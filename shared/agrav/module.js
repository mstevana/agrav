// ============================================================================
// AGRAV game module — the contract the server drives (see
// shared/net/module-contract.md). Everything here delegates to sim/.
// ============================================================================

import { TICK_RATE, SNAPSHOT_RATE, PHASE } from './constants.js';
import { createRace, addRacer, removeRacer, setRacerProfile, startRace, applyRacerInput, stepRace,
         raceIsOver, raceResults, publicRaceState, validateOpts } from './sim/race.js';
import { encodeRaceSnapshot, decodeRaceSnapshot } from './sim/snapshot.js';
import { makeBot, botInput } from './bot.js';
import { VEHICLE_IDS } from './vehicles.js';

export default {
  id: 'agrav', name: 'AGRAV',
  minPlayers: 1, maxPlayers: 12,
  tickRate: TICK_RATE, snapshotRate: SNAPSHOT_RATE,
  defaultOpts: { track: 'meridian', laps: 3 },
  validateOpts,

  createMatch(opts, seed) { const race = createRace(opts, seed); race.bots = {}; return race; },
  addPlayer(state, id, profile, isBot) {
    if (isBot) {
      profile = { ...profile, vehicle: profile.vehicle || VEHICLE_IDS[id % VEHICLE_IDS.length], name: profile.name || `BOT ${id + 1}` };
      state.bots[id] = makeBot({ skill: 0.85 + ((id * 37) % 5) * 0.05, noise: 0.2, lane: ((id % 5) - 2) * 2.2, phase: id * 0.37 });
    }
    addRacer(state, id, profile, isBot);
  },
  removePlayer(state, id) { removeRacer(state, id); delete state.bots[id]; },
  setProfile(state, id, m) {
    const vehicle = VEHICLE_IDS.includes(m.vehicle) ? m.vehicle : undefined;
    return setRacerProfile(state, id, { vehicle, name: m.name });
  },
  publicState: publicRaceState,

  start: startRace,
  phase(state) { return state.phase; },
  applyInput(state, id, input) { applyRacerInput(state, id, input); },
  botInput(state, id, tick) {
    const r = state.byId[id];
    if (!r) return { bits: 0, steer: 0 };
    return botInput(state, r, state.bots[id] || (state.bots[id] = makeBot()), tick);
  },
  step: stepRace,
  onDisconnect(state, id) { const r = state.byId[id]; if (r) r.disconnected = true; },
  onReconnect(state, id) { const r = state.byId[id]; if (r) r.disconnected = false; },
  onAbandon(state, id) { const r = state.byId[id]; if (r) { r.abandoned = true; r.disconnected = true; if (!r.finished) { r.dead = true; r.deathTick = state.tick; } } },

  encodeSnapshot: encodeRaceSnapshot,
  decodeSnapshot: decodeRaceSnapshot,
  isOver: raceIsOver,
  results: raceResults,
  PHASE
};
