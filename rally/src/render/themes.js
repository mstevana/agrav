// ============================================================================
// What each circuit is made of: its light, the materials under the wheels, the
// shape of its obstacles, and the scenery beyond the barriers.
//
// The scenery is the whole reason the camera is a perspective one. Everything
// here is extruded up off the ground and placed outside the road, so it leans
// away from the middle of the screen and slides against the ground as the
// camera follows the car — parallax that falls out of the geometry rather than
// being faked in layers. Nothing is ever placed where a car can reach it.
//
// Materials come from the shared procedural toolkit: a height function per
// texel yields the albedo, a Sobel normal map, a bump map and a roughness map.
// Nothing is downloaded, and the server knows about none of it.
// ============================================================================

import { frameAt } from '../../../shared/sim/spline.js';
import { asphaltSet, concreteSet, scrubGroundSet, cliffSet, metalPlateSet, sandSet, standard } from '../../../shared/gfx/surfaces.js';
import { rock, worldUv } from '../../../shared/gfx/geom.js';
import { fbm2, ridged2, smoothstep } from '../../../shared/gfx/noise.js';

/**
 * The height of the landscape at a point beyond the barrier, matching what the
 * ground mesh does: flat in the corridor around the road, easing out into the
 * theme's own relief over the next thirty metres. Scenery is sunk a little so
 * it beds into the surface instead of hovering over a dip in it.
 */
function groundAt(theme, x, z, away) {
  return -0.14 + theme.groundHeight(x, z, away) * smoothstep(4, 34, away) - 0.35;
}

/** walk the ribbon dropping things beyond the barrier on one side or both */
function alongside(theme, track, rng, THREE, spacing, build, { minOffset = 8, maxOffset = 46, sides = [-1, 1], chance = 0.72, lean = 0, shadow = true } = {}) {
  const group = new THREE.Group();
  const { ribbon } = track;
  for (let s = 0; s < ribbon.length; s += spacing * (0.6 + rng() * 0.8)) {
    const f = frameAt(ribbon, s);
    for (const side of sides) {
      if (rng() > chance) continue;
      const away = minOffset + rng() * (maxOffset - minOffset);
      const off = f.width / 2 + away;
      const mesh = build(rng, THREE);
      if (!mesh) continue;
      const x = f.pos.x + f.right.x * off * side, z = f.pos.z + f.right.z * off * side;
      mesh.position.set(x, mesh.position.y + groundAt(theme, x, z, away), z);
      mesh.rotation.y = rng() * Math.PI * 2;
      if (lean) { mesh.rotation.x = (rng() - 0.5) * lean; mesh.rotation.z = (rng() - 0.5) * lean; }
      mesh.traverse(o => { if (o.isMesh) o.castShadow = shadow; });
      group.add(mesh);
    }
  }
  return group;
}

/** put one thing at a fraction of the way round, a set distance beyond the barrier */
function beside(theme, track, THREE, at, side, off, mesh, { face = 'road', sink = 0 } = {}) {
  const f = frameAt(track.ribbon, track.ribbon.length * at);
  const x = f.pos.x + f.right.x * (f.width / 2 + off) * side;
  const z = f.pos.z + f.right.z * (f.width / 2 + off) * side;
  mesh.position.set(x, mesh.position.y + groundAt(theme, x, z, off) - sink, z);
  mesh.rotation.y = face === 'road'
    ? Math.atan2(-f.right.x * side, -f.right.z * side)
    : Math.atan2(f.tangent.x, f.tangent.z);
  mesh.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return mesh;
}

/**
 * Mark something that passes over the road. The renderer keeps these out of the
 * merged scenery and fades them out as the camera comes underneath, so a bridge
 * reads as a bridge from a distance without ever hiding the car beneath it.
 */
function overhead(group, obj, frame, radius) {
  (group.userData.overhead ||= []).push({ obj, x: frame.pos.x, z: frame.pos.z, r: radius });
}

let ridgeStoneMat = null;
const ridgeStone = () => (ridgeStoneMat ||= standard(cliffSet(0x8d8376), { repeat: [1, 1], bumpScale: 0.25, normalScale: 1.1 }));

const mat = (THREE, color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });

/** a handful of boulder shapes, built once and shared by every rock on the map */
let rockPool = null;
function boulder(THREE, rng, material) {
  if (!rockPool) rockPool = [1, 2, 3, 4, 5].map(i => rock(i * 977, 1, { flat: true, elongate: 0.7 + (i % 3) * 0.25 }));
  const m = new THREE.Mesh(rockPool[Math.floor(rng() * rockPool.length)], material);
  const s = 1.4 + rng() * 3.4;
  m.scale.set(s, s * (0.6 + rng() * 0.5), s * (0.8 + rng() * 0.4));
  return m;
}

/** a stack of flattened car bodies, the junkyard's own wall */
function carStack(rng, THREE, colours) {
  const g = new THREE.Group();
  const n = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const h = 0.75 + rng() * 0.25;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(4.2 + rng() * 0.6, h, 1.9 + rng() * 0.4),
      mat(THREE, colours[Math.floor(rng() * colours.length)], { metalness: 0.2 }));
    body.position.set((rng() - 0.5) * 0.7, i * h + h / 2, (rng() - 0.5) * 0.5);
    body.rotation.y = (rng() - 0.5) * 0.35;
    g.add(body);
  }
  return g;
}

/** a stack of containers, the dock's own wall */
function containerStack(rng, THREE, colours, maxHigh = 4) {
  const g = new THREE.Group();
  const high = 1 + Math.floor(rng() * maxHigh);
  for (let i = 0; i < high; i++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(12.2, 2.9, 2.6),
      mat(THREE, colours[Math.floor(rng() * colours.length)], { metalness: 0.25 }));
    box.position.set((rng() - 0.5) * 1.2, 1.45 + i * 2.95, (rng() - 0.5) * 0.8);
    g.add(box);
  }
  g.rotation.y = rng() < 0.5 ? 0 : Math.PI / 2;
  return g;
}

function tyrePile(rng, THREE) {
  const g = new THREE.Group();
  const black = mat(THREE, 0x1c1a19, { roughness: 0.95 });
  const n = 3 + Math.floor(rng() * 5);
  for (let i = 0; i < n; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.24, 6, 12), black);
    t.rotation.x = Math.PI / 2;
    t.position.set((rng() - 0.5) * 1.6, 0.24 + i * 0.4, (rng() - 0.5) * 1.6);
    t.rotation.z = rng() * Math.PI;
    g.add(t);
  }
  return g;
}

function drums(rng, THREE, colours) {
  const g = new THREE.Group();
  const n = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 1.1, 10),
      mat(THREE, colours[Math.floor(rng() * colours.length)], { metalness: 0.3 }));
    d.position.set((rng() - 0.5) * 2, 0.55 + (rng() < 0.3 ? 1.1 : 0), (rng() - 0.5) * 2);
    if (rng() < 0.2) { d.rotation.z = Math.PI / 2; d.position.y = 0.46; }
    g.add(d);
  }
  return g;
}

/** loose junk: bent plate, offcuts and rod ends, the stuff that collects at a verge */
function litter(rng, THREE, colours) {
  const g = new THREE.Group();
  const n = 2 + Math.floor(rng() * 5);
  for (let i = 0; i < n; i++) {
    const c = colours[Math.floor(rng() * colours.length)];
    const roll = rng();
    let m;
    if (roll < 0.5) {
      m = new THREE.Mesh(new THREE.BoxGeometry(0.7 + rng() * 2.1, 0.09, 0.5 + rng() * 1.3), mat(THREE, c, { metalness: 0.3 }));
      m.position.y = 0.05;
      m.rotation.x = (rng() - 0.5) * 0.3;
    } else if (roll < 0.8) {
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1 + rng() * 2.2, 5), mat(THREE, c, { metalness: 0.45 }));
      m.rotation.z = Math.PI / 2;
      m.position.y = 0.08;
    } else {
      m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), mat(THREE, c, { metalness: 0.2 }));
      m.position.y = 0.3;
    }
    m.position.x += (rng() - 0.5) * 4.5;
    m.position.z += (rng() - 0.5) * 4.5;
    m.rotation.y = rng() * Math.PI;
    g.add(m);
  }
  return g;
}

/** a tuft of dry grass: three crossed blades, cheap and readable from above */
function weeds(rng, THREE, colour) {
  const g = new THREE.Group();
  const m = mat(THREE, colour, { roughness: 1, side: 2 });
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.9 + rng() * 0.7, 0.7 + rng() * 0.8), m);
    blade.position.y = 0.4;
    blade.rotation.y = i * 1.05 + rng() * 0.3;
    g.add(blade);
  }
  return g;
}

function pine(rng, THREE) {
  const tree = new THREE.Group();
  const h = 7 + rng() * 10;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.42, h * 0.35, 6), mat(THREE, 0x40332a));
  trunk.position.y = h * 0.175;
  tree.add(trunk);
  for (let i = 0; i < 3; i++) {
    const r = (1.9 + rng() * 1.2) * (1 - i * 0.24);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.42, 7), mat(THREE, 0x2b4526 + i * 0x040804));
    crown.position.y = h * (0.34 + i * 0.2);
    tree.add(crown);
  }
  return tree;
}

export const THEMES = {
  // ------------------------------------------------------------ scrapyard --
  scrapyard: {
    sky: 0x9a8d78, skyLight: 0xd8cfb6, groundLight: 0x4a3f33, sunColour: 0xfff0d4,
    fill: 1.0, sun: 1.45,
    ground: 0x7a6b55, road: 0x4b4540, wall: 0x8c7855, kerbA: 0xd44b3a, kerbB: 0xe8e2d6,
    post: 0x6a6255, rail: 0x9a8438, sign: 0x2a2620,

    roadSet: () => asphaltSet(0x474139, 0x36322c),
    groundSet: () => scrubGroundSet(0x8d7551),
    groundSet2: () => concreteSet(0x867c6c),
    wallSet: () => metalPlateSet(0x8f7a55),
    groundHeight: (x, z) => fbm2(x * 0.0055, z * 0.0055, { octaves: 4, seed: 11 }) * 11 - 4,
    // bare dirt on the high ground, ash and oil soaked into the hollows
    groundTint: (k, broad) => {
      const m = smoothstep(-0.15, 0.3, broad);
      return [k * (1.06 - m * 0.34), k * (0.98 - m * 0.3), k * (0.86 - m * 0.22)];
    },

    obstacle(o, THREE) {
      const g = new THREE.Group();
      if (o.kind === 'crusher') {
        const base = new THREE.Mesh(new THREE.BoxGeometry(o.r * 1.7, 4.5, o.r * 1.7), mat(THREE, 0x8a4a2a, { metalness: 0.3 }));
        base.position.y = 2.25;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(o.r * 2.6, 0.8, 1.1), mat(THREE, 0xb5b0a4, { metalness: 0.5 }));
        arm.position.y = 5.2;
        const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 2.4, 8), mat(THREE, 0xd8d2c4, { metalness: 0.7, roughness: 0.3 }));
        piston.position.y = 6.4;
        g.add(base); g.add(arm); g.add(piston);
      } else if (o.kind === 'drums') {
        g.add(drums(seeded(Math.round(o.s)), THREE, [0xd4b03a, 0x3a6fd4, 0xd44b3a]));
        g.scale.setScalar(o.r / 2.2);
      } else {
        const s = carStack(seeded(Math.round(o.s)), THREE, [0x7a3b2e, 0x2e4a7a, 0x6a6a5a, 0x8a7a3a]);
        s.scale.setScalar(o.r / 2.6);
        g.add(s);
      }
      return g;
    },

    scenery(track, rng, THREE) {
      const group = new THREE.Group();
      const carColours = [0x7a3b2e, 0x2e4a7a, 0x6a6a5a, 0x8a7a3a, 0x4a6a3a, 0x8a3a5a];
      // dead cars right up against the barriers, then bigger heaps behind
      group.add(alongside(this, track, rng, THREE, 10, (r, T) => carStack(r, T, carColours), { minOffset: 4, maxOffset: 26 }));
      group.add(alongside(this, track, rng, THREE, 15, (r, T) => tyrePile(r, T), { minOffset: 3, maxOffset: 20, chance: 0.6 }));
      group.add(alongside(this, track, rng, THREE, 18, (r, T) => drums(r, T, [0xd4b03a, 0x3a6fd4, 0xd44b3a, 0x8a8a7a]),
        { minOffset: 4, maxOffset: 28, chance: 0.6 }));
      // small junk and dry grass right at the verge, where the eye spends its time
      group.add(alongside(this, track, rng, THREE, 8, (r, T) => litter(r, T, [0x8a7a5a, 0x6a5a4a, 0x9a4a3a, 0x4a5a6a]),
        { minOffset: 2, maxOffset: 14, chance: 0.85, shadow: false }));
      group.add(alongside(this, track, rng, THREE, 6, (r, T) => weeds(r, T, 0x7a6a3a), { minOffset: 1.5, maxOffset: 11, chance: 0.7, shadow: false }));
      // spoil heaps and scrap mountains filling the middle distance
      const dirt = standard(scrubGroundSet(0x6a5a44), { repeat: [1, 1], bumpScale: 0.3 });
      group.add(alongside(this, track, rng, THREE, 60, (r, T) => boulder(T, r, dirt), { minOffset: 30, maxOffset: 120, chance: 0.8, lean: 0.3 }));
      group.add(alongside(this, track, rng, THREE, 90, (r, T) => {
        const m = new T.Mesh(new T.ConeGeometry(9 + r() * 9, 8 + r() * 11, 7), dirt);
        m.position.y = 4;
        return m;
      }, { minOffset: 60, maxOffset: 180 }));
      // containers stacked high enough to lean properly as the camera passes
      group.add(alongside(this, track, rng, THREE, 74, (r, T) =>
        containerStack(r, T, [0xc2542f, 0x2f7ac2, 0x3f9a5a, 0xd0b03a]), { minOffset: 24, maxOffset: 90 }));
      // the crane over the back straight, high enough to pass over the cars
      const crane = new THREE.Group();
      const yellow = mat(THREE, 0xd8a12a, { metalness: 0.4 });
      const tower = new THREE.Mesh(new THREE.BoxGeometry(3, 34, 3), yellow);
      tower.position.y = 17;
      const jib = new THREE.Mesh(new THREE.BoxGeometry(76, 2.2, 2.2), yellow);
      jib.position.set(22, 33, 0);
      const magnet = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.6, 14), mat(THREE, 0x2a2a2e, { metalness: 0.7 }));
      magnet.position.set(44, 26, 0);
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7, 5), mat(THREE, 0x1a1a1c));
      cable.position.set(44, 30, 0);
      crane.add(tower); crane.add(jib); crane.add(magnet); crane.add(cable);
      group.add(beside(this, track, THREE, 0.42, 1, 34, crane, { face: 'along' }));
      // a shed, for somewhere the money changes hands
      const shed = new THREE.Group();
      const walls = new THREE.Mesh(new THREE.BoxGeometry(22, 7, 13), mat(THREE, 0x7a6a55));
      walls.position.y = 3.5;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(23.4, 0.5, 14.4), mat(THREE, 0x5a4a3a, { metalness: 0.3 }));
      roof.position.y = 7.3;
      shed.add(walls); shed.add(roof);
      group.add(beside(this, track, THREE, 0.08, -1, 30, shed));
      return group;
    }
  },

  // -------------------------------------------------------------- harbour --
  harbour: {
    sky: 0x121c2e, skyLight: 0x6d8ec2, groundLight: 0x1a2130, sunColour: 0xc8d8ff,
    fill: 3.2, sun: 0.7,
    ground: 0x2e3541, road: 0x5b6472, wall: 0x78818f, kerbA: 0xe8e2d6, kerbB: 0x39424f,
    post: 0x4a505c, rail: 0xd8d2c4, sign: 0x16202e,

    roadSet: () => asphaltSet(0x545c69, 0x424a56, true),
    groundTile: 17,
    // hardstanding with tarmac patched over it wherever the quay has been dug up
    groundSet: () => concreteSet(0x596170),
    groundSet2: () => asphaltSet(0x3b414b, 0x2b3038, true),
    wallSet: () => concreteSet(0x6d7480),
    // flat dockland, then the quay ends and the basin drops away
    groundHeight: (x, z, away) => fbm2(x * 0.01, z * 0.01, { octaves: 3, seed: 5 }) * 1.4
      - smoothstep(70, 150, away) * 14,
    // wet concrete: the hollows hold rain and go blue-black under the lamps
    groundTint: (k, broad) => {
      const m = smoothstep(-0.1, 0.35, broad);
      return [k * (1 - m * 0.42), k * (1.02 - m * 0.38), k * (1.1 - m * 0.24)];
    },

    obstacle(o, THREE) {
      const g = new THREE.Group();
      if (o.kind === 'bollard') {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.55, o.r * 0.75, 1.5, 10), mat(THREE, 0xd8c23a, { metalness: 0.4 }));
        post.position.y = 0.75;
        g.add(post);
        const chain = new THREE.Mesh(new THREE.TorusGeometry(o.r * 0.8, 0.12, 6, 14), mat(THREE, 0x6a6f78, { metalness: 0.6 }));
        chain.rotation.x = Math.PI / 2;
        chain.position.y = 1.1;
        g.add(chain);
      } else {
        const colours = [0xc2542f, 0x2f7ac2, 0x3f9a5a, 0xd0b03a, 0x8a4a9a];
        for (let i = 0; i < 2; i++) {
          const box = new THREE.Mesh(new THREE.BoxGeometry(o.r * 2.1, 2.7, o.r * 1.5),
            mat(THREE, colours[(i * 3 + Math.round(o.s)) % colours.length], { metalness: 0.25 }));
          box.position.set((i % 2) * 0.4 - 0.2, 1.35 + i * 2.7, 0);
          box.rotation.y = (i - 0.5) * 0.08;
          g.add(box);
        }
      }
      return g;
    },

    scenery(track, rng, THREE) {
      const group = new THREE.Group();
      const colours = [0xc2542f, 0x2f7ac2, 0x3f9a5a, 0xd0b03a, 0x8a4a9a, 0x9a3a3a];
      // the water in the basin, showing wherever the quay has dropped away
      const b = track.bounds;
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry((b.maxX - b.minX) + 900, (b.maxZ - b.minZ) + 900),
        new THREE.MeshStandardMaterial({ color: 0x0b1420, roughness: 0.18, metalness: 0.85 }));
      water.rotation.x = -Math.PI / 2;
      water.position.set((b.minX + b.maxX) / 2, -7.5, (b.minZ + b.maxZ) / 2);
      group.add(water);

      group.add(alongside(this, track, rng, THREE, 11, (r, T) => containerStack(r, T, colours), { minOffset: 5, maxOffset: 62 }));
      // pallets and dropped lashing gear along the quay edge
      group.add(alongside(this, track, rng, THREE, 9, (r, T) => litter(r, T, [0x6a5a42, 0x7a6a52, 0x3f4a56, 0x8a3a2a]),
        { minOffset: 2, maxOffset: 16, chance: 0.8, shadow: false }));
      group.add(alongside(this, track, rng, THREE, 21, (r, T) => {
        const stack = new T.Group();
        const high = 1 + Math.floor(r() * 4);
        for (let i = 0; i < high; i++) {
          const pal = new T.Mesh(new T.BoxGeometry(1.6, 0.18, 1.2), mat(T, 0x6d5a3e));
          pal.position.set((r() - 0.5) * 0.3, 0.09 + i * 0.22, (r() - 0.5) * 0.3);
          stack.add(pal);
        }
        return stack;
      }, { minOffset: 3, maxOffset: 18, chance: 0.6 }));
      group.add(alongside(this, track, rng, THREE, 52, (r, T) => {
        const reel = new T.Group();
        const drum = new T.Mesh(new T.CylinderGeometry(2.1, 2.1, 2.4, 14), mat(T, 0x3a3f48, { metalness: 0.4 }));
        drum.rotation.z = Math.PI / 2;
        drum.position.y = 2.1;
        reel.add(drum);
        return reel;
      }, { minOffset: 6, maxOffset: 26, chance: 0.4 }));

      // gantry cranes striding over the stacks
      const legMat = mat(THREE, 0xd8d2c4, { metalness: 0.35 });
      for (let i = 0; i < 5; i++) {
        const crane = new THREE.Group();
        for (const dx of [-16, 16]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(2.4, 46, 2.4), legMat);
          leg.position.set(dx, 23, 0);
          crane.add(leg);
          const foot = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 6), legMat);
          foot.position.set(dx, 0.6, 0);
          crane.add(foot);
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(46, 3.2, 3.2), legMat);
        beam.position.y = 46;
        crane.add(beam);
        const boom = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 54), legMat);
        boom.position.set(0, 50, -12);
        crane.add(boom);
        const trolley = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 4), mat(THREE, 0x3a4048, { metalness: 0.5 }));
        trolley.position.set(0, 44, -20);
        crane.add(trolley);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd98a }));
        lamp.position.set(0, 52, -34);
        crane.add(lamp);
        group.add(beside(this, track, THREE, 0.08 + i * 0.19, i % 2 ? 1 : -1, 46, crane, { face: 'along' }));
      }

      // dock lamps close in, so something bright passes the eye every few seconds
      group.add(alongside(this, track, rng, THREE, 40, (r, T) => {
        const post = new T.Group();
        const mast = new T.Mesh(new T.CylinderGeometry(0.28, 0.4, 13, 7), mat(T, 0x4a505c, { metalness: 0.5 }));
        mast.position.y = 6.5;
        const arm = new T.Mesh(new T.BoxGeometry(0.2, 0.2, 1.8), mat(T, 0x4a505c, { metalness: 0.5 }));
        arm.position.set(0, 12.8, 0.9);
        const head = new T.Mesh(new T.BoxGeometry(2.2, 0.6, 1.2), new T.MeshBasicMaterial({ color: 0xffe7b0 }));
        head.position.set(0, 12.6, 1.7);
        post.add(mast); post.add(arm); post.add(head);
        return post;
      }, { minOffset: 3, maxOffset: 7 }));

      // a ship at the quay, and a bridge deck the road runs beneath
      const ship = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(24, 11, 130), mat(THREE, 0x3a2a2a, { metalness: 0.3 }));
      hull.position.y = 1.5;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(25, 1.2, 128), mat(THREE, 0x5a5348));
      deck.position.y = 7.2;
      const house = new THREE.Mesh(new THREE.BoxGeometry(18, 14, 22), mat(THREE, 0xc8c4bc));
      house.position.set(0, 14, -44);
      const funnel = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 9, 12), mat(THREE, 0xb03a2a));
      funnel.position.set(0, 24, -48);
      ship.add(hull); ship.add(deck); ship.add(house); ship.add(funnel);
      group.add(beside(this, track, THREE, 0.30, -1, 105, ship, { face: 'along' }));

      // A road bridge the circuit passes beneath. The piers are ordinary scenery;
      // the deck is marked overhead, because a slab of concrete between the
      // camera and your own car is not a detail, it is a blindfold.
      const bf = frameAt(track.ribbon, track.ribbon.length * 0.62);
      const bridge = new THREE.Group();
      const bridgeDeck = new THREE.Group();
      const bridgeSpan = new THREE.Mesh(new THREE.BoxGeometry(bf.width + 150, 2.6, 15), mat(THREE, 0x50565f, { metalness: 0.3 }));
      bridgeSpan.position.y = 19;
      bridgeDeck.add(bridgeSpan);
      for (const dz of [7.2, -7.2]) {
        const kerbRail = new THREE.Mesh(new THREE.BoxGeometry(bf.width + 150, 1.1, 0.5), mat(THREE, 0x8a919c, { metalness: 0.4 }));
        kerbRail.position.set(0, 20.8, dz);
        bridgeDeck.add(kerbRail);
      }
      bridge.add(bridgeDeck);
      for (const side of [-1, 1]) {
        const dx = side * (bf.width / 2 + 26);
        const pier = new THREE.Mesh(new THREE.BoxGeometry(7, 56, 12), mat(THREE, 0x484e57));
        pier.position.set(dx, 10, 0);
        bridge.add(pier);
        const tower = new THREE.Mesh(new THREE.BoxGeometry(4, 24, 4), mat(THREE, 0x5a6069, { metalness: 0.4 }));
        tower.position.set(dx, 32, 0);
        bridge.add(tower);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd98a }));
        lamp.position.set(dx, 44, 0);
        bridge.add(lamp);
      }
      bridge.position.set(bf.pos.x, 0, bf.pos.z);
      bridge.rotation.y = Math.atan2(bf.tangent.x, bf.tangent.z);
      bridge.traverse(o => { if (o.isMesh) o.castShadow = true; });
      group.add(bridge);
      overhead(group, bridgeDeck, bf, 26);
      return group;
    }
  },

  // ---------------------------------------------------------------- ridge --
  ridge: {
    sky: 0x9fb6cf, skyLight: 0xd6e4f2, groundLight: 0x3a3a30, sunColour: 0xfff4e0,
    fill: 1.15, sun: 1.3,
    ground: 0x5f6b4e, road: 0x54514d, wall: 0x7d7364, kerbA: 0xd44b3a, kerbB: 0xe8e2d6,
    post: 0x5a5348, rail: 0xc9ccd2, sign: 0x2b3038,

    roadSet: () => asphaltSet(0x4f4c47, 0x3d3a36),
    groundTile: 12,
    // gravel shoulder with the scrub coming and going across it
    groundSet: () => sandSet(0x8d8670),
    groundSet2: () => scrubGroundSet(0x5d6a3d),
    wallSet: () => cliffSet(0x8a8070),
    // the pass sits on a shoulder: the ground climbs into mountains away from it
    groundHeight: (x, z, away) => {
      const near = fbm2(x * 0.008, z * 0.008, { octaves: 3, seed: 3 }) * 5 - 2;
      const far = ridged2(x * 0.0022, z * 0.0022, { octaves: 5, seed: 17 });
      return near + smoothstep(40, 460, away) * far * 150;
    },
    // the grass goes yellow where the shoulder is thin and the rock comes through
    groundTint: (k, broad) => {
      const m = smoothstep(-0.05, 0.4, broad);
      return [k * (1.04 - m * 0.16), k * (1 + m * 0.04), k * (0.9 - m * 0.16)];
    },

    obstacle(o, THREE) {
      const g = new THREE.Group();
      const rng = seeded(Math.round(o.s));
      const stone = ridgeStone(THREE);
      for (let i = 0; i < 3; i++) {
        const b = boulder(THREE, rng, stone);
        b.scale.multiplyScalar(o.r / 3.2);
        b.position.set((rng() - 0.5) * o.r, 0, (rng() - 0.5) * o.r);
        b.rotation.y = rng() * Math.PI;
        g.add(b);
      }
      return g;
    },

    scenery(track, rng, THREE) {
      const group = new THREE.Group();
      // One material per rock type, built once and shared: the merge buckets by
      // what a material looks like, and a fresh one per boulder would defeat it.
      const stone = standard(cliffSet(0x8d8376), { repeat: [1, 1], bumpScale: 0.25, normalScale: 1.1 });
      const darkStone = standard(cliffSet(0x6b6459), { repeat: [1, 1], bumpScale: 0.25, normalScale: 1.1 });
      // the cut face on the inside of the pass, scree and pines on the outside
      group.add(alongside(this, track, rng, THREE, 11, (r, T) => {
        const box = new T.BoxGeometry(8 + r() * 7, 5 + r() * 9, 7 + r() * 7);
        worldUv(box, 6, 6);
        const slab = new T.Mesh(box, darkStone);
        slab.position.y = (2.5 + r() * 4.5) - 1.4;
        slab.rotation.z = (r() - 0.5) * 0.14;
        return slab;
      }, { minOffset: 4, maxOffset: 30, sides: [-1] }));
      group.add(alongside(this, track, rng, THREE, 9, (r, T) => boulder(T, r, stone), { minOffset: 3, maxOffset: 30, sides: [1], lean: 0.35 }));
      group.add(alongside(this, track, rng, THREE, 26, (r, T) => boulder(T, r, darkStone), { minOffset: 20, maxOffset: 120, chance: 0.85, lean: 0.4 }));
      group.add(alongside(this, track, rng, THREE, 10, (r, T) => pine(r, T), { minOffset: 7, maxOffset: 90, sides: [1] }));
      // scree, tufts and fallen timber, thickest right at the edge of the road
      group.add(alongside(this, track, rng, THREE, 5, (r, T) => weeds(r, T, 0x6f7a3e), { minOffset: 1.5, maxOffset: 16, chance: 0.8, shadow: false }));
      group.add(alongside(this, track, rng, THREE, 12, (r, T) => {
        const g2 = new T.Group();
        for (let i = 0; i < 2 + Math.floor(r() * 4); i++) {
          const b = boulder(T, r, stone);
          b.scale.multiplyScalar(0.16 + r() * 0.2);
          b.position.set((r() - 0.5) * 5, 0, (r() - 0.5) * 5);
          g2.add(b);
        }
        return g2;
      }, { minOffset: 2, maxOffset: 15, chance: 0.75 }));
      group.add(alongside(this, track, rng, THREE, 34, (r, T) => {
        const log = new T.Mesh(new T.CylinderGeometry(0.3, 0.38, 4 + r() * 5, 6), mat(T, 0x4a3a2a));
        log.rotation.z = Math.PI / 2;
        log.position.y = 0.34;
        return log;
      }, { minOffset: 3, maxOffset: 22, chance: 0.5 }));
      group.add(alongside(this, track, rng, THREE, 22, (r, T) => pine(r, T), { minOffset: 12, maxOffset: 150, sides: [-1], chance: 0.35 }));

      // telegraph poles following the road, with a wire between them
      const wood = mat(THREE, 0x4a3c2c);
      let previous = null;
      for (let s = 0; s < track.ribbon.length; s += 46) {
        const f = frameAt(track.ribbon, s);
        const off = f.width / 2 + 5;
        const x = f.pos.x + f.right.x * off, z = f.pos.z + f.right.z * off;
        const y = groundAt(this, x, z, 5);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 9, 6), wood);
        pole.position.set(x, y + 4.5, z);
        const cross = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.16), wood);
        cross.position.set(x, y + 8.4, z);
        cross.rotation.y = Math.atan2(f.tangent.x, f.tangent.z);
        group.add(pole); group.add(cross);
        if (previous) {
          const dx = x - previous.x, dz = z - previous.z;
          const len = Math.hypot(dx, dz);
          const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 4), mat(THREE, 0x2a2a2c));
          wire.position.set((x + previous.x) / 2, (y + previous.y) / 2 + 8.1, (z + previous.z) / 2);
          wire.rotation.z = Math.PI / 2;
          wire.rotation.y = -Math.atan2(dz, dx);
          group.add(wire);
        }
        previous = { x, y, z };
      }

      // a stone hut, and an arch of rock the road runs under
      const hut = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(8, 4.4, 6), mat(THREE, 0x8a8070));
      body.position.y = 2.2;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 3, 4), mat(THREE, 0x5a4034));
      roof.position.y = 5.8;
      roof.rotation.y = Math.PI / 4;
      hut.add(body); hut.add(roof);
      group.add(beside(this, track, THREE, 0.18, 1, 22, hut));

      const f = frameAt(track.ribbon, track.ribbon.length * 0.63);
      const arch = new THREE.Group();
      for (const side of [-1, 1]) {
        const pier = new THREE.Mesh(new THREE.BoxGeometry(9, 38, 13), darkStone);
        pier.position.set(side * (f.width / 2 + 5.5), 13, 0);
        arch.add(pier);
      }
      const crown = new THREE.Group();
      const spanMesh = new THREE.Mesh(new THREE.BoxGeometry(f.width + 24, 8, 13), darkStone);
      spanMesh.position.y = 28;
      crown.add(spanMesh);
      arch.add(crown);
      arch.position.set(f.pos.x, 0, f.pos.z);
      arch.rotation.y = Math.atan2(f.tangent.x, f.tangent.z);
      arch.traverse(o => { if (o.isMesh) o.castShadow = true; });
      overhead(group, crown, f, 22);
      group.add(arch);
      return group;
    }
  }
};

/** a small deterministic generator, so a given obstacle always looks the same */
function seeded(a) {
  a = (a * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
