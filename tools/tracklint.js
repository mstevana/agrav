// ============================================================================
// Track validation + stats.
//
//   node tools/tracklint.js [trackId ...]
//
// Builds each track's ribbon and checks the things that make a track
// unraceable: width never below the two-abreast minimum, no bend tighter than a
// craft can take at a sane speed, no two non-adjacent stretches of track
// closer than their combined width (self-intersection / overlap without a
// height gap), every pad on the track, and every jump landable. It then prints
// the numbers a designer wants: length, corner count, elevation range, jumps.
// ============================================================================

import { TRACKS } from '../shared/agrav/tracks/index.js';
import { buildRibbon, frameAt, toWorld, loopRuns } from '../shared/sim/spline.js';
import { vehicleStats } from '../shared/agrav/vehicles.js';
import module from '../shared/agrav/module.js';
import { makeBot, botInput } from '../shared/agrav/bot.js';

const MIN_WIDTH = 16;
const MAX_CURVATURE = 1 / 28;      // radius 28 m: an airbraked craft makes it at speed; tighter is a wall
const CORNER_CURVATURE = 0.0055;   // radius ~180 m counts as a corner
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TRACKS);
let failed = false;

for (const id of ids) {
  const track = TRACKS[id];
  if (!track) { console.error(`unknown track ${id}`); failed = true; continue; }
  const r = buildRibbon(track.points, { width: track.width });
  const problems = [];
  let minW = Infinity, maxK = 0, minY = Infinity, maxY = -Infinity;
  for (const f of r.frames) {
    minW = Math.min(minW, f.width); maxK = Math.max(maxK, Math.abs(f.curvature));
    minY = Math.min(minY, f.pos.y); maxY = Math.max(maxY, f.pos.y);
  }
  if (minW < MIN_WIDTH) problems.push(`width ${minW.toFixed(1)} m < ${MIN_WIDTH}`);
  if (maxK > MAX_CURVATURE) problems.push(`bend radius ${(1 / maxK).toFixed(0)} m tighter than ${1 / MAX_CURVATURE}`);

  // overlap: frames closer than combined half-widths + margin, with no 8 m height gap
  for (let i = 0; i < r.count; i += 2) {
    const a = r.frames[i];
    for (let j = i + 40; j < r.count; j += 2) {
      if ((r.count - j + i) < 40) continue;   // adjacent across the seam
      const b = r.frames[j];
      const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
      const need = (a.width + b.width) / 2 + 6;
      if (dx * dx + dz * dz < need * need && Math.abs(a.pos.y - b.pos.y) < 8) {
        problems.push(`track overlaps itself near s=${a.s.toFixed(0)} and s=${b.s.toFixed(0)} (dy ${(a.pos.y - b.pos.y).toFixed(1)})`);
        i = r.count; break;
      }
    }
  }
  // corners: contiguous runs of |curvature| above the threshold, at least 20 m long
  let corners = 0, run = 0, left = 0, right = 0, sign = 0;
  for (const f of r.frames) {
    const k = f.curvature;
    if (Math.abs(k) > CORNER_CURVATURE && (sign === 0 || Math.sign(k) === sign)) { run += r.step; sign = Math.sign(k); }
    else { if (run >= 20) { corners++; if (sign > 0) right++; else left++; } run = 0; sign = Math.abs(k) > CORNER_CURVATURE ? Math.sign(k) : 0; if (sign) run = r.step; }
  }
  if (run >= 20) { corners++; if (sign > 0) right++; else left++; }
  // banking sign check: bank should lift the outside (negative on right-handers)
  let badBank = 0;
  for (const f of r.frames) if (Math.abs(f.curvature) > CORNER_CURVATURE && Math.abs(f.bank) > 0.05 && Math.sign(f.bank) === Math.sign(f.curvature)) badBank++;
  if (badBank > r.count * 0.02) problems.push(`${badBank} frames banked toward the inside of the bend`);
  // loop-the-loops: never banked, and the run must start and end on shallow ground so the frame hand-over is clean
  const loops = loopRuns(r);
  const bankedLoop = r.frames.filter(f => f.isLoop && Math.abs(f.bank) > 0.01).length;
  if (bankedLoop) problems.push(`${bankedLoop} loop frames are banked`);
  for (const [a, b] of loops) {
    const before = r.frames[(a - 1 + r.count) % r.count], after = r.frames[(b + 1) % r.count];
    if (Math.abs(before.slope) > 0.35 || Math.abs(after.slope) > 0.35) problems.push(`the loop at s=${r.frames[a].s.toFixed(0)} must start and end on a shallow slope`);
  }
  // pads on the surface
  for (const row of track.pads) {
    if (row.s < 0 || row.s > r.length) problems.push(`pad row at s=${row.s} is off the ${r.length.toFixed(0)} m loop`);
    const f = frameAt(r, row.s);
    for (const t of row.lanes) if (Math.abs(t) > f.width / 2 - 2) problems.push(`pad at s=${row.s} t=${t} is in the wall`);
  }
  // jumps and drivability: the bot drives the fastest craft for two laps
  const st = module.createMatch({ track: id, laps: 2 }, 5);
  module.addPlayer(st, 0, { vehicle: 'kestrel' }, false);
  const bot = makeBot({ skill: 1, noise: 0, lane: 0, phase: 0 });
  module.start(st, 0);
  const racer = st.racers[0], v = racer.v;
  const jumps = [];
  let air = 0, airStart = 0, maxH = 0, hardest = 0, hardestWall = 0, wallHits = 0, tick = 0, tightest = { k: 0, s: 0 };
  for (const f of r.frames) if (Math.abs(f.curvature) > Math.abs(tightest.k)) tightest = { k: f.curvature, s: f.s };
  const ev = [];
  while (!racer.finished && tick < 60 * 400) {
    tick++;
    module.applyInput(st, 0, botInput(st, racer, bot, tick), tick);
    module.step(st, tick, ev);
    if (!v.grounded) { if (!air) airStart = v.s; air++; maxH = Math.max(maxH, v.h); }
    else if (air) {
      if (air >= 6) jumps.push({ s: airStart, sec: air / 60, maxH, landing: v.landing });
      hardest = Math.max(hardest, v.landing);
      air = 0; maxH = 0;
    }
    if (v.wallHit) { wallHits++; hardestWall = Math.max(hardestWall, v.wallHit); }
  }
  if (!racer.finished) problems.push('the bot could not finish two laps');
  if (racer.dead) problems.push('the bot died driving alone');
  if (hardestWall > 45) problems.push(`the bot hit a wall at ${hardestWall.toFixed(0)} m/s: a bend is too tight for its approach speed`);
  const uniq = []; for (const j of jumps) if (!uniq.some(u => Math.abs(u.s - j.s) < 30)) uniq.push(j);

  const ok = problems.length === 0;
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${track.name} (${id})`);
  console.log(`     length ${r.length.toFixed(0)} m · width ${minW.toFixed(0)}–${Math.max(...r.frames.map(f => f.width)).toFixed(0)} m · tightest radius ${(1 / maxK).toFixed(0)} m`);
  console.log(`     corners ${corners} (${left} left, ${right} right) · elevation ${minY.toFixed(0)}..${maxY.toFixed(0)} m (${(maxY - minY).toFixed(0)} m range) · pads ${track.pads.reduce((n, p) => n + p.lanes.length, 0)} in ${track.pads.length} rows · loops ${loops.length}`);
  console.log(`     jumps ${uniq.length}: ${uniq.map(j => `s=${j.s.toFixed(0)} ${j.sec.toFixed(2)}s h=${j.maxH.toFixed(1)}m land=${j.landing.toFixed(0)}`).join(', ') || 'none'} · hardest landing ${hardest.toFixed(0)} m/s`);
  console.log(`     bot (kestrel): best lap ${racer.bestLap ? racer.bestLap.toFixed(1) : '-'} s · wall hits ${wallHits} (hardest ${hardestWall.toFixed(0)} m/s) · hp left ${racer.hp.toFixed(0)} · tightest bend at s=${tightest.s.toFixed(0)}`);
  for (const p of problems) console.log(`     ! ${p}`);
}
process.exit(failed ? 1 : 0);
