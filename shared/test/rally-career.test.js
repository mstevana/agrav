// The record behind a driver: what a race pays, what the mechanic takes first,
// and what the ladder costs. All of it pure, so none of this needs a server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import career from '../rally/career.js';
import { summary, tradeInValue, prizeFor } from '../rally/career.js';
import { CARS, carStats, upgradesSpent } from '../rally/cars.js';
import { PRIZE, WEAPONS, BUMPER } from '../rally/constants.js';

const fresh = (over = {}) => ({ ...career.create(), ...over });
const result = (rows, mult = 1) => ({ order: rows, prizeMultiplier: mult, laps: 2, byElimination: false });
const row = (over = {}) => ({
  id: 0, place: 1, finished: true, eliminated: false, kills: 0, cash: 0,
  hull: 200, maxHull: 260, bestLap: 50, ...over
});

test('career: a driver nobody has seen starts in the beetle with the free gun', () => {
  const c = career.create();
  assert.equal(c.money, 0);
  assert.equal(c.car, CARS[0].id);
  assert.equal(c.hull, CARS[0].hull, 'and a car in one piece');
  assert.deepEqual(c.weapons, ['machinegun']);
  assert.equal(CARS[0].price, 0, 'the starter car is not something you buy');
});

test('career: a broken record still plays', () => {
  const c = career.normalize({ money: -50, car: 'nonsense', upgrades: { speed: 99 }, hull: 1e9, weapons: ['railgun'], weapon: 'railgun' });
  assert.equal(c.money, 0);
  assert.equal(c.car, CARS[0].id);
  assert.equal(c.upgrades.speed, 4, 'clamped to the top of the range, not thrown away');
  assert.equal(c.hull, carStats(c.car, c.upgrades).maxHull);
  assert.deepEqual(c.weapons, ['machinegun']);
  assert.equal(c.weapon, 'machinegun');
  assert.deepEqual(career.normalize(null), career.create());
});

test('career: nothing is for sale while the car is damaged', () => {
  const hurt = fresh({ money: 99999, hull: 40 });
  for (const action of [{ action: 'upgrade', stat: 'speed' }, { action: 'buyBumper' },
                        { action: 'buyWeapon', weapon: 'shotgun' }, { action: 'buyCar', car: 'stiletto' }]) {
    assert.equal(career.apply(hurt, action).error, 'repair-first', `${action.action} should wait for the mechanic`);
  }
  const fixed = career.apply(hurt, { action: 'repair' }).career;
  assert.equal(fixed.hull, summary(fixed).maxHull);
  assert.ok(career.apply(fixed, { action: 'upgrade', stat: 'speed' }).career, 'and then it is open');
});

test('career: the repair bill is the damage times the car’s rate', () => {
  const c = fresh({ money: 5000, hull: 160 });
  const s = summary(c);
  assert.equal(s.repairCost, Math.ceil((s.maxHull - 160) * CARS[0].repairRate));
  const after = career.apply(c, { action: 'repair' }).career;
  assert.equal(after.money, 5000 - s.repairCost);
  assert.equal(after.hull, s.maxHull);
  assert.equal(career.apply(after, { action: 'repair' }).error, 'no-damage');
});

test('career: a driver with almost nothing still gets what they can pay for', () => {
  const broke = fresh({ money: 30, hull: 10 });
  const out = career.apply(broke, { action: 'repair' });
  assert.ok(out.career, 'they are never stranded with an unrepairable car');
  assert.ok(out.career.hull > 10 && out.career.hull < summary(broke).maxHull, 'partly fixed');
  assert.ok(out.career.money >= 0 && out.career.money < 30);
  assert.equal(career.apply(fresh({ money: 0, hull: 10 }), { action: 'repair' }).error, 'funds');
});

test('career: upgrades are bought per car, and armour fits the plating there and then', () => {
  let c = fresh({ money: 99999 });
  const before = summary(c).maxHull;
  c = career.apply(c, { action: 'upgrade', stat: 'armour' }).career;
  assert.equal(c.upgrades.armour, 1);
  assert.ok(summary(c).maxHull > before);
  assert.equal(c.hull, summary(c).maxHull, 'the new plating comes fitted, not as damage');

  for (let i = 0; i < 4; i++) c = career.apply(c, { action: 'upgrade', stat: 'speed' }).career || c;
  assert.equal(c.upgrades.speed, 4);
  assert.equal(career.apply(c, { action: 'upgrade', stat: 'speed' }).error, 'maxed');
  assert.equal(career.apply(c, { action: 'upgrade', stat: 'nonsense' }).error, 'unknown');
});

test('career: buying a car trades the old one in and starts the new one stock', () => {
  let c = fresh({ money: 99999 });
  c = career.apply(c, { action: 'upgrade', stat: 'speed' }).career;
  c = career.apply(c, { action: 'upgrade', stat: 'handling' }).career;
  c = career.apply(c, { action: 'buyBumper' }).career;
  const spent = upgradesSpent(c.car, c.upgrades);
  const value = tradeInValue(c);
  assert.equal(value, Math.round(CARS[0].price * 0.5 + spent * 0.25), 'half the car and a quarter of the upgrades');

  const money = c.money;
  const want = CARS.find(x => x.id === 'stiletto');
  const after = career.apply(c, { action: 'buyCar', car: 'stiletto' }).career;
  assert.equal(after.car, 'stiletto');
  assert.equal(after.money, money - (want.price - value));
  assert.deepEqual(after.upgrades, { speed: 0, handling: 0, armour: 0 }, 'the upgrades stayed with the old car');
  assert.equal(after.bumper, false, 'and so did the spikes');
  assert.equal(after.hull, carStats('stiletto', {}).maxHull, 'the new one is whole');
  assert.equal(career.apply(after, { action: 'buyCar', car: 'stiletto' }).error, 'owned');
});

test('career: weapons are bought once and kept whatever you drive', () => {
  let c = fresh({ money: 99999 });
  assert.equal(career.apply(c, { action: 'selectWeapon', weapon: 'minigun' }).error, 'not-owned');
  c = career.apply(c, { action: 'buyWeapon', weapon: 'minigun' }).career;
  assert.ok(c.weapons.includes('minigun'));
  assert.equal(c.weapon, 'minigun', 'and it goes straight on the car');
  assert.equal(c.money, 99999 - WEAPONS.minigun.price);
  assert.equal(career.apply(c, { action: 'buyWeapon', weapon: 'minigun' }).error, 'owned');

  c = career.apply(c, { action: 'buyCar', car: 'warden' }).career;
  assert.ok(c.weapons.includes('minigun'), 'a new car does not cost you your guns');
  c = career.apply(c, { action: 'selectWeapon', weapon: 'machinegun' }).career;
  assert.equal(c.weapon, 'machinegun');
});

test('career: money never goes anywhere it should not', () => {
  const poor = fresh({ money: 10 });
  assert.equal(career.apply(poor, { action: 'upgrade', stat: 'speed' }).error, 'funds');
  assert.equal(career.apply(poor, { action: 'buyCar', car: 'valkyrie' }).error, 'funds');
  assert.equal(career.apply(poor, { action: 'buyWeapon', weapon: 'shotgun' }).error, 'funds');
  assert.equal(career.apply(poor, { action: 'buyBumper' }).error, 'funds');
  assert.equal(career.apply(poor, { action: 'nonsense' }).error, 'unknown');
  assert.equal(poor.money, 10, 'and nothing was taken on the way');
  assert.ok(BUMPER.price > 0);
});

test('career: a race pays for the place, the kills and whatever was on the road', () => {
  const c = fresh();
  const after = career.settle(c, result([row({ place: 2, kills: 3, cash: 210, hull: 150 })]), 0, {});
  assert.equal(after.money, PRIZE.place[1] + 3 * PRIZE.kill + 210);
  assert.equal(after.hull, 150, 'and the damage comes home with it');
  assert.equal(after.races, 1);
  assert.equal(after.seconds, 1);
  assert.equal(after.kills, 3);
  assert.equal(after.bestLap, 50);
});

test('career: an exploded car earns what it took, not what it placed', () => {
  const c = fresh();
  const wrecked = career.settle(c, result([row({ place: 4, eliminated: true, finished: false, kills: 2, cash: 100, hull: 0 })]), 0, {});
  assert.equal(wrecked.money, 2 * PRIZE.kill + 100, 'no place money for a car that did not come home');
  assert.equal(wrecked.hull, 0, 'and it comes home at nothing');

  // still out there when the flag fell, but alive: that does pay
  const alive = career.settle(c, result([row({ place: 4, finished: false, eliminated: false, hull: 90 })]), 0, {});
  assert.equal(alive.money, PRIZE.place[3]);
});

test('career: the track and the bots both multiply the prize', () => {
  const c = fresh();
  const rich = career.settle(c, result([row({ place: 1, kills: 1 })], 1.6 * 1.3), 0, {});
  const plain = career.settle(c, result([row({ place: 1, kills: 1 })], 1), 0, {});
  assert.ok(rich.money > plain.money);
  assert.equal(rich.money, Math.round(PRIZE.place[0] * 2.08) + Math.round(PRIZE.kill * 2.08));
  assert.equal(prizeFor(row({ place: 1 }), 2).place, PRIZE.place[0] * 2);
  assert.equal(prizeFor(row({ place: 1, eliminated: true, finished: false }), 2).place, 0);
});

test('career: settling a race the driver was not in changes nothing', () => {
  const c = fresh({ money: 500 });
  assert.deepEqual(career.settle(c, result([row({ id: 4 })]), 0, {}), career.normalize(c));
});

test('career: the summary prices everything the garage puts on a button', () => {
  const s = summary(fresh({ money: 3000 }));
  assert.equal(s.healthy, true);
  assert.equal(s.repairCost, 0);
  assert.equal(s.cars.find(c => c.id === CARS[0].id).owned, true);
  assert.ok(s.cars.every(c => c.cost >= 0), 'a trade-in never makes a car free money');
  assert.ok(s.weapons.find(w => w.id === 'machinegun').owned);
  assert.equal(s.weapons.find(w => w.id === 'minigun').owned, false);
  assert.equal(s.upgrades.speed.level, 0);
  assert.ok(s.upgrades.speed.price > 0);
  const maxed = summary(fresh({ upgrades: { speed: 4, handling: 4, armour: 4 } }));
  assert.equal(maxed.upgrades.speed.price, null, 'a maxed stat has no price');
});

test('career: the ladder is reachable on the three paths the brief describes', () => {
  // A coarse check that the prizes and the prices are in the same world as each
  // other: five wins, ten seconds or fifteen starts should each pay for the
  // climb. tools/rallysim.js --career races it properly, with repairs.
  const top = CARS[CARS.length - 1];
  const ladderCost = CARS.slice(1).reduce((total, car, i) => {
    const previous = CARS[i];
    return total + car.price - Math.round(previous.price * 0.5);
  }, 0);
  const wins = 5 * PRIZE.place[0];
  const seconds = 10 * PRIZE.place[1];
  const starts = 15 * (PRIZE.place.slice(1).reduce((a, b) => a + b, 0) / 5);
  for (const [name, money] of [['five wins', wins], ['ten seconds', seconds], ['fifteen starts', starts]]) {
    assert.ok(money > ladderCost * 0.75,
      `${name} pays ${Math.round(money)}, which is nowhere near the ${ladderCost} the ladder costs`);
    assert.ok(money > top.price, `${name} should at least cover the ${top.name} outright`);
  }
  assert.ok(PRIZE.place[0] > PRIZE.place[1] && PRIZE.place[1] > PRIZE.place[5], 'and winning still pays best');
});
