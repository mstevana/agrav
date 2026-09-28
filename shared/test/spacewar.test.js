import { test } from 'node:test';
import assert from 'node:assert/strict';
import sw, { validateOpts } from '../spacewar/module.js';
import { createState, createShip, step, stepShip, startRound, NO_INPUT } from '../spacewar/sim.js';
import {
  FIELD_W, FIELD_H, CX, CY, BIT, TORP_LIFE, TORPS_MAX, FUEL_MAX, FIRE_COOLDOWN, HYPER_TICKS, HYPER_COOLDOWN,
  ROUND_INTRO, ROUND_SETTLE, ROUND_OUTRO, SHIP_R, PLANET_R,
} from '../spacewar/constants.js';

/** a match with `n` ships, released from the intro and ready to play */
function match(n = 2, opts = {}) {
  const s = createState({ planet: false, roundsToWin: 3, ...opts }, 7);
  for (let id = 0; id < n; id++) s.ships[id] = createShip(id);
  startRound(s);
  for (let i = 0; i < ROUND_INTRO; i++) step(s);
  assert.equal(s.phase, 'play');
  return s;
}
/** park ship `id` somewhere, still */
function park(s, id, x, y, a = 0) { Object.assign(s.ships[id], { x, y, a, vx: 0, vy: 0 }); }

test('spacewar: a ship leaving one edge comes back in at the opposite one', () => {
  const ship = { ...createShip(0), alive: true, x: FIELD_W - 2, y: 2, vx: 300, vy: -300 };
  stepShip(ship, NO_INPUT, false);
  assert.ok(ship.x < 10, `x wrapped to ${ship.x}`);
  assert.ok(ship.y > FIELD_H - 10, `y wrapped to ${ship.y}`);
});

test('spacewar: turning, thrust and fuel', () => {
  const ship = { ...createShip(0), alive: true, x: 100, y: 100 };
  stepShip(ship, { bits: 0, steer: 1 }, false);
  assert.ok(ship.a > 0, 'steer +1 turns clockwise on screen');
  const ship2 = { ...createShip(0), alive: true, x: 100, y: 100, a: 0 };
  for (let i = 0; i < 60; i++) stepShip(ship2, { bits: BIT.THRUST, steer: 0 }, false);
  assert.ok(ship2.vx > 120 && Math.abs(ship2.vy) < 1e-9, 'thrust pushes along the nose');
  assert.equal(ship2.fuel, FUEL_MAX - 60);
  ship2.fuel = 0;
  const v = ship2.vx;
  stepShip(ship2, { bits: BIT.THRUST, steer: 0 }, false);
  assert.equal(ship2.vx, v, 'no fuel, no thrust');
  assert.equal(ship2.thrust, false);
});

test('spacewar: the planet pulls, and touching it is fatal', () => {
  const ship = { ...createShip(0), alive: true, x: CX + 250, y: CY };
  stepShip(ship, NO_INPUT, true);
  assert.ok(ship.vx < 0, 'pulled toward the centre');
  const s = match(2, { planet: true });
  park(s, 0, CX + PLANET_R + 2, CY);
  park(s, 1, 100, 100);
  const events = [];
  step(s, [], events);
  assert.equal(s.ships[0].alive, false);
  assert.ok(events.some((e) => e.kind === 'kill' && e.id === 0 && e.cause === 'planet'));
});

test('spacewar: torpedoes fly straight, wrap, and expire', () => {
  const s = match(2);
  park(s, 0, FIELD_W - 60, 300, 0);
  park(s, 1, 200, 800);
  step(s, [{ bits: BIT.FIRE, steer: 0 }]);
  assert.equal(s.torps.length, 1);
  assert.equal(s.ships[0].torps, TORPS_MAX - 1);
  const t = s.torps[0];
  const y0 = t.y;
  let wrapped = false, prevX = t.x;
  for (let i = 1; i < TORP_LIFE - 1; i++) {
    step(s);
    if (!s.torps.length) break;
    if (s.torps[0].x < prevX) wrapped = true;
    prevX = s.torps[0].x;
    assert.equal(s.torps[0].y, y0, 'a straight line');
  }
  assert.ok(wrapped, 'it came back in on the left');
  for (let i = 0; i < 3; i++) step(s);
  assert.equal(s.torps.length, 0, 'burnt out');
});

test('spacewar: the gun has a cooldown and a magazine', () => {
  const s = match(2);
  park(s, 0, 300, 300, 0); park(s, 1, 300, 700, 0);
  s.ships[1].torps = 0;
  for (let i = 0; i < FIRE_COOLDOWN * 3; i++) step(s, [{ bits: BIT.FIRE, steer: 0 }, { bits: BIT.FIRE, steer: 0 }]);
  assert.equal(s.torps.filter((t) => t.owner === 0).length, 3, 'one shot per cooldown');
  assert.equal(s.torps.filter((t) => t.owner === 1).length, 0, 'an empty magazine fires nothing');
});

test('spacewar: a torpedo kills, credits the shooter, and cannot hit its owner at launch', () => {
  const s = match(2);
  park(s, 0, 300, 300, 0);
  park(s, 1, 500, 300, 0);
  const events = [];
  step(s, [{ bits: BIT.FIRE, steer: 0 }], events);
  for (let i = 0; i < 60 && s.ships[1].alive; i++) step(s, [], events);
  assert.equal(s.ships[0].alive, true, 'the shooter survives its own launch');
  assert.equal(s.ships[1].alive, false);
  assert.equal(s.ships[0].kills, 1);
  assert.equal(s.ships[1].deaths, 1);
  assert.ok(events.some((e) => e.kind === 'kill' && e.id === 1 && e.by === 0 && e.cause === 'torpedo'));
  assert.equal(s.torps.length, 0, 'the torpedo is spent');
});

test('spacewar: a fast torpedo cannot tunnel through a ship', () => {
  const s = match(2);
  park(s, 0, 100, 300, 0);
  park(s, 1, 500, 300, 0);
  s.ships[0].vx = 900;  // the torpedo inherits this: ~20 px a tick, about a ship's radius
  step(s, [{ bits: BIT.FIRE, steer: 0 }]);
  s.ships[0].vx = 0;
  for (let i = 0; i < 80 && s.ships[1].alive; i++) step(s);
  assert.equal(s.ships[1].alive, false);
});

test('spacewar: two ships that touch both explode', () => {
  const s = match(3);
  park(s, 0, 300, 300); park(s, 1, 300 + SHIP_R, 300); park(s, 2, 900, 700);
  const events = [];
  step(s, [], events);
  assert.equal(s.ships[0].alive, false);
  assert.equal(s.ships[1].alive, false);
  assert.equal(events.filter((e) => e.cause === 'collision').length, 2);
});

test('spacewar: torpedoes that meet cancel out', () => {
  const s = match(2);
  park(s, 0, 300, 300, 0); park(s, 1, 700, 300, Math.PI);
  step(s, [{ bits: BIT.FIRE, steer: 0 }, { bits: BIT.FIRE, steer: 0 }]);
  assert.equal(s.torps.length, 2);
  for (let i = 0; i < 60; i++) step(s);
  assert.equal(s.torps.length, 0);
  assert.ok(s.ships[0].alive && s.ships[1].alive, 'nobody was hit');
});

test('spacewar: hyperspace moves the ship, hides it for a moment, then recharges', () => {
  const s = match(2);
  park(s, 0, 300, 300); park(s, 1, 1300, 700);
  const events = [];
  step(s, [{ bits: BIT.HYPER, steer: 0 }], events);
  const jump = events.find((e) => e.kind === 'hyper');
  assert.ok(jump, 'a hyper event');
  assert.equal(s.ships[0].hyper, HYPER_TICKS);
  assert.deepEqual([s.ships[0].x, s.ships[0].y], [jump.x, jump.y]);
  // invulnerable while away: park the other ship right on top
  park(s, 1, jump.x, jump.y);
  step(s);
  assert.ok(s.ships[0].alive && s.ships[1].alive);
  park(s, 1, 1300, 700);
  for (let i = 0; i < HYPER_TICKS; i++) step(s, [{ bits: BIT.HYPER, steer: 0 }]);
  assert.equal(s.ships[0].hyper, 0);
  assert.ok(s.ships[0].hyperCd > HYPER_COOLDOWN - 5, 'recharging, and holding the key does not jump again');
});

test('spacewar: the last ship flying wins the round; the match goes to roundsToWin', () => {
  const s = match(2, { roundsToWin: 2 });
  const events = [];
  s.ships[1].alive = false;
  for (let i = 0; i < ROUND_SETTLE; i++) step(s, [], events);
  assert.equal(s.phase, 'outro');
  assert.equal(s.ships[0].wins, 1);
  assert.ok(events.some((e) => e.kind === 'round' && e.winner === 0));
  for (let i = 0; i < ROUND_OUTRO; i++) step(s, [], events);
  assert.equal(s.phase, 'intro');
  assert.equal(s.round, 2);
  assert.ok(s.ships[1].alive, 'everyone is back for the next round');
  assert.equal(s.ships[0].torps, TORPS_MAX, 'rearmed');
  for (let i = 0; i < ROUND_INTRO; i++) step(s, [], events);
  s.ships[1].alive = false;
  for (let i = 0; i < ROUND_SETTLE + ROUND_OUTRO; i++) step(s, [], events);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 0);
  assert.ok(events.some((e) => e.kind === 'over' && e.winner === 0));
});

test('spacewar: nobody left is a draw', () => {
  const s = match(2);
  s.ships[0].alive = false; s.ships[1].alive = false;
  for (let i = 0; i < ROUND_SETTLE; i++) step(s);
  assert.equal(s.phase, 'outro');
  assert.equal(s.roundWinner, -1);
  assert.equal(s.ships[0].wins + s.ships[1].wins, 0);
});

test('spacewar: the snapshot carries everything prediction needs', () => {
  const s = match(3, { planet: true });
  for (let i = 0; i < 30; i++) step(s, [{ bits: BIT.THRUST | BIT.FIRE, steer: 0.5 }]);
  const d = sw.decodeSnapshot(sw.encodeSnapshot(s));
  assert.equal(d.ships.length, 4);
  assert.equal(d.ships[3], null, 'an empty seat');
  const a = s.ships[0], b = d.ships[0];
  assert.ok(Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05);
  assert.ok(Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.a - b.a) < 1e-3);
  assert.deepEqual([b.fuel, b.torps, b.cool, b.alive], [a.fuel, a.torps, a.cool, a.alive]);
  assert.equal(d.torps.length, s.torps.length);
  assert.equal(d.torps[0].id, s.torps[0].id);
  // replaying from the decoded ship lands where the server does, to within quantization
  const pred = { ...b };
  const auth = s.ships[0];
  for (let i = 0; i < 20; i++) { stepShip(pred, { bits: BIT.THRUST, steer: -1 }, true); stepShip(auth, { bits: BIT.THRUST, steer: -1 }, true); }
  assert.ok(Math.hypot(pred.x - auth.x, pred.y - auth.y) < 0.5, 'prediction agrees with the server');
});

test('spacewar: options are validated, and at least two ships always fly', () => {
  assert.deepEqual(validateOpts({ roundsToWin: 99, planet: 0, botDifficulty: 'insane' }),
    { roundsToWin: 15, planet: false, botDifficulty: 'normal' });
  assert.deepEqual(validateOpts({}), { roundsToWin: 5, planet: true, botDifficulty: 'normal' });
  const s = sw.createMatch({}, 1);
  assert.equal(sw.fillBots(s, {}), 2, 'at least two ships fly, whatever the lobby sends');
});

for (const difficulty of ['easy', 'normal', 'hard']) {
  test(`spacewar: ${difficulty} bots play a whole match to a winner`, () => {
    const s = sw.createMatch({ roundsToWin: 3, planet: true, botDifficulty: difficulty }, 99);
    for (let id = 0; id < 4; id++) sw.addPlayer(s, id, {}, true);
    sw.start(s, 0);
    let tick = 0, kills = 0;
    while (!sw.isOver(s) && tick < 60 * 60 * 10) {
      const events = [];
      sw.step(s, ++tick, events);
      kills += events.filter((e) => e.kind === 'kill').length;
    }
    assert.ok(sw.isOver(s), 'the match ended');
    const r = sw.results(s);
    assert.ok(r.winner >= 0 && r.winner < 4);
    assert.equal(r.standings[0].id, r.winner);
    assert.equal(r.standings[0].wins, 3);
    assert.ok(kills > 0);
    assert.doesNotThrow(() => JSON.stringify(s), 'the state stays plain data');
  });
}
