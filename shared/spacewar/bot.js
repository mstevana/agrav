// Bot pilots for Spacewar. A bot reads the authoritative state and returns the same
// {bits, steer} a human would send, so the simulation never knows the difference.
// Its memory is a plain object kept in the match state (no closures), so the state
// stays serialisable.
//
// Priorities, in order: don't fall into the planet, don't stop a torpedo, then hunt
// the nearest ship with a leading shot, spending fuel and ammunition with some care.

import {
  DT, SHIP_R, TURN_RATE, FUEL_MAX, TORP_SPEED, TORP_LIFE, TORP_ARM, PLANET_R, CX, CY, BIT, MAX_SPEED,
} from './constants.js';
import { stepShip, torusDelta, wrapAngle, NO_INPUT } from './sim.js';

export const DIFFICULTIES = {
  // aim: radians of aiming error, re-rolled now and then · cone: fire when this well lined up
  // gap: ticks between shots · hyper: chance to jump away from a torpedo it has seen coming
  // look: ticks ahead it watches torpedoes · cruise: speed it is happy to fly at
  easy: { aim: 0.3, cone: 0.18, gap: 80, hyper: 0.1, look: 20, cruise: 70, planetLook: 70 },
  normal: { aim: 0.12, cone: 0.1, gap: 45, hyper: 0.3, look: 45, cruise: 95, planetLook: 110 },
  hard: { aim: 0.025, cone: 0.06, gap: 24, hyper: 0.65, look: 70, cruise: 120, planetLook: 150 },
};

export function createBotMemory(id, seed, difficulty = 'normal') {
  return {
    id, difficulty: DIFFICULTIES[difficulty] ? difficulty : 'normal',
    rng: ((seed >>> 0) ^ Math.imul(id + 1, 0x9e3779b1)) >>> 0 || 1,
    aimOffset: 0, rerollAt: 0, lastFire: -1000, seen: {},
  };
}

function rnd(mem) {
  mem.rng = (mem.rng + 0x6d2b79f5) >>> 0;
  let t = mem.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** steer that turns toward `want` without overshooting in one tick */
function steerTo(ship, want) {
  const err = wrapAngle(want - ship.a);
  return Math.max(-1, Math.min(1, err / (TURN_RATE * DT)));
}

/** ticks until the ship, coasting, hits the planet (or -1) */
function planetImpact(ship, ticks) {
  const g = { ...ship, hyper: 0, cool: 0, hyperCd: 0 };
  for (let t = 1; t <= ticks; t++) {
    stepShip(g, NO_INPUT, true);
    const d = torusDelta(g.x, g.y, CX, CY);
    if (Math.hypot(d.dx, d.dy) < PLANET_R + SHIP_R + 12) return t;
  }
  return -1;
}

/** a torpedo on a collision course: {t, torp} with the soonest closest approach, or null */
function incoming(state, ship, look) {
  let best = null;
  for (const t of state.torps) {
    if (t.owner === ship.id && t.age < TORP_ARM + 10) continue;
    const d = torusDelta(ship.x, ship.y, t.x, t.y);
    const rvx = t.vx - ship.vx, rvy = t.vy - ship.vy;
    const v2 = rvx * rvx + rvy * rvy;
    if (v2 < 1) continue;
    const tc = -(d.dx * rvx + d.dy * rvy) / v2;          // seconds to closest approach
    if (tc < 0 || tc * 60 > look || tc * 60 > TORP_LIFE - t.age) continue;
    const mx = d.dx + rvx * tc, my = d.dy + rvy * tc;
    if (Math.hypot(mx, my) > SHIP_R + 10) continue;
    if (!best || tc < best.t) best = { t: tc, torp: t };
  }
  return best;
}

/** where to point to hit `target` with a torpedo fired now: {angle, time} or null */
function leadAim(ship, target) {
  const d = torusDelta(ship.x, ship.y, target.x, target.y);
  // the torpedo inherits our velocity, so solve in our frame
  const rvx = target.vx - ship.vx, rvy = target.vy - ship.vy;
  const a = rvx * rvx + rvy * rvy - TORP_SPEED * TORP_SPEED;
  const b = 2 * (d.dx * rvx + d.dy * rvy);
  const c = d.dx * d.dx + d.dy * d.dy;
  let t;
  if (Math.abs(a) < 1e-6) t = -c / b;
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
    t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  }
  if (!(t > 0)) return null;
  return { angle: Math.atan2(d.dy + rvy * t, d.dx + rvx * t), time: t, dist: Math.sqrt(c) };
}

export function think(state, id, mem) {
  const ship = state.ships[id];
  if (!ship || !ship.alive || ship.hyper > 0 || state.phase === 'intro') return NO_INPUT;
  const cfg = DIFFICULTIES[mem.difficulty] || DIFFICULTIES.normal;
  const planet = state.opts.planet;
  const hyperReady = ship.hyperCd === 0;

  // 1. the planet
  if (planet) {
    const hit = planetImpact(ship, cfg.planetLook);
    if (hit > 0) {
      if (hit < 20 && hyperReady) return { bits: BIT.HYPER, steer: 0 };
      const d = torusDelta(CX, CY, ship.x, ship.y);           // planet -> ship
      const r = Math.hypot(d.dx, d.dy) || 1;
      const ox = d.dx / r, oy = d.dy / r;
      // swing round it: outward plus whichever tangent we are already moving along
      const side = Math.sign(-oy * ship.vx + ox * ship.vy) || 1;
      const want = Math.atan2(oy * 0.7 + ox * side, ox * 0.7 - oy * side);
      const steer = steerTo(ship, want);
      const lined = Math.abs(wrapAngle(want - ship.a)) < 0.7;
      return { bits: lined && ship.fuel > 0 ? BIT.THRUST : 0, steer };
    }
  }

  // 2. torpedoes
  const threat = incoming(state, ship, cfg.look);
  if (threat) {
    const key = threat.torp.id;
    if (mem.seen[key] === undefined) mem.seen[key] = rnd(mem) < cfg.hyper;
    if (mem.seen[key] && hyperReady && threat.t < 0.5) return { bits: BIT.HYPER, steer: 0 };
    // burn sideways to the torpedo's line
    const t = threat.torp;
    const side = Math.sign((t.vx - ship.vx) * Math.sin(ship.a) - (t.vy - ship.vy) * Math.cos(ship.a)) || 1;
    const want = Math.atan2(t.vy, t.vx) + side * Math.PI / 2;
    const lined = Math.abs(wrapAngle(want - ship.a)) < 0.9;
    return { bits: lined && ship.fuel > 0 ? BIT.THRUST : 0, steer: steerTo(ship, want) };
  }
  if (state.tick % 120 === 0) mem.seen = {};

  // 3. the hunt
  let target = null, best = Infinity;
  for (const o of state.ships) {
    if (!o || o.id === id || !o.alive || o.hyper > 0) continue;
    const d = torusDelta(ship.x, ship.y, o.x, o.y);
    const dist = Math.hypot(d.dx, d.dy);
    if (dist < best) { best = dist; target = o; }
  }
  if (!target) {
    // nothing to shoot: hold a gentle speed away from the planet
    return cruise(ship, cfg, planet, null);
  }
  if (state.tick >= mem.rerollAt) {
    mem.aimOffset = (rnd(mem) * 2 - 1) * cfg.aim;
    mem.rerollAt = state.tick + 30 + Math.floor(rnd(mem) * 40);
  }
  const lead = leadAim(ship, target);
  const d = torusDelta(ship.x, ship.y, target.x, target.y);
  const want = (lead ? lead.angle : Math.atan2(d.dy, d.dx)) + mem.aimOffset;
  const err = Math.abs(wrapAngle(want - ship.a));
  let bits = 0;
  const inRange = lead && lead.time * 60 < TORP_LIFE * 0.85;
  if (inRange && err < cfg.cone && ship.torps > 0 && state.tick - mem.lastFire >= cfg.gap) {
    bits |= BIT.FIRE;
    mem.lastFire = state.tick;
  }
  const speed = Math.hypot(ship.vx, ship.vy);
  // close in when far away and slow, facing roughly the right way; keep a reserve of fuel
  if (best > 380 && speed < cfg.cruise && err < 0.5 && ship.fuel > FUEL_MAX * 0.25) bits |= BIT.THRUST;
  // too close and closing fast: a collision kills both, so a bot that is winning backs off
  if (best < 90 && ship.fuel > 0) {
    const closing = (d.dx * (target.vx - ship.vx) + d.dy * (target.vy - ship.vy)) < 0;
    if (closing && speed < MAX_SPEED * 0.6) {
      const away = Math.atan2(-d.dy, -d.dx);
      return { bits: Math.abs(wrapAngle(away - ship.a)) < 0.8 ? BIT.THRUST : 0, steer: steerTo(ship, away) };
    }
  }
  return { bits, steer: steerTo(ship, want) };
}

function cruise(ship, cfg, planet) {
  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed < cfg.cruise * 0.5 && ship.fuel > FUEL_MAX * 0.3) {
    const want = planet ? Math.atan2(ship.y - CY, ship.x - CX) + Math.PI / 2 : ship.a;
    const lined = Math.abs(wrapAngle(want - ship.a)) < 0.4;
    return { bits: lined ? BIT.THRUST : 0, steer: steerTo(ship, want) };
  }
  return NO_INPUT;
}
