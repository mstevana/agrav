// Guns, mines and the bumper. The rules here are the ones a player will call
// cheating if they are wrong: what a shot can hit, when, and through what.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import rally from '../rally/module.js';
import { acquireLock, inKillCone, weaponDef, armCar } from '../rally/weapons.js';
import { makeDamage } from '../rally/sim/race.js';
import { ENTITY } from '../rally/sim/snapshot.js';
import { WEAPONS, MINE, NITRO, PAD, HITSCAN_REWIND_TICKS, LOCK, CONTACT } from '../rally/constants.js';
import { frameAt } from '../sim/spline.js';
import { IN } from '../net/protocol.js';

function match(n = 2, opts = {}) {
  const race = rally.createMatch({ track: 'scrapyard', laps: 3, ...opts }, 31337);
  for (let i = 0; i < n; i++) rally.addPlayer(race, i, { weapon: 'machinegun' }, true);
  rally.start(race, 0);
  for (let t = 1; t <= 60 * 5; t++) rally.step(race, t, []);       // let the countdown go
  return race;
}
/** drop a car on the road facing along it */
function put(race, car, s, t = 0, speed = 0) {
  const f = frameAt(race.ribbon, s);
  const yaw = Math.atan2(f.tangent.x, f.tangent.z);
  Object.assign(car.c, {
    x: f.pos.x + f.right.x * t, z: f.pos.z + f.right.z * t, yaw, s, t,
    vx: Math.sin(yaw) * speed, vz: Math.cos(yaw) * speed, fwd: speed, lat: 0
  });
  car.progress = s;
}
/** face a car directly at a point */
const aimAt = (car, x, z) => { car.c.yaw = Math.atan2(x - car.c.x, z - car.c.z); };
/**
 * Let the world catch up with where the test just put everyone. Shots and locks
 * are scored against the pose history, so a car that has been moved by hand is
 * still somewhere else as far as a rewound ray is concerned until a few ticks
 * have written the new positions down.
 */
const settle = (race, ticks = HITSCAN_REWIND_TICKS + 3) => {
  for (const car of race.cars) car.input = { bits: 0, steer: 0 };
  for (let i = 0; i < ticks; i++) rally.step(race, race.tick + 1, []);
};
const hold = (race, car, bits) => { car.input = { bits, steer: 0 }; void race; };

test('weapons: a shot hits what the shooter was pointing at, and spends a round', () => {
  const race = match(2);
  const [a, b] = race.cars;
  put(race, a, 200); put(race, b, 215);
  aimAt(a, b.c.x, b.c.z);
  armCar(a); armCar(b);
  const ammoBefore = a.ammo, hullBefore = b.hull;
  hold(race, a, IN.FIRE);
  for (let i = 0; i < 30; i++) rally.step(race, race.tick + 1, []);
  assert.ok(a.ammo < ammoBefore, 'rounds were spent');
  assert.ok(b.hull < hullBefore, `the target took damage (${hullBefore} -> ${b.hull})`);
  assert.equal(a.hull, a.maxHull, 'and the shooter did not shoot itself');
});

test('weapons: nothing outside the cone can be hit, however long you hold it', () => {
  const race = match(2);
  const [a, b] = race.cars;
  put(race, a, 200); put(race, b, 215);
  aimAt(a, b.c.x, b.c.z);
  a.c.yaw += Math.PI / 2;                        // ninety degrees off
  armCar(a); armCar(b);
  hold(race, a, IN.FIRE);
  for (let i = 0; i < 120; i++) rally.step(race, race.tick + 1, []);
  assert.equal(b.hull, b.maxHull, 'a target abeam of the muzzle is never hit');
  assert.ok(a.ammo < WEAPONS.machinegun.ammo, 'though the rounds were still spent');
});

test('weapons: range is a real limit', () => {
  const race = match(2);
  const [a, b] = race.cars;
  const w = weaponDef('machinegun');
  put(race, a, 40); put(race, b, 40 + w.range + 25);
  aimAt(a, b.c.x, b.c.z);
  armCar(a); armCar(b);
  hold(race, a, IN.FIRE);
  for (let i = 0; i < 60; i++) rally.step(race, race.tick + 1, []);
  assert.equal(b.hull, b.maxHull, 'a car beyond the weapon’s range is out of reach');
});

test('weapons: a wreck is cover, and so is the scenery', () => {
  const race = match(3);
  const [a, b, shield] = race.cars;
  put(race, a, 200); put(race, shield, 208); put(race, b, 216);
  aimAt(a, b.c.x, b.c.z);
  armCar(a); armCar(b);
  makeDamage(race, race.tick)(shield, 99999, -1, 'wall', []);      // it dies where it stands, between them
  assert.equal(race.wrecks.length, 1);
  const hullBefore = b.hull;
  hold(race, a, IN.FIRE);
  for (let i = 0; i < 60; i++) rally.step(race, race.tick + 1, []);
  assert.equal(b.hull, hullBefore, 'the burnt-out shell took the bullets');
});

test('weapons: a shot is scored against where the target was, not where it is now', () => {
  const race = match(2);
  const [a, b] = race.cars;
  put(race, a, 200); put(race, b, 214);
  aimAt(a, b.c.x, b.c.z);
  armCar(a); armCar(b);
  // remember where the shooter is looking, then teleport the target away and
  // fill the history so the rewound pose still has it in the old place
  const wasX = b.c.x, wasZ = b.c.z;
  for (let i = 0; i < HITSCAN_REWIND_TICKS + 2; i++) rally.step(race, race.tick + 1, []);
  b.c.x = wasX + 60; b.c.z = wasZ + 60;                            // gone, as far as this instant goes
  const hullBefore = b.hull;
  hold(race, a, IN.FIRE);
  rally.step(race, race.tick + 1, []);
  assert.ok(b.hull < hullBefore,
    'the shooter hit what they could see, even though the target is no longer there');
});

test('weapons: the shotgun throws a spread and the minigun has to wind up', () => {
  const shot = weaponDef('shotgun'), mini = weaponDef('minigun');
  assert.ok(shot.pellets > 1 && shot.spread > weaponDef('machinegun').spread);
  assert.ok(shot.range < weaponDef('machinegun').range, 'and it is a short-range answer');
  assert.ok(mini.spinUp > 0);

  const race = match(2);
  const [a, b] = race.cars;
  a.weapon = 'minigun'; armCar(a); armCar(b);
  put(race, a, 200); put(race, b, 212);
  aimAt(a, b.c.x, b.c.z);
  hold(race, a, IN.FIRE);
  rally.step(race, race.tick + 1, []);
  assert.equal(a.ammo, mini.ammo, 'nothing comes out on the first tick');
  for (let i = 0; i < Math.ceil(mini.spinUp * 60) + 4; i++) rally.step(race, race.tick + 1, []);
  assert.ok(a.ammo < mini.ammo, 'but it fires once it is up to speed');
});

test('weapons: the laser sight says what is in the cone and never moves the ray', () => {
  const race = match(3);
  const [a, b, c] = race.cars;
  put(race, a, 200); put(race, b, 230); put(race, c, 212);
  aimAt(a, b.c.x, b.c.z);
  armCar(a);
  settle(race);
  assert.equal(acquireLock(race, a, race.tick), c.id, 'the nearer car inside the cone wins');

  // a car well off to the side is not a lock at all
  put(race, b, 205, 40); put(race, c, 205, -40);
  const f = frameAt(race.ribbon, 200);
  put(race, a, 200);
  a.c.yaw = Math.atan2(f.tangent.x, f.tangent.z);
  settle(race);
  assert.equal(acquireLock(race, a, race.tick), -1);
  assert.ok(LOCK.cone < Math.PI / 4, 'the cone is narrow enough to mean something');

  // and with a lock held, a shot still goes exactly where the car points
  put(race, b, 214, 0); put(race, c, 400, 0);
  settle(race);
  a.c.yaw = Math.atan2(f.tangent.x, f.tangent.z) + 0.9;            // pointing away from the lock
  armCar(b);
  const hullBefore = b.hull;
  hold(race, a, IN.FIRE);
  for (let i = 0; i < 60; i++) rally.step(race, race.tick + 1, []);
  assert.equal(b.hull, hullBefore, 'the locked car is untouched, because the gun is not aimed at it');
});

test('weapons: a mine arms, then hurts whoever finds it, its owner included', () => {
  const race = match(2);
  const [a] = race.cars;
  put(race, a, 300);
  armCar(a);
  hold(race, a, IN.MINE);
  rally.step(race, race.tick + 1, []);
  assert.equal(race.entities.length, 1, 'one mine, from one press');
  assert.equal(a.mines, MINE.perRace - 1);
  const mine = race.entities[0];
  assert.equal(mine.kind, ENTITY.MINE);
  assert.equal(mine.armed, false);

  // sitting on it before it arms is safe
  a.c.x = mine.x; a.c.z = mine.z;
  hold(race, a, 0);
  rally.step(race, race.tick + 1, []);
  assert.equal(a.hull, a.maxHull, 'it is not live yet');

  for (let i = 0; i < Math.ceil(MINE.armSec * 60) + 2; i++) {
    a.c.x = mine.x + 40; a.c.z = mine.z + 40;                      // stay clear while it arms
    rally.step(race, race.tick + 1, []);
  }
  assert.equal(race.entities[0]?.armed, true);
  a.c.x = mine.x; a.c.z = mine.z;
  const events = [];
  rally.step(race, race.tick + 1, events);
  assert.ok(a.hull < a.maxHull, 'and it does not care whose it was');
  assert.equal(race.entities.length, 0, 'the mine is spent');
  assert.ok(events.some(e => e.t === 'blast'));
});

test('weapons: holding the mine button drops one mine, not a trail of them', () => {
  const race = match(1);
  const [a] = race.cars;
  put(race, a, 300);
  armCar(a);
  hold(race, a, IN.MINE);
  for (let i = 0; i < 60; i++) rally.step(race, race.tick + 1, []);
  assert.equal(a.mines, MINE.perRace - 1, 'one press, one mine');
  hold(race, a, 0);
  rally.step(race, race.tick + 1, []);
  hold(race, a, IN.MINE);
  rally.step(race, race.tick + 1, []);
  assert.equal(a.mines, MINE.perRace - 2, 'letting go and pressing again drops another');
});

test('weapons: the spiked bumper is cheap to give and expensive to receive', () => {
  const plain = rally.createMatch({ track: 'scrapyard', laps: 3 }, 7);
  rally.addPlayer(plain, 0, { car: 'warden' }, true);
  rally.addPlayer(plain, 1, { car: 'warden' }, true);
  const spiked = rally.createMatch({ track: 'scrapyard', laps: 3 }, 7);
  rally.addPlayer(spiked, 0, { car: 'warden', bumper: true }, true);
  rally.addPlayer(spiked, 1, { car: 'warden' }, true);

  const ram = (race) => {
    rally.start(race, 0);
    for (let t = 1; t <= 60 * 5; t++) rally.step(race, t, []);
    const [a, b] = race.cars;
    put(race, a, 300, 0, 40); put(race, b, 304, 0, 0);
    a.ramTick = -999; b.ramTick = -999;
    for (let i = 0; i < 10; i++) rally.step(race, race.tick + 1, []);
    return { rammer: a.maxHull - a.hull, victim: b.maxHull - b.hull };
  };
  const bare = ram(plain), spikes = ram(spiked);
  assert.ok(spikes.victim > bare.victim, `spikes hurt more (${spikes.victim} vs ${bare.victim})`);
  assert.ok(spikes.rammer < bare.rammer + 0.01, 'and cost the car carrying them less');
  assert.equal(CONTACT.ramDamage > 0, true);
});

test('pickups: a pad hands out what it holds, and comes back later', () => {
  const race = match(1);
  const [a] = race.cars;
  armCar(a);
  const pad = race.pads.find(p => p.item === 'repair');
  a.hull = a.maxHull * 0.3;
  const before = a.hull;
  put(race, a, pad.s, pad.t);
  const events = [];
  rally.step(race, race.tick + 1, events);
  assert.ok(a.hull > before, 'it repaired the car');
  assert.ok(Math.abs(a.hull - Math.min(a.maxHull, before + PAD.repair)) < 1e-6);
  assert.ok(events.some(e => e.t === 'pickup' && e.item === 'repair'));
  assert.ok(pad.respawnTick > race.tick, 'and the pad is empty for a while');

  const hull = a.hull;
  rally.step(race, race.tick + 1, []);
  assert.equal(a.hull, hull, 'sitting on an empty pad gives nothing');
});

test('pickups: a full car leaves the pad for somebody who needs it', () => {
  const race = match(1);
  const [a] = race.cars;
  armCar(a);
  const pad = race.pads.find(p => p.item === 'ammo');
  put(race, a, pad.s, pad.t);
  rally.step(race, race.tick + 1, []);
  assert.equal(pad.respawnTick, 0, 'a full magazine does not take the ammo');
  a.ammo = 10;
  rally.step(race, race.tick + 1, []);
  assert.ok(a.ammo > 10 && pad.respawnTick > race.tick, 'an empty one does');
});

test('pickups: nitro is a charge you spend, and it makes the car faster', () => {
  const race = match(1);
  const [a] = race.cars;
  armCar(a);
  a.nitro = 1;
  put(race, a, 60, 0, 20);
  hold(race, a, IN.NITRO | IN.THROTTLE);
  rally.step(race, race.tick + 1, []);
  assert.equal(a.nitro, 0, 'the charge is gone');
  assert.ok(a.c.nitroT > 0 && a.c.nitroT <= NITRO.duration);
  assert.ok(NITRO.boost > 1);
  hold(race, a, IN.NITRO | IN.THROTTLE);
  for (let i = 0; i < 30; i++) rally.step(race, race.tick + 1, []);
  assert.equal(a.nitro, 0, 'and holding the button does not conjure another');
});

test('weapons: the bot only pulls the trigger on a shot that would land', () => {
  const race = match(2);
  const [a, b] = race.cars;
  put(race, a, 200); put(race, b, 212);
  armCar(a); armCar(b);
  aimAt(a, b.c.x, b.c.z);
  settle(race);
  assert.equal(inKillCone(race, a, b, race.tick), true);
  a.c.yaw += 0.8;
  assert.equal(inKillCone(race, a, b, race.tick), false, 'pointing somewhere else is not a shot');
});
