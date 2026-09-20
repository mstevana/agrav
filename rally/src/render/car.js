// ============================================================================
// The cars.
//
// From sixty metres up a car is its outline, its roof and its lights, and very
// little else: at racing zoom the whole thing is about forty pixels long. So
// the money goes in three places.
//
//   the loft   — a body swept along stations from nose to tail, three levels
//                to a section (sill, belt line, deck or roof). Varying the
//                plan half-width gives a beetle its wings, a coupe its waist
//                and a truck its slab sides, and the silhouette is what tells
//                one car from another before anything else does.
//   the livery — one canvas painted in plan and projected straight down, so
//                what you look at most is what is drawn best: the windscreen,
//                the roof, the number, the stripes, the panel lines and the
//                rust all land where they belong. It carries a height map for
//                the grooves and rivets and a roughness map that makes glass
//                glass and rust rust.
//   the lights — headlamps, tail lamps and brake lamps are the only detail
//                that survives at any distance, so they are real meshes with
//                unlit materials rather than paint.
//
// Everything static is merged down to a handful of draw calls; the wheels, the
// lights and a minigun's barrels stay separate because they move.
// ============================================================================

import * as THREE from 'three';
import { setFromCanvases, standard } from '../../../shared/gfx/surfaces.js';
import { flatten } from '../../../shared/gfx/merge.js';
import { makeRng } from '../../../shared/sim/rng.js';
import { isLite } from './scene.js';

export const TEAM_COLOURS = [0x2fa8ff, 0xff4d3a, 0x4bd964, 0xffd23a, 0xc06bff, 0xff8a3a];

const LIVERY_SIZE = 256;
const UMARGIN = 1.10;   // the plan projection leaves a little canvas either side of the widest section

/**
 * A car's shape, nose (t = 0) to tail (t = 1).
 *
 *   plan     half-width down the length as a fraction of `wide` / 2, which is
 *            the outline you see from above and the thing that identifies the
 *            car; the numbers are read through a Catmull-Rom spline.
 *   cabin    where the greenhouse starts and ends, `screen` being how much of
 *            the length the windscreen and rear screen lie back over.
 *   ride/sill/belt/deck/roof   the heights of the section levels.
 *   smooth   false creases every panel, which is what a truck wants and a
 *            beetle does not.
 */
const SHAPES = {
  vagabond: {
    len: 3.90, wide: 1.78, ride: 0.22, sill: 0.30, belt: 0.78, deck: 0.86, roof: 1.34,
    plan: [0.30, 0.74, 0.98, 1.00, 0.99, 0.95, 0.80, 0.40],
    cabin: [0.30, 0.72], screen: 0.12, cabinW: 0.74, deckW: 0.80, smooth: true,
    wheel: { r: 0.40, w: 0.26, front: 0.20, rear: 0.80, arch: 0.10 },
    cage: true, spare: true, round: true, exhausts: 1,
    accent: 0x2a2620
  },
  mongrel: {
    len: 4.80, wide: 2.02, ride: 0.30, sill: 0.42, belt: 0.92, deck: 1.00, roof: 1.56,
    plan: [0.72, 0.92, 1.00, 1.00, 1.00, 1.00, 1.00, 0.96],
    cabin: [0.22, 0.50], screen: 0.07, cabinW: 0.90, deckW: 0.94, smooth: false,
    wheel: { r: 0.46, w: 0.30, front: 0.19, rear: 0.78, arch: 0.08 },
    bed: [0.54, 0.97], lampBar: true, doorPlate: true, spare: true, exhausts: 1,
    accent: 0x3a3630
  },
  stiletto: {
    len: 4.50, wide: 1.84, ride: 0.16, sill: 0.26, belt: 0.62, deck: 0.70, roof: 1.06,
    plan: [0.34, 0.72, 0.94, 1.00, 1.00, 0.96, 0.84, 0.52],
    cabin: [0.40, 0.76], screen: 0.14, cabinW: 0.72, deckW: 0.82, smooth: true,
    wheel: { r: 0.38, w: 0.30, front: 0.21, rear: 0.81, arch: 0.12 },
    hoop: true, vents: true, exhausts: 2, ducktail: true,
    accent: 0x17191d
  },
  warden: {
    len: 4.90, wide: 2.06, ride: 0.26, sill: 0.38, belt: 0.86, deck: 0.94, roof: 1.44,
    plan: [0.62, 0.90, 1.00, 1.00, 1.00, 0.99, 0.92, 0.70],
    cabin: [0.34, 0.70], screen: 0.08, cabinW: 0.86, deckW: 0.94, smooth: false,
    wheel: { r: 0.42, w: 0.28, front: 0.20, rear: 0.80, arch: 0.08 },
    grille: true, bullbar: true, spotlight: true, exhausts: 2,
    accent: 0x2c2f34
  },
  behemoth: {
    len: 5.60, wide: 2.38, ride: 0.40, sill: 0.56, belt: 1.20, deck: 1.30, roof: 2.10,
    plan: [0.86, 0.98, 1.00, 1.00, 1.00, 1.00, 0.98, 0.90],
    cabin: [0.10, 0.44], screen: 0.05, cabinW: 0.94, deckW: 0.96, smooth: false,
    wheel: { r: 0.58, w: 0.40, front: 0.17, rear: 0.79, arch: 0.06 },
    bed: [0.48, 0.97], blade: true, stacks: true, lampBar: true, mudflaps: true,
    accent: 0x33302b
  },
  valkyrie: {
    len: 4.70, wide: 2.00, ride: 0.16, sill: 0.26, belt: 0.66, deck: 0.74, roof: 1.12,
    plan: [0.26, 0.64, 0.92, 1.00, 1.02, 1.00, 0.88, 0.58],
    cabin: [0.36, 0.68], screen: 0.12, cabinW: 0.66, deckW: 0.78, smooth: true,
    wheel: { r: 0.40, w: 0.34, front: 0.21, rear: 0.81, arch: 0.13 },
    wing: true, pods: true, canopy: true, exhausts: 4, vents: true,
    accent: 0x141820
  }
};

export const carShape = (carId) => SHAPES[carId] || SHAPES.vagabond;

// ------------------------------------------------------------------- loft --

/** Catmull-Rom through the plan control points, clamped at both ends */
function planAt(pts, t) {
  const n = pts.length - 1;
  const x = Math.max(0, Math.min(1, t)) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const f2 = f * f, f3 = f2 * f;
  return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
}

const smooth01 = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** how much of the greenhouse is standing at t: 0 on the bonnet, 1 on the roof */
function cabinAt(s, t) {
  const [c0, c1] = s.cabin;
  return smooth01(c0 - s.screen, c0, t) * (1 - smooth01(c1, c1 + s.screen, t));
}

/** where the deck or roof actually is at a station, for bolting things to it */
export function topAt(s, t) {
  const pw = (s.wide / 2) * planAt(s.plan, t);
  const k = cabinAt(s, t);
  return {
    z: -s.len / 2 + t * s.len,
    w: pw * (s.deckW + (s.cabinW - s.deckW) * k),
    y: s.deck + (s.roof - s.deck) * k,
    belt: pw
  };
}

/**
 * The body: a closed tube of six-vertex sections. UVs are the plan projection
 * — u across the car, v along it — so the livery canvas is painted in the same
 * frame the camera looks at the car from, and the flanks get the smeared edge
 * of it, which is exactly what a flank should show.
 */
function loftBody(s, stations = 30) {
  const pos = [], uv = [], idx = [];
  const RING = 6;
  const section = (t) => {
    const z = -s.len / 2 + t * s.len;
    const pw = (s.wide / 2) * planAt(s.plan, t);
    const k = cabinAt(s, t);
    const topY = s.deck + (s.roof - s.deck) * k;
    const topW = pw * (s.deckW + (s.cabinW - s.deckW) * k);
    return { z, w0: pw * 0.84, w1: pw, w2: topW, topY };
  };
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const { z, w0, w1, w2, topY } = section(t);
    const pts = [[-w0, s.ride], [-w1, s.belt], [-w2, topY], [w2, topY], [w1, s.belt], [w0, s.ride]];
    for (const [x, y] of pts) {
      pos.push(x, y, z);
      uv.push(0.5 + x / (s.wide * UMARGIN), t);
    }
  }
  for (let i = 0; i < stations; i++) {
    for (let e = 0; e < RING; e++) {
      const a = i * RING + e, b = i * RING + (e + 1) % RING;
      const c = a + RING, d = b + RING;
      idx.push(a, c, b, b, c, d);
    }
  }
  // caps: a fan to the centre of the end section, so the nose and tail close
  for (const [i, flip] of [[0, true], [stations, false]]) {
    const base = i * RING;
    let cx = 0, cy = 0, cz = 0;
    for (let e = 0; e < RING; e++) { cx += pos[(base + e) * 3]; cy += pos[(base + e) * 3 + 1]; cz += pos[(base + e) * 3 + 2]; }
    const centre = pos.length / 3;
    pos.push(cx / RING, cy / RING, cz / RING);
    uv.push(0.5, i / stations);
    for (let e = 0; e < RING; e++) {
      const a = base + e, b = base + (e + 1) % RING;
      if (flip) idx.push(centre, a, b); else idx.push(centre, b, a);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const out = s.smooth ? geo : geo.toNonIndexed();
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------- livery ---

const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
const lum = (n) => (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
const shade = (n, k) => {
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return (r << 16) | (g << 8) | b;
};

function canvas2d(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/**
 * The paint, in plan. Albedo, height and roughness are drawn on three canvases
 * in the same coordinates: x across the car, y from nose to tail, both 0..1 of
 * the canvas. Every shape follows the same plan curve the loft does, so a
 * window drawn at the edge of the body lands on the flank and a number drawn
 * down the middle lands on the roof.
 */
function liverySet(carId, colour, number, seed) {
  const key = `rally-livery:${carId}:${colour}:${number}`;
  const S = LIVERY_SIZE;
  return setFromCanvases(key, S, {
    normalStrength: 2.2,
    albedo: paintAlbedo(carId, colour, number, seed, S),
    height: paintHeight(carId, seed, S),
    rough: paintRough(carId, S)
  });
}

/** the shared geometry of a livery: where the body, the glass and the panels are */
function liveryPlan(s) {
  const [c0, c1] = s.cabin;
  const edge = (t) => planAt(s.plan, t) / (2 * UMARGIN);        // half-width in u, at the belt
  const roofEdge = (t) => edge(t) * (s.deckW + (s.cabinW - s.deckW) * cabinAt(s, t)) ;
  return { c0, c1, edge, roofEdge, screen: s.screen };
}

/** trace the body outline (or an inset of it) as a path in canvas pixels */
function bodyPath(g, s, S, v0, v1, widthAt, inset = 0) {
  const steps = 26;
  g.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = v0 + (v1 - v0) * (i / steps);
    const w = Math.max(0.01, widthAt(t) - inset);
    const x = (0.5 + w) * S, y = t * S;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const t = v0 + (v1 - v0) * (i / steps);
    const w = Math.max(0.01, widthAt(t) - inset);
    g.lineTo((0.5 - w) * S, t * S);
  }
  g.closePath();
}

function paintAlbedo(carId, colour, number, seed, S) {
  const s = carShape(carId);
  const p = liveryPlan(s);
  const rng = makeRng(seed);
  const c = canvas2d(S), g = c.getContext('2d');
  const light = lum(colour) > 0.45;
  const ink = light ? '#141414' : '#f2efe8';
  const trim = light ? 0x191919 : 0xe8e4da;

  // the whole canvas is paint, so the smear down the flanks is paint too
  g.fillStyle = hex(colour);
  g.fillRect(0, 0, S, S);

  // a stripe pair down the spine, or a bonnet band, depending on the car
  const styleRoll = rng();
  g.fillStyle = hex(trim);
  if (styleRoll < 0.45) {
    for (const dx of [-0.062, 0.062]) g.fillRect((0.5 + dx - 0.028) * S, 0, 0.056 * S, S);
  } else if (styleRoll < 0.75) {
    g.fillRect(0, p.c0 * S * 0.34, S, 0.09 * S);
    g.fillRect(0, p.c1 * S + 0.12 * S, S, 0.05 * S);
  } else {
    bodyPath(g, s, S, 0, p.c0, p.edge, 0.02);
    g.fill();
  }

  // the flanks go darker than the roof: from above that reads as a rounded car
  const grad = g.createLinearGradient(0, 0, S, 0);
  grad.addColorStop(0.00, 'rgba(0,0,0,0.42)');
  grad.addColorStop(0.24, 'rgba(0,0,0,0.06)');
  grad.addColorStop(0.50, 'rgba(255,255,255,0.13)');
  grad.addColorStop(0.76, 'rgba(0,0,0,0.06)');
  grad.addColorStop(1.00, 'rgba(0,0,0,0.42)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);

  // The greenhouse. The loft lies the screens back over `screen` of the length
  // on either side of the cabin, so the glass goes exactly there and the roof
  // between them stays painted — which is what carries the number.
  const glass = '#0f151c';
  g.fillStyle = glass;
  bodyPath(g, s, S, p.c0 - s.screen, p.c0 + 0.008, p.roofEdge, 0.022);
  g.fill();
  bodyPath(g, s, S, p.c1 - 0.008, p.c1 + s.screen, p.roofEdge, 0.022);
  g.fill();
  // side glass: the band of flank the cabin sides project into, and no further
  {
    const steps = 20;
    g.beginPath();
    for (let side of [-1, 1]) {
      g.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = p.c0 + (p.c1 - p.c0) * (i / steps);
        const u = 0.5 + side * p.roofEdge(t);
        i ? g.lineTo(u * S, t * S) : g.moveTo(u * S, t * S);
      }
      for (let i = steps; i >= 0; i--) {
        const t = p.c0 + (p.c1 - p.c0) * (i / steps);
        const u = 0.5 + side * (p.roofEdge(t) + (p.edge(t) - p.roofEdge(t)) * 0.62);
        g.lineTo(u * S, t * S);
      }
      g.closePath();
      g.fillStyle = glass;
      g.fill();
    }
  }
  // the roof panel, a shade off the body so the eye finds it
  g.fillStyle = hex(shade(colour, 0.9));
  bodyPath(g, s, S, p.c0 + 0.004, p.c1 - 0.004, p.roofEdge, 0.03);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = Math.max(1, S / 190);
  bodyPath(g, s, S, p.c0 - s.screen, p.c1 + s.screen, p.roofEdge, 0.022);
  g.stroke();

  // panel lines: bonnet, boot and two doors, drawn only across the body
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = Math.max(1, S / 200);
  for (const v of [p.c0 - s.screen, p.c1 + s.screen, p.c0 + 0.10, p.c0 + 0.27]) {
    if (v <= 0.02 || v >= 0.98) continue;
    const w = p.edge(v);
    g.beginPath(); g.moveTo((0.5 - w) * S, v * S); g.lineTo((0.5 + w) * S, v * S); g.stroke();
  }

  // the number on the roof, big enough to pick a car out of a pack
  const roofV = (p.c0 + p.c1) / 2;
  const roofW = p.roofEdge(roofV) - 0.04;
  if (roofW > 0.06) {
    g.fillStyle = ink;
    g.font = `bold ${Math.round(S * Math.min(0.30, roofW * 1.5))}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(number), S / 2, roofV * S);
  }

  // rust, scuffs and road grime; the nose and the flanks get the worst of it
  for (let i = 0; i < 64; i++) {
    const x = rng() * S, y = rng() * S;
    const edgeness = Math.min(1, Math.abs(x / S - 0.5) * 2.2);
    const r = (1.5 + rng() * 5) * (0.5 + edgeness);
    g.fillStyle = rng() < 0.55
      ? `rgba(${60 + rng() * 40 | 0},${40 + rng() * 26 | 0},${26 + rng() * 18 | 0},${0.08 + rng() * 0.2})`
      : `rgba(20,18,16,${0.05 + rng() * 0.11})`;
    g.beginPath(); g.ellipse(x, y, r, r * (0.5 + rng()), rng() * 3, 0, 6.29); g.fill();
  }
  return c;
}

function paintHeight(carId, seed, S) {
  const s = carShape(carId);
  const p = liveryPlan(s);
  const rng = makeRng(seed + 991);
  const c = canvas2d(S), g = c.getContext('2d');
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, 0, S, S);

  // panel grooves, cut in the same places the paint lines them
  g.strokeStyle = '#3c3c3c';
  g.lineWidth = Math.max(1.5, S / 150);
  for (const v of [p.c0 - s.screen, p.c1 + s.screen, p.c0 + 0.10, p.c0 + 0.27]) {
    if (v <= 0.02 || v >= 0.98) continue;
    const w = p.edge(v);
    g.beginPath(); g.moveTo((0.5 - w) * S, v * S); g.lineTo((0.5 + w) * S, v * S); g.stroke();
  }
  // the roof stands proud of the deck, the screens are let into it
  g.fillStyle = '#c8c8c8';
  bodyPath(g, s, S, p.c0 - s.screen, p.c1 + s.screen, p.roofEdge, 0.02);
  g.fill();
  g.fillStyle = '#8e8e8e';
  bodyPath(g, s, S, p.c0 - s.screen, p.c0 + 0.008, p.roofEdge, 0.03);
  g.fill();
  bodyPath(g, s, S, p.c1 - 0.008, p.c1 + s.screen, p.roofEdge, 0.03);
  g.fill();

  // bonnet vents on the cars that have them, louvres on the ones that do not
  if (s.vents) {
    g.fillStyle = '#2e2e2e';
    for (let i = 0; i < 5; i++) {
      const y = (p.c0 * 0.42 + i * 0.022) * S;
      g.fillRect(0.40 * S, y, 0.20 * S, Math.max(1, S / 110));
    }
  }
  // rivets round the edge of every panel: cheap, and it catches the light
  g.fillStyle = '#d8d8d8';
  for (let i = 0; i < 120; i++) {
    const v = rng();
    const w = p.edge(v) * (0.55 + rng() * 0.42);
    const x = (0.5 + (rng() < 0.5 ? -w : w)) * S;
    g.beginPath(); g.arc(x, v * S, Math.max(0.8, S / 300), 0, 6.29); g.fill();
  }
  // dents, once the panel beating has had its way
  for (let i = 0; i < 26; i++) {
    const x = rng() * S, y = rng() * S, r = 2 + rng() * 7;
    const d = g.createRadialGradient(x, y, 0, x, y, r);
    d.addColorStop(0, 'rgba(60,60,60,0.5)');
    d.addColorStop(1, 'rgba(154,154,154,0)');
    g.fillStyle = d;
    g.beginPath(); g.arc(x, y, r, 0, 6.29); g.fill();
  }
  return c;
}

function paintRough(carId, S) {
  const s = carShape(carId);
  const p = liveryPlan(s);
  const c = canvas2d(S), g = c.getContext('2d');
  g.fillStyle = '#5c5c5c';                       // paint: fairly glossy
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#1c1c1c';                       // glass: a mirror by comparison
  bodyPath(g, s, S, p.c0 - s.screen, p.c0 + 0.008, p.roofEdge, 0.022);
  g.fill();
  bodyPath(g, s, S, p.c1 - 0.008, p.c1 + s.screen, p.roofEdge, 0.022);
  g.fill();
  return c;
}

/**
 * Scorched metal, shared by every wreck: soot over heat-blued steel with the
 * paint burnt off in patches. One set for all of them — a burnt-out car has
 * no livery left to tell it apart by.
 */
function burntSet() {
  const S = 128;
  return setFromCanvases('rally-burnt', S, {
    normalStrength: 2.6,
    albedo: (() => {
      const c = canvas2d(S), g = c.getContext('2d');
      const rng = makeRng(4211);
      g.fillStyle = '#453d33'; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 420; i++) {
        const x = rng() * S, y = rng() * S, r = 1.5 + rng() * 7;
        const roll = rng();
        g.fillStyle = roll < 0.5 ? `rgba(14,12,11,${0.2 + rng() * 0.6})`
          : roll < 0.8 ? `rgba(${110 + rng() * 40 | 0},${52 + rng() * 26 | 0},${22 + rng() * 14 | 0},${0.12 + rng() * 0.3})`
            : `rgba(${88 + rng() * 40 | 0},${92 + rng() * 34 | 0},${104 + rng() * 30 | 0},${0.1 + rng() * 0.22})`;
        g.beginPath(); g.ellipse(x, y, r, r * (0.4 + rng()), rng() * 3, 0, 6.29); g.fill();
      }
      return c;
    })(),
    height: (() => {
      const c = canvas2d(S), g = c.getContext('2d');
      const rng = makeRng(4212);
      g.fillStyle = '#909090'; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 170; i++) {
        const x = rng() * S, y = rng() * S, r = 2 + rng() * 9;
        const d = g.createRadialGradient(x, y, 0, x, y, r);
        const v = rng() < 0.5 ? 40 : 220;
        d.addColorStop(0, `rgba(${v},${v},${v},0.7)`);
        d.addColorStop(1, 'rgba(144,144,144,0)');
        g.fillStyle = d; g.beginPath(); g.arc(x, y, r, 0, 6.29); g.fill();
      }
      return c;
    })(),
    rough: (() => {
      const c = canvas2d(S), g = c.getContext('2d');
      g.fillStyle = '#e0e0e0'; g.fillRect(0, 0, S, S);
      return c;
    })()
  });
}

// ----------------------------------------------------------------- parts ---

const MAT = {
  tyre: () => new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.92 }),
  rim: () => new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.45, metalness: 0.7 }),
  steel: () => new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.42, metalness: 0.75 }),
  gun: () => new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.4, metalness: 0.8 }),
  dark: (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, metalness: 0.2 })
};

/** a wheel: tyre, sidewall shoulder and a hub, as one mesh per material */
function makeWheel(r, w) {
  const g = new THREE.Group();
  // the axle is the group's own x, so spinning the wheel is one rotation.x
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2), MAT.tyre()));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.52, r * 0.52, w * 1.06, 10).rotateZ(Math.PI / 2), MAT.rim()));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, w * 1.14, 6).rotateZ(Math.PI / 2), MAT.rim()));
  return g;
}

/**
 * The gun on the bonnet, which is the one thing about a car the driver chose.
 * Returns the group and, for a minigun, the barrel cluster so it can spin.
 */
function makeGun(weapon, s) {
  const g = new THREE.Group();
  const metal = MAT.gun();
  const mount = new THREE.Mesh(new THREE.BoxGeometry(s.wide * 0.26, 0.14, 0.42), metal);
  g.add(mount);
  let barrels = null;
  if (weapon === 'minigun') {
    barrels = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.92, 5), metal);
      b.rotation.x = Math.PI / 2;
      b.position.set(Math.cos(a) * 0.085, Math.sin(a) * 0.085, -0.5);
      barrels.add(b);
    }
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 10), metal);
    drum.rotation.x = Math.PI / 2;
    drum.position.z = 0.04;
    barrels.add(drum);
    g.add(barrels);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.3), MAT.dark(0x4a4a3a));
    box.position.set(0.22, 0.02, 0.16);
    g.add(box);
  } else if (weapon === 'shotgun') {
    for (const dx of [-0.085, 0.085]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.66, 8), metal);
      b.rotation.x = Math.PI / 2;
      b.position.set(dx, 0.02, -0.36);
      g.add(b);
    }
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.26), metal);
    block.position.z = 0.04;
    g.add(block);
  } else {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.07, 1.0, 8), metal);
    b.rotation.x = Math.PI / 2;
    b.position.set(0, 0.02, -0.48);
    g.add(b);
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.42, 8), metal);
    shroud.rotation.x = Math.PI / 2;
    shroud.position.z = -0.2;
    g.add(shroud);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.16, 8), MAT.dark(0x24262a));
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.z = -0.94;
    g.add(muzzle);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.2), MAT.dark(0x4a4a3a));
    mag.position.set(0, -0.02, 0.12);
    g.add(mag);
  }
  return { group: g, barrels };
}

/** the bits bolted on that are not the body: cages, bars, wings, stacks */
function makeFittings(s, opts, parts) {
  const g = new THREE.Group();
  const steel = MAT.steel();
  const accent = MAT.dark(s.accent ?? 0x2a2c30);
  const nose = -s.len / 2, tail = s.len / 2;
  const halfAt = (t) => (s.wide / 2) * planAt(s.plan, t);

  // bumpers, front and rear, following the plan so they sit on the body
  for (const [t, z, depth] of [[0.03, nose + 0.10, -1], [0.97, tail - 0.10, 1]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(halfAt(t) * 1.92, 0.2, 0.22), steel);
    bar.position.set(0, s.belt * 0.52, z + depth * 0.06);
    g.add(bar);
  }

  if (s.cage) {
    // a roll cage bolted through the roof, which is what the Vagabond is known for
    const tube = (x0, y0, z0, x1, y1, z1) => {
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      const len = Math.hypot(dx, dy, dz);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 6), steel);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
      g.add(m);
    };
    const cw = s.wide * 0.36, top = s.roof + 0.07;
    const z0 = -s.len / 2 + s.cabin[0] * s.len, z1 = -s.len / 2 + s.cabin[1] * s.len;
    for (const zz of [z0, z1]) { tube(-cw, s.belt, zz, -cw, top, zz); tube(cw, s.belt, zz, cw, top, zz); tube(-cw, top, zz, cw, top, zz); }
    tube(-cw, top, z0, -cw, top, z1); tube(cw, top, z0, cw, top, z1);
  }

  if (s.hoop) {
    const cw = s.wide * 0.32, top = s.roof + 0.14;
    const z = -s.len / 2 + s.cabin[1] * s.len;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(cw * 2, 0.07, 0.07), steel);
    bar.position.set(0, top, z); g.add(bar);
    for (const dx of [-cw, cw]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, top - s.belt, 6), steel);
      leg.position.set(dx, (top + s.belt) / 2, z); g.add(leg);
    }
  }

  if (s.ducktail) {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(halfAt(0.9) * 1.8, 0.09, 0.3), accent);
    lip.position.set(0, s.deck + 0.08, tail - 0.34);
    lip.rotation.x = -0.18;
    g.add(lip);
  }

  if (s.wing) {
    const post = new THREE.BoxGeometry(0.08, 0.34, 0.1);
    for (const dx of [-s.wide * 0.34, s.wide * 0.34]) {
      const p = new THREE.Mesh(post, accent);
      p.position.set(dx, s.deck + 0.17, tail - 0.32);
      g.add(p);
    }
    const plane = new THREE.Mesh(new THREE.BoxGeometry(s.wide * 1.02, 0.07, 0.42), accent);
    plane.position.set(0, s.deck + 0.36, tail - 0.32);
    plane.rotation.x = 0.16;
    g.add(plane);
    for (const dx of [-s.wide * 0.51, s.wide * 0.51]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.44), accent);
      plate.position.set(dx, s.deck + 0.33, tail - 0.32);
      g.add(plate);
    }
  }

  if (s.pods) {
    for (const dx of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, s.len * 0.34), accent);
      pod.position.set(dx * s.wide * 0.49, s.belt - 0.14, s.len * 0.04);
      g.add(pod);
    }
  }

  if (s.bed) {
    // a flat deck with slatted sides, the load space of a working vehicle
    const [b0, b1] = s.bed;
    const z0 = -s.len / 2 + b0 * s.len, z1 = -s.len / 2 + b1 * s.len;
    const w = halfAt((b0 + b1) / 2);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w * 1.84, 0.08, z1 - z0), MAT.dark(0x4a4038));
    floor.position.set(0, s.deck + 0.02, (z0 + z1) / 2);
    g.add(floor);
    for (const dx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, z1 - z0), accent);
      side.position.set(dx * w * 0.92, s.deck + 0.2, (z0 + z1) / 2);
      g.add(side);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(w * 1.84, 0.34, 0.09), accent);
    back.position.set(0, s.deck + 0.2, z1);
    g.add(back);
    for (let i = 1; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(w * 1.8, 0.05, 0.07), accent);
      rib.position.set(0, s.deck + 0.08, z0 + (z1 - z0) * (i / 4));
      g.add(rib);
    }
    // a load: two crates and a drum, because nobody drives an empty flatbed
    const crate = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.42, 0.62), MAT.dark(0x6b5a3e));
    crate.position.set(-w * 0.4, s.deck + 0.27, z0 + (z1 - z0) * 0.3);
    crate.rotation.y = 0.1;
    g.add(crate);
    const crate2 = crate.clone();
    crate2.position.set(-w * 0.34, s.deck + 0.27, z0 + (z1 - z0) * 0.62);
    crate2.rotation.y = -0.18;
    g.add(crate2);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.66, 10), MAT.dark(0x8a6a2a));
    drum.position.set(w * 0.42, s.deck + 0.39, z0 + (z1 - z0) * 0.45);
    g.add(drum);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.8, 0.03, 0.06), MAT.dark(0x2a2622));
    strap.position.set(0, s.deck + 0.5, z0 + (z1 - z0) * 0.45);
    g.add(strap);
  }

  if (s.spare) {
    const spare = makeWheel(s.wheel.r * 0.78, s.wheel.w * 0.8);
    spare.rotation.z = Math.PI / 2;                  // laid flat on the deck
    spare.position.set(s.wide * 0.2, s.deck + s.wheel.w * 0.45, tail - 0.62);
    g.add(spare);
  }

  if (s.doorPlate) {
    for (const dx of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, s.len * 0.3), steel);
      plate.position.set(dx * halfAt(0.4) * 1.0, s.belt - 0.1, -s.len * 0.02);
      g.add(plate);
    }
  }

  if (s.grille) {
    // bars welded over the glass: what makes the Warden the Warden
    const c0 = s.cabin[0];
    for (let i = 0; i < 5; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(s.wide * 0.6, 0.035, 0.035), steel);
      bar.position.set(0, s.roof - 0.06 - i * 0.085, -s.len / 2 + (c0 - s.screen * 0.5) * s.len + i * 0.04);
      g.add(bar);
    }
  }

  if (s.bullbar) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(halfAt(0.02) * 1.9, 0.5, 0.12), steel);
    bar.position.set(0, s.belt * 0.66, nose - 0.16);
    g.add(bar);
    for (const dx of [-0.34, 0, 0.34]) {
      const up = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.1), steel);
      up.position.set(dx * s.wide, s.belt * 0.7, nose - 0.16);
      g.add(up);
    }
  }

  if (s.blade) {
    // the plough: a vee that meets the road, which is the Behemoth's whole idea
    for (const dx of [-1, 1]) {
      const half = new THREE.Mesh(new THREE.BoxGeometry(s.wide * 0.62, 0.78, 0.14), steel);
      half.position.set(dx * s.wide * 0.3, 0.46, nose - 0.34);
      half.rotation.y = dx * 0.32;
      half.rotation.z = dx * -0.06;
      g.add(half);
    }
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.5), steel);
    spine.position.set(0, 0.5, nose - 0.1);
    g.add(spine);
  }

  if (s.stacks) {
    for (const dx of [-1, 1]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.5, 8), steel);
      pipe.position.set(dx * s.wide * 0.42, s.roof - 0.2, -s.len / 2 + s.cabin[1] * s.len + 0.15);
      g.add(pipe);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 8), MAT.dark(0x26221e));
      cap.position.set(dx * s.wide * 0.42, s.roof + 0.58, -s.len / 2 + s.cabin[1] * s.len + 0.15);
      g.add(cap);
    }
  }

  if (s.mudflaps) {
    for (const dx of [-1, 1]) {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.4, s.wheel.w * 1.3), MAT.dark(0x1a1a1c));
      flap.position.set(dx * (halfAt(s.wheel.rear) + 0.02), s.ride - 0.02, -s.len / 2 + s.wheel.rear * s.len + s.wheel.r * 0.9);
      flap.rotation.y = Math.PI / 2;
      g.add(flap);
    }
  }

  if (s.canopy) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(s.wide * 0.3, 0.04, 5, 10, Math.PI), MAT.dark(0x2a3038));
    arc.rotation.y = Math.PI / 2;
    arc.position.set(0, s.roof - 0.04, -s.len / 2 + (s.cabin[0] + s.cabin[1]) / 2 * s.len);
    g.add(arc);
  }

  if (s.lampBar) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(s.wide * 0.64, 0.07, 0.09), MAT.dark(0x2a2c30));
    bar.position.set(0, s.roof + 0.1, -s.len / 2 + (s.cabin[0] + 0.03) * s.len);
    g.add(bar);
  }

  if (s.vents) {
    const t = s.cabin[0] * 0.55;
    const top = s.deck;
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(s.wide * 0.34, 0.11, s.len * 0.14), accent);
    scoop.position.set(0, top + 0.05, -s.len / 2 + t * s.len);
    scoop.rotation.x = -0.1;
    g.add(scoop);
    for (let i = 0; i < 4; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(s.wide * 0.3, 0.02, 0.035), MAT.dark(0x101214));
      slat.position.set(0, top + 0.11, -s.len / 2 + t * s.len - s.len * 0.05 + i * 0.05);
      g.add(slat);
    }
  } else {
    for (const dx of [-1, 1]) {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 6), steel);
      pin.position.set(dx * s.wide * 0.3, s.deck + 0.025, -s.len / 2 + s.cabin[0] * 0.4 * s.len);
      g.add(pin);
    }
  }

  // wing mirrors, which cost four triangles and say "car" better than anything
  {
    const t = s.cabin[0] + 0.02;
    const w = halfAt(t);
    for (const dx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.05), accent);
      arm.position.set(dx * (w + 0.08), s.belt + 0.04, -s.len / 2 + t * s.len);
      g.add(arm);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.11, 0.16), accent);
      cap.position.set(dx * (w + 0.17), s.belt + 0.06, -s.len / 2 + t * s.len);
      g.add(cap);
    }
  }

  // exhausts out of the back, as many as the car is proud of
  const n = s.exhausts || 0;
  for (let i = 0; i < n; i++) {
    const dx = n === 1 ? -s.wide * 0.26 : (i - (n - 1) / 2) * 0.17;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.3, 8), steel);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(dx, s.ride + 0.02, tail + 0.06);
    g.add(pipe);
    parts.exhausts.push({ x: dx, y: s.ride + 0.02, z: tail + 0.2 });
  }

  // bolt-on armour, one plate a level, so an upgraded car looks upgraded
  const armour = Math.max(0, Math.min(3, opts.armour | 0));
  for (let i = 0; i < armour; i++) {
    const t = 0.30 + i * 0.16;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, s.len * 0.17), steel);
    for (const dx of [-1, 1]) {
      const m = plate.clone();
      m.position.set(dx * (halfAt(t) + 0.03), s.belt - 0.12, -s.len / 2 + t * s.len);
      g.add(m);
    }
  }
  if (armour >= 2) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(halfAt(0.06) * 1.7, 0.08, 0.5), steel);
    skid.position.set(0, s.ride - 0.04, nose + 0.32);
    g.add(skid);
  }

  if (opts.bumper) {
    // the spiked bumper the shop sells: a ram bar and five teeth
    const bar = new THREE.Mesh(new THREE.BoxGeometry(halfAt(0.02) * 1.96, 0.36, 0.2), steel);
    bar.position.set(0, s.belt * 0.6, nose - 0.2);
    g.add(bar);
    for (let i = -2; i <= 2; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.62, 6), steel);
      spike.rotation.x = -Math.PI / 2;
      spike.position.set(i * s.wide * 0.2, s.belt * 0.6, nose - 0.58);
      g.add(spike);
    }
  }
  return g;
}

// ------------------------------------------------------------------ build --

/** a coloured, unlit lamp: the only detail that still reads at any distance */
function lamps(places, colour, size) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: colour });
  for (const [x, y, z] of places) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 7, 5), mat);
    m.position.set(x, y, z);
    m.scale.z = 0.55;
    g.add(m);
  }
  return { group: flatten(g), material: mat };
}

/**
 * One car, built once and then only moved. `opts` carries what the driver
 * chose and paid for: the weapon on the bonnet, the spiked bumper, the armour
 * level, and the number painted on the roof.
 */
export function makeCarMesh(carId, colour, opts = {}) {
  const s = carShape(carId);
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';        // heading first, then the lean and pitch on top of it
  const lite = isLite();
  const number = opts.number ?? 1;
  const nose = -s.len / 2, tail = s.len / 2;

  const paint = lite
    ? new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5, metalness: 0.2 })
    : standard(liverySet(carId, colour, number, (carId.charCodeAt(0) * 131 + colour) >>> 0),
      { repeat: [1, 1], bumpScale: 0.035, normalScale: 0.9, metalness: 0.32 });
  const body = new THREE.Mesh(loftBody(s, lite ? 10 : 30), paint);
  g.add(body);

  const parts = { exhausts: [] };
  const moving = [];

  if (!lite) {
    const fittings = makeFittings(s, opts, parts);
    g.add(flatten(fittings));

    const gun = makeGun(opts.weapon, s);
    gun.group.position.set(0, s.deck + 0.08, nose + s.len * (s.cabin[0] * 0.55));
    if (gun.barrels) { g.add(gun.group); moving.push({ kind: 'spin', obj: gun.barrels }); }
    else g.add(flatten(gun.group));

    // Lamps set into the leading and trailing edges of the deck. On a real car
    // they live on the front face, where from directly above they are one pixel
    // of nothing; here they sit in the corners of the bonnet and the boot, and
    // they are the first thing you can see of a car at any distance.
    const front = topAt(s, 0.05), back = topAt(s, 0.955);
    const head = lamps([[-front.w * 0.64, front.y + 0.01, front.z], [front.w * 0.64, front.y + 0.01, front.z]],
      0xfff2cc, s.round ? 0.15 : 0.12);
    const tailLamps = lamps([[-back.w * 0.68, back.y + 0.01, back.z], [back.w * 0.68, back.y + 0.01, back.z]],
      0x8e1b12, 0.11);
    g.add(head.group); g.add(tailLamps.group);
    if (s.spotlight || s.lampBar) {
      const spot = lamps(s.lampBar
        ? [[-s.wide * 0.2, s.roof + 0.15, nose + (s.cabin[0] + 0.03) * s.len], [s.wide * 0.2, s.roof + 0.15, nose + (s.cabin[0] + 0.03) * s.len]]
        : [[s.wide * 0.3, s.roof - 0.1, nose + s.cabin[0] * s.len]], 0xffe9b0, 0.1);
      g.add(spot.group);
      parts.spot = spot;
    }
    parts.head = head;
    parts.tail = tailLamps;
  }

  // wheels last: the front pair steers, all four roll
  const wheels = [];
  for (const [t, steers] of [[s.wheel.front, true], [s.wheel.rear, false]]) {
    const z = nose + t * s.len;
    const half = (s.wide / 2) * planAt(s.plan, t);
    for (const dx of [-1, 1]) {
      const w = lite
        ? new THREE.Mesh(new THREE.CylinderGeometry(s.wheel.r, s.wheel.r, s.wheel.w, 8).rotateZ(Math.PI / 2), MAT.tyre())
        : flatten(makeWheel(s.wheel.r, s.wheel.w));
      const pivot = new THREE.Group();
      pivot.position.set(dx * (half - s.wheel.w * 0.18 + s.wheel.arch), s.wheel.r, z);
      pivot.add(w);
      g.add(pivot);
      wheels.push({ pivot, hub: w, steers });
    }
  }

  g.traverse(o => { if (o.isMesh) { o.castShadow = !lite; o.receiveShadow = false; } });
  g.userData = { paint, colour, shape: s, wheels, moving, parts, yaw: 0, roll: 0, lit: true };
  return g;
}

/**
 * Per-frame life: the wheels roll and the front pair steers, the body leans
 * into a slide, a minigun's barrels spin while it fires, and the brake lamps
 * come on when the car is shedding speed. None of it is simulated — it is all
 * read back out of what the snapshot already said.
 */
export function animateCar(mesh, car, dt) {
  const u = mesh.userData;
  if (!u || !u.wheels) return;
  const s = u.shape;

  // steering angle from how fast the heading is actually turning
  let d = car.yaw - u.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  u.yaw = car.yaw;
  const rate = dt > 0 ? d / dt : 0;
  const steer = Math.max(-0.55, Math.min(0.55, rate * (car.speed > 4 ? 0.9 : 0.25)));
  u.steer = (u.steer ?? 0) + (steer - (u.steer ?? 0)) * Math.min(1, dt * 12);

  const roll = Math.max(-0.09, Math.min(0.09, -rate * Math.min(1, car.speed / 30) * 0.5));
  u.roll += (roll - u.roll) * Math.min(1, dt * 8);
  mesh.rotation.z = u.roll;
  // a car under power sits back on its springs; braking pitches it forward
  const dv = (car.speed - (u.speed ?? car.speed)) / Math.max(1e-3, dt);
  u.speed = car.speed;
  u.pitch = (u.pitch ?? 0) + (Math.max(-0.05, Math.min(0.05, -dv * 0.0035)) - (u.pitch ?? 0)) * Math.min(1, dt * 7);
  mesh.rotation.x = u.pitch;

  const spin = (car.speed / Math.max(0.1, s.wheel.r)) * dt;
  for (const w of u.wheels) {
    w.pivot.rotation.y = w.steers ? u.steer : 0;
    w.hub.rotation.x -= spin;
  }

  for (const m of u.moving) {
    if (m.kind === 'spin') m.obj.rotation.z += dt * (car.firing ? 26 : 2.2);
  }

  const p = u.parts;
  if (p?.tail) {
    const braking = dv < -6;
    p.tail.material.color.setHex(braking ? 0xff3a22 : 0x8e1b12);
  }
  if (p?.head) {
    // the lamps go out with the front of the car
    const alive = car.hull / Math.max(1, car.maxHull) > 0.35;
    if (alive !== u.lit) {
      u.lit = alive;
      p.head.material.color.setHex(alive ? 0xfff2cc : 0x2a2724);
      if (p.spot) p.spot.material.color.setHex(alive ? 0xffe9b0 : 0x2a2724);
    }
  }
}

/** paint scorches and darkens as the plating goes */
export function setDamage(mesh, hullFraction) {
  const paint = mesh.userData?.paint;
  if (!paint) return;
  const f = Math.max(0, Math.min(1, hullFraction));
  if (mesh.userData.damage === Math.round(f * 40)) return;
  mesh.userData.damage = Math.round(f * 40);
  const base = new THREE.Color(mesh.userData.colour);
  const burnt = new THREE.Color(0x2a2220);
  paint.color.copy(base).lerp(burnt, (1 - f) * 0.8);
  paint.roughness = 0.42 + (1 - f) * 0.45;
  paint.metalness = 0.32 * f;
}

/**
 * What is left after it goes up: the same body, burnt out and sat down on its
 * rims, with the roof caved in. It still blocks the road, so it still has to
 * read as a car rather than a smudge.
 */
export function makeWreckMesh(carId) {
  const s = carShape(carId);
  const g = new THREE.Group();
  const lite = isLite();
  const burnt = lite
    ? new THREE.MeshStandardMaterial({ color: 0x3a332b, roughness: 0.96 })
    : standard(burntSet(), { repeat: [1.3, 2.4], bumpScale: 0.06, normalScale: 1.3, metalness: 0.28 });
  const soot = new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 1 });
  const rng = makeRng(carId.charCodeAt(0) * 977 + carId.length);

  // the same body, sat down on its rims with the roof gone
  const squashed = { ...s, roof: s.deck + 0.10, belt: s.belt * 0.74, deck: s.deck * 0.72, sill: s.sill * 0.7, ride: s.ride * 0.5, cabinW: s.cabinW * 0.86 };
  const body = new THREE.Mesh(loftBody(squashed, lite ? 10 : 22), burnt);
  body.scale.set(0.98, 0.86, 0.99);
  body.rotation.z = 0.04;
  g.add(body);

  // the cabin is a hole: the roof went and what is under it is soot
  const [c0, c1] = s.cabin;
  const cz = -s.len / 2 + ((c0 + c1) / 2) * s.len;
  const cw = (s.wide / 2) * planAt(s.plan, (c0 + c1) / 2) * s.cabinW * 0.9;
  const cavity = new THREE.Mesh(new THREE.BoxGeometry(cw * 2, 0.22, (c1 - c0) * s.len * 0.92), soot);
  cavity.position.set(0, squashed.deck * 0.86 + 0.02, cz);
  cavity.rotation.z = 0.04;
  g.add(cavity);

  if (!lite) {
    // ribs standing where the pillars were
    for (const t of [c0, c1]) {
      for (const dx of [-1, 1]) {
        const w = (s.wide / 2) * planAt(s.plan, t) * s.cabinW * 0.9;
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3 + rng() * 0.22, 0.07), burnt);
        rib.position.set(dx * w, squashed.deck + 0.12, -s.len / 2 + t * s.len);
        rib.rotation.set((rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.6);
        g.add(rib);
      }
    }
    // burst tyres, still on the rims and splayed out
    for (const t of [s.wheel.front, s.wheel.rear]) {
      for (const dx of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(s.wheel.r * 0.72, s.wheel.r * 0.72, s.wheel.w * 0.7, 9).rotateZ(Math.PI / 2), soot);
        w.rotation.z = (rng() - 0.5) * 0.7;
        w.rotation.x = (rng() - 0.5) * 0.4;
        w.position.set(dx * (s.wide / 2) * planAt(s.plan, t) * 0.98, s.wheel.r * 0.55, -s.len / 2 + t * s.len);
        g.add(w);
      }
    }
    // a door off its hinges, and panels thrown clear
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, s.len * 0.24), burnt);
    door.position.set(-(s.wide / 2) - 0.5, 0.06, s.len * 0.05);
    door.rotation.set(0, 0.4, Math.PI / 2 - 0.15);
    g.add(door);
    for (let i = 0; i < 5; i++) {
      const chunk = new THREE.Mesh(new THREE.BoxGeometry(0.25 + rng() * 0.55, 0.05, 0.25 + rng() * 0.45), soot);
      chunk.position.set((rng() - 0.5) * s.wide * 1.7, 0.03, (rng() - 0.5) * s.len * 1.3);
      chunk.rotation.set((rng() - 0.5) * 0.4, rng() * 3, (rng() - 0.5) * 0.4);
      g.add(chunk);
    }
  }

  const out = flatten(g);
  out.traverse(o => { if (o.isMesh) o.castShadow = !lite; });
  return out;
}
