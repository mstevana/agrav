// ============================================================================
// Spacewar — network client: session, lobby traffic, clock sync, and the match
// view (prediction of the local ship, reconciliation against snapshots,
// interpolation of everyone else and every torpedo).
//
//   input clock : NetClock estimates the server tick from pings and tells us
//                 how far ahead to stamp inputs; the server-reported margin
//                 nudges the lead. Inputs are sent 60/s, the last three bundled.
//   local ship  : shared stepShip() every tick with the live input; each
//                 snapshot replaces it with the server's and replays the inputs
//                 the server has not applied yet. What is left of a correction
//                 is eased out over ~100 ms rather than snapped.
//   the rest    : drawn a few ticks in the past, between two snapshots, with
//                 every lerp taken the short way round the wrapping arena.
// ============================================================================

import spacewar from '../../shared/spacewar/module.js';
import { WsChannel } from '../../shared/net/channel.js';
import { NetClock } from '../../shared/net/clock.js';
import { MSG, PROTOCOL_VERSION, encodeJson, decodeJson, messageType, isJsonType,
         encodeInputs, encodePing, decodePong, decodeSnapshotHeader } from '../../shared/net/protocol.js';
import { stepShip, wrap, wrapDelta, wrapAngle } from '../../shared/spacewar/sim.js';
import { TICK_RATE, FIELD_W, FIELD_H, PHASE } from '../../shared/spacewar/constants.js';

const TOKEN_KEY = 'spacewar_token';
const INTERP_TICKS = 4;        // render others this many ticks behind the server clock
const SMOOTH_MAX = 90;         // px: a correction bigger than this is a teleport (new round, hyperspace), not an error
const PHASE_NAME = { [PHASE.INTRO]: 'intro', [PHASE.PLAY]: 'play', [PHASE.OUTRO]: 'outro', [PHASE.OVER]: 'over' };

const quantSteer = (s) => Math.round(Math.max(-1, Math.min(1, s || 0)) * 127) / 127;
const lerpWrap = (a, b, u, size) => wrap(a + wrapDelta(b - a, size) * u, size);

export class Client {
  constructor() {
    this.chan = null;
    this.clock = new NetClock(1000 / TICK_RATE);
    this.token = null;
    try { this.token = localStorage.getItem(TOKEN_KEY); } catch { /* ignore */ }
    this.name = '';
    this.room = null;
    this.me = -1;
    this.connected = false;
    this.onRoom = this.onEvents = this.onResults = this.onChat = null;
    this.onError = this.onState = this.onRooms = null;
    this._reset();
  }

  _reset() {
    this.state = null;       // local match: options, seats
    this.snaps = [];         // decoded snapshots, oldest first
    this.latest = null;
    this.phase = 'intro';
    this.pending = [];       // {seq, tick, input} not yet confirmed
    this.seq = 0;
    this.lastTick = 0;
    this.pred = null;        // predicted ship for me
    this.offset = { x: 0, y: 0 };
    this.lastSnapTime = 0;
  }

  // ------------------------------------------------------------ connection --

  connect(url, name) {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return Promise.reject(e); }
    return this._attach(new WsChannel(ws), name, (hello) => ws.addEventListener('open', hello));
  }

  /** solo play: the lobby/room engine runs in this page (server/solo.js), over a loopback channel */
  connectLocal(channel, name) {
    this.local = true;
    return this._attach(channel, name, (hello) => hello());
  }

  _attach(chan, name, whenReady) {
    this.name = name;
    return new Promise((resolve, reject) => {
      let settled = false;
      const hello = () => {
        this.chan = chan;
        chan.send(encodeJson(MSG.HELLO, { v: PROTOCOL_VERSION, name, token: this.token }));
      };
      chan.onMessage = (u8) => {
        const type = messageType(u8);
        if (!settled && type === MSG.WELCOME) {
          settled = true; this.connected = true;
          const m = decodeJson(u8);
          this.token = m.token;
          try { localStorage.setItem(TOKEN_KEY, m.token); } catch { /* ignore */ }
          this._pingTimer = setInterval(() => this.ping(), 1000);
          this.ping();
          resolve(m);
          return;
        }
        if (!settled && type === MSG.ERROR) { settled = true; reject(new Error(decodeJson(u8).message)); return; }
        this._onMessage(type, u8);
      };
      chan.onClose = () => {
        clearInterval(this._pingTimer);
        const was = this.connected;
        this.connected = false; this.chan = null;
        if (!settled) { settled = true; reject(new Error('connection failed')); }
        else if (was) this.onState?.('disconnected');
      };
      whenReady(hello);
    });
  }

  close() { if (this.chan) this.chan.close(); }
  ping() { if (this.chan) this.chan.send(encodePing(Math.round(this.clock.now()) >>> 0)); }
  _pingBurst() { clearInterval(this._burst); let n = 0; this._burst = setInterval(() => { this.ping(); if (++n >= 10) clearInterval(this._burst); }, 150); }

  _send(type, obj) { if (this.chan) this.chan.send(encodeJson(type, obj)); }
  createRoom(opts, isPublic) { this._send(MSG.CREATE_ROOM, { game: 'spacewar', opts, public: isPublic !== false }); }
  joinRoom(code) { this._send(MSG.JOIN_ROOM, { code }); }
  leaveRoom() { this._send(MSG.LEAVE_ROOM, {}); }
  setReady(ready) { this._send(MSG.READY, { ready }); }
  setOpts(opts, isPublic) { this._send(MSG.SET_OPTS, { opts, public: isPublic }); }
  start() { this._send(MSG.START, {}); }
  addBot(id) { this._send(MSG.ADD_BOT, id === undefined ? {} : { id }); }
  kick(id) { this._send(MSG.KICK, { id }); }

  // -------------------------------------------------------------- messages --

  _onMessage(type, u8) {
    if (isJsonType(type)) {
      const m = decodeJson(u8);
      switch (type) {
        case MSG.ROOM: return this._onRoom(m && m.code ? m : null);
        case MSG.EVENTS: return this.onEvents?.(m);
        case MSG.RESULTS: return this.onResults?.(m.results);
        case MSG.CHAT: return this.onChat?.(m);
        case MSG.ERROR: return this.onError?.(m);
        default: return;
      }
    }
    if (type === MSG.PONG) { const p = decodePong(u8); this.clock.onPong(p.clientMs, p.serverTick, p.tickMs); return; }
    if (type === MSG.SNAPSHOT) this._onSnapshot(u8);
  }

  _onRoom(room) {
    const wasRunning = this.room?.phase === 'running';
    this.room = room;
    this.me = room ? room.you : -1;
    if (!room) { this._reset(); this.onRoom?.(null); return; }
    if (room.phase === 'running' && (!wasRunning || !this.state)) this._beginMatch(room);
    this.onRoom?.(room);
  }

  _beginMatch(room) {
    this._reset();
    this.clock.reset();
    this._pingBurst();
    this.state = spacewar.createMatch(room.opts, room.seed);
  }

  // ------------------------------------------------------------- snapshots --

  _onSnapshot(u8) {
    if (!this.state) return;
    const h = decodeSnapshotHeader(u8);
    const snap = spacewar.decodeSnapshot(h.payload);
    snap.tick = h.tick;
    snap.phase = PHASE_NAME[h.phase] || 'play';
    if (this.latest && snap.tick <= this.latest.tick) return;   // stale / out of order
    this.clock.onMargin(h.margin);
    this.snaps.push(snap);
    if (this.snaps.length > 12) this.snaps.shift();
    this.latest = snap;
    this.phase = snap.phase;
    this.lastSnapTime = this.clock.now();
    this._reconcile(snap);
  }

  /** can a ship move on `tick`? not before the round is released, not once the match is over */
  _movable(tick, snap = this.latest) {
    if (!snap) return false;
    if (snap.phase === 'over') return false;
    if (snap.phase === 'intro') return tick > snap.tick + snap.timer;
    return true;
  }

  _reconcile(snap) {
    const mine = snap.ships[this.me];
    if (!mine) { this.pred = null; return; }
    const before = this.pred && this.pred.alive ? { x: this.pred.x + this.offset.x, y: this.pred.y + this.offset.y } : null;
    this.pred = { ...mine };
    this.pending = this.pending.filter((i) => i.tick > snap.tick && i.tick <= snap.tick + 90);
    for (const i of this.pending) if (this._movable(i.tick, snap)) stepShip(this.pred, i.input, this.state.opts.planet);
    // keep what is left of the error on screen and ease it away, unless it was a jump
    if (before && this.pred.alive && this.pred.hyper === 0) {
      const dx = wrapDelta(before.x - this.pred.x, FIELD_W), dy = wrapDelta(before.y - this.pred.y, FIELD_H);
      this.offset = Math.hypot(dx, dy) < SMOOTH_MAX ? { x: dx, y: dy } : { x: 0, y: 0 };
    } else this.offset = { x: 0, y: 0 };
  }

  // ---------------------------------------------------------------- inputs --

  /** one client tick: stamp, send (bundled with the two before it), predict my ship */
  tickInput(raw) {
    if (!this.state || !this.chan || !this.latest || !this.clock.synced) return;
    let tick = this.clock.inputTick();
    if (tick <= this.lastTick) tick = this.lastTick + 1;
    this.lastTick = tick;
    const input = { bits: raw.bits & 0xff, steer: quantSteer(raw.steer) };
    this.pending.push({ seq: (++this.seq) & 0xffff, tick, input });
    if (this.pending.length > 120) this.pending.shift();
    this.chan.send(encodeInputs(this.pending.slice(-3).map((p) => ({ seq: p.seq, tick: p.tick, bits: p.input.bits, steer: p.input.steer }))));
    if (this.pred && this._movable(tick)) stepShip(this.pred, input, this.state.opts.planet);
  }

  /** ease the leftover correction out; call once per frame */
  decay(dt) {
    const k = Math.exp(-dt / 0.1);
    this.offset.x *= k; this.offset.y *= k;
  }

  // ------------------------------------------------------------------ view --

  serverTickNow() {
    if (!this.latest) return 0;
    const half = Math.min(10, (this.clock.rtt / 2) / this.clock.tickMs);
    return this.latest.tick + (this.clock.now() - this.lastSnapTime) / this.clock.tickMs + half;
  }

  /**
   * A render-ready match: my ship predicted, the others and every torpedo
   * interpolated, and the round, timers and scores from the newest snapshot.
   */
  viewState() {
    const L = this.latest;
    if (!this.state || !L) return null;
    const renderTick = this.serverTickNow() - INTERP_TICKS;
    let a = null, b = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].tick <= renderTick) { a = this.snaps[i]; b = this.snaps[i + 1] || null; break; }
    }
    if (!a) { a = this.snaps[0]; b = this.snaps[1] || null; }
    const u = b ? Math.max(0, Math.min(1, (renderTick - a.tick) / Math.max(1, b.tick - a.tick))) : 0;

    const ships = L.ships.map((latest, id) => {
      if (!latest) return null;
      if (id === this.me && this.pred) {
        const p = this.pred;
        return { ...latest, ...p, x: wrap(p.x + this.offset.x, FIELD_W), y: wrap(p.y + this.offset.y, FIELD_H), me: true };
      }
      const sa = a.ships[id], sb = b ? b.ships[id] : null;
      if (!sa) return { ...latest };
      // a death or a jump shows at once: the event that goes with it has already arrived
      const alive = latest.alive && sa.alive;
      const hyper = latest.hyper > 0 ? latest.hyper : sa.hyper;
      if (!sb || sb.hyper > 0 || sa.hyper > 0 || !sb.alive) return { ...latest, ...sa, alive, hyper, wins: latest.wins, kills: latest.kills };
      return {
        ...latest,
        x: lerpWrap(sa.x, sb.x, u, FIELD_W), y: lerpWrap(sa.y, sb.y, u, FIELD_H),
        vx: sa.vx + (sb.vx - sa.vx) * u, vy: sa.vy + (sb.vy - sa.vy) * u,
        a: wrapAngle(sa.a + wrapAngle(sb.a - sa.a) * u),
        thrust: u < 0.5 ? sa.thrust : sb.thrust,
        alive, hyper,
      };
    });

    const torps = [];
    if (b) {
      const inA = new Map(a.torps.map((t) => [t.id, t]));
      for (const tb of b.torps) {
        const ta = inA.get(tb.id);
        if (ta) torps.push({ ...tb, x: lerpWrap(ta.x, tb.x, u, FIELD_W), y: lerpWrap(ta.y, tb.y, u, FIELD_H) });
        else if (u > 0.5) torps.push(tb);
      }
    } else torps.push(...a.torps);

    return {
      phase: L.phase, round: L.round, timer: L.timer, roundWinner: L.roundWinner, winner: L.winner,
      tick: L.tick, opts: this.state.opts, ships, torps,
    };
  }

  get rtt() { return this.clock.rtt; }
}
