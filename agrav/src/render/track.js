// ============================================================================
// AGRAV — track rendering: the ribbon surface with its procedural material
// set, the deck under it, rumble-strip curbs, barrier posts carrying the
// energy wall, light gantries, pads, the start line, and the pose helper that
// turns (s, t, h, yaw) into a world transform.
// ============================================================================

import * as THREE from 'three';
import { frameAt, toWorld } from '../../../shared/sim/spline.js';
import { HOVER_HEIGHT } from '../../../shared/agrav/constants.js';
import { padTexture, checkerTexture, curbTexture, skidTexture, sponsorAdTexture, SPONSOR_IDS } from './textures.js';
import { asphaltSet, concreteSet, metalPlateSet, standard } from '../../../shared/gfx/surfaces.js';
import { sweep, barrierPostGeo, gantryGeo } from './props.js';
import { instanced } from './env/common.js';
import { mergeGeometries } from '../../../shared/gfx/merge.js';
import { makeRng } from '../../../shared/sim/rng.js';

const ACROSS = 8;    // lateral subdivisions
const TILE = 8;      // metres per texture tile

/** the track's material sets, generated ahead of the race */
export function prewarmTrack(env) { asphaltSet(env.surface ?? 0x7c8290, env.seam ?? 0x3a3f4a, !!env.wet); concreteSet(env.deck ?? 0x6f6f74); metalPlateSet(env.metal ?? 0x4a5160); }

export function buildTrack(ribbon, track, env) {
  const group = new THREE.Group();
  const n = ribbon.count;
  const verts = [], normals = [], uvs = [], colors = [], idx = [];
  const edge = new THREE.Color(env.edge ?? 0x2df1ff);
  const tiles = Math.max(1, Math.round(ribbon.length / TILE));   // integer tile count so the loop closes without a seam
  for (let i = 0; i <= n; i++) {
    const f = ribbon.frames[i % n];
    for (let k = 0; k <= ACROSS; k++) {
      const u = k / ACROSS, t = (u - 0.5) * f.width;
      verts.push(f.pos.x + f.right.x * t, f.pos.y + f.right.y * t, f.pos.z + f.right.z * t);
      normals.push(f.up.x, f.up.y, f.up.z);
      uvs.push(t / TILE, i / n * tiles);
      // bright edge strips, darker centre
      const e = Math.min(1, Math.max(0, (Math.abs(u - 0.5) - 0.44) / 0.06));
      colors.push(1 - e + edge.r * e, 1 - e + edge.g * e, 1 - e + edge.b * e);
    }
  }
  const stride = ACROSS + 1;
  // counter-clockwise seen from above: (along × across) must point along `up`, so the
  // across edge comes first
  for (let i = 0; i < n; i++) for (let k = 0; k < ACROSS; k++) {
    const a = i * stride + k, b = a + stride;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(idx);
  const surfMat = standard(asphaltSet(env.surface ?? 0x7c8290, env.seam ?? 0x3a3f4a, !!env.wet), {
    bumpScale: 0.06, normalScale: 0.9, vertexColors: true, metalness: env.wet ? 0.3 : 0.04
  });
  const surface = new THREE.Mesh(geo, surfMat); surface.name = 'road';
  surface.receiveShadow = true;
  group.add(surface);

  // the deck: 1.2 m of concrete under the road so elevated sections read as structure
  const concrete = standard(concreteSet(env.deck ?? 0x6f6f74), { repeat: [1, 1], bumpScale: 0.1 });
  const deck = new THREE.Mesh(sweep(ribbon, 0, n - 1, [
    { t: (f) => -f.width / 2 - 0.2, h: -0.05 }, { t: (f) => -f.width / 2 - 0.2, h: -1.3 },
    { t: (f) => f.width / 2 + 0.2, h: -1.3 }, { t: (f) => f.width / 2 + 0.2, h: -0.05 }
  ], { uvScale: 4 }), concrete);
  deck.material.side = THREE.DoubleSide; deck.name = 'deck';
  group.add(deck);

  // rumble-strip curbs on both edges
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture(env.curb ?? env.edge ?? 0x2df1ff), roughness: 0.6, metalness: 0.1 });
  for (const sd of [1, -1]) {
    const curb = new THREE.Mesh(sweep(ribbon, 0, n - 1, [
      { t: (f) => sd * (f.width / 2 - 1.5), h: 0.02 }, { t: (f) => sd * (f.width / 2 - 1.2), h: 0.14 },
      { t: (f) => sd * (f.width / 2 + 0.15), h: 0.14 }, { t: (f) => sd * (f.width / 2 + 0.25), h: -0.1 }
    ], { uvScale: 2 }), curbMat);
    curb.material.side = THREE.DoubleSide; curb.name = 'curb';
    group.add(curb);
  }

  // walls: a translucent energy barrier along each edge, glowing at the base
  const wallGeo = (side) => {
    const v = [], c = [], id = [];
    const H = 2.6;
    for (let i = 0; i <= n; i++) {
      const f = ribbon.frames[i % n], t = side * f.width / 2;
      const bx = f.pos.x + f.right.x * t, by = f.pos.y + f.right.y * t, bz = f.pos.z + f.right.z * t;
      v.push(bx, by, bz, bx + f.up.x * H, by + f.up.y * H, bz + f.up.z * H);
      c.push(1, 1, 1, 0.05, 0.05, 0.05);
    }
    for (let i = 0; i < n; i++) { const a = i * 2; id.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.setIndex(id);
    return g;
  };
  const wallMat = new THREE.MeshBasicMaterial({ color: env.edge ?? 0x2df1ff, vertexColors: true, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  group.add(new THREE.Mesh(wallGeo(1), wallMat), new THREE.Mesh(wallGeo(-1), wallMat));

  // barrier posts every 12 m carry the wall
  const metal = standard(metalPlateSet(env.metal ?? 0x4a5160), { repeat: [1, 1], bumpScale: 0.05, metalness: 0.6 });
  const posts = [];
  for (let s = 6; s < ribbon.length - 6; s += 12) for (const sd of [1, -1]) posts.push({ f: frameAt(ribbon, s), sd });
  const postMesh = instanced(barrierPostGeo(), metal, posts, (it, pos, q, sc) => {
    const f = it.f, t = it.sd * (f.width / 2 + 0.45);
    pos.set(f.pos.x + f.right.x * t, f.pos.y + f.right.y * t - 0.1, f.pos.z + f.right.z * t);
    q.copy(frameQuat(f)); sc.set(1, 1, 1);
  }); postMesh.name = 'posts'; group.add(postMesh);

  // light gantries across the track
  const frames = [], lamps = [];
  for (let s = 140; s < ribbon.length - 60; s += 160) {   // the start straight stays clear for the grid and the showcase camera
    const f = frameAt(ribbon, s);
    const g = gantryGeo(f.width + 1);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z), frameQuat(f), new THREE.Vector3(1, 1, 1));
    g.frame.applyMatrix4(m); g.lamps.applyMatrix4(m);
    frames.push(g.frame); lamps.push(g.lamps);
  }
  // a sponsor banner hangs from every gantry, facing oncoming racers
  let gi = 0;
  for (let s = 140; s < ribbon.length - 60; s += 160, gi++) {
    const f = frameAt(ribbon, s), id = SPONSOR_IDS[(gi * 3 + track.id.length) % SPONSOR_IDS.length];
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(12, f.width * 0.5), 2.4), new THREE.MeshBasicMaterial({ map: sponsorAdTexture(id, gi % 2), side: THREE.DoubleSide, toneMapped: false }));
    banner.position.set(f.pos.x + f.up.x * 6.4, f.pos.y + f.up.y * 6.4, f.pos.z + f.up.z * 6.4);
    banner.quaternion.copy(frameQuat(f));
    banner.userData.noShadow = true;
    group.add(banner);
  }
  if (frames.length) {
    const gm = new THREE.Mesh(mergeGeometries(frames), metal); gm.frustumCulled = false; gm.name = 'gantry'; group.add(gm);
    const lm = new THREE.Mesh(mergeGeometries(lamps), new THREE.MeshBasicMaterial({ color: env.lamp ?? 0xfff6e0 })); lm.frustumCulled = false; group.add(lm);
  }

  // pads
  const padGeo = new THREE.PlaneGeometry(5, 6);
  const padMat = new THREE.MeshBasicMaterial({ map: padTexture(env.pad ?? 0x2df1ff), transparent: true, opacity: 0.95 });
  const padOff = new THREE.MeshBasicMaterial({ map: padTexture(0x3a4050), transparent: true, opacity: 0.6 });
  const pads = [];
  const rows = [];
  for (const row of track.pads) for (const t of row.lanes) rows.push({ s: row.s, t });
  const housing = new THREE.BoxGeometry(5.8, 0.16, 6.8);
  const housings = [];
  for (const p of rows) {
    const m = new THREE.Mesh(padGeo, padMat);
    poseObject(m, ribbon, p.s, p.t, 0.1, 0);
    m.rotateX(-Math.PI / 2);
    group.add(m);
    pads.push({ mesh: m, on: padMat, off: padOff });
    housings.push(p);
  }
  const housingMesh = instanced(housing, metal, housings, (p, pos, q, sc) => {
    const w = toWorld(ribbon, p.s, p.t, 0.02);
    pos.set(w.x, w.y, w.z); q.copy(frameQuat(w.frame)); sc.set(1, 1, 1);
  }); housingMesh.name = 'housings'; group.add(housingMesh);

  // skid marks where the corners bite: local maxima of curvature, a few streaks each
  const skids = [], rng = makeRng(17);
  let lastS = -1e9;
  for (let i = 2; i < n - 2; i++) {
    const f = ribbon.frames[i], c = Math.abs(f.curvature);
    if (c < 0.011 || c < Math.abs(ribbon.frames[i - 2].curvature) || c < Math.abs(ribbon.frames[i + 2].curvature) || f.s - lastS < 90) continue;
    lastS = f.s;
    const count = 2 + rng.int(0, 3);
    for (let k = 0; k < count; k++) {
      const s0 = f.s - 30 + rng() * 30, t = (rng() - 0.5) * (f.width - 8) + (f.curvature > 0 ? -3 : 3);
      const w = toWorld(ribbon, s0, t, 0.05);
      const g = new THREE.PlaneGeometry(2.4, 12 + rng() * 10); g.rotateX(-Math.PI / 2);
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(w.x, w.y, w.z), frameQuat(w.frame).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rng() - 0.5) * 0.25)), new THREE.Vector3(1, 1, 1)));
      skids.push(g);
    }
  }
  if (skids.length) {
    const sm = new THREE.Mesh(mergeGeometries(skids), new THREE.MeshBasicMaterial({ map: skidTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    sm.frustumCulled = false; sm.userData.noShadow = true; group.add(sm);
  }

  // start line
  const f0 = frameAt(ribbon, 0);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(f0.width, 4), new THREE.MeshBasicMaterial({ map: checkerTexture() }));
  poseObject(line, ribbon, 0, 0, 0.06, 0);
  line.rotateX(-Math.PI / 2);
  group.add(line);

  return { group, pads, surface };
}

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _q = new THREE.Quaternion();

/** quaternion whose -z is the frame's heading and +y its up */
export function frameQuat(f) {
  _z.set(-f.tangent.x, -f.tangent.y, -f.tangent.z);
  _y.set(f.up.x, f.up.y, f.up.z);
  _x.crossVectors(_y, _z).normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  return new THREE.Quaternion().setFromRotationMatrix(_m);
}

/**
 * Place an object at ribbon coords with its -z toward the heading (three's
 * forward), leaning `roll` radians about that heading and lifting the nose by
 * `pitch` radians about its own right.
 */
export function poseObject(obj, ribbon, s, t, h, yaw, roll = 0, hover = 0, pitch = 0) {
  const w = toWorld(ribbon, s, t, h + hover);
  const f = w.frame;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  // heading = tangent rotated by yaw toward right
  _z.set(-(f.tangent.x * cy + f.right.x * sy), -(f.tangent.y * cy + f.right.y * sy), -(f.tangent.z * cy + f.right.z * sy));
  _y.set(f.up.x, f.up.y, f.up.z);
  _x.crossVectors(_y, _z).normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  if (roll) { _q.setFromAxisAngle(_z, roll); obj.quaternion.premultiply(_q); }
  if (pitch) { _q.setFromAxisAngle(_x, pitch); obj.quaternion.premultiply(_q); }
  obj.position.set(w.x, w.y, w.z);
  return w;
}

export { HOVER_HEIGHT };
