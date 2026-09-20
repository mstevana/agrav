// ============================================================================
// AGRAV — procedural textures (canvas → three.js). No image assets anywhere.
// ============================================================================

import * as THREE from 'three';
import { makeRng } from '../../../shared/sim/rng.js';
import { fbm2, smoothstep } from '../../../shared/gfx/noise.js';
import { SPONSORS } from './livery.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { repeat = [1, 1], srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

const cache = new Map();
function memo(key, f) { if (!cache.has(key)) cache.set(key, f()); return cache.get(key); }

/** track surface: panelled composite with faint seams; tile = 8 m along, full width across */
export function trackSurface(base = 0x333948, seam = 0x1a1e28) {
  return memo('surf' + base, () => {
    const c = canvas(512, 512), g = c.getContext('2d'), rng = makeRng(7);
    g.fillStyle = hex(base); g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${rng() < 0.5 ? 255 : 0},${rng() < 0.5 ? 255 : 0},${rng() < 0.5 ? 255 : 0},${(rng() * 0.05).toFixed(3)})`;
      g.fillRect(rng() * 512, rng() * 512, rng() * 4 + 1, rng() * 4 + 1);
    }
    g.strokeStyle = hex(seam); g.lineWidth = 3;
    for (let y = 0; y <= 512; y += 128) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(512, y + 0.5); g.stroke(); }
    for (let x = 0; x <= 512; x += 256) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, 512); g.stroke(); }
    // tyre-like scuff bands down the middle third
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(150, 0, 90, 512); g.fillRect(272, 0, 90, 512);
    return tex(c);
  });
}

/** a powerup pad: chevrons on a dark plate */
export function padTexture(colour = 0x2df1ff) {
  return memo('pad' + colour, () => {
    const c = canvas(128, 128), g = c.getContext('2d');
    g.fillStyle = '#0a0d16'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = hex(colour); g.lineWidth = 10; g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const y = 30 + i * 30;
      g.beginPath(); g.moveTo(24, y + 18); g.lineTo(64, y); g.lineTo(104, y + 18); g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 4; g.strokeRect(6, 6, 116, 116);
    const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}

/** rumble-strip curb: colour / white stripes, one stripe per metre along v */
export function curbTexture(colour = 0x2df1ff) {
  return memo('curb' + colour, () => {
    const c = canvas(16, 64), g = c.getContext('2d');
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, 16, 32);
    g.fillStyle = hex(colour); g.fillRect(0, 32, 16, 32);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, 16, 2); g.fillRect(0, 32, 16, 2);
    return tex(c, { repeat: [1, 1] });
  });
}

/** skid marks: two dark streaks with ragged edges on a transparent plate */
export function skidTexture() {
  return memo('skid', () => {
    const c = canvas(64, 256), g = c.getContext('2d'), rng = makeRng(5);
    g.clearRect(0, 0, 64, 256);
    for (const x0 of [14, 40]) for (let y = 0; y < 256; y += 2) {
      const w = 8 + fbm2(x0, y * 0.05, { octaves: 2, seed: 3 }) * 5, a = 0.35 + fbm2(x0 * 0.3, y * 0.03, { octaves: 2, seed: 4 }) * 0.3;
      const fade = Math.sin(y / 256 * Math.PI);
      g.fillStyle = `rgba(0,0,0,${(a * fade).toFixed(3)})`; g.fillRect(x0 - w / 2 + (rng() - 0.5) * 2, y, w, 2);
    }
    const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}

/** start / finish line */
export function checkerTexture() {
  return memo('checker', () => {
    const c = canvas(256, 64), g = c.getContext('2d');
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#f2f2f2' : '#111'; g.fillRect(x * 16, y * 16, 16, 16); }
    return tex(c);
  });
}

/** tower facade: lit windows on dark cladding, a few strips of neon */
export function facadeTexture(seed, neon) {
  return memo('facade' + seed + neon, () => {
    const c = canvas(256, 512), g = c.getContext('2d'), rng = makeRng(seed);
    g.fillStyle = '#0c0f1a'; g.fillRect(0, 0, 256, 512);
    const cols = 8 + rng.int(0, 4), rows = 24 + rng.int(0, 10);
    const cw = 256 / cols, rh = 512 / rows;
    const warm = rng() < 0.5;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const lit = rng() < 0.55;
      if (!lit) { g.fillStyle = '#131726'; }
      else {
        const b = 0.5 + rng() * 0.5;
        g.fillStyle = warm ? `rgba(${Math.round(255 * b)},${Math.round(210 * b)},${Math.round(150 * b)},1)` : `rgba(${Math.round(160 * b)},${Math.round(210 * b)},${Math.round(255 * b)},1)`;
      }
      g.fillRect(i * cw + 2, j * rh + 2, cw - 4, rh - 4);
    }
    if (neon != null) {
      g.fillStyle = hex(neon);
      const y = rng.int(40, 460);
      g.fillRect(0, y, 256, 6);
      if (rng() < 0.6) g.fillRect(rng.int(0, 200), 0, 6, 512);
    }
    return tex(c, { repeat: [1, 1] });
  });
}

/** canyon strata: horizontal bands of rock colour with noise */
export function strataTexture(colours) {
  return memo('strata' + colours.join(), () => {
    const c = canvas(256, 512), g = c.getContext('2d'), rng = makeRng(11);
    let y = 0;
    while (y < 512) {
      const h = 8 + rng() * 40;
      g.fillStyle = hex(rng.pick(colours));
      g.fillRect(0, y, 256, h);
      y += h;
    }
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(${rng() < 0.5 ? 0 : 255},${rng() < 0.5 ? 0 : 200},${rng() < 0.5 ? 0 : 150},${(rng() * 0.12).toFixed(3)})`;
      g.fillRect(rng() * 256, rng() * 512, rng() * 6 + 1, rng() * 2 + 1);
    }
    return tex(c, { repeat: [4, 1] });
  });
}

/** sand / ground: flat colour with grain */
export function groundTexture(base, grain = 0.08) {
  return memo('ground' + base, () => {
    const c = canvas(256, 256), g = c.getContext('2d'), rng = makeRng(23);
    g.fillStyle = hex(base); g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = `rgba(${rng() < 0.5 ? 0 : 255},${rng() < 0.5 ? 0 : 255},${rng() < 0.5 ? 0 : 255},${(rng() * grain).toFixed(3)})`;
      g.fillRect(rng() * 256, rng() * 256, rng() * 3 + 1, rng() * 3 + 1);
    }
    return tex(c, { repeat: [40, 40] });
  });
}

/** cliff rock: vertical streaks */
export function cliffTexture(base = 0x8a7b68) {
  return memo('cliff' + base, () => {
    const c = canvas(256, 512), g = c.getContext('2d'), rng = makeRng(31);
    g.fillStyle = hex(base); g.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(${rng() < 0.5 ? 0 : 255},${rng() < 0.5 ? 0 : 240},${rng() < 0.5 ? 0 : 220},${(rng() * 0.18).toFixed(3)})`;
      g.fillRect(rng() * 256, rng() * 512, rng() * 8 + 2, rng() * 80 + 10);
    }
    for (let y = 0; y < 512; y += 40 + rng() * 60) { g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, y, 256, 3); }
    return tex(c, { repeat: [3, 1] });
  });
}

/** sky dome gradient (top colour → horizon colour), optionally with a sun disc */
export function skyTexture(top, horizon, sun) {
  return memo('sky' + top + horizon + sun, () => {
    const c = canvas(64, 512), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, hex(top)); grad.addColorStop(0.55, hex(horizon)); grad.addColorStop(1, hex(horizon));
    g.fillStyle = grad; g.fillRect(0, 0, 64, 512);
    const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}

/**
 * A full sky dome: gradient top → horizon, optional star field, nebula haze,
 * clouds and a horizon glow. 1024 × 512, u around, v top → bottom.
 */
export function skyDomeTexture(top, horizon, { stars = false, nebula = false, clouds = false, glow = null, seed = 1, milkyway = false } = {}) {
  return memo(`dome${top}${horizon}${stars}${nebula}${clouds}${glow}${seed}${milkyway}`, () => {
    const W = 1024, H = 512;
    const c = canvas(W, H), g = c.getContext('2d'), rng = makeRng(seed);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, hex(top)); grad.addColorStop(0.5, hex(horizon)); grad.addColorStop(1, hex(horizon));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const img = g.getImageData(0, 0, W, H), d = img.data;
    const T = [(top >> 16) & 255, (top >> 8) & 255, top & 255], Hc = [(horizon >> 16) & 255, (horizon >> 8) & 255, horizon & 255];
    const G = glow != null ? [(glow >> 16) & 255, (glow >> 8) & 255, glow & 255] : null;
    for (let y = 0; y < H; y++) {
      const v = y / H;                         // 0 top, 0.5 horizon
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, u = x / W;
        let r = d[i], gg = d[i + 1], b = d[i + 2];
        if (nebula && v < 0.55) {
          const n = Math.max(0, fbm2(u * 6, v * 8, { octaves: 4, seed: seed + 2 })) * (1 - v / 0.55);
          r += n * 40; gg += n * 20; b += n * 70;
        }
        if (milkyway && v < 0.6) {
          // the galactic band: a sinuous belt of unresolved stars around the sky, torn by dark dust lanes, brighter at its core
          const c = 0.3 + 0.13 * Math.sin(u * Math.PI * 2);
          // a wider belt than a strict gaussian: against a black sky the tails are what read
          const band = Math.exp(-(((v - c) / 0.085) ** 2)) + 0.35 * Math.exp(-(((v - c) / 0.2) ** 2));
          const dust = smoothstep(0.05, 0.45, fbm2(u * 16, v * 26, { octaves: 4, seed: seed + 6 }));
          const wisp = 0.6 + 0.4 * fbm2(u * 40, v * 60, { octaves: 3, seed: seed + 7 });
          const core = 0.55 + 0.45 * Math.exp(-(((u - 0.62) / 0.16) ** 2));
          const k = band * (1 - dust * 0.7) * wisp * core;
          r += k * 165; gg += k * 158; b += k * 195;
        }
        if (clouds && v < 0.5) {
          const n = fbm2(u * 7 + seed, v * 14, { octaves: 5, seed: seed + 4 });
          const cov = smoothstep(0.05, 0.45, n) * smoothstep(0.02, 0.2, v) * (1 - smoothstep(0.35, 0.5, v));
          const lit = 235 + n * 20;
          r = r + (lit - r) * cov * 0.9; gg = gg + (lit - gg) * cov * 0.9; b = b + (lit + 8 - b) * cov * 0.9;
        }
        if (G && v > 0.3) {
          const k = smoothstep(0.3, 0.5, v) * (0.6 + 0.4 * Math.sin(u * 30 + Math.sin(u * 7) * 3) * 0.3);
          r += (G[0] - r) * k * 0.7; gg += (G[1] - gg) * k * 0.7; b += (G[2] - b) * k * 0.7;
        }
        d[i] = Math.min(255, r); d[i + 1] = Math.min(255, gg); d[i + 2] = Math.min(255, b);
      }
    }
    g.putImageData(img, 0, 0);
    if (stars) {
      for (let i = 0; i < 1800; i++) {
        const x = rng() * W, y = rng() * rng() * H * 0.5, s = rng() < 0.08 ? 2 : 1, a = 0.35 + rng() * 0.65;
        g.fillStyle = `rgba(${220 + rng() * 35},${220 + rng() * 35},255,${a.toFixed(2)})`; g.fillRect(x, y, s, s);
      }
    }
    if (milkyway) {
      // a dense sprinkle of faint stars along the band
      for (let i = 0; i < 5000; i++) {
        const x = rng() * W, u = x / W, c = 0.3 + 0.13 * Math.sin(u * Math.PI * 2);
        const y = (c + (rng() + rng() + rng() - 1.5) * 0.12) * H;
        if (y < 0 || y > H * 0.58) continue;
        const a = 0.3 + rng() * 0.6, warm = rng() < 0.3;
        g.fillStyle = `rgba(${warm ? 255 : 225},${warm ? 235 : 230},${warm ? 205 : 255},${a.toFixed(2)})`; g.fillRect(x, y, 1, 1);
      }
    }
    const t = tex(c); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}

/** holographic advert: glyph blocks and scanlines in one neon colour, animated by scrolling */
export function holoTexture(seed, colour) {
  return memo(`holo${seed}${colour}`, () => {
    const c = canvas(256, 128), g = c.getContext('2d'), rng = makeRng(seed);
    g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 256, 128);
    g.fillStyle = hex(colour);
    g.globalAlpha = 0.9;
    for (let i = 0; i < 18; i++) g.fillRect(rng.int(8, 200), rng.int(8, 110), rng.int(6, 50), rng.int(3, 14));
    g.globalAlpha = 0.5;
    g.font = 'bold 40px monospace'; g.fillText(String.fromCharCode(0x30A0 + rng.int(1, 90), 0x30A0 + rng.int(1, 90), 0x30A0 + rng.int(1, 90)), 20, 80);
    g.globalAlpha = 0.25;
    for (let y = 0; y < 128; y += 3) g.fillRect(0, y, 256, 1);
    g.globalAlpha = 1;
    g.strokeStyle = hex(colour); g.lineWidth = 3; g.strokeRect(2, 2, 252, 124);
    const t = tex(c); return t;
  });
}

const BRANDS = ['ZENITH', 'NEO-KYO', 'AGRAV', 'VANTA', 'PULSE', 'KESTREL', 'SYNTH', 'ORBITAL', 'HYPER', 'NOVA', 'MERIDIAN', 'TALON', 'BULWARK', 'CORSAIR', 'REAPER', 'AXIOM'];
const TAGS = ['DRINK THE FUTURE', 'FLY HIGHER', 'ZERO LATENCY', 'NEW SEASON', 'ANTI-GRAV RACING', 'LIVE TONIGHT', 'UPGRADE YOURSELF', 'NO LIMITS', 'BUY NOW', 'SLEEP LESS'];
const kanji = (rng, n) => { let t = ''; for (let i = 0; i < n; i++) t += String.fromCharCode(0x4e00 + rng.int(0, 2000)); return t; };

/**
 * A wall-screen advert, 512 × 256. Styles: 0 brand wordmark, 1 product with a
 * logo disc, 2 glyph wall, 3 the watching eye, 4 ticker (scrolls via offset),
 * 5 racing promo with a craft silhouette.
 */
export function adTexture(seed, colour, style = seed % 6) {
  return memo(`ad${seed}${colour}${style}`, () => {
    const W = 512, H = 256;
    const c = canvas(W, H), g = c.getContext('2d'), rng = makeRng(seed * 7 + 1);
    const col = hex(colour), alt = hex([0xff2d95, 0x2df1ff, 0xffe14d, 0x9d4dff, 0x4dff88, 0xff7a2d][rng.int(0, 5)]);
    const brand = rng.pick(BRANDS), tag = rng.pick(TAGS);
    if (style === 0) {
      g.fillStyle = '#07080f'; g.fillRect(0, 0, W, H);
      g.fillStyle = col; g.fillRect(0, 0, W, 10); g.fillRect(0, H - 10, W, 10);
      g.font = 'bold 84px sans-serif'; g.textAlign = 'center'; g.fillStyle = col; g.fillText(brand, W / 2, 120);
      g.font = '28px sans-serif'; g.fillStyle = '#e8e8f0'; g.fillText(tag, W / 2, 170);
      g.font = '30px sans-serif'; g.fillStyle = alt; g.fillText(kanji(rng, 6), W / 2, 220);
    } else if (style === 1) {
      const grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, col); grad.addColorStop(1, alt);
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(24, 24, W - 48, H - 48);
      g.beginPath(); g.arc(120, 128, 70, 0, 6.29); g.fillStyle = col; g.fill();
      g.beginPath(); g.arc(120, 128, 40, 0, 6.29); g.fillStyle = '#07080f'; g.fill();
      g.font = 'bold 60px sans-serif'; g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.fillText(brand, 220, 118);
      g.font = '26px sans-serif'; g.fillStyle = alt; g.fillText(tag, 222, 165);
    } else if (style === 2) {
      g.fillStyle = '#05060c'; g.fillRect(0, 0, W, H);
      g.font = 'bold 44px sans-serif'; g.textAlign = 'left';
      for (let y = 0; y < 6; y++) for (let x = 0; x < 11; x++) { if (rng() < 0.35) continue; g.fillStyle = rng() < 0.7 ? col : alt; g.globalAlpha = 0.5 + rng() * 0.5; g.fillText(kanji(rng, 1), 8 + x * 46, 44 + y * 42); }
      g.globalAlpha = 1;
    } else if (style === 3) {
      g.fillStyle = '#0a0410'; g.fillRect(0, 0, W, H);
      g.save(); g.translate(W / 2, H / 2); g.scale(1, 0.55);
      g.beginPath(); g.arc(0, 0, 200, 0, 6.29); g.fillStyle = '#f4f0ff'; g.fill();
      g.restore();
      g.beginPath(); g.arc(W / 2, H / 2, 78, 0, 6.29); g.fillStyle = col; g.fill();
      g.beginPath(); g.arc(W / 2, H / 2, 34, 0, 6.29); g.fillStyle = '#05050a'; g.fill();
      g.beginPath(); g.arc(W / 2 - 22, H / 2 - 24, 12, 0, 6.29); g.fillStyle = '#ffffff'; g.fill();
      g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.fillStyle = alt; g.fillText(`${brand} SEES YOU`, W / 2, H - 22);
    } else if (style === 4) {
      g.fillStyle = '#0b0c14'; g.fillRect(0, 0, W, H);
      g.font = 'bold 120px monospace'; g.textAlign = 'left'; g.fillStyle = col;
      const line = `${brand} ▲${rng.int(1, 99)}.${rng.int(0, 9)}  ${tag}  ${kanji(rng, 3)}  `;
      g.fillText(line, 0, 165);
      g.fillStyle = alt; g.fillRect(0, 200, W, 4);
    } else {
      g.fillStyle = '#060a14'; g.fillRect(0, 0, W, H);
      const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(1, col);
      g.fillStyle = grad; g.globalAlpha = 0.5; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
      // a craft silhouette in profile
      g.fillStyle = alt; g.beginPath(); g.moveTo(60, 150); g.lineTo(200, 110); g.lineTo(420, 120); g.lineTo(470, 145); g.lineTo(420, 168); g.lineTo(90, 175); g.closePath(); g.fill();
      g.fillStyle = '#ffffff'; g.fillRect(120, 118, 90, 12);
      g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#ffffff'; g.fillText('ANTI-GRAV LEAGUE', W / 2, 60);
      g.font = '26px sans-serif'; g.fillStyle = col; g.fillText(`${brand} · ${tag}`, W / 2, 225);
    }
    // scanlines
    g.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    const t = tex(c); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}

const TAGLINES = {
  umbrella: ['OUR BUSINESS IS LIFE ITSELF', 'PRESERVING THE FUTURE'], zenith: ['BURN BRIGHTER', 'RACE-GRADE. STREET-LEGAL.'], neokyo: ['MOTION, PERFECTED'],
  axiom: ['SEE THE APEX FIRST'], pulse: ['DRINK THE FUTURE', 'ZERO LATENCY'], vanta: ['NOTHING ESCAPES'], orbital: ['ANYWHERE. BY MORNING.'],
  hypercell: ['CHARGE AHEAD'], synth: ['HEAR THE SPEED'], nova: ['STAY COOL AT 300']
};
/** a sponsor's display advert, 512 × 256: mark and wordmark on a brand field with a tagline */
export function sponsorAdTexture(id, variant = 0) {
  return memo(`spad${id}${variant}`, () => {
    const W = 512, H = 256;
    const c = canvas(W, H), g = c.getContext('2d'), sp = SPONSORS[id], rng = makeRng(id.length * 31 + variant);
    const tags = TAGLINES[id] || ['']; const tag = tags[variant % tags.length];
    if (variant % 2 === 0) { g.fillStyle = '#0a0c14'; g.fillRect(0, 0, W, H); }
    else { const grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, '#1a1e2c'); grad.addColorStop(1, '#0a0c14'); g.fillStyle = grad; g.fillRect(0, 0, W, H); }
    if (id === 'umbrella') { g.fillStyle = '#d0141b'; g.fillRect(0, 0, W, 14); g.fillRect(0, H - 14, W, 14); }
    g.save(); g.translate(W / 2, H * 0.4); sp.logo(g, W * 0.86, H * 0.42); g.restore();
    g.fillStyle = '#e8e8f0'; g.font = `${H * 0.11}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(tag, W / 2, H * 0.8);
    g.fillStyle = 'rgba(0,0,0,0.15)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    void rng;
    const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}
export const SPONSOR_IDS = Object.keys(SPONSORS);

/** a tall vertical neon sign: a column of glyphs in one colour, 64 × 384 */
export function neonSignTexture(seed, colour) {
  return memo(`nsign${seed}${colour}`, () => {
    const c = canvas(64, 384), g = c.getContext('2d'), rng = makeRng(seed * 13 + 5);
    g.fillStyle = '#05060a'; g.fillRect(0, 0, 64, 384);
    g.strokeStyle = hex(colour); g.lineWidth = 3; g.strokeRect(4, 4, 56, 376);
    g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.fillStyle = hex(colour);
    for (let i = 0; i < 8; i++) g.fillText(kanji(rng, 1), 32, 48 + i * 44);
    const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}

/** soft round sprite for glows */
export function glowSprite() {
  return memo('glow', () => {
    const c = canvas(64, 64), g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.3, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}
