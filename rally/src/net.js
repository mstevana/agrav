// ============================================================================
// Scrap Rally — network client: the session, the lobby traffic, the clock, the
// garage's record, and the running race.
//
//   input clock : NetClock estimates the server tick from pings and says how far
//                 ahead to stamp inputs; the server's measured margin nudges the
//                 lead. Inputs go at 60 Hz, the last three bundled, so one lost
//                 packet costs nothing.
//   my car      : the shared stepCar() every tick against the live input. Each
//                 snapshot replaces it with the server's own record and replays
//                 the inputs the server has not applied yet; whatever is left
//                 over is blended away over about a tenth of a second rather
//                 than snapping, so a correction is felt as a settle, not a jump.
//   everyone    : drawn a few ticks in the past, between the two snapshots that
//                 bracket that moment.
// ============================================================================

import rally from '../../shared/rally/module.js';
import { WsChannel } from '../../shared/net/channel.js';
import { NetClock } from '../../shared/net/clock.js';
import { MSG, PROTOCOL_VERSION, encodeJson, decodeJson, messageType, isJsonType,
         encodeInputs, encodePing, decodePong, decodeSnapshotHeader } from '../../shared/net/protocol.js';
import { stepCar } from '../../shared/rally/sim/car.js';
import { buildTrack } from '../../shared/rally/sim/track.js';
import { DT, TICK_RATE, PHASE } from '../../shared/rally/constants.js';

const TOKEN_KEY = 'rally_token';
const CAREER_KEY = 'rally_career_key';
const INTERP_TICKS = 4;          // render everyone else this many ticks behind the server clock
// How a correction is absorbed. A car cannot predict being shunted by another
// one — contacts are the server's alone — so an ordinary race produces errors of
// a few metres whenever two cars touch. Blending those away over a fixed tenth
// of a second makes the car appear to slide at sixty metres a second; the blend
// therefore lasts in proportion to how far it has to move, up to a quarter of a
// second, and only a gap too large to be a shunt is snapped.
const BLEND_MIN_MS = 70;
const BLEND_PER_METRE_MS = 26;
const BLEND_MAX_MS = 260;
const HARD_CORRECTION = 12;      // metres: past this it is a desync, not a shove

/** the long-lived identity behind a career; unrelated to the session token */
export function careerKey() {
  try {
    let k = localStorage.getItem(CAREER_KEY);
    if (!k || !/^[A-Za-z0-9_-]{16,64}$/.test(k)) {
      const b = new Uint8Array(16);
      (globalThis.crypto || {}).getRandomValues?.(b) || b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); });
      k = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(CAREER_KEY, k);
    }
    return k;
  } catch { return null; }          // storage blocked: play without a record
}

export class Client {
  constructor() {
    this.chan = null;
    this.clock = new NetClock(1000 / TICK_RATE);
    this.token = null;
    try { this.token = localStorage.getItem(TOKEN_KEY); } catch { /* ignore */ }
    this.careerKey = careerKey();
    this.career = null;
    this.name = '';
    this.room = null;
    this.me = -1;
    this.connected = false;
    this.module = rally;
    this.onRoom = this.onEvents = this.onResults = this.onChat = null;
    this.onError = this.onState = this.onRooms = this.onCareer = null;
    /** what the socket has actually carried, for the soak tool and the HUD */
    this.stats = { in: 0, out: 0, snaps: 0 };
    this._reset();
  }

  _reset() {
    this.state = null;          // the local match: the track, and a car per seat
    this.track = null;
    this.snaps = [];
    this.latest = null;
    this.pending = [];          // {seq, tick, input} the server has not confirmed
    this.seq = 0;
    this.lastTick = 0;
    this.pred = null;           // my own car, stepped locally
    this.blend = null;          // {x, z, yaw, until} what is left of the last correction
    this.lastSnapTime = 0;
    this.headerPhase = PHASE.LOBBY;
    this.raceTick = 0;
    this.corrections = 0;
    this.predError = 0;
  }

  // ------------------------------------------------------------ connection --

  connect(url, name) {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return Promise.reject(e); }
    return this._attach(new WsChannel(ws), name, (hello) => ws.addEventListener('open', hello));
  }

  /**
   * Solo play: the lobby/room engine runs in this page (see server/solo.js) and we talk to
   * it over a loopback channel. Prediction and the garage work the same; the trip is zero.
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
        chan.send(encodeJson(MSG.HELLO, { v: PROTOCOL_VERSION, name, token: this.token, careerKey: this.careerKey }));
      };
      chan.onMessage = (u8) => {
        this.stats.in += u8.length;
        const type = messageType(u8);
        if (!settled && type === MSG.WELCOME) {
          settled = true; this.connected = true;
          const m = decodeJson(u8);
          this.token = m.token;
          try { localStorage.setItem(TOKEN_KEY, m.token); } catch { /* ignore */ }
          this._pingTimer = setInterval(() => this.ping(), 1000);
          this.ping();
          this.requestCareer();
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
  send(u8) { if (!this.chan) return; this.stats.out += u8.length; this.chan.send(u8); }
  ping() { this.send(encodePing(Math.round(this.clock.now()) >>> 0)); }
  _pingBurst() { clearInterval(this._burst); let n = 0; this._burst = setInterval(() => { this.ping(); if (++n >= 10) clearInterval(this._burst); }, 150); }

  _send(type, obj) { this.send(encodeJson(type, obj)); }
  createRoom(opts, isPublic) { this._send(MSG.CREATE_ROOM, { game: 'rally', opts, public: isPublic !== false }); }
  joinRoom(code) { this._send(MSG.JOIN_ROOM, { code }); }
  leaveRoom() { this._send(MSG.LEAVE_ROOM, {}); }
  setReady(ready) { this._send(MSG.READY, { ready }); }
  setProfile(p) { this._send(MSG.SET_PROFILE, p); }
  setOpts(opts, isPublic) { this._send(MSG.SET_OPTS, { opts, public: isPublic }); }
  start() { this._send(MSG.START, {}); }
  addBot() { this._send(MSG.ADD_BOT, {}); }
  kick(id) { this._send(MSG.KICK, { id }); }
  listRooms() { this._send(MSG.LIST_ROOMS, {}); }
  loaded() { this._send(MSG.LOADED, {}); }
  requestCareer() { if (this.careerKey) this._send(MSG.CAREER_ACTION, { game: 'rally', action: 'get' }); }
  careerAction(action, extra = {}) { this._send(MSG.CAREER_ACTION, { game: 'rally', action, ...extra }); }

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
        case MSG.CAREER: { if (m.career) this.career = m.career; return this.onCareer?.(m); }
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

  /** build the local match from the same options and seed the server used */
  _beginMatch(room) {
    this._reset();
    this.clock.reset();
    this._pingBurst();
    this.state = rally.createMatch(room.opts, room.seed);
    this.track = this.state.track;
    for (const seat of room.players) {
      rally.addPlayer(this.state, seat.id, { ...(seat.profile || {}), name: seat.name }, seat.bot);
    }
    rally.start(this.state, 0);
    const mine = this.state.byId[this.me];
    if (mine) this.pred = mine.c;
  }

  // ------------------------------------------------------------- snapshots --

  _onSnapshot(u8) {
    if (!this.state) return;
    const h = decodeSnapshotHeader(u8);
    const snap = rally.decodeSnapshot(h.payload);
    snap.tick = h.tick;
    if (this.latest && snap.tick <= this.latest.tick) return;      // stale or out of order
    this.headerPhase = h.phase;
    this.raceTick = snap.raceTick;
    this.clock.onMargin(h.margin);
    this.snaps.push(snap);
    if (this.snaps.length > 12) this.snaps.shift();
    this.stats.snaps++;
    this.latest = snap;
    this.lastSnapTime = this.clock.now();
    // the shells and the pads are the server's word; they are not predicted
    this.state.wrecks = snap.wrecks.map(w => ({ ...w, r: (this.state.byId[w.id]?.c.radius || 2) * 0.6 }));
    for (let i = 0; i < this.state.pads.length; i++) {
      const live = snap.pads[i];
      this.state.pads[i].respawnTick = live ? 0 : this.state.tick + 1;
      if (live) this.state.pads[i].live = live;
    }
    for (const rec of snap.cars) {
      const car = this.state.byId[rec.id];
      if (!car) continue;
      car.hull = rec.hull; car.maxHull = rec.maxHull; car.lap = rec.lap; car.rank = rec.rank;
      car.dead = rec.dead; car.finished = rec.finished;
      car.ammo = rec.ammo; car.mines = rec.mines; car.nitro = rec.nitro;
      car.weapon = rec.weapon; car.burstT = rec.burstT;
    }
    this._reconcile(snap);
  }

  /**
   * Put my car where the server says it was, replay everything the server has
   * not seen, and keep whatever difference is left as a blend rather than a jump.
   */
  _reconcile(snap) {
    if (!this.pred) return;
    const mine = snap.cars.find(r => r.id === this.me);
    if (!mine) return;
    const wasX = this.pred.x, wasZ = this.pred.z, wasYaw = this.pred.yaw;

    this.pred.x = mine.x; this.pred.z = mine.z; this.pred.yaw = mine.yaw;
    this.pred.vx = mine.vx; this.pred.vz = mine.vz;
    this.pred.nitroT = mine.nitroT;
    this.pred.s = mine.x === wasX ? this.pred.s : this.pred.s;     // the hint is still close enough to reuse

    this.pending = this.pending.filter(p => p.tick > snap.tick && p.tick <= snap.tick + 90);
    for (const p of this.pending) stepCar(this.track, this.pred, p.input, DT);

    const dx = wasX - this.pred.x, dz = wasZ - this.pred.z;
    const err = Math.hypot(dx, dz);
    this.predError = err;
    if (err > HARD_CORRECTION) { this.blend = null; this.corrections++; return; }
    if (err > 0.01) {
      const span = Math.min(BLEND_MAX_MS, BLEND_MIN_MS + err * BLEND_PER_METRE_MS);
      this.blend = { x: dx, z: dz, yaw: shortestAngle(this.pred.yaw, wasYaw), until: this.clock.now() + span, span };
    } else this.blend = null;
  }

  // ---------------------------------------------------------------- inputs --

  /** one client tick: stamp it, send it with the two before it, and drive my own car with it */
  tickInput(input) {
    if (!this.state || !this.chan || !this.latest || !this.clock.synced) return;
    let tick = this.clock.inputTick();
    if (tick <= this.lastTick) tick = this.lastTick + 1;
    this.lastTick = tick;
    const rec = { seq: (++this.seq) & 0xffff, tick, bits: input.bits, steer: input.steer };
    this.pending.push({ seq: rec.seq, tick, input: { bits: input.bits, steer: input.steer } });
    if (this.pending.length > 120) this.pending.shift();
    this.send(encodeInputs(this.pending.slice(-3).map(p => ({ seq: p.seq, tick: p.tick, bits: p.input.bits, steer: p.input.steer }))));
    const me = this.state.byId[this.me];
    if (this.pred && me && !me.dead) {
      stepCar(this.track, this.pred, input, DT, this.headerPhase === PHASE.COUNTDOWN);
    }
  }

  // ------------------------------------------------------------------ view --

  serverTickNow() {
    if (!this.latest) return 0;
    const half = Math.min(10, (this.clock.rtt / 2) / this.clock.tickMs);
    return this.latest.tick + (this.clock.now() - this.lastSnapTime) / this.clock.tickMs + half;
  }

  /**
   * Everything the renderer needs for this frame: my car where I predict it (plus
   * whatever is left of the last correction), everyone else between the two
   * snapshots that bracket a moment a few ticks ago.
   */
  viewState() {
    if (!this.state || !this.latest) return null;
    const renderTick = this.serverTickNow() - INTERP_TICKS;
    let a = null, b = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].tick <= renderTick) { a = this.snaps[i]; b = this.snaps[i + 1] || null; break; }
    }
    if (!a) { a = this.snaps[0]; b = this.snaps[1] || null; }
    const u = b ? Math.max(0, Math.min(1, (renderTick - a.tick) / Math.max(1, b.tick - a.tick))) : 0;
    const mix = (x, y) => x + (y - x) * u;

    let bx = 0, bz = 0, byaw = 0;
    if (this.blend) {
      const left = Math.max(0, this.blend.until - this.clock.now()) / this.blend.span;
      if (left <= 0) this.blend = null;
      else { bx = this.blend.x * left; bz = this.blend.z * left; byaw = this.blend.yaw * left; }
    }

    const cars = [];
    for (const seat of this.state.cars) {
      const ra = a.cars.find(r => r.id === seat.id);
      if (!ra) continue;
      const rb = b ? b.cars.find(r => r.id === seat.id) : null;
      let x, z, yaw, vx, vz, sliding;
      if (seat.id === this.me && this.pred) {
        x = this.pred.x + bx; z = this.pred.z + bz; yaw = this.pred.yaw + byaw;
        vx = this.pred.vx; vz = this.pred.vz; sliding = this.pred.sliding;
      } else if (rb) {
        x = mix(ra.x, rb.x); z = mix(ra.z, rb.z); yaw = ra.yaw + shortestAngle(ra.yaw, rb.yaw) * u;
        vx = rb.vx; vz = rb.vz; sliding = rb.sliding;
      } else {
        x = ra.x; z = ra.z; yaw = ra.yaw; vx = ra.vx; vz = ra.vz; sliding = ra.sliding;
      }
      cars.push({
        id: seat.id, name: seat.name, bot: seat.bot, car: seat.stats.id, radius: seat.c.radius,
        x, z, yaw, vx, vz, sliding,
        speed: Math.hypot(vx, vz),
        hull: ra.hull, maxHull: ra.maxHull, lap: ra.lap, rank: ra.rank,
        dead: ra.dead, finished: ra.finished, nitro: ra.nitroT > 0,
        weapon: ra.weapon, ammo: ra.ammo, mines: ra.mines, nitroCharges: ra.nitro,
        firing: ra.burstT > 0,
        mine: seat.id === this.me
      });
    }
    return {
      cars, wrecks: this.latest.wrecks, entities: this.latest.entities, pads: this.latest.pads,
      phase: this.headerPhase, raceTick: this.raceTick, laps: this.state.opts.laps,
      track: this.track, countdown: Math.max(0, Math.ceil(-this.raceTick / TICK_RATE))
    };
  }

  get rtt() { return this.clock.rtt; }
}

function shortestAngle(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
