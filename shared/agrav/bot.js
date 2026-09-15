// ============================================================================
// Bot driver: aims at a point ahead on a curvature-biased racing line, feeds
// forward the steering the track's own curvature demands so it turns with the
// road, airbrakes (and brakes) for bends it cannot make at its current speed,
// keeps a lane of its own so a full grid does not pile up, and uses items with
// simple judgement. Used by the server to fill grids, by tools/balance.js to
// compare craft, and by tools/netsim.js as a synthetic client.
// ============================================================================

import { frameAt, deltaS } from '../sim/spline.js';
import { wrapAngle } from '../sim/vec.js';
import { IN } from '../net/protocol.js';
import { acquireTarget } from './sim/weapons.js';

export function makeBot(opts = {}) {
  return {
    skill: opts.skill ?? 1,            // 0.7 .. 1.1: lookahead, reaction, how late it brakes
    noise: opts.noise ?? 0.15,
    lane: opts.lane ?? 0,              // preferred lateral offset, metres
    wobble: 0, phase: (opts.phase ?? Math.random()) * 100
  };
}

/** worst curvature over the next `dist` metres */
function maxCurvatureAhead(ribbon, s, dist) {
  let worst = 0;
  for (let d = 0; d <= dist; d += ribbon.step * 2) {
    const c = frameAt(ribbon, s + d).curvature;
    if (Math.abs(c) > Math.abs(worst)) worst = c;
  }
  return worst;
}

/** @returns {{bits:number, steer:number}} */
export function botInput(race, r, bot, tick) {
  const v = r.v;
  const st = r.stats;
  const ribbon = race.ribbon;
  const speed = Math.hypot(v.vs, v.vt);
  const look = 16 + speed * 0.38 * bot.skill;
  const fHere = frameAt(ribbon, v.s);
  const fAhead = frameAt(ribbon, v.s + look);
  const fFar = frameAt(ribbon, v.s + look * 2.5);
  const half = fAhead.width / 2 - st.width;

  // --- racing line: inside of the coming bend, own lane on the straights
  const bend = fAhead.curvature * 0.6 + fFar.curvature * 0.4;
  let tTarget = bend * 2600 + bot.lane * Math.max(0, 1 - Math.abs(bend) * 400);
  // give way to a craft directly ahead, avoid armed mines
  for (const o of race.racers) {
    if (o.id === r.id || o.dead || o.finished) continue;
    const ds = deltaS(ribbon, v.s, o.v.s);
    if (ds > 2 && ds < 22 && Math.abs(o.v.t - tTarget) < 3.5) tTarget += o.v.t > v.t ? -4 : 4;
  }
  for (const p of race.projectiles) {
    if (p.kind !== 'mine' || !p.armed) continue;
    const ds = deltaS(ribbon, v.s, p.s);
    if (ds > 0 && ds < 70 && Math.abs(p.t - tTarget) < 5) tTarget += p.t > tTarget ? -6 : 6;
  }
  bot.wobble += 0.02;
  tTarget += Math.sin(bot.wobble + bot.phase) * bot.noise * 5;
  tTarget = Math.max(-half * 0.75, Math.min(half * 0.75, tTarget));

  // --- can we make the bend at this speed? decide airbrakes / brakes first
  const worst = maxCurvatureAhead(ribbon, v.s, look * 1.6);
  const turnScale = 1 / (1 + (speed / st.topSpeed) * 0.55);
  const available = st.turnRate * turnScale;              // rad/s with no airbrake
  const needed = Math.abs(worst) * speed;                 // rad/s to follow the bend
  let bits = IN.THROTTLE;
  let airMult = 1;
  if (needed > available * 0.72 * bot.skill) {
    bits |= worst > 0 ? IN.AIRBRAKE_R : IN.AIRBRAKE_L;
    airMult = st.airbrakeTurn;
    if (needed > available * airMult * 0.9) { bits &= ~IN.THROTTLE; bits |= IN.BRAKE; }
  }

  // --- steering: track the target point plus the feed-forward the curvature demands
  const wantYaw = Math.atan2(tTarget - v.t, look);
  const err = wrapAngle(wantYaw - v.yaw);
  const ff = fHere.curvature * speed / Math.max(0.3, st.turnRate * turnScale * airMult);
  let steer = err * 2.2 * bot.skill + ff;
  if (Math.abs(err) > 0.4 && !(bits & (IN.AIRBRAKE_L | IN.AIRBRAKE_R))) bits |= err > 0 ? IN.AIRBRAKE_R : IN.AIRBRAKE_L;
  steer = Math.max(-1, Math.min(1, steer));

  // --- items
  if (r.item !== 'none' && r.burstT <= 0) {
    let fire = false;
    switch (r.item) {
      case 'health': fire = r.hp < r.maxHp * 0.6; break;
      case 'shield': fire = r.hp < r.maxHp * 0.5 || race.projectiles.some(p => p.kind === 'missile' && p.target === r.id); break;
      case 'speed': fire = Math.abs(worst) < 0.004; break;
      case 'mines': fire = race.racers.some(o => o.id !== r.id && !o.dead && !o.finished && (() => { const d = deltaS(ribbon, o.v.s, v.s); return d > 5 && d < 70; })()); break;
      default: fire = acquireTarget(race, r) >= 0;
    }
    if (fire && tick % 4 === 0) bits |= IN.FIRE;   // pulse so the edge triggers each shot
  }
  return { bits, steer };
}
