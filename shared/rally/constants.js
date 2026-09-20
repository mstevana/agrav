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
export const CEASEFIRE_SEC = 5;      // guns are cold for this long after the flag, so the grid is a race first
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
  /** how hard a surface a car is pressed against takes its speed away, in m/s^2 */
  scrubRate: 34,
  scrubFullPress: 9,       // the press, in m/s, at which that is applied in full
  /** and the nudge out of anything a car has ended up inside */
  separate: 2.6,           // m/s, at most
  separateGain: 7,         // per metre of overlap
  hardHit: 16,             // closing speed (m/s) above which a bump is a ram, not a nudge
  cooldownTicks: 30,       // two cars pressed together hurt each other at most this often
  ramDamage: 11,            // hull off each car in a ram, before bumpers and mass
  /** walls */
  scrapeSpeed: 2.5,        // sliding along a wall faster than this scrapes
  scrapeDamagePerSec: 8,
  wallHardSpeed: 10,       // hitting a wall this hard costs hull in one go
  wallDamagePerSpeed: 1.3,
  /** a wreck is a burnt shell: it blocks the road, but takes less of it */
  wreckRadiusFactor: 0.6,
  /** and it settles aside until at least this much road is open past everything */
  wreckMinLane: 6.5
});

/** how much of a nudge is a hit: the share of speed a car keeps after taking one */
export const HIT_SLOW = Object.freeze({
  wall: 0.82, ram: 0.9, bullet: 0.995, pellet: 0.99, mine: 0.6
});

/**
 * Money, before the track and bot-difficulty multipliers.
 *
 * The scale is set by the ladder the brief describes: a driver reaches the
 * elite car after about five wins, ten second places, or fifteen starts without
 * one. That is a target for these numbers and the prices in cars.js, not a rule
 * anywhere in the code — tools/rallysim.js --career walks all three paths and
 * says where they end up.
 */
export const PRIZE = Object.freeze({
  place: [4400, 2500, 2100, 1900, 1800, 1700],   // by finishing position, 1st first
  kill: 175,
  cashMin: 80, cashMax: 220
});

/**
 * Bot difficulty: how well they drive, and what the race is therefore worth.
 *
 * `skill` is the share of the corner speed the car is actually capable of that
 * the bot is willing to carry, so it tops out at one. Pushing it past that does
 * not make a faster bot, it makes one that arrives at the barrier sooner — which
 * is exactly what the first attempt at a "hard" setting did.
 */
export const BOT_DIFFICULTY = Object.freeze({
  easy:   { skill: 0.66, prize: 0.6 },
  normal: { skill: 0.85, prize: 1.0 },
  hard:   { skill: 1.00, prize: 1.3 }
});
export const DIFFICULTY_IDS = Object.freeze(Object.keys(BOT_DIFFICULTY));

/** bot driving */
export const BOT = Object.freeze({
  lookaheadBase: 22,       // metres ahead the bot aims, at rest
  lookaheadPerSpeed: 0.95, // plus this many metres per m/s
  steerGain: 1.9,
  crossGain: 2.2,          // how urgently it closes on the lane it wants
  crossScale: 1.0,
  crossFloor: 6,           // the speed the cross-track term is divided by, at least
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
  reverseTicks: 120,
  reverseClear: 1.4,       // metres of daylight that count as free of a blocker
  reverseHold: 180,        // ticks the reverse clock can be held while still touching one
  avoidLook: 26,           // metres ahead it watches for a wreck or another car
  obstacleLook: 55,        // metres ahead it starts choosing its way past what is parked there
  behindClear: 9,          // metres back at which something stops being in the way
  clusterSpan: 22,         // blockers within this of the nearest are one decision
  gapMargin: 0.9,          // how far inside the edges of a gap it will actually go
  gapReach: 0.15,          // a mild preference for the gap nearest the car
  gapCross: 3.0,           // and a strong dislike of one on the far side of a wreck
  yieldFrom: 0.45,         // how close the narrowing has to be before it will give way
  yieldAlong: 7,           // metres of overlap that count as level with somebody
  yieldAcross: 4.4,        // and how far to the side still counts as in the way
  yieldSpeed: 16,          // above this it brakes to drop back; below it just lifts
  yieldMinSpeed: 9,        // and below this it does not give way at all, it drives
  avoidGain: 1.5,
  avoidMax: 5.5,           // metres the aim point may be shoved aside, however crowded it gets
  padNear: 12,             // a pad nearer than this is already behind the decision
  padLook: 110,            // and further than this is somebody else's problem
  padPull: 0.75,           // how much of the way to the pad the aim point moves
  mineBehind: 14,          // drop one when a chaser is this close
  mineCooldown: 420,       // and not again for seven seconds
  nitroStraight: 0.004     // curvature flat enough to be worth a bottle on
});

/**
 * The three primaries. All hitscan, all fixed forward: a car aims by pointing.
 * `price` is what the garage charges; the machine gun comes with the licence.
 */
export const WEAPONS = Object.freeze({
  machinegun: {
    id: 'machinegun', name: 'Machine gun', price: 0,
    ammo: 320, rate: 9, damage: 1.7, range: 95, spread: 0.014, pellets: 1,
    blurb: 'Accurate, endless and unexciting. It will get the job done from anywhere.'
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun', price: 1600,
    ammo: 44, rate: 1.5, damage: 2.0, range: 34, spread: 0.13, pellets: 6,
    blurb: 'Six pellets and a very short conversation. Useless past a car length or three.'
  },
  minigun: {
    id: 'minigun', name: 'Minigun', price: 3400,
    ammo: 640, rate: 19, damage: 1.15, range: 78, spread: 0.055, pellets: 1, spinUp: 0.4,
    blurb: 'Takes a moment to wind up, then removes an entire car if you can hold it on one.'
  }
});

/** mines: free, three a race, and no respecter of whose they are */
export const MINE = Object.freeze({
  perRace: 3,
  armSec: 0.5,
  dropBack: 1.6,
  radius: 1.5,
  blastRadius: 5.5,
  falloff: 0.8,            // how much of the damage the edge of the blast loses
  damage: 34
});

export const NITRO = Object.freeze({ duration: 2.5, boost: 1.4, maxCharges: 3 });

/** the spiked bumper, bought per car */
export const BUMPER = Object.freeze({ price: 1400, dealt: 3, taken: 0.5 });

/** what a shot is scored against: where everyone was when the trigger came down */
export const HITSCAN_REWIND_TICKS = 6;      // about 100 ms
export const HISTORY_TICKS = 24;

/** pickup pads */
export const PAD = Object.freeze({
  radius: 3.2,
  respawnSec: 20,
  ammoShare: 0.25,        // a refill is this much of the weapon's capacity
  repair: 80,
  cashEverySec: 14,       // a cash drop appears on some free pad about this often
  cashLifeSec: 16
});

/** the flags packed into each car's snapshot record */
export const CF = Object.freeze({
  THROTTLE: 1, BRAKE: 2, SLIDING: 4, DEAD: 8, FINISHED: 16,
  BOT: 32, DISCONNECTED: 64, REVERSING: 128, NITRO: 256, FIRING: 512, SCRAPE: 1024
});
