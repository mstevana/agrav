// ============================================================================
// Durable per-player records (careers), behind a three-method interface so the
// backing store can change without any game knowing.
//
//   get(ns, key) -> Promise<value|null>     read through the cache
//   set(ns, key, value)                     cache now, write to disk soon
//   list(ns) -> Promise<string[]>           the keys in a namespace
//
// The file implementation keeps one JSON file per record at
// DATA_DIR/<ns>/<key>.json, written to a temp file and renamed so a crash
// never leaves a half-written record. Records are small and read once per
// session, so a Map in front of the disk means the hot path never waits.
// A disk error is logged and swallowed: a match must never die because a
// career could not be saved.
// ============================================================================

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';

/** namespaces and keys are path segments, so they are strictly validated */
const SAFE = /^[A-Za-z0-9_-]{1,128}$/;
export const isSafeKey = (s) => typeof s === 'string' && SAFE.test(s);

const IDLE_MS = 60 * 60 * 1000;      // a cached record idle this long is dropped
const SWEEP_MS = 10 * 60 * 1000;

export class Store {
  async get() { return null; }
  set() {}
  async list() { return []; }
  async flush() {}
  close() {}
}

export class JsonFileStore extends Store {
  constructor(dir = config.dataDir) {
    super();
    this.dir = path.resolve(dir);
    this.cache = new Map();          // "ns/key" -> { value, at }
    this.writes = new Map();         // "ns/key" -> promise chain, so two writes never interleave
    this.sweeper = setInterval(() => this.sweep(), SWEEP_MS);
    if (this.sweeper.unref) this.sweeper.unref();
  }

  _path(ns, key) { return path.join(this.dir, ns, `${key}.json`); }

  async get(ns, key) {
    if (!isSafeKey(ns) || !isSafeKey(key)) return null;
    const id = `${ns}/${key}`;
    const hit = this.cache.get(id);
    if (hit) { hit.at = Date.now(); return hit.value; }
    let value = null;
    try {
      value = JSON.parse(await fsp.readFile(this._path(ns, key), 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') log.warn('store', 'read failed', { id, err: e.message });
      return null;
    }
    this.cache.set(id, { value, at: Date.now() });
    return value;
  }

  /** synchronous as far as any caller is concerned: the cache is authoritative */
  set(ns, key, value) {
    if (!isSafeKey(ns) || !isSafeKey(key)) return;
    const id = `${ns}/${key}`;
    this.cache.set(id, { value, at: Date.now() });
    const body = JSON.stringify(value);
    const prev = this.writes.get(id) || Promise.resolve();
    const next = prev.then(() => this._write(ns, key, body)).catch(() => {});
    this.writes.set(id, next);
    next.then(() => { if (this.writes.get(id) === next) this.writes.delete(id); });
  }

  async _write(ns, key, body) {
    const file = this._path(ns, key);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(tmp, body);
      await fsp.rename(tmp, file);
    } catch (e) {
      log.warn('store', 'write failed', { ns, key, err: e.message });
      try { await fsp.unlink(tmp); } catch { /* nothing to clean up */ }
    }
  }

  async list(ns) {
    if (!isSafeKey(ns)) return [];
    try {
      const names = await fsp.readdir(path.join(this.dir, ns));
      return names.filter(n => n.endsWith('.json')).map(n => n.slice(0, -5));
    } catch { return []; }
  }

  /** wait for every pending write (tests and shutdown) */
  async flush() { await Promise.all([...this.writes.values()]); }

  sweep() {
    const cutoff = Date.now() - IDLE_MS;
    for (const [id, rec] of this.cache) if (rec.at < cutoff && !this.writes.has(id)) this.cache.delete(id);
  }

  close() { clearInterval(this.sweeper); }
}

/** an in-memory store for tests and for a server told to keep nothing */
export class MemoryStore extends Store {
  constructor() { super(); this.map = new Map(); }
  async get(ns, key) { return this.map.get(`${ns}/${key}`) ?? null; }
  set(ns, key, value) { if (isSafeKey(ns) && isSafeKey(key)) this.map.set(`${ns}/${key}`, value); }
  async list(ns) { return [...this.map.keys()].filter(k => k.startsWith(`${ns}/`)).map(k => k.slice(ns.length + 1)); }
}

export function createStore(dir = config.dataDir) {
  return dir ? new JsonFileStore(dir) : new MemoryStore();
}

/** node:fs is imported for this one synchronous check at boot */
export function dataDirWritable(dir = config.dataDir) {
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); return true; }
  catch { return false; }
}
