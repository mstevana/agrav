// ============================================================================
// AGRAV — the minigun turret. A burst used to be a bare tracer drawn out of
// thin air ahead of the nose; now a hatch opens on the spine, a six-barrel
// gun rises out of it, tracks the nearest car ahead, spins up and fires from
// its muzzle, then drops back in and closes when the ammo runs out.
//
// One geometry set, shared by every craft and built on first use. The whole
// assembly is hidden while it is stowed, so a craft that is not shooting
// costs nothing to draw.
// ============================================================================

import * as THREE from 'three';
import { mergeGeometries } from '../../../shared/gfx/merge.js';
import { glowSprite } from './textures.js';

const RISE = 0.6;           // how far the gun climbs out of the hull, and how deep it stows under the skin
const BARREL = 0.75;        // length of the barrel cluster, muzzle at -z
const SPIN = 34;            // rad/s at full rate
const DOOR = 2.1;           // how far each hatch door swings open, radians

let parts = null;
/** the turret's geometry, built once and shared: doors, the base it turns on, the barrel cluster */
function gunParts() {
  if (parts) return parts;
  // hatch: two doors meeting at x = 0, each hinged on its outer edge
  const door = new THREE.BoxGeometry(0.24, 0.035, 0.52);
  door.translate(-0.12, 0, 0);                        // pivot at the outer edge, leaf reaching inward
  // the socket ring the gun comes up through, and the base it yaws on
  const collar = new THREE.CylinderGeometry(0.17, 0.17, 0.05, 14, 1, true);
  const post = new THREE.CylinderGeometry(0.11, 0.15, 0.3, 12); post.translate(0, 0.15, 0);
  const shoulder = new THREE.SphereGeometry(0.13, 12, 8); shoulder.translate(0, 0.3, 0);
  const base = mergeGeometries([post, shoulder]);
  // barrel cluster: a hub, six tubes on a ring, a muzzle plate — all pointing -z
  const bits = [];
  const hub = new THREE.CylinderGeometry(0.1, 0.08, 0.24, 12); hub.rotateX(Math.PI / 2); hub.translate(0, 0, -0.12);
  bits.push(hub);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const b = new THREE.CylinderGeometry(0.029, 0.029, BARREL, 6);
    b.rotateX(Math.PI / 2); b.translate(Math.cos(a) * 0.07, Math.sin(a) * 0.07, -BARREL / 2 - 0.1);
    bits.push(b);
  }
  const plate = new THREE.TorusGeometry(0.075, 0.02, 5, 12); plate.translate(0, 0, -BARREL - 0.06);
  bits.push(plate);
  parts = { door, collar, base, cluster: mergeGeometries(bits) };
  return parts;
}

/**
 * @param mount  { x, y, z } on the hull where the hatch sits, from the hull table
 * @param metal  the craft's alloy material, shared so the turret adds no new shader
 * @param skin   the airbrake material: the hatch is hull, so it wears the craft's accent
 */
export function makeMinigun(mount, metal, skin) {
  const p = gunParts();
  const group = new THREE.Group();
  group.position.set(mount.x ?? 0, mount.y, mount.z);
  group.visible = false;
  const doorL = new THREE.Mesh(p.door, skin), doorR = new THREE.Mesh(p.door, skin);
  doorL.position.x = -0.24; doorL.rotation.y = Math.PI;   // mirrored, so both hinge outward
  doorR.position.x = 0.24;
  const collar = new THREE.Mesh(p.collar, metal); collar.position.y = -0.02;
  const mast = new THREE.Group();                        // climbs out of the hull
  const yaw = new THREE.Group();                         // trains left and right
  const pitch = new THREE.Group(); pitch.position.y = 0.3;   // elevates on the shoulder
  const barrels = new THREE.Mesh(p.cluster, metal);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSprite(), color: 0xfff1a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.position.set(0, 0, -BARREL - 0.14); flash.scale.set(0.55, 0.55, 1);
  pitch.add(barrels, flash);
  yaw.add(new THREE.Mesh(p.base, metal), pitch);
  mast.add(yaw);
  group.add(doorL, doorR, collar, mast);
  return { group, doorL, doorR, mast, yaw, pitch, barrels, flash, deploy: 0, spin: 0, hold: 0, wantYaw: 0, wantPitch: 0 };
}

const _v = new THREE.Vector3();
const ease = (rate, dt) => 1 - Math.exp(-dt * rate);

/**
 * @param gun     from makeMinigun
 * @param craft   its craft, for turning a world target into the turret's own frame
 * @param firing  a burst is running
 * @param aimAt   world position of the car being shot at, or null to point straight ahead
 */
export function animateMinigun(gun, craft, { firing, aimAt, dead }, dt) {
  // it stays up for a moment after the last round, rather than snapping shut on the tracer
  if (firing && !dead) gun.hold = 0.45; else gun.hold = Math.max(0, gun.hold - dt);
  const want = gun.hold > 0 ? 1 : 0;
  gun.deploy += (want - gun.deploy) * ease(want ? 10 : 5, dt);   // snaps out, sinks back
  if (gun.deploy < 0.002 && want === 0) { gun.deploy = 0; gun.group.visible = false; gun.spin = 0; return; }
  gun.group.visible = true;
  // the doors are through before the gun starts to climb, so it never clips the hatch
  const open = Math.min(1, gun.deploy / 0.45), rise = Math.max(0, (gun.deploy - 0.3) / 0.7);
  gun.doorL.rotation.z = gun.doorR.rotation.z = -open * DOOR;   // mirrored frames, so one sign opens both outward
  gun.mast.position.y = (rise - 1) * RISE;
  if (aimAt) {
    craft.group.updateWorldMatrix(true, false);
    _v.copy(aimAt); craft.group.worldToLocal(_v);
    _v.sub(gun.group.position);
    const flat = Math.hypot(_v.x, _v.z) || 1e-3;
    gun.wantYaw = Math.atan2(-_v.x, -_v.z);
    gun.wantPitch = Math.max(-0.25, Math.min(0.7, Math.atan2(_v.y - 0.3, flat)));
  } else { gun.wantYaw = 0; gun.wantPitch = 0; }
  const k = ease(9, dt);
  gun.yaw.rotation.y += (gun.wantYaw - gun.yaw.rotation.y) * k;
  gun.pitch.rotation.x += (gun.wantPitch - gun.pitch.rotation.x) * k;
  // the barrels wind up with the gun and coast down with it
  gun.spin += ((firing ? SPIN : 0) - gun.spin) * ease(4, dt);
  gun.barrels.rotation.z += gun.spin * dt;
  gun.flash.material.opacity = Math.max(0, gun.flash.material.opacity - dt * 14);
}

/** a round has left the barrel: light the muzzle */
export function flashMinigun(craft) {
  const g = craft?.gun;
  if (g && g.group.visible) g.flash.material.opacity = 1;
}

/** where the barrel is and where it points, in world space — the tracer's origin */
export function minigunMuzzle(craft, pos, dir) {
  const g = craft?.gun;
  if (!g || !g.group.visible || g.deploy < 0.75) return false;   // still inside the hull: fx falls back to the nose line
  g.flash.getWorldPosition(pos);
  g.pitch.getWorldDirection(dir).negate();   // the barrels point down the group's -z
  return true;
}
