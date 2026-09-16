// ============================================================================
// The hover-craft model in ribbon space. Pure: the same function runs on the
// server for authority and in the browser for prediction of the local craft.
//
// State (all SI, ribbon coordinates):
//   s     distance along the centreline        t     lateral offset (+right)
//   h     height above the surface             W     world vertical velocity (airborne)
//   yaw   heading relative to the track tangent, + toward +t
//   vs/vt velocity along / across the tangent
// ============================================================================

import { frameAt, wrapS } from '../../sim/spline.js';
import { wrapAngle } from '../../sim/vec.js';
import { IN } from '../../net/protocol.js';
import { GRAVITY, ASSIST, WALL, LANDING, WEAPON } from '../constants.js';

export function makeVehicleState(stats) {
  return {
    s: 0, t: 0, h: 0, W: 0, yaw: 0, vs: 0, vt: 0,
    grounded: true, scraping: false, wallHit: 0, landing: 0,
    boostT: 0, shieldT: 0,
    bits: 0, steer: 0,
    stats
  };
}

/**
 * @param ribbon   track ribbon
 * @param v        vehicle state (mutated)
 * @param input    {bits, steer}
 * @param dt       seconds
 * @param frozen   true during the countdown: no thrust, no steering
 */
export function stepVehicle(ribbon, v, input, dt, frozen = false) {
  const st = v.stats;
  const bits = frozen ? 0 : (input?.bits | 0);
  const steer = frozen ? 0 : Math.max(-1, Math.min(1, input?.steer || 0));
  v.bits = bits; v.steer = steer;
  v.wallHit = 0; v.landing = 0;
  if (frozen) { v.vs = 0; v.vt = 0; v.W = 0; return v; }

  const throttle = (bits & IN.THROTTLE) ? 1 : 0;
  const brake = (bits & IN.BRAKE) ? 1 : 0;
  const abL = (bits & IN.AIRBRAKE_L) ? 1 : 0;
  const abR = (bits & IN.AIRBRAKE_R) ? 1 : 0;
  const airbrake = abL || abR;

  if (v.boostT > 0) v.boostT = Math.max(0, v.boostT - dt);
  if (v.shieldT > 0) v.shieldT = Math.max(0, v.shieldT - dt);
  const boost = v.boostT > 0 ? WEAPON.speed.mult : 1;
  const topSpeed = st.topSpeed * boost;
  const accel = st.accel * boost;

  const f0 = frameAt(ribbon, v.s);
  const speed = Math.hypot(v.vs, v.vt);

  // --- steering: heading responds to the stick, less so at speed; airbrakes bite harder
  const turnScale = 1 / (1 + (speed / st.topSpeed) * 0.55);
  let steerEff = steer + (abR - abL) * 0.45;
  steerEff = Math.max(-1, Math.min(1, steerEff));
  const airMult = airbrake ? st.airbrakeTurn : 1;
  const airborneMult = v.grounded ? 1 : 0.35;
  v.yaw = wrapAngle(v.yaw + steerEff * st.turnRate * turnScale * airMult * airborneMult * dt);
  // pilot assist: hands off the stick, the craft settles back along the track (it never steers a bend for you)
  if (steerEff === 0 && v.grounded) v.yaw -= v.yaw * Math.min(1, ASSIST * dt);

  // --- thrust / drag / brake along the heading
  let velAngle = speed > 0.01 ? Math.atan2(v.vt, v.vs) : v.yaw;
  let vAlong = speed;
  if (v.grounded) {
    const drag = (accel / (topSpeed * topSpeed)) * vAlong * vAlong;     // terminal = topSpeed
    vAlong += (accel * throttle - drag) * dt;
    if (brake) vAlong = Math.max(0, vAlong - st.brake * dt);
    if (airbrake) vAlong = Math.max(0, vAlong - st.airbrakeDrag * dt);
    // grip: velocity direction chases the heading
    const g = Math.min(1, st.grip * (airbrake ? 0.55 : 1) * dt);
    velAngle = velAngle + wrapAngle(v.yaw - velAngle) * g;
  } else {
    const drag = (accel / (topSpeed * topSpeed)) * vAlong * vAlong * 0.4;
    vAlong -= drag * dt;
    const g = Math.min(1, st.grip * 0.15 * dt);
    velAngle = velAngle + wrapAngle(v.yaw - velAngle) * g;
  }
  // banked track: gravity pulls toward the low side
  const bankPull = -GRAVITY * Math.sin(f0.bank) * 0.5;
  v.vs = Math.cos(velAngle) * vAlong;
  v.vt = Math.sin(velAngle) * vAlong + bankPull * dt;

  // --- integrate along the ribbon; the inside of a bend is shorter
  const inner = Math.max(0.35, 1 - f0.curvature * v.t);
  const dsCentre = (v.vs * dt) / inner;
  const s1 = wrapS(ribbon, v.s + dsCentre);
  v.t += v.vt * dt;
  // world directions are preserved while the tangent rotates under the craft
  const dYaw = f0.curvature * dsCentre;
  v.yaw = wrapAngle(v.yaw - dYaw);
  velAngle = wrapAngle(Math.atan2(v.vt, v.vs) - dYaw);
  const sp = Math.hypot(v.vs, v.vt);
  v.vs = Math.cos(velAngle) * sp;
  v.vt = Math.sin(velAngle) * sp;

  const f1 = frameAt(ribbon, s1);
  v.s = s1;

  // --- walls
  const half = f1.width / 2 - st.width / 2;
  v.scraping = false;
  if (v.t > half || v.t < -half) {
    const side = v.t > half ? 1 : -1;
    v.t = side * half;
    const into = v.vt * side;                    // lateral speed into the wall
    if (into > 0) {
      if (into > WALL.hardHit) {
        v.wallHit = into;
        v.vs *= WALL.speedLoss;
        v.yaw = wrapAngle(v.yaw - side * Math.min(0.35, into * 0.02));  // glance off
      }
      v.vt = -into * WALL.bounce * side;
      v.scraping = into <= WALL.hardHit;
    } else {
      v.scraping = Math.abs(v.vt) < 1.5;
    }
    if (v.scraping) v.vs *= WALL.scrapeSlow;
  }

  // --- vertical: stick to the surface unless it drops away faster than gravity
  const surfW0 = f0.slope * v.vs;   // surface vertical speed under the craft (world)
  const surfW1 = f1.slope * v.vs;
  if (f0.isLoop || f1.isLoop) {
    // a loop-the-loop: the craft is held to the road (the crest test below is in world terms
    // and would fling it off the apex); anything airborne on entry is set down without a landing
    v.grounded = true; v.h = 0; v.W = surfW1;
  } else if (v.grounded) {
    const W = surfW0 - GRAVITY * dt;
    if (W > surfW1 + 0.03) {         // crest: the ground falls away faster than gravity
      v.grounded = false;
      v.W = W;
      v.h += (v.W - surfW1) * dt;
    } else {
      v.W = surfW1;
      v.h = 0;
    }
  } else {
    v.W -= GRAVITY * dt;
    v.h += (v.W - surfW1) * dt;
    if (v.h <= 0) {
      v.h = 0;
      const impact = surfW1 - v.W;   // how hard, relative to the surface
      v.landing = impact;
      v.grounded = true;
      v.W = surfW1;
      if (impact > LANDING.hard) v.vs *= LANDING.speedLoss;
    }
  }
  return v;
}

/** hp lost this tick to walls and landings (server applies it; client only shows it) */
export function environmentDamage(v, dt) {
  let dmg = 0;
  if (v.wallHit > WALL.hardHit) dmg += Math.min(WALL.maxHitDamage, (v.wallHit - WALL.hardHit) * WALL.damagePerMs);
  if (v.scraping) dmg += WALL.scrapePerSec * dt;
  if (v.landing > LANDING.damageAbove) dmg += (v.landing - LANDING.damageAbove) * LANDING.damagePerMs;
  return dmg;
}
