// The car model: the one thing in Scrap Rally that has to feel right, and the
// one thing the client re-runs itself, so determinism is a hard requirement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRibbon, frameAt } from '../sim/spline.js';
import { makeCarState, stepCar, speedOf, steerAuthority, carRadius, environmentDamage } from '../rally/sim/car.js';
import { buildTrack } from '../rally/sim/track.js';
import { carStats } from '../rally/cars.js';
import { DT, CAR } from '../rally/constants.js';
import { IN } from '../net/protocol.js';

/**
 * A ring so vast and so wide that a car driven flat out in a straight line for
 * half a minute never reaches a barrier: the car under test, and nothing else.
 */
let openCache = null;
function openTrack() {
  if (openCache) return openCache;
  const pts = [];
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; pts.push({ x: Math.sin(a) * 4000, y: 0, z: Math.cos(a) * 4000 }); }
  openCache = { ribbon: buildRibbon(pts, { width: 1600 }), obstacles: [] };
  return openCache;
}
function spawnOn(track, s = 0) {
  const f = frameAt(track.ribbon, s);
  return { x: f.pos.x, z: f.pos.z, yaw: Math.atan2(f.tangent.x, f.tangent.z) };
}
const drive = (track, c, input, ticks) => { for (let i = 0; i < ticks; i++) stepCar(track, c, input, DT); return c; };

test('car: the same inputs give the same state, to the last bit', () => {
  const track = openTrack();
  const st = carStats('stiletto', { handling: 2 });
  const inputs = [];
  for (let i = 0; i < 600; i++) inputs.push({ bits: i % 7 === 0 ? IN.BRAKE : IN.THROTTLE, steer: Math.sin(i / 23) });
  const run = () => {
    const c = makeCarState(st, spawnOn(track));
    for (const i of inputs) stepCar(track, c, i, DT);
    return c;
  };
  const a = run(), b = run();
  for (const k of ['x', 'z', 'yaw', 'vx', 'vz', 'fwd', 'lat', 's', 't']) {
    assert.equal(a[k], b[k], `${k} differs between two identical runs`);
  }
});

test('car: every car reaches its own top speed, and a better engine gets there sooner', () => {
  const track = openTrack();
  for (const id of ['vagabond', 'mongrel', 'stiletto', 'warden', 'behemoth', 'valkyrie']) {
    const st = carStats(id, {});
    const c = drive(track, makeCarState(st, spawnOn(track)), { bits: IN.THROTTLE, steer: 0 }, 60 * 25);
    const reached = Math.abs(c.fwd);
    assert.ok(reached > st.topSpeed * 0.97, `${id} only reached ${reached.toFixed(1)} of ${st.topSpeed.toFixed(1)}`);
    assert.ok(reached <= st.topSpeed + 0.5, `${id} exceeded its top speed (${reached.toFixed(1)})`);
  }
  const stock = carStats('vagabond', {});
  const tuned = carStats('vagabond', { speed: 4 });
  assert.ok(tuned.topSpeed > stock.topSpeed && tuned.accel > stock.accel, 'the Speed upgrade buys both');
  const at = (st, ticks) => Math.abs(drive(track, makeCarState(st, spawnOn(track)), { bits: IN.THROTTLE, steer: 0 }, ticks).fwd);
  assert.ok(at(tuned, 180) > at(stock, 180), 'and it is ahead after three seconds');
});

test('car: positive steer goes to the driver’s right, and reversing flips the wheel', () => {
  const track = buildTrack('scrapyard');
  const spawn = { ...track.grid[0] };
  const c = makeCarState(carStats('warden', {}), spawn);
  drive(track, c, { bits: IN.THROTTLE, steer: 0 }, 120);
  const before = c.t;
  drive(track, c, { bits: IN.THROTTLE, steer: 1 }, 40);
  assert.ok(c.t > before + 0.5, `steer +1 should raise the lateral offset (${before.toFixed(2)} -> ${c.t.toFixed(2)})`);

  const r = makeCarState(carStats('warden', {}), spawnOn(openTrack()));
  const rt = openTrack();
  drive(rt, r, { bits: IN.BRAKE, steer: 0 }, 120);
  assert.ok(r.fwd < -3, 'holding the brake at rest backs the car up');
  const yaw0 = r.yaw;
  drive(rt, r, { bits: IN.BRAKE, steer: 1 }, 30);
  assert.ok(r.yaw > yaw0, 'and the same wheel turns the body the other way when reversing');
  assert.ok(Math.abs(r.fwd) < carStats('warden', {}).topSpeed * CAR.reverseFraction + 1, 'reverse has its own, lower limit');
});

test('car: steering authority is nothing at rest, most in the middle, less at the top', () => {
  const st = carStats('stiletto', {});
  const at = (v) => steerAuthority(v, st);
  assert.equal(at(0), 0);
  assert.ok(at(CAR.turnFullSpeed) > at(1), 'it builds with speed');
  assert.ok(at(st.topSpeed) < at(CAR.turnFullSpeed), 'and fades again at the top end');
  assert.ok(at(30, st, true) < at(30, st, false) + 1e-9, 'a car that has let go turns less');
});

test('car: too much sideways speed is a slide, and Handling is what stops it', () => {
  const track = openTrack();
  const hard = (st) => {
    const c = makeCarState(st, spawnOn(track));
    drive(track, c, { bits: IN.THROTTLE, steer: 0 }, 60 * 12);
    let slid = 0;
    for (let i = 0; i < 300; i++) { stepCar(track, c, { bits: IN.THROTTLE, steer: 1 }, DT); if (c.sliding) slid++; }
    return { slid, lat: Math.abs(c.lat) };
  };
  const stock = hard(carStats('valkyrie', {}));
  const tuned = hard(carStats('valkyrie', { handling: 4 }));
  assert.ok(stock.slid > 0, 'a stock Valkyrie at full lock and full speed lets go');
  assert.ok(tuned.lat < stock.lat, 'a tuned one holds far more of it');
  assert.ok(tuned.slid < stock.slid, `Handling is the difference (${tuned.slid} vs ${stock.slid} ticks sliding)`);
});

test('car: a barrier pushes back, scrapes and, hit hard enough, costs hull', () => {
  const track = buildTrack('scrapyard');
  const st = carStats('vagabond', {});
  const half = track.ribbon.frames[Math.round(60 / track.ribbon.step)].width / 2;
  // point the car at the barrier and drive into it
  const f = frameAt(track.ribbon, 60);
  const c = makeCarState(st, { x: f.pos.x, z: f.pos.z, yaw: Math.atan2(f.tangent.x, f.tangent.z) });
  drive(track, c, { bits: IN.THROTTLE, steer: 0 }, 60 * 6);
  let hardest = 0, scraped = 0, damage = 0;
  for (let i = 0; i < 60 * 4; i++) {
    stepCar(track, c, { bits: IN.THROTTLE, steer: 1 }, DT);
    hardest = Math.max(hardest, c.wallHit);
    if (c.scraping) scraped++;
    damage += environmentDamage(c, DT);
  }
  assert.ok(Math.abs(c.t) <= half - c.radius + 0.01, 'the car never ends a step inside the barrier');
  assert.ok(hardest > 0 || scraped > 0, 'it registered the barrier');
  assert.ok(damage > 0, 'and the barrier took hull for it');
});

test('car: a bigger, heavier car needs more room', () => {
  assert.ok(carRadius(carStats('behemoth', {})) > carRadius(carStats('vagabond', {})));
  assert.ok(carStats('behemoth', {}).mass > carStats('stiletto', {}).mass);
  assert.ok(carStats('vagabond', { armour: 4 }).maxHull > carStats('vagabond', {}).maxHull);
});

test('car: an obstacle is solid from every side', () => {
  const track = buildTrack('scrapyard');
  const o = track.obstacles[0];
  const st = carStats('mongrel', {});
  for (const approach of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const c = makeCarState(st, { x: o.x - Math.sin(approach) * 14, z: o.z - Math.cos(approach) * 14, yaw: approach });
    c.vx = Math.sin(approach) * 20; c.vz = Math.cos(approach) * 20;
    for (let i = 0; i < 60; i++) stepCar(track, c, { bits: IN.THROTTLE, steer: 0 }, DT);
    const d = Math.hypot(c.x - o.x, c.z - o.z);
    assert.ok(d >= c.radius + o.r - 0.01, `driven at from ${approach.toFixed(2)} rad the car ended ${d.toFixed(2)} m away`);
  }
});

