// ============================================================================
// Transport abstraction. A Channel delivers byte frames both ways and exposes
// two delivery classes: reliable (lobby, events) and unreliable (inputs,
// snapshots). WsChannel routes both over one WebSocket — that is phase 1.
// Phase 2 adds an RtcChannel whose unreliable class goes over an unordered,
// unreliable DataChannel; nothing above this file changes.
//
// The same class works on a browser WebSocket and on the `ws` package's
// WebSocket, which is why it only touches the standard event API.
// ============================================================================

export class Channel {
  constructor() {
    this.onMessage = null;   // (Uint8Array) => void
    this.onClose = null;     // (code, reason) => void
    this.closed = false;
    this.sentBytes = 0;
    this.recvBytes = 0;
  }
  /** @param {Uint8Array} bytes  @param {{reliable?: boolean}} [opts] */
  send(bytes, opts) { throw new Error('abstract'); }
  close(code, reason) { throw new Error('abstract'); }
}

export class WsChannel extends Channel {
  /** @param {WebSocket} ws an open or connecting socket */
  constructor(ws) {
    super();
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    this._onMessage = (ev) => {
      const d = ev.data;
      let u8;
      if (d instanceof ArrayBuffer) u8 = new Uint8Array(d);
      else if (ArrayBuffer.isView(d)) u8 = new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
      else return; // text frames are not part of the protocol
      this.recvBytes += u8.length;
      if (this.onMessage) this.onMessage(u8);
    };
    this._onClose = (ev) => {
      if (this.closed) return;
      this.closed = true;
      if (this.onClose) this.onClose(ev?.code, ev?.reason);
    };
    ws.addEventListener('message', this._onMessage);
    ws.addEventListener('close', this._onClose);
    ws.addEventListener('error', () => { /* close follows */ });
  }
  get open() { return this.ws.readyState === 1; }
  send(bytes) {
    if (this.ws.readyState !== 1) return false;
    this.sentBytes += bytes.length;
    this.ws.send(bytes);
    return true;
  }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    try { this.ws.close(code, reason); } catch (e) { /* already closing */ }
  }
}

/** In-process pair for tests: what one end sends, the other receives (next microtask). */
export class LoopbackChannel extends Channel {
  constructor() { super(); this.peer = null; this.latencyMs = 0; this.drop = 0; this.rng = Math.random; }
  static pair() {
    const a = new LoopbackChannel(), b = new LoopbackChannel();
    a.peer = b; b.peer = a;
    return [a, b];
  }
  send(bytes, opts = {}) {
    if (this.closed || !this.peer) return false;
    this.sentBytes += bytes.length;
    if (!opts.reliable && this.drop > 0 && this.rng() < this.drop) return true;
    const copy = bytes.slice();
    const deliver = () => {
      if (this.peer.closed) return;
      this.peer.recvBytes += copy.length;
      if (this.peer.onMessage) this.peer.onMessage(copy);
    };
    if (this.latencyMs > 0) setTimeout(deliver, this.latencyMs);
    else queueMicrotask(deliver);
    return true;
  }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true;
    if (this.onClose) this.onClose(code, reason);
    const p = this.peer;
    // frames already sent still reach the peer before it sees the close, as on a real socket
    const closePeer = () => { if (p && !p.closed) { p.closed = true; if (p.onClose) p.onClose(code, reason); } };
    if (this.latencyMs > 0) setTimeout(closePeer, this.latencyMs); else queueMicrotask(closePeer);
  }
}
