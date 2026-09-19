// ============================================================================
// The car: a free 2D body on the ground plane. Pure, and the same function runs
// on the server for authority and in the browser to predict the local car, so
// the two agree bit for bit.
//
// State (world metres and radians):
//   x, z     position on the ground plane      yaw   heading, atan2(fwd.x, fwd.z)
//   vx, vz   world velocity                    s     the ribbon hint, kept for the next search
//
// Velocity is split into the forward and sideways components of the body each
// step: the engine and brakes act on the first, the tyres scrub the second, and
// how fast they scrub it is the Handling stat. Let go of enough of it and the
// car is sliding — less grip, less steering, and the wall is right there.
//
// Sign convention: a frame's `right` is the driver's right, and with that basis
// increasing yaw turns LEFT. Steering is stated the human way (+1 is right) and
// the single flip lives here.
// ============================================================================

import { IN } from '../../net/protocol.js';
import { CAR, CONTACT, NITRO } from '../constants.js';
import { nearestOnRibbon, wallPenetration } from './track.js';

export const forwardOf = (yaw) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });

/**
 * How much of its steering a car has at this speed: none at rest, all of it by
 * turnFullSpeed, fading again at the top end. The bot asks this the same
 * question the step does, so it never calls for a lock the car cannot give.
 */
export function steerAuthority(speed, stats, sliding = false) {
  const a = Math.min(1, speed / CAR.turnFullSpeed) / (1 + (speed / stats.topSpeed) * CAR.highSpeedTurnPenalty);
  return sliding ? a * CAR.slideTurnFactor : a;
}
export const rightOf = (yaw) => ({ x: -Math.cos(yaw), z: Math.sin(yaw) });
export const carRadius = (stats) => CAR.radius * (0.92 + 0.08 * stats.mass);

export function makeCarState(stats, spawn = { x: 0, z: 0, yaw: 0 }) {
  return {
    x: spawn.x, z: spawn.z, yaw: spawn.yaw,
    vx: 0, vz: 0,
    fwd: 0, lat: 0,            // the split of the last step, kept for the HUD and the bots
    sliding: false,
    nitroT: 0,
    bits: 0, steer: 0,
    s: 0, t: 0,                // where the last nearest-point search landed
    frameYaw: spawn.yaw,
    wallHit: 0, scraping: false, obstacleHit: 0,
    radius: carRadius(stats),
    stats
  };
}

/**
 * One fixed step.
 * @param track   prepared track (ribbon, obstacles)
 * @param c       car state, mutated
 * @param input   {bits, steer}
 * @param dt      seconds
 * @param frozen  true on the grid during the countdown: no engine, no steering
 */
export function stepCar(track, c, input, dt, frozen = false) {
  const st = c.stats;
  const bits = frozen ? 0 : (input?.bits | 0);
  const steer = frozen ? 0 : clamp(input?.steer || 0, -1, 1);
  c.bits = bits; c.steer = steer;
  c.wallHit = 0; c.obstacleHit = 0; c.scraping = false;

  if (c.nitroT > 0) c.nitroT = Math.max(0, c.nitroT - dt);
  const nitro = c.nitroT > 0;
  const topSpeed = st.topSpeed * (nitro ? NITRO.boost : 1);
  const accel = st.accel * (nitro ? NITRO.boost : 1);

  const f = forwardOf(c.yaw), r = rightOf(c.yaw);
  let fwd = c.vx * f.x + c.vz * f.z;
  let lat = c.vx * r.x + c.vz * r.z;

  if (frozen) {
    c.vx = 0; c.vz = 0; c.fwd = 0; c.lat = 0; c.sliding = false;
    settle(track, c, dt);
    return c;
  }

  // --- engine and brakes
  const throttle = (bits & IN.THROTTLE) ? 1 : 0;
  const brake = (bits & IN.BRAKE) ? 1 : 0;
  if (brake) {
    if (fwd > 0.4) fwd = Math.max(0, fwd - CAR.brakeDecel * dt);
    else fwd -= CAR.reverseAccel * dt;                      // held at rest: back out of the wall
  } else if (throttle) {
    if (fwd < -0.4) fwd = Math.min(0, fwd + CAR.brakeDecel * dt);
    else fwd += accel * dt;
  }

  // --- drag, then ease back inside the speed the car is capable of
  const dragRef = st.topSpeed * CAR.dragTerminal;
  const quad = accel * (throttle ? 1 : CAR.coastDrag) / (dragRef * dragRef);
  fwd -= (CAR.rollingDrag * fwd + quad * fwd * Math.abs(fwd)) * dt;
  const limit = fwd >= 0 ? topSpeed : topSpeed * CAR.reverseFraction;
  if (Math.abs(fwd) > limit) fwd = approach(fwd, Math.sign(fwd) * limit, 14 * dt);

  // --- steering. Authority builds with speed, then fades at the top end; a car
  // that has let go of the road turns less than one that has not, and a car
  // rolling backwards turns the other way for the same wheel.
  const speed = Math.abs(fwd);
  const authority = steerAuthority(speed, st, c.sliding);
  c.yaw -= steer * st.yawRate * authority * dt * (fwd < 0 ? -1 : 1);
  c.yaw = wrapPi(c.yaw);

  // the body turned under the velocity, so re-split it against the new heading
  const f2 = forwardOf(c.yaw), r2 = rightOf(c.yaw);
  const vx = c.vx, vz = c.vz;
  const carriedFwd = vx * f2.x + vz * f2.z, carriedLat = vx * r2.x + vz * r2.z;
  const dFwd = fwd - (vx * f.x + vz * f.z);
  fwd = carriedFwd + dFwd;
  lat = carriedLat;

  // --- tyres: scrub the sideways component. Handling is how fast.
  const gripRate = st.grip * (c.sliding ? CAR.slideGripFactor : 1);
  lat -= lat * Math.min(1, gripRate * dt);
  c.sliding = Math.abs(lat) > (c.sliding ? CAR.slideThreshold * 0.6 : CAR.slideThreshold);
  if (c.sliding) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), Math.abs(lat) * 0.25 * dt);

  c.vx = f2.x * fwd + r2.x * lat;
  c.vz = f2.z * fwd + r2.z * lat;
  c.fwd = fwd; c.lat = lat;

  c.x += c.vx * dt;
  c.z += c.vz * dt;

  settle(track, c, dt);
  hitObstacles(track, c, dt);
  // An obstacle set into the barrier can push a car straight back through it, so
  // the barrier gets the last word: a car never ends a step inside one, however
  // tight the pocket it has driven into.
  settle(track, c, dt);
  return c;
}

/** find the road under the car, and push it off the barrier if it is through one */
function settle(track, c, dt) {
  const near = nearestOnRibbon(track.ribbon, c.x, c.z, c.s);
  c.s = near.s; c.t = near.t;
  c.frameYaw = Math.atan2(near.frame.tangent.x, near.frame.tangent.z);

  const { pen, side } = wallPenetration(near, c.radius);
  if (pen <= 0) return;
  const n = near.frame.right;                       // the wall's inward normal is -side * right
  const nx = -side * n.x, nz = -side * n.z;
  c.x += nx * pen; c.z += nz * pen;
  c.t -= side * pen;

  const into = -(c.vx * nx + c.vz * nz);            // closing speed into the barrier
  if (into > 0) {
    c.vx += nx * into * (1 + CONTACT.wallRestitution);
    c.vz += nz * into * (1 + CONTACT.wallRestitution);
    if (into > CONTACT.wallHardSpeed) c.wallHit = into;
  }
  // Scrub along the wall in proportion to how hard the car is pressed into it,
  // as a deceleration rather than a fraction of everything it is doing. Taking a
  // share of the whole velocity every step meant a car held against a barrier by
  // somebody alongside lost almost all its speed within a second and then sat
  // there, which is where most of a bot's wasted race used to go.
  scrubAlong(c, nx, nz, Math.max(into, pen * 20), dt);
  const speed = Math.hypot(c.vx, c.vz);
  if (speed > CONTACT.scrapeSpeed && !c.wallHit) c.scraping = true;
}

/** take speed off along a surface the car is pressed against, never across it */
function scrubAlong(c, nx, nz, press, dt) {
  const tx = -nz, tz = nx;
  const along = c.vx * tx + c.vz * tz;
  if (!along) return;
  const scrub = CONTACT.scrubRate * Math.min(1, press / CONTACT.scrubFullPress) * dt;
  const after = Math.sign(along) * Math.max(0, Math.abs(along) - scrub);
  c.vx += tx * (after - along);
  c.vz += tz * (after - along);
}

/** the dead cars, the crusher and the drums that live inside the corridor */
function hitObstacles(track, c, dt) {
  for (const o of track.obstacles) {
    const dx = c.x - o.x, dz = c.z - o.z;
    const d = Math.hypot(dx, dz), min = c.radius + o.r;
    if (d >= min || d <= 1e-6) continue;
    const nx = dx / d, nz = dz / d, pen = min - d;
    c.x += nx * pen; c.z += nz * pen;
    const into = -(c.vx * nx + c.vz * nz);
    if (into > 0) {
      c.vx += nx * into * (1 + CONTACT.restitution);
      c.vz += nz * into * (1 + CONTACT.restitution);
      if (into > CONTACT.wallHardSpeed) c.obstacleHit = Math.max(c.obstacleHit, into);
    }
    // and a small push out of it, so a car wedged against one is not relying on
    // steering it does not have at walking pace to get itself free
    const bias = Math.min(CONTACT.separate, pen * CONTACT.separateGain);
    c.vx += nx * bias; c.vz += nz * bias;
    scrubAlong(c, nx, nz, Math.max(into, pen * 20), dt);
  }
}

/** hull lost to the scenery this step */
export function environmentDamage(c, dt) {
  let dmg = 0;
  if (c.scraping) dmg += CONTACT.scrapeDamagePerSec * dt;
  const impact = Math.max(c.wallHit, c.obstacleHit);
  if (impact > 0) dmg += (impact - CONTACT.wallHardSpeed) * CONTACT.wallDamagePerSpeed;
  return dmg;
}

export const speedOf = (c) => Math.hypot(c.vx, c.vz);

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function approach(v, target, rate) { return v > target ? Math.max(target, v - rate) : Math.min(target, v + rate); }
function wrapPi(a) {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
}
