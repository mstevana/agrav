import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, stepBlob, makeZones, cloneState, NO_INPUT } from '../volley/sim.js';
import {
  FIELD_W, FIELD_H, NET_X, BALL_R, BLOB_LOWER_R, BLOB_UPPER_Y, BLOB_UPPER_R, MAX_TOUCHES,
  POINT_PAUSE_TICKS, BALL_HIT_SPEED,
} from '../volley/constants.js';

const L = { left: true, right: false, jump: false };
const R = { left: false, right: true, jump: false };
const J = { left: false, right: false, jump: true };

function run(state, inputs, ticks) {
  for (let i = 0; i < ticks; i++) step(state, inputs);
  return state;
}

test('zones never overlap and stay clear of the net and walls', () => {
  for (const teamSize of [1, 2]) {
    const zones = makeZones(teamSize);
    assert.equal(zones.length, teamSize * 2);
    for (let i = 0; i < zones.length; i++) {
      assert.ok(zones[i].min >= BLOB_LOWER_R);
      assert.ok(zones[i].max <= FIELD_W - BLOB_LOWER_R);
      if (i > 0) assert.ok(zones[i].min - zones[i - 1].max >= 2 * BLOB_LOWER_R, `zones ${i - 1} and ${i} touch`);
    }
    const left = zones.filter((z) => z.max < NET_X);
    const right = zones.filter((z) => z.min > NET_X);
    assert.equal(left.length, teamSize);
    assert.equal(right.length, teamSize);
    for (const z of left) assert.ok(z.max + BLOB_LOWER_R <= NET_X);
    for (const z of right) assert.ok(z.min - BLOB_LOWER_R >= NET_X);
  }
});

test('blobs are clamped to their zone and cannot interfere with each other', () => {
  const state = createState();
  run(state, [R, L, R, L], 600);
  const [a, b, c, d] = state.blobs;
  assert.equal(a.x, a.zone.max);
  assert.equal(b.x, b.zone.min);
  assert.equal(c.x, c.zone.max);
  assert.equal(d.x, d.zone.min);
  assert.ok(b.x - a.x >= 2 * BLOB_LOWER_R);
  assert.ok(d.x - c.x >= 2 * BLOB_LOWER_R);
});

test('jumping goes up and lands again; holding jump goes higher', () => {
  const short = { ...createState().blobs[0] };
  stepBlob(short, J);
  let peakShort = 0;
  for (let i = 0; i < 120; i++) {
    stepBlob(short, NO_INPUT);
    peakShort = Math.max(peakShort, short.y);
  }
  assert.ok(peakShort > 100);
  assert.equal(short.y, 0);
  assert.equal(short.onGround, true);

  const held = { ...createState().blobs[0] };
  let peakHeld = 0;
  for (let i = 0; i < 120; i++) {
    stepBlob(held, J);
    peakHeld = Math.max(peakHeld, held.y);
  }
  assert.ok(peakHeld > peakShort + 30);
});

test('ball bounces off the side walls and the ceiling', () => {
  const state = createState();
  Object.assign(state.ball, { x: BALL_R + 5, y: 300, vx: -600, vy: 0 });
  step(state);
  assert.ok(state.ball.vx > 0);
  assert.ok(state.ball.x >= BALL_R);

  Object.assign(state.ball, { x: FIELD_W - BALL_R - 5, y: 300, vx: 600, vy: 0 });
  step(state);
  assert.ok(state.ball.vx < 0);
  assert.ok(state.ball.x <= FIELD_W - BALL_R);

  Object.assign(state.ball, { x: 300, y: FIELD_H - BALL_R - 5, vx: 0, vy: 900 });
  step(state);
  assert.ok(state.ball.vy < 0);
  assert.ok(state.ball.y <= FIELD_H - BALL_R);
});

test('ball cannot pass through the net', () => {
  const state = createState();
  Object.assign(state.ball, { x: NET_X - 60, y: 150, vx: 800, vy: 0 });
  for (let i = 0; i < 20; i++) step(state);
  assert.ok(state.ball.x < NET_X);
});

test('ball on the ground scores for the other side, then the scorer serves', () => {
  const state = createState();
  Object.assign(state.ball, { x: 100, y: BALL_R + 1, vx: 0, vy: -200 });
  step(state);
  assert.equal(state.phase, 'point');
  assert.deepEqual(state.score, [0, 1]);
  assert.equal(state.lastEvent.reason, 'ground');
  run(state, [], POINT_PAUSE_TICKS);
  assert.equal(state.phase, 'play');
  assert.equal(state.serving, 1);
  assert.ok(state.ball.x > NET_X, 'serve drops on the scoring side');
  assert.equal(state.ball.vx, 0);
  for (const blob of state.blobs) assert.equal(blob.x, blob.homeX);
});

test('a blob hit sends the ball away at the fixed hit speed and counts a touch', () => {
  const state = createState();
  const blob = state.blobs[1];
  Object.assign(state.ball, { x: blob.x + 10, y: blob.y + BLOB_UPPER_Y + BLOB_UPPER_R + BALL_R + 2, vx: 0, vy: -300 });
  step(state);
  const speed = Math.hypot(state.ball.vx, state.ball.vy);
  assert.ok(Math.abs(speed - BALL_HIT_SPEED) < 1e-6);
  assert.ok(state.ball.vy > 0);
  assert.ok(state.ball.vx > 0, 'ball leaves along the contact normal');
  assert.equal(state.ball.lastHit, 1);
  assert.equal(state.touchTeam, 0);
  assert.equal(state.touches, 1);
});

test('more than three consecutive touches by one team is a fault', () => {
  const state = createState();
  state.blobs[0].x = 100;
  let touchesSeen = 0;
  // drop the ball on the idle back player's head over and over
  for (let i = 0; i < 60 * 8 && state.phase === 'play'; i++) {
    step(state);
    touchesSeen = Math.max(touchesSeen, state.touches);
  }
  assert.equal(state.phase, 'point');
  assert.equal(state.lastEvent.reason, 'touches');
  assert.deepEqual(state.score, [0, 1]);
  assert.equal(touchesSeen, MAX_TOUCHES + 1);
});

test('match ends when a team reaches the target with a two point lead', () => {
  const state = createState({ pointsToWin: 2 });
  const groundBall = (side) => {
    Object.assign(state.ball, { x: side === 0 ? 100 : 700, y: BALL_R + 1, vx: 0, vy: -200 });
    step(state);
    run(state, [], POINT_PAUSE_TICKS);
  };
  groundBall(0); // red 1
  groundBall(1); // blue 1
  groundBall(0); // red 2, but only a one point lead
  assert.equal(state.phase, 'play');
  assert.equal(state.winner, -1);
  groundBall(0); // red 3
  assert.equal(state.phase, 'over');
  assert.equal(state.winner, 1);
  assert.deepEqual(state.score, [1, 3]);
  const tick = state.tick;
  step(state, [R, R, R, R]);
  assert.equal(state.tick, tick + 1);
  assert.deepEqual(state.score, [1, 3]);
});

test('simulation is deterministic', () => {
  const a = createState();
  const b = cloneState(a);
  const inputs = [R, J, L, { left: true, right: false, jump: true }];
  run(a, inputs, 1200);
  run(b, inputs, 1200);
  assert.deepEqual(a, b);
});

test('1v1 mode gives each player the whole half', () => {
  const state = createState({ teamSize: 1 });
  assert.equal(state.blobs.length, 2);
  assert.equal(state.blobs[0].team, 0);
  assert.equal(state.blobs[1].team, 1);
  assert.ok(state.blobs[0].zone.max - state.blobs[0].zone.min > 300);
});
