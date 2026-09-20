// ============================================================================
// Geometry helpers shared by every game's renderer: pushing primitives around
// with seeded noise, welding the seams that leaves, and giving the result usable
// UVs. Displacement is always a function of position alone, so vertices that
// coincide — a box corner shared by three faces, a cylinder rim shared with its
// cap — move together and nothing tears.
// ============================================================================

import * as THREE from 'three';
import { fbm3 } from './noise.js';
import { makeRng } from '../sim/rng.js';

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
