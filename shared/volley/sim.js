// Deterministic Volley simulation. Pure functions over a plain state object so the
// server can run it authoritatively and the client can re-run its own blob for prediction.

import {
  FIELD_W, FIELD_H, NET_X, NET_HALF_W, NET_HEIGHT,
  BALL_R, BALL_GRAVITY, BALL_HIT_SPEED, BALL_WALL_BOUNCE, BALL_GROUND_BOUNCE,
  BLOB_LOWER_R, BLOB_LOWER_Y, BLOB_UPPER_R, BLOB_UPPER_Y,
  BLOB_SPEED, BLOB_JUMP_V, BLOB_GRAVITY, BLOB_FLOAT_GRAVITY,
  MAX_TOUCHES, DT, POINT_PAUSE_TICKS, SERVE_HEIGHT, TOUCH_COOLDOWN_TICKS, DEFAULT_OPTIONS,
} from './constants.js';

export const NO_INPUT = Object.freeze({ left: false, right: false, jump: false });

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Movement zones. Slots are numbered left to right across the field, so
 * team 0 (left) owns the first `teamSize` slots and team 1 (right) the rest.
 * Zones never overlap, so blobs can never touch each other or the net.
 */
export function makeZones(teamSize) {
  const leftEdge = BLOB_LOWER_R;
  const netEdge = NET_X - NET_HALF_W - BLOB_LOWER_R;
  const zones = [];
  if (teamSize === 1) {
    zones.push({ min: leftEdge, max: netEdge });
  } else {
    // back player gets the outer quarter, front player the inner quarter
    const split = NET_X / 2;
    zones.push({ min: leftEdge, max: split - BLOB_LOWER_R });
    zones.push({ min: split + BLOB_LOWER_R, max: netEdge });
  }
  // mirror for the right team, keeping slots ordered left to right
  const mirrored = zones.map((z) => ({ min: FIELD_W - z.max, max: FIELD_W - z.min })).reverse();
  return zones.concat(mirrored);
}

export function slotTeam(slot, teamSize) {
  return slot < teamSize ? 0 : 1;
}

export function createState(options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const teamSize = opts.teamSize === 1 ? 1 : 2;
  const zones = makeZones(teamSize);
  const blobs = zones.map((zone, slot) => ({
    slot,
    team: slotTeam(slot, teamSize),
    zone,
    homeX: (zone.min + zone.max) / 2,
    x: (zone.min + zone.max) / 2,
    y: 0,
    vy: 0,
    onGround: true,
    dir: 0,
  }));
  const state = {
    tick: 0,
    phase: 'play', // 'play' | 'point' | 'over'
    timer: 0,
    score: [0, 0],
    serving: 0,
    touches: 0,
    touchTeam: -1,
    winner: -1,
    lastEvent: null,
    options: { teamSize, pointsToWin: Math.max(1, opts.pointsToWin | 0) },
    ball: { x: 0, y: 0, vx: 0, vy: 0, angle: 0, lastHit: -1, lastHitTick: -1000 },
    blobs,
  };
  placeForServe(state);
  return state;
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function placeForServe(state) {
  const b = state.ball;
  // The ball is dropped above the serving team's back player.
  const server = state.serving === 0 ? state.blobs[0] : state.blobs[state.blobs.length - 1];
  b.x = server.homeX;
  b.y = SERVE_HEIGHT;
  b.vx = 0;
  b.vy = 0;
  b.lastHit = -1;
  b.lastHitTick = -1000;
  state.touches = 0;
  state.touchTeam = -1;
  for (const blob of state.blobs) {
    blob.x = blob.homeX;
    blob.y = 0;
    blob.vy = 0;
    blob.onGround = true;
    blob.dir = 0;
  }
}

/** Advance one blob by one tick. Used on the server and for client-side prediction. */
export function stepBlob(blob, input = NO_INPUT, dt = DT) {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  blob.dir = dir;
  blob.x = clamp(blob.x + dir * BLOB_SPEED * dt, blob.zone.min, blob.zone.max);
  if (blob.onGround) {
    if (input.jump) {
      blob.vy = BLOB_JUMP_V;
      blob.onGround = false;
    }
  }
  if (!blob.onGround) {
    const g = input.jump && blob.vy > 0 ? BLOB_FLOAT_GRAVITY : BLOB_GRAVITY;
    blob.vy -= g * dt;
    blob.y += blob.vy * dt;
    if (blob.y <= 0) {
      blob.y = 0;
      blob.vy = 0;
      blob.onGround = true;
    }
  }
  return blob;
}

/** Ball vs. walls, ceiling and net. Mutates `ball`; no blobs involved. */
export function stepBallFree(ball, dt = DT) {
  ball.vy -= BALL_GRAVITY * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.angle += (ball.vx * dt) / BALL_R;
  confineBall(ball);
  return ball;
}

/** Keep the ball inside the walls and ceiling and out of the net, bouncing it as needed. */
export function confineBall(ball) {
  if (ball.x < BALL_R) {
    ball.x = BALL_R;
    ball.vx = Math.abs(ball.vx) * BALL_WALL_BOUNCE;
  } else if (ball.x > FIELD_W - BALL_R) {
    ball.x = FIELD_W - BALL_R;
    ball.vx = -Math.abs(ball.vx) * BALL_WALL_BOUNCE;
  }
  if (ball.y > FIELD_H - BALL_R) {
    ball.y = FIELD_H - BALL_R;
    ball.vy = -Math.abs(ball.vy) * BALL_WALL_BOUNCE;
  }
  collideNet(ball);
  return ball;
}

function collideNet(ball) {
  if (ball.y < NET_HEIGHT) {
    // the straight part of the net: push out sideways
    const dx = ball.x - NET_X;
    const minDist = NET_HALF_W + BALL_R;
    if (Math.abs(dx) < minDist) {
      if (dx < 0) {
        ball.x = NET_X - minDist;
        ball.vx = -Math.abs(ball.vx) * BALL_WALL_BOUNCE;
      } else {
        ball.x = NET_X + minDist;
        ball.vx = Math.abs(ball.vx) * BALL_WALL_BOUNCE;
      }
    }
  } else {
    // the rounded top: reflect off a small sphere
    reflectOffCircle(ball, NET_X, NET_HEIGHT, NET_HALF_W, BALL_WALL_BOUNCE);
  }
}

function reflectOffCircle(ball, cx, cy, r, bounce) {
  const dx = ball.x - cx;
  const dy = ball.y - cy;
  const minDist = r + BALL_R;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minDist * minDist || d2 === 0) return false;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  ball.x = cx + nx * minDist;
  ball.y = cy + ny * minDist;
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn < 0) {
    ball.vx = (ball.vx - 2 * vn * nx) * bounce;
    ball.vy = (ball.vy - 2 * vn * ny) * bounce;
  }
  return true;
}

/** Circles making up a blob's body, in field coordinates. */
export function blobCircles(blob) {
  return [
    { x: blob.x, y: blob.y + BLOB_UPPER_Y, r: BLOB_UPPER_R },
    { x: blob.x, y: blob.y + BLOB_LOWER_Y, r: BLOB_LOWER_R },
  ];
}

/** Like the original: the ball leaves the blob at a fixed speed along the contact normal. */
function collideBlob(ball, blob) {
  for (const c of blobCircles(blob)) {
    const dx = ball.x - c.x;
    const dy = ball.y - c.y;
    const minDist = c.r + BALL_R;
    const d2 = dx * dx + dy * dy;
    if (d2 < minDist * minDist) {
      const d = Math.sqrt(d2) || 1e-6;
      const nx = d2 === 0 ? 0 : dx / d;
      const ny = d2 === 0 ? 1 : dy / d;
      ball.x = c.x + nx * minDist;
      ball.y = c.y + ny * minDist;
      ball.vx = nx * BALL_HIT_SPEED;
      ball.vy = ny * BALL_HIT_SPEED;
      return true;
    }
  }
  return false;
}

function awardPoint(state, team, reason) {
  state.score[team] += 1;
  state.serving = team;
  state.phase = 'point';
  state.timer = POINT_PAUSE_TICKS;
  state.lastEvent = { kind: 'point', team, reason, tick: state.tick, score: [...state.score] };
  const [a, b] = state.score;
  const target = state.options.pointsToWin;
  if ((a >= target || b >= target) && Math.abs(a - b) >= 2) {
    state.winner = a > b ? 0 : 1;
  }
}

/**
 * Advance the whole match by one tick.
 * `inputs[slot]` is `{left, right, jump}` for every blob (missing => no input).
 */
export function step(state, inputs = []) {
  if (state.phase === 'over') {
    state.tick += 1;
    return state;
  }
  const { ball, blobs } = state;
  const teamSize = state.options.teamSize;

  for (const blob of blobs) stepBlob(blob, inputs[blob.slot] || NO_INPUT);

  stepBallFree(ball);

  let touched = false;
  for (const blob of blobs) {
    if (!collideBlob(ball, blob)) continue;
    touched = true;
    const fresh = ball.lastHit !== blob.slot || state.tick - ball.lastHitTick > TOUCH_COOLDOWN_TICKS;
    ball.lastHit = blob.slot;
    ball.lastHitTick = state.tick;
    if (state.phase !== 'play' || !fresh) continue;
    const team = slotTeam(blob.slot, teamSize);
    if (state.touchTeam === team) state.touches += 1;
    else {
      state.touchTeam = team;
      state.touches = 1;
    }
    if (state.touches > MAX_TOUCHES) awardPoint(state, 1 - team, 'touches');
  }
  // a blob standing at a wall or the net may have pushed the ball into it
  if (touched) confineBall(ball);

  if (ball.y < BALL_R) {
    ball.y = BALL_R;
    ball.vy = Math.abs(ball.vy) * BALL_GROUND_BOUNCE;
    ball.vx *= BALL_GROUND_BOUNCE;
    if (state.phase === 'play') {
      const landedOn = ball.x < NET_X ? 0 : 1;
      awardPoint(state, 1 - landedOn, 'ground');
    }
  }

  if (state.phase === 'point') {
    state.timer -= 1;
    if (state.timer <= 0) {
      if (state.winner >= 0) {
        state.phase = 'over';
        state.lastEvent = { kind: 'over', team: state.winner, tick: state.tick, score: [...state.score] };
      } else {
        state.phase = 'play';
        placeForServe(state);
      }
    }
  }

  state.tick += 1;
  return state;
}
