// ============================================================================
// A room: one match of one game, its players, and its fixed-timestep loop.
//
// The room knows nothing about the game's rules. Every tick it hands each
// player's input for that tick to the module, asks the module to step, then
// every N ticks encodes a snapshot per recipient and pushes any reliable
// events. Inputs arrive stamped with the tick they are meant for; a missing
// one is filled from the newest earlier input (the client bundles the last
// three, so a single lost packet never leaves a hole).
// ============================================================================

import { MSG, encodeJson, encodeSnapshot, seqNewer } from '../shared/net/protocol.js';
import { RingBuffer } from '../shared/sim/ring-buffer.js';
import { config } from './config.js';
import { log } from './log.js';

const INPUT_HISTORY = 128;       // ticks of buffered inputs per player
const MAX_FUTURE_TICKS = 90;     // inputs stamped further ahead are dropped (1.5 s: a clock that far off resyncs from the margin)
const MAX_CATCHUP = 5;           // ticks stepped in one timer callback when behind

export class Room {
  constructor(lobby, code, game, opts, isPublic) {
    this.lobby = lobby;
    this.code = code;
    this.game = game;
    this.opts = opts;
    this.isPublic = isPublic;
    this.players = new Map();     // id -> player record
    this.hostId = -1;
    this.phase = 'lobby';         // lobby | running | results
    this.tick = 0;
    this.tickMs = 1000 / game.tickRate;
    this.snapshotEvery = Math.max(1, Math.round(game.tickRate / game.snapshotRate));
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this.state = game.createMatch(this.opts, this.seed);
    this.events = [];
    this.timer = null;
    this.nextTickAt = 0;
    this.tickTimes = [];
    this.emptySince = Date.now();
    this.destroyed = false;
    this.results = null;
  }

  // ------------------------------------------------------------ players --

  _freeId() {
    for (let i = 0; i < this.game.maxPlayers; i++) if (!this.players.has(i)) return i;
    return -1;
  }

  join(session, asHost) {
    if (this.phase === 'running') return session.error('running', 'race in progress');
    const id = this._freeId();
    if (id < 0) return session.error('full', 'room is full');
    const p = this._newPlayer(id, session.name, false);
    p.session = session;
    this.players.set(id, p);
    if (asHost || this.hostId < 0) this.hostId = id;
    this.lobby.attach(session, this, id);
    this.game.addPlayer(this.state, id, p.profile, false);
    session.sendJson(MSG.ROOM, this.roomState(id));
    this.broadcastRoomState();
    log.info('room', 'joined', { code: this.code, id, name: session.name });
  }

  _newPlayer(id, name, bot) {
    return {
      id, name, bot,
      session: null,
      ready: bot,
      profile: {},
      inputs: new RingBuffer(INPUT_HISTORY),
      lastSeq: 0, lastInput: null, margin: 0,
      disconnectedAt: 0, abandonTimer: null
    };
  }

  addBot(session) {
    if (!this._isHost(session)) return session.error('host', 'host only');
    if (this.phase === 'running') return;
    const id = this._freeId();
    if (id < 0) return session.error('full', 'room is full');
    const p = this._newPlayer(id, `BOT ${id + 1}`, true);
    this.players.set(id, p);
    this.game.addPlayer(this.state, id, p.profile, true);
    this.broadcastRoomState();
  }

  kick(session, id) {
    if (!this._isHost(session)) return session.error('host', 'host only');
    const p = this.players.get(id);
    if (!p || id === this.hostId) return;
    if (p.session) { p.session.sendJson(MSG.ROOM, null); this.lobby.detach(p.session); }
    this._removePlayer(id);
    this.broadcastRoomState();
  }

  leave(session) {
    const p = this.players.get(session.playerId);
    this.lobby.detach(session);
    if (!p) return;
    if (this.phase === 'running') {
      this.game.onAbandon(this.state, p.id, this.tick);
      p.session = null;
      p.abandoned = true;
    } else {
      this._removePlayer(p.id);
    }
    session.sendJson(MSG.ROOM, null);
    this._afterPlayerChange();
  }

  _removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.abandonTimer) clearTimeout(p.abandonTimer);
    this.players.delete(id);
    this.game.removePlayer(this.state, id);
    if (this.hostId === id) this._pickNewHost();
  }

  _pickNewHost() {
    this.hostId = -1;
    for (const p of this.players.values()) if (!p.bot && p.session) { this.hostId = p.id; break; }
  }

  _afterPlayerChange() {
    if (this.humanCount() === 0) {
      this.emptySince = Date.now();
      if (this.phase === 'running') this._finish();   // nobody is watching, end it
    }
    if (this.hostId < 0 || !this.players.get(this.hostId)?.session) this._pickNewHost();
    this.broadcastRoomState();
  }

  onDisconnect(session) {
    const p = this.players.get(session.playerId);
    if (!p) return;
    p.session = null;
    if (this.phase !== 'running') {
      this._removePlayer(p.id);
      this.lobby.detach(session);     // a later reconnect starts from the menu, not a dead seat
      this._afterPlayerChange();
      return;
    }
    p.disconnectedAt = Date.now();
    this.game.onDisconnect(this.state, p.id, this.tick);
    p.abandonTimer = setTimeout(() => {
      p.abandonTimer = null;
      if (p.session || this.destroyed) return;
      this.game.onAbandon(this.state, p.id, this.tick);
      p.abandoned = true;
      this._afterPlayerChange();
    }, config.reconnectGraceMs);
    if (p.abandonTimer.unref) p.abandonTimer.unref();
    this._afterPlayerChange();
  }

  reattach(session, playerId) {
    const p = this.players.get(playerId);
    if (!p || p.session || p.abandoned) { this.lobby.detach(session); return session.sendJson(MSG.ROOM, null); }
    p.session = session;
    p.name = session.name;
    if (p.abandonTimer) { clearTimeout(p.abandonTimer); p.abandonTimer = null; }
    this.lobby.attach(session, this, playerId);
    if (this.phase === 'running') this.game.onReconnect(this.state, playerId, this.tick);
    session.sendJson(MSG.ROOM, this.roomState(playerId));
    if (this.hostId < 0) this.hostId = playerId;
    this.broadcastRoomState();
    log.info('room', 'reattached', { code: this.code, id: playerId });
  }

  humanCount() { let n = 0; for (const p of this.players.values()) if (!p.bot && p.session) n++; return n; }
  hostName() { return this.players.get(this.hostId)?.name || '—'; }
  _isHost(session) { return session.playerId === this.hostId && session.room === this; }

  // -------------------------------------------------------------- lobby --

  setProfile(session, m) {
    const p = this.players.get(session.playerId);
    if (!p || this.phase === 'running') return;
    p.profile = this.game.setProfile(this.state, p.id, m) || p.profile;
    this.broadcastRoomState();
  }

  setReady(session, ready) {
    const p = this.players.get(session.playerId);
    if (!p || this.phase === 'running') return;
    p.ready = ready;
    this.broadcastRoomState();
  }

  setOpts(session, opts, isPublic) {
    if (!this._isHost(session) || this.phase === 'running') return;
    if (typeof isPublic === 'boolean') { this.isPublic = isPublic; if (!Object.keys(opts).length) return this.broadcastRoomState(); }
    this.opts = this.game.validateOpts({ ...this.opts, ...opts });
    this.state = this.game.createMatch(this.opts, this.seed);
    for (const p of this.players.values()) {
      this.game.addPlayer(this.state, p.id, p.profile, p.bot);
      p.ready = p.bot;
    }
    this.broadcastRoomState();
  }

  requestStart(session) {
    if (!this._isHost(session)) return session.error('host', 'host only');
    if (this.phase === 'running') return;
    const humans = [...this.players.values()].filter(p => !p.bot && p.session);
    if (humans.length < this.game.minPlayers) return session.error('players', 'not enough players');
    if (humans.some(p => !p.ready)) return session.error('ready', 'everyone must be ready');
    this.start();
  }

  start() {
    if (this.phase === 'results') {
      // a rematch: fresh state, same players and picks
      this.seed = (Math.random() * 0xffffffff) >>> 0;
      this.state = this.game.createMatch(this.opts, this.seed);
      for (const p of this.players.values()) this.game.addPlayer(this.state, p.id, p.profile, p.bot);
    }
    this.phase = 'running';
    this.results = null;
    for (const p of this.players.values()) { p.inputs = new RingBuffer(INPUT_HISTORY); p.lastInput = null; p.lastSeq = 0; p.abandoned = false; }
    this.game.start(this.state, this.tick);
    this.broadcastRoomState();
    this._startLoop();
    log.info('room', 'started', { code: this.code, players: this.players.size });
  }

  chat(session, text) {
    if (!text) return;
    this.broadcast(encodeJson(MSG.CHAT, { from: session.name, id: session.playerId, text }));
  }

  // --------------------------------------------------------------- loop --

  _startLoop() {
    if (this.timer) return;
    if (this.lobby.opts?.manualTick) return;   // tests drive _doTick() themselves
    this.nextTickAt = performance.now() + this.tickMs;
    const pump = () => {
      if (this.destroyed || this.phase !== 'running') { this.timer = null; return; }
      const now = performance.now();
      let n = 0;
      while (now >= this.nextTickAt && n < MAX_CATCHUP) {
        this._doTick();
        this.nextTickAt += this.tickMs;
        n++;
      }
      if (n === MAX_CATCHUP && now >= this.nextTickAt) this.nextTickAt = now + this.tickMs; // give up catching up
      if (this.phase !== 'running') { this.timer = null; return; }
      this.timer = setTimeout(pump, Math.max(0, this.nextTickAt - performance.now()));
    };
    this.timer = setTimeout(pump, this.tickMs);
  }

  /** advance exactly one tick (also used by tests, which drive the loop by hand) */
  _doTick() {
    const t0 = performance.now();
    this.tick++;
    try {
      for (const p of this.players.values()) {
        let input;
        if (p.bot) input = this.game.botInput(this.state, p.id, this.tick);
        else {
          const rec = p.inputs.get(this.tick) || p.inputs.latestAtOrBefore(this.tick, 30)?.val || p.lastInput;
          input = rec || null;
          if (rec) p.lastInput = rec;
        }
        if (input) this.game.applyInput(this.state, p.id, input, this.tick);
      }
      this.game.step(this.state, this.tick, this.events);
    } catch (e) {
      log.error('room', 'module threw; closing room', { code: this.code, err: e.stack || e.message });
      this.broadcast(encodeJson(MSG.ERROR, { code: 'crash', message: 'the match hit an internal error' }));
      this.lobby.destroyRoom(this);
      return;
    }
    if (this.events.length) {
      this.broadcast(encodeJson(MSG.EVENTS, { tick: this.tick, events: this.events }));
      this.events = [];
    }
    if (this.tick % this.snapshotEvery === 0) this._sendSnapshots();
    if (this.game.isOver(this.state)) this._finish();
    const dt = performance.now() - t0;
    this.tickTimes.push(dt);
    if (this.tickTimes.length > 600) this.tickTimes.shift();
    if (dt > config.tickBudgetMs) log.warn('room', 'slow tick', { code: this.code, ms: +dt.toFixed(2) });
  }

  _sendSnapshots() {
    const phase = this.game.phase(this.state);
    for (const p of this.players.values()) {
      if (!p.session) continue;
      const payload = this.game.encodeSnapshot(this.state, p.id);
      p.session.sendUnreliable(encodeSnapshot(this.tick, p.lastSeq, p.margin, phase, payload));
    }
  }

  onInputs(session, records) {
    const p = this.players.get(session.playerId);
    if (!p || this.phase !== 'running') return;
    for (const r of records) {
      if (r.tick > this.tick + MAX_FUTURE_TICKS) continue;
      // too old to simulate, but the client must still learn how late it is or it can never catch up
      if (r.tick <= this.tick - INPUT_HISTORY) { p.margin = r.tick - this.tick; continue; }
      if (!seqNewer(r.seq, p.lastSeq) && p.lastSeq !== 0) continue;   // already have it (bundled resend)
      if (r.steer !== r.steer) continue;                                // NaN
      p.inputs.set(r.tick, { bits: r.bits & 0xff, steer: Math.max(-1, Math.min(1, r.steer)), seq: r.seq });
      p.lastSeq = r.seq;
      // how early the newest input arrived, in ticks (>0 early, <0 already late); the client smooths it
      p.margin = r.tick - this.tick;
    }
  }

  _finish() {
    if (this.phase !== 'running') return;
    this.phase = 'results';
    this.results = this.game.results(this.state);
    this.broadcast(encodeJson(MSG.RESULTS, { results: this.results }));
    for (const p of [...this.players.values()]) {
      p.ready = p.bot;
      if (p.abandoned || (!p.bot && !p.session)) this._removePlayer(p.id);
    }
    if (this.hostId < 0 || !this.players.get(this.hostId)?.session) this._pickNewHost();
    this.broadcastRoomState();
    log.info('room', 'finished', { code: this.code });
  }

  // ---------------------------------------------------------- messages --

  roomState(forId) {
    return {
      code: this.code, game: this.game.id, phase: this.phase, hostId: this.hostId, you: forId,
      opts: this.opts, public: this.isPublic, tick: this.tick, tickRate: this.game.tickRate,
      snapshotRate: this.game.snapshotRate, seed: this.seed,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, bot: p.bot, ready: p.ready, connected: !!(p.session || p.bot), profile: p.profile
      })),
      state: this.game.publicState(this.state),
      results: this.results
    };
  }

  sendRoomState(session) { session?.sendJson(MSG.ROOM, this.roomState(session.playerId)); }

  broadcastRoomState() {
    for (const p of this.players.values()) if (p.session) p.session.sendJson(MSG.ROOM, this.roomState(p.id));
  }

  broadcast(u8) {
    for (const p of this.players.values()) if (p.session) p.session.send(u8);
  }

  tickP95() {
    if (!this.tickTimes.length) return 0;
    const s = [...this.tickTimes].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.95)];
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const p of this.players.values()) {
      if (p.abandonTimer) clearTimeout(p.abandonTimer);
      if (p.session) { p.session.sendJson(MSG.ROOM, null); this.lobby.detach(p.session); }
    }
    this.players.clear();
  }
}
