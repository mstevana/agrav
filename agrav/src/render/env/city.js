// NEON MERIDIAN — night city. Tiered, round and stepped towers with lit,
// recessed window grids and rooftop clutter; wall screens running adverts of
// every kind; vertical neon signs and rooftop crowns; a skytrain weaving on a
// suspended guideway above the expressway; lanes of flying traffic higher up;
// searchlights, drones, cables, holo billboards, wet streets, rain and mist.
// Everything that moves stays above the road or beyond the barriers.
import * as THREE from 'three';
import { setupSky, placeAlong, instanced, ground, merged, placed, particleField, fogCards } from './common.js';
import { glowSprite, holoTexture, adTexture, neonSignTexture, sponsorAdTexture, SPONSOR_IDS } from '../textures.js';
import { asphaltSet, facadeSet, concreteSet, metalPlateSet, standard } from '../../../../shared/gfx/surfaces.js';
import { tower, towerDressing, pylonGeo, lampPostGeo, sweep, frameRuns } from '../props.js';
import { frameQuat } from '../track.js';
import { frameAt } from '../../../../shared/sim/spline.js';
import { makeRng } from '../../../../shared/sim/rng.js';
import { mergeGeometries } from '../../../../shared/gfx/merge.js';

const GROUND = -22;
const FACADES = 6;
const facadeSpec = (env, i) => [100 + i, env.neon[i % env.neon.length], 5 + (i % 4), 12 + i * 2];

export function prewarmCity(ribbon, track) { const env = track.env; asphaltSet(0x1c2030, 0x0e1018, true); concreteSet(0x5c5e66); metalPlateSet(0x3e4450); for (let i = 0; i < FACADES; i++) facadeSet(...facadeSpec(env, i)); }

/** the skytrain guideway weaves above the road: lateral and height as functions of s */
const railT = (s) => 11 * Math.sin(s / 170) + 3 * Math.sin(s / 61);
const railH = (s) => 31 + 5 * Math.sin(s / 240);

export function buildCity(scene, ribbon, track) {
  const env = track.env;
  const group = new THREE.Group(), fine = new THREE.Group();
  const sky = setupSky(scene, env, 0x05061a, 0x1a1f45, { stars: true, nebula: true, glow: 0x3a2660, seed: 3 });
  // street level glow so the surface and the craft read at night
  scene.add(new THREE.HemisphereLight(0x2a3a6a, 0x101830, 1.2));
  const street = standard(asphaltSet(0x1c2030, 0x0e1018, true), { repeat: [750, 750], bumpScale: 0.05, metalness: 0.35 });
  ground(scene, GROUND, street);

  const concrete = standard(concreteSet(0x5c5e66), { bumpScale: 0.12 });
  const metal = standard(metalPlateSet(0x3e4450), { bumpScale: 0.05, metalness: 0.6 });
  const facades = []; for (let i = 0; i < FACADES; i++) facades.push(standard(facadeSet(...facadeSpec(env, i)), { bumpScale: 0.1, emissiveIntensity: 1.1 }));
  const glow = glowSprite();
  const neonMat = env.neon.map(c => new THREE.MeshBasicMaterial({ color: c }));

  // ---------------------------------------------------------------- towers --
  const towerHalf = (rng) => 7 + rng() * 11;      // half of a 14–36 m footprint
  const lists = facades.map(() => []), dress = { concrete: [], metal: [] }, roofNeon = env.neon.map(() => []);
  const layers = [
    placeAlong(ribbon, { every: 22, gap: 4, spread: 20, seed: 3, halfExtent: towerHalf }),
    placeAlong(ribbon, { every: 30, gap: 40, spread: 70, seed: 4, halfExtent: towerHalf }),
    placeAlong(ribbon, { every: 40, gap: 110, spread: 160, seed: 5, halfExtent: towerHalf })
  ];
  const tops = [], screens = [], signs = [], tall = [], nearTowers = [], clutter = env.neon.map(() => []);
  const yawOf = (it) => it.rng() * 0.3;
  layers.forEach((items, li) => items.forEach((it, i) => {
    const w = it.r * 2, d = Math.min(it.r * 2, it.r * (1.4 + it.rng() * 1.2)), h = 40 + it.rng() * (90 + li * 60);
    const kind = it.rng() < 0.18 ? 1 : it.rng() < 0.2 ? 2 : 0;
    const yaw = yawOf(it);
    lists[i % FACADES].push(placed(tower(w, d, h, it.rng, 24, 48, kind), it.p.x, GROUND, it.p.z, yaw));
    if (li === 0) { tops.push({ x: it.p.x, y: GROUND + h, z: it.p.z }); nearTowers.push({ x: it.p.x, z: it.p.z, h, sd: it.sd, s: it.s, f: it.f }); }
    // ledges every few storeys give the megablocks their stepped, balconied faces
    if (kind === 0 && li < 2) for (let y = 16; y < h - 8; y += 18) { const l = new THREE.BoxGeometry(w + 1.2, 0.6, d + 1.2); l.translate(0, y, 0); dress.concrete.push(placed(l, it.p.x, GROUND, it.p.z, yaw)); }
    if (li === 1) tops.push({ x: it.p.x, y: GROUND + h * 0.5, z: it.p.z, far: true });
    if (h > 120 && li < 2) tall.push({ x: it.p.x, y: GROUND + h, z: it.p.z, rng: it.rng });
    const out = { concrete: [], metal: [] };
    towerDressing(w, d, h, it.rng, out);
    if (li === 0) {
      for (const g of out.concrete) dress.concrete.push(placed(g, it.p.x, GROUND, it.p.z, yaw));
      for (const g of out.metal) dress.metal.push(placed(g, it.p.x, GROUND, it.p.z, yaw));
      const ni = i % env.neon.length;
      if (kind === 1) {
        const ring = new THREE.TorusGeometry(Math.min(w, d) / 2 + 0.6, 0.35, 6, 28); ring.rotateX(Math.PI / 2); ring.translate(0, h + 0.8, 0);
        roofNeon[ni].push(placed(ring, it.p.x, GROUND, it.p.z, yaw));
      } else {
        for (const sz of [1, -1]) { const s = new THREE.BoxGeometry(w + 0.4, 0.22, 0.22); s.translate(0, h + 1.5, sz * (d / 2 + 0.15)); roofNeon[ni].push(placed(s, it.p.x, GROUND, it.p.z, yaw)); }
      }
    } else {
      dress.concrete.push(placed(out.concrete[out.concrete.length - 1], it.p.x, GROUND, it.p.z, yaw));   // just the plinth
    }
    // the face toward the road: wall screens and vertical signs hang on it
    if (kind !== 1 && li < 2) {
      const nx = -it.f.right.x * it.sd, nz = -it.f.right.z * it.sd;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const lx = nx * cy - nz * sy, lz = nx * sy + nz * cy;   // road direction in the tower's frame
      let faceW, half, ln;
      if (Math.abs(lx) > Math.abs(lz)) { faceW = d; half = w / 2; ln = [Math.sign(lx), 0]; } else { faceW = w; half = d / 2; ln = [0, Math.sign(lz)]; }
      const wn = { x: ln[0] * cy + ln[1] * sy, z: -ln[0] * sy + ln[1] * cy };   // face normal back in world
      const cxw = it.p.x + wn.x * (half + 0.6), czw = it.p.z + wn.z * (half + 0.6);
      const r = it.rng();
      if (r < 0.55 && h > 48) {
        const sw = Math.min(faceW * 0.86, h > 110 ? 56 : 40), sh = sw * 0.5;
        screens.push({ x: cxw, z: czw, y: GROUND + 24 + it.rng() * Math.max(6, h - 40 - sh), w: sw, h: sh, n: wn, seed: i * 3 + li, colour: env.neon[(i + li) % env.neon.length] });
      }
      if (li === 0) {
        const px = -wn.z, pz = wn.x;
        const nSign = 3 + it.rng.int(0, 4);
        for (let k = 0; k < nSign; k++) {
          const off = (it.rng() - 0.5) * faceW * 0.8, y = GROUND + 4 + it.rng() * 26, sw = 1.5 + it.rng() * 3, shh = 0.8 + it.rng() * 1.6;
          const b = new THREE.BoxGeometry(sw, shh, 0.3);
          b.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(cxw + px * off + wn.x * 0.3, y, czw + pz * off + wn.z * 0.3), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(wn.x, 0, wn.z).normalize()), new THREE.Vector3(1, 1, 1)));
          clutter[it.rng.int(0, env.neon.length - 1)].push(b);
        }
      }
      if (r >= 0.55 && r < 0.85) {
        const off = (it.rng() - 0.5) * faceW * 0.6;
        const px = -wn.z, pz = wn.x;   // along the face
        signs.push({ x: cxw + px * off, z: czw + pz * off, y: GROUND + 10 + it.rng() * 14, n: wn, seed: i + li * 7, colour: env.neon[(i * 5 + li) % env.neon.length] });
      }
    }
  }));
  // moonlight through a forest of towers would blacken the road: the towers receive shadows but cast none
  lists.forEach((l, i) => { const m = merged(l, facades[i]); if (m) { m.userData.noShadow = true; group.add(m); } });
  env.neon.forEach((c, i) => { const m = merged(roofNeon[i], neonMat[i]); if (m) group.add(m); });
  env.neon.forEach((c, i) => { const m = merged(clutter[i], neonMat[i]); if (m) group.add(m); });
  // glass sky bridges between facing towers, high over the road
  const bridges = [], ribs = [];
  const bySide = [nearTowers.filter(t => t.sd > 0 && t.h > 70), nearTowers.filter(t => t.sd < 0 && t.h > 70)];
  let lastBridge = -1e9;
  for (const a of bySide[0]) {
    if (a.s - lastBridge < 170) continue;
    const b = bySide[1].find(t => Math.abs(t.s - a.s) < 25);
    if (!b) continue;
    lastBridge = a.s;
    const y = Math.max(a.f.pos.y + 30, GROUND + Math.min(a.h, b.h) * 0.55);
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
    const mid = new THREE.Vector3((a.x + b.x) / 2, y, (a.z + b.z) / 2), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    const tube = new THREE.BoxGeometry(3.6, 3.6, len); tube.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1))); bridges.push(tube);
    for (let k = -len / 2 + 3; k < len / 2; k += 6) { const rib = new THREE.BoxGeometry(4, 4, 0.5); rib.translate(0, 0, k); rib.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1))); ribs.push(rib); }
    const floor = new THREE.BoxGeometry(3.8, 0.3, len); floor.translate(0, -1.7, 0); floor.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1))); ribs.push(floor);
  }
  if (bridges.length) {
    const glass = new THREE.Mesh(mergeGeometries(bridges), new THREE.MeshStandardMaterial({ color: 0x9fd0ff, emissive: 0x2df1ff, emissiveIntensity: 0.25, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.2, depthWrite: false }));
    glass.frustumCulled = false; glass.userData.noShadow = true; group.add(glass);
    group.add(merged(ribs, metal));
  }

  // ----------------------------------------------------------- wall screens --
  const screenMats = [];
  const screenFrames = [];
  screens.forEach((sc, i) => {
    // every screen alternates a generic advert with a sponsor spot
    const t0 = adTexture(sc.seed, sc.colour).clone(), t1 = sponsorAdTexture(SPONSOR_IDS[(sc.seed * 5 + i) % SPONSOR_IDS.length], i % 2).clone();
    t0.needsUpdate = t1.needsUpdate = true;
    const m = new THREE.MeshBasicMaterial({ map: t0, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sc.w, sc.h), m);
    mesh.position.set(sc.x, sc.y, sc.z);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(sc.n.x, 0, sc.n.z).normalize());
    group.add(mesh);
    screenMats.push({ m, t0, t1, ticker: sc.seed % 6 === 4, period: 3 + (i % 4), phase: i * 0.7 });
    const fr = new THREE.BoxGeometry(sc.w + 1.2, sc.h + 1.2, 0.8); fr.translate(0, 0, -0.45);
    fr.applyMatrix4(new THREE.Matrix4().compose(mesh.position, mesh.quaternion, new THREE.Vector3(1, 1, 1)));
    screenFrames.push(fr);
    // a glow pool under the screen
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: sc.colour, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.set(sc.x + sc.n.x * 3, sc.y, sc.z + sc.n.z * 3); sp.scale.set(sc.w * 1.3, sc.h * 1.6, 1); fine.add(sp);
  });
  if (screenFrames.length) group.add(merged(screenFrames, metal));
  // vertical neon signs
  for (const sg of signs) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 24), new THREE.MeshBasicMaterial({ map: neonSignTexture(sg.seed, sg.colour), toneMapped: false }));
    mesh.position.set(sg.x, sg.y + 12, sg.z);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(sg.n.x, 0, sg.n.z).normalize());
    group.add(mesh);
  }

  // ------------------------------------------- expressway pylons and tunnel --
  const pylons = [], underLights = [];
  for (let s = 12; s < ribbon.length; s += 24) {
    const f = frameAt(ribbon, s);
    const h = f.pos.y - GROUND - 1.3;
    if (h < 3) continue;
    pylons.push(placed(pylonGeo(h, 1.5), f.pos.x, GROUND, f.pos.z));
    const beam = new THREE.BoxGeometry(f.width + 3, 1.6, 2);
    beam.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(f.pos.x - f.up.x * 2.1, f.pos.y - f.up.y * 2.1, f.pos.z - f.up.z * 2.1), frameQuat(f), new THREE.Vector3(1, 1, 1)));
    dress.concrete.push(beam);
    // service lights along the deck's underside, so the ramp reads as structure from below
    const ul = new THREE.BoxGeometry(f.width * 0.8, 0.25, 0.6);
    ul.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(f.pos.x - f.up.x * 1.45, f.pos.y - f.up.y * 1.45, f.pos.z - f.up.z * 1.45), frameQuat(f), new THREE.Vector3(1, 1, 1)));
    underLights.push(ul);
  }
  group.add(merged(pylons, concrete));
  group.add(merged(underLights, new THREE.MeshBasicMaterial({ color: 0xffd9a0 })));
  for (const [i0, i1] of frameRuns(ribbon, f => f.width < track.width - 5.5)) {
    const a = (i0 - 4 + ribbon.count) % ribbon.count, b = (i1 + 4) % ribbon.count;
    const tube = new THREE.Mesh(sweep(ribbon, a, b, [
      { t: (f) => -f.width / 2 - 2.5, h: -2 }, { t: (f) => -f.width / 2 - 2.5, h: 7.5 }, { t: (f) => -f.width / 2 - 1, h: 9 },
      { t: (f) => f.width / 2 + 1, h: 9 }, { t: (f) => f.width / 2 + 2.5, h: 7.5 }, { t: (f) => f.width / 2 + 2.5, h: -2 }
    ], { uvScale: 6, closeProfile: true }), concrete.clone());
    tube.material.side = THREE.DoubleSide;
    tube.frustumCulled = false;
    group.add(tube);
    const lights = [];
    for (let i = a; i !== b; i = (i + 6) % ribbon.count) { const f = ribbon.frames[i]; const l = new THREE.BoxGeometry(1.2, 0.2, 4); l.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(f.pos.x + f.up.x * 8.6, f.pos.y + f.up.y * 8.6, f.pos.z + f.up.z * 8.6), frameQuat(f), new THREE.Vector3(1, 1, 1))); lights.push(l); }
    group.add(merged(lights, new THREE.MeshBasicMaterial({ color: 0xdfe8ff })));
  }

  // -------------------------------------------------------------- skytrain --
  const n = ribbon.count;
  const rail = new THREE.Mesh(sweep(ribbon, 0, n - 1, [
    { t: (f) => railT(f.s) - 1.7, h: (f) => railH(f.s) }, { t: (f) => railT(f.s) - 1.7, h: (f) => railH(f.s) + 1.5 }, { t: (f) => railT(f.s) - 1.2, h: (f) => railH(f.s) + 1.5 },
    { t: (f) => railT(f.s) - 1.2, h: (f) => railH(f.s) + 0.4 }, { t: (f) => railT(f.s) + 1.2, h: (f) => railH(f.s) + 0.4 }, { t: (f) => railT(f.s) + 1.2, h: (f) => railH(f.s) + 1.5 },
    { t: (f) => railT(f.s) + 1.7, h: (f) => railH(f.s) + 1.5 }, { t: (f) => railT(f.s) + 1.7, h: (f) => railH(f.s) }
  ], { uvScale: 4, closeProfile: true }), metal.clone());
  rail.material.side = THREE.DoubleSide; rail.frustumCulled = false; rail.name = 'skyrail';
  group.add(rail);
  const railLight = new THREE.Mesh(sweep(ribbon, 0, n - 1, [{ t: (f) => railT(f.s) - 1.2, h: (f) => railH(f.s) - 0.05 }, { t: (f) => railT(f.s) + 1.2, h: (f) => railH(f.s) - 0.05 }], { uvScale: 4 }), new THREE.MeshBasicMaterial({ color: env.neon[1], side: THREE.DoubleSide }));
  railLight.frustumCulled = false; group.add(railLight);
  // support arms from columns beside the road (never on it)
  const arms = [];
  for (let s = 30; s < ribbon.length - 20; s += 64) {
    const f = frameAt(ribbon, s), rt = railT(s), rh = railH(s);
    const sd = rt >= 0 ? 1 : -1, ct = sd * (f.width / 2 + 4.5);
    const cx = f.pos.x + f.right.x * ct, cz = f.pos.z + f.right.z * ct;
    const col = new THREE.CylinderGeometry(0.9, 1.1, rh + 2 + (f.pos.y - GROUND), 10); col.translate(cx, GROUND + (rh + 2 + f.pos.y - GROUND) / 2, cz); arms.push(col);
    const len = Math.abs(ct - rt) + 1;
    const arm = new THREE.BoxGeometry(len, 1, 1.4); arm.translate(-(ct - rt) / 2 * sd * sd + 0, 0, 0);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(f.pos.x + f.right.x * (ct + rt) / 2, f.pos.y + rh + 1.9, f.pos.z + f.right.z * (ct + rt) / 2), frameQuat(f), new THREE.Vector3(1, 1, 1));
    const armG = new THREE.BoxGeometry(len, 1, 1.4); armG.applyMatrix4(m); arms.push(armG);
  }
  group.add(merged(arms, concrete));
  // two trains, five cars each, opposite directions
  const carLen = 12, gap = 1.2;
  const trains = [{ s: 200, dir: 1, speed: 46 }, { s: ribbon.length * 0.6, dir: -1, speed: 42 }];
  const carItems = []; trains.forEach((tr, ti) => { for (let k = 0; k < 5; k++) carItems.push({ tr, k }); });
  const bodyGeo = new THREE.BoxGeometry(3.2, 3.2, carLen - gap); bodyGeo.translate(0, 1.6, 0);
  const winGeo = new THREE.BoxGeometry(3.3, 1.1, carLen - gap - 1); winGeo.translate(0, 2.1, 0);
  const trainBody = instanced(bodyGeo, metal, carItems, (it, pos, q, sc) => { pos.set(0, -999, 0); q.identity(); sc.set(1, 1, 1); });
  const trainWin = instanced(winGeo, new THREE.MeshBasicMaterial({ color: 0xfff1cc }), carItems, (it, pos, q, sc) => { pos.set(0, -999, 0); q.identity(); sc.set(1, 1, 1); });
  fine.add(trainBody, trainWin);
  const headLights = trains.map(() => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); sp.scale.set(6, 6, 1); fine.add(sp); return sp; });
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _fwd = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
  const placeTrains = (dt) => {
    trains.forEach((tr, ti) => { tr.s = (tr.s + tr.dir * tr.speed * dt + ribbon.length) % ribbon.length; });
    carItems.forEach((it, i) => {
      const s = (it.tr.s - it.tr.dir * it.k * carLen + ribbon.length) % ribbon.length;
      const f = frameAt(ribbon, s), rt = railT(s), rh = railH(s);
      _p.set(f.pos.x + f.right.x * rt, f.pos.y + rh + 0.4, f.pos.z + f.right.z * rt);
      _fwd.set(f.tangent.x, 0, f.tangent.z).normalize().multiplyScalar(it.tr.dir);
      _q.setFromUnitVectors(_z, _fwd);
      _m.compose(_p, _q, _s); trainBody.setMatrixAt(i, _m); trainWin.setMatrixAt(i, _m);
      if (it.k === 0) headLights[trains.indexOf(it.tr)].position.copy(_p).addScaledVector(_fwd, carLen / 2).add(new THREE.Vector3(0, 1.6, 0));
    });
    trainBody.instanceMatrix.needsUpdate = true; trainWin.instanceMatrix.needsUpdate = true;
  };
  placeTrains(0);

  // --------------------------------------------------------- flying traffic --
  // lanes above the road, above the skytrain: nothing on the racing surface
  // stacked lanes climbing the canyon between the tower faces, the way the traffic runs in The Fifth Element
  const lanes = [];
  for (let k = 0; k < 10; k++) lanes.push({ t: (k % 2 ? 1 : -1) * (5 + (k % 3) * 3), h: 46 + k * 9, dir: k % 2 ? -1 : 1, speed: 30 + ((k * 7) % 5) * 7 });
  const crng = makeRng(505);
  const cars = [];
  const paint = [0xf2c21b, 0xf2c21b, 0xf2c21b, 0xe8e8f0, 0x3a3f4a, 0x2df1ff, 0xff2d95, 0x9d4dff, 0x6a6f7a];   // taxis first
  for (let i = 0; i < 320; i++) { const l = lanes[i % lanes.length]; cars.push({ l, s: crng() * ribbon.length, bob: crng() * 6.28, ph: crng(), colour: paint[crng.int(0, paint.length - 1)] }); }
  const carBody = new THREE.BoxGeometry(1.8, 0.6, 4); carBody.translate(0, 0, 0);
  const headGeo = new THREE.BoxGeometry(1.4, 0.3, 0.5); headGeo.translate(0, 0, 2.1);
  const tailGeo = new THREE.BoxGeometry(1.4, 0.3, 0.4); tailGeo.translate(0, 0, -2.1);
  const dummy = (it, pos, q, sc) => { pos.set(0, -999, 0); q.identity(); sc.set(1, 1, 1); };
  const carPaint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.5 });
  const carMeshes = [instanced(carBody, carPaint, cars, dummy), instanced(headGeo, new THREE.MeshBasicMaterial({ color: 0xfff6e0 }), cars, dummy), instanced(tailGeo, new THREE.MeshBasicMaterial({ color: 0xff2a2a }), cars, dummy)];
  cars.forEach((c, i) => carMeshes[0].setColorAt(i, new THREE.Color(c.colour))); carMeshes[0].instanceColor.needsUpdate = true;
  carMeshes.forEach(m => fine.add(m));
  let carT = 0;
  const placeCars = (dt) => {
    carT += dt;
    cars.forEach((c, i) => {
      c.s = (c.s + c.l.dir * c.l.speed * dt + ribbon.length) % ribbon.length;
      const f = frameAt(ribbon, c.s);
      _p.set(f.pos.x + f.right.x * c.l.t, f.pos.y + c.l.h + Math.sin(carT * 1.3 + c.bob) * 0.8, f.pos.z + f.right.z * c.l.t);
      _fwd.set(f.tangent.x, 0, f.tangent.z).normalize().multiplyScalar(c.l.dir);
      _q.setFromUnitVectors(_z, _fwd);
      _m.compose(_p, _q, _s); for (const m of carMeshes) m.setMatrixAt(i, _m);
    });
    for (const m of carMeshes) m.instanceMatrix.needsUpdate = true;
  };
  placeCars(0);

  // ------------------------------------------------ neon strips, billboards --
  // Glowing edge strips lining each side of the track, seated just OUTSIDE the
  // road edge and on the surface — never floating over the racing line.
  const strip = new THREE.BoxGeometry(0.3, 0.3, 12);
  const neonItems = [];
  for (let s = 6; s < ribbon.length - 6; s += 15) {
    const f = frameAt(ribbon, s);
    neonItems.push({ f, sd: 1 }, { f, sd: -1 });
  }
  env.neon.forEach((c, ci) => {
    const mine = neonItems.filter((_, i) => i % env.neon.length === ci);
    group.add(instanced(strip, neonMat[ci], mine, (it, pos, q, sc) => {
      const f = it.f, t = it.sd * (f.width / 2 + 0.6);
      pos.set(f.pos.x + f.right.x * t, f.pos.y + f.right.y * t + 0.2, f.pos.z + f.right.z * t);
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(f.tangent.x, 0, f.tangent.z).normalize());
      sc.set(1, 1, 1);
    }));
  });
  const bb = new THREE.PlaneGeometry(18, 9);
  const bbItems = placeAlong(ribbon, { every: 110, gap: 6, spread: 10, seed: 12, yOffset: 22, halfExtent: 9 });
  const holoMats = [];
  const frameGeo = [];
  bbItems.forEach((it, i) => {
    const c = env.neon[i % env.neon.length];
    const t = (i % 2 ? sponsorAdTexture(SPONSOR_IDS[i % SPONSOR_IDS.length], 1) : holoTexture(50 + (i % 5), c)).clone(); t.needsUpdate = true;
    const m = new THREE.MeshBasicMaterial({ map: t, color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    holoMats.push({ m, speed: i % 2 ? 0 : 0.05 + (i % 3) * 0.04 });   // sponsor spots hold still, glyph boards scroll
    const mesh = new THREE.Mesh(bb, m);
    mesh.position.set(it.p.x, it.p.y, it.p.z);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-it.f.right.x * it.sd, 0, -it.f.right.z * it.sd).normalize());
    group.add(mesh);
    const fr = new THREE.BoxGeometry(19, 10, 0.6); fr.translate(0, 0, -0.5);
    fr.applyMatrix4(new THREE.Matrix4().compose(mesh.position, mesh.quaternion, new THREE.Vector3(1, 1, 1)));
    frameGeo.push(fr);
    const mast = new THREE.CylinderGeometry(0.4, 0.5, it.p.y - GROUND - 4.5, 8); mast.translate(it.p.x, GROUND + (it.p.y - GROUND - 4.5) / 2, it.p.z); frameGeo.push(mast);
  });
  group.add(merged(frameGeo, metal));

  // -------------------------------------------------- lamps, cables, drones --
  const lamps = [];
  let sd = 1;
  for (let s = 20; s < ribbon.length - 10; s += 44) { lamps.push({ f: frameAt(ribbon, s), sd }); sd = -sd; }
  group.add(instanced(lampPostGeo(9), metal, lamps, (it, pos, q, sc) => {
    const f = it.f, t = it.sd * (f.width / 2 + 1.1);
    pos.set(f.pos.x + f.right.x * t, f.pos.y + f.right.y * t - 0.1, f.pos.z + f.right.z * t);
    q.copy(frameQuat(f)); if (it.sd > 0) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    sc.set(1, 1, 1);
  }));
  for (const it of lamps) {
    const f = it.f, t = it.sd * (f.width / 2 + 1.1);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff1c8, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.set(f.pos.x + f.right.x * t, f.pos.y + 8.5, f.pos.z + f.right.z * t); sp.scale.set(6, 6, 1); fine.add(sp);
  }
  const cablePts = [];
  const near = tops.filter(t => !t.far);
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
    const a = near[i], b = near[j], d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d > 95 || d < 20 || Math.abs(a.y - b.y) > 60) continue;
    const segs = 10;
    for (let k = 0; k < segs; k++) {
      const u0 = k / segs, u1 = (k + 1) / segs;
      const sag = (u) => -Math.sin(u * Math.PI) * d * 0.09;
      cablePts.push(a.x + (b.x - a.x) * u0, a.y + (b.y - a.y) * u0 + sag(u0), a.z + (b.z - a.z) * u0, a.x + (b.x - a.x) * u1, a.y + (b.y - a.y) * u1 + sag(u1), a.z + (b.z - a.z) * u1);
    }
  }
  if (cablePts.length) {
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3));
    const cables = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x05070c })); cables.frustumCulled = false; fine.add(cables);
  }
  const drones = [];
  for (let i = 0; i < 7; i++) {
    const f = frameAt(ribbon, (i + 0.5) * ribbon.length / 7);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 1.2), metal);
    const light = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: env.neon[i % env.neon.length], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    light.scale.set(4, 4, 1); body.add(light);
    fine.add(body);
    drones.push({ body, light, cx: f.pos.x, cz: f.pos.z, y: f.pos.y + 18 + i * 2, r: 22 + i * 3, ph: i * 1.3 });
  }
  // searchlights sweeping from the tallest roofs
  const beams = [];
  tall.filter((_, i) => i % 5 === 0).slice(0, 6).forEach((t, i) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(14, 380, 12, 1, true), new THREE.MeshBasicMaterial({ color: [0xffffff, 0xff2d95, 0x2df1ff][i % 3], transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    cone.geometry.translate(0, 190, 0); cone.geometry.rotateX(-0.45);
    const pivot = new THREE.Object3D(); pivot.position.set(t.x, t.y + 1, t.z); pivot.add(cone);
    fine.add(pivot); beams.push({ pivot, speed: 0.25 + i * 0.07, ph: i });
  });
  fine.add(fogCards(tops.filter(t => t.far).filter((_, i) => i % 3 === 0).map(t => ({ x: t.x, y: t.y, z: t.z })), { colour: 0x4a5a9a, opacity: 0.06, scale: [90, 40] }));
  // rain, low mist, street glow
  const rain = particleField(1100, { seed: 77, box: [120, 60, 120], colour: 0x9fb8ff, size: 0.25, opacity: 0.45, fall: 40 });
  group.add(rain);
  const mist = particleField(220, { seed: 78, box: [260, 26, 260], colour: 0x6a7cc0, size: 14, opacity: 0.08, drift: [1.5, 0, 0.6], map: glow });
  fine.add(mist);
  const glowItems = placeAlong(ribbon, { every: 60, gap: 3, spread: 4, seed: 21, yOffset: 1, halfExtent: 0 });
  for (const it of glowItems) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: env.neon[Math.floor(it.u * env.neon.length)], transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.set(it.p.x, it.p.y, it.p.z); sp.scale.set(14, 14, 1); group.add(sp);
  }

  scene.add(group, fine);
  let t = 0;
  return {
    group, fine, sky,
    update(dt, camera) {
      t += dt;
      rain.tick(dt, camera); mist.tick(dt, camera);
      placeCars(dt); placeTrains(dt);
      for (const h of holoMats) { h.m.map.offset.y = (t * h.speed) % 1; h.m.opacity = 0.7 + Math.sin(t * 7 + h.speed * 100) * 0.15; }
      for (const s of screenMats) {
        const on = Math.floor((t + s.phase) / s.period) % 2 === 0;
        const want = on ? s.t0 : s.t1; if (s.m.map !== want) { s.m.map = want; s.m.needsUpdate = true; }
        if (s.ticker) s.m.map.offset.x = (t * 0.12 + s.phase) % 1;
        s.m.color.setScalar(0.85 + 0.15 * Math.sin(t * 13 + s.phase * 9) * Math.sin(t * 0.9 + s.phase));
      }
      for (const d of drones) { const a = t * 0.5 + d.ph; d.body.position.set(d.cx + Math.cos(a) * d.r, d.y + Math.sin(t * 1.3 + d.ph) * 2, d.cz + Math.sin(a) * d.r); d.body.rotation.y = -a; d.light.material.opacity = 0.5 + 0.5 * Math.round(Math.sin(t * 6 + d.ph) * 0.5 + 0.5); }
      for (const b of beams) b.pivot.rotation.y = t * b.speed + b.ph;
    },
    setDetail(on) { fine.visible = on; },
    lighting: { effects: true }
  };
}
