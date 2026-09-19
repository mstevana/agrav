// ============================================================================
// The six AGRAV craft. Each is a small deviation from a common baseline so a
// race between any two is decided by the driver; tools/balance.js keeps the
// bot lap times within a few percent of each other.
//
//   topSpeed   m/s at full throttle on the flat
//   accel      m/s² toward topSpeed
//   turnRate   rad/s of heading change at full steer, low speed
//   grip       how fast velocity follows heading (1/s); lower = more drift
//   armor      health multiplier, against BASE.hp
//   damage     weapon damage multiplier
// ============================================================================

export const BASE = Object.freeze({
  topSpeed: 92, accel: 34, turnRate: 2.3, grip: 3.2, armor: 1.0, damage: 1.0,
  // Hull of a craft with armor 1.0. Weapon damage is absolute, so this alone sets how many hits a
  // race lasts. The snapshot carries hp as a u8 that CLAMPS rather than wraps, so this times the
  // highest armor must stay under 255 (today: bulwark at 203); past that, widen the field first.
  hp: 150,
  airbrakeTurn: 1.55,     // turn-rate multiplier with one airbrake down
  airbrakeDrag: 22,       // m/s² speed bled with an airbrake down
  drag: 0.28,             // quadratic drag coefficient (fraction of topSpeed² per s)
  brake: 40,              // m/s² of braking
  length: 6.4, width: 3.2 // metres, for contact and rendering
});

export const VEHICLES = Object.freeze([
  { id: 'kestrel', name: 'KESTREL', team: 'Kestrel Dynamics', colour: 0x3fd1ff, accent: 0xffffff,
    desc: 'Fastest straight-line craft. Thin plating, weak guns.',
    topSpeed: 1.05, accel: 0.98, turnRate: 0.92, grip: 0.94, armor: 0.92, damage: 0.90 },
  { id: 'talon', name: 'TALON', team: 'Talon Aerospace', colour: 0xff8a2a, accent: 0x2b1408,
    desc: 'Explosive acceleration out of every corner. Fragile.',
    topSpeed: 0.99, accel: 1.16, turnRate: 1.00, grip: 1.05, armor: 0.90, damage: 1.00 },
  { id: 'vantage', name: 'VANTAGE', team: 'Vantage Works', colour: 0xb4ff3a, accent: 0x1b2a06,
    desc: 'Turns on a coin and holds its line. Light hull.',
    topSpeed: 0.975, accel: 1.00, turnRate: 1.10, grip: 1.12, armor: 0.92, damage: 0.96 },
  { id: 'bulwark', name: 'BULWARK', team: 'Bulwark Heavy', colour: 0x8d97a8, accent: 0xffc93a,
    desc: 'Twice the plating of anything else. Slow to wind up.',
    topSpeed: 0.975, accel: 0.96, turnRate: 1.02, grip: 1.04, armor: 1.35, damage: 1.00 },
  { id: 'reaper', name: 'REAPER', team: 'Reaper Ordnance', colour: 0xe0304a, accent: 0x14060a,
    desc: 'Every weapon hits harder. Wide turning circle.',
    topSpeed: 1.01, accel: 1.02, turnRate: 0.90, grip: 0.95, armor: 1.00, damage: 1.25 },
  { id: 'corsair', name: 'CORSAIR', team: 'Corsair Collective', colour: 0xa76bff, accent: 0xffffff,
    desc: 'No weaknesses, no edge. The honest choice.',
    topSpeed: 1.00, accel: 1.00, turnRate: 1.00, grip: 1.00, armor: 1.00, damage: 1.00 }
]);

export const VEHICLE_IDS = VEHICLES.map(v => v.id);

/** resolved absolute stats for a vehicle id (defaults to corsair) */
export function vehicleStats(id) {
  const v = VEHICLES.find(x => x.id === id) || VEHICLES[5];
  return {
    id: v.id, name: v.name, colour: v.colour, accent: v.accent,
    topSpeed: BASE.topSpeed * v.topSpeed,
    accel: BASE.accel * v.accel,
    turnRate: BASE.turnRate * v.turnRate,
    grip: BASE.grip * v.grip,
    armor: v.armor,
    damage: v.damage,
    maxHp: Math.round(BASE.hp * v.armor),
    airbrakeTurn: BASE.airbrakeTurn, airbrakeDrag: BASE.airbrakeDrag, drag: BASE.drag, brake: BASE.brake,
    length: BASE.length, width: BASE.width
  };
}
