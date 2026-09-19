// ============================================================================
// The bot driver. It aims at a point up the road, feeds forward the steering the
// bend itself demands so it turns with the road rather than after it, brakes for
// what it cannot carry, holds a lane of its own so six of them do not arrive at
// turn one as one object, and steers around anything parked in the way.
//
// Used by the server to fill grids, by tools/rallysim.js to compare cars, and by
// tools/netsim.js as a synthetic client. Combat judgement arrives with the guns.
// ============================================================================

import { frameAt, deltaS, wrapS } from '../sim/spline.js';
import { wrapAngle } from '../sim/vec.js';
import { IN } from '../net/protocol.js';
import { frameYaw } from './sim/track.js';
import { steerAuthority } from './sim/car.js';
import { inKillCone, weaponDef } from './weapons.js';
import { BOT, BOT_DIFFICULTY, CAR, MINE, NITRO, PAD } from './constants.js';

export function makeBot(opts = {}) {
  const skill = opts.skill ?? 1;
  return {
    skill,
    noise: opts.noise ?? 0.1,
    lane: opts.lane ?? 0,          // its private line, as a share of the half-width
    phase: (opts.phase ?? 0) * 100,
    reverseFor: 0, lastProgress: null, watchTick: 0,
    aggression: opts.aggression ?? 0.8, wantPad: -1, lastMineTick: -999
  };
}

export function botFor(difficulty, id, seedMix = 0) {
  const d = BOT_DIFFICULTY[difficulty] || BOT_DIFFICULTY.normal;
  const jitter = ((id * 37 + seedMix) % 7) / 7;      // each bot is a little different, deterministically
  return makeBot({
    skill: d.skill * (0.94 + jitter * 0.12),
    noise: 0.14 - d.skill * 0.06,
    lane: ((id % 5) - 2) * BOT.laneSpread * 0.5,
    phase: (id * 0.37) % 1,
    aggression: 0.25 + d.skill * 0.40
  });
}

const hereFrame = (ribbon, c) => frameAt(ribbon, c.s);

/**
 * The slowest the car must already be, given everything between here and `dist`
 * ahead. For each bend it asks what that bend can be taken at and how much road
 * there is to lose the difference in, so a fast car brakes late and a slow one
 * simply never has to — which is what makes a bought top end worth having.
 */
function speedTarget(ribbon, s, dist, stats, brakeRate) {
  let limit = Infinity, worst = 0;
  for (let d = 4; d <= dist; d += ribbon.step * 2) {
    const k = frameAt(ribbon, s + d).curvature;
    if (Math.abs(k) > Math.abs(worst)) worst = k;
    const vc = cornerSpeed(stats, k);
    if (vc === Infinity) continue;
    // v^2 = vc^2 + 2*a*d : the fastest we can be here and still be at vc by then
    limit = Math.min(limit, Math.sqrt(vc * vc + 2 * brakeRate * d));
  }
  return { limit, worst };
}

/**
 * The fastest a car can hold a bend of this curvature. Two things cap it and the
 * lower one wins: the tyres, which let go past about grip x slideThreshold of
 * lateral acceleration, and the steering itself, which has less and less
 * authority the faster the car is going and eventually cannot ask for the bend
 * at all. Two passes of the fixed point are enough for the second.
 */
function cornerSpeed(stats, curvature) {
  const k = Math.abs(curvature);
  if (k < 1e-4) return Infinity;
  const lateral = stats.grip * CAR.slideThreshold * BOT.gripUse;
  let v = Math.sqrt(lateral / k);
  for (let i = 0; i < 2; i++) v = Math.min(v, stats.yawRate * steerAuthority(v, stats) / k);
  return v;
}

/**
 * One tick of driving for one bot.
 * @returns {{bits:number, steer:number}} the same input record a human sends
 */
export function botInput(race, car, bot, tick) {
  const ribbon = race.ribbon;
  const c = car.c;
  const speed = Math.abs(c.fwd);
  const stats = car.stats;

  // --- where to aim: a point up the road, on this bot's own line
  const look = (BOT.lookaheadBase + BOT.lookaheadPerSpeed * speed) * (0.85 + bot.skill * 0.2);
  const aheadS = wrapS(ribbon, c.s + look);
  const f = frameAt(ribbon, aheadS);
  const room = Math.max(1.5, f.width / 2 - c.radius - 1.2);
  const wobble = Math.sin((tick * 0.013) + bot.phase) * bot.noise;
  // the inside of a bend is the side it turns toward, and curvature is signed that way
  const inside = clamp(f.curvature * 40, -0.8, 0.8) * BOT.lineInside;
  // the private lane and the racing line can both want the same edge; together they
  // never get closer to a barrier than BOT.laneLimit of the room going spare
  let lane = clamp(bot.lane + wobble + inside, -BOT.laneLimit, BOT.laneLimit) * room;
  // and whatever line it wanted, get off the barrier it is already touching
  const hereRoom = Math.max(1.5, hereFrame(ribbon, c).width / 2 - c.radius - 0.8);
  if (Math.abs(c.t) > hereRoom * BOT.wallNear) {
    const over = (Math.abs(c.t) - hereRoom * BOT.wallNear) / ((1 - BOT.wallNear) * hereRoom);
    lane -= Math.sign(c.t) * clamp(over, 0, 1.5) * room * BOT.wallPush;
    lane = clamp(lane, -room, room);
  }
  let tx = f.pos.x + f.right.x * lane, tz = f.pos.z + f.right.z * lane;

  // --- a pad worth going out of its way for
  const pad = wantedPad(race, car, bot);
  if (pad) {
    const pull = clamp(1 - Math.abs(deltaS(ribbon, c.s, pad.s)) / BOT.padLook, 0, 1);
    tx += (pad.x - tx) * pull * BOT.padPull;
    tz += (pad.z - tz) * pull * BOT.padPull;
  }

  // --- steer away from anything parked in the road
  const avoid = avoidance(race, car, look);
  tx += avoid.x; tz += avoid.z;

  const want = Math.atan2(tx - c.x, tz - c.z);
  // turning right lowers yaw, so the steer that closes the gap is the negated error
  let steer = -wrapAngle(want - c.yaw) * BOT.steerGain;

  // and feed forward exactly the lock the bend demands: the road asks for a yaw
  // rate of curvature x speed, and the car gives yawRate x authority per unit of stick
  const here = frameAt(ribbon, c.s);
  const give = Math.max(0.15, stats.yawRate * steerAuthority(speed, stats, c.sliding));
  steer += (here.curvature * speed) / give;
  steer = clamp(steer, -1, 1);

  // --- throttle and brakes
  const { limit: rawLimit, worst } = speedTarget(
    ribbon, c.s, BOT.cornerLook * (0.7 + bot.skill * 0.4), stats, CAR.brakeDecel * 0.8);
  const limit = rawLimit * BOT.brakeMargin * bot.skill;
  let bits = 0;
  if (speed > limit * 1.04) bits |= IN.BRAKE;
  else bits |= IN.THROTTLE;

  // --- unstick. The only honest test of stuck is distance: a car that has not
  // got meaningfully further round the lap in a second and a half is wedged,
  // however fast its wheels are turning against whatever it is leaning on.
  const wrongWay = Math.abs(wrapAngle(frameYaw(here) - c.yaw)) > 2.0;
  if (race.phase !== 2) bot.lastProgress = null;
  else if (bot.reverseFor <= 0) {
    if (bot.lastProgress === null) { bot.lastProgress = car.progress; bot.watchTick = tick; }
    else if (tick - bot.watchTick >= BOT.watchTicks) {
      if (car.progress - bot.lastProgress < BOT.watchProgress) bot.reverseFor = BOT.reverseTicks;
      bot.lastProgress = car.progress;
      bot.watchTick = tick;
    }
  }
  if (bot.reverseFor > 0) {
    bot.reverseFor--;
    // Back out until there is room again. It has to be a committed manoeuvre: a
    // car leaning on a barrier at walking pace has almost no steering to turn
    // with, and only gets any back once it is properly moving, so a brief dab of
    // reverse just puts it back into the same wall.
    const clear = Math.abs(c.t) < hereRoom * 0.7 && speed > 3;
    if (clear || bot.reverseFor === 0) {
      bot.reverseFor = 0;
      bot.lastProgress = car.progress;
      bot.watchTick = tick;
    }
    if (bot.reverseFor > 0) {
      // facing back up the road is not a wedge, it is a mistake: drive out of it
      if (wrongWay) return { bits: IN.THROTTLE, steer: clamp(steer, -1, 1) };
      return { bits: IN.BRAKE, steer: -clamp(steer, -1, 1) };
    }
  }

  // --- the trigger, the mines and the bottle
  bits |= combat(race, car, bot, tick, worst, speed);

  return { bits, steer };
}

/**
 * The pad this bot is going for, if any. It only ever wants something it is
 * actually short of, and only from the pads close enough ahead to be worth the
 * line it would cost.
 */
function wantedPad(race, car, bot) {
  const w = weaponDef(car.weapon);
  const needs = (item) => {
    switch (item) {
      case 'ammo': return car.ammo < w.ammo * 0.4;
      case 'repair': return car.hull < car.maxHull * 0.7;
      case 'nitro': return car.nitro < NITRO.maxCharges;
      case 'cash': return true;
      case 'mines': return car.mines < MINE.perRace;
      default: return false;
    }
  };
  let best = null, nearest = Infinity;
  for (const pad of race.pads) {
    if (pad.respawnTick > race.tick) continue;
    if (!needs(pad.live || pad.item)) continue;
    const ds = deltaS(race.ribbon, car.c.s, pad.s);
    if (ds < BOT.padNear || ds > BOT.padLook || ds >= nearest) continue;
    nearest = ds; best = pad;
  }
  bot.wantPad = best ? best.i : -1;
  return best;
}

/**
 * Shooting, mining and the nitro bottle. It fires only when the shot would
 * actually score — the same ray the server will trace, not a hopeful guess down
 * the road — drops a mine when somebody is close behind and there is a bend to
 * lose them round, and spends nitro on a straight or to get away from a chaser.
 */
function combat(race, car, bot, tick, worstAhead, speed) {
  let bits = 0;
  const w = weaponDef(car.weapon);

  if (car.ammo > 0 && car.lockOn >= 0 && race.rng() < bot.aggression) {
    const target = race.byId[car.lockOn];
    if (target && inKillCone(race, car, target, tick)) bits |= IN.FIRE;
  }

  // a mine is for whoever is sitting on your bumper
  if (car.mines > 0 && tick - bot.lastMineTick > BOT.mineCooldown) {
    const chaser = closestBehind(race, car);
    if (chaser && chaser.dist < BOT.mineBehind) { bits |= IN.MINE; bot.lastMineTick = tick; }
  }

  if (car.nitro > 0 && car.c.nitroT <= 0 && Math.abs(worstAhead) < BOT.nitroStraight
      && speed > car.stats.topSpeed * 0.62) bits |= IN.NITRO;
  void w;
  return bits;
}

/** the nearest car sitting behind this one, close enough to be a nuisance */
function closestBehind(race, car) {
  const fx = Math.sin(car.c.yaw), fz = Math.cos(car.c.yaw);
  let best = null;
  for (const other of race.cars) {
    if (other.id === car.id || other.dead || other.finished) continue;
    const dx = other.c.x - car.c.x, dz = other.c.z - car.c.z;
    const behind = -(dx * fx + dz * fz);
    if (behind <= 0) continue;
    const dist = Math.hypot(dx, dz);
    const off = Math.abs(dx * -Math.cos(car.c.yaw) + dz * Math.sin(car.c.yaw));
    if (off > 6) continue;
    if (!best || dist < best.dist) best = { car: other, dist };
  }
  return best;
}

/** a push away from the nearest wreck, obstacle or car in the way */
function avoidance(race, car, look) {
  const c = car.c;
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
  let ax = 0, az = 0;
  const consider = (ox, oz, r) => {
    const dx = ox - c.x, dz = oz - c.z;
    const ahead = dx * fx + dz * fz;
    if (ahead < 0 || ahead > Math.min(look, BOT.avoidLook)) return;
    const side = dx * -Math.cos(c.yaw) + dz * Math.sin(c.yaw);   // + is to the car's right
    const clearance = r + c.radius + 1.4;
    if (Math.abs(side) > clearance) return;
    const push = (clearance - Math.abs(side)) * BOT.avoidGain * (1 - ahead / BOT.avoidLook);
    const dir = side >= 0 ? -1 : 1;                              // shove the aim point the other way
    ax += -Math.cos(c.yaw) * push * dir;
    az += Math.sin(c.yaw) * push * dir;
  };
  for (const o of race.track.obstacles) consider(o.x, o.z, o.r);
  for (const w of race.wrecks) if (w.id !== car.id) consider(w.x, w.z, w.r);
  for (const other of race.cars) {
    if (other.id === car.id || other.dead) continue;
    consider(other.c.x, other.c.z, other.c.radius);
  }
  // five cars all asking at once would throw the aim point off the road entirely
  const mag = Math.hypot(ax, az);
  if (mag > BOT.avoidMax) { ax *= BOT.avoidMax / mag; az *= BOT.avoidMax / mag; }
  return { x: ax, z: az };
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export { deltaS };
