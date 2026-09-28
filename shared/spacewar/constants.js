// Arena geometry and physics tuning for Spacewar.
// Coordinates are logical pixels on a 16:9 torus: y points DOWN (canvas order) and
// anything leaving one edge comes back in at the opposite one. Angles are radians,
// 0 pointing right, growing clockwise on screen. Shared by the server, the bots and
// the browser client.

export const FIELD_W = 1600;
export const FIELD_H = 900;
export const CX = FIELD_W / 2;
export const CY = FIELD_H / 2;

export const TICK_RATE = 60;
export const SNAPSHOT_RATE = 30;
export const DT = 1 / TICK_RATE;
export const MAX_SHIPS = 4;

// ships
export const SHIP_R = 19;              // collision radius
export const TURN_RATE = 2.7;          // rad/s at full stick
export const THRUST = 150;             // px/s^2
export const MAX_SPEED = 360;          // px/s, hard cap
export const FUEL_MAX = 60 * 20;       // ticks of thrust per round
export const TORPS_MAX = 24;           // torpedoes per round
export const FIRE_COOLDOWN = 20;       // ticks between shots while the trigger is held

// torpedoes: straight lines, wrapping, gone after a while
export const TORP_SPEED = 340;         // px/s, added to the ship's own velocity
export const TORP_LIFE = 150;          // ticks (range stays about 850 px)
export const TORP_R = 3;
export const TORP_ARM = 12;             // ticks before a torpedo can hit the ship that fired it
export const MUZZLE = SHIP_R + 5;      // spawn distance ahead of the ship's centre

// hyperspace
export const HYPER_TICKS = 36;         // ticks spent out of the arena
export const HYPER_COOLDOWN = 60 * 5;  // ticks after re-entry before the next jump
export const HYPER_CLEAR_PLANET = 170; // re-entry keeps at least this far from the planet
export const HYPER_CLEAR_SHIP = 110;   // ... and from other ships

// the planet at the centre
export const PLANET_R = 50;
export const GRAVITY = 2.6e6;          // a = GRAVITY / r^2  (px/s^2)
export const GRAVITY_MIN_R = 70;       // softening: the pull stops growing inside this radius

// rounds
export const SPAWN_RING = 330;         // ships start on this circle around the centre
export const ROUND_INTRO = 120;        // ticks of "Round N" before ships are released
export const ROUND_SETTLE = 100;        // ticks play goes on once one ship is left (a torpedo may still be in flight)
export const ROUND_OUTRO = 150;        // ticks the round result is shown
export const ROUND_MAX = 60 * 120;     // a round that lasts this long is a draw
export const DRY_TIMEOUT = 60 * 12;    // ... and so is one where no survivor has a torpedo left for this long

// phase byte carried in the snapshot header (see shared/net/module-contract.md)
export const PHASE = Object.freeze({ INTRO: 0, PLAY: 1, OUTRO: 2, OVER: 3 });

export const DEFAULT_OPTIONS = Object.freeze({
  roundsToWin: 5,
  planet: true,
  botDifficulty: 'normal',
});

// one hull and one colour per seat
export const SHIPS = Object.freeze([
  { name: 'Needle', color: '#35e8ff', glow: '#00b4ff' },
  { name: 'Wedge', color: '#ff4fa3', glow: '#ff1f7a' },
  { name: 'Hornet', color: '#ffc03a', glow: '#ff8a00' },
  { name: 'Manta', color: '#7dff6a', glow: '#2fe05a' },
]);

// input bits (the wire carries {bits, steer}; steer is the turn, -1 left .. +1 right)
export const BIT = Object.freeze({ THRUST: 1, HYPER: 2, FIRE: 16 });
