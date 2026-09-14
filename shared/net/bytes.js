// ============================================================================
// Growable little-endian byte writer + reader over DataView. All hot-path
// messages (inputs, snapshots) are laid out with these so Node and the
// browser agree byte for byte.
// ============================================================================

const enc = new TextEncoder();
const dec = new TextDecoder();

export class ByteWriter {
  constructor(size = 256) {
    this.buf = new ArrayBuffer(size);
    this.view = new DataView(this.buf);
    this.pos = 0;
  }
  _need(n) {
    if (this.pos + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new ArrayBuffer(size);
    new Uint8Array(nb).set(new Uint8Array(this.buf, 0, this.pos));
    this.buf = nb;
    this.view = new DataView(nb);
  }
  u8(v)  { this._need(1); this.view.setUint8(this.pos, v); this.pos += 1; return this; }
  i8(v)  { this._need(1); this.view.setInt8(this.pos, v); this.pos += 1; return this; }
  u16(v) { this._need(2); this.view.setUint16(this.pos, v, true); this.pos += 2; return this; }
  i16(v) { this._need(2); this.view.setInt16(this.pos, v, true); this.pos += 2; return this; }
  u32(v) { this._need(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; return this; }
  i32(v) { this._need(4); this.view.setInt32(this.pos, v, true); this.pos += 4; return this; }
  f32(v) { this._need(4); this.view.setFloat32(this.pos, v, true); this.pos += 4; return this; }
  f64(v) { this._need(8); this.view.setFloat64(this.pos, v, true); this.pos += 8; return this; }
  bytes(u8) { this._need(u8.length); new Uint8Array(this.buf, this.pos, u8.length).set(u8); this.pos += u8.length; return this; }
  /** u16 length-prefixed UTF-8 */
  str(s) { const b = enc.encode(s); this.u16(b.length); return this.bytes(b); }
  /** quantized helpers: value * scale rounded into the integer field, clamped */
  qi16(v, scale) { return this.i16(clampInt(Math.round(v * scale), -32768, 32767)); }
  qu16(v, scale) { return this.u16(clampInt(Math.round(v * scale), 0, 65535)); }
  qu8(v, scale)  { return this.u8(clampInt(Math.round(v * scale), 0, 255)); }
  qi8(v, scale)  { return this.i8(clampInt(Math.round(v * scale), -128, 127)); }
  /** angle in (-PI, PI] -> i16 */
  angle(a) { return this.i16(clampInt(Math.round(a / Math.PI * 32767), -32767, 32767)); }
  finish() { return new Uint8Array(this.buf, 0, this.pos); }
}

function clampInt(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export class ByteReader {
  /** @param {Uint8Array|ArrayBuffer} data */
  constructor(data, offset = 0) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.u8a = u8;
    this.view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.pos = offset;
  }
  get remaining() { return this.u8a.byteLength - this.pos; }
  u8()  { const v = this.view.getUint8(this.pos); this.pos += 1; return v; }
  i8()  { const v = this.view.getInt8(this.pos); this.pos += 1; return v; }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  f32() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  f64() { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  bytes(n) { const v = this.u8a.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  rest() { return this.bytes(this.remaining); }
  str() { const n = this.u16(); return dec.decode(this.bytes(n)); }
  qi16(scale) { return this.i16() / scale; }
  qu16(scale) { return this.u16() / scale; }
  qu8(scale)  { return this.u8() / scale; }
  qi8(scale)  { return this.i8() / scale; }
  angle() { return this.i16() / 32767 * Math.PI; }
}
