import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, step } from '../volley/sim.js';
import { createBot, predictLanding, DIFFICULTIES } from '../volley/bot.js';
import { FIELD_W, FIELD_H, BALL_R, NET_X } from '../volley/constants.js';

test('predictLanding follows the free ball to head height', () => {
  const ball = { x: 100, y: 400, vx: 0, vy: 0, angle: 0 };
  const landing = predictLanding(ball);
  assert.ok(landing);
  assert.equal(landing.side, 0);
  assert.ok(Math.abs(landing.x - 100) < 1);
  assert.ok(landing.ticks > 10 && landing.ticks < 120);

  const flying = { x: 100, y: 200, vx: 700, vy: 500, angle: 0 };
  const far = predictLanding(flying);
  assert.ok(far);
  assert.equal(far.side, 1, 'ball crosses the net');
  assert.ok(far.x > NET_X && far.x <= FIELD_W - BALL_R);
});

test('bots keep the ball in play, stay in their zones and finish a match', () => {
  const state = createState({ pointsToWin: 5 });
  const bots = state.blobs.map((b, i) => createBot(i, { difficulty: 'normal', seed: 42 + i }));
  let touches = 0;
  let prevTouches = 0;
  while (state.phase !== 'over') {
    assert.ok(state.tick < 60 * 60 * 5, 'match should finish within five minutes');
    const inputs = bots.map((b) => b.think(state));
    step(state, inputs);
    for (const blob of state.blobs) {
      assert.ok(blob.x >= blob.zone.min && blob.x <= blob.zone.max, `blob ${blob.slot} left its zone`);
      assert.ok(blob.y >= 0);
    }
    const { ball } = state;
    assert.ok(ball.x >= BALL_R - 1e-6 && ball.x <= FIELD_W - BALL_R + 1e-6, 'ball inside side walls');
    assert.ok(ball.y <= FIELD_H - BALL_R + 1e-6, 'ball below ceiling');
    if (state.touches !== prevTouches && state.touches > 0) touches++;
    prevTouches = state.touches;
  }
  assert.ok(state.winner === 0 || state.winner === 1);
  assert.ok(Math.max(...state.score) >= 5);
  assert.ok(touches > 20, `bots should rally, saw ${touches} touches`);
});

test('bots are deterministic for a given seed', () => {
  const play = () => {
    const state = createState({ pointsToWin: 2 });
    const bots = state.blobs.map((b, i) => createBot(i, { seed: 7 + i }));
    for (let i = 0; i < 1500; i++) step(state, bots.map((b) => b.think(state)));
    return state;
  };
  assert.deepEqual(play(), play());
});

test('every difficulty is playable in 1v1', () => {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    const state = createState({ teamSize: 1, pointsToWin: 2 });
    const bots = state.blobs.map((b, i) => createBot(i, { difficulty, seed: 100 + i }));
    while (state.phase !== 'over' && state.tick < 60 * 60 * 3) step(state, bots.map((b) => b.think(state)));
    assert.equal(state.phase, 'over', `${difficulty} bots finish a match`);
  }
});
