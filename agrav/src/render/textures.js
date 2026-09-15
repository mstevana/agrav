// ============================================================================
// AGRAV — procedural textures (canvas → three.js). No image assets anywhere.
// ============================================================================

import * as THREE from 'three';
import { makeRng } from '../../../shared/sim/rng.js';

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
export function trackSurface(base = 0x2a2f3b, seam = 0x161922) {
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
