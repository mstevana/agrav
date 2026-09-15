// SUNFALL CANYON — desert. Layered rock walls climbing away from the track,
// mesas on the horizon, a river below the floor section, sand haze.
import * as THREE from 'three';
import { setupSky, placeAlong, instanced, ground } from './common.js';
import { strataTexture, groundTexture } from '../textures.js';

export function buildCanyon(scene, ribbon, track) {
  const env = track.env;
  const group = new THREE.Group();
  setupSky(scene, env, 0x6fa8ff, 0xffc38a);
  ground(scene, -6, new THREE.MeshStandardMaterial({ map: groundTexture(0xc98a5a, 0.1), roughness: 1 }));
  // river along the floor: a flat blue strip under the low section
  const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 120), new THREE.MeshStandardMaterial({ color: 0x2f6f8f, roughness: 0.2, metalness: 0.4, transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -5, 60);
  group.add(water);

  const strata = new THREE.MeshStandardMaterial({ map: strataTexture(env.strata), roughness: 0.95 });
  // rock walls: tall boxes hugging the track, taller the higher the track sits (the walls are the canyon)
  const rock = new THREE.BoxGeometry(1, 1, 1); rock.translate(0, 0.5, 0);
  const near = placeAlong(ribbon, { every: 14, gap: 3, spread: 6, clear: 18, seed: 31 });
  group.add(instanced(rock, strata, near, (it, pos, q, sc) => {
    const h = 18 + it.rng() * 30 + Math.max(0, 50 - it.p.y) * 0.5;
    pos.set(it.p.x, it.p.y - 30 - it.rng() * 6, it.p.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28);
    sc.set(16 + it.rng() * 16, h + 30, 12 + it.rng() * 12);
  }));
  // far mesas
  const far = placeAlong(ribbon, { every: 50, gap: 120, spread: 400, clear: 60, seed: 32 });
  const mesa = new THREE.CylinderGeometry(0.7, 1, 1, 7); mesa.translate(0, 0.5, 0);
  group.add(instanced(mesa, strata, far, (it, pos, q, sc) => {
    pos.set(it.p.x, -6, it.p.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28);
    const r = 40 + it.rng() * 90;
    sc.set(r, 40 + it.rng() * 90, r);
  }));
  // boulders on the floor
  const boulder = new THREE.DodecahedronGeometry(1, 0);
  const rocks = placeAlong(ribbon, { every: 26, gap: 4, spread: 20, clear: 16, seed: 33 });
  group.add(instanced(boulder, new THREE.MeshStandardMaterial({ color: 0x9c5a3c, roughness: 1 }), rocks, (it, pos, q, sc) => {
    const r = 1.5 + it.rng() * 4;
    pos.set(it.p.x, it.p.y - 1 + r * 0.3, it.p.z);
    q.setFromEuler(new THREE.Euler(it.rng() * 3, it.rng() * 3, it.rng() * 3));
    sc.set(r, r * 0.8, r);
  }));
  // sun glare: a bright sprite far away
  const sun = new THREE.Mesh(new THREE.SphereGeometry(60, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff3d0, fog: false }));
  sun.position.set(1200, 700, 900);
  group.add(sun);
  scene.add(group);
  return { group, update() {}, lighting: { effects: true } };
}
