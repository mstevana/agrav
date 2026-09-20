// The rules that turn driving into a result: laps, the two ways to win, what a
// wreck leaves behind, and what the wire carries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import rally from '../rally/module.js';
import { PHASE, CONTACT, FINISH_GRACE_SEC, ELIM_BANNER_SEC } from '../rally/constants.js';
import { makeDamage, running } from '../rally/sim/race.js';
import { encodeRallySnapshot, decodeRallySnapshot, ENTITY } from '../rally/sim/snapshot.js';
import { buildTrack } from '../rally/sim/track.js';
import { frameAt } from '../sim/spline.js';

/** a match with `n` bot seats, started and ready to be stepped by hand */
function match(n = 3, opts = {}) {
  const race = rally.createMatch({ track: 'scrapyard', laps: 1, ...opts }, 4242);
  for (let i = 0; i < n; i++) rally.addPlayer(race, i, {}, true);
  rally.start(race, 0);
  return race;
}
function run(race, ticks, { drive = true, from = 0 } = {}) {
  const events = [];
  for (let i = 1; i <= ticks; i++) {
    const tick = from + i;
    if (drive) for (const c of race.cars) rally.applyInput(race, c.id, rally.botInput(race, c.id, tick));
    rally.step(race, tick, events);
  }
  return events;
}
/** put a car on the road at a given distance round the lap, pointing the right way */
function place(race, car, s, t = 0, speed = 0) {
  const f = frameAt(race.ribbon, s);
  const yaw = Math.atan2(f.tangent.x, f.tangent.z);
  Object.assign(car.c, { x: f.pos.x + f.right.x * t, z: f.pos.z + f.right.z * t, yaw, s, t,
    vx: Math.sin(yaw) * speed, vz: Math.cos(yaw) * speed, fwd: speed, lat: 0 });
  car.progress = s;
}

test('race: the countdown freezes the grid, then the flag drops', () => {
  const race = match(3);
  assert.equal(race.phase, PHASE.COUNTDOWN);
  const before = race.cars.map(c => ({ x: c.c.x, z: c.c.z }));
  const events = run(race, 60);
  assert.equal(race.phase, PHASE.COUNTDOWN, 'still counting after one second');
  race.cars.forEach((c, i) => assert.equal(c.c.x, before[i].x, 'nobody moved on the grid'));
  const more = run(race, 60 * 4, { from: 60 });
  assert.equal(race.phase, PHASE.RACING);
  assert.ok([...events, ...more].some(e => e.t === 'go'));
});

test('race: laps only count forwards, and driving backwards over the line takes one away', () => {
  const race = match(1, { laps: 3 });
  run(race, 60 * 4);                                  // let the countdown finish
  const car = race.cars[0];
  const L = race.ribbon.length;

  place(race, car, L - 40);
  car.progress = L - 40;
  run(race, 1, { drive: false, from: 300 });
  assert.equal(car.lap, 0);

  place(race, car, 20);
  car.progress = L + 20;                              // crossed the line
  const ev = run(race, 1, { drive: false, from: 301 });
  assert.equal(car.lap, 1, 'a lap is counted');
  assert.ok(ev.some(e => e.t === 'lap' && e.id === car.id));

  car.progress = L - 30;                              // reversed back over it
  run(race, 1, { drive: false, from: 302 });
  assert.equal(car.lap, 0, 'and taken away again');
});

test('race: the last car still running wins there and then', () => {
  const race = match(4, { laps: 5 });
  run(race, 60 * 5);
  const events = [];
  const applyDamage = makeDamage(race, race.tick);
  for (const c of race.cars.slice(1)) applyDamage(c, 9999, 0, 'ram', events);
  assert.equal(running(race).length, 1);
  rally.step(race, race.tick + 1, events);
  assert.equal(race.phase, PHASE.FINISHED, 'the race did not wait for the laps to be run');
  assert.equal(race.lastAlive, race.cars[0].id);
  assert.ok(events.some(e => e.t === 'laststanding' && e.id === race.cars[0].id));
  const results = rally.results(race);
  assert.equal(results.byElimination, true);
  assert.equal(results.order[0].id, race.cars[0].id, 'the survivor is first, unfinished laps and all');
  assert.ok(results.order.slice(1).every(o => o.eliminated));
});

test('race: after the first car home the rest have the grace to finish, then it ends', () => {
  const race = match(3, { laps: 1 });
  run(race, 60 * 5);
  const [winner, second, third] = race.cars;
  const L = race.ribbon.length;
  place(race, winner, 1);
  winner.progress = L + 1;
  run(race, 1, { drive: false, from: 600 });
  assert.ok(winner.finished, 'the leader is home');
  assert.equal(race.phase, PHASE.RACING, 'and the race goes on for the others');

  place(race, second, 1);
  second.progress = L + 1;
  run(race, 1, { drive: false, from: 601 });
  assert.ok(second.finished);
  assert.equal(race.phase, PHASE.RACING);

  run(race, FINISH_GRACE_SEC * 60 + 5, { drive: false, from: 602 });
  assert.equal(race.phase, PHASE.FINISHED, 'the grace ran out');
  const results = rally.results(race);
  assert.equal(results.byElimination, false);
  assert.equal(results.order[0].id, winner.id);
  assert.equal(results.order[1].id, second.id);
  assert.equal(results.order[2].id, third.id);
  assert.ok(results.order[2].time === null, 'the one still out there has no time');
});

test('race: a car that is home cannot be hurt, and cannot hurt anyone', () => {
  const race = match(2, { laps: 1 });
  run(race, 60 * 5);
  const [a, b] = race.cars;
  a.finished = true; a.finishTick = race.tick;
  const events = [];
  const applyDamage = makeDamage(race, race.tick);
  const hullBefore = b.hull;
  applyDamage(a, 50, b.id, 'ram', events);
  assert.equal(a.hull, a.maxHull, 'a finished car takes nothing');
  // and park them on top of each other at closing speed: no ram is exchanged
  place(race, a, 200, 0, 30);
  place(race, b, 200.5, 0, -30);
  rally.step(race, race.tick + 1, events);
  assert.equal(b.hull, hullBefore, 'and deals nothing');
});

test('race: a wreck stays in the road at a fraction of the car, a dropout leaves nothing', () => {
  const race = match(3, { laps: 3 });
  run(race, 60 * 5);
  const [a, b] = race.cars;
  const events = [];
  makeDamage(race, race.tick)(a, 9999, b.id, 'ram', events);
  assert.equal(race.wrecks.length, 1);
  const wreck = race.wrecks[0];
  assert.equal(wreck.id, a.id);
  assert.ok(Math.abs(wreck.r - a.c.radius * CONTACT.wreckRadiusFactor) < 1e-9,
    'the shell blocks less road than the car did, so a lane stays open');
  assert.equal(b.kills, 1, 'and the kill is credited');

  rally.onAbandon(race, race.cars[2].id);
  assert.equal(race.wrecks.length, 1, 'a driver who ran out of time to come back simply vanishes');
});

test('race: a wreck is solid, and it is still solid for the car that left it', () => {
  const race = match(2, { laps: 3 });
  run(race, 60 * 5);
  const [a, b] = race.cars;
  place(race, a, 300);
  makeDamage(race, race.tick)(a, 9999, -1, 'wall', []);
  const wreck = race.wrecks[0];
  place(race, b, 280, 0, 25);
  for (let i = 0; i < 90; i++) { rally.applyInput(race, b.id, { bits: 1, steer: 0 }); rally.step(race, race.tick + 1 + i, []); }
  const d = Math.hypot(b.c.x - wreck.x, b.c.z - wreck.z);
  assert.ok(d >= b.c.radius + wreck.r - 0.05, `a car drove through the wreck (${d.toFixed(2)} m apart)`);
});

test('race: the snapshot round-trips everything the client draws from', () => {
  const race = match(4, { laps: 2 });
  run(race, 60 * 8);
  makeDamage(race, race.tick)(race.cars[3], 9999, 0, 'ram', []);
  race.entities.length = 0;                       // the bots have been busy; this test wants one known mine
  race.entities.push({ id: 7, kind: ENTITY.MINE, owner: 1, x: 12.5, z: -30.25, yaw: 0.5, life: 9, armed: true });
  race.pads[0].respawnTick = race.tick + 600;

  const u8 = encodeRallySnapshot(race, 2);
  const d = decodeRallySnapshot(u8);
  assert.equal(d.cars[0].id, 2, 'the recipient is first in the record, so it can reconcile and stop');
  assert.equal(d.cars.length, 4);
  assert.equal(d.wrecks.length, 1);
  assert.equal(d.entities.length, 1);
  assert.equal(d.entities[0].kind, ENTITY.MINE);
  assert.equal(d.entities[0].armed, true);
  assert.equal(d.pads.length, race.pads.length);
  assert.equal(d.pads[0], null, 'a taken pad reads as taken');
  assert.equal(d.pads[1], race.pads[1].item, 'and a live one says what is on it');
  for (const car of race.cars) {
    const rec = d.cars.find(r => r.id === car.id);
    assert.ok(Math.abs(rec.x - car.c.x) < 1e-3 && Math.abs(rec.z - car.c.z) < 1e-3,
      'position survives exactly enough to reconcile against');
    assert.ok(Math.abs(rec.vx - car.c.vx) < 0.02 && Math.abs(rec.vz - car.c.vz) < 0.02);
    assert.ok(Math.abs(rec.yaw - car.c.yaw) < 1e-3);
    assert.equal(rec.dead, car.dead);
    assert.equal(rec.lap, car.lap);
  }
  assert.ok(u8.length < 400, `a snapshot is ${u8.length} bytes`);
});

test('race: results rank finishers by the flag, the rest by distance, the dead last', () => {
  const race = match(4, { laps: 1 });
  run(race, 60 * 5);
  const [a, b, c, d] = race.cars;
  const L = race.ribbon.length;
  a.finished = true; a.finishTick = 100; a.progress = L;
  b.finished = true; b.finishTick = 200; b.progress = L;
  c.progress = 400;
  makeDamage(race, race.tick)(d, 9999, -1, 'wall', []);
  d.progress = 900;                                    // died a long way round, still behind the living
  const order = rally.results(race).order;
  assert.deepEqual(order.map(o => o.id), [a.id, b.id, c.id, d.id]);
  assert.deepEqual(order.map(o => o.place), [1, 2, 3, 4]);
});

test('race: the room is told the race is over only after the camera has had its moment', () => {
  const race = match(2, { laps: 1 });
  run(race, 60 * 5);
  for (const car of race.cars) { car.finished = true; car.finishTick = race.tick; }
  rally.step(race, race.tick + 1, []);
  assert.equal(race.phase, PHASE.FINISHED);
  assert.equal(rally.isOver(race), false, 'not the instant it ends');
  run(race, 60 * (ELIM_BANNER_SEC + 6), { drive: false, from: race.tick });
  assert.equal(rally.isOver(race), true);
});

test('race: host options are clamped to something raceable', () => {
  assert.deepEqual(rally.validateOpts({}), { track: 'scrapyard', laps: 3, botDifficulty: 'normal', fillBots: true });
  assert.equal(rally.validateOpts({ laps: 99 }).laps, 9);
  assert.equal(rally.validateOpts({ laps: -3 }).laps, 1, 'a nonsense lap count lands inside the range, not at the default');
  assert.equal(rally.validateOpts({ track: '../../etc/passwd' }).track, 'scrapyard');
  assert.equal(rally.validateOpts({ botDifficulty: 'impossible' }).botDifficulty, 'normal');
  assert.equal(rally.validateOpts({ fillBots: false }).fillBots, false);
  assert.equal(rally.fillBots(null, rally.validateOpts({ fillBots: false })), false);
  assert.equal(rally.fillBots(null, rally.validateOpts({})), true);
});

test('race: the prize multiplier stacks the track with the difficulty', () => {
  const easy = match(1, { botDifficulty: 'easy' });
  const hard = match(1, { botDifficulty: 'hard' });
  const track = buildTrack('scrapyard');
  assert.ok(Math.abs(rally.results(easy).prizeMultiplier - track.prize * 0.6) < 1e-6);
  assert.ok(Math.abs(rally.results(hard).prizeMultiplier - track.prize * 1.3) < 1e-6);
});
