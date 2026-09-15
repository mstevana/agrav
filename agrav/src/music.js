// ============================================================================
// AGRAV — the soundtrack: six synthesized techno tracks in the WipEout vein,
// sequenced at sixteenth-note resolution from pattern data and rendered with
// Web Audio oscillators and noise. Nothing is downloaded. The engine is a
// pure function of time (scheduleRange), so the live player looks a little
// ahead each tick and the preview tool can render whole bars offline.
// ============================================================================

const X = 1, _ = 0;
/** a 16-step row from a string: 'x' hit, 'o' accent, '.' rest */
const row = (s) => [...s.replace(/\s/g, '')].map(ch => ch === 'x' ? 1 : ch === 'o' ? 1.4 : 0);
/** note rows: numbers are scale degrees (can be negative / >7), '.' rests, '=' ties the previous note */
const notes = (s) => s.trim().split(/\s+/).map(t => t === '.' ? null : t === '=' ? '=' : parseInt(t, 10));

const MINOR = [0, 2, 3, 5, 7, 8, 10], PHRYGIAN = [0, 1, 3, 5, 7, 8, 10], DORIAN = [0, 2, 3, 5, 7, 9, 10];
const degree = (scale, d) => { const o = Math.floor(d / scale.length); return scale[((d % scale.length) + scale.length) % scale.length] + o * 12; };

/**
 * Track data. Each pattern is one bar of sixteenths; `arrangement` lists
 * sections as [bars, layers]. Layer names: kick snare clap hat ohat bass acid
 * arp stab pad lead ride.
 */
export const TRACKS = [
  {
    id: 'canyon-carver', title: 'Canyon Carver', bpm: 150, root: 55, scale: MINOR, swing: 0.04,
    kick: row('x... x... x... x..x'), snare: row('.... x... .... x...'), hat: row('..x. ..x. ..x. ..x.'), ohat: row('.... .... .... ..x.'),
    bass: notes('0 . 0 . 7 . 0 . 0 . 3 . 0 . 5 .'), acid: notes('0 0 12 0 3 0 10 0 0 7 0 12 0 3 5 0'),
    arp: notes('0 7 12 14 7 12 14 19 0 7 12 14 7 10 14 17'), stab: notes('. . . . 0 . . . . . . . 3 . . .'),
    arrangement: [[8, ['kick', 'hat', 'bass']], [8, ['kick', 'hat', 'ohat', 'bass', 'acid']], [8, ['kick', 'snare', 'hat', 'ohat', 'bass', 'acid', 'arp']], [4, ['hat', 'ohat', 'pad', 'arp']], [8, ['kick', 'snare', 'hat', 'ohat', 'bass', 'acid', 'arp', 'stab']]]
  },
  {
    id: 'meridian-overdrive', title: 'Meridian Overdrive', bpm: 160, root: 49, scale: MINOR, swing: 0,
    kick: row('x... x... x... x...'), clap: row('.... x... .... x...'), hat: row('..x. ..x. ..x. ..x.'), ohat: row('.... ..x. .... ..x.'),
    bass: notes('0 . 0 0 . 0 . 0 0 . 0 0 . 0 5 7'), arp: notes('0 4 7 12 4 7 12 16 0 4 7 12 3 7 10 14'),
    lead: notes('12 . . 12 . 14 . . 12 . . 10 . . 7 .'), stab: notes('0 . . . . . 0 . . . 0 . . . . .'),
    arrangement: [[8, ['kick', 'hat', 'bass', 'arp']], [8, ['kick', 'clap', 'hat', 'ohat', 'bass', 'arp']], [8, ['kick', 'clap', 'hat', 'ohat', 'bass', 'arp', 'lead']], [4, ['pad', 'arp', 'lead']], [8, ['kick', 'clap', 'hat', 'ohat', 'bass', 'arp', 'lead', 'stab']]]
  },
  {
    id: 'vanta-tide', title: 'Vanta Tide', bpm: 145, root: 58.3, scale: DORIAN, swing: 0.06,
    kick: row('x... ..x. x... .x..'), snare: row('.... x... .... x..x'), hat: row('x.x. x.x. x.x. x.xx'), ride: row('..x. ..x. ..x. ..x.'),
    bass: notes('0 . . 0 . 0 . . 0 . . 3 . 5 . .'), arp: notes('0 2 4 7 9 7 4 2 0 2 4 7 11 9 7 4'),
    pad: notes('0 . . . . . . . 3 . . . . . . .'), lead: notes('. . 7 . . 9 . . . . 7 . 4 . 2 .'),
    arrangement: [[8, ['kick', 'hat', 'bass', 'pad']], [8, ['kick', 'snare', 'hat', 'ride', 'bass', 'pad', 'arp']], [8, ['kick', 'snare', 'hat', 'ride', 'bass', 'arp', 'lead']], [4, ['pad', 'ride', 'lead']], [8, ['kick', 'snare', 'hat', 'ride', 'bass', 'pad', 'arp', 'lead']]]
  },
  {
    id: 'league-anthem', title: 'Anti-Grav League Anthem', bpm: 172, root: 46.2, scale: MINOR, swing: 0,
    kick: row('x... .... ..x. ....'), snare: row('.... x... .... x...'), hat: row('x.x. x.x. x.x. x.x.'), ohat: row('.... .... ..x. ....'),
    bass: notes('0 = = = = = = = 0 = = = 3 = 5 ='), reese: true, arp: notes('0 7 12 0 7 12 0 7 3 10 15 3 10 15 3 10'),
    lead: notes('12 . 14 . 15 . . . 14 . 12 . . . 10 .'), stab: notes('0 . . . . . . . . . 0 . . . . .'),
    arrangement: [[8, ['kick', 'snare', 'hat', 'bass']], [8, ['kick', 'snare', 'hat', 'ohat', 'bass', 'arp']], [8, ['kick', 'snare', 'hat', 'ohat', 'bass', 'arp', 'lead']], [4, ['pad', 'arp']], [8, ['kick', 'snare', 'hat', 'ohat', 'bass', 'arp', 'lead', 'stab']]]
  },
  {
    id: 'umbrella-protocol', title: 'Umbrella Protocol', bpm: 140, root: 41.2, scale: PHRYGIAN, swing: 0.02,
    kick: row('x... x... x... x...'), snare: row('.... x... .... x...'), hat: row('.... ..x. .... ..x.'), ohat: row('..x. .... ..x. ....'),
    bass: notes('0 . 0 . 0 . 1 . 0 . 0 . 0 . 3 .'), acid: notes('0 . 12 . 0 . 13 . 0 . 12 . 3 . 15 .'),
    stab: notes('0 . . 1 . . 0 . . . 0 . . 3 . .'), pad: notes('0 . . . . . . . 1 . . . . . . .'),
    arrangement: [[8, ['kick', 'hat', 'bass']], [8, ['kick', 'snare', 'hat', 'ohat', 'bass', 'stab']], [8, ['kick', 'snare', 'hat', 'ohat', 'bass', 'acid', 'stab']], [4, ['pad', 'ohat', 'acid']], [8, ['kick', 'snare', 'hat', 'ohat', 'bass', 'acid', 'stab', 'pad']]]
  },
  {
    id: 'hypercell', title: 'Hypercell', bpm: 165, root: 65.4, scale: MINOR, swing: 0,
    kick: row('x... x... x... x...'), clap: row('.... x... .... x...'), hat: row('..x. ..x. ..x. ..x.'), ohat: row('.... .... .... ..x.'),
    bass: notes('0 . 0 . 0 . 0 . 0 . 0 . 0 . 0 .'), stab: notes('0 . 0 . . 3 . . 0 . 0 . . 5 . .'),
    arp: notes('0 12 7 12 3 12 7 12 0 12 7 12 5 12 10 12'), lead: notes('. . . . 7 . 7 . . . 5 . 3 . . .'),
    arrangement: [[8, ['kick', 'hat', 'bass', 'stab']], [8, ['kick', 'clap', 'hat', 'ohat', 'bass', 'stab', 'arp']], [8, ['kick', 'clap', 'hat', 'ohat', 'bass', 'stab', 'arp', 'lead']], [4, ['pad', 'arp']], [8, ['kick', 'clap', 'hat', 'ohat', 'bass', 'stab', 'arp', 'lead']]]
  }
];

// ---------------------------------------------------------- instruments --

function noiseBuffer(ctx) {
  if (ctx.__agravNoise) return ctx.__agravNoise;
  const n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let s = 1; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = s / 2147483647 * 2 - 1; }
  ctx.__agravNoise = buf; return buf;
}
const env = (g, t, a, d, peak, sustain = 0.0001, hold = 0) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); if (hold) g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(sustain, t + a + hold + d); };

const INSTRUMENTS = {
  kick(ctx, out, t, v) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain(); env(g, t, 0.002, 0.28, 0.9 * v); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.35);
    const c = ctx.createBufferSource(); c.buffer = noiseBuffer(ctx); const cf = ctx.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.value = 2500;
    const cg = ctx.createGain(); env(cg, t, 0.001, 0.02, 0.25 * v); c.connect(cf); cf.connect(cg); cg.connect(out); c.start(t); c.stop(t + 0.04);
  },
  snare(ctx, out, t, v) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
    const g = ctx.createGain(); env(g, t, 0.002, 0.16, 0.5 * v); n.connect(f); f.connect(g); g.connect(out); n.start(t); n.stop(t + 0.2);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const og = ctx.createGain(); env(og, t, 0.001, 0.09, 0.35 * v); o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.12);
  },
  clap(ctx, out, t, v) {
    for (let i = 0; i < 3; i++) {
      const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 1.2;
      const g = ctx.createGain(); const tt = t + i * 0.011; env(g, tt, 0.001, i === 2 ? 0.18 : 0.03, 0.4 * v); n.connect(f); f.connect(g); g.connect(out); n.start(tt); n.stop(tt + 0.22);
    }
  },
  hat(ctx, out, t, v) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain(); env(g, t, 0.001, 0.04, 0.22 * v); n.connect(f); f.connect(g); g.connect(out); n.start(t); n.stop(t + 0.06);
  },
  ohat(ctx, out, t, v) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
    const g = ctx.createGain(); env(g, t, 0.001, 0.22, 0.2 * v); n.connect(f); f.connect(g); g.connect(out); n.start(t); n.stop(t + 0.28);
  },
  ride(ctx, out, t, v) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 9000; f.Q.value = 2;
    const g = ctx.createGain(); env(g, t, 0.001, 0.3, 0.12 * v); n.connect(f); f.connect(g); g.connect(out); n.start(t); n.stop(t + 0.35);
  },
  bass(ctx, out, t, freq, dur, reese) {
    const g = ctx.createGain(); env(g, t, 0.004, dur * 0.9, 0.42, 0.0001, 0);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(reese ? 700 : 1400, t); f.frequency.exponentialRampToValueAtTime(reese ? 300 : 180, t + dur); f.Q.value = reese ? 4 : 1.5;
    const os = reese ? [0, 12, -12] : [0]; for (const cents of os) { const o = ctx.createOscillator(); o.type = reese ? 'sawtooth' : 'square'; o.frequency.value = freq; o.detune.value = cents; o.connect(f); o.start(t); o.stop(t + dur + 0.05); }
    f.connect(g); g.connect(out);
  },
  acid(ctx, out, t, freq, dur, accent) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 14; f.frequency.setValueAtTime(accent ? 2600 : 900, t); f.frequency.exponentialRampToValueAtTime(220, t + dur * 1.3);
    const g = ctx.createGain(); env(g, t, 0.003, dur, 0.22); o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  },
  arp(ctx, out, t, freq, dur) {
    const g = ctx.createGain(); env(g, t, 0.003, dur * 1.4, 0.11);
    for (const d of [-7, 7]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = d; o.connect(g); o.start(t); o.stop(t + dur * 1.5); }
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200; g.connect(f); f.connect(out);
    return f;
  },
  lead(ctx, out, t, freq, dur) {
    const g = ctx.createGain(); env(g, t, 0.01, dur * 1.8, 0.16);
    for (const d of [-9, 0, 9]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq; o.detune.value = d; o.connect(g); o.start(t); o.stop(t + dur * 2); }
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3800, t); f.frequency.exponentialRampToValueAtTime(900, t + dur * 1.8); g.connect(f); f.connect(out);
    return f;
  },
  stab(ctx, out, t, freq, dur, scale) {
    const g = ctx.createGain(); env(g, t, 0.003, dur * 0.7, 0.16);
    for (const semi of [0, 3, 7, 12]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq * Math.pow(2, semi / 12); o.connect(g); o.start(t); o.stop(t + dur); }
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(600, t + dur * 0.7); g.connect(f); f.connect(out);
    void scale;
  },
  pad(ctx, out, t, freq, dur) {
    const g = ctx.createGain(); env(g, t, dur * 0.3, dur * 0.7, 0.07, 0.0001, dur * 0.2);
    for (const [semi, d] of [[0, -6], [7, 5], [12, -4], [15, 6]]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq * Math.pow(2, semi / 12); o.detune.value = d; o.connect(g); o.start(t); o.stop(t + dur * 1.3); }
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400; g.connect(f); f.connect(out);
  }
};

// ------------------------------------------------------------ sequencer --

/**
 * A player for one track on a Web Audio context. `scheduleRange(t0, t1)`
 * places every hit whose time falls in [t0, t1) relative to `origin`, so the
 * live loop can advance a little at a time and an offline render can do it
 * all at once.
 */
export class TrackPlayer {
  constructor(ctx, track, out, { origin = ctx.currentTime, energy = 1 } = {}) {
    this.ctx = ctx; this.track = track; this.origin = origin; this.energy = energy;
    this.bus = ctx.createGain(); this.bus.gain.value = 1; this.bus.connect(out);
    // a delay send for arps and leads
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = (60 / track.bpm) * 0.75;
    this.delayGain = ctx.createGain(); this.delayGain.gain.value = 0.3;
    const fb = ctx.createGain(); fb.gain.value = 0.35; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
    this.delay.connect(fb); fb.connect(hp); hp.connect(this.delay); this.delay.connect(this.delayGain); this.delayGain.connect(this.bus);
    this.step = 60 / track.bpm / 4;
    this.barLen = this.step * 16;
    this.totalBars = track.arrangement.reduce((a, s) => a + s[0], 0);
    this.scheduled = 0;   // next step index to schedule
  }
  layersAt(bar) {
    let b = bar % this.totalBars;
    for (const [n, layers] of this.track.arrangement) { if (b < n) return layers; b -= n; }
    return this.track.arrangement[0][1];
  }
  /** schedule steps whose time is in [t0, t1) */
  scheduleRange(t0, t1) {
    const T = this.track, ctx = this.ctx, scale = T.scale;
    while (true) {
      const i = this.scheduled, bar = Math.floor(i / 16), s16 = i % 16;
      const t = this.origin + bar * this.barLen + s16 * this.step + (s16 % 2 ? T.swing * this.step : 0);
      if (t >= t1) return;
      this.scheduled++;
      if (t < t0 - 0.05) continue;
      const layers = this.layersAt(bar);
      const fill = (bar % 8 === 7) && s16 >= 12;   // a fill on the last beat of every eighth bar
      const on = (name) => layers.includes(name);
      const v = this.energy;
      if (on('kick') && T.kick[s16]) INSTRUMENTS.kick(ctx, this.bus, t, T.kick[s16] * v);
      if (on('snare') && (T.snare?.[s16] || (fill && s16 % 2 === 0))) INSTRUMENTS.snare(ctx, this.bus, t, (T.snare?.[s16] || 0.8) * v);
      if (on('clap') && (T.clap?.[s16] || (fill && s16 % 2 === 1))) INSTRUMENTS.clap(ctx, this.bus, t, (T.clap?.[s16] || 0.8) * v);
      if (on('hat') && T.hat?.[s16]) INSTRUMENTS.hat(ctx, this.bus, t, T.hat[s16] * v * (s16 % 4 === 2 ? 1 : 0.7));
      if (on('ohat') && T.ohat?.[s16]) INSTRUMENTS.ohat(ctx, this.bus, t, T.ohat[s16] * v);
      if (on('ride') && T.ride?.[s16]) INSTRUMENTS.ride(ctx, this.bus, t, T.ride[s16] * v);
      const noteAt = (rowData, idx) => { const n = rowData?.[idx]; if (n == null || n === '=') return null; let len = 1; while (rowData[(idx + len) % 16] === '=' && len < 16) len++; return { n, len }; };
      const hz = (d, oct = 0) => T.root * Math.pow(2, (degree(scale, d) + oct * 12) / 12);
      if (on('bass')) { const nb = noteAt(T.bass, s16); if (nb) INSTRUMENTS.bass(ctx, this.bus, t, hz(nb.n), this.step * nb.len * 0.95, !!T.reese); }
      if (on('acid')) { const na = noteAt(T.acid, s16); if (na) INSTRUMENTS.acid(ctx, this.bus, t, hz(na.n, 1), this.step * 0.9, s16 % 4 === 0); }
      if (on('arp')) { const na = noteAt(T.arp, s16); if (na) { const f = INSTRUMENTS.arp(ctx, this.bus, t, hz(na.n, 2), this.step * na.len); f.connect(this.delay); } }
      if (on('lead')) { const nl = noteAt(T.lead, s16); if (nl) { const f = INSTRUMENTS.lead(ctx, this.bus, t, hz(nl.n, 2), this.step * nl.len); f.connect(this.delay); } }
      if (on('stab')) { const ns = noteAt(T.stab, s16); if (ns) INSTRUMENTS.stab(ctx, this.bus, t, hz(ns.n, 1), this.step * 2, scale); }
      if (on('pad')) { const np = noteAt(T.pad || notes('0 . . . . . . . . . . . . . . .'), s16); if (np) INSTRUMENTS.pad(ctx, this.bus, t, hz(np.n, 1), this.barLen); }
    }
  }
  /** live: keep ~0.2 s scheduled ahead of the context clock */
  tick() { this.scheduleRange(this.ctx.currentTime, this.ctx.currentTime + 0.25); }
  stop(fade = 0.6) { const t = this.ctx.currentTime; this.bus.gain.setTargetAtTime(0, t, fade / 3); setTimeout(() => this.bus.disconnect(), fade * 1000 + 200); }
}

/** render `bars` bars of a track to an AudioBuffer with an OfflineAudioContext (browser only) */
export async function renderTrack(track, bars = 8, sampleRate = 44100) {
  const step = 60 / track.bpm / 4, dur = step * 16 * bars + 1.5;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4; comp.connect(ctx.destination);
  const master = ctx.createGain(); master.gain.value = 0.7; master.connect(comp);
  const p = new TrackPlayer(ctx, track, master, { origin: 0.05 });
  p.scheduleRange(0, dur);
  return ctx.startRendering();
}
