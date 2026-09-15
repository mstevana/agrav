// ============================================================================
// AGRAV — audio: Web Audio only, zero assets. Engines are a pair of detuned
// oscillators plus filtered noise whose pitch follows speed; weapons, hits,
// pickups and the countdown are short synthesized hits; music is a small
// generative sequencer (a driving pulse in the race, a slow drone elsewhere).
// ============================================================================

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

class Audio {
  constructor() {
    this.ctx = null; this.muted = false; this.musicOn = true;
    this.engines = new Map();
    this.listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
    this.last = {};
    this.music = null;
  }
  get ready() { return !!this.ctx; }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicOn ? 0.28 : 0; this.musicBus.connect(this.master);
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.sfx.disconnect(); this.sfx.connect(this.comp); this.comp.connect(this.master);
    const n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.ctx?.state === 'suspended') this.ctx.resume(); });
  }
  setMuted(m) { this.muted = m; if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05); }
  setMusic(on) { this.musicOn = on; if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.28 : 0, this.ctx.currentTime, 0.2); }
  setListener(camera) { const e = camera.matrixWorld.elements; this.listener = { x: e[12], y: e[13], z: e[14], rx: e[0], rz: e[2] }; }

  _spatial(pos) {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z;
    const d = Math.hypot(dx, dy, dz);
    const gain = 1 / (1 + (d / 40) ** 2);
    const pan = clamp((dx * this.listener.rx + dz * this.listener.rz) / Math.max(1, d), -1, 1) * 0.7;
    return { gain, pan };
  }
  _out(pos, vol = 1) {
    const { gain, pan } = this._spatial(pos);
    const g = this.ctx.createGain(); g.gain.value = gain * vol;
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; g.connect(p); p.connect(this.sfx); } else g.connect(this.sfx);
    return g;
  }
  _limit(name, ms) { const now = performance.now(); if (this.last[name] && now - this.last[name] < ms) return false; this.last[name] = now; return true; }

  /** a filtered noise burst */
  _burst(pos, { dur = 0.2, from = 3000, to = 300, vol = 0.6, q = 1 }) {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this._out(pos, vol); g.gain.setValueAtTime(g.gain.value, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); src.start(t); src.stop(t + dur + 0.05);
  }
  /** a pitched blip */
  _tone(pos, { freq = 440, to = null, dur = 0.15, type = 'square', vol = 0.3 }) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this._out(pos, vol); g.gain.setValueAtTime(g.gain.value, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); o.start(t); o.stop(t + dur + 0.05);
  }

  play(name, pos, opts = {}) {
    if (!this.ctx) return;
    switch (name) {
      case 'rocket': if (this._limit(name, 60)) { this._burst(pos, { dur: 0.35, from: 1800, to: 200, vol: 0.7 }); this._tone(pos, { freq: 320, to: 90, dur: 0.3, type: 'sawtooth', vol: 0.25 }); } break;
      case 'missile': this._burst(pos, { dur: 0.6, from: 1200, to: 150, vol: 0.7, q: 2 }); this._tone(pos, { freq: 900, to: 200, dur: 0.5, type: 'sawtooth', vol: 0.2 }); break;
      case 'minigun': if (this._limit(name, 40)) this._burst(pos, { dur: 0.06, from: 4000, to: 800, vol: 0.5, q: 0.7 }); break;
      case 'mine': this._tone(pos, { freq: 200, to: 120, dur: 0.2, type: 'square', vol: 0.3 }); break;
      case 'boom': this._burst(pos, { dur: 0.7, from: 600, to: 40, vol: 1.0, q: 0.5 }); this._tone(pos, { freq: 80, to: 30, dur: 0.6, type: 'sine', vol: 0.6 }); break;
      case 'bigboom': this._burst(pos, { dur: 1.4, from: 900, to: 30, vol: 1.2, q: 0.5 }); this._tone(pos, { freq: 60, to: 20, dur: 1.2, type: 'sine', vol: 0.8 }); break;
      case 'hit': if (this._limit(name, 50)) this._burst(pos, { dur: 0.12, from: 2500, to: 500, vol: 0.5, q: 1.5 }); break;
      case 'absorb': this._tone(pos, { freq: 1200, to: 600, dur: 0.2, type: 'triangle', vol: 0.3 }); break;
      case 'wall': if (this._limit(name, 120)) this._burst(pos, { dur: 0.25, from: 3000, to: 600, vol: clamp((opts.force || 10) / 40, 0.2, 0.8), q: 0.8 }); break;
      case 'scrape': if (this._limit(name, 200)) this._burst(pos, { dur: 0.22, from: 5000, to: 3000, vol: 0.18, q: 0.6 }); break;
      case 'pickup': this._tone(pos, { freq: 660, to: 1320, dur: 0.18, type: 'triangle', vol: 0.35 }); this._tone(pos, { freq: 990, to: 1980, dur: 0.22, type: 'sine', vol: 0.2 }); break;
      case 'health': this._tone(pos, { freq: 520, to: 1040, dur: 0.35, type: 'sine', vol: 0.4 }); break;
      case 'shield': this._tone(pos, { freq: 300, to: 1500, dur: 0.4, type: 'sawtooth', vol: 0.25 }); break;
      case 'speed': this._burst(pos, { dur: 0.8, from: 400, to: 4000, vol: 0.6, q: 3 }); break;
      case 'lap': this._tone(null, { freq: 880, dur: 0.12, type: 'square', vol: 0.25 }); setTimeout(() => this.ctx && this._tone(null, { freq: 1320, dur: 0.2, type: 'square', vol: 0.25 }), 120); break;
      case 'count': this._tone(null, { freq: 440, dur: 0.18, type: 'square', vol: 0.35 }); break;
      case 'go': this._tone(null, { freq: 880, dur: 0.5, type: 'square', vol: 0.4 }); break;
      case 'finish': [0, 120, 240, 360].forEach((d, i) => setTimeout(() => this.ctx && this._tone(null, { freq: [660, 880, 1100, 1320][i], dur: 0.3, type: 'triangle', vol: 0.3 }), d)); break;
      case 'dead': this.play('bigboom', pos); break;
      case 'ui': this._tone(null, { freq: 700, dur: 0.05, type: 'square', vol: 0.12 }); break;
      case 'bump': if (this._limit(name, 150)) this._burst(pos, { dur: 0.15, from: 900, to: 200, vol: clamp((opts.force || 5) / 30, 0.1, 0.5), q: 1 }); break;
      default: break;
    }
  }

  /** keep an engine voice for a craft up to date; call every frame for audible craft */
  engine(id, { speedFrac, throttle, boost, pos, mine }) {
    if (!this.ctx) return;
    let e = this.engines.get(id);
    const c = this.ctx;
    if (!e) {
      const o1 = c.createOscillator(); o1.type = 'sawtooth';
      const o2 = c.createOscillator(); o2.type = 'square';
      const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
      const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.8;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass';
      const g = c.createGain(); g.gain.value = 0;
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      o1.connect(lp); o2.connect(lp); n.connect(nf); nf.connect(lp); lp.connect(g);
      if (pan) { g.connect(pan); pan.connect(this.sfx); } else g.connect(this.sfx);
      o1.start(); o2.start(); n.start();
      e = { o1, o2, nf, lp, g, pan };
      this.engines.set(id, e);
    }
    const t = c.currentTime;
    const base = 55 + speedFrac * 140 + (boost ? 40 : 0);
    e.o1.frequency.setTargetAtTime(base, t, 0.08);
    e.o2.frequency.setTargetAtTime(base * 0.5 + (throttle ? 2 : 0), t, 0.08);
    e.nf.frequency.setTargetAtTime(400 + speedFrac * 2600, t, 0.1);
    e.lp.frequency.setTargetAtTime(600 + speedFrac * 3000 + (throttle ? 600 : 0), t, 0.1);
    const { gain, pan } = mine ? { gain: 1, pan: 0 } : this._spatial(pos);
    e.g.gain.setTargetAtTime((mine ? 0.16 : 0.12) * gain * (0.5 + speedFrac * 0.5 + (throttle ? 0.25 : 0)), t, 0.1);
    if (e.pan) e.pan.pan.setTargetAtTime(pan, t, 0.1);
  }
  stopEngine(id) { const e = this.engines.get(id); if (!e) return; try { e.o1.stop(); e.o2.stop(); } catch { /* */ } this.engines.delete(id); }
  stopAllEngines() { for (const id of [...this.engines.keys()]) this.stopEngine(id); }

  // ------------------------------------------------------------------ music --
  /** mode: 'menu' | 'race' | null */
  setMusicMode(mode) {
    if (!this.ctx) { this._musicMode = mode; return; }
    if (this.music && this.music.mode === mode) return;
    this.stopMusic();
    if (!mode) return;
    const c = this.ctx;
    const bus = c.createGain(); bus.gain.value = 0; bus.connect(this.musicBus);
    bus.gain.setTargetAtTime(1, c.currentTime, 1.5);
    const m = { mode, bus, step: 0, timer: 0, alive: true };
    const bpm = mode === 'race' ? 138 : 70;
    const scale = mode === 'race' ? [0, 3, 5, 7, 10, 12, 15] : [0, 2, 3, 7, 9, 12, 14];
    const root = mode === 'race' ? 55 : 41.2;
    const schedule = () => {
      if (!m.alive) return;
      const t = c.currentTime;
      const beat = 60 / bpm / 2;
      const i = m.step++;
      // bass pulse
      if (i % 2 === 0) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = root * (i % 16 < 8 ? 1 : 1.5);
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(mode === 'race' ? 900 : 300, t); f.frequency.exponentialRampToValueAtTime(120, t + beat * 1.8);
        const g = c.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + beat * 1.9);
        o.connect(f); f.connect(g); g.connect(bus); o.start(t); o.stop(t + beat * 2);
      }
      // arpeggio
      if (mode === 'race' || i % 4 === 0) {
        const n = scale[(i * 5 + (i >> 3)) % scale.length] + 24;
        const o = c.createOscillator(); o.type = mode === 'race' ? 'square' : 'triangle'; o.frequency.value = root * Math.pow(2, n / 12);
        const g = c.createGain(); g.gain.setValueAtTime(mode === 'race' ? 0.09 : 0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + beat * (mode === 'race' ? 0.9 : 3.5));
        const d = c.createDelay(); d.delayTime.value = beat * 1.5; const dg = c.createGain(); dg.gain.value = 0.35;
        o.connect(g); g.connect(bus); g.connect(d); d.connect(dg); dg.connect(bus); o.start(t); o.stop(t + beat * 4);
      }
      m.timer = setTimeout(schedule, beat * 1000);
    };
    schedule();
    this.music = m;
  }
  stopMusic() {
    if (!this.music) return;
    const m = this.music; m.alive = false; clearTimeout(m.timer);
    m.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
    setTimeout(() => m.bus.disconnect(), 2500);
    this.music = null;
  }
}

export const audio = new Audio();
