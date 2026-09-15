// ============================================================================
// AGRAV — network client: session, lobby traffic, clock sync, and the race
// view (prediction of the local craft, reconciliation against snapshots,
// interpolation of everyone else).
//
//   input clock : ticks are stamped as a continuous local sequence seeded from
//                 the first snapshot plus a round-trip-based lead, then nudged
//                 one tick at a time by how early the server says they arrive;
//                 no wall-clock estimate is involved, so a starved main thread
//                 (10 fps on a weak phone) cannot yank it around
//   render clock: the latest snapshot's tick plus the time since it arrived
//   local craft : shared stepVehicle() every client tick with the live input,
//                 stamped `lead` ticks ahead of the server; on every snapshot
//                 the server's state replaces ours and the inputs it has not
//                 seen yet are replayed on top; the visual pose blends the
//                 old prediction into the corrected one over ~100 ms
//   other craft : rendered a few ticks in the past, between two snapshots
//   projectiles : same as other craft
// ============================================================================

import module from '../../shared/agrav/module.js';
import { WsChannel } from '../../shared/net/channel.js';
import { NetClock } from '../../shared/net/clock.js';
import { MSG, PROTOCOL_VERSION, encodeJson, decodeJson, messageType, isJsonType,
         encodeInputs, encodePing, decodePong, decodeSnapshotHeader } from '../../shared/net/protocol.js';
import { deltaS, wrapS } from '../../shared/sim/spline.js';
import { wrapAngle } from '../../shared/sim/vec.js';
import { makeVehicleState, stepVehicle } from '../../shared/agrav/sim/vehicle.js';
import { vehicleStats } from '../../shared/agrav/vehicles.js';
import { ribbonFor } from '../../shared/agrav/sim/race.js';
import { PHASE, DT, TICK_RATE } from '../../shared/agrav/constants.js';

const TOKEN_KEY = 'agrav_token';
const INTERP_TICKS = 5;          // render others this many ticks behind the server clock
const MAX_EXTRAP_TICKS = 6;
const SMOOTH_TAU = 0.09;         // seconds: correction blend

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
    this.url = '';
    // callbacks
    this.onRoom = null; this.onEvents = null; this.onResults = null; this.onChat = null;
    this.onError = null; this.onState = null; this.onRooms = null;
    this._reset();
  }

  _reset() {
    this.race = null;            // local match state (track, pads) for prediction and rendering
    this.ribbon = null;
    this.snaps = [];             // decoded snapshots, oldest first
    this.latest = null;
    this.pending = [];           // inputs the server has not confirmed
    this.seq = 0;
    this.nextInputTick = 0;      // continuous stamp sequence; 0 until the first snapshot seeds it
    this.holdTicks = 0;          // local ticks to skip (inputs are arriving too early)
    this.marginEma = null;
    this.marginAt = 0;
    this.pred = null;            // predicted vehicle state for me
    this.smooth = { s: 0, t: 0, h: 0, yaw: 0 };
    this.phase = PHASE.LOBBY;
    this.raceTick = -9999;
    this.stats = { in: 0, out: 0, snaps: 0, corrections: 0, maxErr: 0 };
    this.lastSnapTime = 0;
  }

  // ------------------------------------------------------------ connection --

  connect(url, name) {
    this.url = url; this.name = name;
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { return reject(e); }
      const chan = new WsChannel(ws);
      let settled = false;
      ws.addEventListener('open', () => {
        this.chan = chan;
        chan.send(encodeJson(MSG.HELLO, { v: PROTOCOL_VERSION, name, token: this.token }));
      });
      chan.onMessage = (u8) => {
        const type = messageType(u8);
        if (!settled && type === MSG.WELCOME) {
          settled = true; this.connected = true;
          const m = decodeJson(u8);
          this.token = m.token;
          try { localStorage.setItem(TOKEN_KEY, m.token); } catch { /* ignore */ }
          this._pingTimer = setInterval(() => this.ping(), 1000);
          this.ping();
          this._fastPings = 0;
          resolve(m);
          return;
        }
        if (!settled && type === MSG.ERROR) { settled = true; reject(new Error(decodeJson(u8).message)); return; }
        this._onMessage(type, u8);
      };
      chan.onClose = () => {
        clearInterval(this._pingTimer);
        const was = this.connected;
        this.connected = false;
        this.chan = null;
        if (!settled) { settled = true; reject(new Error('connection failed')); }
        else if (was && this.onState) this.onState('disconnected');
      };
    });
  }

  close() { clearInterval(this._burstTimer); if (this.chan) this.chan.close(); }

  ping() { if (this.chan) this.chan.send(encodePing(Math.round(this.clock.now()) >>> 0)); }
  /** burst of pings so a fresh room clock is usable within the countdown */
  _pingBurst() {
    clearInterval(this._burstTimer);
    let n = 0;
    this._burstTimer = setInterval(() => { this.ping(); if (++n >= 10) clearInterval(this._burstTimer); }, 150);
  }

  _send(type, obj) { if (this.chan) this.chan.send(encodeJson(type, obj)); }
  createRoom(opts, isPublic) { this._send(MSG.CREATE_ROOM, { game: 'agrav', opts, public: isPublic }); }
  joinRoom(code) { this._send(MSG.JOIN_ROOM, { code }); }
  leaveRoom() { this._send(MSG.LEAVE_ROOM, {}); }
  setProfile(p) { this._send(MSG.SET_PROFILE, p); }
  setReady(ready) { this._send(MSG.READY, { ready }); }
  setOpts(opts) { this._send(MSG.SET_OPTS, { opts }); }
  setPublic(isPublic) { this._send(MSG.SET_OPTS, { public: !!isPublic }); }
  start() { this._send(MSG.START, {}); }
  loaded() { this._send(MSG.LOADED, {}); }
  addBot() { this._send(MSG.ADD_BOT, {}); }
  kick(id) { this._send(MSG.KICK, { id }); }
  chat(text) { this._send(MSG.CHAT, { text }); }
  listRooms() { this._send(MSG.LIST_ROOMS, {}); }

  // -------------------------------------------------------------- messages --

  _onMessage(type, u8) {
    if (isJsonType(type)) {
      const m = decodeJson(u8);
      switch (type) {
        case MSG.ROOM: return this._onRoom(m && m.code ? m : null);
        case MSG.EVENTS: this.onEvents?.(m); return;
        case MSG.RESULTS: this.onResults?.(m.results); return;
        case MSG.CHAT: this.onChat?.(m); return;
        case MSG.ERROR: this.onError?.(m); return;
        case MSG.LIST_ROOMS: this.onRooms?.(m.rooms); return;
        default: return;
      }
    }
    if (type === MSG.PONG) {
      const p = decodePong(u8);
      this.clock.onPong(p.clientMs, p.serverTick, p.tickMs);
      return;
    }
    if (type === MSG.SNAPSHOT) this._onSnapshot(u8);
  }

  _onRoom(room) {
    const wasRunning = this.room?.phase === 'running';
    this.room = room;
    this.me = room ? room.you : -1;
    if (!room) { this._reset(); this.onRoom?.(null); return; }
    if (room.phase === 'running' && (!wasRunning || !this.race)) this._beginRace(room);
    else if (this.race) this._syncPlayers(room);
    if (room.phase !== 'running' && this.race && wasRunning) { /* keep the race view until results are dismissed */ }
    this.onRoom?.(room);
  }

  /** build the local match (same track, same seed as the server) for prediction and rendering */
  _beginRace(room) {
    this._reset();
    this.clock.reset();
    this._pingBurst();
    this.race = module.createMatch(room.opts, room.seed);
    this.ribbon = this.race.ribbon;
    this._syncPlayers(room);
    const meRacer = this.race.byId[this.me];
    this.pred = makeVehicleState(meRacer ? meRacer.stats : vehicleStats('corsair'));
    if (meRacer) Object.assign(this.pred, { s: meRacer.v.s, t: meRacer.v.t });
    this.phase = PHASE.COUNTDOWN;
  }

  _syncPlayers(room) {
    const seen = new Set();
    for (const p of room.players) {
      seen.add(p.id);
      const existing = this.race.byId[p.id];
      if (!existing) module.addPlayer(this.race, p.id, { ...p.profile, name: p.name }, p.bot);
      else { existing.name = p.name; if (p.profile?.vehicle && p.profile.vehicle !== existing.vehicle) module.setProfile(this.race, p.id, p.profile); }
    }
    for (const r of [...this.race.racers]) if (!seen.has(r.id)) module.removePlayer(this.race, r.id);
  }

  // ------------------------------------------------------------- snapshots --

  _onSnapshot(u8) {
    if (!this.race) return;
    const h = decodeSnapshotHeader(u8);
    const snap = module.decodeSnapshot(h.payload);
    snap.tick = h.tick; snap.phase = h.phase; snap.lastInputSeq = h.lastInputSeq;
    snap.byId = {};
    for (const r of snap.racers) snap.byId[r.id] = r;
    this.stats.snaps++;
    this.stats.in += u8.length;
    if (this.latest && snap.tick <= this.latest.tick) return;   // out of order (impossible on ws, cheap to guard)
    if (this.nextInputTick === 0) this.nextInputTick = snap.tick + this._initialLead();
    else this._onMargin(h.margin);
    this.snaps.push(snap);
    if (this.snaps.length > 12) this.snaps.shift();
    this.latest = snap;
    this.lastSnapTime = this.clock.now();
    this.phase = snap.phase;
    this.raceTick = snap.raceTick;
    // keep the local racer records in step for HUD/logic (hp, items, laps, ranks)
    for (const rec of snap.racers) {
      const r = this.race.byId[rec.id];
      if (!r) continue;
      r.hp = rec.hp; r.item = rec.item; r.ammo = rec.ammo; r.lap = rec.lap; r.rank = rec.rank;
      r.dead = !!(rec.flags & 32); r.finished = !!(rec.flags & 64); r.disconnected = !!(rec.flags & 1024);
      r.burstT = rec.burstT;
    }
    this._reconcile(snap);
  }

  /** ticks to stamp ahead of the newest snapshot before the server has told us anything */
  _initialLead() {
    const half = this.clock.synced ? (this.clock.rtt / 2) / this.clock.tickMs : 4;
    return Math.max(3, Math.min(30, Math.ceil(half) + 3));
  }

  /**
   * margin = how many ticks early our newest input reached the server (server-measured).
   * Aim for a small positive margin: too late → skip a stamp forward; too early → hold one.
   * One nudge per 250 ms, then let the smoothed margin reflect it.
   */
  _onMargin(margin) {
    this.marginEma = this.marginEma == null ? margin : this.marginEma * 0.8 + margin * 0.2;
    const now = this.clock.now();
    const target = 2;
    // hopelessly late (a stall: scene build, tab switch, GC): jump straight to the right stamp, then
    // wait a round trip before trusting the margin again — snapshots keep reporting the stale one until
    // the re-stamped inputs have arrived
    if (margin < -20) {
      if (now - this.marginAt > this.clock.rtt + 200) { this.nextInputTick += Math.min(70, Math.ceil(target - margin)); this.marginEma = null; this.marginAt = now; }
      return;
    }
    if (now - this.marginAt < 250) return;
    if (this.marginEma < target - 1) { this.nextInputTick += Math.min(4, Math.ceil(target - this.marginEma)); this.marginEma = null; this.marginAt = now; }
    else if (this.marginEma > target + 3) { this.holdTicks = Math.min(4, Math.floor(this.marginEma - target - 1)); this.marginEma = null; this.marginAt = now; }
    this.clock.leadTicks = Math.round(this.nextInputTick - this.serverTickNow());   // for display only
  }

  _reconcile(snap) {
    const mine = snap.byId[this.me];
    if (!mine || !this.pred) return;
    // authoritative state at snap.tick
    const before = { s: this.pred.s, t: this.pred.t, h: this.pred.h, yaw: this.pred.yaw };
    Object.assign(this.pred, { s: mine.s, t: mine.t, h: mine.h, W: mine.W, vs: mine.vs, vt: mine.vt, yaw: mine.yaw,
      grounded: !!(mine.flags & 1), shieldT: mine.shieldT, boostT: mine.boostT });
    // drop inputs the server has already simulated, replay the rest
    // inputs the server has simulated are done with; ones stamped absurdly far ahead came from a clock
    // that has since been resynced and would only replay garbage
    this.pending = this.pending.filter(i => i.tick > snap.tick && i.tick <= snap.tick + 60);
    const frozen = snap.phase === PHASE.COUNTDOWN;
    if (!(mine.flags & 32)) {
      for (const i of this.pending) stepVehicle(this.ribbon, this.pred, i, DT, frozen);
    }
    // what the eye was seeing minus what is now true: fold it into the smoothing offset
    const errS = deltaS(this.ribbon, this.pred.s, before.s) + this.smooth.s;
    const errT = before.t - this.pred.t + this.smooth.t;
    const errH = before.h - this.pred.h + this.smooth.h;
    const errYaw = wrapAngle(before.yaw - this.pred.yaw + this.smooth.yaw);
    const mag = Math.hypot(errS, errT);
    this.stats.maxErr = Math.max(this.stats.maxErr, mag);
    if (mag > 8 || Math.abs(errYaw) > 1.2) {   // too far to blend: snap
      this.smooth = { s: 0, t: 0, h: 0, yaw: 0 };
      if (!(mine.flags & 32)) this.stats.corrections++;   // an explosion is not a prediction miss
      this.stats.lastSnap = { tick: snap.tick, raceTick: snap.raceTick, phase: snap.phase, errS: +errS.toFixed(2), errT: +errT.toFixed(2), errYaw: +errYaw.toFixed(2), flags: mine.flags, pending: this.pending.length, lead: this.clock.leadTicks, srvTick: +this.clock.serverTick().toFixed(1) };
      (this.stats.snapLog ||= []).push(this.stats.lastSnap);
    }
    else this.smooth = { s: errS, t: errT, h: errH, yaw: errYaw };
  }

  // ---------------------------------------------------------------- inputs --

  /** one client tick: stamp, send (bundled with the two before it), predict */
  tickInput(input) {
    if (!this.race || !this.chan || this.nextInputTick === 0) return;
    if (this.holdTicks > 0) { this.holdTicks--; return; }
    const rec = { seq: (++this.seq) & 0xffff, tick: this.nextInputTick++, bits: input.bits, steer: input.steer };
    this.pending.push(rec);
    if (this.pending.length > 120) this.pending.shift();
    const bundle = this.pending.slice(-3);
    const bytes = encodeInputs(bundle);
    this.chan.send(bytes, { reliable: false });
    this.stats.out += bytes.length;
    const me = this.race.byId[this.me];
    if (this.pred && me && !me.dead) stepVehicle(this.ribbon, this.pred, rec, DT, this.phase === PHASE.COUNTDOWN);
  }

  // ------------------------------------------------------------------ view --

  /** per-frame: decay the correction offset */
  frame(dt) {
    const k = Math.exp(-dt / SMOOTH_TAU);
    this.smooth.s *= k; this.smooth.t *= k; this.smooth.h *= k; this.smooth.yaw *= k;
  }

  /** server tick right now: the newest snapshot's tick, aged by the time since it arrived, plus half a round trip */
  serverTickNow() {
    if (!this.latest) return 0;
    const half = Math.min(10, (this.clock.rtt / 2) / this.clock.tickMs);
    return this.latest.tick + (this.clock.now() - this.lastSnapTime) / this.clock.tickMs + half;
  }

  /** estimated race tick right now (negative during the countdown) */
  raceTickNow() {
    if (!this.latest) return this.raceTick;
    return this.raceTick + (this.serverTickNow() - this.latest.tick);
  }

  /** pose of my craft for rendering: prediction plus the decaying correction */
  myPose() {
    if (!this.pred) return null;
    const p = this.pred;
    return { s: wrapS(this.ribbon, p.s + this.smooth.s), t: p.t + this.smooth.t, h: p.h + this.smooth.h, yaw: wrapAngle(p.yaw + this.smooth.yaw),
      vs: p.vs, vt: p.vt, bits: p.bits, steer: p.steer, grounded: p.grounded, scraping: p.scraping };
  }

  /** interpolated poses of everyone else (and projectiles) at the render time */
  othersPoses() {
    const out = { racers: [], projectiles: [] };
    if (!this.latest) return out;
    const renderTick = this.serverTickNow() - INTERP_TICKS;
    // bracket
    let a = null, b = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].tick <= renderTick) { a = this.snaps[i]; b = this.snaps[i + 1] || null; break; }
    }
    if (!a) { a = this.snaps[0]; b = this.snaps[1] || null; }
    const L = this.ribbon.length;
    let u = 0, extrap = 0;
    if (b) u = Math.max(0, Math.min(1, (renderTick - a.tick) / Math.max(1, b.tick - a.tick)));
    else extrap = Math.max(0, Math.min(MAX_EXTRAP_TICKS, renderTick - a.tick)) * DT;
    const lerpAngle = (x, y, k) => wrapAngle(x + wrapAngle(y - x) * k);
    for (const ra of a.racers) {
      if (ra.id === this.me) continue;
      const rb = b ? b.byId[ra.id] : null;
      let s, t, h, yaw;
      if (rb) {
        s = wrapS(this.ribbon, ra.s + deltaS(this.ribbon, ra.s, rb.s) * u);
        t = ra.t + (rb.t - ra.t) * u; h = ra.h + (rb.h - ra.h) * u; yaw = lerpAngle(ra.yaw, rb.yaw, u);
      } else {
        s = wrapS(this.ribbon, ra.s + ra.vs * extrap); t = ra.t + ra.vt * extrap; h = ra.h; yaw = ra.yaw;
      }
      out.racers.push({ ...ra, s, t, h, yaw });
    }
    for (const pa of a.projectiles) {
      const pb = b ? b.projectiles.find(p => p.id === pa.id) : null;
      let s, t, h;
      if (pb) { s = wrapS(this.ribbon, pa.s + deltaS(this.ribbon, pa.s, pb.s) * u); t = pa.t + (pb.t - pa.t) * u; h = pa.h + (pb.h - pa.h) * u; }
      else if (pa.kind === 'mine') { s = pa.s; t = pa.t; h = pa.h; }
      else { const d = pa.speed * (b ? 0 : extrap); s = wrapS(this.ribbon, pa.s + Math.cos(pa.yaw) * d); t = pa.t + Math.sin(pa.yaw) * d; h = pa.h; }
      out.projectiles.push({ ...pa, s, t, h });
    }
    void L;
    return out;
  }

  get rtt() { return this.clock.rtt; }
}
