// ============================================================================
// Sound, synthesized on the fly through Web Audio: no files to download and no
// licences to worry about. An engine is a pair of detuned saws whose pitch
// follows the throttle, a gun is a filtered noise burst, an explosion is a
// noise envelope with a low thump under it.
//
// Nothing plays until the player has interacted with the page, because browsers
// will not allow it, and everything is a no-op when the context cannot be made.
// ============================================================================

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.engine = null;
    this.lastShot = 0;
  }

  /** must be called from a real gesture, or the browser refuses */
  resume() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) { this.enabled = false; return; }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.32;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { this.enabled = false; }
  }

  setMuted(m) {
    this.enabled = !m;
    if (this.master) this.master.gain.value = m ? 0 : 0.32;
  }

  _noiseBuffer() {
    if (this._noise) return this._noise;
    const n = this.ctx.sampleRate * 0.5;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  /** the engine runs continuously once the race starts; pitch follows the revs */
  startEngine() {
    if (!this.ctx || this.engine) return;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const a = this.ctx.createOscillator(), b = this.ctx.createOscillator();
    a.type = 'sawtooth'; b.type = 'sawtooth';
    a.frequency.value = 70; b.frequency.value = 71.5;
    a.connect(filter); b.connect(filter);
    filter.connect(g); g.connect(this.master);
    a.start(); b.start();
    this.engine = { a, b, g, filter };
  }

  stopEngine() {
    if (!this.engine) return;
    try { this.engine.a.stop(); this.engine.b.stop(); } catch { /* already gone */ }
    this.engine = null;
  }

  /** @param revs 0..1, @param load how hard it is working */
  engineAt(revs, load = 1) {
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    const f = 58 + revs * 128;
    this.engine.a.frequency.setTargetAtTime(f, t, 0.06);
    this.engine.b.frequency.setTargetAtTime(f * 1.02, t, 0.06);
    this.engine.filter.frequency.setTargetAtTime(500 + revs * 2200, t, 0.08);
    this.engine.g.gain.setTargetAtTime(0.1 + load * 0.12, t, 0.1);
  }

  _burst({ freq = 1400, q = 2, dur = 0.08, gain = 0.5, type = 'bandpass' }) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  shot(weapon) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastShot < 0.03) return;         // do not stack a minigun into a wall of noise
    this.lastShot = now;
    if (weapon === 'shotgun') this._burst({ freq: 700, q: 0.9, dur: 0.16, gain: 0.55 });
    else if (weapon === 'minigun') this._burst({ freq: 2300, q: 3, dur: 0.05, gain: 0.3 });
    else this._burst({ freq: 1700, q: 2.4, dur: 0.06, gain: 0.34 });
  }

  explosion(size = 1) {
    if (!this.ctx) return;
    this._burst({ freq: 260, q: 0.6, dur: 0.5 * size, gain: 0.7, type: 'lowpass' });
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.45);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.55);
  }

  impact(force = 1) { this._burst({ freq: 420, q: 1.1, dur: 0.1 + force * 0.08, gain: 0.25 + force * 0.25, type: 'lowpass' }); }
  pickup() { this._chirp(660, 990, 0.14); }
  cash() { this._chirp(880, 1320, 0.2); }
  beep(high = false) { this._chirp(high ? 900 : 560, high ? 900 : 560, 0.16); }

  _chirp(from, to, dur) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    osc.type = 'square';
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
}
