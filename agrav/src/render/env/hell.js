// INFERNO BASIN — hellscape. A red desert basin under a smoke-red sky, ringed
// by erupting volcanoes; a lava lake under the causeway and a lava chasm under
// the jump, both glowing through the melt's crust; meteors streaking down and
// bursting on the plain; cinders rising, ash falling, mist in the hollows;
// black pterodactyls wheeling overhead; and a road that reads as cooling lava.
import * as THREE from 'three';
import { setupSky, placeAlong, instancedVariants, rockTint, merged, placed, particleField, fogCards, billboards, glowPools, swayMaterial } from './common.js';
import { glowSprite } from '../textures.js';
import { strataSet, sandSet, cliffSet, metalPlateSet, lavaSet, lavaMaterial, standard, triplanarBlended } from '../../../../shared/gfx/surfaces.js';
import { rock, mesa, cliffSlab, volcanoGeo, deadTreeGeo, pylonGeo } from '../props.js';
import { buildTerrain, corridor } from '../terrain.js';
import { fbm2, ridged2, smoothstep } from '../../../../shared/gfx/noise.js';
import { makePlume } from '../exhaust.js';
import { fireballMaterial, ringMaterial, trailMaterial, trailGeometry } from '../fxshaders.js';
import { makeRng } from '../../../../shared/sim/rng.js';

const LAVA_LEVEL = 10;
// world-space landmarks (the track is authored mirrored in x, so plan x = -442 is world +442)
const LAKE = { x: 0, z: 60, r: 270 };        // the lava lake the causeway crosses
const CHASM = { x: 442, z: 57, r: 70 };      // under the jump
const mixN = (a, b, t) => a + (b - a) * t;

/** the height field: a rolling red plain, basins under the melt, volcanic rims far out (cached per track) */
function terrainFor(ribbon, env) {
  const terrainMat = triplanarBlended(strataSet(env.strata), sandSet(env.sand), { tile: 30, normalScale: 1.0 });
  return buildTerrain(ribbon, {
    cacheKey: 'hell', cells: 200, pad: 420, corridor: { drop: 4, margin: 6, fade: 45 },
    profile(info) {
      const edge = Math.max(0, info.d - info.w / 2);
      const rim = smoothstep(120, 340, edge) * (30 + ridged2(info.x / 160, info.z / 160, { octaves: 4, seed: 11 }) * 70);
      let land = info.tySmooth - 6 + fbm2(info.x / 60, info.z / 60, { octaves: 4, seed: 12 }) * 9 + rim;
      const lake = 1 - smoothstep(LAKE.r * 0.55, LAKE.r, Math.hypot(info.x - LAKE.x, info.z - LAKE.z));
      const chasm = 1 - smoothstep(CHASM.r * 0.35, CHASM.r, Math.hypot(info.x - CHASM.x, info.z - CHASM.z));
      land = mixN(land, LAVA_LEVEL - 9 + fbm2(info.x / 25, info.z / 25, { octaves: 2, seed: 13 }) * 2, lake);
      land = mixN(land, LAVA_LEVEL - 12, chasm);
      return corridor(info, land);
    },
    colour(info, y, ny) { const ash = smoothstep(0.7, 0.95, ny) * 0.25; const n = fbm2(info.x / 40, info.z / 40, { octaves: 2, seed: 14 }) * 0.1; return [0.95 + n - ash * 0.4, 0.82 + n - ash * 0.3, 0.78 + n - ash * 0.2]; },
    blend: (info, y, ny) => smoothstep(0.7, 0.94, ny),
    material: terrainMat
  });
}

export function prewarmHell(ribbon, track) { const env = track.env; terrainFor(ribbon, env); strataSet(env.strata); sandSet(env.sand); cliffSet(0x2a1a16); lavaSet(0x140806, env.lava); lavaSet(0x1a0c08, env.lava, 32); metalPlateSet(0x3a2a26); }

/** black pterodactyls: a fork of common.js's flock with a long beak, a head crest, elbowed wings and a slow flap; each roams its own wandering circle */
function pteroFlock(n, centre, radius, height, { seed = 1, colour = 0x0a0608, size = 9 } = {}) {
  const rng = makeRng(seed);
  const birds = [];
  for (let i = 0; i < n; i++) birds.push({ a: rng() * 6.28, r: radius * (0.6 + rng() * 0.6), h: height + (rng() - 0.5) * 30, f: rng() * 6.28, s: size * (0.75 + rng() * 0.5), w: 0.07 + rng() * 0.07, dir: rng() < 0.5 ? 1 : -1 });
  const TRIS = 8;
  const pos = new Float32Array(n * TRIS * 9);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  let t = 0;
  const P = (o, k, a, b, c) => { pos[o + k * 9] = a[0]; pos[o + k * 9 + 1] = a[1]; pos[o + k * 9 + 2] = a[2]; pos[o + k * 9 + 3] = b[0]; pos[o + k * 9 + 4] = b[1]; pos[o + k * 9 + 5] = b[2]; pos[o + k * 9 + 6] = c[0]; pos[o + k * 9 + 7] = c[1]; pos[o + k * 9 + 8] = c[2]; };
  mesh.tick = (dt) => {
    t += dt;
    for (let i = 0; i < n; i++) {
      const b = birds[i], a = b.a + t * b.w * b.dir;
      const r = b.r + Math.sin(t * 0.13 + b.f) * 40;
      const cx = centre.x + Math.cos(a) * r, cz = centre.z + Math.sin(a) * r, cy = b.h + Math.sin(t * 0.31 + b.f) * 9;
      const dx = -Math.sin(a) * b.dir, dz = Math.cos(a) * b.dir;   // heading
      const wx = dz, wz = -dx;                                       // wing axis
      const flap = Math.sin(t * 2.2 + b.f) * 0.55, s = b.s;
      const pt = (fd, fw, fu) => [cx + dx * s * fd + wx * s * fw, cy + s * fu, cz + dz * s * fd + wz * s * fw];
      const o = i * TRIS * 9;
      const nose = pt(1.5, 0, 0), tail = pt(-1.3, 0, -0.05), beak = pt(2.7, 0, 0.05), crestA = pt(0.8, 0, 0.1), crestB = pt(0.1, 0, 0.75);
      P(o, 0, nose, tail, pt(0, 0.25, 0)); P(o, 1, nose, pt(0, -0.25, 0), tail);
      P(o, 2, beak, pt(1.4, 0.12, 0), pt(1.4, -0.12, 0.02));
      P(o, 3, crestA, crestB, pt(0.6, 0, 0));
      for (const sd of [1, -1]) {
        const elbow = pt(0.3, sd * 1.25, flap * 0.35), tip = pt(-0.5, sd * 2.7, flap * 1.25);
        P(o, sd > 0 ? 4 : 6, pt(0.4, 0, 0), elbow, pt(-0.9, sd * 0.8, flap * 0.15));
        P(o, sd > 0 ? 5 : 7, elbow, tip, pt(-0.7, sd * 1.6, flap * 0.6));
      }
    }
    geo.attributes.position.needsUpdate = true;
  };
  mesh.tick(0);
  return mesh;
}

export function buildHell(scene, ribbon, track) {
  const env = track.env;
  const group = new THREE.Group(), fine = new THREE.Group();
  const sunPos = { x: -600, y: 170, z: 900 };
  const sky = setupSky(scene, env, 0x1a0606, 0x7a2010, { glow: 0xff4a10, seed: 21, sunPos, sunDisc: { colour: 0xff5a20, size: 70 }, hemi: 0.9, hemiGround: 0x3a0c06 });
  scene.add(new THREE.HemisphereLight(0x2a0a08, 0xff3a10, 0.55));   // the melt lights everything from below

  const terrain = terrainFor(ribbon, env);
  terrain.mesh.name = 'terrain';
  group.add(terrain.mesh);
  const { heightAt } = terrain;
  const glow = glowSprite();
  const rng = makeRng(77);

  // ------------------------------------------------------------------ lava --
  const lavaMat = lavaMaterial(lavaSet(0x140806, env.lava), { repeat: [70, 70], flow: [0.0025, 0.0015], emissiveIntensity: 2.6 });
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(2800, 2800), lavaMat);
  lava.rotation.x = -Math.PI / 2; lava.position.set(LAKE.x, LAVA_LEVEL, LAKE.z); lava.name = 'lava'; lava.userData.noShadow = true;
  group.add(lava);
  const lakeLights = [];
  for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28; const l = new THREE.PointLight(env.lava, 45, 260, 1.6); l.position.set(LAKE.x + Math.cos(a) * LAKE.r * 0.5, LAVA_LEVEL + 6, LAKE.z + Math.sin(a) * LAKE.r * 0.5); group.add(l); lakeLights.push({ l, ph: i * 1.7 }); }
  // the road itself: cooling lava
  const road = scene.getObjectByName('road');
  const roadMat = lavaMaterial(lavaSet(0x1a0c08, env.lava, 32), { repeat: [1, 1], flow: [0, 0.012], emissiveIntensity: 1.9, vertexColors: true, metalness: 0.05, bumpScale: 0.08, normalScale: 1.0 });
  if (road) road.material = roadMat;

  // ------------------------------------------------------------- volcanoes --
  const strata = standard(strataSet(env.strata), { repeat: [3, 2], bumpScale: 0.3, normalScale: 1.2 });
  const cones = placeAlong(ribbon, { every: 110, gap: 260, spread: 420, seed: 51, halfExtent: (r) => 70 + r() * 50, y: heightAt }).filter((_, i) => i % 2 === 0).slice(0, 7);
  const coneGeos = [], craterDiscs = [], volcanoes = [];
  const fireGeo = new THREE.SphereGeometry(1, 14, 10);
  cones.forEach((it, i) => {
    const H = 90 + it.rng() * 90, rad = it.r * 2, yaw = it.rng() * 6.28;
    coneGeos.push(placed(volcanoGeo(60 + i), it.p.x, it.p.y - 12, it.p.z, yaw, rad, H, rad));
    const top = it.p.y - 12 + H * 0.84;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(rad * 0.24, 20), lavaMat); disc.rotation.x = -Math.PI / 2; disc.position.set(it.p.x, top, it.p.z); disc.userData.noShadow = true; craterDiscs.push(disc);
    const plume = makePlume(0x6a2410, rad * 0.16, i * 3); plume.rotation.x = -Math.PI / 2; plume.position.set(it.p.x, top + 2, it.p.z); plume.scale.set(1, 1, 120 + H * 0.8); plume.material.uniforms.heat.value = 0.22;
    const light = new THREE.PointLight(env.lava, 30, rad * 2.2, 1.4); light.position.set(it.p.x, top + 8, it.p.z);
    // a sprite over the crater: the disc alone is invisible from the road, four hundred metres away
    const craterGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: env.lava, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    craterGlow.position.set(it.p.x, top + 3, it.p.z); craterGlow.scale.set(rad * 0.9, rad * 0.6, 1);
    fine.add(plume); group.add(disc, light, craterGlow);
    volcanoes.push({ x: it.p.x, y: top, z: it.p.z, rad, plume, light, craterGlow, next: 3 + it.rng() * 8, phase: it.rng() * 6.28 });
  });
  if (coneGeos.length) group.add(merged(coneGeos, strata));

  // ------------------------------------------------- the mid-ground basin --
  // Without this the basin is an empty plain: the nearest scenery was 34 m out and the next thing
  // was a volcano at 420 m. Buttes, slabs and spires fill the 60-350 m band and give the horizon a
  // silhouette. All merged, so the whole band is one draw call.
  const farItems = placeAlong(ribbon, { every: 45, gap: 60, spread: 300, seed: 54, halfExtent: (r) => 12 + r() * 22, y: heightAt })
    .filter(it => it.p.y > LAVA_LEVEL - 2);
  const farGeos = [];
  for (const it of farItems) {
    const w = it.r, h = w * (0.7 + it.rng() * 1.5), yaw = it.rng() * 6.28, k = Math.floor(it.rng() * 3);
    if (k === 0) farGeos.push(placed(mesa(90 + (it.u * 7 | 0)), it.p.x, it.p.y - 2, it.p.z, yaw, w, h, w * (0.7 + it.rng() * 0.5)));
    else if (k === 1) farGeos.push(placed(cliffSlab(95 + (it.u * 5 | 0)), it.p.x, it.p.y - 1, it.p.z, yaw, w * 1.3, h * 0.8, w * 0.7));
    else farGeos.push(placed(rock(100 + (it.u * 6 | 0), 2, { elongate: 0.35 }), it.p.x, it.p.y + h * 0.15, it.p.z, yaw, w * 0.5, h * 1.3, w * 0.5));
  }
  if (farGeos.length) group.add(merged(farGeos, strata));

  // -------------------------------------------------------- rocks and scrub --
  const basalt = standard(cliffSet(0x2a1a16), { repeat: [1.5, 1], bumpScale: 0.2 });
  const rocks = [rock(71), rock(72), rock(73, 3)];
  const dry = (it) => it.p.y > LAVA_LEVEL + 1.5;
  const boulders = placeAlong(ribbon, { every: 20, gap: 2, spread: 34, seed: 52, halfExtent: 3, y: heightAt }).filter(dry);
  group.add(instancedVariants(rocks, basalt, boulders, (it, pos, q, sc) => { const r = 1.5 + it.rng() * 4; pos.set(it.p.x, it.p.y + r * 0.25, it.p.z); q.setFromEuler(new THREE.Euler(0, it.rng() * 6.28, 0)); sc.set(r, r * (0.7 + it.rng() * 0.5), r); }, rockTint));
  const heat = { value: 0 };   // a shared clock for everything that wavers in the heat
  // the lean is weighted by y**2 and these trunks run to eight metres, so the strength stays low
  const charred = swayMaterial(new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: 1 }), heat, 0.05, 'charred');
  const trees = placeAlong(ribbon, { every: 26, gap: 3, spread: 50, seed: 53, halfExtent: 1, y: heightAt }).filter(it => dry(it) && terrain.slopeAt(it.p.x, it.p.z) < 0.4);
  fine.add(instancedVariants([deadTreeGeo(4), deadTreeGeo(5), deadTreeGeo(6)], charred, trees, (it, pos, q, sc) => { pos.set(it.p.x, it.p.y - 0.2, it.p.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28); const s = 0.9 + it.rng() * 0.8; sc.set(s, s, s); }));
  // flows down the flanks: elongated rock in the melt material
  const flowGeos = [];
  for (const v of volcanoes) for (let k = 0; k < 3; k++) { const a = rng() * 6.28, len = v.rad * (0.5 + rng() * 0.4); const g = rock(80 + k, 2, { elongate: 0.4 }); flowGeos.push(placed(g, v.x + Math.cos(a) * v.rad * 0.55, v.y - 40, v.z + Math.sin(a) * v.rad * 0.55, a, 7, 6, len)); }
  if (flowGeos.length) { const fm = merged(flowGeos, lavaMat); fm.userData.noShadow = true; group.add(fm); }

  // ------------------------------------------- obsidian, fissures, falls --
  // glassy spires near the road: dark, but they catch the melt and read as shards
  const obsidian = new THREE.MeshStandardMaterial({ color: 0x120c12, roughness: 0.18, metalness: 0.35 });
  const spires = placeAlong(ribbon, { every: 34, gap: 5, spread: 48, seed: 55, halfExtent: 2, y: heightAt }).filter(dry);
  group.add(instancedVariants([rock(110, 1, { elongate: 0.22 }), rock(111, 1, { elongate: 0.3 })], obsidian, spires,
    (it, pos, q, sc) => { const r = 0.8 + it.rng() * 1.6, h = r * (3 + it.rng() * 4); pos.set(it.p.x, it.p.y + h * 0.35, it.p.z); q.setFromEuler(new THREE.Euler((it.rng() - 0.5) * 0.3, it.rng() * 6.28, (it.rng() - 0.5) * 0.3)); sc.set(r, h, r); }));

  // cracks in the plain with the melt showing through: thin strips laid flat on the height field
  const fissureGeos = [];
  for (const it of placeAlong(ribbon, { every: 30, gap: 14, spread: 200, seed: 56, halfExtent: 5, y: heightAt }).filter(dry)) {
    const a = it.rng() * 6.28, len = 14 + it.rng() * 46, wid = 0.5 + it.rng() * 1.6;
    const g = new THREE.PlaneGeometry(wid, len, 1, Math.max(2, len / 8 | 0));
    g.rotateX(-Math.PI / 2);
    // sag each strip onto the ground so it does not float over the undulations
    const a3 = g.attributes.position.array;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let i = 0; i < a3.length; i += 3) {
      const wx = it.p.x + a3[i] * ca - a3[i + 2] * sa, wz = it.p.z + a3[i] * sa + a3[i + 2] * ca;
      a3[i + 1] = heightAt(wx, wz) - it.p.y + 0.12;
    }
    g.computeVertexNormals();
    fissureGeos.push(placed(g, it.p.x, it.p.y, it.p.z, a));
  }
  if (fissureGeos.length) { const fz = merged(fissureGeos, lavaMat); fz.userData.noShadow = true; group.add(fz); }

  // lava falls: sheets pouring off the chasm lip and the lake wall, with a glow at the lip
  const fallMat = lavaMaterial(lavaSet(0x140806, env.lava), { repeat: [3, 10], flow: [0, 0.22], emissiveIntensity: 3.2 });
  const falls = new THREE.Group();
  const fallAt = (cx, cz, r, n, top) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28 + rng() * 0.6, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const h = Math.max(6, top - LAVA_LEVEL), w = 7 + rng() * 14;
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(w, h), fallMat);
      sheet.position.set(x, LAVA_LEVEL + h / 2, z);
      sheet.lookAt(cx, LAVA_LEVEL + h / 2, cz);
      sheet.userData.noShadow = true;
      falls.add(sheet);
      const lip = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: env.lava, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      lip.position.set(x, LAVA_LEVEL + h, z); lip.scale.set(w * 1.4, w * 0.8, 1); falls.add(lip);
    }
  };
  fallAt(CHASM.x, CHASM.z, CHASM.r * 0.9, 5, heightAt(CHASM.x + CHASM.r, CHASM.z) + 4);
  fallAt(LAKE.x, LAKE.z, LAKE.r * 0.97, 7, LAVA_LEVEL + 22);
  group.add(falls);

  // vents beside the road, breathing steam
  const fumaroles = [];
  for (const it of placeAlong(ribbon, { every: 90, gap: 9, spread: 40, seed: 57, halfExtent: 2, y: heightAt }).filter(dry)) {
    const pl = makePlume(0x6a5a52, 0.8 + it.rng() * 0.7, it.u * 9);
    pl.rotation.x = -Math.PI / 2; pl.position.set(it.p.x, it.p.y + 0.4, it.p.z);
    pl.scale.set(1, 1, 10 + it.rng() * 16); pl.material.uniforms.heat.value = 0.16;
    fine.add(pl); fumaroles.push({ pl, ph: it.rng() * 6.28, base: pl.scale.z });
  }

  // pools of ember light along the verge
  fine.add(glowPools(placeAlong(ribbon, { every: 46, gap: 3, spread: 5, seed: 58, halfExtent: 0, y: heightAt }).filter(dry),
    { colour: env.lava, scale: (it) => 9 + it.u * 8, opacity: 0.3 }));

  // pylons wherever the causeway flies over the melt, so the road reads as structure
  const pylonGeos = [];
  for (let i = 0; i < ribbon.count; i += 6) {
    const f = ribbon.frames[i];
    if (f.isLoop) continue;
    const g0 = heightAt(f.pos.x, f.pos.z);
    const h = f.pos.y - g0;
    if (h < 7) continue;
    for (const sd of [-1, 1]) {
      const t = sd * (f.width / 2 - 2.2);
      pylonGeos.push(placed(pylonGeo(h, 1.5), f.pos.x + f.right.x * t, g0, f.pos.z + f.right.z * t, Math.atan2(f.tangent.x, f.tangent.z)));
    }
  }
  if (pylonGeos.length) group.add(merged(pylonGeos, basalt));

  // ----------------------------------------------------- cinders, ash, mist --
  const cinders = particleField(900, { seed: 61, box: [160, 70, 160], colour: 0xff9a40, size: 0.45, opacity: 0.7, fall: -1.6, drift: [1.2, 0, 0.5], map: glow });
  const ash = particleField(600, { seed: 62, box: [200, 80, 200], colour: 0x3a2a26, size: 0.5, opacity: 0.5, fall: 2.2, drift: [2, 0, 1] });
  const mist = particleField(200, { seed: 63, box: [300, 24, 300], colour: 0x7a2a1a, size: 18, opacity: 0.07, drift: [1.5, 0, 0.6], map: glow });
  const haze = [];
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28; haze.push({ x: LAKE.x + Math.cos(a) * LAKE.r * 0.75, y: LAVA_LEVEL + 9, z: LAKE.z + Math.sin(a) * LAKE.r * 0.75 }); }
  haze.push({ x: CHASM.x, y: LAVA_LEVEL + 20, z: CHASM.z });
  fine.add(cinders, mist, fogCards(haze, { colour: 0xff5a20, opacity: 0.05, scale: [120, 40] }));
  group.add(ash);
  // distant streaks high in the sky
  const streaks = particleField(30, { seed: 64, box: [900, 500, 900], colour: 0xffb060, size: 4, opacity: 0.8, fall: 120, drift: [-60, 0, -20], map: glow, fixedY: 120 });
  fine.add(streaks);

  // -------------------------------------------------------------- meteors --
  const live = [];   // short-lived bursts: { obj, t, life, update, dispose }
  const spawn = (obj, life, update, dispose) => { scene.add(obj); live.push({ obj, t: 0, life, update, dispose }); };
  const coarse = []; for (let i = 0; i < ribbon.count; i += 3) coarse.push(ribbon.frames[i]);
  const nearRoad = (x, z) => { for (const q of coarse) { const dx = q.pos.x - x, dz = q.pos.z - z, need = q.width / 2 + 22; if (dx * dx + dz * dz < need * need) return true; } return false; };
  const impact = (p, size) => {
    const ball = new THREE.Mesh(fireGeo, fireballMaterial(rng() * 10)); ball.position.copy(p); ball.rotation.set(rng() * 3, rng() * 3, 0);
    spawn(ball, 0.75, (o, k) => { const s = size * (1 + Math.sqrt(k) * 4); o.scale.set(s, s, s); o.material.uniforms.t.value = k; }, () => ball.material.dispose());
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMaterial(0xff8a30)); ring.position.copy(p); ring.position.y += 0.4; ring.rotation.x = -Math.PI / 2;
    spawn(ring, 0.6, (o, k) => { const s = size * (3 + k * 14); o.scale.set(s, s, 1); o.material.uniforms.t.value = k; }, () => { ring.material.dispose(); ring.geometry.dispose(); });
    const flash = new THREE.PointLight(0xffa050, 90, size * 40, 1.5); flash.position.copy(p); flash.position.y += 4;
    spawn(flash, 0.5, (o, k) => { o.intensity = 90 * (1 - k); }, () => {});
    const n = 30, pts = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) { pts[i * 3] = p.x; pts[i * 3 + 1] = p.y; pts[i * 3 + 2] = p.z; vel.push(new THREE.Vector3(rng() - 0.5, rng() * 0.9, rng() - 0.5).multiplyScalar(size * 12 * (0.5 + rng()))); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const sp = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffb060, size: 0.6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    spawn(sp, 1.4, (o, k, dt) => { const a = o.geometry.attributes.position.array; for (let i = 0; i < n; i++) { vel[i].y -= 30 * dt; a[i * 3] += vel[i].x * dt; a[i * 3 + 1] += vel[i].y * dt; a[i * 3 + 2] += vel[i].z * dt; } o.geometry.attributes.position.needsUpdate = true; o.material.opacity = 1 - k; }, () => { g.dispose(); sp.material.dispose(); });
  };
  const meteors = [];
  const trailGeo = trailGeometry(3.2, 70);
  for (let i = 0; i < 6; i++) {
    const obj = new THREE.Object3D();
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffd0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); head.scale.set(9, 9, 1);
    const trail = new THREE.Mesh(trailGeo, trailMaterial(0xff7a20)); trail.frustumCulled = false;
    obj.add(head, trail); obj.visible = false; obj.userData.noShadow = true;
    fine.add(obj);
    meteors.push({ obj, trail, vel: new THREE.Vector3(), active: false, at: 1 + i * 0.7 });
  }
  const launch = (m, camera) => {
    let tx, tz; for (let tries = 0; tries < 8; tries++) { const a = rng() * 6.28, d = 60 + rng() * 260; tx = camera.position.x + Math.cos(a) * d; tz = camera.position.z + Math.sin(a) * d; if (!nearRoad(tx, tz)) break; if (tries === 7) return false; }
    const target = new THREE.Vector3(tx, heightAt(tx, tz), tz);
    const a = rng() * 6.28, d = 420 + rng() * 300;
    const from = new THREE.Vector3(target.x + Math.cos(a) * d, target.y + 380 + rng() * 160, target.z + Math.sin(a) * d);
    m.vel.copy(target).sub(from).normalize().multiplyScalar(190 + rng() * 80);
    m.obj.position.copy(from); m.obj.lookAt(from.clone().sub(m.vel)); m.obj.visible = true; m.active = true; m.target = target;
    return true;
  };

  // ------------------------------------------------------- pterodactyls --
  const pteros = [pteroFlock(6, { x: LAKE.x + 60, z: LAKE.z - 40 }, 220, 95, { seed: 31 }), pteroFlock(8, { x: -230, z: -260 }, 180, 120, { seed: 32, size: 8 })];
  fine.add(...pteros);

  // sponsor billboards on the flats
  const bb = billboards(ribbon, { every: 220, seed: 6, y: heightAt });
  group.add(bb.ads, merged(bb.frames, standard(metalPlateSet(0x3a2a26), { bumpScale: 0.05, metalness: 0.6, roughness: 0.5 })));

  scene.add(group, fine);
  let t = 0, detail = true;
  return {
    group, fine, terrain, sky,
    update(dt, camera) {
      t += dt;
      heat.value = t;
      lavaMat.userData.time.value = t; roadMat.userData.time.value = t; fallMat.userData.time.value = t;
      ash.tick(dt, camera);
      for (const { l, ph } of lakeLights) l.intensity = 40 + Math.sin(t * 1.9 + ph) * 9 + Math.sin(t * 5.3 + ph * 2) * 5;
      // the fine tier is hidden when the governor sheds detail, so do not pay to simulate it
      if (detail) {
        cinders.tick(dt, camera); mist.tick(dt, camera); streaks.tick(dt, camera);
        for (const p of pteros) p.tick(dt);
        for (const f of fumaroles) { f.pl.material.uniforms.time.value = t * 0.3 + f.ph; f.pl.scale.z = f.base * (0.8 + Math.sin(t * 0.5 + f.ph) * 0.25); }
      }
      for (const v of volcanoes) {
        v.plume.material.uniforms.time.value = t * 0.35 + v.phase;
        v.light.intensity = 24 + Math.sin(t * 3.1 + v.phase) * 6 + Math.sin(t * 7.3 + v.phase * 2) * 4;
        v.craterGlow.material.opacity = 0.62 + Math.sin(t * 2.3 + v.phase) * 0.16;
        v.next -= dt;
        if (v.next <= 0) {   // an eruption: a burst from the crater and a shower of lava bombs
          v.next = 6 + rng() * 9;
          impact(new THREE.Vector3(v.x, v.y + 6, v.z), v.rad * 0.12);
          const light = v.light; spawn(new THREE.Object3D(), 1.2, (o, k) => { light.intensity = 24 + (1 - k) * 160; }, () => {});
          v.plume.scale.z *= 1.35; v.plume.material.uniforms.heat.value = 0.7;
        }
        v.plume.scale.z += ((120 + v.rad * 0.55) - v.plume.scale.z) * Math.min(1, dt * 0.4);
        v.plume.material.uniforms.heat.value += (0.22 - v.plume.material.uniforms.heat.value) * Math.min(1, dt * 0.5);
      }
      for (const m of meteors) {
        if (!m.active) { m.at -= dt; if (m.at <= 0 && !launch(m, camera)) m.at = 1; continue; }
        m.obj.position.addScaledVector(m.vel, dt);
        m.trail.material.uniforms.time.value = t;
        if (m.obj.position.y <= m.target.y + 1.5) {
          impact(m.target, 5 + rng() * 4);
          m.active = false; m.obj.visible = false; m.at = 0.4 + rng() * 2.6;
        }
      }
      for (let i = live.length - 1; i >= 0; i--) {
        const e = live[i]; e.t += dt; const k = e.t / e.life;
        if (k >= 1) { scene.remove(e.obj); e.dispose(); live.splice(i, 1); continue; }
        e.update(e.obj, k, dt);
      }
    },
    setDetail(on) { fine.visible = on; detail = on; },
    lighting: { effects: true }
  };
}
