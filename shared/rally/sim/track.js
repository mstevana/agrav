// ============================================================================
// A prepared track: the ribbon, the walls that follow it, the static obstacles
// inside the corridor, the pickup pads and the starting grid.
//
// Cars drive in world (x, z) and are free to spin, reverse and cross the road at
// any angle, so the ribbon is never their coordinate system — it is the
// reference that answers three questions: how far round am I (progress and
// laps), how far across am I (walls), and which way does the road go (the bots
// and the camera).
// ============================================================================

import { buildRibbon, frameAt, wrapS } from '../../sim/spline.js';
import { getTrack, TRACK_IDS } from '../tracks/index.js';
import { GRID, CAR } from '../constants.js';

const cache = new Map();

/** the prepared form of a track; built once per id and shared, since it is read-only */
export function buildTrack(id) {
  if (cache.has(id)) return cache.get(id);
  const def = getTrack(id);
  const ribbon = buildRibbon(def.points, { width: def.width });
  const track = {
    id: def.id, name: def.name, theme: def.theme, def, ribbon,
    length: ribbon.length,
    prize: def.prize ?? 1,
    obstacles: (def.obstacles || []).map((o, i) => {
      const s = wrapS(ribbon, o.s);
      const f = frameAt(ribbon, s);
      return { i, s, t: o.t, r: o.r, kind: o.kind || 'block',
               x: f.pos.x + f.right.x * o.t, z: f.pos.z + f.right.z * o.t, halfWidth: f.width / 2 };
    }),
    pads: (def.pads || []).map((p, i) => {
      const f = frameAt(ribbon, wrapS(ribbon, p.s));
      return { i, s: wrapS(ribbon, p.s), t: p.t, item: p.item, x: f.pos.x + f.right.x * p.t, z: f.pos.z + f.right.z * p.t };
    }),
    grid: [],
    bounds: bounds(ribbon)
  };
  for (let slot = 0; slot < 8; slot++) track.grid.push(gridSlot(ribbon, slot));
  cache.set(id, track);
  return track;
}

export const TRACK_LIST = TRACK_IDS;

/** where car number `slot` starts: two columns, the right one staggered back half a row */
function gridSlot(ribbon, slot) {
  const row = Math.floor(slot / GRID.cols), col = slot % GRID.cols;
  const back = GRID.backFromLine + row * GRID.rowGap + (col === 1 ? GRID.rowGap * 0.45 : 0);
  const s = wrapS(ribbon, -back);
  const t = (col - (GRID.cols - 1) / 2) * GRID.colGap * 2;
  const f = frameAt(ribbon, s);
  return { s, t, x: f.pos.x + f.right.x * t, z: f.pos.z + f.right.z * t, yaw: frameYaw(f) };
}

/** the heading of the road at a frame, in the same convention as a car's yaw */
export const frameYaw = (f) => Math.atan2(f.tangent.x, f.tangent.z);

/**
 * The point on the centreline nearest (x, z).
 *
 * `hint` is where the caller was last tick: a car moves at most a couple of
 * metres per tick, so a window around the hint is both far cheaper than a sweep
 * of the whole ribbon and immune to the near-miss that a global search hits
 * where a track doubles back on itself. Pass null for a cold search.
 */
export function nearestOnRibbon(ribbon, x, z, hint = null, window = 90) {
  const { frames, count, step } = ribbon;
  let bestI = 0, bestD = Infinity;
  if (hint == null) {
    for (let i = 0; i < count; i++) {
      const d = d2(frames[i].pos, x, z);
      if (d < bestD) { bestD = d; bestI = i; }
    }
  } else {
    const centre = Math.round(wrapS(ribbon, hint) / step);
    const span = Math.ceil(window / step);
    for (let k = -span; k <= span; k++) {
      const i = ((centre + k) % count + count) % count;
      const d = d2(frames[i].pos, x, z);
      if (d < bestD) { bestD = d; bestI = i; }
    }
  }
  // refine between the neighbouring frames
  let s = bestI * step;
  for (let h = step; h > 0.02; h *= 0.5) {
    for (const cand of [s - h, s + h]) {
      const d = d2(frameAt(ribbon, cand).pos, x, z);
      if (d < bestD) { bestD = d; s = cand; }
    }
  }
  s = wrapS(ribbon, s);
  const f = frameAt(ribbon, s);
  return { s, t: (x - f.pos.x) * f.right.x + (z - f.pos.z) * f.right.z, frame: f };
}

const d2 = (p, x, z) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);

/** the corners of the world the track occupies, with room for the scenery */
function bounds(ribbon) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const f of ribbon.frames) {
    const w = f.width / 2 + 4;
    minX = Math.min(minX, f.pos.x - w); maxX = Math.max(maxX, f.pos.x + w);
    minZ = Math.min(minZ, f.pos.z - w); maxZ = Math.max(maxZ, f.pos.z + w);
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * How far a car of radius `r` has pushed past the barrier at its nearest frame,
 * and which way the wall pushes back. Positive `pen` is a car in the wall.
 */
export function wallPenetration(near, r = CAR.radius) {
  const half = near.frame.width / 2;
  const side = near.t >= 0 ? 1 : -1;
  return { pen: Math.abs(near.t) + r - half, side };
}
