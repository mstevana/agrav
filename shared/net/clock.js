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
    this.lastAdjust = 0;
    this.maxLead = 40;          // well inside the server's future-input window
  }
  /** local monotonic time in ms */
  now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

  /** forget every sample (a new room's ticks start from zero) */
  reset() { this.samples = []; this.synced = false; this.marginEma = null; this.offsetTicks = 0; this.lastAdjust = 0; this.resyncs = 0; }

  onPong(clientMs, serverTick, tickMs, recvMs = this.now()) {
    if (serverTick === 0) return;              // the room's loop is not running yet: nothing to sync to
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
    if (!this.synced) this.leadTicks = Math.min(this.maxLead, Math.ceil((this.rtt / 2) / this.tickMs) + this.targetMargin);
    this.synced = true;
  }

  /** fractional server tick right now */
  serverTick(nowMs = this.now()) { return nowMs / this.tickMs + this.offsetTicks; }

  /** the tick the next input should be stamped with */
  inputTick(nowMs = this.now()) { return Math.floor(this.serverTick(nowMs) + this.leadTicks); }

  /**
   * Called with every snapshot's margin: how many ticks early (+) or late (−)
   * our newest input reached the server, measured by the server itself. Small
   * errors steer the lead (a proportional step every 250 ms); a large,
   * persistent error means the offset estimate is wrong (queued pongs on a
   * starved main thread inflate the round trip), so the offset is resynced
   * from the margin directly.
   */
  onMargin(margin) {
    this.marginEma = this.marginEma == null ? margin : this.marginEma * 0.85 + margin * 0.15;
    const now = this.now();
    if (now < this.lastAdjust) return;
    const err = this.targetMargin - this.marginEma;     // >0: arriving too late, need more lead
    if (Math.abs(err) > 8) {
      this.offsetTicks += err;                          // resync the clock, keep the lead
      this.marginEma = null;                            // measure afresh once the change has round-tripped
      this.resyncs = (this.resyncs || 0) + 1;
      this.lastAdjust = now + this.rtt + 400;
    } else if (Math.abs(err) >= 1) {
      this.leadTicks = Math.max(1, Math.min(this.maxLead, this.leadTicks + Math.max(-3, Math.min(3, Math.round(err * 0.5)))));
      this.marginEma = null;
      this.lastAdjust = now + this.rtt + 150;
    } else this.lastAdjust = now;
  }
}
