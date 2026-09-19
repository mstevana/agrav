// ============================================================================
// Scrap Rally game module — the contract the server drives (see
// shared/net/module-contract.md). Everything here delegates to sim/.
// ============================================================================

import { TICK_RATE, SNAPSHOT_RATE, PHASE } from './constants.js';
import { createRace, addCar, removeCar, setCarProfile, publicProfile, startRace, holdRace, armRace,
         applyCarInput, stepRace, raceIsOver, raceResults, publicRaceState, validateOpts } from './sim/race.js';
import { encodeRallySnapshot, decodeRallySnapshot } from './sim/snapshot.js';
import { botFor, botInput } from './bot.js';
import { CAR_IDS, isCarId } from './cars.js';
import { TRACK_IDS } from './tracks/index.js';

/** a bot's car: the average of the humans in the room, so nobody is fed to a Valkyrie */
function botProfile(race, id) {
  const humans = race.cars.filter(c => !c.bot);
  const tiers = humans.map(c => c.stats.tier);
  const avg = tiers.length ? tiers.reduce((a, b) => a + b, 0) / tiers.length : 0;
  const spread = [-1, 0, 1, 0, -1, 1][id % 6];
  const tier = Math.max(0, Math.min(CAR_IDS.length - 1, Math.round(avg + spread)));
  const level = Math.max(0, Math.min(4, Math.round(avg / 5 * 4)));
  return {
    car: CAR_IDS[tier],
    upgrades: { speed: level, handling: level, armour: level },
    bumper: tier >= 3,
    name: `BOT ${id + 1}`
  };
}

export default {
  id: 'rally', name: 'Scrap Rally',
  minPlayers: 1, maxPlayers: 6,
  tickRate: TICK_RATE, snapshotRate: SNAPSHOT_RATE,
  defaultOpts: { track: TRACK_IDS[0], laps: 3, botDifficulty: 'normal', fillBots: true },
  validateOpts,

  createMatch(opts, seed) { const race = createRace(opts, seed); race.bots = {}; return race; },

  addPlayer(state, id, profile, isBot) {
    const p = isBot ? { ...botProfile(state, id), ...profile } : profile;
    addCar(state, id, p, isBot);
    if (isBot) state.bots[id] = botFor(state.opts.botDifficulty, id, state.seed);
  },
  removePlayer(state, id) { removeCar(state, id); delete state.bots[id]; },

  /** the client may pick only among what its record owns; the record itself is set by setCareer */
  setProfile(state, id, m) {
    const c = state.byId[id];
    if (!c) return null;
    const owned = state.owned?.[id];
    const want = {
      car: isCarId(m?.car) && (!owned || owned.car === m.car) ? m.car : c.stats.id,
      upgrades: c.stats.upgrades, bumper: c.stats.bumper, hull: c.hull,
      name: typeof m?.name === 'string' ? m.name : c.name,
      weapon: owned && !owned.weapons?.includes(m?.weapon) ? c.weapon : m?.weapon
    };
    return setCarProfile(state, id, want);
  },

  /** the server seats a player from their durable record; nothing here is client-supplied */
  setCareer(state, id, career) {
    const c = state.byId[id];
    if (!c) return null;
    (state.owned || (state.owned = {}))[id] = { car: career.car, weapons: career.weapons || ['machinegun'] };
    return setCarProfile(state, id, {
      car: career.car, upgrades: career.upgrades, bumper: career.bumper,
      hull: career.hull, weapon: career.weapon, name: c.name
    });
  },

  /** every seat nobody took becomes a bot at the flag, unless the host said not to */
  fillBots(state, opts) { return (opts ?? state.opts).fillBots !== false; },

  publicState: publicRaceState,

  start: startRace,
  hold: holdRace,
  arm: armRace,
  phase(state) { return state.phase; },
  applyInput(state, id, input) { applyCarInput(state, id, input); },
  botInput(state, id, tick) {
    const c = state.byId[id];
    if (!c) return { bits: 0, steer: 0 };
    const bot = state.bots[id] || (state.bots[id] = botFor(state.opts.botDifficulty, id, state.seed));
    return botInput(state, c, bot, tick);
  },
  step: stepRace,

  onDisconnect(state, id) { const c = state.byId[id]; if (c) c.disconnected = true; },
  onReconnect(state, id) { const c = state.byId[id]; if (c) c.disconnected = false; },
  /** a driver who ran out of time to come back is simply gone: no wreck is left in the road */
  onAbandon(state, id) {
    const c = state.byId[id];
    if (!c) return;
    c.abandoned = true; c.disconnected = true;
    if (!c.finished) { c.dead = true; c.deathTick = state.tick; }
  },

  encodeSnapshot: encodeRallySnapshot,
  decodeSnapshot: decodeRallySnapshot,
  isOver: raceIsOver,
  results: raceResults,
  PHASE, publicProfile
};
