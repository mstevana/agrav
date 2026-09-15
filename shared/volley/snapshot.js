// ============================================================================
// Volley snapshot payload: the ball, the four blobs, the score and touch state.
// Small enough (about 40 bytes) that every snapshot is complete — no delta.
// The recipient reconciles its own blob from its record, so blob velocity and
// the grounded flag ride along too.
// ============================================================================

import { ByteWriter, ByteReader } from '../net/bytes.js';

const POS = 32;   // px -> fixed point (800*32 and 600*32 both fit in i16)
const VEL = 16;   // px/s -> fixed point (|v| stays under ~2000, *16 fits in i16)

export function encodeVolleySnapshot(state) {
  const b = state.ball;
  const w = new ByteWriter(16 + state.blobs.length * 8);
  w.u8(state.score[0] & 0xff).u8(state.score[1] & 0xff);
  w.u8(state.serving & 0xff).i8(state.touchTeam).u8(state.touches & 0xff);
  w.i8(b.lastHit).u32(b.lastHitTick < 0 ? 0 : b.lastHitTick);
  w.qi16(b.x, POS).qi16(b.y, POS).qi16(b.vx, VEL).qi16(b.vy, VEL).angle(wrapPi(b.angle));
  w.u8(state.blobs.length);
  for (const bl of state.blobs) {
    w.u8(bl.onGround ? 1 : 0);
    w.qi16(bl.x, POS).qi16(bl.y, POS).qi16(bl.vy, VEL);
  }
  return w.finish();
}

export function decodeVolleySnapshot(u8) {
  const r = new ByteReader(u8);
  const out = {
    score: [r.u8(), r.u8()],
    serving: r.u8(),
    touchTeam: r.i8(),
    touches: r.u8(),
    ball: {},
    blobs: [],
  };
  const lastHit = r.i8();
  const lastHitTick = r.u32();
  out.ball = {
    lastHit, lastHitTick,
    x: r.qi16(POS), y: r.qi16(POS), vx: r.qi16(VEL), vy: r.qi16(VEL), angle: r.angle(),
  };
  const n = r.u8();
  for (let slot = 0; slot < n; slot++) {
    out.blobs.push({
      slot,
      onGround: !!r.u8(),
      x: r.qi16(POS), y: r.qi16(POS), vy: r.qi16(VEL),
    });
  }
  return out;
}

function wrapPi(a) {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
}
