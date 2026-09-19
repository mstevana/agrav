// ============================================================================
// Scrap Rally tuning. Metres, seconds, radians throughout.
//
// The world is the ground plane (x, z) of the same right-handed, y-up space the
// track ribbon is built in, so a car's position is directly a world position and
// the ribbon is only ever a reference for progress, walls and the racing line.
//
// Heading: yaw is measured as atan2(forward.x, forward.z), the same convention
// shared/sim/spline.js uses, so a frame's heading and a car's are comparable.
// A frame's `right` is the driver's right (tracks are authored east-positive and
// mirrored at load, exactly as AGRAV's are), and because of that basis
// INCREASING YAW TURNS LEFT. Steering is stated the human way — +1 is right —
// and the one sign flip lives in stepCar.
// ============================================================================

export const TICK_RATE = 60;
export const SNAPSHOT_RATE = 30;
export const DT = 1 / TICK_RATE;

export const PHASE = Object.freeze({ LOBBY: 0, COUNTDOWN: 1, RACING: 2, FINISHED: 3 });

/** the race clock */
export const COUNTDOWN_SEC = 4;      // 3, 2, 1, GO
export const GRID_HOLD_SEC = 8;      // the grid waits this long at most for every client to build its scene
export const FINISH_GRACE_SEC = 20;  // after the first car home, the rest have this long to finish for placing
export const RESULTS_HOLD_SEC = 6;   // the camera lingers before the room shows results
export const ELIM_BANNER_SEC = 3;    // "last driver standing" before the same results

/** how the grid is laid out behind the line */
export const GRID = Object.freeze({
  cols: 2,
  colGap: 4.2,       // metres between the two columns, centre to centre
  rowGap: 9,         // metres between rows
  backFromLine: 14   // the front row sits this far behind s = 0
});

/** the car model */
export const CAR = Object.freeze({
  radius: 1.9,             // collision circle; a car is about 4.2 m long and 2 m wide
  reverseFraction: 0.32,   // reverse top speed, as a share of forward top speed
  brakeDecel: 26,          // m/s^2 while braking and still rolling forward
  rollingDrag: 0.045,      // linear drag (1/s): what a car off the throttle loses
  /** the quadratic term is scaled per car so every one of them pulls hard right up
      to its own top speed and would run out of breath just beyond it */
  dragTerminal: 1.2,       // terminal speed, as a multiple of the car's top speed
  coastDrag: 0.3,          // that term is mostly the engine's, so lifting off keeps only this much of it
  reverseAccel: 7,         // m/s^2 backwards once stopped with the brake held
  /** steering authority against speed: none at rest, full by turnFullSpeed, fading at the top end */
  turnFullSpeed: 11,
  highSpeedTurnPenalty: 0.62,
  /** lateral grip: how fast sideways velocity is scrubbed off (1/s) */
  slideThreshold: 6.5,     // sideways speed above which the tyres let go
  slideGripFactor: 0.34,   // grip retained while sliding
  /** a car that is sliding steers a little less sharply */
  slideTurnFactor: 0.82
});

/** walls, obstacles and each other */
export const CONTACT = Object.freeze({
  restitution: 0.28,
  friction: 0.22,          // share of the relative tangential speed scrubbed off in a swipe
  loss: 0.16,              // share of speed lost in a hard bump
  wallRestitution: 0.42,
  wallFriction: 0.55,      // a wall scrubs far more speed than another car does
  hardHit: 16,             // closing speed (m/s) above which a bump is a ram, not a nudge
  cooldownTicks: 30,       // two cars pressed together hurt each other at most this often
  ramDamage: 7,            // hull off each car in a ram, before bumpers and mass
  /** walls */
  scrapeSpeed: 2.5,        // sliding along a wall faster than this scrapes
  scrapeDamagePerSec: 5,
  wallHardSpeed: 10,       // hitting a wall this hard costs hull in one go
  wallDamagePerSpeed: 0.8,
  /** a wreck is a burnt shell: it blocks the road, but takes less of it */
  wreckRadiusFactor: 0.6
});

/** how much of a nudge is a hit: the share of speed a car keeps after taking one */
export const HIT_SLOW = Object.freeze({
  wall: 0.82, ram: 0.9, bullet: 0.995, pellet: 0.99, mine: 0.6
});

/** money, before the track and bot-difficulty multipliers */
export const PRIZE = Object.freeze({
  place: [600, 350, 200, 60, 60, 60],   // by finishing position, 1st first
  kill: 75,
  cashMin: 50, cashMax: 150
});

/** bot difficulty: how well they drive, and what the race is therefore worth */
export const BOT_DIFFICULTY = Object.freeze({
  easy:   { skill: 0.78, prize: 0.6 },
  normal: { skill: 0.94, prize: 1.0 },
  hard:   { skill: 1.08, prize: 1.3 }
});
export const DIFFICULTY_IDS = Object.freeze(Object.keys(BOT_DIFFICULTY));

/** bot driving */
export const BOT = Object.freeze({
  lookaheadBase: 22,       // metres ahead the bot aims, at rest
  lookaheadPerSpeed: 0.95, // plus this many metres per m/s
  steerGain: 1.9,
  cornerLook: 70,          // metres of track it reads ahead when deciding to brake
  brakeMargin: 1.0,        // how far over the corner's speed limit it will still carry
  gripUse: 0.5,            // the share of the tyres' lateral limit it plans to use
  laneSpread: 0.30,        // share of the half-width the bots' private lanes spread over
  lineInside: 0.45,        // how far toward the inside of a bend the aim point moves
  laneLimit: 0.8,          // the aim point never goes nearer a barrier than this share of the room
  wallNear: 0.62,          // closer to the barrier than this share of the road, and it starts easing off
  wallPush: 0.9,           // how hard it eases off
  watchTicks: 120,         // the stuck watchdog looks at how far it got in this many ticks
  watchProgress: 6,        // fewer metres of lap than this means it is wedged on something
  reverseTicks: 50,
  avoidLook: 26,           // metres ahead it watches for a wreck or an obstacle
  avoidGain: 1.5,
  avoidMax: 5.5            // metres the aim point may be shoved aside, however crowded it gets
});

/** the flags packed into each car's snapshot record */
export const CF = Object.freeze({
  THROTTLE: 1, BRAKE: 2, SLIDING: 4, DEAD: 8, FINISHED: 16,
  BOT: 32, DISCONNECTED: 64, REVERSING: 128, NITRO: 256, FIRING: 512, SCRAPE: 1024
});
