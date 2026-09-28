// ============================================================================
// Spacewar renderer: one 2D canvas, the arena scaled to fit and letterboxed.
//
// Everything that does not move is painted once per resize into offscreen
// canvases at the exact device resolution — the nebula and starfield, the
// planet's shading, each hull and its glow — so a frame is mostly drawImage.
// The arena wraps, so anything near an edge is drawn again at its wrapped
// images, clipped to the arena: a ship slides out of one side and into the
// other in one piece.
//
// Effects (exhaust, explosions, hyperspace, torpedo trails, screen shake) live
// here and are purely cosmetic; the simulation never sees them.
// ============================================================================

import {
  FIELD_W, FIELD_H, CX, CY, SHIPS, PLANET_R, SHIP_R, FUEL_MAX, HYPER_COOLDOWN, HYPER_TICKS,
} from '../../shared/spacewar/constants.js';
import { makeRng } from '../../shared/sim/rng.js';

const TAU = Math.PI * 2;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function mix(hex, other, t) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(other.slice(1), 16);
  const ch = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}

// ------------------------------------------------------------------ hulls --
// Each hull points along +x, about 36 px nose to tail, drawn in arena units.
// `engines` are where the flames come out.

const HULLS = [
  { // Needle: a long, slender dart with swept tail fins
    engines: [[-16, 0]],
    body(g) {
      g.moveTo(19, 0); g.lineTo(7, -3.2); g.lineTo(-10, -3.8); g.lineTo(-15, -2.6);
      g.lineTo(-15, 2.6); g.lineTo(-10, 3.8); g.lineTo(7, 3.2); g.closePath();
    },
    wings(g) {
      g.moveTo(-3, -3.4); g.lineTo(-13, -12); g.lineTo(-16.5, -11.5); g.lineTo(-12, -3.4); g.closePath();
      g.moveTo(-3, 3.4); g.lineTo(-13, 12); g.lineTo(-16.5, 11.5); g.lineTo(-12, 3.4); g.closePath();
      g.moveTo(9, -2.6); g.lineTo(3, -6.5); g.lineTo(1, -6.5); g.lineTo(3, -3); g.closePath();
      g.moveTo(9, 2.6); g.lineTo(3, 6.5); g.lineTo(1, 6.5); g.lineTo(3, 3); g.closePath();
    },
    stripes(g) { g.rect(-9, -3.9, 3, 7.8); },
    canopy: [5, 0, 4.2, 1.8],
  },
  { // Wedge: a broad arrowhead with a notched tail and twin engines
    engines: [[-15, -3], [-15, 3]],
    body(g) {
      g.moveTo(18, 0); g.lineTo(-10, -13); g.lineTo(-7, -6); g.lineTo(-14, -5.5);
      g.lineTo(-14, 5.5); g.lineTo(-7, 6); g.lineTo(-10, 13); g.closePath();
    },
    wings(g) {
      g.moveTo(-10, -13); g.lineTo(-14.5, -14); g.lineTo(-12, -8.5); g.closePath();
      g.moveTo(-10, 13); g.lineTo(-14.5, 14); g.lineTo(-12, 8.5); g.closePath();
    },
    stripes(g) { g.moveTo(10, -1.2); g.lineTo(-6, -8.6); g.lineTo(-5, -6.4); g.lineTo(8, -0.4); g.closePath();
      g.moveTo(10, 1.2); g.lineTo(-6, 8.6); g.lineTo(-5, 6.4); g.lineTo(8, 0.4); g.closePath(); },
    canopy: [2, 0, 4.5, 2.2],
  },
  { // Hornet: a round-bellied fuselage, forward-swept wings, a striped tail
    engines: [[-15, 0]],
    body(g) { g.ellipse(1, 0, 15, 5.4, 0, 0, TAU); },
    wings(g) {
      g.moveTo(-7, -4.5); g.lineTo(5, -13.5); g.lineTo(1.5, -15); g.lineTo(-12, -6); g.closePath();
      g.moveTo(-7, 4.5); g.lineTo(5, 13.5); g.lineTo(1.5, 15); g.lineTo(-12, 6); g.closePath();
      g.moveTo(-10, -2); g.lineTo(-17, -6); g.lineTo(-16, -2); g.closePath();
      g.moveTo(-10, 2); g.lineTo(-17, 6); g.lineTo(-16, 2); g.closePath();
    },
    stripes(g) { g.rect(-11, -5, 2.2, 10); g.rect(-6.5, -5.6, 2.2, 11.2); },
    canopy: [7, 0, 4.6, 2.4],
  },
  { // Manta: one sweeping flying wing with engines out on the wings
    engines: [[-13, -7], [-13, 7]],
    body(g) {
      g.moveTo(16, 0);
      g.quadraticCurveTo(6, -4, -2, -16); g.quadraticCurveTo(-7, -17, -9, -12);
      g.quadraticCurveTo(-11, -5, -15, -3); g.lineTo(-12, 0); g.lineTo(-15, 3);
      g.quadraticCurveTo(-11, 5, -9, 12); g.quadraticCurveTo(-7, 17, -2, 16);
      g.quadraticCurveTo(6, 4, 16, 0); g.closePath();
    },
    wings(g) { g.rect(-13, -9, 6, 4); g.rect(-13, 5, 6, 4); },
    stripes(g) { g.moveTo(-2, -14); g.quadraticCurveTo(2, -6, 11, -1.5); g.lineTo(9, -1);
      g.quadraticCurveTo(0, -6, -4, -13); g.closePath();
      g.moveTo(-2, 14); g.quadraticCurveTo(2, 6, 11, 1.5); g.lineTo(9, 1);
      g.quadraticCurveTo(0, 6, -4, 13); g.closePath(); },
    canopy: [4, 0, 4.4, 2.4],
  },
];

const SPRITE = 64;   // hull units square, room for the glow
const HULL_SCALE = 1.35;   // hull units -> arena units: a hull is ~48 px nose to tail

function paintHull(g, hull, color) {
  const metal = g.createLinearGradient(0, -16, 0, 16);
  metal.addColorStop(0, mix(color, '#f4f7ff', 0.82));
  metal.addColorStop(0.35, mix(color, '#98a6c4', 0.72));
  metal.addColorStop(0.7, mix(color, '#343d55', 0.75));
  metal.addColorStop(1, '#131826');
  const accent = g.createLinearGradient(0, -16, 0, 16);
  accent.addColorStop(0, mix(color, '#ffffff', 0.45));
  accent.addColorStop(0.5, color);
  accent.addColorStop(1, mix(color, '#000000', 0.55));

  g.lineJoin = 'round';
  // wings and fins: coloured
  g.beginPath(); hull.wings(g);
  g.fillStyle = accent; g.fill();
  g.strokeStyle = rgba('#000000', 0.45); g.lineWidth = 0.6; g.stroke();
  // hull: brushed metal
  g.beginPath(); hull.body(g);
  g.fillStyle = metal; g.fill();
  g.save(); g.clip();
  g.beginPath(); hull.stripes(g); g.fillStyle = accent; g.fill();
  // a soft specular sweep along the spine
  const spec = g.createLinearGradient(0, -6, 0, 2);
  spec.addColorStop(0, 'rgba(255,255,255,0)');
  spec.addColorStop(0.5, 'rgba(255,255,255,0.28)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spec; g.fillRect(-20, -6, 40, 8);
  g.restore();
  g.beginPath(); hull.body(g);
  g.strokeStyle = mix(color, '#ffffff', 0.3); g.lineWidth = 0.9; g.stroke();
  // engine nozzles
  for (const [ex, ey] of hull.engines) {
    g.beginPath(); g.ellipse(ex + 1.2, ey, 1.4, 2.2, 0, 0, TAU);
    g.fillStyle = '#10131c'; g.fill();
    g.strokeStyle = '#6b7690'; g.lineWidth = 0.6; g.stroke();
  }
  // canopy: dark glass with a highlight
  const [cx, cy, rx, ry] = hull.canopy;
  const glass = g.createRadialGradient(cx + rx * 0.3, cy - ry * 0.5, 0.2, cx, cy, rx);
  glass.addColorStop(0, '#ffffff');
  glass.addColorStop(0.25, mix(color, '#ffffff', 0.5));
  glass.addColorStop(0.6, mix(color, '#061020', 0.6));
  glass.addColorStop(1, '#040810');
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  g.fillStyle = glass; g.fill();
  g.strokeStyle = rgba('#000000', 0.6); g.lineWidth = 0.5; g.stroke();
}

function hullSprite(hull, color, s) {
  const c = canvas(SPRITE * HULL_SCALE * s, SPRITE * HULL_SCALE * s);
  const g = c.getContext('2d');
  g.scale(s * HULL_SCALE, s * HULL_SCALE); g.translate(SPRITE / 2, SPRITE / 2);
  paintHull(g, hull, color);
  return c;
}

function glowSprite(hull, color, s) {
  const c = canvas(SPRITE * HULL_SCALE * s, SPRITE * HULL_SCALE * s);
  const g = c.getContext('2d');
  g.scale(s * HULL_SCALE, s * HULL_SCALE); g.translate(SPRITE / 2, SPRITE / 2);
  g.shadowColor = color; g.shadowBlur = 9 * s;
  g.fillStyle = rgba(color, 0.55);
  g.beginPath(); hull.body(g); hull.wings(g); g.fill();
  g.fill();
  return c;
}

/** a soft round dot, for additive particles and torpedo glows */
function dotSprite(color, s, size = 32) {
  const c = canvas(size * s, size * s);
  const g = c.getContext('2d');
  const r = (size * s) / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, rgba(color, 1));
  grad.addColorStop(0.2, rgba(color, 0.55));
  grad.addColorStop(0.5, rgba(color, 0.16));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad; g.fillRect(0, 0, size * s, size * s);
  return c;
}

// ------------------------------------------------------------- renderer --

export class Renderer {
  constructor(el) {
    this.el = el;
    this.g = el.getContext('2d');
    this.particles = [];
    this.debris = [];
    this.rings = [];
    this.flashes = [];
    this.later = [];         // effects scheduled for a moment from now
    this.trails = new Map(); // torpedo id -> recent points
    this.shake = 0;
    this.time = 0;
    this.sprites = null;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    this.el.width = Math.round(w * dpr);
    this.el.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.scale = Math.min(w / FIELD_W, h / FIELD_H);
    this.ox = (w - FIELD_W * this.scale) / 2;
    this.oy = (h - FIELD_H * this.scale) / 2;
    const s = this.scale * dpr;
    if (this.sprites && Math.abs(this.sprites.s - s) < 0.01) return;
    this.sprites = {
      s,
      hulls: SHIPS.map((sh, i) => hullSprite(HULLS[i], sh.color, s)),
      glows: SHIPS.map((sh, i) => glowSprite(HULLS[i], sh.glow, s)),
      dots: SHIPS.map((sh) => dotSprite(sh.color, s)),
      white: dotSprite('#ffffff', s),
      fire: dotSprite('#ffa040', s),
      blue: dotSprite('#8fb4ff', s),
    };
    this.bg = this._paintBackground(s);
    this.planet = this._paintPlanet(s);
  }

  // ------------------------------------------------------ static layers --

  _paintBackground(s) {
    const c = canvas(FIELD_W * s, FIELD_H * s);
    const g = c.getContext('2d');
    g.scale(s, s);
    const base = g.createRadialGradient(CX, CY, 50, CX, CY, FIELD_W * 0.7);
    base.addColorStop(0, '#0b1026');
    base.addColorStop(0.6, '#060917');
    base.addColorStop(1, '#020309');
    g.fillStyle = base; g.fillRect(0, 0, FIELD_W, FIELD_H);

    const rng = makeRng(0x5bace);
    // nebula: soft clouds strung along a few lazy filaments
    g.globalCompositeOperation = 'lighter';
    const tints = ['#5b2da8', '#1d6f9a', '#a3286f', '#2a3fb0'];
    for (let f = 0; f < 5; f++) {
      let x = rng() * FIELD_W, y = rng() * FIELD_H, dir = rng() * TAU;
      const tint = tints[f % tints.length];
      for (let i = 0; i < 26; i++) {
        const r = 60 + rng() * 170;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, rgba(tint, 0.05 + rng() * 0.035));
        grad.addColorStop(1, rgba(tint, 0));
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
        dir += (rng() - 0.5) * 0.8;
        x += Math.cos(dir) * 45; y += Math.sin(dir) * 45;
      }
    }
    g.globalCompositeOperation = 'source-over';
    // stars: many faint, some brighter, a few with a glint
    const starTints = ['#ffffff', '#cfe0ff', '#fff1d6', '#d6e8ff', '#ffe3ea'];
    for (let i = 0; i < 1100; i++) {
      const x = rng() * FIELD_W, y = rng() * FIELD_H;
      const r = 0.35 + rng() ** 3 * 0.9;
      g.globalAlpha = 0.12 + rng() * 0.4;
      g.fillStyle = starTints[Math.floor(rng() * starTints.length)];
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    for (let i = 0; i < 14; i++) {
      const x = rng() * FIELD_W, y = rng() * FIELD_H;
      const len = 5 + rng() * 7;
      g.globalAlpha = 0.35 + rng() * 0.3;
      const grad = g.createRadialGradient(x, y, 0, x, y, len);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(160,190,255,0)');
      g.fillStyle = grad;
      g.fillRect(x - len, y - 0.45, len * 2, 0.9);
      g.fillRect(x - 0.45, y - len, 0.9, len * 2);
      g.beginPath(); g.arc(x, y, 1.1, 0, TAU); g.fillStyle = '#fff'; g.fill();
    }
    g.globalAlpha = 1;
    // vignette
    const v = g.createRadialGradient(CX, CY, FIELD_H * 0.45, CX, CY, FIELD_W * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = v; g.fillRect(0, 0, FIELD_W, FIELD_H);

    // the twinkling few are drawn live, over the top
    this.twinkles = [];
    for (let i = 0; i < 70; i++) {
      this.twinkles.push({ x: rng() * FIELD_W, y: rng() * FIELD_H, r: 0.6 + rng() * 0.8, f: 0.4 + rng() * 1.6, p: rng() * TAU, a: 0.25 + rng() * 0.45 });
    }
    return c;
  }

  _paintPlanet(s) {
    const R = PLANET_R;
    // atmosphere halo
    const H = R * 4.2;
    const halo = canvas(H * 2 * s, H * 2 * s);
    let g = halo.getContext('2d');
    g.scale(s, s);
    let grad = g.createRadialGradient(H, H, R * 0.9, H, H, H);
    grad.addColorStop(0, 'rgba(120,170,255,0.45)');
    grad.addColorStop(0.12, 'rgba(110,120,255,0.18)');
    grad.addColorStop(0.4, 'rgba(120,70,220,0.06)');
    grad.addColorStop(1, 'rgba(80,40,160,0)');
    g.fillStyle = grad; g.fillRect(0, 0, H * 2, H * 2);

    // cloud bands: a strip twice the planet's width, scrolled under a circular clip
    const bw = R * 4, bh = R * 2;
    const bands = canvas(bw * s, bh * s);
    g = bands.getContext('2d');
    g.scale(s, s);
    const body = g.createLinearGradient(0, 0, 0, bh);
    body.addColorStop(0, '#7a8cff'); body.addColorStop(0.3, '#5a4fd6');
    body.addColorStop(0.55, '#8a5ad8'); body.addColorStop(0.8, '#3d3aa8'); body.addColorStop(1, '#2a2a88');
    g.fillStyle = body; g.fillRect(0, 0, bw, bh);
    const rng = makeRng(0xb1a7e7);
    for (let i = 0; i < 22; i++) {
      const y = rng() * bh, th = 1 + rng() * 5;
      const light = rng() < 0.5;
      g.fillStyle = light ? `rgba(200,210,255,${0.08 + rng() * 0.16})` : `rgba(20,10,60,${0.1 + rng() * 0.18})`;
      g.beginPath();
      // periodic over bw/2 so the strip tiles as it scrolls
      const k = TAU / (bw / 2), amp = 0.6 + rng() * 1.8, ph = rng() * TAU;
      g.moveTo(0, y);
      for (let x = 0; x <= bw; x += 4) g.lineTo(x, y + Math.sin(x * k * 2 + ph) * amp);
      for (let x = bw; x >= 0; x -= 4) g.lineTo(x, y + th + Math.sin(x * k * 2 + ph + 1) * amp);
      g.closePath(); g.fill();
    }
    // a storm
    grad = g.createRadialGradient(R * 1.3, R * 1.3, 0, R * 1.3, R * 1.3, 6);
    grad.addColorStop(0, 'rgba(255,220,255,0.5)'); grad.addColorStop(1, 'rgba(255,220,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, bw, bh);
    g.fillStyle = grad; g.save(); g.translate(bw / 2, 0); g.fillRect(0, 0, bw / 2, bh); g.restore();

    // shading: lit from the upper left, a rim of atmosphere on the edge
    const shade = canvas(R * 2 * s + 4, R * 2 * s + 4);
    g = shade.getContext('2d');
    g.scale(s, s); g.translate(R + 2 / s, R + 2 / s);
    grad = g.createRadialGradient(-R * 0.45, -R * 0.45, R * 0.1, 0, 0, R * 1.05);
    grad.addColorStop(0, 'rgba(255,255,255,0.28)');
    grad.addColorStop(0.35, 'rgba(0,0,0,0)');
    grad.addColorStop(0.8, 'rgba(4,2,20,0.55)');
    grad.addColorStop(1, 'rgba(2,0,10,0.9)');
    g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fillStyle = grad; g.fill();
    grad = g.createRadialGradient(0, 0, R * 0.82, 0, 0, R);
    grad.addColorStop(0, 'rgba(150,190,255,0)');
    grad.addColorStop(1, 'rgba(170,210,255,0.55)');
    g.fillStyle = grad; g.fill();
    return { halo, H, bands, bw, bh, shade };
  }

  // ------------------------------------------------------------- effects --

  explode(x, y, vx, vy, id) {
    const color = SHIPS[id]?.color || '#ffffff';
    const rng = Math.random;
    for (let i = 0; i < 70; i++) {
      const a = rng() * TAU, sp = 40 + rng() ** 2 * 380;
      this.particles.push({ x, y, vx: vx * 0.5 + Math.cos(a) * sp, vy: vy * 0.5 + Math.sin(a) * sp,
        life: 0, max: 0.5 + rng() * 0.9, size: 6 + rng() * 10, sprite: rng() < 0.45 ? 'fire' : rng() < 0.5 ? id : 'white', drag: 1.6 });
    }
    for (let i = 0; i < 14; i++) {
      const a = rng() * TAU, sp = 30 + rng() * 150;
      this.debris.push({ x, y, vx: vx * 0.6 + Math.cos(a) * sp, vy: vy * 0.6 + Math.sin(a) * sp,
        a: rng() * TAU, va: (rng() - 0.5) * 12, life: 0, max: 1.2 + rng() * 1.4, size: 2 + rng() * 4, color });
    }
    this.rings.push({ x, y, life: 0, max: 0.7, r0: 8, r1: 110, color, width: 2 });
    this.rings.push({ x, y, life: 0, max: 1.1, r0: 4, r1: 60, color: '#ffffff', width: 1.5 });
    this.flashes.push({ x, y, life: 0, max: 0.35, r: 90 });
    this.shake = Math.min(14, this.shake + 9);
  }

  hyperOut(x, y, id) {
    const color = SHIPS[id]?.color || '#ffffff';
    this.rings.push({ x, y, life: 0, max: 0.45, r0: 46, r1: 2, color, width: 2 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * TAU, d = 20 + Math.random() * 30;
      // particles drawn in from a ring, meeting at the centre
      this.particles.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: -Math.cos(a) * d * 2.4, vy: -Math.sin(a) * d * 2.4,
        life: 0, max: 0.42, size: 5, sprite: id, drag: 0 });
    }
    this.flashes.push({ x, y, life: 0, max: 0.25, r: 40 });
  }

  hyperIn(x, y, id) {
    const color = SHIPS[id]?.color || '#ffffff';
    this.later.push({ at: this.time + HYPER_TICKS / 60, run: () => {
      this.rings.push({ x, y, life: 0, max: 0.5, r0: 2, r1: 56, color, width: 2.5 });
      this.flashes.push({ x, y, life: 0, max: 0.3, r: 50 });
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * TAU, sp = 60 + Math.random() * 160;
        this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.5, size: 5, sprite: id, drag: 2 });
      }
    } });
  }

  _emitExhaust(ship, dt) {
    const hull = HULLS[ship.id];
    const c = Math.cos(ship.a), s = Math.sin(ship.a);
    const n = Math.random() < dt * 90 ? 1 : 0;
    for (let [ex, ey] of hull.engines) {
      ex *= HULL_SCALE; ey *= HULL_SCALE;
      for (let i = 0; i <= n; i++) {
        const px = ship.x + c * ex - s * ey, py = ship.y + s * ex + c * ey;
        const sp = 120 + Math.random() * 120, j = (Math.random() - 0.5) * 0.5;
        this.particles.push({ x: px, y: py, vx: ship.vx - Math.cos(ship.a + j) * sp, vy: ship.vy - Math.sin(ship.a + j) * sp,
          life: 0, max: 0.25 + Math.random() * 0.25, size: 5 + Math.random() * 4, sprite: Math.random() < 0.5 ? 'fire' : ship.id, drag: 2.5 });
      }
    }
  }

  _stepEffects(dt) {
    for (let i = this.later.length - 1; i >= 0; i--) if (this.time >= this.later[i].at) { this.later[i].run(); this.later.splice(i, 1); }
    const move = (p) => {
      p.life += dt;
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
      p.x = ((p.x + p.vx * dt) % FIELD_W + FIELD_W) % FIELD_W;
      p.y = ((p.y + p.vy * dt) % FIELD_H + FIELD_H) % FIELD_H;
      if (p.va) p.a += p.va * dt;
      return p.life < p.max;
    };
    this.particles = this.particles.filter(move);
    if (this.particles.length > 2500) this.particles.splice(0, this.particles.length - 2500);
    this.debris = this.debris.filter(move);
    const age = (e) => (e.life += dt) < e.max;
    this.rings = this.rings.filter(age);
    this.flashes = this.flashes.filter(age);
    this.shake *= Math.exp(-dt * 6);
  }

  /** forget every effect (a new match) */
  clear() {
    this.particles = []; this.debris = []; this.rings = []; this.flashes = []; this.later = [];
    this.trails.clear(); this.shake = 0;
  }

  // ---------------------------------------------------------------- draw --

  /** call fn(x, y) for each wrapped image of a point within `m` of the arena */
  _images(x, y, m, fn) {
    fn(x, y);
    const wx = x < m ? FIELD_W : x > FIELD_W - m ? -FIELD_W : 0;
    const wy = y < m ? FIELD_H : y > FIELD_H - m ? -FIELD_H : 0;
    if (wx) fn(x + wx, y);
    if (wy) fn(x, y + wy);
    if (wx && wy) fn(x + wx, y + wy);
  }

  /**
   * @param view  Client.viewState() or null (menus: just the sky)
   * @param info  {me, names, dt, phaseText}
   */
  draw(view, info = {}) {
    const dt = Math.min(0.05, info.dt || 0.016);
    this.time += dt;
    const g = this.g;
    const { dpr, scale } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#010207';
    g.fillRect(0, 0, this.el.width, this.el.height);

    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (this.ox + sx * scale), dpr * (this.oy + sy * scale));
    g.drawImage(this.bg, 0, 0, FIELD_W, FIELD_H);
    g.save();
    g.beginPath(); g.rect(0, 0, FIELD_W, FIELD_H); g.clip();

    // twinkles
    for (const t of this.twinkles) {
      const a = t.a * (0.5 + 0.5 * Math.sin(this.time * t.f * 2 + t.p));
      g.globalAlpha = a; g.fillStyle = '#e8f0ff';
      g.fillRect(t.x - t.r / 2, t.y - t.r / 2, t.r, t.r);
    }
    g.globalAlpha = 1;

    const planet = view ? view.opts.planet : true;
    if (planet) this._drawPlanet(g);

    if (view) {
      this._stepEffects(dt);
      for (const s of view.ships) if (s && s.alive && !s.hyper && s.thrust) this._emitExhaust(s, dt);
      this._drawTorps(g, view.torps);
      this._drawParticles(g, false);
      for (const s of view.ships) if (s && s.alive && !s.hyper) this._drawShip(g, s, view);
      this._drawParticles(g, true);
      this._drawRings(g);
    }
    g.restore();

    // the arena's edge: faint, so the wrap reads as a boundary you pass through
    g.strokeStyle = 'rgba(120,150,255,0.14)'; g.lineWidth = 1.5;
    g.strokeRect(0, 0, FIELD_W, FIELD_H);

    if (view && !view.demo) {
      this._drawLabels(g, view, info);
      this._drawHud(g, view, info);
      this._drawCenter(g, view, info);
    }
  }

  _drawPlanet(g) {
    const P = this.planet, R = PLANET_R;
    // gravity: slow ripples drawn in toward the planet
    g.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      const k = ((this.time * 0.22 + i / 3) % 1);
      const r = R + (1 - k) * 230;
      g.strokeStyle = `rgba(140,150,255,${0.07 * Math.sin(k * Math.PI)})`;
      g.beginPath(); g.arc(CX, CY, r, 0, TAU); g.stroke();
    }
    g.globalCompositeOperation = 'lighter';
    const pulse = 1 + Math.sin(this.time * 1.3) * 0.03;
    g.drawImage(P.halo, CX - P.H * pulse, CY - P.H * pulse, P.H * 2 * pulse, P.H * 2 * pulse);
    g.globalCompositeOperation = 'source-over';
    g.save();
    g.beginPath(); g.arc(CX, CY, R, 0, TAU); g.clip();
    const off = (this.time * 5) % (P.bw / 2);
    g.drawImage(P.bands, CX - R - off, CY - R, P.bw, P.bh);
    g.restore();
    g.drawImage(P.shade, CX - R - 2 / this.sprites.s, CY - R - 2 / this.sprites.s, R * 2 + 4 / this.sprites.s, R * 2 + 4 / this.sprites.s);
  }

  _drawTorps(g, torps) {
    const seen = new Set();
    g.globalCompositeOperation = 'lighter';
    for (const t of torps) {
      seen.add(t.id);
      let tr = this.trails.get(t.id);
      if (!tr) this.trails.set(t.id, (tr = []));
      const last = tr[tr.length - 1];
      if (!last || last.x !== t.x || last.y !== t.y) tr.push({ x: t.x, y: t.y });
      if (tr.length > 10) tr.shift();
      const color = SHIPS[t.owner]?.color || '#ffffff';
      g.lineCap = 'round';
      for (let i = 1; i < tr.length; i++) {
        const p = tr[i - 1], q = tr[i];
        if (Math.abs(q.x - p.x) > 200 || Math.abs(q.y - p.y) > 200) continue;   // wrapped: no streak across the arena
        g.strokeStyle = rgba(color, (i / tr.length) * 0.5);
        g.lineWidth = 1 + (i / tr.length) * 2;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
      }
      const fade = t.age > 80 ? Math.max(0.2, 1 - (t.age - 80) / 16) : 1;
      this._images(t.x, t.y, 12, (x, y) => {
        g.globalAlpha = fade;
        g.drawImage(this.sprites.dots[t.owner] || this.sprites.white, x - 11, y - 11, 22, 22);
        g.drawImage(this.sprites.white, x - 3.5, y - 3.5, 7, 7);
      });
      g.globalAlpha = 1;
    }
    for (const id of this.trails.keys()) if (!seen.has(id)) this.trails.delete(id);
    g.globalCompositeOperation = 'source-over';
  }

  _drawParticles(g, top) {
    const S = this.sprites;
    if (!top) {
      // debris: solid, tumbling, cooling from white-hot to the hull's colour
      for (const d of this.debris) {
        const k = d.life / d.max;
        g.globalAlpha = 1 - k;
        g.save(); g.translate(d.x, d.y); g.rotate(d.a);
        g.fillStyle = k < 0.15 ? '#ffffff' : d.color;
        g.beginPath(); g.moveTo(d.size, 0); g.lineTo(-d.size * 0.7, d.size * 0.6); g.lineTo(-d.size * 0.5, -d.size * 0.7); g.closePath();
        g.fill();
        g.restore();
      }
      g.globalAlpha = 1;
      return;
    }
    g.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const k = p.life / p.max;
      const img = p.sprite === 'fire' ? S.fire : p.sprite === 'white' ? S.white : S.dots[p.sprite] || S.white;
      const sz = p.size * (1 - k * 0.6);
      g.globalAlpha = (1 - k) * 0.9;
      g.drawImage(img, p.x - sz, p.y - sz, sz * 2, sz * 2);
    }
    for (const f of this.flashes) {
      const k = f.life / f.max;
      g.globalAlpha = (1 - k) * 0.9;
      const r = f.r * (0.5 + k * 0.8);
      g.drawImage(S.white, f.x - r, f.y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  _drawRings(g) {
    g.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      const k = r.life / r.max;
      const e = 1 - (1 - k) ** 3;
      g.strokeStyle = rgba(r.color, (1 - k) * 0.6);
      g.lineWidth = r.width * (1 - k * 0.5);
      g.beginPath(); g.arc(r.x, r.y, Math.max(0.5, r.r0 + (r.r1 - r.r0) * e), 0, TAU); g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  }

  _drawShip(g, s, view) {
    const S = this.sprites, hull = HULLS[s.id];
    const size = SPRITE * HULL_SCALE, half = size / 2;
    const flicker = 0.75 + Math.random() * 0.5;
    this._images(s.x, s.y, half, (x, y) => {
      g.save();
      g.translate(x, y); g.rotate(s.a);
      if (s.thrust) {
        g.save(); g.scale(HULL_SCALE, HULL_SCALE);
        g.globalCompositeOperation = 'lighter';
        for (const [ex, ey] of hull.engines) {
          const len = 16 * flicker;
          const grad = g.createLinearGradient(ex, 0, ex - len, 0);
          grad.addColorStop(0, 'rgba(255,255,255,0.95)');
          grad.addColorStop(0.25, rgba(SHIPS[s.id].color, 0.8));
          grad.addColorStop(1, rgba(SHIPS[s.id].glow, 0));
          g.fillStyle = grad;
          g.beginPath();
          g.moveTo(ex, ey - 2.4); g.quadraticCurveTo(ex - len * 0.5, ey - 2.8, ex - len, ey);
          g.quadraticCurveTo(ex - len * 0.5, ey + 2.8, ex, ey + 2.4); g.closePath(); g.fill();
        }
        g.restore();
      }
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.8 + Math.sin(this.time * 4 + s.id) * 0.15;
      g.drawImage(S.glows[s.id], -half, -half, size, size);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.drawImage(S.hulls[s.id], -half, -half, size, size);
      g.restore();
    });
    // a halo on the round's opening, so everyone finds their ship
    if (view.phase === 'intro' && !view.demo) {
      const k = (this.time * 1.5) % 1;
      g.strokeStyle = rgba(SHIPS[s.id].color, 0.6 * (1 - k));
      g.lineWidth = 2;
      g.beginPath(); g.arc(s.x, s.y, SHIP_R + 6 + k * 26, 0, TAU); g.stroke();
    }
  }

  _drawLabels(g, view, info) {
    if (view.phase !== 'intro') return;
    g.font = `600 13px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const s of view.ships) {
      if (!s || !s.alive) continue;
      const name = s.id === info.me ? 'YOU' : (info.names?.[s.id] || SHIPS[s.id].name);
      g.fillStyle = rgba(SHIPS[s.id].color, 0.95);
      g.fillText(name, s.x, s.y + SHIP_R + 16);
    }
  }

  _drawHud(g, view, info) {
    const present = view.ships.filter(Boolean);
    const W = 230, H = 58, gap = 14;
    const total = present.length * W + (present.length - 1) * gap;
    let x = CX - total / 2;
    const y = 14;
    for (const s of present) {
      const col = SHIPS[s.id].color;
      const me = s.id === info.me;
      g.globalAlpha = s.alive ? 1 : 0.45;
      roundRect(g, x, y, W, H, 10);
      g.fillStyle = 'rgba(8,12,28,0.62)'; g.fill();
      g.strokeStyle = rgba(col, me ? 0.8 : 0.3); g.lineWidth = me ? 1.6 : 1; g.stroke();
      // name
      g.fillStyle = col;
      g.beginPath(); g.arc(x + 14, y + 16, 4.5, 0, TAU); g.fill();
      g.font = `700 14px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillStyle = '#eef3ff';
      const nm = (info.names?.[s.id] || SHIPS[s.id].name) + (me ? '  (you)' : '');
      g.fillText(clip(g, s.alive ? nm : `${nm}`, W - 110), x + 25, y + 16);
      // rounds won
      const need = view.opts.roundsToWin;
      g.textAlign = 'right';
      if (need <= 7) {
        for (let i = 0; i < need; i++) {
          const px = x + W - 12 - (need - 1 - i) * 11;
          g.beginPath(); g.arc(px, y + 16, 3.8, 0, TAU);
          if (i < s.wins) { g.fillStyle = col; g.fill(); } else { g.strokeStyle = rgba(col, 0.45); g.lineWidth = 1; g.stroke(); }
        }
      } else {
        g.fillStyle = col; g.font = `700 13px ${FONT}`;
        g.fillText(`${s.wins}/${need}`, x + W - 12, y + 16);
      }
      // fuel
      const fx = x + 12, fy = y + 34, fw = 110;
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(fx, fy, fw, 5);
      const fuel = Math.max(0, s.fuel / FUEL_MAX);
      g.fillStyle = fuel < 0.2 ? '#ff6b5b' : col;
      g.fillRect(fx, fy, fw * fuel, 5);
      g.font = `600 10px ${FONT}`; g.textAlign = 'left'; g.fillStyle = 'rgba(200,210,240,0.6)';
      g.fillText('FUEL', fx, fy + 14);
      // torpedoes
      g.textAlign = 'right';
      g.fillStyle = s.torps ? '#eef3ff' : '#ff6b5b';
      g.font = `700 13px ${FONT}`;
      g.fillText(`${s.torps}`, x + W - 58, y + 38);
      g.font = `600 10px ${FONT}`; g.fillStyle = 'rgba(200,210,240,0.6)';
      g.fillText('TORP', x + W - 58, y + 50);
      // hyperspace: a ring that fills as it recharges
      const hx = x + W - 26, hy = y + 40;
      const ready = s.hyperCd === 0 && !s.hyper;
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 3;
      g.beginPath(); g.arc(hx, hy, 9, 0, TAU); g.stroke();
      const k = s.hyper ? 0 : 1 - s.hyperCd / HYPER_COOLDOWN;
      g.strokeStyle = ready ? col : rgba(col, 0.55);
      g.beginPath(); g.arc(hx, hy, 9, -Math.PI / 2, -Math.PI / 2 + TAU * k); g.stroke();
      g.fillStyle = ready ? col : 'rgba(200,210,240,0.4)';
      g.beginPath(); g.moveTo(hx, hy - 4); g.lineTo(hx + 4, hy); g.lineTo(hx, hy + 4); g.lineTo(hx - 4, hy); g.closePath(); g.fill();
      if (!s.alive) {
        g.globalAlpha = 1;
        g.fillStyle = 'rgba(255,110,110,0.9)'; g.font = `800 11px ${FONT}`; g.textAlign = 'right';
        g.fillText('DESTROYED', x + W - 58 - 30, y + 38);
      }
      g.globalAlpha = 1;
      x += W + gap;
    }
    if (info.phaseText) {
      g.font = `600 13px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(200,210,240,0.7)';
      g.fillText(info.phaseText, CX, y + H + 18);
    }
  }

  _drawCenter(g, view, info) {
    let title = null, sub = null, color = '#eef3ff';
    if (view.phase === 'intro') {
      title = `ROUND ${view.round}`;
      sub = view.timer > 60 ? 'GET READY' : 'STAND BY';
    } else if (view.phase === 'outro' || view.phase === 'over') {
      const w = view.roundWinner;
      if (w >= 0) {
        color = SHIPS[w].color;
        const nm = w === info.me ? 'YOU' : (info.names?.[w] || SHIPS[w].name);
        title = view.winner >= 0 ? `${nm.toUpperCase()} ${w === info.me ? 'WIN' : 'WINS'} THE MATCH` : `${nm.toUpperCase()} ${w === info.me ? 'TAKE' : 'TAKES'} THE ROUND`;
      } else title = 'DRAW';
      sub = view.winner >= 0 ? '' : 'next round…';
    } else if (info.go > 0) {
      title = 'GO!';
      g.globalAlpha = Math.min(1, info.go * 2);
    }
    if (!title) return;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 54px ${FONT}`;
    g.shadowColor = rgba(color, 0.8); g.shadowBlur = 24;
    g.fillStyle = color;
    const ty = view.opts.planet ? CY - 150 : CY - 20;
    g.fillText(spaced(title), CX, ty);
    g.shadowBlur = 0;
    if (sub) {
      g.font = `600 16px ${FONT}`; g.fillStyle = 'rgba(210,220,250,0.75)';
      g.fillText(spaced(sub.toUpperCase()), CX, ty + 46);
    }
    g.globalAlpha = 1;
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
/** letter spacing for canvas text, which has none of its own everywhere */
function spaced(t) { return t.split('').join(' '); }
function clip(g, text, w) {
  if (g.measureText(text).width <= w) return text;
  while (text.length > 1 && g.measureText(text + '…').width > w) text = text.slice(0, -1);
  return text + '…';
}
