// ============================================================================
// The ladder. Six cars, each bought with money and nothing else; a driver owns
// one at a time and buying the next trades the old one in.
//
// Three stats carry five levels each, bought per car: a new car starts at level
// zero. Speed moves top speed and acceleration, Handling moves grip and steering
// rate (the difference between a corner and a wall), Armour moves hull and mass
// (mass is armour, so the heavier car gives way less in a shunt).
//
// Pure data and pure functions: the garage previews a purchase with the same
// code the server uses to apply it.
// ============================================================================

export const UPGRADE_LEVELS = 5;          // levels 0..4
export const STATS = Object.freeze(['speed', 'handling', 'armour']);

/** per level above zero */
const GAIN = Object.freeze({
  speed:    { topSpeed: 0.055, accel: 0.075 },
  handling: { grip: 0.085, yawRate: 0.055 },
  armour:   { hull: 0.13, mass: 0.07 }
});

export const CARS = Object.freeze([
  {
    id: 'vagabond', name: 'Vagabond', tier: 0, price: 0, repairRate: 2.2,
    blurb: 'A rounded little beetle with a roll cage bolted through the roof.',
    topSpeed: 41, accel: 9.0, grip: 5.6, yawRate: 1.70, hull: 100, mass: 1.00,
    upgradePrice: [260, 420, 640, 920]
  },
  {
    id: 'mongrel', name: 'Mongrel', tier: 1, price: 1500, repairRate: 3.0,
    blurb: 'A flatbed pickup with plate over the doors. Slow to turn, hard to stop.',
    topSpeed: 47, accel: 10.4, grip: 6.0, yawRate: 1.62, hull: 135, mass: 1.22,
    upgradePrice: [380, 600, 900, 1300]
  },
  {
    id: 'stiletto', name: 'Stiletto', tier: 2, price: 4000, repairRate: 4.1,
    blurb: 'A stripped coupe. Quick and sharp, and made of paper.',
    topSpeed: 56, accel: 13.2, grip: 7.4, yawRate: 2.05, hull: 120, mass: 1.05,
    upgradePrice: [560, 880, 1320, 1900]
  },
  {
    id: 'warden', name: 'Warden', tier: 3, price: 7000, repairRate: 5.0,
    blurb: 'An armoured saloon that does nothing badly and one thing well: survive.',
    topSpeed: 52, accel: 11.8, grip: 7.6, yawRate: 1.92, hull: 180, mass: 1.45,
    upgradePrice: [720, 1120, 1680, 2400]
  },
  {
    id: 'behemoth', name: 'Behemoth', tier: 4, price: 11000, repairRate: 6.4,
    blurb: 'A truck cab with a blade on the front. It does not go round things.',
    topSpeed: 50, accel: 10.6, grip: 6.4, yawRate: 1.56, hull: 260, mass: 1.95,
    upgradePrice: [900, 1400, 2100, 3000]
  },
  {
    id: 'valkyrie', name: 'Valkyrie', tier: 5, price: 18000, repairRate: 8.0,
    blurb: 'The prototype nobody admits to building. Fast, planted and armoured.',
    topSpeed: 66, accel: 16.0, grip: 9.4, yawRate: 2.30, hull: 210, mass: 1.50,
    upgradePrice: [1300, 2000, 3000, 4300]
  }
]);

export const CAR_IDS = Object.freeze(CARS.map(c => c.id));
const BY_ID = new Map(CARS.map(c => [c.id, c]));

export const getCar = (id) => BY_ID.get(id) || CARS[0];
export const isCarId = (id) => BY_ID.has(id);

const clampLevel = (n) => Math.max(0, Math.min(UPGRADE_LEVELS - 1, n | 0));

/** upgrade levels as stored: missing or malformed reads as a stock car */
export function normalizeUpgrades(u) {
  return { speed: clampLevel(u?.speed), handling: clampLevel(u?.handling), armour: clampLevel(u?.armour) };
}

/**
 * What a car actually performs at, given its upgrades and whether it carries a
 * spiked bumper. Everything the simulation reads about a car comes from here.
 */
export function carStats(carId, upgrades, bumper = false) {
  const base = getCar(carId);
  const u = normalizeUpgrades(upgrades);
  const s = 1 + GAIN.speed.topSpeed * u.speed;
  const a = 1 + GAIN.speed.accel * u.speed;
  const g = 1 + GAIN.handling.grip * u.handling;
  const y = 1 + GAIN.handling.yawRate * u.handling;
  const h = 1 + GAIN.armour.hull * u.armour;
  const m = 1 + GAIN.armour.mass * u.armour;
  return {
    id: base.id, name: base.name, tier: base.tier, upgrades: u, bumper: !!bumper,
    topSpeed: base.topSpeed * s,
    accel: base.accel * a,
    grip: base.grip * g,
    yawRate: base.yawRate * y,
    maxHull: Math.round(base.hull * h),
    mass: base.mass * m,
    repairRate: base.repairRate
  };
}

/** what it costs to take a stat from its current level to the next one */
export function upgradePrice(carId, stat, level) {
  const base = getCar(carId);
  if (!STATS.includes(stat)) return null;
  const l = clampLevel(level);
  if (l >= UPGRADE_LEVELS - 1) return null;         // already maxed
  return base.upgradePrice[l];
}

/** everything sunk into one car's upgrades so far, for the trade-in */
export function upgradesSpent(carId, upgrades) {
  const base = getCar(carId);
  const u = normalizeUpgrades(upgrades);
  let total = 0;
  for (const stat of STATS) for (let l = 0; l < u[stat]; l++) total += base.upgradePrice[l];
  return total;
}

/** a tier for matchmaking and for the bots: the car plus how far it has been taken */
export function effectiveTier(carId, upgrades) {
  const base = getCar(carId);
  const u = normalizeUpgrades(upgrades);
  return base.tier + (u.speed + u.handling + u.armour) / (3 * (UPGRADE_LEVELS - 1));
}
