// A trivial game module for exercising the room machinery: each player has a
// number that their THROTTLE bit increments and BRAKE bit decrements.
import { ByteWriter, ByteReader } from '../../shared/net/bytes.js';
import { IN } from '../../shared/net/protocol.js';

export function makeEchoModule(overrides = {}) {
  return {
    id: 'echo', name: 'Echo', minPlayers: 1, maxPlayers: 4, tickRate: 60, snapshotRate: 30,
    defaultOpts: { ticks: 30 },
    validateOpts(o) { return { ticks: Math.max(1, o.ticks | 0 || 30) }; },
    createMatch(opts, seed) { return { opts, seed, tick: 0, started: false, players: {} }; },
    addPlayer(state, id, profile, bot) { state.players[id] = { x: 0, bits: 0, bot, gone: false, profile }; },
    removePlayer(state, id) { delete state.players[id]; },
    setProfile(state, id, m) { const p = { colour: String(m.colour || 'red') }; state.players[id].profile = p; return p; },
    publicState(state) { return { started: state.started }; },
    start(state, tick) { state.started = true; state.startTick = tick; },
    phase(state) { return state.started ? 1 : 0; },
    applyInput(state, id, input) { state.players[id].bits = input.bits; },
    botInput() { return { bits: IN.THROTTLE, steer: 0 }; },
    step(state, tick) {
      state.tick = tick;
      for (const p of Object.values(state.players)) {
        if (p.bits & IN.THROTTLE) p.x += 1;
        if (p.bits & IN.BRAKE) p.x -= 1;
      }
    },
    onDisconnect(state, id) { state.players[id].dc = true; },
    onReconnect(state, id) { state.players[id].dc = false; },
    onAbandon(state, id) { state.players[id].gone = true; },
    encodeSnapshot(state) {
      const ids = Object.keys(state.players);
      const w = new ByteWriter(1 + ids.length * 5);
      w.u8(ids.length);
      for (const id of ids) w.u8(+id).f32(state.players[id].x);
      return w.finish();
    },
    decodeSnapshot(u8) {
      const r = new ByteReader(u8); const n = r.u8(); const out = {};
      for (let i = 0; i < n; i++) { const id = r.u8(); out[id] = { x: r.f32() }; }
      return out;
    },
    isOver(state) { return state.started && state.tick - state.startTick >= state.opts.ticks; },
    results(state) { return { x: Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, p.x])) }; },
    ...overrides
  };
}
