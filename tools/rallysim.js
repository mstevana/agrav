#!/usr/bin/env node
// ============================================================================
// Headless Scrap Rally: bots race each other with no server and no client, and
// the run reports what the simulation is actually doing — lap times, how much
// of the lap is spent against a barrier, hull left, and how often a race ends
// with a last car standing rather than a chequered flag.
//
//   node tools/rallysim.js                        one race per track, six bots
//   node tools/rallysim.js --laps 3 --races 5
//   node tools/rallysim.js --track scrapyard --difficulty hard --cars 6
//   node tools/rallysim.js --ladder               every car, alone, on every track
// ============================================================================

import rally from '../shared/rally/module.js';
import { TRACK_IDS, getTrack } from '../shared/rally/tracks/index.js';
import { CAR_IDS } from '../shared/rally/cars.js';
import { buildTrack } from '../shared/rally/sim/track.js';

const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const has = (name) => process.argv.includes(name);

const LAPS = parseInt(arg('--laps', '2'), 10);
const CARS = parseInt(arg('--cars', '6'), 10);
const RACES = parseInt(arg('--races', '3'), 10);
const DIFF = arg('--difficulty', 'normal');
const TRACKS = arg('--track', null) ? [arg('--track', null)] : [...TRACK_IDS];
const MAX_SEC = parseInt(arg('--max-seconds', '600'), 10);

/** one race; returns a row per car plus how it ended */
export function runRace({ track, laps, cars, difficulty, seed, profiles }) {
  const race = rally.createMatch({ track, laps, botDifficulty: difficulty, fillBots: true }, seed);
  for (let i = 0; i < cars; i++) rally.addPlayer(race, i, profiles ? profiles(i) : {}, true);
  rally.start(race, 0);
  const events = [];
  const wallTicks = new Map(), slideTicks = new Map();
  let tick = 0;
  const limit = MAX_SEC * 60;
  while (!rally.isOver(race) && tick < limit) {
    tick++;
    for (const c of race.cars) rally.applyInput(race, c.id, rally.botInput(race, c.id, tick));
    rally.step(race, tick, events);
    for (const c of race.cars) {
      if (c.c.scraping || c.c.wallHit) wallTicks.set(c.id, (wallTicks.get(c.id) || 0) + 1);
      if (c.c.sliding) slideTicks.set(c.id, (slideTicks.get(c.id) || 0) + 1);
    }
  }
  const results = rally.results(race);
  return {
    results, tick, timedOut: tick >= limit,
    rows: results.order.map(o => ({
      ...o,
      wallPct: 100 * (wallTicks.get(o.id) || 0) / Math.max(1, tick),
      slidePct: 100 * (slideTicks.get(o.id) || 0) / Math.max(1, tick)
    }))
  };
}

function pct(v) { return v.toFixed(1).padStart(5); }
function sec(v) { return v == null ? '    —' : v.toFixed(2).padStart(6); }

function fieldRun() {
  for (const track of TRACKS) {
    const t = buildTrack(track);
    console.log(`\n=== ${getTrack(track).name}  (${Math.round(t.length)} m, ${LAPS} laps, ${CARS} bots, ${DIFF}) ===`);
    let elim = 0, dnf = 0, lapTimes = [];
    for (let i = 0; i < RACES; i++) {
      const r = runRace({ track, laps: LAPS, cars: CARS, difficulty: DIFF, seed: 1000 + i * 7919 });
      if (r.results.byElimination) elim++;
      if (r.timedOut) console.log(`  race ${i + 1}: TIMED OUT after ${MAX_SEC}s`);
      for (const row of r.rows) {
        if (!row.finished) dnf++;
        if (row.bestLap) lapTimes.push(row.bestLap);
      }
      const head = r.rows[0];
      console.log(`  race ${i + 1}: won by ${head.name || ('#' + head.id)} (${head.car})` +
        `${r.results.byElimination ? ' — last car standing' : ` in ${sec(head.time)}s`}` +
        `   finishers ${r.rows.filter(x => x.finished).length}/${r.rows.length}`);
      for (const row of r.rows) {
        console.log(`     ${String(row.place).padStart(2)} ${(row.name || '#' + row.id).padEnd(7)} ${row.car.padEnd(9)}` +
          ` best ${sec(row.bestLap)}  hull ${String(row.hull).padStart(3)}/${row.maxHull}` +
          `  wall ${pct(row.wallPct)}%  slide ${pct(row.slidePct)}%${row.eliminated ? '  DEAD' : ''}`);
      }
    }
    const sorted = [...lapTimes].sort((a, b) => a - b);
    if (sorted.length) {
      const spread = 100 * (sorted[sorted.length - 1] - sorted[0]) / sorted[0];
      console.log(`  best laps ${sec(sorted[0])}s .. ${sec(sorted[sorted.length - 1])}s  (spread ${spread.toFixed(1)}%)` +
        `   elimination endings ${elim}/${RACES}   did not finish ${dnf}`);
    }
  }
}

/** every car alone on every track: the check that no tier is a dead end */
function ladderRun() {
  console.log(`\n=== one car alone, ${LAPS} lap(s), fully upgraded vs stock ===`);
  for (const track of TRACKS) {
    console.log(`\n  ${getTrack(track).name}`);
    for (const car of CAR_IDS) {
      const row = [];
      for (const level of [0, 4]) {
        const r = runRace({
          track, laps: LAPS, cars: 1, difficulty: DIFF, seed: 4242,
          profiles: () => ({ car, upgrades: { speed: level, handling: level, armour: level } })
        });
        const o = r.rows[0];
        row.push(`L${level} ${sec(o.bestLap)}s wall ${pct(r.rows[0].wallPct)}%`);
      }
      console.log(`    ${car.padEnd(9)} ${row.join('   ')}`);
    }
  }
}

if (has('--ladder')) ladderRun(); else fieldRun();
