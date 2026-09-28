// Headless Spacewar: bots fly whole matches with no server, and we report how
// rounds end and how long they take. Useful when tuning physics or the bots.
//
//   node tools/spacewarsim.js [matches=5] [ships=4] [difficulty=normal] [planet=1]

import sw from '../shared/spacewar/module.js';

const [matches = 5, ships = 4, difficulty = 'normal', planet = '1'] = process.argv.slice(2);
const causes = {};
let rounds = 0, draws = 0, roundTicks = 0, torpsFired = 0, hypers = 0;
for (let m = 0; m < Number(matches); m++) {
  const state = sw.createMatch({ roundsToWin: 5, planet: planet !== '0', botDifficulty: difficulty }, 1234 + m * 77);
  for (let id = 0; id < Number(ships); id++) sw.addPlayer(state, id, {}, true);
  sw.start(state, 0);
  let tick = 0, roundStart = 0;
  while (!sw.isOver(state) && tick < 60 * 60 * 30) {
    const events = [];
    const before = state.nextTorpId;
    sw.step(state, ++tick, events);
    torpsFired += (state.nextTorpId - before + 0x10000) % 0x10000;
    for (const e of events) {
      if (e.kind === 'kill') causes[e.cause] = (causes[e.cause] || 0) + 1;
      if (e.kind === 'hyper') hypers++;
      if (e.kind === 'go') roundStart = tick;
      if (e.kind === 'round') { rounds++; roundTicks += tick - roundStart; if (e.winner < 0) draws++; }
    }
  }
  const r = sw.results(state);
  console.log(`match ${m + 1}: winner ${r.winner} after ${r.rounds} rounds, ${(tick / 60).toFixed(0)} s ·`,
    r.standings.map((s) => `${s.ship} ${s.wins}w ${s.kills}k ${s.deaths}d`).join(' | '));
}
console.log(`rounds ${rounds}, draws ${draws}, mean round ${(roundTicks / Math.max(1, rounds) / 60).toFixed(1)} s`);
console.log('deaths by cause', causes, `torpedoes ${torpsFired}, jumps ${hypers}`);
