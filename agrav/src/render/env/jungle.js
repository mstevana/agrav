// OSA REEF — a Costa Rican jungle coast, above and below the water. Dense
// canopy, palms on the beaches, mangroves standing in the shallows on their
// prop roots, ferns, macaws and parrots and toucans, sloths and monkeys in the
// trees, iguanas on the rocks, crocodiles in the mangroves, a tapir on the
// flats, blue morphos over the road. Where the track dives, a glass tunnel
// runs through a reef of corals and sea fans, fish schools, a dolphin pod,
// manta rays, whales and turtles, past the domes of a sunken city; the light
// turns blue and caustics ripple on the sand.
import * as THREE from 'three';
import { setupSky, placeAlong, instanced, instancedVariants, rockTint, merged, placed, particleField, flock, billboards } from './common.js';
import { glowSprite } from '../textures.js';
import { cliffSet, sandSet, concreteSet, metalPlateSet, facadeSet, standard, triplanarBlended } from '../surfaces.js';
import { rock, domeGeo, treeGeo, palmGeo, mangroveGeo, coralGeo, grassGeo, loft, tower, sweep, frameRuns, worldUv } from '../props.js';
import { buildTerrain, corridor } from '../terrain.js';
import { fbm2, voronoi2, ridged2, smoothstep } from '../noise.js';
import { makeSea } from './sea.js';
import { frameQuat } from '../track.js';
import { makeRng } from '../../../../shared/sim/rng.js';
import { mergeGeometries } from '../../../../shared/gfx/merge.js';

const SEA_LEVEL = 0;
const isSub = (f) => f.pos.y < SEA_LEVEL - 2;

/** the height field: jungle hills inland, a beach, a reef and a deep basin wherever the road dives (cached per track) */
function terrainFor(ribbon, env) {
  const terrainMat = triplanarBlended(cliffSet(env.cliff), sandSet(env.sand), { tile: 22, normalScale: 1.0, wetBand: [SEA_LEVEL + 0.3, SEA_LEVEL + 2.5] });
  const terrain = buildTerrain(ribbon, {
    cacheKey: 'jungle', cells: 200, pad: 420, corridor: { drop: 4, margin: 6, fade: 40 },
    profile(info) {
      const edge = Math.max(0, info.d - info.w / 2);
      const hills = info.tySmooth + smoothstep(6, 90, edge) * (10 + fbm2(info.x / 110, info.z / 110, { octaves: 4, seed: 3 }) * 26 + ridged2(info.x / 200, info.z / 200, { octaves: 3, seed: 4 }) * 30) + fbm2(info.x / 30, info.z / 30, { octaves: 3, seed: 5 }) * 3;
      const sea = smoothstep(2, -10, info.tySmooth);      // 1 where the road runs under the water
      const reef = -9 + fbm2(info.x / 40, info.z / 40, { octaves: 3, seed: 6 }) * 6;
      const basin = -30 + fbm2(info.x / 60, info.z / 60, { octaves: 2, seed: 7 }) * 4;
      const floor = reef + (basin - reef) * smoothstep(-8, -22, info.tySmooth);
      return corridor(info, hills + (floor - hills) * sea);
    },
    colour(info, y, ny) { const g = smoothstep(0.8, 0.95, ny) * smoothstep(1.5, 4, y); return [1 - g * 0.45, 1 - g * 0.05, 1 - g * 0.5]; },
    blend: (info, y, ny) => Math.max(smoothstep(5, 1.5, y), (1 - smoothstep(0.7, 0.95, ny)) * 0),
    material: terrainMat
  });
  return terrain;
}

export function prewarmJungle(ribbon, track) { const env = track.env; terrainFor(ribbon, env); cliffSet(env.cliff); sandSet(env.sand); concreteSet(0x8a8a82); metalPlateSet(env.metal); for (let i = 0; i < 3; i++) facadeSet(200 + i, 0x2df1ff, 6, 12); }

/** scrolling caustic lines for the sea floor */
function causticTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = voronoi2(x / S * 6, y / S * 6, 21), k = 1 - smoothstep(0, 0.12, v.f2 - v.f1);
    const i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = k * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

/** a world-space sway for foliage and fans: the tips lean with the wind (or the current) */
function swayMaterial(mat, wind, strength = 0.35, key = 'sway') {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <project_vertex>', `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition.x += (sin(uTime * 1.3 + mvPosition.z * 0.1 + mvPosition.x * 0.06) * ${strength.toFixed(2)} + 0.1) * transformed.y * transformed.y * 0.3;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => key + strength;
  return mat;
}

// lofted bodies, all with the nose at +z so lookAt() aims them
const fishGeo = (s = 1) => { const g = loft([{ p: -0.55, w: 0.02, h: 0.14 }, { p: -0.3, w: 0.06, h: 0.09 }, { p: -0.05, w: 0.13, h: 0.22 }, { p: 0.25, w: 0.14, h: 0.24 }, { p: 0.5, w: 0.07, h: 0.13 }, { p: 0.65, w: 0.02, h: 0.04 }], { axis: 'z', segments: 10 }); g.scale(s, s, s); return g; };
const dolphinGeo = () => { const body = loft([{ p: -2.4, w: 0.04, h: 0.06 }, { p: -1.8, w: 0.2, h: 0.26 }, { p: -0.6, w: 0.48, h: 0.55 }, { p: 0.5, w: 0.5, h: 0.55 }, { p: 1.6, w: 0.32, h: 0.36 }, { p: 2.3, w: 0.12, h: 0.12 }, { p: 2.6, w: 0.04, h: 0.04 }], { axis: 'z', segments: 14 }); const fin = new THREE.BoxGeometry(0.08, 0.55, 0.6); fin.translate(0, 0.75, 0.2); const fluke = new THREE.BoxGeometry(1.3, 0.06, 0.45); fluke.translate(0, 0, -2.3); const g = mergeGeometries([body, fin, fluke]); worldUv(g, 2, 2); return g; };
const mantaGeo = () => { const g = loft([{ p: -1.6, w: 0.08, h: 0.05 }, { p: -0.6, w: 2.4, h: 0.22 }, { p: 0.4, w: 2.8, h: 0.26 }, { p: 1.3, w: 1.3, h: 0.16 }, { p: 3.4, w: 0.04, h: 0.03 }], { axis: 'z', segments: 18 }); worldUv(g, 2, 2); return g; };
const whaleGeo = () => { const body = loft([{ p: -12, w: 0.3, h: 0.5 }, { p: -9, w: 1.4, h: 1.6 }, { p: -3, w: 2.6, h: 3 }, { p: 3, w: 2.8, h: 3.2 }, { p: 8, w: 1.9, h: 2.3 }, { p: 11.5, w: 0.7, h: 0.9 }, { p: 13, w: 0.2, h: 0.3 }], { axis: 'z', segments: 16 }); const fluke = new THREE.BoxGeometry(8, 0.3, 3); fluke.translate(0, 0.2, -12.2); const fins = []; for (const sx of [-1, 1]) { const f = new THREE.BoxGeometry(5, 0.25, 1.6); f.rotateZ(sx * 0.25); f.translate(sx * 4, -1.2, 2); fins.push(f); } const g = mergeGeometries([body, fluke, ...fins]); worldUv(g, 4, 4); return g; };
const turtleGeo = () => { const shell = domeGeo(14); shell.scale(1.1, 0.5, 1.4); const head = new THREE.SphereGeometry(0.28, 8, 6); head.translate(0, 0.1, 1.55); const fl = []; for (const [x, z] of [[-1.1, 0.7], [1.1, 0.7], [-0.9, -0.8], [0.9, -0.8]]) { const f = new THREE.BoxGeometry(0.9, 0.08, 0.4); f.rotateY(x > 0 ? -0.5 : 0.5); f.translate(x, 0.05, z); fl.push(f); } const g = mergeGeometries([shell, head, ...fl]); worldUv(g, 1, 1); return g; };
const crocGeo = () => { const body = loft([{ p: -2.6, w: 0.05, h: 0.05 }, { p: -1.4, w: 0.28, h: 0.15 }, { p: -0.3, w: 0.44, h: 0.25 }, { p: 0.8, w: 0.38, h: 0.23 }, { p: 1.7, w: 0.22, h: 0.13 }, { p: 2.4, w: 0.1, h: 0.06 }], { axis: 'z', segments: 10 }); const ridge = new THREE.BoxGeometry(0.1, 0.12, 2.6); ridge.translate(0, 0.28, -0.6); const g = mergeGeometries([body, ridge]); worldUv(g, 1, 1); return g; };
const iguanaGeo = () => { const g = loft([{ p: -1, w: 0.02, h: 0.02 }, { p: -0.45, w: 0.12, h: 0.1 }, { p: 0.1, w: 0.17, h: 0.15 }, { p: 0.45, w: 0.11, h: 0.11 }, { p: 0.62, w: 0.05, h: 0.05 }], { axis: 'z', segments: 8 }); return g; };
const tapirGeo = () => { const body = loft([{ p: -1.2, w: 0.35, h: 0.42 }, { p: -0.3, w: 0.46, h: 0.52 }, { p: 0.6, w: 0.4, h: 0.46 }, { p: 1.2, w: 0.22, h: 0.26 }, { p: 1.5, w: 0.1, h: 0.1 }], { axis: 'z', segments: 12 }); body.translate(0, 0.95, 0); const legs = []; for (const [x, z] of [[-0.25, -0.8], [0.25, -0.8], [-0.25, 0.6], [0.25, 0.6]]) { const l = new THREE.CylinderGeometry(0.09, 0.08, 0.8, 6); l.translate(x, 0.4, z); legs.push(l); } const g = mergeGeometries([body, ...legs]); worldUv(g, 1, 1); return g; };
const slothGeo = () => { const body = rock(90, 1); body.scale(0.5, 0.36, 0.8); const head = new THREE.SphereGeometry(0.28, 8, 6); head.translate(0, 0.1, 0.8); const arms = []; for (const x of [-0.35, 0.35]) { const a = new THREE.CylinderGeometry(0.06, 0.05, 0.9, 5); a.translate(x, 0.55, 0.3); arms.push(a); } const g = mergeGeometries([body, head, ...arms]); worldUv(g, 1, 1); return g; };

export function buildJungle(scene, ribbon, track) {
  const env = track.env;
  const group = new THREE.Group(), fine = new THREE.Group();
  const sunPos = { x: 700, y: 620, z: 500 };
  const sky = setupSky(scene, env, 0x3c8fe0, 0xcfe6f0, { clouds: true, seed: 12, sunPos, sunDisc: { colour: 0xfff4d8, size: 52 } });
  const surfaceFog = { colour: new THREE.Color(env.fog), density: env.fogDensity, sky: new THREE.Color(env.sky) };
  const underFog = { colour: new THREE.Color(env.underwater.fog), density: env.underwater.density, sky: new THREE.Color(env.underwater.sky) };

  const terrain = terrainFor(ribbon, env);
  terrain.mesh.name = 'terrain';
  group.add(terrain.mesh);
  const { heightAt, slopeAt } = terrain;
  const glow = glowSprite();
  const rng = makeRng(123);
  const wind = { value: 0 }, current = { value: 0 };

  // ------------------------------------------------------------------- sea --
  const { mesh: sea, material: seaMat } = makeSea(terrain, env, sunPos, { level: SEA_LEVEL, doubleSide: true, shallow: 0x2aa7a0 });
  group.add(sea);

  // ---------------------------------------------------------- glass tunnels --
  const runs = frameRuns(ribbon, isSub).map(([a, b]) => [(a - 3 + ribbon.count) % ribbon.count, (b + 3) % ribbon.count]);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.5 });
  const metal = standard(metalPlateSet(env.metal), { bumpScale: 0.05, metalness: 0.6, roughness: 0.45 });
  const concrete = standard(concreteSet(0x8a8a82), { bumpScale: 0.1 });
  const ribGeos = [], portalGeos = [];
  const tubeR = (f) => f.width / 2 + 4;
  const seaAreas = [];   // { x, z, r, deep } — where the underwater dressing goes
  for (const [i0, i1] of runs) {
    const prof = [];
    for (let k = 0; k <= 16; k++) { const ang = Math.PI * (1 - k / 16); prof.push({ t: (f) => Math.cos(ang) * tubeR(f), h: (f) => Math.sin(ang) * tubeR(f) - 1.1 }); }
    const tube = new THREE.Mesh(sweep(ribbon, i0, i1, prof, { uvScale: 9 }), glass);
    tube.frustumCulled = false; tube.userData.noShadow = true; tube.renderOrder = 5;
    group.add(tube);
    const count = ((i1 - i0 + ribbon.count) % ribbon.count) + 1;
    for (let n = 0; n < count; n += 6) {
      const f = ribbon.frames[(i0 + n) % ribbon.count];
      const rib = new THREE.TorusGeometry(tubeR(f) + 0.25, 0.32, 6, 22, Math.PI); rib.translate(0, -1.1, 0);
      rib.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z), frameQuat(f), new THREE.Vector3(1, 1, 1)));
      ribGeos.push(rib);
    }
    for (const i of [i0, i1]) {
      const f = ribbon.frames[i];
      const ring = new THREE.TorusGeometry(tubeR(f) + 1, 1.3, 8, 26, Math.PI); ring.translate(0, -1.1, 0);
      ring.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z), frameQuat(f), new THREE.Vector3(1, 1, 1)));
      portalGeos.push(ring);
    }
    let sx = 0, sz = 0, deep = 0; const mid = ribbon.frames[(i0 + Math.floor(count / 2)) % ribbon.count];
    for (let n = 0; n < count; n++) { const f = ribbon.frames[(i0 + n) % ribbon.count]; sx += f.pos.x; sz += f.pos.z; deep = Math.min(deep, f.pos.y); }
    seaAreas.push({ x: sx / count, z: sz / count, r: 40 + count * ribbon.step * 0.3, deep, mid, i0, i1 });
  }
  if (ribGeos.length) group.add(merged(ribGeos, metal));
  if (portalGeos.length) group.add(merged(portalGeos, concrete));

  // caustics: a sheet that hugs the sea floor under each dive, scrolling; light shafts above it
  const caustic = causticTexture(); caustic.repeat.set(12, 12);
  const causticMat = new THREE.MeshBasicMaterial({ map: caustic, color: 0x9adfff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  const shaftMat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
  const shaftGeo = new THREE.PlaneGeometry(7, 44);
  for (const area of seaAreas) {
    const size = area.r * 2.4, cells = 44;
    const g = new THREE.PlaneGeometry(size, size, cells, cells); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) + area.x, z = p.getZ(i) + area.z; p.setY(i, Math.min(SEA_LEVEL - 0.5, heightAt(x, z) + 0.35)); }
    p.needsUpdate = true;
    const sheet = new THREE.Mesh(g, causticMat); sheet.position.set(area.x, 0, area.z); sheet.userData.noShadow = true; fine.add(sheet);
    for (let i = 0; i < 16; i++) {
      const a = rng() * 6.28, d = rng() * area.r * 0.9;
      const s = new THREE.Mesh(shaftGeo, shaftMat); s.position.set(area.x + Math.cos(a) * d, -18 + rng() * 8, area.z + Math.sin(a) * d); s.rotation.set(0.25 + rng() * 0.2, rng() * 6.28, 0); s.userData.noShadow = true; fine.add(s);
    }
  }

  // --------------------------------------------------------------- reef --
  const coralMat = swayMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide }), current, 0.15, 'coral');
  const palette = [0xff3a9a, 0xff8a2a, 0xffe14d, 0x9d4dff, 0x2df1c8, 0xff4040, 0xff6ab0];
  const coralTint = (it) => { const c = new THREE.Color(palette[Math.floor(it.rng() * palette.length)]); const k = 0.7 + it.rng() * 0.5; return [c.r * k, c.g * k, c.b * k]; };
  const corals = [coralGeo(1, 0), coralGeo(2, 0), coralGeo(3, 1), coralGeo(4, 1), coralGeo(5, 2), coralGeo(6, 2), coralGeo(7, 0)];
  const onReef = (it) => it.p.y < SEA_LEVEL - 3 && it.p.y > -27;
  const reef = placeAlong(ribbon, { every: 5, gap: 1, spread: 70, seed: 71, halfExtent: 1, y: heightAt }).filter(onReef);
  group.add(instancedVariants(corals, coralMat, reef, (it, pos, q, sc) => { const s = 1.4 + it.rng() * 2.8; pos.set(it.p.x, it.p.y - 0.1, it.p.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28); sc.set(s, s * (0.8 + it.rng() * 0.6), s); }, coralTint));
  const kelpMat = swayMaterial(new THREE.MeshStandardMaterial({ color: 0x4a7a2a, roughness: 1, side: THREE.DoubleSide }), current, 0.5, 'kelp');
  const kelp = placeAlong(ribbon, { every: 7, gap: 1, spread: 50, seed: 72, halfExtent: 0.6, y: heightAt }).filter(it => it.p.y < SEA_LEVEL - 4);
  fine.add(instancedVariants([grassGeo()], kelpMat, kelp, (it, pos, q, sc) => { pos.set(it.p.x, it.p.y - 0.1, it.p.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28); const s = 2 + it.rng() * 3; sc.set(s * 0.6, s * 3, s * 0.6); }));
  const shoreRock = standard(cliffSet(env.cliff), { repeat: [1.5, 1], bumpScale: 0.2 });
  const boulders = placeAlong(ribbon, { every: 24, gap: 2, spread: 30, seed: 73, halfExtent: 3, y: heightAt });
  group.add(instancedVariants([rock(21), rock(22), rock(23, 3)], shoreRock, boulders, (it, pos, q, sc) => { const r = 1.2 + it.rng() * 3; pos.set(it.p.x, it.p.y + r * 0.2, it.p.z); q.setFromEuler(new THREE.Euler(0, it.rng() * 6.28, 0)); sc.set(r, r * 0.8, r); }, rockTint));

  // ---------------------------------------------------------- sea life --
  const schools = [];
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _fwd = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
  const fishMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.3 });
  const schoolColours = [0xffd24d, 0xc8d0dc, 0x3a8aff, 0xff8a3a];
  seaAreas.forEach((area, ai) => {
    for (let k = 0; k < 2; k++) {
      const n = 50, geo = fishGeo(k ? 1.3 : 0.7), colour = schoolColours[(ai * 2 + k) % schoolColours.length];
      const fish = []; for (let i = 0; i < n; i++) fish.push({ o: new THREE.Vector3((rng() - 0.5) * 16, (rng() - 0.5) * 5, (rng() - 0.5) * 16), f: rng() * 6.28 });
      const mesh = instanced(geo, fishMat, fish, (it, pos, q, sc) => { pos.set(0, -999, 0); q.identity(); sc.set(1, 1, 1); });
      const c = new THREE.Color(colour); fish.forEach((_, i) => mesh.setColorAt(i, c)); mesh.instanceColor.needsUpdate = true;
      fine.add(mesh);
      const a = rng() * 6.28, d = area.r * 0.5;
      schools.push({ mesh, fish, cx: area.x + Math.cos(a) * d, cz: area.z + Math.sin(a) * d, y: Math.max(area.deep + 6, -22) + k * 5, A: 30 + rng() * 30, C: 25 + rng() * 25, w: 0.09 + rng() * 0.06, ph: rng() * 6.28 });
    }
  });
  const swimmers = [];
  const swimmer = (mesh, o) => { group.add(mesh); swimmers.push({ mesh, ...o }); };
  const grey = new THREE.MeshStandardMaterial({ color: 0x6a7580, roughness: 0.4, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2e3a48, roughness: 0.5 });
  const olive = new THREE.MeshStandardMaterial({ color: 0x4a6a2e, roughness: 0.8 });
  const dg = dolphinGeo(), mg = mantaGeo(), wg = whaleGeo(), tg = turtleGeo();
  seaAreas.forEach((area, ai) => {
    for (let i = 0; i < 3; i++) swimmer(new THREE.Mesh(dg, grey), { cx: area.x, cz: area.z, r: 55 + i * 8, y: -3.5, w: 0.22, ph: i * 1.1 + ai, bob: 1.2, breach: 0.8 + i * 0.3 });
    swimmer(new THREE.Mesh(mg, dark), { cx: area.x + 30, cz: area.z - 20, r: 70, y: Math.max(area.deep + 8, -20), w: -0.08, ph: ai * 2, bob: 2, flap: true });
    for (let i = 0; i < 2; i++) swimmer(new THREE.Mesh(tg, olive), { cx: area.x - 20, cz: area.z + 30, r: 26 + i * 12, y: -7 - i * 3, w: 0.05, ph: i * 2.2, bob: 0.6, scale: 1.4 });
  });
  const deepest = seaAreas.reduce((m, a) => (a.deep < m.deep ? a : m), seaAreas[0]);
  if (deepest) for (let i = 0; i < 2; i++) swimmer(new THREE.Mesh(wg, dark), { cx: deepest.x + 40, cz: deepest.z + 40, r: 120 + i * 40, y: -20 - i * 2, w: 0.035 * (i ? -1 : 1), ph: i * 3, bob: 1.5 });
  for (const s of swimmers) if (s.scale) s.mesh.scale.setScalar(s.scale);

  // ----------------------------------------------------------- sunken city --
  if (deepest) {
    const f = deepest.mid, side = 1;
    const cx = f.pos.x + f.right.x * side * 95, cz = f.pos.z + f.right.z * side * 95;
    const facades = [0, 1, 2].map(i => standard(facadeSet(200 + i, 0x2df1ff, 6, 12), { bumpScale: 0.1, emissiveIntensity: 1.3 }));
    const cityGlass = new THREE.MeshPhysicalMaterial({ color: 0x7fc8ff, transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
    const crng = makeRng(77);
    for (let i = 0; i < 7; i++) {
      const a = crng() * 6.28, d = i === 0 ? 0 : 40 + crng() * 60, r = 18 + crng() * 22;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, y = heightAt(x, z) - 3;
      const dm = new THREE.Mesh(domeGeo(24), cityGlass); dm.position.set(x, y, z); dm.scale.setScalar(r); dm.userData.noShadow = true; dm.renderOrder = 4; group.add(dm);
      const nt = 2 + crng.int(0, 2);
      for (let k = 0; k < nt; k++) {
        const ta = crng() * 6.28, td = crng() * r * 0.45, w = 6 + crng() * 6, h = r * (0.4 + crng() * 0.45);
        const tw = new THREE.Mesh(tower(w, w, h, crng, 24, 48, k % 2 ? 1 : 2), facades[(i + k) % 3]); tw.position.set(x + Math.cos(ta) * td, y + 1, z + Math.sin(ta) * td); group.add(tw);
      }
      const l = new THREE.PointLight(0x2df1ff, 20, r * 4, 1.5); l.position.set(x, y + r * 0.4, z); group.add(l);
    }
    var cityFacades = facades;   // eslint-disable-line no-var
  }

  // ---------------------------------------------------------------- jungle --
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 1 });
  const canopyMat = swayMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), wind, 0.12, 'canopy');
  const greens = (it) => { const k = 0.55 + it.rng() * 0.5, w = it.rng() * 0.2; return [0.22 * k + w * 0.3, 0.55 * k, 0.16 * k]; };
  const treeSeeds = [1, 2, 3, 4].map(treeGeo);
  const onLand = (it) => it.p.y > SEA_LEVEL + 1.5 && slopeAt(it.p.x, it.p.z) < 0.55;
  const trees = placeAlong(ribbon, { every: 6, gap: 3, spread: 90, seed: 81, halfExtent: 2, y: heightAt }).filter(onLand);
  const treeSetup = (it, pos, q, sc) => { pos.set(it.p.x, it.p.y - 0.3, it.p.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28); const s = 0.8 + it.rng() * 0.7; sc.set(s, s, s); };
  const treeRngs = trees.map(it => ({ ...it, rng: makeRng(Math.round(it.p.x * 7 + it.p.z * 13)) }));
  group.add(instancedVariants(treeSeeds.map(t => t.trunk), trunkMat, treeRngs, treeSetup));
  group.add(instancedVariants(treeSeeds.map(t => t.canopy), canopyMat, treeRngs.map(it => ({ ...it, rng: makeRng(Math.round(it.p.x * 7 + it.p.z * 13)) })), treeSetup, greens));
  const palmSeeds = [5, 6, 7].map(palmGeo);
  const frondMat = swayMaterial(new THREE.MeshStandardMaterial({ color: 0x4f9a36, roughness: 0.9, side: THREE.DoubleSide }), wind, 0.3, 'frond');
  const palms = placeAlong(ribbon, { every: 18, gap: 3, spread: 40, seed: 82, halfExtent: 1, y: heightAt }).filter(it => it.p.y > 0.4 && it.p.y < 5);
  const palmRngs = palms.map(it => ({ ...it, rng: makeRng(Math.round(it.p.x * 3 + it.p.z * 5)) }));
  const palmSetup = (it, pos, q, sc) => { pos.set(it.p.x, it.p.y - 0.2, it.p.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28); const s = 0.8 + it.rng() * 0.6; sc.set(s, s, s); };
  group.add(instancedVariants(palmSeeds.map(p => p.trunk), trunkMat, palmRngs, palmSetup));
  group.add(instancedVariants(palmSeeds.map(p => p.fronds), frondMat, palmRngs.map(it => ({ ...it, rng: makeRng(Math.round(it.p.x * 3 + it.p.z * 5)) })), palmSetup));
  const mangSeeds = [8, 9, 10].map(mangroveGeo);
  const mangroves = placeAlong(ribbon, { every: 9, gap: 2, spread: 34, seed: 83, halfExtent: 1.5, y: heightAt }).filter(it => it.p.y > -1.6 && it.p.y < 2.2);
  const mangRngs = mangroves.map(it => ({ ...it, rng: makeRng(Math.round(it.p.x * 11 + it.p.z * 3)) }));
  const mangSetup = (it, pos, q, sc) => { pos.set(it.p.x, Math.max(it.p.y, SEA_LEVEL) - 2.3, it.p.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28); const s = 0.9 + it.rng() * 0.5; sc.set(s, s, s); };
  group.add(instancedVariants(mangSeeds.map(m => m.trunk), trunkMat, mangRngs, mangSetup));
  group.add(instancedVariants(mangSeeds.map(m => m.canopy), canopyMat, mangRngs.map(it => ({ ...it, rng: makeRng(Math.round(it.p.x * 11 + it.p.z * 3)) })), mangSetup, greens));
  const fernMat = swayMaterial(new THREE.MeshStandardMaterial({ color: 0x3f8a2e, roughness: 1, side: THREE.DoubleSide }), wind, 0.35, 'fern');
  const ferns = placeAlong(ribbon, { every: 5, gap: 1.5, spread: 40, seed: 84, halfExtent: 0.8, y: heightAt }).filter(onLand);
  fine.add(instancedVariants([grassGeo()], fernMat, ferns, (it, pos, q, sc) => { pos.set(it.p.x, it.p.y - 0.1, it.p.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28); const s = 1.6 + it.rng() * 1.6; sc.set(s * 1.5, s, s * 1.5); }));

  // ----------------------------------------------------------- animals --
  const brown = new THREE.MeshStandardMaterial({ color: 0x5a4a30, roughness: 1 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 1 });
  const green = new THREE.MeshStandardMaterial({ color: 0x4a8a2a, roughness: 0.7 });
  const greyish = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 });
  const perched = [];   // sloths and monkeys hang in the canopy
  const slothG = slothGeo(), monkeyG = rock(91, 1);
  treeRngs.filter((_, i) => i % 41 === 0).slice(0, 8).forEach(it => { const s = new THREE.Mesh(slothG, brown); s.position.set(it.p.x + 1.2, it.p.y + 8.2, it.p.z); s.rotation.set(0, it.rng() * 6.28, Math.PI); perched.push(s); });
  treeRngs.filter((_, i) => i % 23 === 5).slice(0, 14).forEach(it => { const m = new THREE.Mesh(monkeyG, black); m.position.set(it.p.x - 1.4, it.p.y + 9.5, it.p.z + 0.8); m.scale.set(0.42, 0.5, 0.42); perched.push(m); });
  fine.add(...perched);
  const igG = iguanaGeo(), crG = crocGeo(), tpG = tapirGeo();
  boulders.filter((_, i) => i % 6 === 0).slice(0, 9).forEach(it => { if (it.p.y < 1) return; const g = new THREE.Mesh(igG, green); g.position.set(it.p.x, it.p.y + 2.2, it.p.z); g.rotation.y = it.rng() * 6.28; g.scale.setScalar(1.6); fine.add(g); });
  const crocs = [];
  mangroves.filter((_, i) => i % 9 === 3).slice(0, 6).forEach(it => { const c = new THREE.Mesh(crG, olive); c.position.set(it.p.x + 3, SEA_LEVEL - 0.12, it.p.z + 2); c.rotation.y = it.rng() * 6.28; c.scale.setScalar(1.5); crocs.push({ mesh: c, y0: c.rotation.y, ph: it.rng() * 6.28 }); fine.add(c); });
  placeAlong(ribbon, { every: 300, gap: 8, spread: 12, seed: 85, halfExtent: 2, y: heightAt }).filter(onLand).slice(0, 3).forEach(it => { const tp = new THREE.Mesh(tpG, greyish); tp.position.set(it.p.x, it.p.y, it.p.z); tp.rotation.y = it.rng() * 6.28; tp.scale.setScalar(1.3); fine.add(tp); });

  // birds and butterflies
  const flocks = [];
  const roost = (frac, o) => { const f = ribbon.frames[Math.floor(ribbon.count * frac)]; return { x: f.pos.x + f.right.x * o, z: f.pos.z + f.right.z * o, y: f.pos.y }; };
  const a1 = roost(0.12, 60), a2 = roost(0.62, -70), a3 = roost(0.9, 50);
  flocks.push(flock(10, a1, 80, a1.y + 34, { seed: 21, colour: 0xe02a2a, size: 1.5, speed: 0.4 }));     // scarlet macaws
  flocks.push(flock(8, a2, 70, a2.y + 28, { seed: 22, colour: 0x2ad04a, size: 1.2, speed: 0.5 }));      // parrots
  flocks.push(flock(6, a3, 60, a3.y + 24, { seed: 23, colour: 0x141414, size: 1.7, speed: 0.32 }));     // toucans
  fine.add(...flocks);
  const morphos = particleField(220, { seed: 46, box: [90, 10, 90], colour: 0x3a8aff, size: 0.35, opacity: 0.9, drift: [0.5, 0, 0.3], map: glow, fixedY: 4 });
  fine.add(morphos);

  // sponsor boards
  const bb = billboards(ribbon, { every: 230, seed: 8, y: heightAt });
  group.add(bb.ads, merged(bb.frames, metal));

  scene.add(group, fine);
  let t = 0, under = 0;
  return {
    group, fine, terrain, sky,
    update(dt, camera) {
      t += dt; seaMat.uniforms.time.value = t; wind.value = t; current.value = t * 0.5;
      caustic.offset.set(t * 0.02, t * 0.013);
      // the light goes blue and thick when the camera is under the surface
      const want = camera.position.y < SEA_LEVEL ? 1 : 0;
      under += (want - under) * Math.min(1, dt * 5);
      scene.fog.color.copy(surfaceFog.colour).lerp(underFog.colour, under);
      scene.fog.density = surfaceFog.density + (underFog.density - surfaceFog.density) * under;
      scene.background.copy(surfaceFog.sky).lerp(underFog.sky, under);
      for (const s of schools) {
        const a = s.ph + t * s.w;
        const cx = s.cx + Math.sin(a) * s.A, cz = s.cz + Math.cos(a * 0.7) * s.C, cy = s.y + Math.sin(a * 1.3) * 2;
        const vx = Math.cos(a) * s.A * s.w, vz = -Math.sin(a * 0.7) * s.C * s.w * 0.7;
        _fwd.set(vx, 0, vz).normalize(); _q.setFromUnitVectors(_z, _fwd);
        s.fish.forEach((f, i) => {
          _p.set(cx + f.o.x + Math.sin(t * 2.1 + f.f) * 0.6, cy + f.o.y + Math.sin(t * 1.4 + f.f) * 0.4, cz + f.o.z + Math.cos(t * 1.7 + f.f) * 0.6);
          _m.compose(_p, _q, _s.set(1, 1, 1)); s.mesh.setMatrixAt(i, _m);
        });
        s.mesh.instanceMatrix.needsUpdate = true;
      }
      for (const s of swimmers) {
        const a = s.ph + t * s.w, na = a + 0.06 * Math.sign(s.w);
        let y = s.y + Math.sin(t * 0.6 + s.ph) * s.bob;
        if (s.breach) { const b = Math.sin(t * 0.45 + s.ph); if (b > 0.86) y += Math.pow((b - 0.86) / 0.14, 0.6) * 4.5 * s.breach; }
        s.mesh.position.set(s.cx + Math.cos(a) * s.r, y, s.cz + Math.sin(a) * s.r);
        s.mesh.lookAt(s.cx + Math.cos(na) * s.r, y + (s.breach ? Math.cos(t * 0.45 + s.ph) * 1.5 : 0), s.cz + Math.sin(na) * s.r);
        if (s.flap) s.mesh.rotation.z += Math.sin(t * 1.4 + s.ph) * 0.12;
      }
      for (const c of crocs) c.mesh.rotation.y = c.y0 + Math.sin(t * 1.1 + c.ph) * 0.06;
      for (const f of flocks) f.tick(dt);
      morphos.tick(dt, camera);
      if (cityFacades) for (const m of cityFacades) m.emissiveIntensity = 1.2 + Math.sin(t * 0.8 + m.id) * 0.25;
    },
    setDetail(on) { fine.visible = on; },
    lighting: { effects: true }
  };
}
