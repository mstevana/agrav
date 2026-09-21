// ============================================================================
// Bot driver: aims at a point ahead on a curvature-biased racing line, feeds
// forward the steering the track's own curvature demands so it turns with the
// road, airbrakes (and brakes) for bends it cannot make at its current speed,
// keeps a lane of its own so a full grid does not pile up, detours over weapon
// pads when its slot is empty, lines up on a victim before spending a shot,
// and uses items with simple judgement. Used by the server to fill grids, by
// tools/balance.js to compare craft, and by tools/netsim.js as a synthetic
// client.
// ============================================================================

import { frameAt, deltaS } from '../sim/spline.js';
import { wrapAngle } from '../sim/vec.js';
import { IN } from '../net/protocol.js';
import { acquireTarget } from './sim/weapons.js';
import { BOT, WEAPON, BOT_DIFFICULTY } from './constants.js';

export function makeBot(opts = {}) {
  return {
    skill: opts.skill ?? 1,            // 0.7 .. 1.1: lookahead, reaction, how late it brakes
    // The share of the craft it will actually use. skill alone turned out not to set the pace at
    // all -- a bot is on full throttle except when a corner makes it brake, so a better driver only
    // takes a tidier line, and pushed hard it simply crashes more. This is what makes an easier
    // bot slower in a way you can feel.
    pace: opts.pace ?? 1,
    noise: opts.noise ?? 0.15,
    lane: opts.lane ?? 0,              // preferred lateral offset, metres
    wobble: 0, phase: (opts.phase ?? Math.random()) * 100
  };
}

/**
 * The bot for a grid slot at a chosen difficulty. The per-id spread is the one the grid always
 * had, so a row of bots is a row of slightly different drivers rather than five copies -- and so
 * `normal` reproduces the old hardcoded line exactly.
 */
export function botFor(difficulty, id) {
  const d = BOT_DIFFICULTY[difficulty] || BOT_DIFFICULTY.normal;
  return makeBot({ skill: d.skill + ((id * 37) % 5) * 0.05, pace: d.pace, noise: d.noise,
                   lane: ((id % 5) - 2) * 2.2, phase: id * 0.37 });
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

/* exported for tools/tests */
/**
 * The pad the bot should go for: the nearest row ahead that still has a live pad, then the lane in
 * that row closest to where the craft already is. Rows rather than pads, so the choice does not
 * flip to a distant row when a near lane happens to sit further off the line.
 */
export function padAhead(race, r, tWant) {
  let near = Infinity;
  for (const pad of race.pads) {
    if (pad.respawnTick > race.tick) continue;
    const ds = deltaS(race.ribbon, r.v.s, pad.s);
    if (ds < BOT.padNear || ds > BOT.padLook || ds >= near) continue;
    near = ds;
  }
  if (near === Infinity) return null;
  let best = null, bc = Infinity;
  for (const pad of race.pads) {
    if (pad.respawnTick > race.tick) continue;
    const ds = deltaS(race.ribbon, r.v.s, pad.s);
    if (ds < BOT.padNear || ds > near + 6) continue;      // the same row
    const cost = Math.abs(pad.t - tWant);
    if (cost < bc) { bc = cost; best = { pad, ds }; }
  }
  return best;
}

/** nearest live racer ahead an unguided shot could reach, with the rocket's lead worked out */
function gunTarget(race, r) {
  const v = r.v;
  let best = null, bd = Infinity;
  for (const o of race.racers) {
    if (o.id === r.id || o.dead || o.finished) continue;
    const ds = deltaS(race.ribbon, v.s, o.v.s);
    if (ds <= 2 || ds > BOT.gunRange || ds >= bd) continue;
    if (Math.abs(o.v.h - v.h) > 3.5) continue;
    bd = ds;
    best = { o, ds, lead: o.v.t + o.v.vt * (ds / WEAPON.rocket.speed) };
  }
  return best;
}

/** where the craft's nose is pointing, `ds` metres out */
function aimT(v, ds) {
  return v.t + Math.tan(Math.max(-1.3, Math.min(1.3, v.yaw))) * ds;
}

/** something inbound worth burning a shield on */
function threatened(race, r) {
  const v = r.v;
  for (const p of race.projectiles) {
    if (p.kind === 'missile' && p.target === r.id) return true;
    if (p.owner === r.id) continue;
    const ds = deltaS(race.ribbon, p.s, v.s);      // + when the projectile is behind us
    if (p.kind === 'rocket' && ds > 0 && ds < BOT.dodgeRocket && Math.abs(p.t - v.t) < 6) return true;
    if (p.kind === 'mine' && p.armed && ds < 0 && ds > -BOT.dodgeMine && Math.abs(p.t - v.t) < 5) return true;
  }
  return false;
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

  // --- can we make the bend at this speed? decide airbrakes / brakes first
  const worst = maxCurvatureAhead(ribbon, v.s, look * 1.6);
  const turnScale = 1 / (1 + (speed / st.topSpeed) * 0.55);
  const available = st.turnRate * turnScale;              // rad/s with no airbrake
  const needed = Math.abs(worst) * speed;                 // rad/s to follow the bend
  let bits = IN.THROTTLE;
  // Off the throttle, coasting, not braking. Skipped entirely at full pace, so medium and hard are
  // the uncapped driver exactly rather than one that clips at its own top speed. The boost has to
  // be in the ceiling either way: turbo raises the craft's top speed, and a cap that ignored it
  // cut the throttle the moment a bot used one, cancelling the turbo it had just picked up.
  if (bot.pace < 1 && speed > st.topSpeed * bot.pace * (v.boostT > 0 ? WEAPON.speed.mult : 1)) bits &= ~IN.THROTTLE;
  let airMult = 1;
  if (needed > available * 0.72 * bot.skill) {
    bits |= worst > 0 ? IN.AIRBRAKE_R : IN.AIRBRAKE_L;
    airMult = st.airbrakeTurn;
    if (needed > available * airMult * 0.9) { bits &= ~IN.THROTTLE; bits |= IN.BRAKE; }
  }
  // how much of the line the bot will spend on anything other than the corner
  const spare = (bits & IN.BRAKE) ? 0 : (bits & (IN.AIRBRAKE_L | IN.AIRBRAKE_R)) ? BOT.padCorner : 1;

  // --- weapon pads: with an empty slot, pick the next row the bot can still take from
  const holding = r.item !== 'none' || r.burstT > 0;
  const want = holding || spare <= 0 ? null : padAhead(race, r, v.t);

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

  let limit = half * 0.75;
  if (want) {
    // Ramp onto the pad lane over the whole approach and hold it over the last stretch. It has to
    // start this far out: shifting six metres across takes well over a second at racing speed, and
    // the pickup window is only PAD.radiusT wide. Applied after the bend term, which would
    // otherwise suppress it — the lane term above is zeroed by any curvature tighter than ~400 m.
    const commit = Math.max(0, Math.min(1, (BOT.padLook - want.ds) / Math.max(1, BOT.padLook - BOT.padClose)));
    tTarget += (want.pad.t - tTarget) * commit * spare;
    // the outermost pad lanes sit outside the lane the bot would otherwise keep to
    limit = Math.max(limit, Math.min(Math.abs(want.pad.t) + 0.6, half));
  }

  // --- gunnery: line the nose up before spending a rocket or a burst
  const gun = (r.item === 'rocket' || r.item === 'minigun') && r.burstT <= 0 ? gunTarget(race, r) : null;
  if (gun && spare > 0) tTarget += Math.max(-BOT.aimBias, Math.min(BOT.aimBias, gun.lead - tTarget)) * spare * bot.skill;
  tTarget = Math.max(-limit, Math.min(limit, tTarget));

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
      case 'shield': fire = r.hp < r.maxHp * 0.5 || threatened(race, r); break;
      case 'speed': fire = Math.abs(worst) < 0.004; break;
      case 'mines': fire = race.racers.some(o => o.id !== r.id && !o.dead && !o.finished && (() => { const d = deltaS(ribbon, o.v.s, v.s); return d > 5 && d < 70; })()); break;
      // an unguided bolt is only worth it if the nose is already on the lead point
      case 'rocket': fire = !!gun && gun.ds <= BOT.rocketRange && Math.abs(aimT(v, gun.ds) - gun.lead) < WEAPON.rocket.hitDt + BOT.rocketMargin; break;
      // the same cone stepMinigun scores hits with, so a burst is never spent on empty road
      case 'minigun': fire = !!gun && gun.ds <= WEAPON.minigun.range &&
        Math.abs(gun.o.v.t - aimT(v, gun.ds)) <= WEAPON.minigun.spread + gun.ds * WEAPON.minigun.cone; break;
      default: fire = acquireTarget(race, r) >= 0;
    }
    if (fire && tick % 4 === 0) bits |= IN.FIRE;   // pulse so the edge triggers each shot
  }
  return { bits, steer };
}
