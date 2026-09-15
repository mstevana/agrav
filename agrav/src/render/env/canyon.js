// SUNFALL CANYON — desert. A terrain height field that climbs into ridged
// walls either side of the road and drops to a river on the floor, layered
// strata on every rock, eroded mesas on the horizon, boulders, scrub, a
// hazy sun and drifting dust.
import * as THREE from 'three';
import { setupSky, placeAlong, instancedVariants, rockTint, merged, placed, particleField, flock, billboards } from './common.js';
import { glowSprite } from '../textures.js';
import { strataSet, sandSet, cliffSet, concreteSet, metalPlateSet, waterSet, standard, triplanarBlended } from '../surfaces.js';
import { rock, mesa, cliffSlab, cactusGeo, deadTreeGeo, pylonGeo, archGeo } from '../props.js';
import { buildTerrain, corridor } from '../terrain.js';
import { fbm2, ridged2, smoothstep } from '../noise.js';
import { frameAt } from '../../../../shared/sim/spline.js';

/** the height field (cached per track) */
function terrainFor(ribbon, env) {
  // terrain: strata on the slopes, sand on the flats
  const terrainMat = triplanarBlended(strataSet(env.strata), sandSet(0xd9a06e), { tile: 36, normalScale: 0.9 });
  const wallH = (x, z) => 40 + ridged2(x / 150, z / 150, { octaves: 4, seed: 7 }) * 55;
  return buildTerrain(ribbon, {
    cacheKey: 'canyon', cells: 200, pad: 380, corridor: { drop: 3.5, margin: 5, fade: 40 },
    profile(info) {
      const edge = Math.max(0, info.d - info.w / 2);
      const rise = smoothstep(4, 130, edge);
      let land = info.tySmooth + rise * wallH(info.x, info.z) + fbm2(info.x / 70, info.z / 70, { octaves: 3, seed: 8 }) * 6;
      // the river runs 40 m out on the low side of the floor section
      const low = smoothstep(16, 6, info.ty);
      const riverSide = smoothstep(0.1, -0.5, info.sideSmooth);
      const channel = (1 - smoothstep(0, 34, Math.abs(edge - 42))) * low * riverSide;
      land -= channel * 15;
      return corridor(info, land);
    },
    colour(info, y, ny) { const dust = 0.85 + fbm2(info.x / 30, info.z / 30, { octaves: 2, seed: 9 }) * 0.12 + smoothstep(-10, 70, y) * 0.3; return [dust, dust * 0.96, dust * 0.9]; },
    blend: (info, y, ny) => smoothstep(0.72, 0.95, ny),
    material: terrainMat
  });
}

/** build the expensive parts (textures, terrain) ahead of the race, from the lobby */
export function prewarmCanyon(ribbon, track) { terrainFor(ribbon, track.env); strataSet(track.env.strata); concreteSet(0x9a8a78); waterSet(3); }

export function buildCanyon(scene, ribbon, track) {
  const env = track.env;
  const group = new THREE.Group(), fine = new THREE.Group();
  const sunPos = { x: 1200, y: 700, z: 900 };
  const sky = setupSky(scene, env, 0x6fa8ff, 0xffc38a, { clouds: true, seed: 5, sunPos, sunDisc: { colour: 0xfff3d0, size: 60 } });

  const terrain = terrainFor(ribbon, env);
  terrain.mesh.name = 'terrain';
  group.add(terrain.mesh);
  const { heightAt } = terrain;

  // river: a normal-mapped water plane under the floor section
  const floor = ribbon.frames.filter(f => f.pos.y < 10);
  const cx = floor.reduce((a, f) => a + f.pos.x, 0) / floor.length, cz = floor.reduce((a, f) => a + f.pos.z, 0) / floor.length;
  const waterN = waterSet(3).normalMap.clone(); waterN.repeat.set(70, 70); waterN.needsUpdate = true;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ color: 0x2f6f8f, normalMap: waterN, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.9 }));
  water.name = 'water';
  water.rotation.x = -Math.PI / 2; water.position.set(cx, -6, cz);
  group.add(water);

  const strata = standard(strataSet(env.strata), { repeat: [3, 2], bumpScale: 0.3, normalScale: 1.2 });
  // near walls: displaced slabs hugging the road (not on the river side of the floor)
  const slabs = [cliffSlab(1), cliffSlab(2), cliffSlab(3), cliffSlab(4)];
  const near = placeAlong(ribbon, { every: 15, gap: 2.5, spread: 8, seed: 31, halfExtent: (rng) => 6 + rng() * 7, y: heightAt })
    .filter(it => !(it.f.pos.y < 16 && it.sd === -1));
  group.add(instancedVariants(slabs, strata, near, (it, pos, q, sc) => {
    pos.set(it.p.x, it.p.y - 3 - it.rng() * 3, it.p.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28);
    sc.set(it.r * 2, 14 + it.rng() * 26, it.r * (1.2 + it.rng() * 0.8));
  }, rockTint));
  // far mesas and buttes
  const mesas = [mesa(11), mesa(12), mesa(13)];
  const far = placeAlong(ribbon, { every: 55, gap: 150, spread: 520, seed: 32, halfExtent: (rng) => 40 + rng() * 80, y: heightAt });
  group.add(instancedVariants(mesas, strata, far, (it, pos, q, sc) => {
    pos.set(it.p.x, it.p.y - 8, it.p.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28);
    sc.set(it.r, 40 + it.rng() * 100, it.r * (0.8 + it.rng() * 0.4));
  }));
  // boulders
  const rocks = [rock(21), rock(22), rock(23), rock(24, 3)];
  const boulderMat = standard(cliffSet(0xa8613f), { repeat: [1.5, 1], bumpScale: 0.2 });
  const bItems = placeAlong(ribbon, { every: 22, gap: 2, spread: 30, seed: 33, halfExtent: 3, y: heightAt });
  group.add(instancedVariants(rocks, boulderMat, bItems, (it, pos, q, sc) => {
    const r = 1.5 + it.rng() * 4;
    pos.set(it.p.x, it.p.y + r * 0.25, it.p.z);
    q.setFromEuler(new THREE.Euler(0, it.rng() * 6.28, 0));
    sc.set(r, r * (0.7 + it.rng() * 0.5), r);
  }));
  // scrub: cacti and dead trees on the flats
  const flat = (it) => terrain.slopeAt(it.p.x, it.p.z) < 0.35;
  const plants = placeAlong(ribbon, { every: 14, gap: 3, spread: 50, seed: 34, halfExtent: 1, y: heightAt }).filter(flat);
  const cacti = [cactusGeo(1), cactusGeo(2), cactusGeo(3)], trees = [deadTreeGeo(4), deadTreeGeo(5)];
  const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.9 }), treeMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 });
  fine.add(instancedVariants(cacti, cactusMat, plants.filter((_, i) => i % 3 !== 0), (it, pos, q, sc) => { pos.set(it.p.x, it.p.y - 0.2, it.p.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28); const s = 0.7 + it.rng() * 0.6; sc.set(s, s, s); }));
  fine.add(instancedVariants(trees, treeMat, plants.filter((_, i) => i % 3 === 0), (it, pos, q, sc) => { pos.set(it.p.x, it.p.y - 0.2, it.p.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28); const s = 0.8 + it.rng() * 0.7; sc.set(s, s, s); }));
  // talus: rubble around the foot of every near wall
  const talus = [];
  for (const it of near) for (let k = 0; k < 4; k++) {
    // outward from the road only (the slab's near face is next to the curb) and spread along it
    const out = it.r * (1.2 + it.rng() * 0.7), along = (it.rng() - 0.5) * it.r * 2.2;
    const x = it.p.x + it.f.right.x * it.sd * out + it.f.tangent.x * along, z = it.p.z + it.f.right.z * it.sd * out + it.f.tangent.z * along;
    talus.push({ x, z, y: heightAt(x, z), rng: it.rng });
  }
  group.add(instancedVariants(rocks, boulderMat, talus, (it, pos, q, sc) => { const r = 0.8 + it.rng() * 1.8; pos.set(it.x, it.y + r * 0.2, it.z); q.setFromEuler(new THREE.Euler(0, it.rng() * 6.28, 0)); sc.set(r, r * 0.7, r); }));
  // sandstone arches on the rim
  const arches = [archGeo(3), archGeo(4)];
  const archItems = placeAlong(ribbon, { every: 90, gap: 120, spread: 260, seed: 36, halfExtent: 30, y: heightAt }).filter((_, i) => i % 2 === 0);
  group.add(instancedVariants(arches, strata, archItems, (it, pos, q, sc) => { const w = 22 + it.rng() * 30; pos.set(it.p.x, it.p.y - w * 0.12, it.p.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28); sc.set(w, w * (0.6 + it.rng() * 0.3), w * 0.9); }));
  // birds over the river
  const birds = flock(14, { x: cx, z: cz }, 90, 46, { seed: 8 });
  fine.add(birds);
  // bridge pylons wherever the road flies over the ground
  const concrete = standard(concreteSet(0x9a8a78), { bumpScale: 0.12 });
  const pylons = [];
  for (let s = 10; s < ribbon.length; s += 20) {
    const f = frameAt(ribbon, s);
    const g = heightAt(f.pos.x, f.pos.z), h = f.pos.y - g - 1.3;
    if (h > 5) pylons.push(placed(pylonGeo(h + 2, 1.6), f.pos.x, g - 2, f.pos.z));
  }
  if (pylons.length) group.add(merged(pylons, concrete));
  // sponsor billboards on posts beside the road
  const bb = billboards(ribbon, { every: 190, seed: 5, y: heightAt });
  group.add(bb.ads, merged(bb.frames, standard(metalPlateSet(0x4a505c), { bumpScale: 0.05, metalness: 0.6, roughness: 0.5 })));
  // dust motes and heat haze
  const dust = particleField(500, { seed: 41, box: [180, 40, 180], colour: 0xffd9a0, size: 0.6, opacity: 0.22, drift: [3, 0, 1], map: glowSprite() });
  fine.add(dust);
  scene.add(group, fine);
  let t = 0;
  return {
    group, fine, terrain, sky,
    update(dt, camera) { t += dt; waterN.offset.set(t * 0.01, t * 0.006); dust.tick(dt, camera); birds.tick(dt); },
    setDetail(on) { fine.visible = on; },
    lighting: { effects: true }
  };
}
