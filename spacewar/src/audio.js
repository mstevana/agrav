// ============================================================================
// Sound, synthesized on the fly through Web Audio: no files to download. A
// torpedo is a falling sine chirp, an explosion a noise burst over a low thump,
// thrust a band of filtered noise that swells while the engine burns, a jump a
// sweep up and back down.
//
// Nothing plays until the player has interacted with the page (browsers will
// not allow it), and everything is a no-op when no context can be made.
// ============================================================================

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.thrustGain = null;
  }

  /** must be called from a real gesture, or the browser refuses */
  resume() {
    try {
      if (!this.ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.35;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { this.ctx = null; }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.35;
  }

  _noise() {
    if (this._buf) return this._buf;
    const n = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return (this._buf = buf);
  }

  _env(gain, t, peak, attack, decay) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** @param pan -1..1 across the arena, @param near 0..1 how loud */
  fire(pan = 0, near = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.16);
    this._env(g, t, 0.25 * near, 0.005, 0.17);
    o.connect(g); this._out(g, pan);
    o.start(t); o.stop(t + 0.2);
  }

  explode(pan = 0, big = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this._noise();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 1.1);
    const g = this.ctx.createGain();
    this._env(g, t, 0.9 * big, 0.01, 1.1);
    n.connect(f); f.connect(g); this._out(g, pan);
    n.start(t); n.stop(t + 1.2);
    const o = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.6);
    this._env(og, t, 0.8 * big, 0.01, 0.6);
    o.connect(og); this._out(og, pan);
    o.start(t); o.stop(t + 0.7);
  }

  hyper(pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(1800, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.7);
    this._env(g, t, 0.22, 0.02, 0.7);
    o.connect(g); this._out(g, pan);
    o.start(t); o.stop(t + 0.75);
  }

  /** short notes: the countdown, the go, the round won */
  blip(freq = 660, len = 0.12, vol = 0.18, type = 'square') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    this._env(g, t, vol, 0.005, len);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + len + 0.05);
  }
  fanfare(win) {
    const notes = win ? [523, 659, 784, 1047] : [392, 330, 262];
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.16, 0.14, 'triangle'), i * 120));
  }

  /** the engine: call every frame with whether my ship is burning */
  thrust(on) {
    if (!this.ctx) return;
    if (!this.thrustGain) {
      const n = this.ctx.createBufferSource();
      n.buffer = this._noise();
      n.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 180; f.Q.value = 0.8;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      n.connect(f); f.connect(g); g.connect(this.master);
      n.start();
      this.thrustGain = g;
    }
    this.thrustGain.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, on ? 0.03 : 0.08);
  }

  _out(node, pan) {
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p); p.connect(this.master);
    } else node.connect(this.master);
  }
}
