// ============================================================================
// Solo play: the same room/lobby/session engine, hosted inside the page.
//
// Nothing here is a second implementation of the game. The browser imports the
// very modules the Node server runs (lobby.js, room.js, session.js) and wires
// them to the client over LoopbackChannel — the in-process transport the server
// tests already use — so one player plus bots needs no server at all and the
// whole thing can be served as static files (GitHub Pages, file://, a CDN).
//
// The client keeps its prediction, reconciliation and interpolation; the round
// trip is simply zero. Bots are the ones the server always ran.
//
//   const host = createSoloHost();
//   await client.connectLocal(host.channel, name);   // then drive the lobby as usual
//   host.stop();                                     // when leaving solo play
// ============================================================================

import { Lobby } from './lobby.js';
import { Session } from './session.js';
import { Store, isSafeKey } from './store.js';
import { LoopbackChannel } from '../shared/net/channel.js';

/**
 * Durable records for a page with no server: localStorage instead of a disk, so a solo
 * career survives a reload. Falls back to memory where storage is blocked (private mode).
 */
export class LocalStorageStore extends Store {
  constructor(prefix = 'agrav.store.') {
    super();
    this.prefix = prefix;
    this.memory = new Map();
    try { this.ls = globalThis.localStorage || null; } catch { this.ls = null; }
  }
  _id(ns, key) { return `${this.prefix}${ns}/${key}`; }
  async get(ns, key) {
    if (!isSafeKey(ns) || !isSafeKey(key)) return null;
    const id = this._id(ns, key);
    if (this.memory.has(id)) return this.memory.get(id);
    try {
      const raw = this.ls?.getItem(id);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  set(ns, key, value) {
    if (!isSafeKey(ns) || !isSafeKey(key)) return;
    const id = this._id(ns, key);
    this.memory.set(id, value);
    try { this.ls?.setItem(id, JSON.stringify(value)); } catch { /* full or blocked: memory still has it */ }
  }
  async list(ns) {
    const out = new Set();
    const head = `${this.prefix}${ns}/`;
    for (const id of this.memory.keys()) if (id.startsWith(head)) out.add(id.slice(head.length));
    try {
      for (let i = 0; i < (this.ls?.length || 0); i++) {
        const id = this.ls.key(i);
        if (id && id.startsWith(head)) out.add(id.slice(head.length));
      }
    } catch { /* ignore */ }
    return [...out];
  }
}

/**
 * Stand up a private lobby for this page and return the client end of the wire.
 * @param {object} [opts] forwarded to the Lobby (tests use `{manualTick:true}`)
 * @returns {{channel: LoopbackChannel, lobby: Lobby, session: Session, stop: () => void}}
 */
export function createSoloHost(opts = {}) {
  const lobby = new Lobby({ store: new LocalStorageStore(), ...opts });
  const [client, server] = LoopbackChannel.pair();
  const session = new Session(server, lobby);
  let stopped = false;
  return {
    channel: client,
    lobby,
    session,
    stop() {
      if (stopped) return;
      stopped = true;
      try { client.close(); } catch { /* already gone */ }
      lobby.close();
    },
  };
}
