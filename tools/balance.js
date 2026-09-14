// ============================================================================
// Vehicle balance: the same bot drives every craft alone around every track
// for three laps. Lap times must sit within TOLERANCE of the track mean, or
// a craft is simply better than the others.
//
//   node tools/balance.js [--tolerance 0.03] [--laps 3]
// ============================================================================

import module from '../shared/agrav/module.js';
import { VEHICLE_IDS } from '../shared/agrav/vehicles.js';
import { TRACK_IDS } from '../shared/agrav/tracks/index.js';
import { makeBot, botInput } from '../shared/agrav/bot.js';

const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const TOL = parseFloat(arg('--tolerance', '0.03'));
const LAPS = parseInt(arg('--laps', '3'), 10);

function soloLap(track, vehicle) {
  const st = module.createMatch({ track, laps: LAPS }, 11);
  module.addPlayer(st, 0, { vehicle }, false);
  const bot = makeBot({ skill: 1, noise: 0, lane: 0, phase: 0 });
  module.start(st, 0);
  const ev = [];
  let t = 0;
  while (!st.racers[0].finished && t < 60 * 600) {
    t++;
    module.applyInput(st, 0, botInput(st, st.racers[0], bot, t), t);
    module.step(st, t, ev);
  }
  const r = st.racers[0];
  return { best: r.bestLap, total: (r.finishTick - st.startTick) / 60, hp: r.hp, walls: ev.filter(e => e.t === 'wall').length };
}

let failed = false;
const table = {};
for (const track of TRACK_IDS) {
  table[track] = {};
  for (const v of VEHICLE_IDS) table[track][v] = soloLap(track, v);
  const totals = VEHICLE_IDS.map(v => table[track][v].total);
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  console.log(`\n${track.toUpperCase()}  (${LAPS} laps, mean ${mean.toFixed(1)} s)`);
  for (const v of VEHICLE_IDS) {
    const x = table[track][v];
    const dev = (x.total - mean) / mean;
    const flag = Math.abs(dev) > TOL ? '  <-- out of band' : '';
    if (flag) failed = true;
    console.log(`  ${v.padEnd(8)} total ${x.total.toFixed(1)} s  best lap ${x.best.toFixed(1)} s  ${(dev * 100 >= 0 ? '+' : '')}${(dev * 100).toFixed(1)}%  walls ${x.walls}  hp ${x.hp.toFixed(0)}${flag}`);
  }
}
console.log(failed ? `\nFAIL: a craft is more than ${TOL * 100}% from the mean` : `\nOK: every craft within ±${TOL * 100}% on every track`);
process.exit(failed ? 1 : 0);
