// ============================================================================
// AGRAV — pterosaurs for Inferno Basin.
//
// These were eight flat black triangles each, which read from below as a
// silhouette and from anywhere else as a sliver of paper. They are solid now:
// a lofted body with a long neck, a skull with a dagger beak and a swept-back
// crest, trailing legs, and wings built the way a pterosaur's are -- a membrane
// stretched between an arm bone and one enormously long finger, cambered so it
// billows, hinged at the shoulder and again at the wrist so the tip lags the
// stroke. They glide for long stretches and beat in bursts, bank into the
// circles they wheel on, and are lit like everything else, so the melt below
// catches their bellies and the undersides of their wings.
//
// One flock is five instanced meshes (body, and inner and outer wing each side),
// so a flock is five draw calls however many birds are in it.
// ============================================================================

import * as THREE from 'three';
import { mergeGeometries } from '../../../../shared/gfx/merge.js';
import { makeRng } from '../../../../shared/sim/rng.js';

// the wing's joints in the body's frame: +x forward, +y up, +z to the right
const SHOULDER = new THREE.Vector3(0.35, 0.1, 0.16);
const WRIST = new THREE.Vector3(-0.15, 0.02, 1.35);    // from the shoulder
const TIP = new THREE.Vector3(-0.75, 0, 1.5);          // from the wrist

/**
 * @param n birds; centre {x, z} they wheel round; radius and height of the wheel
 * @param opts { seed, size: body scale in metres per unit (the span is about 5.6 units) }
 */
export function pteroFlock(n, centre, radius, height, { seed = 1, size = 9 } = {}) {
  const rng = makeRng(seed);
  const birds = [];
  for (let i = 0; i < n; i++) birds.push({ a: rng() * 6.28, r: radius * (0.6 + rng() * 0.6), h: height + (rng() - 0.5) * 30, f: rng() * 6.28, s: size * (0.75 + rng() * 0.5), w: 0.07 + rng() * 0.07, dir: rng() < 0.5 ? 1 : -1 });

  const skin = new THREE.MeshStandardMaterial({ color: 0x3a2a26, roughness: 0.6, metalness: 0 });
  // The membrane is thin enough for the melt's glow to come through it where it thins toward the
  // trailing edge, which is also what keeps a bird a hundred metres up readable against a dark sky.
  const map = membraneMap();
  const membrane = new THREE.MeshStandardMaterial({ color: 0xffffff, map, emissive: 0xff5a28, emissiveMap: map, emissiveIntensity: 0.35, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const inner = wingInner(), outer = wingOuter();
  const parts = {
    body: new THREE.InstancedMesh(bodyGeometry(), skin, n),
    innerR: new THREE.InstancedMesh(inner, membrane, n), outerR: new THREE.InstancedMesh(outer, membrane, n),
    innerL: new THREE.InstancedMesh(mirror(inner), membrane, n), outerL: new THREE.InstancedMesh(mirror(outer), membrane, n),
  };
  const group = new THREE.Group();
  group.name = 'pteros';
  for (const m of Object.values(parts)) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(m); }

  const bird = new THREE.Matrix4(), joint = new THREE.Matrix4(), hinge = new THREE.Matrix4(), out = new THREE.Matrix4();
  const q = new THREE.Quaternion(), qr = new THREE.Quaternion(), qp = new THREE.Quaternion();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(), fwd = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3();
  const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
  const where = [];   // each bird's position and heading, for tools
  let t = 0;

  // shoulder, then wrist: the outer wing rides on the inner one and bends again on its own
  const wing = (i, sd, flapIn, flapOut) => {
    out.copy(bird).multiply(joint.makeTranslation(SHOULDER.x, SHOULDER.y, SHOULDER.z * sd)).multiply(hinge.makeRotationX(-flapIn * sd));
    (sd > 0 ? parts.innerR : parts.innerL).setMatrixAt(i, out);
    out.multiply(joint.makeTranslation(WRIST.x, WRIST.y, WRIST.z * sd)).multiply(hinge.makeRotationX(-flapOut * sd));
    (sd > 0 ? parts.outerR : parts.outerL).setMatrixAt(i, out);
  };

  group.tick = (dt) => {
    if (!group.userData.freeze) t += dt;
    for (let i = 0; i < n; i++) {
      const b = birds[i], a = b.a + t * b.w * b.dir;
      const r = b.r + Math.sin(t * 0.13 + b.f) * 40;
      // long glides broken by bursts of beating, each bird on its own rhythm
      const burst = Math.max(0, Math.sin(t * 0.42 + b.f * 2.1));
      const amp = 0.12 + 0.88 * burst * burst;
      const ph = t * 2.3 + b.f;
      const flapIn = 0.08 + Math.sin(ph) * 0.38 * amp;         // a little dihedral even when gliding
      const flapOut = 0.04 + Math.sin(ph - 0.7) * 0.45 * amp;   // the tip lags the arm
      pos.set(centre.x + Math.cos(a) * r, b.h + Math.sin(t * 0.31 + b.f) * 9 - Math.cos(ph) * 0.1 * b.s * amp, centre.z + Math.sin(a) * r);
      fwd.set(-Math.sin(a) * b.dir, 0, Math.cos(a) * b.dir);
      right.crossVectors(fwd, up);
      q.setFromRotationMatrix(joint.makeBasis(fwd, up, right));
      // banked into the wheel (the centre is on the right when dir is +1), nose up a touch while beating
      q.multiply(qr.setFromAxisAngle(X, 0.28 * b.dir)).multiply(qp.setFromAxisAngle(Z, 0.04 + 0.06 * amp));
      bird.compose(pos, q, scl.setScalar(b.s));
      parts.body.setMatrixAt(i, bird);
      wing(i, 1, flapIn, flapOut);
      wing(i, -1, flapIn, flapOut);
      (where[i] ||= { pos: new THREE.Vector3(), fwd: new THREE.Vector3() }).pos.copy(pos);
      where[i].fwd.copy(fwd);
    }
    for (const m of Object.values(parts)) m.instanceMatrix.needsUpdate = true;
  };
  group.userData.bird = (i) => ({ pos: where[i].pos.clone(), fwd: where[i].fwd.clone() });
  group.tick(0);
  return group;
}

/** torso and tail, neck, skull, beak, lower jaw, crest and trailing legs, in one geometry */
function bodyGeometry() {
  // torso to tail, turned so the lathe's axis runs nose-forward along +x
  const profile = [[0, -1.9], [0.035, -1.6], [0.06, -1.1], [0.13, -0.6], [0.2, -0.25], [0.23, 0.05], [0.21, 0.35], [0.15, 0.6], [0.095, 0.82], [0.075, 1.02], [0, 1.1]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.LatheGeometry(profile, 10);
  torso.rotateZ(-Math.PI / 2);
  torso.scale(1, 1.15, 0.85);   // deeper than it is wide
  const skull = new THREE.SphereGeometry(1, 12, 8);
  skull.scale(0.32, 0.13, 0.11); skull.rotateZ(-0.08); skull.translate(1.2, 0.05, 0);
  const beak = new THREE.ConeGeometry(0.075, 1.25, 8);
  beak.rotateZ(-Math.PI / 2 - 0.06); beak.scale(1, 1, 0.8); beak.translate(2.0, -0.02, 0);
  const jaw = new THREE.ConeGeometry(0.05, 1.05, 6);
  jaw.rotateZ(-Math.PI / 2 - 0.12); jaw.scale(1, 1, 0.8); jaw.translate(1.85, -0.09, 0);
  // the crest sweeps back and up from the back of the skull: a flattened cone, a blade in profile
  const crest = new THREE.ConeGeometry(0.1, 0.95, 4);
  crest.rotateZ(0.96); crest.scale(1, 1, 0.25); crest.translate(0.66, 0.39, 0);
  const legs = [1, -1].map(sd => {
    const l = new THREE.CylinderGeometry(0.035, 0.02, 0.8, 5);
    l.rotateZ(1.87); l.translate(-0.73, -0.22, 0.14 * sd);
    return l;
  });
  return mergeGeometries([torso, skull, beak, jaw, crest, ...legs]);
}

/**
 * A membrane between a leading edge and a trailing edge, as a grid: u runs out along the span, v back
 * across the chord. It billows upward mid-chord, less toward the tip, and the bone along the leading
 * edge is a tapered tube so the wing has an edge you can see from any angle.
 */
function membraneGeometry(lead0, lead1, trail0, trail1, camber, bone0, bone1, bow) {
  const U = 8, V = 4, pos = [], uv = [], idx = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i <= U; i++) for (let j = 0; j <= V; j++) {
    const u = i / U, v = j / V;
    a.lerpVectors(lead0, lead1, u); b.lerpVectors(trail0, trail1, u);
    // the trailing edge is scalloped, drawn in toward the bone between its two anchors -- the
    // straight edge it had read as a glider's wing, not an animal's
    b.lerp(a, bow * Math.sin(Math.PI * u));
    a.lerp(b, v);
    a.y += Math.sin(Math.PI * v) * camber * (1 - 0.5 * u);
    pos.push(a.x, a.y, a.z); uv.push(u, v);
  }
  for (let i = 0; i < U; i++) for (let j = 0; j < V; j++) {
    const k = i * (V + 1) + j;
    idx.push(k, k + 1, k + V + 1, k + 1, k + V + 2, k + V + 1);
  }
  const sheet = new THREE.BufferGeometry();
  sheet.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sheet.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  sheet.setIndex(idx);
  sheet.computeVertexNormals();
  return mergeGeometries([sheet, tube(lead0, lead1, bone0, bone1)]);
}

/** a tapered tube from a to b, its texture pinned to the dark leading edge of the membrane map */
function tube(a, b, r0, r1) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 6, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.02);
  return g;
}

/** shoulder to wrist; the membrane's root runs back along the flank to the leg */
function wingInner() {
  const O = new THREE.Vector3();
  return membraneGeometry(O, WRIST, new THREE.Vector3(-1.15, -0.18, -0.14), new THREE.Vector3(-0.55, 0, 1.3), 0.09, 0.055, 0.04, 0.22);
}
/** wrist to tip: the one long finger, with the membrane narrowing to nothing at the end */
function wingOuter() {
  const O = new THREE.Vector3();
  return membraneGeometry(O, TIP, new THREE.Vector3(-0.4, -0.02, -0.05), TIP.clone().add(new THREE.Vector3(-0.02, 0, 0)), 0.06, 0.035, 0.012, 0.3);
}

/** the left wing: mirrored across the body's midline, with each triangle turned back the right way round */
function mirror(geo) {
  const g = geo.clone();
  g.scale(1, 1, -1);
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  g.index.needsUpdate = true;
  return g;
}

/**
 * The membrane's colour across the chord: dark and leathery at the bone, thinning toward the trailing
 * edge where the lava light comes through warmer, with faint veins fanning back from the leading edge.
 */
function membraneMap() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#2a1d1b'); grd.addColorStop(0.35, '#3a2521'); grd.addColorStop(1, '#6a3226');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(20,10,8,0.45)'; g.lineWidth = 1;
  for (let k = 0; k < 7; k++) { const x = 4 + k * 9; g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x - 3, 30, x - 8, 64); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
