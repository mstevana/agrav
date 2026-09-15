// ============================================================================
// One AGRAV match: racers, the track ribbon, pads, projectiles and the rules
// (countdown, laps, elimination, finishing, results). Pure JS; the server
// steps it for authority and the client steps its own racer for prediction.
// ============================================================================

import { buildRibbon, deltaS, wrapS, frameAt } from '../../sim/spline.js';
import { makeRng } from '../../sim/rng.js';
import { RingBuffer } from '../../sim/ring-buffer.js';
import { IN } from '../../net/protocol.js';
import { vehicleStats } from '../vehicles.js';
import { getTrack, TRACK_IDS } from '../tracks/index.js';
import { makeVehicleState, stepVehicle, environmentDamage } from './vehicle.js';
import { rollItem, useItem, stepProjectiles, stepMinigun, resetProjectileIds } from './weapons.js';
import { ITEMS, PAD, GRID, PHASE, CONTACT, COUNTDOWN_SEC, FINISH_GRACE_SEC, RESULTS_HOLD_SEC,
         TICK_RATE, HISTORY_TICKS, HITSCAN_REWIND_TICKS } from '../constants.js';

const ribbonCache = new Map();
export function ribbonFor(trackId) {
  if (!ribbonCache.has(trackId)) {
    const t = getTrack(trackId);
    ribbonCache.set(trackId, buildRibbon(t.points, { width: t.width }));
  }
  return ribbonCache.get(trackId);
}

export function validateOpts(o = {}) {
  return {
    track: TRACK_IDS.includes(o.track) ? o.track : TRACK_IDS[0],
    laps: Math.max(1, Math.min(9, o.laps | 0 || 3))
  };
}

export function createRace(opts, seed = 1) {
  opts = validateOpts(opts);
  const track = getTrack(opts.track);
  const ribbon = ribbonFor(opts.track);
  const rng = makeRng(seed);
  resetProjectileIds();
  const pads = [];
  for (const row of track.pads) for (const t of row.lanes) pads.push({ s: wrapS(ribbon, row.s), t, respawnTick: 0 });
  return {
    opts, seed, rng, track, ribbon, pads,
    tickRate: TICK_RATE,
    phase: PHASE.LOBBY,
    tick: 0, raceTick: 0, startTick: 0, firstFinishTick: 0, finishedTick: 0,
    racers: [], byId: {},
    projectiles: [],
    history: new RingBuffer(HISTORY_TICKS)
  };
}

export function addRacer(race, id, profile = {}, bot = false) {
  removeRacer(race, id);
  const stats = vehicleStats(profile.vehicle);
  const r = {
    id, bot, vehicle: stats.id, stats, name: profile.name || '',
    v: makeVehicleState(stats),
    hp: stats.maxHp, maxHp: stats.maxHp,
    item: 'none', ammo: 0, burstT: 0, burstNext: 0, refireT: 0, fireHeld: false,
    lap: 0, progress: 0, lapStartTick: 0, bestLap: 0, lapTimes: [],
    finished: false, finishTick: 0, dead: false, deathTick: 0, killer: -1, kills: 0,
    disconnected: false, abandoned: false, rank: 0, place: 0,
    input: { bits: 0, steer: 0 }
  };
  race.racers.push(r);
  race.byId[id] = r;
  placeOnGrid(race);
  return r;
}

export function removeRacer(race, id) {
  const i = race.racers.findIndex(r => r.id === id);
  if (i < 0) return;
  race.racers.splice(i, 1);
  delete race.byId[id];
  if (race.phase === PHASE.LOBBY) placeOnGrid(race);
}

export function setRacerProfile(race, id, m) {
  const r = race.byId[id];
  if (!r) return null;
  const stats = vehicleStats(m.vehicle);
  r.vehicle = stats.id; r.stats = stats; r.v.stats = stats;
  r.hp = r.maxHp = stats.maxHp;
  if (typeof m.name === 'string') r.name = m.name.slice(0, 16);
  return { vehicle: r.vehicle, name: r.name };
}

/** grid: two columns behind the start line, in join order (ids ascending) */
function placeOnGrid(race) {
  const sorted = [...race.racers].sort((a, b) => a.id - b.id);
  sorted.forEach((r, i) => {
    const row = Math.floor(i / GRID.cols), col = i % GRID.cols;
    const s = wrapS(race.ribbon, -GRID.backFromLine - row * GRID.rowGap);
    Object.assign(r.v, { s, t: (col - (GRID.cols - 1) / 2) * GRID.colGap * 2, h: 0, W: 0, yaw: 0, vs: 0, vt: 0, grounded: true });
    r.progress = -GRID.backFromLine - row * GRID.rowGap;   // distance to the line is negative progress
  });
}

export function startRace(race, tick) {
  race.phase = PHASE.COUNTDOWN;
  race.tick = tick;
  race.startTick = tick + COUNTDOWN_SEC * race.tickRate;
  race.firstFinishTick = 0;
  race.finishedTick = 0;
  race.projectiles = [];
  for (const p of race.pads) p.respawnTick = 0;
  placeOnGrid(race);
  for (const r of race.racers) {
    r.hp = r.maxHp; r.item = 'none'; r.ammo = 0; r.burstT = 0; r.refireT = 0;
    r.lap = 0; r.lapTimes = []; r.bestLap = 0; r.finished = false; r.dead = false; r.kills = 0; r.killer = -1;
    r.v.shieldT = 0; r.v.boostT = 0;
    r.lapStartTick = race.startTick;
  }
}

export function applyRacerInput(race, id, input) {
  const r = race.byId[id];
  if (!r) return;
  r.input = { bits: input.bits | 0, steer: Math.max(-1, Math.min(1, +input.steer || 0)) };
}

/** hp loss with shield and death handling; used by weapons and the environment */
function makeDamage(race, tick) {
  return function applyDamage(victim, amount, by, source, events) {
    if (victim.dead || victim.finished || amount <= 0) return;
    if (victim.v.shieldT > 0) { events.push({ t: 'absorb', id: victim.id, by, source }); return; }
    victim.hp -= amount;
    events.push({ t: 'hit', id: victim.id, by, source, dmg: Math.round(amount), hp: Math.max(0, Math.round(victim.hp)) });
    if (victim.hp <= 0) {
      victim.hp = 0; victim.dead = true; victim.deathTick = tick; victim.killer = by;
      victim.v.vs = 0; victim.v.vt = 0;
      const killer = by >= 0 ? race.byId[by] : null;
      if (killer && killer.id !== victim.id) killer.kills++;
      events.push({ t: 'dead', id: victim.id, by, source });
    }
  };
}

export function stepRace(race, tick, events) {
  race.tick = tick;
  if (race.phase === PHASE.LOBBY) return;
  const dt = 1 / race.tickRate;
  const ribbon = race.ribbon;
  const L = ribbon.length;

  if (race.phase === PHASE.COUNTDOWN && tick >= race.startTick) {
    race.phase = PHASE.RACING;
    events.push({ t: 'go' });
  }
  race.raceTick = tick - race.startTick;
  const frozen = race.phase === PHASE.COUNTDOWN;   // only the grid holds craft still; after the flag everyone coasts
  const applyDamage = makeDamage(race, tick);

  // --- vehicles
  for (const r of race.racers) {
    if (r.dead) { r.v.bits = 0; continue; }
    // a finished racer keeps driving a cool-down lap: no laps, no damage, no items, no contact
    const input = r.disconnected ? { bits: 0, steer: 0 } : r.input;
    const before = r.v.s;
    stepVehicle(ribbon, r.v, input, dt, frozen);
    if (frozen || r.finished) continue;
    const ds = deltaS(ribbon, before, r.v.s);
    r.progress += ds;
    const dmg = environmentDamage(r.v, dt);
    if (r.v.wallHit) events.push({ t: 'wall', id: r.id, force: Math.round(r.v.wallHit) });
    if (dmg > 0) applyDamage(r, dmg, -1, 'wall', events);
    // laps
    const lapsDone = Math.floor(r.progress / L);
    if (lapsDone > r.lap) {
      const lapTime = (tick - r.lapStartTick) / race.tickRate;
      r.lap = lapsDone; r.lapTimes.push(lapTime); r.lapStartTick = tick;
      if (!r.bestLap || lapTime < r.bestLap) r.bestLap = lapTime;
      if (r.lap >= race.opts.laps) {
        r.finished = true; r.finishTick = tick;
        if (!race.firstFinishTick) race.firstFinishTick = tick;
        events.push({ t: 'finish', id: r.id, time: race.raceTick / race.tickRate });
      } else events.push({ t: 'lap', id: r.id, lap: r.lap, time: lapTime });
    } else if (lapsDone < r.lap) r.lap = Math.max(0, lapsDone);   // drove backwards over the line
    // items
    if (r.refireT > 0) r.refireT -= dt;
    const fire = !!(input.bits & IN.FIRE);
    if (fire && !r.fireHeld) useItem(race, r, tick, events);
    else if (fire && r.item === 'rocket' && r.refireT <= 0) useItem(race, r, tick, events);  // hold for the burst
    r.fireHeld = fire;
    stepMinigun(race, r, dt, tick, events, applyDamage, (id) => poseAt(race, id, tick - HITSCAN_REWIND_TICKS));
  }

  if (!frozen) {
    resolveContacts(race, events, applyDamage);
    stepProjectiles(race, dt, tick, events, applyDamage);
    collectPads(race, tick, events);
  }

  // pose history for lag compensation
  const poses = {};
  for (const r of race.racers) poses[r.id] = { s: r.v.s, t: r.v.t, h: r.v.h, yaw: r.v.yaw };
  race.history.set(tick, poses);

  rankRacers(race);

  // --- end of race
  if (race.phase === PHASE.RACING) {
    const alive = race.racers.filter(r => !r.dead && !r.finished && !r.abandoned);
    const timedOut = race.firstFinishTick && tick - race.firstFinishTick >= FINISH_GRACE_SEC * race.tickRate;
    if (alive.length === 0 || timedOut || race.racers.length === 0) {
      race.phase = PHASE.FINISHED;
      race.finishedTick = tick;
      for (const r of race.racers) r.place = r.rank + 1;
      events.push({ t: 'end' });
    }
  }
}

function poseAt(race, id, tick) {
  const poses = race.history.get(Math.max(0, tick));
  return poses ? poses[id] : null;
}

/** progress order: finishers by time, then live racers by distance, then the dead by where they died */
export function rankRacers(race) {
  const key = (r) => {
    if (r.finished) return [0, r.finishTick, 0];
    if (r.dead || r.abandoned) return [2, 0, -r.progress];
    return [1, 0, -r.progress];
  };
  const sorted = [...race.racers].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return a.id - b.id;
  });
  sorted.forEach((r, i) => { r.rank = i; });
}

function resolveContacts(race, events, applyDamage) {
  const rs = race.racers;
  for (let i = 0; i < rs.length; i++) {
    const a = rs[i];
    if (a.dead || a.finished) continue;
    for (let j = i + 1; j < rs.length; j++) {
      const b = rs[j];
      if (b.dead || b.finished) continue;
      const ds = deltaS(race.ribbon, a.v.s, b.v.s);
      const dt = b.v.t - a.v.t;
      const halfL = (a.stats.length + b.stats.length) / 2 * 0.85;
      const halfW = (a.stats.width + b.stats.width) / 2 * 0.95;
      if (Math.abs(ds) >= halfL || Math.abs(dt) >= halfW || Math.abs(a.v.h - b.v.h) > 2.5) continue;
      // separate along the axis with the smaller penetration
      const penS = halfL - Math.abs(ds), penT = halfW - Math.abs(dt);
      const relS = b.v.vs - a.v.vs, relT = b.v.vt - a.v.vt;
      if (penT < penS) {
        const n = dt >= 0 ? 1 : -1;
        a.v.t -= n * penT / 2; b.v.t += n * penT / 2;
        if (relT * n < 0) {
          const j_ = -(1 + CONTACT.restitution) * relT * n / 2;
          a.v.vt -= j_ * n; b.v.vt += j_ * n;
        }
      } else {
        const n = ds >= 0 ? 1 : -1;
        a.v.s = wrapS(race.ribbon, a.v.s - n * penS / 2); b.v.s = wrapS(race.ribbon, b.v.s + n * penS / 2);
        if (relS * n < 0) {
          const j_ = -(1 + CONTACT.restitution) * relS * n / 2;
          a.v.vs -= j_ * n; b.v.vs += j_ * n;
        }
      }
      const rel = Math.hypot(relS, relT);
      events.push({ t: 'bump', a: a.id, b: b.id, force: Math.round(rel) });
      // a hard ram hurts once, not on every tick two craft stay pressed together
      if (rel > CONTACT.hardHit && race.tick - Math.max(a.lastRamTick || 0, b.lastRamTick || 0) > CONTACT.cooldownTicks) {
        a.lastRamTick = b.lastRamTick = race.tick;
        applyDamage(a, CONTACT.damage, b.id, 'ram', events);
        applyDamage(b, CONTACT.damage, a.id, 'ram', events);
      }
    }
  }
}

function collectPads(race, tick, events) {
  const n = race.racers.filter(r => !r.dead && !r.finished).length;
  race.pads.forEach((pad, idx) => {
    if (pad.respawnTick > tick) return;
    for (const r of race.racers) {
      if (r.dead || r.finished || r.item !== 'none' || r.burstT > 0) continue;
      if (Math.abs(deltaS(race.ribbon, pad.s, r.v.s)) > PAD.radiusS) continue;
      if (Math.abs(r.v.t - pad.t) > PAD.radiusT || r.v.h > 2) continue;
      r.item = rollItem(race.rng, r.rank, n);
      r.ammo = ITEMS[r.item].ammo;
      pad.respawnTick = tick + PAD.respawnSec * race.tickRate;
      events.push({ t: 'pickup', id: r.id, item: r.item, pad: idx });
      break;
    }
  });
}

export function raceIsOver(race) {
  return race.phase === PHASE.FINISHED && race.tick - race.finishedTick >= RESULTS_HOLD_SEC * race.tickRate;
}

export function raceResults(race) {
  rankRacers(race);
  return {
    track: race.opts.track, laps: race.opts.laps,
    order: [...race.racers].sort((a, b) => a.rank - b.rank).map(r => ({
      id: r.id, name: r.name, vehicle: r.vehicle, place: r.rank + 1,
      finished: r.finished, time: r.finished ? (r.finishTick - race.startTick) / race.tickRate : null,
      eliminated: r.dead, by: r.killer, abandoned: r.abandoned,
      laps: r.lap, bestLap: r.bestLap || null, kills: r.kills
    }))
  };
}

export function publicRaceState(race) {
  return {
    phase: race.phase, track: race.opts.track, laps: race.opts.laps,
    racers: race.racers.map(r => ({ id: r.id, vehicle: r.vehicle, name: r.name, bot: r.bot }))
  };
}
