// ============================================================================
// Minimal geometry merger (shared by every game client).
//
// three's BufferGeometryUtils lives in examples/jsm, which we deliberately
// don't vendor. Ship hulls are built from dozens of primitives that all share
// the same attribute layout (position / normal / uv, indexed), so a tiny
// purpose-built merge keeps a whole capital ship down to a few draw calls.
// ============================================================================

import * as THREE from 'three';

const ATTRS = ['position', 'normal', 'uv'];

/**
 * @param {THREE.BufferGeometry[]} geometries — indexed or not; mixed is fine
 * @returns {THREE.BufferGeometry|null}
 */
export function mergeGeometries(geometries) {
  const list = geometries.filter(g => g && g.attributes && g.attributes.position);
  if (!list.length) return null;
  if (list.length === 1) return list[0];

  let vertexCount = 0;
  let indexCount = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    vertexCount += n;
    indexCount += g.index ? g.index.count : n;
  }

  const out = new THREE.BufferGeometry();
  const arrays = {};
  for (const name of ATTRS) {
    if (!list.every(g => g.attributes[name])) continue;
    const itemSize = list[0].attributes[name].itemSize;
    arrays[name] = { data: new Float32Array(vertexCount * itemSize), itemSize, offset: 0 };
  }
  const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const g of list) {
    for (const name of Object.keys(arrays)) {
      const src = g.attributes[name];
      const dst = arrays[name];
      dst.data.set(src.array.subarray(0, src.count * src.itemSize), dst.offset);
      dst.offset += src.count * src.itemSize;
    }
    const n = g.attributes.position.count;
    if (g.index) {
      const src = g.index.array;
      for (let i = 0; i < src.length; i++) index[indexOffset + i] = src[i] + vertexOffset;
      indexOffset += src.length;
    } else {
      for (let i = 0; i < n; i++) index[indexOffset + i] = vertexOffset + i;
      indexOffset += n;
    }
    vertexOffset += n;
  }

  for (const name of Object.keys(arrays)) {
    out.setAttribute(name, new THREE.BufferAttribute(arrays[name].data, arrays[name].itemSize));
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}
