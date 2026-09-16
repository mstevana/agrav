// ============================================================================
// Closed Catmull-Rom track spline sampled into a "ribbon": an arc-length
// table of frames (position, tangent, right, up, width, bank, curvature,
// slope). Vehicles live in ribbon coordinates (s along, t across, h above),
// and both the server and the client convert to world space through this.
//
// Sampling is O(1): frames are stored every STEP metres and interpolated.
// ============================================================================

import { v3, add, sub, scale, cross, norm, dot, len, lerp, clamp } from './vec.js';

export const STEP = 2;   // metres between stored frames

function catmull(p0, p1, p2, p3, u) {
  const u2 = u * u, u3 = u2 * u;
  const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), z: f(p0.z, p1.z, p2.z, p3.z) };
}
function catmullScalar(a, b, c, d, u) {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
}

// ---------------------------------------------------------------- loops ----
// A vertical loop-the-loop cannot be framed against world up (the road never
// inverts and `right` flips where the tangent goes vertical), so control points
// carry `loop: 1` through the loop. Those frames get a rotation-minimising
// (parallel-transported) basis seeded from the frame before the run, and the
// twist it accumulates is spread linearly along the run so it rejoins the
// world-up frame at the exit. On a helix that is exactly the Frenet frame with
// `up` toward the axis. Tracks without the flag never enter any of this.
const worldUp = v3(0, 1, 0);
function worldUpBasis(tangent) {
  let right = norm(cross(tangent, worldUp));
  if (len(right) < 1e-3) right = v3(1, 0, 0);
  const up = norm(cross(right, tangent));
  return [right, up];
}
function rollBasis(right, up, b) {
  const cb = Math.cos(b), sb = Math.sin(b);
  return [add(scale(right, cb), scale(up, sb)), sub(scale(up, cb), scale(right, sb))];
}
/** contiguous runs of loop frames as [a, b] index pairs, wrap-aware */
function loopRunsOf(frames, count) {
  let off = 0;
  while (off < count && frames[off].isLoop) off++;
  if (off === count) throw new Error('a track cannot be a loop everywhere');
  const runs = [];
  let start = -1;
  for (let k = 0; k <= count; k++) {
    const i = (off + k) % count;
    const on = k < count && frames[i].isLoop;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { runs.push([start, (i - 1 + count) % count]); start = -1; }
  }
  return runs;
}
export function loopRuns(ribbon) { return ribbon.hasLoop ? loopRunsOf(ribbon.frames, ribbon.count) : []; }
function transportLoops(frames, count) {
  for (const [a, b] of loopRunsOf(frames, count)) {
    const k = ((b - a + count) % count) + 1;
    let [r, u] = worldUpBasis(frames[(a - 1 + count) % count].tangent);   // unbanked seed
    const rT = [], uT = [];
    for (let m = 0; m < k; m++) {
      const T = frames[(a + m) % count].tangent;
      r = norm(sub(r, scale(T, dot(r, T))));   // previous right projected onto the plane ⊥ tangent
      u = norm(cross(r, T));
      rT.push(r); uT.push(u);
    }
    // the twist between the transported basis and the world-up basis at the run's end, in roll's own terms
    const [rW] = worldUpBasis(frames[b].tangent);
    const phi = Math.atan2(dot(rW, uT[k - 1]), dot(rW, rT[k - 1]));
    for (let m = 0; m < k; m++) {
      const i = (a + m) % count;
      let [rr, uu] = rollBasis(rT[m], uT[m], phi * (m + 1) / k);
      if (frames[i].bank) [rr, uu] = rollBasis(rr, uu, frames[i].bank);
      frames[i].right = rr; frames[i].up = uu;
    }
  }
}

/**
 * @param {Array<{x,y,z,width?,bank?,loop?}>} points  control points of a closed loop
 * @returns ribbon
 */
export function buildRibbon(points, opts = {}) {
  const n = points.length;
  if (n < 4) throw new Error('a track needs at least 4 control points');
  const defaultWidth = opts.width ?? 24;
  const P = (i) => points[((i % n) + n) % n];
  const W = (i) => P(i).width ?? defaultWidth;
  const B = (i) => P(i).bank ?? 0;
  const L = (i) => P(i).loop ?? 0;

  // dense pre-sample to measure arc length, then resample at STEP
  const dense = [];
  const SUB = 24;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < SUB; k++) {
      const u = k / SUB;
      dense.push({
        p: catmull(P(i - 1), P(i), P(i + 1), P(i + 2), u),
        w: catmullScalar(W(i - 1), W(i), W(i + 1), W(i + 2), u),
        b: catmullScalar(B(i - 1), B(i), B(i + 1), B(i + 2), u),
        l: catmullScalar(L(i - 1), L(i), L(i + 1), L(i + 2), u)
      });
    }
  }
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) cum.push(cum[i - 1] + len(sub(dense[i % dense.length].p, dense[i - 1].p)));
  const length = cum[dense.length];
  const count = Math.max(8, Math.round(length / STEP));
  const step = length / count;

  const frames = new Array(count);
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = i * step;
    while (j < dense.length - 1 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const u = (s - cum[j]) / seg;
    const a = dense[j], b = dense[(j + 1) % dense.length];
    frames[i] = { s, pos: lerp(a.p, b.p, u), width: a.w + (b.w - a.w) * u, bank: a.b + (b.b - a.b) * u, loop: a.l + (b.l - a.l) * u };
    frames[i].isLoop = frames[i].loop > 0.5;
  }
  const hasLoop = frames.some(f => f.isLoop);
  // tangents by central difference, then a stable up/right basis
  for (let i = 0; i < count; i++) {
    const prev = frames[(i - 1 + count) % count].pos, next = frames[(i + 1) % count].pos;
    const tangent = norm(sub(next, prev));
    let right = norm(cross(tangent, worldUp));
    if (len(right) < 1e-3) right = v3(1, 0, 0);
    let up = norm(cross(right, tangent));
    // bank: roll the basis about the tangent
    const b = frames[i].bank;
    if (b) {
      const cb = Math.cos(b), sb = Math.sin(b);
      const r2 = add(scale(right, cb), scale(up, sb));
      const u2 = sub(scale(up, cb), scale(right, sb));
      right = r2; up = u2;
    }
    frames[i].tangent = tangent;
    frames[i].right = right;
    frames[i].up = up;
    // slope: vertical rise per metre travelled (world y along tangent)
    frames[i].slope = tangent.y;
  }
  if (hasLoop) transportLoops(frames, count);
  // signed yaw curvature (rad/m): rotation of the horizontal tangent per metre.
  // positive = turning right (toward +right)
  for (let i = 0; i < count; i++) {
    const t0 = frames[(i - 1 + count) % count].tangent, t1 = frames[(i + 1) % count].tangent;
    if (frames[i].isLoop) {
      // through a loop the heading formula below spikes where z reverses; measure the turn in the road plane instead
      const u = frames[i].up;
      const p0 = sub(t0, scale(u, dot(t0, u))), p1 = sub(t1, scale(u, dot(t1, u)));
      const ang = Math.atan2(dot(cross(p0, p1), u), dot(p0, p1));
      frames[i].curvature = -ang / (2 * step);
      continue;
    }
    const a0 = Math.atan2(t0.x, t0.z), a1 = Math.atan2(t1.x, t1.z);
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    // heading measured as atan2(x, z): increasing angle is a turn toward +x when facing +z.
    // right = tangent × up; for tangent (0,0,1) right is (-1,0,0)... so flip the sign
    const r = frames[i].right;
    const turnRight = dot(cross(t0, t1), frames[i].up) < 0 ? 1 : -1;
    frames[i].curvature = Math.abs(d) / (2 * step) * turnRight;
    void r;
  }
  return { frames, length, step, count, points, hasLoop };
}

/** frame at s (wrapped), interpolated between stored frames */
export function frameAt(ribbon, s) {
  const L = ribbon.length;
  s = ((s % L) + L) % L;
  const f = s / ribbon.step;
  const i = Math.floor(f);
  const u = f - i;
  const a = ribbon.frames[i % ribbon.count], b = ribbon.frames[(i + 1) % ribbon.count];
  return {
    s,
    pos: lerp(a.pos, b.pos, u),
    tangent: norm(lerp(a.tangent, b.tangent, u)),
    right: norm(lerp(a.right, b.right, u)),
    up: norm(lerp(a.up, b.up, u)),
    width: a.width + (b.width - a.width) * u,
    bank: a.bank + (b.bank - a.bank) * u,
    curvature: a.curvature + (b.curvature - a.curvature) * u,
    slope: a.slope + (b.slope - a.slope) * u,
    loop: clamp(a.loop + (b.loop - a.loop) * u, 0, 1),
    isLoop: a.isLoop || b.isLoop
  };
}

/** world position of ribbon coordinates (s, t, h) */
export function toWorld(ribbon, s, t, h = 0) {
  const f = frameAt(ribbon, s);
  return {
    x: f.pos.x + f.right.x * t + f.up.x * h,
    y: f.pos.y + f.right.y * t + f.up.y * h,
    z: f.pos.z + f.right.z * t + f.up.z * h,
    frame: f
  };
}

/** signed distance along the loop from a to b in the forward direction, in (-L/2, L/2] */
export function deltaS(ribbon, a, b) {
  const L = ribbon.length;
  let d = (b - a) % L;
  if (d > L / 2) d -= L;
  if (d <= -L / 2) d += L;
  return d;
}

export const wrapS = (ribbon, s) => ((s % ribbon.length) + ribbon.length) % ribbon.length;

/**
 * nearest s on the ribbon to a world point (coarse frame search then a local
 * refine). Used by tools and the client camera, not by the hot path.
 */
export function nearestS(ribbon, p) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < ribbon.count; i += 4) {
    const q = ribbon.frames[i].pos;
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  let s = best * ribbon.step;
  for (let stepSize = ribbon.step * 2; stepSize > 0.05; stepSize /= 2) {
    for (const cand of [s - stepSize, s + stepSize]) {
      const q = frameAt(ribbon, cand).pos;
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
      if (d < bd) { bd = d; s = cand; }
    }
  }
  return wrapS(ribbon, s);
}
