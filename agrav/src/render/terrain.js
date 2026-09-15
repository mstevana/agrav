// ============================================================================
// AGRAV — terrain: one displaced grid under the whole track. Every vertex
// knows its nearest ribbon frame (distance, track height, width, which side
// it is on), the theme turns that into a landscape height, and the corridor
// rule caps the ground just under the road so nothing ever pokes through the
// surface while bridges stay bridges. The cap is the minimum over every
// nearby frame, so where a rim road crosses above a valley road the ground
// follows the lower one.
// ============================================================================

import * as THREE from 'three';
import { smin, smoothstep } from './noise.js';

/**
 * @param ribbon
 * @param opts { cells, pad, skip, sigma, orient(frame)→±1, noCap(frame)→bool, corridor:{drop,margin,fade},
 *               profile(info)→y, colour?(info, y, ny)→[r,g,b], blend?(info, y, ny)→[0,1], material }
 *  info: { x, z, d, ty, tySmooth, lowEdge, w, s, side, sideSmooth, cap, f }
 *   d          horizontal distance to the centreline of the nearest frame
 *   side       ±1: which side of the nearest frame (× orient)
 *   sideSmooth [-1, 1]: the same, blended over ~σ metres so it is continuous away from the track
 *   tySmooth   track height blended over ~σ/2 metres (bridges over valleys give a slope, not a cliff)
 *   cap        the corridor ceiling for this vertex (already the min over all frames)
 */
const cache = new WeakMap();   // ribbon → Map(cacheKey → terrain); ribbons are cached per track, so this is per track
export function buildTerrain(ribbon, opts = {}) {
  if (opts.cacheKey) {
    let m = cache.get(ribbon); if (!m) { m = new Map(); cache.set(ribbon, m); }
    if (!m.has(opts.cacheKey)) m.set(opts.cacheKey, buildTerrainNow(ribbon, opts));
    return m.get(opts.cacheKey);
  }
  return buildTerrainNow(ribbon, opts);
}
function buildTerrainNow(ribbon, { cells = 180, pad = 320, skip = 3, sigma = 90, orient = () => 1, noCap = () => false, corridor: cor = {}, profile, colour = null, blend = null, material } = {}) {
  const { drop = 4, margin = 6, fade = 45 } = cor;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const f of ribbon.frames) { minX = Math.min(minX, f.pos.x); maxX = Math.max(maxX, f.pos.x); minZ = Math.min(minZ, f.pos.z); maxZ = Math.max(maxZ, f.pos.z); }
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
  const nx = cells + 1, nz = cells + 1;
  const dx = (maxX - minX) / cells, dz = (maxZ - minZ) / cells;
  const frames = []; for (let i = 0; i < ribbon.count; i += skip) frames.push(ribbon.frames[i]);
  const orientOf = frames.map(orient), capOf = frames.map(f => !noCap(f));
  const lowEdgeOf = frames.map(f => f.pos.y - Math.abs(Math.sin(f.bank)) * f.width / 2);
  const heights = new Float32Array(nx * nz);
  const infos = new Array(nx * nz);
  const s4 = sigma ** 4, t4 = (sigma * 0.5) ** 4;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = minX + i * dx, z = minZ + j * dz;
    let best = -1, bd = Infinity, wsum = 0, ssum = 0, tw = 0, tsum = 0, cap = Infinity;
    for (let k = 0; k < frames.length; k++) {
      const f = frames[k];
      const ex = x - f.pos.x, ez = z - f.pos.z;
      const d2 = ex * ex + ez * ez;
      if (d2 < bd) { bd = d2; best = k; }
      const d4 = d2 * d2;
      const w = 1 / (1 + d4 / s4);
      const sd = (ex * f.right.x + ez * f.right.z) > 0 ? 1 : -1;
      wsum += w; ssum += w * sd * orientOf[k];
      const w2 = 1 / (1 + d4 / t4);
      tw += w2; tsum += w2 * f.pos.y;
      if (capOf[k]) {
        const out = Math.sqrt(d2) - f.width / 2;
        if (out < margin + fade) { const c = lowEdgeOf[k] - drop + smoothstep(margin, margin + fade, out) * 600; if (c < cap) cap = c; }
      }
    }
    const f = frames[best];
    const ex = x - f.pos.x, ez = z - f.pos.z;
    const side = ((ex * f.right.x + ez * f.right.z) > 0 ? 1 : -1) * orientOf[best];
    const info = { x, z, d: Math.sqrt(bd), ty: f.pos.y, tySmooth: tsum / tw, lowEdge: lowEdgeOf[best], w: f.width, s: f.s, side, sideSmooth: ssum / wsum, cap, f };
    infos[j * nx + i] = info;
    heights[j * nx + i] = profile(info);
  }
  // geometry
  const verts = new Float32Array(nx * nz * 3), uvs = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    verts[k * 3] = minX + i * dx; verts[k * 3 + 1] = heights[k]; verts[k * 3 + 2] = minZ + j * dz;
    uvs[k * 2] = (minX + i * dx) / 8; uvs[k * 2 + 1] = (minZ + j * dz) / 8;
  }
  const idx = new Uint32Array(cells * cells * 6);
  let q = 0;
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  if (colour) {
    const col = new Float32Array(nx * nz * 3);
    for (let k = 0; k < nx * nz; k++) { const c = colour(infos[k], heights[k], n.getY(k)); col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2]; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    material.vertexColors = true;
  }
  if (blend) {
    const bl = new Float32Array(nx * nz);
    for (let k = 0; k < nx * nz; k++) bl[k] = blend(infos[k], heights[k], n.getY(k));
    geo.setAttribute('blend', new THREE.BufferAttribute(bl, 1));
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  const heightAt = (x, z) => {
    const fi = (x - minX) / dx, fj = (z - minZ) / dz;
    const i = Math.max(0, Math.min(cells - 1, Math.floor(fi))), j = Math.max(0, Math.min(cells - 1, Math.floor(fj)));
    const u = Math.max(0, Math.min(1, fi - i)), v = Math.max(0, Math.min(1, fj - j));
    const h00 = heights[j * nx + i], h10 = heights[j * nx + i + 1], h01 = heights[(j + 1) * nx + i], h11 = heights[(j + 1) * nx + i + 1];
    return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
  };
  const infoAt = (x, z) => {
    const i = Math.max(0, Math.min(cells, Math.round((x - minX) / dx))), j = Math.max(0, Math.min(cells, Math.round((z - minZ) / dz)));
    return infos[j * nx + i];
  };
  const slopeAt = (x, z, r = 4) => Math.max(Math.abs(heightAt(x + r, z) - heightAt(x - r, z)), Math.abs(heightAt(x, z + r) - heightAt(x, z - r))) / (2 * r);
  /** the height field as a texture (R = (h + 30) / 80) for shaders such as the sea's shoreline */
  const heightTexture = () => {
    const data = new Uint8Array(nx * nz * 4);
    for (let k = 0; k < nx * nz; k++) { const v = Math.max(0, Math.min(255, Math.round((heights[k] + 30) / 80 * 255))); data[k * 4] = data[k * 4 + 1] = data[k * 4 + 2] = v; data[k * 4 + 3] = 255; }
    const t = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  };
  return { mesh, heightAt, infoAt, slopeAt, heightTexture, bounds: { minX, maxX, minZ, maxZ } };
}

/** the corridor rule: the landscape, capped just under the road wherever a road is near */
export function corridor(info, landY, k = 8) {
  return smin(landY, info.cap, k);
}
