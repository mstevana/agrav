// ============================================================================
// Lobby: the registry of rooms and of session tokens. Rooms are addressed by
// a four-letter code; public rooms are also listed for quick-join.
// ============================================================================

import { MSG } from '../shared/net/protocol.js';
import { Room } from './room.js';
import { loadGame, listGames } from './games.js';
import { createStore } from './store.js';
import { config } from './config.js';
import { log } from './log.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export class Lobby {
  constructor(opts = {}) {
    this.rooms = new Map();          // code -> Room
    this.tokens = new Map();         // token -> { session|null, room, playerId, expires }
    this.opts = opts;
    /** durable player records (careers); games that keep none never touch it */
    this.store = opts.store || createStore();
    this.reaper = setInterval(() => this.reap(), 10000);
    if (this.reaper.unref) this.reaper.unref();
  }

  games() { return listGames(); }

  registerToken(token, session) { this.tokens.set(token, { session, room: null, playerId: -1, expires: 0 }); }

  /** a returning socket presents its token: hand back what it was attached to */
  takeToken(token) {
    const rec = this.tokens.get(token);
    if (!rec) return null;
    if (rec.session && !rec.session.closed) return null;   // still connected elsewhere
    return rec;
  }

  attach(session, room, playerId) {
    const rec = this.tokens.get(session.token);
    if (rec) { rec.session = session; rec.room = room; rec.playerId = playerId; }
    session.room = room;
    session.playerId = playerId;
  }

  detach(session) {
    const rec = this.tokens.get(session.token);
    if (rec) { rec.room = null; rec.playerId = -1; }
    session.room = null;
    session.playerId = -1;
  }

  onSessionClosed(session) {
    const rec = this.tokens.get(session.token);
    if (!rec) return;
    rec.session = null;
    // keep the token while a reconnect could still matter, then forget it
    rec.expires = Date.now() + (rec.room ? config.reconnectGraceMs + 5000 : 30000);
  }

  newCode() {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  async createRoom(session, gameId, opts, isPublic) {
    if (session.room) session.room.leave(session);
    if (this.rooms.size >= config.maxRooms) return session.error('full', 'server is full');
    const game = await loadGame(gameId);
    if (!game) return session.error('game', `unknown game ${gameId}`);
    const code = this.newCode();
    if (!code) return session.error('full', 'no room codes left');
    const room = new Room(this, code, game, game.validateOpts(opts), isPublic);
    this.rooms.set(code, room);
    log.info('lobby', 'room created', { code, game: gameId, by: session.name });
    room.join(session, true);
  }

  joinRoom(session, code) {
    const room = this.rooms.get(code);
    if (!room) return session.error('nope', 'no such room');
    if (session.room === room) return room.sendRoomState();
    if (session.room) session.room.leave(session);
    room.join(session, false);
  }

  listPublic() {
    const out = [];
    for (const r of this.rooms.values()) {
      if (!r.isPublic) continue;
      out.push({ code: r.code, game: r.game.id, name: r.hostName(), players: r.humanCount(), max: r.game.maxPlayers, phase: r.phase, opts: r.opts });
    }
    return out;
  }

  destroyRoom(room) {
    room.destroy();
    this.rooms.delete(room.code);
    log.info('lobby', 'room destroyed', { code: room.code });
  }

  reap() {
    const now = Date.now();
    for (const r of [...this.rooms.values()]) {
      if (r.humanCount() === 0 && now - r.emptySince > config.emptyRoomTtlMs) this.destroyRoom(r);
    }
    for (const [tok, rec] of this.tokens) {
      if (!rec.session && rec.expires && now > rec.expires) this.tokens.delete(tok);
    }
  }

  stats() {
    let players = 0, ticksP95 = 0;
    for (const r of this.rooms.values()) { players += r.humanCount(); ticksP95 = Math.max(ticksP95, r.tickP95()); }
    return { rooms: this.rooms.size, players, tickP95Ms: +ticksP95.toFixed(2), games: this.games() };
  }

  /**
   * Read (creating on first sight) a caller's persistent record for a game, and
   * optionally spend in its shop. All career rules are the module's pure functions;
   * the lobby only moves records between the store and the module.
   */
  async career(gameId, key, action) {
    const game = await loadGame(gameId);
    if (!game?.career) return { error: 'game' };
    let career = await this.store.get(gameId, key);
    if (!career) { career = game.career.create(); this.store.set(gameId, key, career); }
    if (!action || action === 'get') return { career };
    const out = game.career.apply(career, action);
    if (out.error) return { error: out.error, career };
    this.store.set(gameId, key, out.career);
    return { career: out.career };
  }

  close() {
    clearInterval(this.reaper);
    for (const r of [...this.rooms.values()]) this.destroyRoom(r);
    this.store.close?.();
  }
}
