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

/**
 * Collapse a tree of small static meshes into one mesh per material.
 *
 * Scenery is authored as hundreds of little groups because that is how it is
 * easiest to think about, and hundreds of little groups is also the fastest
 * way to bring a renderer to its knees. This bakes each mesh's world matrix
 * into a copy of its geometry, buckets by what the material actually looks
 * like — not by object identity, since scenery builders tend to mint a fresh
 * material per prop — and merges each bucket. Anything that cannot be merged
 * (an InstancedMesh, a skinned mesh, a mesh with a per-vertex attribute the
 * merger does not carry) is passed through untouched.
 *
 * @param {THREE.Object3D} root
 * @returns {THREE.Group}
 */
export function flatten(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const passthrough = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material)) { passthrough.push(o); return; }
    const g = o.geometry;
    if (!g || !g.attributes.position || !g.attributes.normal || !g.attributes.uv) { passthrough.push(o); return; }
    if (g.attributes.color || g.attributes.blend) { passthrough.push(o); return; }
    const m = o.material;
    const key = [m.type, m.color?.getHex(), m.roughness, m.metalness, m.transparent, m.opacity,
      m.side, m.depthWrite, m.map?.uuid ?? '', m.emissive?.getHex() ?? ''].join('|');
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = { material: m, geometries: [], castShadow: false, receiveShadow: false });
    const clone = g.clone().applyMatrix4(o.matrixWorld);
    b.geometries.push(clone);
    b.castShadow ||= o.castShadow;
    b.receiveShadow ||= o.receiveShadow;
  });
  const out = new THREE.Group();
  for (const b of buckets.values()) {
    const geo = mergeGeometries(b.geometries);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, b.material);
    mesh.castShadow = b.castShadow;
    mesh.receiveShadow = b.receiveShadow;
    out.add(mesh);
  }
  for (const o of passthrough) {
    o.updateMatrixWorld(true);
    const m = o.clone();
    m.matrix.copy(o.matrixWorld);
    m.matrix.decompose(m.position, m.quaternion, m.scale);
    m.matrixAutoUpdate = true;
    out.add(m);
  }
  return out;
}
