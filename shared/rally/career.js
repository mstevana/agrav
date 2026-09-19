// ============================================================================
// A driver's record: what they own, what they owe the mechanic, and what the
// last race left them with.
//
// Every rule here is a pure function over a plain JSON object, so the garage in
// the browser can price a purchase with exactly the code the server will use to
// apply it, and the whole ladder can be driven in a test without a socket.
//
// Two rules shape everything else:
//   · Damage is persistent. The hull you finish a race with is the hull you
//     start the next one on, and an exploded car comes home at nothing.
//   · Repairs come first. While the hull is short of full, the only thing the
//     shop will sell you is the repair, so you cannot spend the prize money on
//     a bigger engine and take a wreck to the next grid.
//
// Cars are bought, and nothing else gates them. The brief's ladder — elite cars
// after about five wins, ten second places or fifteen starts — is the target
// the prizes and prices are tuned against (tools/rallysim.js --career), not a
// counter anybody has to watch.
// ============================================================================

import { CARS, CAR_IDS, getCar, carStats, upgradePrice, upgradesSpent, normalizeUpgrades, STATS, UPGRADE_LEVELS } from './cars.js';
import { WEAPONS, BUMPER, PRIZE } from './constants.js';
import { isWeaponId } from './weapons.js';

export const CAREER_VERSION = 1;
const TRADE_IN_CAR = 0.5;        // of what the old car cost
const TRADE_IN_UPGRADES = 0.25;  // of everything sunk into it

/** a driver nobody has seen before: the starter car, the free gun, no money */
export function create() {
  const car = CARS[0];
  return {
    v: CAREER_VERSION,
    money: 0,
    car: car.id,
    upgrades: { speed: 0, handling: 0, armour: 0 },
    bumper: false,
    hull: car.hull,
    weapon: 'machinegun',
    weapons: ['machinegun'],
    races: 0, wins: 0, seconds: 0, thirds: 0, kills: 0, bestLap: null, earned: 0
  };
}

/** whatever came out of the store, made sane; an old or damaged record still plays */
export function normalize(raw) {
  const base = create();
  if (!raw || typeof raw !== 'object') return base;
  const car = CAR_IDS.includes(raw.car) ? raw.car : base.car;
  const upgrades = normalizeUpgrades(raw.upgrades);
  const stats = carStats(car, upgrades, !!raw.bumper);
  const weapons = Array.isArray(raw.weapons) ? raw.weapons.filter(isWeaponId) : [];
  if (!weapons.includes('machinegun')) weapons.unshift('machinegun');
  const weapon = weapons.includes(raw.weapon) ? raw.weapon : 'machinegun';
  const num = (v, d = 0) => (Number.isFinite(+v) ? Math.max(0, Math.round(+v)) : d);
  return {
    v: CAREER_VERSION,
    money: num(raw.money),
    car, upgrades, bumper: !!raw.bumper,
    hull: Math.max(0, Math.min(stats.maxHull, Number.isFinite(+raw.hull) ? +raw.hull : stats.maxHull)),
    weapon, weapons,
    races: num(raw.races), wins: num(raw.wins), seconds: num(raw.seconds), thirds: num(raw.thirds),
    kills: num(raw.kills), earned: num(raw.earned),
    bestLap: Number.isFinite(+raw.bestLap) && +raw.bestLap > 0 ? +raw.bestLap : null
  };
}

/** the numbers the garage puts on its buttons, all derived, never stored */
export function summary(career) {
  const c = normalize(career);
  const stats = carStats(c.car, c.upgrades, c.bumper);
  const base = getCar(c.car);
  const missing = Math.max(0, stats.maxHull - c.hull);
  const repairCost = Math.ceil(missing * base.repairRate);
  const healthy = missing <= 0;
  return {
    ...c,
    stats,
    maxHull: stats.maxHull,
    repairCost,
    healthy,
    tradeIn: tradeInValue(c),
    upgrades: STATS.reduce((out, stat) => {
      const level = c.upgrades[stat];
      const price = upgradePrice(c.car, stat, level);
      out[stat] = { level, max: UPGRADE_LEVELS - 1, price, affordable: price !== null && c.money >= price };
      return out;
    }, {}),
    bumperPrice: c.bumper ? null : BUMPER.price,
    weapons: Object.values(WEAPONS).map(w => ({
      id: w.id, name: w.name, blurb: w.blurb, price: w.price,
      owned: c.weapons.includes(w.id), equipped: c.weapon === w.id,
      affordable: c.money >= w.price
    })),
    cars: CARS.map(car => ({
      id: car.id, name: car.name, blurb: car.blurb, tier: car.tier, price: car.price,
      owned: car.id === c.car,
      cost: Math.max(0, car.price - tradeInValue(c)),
      affordable: c.money >= Math.max(0, car.price - tradeInValue(c))
    }))
  };
}

/** what the old car is worth against the next one */
export function tradeInValue(career) {
  const c = normalize(career);
  return Math.round(getCar(c.car).price * TRADE_IN_CAR + upgradesSpent(c.car, c.upgrades) * TRADE_IN_UPGRADES);
}

/**
 * Spend. Returns the new record, or the reason it cannot be done — the garage
 * shows that reason rather than a dead button with no explanation.
 */
export function apply(career, action) {
  const c = normalize(career);
  const kind = action?.action;
  const base = getCar(c.car);
  const stats = carStats(c.car, c.upgrades, c.bumper);
  const missing = Math.max(0, stats.maxHull - c.hull);

  // choosing between things you already own costs nothing and is always allowed
  if (kind === 'selectWeapon') {
    if (!c.weapons.includes(action.weapon)) return { error: 'not-owned' };
    return { career: { ...c, weapon: action.weapon } };
  }
  if (kind === 'repair') {
    if (missing <= 0) return { error: 'no-damage' };
    const cost = Math.ceil(missing * base.repairRate);
    if (c.money < cost) {
      // never leave a driver stranded: what they can afford, they get
      const afford = Math.floor(c.money / base.repairRate);
      if (afford <= 0) return { error: 'funds' };
      return { career: { ...c, money: c.money - Math.ceil(afford * base.repairRate), hull: c.hull + afford } };
    }
    return { career: { ...c, money: c.money - cost, hull: stats.maxHull } };
  }

  // everything else waits for the panel beater
  if (missing > 0) return { error: 'repair-first' };

  switch (kind) {
    case 'upgrade': {
      if (!STATS.includes(action.stat)) return { error: 'unknown' };
      const price = upgradePrice(c.car, action.stat, c.upgrades[action.stat]);
      if (price === null) return { error: 'maxed' };
      if (c.money < price) return { error: 'funds' };
      const upgrades = { ...c.upgrades, [action.stat]: c.upgrades[action.stat] + 1 };
      // more armour is more hull, and the new plating comes fitted
      const after = carStats(c.car, upgrades, c.bumper);
      return { career: { ...c, money: c.money - price, upgrades, hull: after.maxHull } };
    }
    case 'buyBumper':
      if (c.bumper) return { error: 'owned' };
      if (c.money < BUMPER.price) return { error: 'funds' };
      return { career: { ...c, money: c.money - BUMPER.price, bumper: true } };
    case 'buyWeapon': {
      if (!isWeaponId(action.weapon)) return { error: 'unknown' };
      if (c.weapons.includes(action.weapon)) return { error: 'owned' };
      const price = WEAPONS[action.weapon].price;
      if (c.money < price) return { error: 'funds' };
      return { career: { ...c, money: c.money - price, weapons: [...c.weapons, action.weapon], weapon: action.weapon } };
    }
    case 'buyCar': {
      if (!CAR_IDS.includes(action.car)) return { error: 'unknown' };
      if (action.car === c.car) return { error: 'owned' };
      const want = getCar(action.car);
      const cost = Math.max(0, want.price - tradeInValue(c));
      if (c.money < cost) return { error: 'funds' };
      // a trade-in is a clean sheet: the upgrades and the spikes stayed with the old car
      return {
        career: {
          ...c, money: c.money - cost, car: want.id,
          upgrades: { speed: 0, handling: 0, armour: 0 }, bumper: false,
          hull: carStats(want.id, { speed: 0, handling: 0, armour: 0 }, false).maxHull
        }
      };
    }
    default: return { error: 'unknown' };
  }
}

/**
 * After the flag: the money, and the state the car came home in.
 *
 * Place money goes only to a car that was still running at the end. An exploded
 * one keeps what it picked up off the road and what it took off other people,
 * which is what makes racing a wreck a gamble rather than a free sixty credits.
 */
export function settle(career, results, id, opts) {
  const c = normalize(career);
  const me = results?.order?.find(o => o.id === id);
  if (!me) return c;
  const mult = results.prizeMultiplier ?? 1;
  const wrecked = !!me.eliminated && !me.finished;
  const place = Math.max(1, me.place | 0);
  const placeMoney = wrecked ? 0 : Math.round((PRIZE.place[place - 1] ?? 0) * mult);
  const killMoney = Math.round((me.kills || 0) * PRIZE.kill * mult);
  const cash = Math.max(0, me.cash | 0);
  const earned = placeMoney + killMoney + cash;
  return {
    ...c,
    money: c.money + earned,
    earned: c.earned + earned,
    hull: Math.max(0, Math.min(carStats(c.car, c.upgrades, c.bumper).maxHull, me.hull ?? c.hull)),
    races: c.races + 1,
    wins: c.wins + (place === 1 ? 1 : 0),
    seconds: c.seconds + (place === 2 ? 1 : 0),
    thirds: c.thirds + (place === 3 ? 1 : 0),
    kills: c.kills + (me.kills || 0),
    bestLap: me.bestLap && (!c.bestLap || me.bestLap < c.bestLap) ? me.bestLap : c.bestLap
  };
}

/** what one race is worth to this driver, for the results screen */
export function prizeFor(row, prizeMultiplier = 1) {
  const wrecked = !!row.eliminated && !row.finished;
  const place = wrecked ? 0 : Math.round((PRIZE.place[(row.place | 0) - 1] ?? 0) * prizeMultiplier);
  const kills = Math.round((row.kills || 0) * PRIZE.kill * prizeMultiplier);
  return { place, kills, cash: Math.max(0, row.cash | 0), total: place + kills + Math.max(0, row.cash | 0) };
}

export default { create, normalize, apply, settle, summary, tradeInValue, prizeFor };
