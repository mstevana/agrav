// ============================================================================
// AGRAV — environment helpers shared by the three themes: sky dome, lighting,
// fog, sun disc, and seeded placement of scenery along the ribbon that never
// lands on the track and can sit on a terrain height field.
// ============================================================================

import * as THREE from 'three';
import { frameAt } from '../../../../shared/sim/spline.js';
import { makeRng } from '../../../../shared/sim/rng.js';
import { skyDomeTexture, glowSprite, sponsorAdTexture, SPONSOR_IDS } from '../textures.js';
import { mergeGeometries } from '../../../../shared/gfx/merge.js';

/**
 * Sky dome + lights. opts: { stars, nebula, milkyway, clouds, glow, seed, sunPos, sunDisc: {colour, size},
 * hemi, amb (fill intensities; a vacuum wants almost none) }
 */
export function setupSky(scene, env, top, horizon, opts = {}) {
  scene.background = new THREE.Color(env.sky);
  scene.fog = new THREE.FogExp2(env.fog, env.fogDensity);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2400, 32, 16), new THREE.MeshBasicMaterial({ map: skyDomeTexture(top, horizon, opts), side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -10;
  scene.add(dome);
  // three r155+ lights are physically scaled: a sun needs ~3, fill ~1.5 to read as daylight
  const hemi = new THREE.HemisphereLight(top, opts.hemiGround ?? 0x404040, opts.hemi ?? 1.4);
  const sun = new THREE.DirectionalLight(env.sun, env.sunIntensity * 3.2);
  const sp = opts.sunPos || { x: 300, y: 500, z: 200 };
  sun.position.set(sp.x, sp.y, sp.z);
  const amb = new THREE.AmbientLight(env.ambient, opts.amb ?? 1.6);
  scene.add(hemi, sun, amb);
  let sunMesh = null;
  if (opts.sunDisc) {
    const dir = new THREE.Vector3(sp.x, sp.y, sp.z).normalize();
    sunMesh = new THREE.Mesh(new THREE.SphereGeometry(opts.sunDisc.size || 60, 16, 12), new THREE.MeshBasicMaterial({ color: opts.sunDisc.colour || 0xfff3d0, fog: false }));
    sunMesh.position.copy(dir).multiplyScalar(2100);
    scene.add(sunMesh);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSprite(), color: opts.sunDisc.colour || 0xfff3d0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.position.copy(sunMesh.position); halo.scale.set(700, 700, 1);
    scene.add(halo);
  }
  return { dome, sun, hemi, amb, sunMesh };
}

/**
 * Sample positions along the ribbon at `every` metres, on `side` (+1 right /
 * -1 left / 0 both), at a lateral distance of width/2 + gap + jitter, and
 * reject any sample closer than the object's reach to any other part of the
 * track. `y(x, z)` (a terrain) overrides the frame height.
 */
export function placeAlong(ribbon, { every = 30, side = 0, gap = 8, spread = 30, seed = 1, yOffset = 0, halfExtent = 0, y = null, minS = 0, maxS = Infinity } = {}) {
  const rng = makeRng(seed);
  const out = [];
  const coarse = [];
  for (let i = 0; i < ribbon.count; i += 2) coarse.push(ribbon.frames[i]);
  for (let s = 0; s < ribbon.length; s += every) {
    const ss = s + rng() * every * 0.5;
    const f = frameAt(ribbon, ss);
    if (f.isLoop) continue;   // nothing hangs in the air beside a loop-the-loop
    const sides = side === 0 ? [1, -1] : [side];
    for (const sd of sides) {
      // the object's own footprint decides how far out it sits and what it must clear
      const r = typeof halfExtent === 'function' ? halfExtent(rng) : halfExtent;
      const d = f.width / 2 + r + gap + rng() * spread;
      const px = f.pos.x + f.right.x * sd * d, pz = f.pos.z + f.right.z * sd * d;
      const p = { x: px, y: (y ? y(px, pz) : f.pos.y) + yOffset, z: pz };
      const reach = r * 1.45 + 3;   // rotated box corner + margin
      let ok = ss >= minS && ss <= maxS;
      for (const q of coarse) {
        if (!ok) break;
        const dx = q.pos.x - p.x, dz = q.pos.z - p.z, need = q.width / 2 + reach;
        if (dx * dx + dz * dz < need * need && Math.abs(q.pos.y - p.y) < 60) { ok = false; }
      }
      if (ok) out.push({ p, f, sd, rng, u: rng(), r, s: ss });
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

/** split items across several geometry variants (one instanced mesh each); `tint` gives each instance its own shade */
export function instancedVariants(geos, mat, items, setup, tint = null) {
  const g = new THREE.Group();
  geos.forEach((geo, vi) => {
    const mine = items.filter((_, i) => i % geos.length === vi);
    if (!mine.length) return;
    const m = instanced(geo, mat, mine, setup);
    if (tint) { const c = new THREE.Color(); mine.forEach((it, i) => { const [r, gg, b] = tint(it); m.setColorAt(i, c.setRGB(r, gg, b)); }); m.instanceColor.needsUpdate = true; }
    g.add(m);
  });
  return g;
}
/** a mild random shade for instanced rock: brightness ±15 %, a touch warmer or cooler */
export const rockTint = (it) => { const k = 0.85 + it.rng() * 0.3, w = (it.rng() - 0.5) * 0.08; return [k + w, k, k - w]; };

/** one mesh from many absolute-positioned geometries */
export function merged(geos, mat) {
  const g = mergeGeometries(geos.filter(Boolean));
  if (!g) return null;
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

/** place a geometry at (x, y, z) with yaw and scale, returning a transformed copy for merging */
export function placed(geo, x, y, z, yaw = 0, sx = 1, sy = sx, sz = sx) {
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(sx, sy, sz)));
  return g;
}

/** a big ground plane under everything */
export function ground(scene, y, material, size = 6000) {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
  g.rotation.x = -Math.PI / 2; g.position.y = y;
  scene.add(g);
  return g;
}

/** a drifting particle field that follows the camera (rain, dust, spray, motes) */
export function particleField(n, { seed = 1, box = [120, 60, 120], colour = 0xffffff, size = 0.3, opacity = 0.4, fall = 0, drift = [0, 0, 0], map = null, fixedY = null } = {}) {
  const rng = makeRng(seed);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = (rng() - 0.5) * box[0]; pos[i * 3 + 1] = rng() * box[1]; pos[i * 3 + 2] = (rng() - 0.5) * box[2]; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: colour, size, transparent: true, opacity, sizeAttenuation: true, depthWrite: false, ...(map ? { map, blending: THREE.AdditiveBlending } : {}) }));
  pts.frustumCulled = false;
  let t = 0;
  pts.tick = (dt, camera) => {
    t += dt;
    const a = geo.attributes.position.array;
    for (let i = 0; i < n; i++) {
      a[i * 3] += drift[0] * dt + Math.sin(t * 0.7 + i) * 0.4 * dt; a[i * 3 + 1] -= fall * dt; a[i * 3 + 2] += drift[2] * dt;
      if (a[i * 3 + 1] < 0) a[i * 3 + 1] += box[1]; if (a[i * 3 + 1] > box[1]) a[i * 3 + 1] -= box[1];
      if (a[i * 3] > box[0] / 2) a[i * 3] -= box[0]; if (a[i * 3] < -box[0] / 2) a[i * 3] += box[0];
      if (a[i * 3 + 2] > box[2] / 2) a[i * 3 + 2] -= box[2]; if (a[i * 3 + 2] < -box[2] / 2) a[i * 3 + 2] += box[2];
    }
    geo.attributes.position.needsUpdate = true;
    pts.position.set(camera.position.x, fixedY ?? (camera.position.y - box[1] / 2), camera.position.z);
  };
  return pts;
}

/** a PMREM of the sky dome for scene.environment: wet roads, water and hulls reflect the sky */
export function skyEnvironment(renderer, dome) {
  const pm = new THREE.PMREMGenerator(renderer);
  const tmp = new THREE.Scene();
  const clone = new THREE.Mesh(dome.geometry, dome.material);
  tmp.add(clone);
  const rt = pm.fromScene(tmp, 0, 1, 3000);
  pm.dispose();
  return rt.texture;
}

/** mark everything solid in a group as a shadow caster and receiver */
export function markShadows(group, { cast = true, receive = true } = {}) {
  group.traverse(o => {
    if (!o.isMesh || o.isSprite || o.isPoints) return;
    if (o.userData.noShadow) return;
    const m = o.material;
    if (!m || m.transparent || m.blending !== THREE.NormalBlending) return;
    o.castShadow = cast; o.receiveShadow = receive;
  });
}

/** a flock of birds circling a point: one mesh, positions rewritten per frame */
export function flock(n, centre, radius, height, { seed = 1, colour = 0x1c1c24, size = 1.6, speed = 0.35 } = {}) {
  const rng = makeRng(seed);
  const birds = []; for (let i = 0; i < n; i++) birds.push({ a: rng() * 6.28, r: radius * (0.6 + rng() * 0.6), h: height + (rng() - 0.5) * 12, f: rng() * 6.28, s: size * (0.7 + rng() * 0.6) });
  const pos = new Float32Array(n * 6 * 3);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  let t = 0;
  mesh.tick = (dt) => {
    t += dt;
    for (let i = 0; i < n; i++) {
      const b = birds[i], a = b.a + t * speed;
      const cx = centre.x + Math.cos(a) * b.r, cz = centre.z + Math.sin(a) * b.r, cy = b.h + Math.sin(t * 0.7 + b.f) * 3;
      const dx = -Math.sin(a), dz = Math.cos(a);          // heading
      const wx = dz, wz = -dx;                              // wing axis
      const flap = Math.sin(t * 9 + b.f) * 0.7;
      const k = i * 18, s = b.s;
      // two triangles: body → left wing tip, body → right wing tip
      pos.set([cx, cy, cz, cx + dx * s * 0.6, cy, cz + dz * s * 0.6, cx + wx * s * 1.4, cy + flap * s, cz + wz * s * 1.4,
               cx, cy, cz, cx + dx * s * 0.6, cy, cz + dz * s * 0.6, cx - wx * s * 1.4, cy + flap * s, cz - wz * s * 1.4], k);
    }
    geo.attributes.position.needsUpdate = true;
  };
  mesh.tick(0);
  return mesh;
}

/**
 * A world-space sway for anything that should bend with a wind or a current: the tips lean, the
 * base stays put (the lean is weighted by `transformed.y²`, so a geometry whose base sits at y=0
 * pivots correctly — `grassGeo` and the tree canopies are built that way). Instance-aware.
 * `clock` is a shared uniform object `{ value }` the caller ticks.
 */
export function swayMaterial(mat, clock, strength = 0.35, key = 'sway') {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = clock;
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

/**
 * Pools of light on the ground: one additive glow sprite per item, flat to the sky. The cheapest
 * way to make a surface look lit by something it cannot see (city hangs these along the road).
 */
export function glowPools(items, { colour = 0xffffff, scale = 14, opacity = 0.35, yOffset = 0.6 } = {}) {
  const g = new THREE.Group();
  const map = glowSprite();
  for (const it of items) {
    const c = typeof colour === 'function' ? colour(it) : colour;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: c, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    const sc = typeof scale === 'function' ? scale(it) : scale;
    sp.position.set(it.p.x, it.p.y + yOffset, it.p.z); sp.scale.set(sc, sc, 1); g.add(sp);
  }
  return g;
}

/** soft fog cards: additive glow sprites hung between distant scenery */
export function fogCards(items, { colour = 0x8090c0, opacity = 0.07, scale = [60, 26] } = {}) {
  const g = new THREE.Group();
  const glow = glowSprite();
  for (const it of items) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: colour, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.set(it.x, it.y, it.z); sp.scale.set(scale[0], scale[1], 1); g.add(sp);
  }
  return g;
}

/**
 * Roadside billboards: a sponsor advert on a post beyond the barrier every
 * `every` metres, alternating sides, turned to face oncoming racers. `y(x, z)`
 * gives the ground height under the post. Returns { ads: Group, frames: [geo] }
 * so the theme merges the posts into its own metal.
 */
export function billboards(ribbon, { every = 210, seed = 4, gap = 6, w = 14, h = 7, lift = 5, y = null } = {}) {
  const rng = makeRng(seed);
  const ads = new THREE.Group(), frames = [];
  let sd = 1, i = 0;
  for (let s = every * 0.5; s < ribbon.length - 40; s += every, i++) {
    const f = frameAt(ribbon, s + rng() * 40), t = sd * (f.width / 2 + gap + w * 0.5);
    if (f.isLoop) continue;
    const px = f.pos.x + f.right.x * t, pz = f.pos.z + f.right.z * t;
    const base = y ? y(px, pz) : f.pos.y - 1;
    const id = SPONSOR_IDS[(i * 7 + seed) % SPONSOR_IDS.length];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: sponsorAdTexture(id, i % 2), side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(px, Math.max(base, f.pos.y - 2) + lift + h / 2, pz);
    // face back down the track, angled slightly toward the road
    const back = new THREE.Vector3(f.tangent.x, 0, f.tangent.z).normalize().multiplyScalar(-1);
    const toRoad = new THREE.Vector3(-f.right.x * sd, 0, -f.right.z * sd);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), back.multiplyScalar(0.8).add(toRoad.multiplyScalar(0.6)).normalize());
    m.userData.noShadow = true;
    ads.add(m);
    const fr = new THREE.BoxGeometry(w + 0.8, h + 0.8, 0.5); fr.translate(0, 0, -0.35); fr.applyMatrix4(new THREE.Matrix4().compose(m.position, m.quaternion, new THREE.Vector3(1, 1, 1))); frames.push(fr);
    const postH = m.position.y - h / 2 - base;
    for (const dx of [-w * 0.3, w * 0.3]) { const post = new THREE.CylinderGeometry(0.22, 0.28, postH, 8); post.translate(dx, postH / 2, -0.4); post.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(px, base, pz), m.quaternion, new THREE.Vector3(1, 1, 1))); frames.push(post); }
    sd = -sd;
  }
  return { ads, frames };
}
