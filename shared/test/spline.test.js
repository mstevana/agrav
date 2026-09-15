import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRibbon, frameAt, toWorld, deltaS, wrapS, nearestS } from '../sim/spline.js';
import { dist } from '../sim/vec.js';

function circle(n = 24, R = 200) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push({ x: Math.cos(a) * R, y: 0, z: Math.sin(a) * R, width: 20 }); }
  return buildRibbon(pts);
}

test('arc length and curvature of a circle', () => {
  const r = circle();
  assert.ok(Math.abs(r.length - 2 * Math.PI * 200) < 3);
  let integral = 0;
  for (const f of r.frames) integral += f.curvature * r.step;
  assert.ok(Math.abs(integral - 2 * Math.PI) < 0.01, `curvature integral ${integral}`);
  // this loop turns right (toward the centre, which is on the +right side)
  assert.ok(frameAt(r, 100).curvature > 0);
});

test('frames are orthonormal and toWorld honours the lateral offset', () => {
  const r = circle();
  for (const s of [0, 137.5, r.length - 1]) {
    const f = frameAt(r, s);
    const d = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    assert.ok(Math.abs(d(f.tangent, f.right)) < 1e-6);
    assert.ok(Math.abs(d(f.tangent, f.up)) < 1e-6);
    assert.ok(Math.abs(d(f.right, f.right) - 1) < 1e-6);
    const c = toWorld(r, s, 0, 0), o = toWorld(r, s, 7, 0), u = toWorld(r, s, 0, 3);
    assert.ok(Math.abs(dist(c, o) - 7) < 1e-6);
    assert.ok(Math.abs(dist(c, u) - 3) < 1e-6);
    assert.ok(u.y > c.y);
  }
});

test('deltaS and wrapS handle the seam', () => {
  const r = circle();
  const L = r.length;
  assert.ok(Math.abs(deltaS(r, L - 5, 3) - 8) < 1e-9);
  assert.ok(Math.abs(deltaS(r, 3, L - 5) + 8) < 1e-9);
  assert.ok(Math.abs(wrapS(r, -1) - (L - 1)) < 1e-9);
  assert.ok(Math.abs(wrapS(r, L + 2) - 2) < 1e-9);
});

test('nearestS finds the closest point on the loop', () => {
  const r = circle();
  const p = toWorld(r, 431.2, 4, 0);
  assert.ok(Math.abs(deltaS(r, nearestS(r, p), 431.2)) < 0.5);
});

test('banking rolls the frame about the tangent', () => {
  const pts = [];
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; pts.push({ x: Math.cos(a) * 200, y: 0, z: Math.sin(a) * 200, bank: 0.3 }); }
  const f = frameAt(buildRibbon(pts), 50);
  assert.ok(f.right.y > 0.25, 'positive bank raises the right side');
});
