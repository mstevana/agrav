// ============================================================================
// Wire protocol shared by server and clients.
//
// Every message is a binary frame whose first byte is the type. Lobby and
// control traffic is JSON after that byte (rare, readable, easy to extend);
// the hot path — INPUT up, SNAPSHOT down — is fixed binary laid out with
// ByteWriter/ByteReader. Game-specific snapshot payloads are produced by the
// game module and appended after the server's own header, so this file knows
// nothing about racing.
// ============================================================================

import { ByteWriter, ByteReader } from './bytes.js';

/** bump whenever a binary layout or a control message shape changes */
export const PROTOCOL_VERSION = 1;

export const MSG = Object.freeze({
  // control (JSON)
  HELLO: 1,        // c->s {v, name, token?}      first message on a socket
  WELCOME: 2,      // s->c {id, token, tickRate, snapshotRate, games:[...]}
  ERROR: 3,        // s->c {code, message}
  CREATE_ROOM: 4,  // c->s {game, opts}
  JOIN_ROOM: 5,    // c->s {code}
  LEAVE_ROOM: 6,   // c->s {}
  ROOM: 7,         // s->c full room state (players, phase, settings)
  SET_PROFILE: 8,  // c->s {vehicle, ...}   game-specific profile bits
  READY: 9,        // c->s {ready: bool}
  SET_OPTS: 10,    // c->s (host) {opts}
  START: 11,       // c->s (host) {}
  CHAT: 12,        // both {text} / {from, text}
  ADD_BOT: 13,     // c->s (host) {}
  KICK: 14,        // c->s (host) {id}
  EVENTS: 15,      // s->c {tick, events:[...]}   game events, reliable
  RESULTS: 16,     // s->c {results}
  LIST_ROOMS: 17,  // c->s {} -> s->c {rooms:[...]}
  // hot path (binary)
  PING: 20,        // c->s  u32 clientTimeMs
  PONG: 21,        // s->c  u32 clientTimeMs, u32 serverTick, u16 tickMs*100
  INPUT: 22,       // c->s  u8 count, then count × input record (newest last)
  SNAPSHOT: 23     // s->c  u32 tick, u16 lastInputSeq, i8 margin, u8 phase, then game payload
});

const enc = new TextEncoder();
const dec = new TextDecoder();

// ------------------------------------------------------------- control ----

export function encodeJson(type, obj) {
  const body = enc.encode(JSON.stringify(obj ?? {}));
  const out = new Uint8Array(body.length + 1);
  out[0] = type;
  out.set(body, 1);
  return out;
}

export function decodeJson(u8) {
  const text = dec.decode(u8.subarray(1));
  return text.length ? JSON.parse(text) : {};
}

export function messageType(u8) { return u8[0]; }

export const isJsonType = (t) => t < 20;

// -------------------------------------------------------------- inputs ----

/** input record: {seq, tick, bits, steer(-1..1)} */
export const INPUT_RECORD_BYTES = 2 + 4 + 1 + 1;

export function encodeInputs(records) {
  const w = new ByteWriter(2 + records.length * INPUT_RECORD_BYTES);
  w.u8(MSG.INPUT).u8(records.length);
  for (const r of records) {
    w.u16(r.seq & 0xffff).u32(r.tick).u8(r.bits & 0xff).qi8(r.steer, 127);
  }
  return w.finish();
}

export function decodeInputs(u8) {
  const r = new ByteReader(u8, 1);
  const n = r.u8();
  const out = [];
  for (let i = 0; i < n && r.remaining >= INPUT_RECORD_BYTES; i++) {
    out.push({ seq: r.u16(), tick: r.u32(), bits: r.u8(), steer: r.qi8(127) });
  }
  return out;
}

// ---------------------------------------------------------------- ping ----

export function encodePing(clientMs) {
  return new ByteWriter(5).u8(MSG.PING).u32(clientMs >>> 0).finish();
}
export function decodePing(u8) { return new ByteReader(u8, 1).u32(); }

export function encodePong(clientMs, serverTick, tickMs) {
  return new ByteWriter(11).u8(MSG.PONG).u32(clientMs >>> 0).u32(serverTick).qu16(tickMs, 100).finish();
}
export function decodePong(u8) {
  const r = new ByteReader(u8, 1);
  return { clientMs: r.u32(), serverTick: r.u32(), tickMs: r.qu16(100) };
}

// ------------------------------------------------------------ snapshot ----

export const SNAPSHOT_HEADER_BYTES = 1 + 4 + 2 + 1 + 1;

/**
 * @param {number} tick            server tick this snapshot describes
 * @param {number} lastInputSeq    newest input seq applied for the recipient
 * @param {number} margin          ticks the recipient's inputs are arriving early (+) or late (−)
 * @param {number} phase           game phase byte (module-defined)
 * @param {Uint8Array} payload     module-encoded game state
 */
export function encodeSnapshot(tick, lastInputSeq, margin, phase, payload) {
  const w = new ByteWriter(SNAPSHOT_HEADER_BYTES + payload.length);
  w.u8(MSG.SNAPSHOT).u32(tick).u16(lastInputSeq & 0xffff).i8(Math.max(-128, Math.min(127, margin))).u8(phase);
  w.bytes(payload);
  return w.finish();
}

export function decodeSnapshotHeader(u8) {
  const r = new ByteReader(u8, 1);
  return { tick: r.u32(), lastInputSeq: r.u16(), margin: r.i8(), phase: r.u8(), payload: r.rest() };
}

// -------------------------------------------------------- input bits ----

export const IN = Object.freeze({
  THROTTLE: 1,
  BRAKE: 2,
  AIRBRAKE_L: 4,
  AIRBRAKE_R: 8,
  FIRE: 16
});

/** u16 seq comparison that survives wrap */
export function seqNewer(a, b) { return ((a - b) & 0xffff) < 0x8000 && a !== b; }
