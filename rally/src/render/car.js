// ============================================================================
// The cars: a lofted body per model, team colour, and a burnt shell to leave
// behind. Seen from above a car is mostly its roof and its shadow, so the
// silhouette carries the identity — a beetle's curve, a truck's slab — and the
// paint carries who it is.
// ============================================================================

import * as THREE from 'three';
import { isLite } from './scene.js';

export const TEAM_COLOURS = [0x2fa8ff, 0xff4d3a, 0x4bd964, 0xffd23a, 0xc06bff, 0xff8a3a];

const SHAPES = {
  vagabond: { len: 3.9, wide: 1.8, roof: 1.25, nose: 0.62, tail: 0.66, curve: 0.95 },
  mongrel:  { len: 4.8, wide: 2.0, roof: 1.45, nose: 0.55, tail: 0.92, curve: 0.35, bed: true },
  stiletto: { len: 4.5, wide: 1.86, roof: 1.00, nose: 0.40, tail: 0.48, curve: 0.65 },
  warden:   { len: 4.9, wide: 2.05, roof: 1.42, nose: 0.52, tail: 0.58, curve: 0.45 },
  behemoth: { len: 5.6, wide: 2.35, roof: 2.05, nose: 0.72, tail: 0.70, curve: 0.15, blade: true },
  valkyrie: { len: 4.7, wide: 2.0, roof: 1.05, nose: 0.34, tail: 0.42, curve: 0.72, wing: true }
};

/** one car, built once and then only moved */
export function makeCarMesh(carId, colour, opts = {}) {
  const s = SHAPES[carId] || SHAPES.vagabond;
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.42, metalness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x16212b, roughness: 0.18, metalness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.45, metalness: 0.7 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(s.wide, 0.72, s.len), paint);
  body.position.y = 0.52;
  g.add(body);

  // the roof: shorter than the body, set back, and rounded by however curvy the car is
  const roofLen = s.len * (s.bed ? 0.38 : 0.56);
  const roof = new THREE.Mesh(
    s.curve > 0.6 ? new THREE.SphereGeometry(s.wide * 0.52, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)
                  : new THREE.BoxGeometry(s.wide * 0.86, s.roof - 0.72, roofLen), glass);
  if (s.curve > 0.6) roof.scale.set(1, (s.roof - 0.6) / (s.wide * 0.52), roofLen / (s.wide * 1.04));
  roof.position.set(0, s.curve > 0.6 ? 0.82 : 0.72 + (s.roof - 0.72) / 2, s.bed ? -s.len * 0.16 : 0);
  g.add(roof);

  // wheels, just visible past the body from above
  const tyre = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10);
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    const w = new THREE.Mesh(tyre, dark);
    w.rotation.z = Math.PI / 2;
    w.position.set(dx * (s.wide / 2 + 0.02), 0.4, dz * s.len * 0.32);
    g.add(w);
  }

  if (s.bed) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(s.wide, 0.42, s.len * 0.42), dark);
    rail.position.set(0, 0.95, s.len * 0.26);
    g.add(rail);
  }
  if (s.wing) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(s.wide * 1.05, 0.12, 0.6), dark);
    wing.position.set(0, 1.12, s.len * 0.46);
    g.add(wing);
  }
  if (s.blade || opts.bumper) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(s.wide * 1.02, 0.46, 0.34), steel);
    blade.position.set(0, 0.5, -s.len / 2 - 0.18);
    g.add(blade);
    if (opts.bumper) {
      for (let i = -2; i <= 2; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.7, 6), steel);
        spike.rotation.x = -Math.PI / 2;
        spike.position.set(i * s.wide * 0.19, 0.5, -s.len / 2 - 0.55);
        g.add(spike);
      }
    }
  }

  g.traverse(o => { if (o.isMesh) { o.castShadow = !isLite(); o.receiveShadow = false; } });
  g.userData = { paint, roof, length: s.len, colour };
  return g;
}

/** paint scorches and darkens as the plating goes */
export function setDamage(mesh, hullFraction) {
  const paint = mesh.userData?.paint;
  if (!paint) return;
  const f = Math.max(0, Math.min(1, hullFraction));
  const base = new THREE.Color(mesh.userData.colour);
  const burnt = new THREE.Color(0x2a2220);
  paint.color.copy(base).lerp(burnt, (1 - f) * 0.8);
  paint.roughness = 0.42 + (1 - f) * 0.45;
  paint.metalness = 0.25 * f;
}

/** what is left after it goes up: a black shell that still blocks the road */
export function makeWreckMesh(carId) {
  const s = SHAPES[carId] || SHAPES.vagabond;
  const g = new THREE.Group();
  const burnt = new THREE.MeshStandardMaterial({ color: 0x24201e, roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(s.wide * 0.94, 0.5, s.len * 0.92), burnt);
  body.position.y = 0.3;
  body.rotation.z = 0.06;
  g.add(body);
  for (let i = 0; i < 3; i++) {
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(0.5 + i * 0.2, 0.3, 0.5), burnt);
    chunk.position.set((i - 1) * 0.7, 0.62, (i - 1) * 0.5);
    chunk.rotation.set(0.3 * i, i, 0.2);
    g.add(chunk);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = !isLite(); });
  return g;
}
