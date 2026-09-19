#!/usr/bin/env node
// ============================================================================
// Track checks for Scrap Rally. Every rule here is one that has already cost
// something: an obstacle authored in world coordinates that landed inside a
// barrier and wedged two cars for a whole race is why the passage rule exists.
//
//   node tools/rallylint.js [trackId ...]
//
// Exits non-zero if any track fails, so it can sit in front of a commit.
// ============================================================================

import { frameAt } from '../shared/sim/spline.js';
import { buildTrack, nearestOnRibbon } from '../shared/rally/sim/track.js';
import { TRACK_IDS } from '../shared/rally/tracks/index.js';
import { carStats, CARS } from '../shared/rally/cars.js';
import { CAR, GRID, BOT } from '../shared/rally/constants.js';
import { carRadius, steerAuthority } from '../shared/rally/sim/car.js';

const RULES = {
  minPassage: 7,        // the widest free lane past an obstacle, in metres
  padClearance: 2.0,    // a pad must sit this far inside the barrier
  padSpacing: 40,       // metres between pads, so a lap is not one long buffet
  gridClearance: 1.5,   // every grid slot this far inside the barrier
  minCornerSpeed: 12,   // the slowest car must still be able to take the tightest bend this fast
  crossClearance: 3,    // two parts of the road this far apart in s must not come closer than this
  trapMargin: 1.6       // clearance a car needs beyond its own width to take a gap at speed
};

const targets = process.argv.slice(2).filter(a => !a.startsWith('-'));
const ids = targets.length ? targets : [...TRACK_IDS];
let failed = 0;

for (const id of ids) {
  const problems = [], notes = [];
  const track = buildTrack(id);
  const { ribbon } = track;
  const slowest = carStats(CARS[0].id, {});
  const slowRadius = carRadius(slowest);

  // --- the road itself
  let minWidth = Infinity, maxCurvature = 0, worstS = 0;
  for (const f of ribbon.frames) {
    if (f.width < minWidth) minWidth = f.width;
    if (Math.abs(f.curvature) > Math.abs(maxCurvature)) { maxCurvature = f.curvature; worstS = f.s; }
  }
  const tightest = cornerSpeed(slowest, maxCurvature);
  if (tightest < RULES.minCornerSpeed) {
    problems.push(`the bend at s=${worstS.toFixed(0)} (radius ${(1 / Math.abs(maxCurvature)).toFixed(0)} m) can only be taken at ` +
      `${tightest.toFixed(1)} m/s in a stock ${slowest.name}; the floor is ${RULES.minCornerSpeed}`);
  }

  // --- the road must not come back and touch itself
  const step = 4;
  const samples = [];
  for (let s = 0; s < ribbon.length; s += step) samples.push(frameAt(ribbon, s));
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const ds = Math.min(Math.abs(samples[j].s - samples[i].s), ribbon.length - Math.abs(samples[j].s - samples[i].s));
      if (ds < 60) continue;                       // neighbours along the same piece of road
      const a = samples[i], b = samples[j];
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      const need = (a.width + b.width) / 2 + RULES.crossClearance;
      if (d < need) {
        problems.push(`the road at s=${a.s.toFixed(0)} and s=${b.s.toFixed(0)} are ${d.toFixed(1)} m apart, ` +
          `which is inside their own width (${need.toFixed(1)} m needed)`);
        j = samples.length;                        // one report per stretch is enough
      }
    }
  }

  // --- obstacles must leave a lane, and must not leave a trap
  const carWidth = slowRadius * 2;
  for (const o of track.obstacles) {
    const left = (o.t - o.r) + o.halfWidth;
    const right = o.halfWidth - (o.t + o.r);
    const widest = Math.max(left, right);
    const narrowest = Math.min(left, right);
    if (widest < RULES.minPassage) {
      problems.push(`the ${o.kind} at s=${o.s.toFixed(0)} leaves only ${widest.toFixed(1)} m to get past ` +
        `(left ${left.toFixed(1)}, right ${right.toFixed(1)}); ${RULES.minPassage} m is the floor`);
    } else if (narrowest > 0 && narrowest < carWidth + RULES.trapMargin) {
      // the far side of this one is wide enough to aim at and too narrow to fit
      // through, which is not a chicane, it is somewhere cars get wedged
      problems.push(`the ${o.kind} at s=${o.s.toFixed(0)} leaves a ${narrowest.toFixed(1)} m slot on one side: ` +
        `too narrow for a car ${carWidth.toFixed(1)} m wide, wide enough to try. Close it against the barrier ` +
        `(push it out past t=${(o.t >= 0 ? o.halfWidth - o.r : -(o.halfWidth - o.r)).toFixed(1)}) or open it to ${(carWidth + RULES.trapMargin).toFixed(1)} m`);
    } else if (narrowest > RULES.minPassage) {
      notes.push(`the ${o.kind} at s=${o.s.toFixed(0)} can be passed on either side`);
    }
    const placed = nearestOnRibbon(ribbon, o.x, o.z, o.s);
    if (Math.abs(placed.s - o.s) > 2 && Math.abs(placed.s - o.s) < ribbon.length - 2) {
      problems.push(`the ${o.kind} says s=${o.s.toFixed(0)} but sits nearest s=${placed.s.toFixed(0)}`);
    }
  }

  // --- pads on the road, and spread round the lap
  const bySeq = [...track.pads].sort((a, b) => a.s - b.s);
  for (const p of track.pads) {
    const f = frameAt(ribbon, p.s);
    const clear = f.width / 2 - Math.abs(p.t);
    if (clear < RULES.padClearance) {
      problems.push(`the ${p.item} pad at s=${p.s.toFixed(0)} is ${clear.toFixed(1)} m from the barrier`);
    }
  }
  for (let i = 0; i < bySeq.length; i++) {
    const a = bySeq[i], b = bySeq[(i + 1) % bySeq.length];
    const gap = i === bySeq.length - 1 ? ribbon.length - a.s + b.s : b.s - a.s;
    if (gap > 0.5 && gap < RULES.padSpacing && !(Math.abs(a.s - b.s) < 0.5)) {
      problems.push(`the ${a.item} pad at s=${a.s.toFixed(0)} and the ${b.item} pad at s=${b.s.toFixed(0)} ` +
        `are ${gap.toFixed(0)} m apart; ${RULES.padSpacing} m is the floor`);
    }
  }

  // --- every car on the grid starts on the road, and six fit abreast of the line
  for (let slot = 0; slot < 6; slot++) {
    const g = track.grid[slot];
    const f = frameAt(ribbon, g.s);
    const clear = f.width / 2 - Math.abs(g.t) - slowRadius;
    if (clear < RULES.gridClearance) problems.push(`grid slot ${slot + 1} has ${clear.toFixed(1)} m to spare`);
  }
  const lineWidth = frameAt(ribbon, 0).width;
  const needed = GRID.colGap * 2 + slowRadius * 4;
  if (lineWidth < needed) problems.push(`the start line is ${lineWidth.toFixed(1)} m wide; the grid needs ${needed.toFixed(1)} m`);

  // --- report
  const head = `${track.name.padEnd(12)} ${Math.round(ribbon.length)} m, ${minWidth.toFixed(0)}–${Math.max(...ribbon.frames.map(f => f.width)).toFixed(0)} m wide, ` +
    `tightest bend ${(1 / Math.abs(maxCurvature)).toFixed(0)} m radius (${tightest.toFixed(0)} m/s), ` +
    `${track.obstacles.length} obstacles, ${track.pads.length} pads`;
  if (problems.length) {
    failed++;
    console.log(`FAIL  ${head}`);
    for (const p of problems) console.log(`        · ${p}`);
  } else {
    console.log(`ok    ${head}`);
    for (const n of notes) console.log(`        · ${n}`);
  }
}

/** the same two limits the bot plans around: the tyres, and the steering */
function cornerSpeed(stats, curvature) {
  const k = Math.abs(curvature);
  if (k < 1e-4) return Infinity;
  let v = Math.sqrt(stats.grip * CAR.slideThreshold * BOT.gripUse / k);
  for (let i = 0; i < 2; i++) v = Math.min(v, stats.yawRate * steerAuthority(v, stats) / k);
  return v;
}

process.exit(failed ? 1 : 0);
