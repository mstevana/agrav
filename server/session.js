// ============================================================================
// One connected socket. Parses frames, enforces a rate limit, and forwards
// control messages to the lobby and hot-path messages to the room the session
// is in. Identity is a random token issued on HELLO; presenting it again on a
// new socket re-attaches to the same player (mid-race reconnect).
// ============================================================================

import crypto from 'node:crypto';
import { WsChannel } from '../shared/net/channel.js';
import { MSG, PROTOCOL_VERSION, encodeJson, decodeJson, messageType, isJsonType,
         decodeInputs, decodePing, encodePong } from '../shared/net/protocol.js';
import { config } from './config.js';
import { log } from './log.js';

export class Session {
  /**
   * @param {import('../shared/net/channel.js').Channel} channel
   * @param {import('./lobby.js').Lobby} lobby
   */
  constructor(channel, lobby) {
    this.channel = channel;
    this.lobby = lobby;
    this.token = null;
    this.name = 'player';
    this.room = null;       // Room
    this.playerId = -1;     // id within the room
    this.helloDone = false;
    this.bucket = config.rateLimitPerSec;
    this.bucketAt = Date.now();
    this.closed = false;
    channel.onMessage = (u8) => this.onMessage(u8);
    channel.onClose = () => this.onClose();
  }

  static fromSocket(ws, lobby) { return new Session(new WsChannel(ws), lobby); }

  send(u8) { return this.channel.send(u8, { reliable: true }); }
  sendUnreliable(u8) { return this.channel.send(u8, { reliable: false }); }
  sendJson(type, obj) { return this.send(encodeJson(type, obj)); }
  error(code, message) { this.sendJson(MSG.ERROR, { code, message }); }

  _rateOk() {
    const now = Date.now();
    this.bucket = Math.min(config.rateLimitPerSec, this.bucket + (now - this.bucketAt) * config.rateLimitPerSec / 1000);
    this.bucketAt = now;
    if (this.bucket < 1) return false;
    this.bucket -= 1;
    return true;
  }

  onMessage(u8) {
    if (this.closed || u8.length === 0) return;
    if (!this._rateOk()) { this.error('rate', 'too many messages'); this.close(1008, 'rate'); return; }
    const type = messageType(u8);
    try {
      if (isJsonType(type)) this.onControl(type, decodeJson(u8));
      else this.onHot(type, u8);
    } catch (e) {
      log.warn('session', 'bad message', { type, err: e.message });
      this.error('bad', 'malformed message');
    }
  }

  onControl(type, m) {
    if (type === MSG.HELLO) return this.onHello(m);
    if (!this.helloDone) return this.error('hello', 'HELLO first');
    switch (type) {
      case MSG.LIST_ROOMS: return this.sendJson(MSG.LIST_ROOMS, { rooms: this.lobby.listPublic() });
      case MSG.CREATE_ROOM: return this.lobby.createRoom(this, m.game, m.opts || {}, !!m.public);
      case MSG.JOIN_ROOM: return this.lobby.joinRoom(this, String(m.code || '').toUpperCase());
      case MSG.LEAVE_ROOM: return this.room?.leave(this);
      case MSG.SET_PROFILE: return this.room?.setProfile(this, m);
      case MSG.READY: return this.room?.setReady(this, !!m.ready);
      case MSG.SET_OPTS: return this.room?.setOpts(this, m.opts || {}, m.public);
      case MSG.START: return this.room?.requestStart(this);
      case MSG.LOADED: return this.room?.loaded(this);
      case MSG.ADD_BOT: return this.room?.addBot(this);
      case MSG.KICK: return this.room?.kick(this, m.id | 0);
      case MSG.CHAT: return this.room?.chat(this, String(m.text || '').slice(0, 200));
      default: return this.error('type', `unknown control message ${type}`);
    }
  }

  onHello(m) {
    if (m.v !== PROTOCOL_VERSION) {
      this.error('version', `protocol ${PROTOCOL_VERSION} required`);
      return this.close(4000, 'version');
    }
    this.name = cleanName(m.name);
    const prior = m.token && this.lobby.takeToken(m.token);
    if (prior) {
      this.token = m.token;
      this.helloDone = true;
      this.sendJson(MSG.WELCOME, { token: this.token, name: this.name, games: this.lobby.games() });
      if (prior.room) prior.room.reattach(this, prior.playerId);
      return;
    }
    this.token = crypto.randomBytes(12).toString('base64url');
    this.helloDone = true;
    this.lobby.registerToken(this.token, this);
    this.sendJson(MSG.WELCOME, { token: this.token, name: this.name, games: this.lobby.games() });
  }

  onHot(type, u8) {
    if (!this.helloDone) return;
    if (type === MSG.PING) {
      const clientMs = decodePing(u8);
      const tick = this.room ? this.room.tick : 0;
      const tickMs = this.room ? this.room.tickMs : 1000 / 60;
      return this.sendUnreliable(encodePong(clientMs, tick, tickMs));
    }
    if (type === MSG.INPUT) {
      if (!this.room) return;
      return this.room.onInputs(this, decodeInputs(u8));
    }
  }

  onClose() {
    if (this.closed) return;
    this.closed = true;
    if (this.room) this.room.onDisconnect(this);
    this.lobby.onSessionClosed(this);
  }

  close(code, reason) {
    this.channel.close(code, reason);
    this.onClose();
  }
}

export function cleanName(raw) {
  const s = String(raw ?? '').replace(/[^\w \-\.]/g, '').trim().slice(0, config.maxNameLength);
  return s || 'player';
}
