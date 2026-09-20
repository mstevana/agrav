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
import { wouldHitCar, weaponDef } from './weapons.js';
import { BOT, BOT_DIFFICULTY, CAR, MINE, NITRO, PAD } from './constants.js';

export function makeBot(opts = {}) {
  const skill = opts.skill ?? 1;
  return {
    skill,
    noise: opts.noise ?? 0.1,
    lane: opts.lane ?? 0,          // its private line, as a share of the half-width
    gapSlot: opts.gapSlot ?? 0.5,  // and where across a narrow gap it belongs, 0 left to 1 right
    phase: (opts.phase ?? 0) * 100,
    reverseFor: 0, reverseHeld: 0, lastProgress: null, watchTick: 0,
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
    // six cars will not fit across a chicane, but they should at least start
    // from six different places across it rather than all from the middle
    gapSlot: ((id * 2 + 1) % 6) / 5,
    phase: (id * 0.37) % 1,
    // How readily it takes a shot that would land. The numbers came down when
    // the laser sight went: the old gate only fired at whichever car sat
    // nearest the middle of the cone, so a bot declined shots that would have
    // hit somebody else, and asking the ray directly turned that restraint
    // into an extra fifth of a race's damage. Re-tuned against the sweep until
    // the elimination rate, the kills and the hull lost sat back where they
    // were before the sight was removed.
    aggression: 0.24 + d.skill * 0.48
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
  // Something parked in the road is a decision about where to be, and it has to
  // be one decision about all of it: a chicane with a wreck dropped in it is two
  // blockers at once, and picking the open side of whichever is nearest makes the
  // car swap its mind every few metres and wedge between them.
  //
  // What comes back is the gap, not a line. Handing every bot the single best
  // line is what used to put one of them in the barrier: six cars all aiming at
  // the same metre of road arrive there together, and the outermost is the one
  // that runs out of room. Each keeps its own place across the gap instead.
  const gap = openGap(race, car, room);
  if (gap) lane = lane * (1 - gap.urgency) + placeInGap(gap, bot.gapSlot) * gap.urgency;

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

  // Then close the gap to the lane it actually wants to be in. Aiming at a point
  // sixty metres up the road turns a six-metre lane change into a tenth of a
  // radian, which the feed-forward for the bend the car is already in swamps
  // completely — a bot on the outside of a corner would hold that line straight
  // into a container it had seen coming for fifty metres. This is the same
  // cross-track term a Stanley controller uses, and it is the one that makes the
  // difference between wanting a lane and taking it.
  steer += Math.atan2(BOT.crossGain * (lane - c.t), Math.max(BOT.crossFloor, speed)) * BOT.crossScale;
  steer = clamp(steer, -1, 1);

  // --- throttle and brakes
  const { limit: rawLimit, worst } = speedTarget(
    ribbon, c.s, BOT.cornerLook * (0.7 + bot.skill * 0.4), stats, CAR.brakeDecel * 0.8);
  const limit = rawLimit * BOT.brakeMargin * bot.skill;
  let bits = 0;
  if (speed > limit * 1.04) bits |= IN.BRAKE;
  else bits |= IN.THROTTLE;

  // Racecraft: nobody goes three wide into a chicane. Six cars are twenty-odd
  // metres of car and a gap between two rocks is a dozen, so a car that is
  // level with somebody where the road is about to close has to decide whether
  // it is the one going through. If the other car has the line, lift and take
  // the place behind rather than leaning on it until one of you is in the wall.
  // ...and only ever by lifting. A car that is already crawling has nothing left
  // to give up, and a yield that can hold the throttle shut at a standstill is
  // not racecraft, it is a car parked in the middle of the road waiting for
  // somebody who is themselves waiting.
  if (speed > BOT.yieldMinSpeed && gap && gap.urgency > BOT.yieldFrom && yieldTo(race, car, gap, lane)) {
    bits &= ~IN.THROTTLE;
    if (speed > BOT.yieldSpeed) bits |= IN.BRAKE;
  }

  // --- unstick. The only honest test of stuck is distance: a car that has not
  // got meaningfully further round the lap in a second and a half is wedged,
  // however fast its wheels are turning against whatever it is leaning on.
  const wrongWay = Math.abs(wrapAngle(frameYaw(here) - c.yaw)) > 2.0;
  if (race.phase !== 2) bot.lastProgress = null;
  else if (bot.reverseFor <= 0) {
    if (bot.lastProgress === null) { bot.lastProgress = car.progress; bot.watchTick = tick; }
    else if (tick - bot.watchTick >= BOT.watchTicks) {
      // A longer reverse was tried here and measured worse: seven seconds of
      // backing up puts a car into whoever is behind it, and on the dock circuit
      // that cost more races than the pocket it was meant to escape.
      if (car.progress - bot.lastProgress < BOT.watchProgress) { bot.reverseFor = BOT.reverseTicks; bot.reverseHeld = 0; }
      bot.lastProgress = car.progress;
      bot.watchTick = tick;
    }
  }
  if (bot.reverseFor > 0) {
    // Backing out has to last until the car is actually out. A fixed count is
    // enough to break contact with a wreck and no more, so the car rolls forward
    // a metre and jams on the same shell again — which is where the last of the
    // lost races went. While something is still within touching distance the
    // clock is held, up to a limit, so the manoeuvre finishes what it started.
    const jammed = touching(race, car, BOT.reverseClear);
    if (jammed && bot.reverseHeld < BOT.reverseHold) bot.reverseHeld++;
    else bot.reverseFor--;
    // Back out until there is room again. It has to be a committed manoeuvre: a
    // car leaning on a barrier at walking pace has almost no steering to turn
    // with, and only gets any back once it is properly moving, so a brief dab of
    // reverse just puts it back into the same wall.
    const clear = !jammed && Math.abs(c.t) < hereRoom * 0.7 && speed > 3;
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

  if (car.ammo > 0 && wouldHitCar(race, car, tick) && race.rng() < bot.aggression) bits |= IN.FIRE;

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

/**
 * Whether somebody else has more claim to the gap than this car does.
 *
 * Only cars actually level with it count — one behind is not in the way and one
 * clear ahead has already gone. Of those, the car nearer the middle of what is
 * still open has the line, and the one being squeezed toward the edge is the
 * one that has to lift.
 */
function yieldTo(race, car, gap, lane) {
  const c = car.c;
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
  const rx = -Math.cos(c.yaw), rz = Math.sin(c.yaw);
  const middle = (gap.lo + gap.hi) / 2;
  const mine = Math.abs(lane - middle);
  for (const other of race.cars) {
    if (other.id === car.id || other.dead || other.finished) continue;
    const dx = other.c.x - c.x, dz = other.c.z - c.z;
    const along = dx * fx + dz * fz;
    const across = dx * rx + dz * rz;
    if (Math.abs(along) > BOT.yieldAlong || Math.abs(across) > BOT.yieldAcross) continue;
    // a car already past its own nose has the corner; otherwise the inside line wins
    if (along > 1.5) return true;
    if (Math.abs(other.c.t - middle) < mine - 0.4) return true;
  }
  return false;
}

/** is the car still within touching distance of anything parked in the road? */
function touching(race, car, margin) {
  const c = car.c;
  for (const o of race.track.obstacles) {
    if (Math.hypot(c.x - o.x, c.z - o.z) < c.radius + o.r + margin) return true;
  }
  for (const w of race.wrecks) {
    if (w.id === car.id) continue;
    if (Math.hypot(c.x - w.x, c.z - w.z) < c.radius + w.r + margin) return true;
  }
  return false;
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

/**
 * The stretch of road still open past whatever is parked just ahead.
 *
 * Only the cluster around the nearest blocker counts: the far half of a chicane
 * is a separate decision, taken once this one is behind. The gap comes back
 * already narrowed by the car's own width, so anywhere inside it is somewhere
 * the car fits.
 */
function openGap(race, car, room) {
  const c = car.c;
  const blockers = [];
  let nearest = Infinity;
  const consider = (o) => {
    if (!Number.isFinite(o.s)) return;        // a wreck the client only knows in world space
    if (o.id === car.id) return;
    const ds = deltaS(race.ribbon, c.s, o.s);
    if (ds > BOT.obstacleLook || ds < -BOT.behindClear) return;
    // Something level with the car, or just behind its middle, is still very
    // much in the way — a car jammed on a wreck that sits four metres back used
    // to ignore it completely and keep aiming a lane straight through it, which
    // is how a bot lost a minute and a half in one place. It stops mattering
    // quickly once the car is actually past, hence the sharper scale behind.
    const near = ds >= 0 ? ds : -ds * (BOT.obstacleLook / BOT.behindClear);
    blockers.push({ near, t: o.t, r: o.r });
    nearest = Math.min(nearest, near);
  };
  for (const o of race.track.obstacles) consider(o);
  for (const w of race.wrecks) consider(w);
  if (!blockers.length) return null;

  const spans = blockers
    .filter(b => b.near <= nearest + BOT.clusterSpan)
    .map(b => [b.t - b.r - c.radius, b.t + b.r + c.radius])
    .sort((a, b) => a[0] - b[0]);

  // what is left of the road, as intervals a car centre can sit in
  const free = [];
  let edge = -room;
  for (const [a, b] of spans) {
    if (a > edge) free.push([edge, a]);
    edge = Math.max(edge, b);
  }
  if (edge < room) free.push([edge, room]);
  if (!free.length) return null;

  // The widest gap is not always the right one. A car jammed between two wrecks
  // with clear road beyond them cannot get to it without driving through them,
  // and aiming at it anyway is how a bot sits against the same shell for a
  // minute. So a gap is worth what it is wide, less what it costs to reach —
  // and crossing something to get there costs a great deal.
  let best = null, bestScore = -Infinity;
  for (const [lo, hi] of free) {
    const width = hi - lo;
    if (width <= 0) continue;
    const aim = clamp(c.t, lo, hi);
    const reach = Math.abs(aim - c.t);
    let crossed = 0;
    const from = Math.min(c.t, aim), to = Math.max(c.t, aim);
    for (const [a, b] of spans) crossed += Math.max(0, Math.min(b, to) - Math.max(a, from));
    const score = width - reach * BOT.gapReach - crossed * BOT.gapCross;
    if (score > bestScore) { bestScore = score; best = [lo, hi]; }
  }
  if (!best) return null;
  return { lo: best[0], hi: best[1], width: best[1] - best[0], urgency: clamp(1 - nearest / BOT.obstacleLook, 0, 1) };
}

/**
 * Where in that gap this particular car belongs: the same place across it that
 * it wanted across the road, so a field spreads through a gap in the order it
 * arrived rather than converging on the middle of it.
 */
function placeInGap(gap, slot) {
  const middle = (gap.lo + gap.hi) / 2;
  if (gap.width <= 0) return middle;
  const margin = Math.min(BOT.gapMargin, gap.width * 0.2);
  const lo = gap.lo + margin, hi = gap.hi - margin;
  if (hi <= lo) return middle;
  return lo + clamp(slot, 0, 1) * (hi - lo);
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
