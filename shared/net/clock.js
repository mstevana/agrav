// ============================================================================
// Client-side clock: estimates the server's current tick from PONG samples and
// decides how far ahead of it the client should stamp its inputs so they reach
// the server just before they are needed.
//
//   serverTickNow ≈ pong.serverTick + (now - pong.recvTime + rtt/2) / tickMs
//   inputTick     = serverTickNow + lead
//
// `lead` starts at rtt/2 + 1 tick and is nudged by the margin the server
// reports in every snapshot (how many ticks early the last input arrived), so
// a jittery link keeps a bigger buffer and a clean one runs tight.
// ============================================================================

export class NetClock {
  constructor(tickMs = 1000 / 60) {
    this.tickMs = tickMs;
    this.rtt = 100;             // ms, smoothed
    this.offsetTicks = 0;       // serverTick - localTick estimate (fractional)
    this.samples = [];
    this.leadTicks = 4;
    this.synced = false;
    this.targetMargin = 2;      // ticks of slack we want inputs to arrive early
    this.marginEma = null;
  }
  /** local monotonic time in ms */
  now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

  onPong(clientMs, serverTick, tickMs, recvMs = this.now()) {
    if (tickMs > 0) this.tickMs = tickMs;
    const rtt = Math.max(0, recvMs - clientMs);
    this.rtt = this.synced ? this.rtt * 0.8 + rtt * 0.2 : rtt;
    // server tick at recvMs is serverTick + half the round trip
    const serverTickAtRecv = serverTick + (rtt / 2) / this.tickMs;
    const localTickAtRecv = recvMs / this.tickMs;
    const offset = serverTickAtRecv - localTickAtRecv;
    this.samples.push({ offset, rtt });
    if (this.samples.length > 8) this.samples.shift();
    // trust the samples with the lowest rtt (least queueing)
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, this.samples.length >> 1));
    const avg = best.reduce((s, x) => s + x.offset, 0) / best.length;
    this.offsetTicks = this.synced ? this.offsetTicks * 0.7 + avg * 0.3 : avg;
    if (!this.synced) this.leadTicks = Math.ceil((this.rtt / 2) / this.tickMs) + this.targetMargin;
    this.synced = true;
  }

  /** fractional server tick right now */
  serverTick(nowMs = this.now()) { return nowMs / this.tickMs + this.offsetTicks; }

  /** the tick the next input should be stamped with */
  inputTick(nowMs = this.now()) { return Math.floor(this.serverTick(nowMs) + this.leadTicks); }

  /** called with every snapshot's margin (+ early / − late) */
  onMargin(margin) {
    this.marginEma = this.marginEma == null ? margin : this.marginEma * 0.9 + margin * 0.1;
    if (this.marginEma < this.targetMargin - 1) { this.leadTicks += 1; this.marginEma = this.targetMargin; }
    else if (this.marginEma > this.targetMargin + 3) { this.leadTicks = Math.max(1, this.leadTicks - 1); this.marginEma = this.targetMargin; }
  }
}
