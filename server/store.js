// ============================================================================
// Durable per-player records (careers), behind a three-method interface so the
// backing store can change without any game knowing.
//
//   get(ns, key) -> Promise<value|null>     read through the cache
//   set(ns, key, value)                     cache now, write to disk soon
//   list(ns) -> Promise<string[]>           the keys in a namespace
//
// This file is pure: it holds the interface, the key rules and the in-memory
// store, so the lobby/session engine still loads in a browser for solo play.
// The on-disk backend is server/store-file.js, which the Node server injects.
// ============================================================================

/** namespaces and keys are path segments, so they are strictly validated */
const SAFE = /^[A-Za-z0-9_-]{1,128}$/;
export const isSafeKey = (s) => typeof s === 'string' && SAFE.test(s);

export class Store {
  async get() { return null; }
  set() {}
  async list() { return []; }
  async flush() {}
  close() {}
}

/** an in-memory store for tests and for a server told to keep nothing */
export class MemoryStore extends Store {
  constructor() { super(); this.map = new Map(); }
  async get(ns, key) { return this.map.get(`${ns}/${key}`) ?? null; }
  set(ns, key, value) { if (isSafeKey(ns) && isSafeKey(key)) this.map.set(`${ns}/${key}`, value); }
  async list(ns) { return [...this.map.keys()].filter(k => k.startsWith(`${ns}/`)).map(k => k.slice(ns.length + 1)); }
}

/**
 * The default store. It keeps nothing on disk, which is the right answer in the browser
 * (solo play) and in tests; server/index.js hands the Lobby a JsonFileStore instead.
 */
export function createStore() {
  return new MemoryStore();
}
