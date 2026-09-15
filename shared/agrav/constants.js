// ============================================================================
// AGRAV tunables. Everything the balance passes touch lives here.
// ============================================================================

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 30;

export const GRAVITY = 30;              // m/s², arcade-heavy so jumps land fast
export const ASSIST = 1.6;              // 1/s: with no steering input the heading relaxes toward the track (pilot assist)
export const HOVER_HEIGHT = 1.4;        // visual ride height (rendering only)
export const COUNTDOWN_SEC = 3;
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
  restitution: 0.5,
  hardHit: 14,            // m/s relative: above this both take damage
  damage: 6
});

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

export const HITSCAN_REWIND_TICKS = 6;   // ~100 ms: what the shooter saw when they pulled the trigger
export const HISTORY_TICKS = 16;

export const GRID = Object.freeze({ rows: 6, cols: 2, rowGap: 9, colGap: 5.5, backFromLine: 14 });

/** phase bytes in the snapshot header */
export const PHASE = Object.freeze({ LOBBY: 0, COUNTDOWN: 1, RACING: 2, FINISHED: 3 });

/** vehicle flag bits in snapshots */
export const VF = Object.freeze({
  GROUNDED: 1, SHIELD: 2, BOOST: 4, AIRBRAKE_L: 8, AIRBRAKE_R: 16, DEAD: 32, FINISHED: 64,
  FIRING: 128, THROTTLE: 256, SCRAPE: 512, DISCONNECTED: 1024, BOT: 2048
});
