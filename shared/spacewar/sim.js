// Deterministic Spacewar simulation. Pure functions over a plain state object, so the
// server runs it authoritatively and the client re-runs its own ship (stepShip) for
// prediction. The arena is a torus: every position wraps, and every distance is taken
// to the nearest wrapped image.

import {
  FIELD_W, FIELD_H, CX, CY, DT, MAX_SHIPS,
  SHIP_R, TURN_RATE, THRUST, MAX_SPEED, FUEL_MAX, TORPS_MAX, FIRE_COOLDOWN,
  TORP_SPEED, TORP_LIFE, TORP_R, TORP_ARM, MUZZLE,
  HYPER_TICKS, HYPER_COOLDOWN, HYPER_CLEAR_PLANET, HYPER_CLEAR_SHIP,
  PLANET_R, GRAVITY, GRAVITY_MIN_R,
  SPAWN_RING, ROUND_INTRO, ROUND_SETTLE, ROUND_OUTRO, ROUND_MAX, DRY_TIMEOUT,
  DEFAULT_OPTIONS, BIT,
} from './constants.js';

export const NO_INPUT = Object.freeze({ bits: 0, steer: 0 });

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** wrap a coordinate into [0, size) */
export function wrap(v, size) {
  v %= size;
  return v < 0 ? v + size : v;
}
/** the shortest signed difference b - a on a circle of `size` */
export function wrapDelta(d, size) {
  d %= size;
  if (d > size / 2) d -= size;
  else if (d < -size / 2) d += size;
  return d;
}
export function wrapAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}
/** vector from (ax, ay) to the nearest image of (bx, by) */
export function torusDelta(ax, ay, bx, by) {
  return { dx: wrapDelta(bx - ax, FIELD_W), dy: wrapDelta(by - ay, FIELD_H) };
}

/** mulberry32 over a u32 kept in the state, so the state stays plain JSON */
export function rand(state) {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createState(options = {}, seed = 1) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  return {
    tick: 0,
    phase: 'lobby',          // lobby | intro | play | outro | over
    timer: 0,                // ticks left in intro / outro
    round: 0,
    roundTicks: 0,
    dryTicks: 0,
    settle: -1,              // ticks until the round is called, once one ship (or none) is left
    roundWinner: -1,         // last round: the survivor's id, -1 for a draw
    winner: -1,              // the match
    opts: { roundsToWin: o.roundsToWin, planet: !!o.planet },
    rng: (seed >>> 0) || 1,
    ships: new Array(MAX_SHIPS).fill(null),
    torps: [],
    nextTorpId: 1,
  };
}

export function createShip(id) {
  return {
    id, x: CX, y: CY, vx: 0, vy: 0, a: 0,
    alive: false, thrust: false,
    fuel: FUEL_MAX, torps: TORPS_MAX, cool: 0,
    hyper: 0, hyperCd: 0,
    wins: 0, kills: 0, deaths: 0,
  };
}

/** gravity on a point: acceleration toward the planet's nearest image */
export function gravityAt(x, y) {
  const { dx, dy } = torusDelta(x, y, CX, CY);
  const r = Math.max(GRAVITY_MIN_R, Math.hypot(dx, dy));
  const a = GRAVITY / (r * r);
  const d = Math.hypot(dx, dy) || 1;
  return { ax: (dx / d) * a, ay: (dy / d) * a };
}

/**
 * Advance one ship by one tick: turn, thrust, gravity, drift and wrap, and the
 * hyperspace and gun timers. No firing, no collisions: those need the whole
 * match and live in step(). The client runs exactly this for its own ship.
 */
export function stepShip(ship, input = NO_INPUT, planet = true) {
  if (!ship.alive) { ship.thrust = false; return ship; }
  if (ship.cool > 0) ship.cool--;
  if (ship.hyper > 0) {
    // out of the arena: frozen at the re-entry point, keeping its velocity for the exit
    ship.thrust = false;
    if (--ship.hyper === 0) ship.hyperCd = HYPER_COOLDOWN;
    return ship;
  }
  if (ship.hyperCd > 0) ship.hyperCd--;
  const turn = clamp(input.steer || 0, -1, 1);
  ship.a = wrapAngle(ship.a + turn * TURN_RATE * DT);
  ship.thrust = !!(input.bits & BIT.THRUST) && ship.fuel > 0;
  if (ship.thrust) {
    ship.vx += Math.cos(ship.a) * THRUST * DT;
    ship.vy += Math.sin(ship.a) * THRUST * DT;
    ship.fuel--;
  }
  if (planet) {
    const g = gravityAt(ship.x, ship.y);
    ship.vx += g.ax * DT;
    ship.vy += g.ay * DT;
  }
  const sp = Math.hypot(ship.vx, ship.vy);
  if (sp > MAX_SPEED) { ship.vx *= MAX_SPEED / sp; ship.vy *= MAX_SPEED / sp; }
  ship.x = wrap(ship.x + ship.vx * DT, FIELD_W);
  ship.y = wrap(ship.y + ship.vy * DT, FIELD_H);
  return ship;
}

export function shipsIn(state) { return state.ships.filter(Boolean); }

/** a fresh round: everyone alive, refuelled and rearmed, spread around the planet */
export function startRound(state) {
  state.round++;
  state.phase = 'intro';
  state.timer = ROUND_INTRO;
  state.roundTicks = 0;
  state.dryTicks = 0;
  state.settle = -1;
  state.torps = [];
  const ships = shipsIn(state);
  const n = ships.length;
  // two ships face off left and right; more share the circle evenly, with a random twist per round
  const base = Math.PI + (n > 2 ? (rand(state) - 0.5) * 0.8 : 0);
  ships.forEach((s, i) => {
    const th = base + (i * TAU) / Math.max(1, n);
    s.x = wrap(CX + Math.cos(th) * SPAWN_RING, FIELD_W);
    s.y = wrap(CY + Math.sin(th) * SPAWN_RING, FIELD_H);
    if (state.opts.planet) {
      // a circular orbit, so nobody falls into the planet while still deciding what to do
      const v = Math.sqrt(GRAVITY / SPAWN_RING);
      s.vx = -Math.sin(th) * v;
      s.vy = Math.cos(th) * v;
      s.a = Math.atan2(s.vy, s.vx);
    } else {
      s.vx = 0; s.vy = 0;
      s.a = wrapAngle(rand(state) * 2 * Math.PI);  // nothing to orbit: each ship starts facing a random way
    }
    s.alive = true; s.thrust = false;
    s.fuel = FUEL_MAX; s.torps = TORPS_MAX; s.cool = 0;
    s.hyper = 0; s.hyperCd = 0;
  });
}

function kill(state, ship, cause, by, events) {
  if (!ship.alive) return;
  ship.alive = false;
  ship.thrust = false;
  ship.hyper = 0;
  if (state.phase === 'play') {
    ship.deaths++;
    const killer = by >= 0 && by !== ship.id ? state.ships[by] : null;
    if (killer) killer.kills++;
  }
  events.push({ kind: 'kill', id: ship.id, by, cause, x: ship.x, y: ship.y, vx: ship.vx, vy: ship.vy });
}

/** a random re-entry point clear of the planet and of other ships (best of a few tries) */
function hyperTarget(state, ship) {
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < 12; i++) {
    const x = rand(state) * FIELD_W;
    const y = rand(state) * FIELD_H;
    let score = Infinity;
    if (state.opts.planet) {
      const d = torusDelta(x, y, CX, CY);
      score = Math.hypot(d.dx, d.dy) / HYPER_CLEAR_PLANET;
    }
    for (const o of state.ships) {
      if (!o || o === ship || !o.alive) continue;
      const d = torusDelta(x, y, o.x, o.y);
      score = Math.min(score, Math.hypot(d.dx, d.dy) / HYPER_CLEAR_SHIP);
    }
    if (score >= 1) return { x, y };
    if (score > bestScore) { bestScore = score; best = { x, y }; }
  }
  return best;
}

/**
 * Closest approach, over the last tick, of two points that each moved in a straight line.
 * `dx, dy` is b - a now; `rvx, rvy` is b's velocity relative to a. Catches fast torpedoes
 * that would otherwise step straight through a ship.
 */
function sweptHit(dx, dy, rvx, rvy, r) {
  const sx = dx - rvx * DT, sy = dy - rvy * DT;   // relative position a tick ago
  const ex = rvx * DT, ey = rvy * DT;
  const len2 = ex * ex + ey * ey;
  let t = len2 > 0 ? -(sx * ex + sy * ey) / len2 : 1;
  t = clamp(t, 0, 1);
  const cx = sx + ex * t, cy = sy + ey * t;
  return cx * cx + cy * cy < r * r;
}

/**
 * Advance the whole match by one tick. `inputs[id]` is {bits, steer} for every ship.
 * Reliable game events (kills, jumps, round results) are pushed onto `events`.
 */
export function step(state, inputs = [], events = []) {
  state.tick++;
  if (state.phase === 'lobby' || state.phase === 'over') return state;
  if (state.phase === 'intro') {
    if (--state.timer <= 0) { state.phase = 'play'; events.push({ kind: 'go', round: state.round }); }
    return state;
  }

  const planet = state.opts.planet;
  const ships = shipsIn(state);

  // ships move, then act from where they are
  for (const s of ships) {
    const input = inputs[s.id] || NO_INPUT;
    stepShip(s, input, planet);
    if (!s.alive || s.hyper > 0) continue;
    if ((input.bits & BIT.HYPER) && s.hyperCd === 0) {
      const to = hyperTarget(state, s);
      events.push({ kind: 'hyper', id: s.id, x0: s.x, y0: s.y, x: to.x, y: to.y });
      s.x = to.x; s.y = to.y;
      s.hyper = HYPER_TICKS;
      s.thrust = false;
      continue;
    }
    if ((input.bits & BIT.FIRE) && s.cool === 0 && s.torps > 0) {
      const c = Math.cos(s.a), sn = Math.sin(s.a);
      state.torps.push({
        id: state.nextTorpId, owner: s.id, age: 0,
        x: wrap(s.x + c * MUZZLE, FIELD_W), y: wrap(s.y + sn * MUZZLE, FIELD_H),
        vx: s.vx + c * TORP_SPEED, vy: s.vy + sn * TORP_SPEED,
      });
      state.nextTorpId = (state.nextTorpId + 1) & 0xffff || 1;
      s.torps--;
      s.cool = FIRE_COOLDOWN;
    }
  }

  // torpedoes fly straight, wrap, and burn out; the planet swallows them
  const torps = [];
  for (const t of state.torps) {
    t.age++;
    t.x = wrap(t.x + t.vx * DT, FIELD_W);
    t.y = wrap(t.y + t.vy * DT, FIELD_H);
    if (t.age >= TORP_LIFE) continue;
    if (planet) {
      const d = torusDelta(t.x, t.y, CX, CY);
      if (d.dx * d.dx + d.dy * d.dy < PLANET_R * PLANET_R) continue;
    }
    torps.push(t);
  }
  state.torps = torps;

  // torpedo meets torpedo: both gone
  const dead = new Set();
  for (let i = 0; i < torps.length; i++) {
    for (let j = i + 1; j < torps.length; j++) {
      const a = torps[i], b = torps[j];
      if (dead.has(a) || dead.has(b)) continue;
      const d = torusDelta(a.x, a.y, b.x, b.y);
      if (sweptHit(d.dx, d.dy, b.vx - a.vx, b.vy - a.vy, TORP_R * 2 + 1)) { dead.add(a); dead.add(b); }
    }
  }

  const solid = (s) => s.alive && s.hyper === 0;
  // torpedo meets ship
  for (const t of torps) {
    if (dead.has(t)) continue;
    for (const s of ships) {
      if (!solid(s)) continue;
      if (s.id === t.owner && t.age < TORP_ARM) continue;
      const d = torusDelta(s.x, s.y, t.x, t.y);
      if (sweptHit(d.dx, d.dy, t.vx - s.vx, t.vy - s.vy, SHIP_R + TORP_R)) {
        dead.add(t);
        kill(state, s, 'torpedo', t.owner, events);
        break;
      }
    }
  }
  if (dead.size) state.torps = state.torps.filter((t) => !dead.has(t));

  // ship meets ship: both explode
  for (let i = 0; i < ships.length; i++) {
    for (let j = i + 1; j < ships.length; j++) {
      const a = ships[i], b = ships[j];
      if (!solid(a) || !solid(b)) continue;
      const d = torusDelta(a.x, a.y, b.x, b.y);
      if (d.dx * d.dx + d.dy * d.dy < (SHIP_R * 1.7) ** 2) {
        kill(state, a, 'collision', b.id, events);
        kill(state, b, 'collision', a.id, events);
      }
    }
  }

  // ship meets planet
  if (planet) {
    for (const s of ships) {
      if (!solid(s)) continue;
      const d = torusDelta(s.x, s.y, CX, CY);
      if (d.dx * d.dx + d.dy * d.dy < (PLANET_R + SHIP_R * 0.6) ** 2) kill(state, s, 'planet', -1, events);
    }
  }

  if (state.phase === 'play') stepRound(state, ships, events);
  else if (state.phase === 'outro' && --state.timer <= 0) {
    if (state.winner >= 0) {
      state.phase = 'over';
      events.push({ kind: 'over', winner: state.winner });
    } else {
      startRound(state);
      events.push({ kind: 'round-start', round: state.round });
    }
  }
  return state;
}

/** is the round decided? one survivor (after a moment's grace) wins it; none, or a stalemate, is a draw */
function stepRound(state, ships, events) {
  state.roundTicks++;
  const alive = ships.filter((s) => s.alive);
  state.dryTicks = alive.length > 1 && alive.every((s) => s.torps === 0) ? state.dryTicks + 1 : 0;
  if (state.settle < 0 && alive.length <= 1) state.settle = ROUND_SETTLE;
  let end = false;
  if (state.settle >= 0 && --state.settle <= 0) end = true;
  if (state.roundTicks >= ROUND_MAX || state.dryTicks >= DRY_TIMEOUT) end = true;
  if (!end) return;

  const survivor = alive.length === 1 ? alive[0] : null;
  state.roundWinner = survivor ? survivor.id : -1;
  if (survivor) {
    survivor.wins++;
    if (survivor.wins >= state.opts.roundsToWin) state.winner = survivor.id;
  }
  state.phase = 'outro';
  state.timer = ROUND_OUTRO;
  events.push({
    kind: 'round', round: state.round, winner: state.roundWinner,
    reason: survivor ? 'last' : alive.length ? 'stalemate' : 'none',
    wins: state.ships.map((s) => (s ? s.wins : 0)),
    match: state.winner,
  });
}
