// ============================================================================
// Volley game module — the contract the server drives (see
// shared/net/module-contract.md). Pure JS: the deterministic simulation lives
// in sim.js, the AI in bot.js, the wire format in snapshot.js.
//
// Volley is always 2 vs 2: four blob slots, ids 0..3, laid out left to right
//   0 Blue back | 1 Blue front |net| 2 Red front | 3 Red back
// so a player's id is its blob slot. The server assigns ids 0..3 in join order
// and hands them to addPlayer. Any slot without a connected human — an empty
// seat the host never filled, a lobby bot, or a player who dropped mid-match —
// is driven by a bot, so one player can start alone and get three bots.
// ============================================================================

import { TICK_RATE, SNAPSHOT_RATE, PHASE, TEAM_NAMES, MAX_TOUCHES } from './constants.js';
import { createState, step as stepSim, slotTeam, NO_INPUT } from './sim.js';
import { createBot, DIFFICULTIES } from './bot.js';
import { encodeVolleySnapshot, decodeVolleySnapshot } from './snapshot.js';

const TEAM_SIZE = 2;          // fixed: 2 vs 2
const SLOTS = TEAM_SIZE * 2;  // four blobs

/** turn a wire input {bits, steer} into the simulation's {left, right, jump} */
function toMove(input) {
  if (!input) return NO_INPUT;
  const steer = input.steer || 0;
  return { left: steer < -0.3, right: steer > 0.3, jump: !!(input.bits & 1) };
}

export function validateOpts(opts = {}) {
  let pts = Number(opts.pointsToWin);
  if (!Number.isFinite(pts)) pts = 15;
  pts = Math.min(50, Math.max(1, Math.round(pts)));
  const bot = DIFFICULTIES[opts.botDifficulty] ? opts.botDifficulty : 'normal';
  return { pointsToWin: pts, botDifficulty: bot };
}

export default {
  id: 'volley', name: 'Volley',
  minPlayers: 1, maxPlayers: SLOTS,
  tickRate: TICK_RATE, snapshotRate: SNAPSHOT_RATE,
  defaultOpts: { pointsToWin: 15, botDifficulty: 'normal' },
  validateOpts,

  createMatch(opts, seed) {
    const o = validateOpts(opts);
    const state = createState({ teamSize: TEAM_SIZE, pointsToWin: o.pointsToWin });
    state.botDifficulty = o.botDifficulty;
    state.seed = seed >>> 0;
    state.control = new Array(SLOTS).fill('bot'); // 'human' | 'bot'; unfilled seats play as bots
    state.brains = new Array(SLOTS).fill(null);
    state.move = new Array(SLOTS).fill(null);     // latest human move for each slot
    state.lastSentEventTick = -1;
    return state;
  },

  addPlayer(state, id, profile, isBot) {
    if (id < 0 || id >= SLOTS) return;
    state.control[id] = isBot ? 'bot' : 'human';
    if (isBot && !state.brains[id]) state.brains[id] = makeBrain(state, id);
  },
  removePlayer(state, id) {
    if (id < 0 || id >= SLOTS) return;
    state.control[id] = 'bot';   // the seat keeps playing as a bot
    state.move[id] = null;
  },
  setProfile(state, id, m) { return { name: typeof m?.name === 'string' ? m.name.slice(0, 16) : undefined }; },

  publicState(state) {
    return {
      teamSize: TEAM_SIZE,
      pointsToWin: state.options.pointsToWin,
      botDifficulty: state.botDifficulty,
      score: [...state.score],
      serving: state.serving,
      phase: state.phase,
      winner: state.winner,
      slots: state.blobs.map((b) => ({
        slot: b.slot, team: b.team, teamName: TEAM_NAMES[b.team],
        role: b.slot === 0 || b.slot === SLOTS - 1 ? 'back' : 'front',
      })),
    };
  },

  start(state) { /* the sim is already at serve; nothing to do */ },
  phase(state) { return state.phase === 'over' ? PHASE.OVER : state.phase === 'point' ? PHASE.POINT : PHASE.PLAY; },

  applyInput(state, id, input) {
    if (id < 0 || id >= SLOTS) return;
    if (state.control[id] === 'human') state.move[id] = toMove(input);
  },
  botInput() { return { bits: 0, steer: 0 }; }, // bot movement is decided in step()

  step(state, tick, events) {
    // assemble one move per slot: the human's if connected, otherwise the bot's
    const inputs = new Array(SLOTS);
    for (let id = 0; id < SLOTS; id++) {
      if (state.control[id] === 'human' && state.move[id]) {
        inputs[id] = state.move[id];
      } else {
        const brain = state.brains[id] || (state.brains[id] = makeBrain(state, id));
        inputs[id] = brain.think(state);
      }
    }
    stepSim(state, inputs);
    // surface a scored point / match end as a reliable event exactly once
    const ev = state.lastEvent;
    if (ev && ev.tick !== state.lastSentEventTick && (ev.kind === 'point' || ev.kind === 'over')) {
      state.lastSentEventTick = ev.tick;
      events.push(ev.kind === 'point'
        ? { kind: 'point', team: ev.team, reason: ev.reason, score: ev.score }
        : { kind: 'over', team: ev.team, score: ev.score });
    }
  },

  onDisconnect(state, id) { if (id >= 0 && id < SLOTS) { state.control[id] = 'bot'; state.move[id] = null; } },
  onReconnect(state, id) { if (id >= 0 && id < SLOTS) state.control[id] = 'human'; },
  onAbandon(state, id) { if (id >= 0 && id < SLOTS) { state.control[id] = 'bot'; state.move[id] = null; } },

  encodeSnapshot(state) { return encodeVolleySnapshot(state); },
  decodeSnapshot(u8) { return decodeVolleySnapshot(u8); },
  isOver(state) { return state.phase === 'over'; },
  results(state) {
    const winner = state.winner;
    return {
      winner, winnerName: winner >= 0 ? TEAM_NAMES[winner] : null,
      score: [...state.score],
      teams: TEAM_NAMES.map((name, team) => ({ team, name, score: state.score[team], won: team === winner })),
    };
  },
  PHASE, MAX_TOUCHES, TEAM_SIZE,
};

function makeBrain(state, id) {
  return createBot(id, {
    difficulty: state.botDifficulty || 'normal',
    seed: (((state.seed || 1) >>> 0) + id * 0x9e3779b1) >>> 0,
  });
}
