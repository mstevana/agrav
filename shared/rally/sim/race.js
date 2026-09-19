// ============================================================================
// One Scrap Rally match: the cars, the track under them, the rules that turn a
// lap of driving into a result.
//
// Two ways to win. Cross the line first after the laps are done, or be the last
// car still running: the moment the field is down to one, that car has won and
// the race is over. After the first car is home the rest have FINISH_GRACE_SEC
// to finish for placing, and during that grace nobody who is already home can
// hurt anyone or be hurt, so a winner cannot sit on the line and shoot second
// place out of its prize money.
//
// Pure JS: the server steps it for authority, the client steps its own car for
// prediction.
// ============================================================================

import { deltaS } from '../../sim/spline.js';
import { makeRng } from '../../sim/rng.js';
import { RingBuffer } from '../../sim/ring-buffer.js';
import { carStats } from '../cars.js';
import { buildTrack, frameYaw } from './track.js';
import { makeCarState, stepCar, environmentDamage, speedOf } from './car.js';
import { TRACK_IDS, isTrackId } from '../tracks/index.js';
import { stepWeapons, armCar, resetEntityIds, isWeaponId } from '../weapons.js';
import { stepPickups, resetPads } from '../pickups.js';
import { PHASE, CONTACT, HIT_SLOW, GRID, COUNTDOWN_SEC, GRID_HOLD_SEC, FINISH_GRACE_SEC,
         RESULTS_HOLD_SEC, ELIM_BANNER_SEC, TICK_RATE, BOT_DIFFICULTY, DIFFICULTY_IDS,
         HISTORY_TICKS, PRIZE } from '../constants.js';

export function validateOpts(o = {}) {
  return {
    track: isTrackId(o.track) ? o.track : TRACK_IDS[0],
    laps: Math.max(1, Math.min(9, o.laps | 0 || 3)),
    botDifficulty: DIFFICULTY_IDS.includes(o.botDifficulty) ? o.botDifficulty : 'normal',
    fillBots: o.fillBots === undefined ? true : !!o.fillBots
  };
}

export function createRace(opts, seed = 1) {
  opts = validateOpts(opts);
  const track = buildTrack(opts.track);
  return {
    opts, seed: seed >>> 0, rng: makeRng(seed), track, ribbon: track.ribbon,
    tickRate: TICK_RATE,
    phase: PHASE.LOBBY,
    tick: 0, raceTick: 0, startTick: 0,
    held: false,
    firstFinishTick: 0, finishedTick: 0,
    lastAlive: -1,                                   // the winner, when the race ended by elimination
    cars: [], byId: {},
    wrecks: [],                                      // {id, x, z, yaw, r} — burnt shells that stay in the road
    entities: [],                                    // mines today; the kind byte leaves room for more
    pads: track.pads.map(p => ({ ...p, respawnTick: 0, live: p.item, cashUntil: 0 })),
    nextCashTick: 0,
    cashMin: PRIZE.cashMin, cashMax: PRIZE.cashMax,
    history: new RingBuffer(HISTORY_TICKS)
  };
}

/** the seat's stats come from the player's record when they have one, else a stock starter car */
export function addCar(race, id, profile = {}, bot = false) {
  removeCar(race, id);
  const stats = carStats(profile.car, profile.upgrades, profile.bumper);
  const slot = race.cars.length;
  const g = race.track.grid[Math.min(slot, race.track.grid.length - 1)];
  const c = {
    id, bot, name: profile.name || '', stats,
    c: makeCarState(stats, g),
    hull: clampHull(profile.hull, stats.maxHull), maxHull: stats.maxHull,
    lap: 0, progress: 0, lapStartTick: 0, bestLap: 0, lapTimes: [],
    finished: false, finishTick: 0, dead: false, deathTick: 0, killer: -1, kills: 0,
    disconnected: false, abandoned: false, rank: 0, place: 0,
    cash: 0, ramTick: -999,
    weapon: isWeaponId(profile.weapon) ? profile.weapon : 'machinegun',
    ammo: 0, mines: 0, nitro: 0, refireT: 0, spinT: 0, burstT: 0, lockOn: -1,
    input: { bits: 0, steer: 0 }
  };
  race.cars.push(c);
  race.byId[id] = c;
  placeOnGrid(race);
  return c;
}

export function removeCar(race, id) {
  const i = race.cars.findIndex(c => c.id === id);
  if (i < 0) return;
  race.cars.splice(i, 1);
  delete race.byId[id];
  if (race.phase === PHASE.LOBBY) placeOnGrid(race);
}

/** the durable record behind a seat: the car it owns, how it is built, and the damage it drove home with */
export function setCarProfile(race, id, profile) {
  const c = race.byId[id];
  if (!c || race.phase !== PHASE.LOBBY) return null;
  const stats = carStats(profile.car, profile.upgrades, profile.bumper);
  c.stats = stats;
  c.c.stats = stats;
  c.maxHull = stats.maxHull;
  c.hull = clampHull(profile.hull, stats.maxHull);
  if (typeof profile.name === 'string') c.name = profile.name.slice(0, 16);
  if (isWeaponId(profile.weapon)) c.weapon = profile.weapon;
  placeOnGrid(race);
  return publicProfile(c);
}

export const publicProfile = (c) => ({
  car: c.stats.id, upgrades: c.stats.upgrades, bumper: c.stats.bumper,
  hull: Math.round(c.hull), maxHull: c.maxHull, tier: c.stats.tier,
  weapon: c.weapon || 'machinegun', name: c.name
});

const clampHull = (hull, max) => {
  const h = Number(hull);
  if (!Number.isFinite(h) || h > max) return max;
  return Math.max(0, h);
};

/** two columns behind the line, in join order */
function placeOnGrid(race) {
  const sorted = [...race.cars].sort((a, b) => a.id - b.id);
  sorted.forEach((c, i) => {
    const g = race.track.grid[Math.min(i, race.track.grid.length - 1)];
    Object.assign(c.c, { x: g.x, z: g.z, yaw: g.yaw, vx: 0, vz: 0, fwd: 0, lat: 0, s: g.s, t: g.t, sliding: false, nitroT: 0 });
    c.progress = -(race.ribbon.length - g.s);       // the line is ahead of the grid, so progress starts negative
  });
}

/** the grid waits for every client to build its scene; the countdown is pushed out to the ceiling until it does */
export function holdRace(race, tick) {
  race.held = true;
  race.startTick = tick + (GRID_HOLD_SEC + COUNTDOWN_SEC) * race.tickRate;
}
export function armRace(race, tick) {
  if (!race.held) return;
  race.held = false;
  race.startTick = tick + COUNTDOWN_SEC * race.tickRate;
}

export function startRace(race, tick) {
  race.phase = PHASE.COUNTDOWN;
  race.tick = tick;
  race.startTick = tick + COUNTDOWN_SEC * race.tickRate;
  race.firstFinishTick = 0;
  race.finishedTick = 0;
  race.lastAlive = -1;
  race.wrecks = [];
  race.entities = [];
  resetEntityIds();
  resetPads(race);
  placeOnGrid(race);
  for (const c of race.cars) {
    c.lap = 0; c.lapTimes = []; c.bestLap = 0; c.finished = false; c.dead = false;
    c.kills = 0; c.killer = -1; c.cash = 0; c.ramTick = -999;
    c.lapStartTick = race.startTick;
    armCar(c);
  }
}

export function applyCarInput(race, id, input) {
  const c = race.byId[id];
  if (!c) return;
  c.input = { bits: input.bits | 0, steer: Math.max(-1, Math.min(1, +input.steer || 0)) };
}

/** hull loss, wrecks and kills in one place; weapons and the scenery both come through here */
export function makeDamage(race, tick) {
  return function applyDamage(victim, amount, by, source, events) {
    if (victim.dead || victim.finished || amount <= 0) return;
    if (race.phase !== PHASE.RACING) return;
    victim.hull -= amount;
    const slow = HIT_SLOW[source] ?? 1;
    if (slow < 1) { victim.c.vx *= slow; victim.c.vz *= slow; }
    events.push({ t: 'hit', id: victim.id, by, source, dmg: Math.round(amount), hull: Math.max(0, Math.round(victim.hull)) });
    if (victim.hull > 0) return;
    victim.hull = 0;
    victim.dead = true;
    victim.deathTick = tick;
    victim.killer = by;
    victim.c.vx = 0; victim.c.vz = 0; victim.c.fwd = 0; victim.c.lat = 0;
    // the shell stays where it died and blocks the road for the rest of the race
    race.wrecks.push({ id: victim.id, x: victim.c.x, z: victim.c.z, yaw: victim.c.yaw,
                       r: victim.c.radius * CONTACT.wreckRadiusFactor, tick });
    const killer = by >= 0 ? race.byId[by] : null;
    if (killer && killer.id !== victim.id) killer.kills++;
    events.push({ t: 'dead', id: victim.id, by, source });
  };
}

export function stepRace(race, tick, events) {
  race.tick = tick;
  if (race.phase === PHASE.LOBBY) return;
  const dt = 1 / race.tickRate;
  const L = race.ribbon.length;

  if (race.held && tick >= race.startTick - COUNTDOWN_SEC * race.tickRate) race.held = false;
  if (race.phase === PHASE.COUNTDOWN && tick >= race.startTick) {
    race.phase = PHASE.RACING;
    events.push({ t: 'go' });
  }
  race.raceTick = tick - race.startTick;
  const frozen = race.phase === PHASE.COUNTDOWN;
  const applyDamage = makeDamage(race, tick);

  for (const c of race.cars) {
    if (c.dead) { c.c.bits = 0; continue; }
    const input = c.disconnected ? { bits: 0, steer: 0 } : c.input;
    const before = c.c.s;
    stepCar(race.track, c.c, input, dt, frozen);
    hitWrecks(race, c);
    if (frozen) continue;

    const ds = deltaS(race.ribbon, before, c.c.s);
    // a car that has been spun round or shunted across the road can jump the nearest
    // point by a long way in one tick; only believe a step a car could actually drive
    if (Math.abs(ds) < speedOf(c.c) * dt + 4) c.progress += ds;

    if (c.finished) continue;                       // home already: a cool-down lap, nothing counts

    const dmg = environmentDamage(c.c, dt);
    if (c.c.wallHit || c.c.obstacleHit) events.push({ t: 'wall', id: c.id, force: Math.round(Math.max(c.c.wallHit, c.c.obstacleHit)) });
    if (dmg > 0) applyDamage(c, dmg, -1, 'wall', events);
    if (c.dead) continue;

    const lapsDone = Math.floor(c.progress / L);
    if (lapsDone > c.lap) {
      const lapTime = (tick - c.lapStartTick) / race.tickRate;
      c.lap = lapsDone; c.lapTimes.push(lapTime); c.lapStartTick = tick;
      if (!c.bestLap || lapTime < c.bestLap) c.bestLap = lapTime;
      if (c.lap >= race.opts.laps) {
        c.finished = true; c.finishTick = tick;
        if (!race.firstFinishTick) race.firstFinishTick = tick;
        events.push({ t: 'finish', id: c.id, time: (tick - race.startTick) / race.tickRate });
      } else events.push({ t: 'lap', id: c.id, lap: c.lap, time: lapTime });
    } else if (lapsDone < c.lap) c.lap = Math.max(0, lapsDone);
  }

  // the pose history is written before anything shoots, so a shot rewound by N
  // ticks reads a history that already contains this tick
  const poses = {};
  for (const c of race.cars) poses[c.id] = { x: c.c.x, z: c.c.z, yaw: c.c.yaw, r: c.c.radius, dead: c.dead };
  race.history.set(tick, poses);

  if (!frozen) {
    resolveContacts(race, events, applyDamage);
    stepWeapons(race, dt, tick, events, applyDamage);
    stepPickups(race, dt, tick, events);
  }

  rankCars(race);
  checkEnd(race, tick, events);
}

/** who is still in it: alive, not finished, not gone */
export const running = (race) => race.cars.filter(c => !c.dead && !c.finished && !c.abandoned);

function checkEnd(race, tick, events) {
  if (race.phase !== PHASE.RACING) return;
  const alive = race.cars.filter(c => !c.dead && !c.abandoned);
  const still = running(race);

  // last car standing: over at once, whatever lap it is on
  if (!race.firstFinishTick && alive.length === 1 && race.cars.length > 1) {
    race.lastAlive = alive[0].id;
    events.push({ t: 'laststanding', id: alive[0].id });
    return end(race, tick, events);
  }
  if (alive.length === 0) return end(race, tick, events);
  if (still.length === 0) return end(race, tick, events);
  if (race.firstFinishTick && tick - race.firstFinishTick >= FINISH_GRACE_SEC * race.tickRate) return end(race, tick, events);
}

function end(race, tick, events) {
  race.phase = PHASE.FINISHED;
  race.finishedTick = tick;
  for (const c of race.cars) c.place = c.rank + 1;
  events.push({ t: 'end', winner: race.cars.find(c => c.rank === 0)?.id ?? -1, byElimination: race.lastAlive >= 0 });
}

/** finishers by the order they crossed, then the running by distance, then the dead by how far they got */
export function rankCars(race) {
  const key = (c) => {
    if (c.finished) return [0, c.finishTick, 0];
    if (c.dead || c.abandoned) return [2, 0, -c.progress];
    return [1, 0, -c.progress];
  };
  // the last car standing has won: it outranks even a finisher, and there cannot be one
  const sorted = [...race.cars].sort((a, b) => {
    if (a.id === race.lastAlive) return -1;
    if (b.id === race.lastAlive) return 1;
    const ka = key(a), kb = key(b);
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return a.id - b.id;
  });
  sorted.forEach((c, i) => { c.rank = i; });
}

/** the burnt shells: static, so a car simply bounces off them */
function hitWrecks(race, car) {
  const c = car.c;
  for (const w of race.wrecks) {
    if (w.id === car.id) continue;
    const dx = c.x - w.x, dz = c.z - w.z;
    const d = Math.hypot(dx, dz), min = c.radius + w.r;
    if (d >= min || d <= 1e-6) continue;
    const nx = dx / d, nz = dz / d, pen = min - d;
    c.x += nx * pen; c.z += nz * pen;
    const into = -(c.vx * nx + c.vz * nz);
    if (into <= 0) continue;
    c.vx += nx * into * (1 + CONTACT.restitution);
    c.vz += nz * into * (1 + CONTACT.restitution);
    const keep = 1 - CONTACT.wallFriction * Math.min(1, into / 20);
    c.vx *= keep; c.vz *= keep;
    if (into > CONTACT.wallHardSpeed) c.obstacleHit = Math.max(c.obstacleHit, into);
  }
}

/** car against car: mass-weighted, and a spiked bumper turns a shunt into a weapon */
function resolveContacts(race, events, applyDamage) {
  const cars = race.cars;
  for (let i = 0; i < cars.length; i++) {
    const A = cars[i];
    if (A.dead) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const B = cars[j];
      if (B.dead) continue;
      const a = A.c, b = B.c;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz), min = a.radius + b.radius;
      if (d >= min || d <= 1e-6) continue;
      const nx = dx / d, nz = dz / d, pen = min - d;

      const ma = A.stats.mass, mb = B.stats.mass;
      const wa = mb / (ma + mb), wb = ma / (ma + mb);   // the heavier hull gives way less
      a.x -= nx * pen * wa; a.z -= nz * pen * wa;
      b.x += nx * pen * wb; b.z += nz * pen * wb;

      const relx = b.vx - a.vx, relz = b.vz - a.vz;
      const closing = -(relx * nx + relz * nz);
      if (closing > 0) {
        const jn = closing * (1 + CONTACT.restitution);
        a.vx -= nx * jn * wa; a.vz -= nz * jn * wa;
        b.vx += nx * jn * wb; b.vz += nz * jn * wb;
        // and a share of the sideways slip, so a swipe drags both cars off line
        const tx = -nz, tz = nx;
        const slip = relx * tx + relz * tz;
        a.vx += tx * slip * CONTACT.friction * wa; a.vz += tz * slip * CONTACT.friction * wa;
        b.vx -= tx * slip * CONTACT.friction * wb; b.vz -= tz * slip * CONTACT.friction * wb;
        const loss = 1 - CONTACT.loss * Math.min(1, closing / 20);
        a.vx *= loss; a.vz *= loss; b.vx *= loss; b.vz *= loss;
      }
      events.push({ t: 'bump', a: A.id, b: B.id, force: Math.round(Math.max(0, closing)) });

      // a hard ram hurts, once, not on every tick two cars stay pressed together.
      // A car that is already home neither takes damage nor deals it, so the winner
      // cannot sit on the line and shunt second place out of its prize.
      if (A.finished || B.finished) continue;
      if (closing > CONTACT.hardHit && race.tick - Math.max(A.ramTick, B.ramTick) > CONTACT.cooldownTicks) {
        A.ramTick = B.ramTick = race.tick;
        const scale = closing / CONTACT.hardHit;
        // the car doing the ramming is the one moving into the other; spikes make that side cheap
        const aInto = (a.vx * nx + a.vz * nz) > 0, bInto = (b.vx * nx + b.vz * nz) < 0;
        applyDamage(A, ramDamage(scale, B.stats.bumper && bInto, A.stats.bumper && aInto), B.id, 'ram', events);
        applyDamage(B, ramDamage(scale, A.stats.bumper && aInto, B.stats.bumper && bInto), A.id, 'ram', events);
      }
    }
  }
}

const ramDamage = (scale, hitByBumper, ownBumper) =>
  CONTACT.ramDamage * scale * (hitByBumper ? 3 : 1) * (ownBumper ? 0.5 : 1);

export function raceIsOver(race) {
  const hold = (race.lastAlive >= 0 ? ELIM_BANNER_SEC : RESULTS_HOLD_SEC) * race.tickRate;
  return race.phase === PHASE.FINISHED && race.tick - race.finishedTick >= hold;
}

export function raceResults(race) {
  rankCars(race);
  const mult = race.track.prize * (BOT_DIFFICULTY[race.opts.botDifficulty]?.prize ?? 1);
  return {
    track: race.opts.track, laps: race.opts.laps,
    botDifficulty: race.opts.botDifficulty,
    prizeMultiplier: +mult.toFixed(3),
    byElimination: race.lastAlive >= 0,
    order: [...race.cars].sort((a, b) => a.rank - b.rank).map(c => ({
      id: c.id, name: c.name, car: c.stats.id, place: c.rank + 1,
      finished: c.finished, time: c.finished ? (c.finishTick - race.startTick) / race.tickRate : null,
      eliminated: c.dead, by: c.killer, abandoned: c.abandoned, bot: c.bot,
      laps: c.lap, bestLap: c.bestLap || null, kills: c.kills, cash: c.cash,
      hull: Math.round(c.hull), maxHull: c.maxHull
    }))
  };
}

export function publicRaceState(race) {
  return {
    phase: race.phase, track: race.opts.track, laps: race.opts.laps,
    botDifficulty: race.opts.botDifficulty, fillBots: race.opts.fillBots,
    trackName: race.track.name, length: Math.round(race.length || race.ribbon.length),
    cars: race.cars.map(c => ({
      id: c.id, name: c.name, bot: c.bot, car: c.stats.id, tier: c.stats.tier,
      upgrades: c.stats.upgrades, bumper: c.stats.bumper, weapon: c.weapon || 'machinegun'
    }))
  };
}

export { frameYaw, GRID };
