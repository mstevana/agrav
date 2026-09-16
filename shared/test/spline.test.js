import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildRibbon, frameAt, toWorld, deltaS, wrapS, nearestS, loopRuns } from '../sim/spline.js';
import { dist, dot } from '../sim/vec.js';
import { TRACKS } from '../agrav/tracks/index.js';

function circle(n = 24, R = 200) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push({ x: Math.cos(a) * R, y: 0, z: Math.sin(a) * R, width: 20 }); }
  return buildRibbon(pts);
}

/**
 * A rounded rectangle with a one-turn helix (a loop-the-loop, radius R, lateral
 * pitch p) in the middle of its first straight. `rotate` moves the seam (s = 0)
 * into the helix so a run straddling index 0 gets exercised.
 */
export function helixTrack({ R = 50, pitch = 42, N = 12, rotate = 0 } = {}) {
  const pts = [];
  pts.push({ x: 0, y: 0, z: -300 }, { x: 0, y: 0, z: -120 });
  for (let k = 0; k <= N; k++) { const a = k / N * Math.PI * 2; pts.push({ x: pitch * k / N, y: R * (1 - Math.cos(a)), z: R * Math.sin(a), loop: 1 }); }
  pts.push({ x: pitch, y: 0, z: 120 }, { x: pitch, y: 0, z: 300 });
  const far = pitch + 400;
  for (let k = 1; k < 6; k++) { const a = Math.PI - k / 6 * Math.PI; pts.push({ x: pitch + 200 + Math.cos(a) * 200, y: 0, z: 300 + Math.sin(a) * 200 }); }
  pts.push({ x: far, y: 0, z: 300 }, { x: far, y: 0, z: -300 });
  const r2 = far / 2;
  for (let k = 1; k < 6; k++) { const a = -k / 6 * Math.PI; pts.push({ x: r2 + Math.cos(a) * r2, y: 0, z: -300 + Math.sin(a) * r2 }); }
  const rot = [...pts.slice(rotate), ...pts.slice(0, rotate)];
  return buildRibbon(rot, { width: 24 });
}

test('the three shipped tracks build exactly the frames they always have', () => {
  // Every frame of every track, hashed. The loop-the-loop support in buildRibbon is gated on a
  // per-point `loop` flag none of these tracks carry, and this proves it is a no-op for them.
  // Regenerate only for an intentional change to the ribbon algorithm (see the golden.js
  // snippet in tools/ history): node --input-type=module -e "…buildRibbon… createHash('sha256')"
  const golden = {
    meridian: [1564, 'f66cb71566e6410c7e160c9dc28afc603239f42e02d4328b930a305ce1c93591'],
    canyon: [1346, 'dfe4c8e92b0d3bd44a4598c62b4951345ed55ae136a2c14bc6f58db6d0003972'],
    vanta: [1433, '412cb3336d23a14abefc63fba5c46d8200b67cbfd477f9fad820d3873406117a']
  };
  for (const id of Object.keys(golden)) {
    const t = TRACKS[id];
    const r = buildRibbon(t.points, { width: t.width });
    const a = new Float64Array(r.count * 17); let k = 0;
    for (const f of r.frames) {
      a[k++] = f.s; a[k++] = f.pos.x; a[k++] = f.pos.y; a[k++] = f.pos.z;
      a[k++] = f.tangent.x; a[k++] = f.tangent.y; a[k++] = f.tangent.z;
      a[k++] = f.right.x; a[k++] = f.right.y; a[k++] = f.right.z;
      a[k++] = f.up.x; a[k++] = f.up.y; a[k++] = f.up.z;
      a[k++] = f.width; a[k++] = f.bank; a[k++] = f.curvature; a[k++] = f.slope;
    }
    assert.equal(r.count, golden[id][0], `${id} frame count`);
    assert.equal(createHash('sha256').update(Buffer.from(a.buffer)).digest('hex'), golden[id][1], `${id} frames changed`);
    assert.equal(r.hasLoop, false);
    assert.ok(r.frames.every(f => f.loop === 0 && !f.isLoop));
  }
});

test('a loop-the-loop gets a continuous, inverting frame', () => {
  for (const rotate of [0, 8]) {
    const r = helixTrack({ rotate });
    assert.ok(r.hasLoop);
    const runs = loopRuns(r);
    assert.equal(runs.length, 1, `one run, got ${JSON.stringify(runs)}`);
    let minUpY = 1;
    for (let i = 0; i < r.count; i++) {
      const f = r.frames[i], g = r.frames[(i + 1) % r.count];
      assert.ok(Math.abs(dot(f.tangent, f.right)) < 1e-6 && Math.abs(dot(f.tangent, f.up)) < 1e-6, `orthogonal at ${i}`);
      assert.ok(Math.abs(dist(f.right, { x: 0, y: 0, z: 0 }) - 1) < 1e-6 && Math.abs(dist(f.up, { x: 0, y: 0, z: 0 }) - 1) < 1e-6, `unit at ${i}`);
      // a flip reads -1; the fixture's straight-to-circle join pitches the tangent ~11° per frame, which the frame follows
      assert.ok(dot(f.right, g.right) > 0.9 && dot(f.up, g.up) > 0.9, `no flip between ${i} and ${i + 1} (rotate ${rotate})`);
      assert.ok(f.loop > -0.11 && f.loop < 1.11);
      minUpY = Math.min(minUpY, f.up.y);
      // the heading formula would read π/(2·step) ≈ 0.79 where z reverses; in the road plane the fixture only jogs by its
      // lateral pitch where the straight meets the circle (a ~36 m radius, still inside tracklint's 28 m limit)
      if (f.isLoop) assert.ok(Math.abs(f.curvature) < 0.05, `in-plane curvature stays small on the loop: ${f.curvature} at ${i}`);
      else assert.ok(f.up.y > 0.9, `flat frames keep world up at ${i}`);
    }
    assert.ok(minUpY < -0.98, `the apex is inverted (min up.y ${minUpY})`);
    // interpolated frames at the apex are sound too
    const apexS = r.frames.reduce((best, f) => (f.up.y < best.up.y ? f : best), r.frames[0]).s + r.step * 0.4;
    const f = frameAt(r, apexS);
    assert.ok(Math.abs(dot(f.tangent, f.up)) < 1e-3 && f.up.y < -0.95 && f.loop >= 0 && f.loop <= 1 && f.isLoop);
    const under = toWorld(r, apexS, 0, 3);
    assert.ok(under.y < f.pos.y, 'h points down at the apex');
  }
});

test('flagging flat frames as loop changes nothing about them', () => {
  const n = 24, R = 200;
  const plain = [], flagged = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; const p = { x: Math.cos(a) * R, y: 0, z: Math.sin(a) * R, width: 20 }; plain.push(p); flagged.push({ ...p, loop: i < n / 2 ? 1 : 0 }); }
  const a = buildRibbon(plain), b = buildRibbon(flagged);
  assert.ok(b.hasLoop);
  for (let i = 0; i < a.count; i++) {
    assert.ok(Math.abs(a.frames[i].curvature - b.frames[i].curvature) < 1e-9, `curvature sign/magnitude at ${i}`);
    assert.ok(dot(a.frames[i].right, b.frames[i].right) > 1 - 1e-9 && dot(a.frames[i].up, b.frames[i].up) > 1 - 1e-9);
  }
});

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
