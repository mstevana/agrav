#!/usr/bin/env node
// Headless bots-vs-bots Volley match. Handy for tuning physics and bot behaviour.
//   node tools/volleysim.js [pointsToWin] [teamSize] [difficulty...]
import { createState, step } from '../shared/volley/sim.js';
import { createBot } from '../shared/volley/bot.js';

const pointsToWin = Number(process.argv[2] || 15);
const teamSize = Number(process.argv[3] || 2);
const diffs = process.argv.slice(4);
const state = createState({ pointsToWin, teamSize });
const bots = state.blobs.map((b, i) => createBot(i, { difficulty: diffs[i] || diffs[0] || 'normal' }));
let rallies = 0;
let touches = 0;
let lastTick = 0;
let longest = 0;
while (state.phase !== 'over' && state.tick < 60 * 60 * 30) {
  const prevTouches = state.touches;
  step(state, bots.map((b) => b.think(state)));
  if (state.touches !== prevTouches && state.touches > 0) touches++;
  if (state.lastEvent && state.lastEvent.tick === state.tick - 1 && state.lastEvent.kind === 'point') {
    rallies++;
    longest = Math.max(longest, state.tick - lastTick);
    lastTick = state.tick;
    console.log(`point #${rallies}: ${state.lastEvent.reason.padEnd(7)} -> ${state.score.join(':')}`);
  }
}
console.log(`winner: team ${state.winner}, score ${state.score.join(':')}, ${rallies} rallies, ` +
  `${touches} touches, ${(state.tick / 60).toFixed(1)}s, longest rally ${(longest / 60).toFixed(1)}s`);
