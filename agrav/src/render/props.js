// ============================================================================
// AGRAV — displaced procedural geometry. Rocks, mesas, cliff slabs, towers,
// street furniture and swept tunnels, all built from primitives that are
// pushed around by seeded noise and then given fresh normals. Displacement
// is always a function of position only, so vertices that coincide (a box
// corner shared by three faces, a cylinder rim shared with its cap) move
// together and nothing tears.
// ============================================================================

import * as THREE from 'three';
import { fbm3, fbm2, ridged2, smoothstep } from './noise.js';
import { mergeGeometries } from '../../../shared/gfx/merge.js';
import { makeRng } from '../../../shared/sim/rng.js';

/** displace every vertex by fn(x, y, z) → [dx, dy, dz]; recomputes normals */
export function displace(geo, fn) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const d = fn(p.getX(i), p.getY(i), p.getZ(i));
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** weld coincident vertices so a faceted primitive shades smoothly */
export function weld(geo, eps = 1e-4) {
  const p = geo.attributes.position, uv = geo.attributes.uv;
  const map = new Map(), remap = new Uint32Array(p.count);
  const pos = [], uvs = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) / eps)},${Math.round(p.getY(i) / eps)},${Math.round(p.getZ(i) / eps)}`;
    let j = map.get(key);
    if (j === undefined) { j = pos.length / 3; map.set(key, j); pos.push(p.getX(i), p.getY(i), p.getZ(i)); if (uv) uvs.push(uv.getX(i), uv.getY(i)); }
    remap[i] = j;
  }
  const idx = [];
  if (geo.index) for (let i = 0; i < geo.index.count; i++) idx.push(remap[geo.index.getX(i)]);
  else for (let i = 0; i < p.count; i++) idx.push(remap[i]);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

/** planar UVs by dominant normal axis (box mapping), in metres / scale */
export function worldUv(geo, sx = 8, sy = sx) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i) / sx; v = p.getZ(i) / sy; }
    else if (ax >= az) { u = p.getZ(i) / sx; v = p.getY(i) / sy; }
    else { u = p.getX(i) / sx; v = p.getY(i) / sy; }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/**
 * Loft a superellipse cross-section through stations along an axis. Each
 * station: { p, a0 = 0, b0 = 0, w, h, k = 2.4, flat = 0 } — position along
 * the axis, centre offsets across (a) and up (b), half-extents, squareness
 * (2 = ellipse, 4 = rounded box) and how much the negative-b side is
 * flattened. axis 'z': a→x, b→y (fuselages, nacelles); 'x': a→z, b→y
 * (wings, chord along z); 'y': a→z, b→x (fins). UVs are coherent: u goes
 * round the section (0 at -b, 0.5 at +b), v along the stations, both mapped
 * into the atlas rect `uv = [u0, v0, u1, v1]`. Ends are capped.
 */
export function loft(stations, { axis = 'z', segments = 24, uv = [0, 0, 1, 1], cap = true } = {}) {
  const S = stations.length, N = segments;
  const pos = [], uvs = [], idx = [];
  const map = axis === 'z' ? (a, b, p) => [a, b, p] : axis === 'x' ? (a, b, p) => [p, b, a] : (a, b, p) => [b, p, a];
  let len = 0; const cum = [0];
  for (let i = 1; i < S; i++) { len += Math.abs(stations[i].p - stations[i - 1].p) + 1e-6; cum.push(len); }
  const U = (u) => uv[0] + u * (uv[2] - uv[0]), V = (v) => uv[1] + v * (uv[3] - uv[1]);
  for (let i = 0; i < S; i++) {
    const st = stations[i], k = st.k ?? 2.4, flat = st.flat ?? 0, v = cum[i] / (len || 1);
    for (let j = 0; j <= N; j++) {
      const u = j / N, ang = -Math.PI / 2 + u * Math.PI * 2;
      const c = Math.cos(ang), sn = Math.sin(ang);
      let a = st.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / k), b = st.h * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / k);
      if (b < 0) b *= (1 - flat);
      const [x, y, z] = map(a + (st.a0 ?? 0), b + (st.b0 ?? 0), st.p);
      pos.push(x, y, z); uvs.push(U(u), V(v));
    }
  }
  const row = N + 1;
  for (let i = 0; i < S - 1; i++) for (let j = 0; j < N; j++) {
    const a = i * row + j, b = a + row;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  if (cap) {
    for (const [i, front] of [[0, true], [S - 1, false]]) {
      const st = stations[i];
      const [x, y, z] = map(st.a0 ?? 0, st.b0 ?? 0, st.p);
      const ci = pos.length / 3; pos.push(x, y, z); uvs.push(U(0.5), V(i === 0 ? 0 : 1));
      for (let j = 0; j < N; j++) { const a = i * row + j; if (front) idx.push(ci, a + 1, a); else idx.push(ci, a, a + 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** push every vertex along its normal by fn(x, y, z, u, v) metres; normals recomputed */
export function displaceAlongNormal(geo, fn) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const d = fn(p.getX(i), p.getY(i), p.getZ(i), uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    p.setXYZ(i, p.getX(i) + n.getX(i) * d, p.getY(i) + n.getY(i) * d, p.getZ(i) + n.getZ(i) * d);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// --------------------------------------------------------------- rocks ----

/** a boulder: smoothed icosphere pushed by 3D fbm, flattened underneath. Unit radius. */
export function rock(seed = 1, detail = 2, { flat = true, elongate = 1 } = {}) {
  const g = weld(new THREE.IcosahedronGeometry(1, detail));
  const rng = makeRng(seed);
  const ox = rng() * 50, oy = rng() * 50, oz = rng() * 50;
  displace(g, (x, y, z) => {
    const n = fbm3(x * 1.3 + ox, y * 1.3 + oy, z * 1.3 + oz, { octaves: 4, seed });
    const facet = fbm3(x * 0.6 + oz, y * 0.6 + ox, z * 0.6 + oy, { octaves: 2, seed: seed + 5 });
    const k = 0.22 * n + 0.3 * facet;
    let dx = x * k, dy = y * k * elongate, dz = z * k;
    if (flat && y < -0.35) dy += (-0.35 - y) * 0.85;   // sit on the ground
    return [dx, dy, dz];
  });
  // uv: cylindrical around y, tiled
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (Math.atan2(p.getZ(i), p.getX(i)) / (Math.PI * 2) + 0.5) * 2; uv[i * 2 + 1] = p.getY(i) * 0.6 + 0.5; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** a mesa / butte: eroded cylinder, base at y=0, height 1, top radius ~0.7 */
export function mesa(seed = 1) {
  const g = new THREE.CylinderGeometry(0.72, 1, 1, 32, 12, false);
  g.translate(0, 0.5, 0);
  displace(g, (x, y, z) => {
    const a = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    if (r < 1e-4) return [0, 0, 0];
    const band = y * 7;
    const ledge = smoothstep(0.6, 0.95, band % 1) * 0.12;                 // bands step outwards toward their top
    const erode = fbm3(x * 2.2, y * 9 + seed, z * 2.2, { octaves: 4, seed }) * 0.28;
    const gully = Math.max(0, ridged2(a * 2.5 + seed, y * 4, { octaves: 3, seed: seed + 3 }) - 0.55) * 0.35;
    const k = 1 + erode - ledge - gully;
    return [x * (k - 1), 0, z * (k - 1)];
  });
  return g;
}

/** a volcano: eroded cone with radial gullies and a sunken crater, base at y=0, height 1, base radius 1 */
export function volcanoGeo(seed = 1) {
  const g = new THREE.CylinderGeometry(0.3, 1, 1, 40, 14, false);
  g.translate(0, 0.5, 0);
  displace(g, (x, y, z) => {
    const r = Math.hypot(x, z);
    if (r < 1e-4) return [0, y > 0.5 ? -0.18 : 0, 0];   // the cap centre sinks into the crater
    const a = Math.atan2(z, x);
    const gully = Math.max(0, ridged2(a * 3 + seed, y * 3, { octaves: 3, seed: seed + 2 }) - 0.5) * 0.35 * (1 - y * 0.5);
    const erode = fbm3(x * 2.5, y * 6 + seed, z * 2.5, { octaves: 4, seed }) * 0.18;
    const k = 1 + erode - gully;
    return [x * (k - 1), 0, z * (k - 1)];
  });
  return g;
}

/** a dome: the upper half of a unit sphere, open underneath (habitats, sunken cities); scale to size */
export function domeGeo(segs = 24) {
  return new THREE.SphereGeometry(1, segs, Math.max(8, Math.round(segs / 2)), 0, Math.PI * 2, 0, Math.PI / 2);
}

/** a jungle tree: trunk with branches, and a canopy of displaced blobs; returns { trunk, canopy } */
export function treeGeo(seed = 1) {
  const rng = makeRng(seed);
  const h = 7 + rng() * 6;
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.18, 0.45, h, 7); trunk.translate(0, h / 2, 0); parts.push(trunk);
  for (let i = 0; i < 3; i++) {
    const y = h * (0.55 + rng() * 0.3), len = 2 + rng() * 2.5;
    const b = new THREE.CylinderGeometry(0.08, 0.18, len, 5); b.translate(0, len / 2, 0); b.rotateZ(0.7 + rng() * 0.5); b.translate(0, y, 0); b.rotateY(rng() * Math.PI * 2); parts.push(b);
  }
  const trunkG = mergeGeometries(parts); worldUv(trunkG, 1, 1);
  const blobs = [];
  const n = 3 + rng.int(0, 2);
  for (let i = 0; i < n; i++) {
    const s = 2.2 + rng() * 1.8, a = rng() * Math.PI * 2, d = i === 0 ? 0 : 1.2 + rng() * 1.6, o = rng() * 20;
    const b = weld(new THREE.IcosahedronGeometry(1, 2));
    displace(b, (x, y, z) => { const k = fbm3(x * 1.6 + o, y * 1.6, z * 1.6 + o, { octaves: 3, seed: seed + i }) * 0.35; return [x * k, y * k * 0.7, z * k]; });
    b.scale(s, s * 0.75, s); b.translate(Math.cos(a) * d, h * 0.92 + (rng() - 0.3) * 1.5, Math.sin(a) * d); blobs.push(b);
  }
  const canopy = mergeGeometries(blobs); worldUv(canopy, 3, 3);
  return { trunk: trunkG, canopy };
}

/** a palm: a leaning trunk and a crown of drooping fronds; returns { trunk, fronds } */
export function palmGeo(seed = 1) {
  const rng = makeRng(seed);
  const h = 8 + rng() * 5, lean = (rng() - 0.5) * 0.5, dir = rng() * Math.PI * 2;
  const segs = [], N = 6;
  for (let i = 0; i < N; i++) { const c = new THREE.CylinderGeometry(0.22 - i * 0.02, 0.26 - i * 0.02, h / N + 0.05, 7); c.translate(0, h * (i + 0.5) / N, 0); segs.push(c); }
  const trunk = mergeGeometries(segs);
  displace(trunk, (x, y, z) => { const k = (y / h) ** 2 * lean * h; return [Math.cos(dir) * k, 0, Math.sin(dir) * k]; });
  worldUv(trunk, 1, 1);
  const top = { x: Math.cos(dir) * lean * h, y: h, z: Math.sin(dir) * lean * h };
  const fronds = [];
  const nf = 7 + rng.int(0, 3);
  for (let i = 0; i < nf; i++) {
    const p = new THREE.PlaneGeometry(1.1, 5, 1, 6); p.translate(0, 2.5, 0);
    displace(p, (x, y) => [x * (1 - y / 5.5) - x, 0, -((y / 5) ** 2) * 2.2]);   // taper to the tip, droop
    p.rotateX(-(0.9 + rng() * 0.5)); p.rotateY(i / nf * Math.PI * 2 + rng() * 0.3); p.translate(top.x, top.y, top.z); fronds.push(p);
  }
  return { trunk, fronds: mergeGeometries(fronds) };
}

/** a mangrove: a trunk standing on splayed prop roots that reach down into the water; returns { trunk, canopy } */
export function mangroveGeo(seed = 1) {
  const rng = makeRng(seed);
  const h = 4 + rng() * 3, parts = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, h, 7); trunk.translate(0, 1.5 + h / 2, 0); parts.push(trunk);
  const nr = 6 + rng.int(0, 4);
  for (let i = 0; i < nr; i++) {
    const len = 2.4 + rng() * 1.2;
    const r = new THREE.CylinderGeometry(0.05, 0.1, len, 5); r.translate(0, len / 2, 0); r.rotateX(Math.PI); r.rotateZ(0.5 + rng() * 0.35); r.rotateY(i / nr * Math.PI * 2 + rng() * 0.4); r.translate(0, 2.2, 0); parts.push(r);
  }
  const trunkG = mergeGeometries(parts); worldUv(trunkG, 1, 1);
  const blobs = [];
  for (let i = 0; i < 3; i++) {
    const s = 1.6 + rng() * 1.2, a = rng() * Math.PI * 2, d = i === 0 ? 0 : 1 + rng(), o = rng() * 20;
    const b = weld(new THREE.IcosahedronGeometry(1, 2));
    displace(b, (x, y, z) => { const k = fbm3(x * 1.8 + o, y * 1.8, z * 1.8 + o, { octaves: 3, seed: seed + 9 + i }) * 0.3; return [x * k, y * k * 0.6, z * k]; });
    b.scale(s, s * 0.7, s); b.translate(Math.cos(a) * d, 1.5 + h + 0.4, Math.sin(a) * d); blobs.push(b);
  }
  const canopy = mergeGeometries(blobs); worldUv(canopy, 3, 3);
  return { trunk: trunkG, canopy };
}

/** coral, unit-ish size: kind 0 staghorn (branching), 1 brain (a low boulder), 2 sea fan (a standing half disc) */
export function coralGeo(seed = 1, kind = 0) {
  const rng = makeRng(seed);
  if (kind === 1) { const g = rock(seed, 2); g.scale(1, 0.7, 1); return g; }
  if (kind === 2) {
    const g = new THREE.CircleGeometry(1, 28, 0, Math.PI);
    displace(g, (x, y) => { const n = fbm2(x * 3 + seed, y * 3, { octaves: 3, seed }); const r = Math.hypot(x, y); return [x * n * 0.25 * r, y * n * 0.25 * r, n * 0.15]; });
    return g;
  }
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.08, 0.16, 0.8, 6); trunk.translate(0, 0.4, 0); parts.push(trunk);
  const nb = 8 + rng.int(0, 4);
  for (let i = 0; i < nb; i++) {
    const len = 0.5 + rng() * 0.7;
    const b = new THREE.CylinderGeometry(0.03, 0.08, len, 5); b.translate(0, len / 2, 0); b.rotateZ(0.4 + rng() * 0.9); b.rotateY(i / nb * Math.PI * 2 + rng() * 0.5); b.translate(0, 0.45 + rng() * 0.35, 0); parts.push(b);
  }
  const g = mergeGeometries(parts); worldUv(g, 1, 1);
  return g;
}

/** a rock slab for cliffs and canyon walls: unit box on the ground, faces bulged by noise */
export function cliffSlab(seed = 1) {
  const g = new THREE.BoxGeometry(1, 1, 1, 5, 7, 5);
  g.translate(0, 0.5, 0);
  const rng = makeRng(seed);
  const ox = rng() * 40, shear = (rng() - 0.5) * 0.25;
  displace(g, (x, y, z) => {
    const n = fbm3(x * 2.4 + ox, y * 2.4, z * 2.4 + ox, { octaves: 4, seed });
    const big = fbm3(x * 0.9 + ox, y * 0.9, z * 0.9, { octaves: 2, seed: seed + 9 });
    // pull the vertical corners and the top rim in so the block reads as a weathered mass, not a crate
    const corner = Math.min(1, Math.abs(x) * Math.abs(z) * 4) * 0.16, rim = smoothstep(0.75, 1, y) * 0.12;
    const k = 0.12 * n + 0.14 * big - corner - rim;
    return [k * Math.sign(x || 1) + shear * y, 0.08 * n * (y > 0.9 ? 1 : 0), k * Math.sign(z || 1)];
  });
  worldUv(g, 0.5, 0.35);
  return g;
}

/** a sandstone arch: half torus standing on its ends, roughened. Span 2, height ~1. */
export function archGeo(seed = 1) {
  const g = weld(new THREE.TorusGeometry(1, 0.26, 10, 22, Math.PI));
  displace(g, (x, y, z) => { const n = fbm3(x * 3 + seed, y * 3, z * 3, { octaves: 3, seed }); return [x * n * 0.12, y * n * 0.12 + (y < 0.05 ? 0 : 0), z * n * 0.25]; });
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = Math.atan2(p.getY(i), p.getX(i)) * 2; uv[i * 2 + 1] = p.getY(i) * 1.5 + p.getZ(i); }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** a sea stack: tall rock, wider base, ragged top */
export function seaStack(seed = 1) {
  const g = rock(seed, 3, { flat: false, elongate: 1 });
  g.scale(0.7, 1.8, 0.7);
  displace(g, (x, y, z) => [x * Math.max(0, -y) * 0.35, 0, z * Math.max(0, -y) * 0.35]);
  return g;
}

// -------------------------------------------------------------- towers ----

/** a tiered tower at absolute size, base on y=0, centred at the origin. UVs in facade tiles (24 m × 48 m). */
export function tower(w, d, h, rng, tileW = 24, tileH = 48, kind = 0) {
  const parts = [];
  if (kind === 1) {
    // a round tower with a crown ring
    const r = Math.min(w, d) / 2;
    const c = new THREE.CylinderGeometry(r * 0.92, r, h, 14, 1); c.translate(0, h / 2, 0);
    const uv = c.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * Math.PI * r / tileW), uv.getY(i) * (h / tileH));
    const cap = new THREE.CylinderGeometry(r * 0.6, r * 0.95, 4, 14, 1); cap.translate(0, h + 2, 0);
    const g = mergeGeometries([c, cap]);
    return g;
  }
  if (kind === 2) {
    // a stepped ziggurat: five fast-shrinking tiers
    let cw = w, cd = d, y = 0;
    for (let i = 0; i < 5; i++) { const th = h * [0.34, 0.24, 0.18, 0.14, 0.1][i]; const b = new THREE.BoxGeometry(cw, th, cd); b.translate(0, y + th / 2, 0); parts.push(b); y += th; cw *= 0.8; cd *= 0.8; }
    const g = mergeGeometries(parts); worldUv(g, tileW, tileH); return g;
  }
  const tiers = h > 90 ? 1 + rng.int(1, 2) : rng() < 0.5 ? 1 : 2;
  let cw = w, cd = d, y = 0;
  for (let i = 0; i < tiers; i++) {
    const th = i === tiers - 1 ? h - y : h * (0.45 + rng() * 0.25) / tiers * (tiers - i) ;
    const b = new THREE.BoxGeometry(cw, th, cd, 1, 1, 1);
    b.translate(0, y + th / 2, 0);
    parts.push(b);
    y += th;
    cw *= 0.72 + rng() * 0.16; cd *= 0.72 + rng() * 0.16;
  }
  const g = mergeGeometries(parts);
  worldUv(g, tileW, tileH);
  return g;
}

/** rooftop and street-level clutter for a tower footprint (w × d, height h); pushes geometries into lists */
export function towerDressing(w, d, h, rng, out) {
  const topW = w, topD = d;   // dressing goes on the base tier's roof edge and the true roof
  // parapet on the roof
  const t = 0.6;
  for (const [x, z, sx, sz] of [[0, topD / 2 - t / 2, topW, t], [0, -topD / 2 + t / 2, topW, t], [topW / 2 - t / 2, 0, t, topD], [-topW / 2 + t / 2, 0, t, topD]]) {
    const b = new THREE.BoxGeometry(sx, 1.4, sz); b.translate(x, h + 0.7, z); out.concrete.push(b);
  }
  // water tank
  if (rng() < 0.6) { const c = new THREE.CylinderGeometry(2.2, 2.2, 4, 12); c.translate((rng() - 0.5) * w * 0.4, h + 2, (rng() - 0.5) * d * 0.4); out.metal.push(c); }
  // AC units
  const nAc = rng.int(1, 3);
  for (let i = 0; i < nAc; i++) { const b = new THREE.BoxGeometry(3, 1.6, 2.2); b.translate((rng() - 0.5) * w * 0.6, h + 0.8, (rng() - 0.5) * d * 0.6); out.metal.push(b); }
  // antenna mast
  if (rng() < 0.7) { const m = new THREE.CylinderGeometry(0.15, 0.3, 10 + rng() * 14, 6); m.translate((rng() - 0.5) * w * 0.5, h + 6, (rng() - 0.5) * d * 0.5); out.metal.push(m); }
  // plinth at street level
  const pl = new THREE.BoxGeometry(w + 6, 1, d + 6); pl.translate(0, 0.5, 0); out.concrete.push(pl);
}

// ------------------------------------------------------- street furniture --

export function pylonGeo(height, r = 1.4) {
  const c = new THREE.CylinderGeometry(r, r * 1.25, height, 10, 1);
  c.translate(0, height / 2, 0);
  const cap = new THREE.BoxGeometry(r * 3.2, 1.2, r * 3.2); cap.translate(0, height - 0.6, 0);
  const foot = new THREE.CylinderGeometry(r * 1.8, r * 2.2, 1.2, 10); foot.translate(0, 0.6, 0);
  const g = mergeGeometries([c, cap, foot]);
  worldUv(g, 4, 4);
  return g;
}

/** light gantry across the track: two legs and a truss, lamps merged separately */
export function gantryGeo(width, h = 9) {
  const parts = [], lamps = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.BoxGeometry(0.9, h, 0.9); leg.translate(sx * (width / 2 + 1.5), h / 2, 0); parts.push(leg);
  }
  const beam = new THREE.BoxGeometry(width + 4, 1.4, 1.4); beam.translate(0, h - 0.7, 0); parts.push(beam);
  const n = Math.max(3, Math.round(width / 5));
  for (let i = 0; i < n; i++) { const l = new THREE.BoxGeometry(1.6, 0.4, 0.9); l.translate(-width / 2 + (i + 0.5) * (width / n), h - 1.6, 0); lamps.push(l); }
  const g = mergeGeometries(parts); worldUv(g, 4, 4);
  return { frame: g, lamps: mergeGeometries(lamps) };
}

/** a barrier post: instanced, absolute size */
export function barrierPostGeo() {
  const p = new THREE.BoxGeometry(0.4, 3, 0.4); p.translate(0, 1.5, 0);
  const cap = new THREE.BoxGeometry(0.7, 0.25, 0.7); cap.translate(0, 3.1, 0);
  const g = mergeGeometries([p, cap]); worldUv(g, 1, 1);
  return g;
}

export function lampPostGeo(h = 9) {
  const pole = new THREE.CylinderGeometry(0.16, 0.24, h, 8); pole.translate(0, h / 2, 0);
  const arm = new THREE.BoxGeometry(3, 0.25, 0.25); arm.translate(1.5, h - 0.2, 0);
  const head = new THREE.BoxGeometry(1.4, 0.35, 0.6); head.translate(2.6, h - 0.5, 0);
  const g = mergeGeometries([pole, arm, head]); worldUv(g, 2, 2);
  return g;
}

/** desert plants */
export function cactusGeo(seed = 1) {
  const rng = makeRng(seed);
  const h = 3 + rng() * 3;
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.35, 0.45, h, 8); trunk.translate(0, h / 2, 0); parts.push(trunk);
  const arms = rng.int(1, 3);
  for (let i = 0; i < arms; i++) {
    const a = rng() * Math.PI * 2, y = h * (0.35 + rng() * 0.3);
    const out = new THREE.CylinderGeometry(0.22, 0.26, 1.2, 6); out.rotateZ(Math.PI / 2); out.translate(0.7, y, 0); out.rotateY(a); parts.push(out);
    const up = new THREE.CylinderGeometry(0.22, 0.26, 1.2 + rng() * 1.5, 6); up.translate(1.2, y + 0.8, 0); up.rotateY(a); parts.push(up);
  }
  const g = mergeGeometries(parts); worldUv(g, 1, 1);
  return g;
}
export function deadTreeGeo(seed = 1) {
  const rng = makeRng(seed);
  const parts = [];
  const h = 4 + rng() * 4;
  const trunk = new THREE.CylinderGeometry(0.12, 0.35, h, 6); trunk.translate(0, h / 2, 0); parts.push(trunk);
  for (let i = 0; i < 4; i++) {
    const y = h * (0.4 + rng() * 0.5), len = 1.5 + rng() * 2.5;
    const b = new THREE.CylinderGeometry(0.05, 0.14, len, 5); b.translate(0, len / 2, 0); b.rotateZ(0.6 + rng() * 0.6); b.translate(0, y, 0); b.rotateY(rng() * Math.PI * 2); parts.push(b);
  }
  const g = mergeGeometries(parts); worldUv(g, 1, 1);
  return g;
}
/** a grass tuft: three crossed blades, vertex-coloured by height for the sway shader */
export function grassGeo() {
  const parts = [];
  for (let i = 0; i < 3; i++) { const p = new THREE.PlaneGeometry(1.2, 1, 1, 2); p.translate(0, 0.5, 0); p.rotateY(i * Math.PI / 3); parts.push(p); }
  return mergeGeometries(parts);
}

// -------------------------------------------------------------- sweeps ----

/**
 * Sweep a cross-section along a run of ribbon frames [i0..i1] (indices, may
 * wrap). profile: [{t, h, m?}] in frame space (t across, h up, m = how much
 * the displacer may move this point, default 1); t and h may be functions of
 * the frame (so a curb can follow the width). uv: u along the profile,
 * v along s, both in metres / uvScale.
 */
export function sweep(ribbon, i0, i1, profile, { uvScale = 8, displace: dfn = null, closeProfile = false } = {}) {
  const count = ((i1 - i0 + ribbon.count) % ribbon.count) + 1;
  const prof = closeProfile ? [...profile, profile[0]] : profile;
  const P = prof.length;
  const f0 = ribbon.frames[i0 % ribbon.count];
  const num = (v) => typeof v === 'function' ? v(f0) : v;
  const arc = [0];
  for (let k = 1; k < P; k++) arc[k] = arc[k - 1] + Math.hypot(num(prof[k].t) - num(prof[k - 1].t), num(prof[k].h) - num(prof[k - 1].h));
  const verts = [], uvs = [], idx = [];
  for (let n = 0; n < count; n++) {
    const f = ribbon.frames[(i0 + n) % ribbon.count];
    for (let k = 0; k < P; k++) {
      const q = prof[k];
      const qt = typeof q.t === 'function' ? q.t(f) : q.t, qh = typeof q.h === 'function' ? q.h(f) : q.h;
      let x = f.pos.x + f.right.x * qt + f.up.x * qh, y = f.pos.y + f.right.y * qt + f.up.y * qh, z = f.pos.z + f.right.z * qt + f.up.z * qh;
      if (dfn) { const d = dfn(x, y, z, q.m ?? 1, f); x += d[0]; y += d[1]; z += d[2]; }
      verts.push(x, y, z);
      uvs.push(arc[k] / uvScale, (n * ribbon.step) / uvScale);
    }
  }
  for (let n = 0; n < count - 1; n++) for (let k = 0; k < P - 1; k++) {
    const a = n * P + k, b = a + P;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** contiguous runs of frame indices where pred(frame) holds, as [i0, i1] pairs (wrap-aware) */
export function frameRuns(ribbon, pred) {
  const n = ribbon.count, runs = [];
  let start = -1;
  // begin scanning at a frame where pred is false so a run across the wrap is one run
  let off = 0; while (off < n && pred(ribbon.frames[off])) off++;
  if (off === n) return [[0, n - 1]];
  for (let k = 0; k <= n; k++) {
    const i = (off + k) % n;
    const on = k < n && pred(ribbon.frames[i]);
    if (on && start < 0) start = i;
    if (!on && start >= 0) { runs.push([start, (i - 1 + n) % n]); start = -1; }
  }
  return runs;
}
