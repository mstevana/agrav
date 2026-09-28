// ============================================================================
// Spacewar game module — the contract the server drives (see
// shared/net/module-contract.md). Pure JS: the deterministic simulation lives
// in sim.js, the AI in bot.js, the wire format in snapshot.js.
//
// Up to four ships on a wrapping arena, optionally around a planet whose
// gravity pulls everything in. A match is rounds: the last ship flying takes
// the round, and the first to win `roundsToWin` rounds takes the match. A
// player's id is their seat, and the seat fixes the hull and colour. Any seat
// without a connected human — a lobby bot, a seat filled at the start, or a
// player who dropped mid-match — is flown by a bot.
// ============================================================================

import {
  TICK_RATE, SNAPSHOT_RATE, MAX_SHIPS, PHASE, SHIPS, DEFAULT_OPTIONS,
} from './constants.js';
import { createState, createShip, step as stepSim, startRound, shipsIn } from './sim.js';
import { createBotMemory, think, DIFFICULTIES } from './bot.js';
import { encodeSpacewarSnapshot, decodeSpacewarSnapshot } from './snapshot.js';

const ROUND_CHOICES = [1, 3, 5, 7, 10];

export function validateOpts(opts = {}) {
  let rounds = Math.round(Number(opts.roundsToWin));
  if (!Number.isFinite(rounds)) rounds = DEFAULT_OPTIONS.roundsToWin;
  rounds = Math.min(15, Math.max(1, rounds));
  return {
    roundsToWin: rounds,
    planet: opts.planet === undefined ? DEFAULT_OPTIONS.planet : !!opts.planet,
    botDifficulty: DIFFICULTIES[opts.botDifficulty] ? opts.botDifficulty : DEFAULT_OPTIONS.botDifficulty,
  };
}

const MIN_SHIPS = 2;
const inSeat = (id) => Number.isInteger(id) && id >= 0 && id < MAX_SHIPS;

const module = {
  id: 'spacewar', name: 'Spacewar',
  minPlayers: 1, maxPlayers: MAX_SHIPS,
  tickRate: TICK_RATE, snapshotRate: SNAPSHOT_RATE,
  defaultOpts: { ...DEFAULT_OPTIONS },
  validateOpts,
  ROUND_CHOICES, PHASE, SHIPS,

  createMatch(opts, seed) {
    const o = validateOpts(opts);
    const state = createState(o, seed);
    state.seed = seed >>> 0;
    state.botDifficulty = o.botDifficulty;
    state.control = new Array(MAX_SHIPS).fill(null);   // 'human' | 'bot' per seat taken
    state.input = new Array(MAX_SHIPS).fill(null);
    state.bots = new Array(MAX_SHIPS).fill(null);
    return state;
  },

  addPlayer(state, id, profile, isBot) {
    if (!inSeat(id)) return undefined;
    if (!state.ships[id]) state.ships[id] = createShip(id);
    state.control[id] = isBot ? 'bot' : 'human';
    return { ship: SHIPS[id].name, color: SHIPS[id].color };
  },
  removePlayer(state, id) {
    if (!inSeat(id)) return;
    state.ships[id] = null;
    state.control[id] = null;
    state.input[id] = null;
    state.bots[id] = null;
  },
  setProfile(state, id) { return inSeat(id) ? { ship: SHIPS[id].name, color: SHIPS[id].color } : undefined; },

  /** at least two ships fly. The lobby won't launch with fewer; this covers a client that tries anyway */
  fillBots() { return MIN_SHIPS; },

  publicState(state) {
    return {
      phase: state.phase,
      round: state.round,
      roundsToWin: state.opts.roundsToWin,
      planet: state.opts.planet,
      botDifficulty: state.botDifficulty,
      winner: state.winner,
      seats: SHIPS.map((s, id) => ({ id, ship: s.name, color: s.color })),
    };
  },

  start(state) {
    for (const s of shipsIn(state)) { s.wins = 0; s.kills = 0; s.deaths = 0; }
    state.winner = -1;
    state.round = 0;
    startRound(state);
  },
  phase(state) {
    switch (state.phase) {
      case 'play': return PHASE.PLAY;
      case 'outro': return PHASE.OUTRO;
      case 'over': return PHASE.OVER;
      default: return PHASE.INTRO;
    }
  },

  applyInput(state, id, input) {
    if (inSeat(id) && state.control[id] === 'human') state.input[id] = input;
  },
  botInput() { return { bits: 0, steer: 0 }; },   // bots are flown in step(), like dropped players

  step(state, tick, events) {
    const inputs = new Array(MAX_SHIPS);
    for (let id = 0; id < MAX_SHIPS; id++) {
      if (!state.ships[id]) continue;
      if (state.control[id] === 'human') inputs[id] = state.input[id];
      else {
        const mem = state.bots[id] || (state.bots[id] = createBotMemory(id, state.seed, state.botDifficulty));
        inputs[id] = think(state, id, mem);
      }
    }
    stepSim(state, inputs, events);
  },

  onDisconnect(state, id) { if (inSeat(id) && state.ships[id]) { state.control[id] = 'bot'; state.input[id] = null; } },
  onReconnect(state, id) { if (inSeat(id) && state.ships[id]) state.control[id] = 'human'; },
  onAbandon(state, id) { if (inSeat(id) && state.ships[id]) { state.control[id] = 'bot'; state.input[id] = null; } },

  encodeSnapshot(state) { return encodeSpacewarSnapshot(state); },
  decodeSnapshot(u8) { return decodeSpacewarSnapshot(u8); },
  isOver(state) { return state.phase === 'over'; },
  results(state) {
    const standings = shipsIn(state)
      .map((s) => ({ id: s.id, ship: SHIPS[s.id].name, color: SHIPS[s.id].color, wins: s.wins, kills: s.kills, deaths: s.deaths }))
      .sort((a, b) => b.wins - a.wins || b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
    return { winner: state.winner, rounds: state.round, roundsToWin: state.opts.roundsToWin, standings };
  },
};

export default module;
