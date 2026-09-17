// MARE SELENE — the Moon. A cratered mare under a black sky with the Milky Way
// and the Earth hanging in it; hard sunlight and near-black shadows; sharp
// angular rock everywhere; glass-domed base clusters glowing from inside; an
// Apollo lander with its flag, one rover parked beside it and one out driving;
// a crashed saucer half buried in the regolith, still sparking.
import * as THREE from 'three';
import { setupSky, placeAlong, instancedVariants, rockTint, merged, placed, billboards } from './common.js';
import { cliffSet, sandSet, concreteSet, metalPlateSet, facadeSet, standard, triplanarBlended } from '../surfaces.js';
import { rock, domeGeo, loft, weld, displace, worldUv } from '../props.js';
import { buildTerrain, corridor } from '../terrain.js';
import { fbm2, fbm3, ridged2, voronoi2, smoothstep } from '../noise.js';
import { makePlume } from '../exhaust.js';
import { makeRng } from '../../../../shared/sim/rng.js';
import { mergeGeometries } from '../../../../shared/gfx/merge.js';

/** the height field: a gently rolling mare pocked with rimmed craters, highlands on the horizon (cached per track) */
function terrainFor(ribbon, env) {
  const terrainMat = triplanarBlended(cliffSet(env.rock), sandSet(env.regolith), { tile: 26, normalScale: 1.3 });
  const craters = (x, z) => {
    const c = voronoi2(x / 260, z / 260, 5);
    const d = c.f1 * 260, R = 60 + c.id * 90;
    const bowl = -(18 + c.id * 14) * (1 - smoothstep(R * 0.55, R, d));
    const rim = (8 + c.id * 6) * Math.exp(-(((d - R) / (R * 0.18)) ** 2));
    return bowl + rim;
  };
  return buildTerrain(ribbon, {
    cacheKey: 'moon', cells: 200, pad: 400, corridor: { drop: 3.5, margin: 6, fade: 45 },
    profile(info) {
      const edge = Math.max(0, info.d - info.w / 2);
      const high = smoothstep(180, 420, edge) * (20 + ridged2(info.x / 220, info.z / 220, { octaves: 4, seed: 9 }) * 70);
      const land = info.tySmooth - 3 + fbm2(info.x / 50, info.z / 50, { octaves: 4, seed: 8 }) * 6 + craters(info.x, info.z) * smoothstep(10, 60, edge) + high;
      return corridor(info, land);
    },
    colour(info, y, ny) { const d = 0.82 + fbm2(info.x / 30, info.z / 30, { octaves: 2, seed: 10 }) * 0.25; const dark = (1 - smoothstep(0.85, 0.98, ny)) * 0.12; return [d - dark, d - dark, d + 0.02 - dark]; },
    blend: (info, y, ny) => smoothstep(0.75, 0.94, ny),
    material: terrainMat
  });
}

export function prewarmMoon(ribbon, track) { const env = track.env; terrainFor(ribbon, env); cliffSet(env.rock); sandSet(env.regolith); concreteSet(0x9a9aa0); metalPlateSet(0x8a8e98); metalPlateSet(0xc9a03a); facadeSet(300, 0xffe9c0, 6, 10); }

/** the Earth: oceans, continents and cloud swirls painted from noise */
function earthTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d'), img = g.createImageData(256, 128), d = img.data;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 256; x++) {
    const u = x / 256, v = y / 128, i = (y * 256 + x) * 4;
    const land = smoothstep(0.08, 0.2, fbm2(u * 5, v * 3, { octaves: 5, seed: 41 }));
    const cloud = smoothstep(0.15, 0.5, fbm2(u * 9 + 3, v * 6, { octaves: 4, seed: 42 }));
    const ice = smoothstep(0.86, 0.96, Math.abs(v - 0.5) * 2);
    let r = 20 + land * 70, gg = 70 + land * 90, b = 170 - land * 110;
    r += (235 - r) * Math.max(cloud * 0.9, ice); gg += (238 - gg) * Math.max(cloud * 0.9, ice); b += (245 - b) * Math.max(cloud * 0.9, ice);
    d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** an angular boulder: a coarse icosphere pushed by noise, no smoothing */
function sharpRock(seed) {
  const g = weld(new THREE.IcosahedronGeometry(1, 1));
  const rng = makeRng(seed), o = rng() * 30;
  displace(g, (x, y, z) => { const n = fbm3(x * 1.1 + o, y * 1.1, z * 1.1 + o, { octaves: 2, seed }); const k = 0.35 * n + 0.1; return [x * k, y * k * (y < -0.3 ? 0.2 : 1.3), z * k]; });
  worldUv(g, 1.5, 1.5);
  return g;
}

/** the descent stage, ascent stage, legs and pads of an Apollo-style lander (base on y=0), split by material */
function landerGeo() {
  const gold = [], silver = [], dark = [];
  const octo = loft([{ p: 1.6, w: 2.1, h: 2.1, k: 2 }, { p: 3.4, w: 2.1, h: 2.1, k: 2 }], { axis: 'y', segments: 8 });
  gold.push(octo);
  const box = new THREE.BoxGeometry(2.4, 1.9, 2.4); box.translate(0, 4.4, 0); silver.push(box);
  const cabin = new THREE.SphereGeometry(1.3, 10, 8); cabin.translate(0, 5.2, 0.6); silver.push(cabin);
  const bell = new THREE.ConeGeometry(0.7, 1.4, 12, 1, true); bell.translate(0, 0.9, 0); dark.push(bell);
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.CylinderGeometry(0.12, 0.12, 4.4, 6); leg.translate(0, 2.2, 0); leg.rotateZ(0.62); leg.translate(1.7, 0, 0); leg.rotateY(a); gold.push(leg);
    const pad = new THREE.CylinderGeometry(0.9, 0.9, 0.25, 10); pad.translate(3.9, 0.12, 0); pad.rotateY(a); gold.push(pad);
    const strut = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5); strut.translate(0, 1.3, 0); strut.rotateZ(1.1); strut.translate(2.4, 1.6, 0); strut.rotateY(a); silver.push(strut);
  }
  const ant = new THREE.CylinderGeometry(0.04, 0.04, 1.8, 5); ant.translate(-1, 6.2, -0.8); silver.push(ant);
  const dish = new THREE.CircleGeometry(0.7, 12); dish.rotateX(-1.0); dish.translate(1.1, 5.9, -0.9); silver.push(dish);
  return { gold: mergeGeometries(gold), silver: mergeGeometries(silver), dark: mergeGeometries(dark) };
}

/** a rover: chassis, seats, dish, antenna and four wheels; the wheels come back separately so they can turn */
function roverMesh(bodyMat, wheelMat) {
  const g = new THREE.Group();
  const parts = [];
  const chassis = new THREE.BoxGeometry(3.4, 0.35, 2.1); chassis.translate(0, 0.95, 0); parts.push(chassis);
  for (const z of [-0.55, 0.55]) { const seat = new THREE.BoxGeometry(0.9, 0.5, 0.8); seat.translate(-0.3, 1.4, z); parts.push(seat); const back = new THREE.BoxGeometry(0.15, 0.8, 0.8); back.translate(-0.75, 1.75, z); parts.push(back); }
  const post = new THREE.CylinderGeometry(0.05, 0.05, 1.4, 5); post.translate(1.3, 1.8, 0); parts.push(post);
  const dish = new THREE.CircleGeometry(0.55, 12); dish.rotateX(-0.9); dish.translate(1.3, 2.5, 0); parts.push(dish);
  const ant = new THREE.CylinderGeometry(0.03, 0.03, 1.6, 4); ant.translate(-1.4, 1.9, -0.9); parts.push(ant);
  const tool = new THREE.BoxGeometry(0.9, 0.3, 0.9); tool.translate(-1.2, 1.28, 0.6); parts.push(tool);
  const body = mergeGeometries(parts); worldUv(body, 1, 1);
  g.add(new THREE.Mesh(body, bodyMat));
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 14); wheelGeo.rotateX(Math.PI / 2);
  for (const [x, z] of [[-1.15, -1.1], [1.15, -1.1], [-1.15, 1.1], [1.15, 1.1]]) { const w = new THREE.Mesh(wheelGeo, wheelMat); w.position.set(x, 0.5, z); g.add(w); wheels.push(w); }
  g.wheels = wheels;
  return g;
}

/** a flying saucer: a lofted disc with a cupola and a ring of lamps */
function saucerMesh(hullMat, lampMat) {
  const g = new THREE.Group();
  const disc = loft([{ p: 0, w: 1, h: 1 }, { p: 0.6, w: 6.2, h: 6.2 }, { p: 1.3, w: 6.8, h: 6.8 }, { p: 2.1, w: 4.6, h: 4.6 }, { p: 2.5, w: 2.4, h: 2.4 }], { axis: 'y', segments: 36 });
  worldUv(disc, 3, 3);
  const cup = new THREE.SphereGeometry(2.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2); cup.translate(0, 2.4, 0);
  g.add(new THREE.Mesh(disc, hullMat), new THREE.Mesh(cup, new THREE.MeshStandardMaterial({ color: 0x3a6a7a, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.7 })));
  const lamps = [];
  for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; const l = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lampMat); l.position.set(Math.cos(a) * 6.4, 1.3, Math.sin(a) * 6.4); g.add(l); lamps.push(l); }
  g.lamps = lamps;
  return g;
}

export function buildMoon(scene, ribbon, track) {
  const env = track.env;
  const group = new THREE.Group(), fine = new THREE.Group();
  const sunPos = { x: 900, y: 520, z: -400 };
  const sky = setupSky(scene, env, 0x000000, 0x000000, { stars: true, milkyway: true, seed: 5, sunPos, sunDisc: { colour: 0xffffff, size: 36 }, hemi: 0.12, hemiGround: 0x101014, amb: 0.3 });
  // the Earth, a little above the horizon
  const earth = new THREE.Mesh(new THREE.SphereGeometry(105, 32, 24), new THREE.MeshBasicMaterial({ map: earthTexture(), fog: false }));
  earth.position.set(-0.55, 0.36, 0.75).normalize().multiplyScalar(2100); earth.rotation.y = 1.2;
  scene.add(earth);

  const terrain = terrainFor(ribbon, env);
  terrain.mesh.name = 'terrain';
  group.add(terrain.mesh);
  const { heightAt, slopeAt } = terrain;
  const rng = makeRng(99);

  // ------------------------------------------------------------ sharp rock --
  const rockMat = standard(cliffSet(env.rock), { repeat: [1.5, 1], bumpScale: 0.25, normalScale: 1.4 });
  const rocks = [sharpRock(1), sharpRock(2), rock(3, 1), sharpRock(4), rock(5, 1)];
  const field = placeAlong(ribbon, { every: 11, gap: 2, spread: 44, seed: 41, halfExtent: 2.5, y: heightAt });
  group.add(instancedVariants(rocks, rockMat, field, (it, pos, q, sc) => { const r = 1 + it.rng() * 3.2; pos.set(it.p.x, it.p.y + r * 0.2, it.p.z); q.setFromEuler(new THREE.Euler(it.rng() * 0.5, it.rng() * 6.28, it.rng() * 0.5)); sc.set(r, r * (0.6 + it.rng() * 0.8), r); }, rockTint));
  const monoliths = placeAlong(ribbon, { every: 85, gap: 30, spread: 220, seed: 42, halfExtent: 8, y: heightAt });
  group.add(instancedVariants([sharpRock(6), sharpRock(7)], rockMat, monoliths, (it, pos, q, sc) => { const r = 6 + it.rng() * 10; pos.set(it.p.x, it.p.y + r * 0.3, it.p.z); q.setFromEuler(new THREE.Euler(it.rng() * 0.4, it.rng() * 6.28, it.rng() * 0.3)); sc.set(r, r * (1.4 + it.rng() * 1.4), r); }, rockTint));

  // ------------------------------------------------------------ moon base --
  const concrete = standard(concreteSet(0x9a9aa0), { bumpScale: 0.1 });
  const metal = standard(metalPlateSet(0x8a8e98), { bumpScale: 0.05, metalness: 0.7, roughness: 0.45 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.3, roughness: 0.06, metalness: 0, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4 });
  const frame = new THREE.MeshBasicMaterial({ color: 0xcfe8ff, wireframe: true, transparent: true, opacity: 0.3 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x8a94a0, emissive: 0xffe9c0, emissiveIntensity: 0.5, roughness: 0.9 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a2a5a, metalness: 0.6, roughness: 0.3 });
  const dome = domeGeo(28), domeFrame = domeGeo(14);
  const clusters = placeAlong(ribbon, { every: 250, gap: 48, spread: 90, seed: 43, halfExtent: 34, y: heightAt }).filter((_, i) => i % 2 === 0).slice(0, 4);
  const concreteGeos = [], metalGeos = [], panelGeos = [];
  const baseLights = [];
  clusters.forEach((it, ci) => {
    const n = 2 + it.rng.int(0, 2);
    const domes = [];
    for (let i = 0; i < n; i++) {
      const r = 10 + it.rng() * 12, a = it.rng() * 6.28, d = i === 0 ? 0 : 22 + it.rng() * 14;
      const x = it.p.x + Math.cos(a) * d, z = it.p.z + Math.sin(a) * d, y = heightAt(x, z) - 1;
      const m = new THREE.Mesh(dome, glass); m.position.set(x, y, z); m.scale.setScalar(r); m.userData.noShadow = true;
      const f = new THREE.Mesh(domeFrame, frame); f.position.set(x, y, z); f.scale.setScalar(r * 1.005); f.userData.noShadow = true;
      const fl = new THREE.Mesh(new THREE.CircleGeometry(r * 0.98, 32), floorMat); fl.rotation.x = -Math.PI / 2; fl.position.set(x, y + 0.4, z);
      const light = new THREE.PointLight(0xfff0d0, 30, r * 4.5, 1.6); light.position.set(x, y + r * 0.5, z);
      group.add(m, f, fl, light); baseLights.push(light);
      const ring = new THREE.TorusGeometry(r + 0.6, 0.9, 8, 40); ring.rotateX(Math.PI / 2); ring.translate(x, y + 0.5, z); concreteGeos.push(ring);
      // an airlock on the far side of the first dome, a mast on the biggest
      if (i === 0) { const lock = new THREE.CylinderGeometry(2.6, 2.6, 7, 14); lock.rotateZ(Math.PI / 2); lock.translate(r + 2.5, 2.6, 0); lock.rotateY(a + Math.PI); lock.translate(x, y, z); metalGeos.push(lock); }
      domes.push({ x, y, z, r });
    }
    for (let i = 1; i < domes.length; i++) {   // pressurised tubes between the domes
      const a = domes[0], b = domes[i], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      const tube = new THREE.CylinderGeometry(2.2, 2.2, len, 12); tube.rotateZ(Math.PI / 2); tube.rotateY(-Math.atan2(dz, dx)); tube.translate((a.x + b.x) / 2, Math.max(a.y, b.y) + 2.2, (a.z + b.z) / 2); metalGeos.push(tube);
    }
    const big = domes.reduce((m, d) => (d.r > m.r ? d : m), domes[0]);
    const mast = new THREE.CylinderGeometry(0.3, 0.45, 26, 8); mast.translate(big.x + big.r + 4, big.y + 13, big.z); metalGeos.push(mast);
    const dish = new THREE.CircleGeometry(4, 16); dish.rotateX(-0.7); dish.rotateY(it.rng() * 6.28); dish.translate(big.x + big.r + 4, big.y + 25, big.z); metalGeos.push(dish);
    for (let k = 0; k < 4; k++) {   // a solar array
      const px = big.x - big.r - 8 - k * 7, pz = big.z + (k % 2 ? 6 : -6), py = heightAt(px, pz);
      const post = new THREE.CylinderGeometry(0.2, 0.25, 3, 6); post.translate(px, py + 1.5, pz); metalGeos.push(post);
      const panel = new THREE.BoxGeometry(9, 0.2, 4.5); panel.rotateX(-0.55); panel.translate(px, py + 3.4, pz); panelGeos.push(panel);
    }
    void ci;
  });
  if (concreteGeos.length) group.add(merged(concreteGeos, concrete));
  if (metalGeos.length) group.add(merged(metalGeos, metal));
  if (panelGeos.length) group.add(merged(panelGeos, panelMat));

  // ------------------------------------------------------ lander and rovers --
  const gold = standard(metalPlateSet(0xc9a03a), { repeat: [2, 2], bumpScale: 0.05, metalness: 0.85, roughness: 0.35 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xd8d8dc, metalness: 0.8, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.5, roughness: 0.6 });
  const flats = placeAlong(ribbon, { every: 60, gap: 22, spread: 30, seed: 44, halfExtent: 7, y: heightAt }).filter(it => slopeAt(it.p.x, it.p.z) < 0.12);
  const site = flats[Math.floor(flats.length * 0.6)] || flats[0];
  const rovers = [];
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x9a9aa0, metalness: 0.6, roughness: 0.5, wireframe: true });
  if (site) {
    const lg = landerGeo();
    const lander = new THREE.Group();
    lander.add(new THREE.Mesh(lg.gold, gold), new THREE.Mesh(lg.silver, silver), new THREE.Mesh(lg.dark, dark));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 5), silver); pole.position.set(-5.5, 1.5, 2);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshBasicMaterial({ color: 0xff3a3a, side: THREE.DoubleSide })); flag.position.set(-4.8, 2.6, 2);
    lander.add(pole, flag);
    lander.position.set(site.p.x, site.p.y - 0.1, site.p.z); lander.rotation.y = site.rng() * 6.28;
    group.add(lander);
    const r1 = roverMesh(silver, wheelMat); r1.position.set(site.p.x + 12, site.p.y, site.p.z + 6); r1.rotation.y = 0.7; group.add(r1);
    const r2 = roverMesh(silver, wheelMat); group.add(r2);
    rovers.push({ mesh: r2, cx: site.p.x + site.f.right.x * site.sd * 40, cz: site.p.z + site.f.right.z * site.sd * 40, r: 34, a: 0, w: 0.16 });
    // wheel tracks: a dark ring where the rover drives
    const tracks = new THREE.Mesh(new THREE.RingGeometry(31, 37, 48), new THREE.MeshBasicMaterial({ color: 0x2a2a30, transparent: true, opacity: 0.35, depthWrite: false }));
    tracks.rotation.x = -Math.PI / 2; tracks.position.set(rovers[0].cx, heightAt(rovers[0].cx, rovers[0].cz) + 0.15, rovers[0].cz); fine.add(tracks);
  }

  // ------------------------------------------------------------ crashed UFO --
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x6affe0 });
  const hull = new THREE.MeshStandardMaterial({ color: 0x9aa4b4, metalness: 0.9, roughness: 0.25 });
  const crash = flats[Math.floor(flats.length * 0.25)] || flats[flats.length - 1];
  let ufo = null, ufoLight = null, ufoSmoke = null;
  if (crash) {
    ufo = saucerMesh(hull, lampMat);
    ufo.position.set(crash.p.x, crash.p.y - 1.3, crash.p.z); ufo.rotation.set(0.42, crash.rng() * 6.28, 0.22);
    group.add(ufo);
    const shards = [];
    for (let i = 0; i < 9; i++) { const a = crash.rng() * 6.28, d = 6 + crash.rng() * 14; const s = new THREE.BoxGeometry(1 + crash.rng() * 2, 0.2, 0.6 + crash.rng()); shards.push(placed(s, crash.p.x + Math.cos(a) * d, heightAt(crash.p.x + Math.cos(a) * d, crash.p.z + Math.sin(a) * d) + 0.1, crash.p.z + Math.sin(a) * d, crash.rng() * 6.28)); }
    group.add(merged(shards, hull));
    const furrow = new THREE.Mesh(new THREE.PlaneGeometry(14, 60), new THREE.MeshBasicMaterial({ color: 0x3a3a40, transparent: true, opacity: 0.4, depthWrite: false }));
    furrow.rotation.x = -Math.PI / 2; furrow.rotation.z = crash.rng() * 6.28; furrow.position.set(crash.p.x, crash.p.y + 0.12, crash.p.z); fine.add(furrow);
    ufoLight = new THREE.PointLight(0x6affe0, 12, 40, 1.6); ufoLight.position.set(crash.p.x, crash.p.y + 3, crash.p.z); group.add(ufoLight);
    ufoSmoke = makePlume(0x8a8a90, 1.4, 5); ufoSmoke.rotation.x = -Math.PI / 2; ufoSmoke.position.set(crash.p.x + 2, crash.p.y + 1.5, crash.p.z - 1); ufoSmoke.scale.set(1, 1, 22); ufoSmoke.material.uniforms.heat.value = 0.2; fine.add(ufoSmoke);
  }
  const live = [];
  const sparks = (p) => {
    const n = 18, pts = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) { pts[i * 3] = p.x; pts[i * 3 + 1] = p.y; pts[i * 3 + 2] = p.z; vel.push(new THREE.Vector3(rng() - 0.5, rng() * 0.8, rng() - 0.5).multiplyScalar(6 + rng() * 8)); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const sp = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fffee, size: 0.25, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    scene.add(sp); live.push({ obj: sp, t: 0, life: 0.9, vel, n });
  };
  let sparkAt = 2;

  // sponsor boards
  const bb = billboards(ribbon, { every: 240, seed: 7, y: heightAt });
  group.add(bb.ads, merged(bb.frames, metal));

  scene.add(group, fine);
  let t = 0;
  return {
    group, fine, terrain, sky,
    update(dt, camera) {
      t += dt;
      for (const r of rovers) {
        r.a += r.w * dt;
        const x = r.cx + Math.cos(r.a) * r.r, z = r.cz + Math.sin(r.a) * r.r, nx = r.cx + Math.cos(r.a + 0.05) * r.r, nz = r.cz + Math.sin(r.a + 0.05) * r.r;
        r.mesh.position.set(x, heightAt(x, z) + 0.05, z); r.mesh.lookAt(nx, heightAt(nx, nz) + 0.05, nz); r.mesh.rotateY(-Math.PI / 2);
        for (const w of r.mesh.wheels) w.rotation.z -= (r.w * r.r / 0.5) * dt;
      }
      if (ufo) {
        const on = Math.floor(t * 6) % 14;
        ufo.lamps.forEach((l, i) => { l.visible = ((i + on) % 7) < 3 || rng() < 0.02; });
        ufoLight.intensity = 8 + Math.sin(t * 11) * 4 + (rng() < 0.04 ? 30 : 0);
        ufoSmoke.material.uniforms.time.value = t * 0.4;
        sparkAt -= dt; if (sparkAt <= 0) { sparkAt = 1.5 + rng() * 4; sparks(new THREE.Vector3(ufo.position.x + 3, ufo.position.y + 2.5, ufo.position.z + 2)); }
      }
      for (const l of baseLights) l.intensity = 30 + Math.sin(t * 0.7 + l.position.x) * 3;
      for (let i = live.length - 1; i >= 0; i--) {
        const e = live[i]; e.t += dt; const k = e.t / e.life;
        if (k >= 1) { scene.remove(e.obj); e.obj.geometry.dispose(); e.obj.material.dispose(); live.splice(i, 1); continue; }
        const a = e.obj.geometry.attributes.position.array;
        for (let j = 0; j < e.n; j++) { e.vel[j].y -= 5 * dt; a[j * 3] += e.vel[j].x * dt; a[j * 3 + 1] += e.vel[j].y * dt; a[j * 3 + 2] += e.vel[j].z * dt; }
        e.obj.geometry.attributes.position.needsUpdate = true; e.obj.material.opacity = 1 - k;
      }
      void camera;
    },
    setDetail(on) { fine.visible = on; },
    lighting: { effects: true }
  };
}
