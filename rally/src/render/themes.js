// ============================================================================
// What each circuit is made of: its palette, the shape of its obstacles, and
// the scenery beyond the barriers.
//
// The scenery is the whole reason the camera is a perspective one. Everything
// here is extruded up off the ground and placed outside the road, so it leans
// away from the middle of the screen and slides against the ground as the camera
// follows the car — parallax that falls out of the geometry rather than being
// faked in layers. Nothing is ever placed where a car can reach it.
// ============================================================================

import { frameAt } from '../../../shared/sim/spline.js';

/** walk the ribbon dropping things beyond the barrier on one side or both */
function alongside(track, rng, THREE, spacing, build, { minOffset = 8, maxOffset = 46, sides = [-1, 1] } = {}) {
  const group = new THREE.Group();
  const { ribbon } = track;
  for (let s = 0; s < ribbon.length; s += spacing * (0.6 + rng() * 0.8)) {
    const f = frameAt(ribbon, s);
    for (const side of sides) {
      if (rng() > 0.72) continue;
      const off = f.width / 2 + minOffset + rng() * (maxOffset - minOffset);
      const mesh = build(rng, THREE);
      if (!mesh) continue;
      mesh.position.set(f.pos.x + f.right.x * off * side, mesh.position.y, f.pos.z + f.right.z * off * side);
      mesh.rotation.y = rng() * Math.PI * 2;
      mesh.castShadow = true;
      group.add(mesh);
    }
  }
  return group;
}

const mat = (THREE, color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });

/** a stack of flattened car bodies, the junkyard's own wall */
function carStack(rng, THREE, colours) {
  const g = new THREE.Group();
  const n = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const h = 0.75 + rng() * 0.25;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(4.2 + rng() * 0.6, h, 1.9 + rng() * 0.4),
      mat(THREE, colours[Math.floor(rng() * colours.length)]));
    body.position.set((rng() - 0.5) * 0.7, i * h + h / 2, (rng() - 0.5) * 0.5);
    body.rotation.y = (rng() - 0.5) * 0.35;
    g.add(body);
  }
  return g;
}

/** a rough box with its top pushed about, for rocks and rubble */
function chunk(rng, THREE, size, colour) {
  const g = new THREE.BoxGeometry(size, size * (0.7 + rng() * 0.6), size * (0.8 + rng() * 0.5), 2, 2, 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) * (0.75 + rng() * 0.5), pos.getY(i) * (0.75 + rng() * 0.5), pos.getZ(i) * (0.75 + rng() * 0.5));
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat(THREE, colour));
  m.position.y = size * 0.35;
  return m;
}

export const THEMES = {
  scrapyard: {
    sky: 0x9a8d78, skyLight: 0xd8cfb6, groundLight: 0x4a3f33, sunColour: 0xfff0d4,
    fill: 1.0, sun: 1.45,
    ground: 0x7a6b55, road: 0x4b4540, wall: 0x8c7855, kerbA: 0xd44b3a, kerbB: 0xe8e2d6,

    obstacle(o, THREE) {
      const g = new THREE.Group();
      if (o.kind === 'crusher') {
        const base = new THREE.Mesh(new THREE.BoxGeometry(o.r * 1.7, 4.5, o.r * 1.7), mat(THREE, 0x8a4a2a, { metalness: 0.3 }));
        base.position.y = 2.25;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(o.r * 2.6, 0.8, 1.1), mat(THREE, 0xb5b0a4, { metalness: 0.5 }));
        arm.position.y = 5.2;
        g.add(base); g.add(arm);
      } else if (o.kind === 'drums') {
        for (let i = 0; i < 5; i++) {
          const d = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.7, 10),
            mat(THREE, [0xd4b03a, 0x3a6fd4, 0xd44b3a][i % 3]));
          const a = i / 5 * Math.PI * 2;
          d.position.set(Math.cos(a) * (o.r - 0.8), 0.85 + (i % 2) * 1.7, Math.sin(a) * (o.r - 0.8));
          g.add(d);
        }
      } else {
        const s = carStack(Math.random, THREE, [0x7a3b2e, 0x2e4a7a, 0x6a6a5a, 0x8a7a3a]);
        s.scale.setScalar(o.r / 2.6);
        g.add(s);
      }
      return g;
    },

    scenery(track, rng, THREE) {
      const group = new THREE.Group();
      // stacks of dead cars right up against the barriers, then bigger heaps behind
      group.add(alongside(track, rng, THREE, 26, (r, T) => carStack(r, T, [0x7a3b2e, 0x2e4a7a, 0x6a6a5a, 0x8a7a3a, 0x4a6a3a]),
        { minOffset: 4, maxOffset: 22 }));
      group.add(alongside(track, rng, THREE, 55, (r, T) => {
        const m = new T.Mesh(new T.ConeGeometry(7 + r() * 6, 6 + r() * 7, 7), mat(T, 0x5a4e3e));
        m.position.y = 3;
        return m;
      }, { minOffset: 30, maxOffset: 90 }));
      // shipping containers: tall, square and good at showing which way the camera is leaning
      group.add(alongside(track, rng, THREE, 70, (r, T) => {
        const m = new T.Mesh(new T.BoxGeometry(12, 2.9, 2.6),
          mat(T, [0xc2542f, 0x2f7ac2, 0x3f9a5a, 0xd0b03a][Math.floor(r() * 4)], { metalness: 0.25 }));
        m.position.y = 1.45 + (r() < 0.4 ? 2.9 : 0);
        return m;
      }, { minOffset: 24, maxOffset: 80 }));
      // and one crane arm over the back straight, high enough to pass over the cars
      const f = frameAt(track.ribbon, track.ribbon.length * 0.42);
      const crane = new THREE.Group();
      const tower = new THREE.Mesh(new THREE.BoxGeometry(3, 34, 3), mat(THREE, 0xd8a12a, { metalness: 0.4 }));
      tower.position.y = 17;
      const jib = new THREE.Mesh(new THREE.BoxGeometry(76, 2.2, 2.2), mat(THREE, 0xd8a12a, { metalness: 0.4 }));
      jib.position.set(22, 33, 0);
      const magnet = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.6, 14), mat(THREE, 0x2a2a2e, { metalness: 0.7 }));
      magnet.position.set(44, 26, 0);
      crane.add(tower); crane.add(jib); crane.add(magnet);
      crane.position.set(f.pos.x + f.right.x * (f.width / 2 + 34), 0, f.pos.z + f.right.z * (f.width / 2 + 34));
      crane.rotation.y = Math.atan2(-f.right.x, -f.right.z);
      group.add(crane);
      return group;
    }
  },

  // -------------------------------------------------------------- harbour --
  harbour: {
    sky: 0x121c2e, skyLight: 0x6d8ec2, groundLight: 0x1a2130, sunColour: 0xc8d8ff,
    fill: 3.2, sun: 0.7,
    ground: 0x2e3541, road: 0x5b6472, wall: 0x78818f, kerbA: 0xe8e2d6, kerbB: 0x39424f,

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
      // stacks of containers, the taller the further back: the parallax is the point
      group.add(alongside(track, rng, THREE, 17, (r, T) => {
        const stack = new T.Group();
        const high = 1 + Math.floor(r() * 4);
        for (let i = 0; i < high; i++) {
          const box = new T.Mesh(new T.BoxGeometry(12.2, 2.9, 2.6),
            mat(T, colours[Math.floor(r() * colours.length)], { metalness: 0.25 }));
          box.position.set((r() - 0.5) * 1.2, 1.45 + i * 2.95, (r() - 0.5) * 0.8);
          stack.add(box);
        }
        stack.rotation.y = r() < 0.5 ? 0 : Math.PI / 2;
        return stack;
      }, { minOffset: 5, maxOffset: 70 }));
      // gantry cranes striding over the stacks
      const { ribbon } = track;
      for (let i = 0; i < 5; i++) {
        const f = frameAt(ribbon, ribbon.length * (0.08 + i * 0.19));
        const side = i % 2 ? 1 : -1;
        const crane = new THREE.Group();
        const legMat = mat(THREE, 0xd8d2c4, { metalness: 0.35 });
        for (const dx of [-16, 16]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(2.4, 46, 2.4), legMat);
          leg.position.set(dx, 23, 0);
          crane.add(leg);
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(46, 3.2, 3.2), legMat);
        beam.position.y = 46;
        crane.add(beam);
        const boom = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 54), legMat);
        boom.position.set(0, 50, -12);
        crane.add(boom);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xffd98a }));
        lamp.position.set(0, 52, -34);
        crane.add(lamp);
        crane.position.set(f.pos.x + f.right.x * (f.width / 2 + 46) * side, 0, f.pos.z + f.right.z * (f.width / 2 + 46) * side);
        crane.rotation.y = Math.atan2(f.tangent.x, f.tangent.z);
        group.add(crane);
      }
      // dock lamps close in, so something bright passes the eye every few seconds
      group.add(alongside(track, rng, THREE, 46, (r, T) => {
        const post = new T.Group();
        const mast = new T.Mesh(new T.CylinderGeometry(0.28, 0.4, 13, 7), mat(T, 0x4a505c, { metalness: 0.5 }));
        mast.position.y = 6.5;
        const head = new T.Mesh(new T.BoxGeometry(2.2, 0.6, 1.2), new T.MeshBasicMaterial({ color: 0xffe7b0 }));
        head.position.y = 13;
        post.add(mast); post.add(head);
        return post;
      }, { minOffset: 3, maxOffset: 7 }));
      return group;
    }
  },

  // ---------------------------------------------------------------- ridge --
  ridge: {
    sky: 0x9fb6cf, skyLight: 0xd6e4f2, groundLight: 0x3a3a30, sunColour: 0xfff4e0,
    fill: 1.15, sun: 1.3,
    ground: 0x5f6b4e, road: 0x54514d, wall: 0x7d7364, kerbA: 0xd44b3a, kerbB: 0xe8e2d6,

    obstacle(o, THREE) {
      const g = new THREE.Group();
      const rng = seeded(Math.round(o.s));
      for (let i = 0; i < 3; i++) {
        const c = chunk(rng, THREE, o.r * (0.7 + rng() * 0.5), 0x7a7266);
        c.position.set((rng() - 0.5) * o.r, c.position.y, (rng() - 0.5) * o.r);
        c.rotation.y = rng() * Math.PI;
        g.add(c);
      }
      return g;
    },

    scenery(track, rng, THREE) {
      const group = new THREE.Group();
      // the cliff face on the inside, boulders and pines on the outside
      group.add(alongside(track, rng, THREE, 12, (r, T) => {
        const slab = new T.Mesh(new T.BoxGeometry(14 + r() * 10, 18 + r() * 34, 12 + r() * 10), mat(T, 0x6e6455));
        slab.position.y = (9 + r() * 17) - 2;
        slab.rotation.z = (r() - 0.5) * 0.14;
        return slab;
      }, { minOffset: 6, maxOffset: 34, sides: [-1] }));
      group.add(alongside(track, rng, THREE, 15, (r, T) => chunk(r, T, 2 + r() * 5, 0x7a7266),
        { minOffset: 3, maxOffset: 26, sides: [1] }));
      // pines, thinning with height
      group.add(alongside(track, rng, THREE, 11, (r, T) => {
        const tree = new T.Group();
        const h = 7 + r() * 9;
        const trunk = new T.Mesh(new T.CylinderGeometry(0.28, 0.44, h * 0.35, 6), mat(T, 0x4a3a2a));
        trunk.position.y = h * 0.175;
        const crown = new T.Mesh(new T.ConeGeometry(1.5 + r() * 1.3, h * 0.85, 7), mat(T, 0x2f4a2a));
        crown.position.y = h * 0.6;
        tree.add(trunk); tree.add(crown);
        return tree;
      }, { minOffset: 8, maxOffset: 80, sides: [1] }));
      // and one arch of rock the road runs under
      const f = frameAt(track.ribbon, track.ribbon.length * 0.63);
      const arch = new THREE.Group();
      for (const side of [-1, 1]) {
        const pier = new THREE.Mesh(new THREE.BoxGeometry(9, 26, 13), mat(THREE, 0x6e6455));
        pier.position.set(side * (f.width / 2 + 5.5), 13, 0);
        arch.add(pier);
      }
      const span = new THREE.Mesh(new THREE.BoxGeometry(f.width + 24, 8, 13), mat(THREE, 0x6e6455));
      span.position.y = 28;
      arch.add(span);
      arch.position.set(f.pos.x, 0, f.pos.z);
      arch.rotation.y = Math.atan2(f.tangent.x, f.tangent.z);
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
