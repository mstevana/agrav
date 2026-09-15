// ============================================================================
// AGRAV — environment helpers shared by the three themes: sky dome, lighting,
// fog, and seeded placement of scenery along the ribbon that never lands on
// the track.
// ============================================================================

import * as THREE from 'three';
import { frameAt } from '../../../../shared/sim/spline.js';
import { makeRng } from '../../../../shared/sim/rng.js';
import { skyTexture } from '../textures.js';

export function setupSky(scene, env, top, horizon) {
  scene.background = new THREE.Color(env.sky);
  scene.fog = new THREE.FogExp2(env.fog, env.fogDensity);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2400, 24, 12), new THREE.MeshBasicMaterial({ map: skyTexture(top, horizon), side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -10;
  scene.add(dome);
  // three r155+ lights are physically scaled: a sun needs ~3, fill ~1.5 to read as daylight
  const hemi = new THREE.HemisphereLight(top, 0x404040, 1.4);
  const sun = new THREE.DirectionalLight(env.sun, env.sunIntensity * 3.2);
  sun.position.set(300, 500, 200);
  const amb = new THREE.AmbientLight(env.ambient, 1.6);
  scene.add(hemi, sun, amb);
  return { dome, sun, hemi, amb };
}

/**
 * Sample positions along the ribbon at `every` metres, on `side` (+1 right /
 * -1 left / 0 both), at a lateral distance of width/2 + gap + jitter, and
 * reject any sample closer than `clear` to any other part of the track.
 */
export function placeAlong(ribbon, { every = 30, side = 0, gap = 8, spread = 30, seed = 1, yOffset = 0, halfExtent = 0 } = {}) {
  const rng = makeRng(seed);
  const out = [];
  const coarse = [];
  for (let i = 0; i < ribbon.count; i += 2) coarse.push(ribbon.frames[i]);
  for (let s = 0; s < ribbon.length; s += every) {
    const f = frameAt(ribbon, s + rng() * every * 0.5);
    const sides = side === 0 ? [1, -1] : [side];
    for (const sd of sides) {
      // the object's own footprint decides how far out it sits and what it must clear
      const r = typeof halfExtent === 'function' ? halfExtent(rng) : halfExtent;
      const d = f.width / 2 + r + gap + rng() * spread;
      const p = { x: f.pos.x + f.right.x * sd * d, y: f.pos.y + yOffset, z: f.pos.z + f.right.z * sd * d };
      const reach = r * 1.45 + 3;   // rotated box corner + margin
      let ok = true;
      for (const q of coarse) {
        const dx = q.pos.x - p.x, dz = q.pos.z - p.z, need = q.width / 2 + reach;
        if (dx * dx + dz * dz < need * need && Math.abs(q.pos.y - p.y) < 60) { ok = false; break; }
      }
      if (ok) out.push({ p, f, sd, rng, u: rng(), r });
    }
  }
  return out;
}

/** instanced mesh from a geometry + transforms */
export function instanced(geo, mat, items, setup) {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
  items.forEach((it, i) => { setup(it, pos, q, sc, i); m.compose(pos, q, sc); mesh.setMatrixAt(i, m); });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** a big ground plane under everything */
export function ground(scene, y, material, size = 6000) {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
  g.rotation.x = -Math.PI / 2; g.position.y = y;
  scene.add(g);
  return g;
}
