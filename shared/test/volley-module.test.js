import { test } from 'node:test';
import assert from 'node:assert/strict';
import module from '../volley/module.js';
import { encodeVolleySnapshot, decodeVolleySnapshot } from '../volley/snapshot.js';
import { FIELD_W, BALL_R } from '../volley/constants.js';

test('module advertises a valid contract shape', () => {
  assert.equal(module.id, 'volley');
  assert.equal(module.maxPlayers, 4);
  assert.equal(module.minPlayers, 1);
  for (const fn of ['createMatch', 'addPlayer', 'removePlayer', 'step', 'applyInput', 'botInput',
    'encodeSnapshot', 'decodeSnapshot', 'isOver', 'results', 'publicState', 'validateOpts', 'phase']) {
    assert.equal(typeof module[fn], 'function', `missing ${fn}`);
  }
});

test('validateOpts clamps points and difficulty', () => {
  assert.deepEqual(module.validateOpts({ pointsToWin: 999, botDifficulty: 'x' }), { pointsToWin: 50, botDifficulty: 'normal' });
  assert.deepEqual(module.validateOpts({ pointsToWin: 0 }), { pointsToWin: 1, botDifficulty: 'normal' });
  assert.equal(module.validateOpts({ botDifficulty: 'hard' }).botDifficulty, 'hard');
});

test('createMatch always builds a 2v2 court of four blobs', () => {
  const s = module.createMatch({ pointsToWin: 5 }, 1);
  assert.equal(s.blobs.length, 4);
  assert.equal(s.options.teamSize, 2);
  const ps = module.publicState(s);
  assert.equal(ps.slots.length, 4);
  assert.deepEqual(ps.slots.map((x) => x.team), [0, 0, 1, 1]);
  assert.deepEqual(ps.slots.map((x) => x.role), ['back', 'front', 'front', 'back']);
});

test('a human input steers its own blob; empty seats play as bots', () => {
  const s = module.createMatch({ pointsToWin: 3 }, 42);
  module.addPlayer(s, 0, {}, false);       // one human, seats 1..3 stay empty
  const startX = s.blobs[0].x;
  const events = [];
  for (let t = 1; t <= 30; t++) { module.applyInput(s, 0, { bits: 0, steer: 1 }, t); module.step(s, t, events); }
  assert.ok(s.blobs[0].x > startX, 'human seat 0 moved right');
  // an empty seat is bot-driven, so at least one other blob should have moved from home by now
  const moved = [1, 2, 3].some((i) => Math.abs(s.blobs[i].x - s.blobs[i].homeX) > 1 || s.blobs[i].y > 1);
  assert.ok(moved, 'empty seats are driven by bots');
});

test('scoring surfaces reliable events, once each', () => {
  const s = module.createMatch({ pointsToWin: 5 }, 7);
  module.addPlayer(s, 0, {}, false);
  const all = [];
  for (let t = 1; t < 60 * 60 && !module.isOver(s); t++) {
    module.applyInput(s, 0, { bits: 0, steer: 0 }, t);
    const ev = []; module.step(s, t, ev); for (const e of ev) all.push(e);
  }
  const points = all.filter((e) => e.kind === 'point');
  const overs = all.filter((e) => e.kind === 'over');
  assert.ok(points.length >= 5, 'points were scored');
  assert.equal(overs.length, 1, 'exactly one over event');
  assert.equal(overs[0].team, module.results(s).winner);
});

test('a single player and three bots finish a match', () => {
  const s = module.createMatch({ pointsToWin: 5, botDifficulty: 'hard' }, 99);
  module.addPlayer(s, 0, {}, false);
  for (let t = 1; t < 60 * 60 * 5 && !module.isOver(s); t++) {
    module.applyInput(s, 0, { bits: 0, steer: 0 }, t);
    module.step(s, t, []);
  }
  assert.ok(module.isOver(s));
  const r = module.results(s);
  assert.ok(r.winner === 0 || r.winner === 1);
  assert.ok(Math.max(...r.score) >= 5);
});

test('phase byte tracks play/point/over', () => {
  const s = module.createMatch({ pointsToWin: 1 }, 3);
  module.addPlayer(s, 0, {}, false);
  assert.equal(module.phase(s), module.PHASE.PLAY);
  // force a ground point next tick
  Object.assign(s.ball, { x: 100, y: BALL_R + 1, vx: 0, vy: -200 });
  module.step(s, 1, []);
  assert.equal(module.phase(s), module.PHASE.POINT);
});

test('snapshot encodes and decodes the ball, blobs, score and touches', () => {
  const s = module.createMatch({ pointsToWin: 15 }, 5);
  module.addPlayer(s, 0, {}, false);
  for (let t = 1; t <= 120; t++) { module.applyInput(s, 0, { bits: 1, steer: 1 }, t); module.step(s, t, []); }
  const u8 = encodeVolleySnapshot(s);
  const d = decodeVolleySnapshot(u8);
  assert.equal(d.blobs.length, 4);
  assert.deepEqual(d.score, s.score);
  assert.equal(d.serving, s.serving);
  assert.equal(d.touchTeam, s.touchTeam);
  assert.ok(Math.abs(d.ball.x - s.ball.x) < 0.1 && Math.abs(d.ball.y - s.ball.y) < 0.1);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(d.blobs[i].x - s.blobs[i].x) < 0.1, `blob ${i} x`);
    assert.ok(Math.abs(d.blobs[i].y - s.blobs[i].y) < 0.1, `blob ${i} y`);
    assert.equal(d.blobs[i].onGround, s.blobs[i].onGround);
  }
  assert.ok(d.ball.x >= BALL_R - 1 && d.ball.x <= FIELD_W - BALL_R + 1);
});

test('disconnect makes a seat a bot; reconnect gives it back', () => {
  const s = module.createMatch({ pointsToWin: 5 }, 11);
  module.addPlayer(s, 0, {}, false);
  module.onDisconnect(s, 0, 10);
  assert.equal(s.control[0], 'bot');
  const homeX = s.blobs[0].homeX;
  for (let t = 1; t <= 60; t++) module.step(s, t, []);   // no human input, bot should act
  const botMoved = Math.abs(s.blobs[0].x - homeX) > 1 || s.blobs[0].y > 1;
  assert.ok(botMoved, 'a disconnected seat is driven by a bot');
  module.onReconnect(s, 0, 70);
  assert.equal(s.control[0], 'human');
});
