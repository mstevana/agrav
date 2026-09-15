// ============================================================================
// AGRAV — procedural craft meshes. Each of the six craft is built from
// primitives merged per material: hull (team colour), trim (accent), a dark
// canopy and two engine nozzles. Airbrake flaps swing up when used. Facing -z.
// ============================================================================

import * as THREE from 'three';
import { mergeGeometries } from '../../../shared/gfx/merge.js';
import { VEHICLES, BASE } from '../../../shared/agrav/vehicles.js';
import { glowSprite } from './textures.js';

const protos = new Map();

function hullShape(def) {
  const L = BASE.length, W = BASE.width;
  const parts = [];
  const push = (geo, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    geo.scale(sx, sy, sz); geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz); geo.translate(x, y, z); parts.push(geo);
  };
  // central fuselage: a stretched octahedron-ish body
  const body = new THREE.CylinderGeometry(0.55, 0.95, L * 0.78, 8, 1);
  push(body, 0, 0.25, 0.2, 1, 1, 1, Math.PI / 2);
  // nose
  const nose = new THREE.ConeGeometry(0.55, L * 0.32, 8, 1);
  push(nose, 0, 0.25, -L * 0.55, 1, 0.7, 1, -Math.PI / 2);
  // per-craft silhouettes
  switch (def.id) {
    case 'kestrel':   // long, narrow, forward-swept outriggers
      push(new THREE.BoxGeometry(W * 0.95, 0.18, L * 0.55), 0, 0.1, 0.4);
      push(new THREE.BoxGeometry(0.5, 0.35, L * 0.5), -W / 2 + 0.25, 0.15, 0.6);
      push(new THREE.BoxGeometry(0.5, 0.35, L * 0.5), W / 2 - 0.25, 0.15, 0.6);
      break;
    case 'talon':     // stubby delta
      push(new THREE.BoxGeometry(W, 0.22, L * 0.45), 0, 0.12, 0.9, 1, 1, 1, 0, 0, 0);
      push(new THREE.ConeGeometry(0.6, L * 0.4, 4), -W * 0.4, 0.3, 0.3, 1, 1, 1, -Math.PI / 2);
      push(new THREE.ConeGeometry(0.6, L * 0.4, 4), W * 0.4, 0.3, 0.3, 1, 1, 1, -Math.PI / 2);
      break;
    case 'vantage':   // twin-hull catamaran
      push(new THREE.CylinderGeometry(0.42, 0.5, L * 0.7, 6), -W * 0.42, 0.2, 0.3, 1, 1, 1, Math.PI / 2);
      push(new THREE.CylinderGeometry(0.42, 0.5, L * 0.7, 6), W * 0.42, 0.2, 0.3, 1, 1, 1, Math.PI / 2);
      push(new THREE.BoxGeometry(W * 0.9, 0.16, L * 0.3), 0, 0.3, 0.2);
      break;
    case 'bulwark':   // wide armoured slab
      push(new THREE.BoxGeometry(W * 1.05, 0.55, L * 0.6), 0, 0.15, 0.5);
      push(new THREE.BoxGeometry(W * 0.5, 0.3, L * 0.25), 0, 0.55, 0.9);
      break;
    case 'reaper':    // forward-canted fins, aggressive
      push(new THREE.BoxGeometry(W * 0.9, 0.2, L * 0.5), 0, 0.1, 0.6);
      push(new THREE.BoxGeometry(0.15, 0.9, L * 0.35), -W * 0.45, 0.5, 0.9, 1, 1, 1, 0, 0, 0.25);
      push(new THREE.BoxGeometry(0.15, 0.9, L * 0.35), W * 0.45, 0.5, 0.9, 1, 1, 1, 0, 0, -0.25);
      break;
    default:          // corsair: classic swept wing
      push(new THREE.BoxGeometry(W, 0.2, L * 0.4), 0, 0.12, 0.8);
      push(new THREE.BoxGeometry(0.12, 0.7, L * 0.25), 0, 0.7, 1.4);
  }
  // rear engine pods
  push(new THREE.CylinderGeometry(0.4, 0.5, 1.6, 8), -W * 0.32, 0.25, L * 0.42, 1, 1, 1, Math.PI / 2);
  push(new THREE.CylinderGeometry(0.4, 0.5, 1.6, 8), W * 0.32, 0.25, L * 0.42, 1, 1, 1, Math.PI / 2);
  return mergeGeometries(parts);
}

function trimShape() {
  const parts = [];
  const strip = new THREE.BoxGeometry(0.16, 0.06, BASE.length * 0.6); strip.translate(0, 0.62, 0.1); parts.push(strip);
  const l = new THREE.BoxGeometry(BASE.width * 0.7, 0.05, 0.25); l.translate(0, 0.24, BASE.length * 0.2); parts.push(l);
  return mergeGeometries(parts);
}

function canopyShape() {
  const g = new THREE.SphereGeometry(0.42, 10, 8); g.scale(1, 0.7, 1.9); g.translate(0, 0.62, -0.9); return g;
}

function nozzleShape() {
  const parts = [];
  for (const x of [-BASE.width * 0.32, BASE.width * 0.32]) {
    const n = new THREE.CylinderGeometry(0.3, 0.36, 0.3, 10, 1, true); n.rotateX(Math.PI / 2); n.translate(x, 0.25, BASE.length * 0.42 + 0.9); parts.push(n);
  }
  return mergeGeometries(parts);
}

function prototype(def) {
  if (protos.has(def.id)) return protos.get(def.id);
  const hull = new THREE.Mesh(hullShape(def), new THREE.MeshStandardMaterial({ color: def.colour, roughness: 0.45, metalness: 0.55 }));
  const trim = new THREE.Mesh(trimShape(), new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.4, metalness: 0.3, emissive: def.accent, emissiveIntensity: 0.25 }));
  const canopy = new THREE.Mesh(canopyShape(), new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 0.15, metalness: 0.8 }));
  const nozzles = new THREE.Mesh(nozzleShape(), new THREE.MeshStandardMaterial({ color: 0x222630, roughness: 0.6, metalness: 0.7, side: THREE.DoubleSide }));
  const g = new THREE.Group();
  g.add(hull, trim, canopy, nozzles);
  protos.set(def.id, g);
  return g;
}

/** @returns {{group, exhaust:[Sprite,Sprite], flapL, flapR, colour}} */
export function buildCraft(vehicleId) {
  const def = VEHICLES.find(v => v.id === vehicleId) || VEHICLES[5];
  const group = prototype(def).clone();
  const glow = glowSprite();
  const exhaust = [];
  for (const x of [-BASE.width * 0.32, BASE.width * 0.32]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: def.colour, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.set(x, 0.25, BASE.length * 0.42 + 1.1);
    sp.scale.set(1.2, 1.2, 1);
    group.add(sp);
    exhaust.push(sp);
  }
  const flapMat = new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.5, metalness: 0.4 });
  const flapGeo = new THREE.BoxGeometry(0.9, 0.06, 0.7);
  flapGeo.translate(0, 0, 0.35);
  const flapL = new THREE.Mesh(flapGeo, flapMat), flapR = new THREE.Mesh(flapGeo, flapMat);
  flapL.position.set(-BASE.width * 0.45, 0.35, BASE.length * 0.15);
  flapR.position.set(BASE.width * 0.45, 0.35, BASE.length * 0.15);
  group.add(flapL, flapR);
  // a point light under the hull washes the track in team colour
  const light = new THREE.PointLight(def.colour, 0, 14, 2);
  light.position.set(0, -0.5, 0);
  group.add(light);
  return { group, exhaust, flapL, flapR, light, colour: def.colour, def };
}

/** per-frame animation of a craft's dressing */
export function animateCraft(craft, { throttle, abL, abR, boost, speedFrac, dead }) {
  const e = throttle ? (boost ? 2.4 : 1.4 + speedFrac * 0.6) : 0.5;
  for (const sp of craft.exhaust) { sp.scale.set(e, e * 0.8, 1); sp.material.opacity = dead ? 0 : 0.9; }
  craft.flapL.rotation.x = THREE.MathUtils.lerp(craft.flapL.rotation.x, abL ? -0.9 : 0, 0.3);
  craft.flapR.rotation.x = THREE.MathUtils.lerp(craft.flapR.rotation.x, abR ? -0.9 : 0, 0.3);
  craft.light.intensity = dead ? 0 : (boost ? 3 : 1.2);
  craft.group.visible = !dead;
}
