import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRibbon, frameAt } from '../sim/spline.js';
import { vehicleStats } from '../agrav/vehicles.js';
import { makeVehicleState, stepVehicle } from '../agrav/sim/vehicle.js';
import { IN } from '../net/protocol.js';
import { DT } from '../agrav/constants.js';

function oval() {
  const pts = [];
  for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; pts.push({ x: Math.cos(a) * 600, y: 0, z: Math.sin(a) * 300, width: 24 }); }
  return buildRibbon(pts);
}
function crest() {
  // flat, a ramp up, a sharp lip, a drop: the craft should fly
  const pts = [];
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2;
    let y = 0;
    if (i === 8) y = 10; if (i === 9) y = 20; if (i === 10) y = 27; if (i === 11) y = 4;
    pts.push({ x: Math.cos(a) * 600, y, z: Math.sin(a) * 300, width: 24 });
  }
  return buildRibbon(pts);
}

const centre = (v) => Math.max(-1, Math.min(1, -v.t * 0.05 - v.yaw * 1.5 + frameAt(r0, v.s).curvature * Math.hypot(v.vs, v.vt) / 2));
let r0;

test('full throttle approaches top speed and the brake stops the craft', () => {
  const r = r0 = oval();
  const v = makeVehicleState(vehicleStats('corsair'));
  for (let i = 0; i < 60 * 20; i++) stepVehicle(r, v, { bits: IN.THROTTLE, steer: centre(v) }, DT);
  const sp = Math.hypot(v.vs, v.vt);
  assert.ok(sp > v.stats.topSpeed * 0.97 && sp <= v.stats.topSpeed + 0.01, `speed ${sp}`);
  for (let i = 0; i < 60 * 5; i++) stepVehicle(r, v, { bits: IN.BRAKE, steer: 0 }, DT);
  assert.ok(Math.hypot(v.vs, v.vt) < 0.5);
});

test('the craft is held inside the walls and loses speed hitting them', () => {
  const r = oval();
  const v = makeVehicleState(vehicleStats('corsair'));
  let hits = 0, maxT = 0;
  for (let i = 0; i < 60 * 10; i++) {
    stepVehicle(r, v, { bits: IN.THROTTLE, steer: i < 120 ? 0 : 1 }, DT);
    maxT = Math.max(maxT, Math.abs(v.t));
    if (v.wallHit) hits++;
  }
  assert.ok(maxT <= 12 - v.stats.width / 2 + 1e-6, `max |t| ${maxT}`);
  assert.ok(hits >= 1);
});

test('a track that curves under a straight-flying craft rotates its relative heading', () => {
  const r = oval();
  const v = makeVehicleState(vehicleStats('corsair'));
  // no steering on a bend: the craft drifts to the outside and its yaw swings away from the bend
  for (let i = 0; i < 60 * 3; i++) stepVehicle(r, v, { bits: IN.THROTTLE, steer: 0 }, DT);
  assert.notEqual(v.yaw, 0);
  assert.ok(Math.abs(v.t) > 0.5);
});

test('a crest launches the craft and it lands again', () => {
  const r = r0 = crest();
  const v = makeVehicleState(vehicleStats('kestrel'));
  let air = 0, landed = false;
  for (let i = 0; i < 60 * 30; i++) {
    stepVehicle(r, v, { bits: IN.THROTTLE, steer: centre(v) }, DT);
    if (!v.grounded) air++;
    else if (air > 0) landed = true;
  }
  assert.ok(air > 10, `airborne ticks ${air}`);
  assert.ok(landed);
  assert.equal(v.h, 0);
});

test('airbrakes tighten the turn', () => {
  const r = oval();
  const a = makeVehicleState(vehicleStats('corsair')), b = makeVehicleState(vehicleStats('corsair'));
  for (let i = 0; i < 60 * 3; i++) { stepVehicle(r, a, { bits: IN.THROTTLE, steer: 0 }, DT); stepVehicle(r, b, { bits: IN.THROTTLE, steer: 0 }, DT); }
  const y0 = a.yaw;
  for (let i = 0; i < 30; i++) { stepVehicle(r, a, { bits: IN.THROTTLE, steer: 1 }, DT); stepVehicle(r, b, { bits: IN.THROTTLE | IN.AIRBRAKE_R, steer: 1 }, DT); }
  assert.ok(b.yaw - y0 > a.yaw - y0);
});
