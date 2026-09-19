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

export const THEMES = {
  scrapyard: {
    sky: 0x9a8d78, skyLight: 0xd8cfb6, groundLight: 0x4a3f33, sunColour: 0xfff0d4,
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
  }
};
