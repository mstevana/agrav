// Bot players for Volley. A bot looks at the authoritative state and returns the same
// {left, right, jump} input a human would send, so the simulation never knows the difference.

import {
  NET_X, BALL_R, BLOB_UPPER_Y, BLOB_UPPER_R, BLOB_HEIGHT, BLOB_SPEED, BLOB_JUMP_V, BLOB_FLOAT_GRAVITY, DT,
} from './constants.js';
import { stepBallFree } from './sim.js';

/** Tiny deterministic PRNG so bot behaviour is reproducible in tests. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REACH_Y = BLOB_UPPER_Y + BLOB_UPPER_R + BALL_R; // ball centre height when it meets a standing blob's head

/**
 * Where will the ball be when it next falls through height `targetY`?
 * Simulates the free ball (walls, ceiling, net, no blobs) up to `maxTicks` ahead and
 * reports the first downward crossing of `targetY` (or the ground, whichever comes first).
 * Returns {x, y, ticks, side} or null if it does not happen in time.
 */
export function predictLanding(ball, maxTicks = 240, targetY = REACH_Y) {
  const b = { ...ball };
  for (let t = 1; t <= maxTicks; t++) {
    const prevY = b.y;
    stepBallFree(b, DT);
    const crossed = b.vy < 0 && b.y <= targetY && prevY > targetY;
    if (crossed || b.y <= BALL_R) {
      return { x: b.x, y: b.y, ticks: t, side: b.x < NET_X ? 0 : 1 };
    }
  }
  return null;
}

/** How high a blob's head is `ticks` after take-off while holding jump. */
function jumpHeightAfter(ticks) {
  const t = ticks * DT;
  return Math.max(0, BLOB_JUMP_V * t - 0.5 * BLOB_FLOAT_GRAVITY * t * t);
}

export const DIFFICULTIES = {
  // aimError: how far (px) the bot may misplace itself relative to the ideal spot, re-rolled per rally
  // reaction: max ticks of delay before the bot re-plans at the start of a rally
  // jumpLead: how many ticks before the ball reaches head height the bot takes off
  easy: { aimError: 34, reaction: 14, jumpLead: 12 },
  normal: { aimError: 18, reaction: 6, jumpLead: 18 },
  hard: { aimError: 8, reaction: 2, jumpLead: 22 },
};

/**
 * Create a bot brain for one slot. Call `think(state)` once per tick.
 */
export function createBot(slot, { difficulty = 'normal', seed = slot * 7919 + 1 } = {}) {
  const base = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
  const cfg = { ...base, meetHeight: jumpHeightAfter(base.jumpLead) };
  const rand = mulberry32(seed);
  let aimOffset = 0;
  let planTick = -1;
  let lastRallyKey = null;
  let lastOwnHitTick = -1;
  let cachedInput = { left: false, right: false, jump: false };

  function replan(state, react) {
    // Re-roll the "style" per rally and after every own touch, so the bot is consistent but
    // not perfect, and two bots can never lock into an endless identical rally.
    aimOffset = (rand() * 2 - 1) * cfg.aimError;
    if (react) planTick = state.tick + Math.floor(rand() * cfg.reaction);
  }

  function think(state) {
    const blob = state.blobs[slot];
    if (!blob) return cachedInput;
    const team = blob.team;
    const rallyKey = `${state.score[0]}:${state.score[1]}`;
    if (rallyKey !== lastRallyKey) {
      lastRallyKey = rallyKey;
      replan(state, true);
    }
    if (state.ball.lastHit === slot && state.ball.lastHitTick !== lastOwnHitTick) {
      lastOwnHitTick = state.ball.lastHitTick;
      replan(state, false);
    }
    // While the bot is still "reacting" it keeps its previous input.
    if (state.tick < planTick) return cachedInput;

    const ball = state.ball;
    let targetX = blob.homeX;
    let jump = false;

    if (state.phase === 'play') {
      // Plan to meet the ball mid-jump: predict where it will be at that height. If it never
      // gets that high, wait for it at head height instead and don't jump.
      let landing = predictLanding(ball, 240, REACH_Y + cfg.meetHeight);
      let canJump = true;
      if (!landing) {
        landing = predictLanding(ball);
        canJump = false;
      }
      if (landing && landing.side === team) {
        if (inZone(landing.x, blob.zone, 30)) {
          // Stand slightly on the far side of the ball from the net so the head sends it over.
          const away = team === 0 ? -1 : 1;
          targetX = clampZone(landing.x + away * (30 + aimOffset), blob.zone);
          const inPosition = Math.abs(blob.x - targetX) < 14;
          if (canJump && inPosition && blob.onGround && landing.ticks <= cfg.jumpLead) jump = true;
          // keep holding jump while rising under the ball: "hold to jump higher"
          if (!blob.onGround && blob.vy > 0 && ball.y > blob.y + BLOB_HEIGHT) jump = true;
        } else {
          // A teammate's ball: lean toward it in case it comes back our way.
          targetX = clampZone((blob.homeX * 2 + landing.x) / 3, blob.zone);
        }
      }
    }

    const dead = BLOB_SPEED * DT * 0.75; // don't jitter around the target
    const left = blob.x - targetX > dead;
    const right = targetX - blob.x > dead;
    cachedInput = { left, right, jump };
    return cachedInput;
  }

  return { slot, difficulty, think };
}

function inZone(x, zone, slack = 0) {
  return x >= zone.min - slack && x <= zone.max + slack;
}

function clampZone(x, zone) {
  return x < zone.min ? zone.min : x > zone.max ? zone.max : x;
}
