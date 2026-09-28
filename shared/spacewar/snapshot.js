// ============================================================================
// Spacewar snapshot payload: the round, every seat's ship and every torpedo in
// flight. Small enough (under 100 bytes plus 13 per torpedo) that each one is
// complete — no deltas. The recipient reconciles its own ship from its record,
// so velocity, fuel and the gun and hyperspace timers ride along too.
// ============================================================================

import { ByteWriter, ByteReader } from '../net/bytes.js';

const POS = 16;   // px -> fixed point (1600 * 16 fits in i16)
const VEL = 16;   // px/s -> fixed point (torpedoes top out near 1100 px/s)

const F_PRESENT = 1, F_ALIVE = 2, F_THRUST = 4;

export function encodeSpacewarSnapshot(state) {
  const w = new ByteWriter(64 + state.ships.length * 24 + state.torps.length * 13);
  w.u8(state.round & 0xff).u16(Math.max(0, state.timer) & 0xffff).i8(state.roundWinner).i8(state.winner);
  w.u8(state.ships.length);
  for (const s of state.ships) {
    if (!s) { w.u8(0); continue; }
    w.u8(F_PRESENT | (s.alive ? F_ALIVE : 0) | (s.thrust ? F_THRUST : 0));
    w.qi16(s.x, POS).qi16(s.y, POS).qi16(s.vx, VEL).qi16(s.vy, VEL).angle(s.a);
    w.u16(s.fuel).u8(s.torps).u8(s.cool).u8(s.hyper).u8(s.hyperCd);
    w.u8(s.wins).u8(Math.min(255, s.kills)).u8(Math.min(255, s.deaths));
  }
  w.u16(state.torps.length);
  for (const t of state.torps) {
    w.u16(t.id).u8(t.owner).u8(Math.min(255, t.age));
    w.qi16(t.x, POS).qi16(t.y, POS).qi16(t.vx, VEL).qi16(t.vy, VEL);
  }
  return w.finish();
}

export function decodeSpacewarSnapshot(u8) {
  const r = new ByteReader(u8);
  const out = { round: r.u8(), timer: r.u16(), roundWinner: r.i8(), winner: r.i8(), ships: [], torps: [] };
  const n = r.u8();
  for (let id = 0; id < n; id++) {
    const f = r.u8();
    if (!(f & F_PRESENT)) { out.ships.push(null); continue; }
    out.ships.push({
      id, alive: !!(f & F_ALIVE), thrust: !!(f & F_THRUST),
      x: r.qi16(POS), y: r.qi16(POS), vx: r.qi16(VEL), vy: r.qi16(VEL), a: r.angle(),
      fuel: r.u16(), torps: r.u8(), cool: r.u8(), hyper: r.u8(), hyperCd: r.u8(),
      wins: r.u8(), kills: r.u8(), deaths: r.u8(),
    });
  }
  const m = r.u16();
  for (let i = 0; i < m; i++) {
    out.torps.push({
      id: r.u16(), owner: r.u8(), age: r.u8(),
      x: r.qi16(POS), y: r.qi16(POS), vx: r.qi16(VEL), vy: r.qi16(VEL),
    });
  }
  return out;
}
