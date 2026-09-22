// ============================================================================
// AGRAV tunables. Everything the balance passes touch lives here.
// ============================================================================

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 30;

export const GRAVITY = 30;              // m/s², arcade-heavy so jumps land fast
export const ASSIST = 1.6;              // 1/s: with no steering input the heading relaxes toward the track (pilot assist)
export const HOVER_HEIGHT = 1.4;        // visual ride height (rendering only)
export const COUNTDOWN_SEC = 4;       // 3, 2, 1, 0 — one second each
export const GRID_HOLD_SEC = 8;       // the longest the grid waits for slow clients to load before counting down anyway
export const FINISH_GRACE_SEC = 45;     // race ends this long after the first finisher
export const RESULTS_HOLD_SEC = 12;     // results shown before the room returns to the lobby

export const WALL = Object.freeze({
  bounce: 0.35,           // lateral velocity retained (inverted) on impact
  hardHit: 9,             // m/s lateral: above this a hit costs speed and health
  speedLoss: 0.86,        // fraction of forward speed kept on a hard hit
  damagePerMs: 0.5,       // hp per (m/s) of lateral impact above hardHit
  maxHitDamage: 18,       // one impact never costs more than this
  scrapePerSec: 4,        // hp/s while pressed into a wall
  scrapeSlow: 0.985       // per-tick speed multiplier while scraping
});

export const CONTACT = Object.freeze({
  restitution: 0.35,      // bounce: craft are hovering hulls, not billiard balls
  friction: 0.3,          // how much of the sliding velocity a contact scrubs off
  loss: 0.035,            // speed lost per hard bump (fraction, scaled by impact speed / 20)
  spin: 0.012,            // yaw kick per m/s of longitudinal slip in a side swipe (rad)
  hardHit: 14,            // m/s relative: above this both take damage
  damage: 6,
  cooldownTicks: 30,      // the same pair cannot trade ram damage again for half a second
  // How long a contact keeps being announced to the client after the hulls part. A contact is the
  // one thing the local craft cannot predict -- it does not know where the others really are -- so
  // the server flags it and the prediction leans on the authoritative velocity while it holds.
  holdTicks: 14
});

/** a weapon hit bleeds speed: the victim's longitudinal and lateral velocity are scaled by this */
export const HIT_SLOW = Object.freeze({ rocket: 0.86, missile: 0.8, mine: 0.72, minigun: 0.988, ram: 1, wall: 1, landing: 1 });

export const LANDING = Object.freeze({ hard: 14, speedLoss: 0.92, damageAbove: 24, damagePerMs: 0.8 });

/** items: id, byte code, pickup weights per position tier (leader..trailer) */
export const ITEMS = Object.freeze({
  none:    { code: 0 },
  rocket:  { code: 1, ammo: 3, w: [3, 3, 3] },
  missile: { code: 2, ammo: 1, w: [1, 3, 5] },
  minigun: { code: 3, ammo: 1, w: [4, 3, 2] },
  mines:   { code: 4, ammo: 3, w: [5, 2, 1] },
  health:  { code: 5, ammo: 1, w: [3, 4, 4] },
  shield:  { code: 6, ammo: 1, w: [1, 3, 5] },
  speed:   { code: 7, ammo: 1, w: [2, 3, 4] }
});
export const ITEM_BY_CODE = Object.freeze(Object.fromEntries(Object.entries(ITEMS).map(([k, v]) => [v.code, k])));

export const WEAPON = Object.freeze({
  rocket:  { speed: 95, life: 3.0, damage: 16, hitDs: 5, hitDt: 2.8, refire: 0.22 },
  missile: { speed: 55, life: 7.0, damage: 26, hitDs: 5, hitDt: 3.0, turnRate: 2.6, lockRange: 260, lockAngle: 0.45, acquireAhead: true },
  minigun: { burst: 2.0, interval: 0.1, damage: 2.5, range: 150, cone: 0.09, spread: 2.2 },
  mines:   { life: 30, arm: 0.6, radius: 3.4, damage: 20, ownerImmune: 2.0, dropGap: 0.28, dropBehind: 4 },
  health:  { amount: 40 },
  shield:  { duration: 5.0 },
  speed:   { duration: 3.0, mult: 1.35 }
});

export const PAD = Object.freeze({ radiusS: 3.5, radiusT: 2.6, respawnSec: 6 });

/** bot driving and gunnery. tools/balance.js is the gate on anything here that costs lap time. */
/**
 * How well the bots drive, chosen per room. `skill` is the dial bot.js already had: how far ahead
 * it aims, how late it brakes, how hard it steers and how much it leads a shot. `noise` wanders
 * the line it wants. `pace` is the share of the craft it will use, which is what actually sets a
 * bot's lap time -- skill only buys a tidier line, since a bot is on full throttle except when a
 * corner makes it brake. `normal` is exactly the bot everyone had before the setting existed.
 *
 * Medium is therefore already using all of the craft, so hard cannot be faster on pace. What it
 * gets instead is a better craft than the one in your hands: `speed` scales its top speed, `accel`
 * how hard it winds up out of a corner, and `turn` both its turn rate and its grip, so it carries
 * more through a bend and straightens earlier. That is deliberate, and the only thing hard adds
 * beyond a tidier line. Anything but 1.00 here is a bot-only edge, so keep the list short and the
 * numbers honest -- a human never sees these.
 */
export const BOT_DIFFICULTY = Object.freeze({
  easy:   { pace: 0.82, skill: 0.76, noise: 0.30, speed: 1.00, accel: 1.00, turn: 1.00 },
  normal: { pace: 1.00, skill: 0.85, noise: 0.20, speed: 1.00, accel: 1.00, turn: 1.00 },
  hard:   { pace: 1.00, skill: 0.92, noise: 0.12, speed: 1.05, accel: 1.18, turn: 1.12 }
});
export const DIFFICULTY_IDS = Object.freeze(Object.keys(BOT_DIFFICULTY));

export const BOT = Object.freeze({
  padLook: 150,       // m ahead a bot will consider a weapon pad
  padNear: 0,         // the seek holds until the pad is passed, not abandoned just short of it
  padClose: 30,       // m: inside this the line commits fully to the pad lane
  padCorner: 0.35,    // how much of the pull survives while an airbrake is down (none while braking)
  gunRange: 150,      // m: the furthest a bot looks for something to shoot at
  rocketRange: 120,   // m: beyond this an unguided bolt is a waste
  rocketMargin: 1.6,  // m of slack on the lead-predicted lateral error before a rocket is worth it
  aimBias: 2.5,       // m the line target is pulled toward a victim to line a shot up
  dodgeRocket: 60,    // m: a rocket this close behind is worth a shield
  dodgeMine: 25       // m: an armed mine this close ahead is worth a shield
});

export const HITSCAN_REWIND_TICKS = 6;   // ~100 ms: what the shooter saw when they pulled the trigger
export const HISTORY_TICKS = 16;

export const GRID = Object.freeze({ rows: 6, cols: 2, rowGap: 9, colGap: 5.5, backFromLine: 14 });

/** phase bytes in the snapshot header */
export const PHASE = Object.freeze({ LOBBY: 0, COUNTDOWN: 1, RACING: 2, FINISHED: 3 });

/** vehicle flag bits in snapshots */
export const VF = Object.freeze({
  GROUNDED: 1, SHIELD: 2, BOOST: 4, AIRBRAKE_L: 8, AIRBRAKE_R: 16, DEAD: 32, FINISHED: 64,
  FIRING: 128, THROTTLE: 256, SCRAPE: 512, DISCONNECTED: 1024, BOT: 2048, CONTACT: 4096
});
