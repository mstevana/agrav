// ============================================================================
// Volley — network client: session, lobby traffic, clock sync, and the match
// view (prediction of the local blob, reconciliation against snapshots,
// interpolation of everyone and the ball).
//
//   input clock : NetClock estimates the server tick from pings and tells us
//                 how far ahead to stamp inputs; the server-reported margin
//                 nudges the lead. Inputs are sent 60/s, the last three bundled.
//   local blob  : shared stepBlob() every tick with the live input, stamped a
//                 few ticks ahead; each snapshot replaces it with the server's
//                 and replays the inputs the server has not applied yet.
//   others+ball : rendered a few ticks in the past, between two snapshots.
// ============================================================================

import module2 from '../../shared/volley/module.js';
import module1 from '../../shared/volley/module1.js';
import module3 from '../../shared/volley/module3.js';
import { WsChannel } from '../../shared/net/channel.js';
import { NetClock } from '../../shared/net/clock.js';
import { MSG, PROTOCOL_VERSION, encodeJson, decodeJson, messageType, isJsonType,
         encodeInputs, encodePing, decodePong, decodeSnapshotHeader } from '../../shared/net/protocol.js';
import { stepBlob } from '../../shared/volley/sim.js';
import { DT, TICK_RATE } from '../../shared/volley/constants.js';

const TOKEN_KEY = 'volley_token';
const INTERP_TICKS = 4;   // render others this many ticks behind the server clock

const toMove = (i) => ({ left: i.steer < -0.3, right: i.steer > 0.3, jump: !!(i.bits & 1) });
const moduleFor = (game) => (game === 'volley1' ? module1 : game === 'volley3' ? module3 : module2);

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
    this.module = module2;
    // callbacks
    this.onRoom = this.onEvents = this.onResults = this.onChat = null;
    this.onError = this.onState = this.onRooms = null;
    this._reset();
  }

  _reset() {
    this.state = null;       // local match (blobs with zones/teams) for prediction and rendering
    this.snaps = [];         // decoded snapshots, oldest first
    this.latest = null;
    this.pending = [];       // {seq, tick, move} not yet confirmed
    this.seq = 0;
    this.lastTick = 0;
    this.pred = null;        // predicted blob for me
    this.lastSnapTime = 0;
    this.headerPhase = 0;
  }

  // ------------------------------------------------------------ connection --

  connect(url, name) {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return Promise.reject(e); }
    return this._attach(new WsChannel(ws), name, (hello) => ws.addEventListener('open', hello));
  }

  /**
   * Solo play: the lobby/room engine runs in this page (see server/solo.js) and we
   * talk to it over a loopback channel. Everything above the transport is unchanged.
   */
  connectLocal(channel, name) {
    this.local = true;
    return this._attach(channel, name, (hello) => hello());
  }

  /** shared by both transports: send HELLO once the channel is usable, resolve on WELCOME */
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
  createRoom(game, opts, isPublic) { this._send(MSG.CREATE_ROOM, { game: game || 'volley', opts, public: isPublic !== false }); }
  joinRoom(code) { this._send(MSG.JOIN_ROOM, { code }); }
  leaveRoom() { this._send(MSG.LEAVE_ROOM, {}); }
  setReady(ready) { this._send(MSG.READY, { ready }); }
  setOpts(opts) { this._send(MSG.SET_OPTS, { opts }); }
  start() { this._send(MSG.START, {}); }
  addBot() { this._send(MSG.ADD_BOT, {}); }
  kick(id) { this._send(MSG.KICK, { id }); }
  listRooms() { this._send(MSG.LIST_ROOMS, {}); }

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
        case MSG.LIST_ROOMS: return this.onRooms?.(m.rooms);
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

  /** build the local match (same opts + seed as the server) for prediction and rendering */
  _beginMatch(room) {
    this._reset();
    this.clock.reset();
    this._pingBurst();
    this.module = moduleFor(room.game);
    this.state = this.module.createMatch(room.opts, room.seed);
    const mine = this.state.blobs[this.me];
    if (mine) this.pred = { ...mine };
  }

  // ------------------------------------------------------------- snapshots --

  _onSnapshot(u8) {
    if (!this.state) return;
    const h = decodeSnapshotHeader(u8);
    const snap = this.module.decodeSnapshot(h.payload);
    snap.tick = h.tick;
    if (this.latest && snap.tick <= this.latest.tick) return;   // stale/out of order
    this.headerPhase = h.phase;
    this.clock.onMargin(h.margin);
    this.snaps.push(snap);
    if (this.snaps.length > 12) this.snaps.shift();
    this.latest = snap;
    this.lastSnapTime = this.clock.now();
    // fold the authoritative score/serve state into the local match for the HUD
    this.state.score = snap.score;
    this.state.serving = snap.serving;
    this.state.touchTeam = snap.touchTeam;
    this.state.touches = snap.touches;
    this.state.phase = h.phase === this.module.PHASE.OVER ? 'over' : h.phase === this.module.PHASE.POINT ? 'point' : 'play';
    this._reconcile(snap);
  }

  _reconcile(snap) {
    if (!this.pred) return;
    const mine = snap.blobs[this.me];
    if (!mine) return;
    this.pred.x = mine.x; this.pred.y = mine.y; this.pred.vy = mine.vy; this.pred.onGround = mine.onGround;
    this.pending = this.pending.filter((i) => i.tick > snap.tick && i.tick <= snap.tick + 90);
    for (const i of this.pending) stepBlob(this.pred, i.move);
  }

  // ---------------------------------------------------------------- inputs --

  /** one client tick: stamp, send (bundled with the two before it), predict my blob */
  tickInput(input) {
    if (!this.state || !this.chan || !this.latest || !this.clock.synced) return;
    let tick = this.clock.inputTick();
    if (tick <= this.lastTick) tick = this.lastTick + 1;
    this.lastTick = tick;
    const move = toMove(input);
    const rec = { seq: (++this.seq) & 0xffff, tick, bits: input.bits, steer: input.steer };
    this.pending.push({ seq: rec.seq, tick, move });
    if (this.pending.length > 120) this.pending.shift();
    this.chan.send(encodeInputs(this.pending.slice(-3).map((p) => ({ seq: p.seq, tick: p.tick, bits: (p.move.jump ? 1 : 0), steer: p.move.right ? 1 : p.move.left ? -1 : 0 }))));
    if (this.pred) stepBlob(this.pred, move);
  }

  // ------------------------------------------------------------------ view --

  serverTickNow() {
    if (!this.latest) return 0;
    const half = Math.min(10, (this.clock.rtt / 2) / this.clock.tickMs);
    return this.latest.tick + (this.clock.now() - this.lastSnapTime) / this.clock.tickMs + half;
  }

  /** a render-ready match state: my blob predicted, everyone and the ball interpolated */
  viewState() {
    if (!this.state || !this.latest) return this.state;
    const st = this.state;
    const renderTick = this.serverTickNow() - INTERP_TICKS;
    let a = null, b = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].tick <= renderTick) { a = this.snaps[i]; b = this.snaps[i + 1] || null; break; }
    }
    if (!a) { a = this.snaps[0]; b = this.snaps[1] || null; }
    const u = b ? Math.max(0, Math.min(1, (renderTick - a.tick) / Math.max(1, b.tick - a.tick))) : 0;
    const lerp = (x, y) => x + (y - x) * u;
    const ball = b
      ? { ...b.ball, x: lerp(a.ball.x, b.ball.x), y: lerp(a.ball.y, b.ball.y), angle: a.ball.angle + shortestAngle(a.ball.angle, b.ball.angle) * u }
      : { ...a.ball };
    const blobs = st.blobs.map((base) => {
      const ra = a.blobs[base.slot];
      const rb = b ? b.blobs[base.slot] : null;
      let x, y, vy, onGround;
      if (base.slot === this.me && this.pred) { x = this.pred.x; y = this.pred.y; vy = this.pred.vy; onGround = this.pred.onGround; }
      else if (rb) { x = lerp(ra.x, rb.x); y = lerp(ra.y, rb.y); vy = rb.vy; onGround = rb.onGround; }
      else { x = ra.x; y = ra.y; vy = ra.vy; onGround = ra.onGround; }
      return { ...base, x, y, vy, onGround };
    });
    return { ...st, ball, blobs };
  }

  get rtt() { return this.clock.rtt; }
}

function shortestAngle(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
