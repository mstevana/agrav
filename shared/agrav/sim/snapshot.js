// ============================================================================
// AGRAV snapshot payload: every racer's full state (so the recipient can
// reconcile its own prediction) plus live projectiles and pad availability.
// ============================================================================

import { ByteWriter, ByteReader } from '../../net/bytes.js';
import { ITEMS, ITEM_BY_CODE, VF } from '../constants.js';

const KIND_CODE = { rocket: 1, missile: 2, mine: 3 };
const KIND_BY_CODE = { 1: 'rocket', 2: 'missile', 3: 'mine' };

export function encodeRaceSnapshot(race, forId) {
  const w = new ByteWriter(64 + race.racers.length * 28 + race.projectiles.length * 14);
  w.i32(race.raceTick);
  w.u8(race.racers.length);
  // recipient first, so a reconciliation can stop after the first record
  const ordered = [...race.racers].sort((a, b) => (a.id === forId ? -1 : b.id === forId ? 1 : 0));
  // who a missile is chasing. The projectile record carries the missile, not its lock, and a client
  // cannot tell a missile flying past from one coming for it -- so the lock is told to the target.
  const locked = new Set();
  for (const p of race.projectiles) if (p.kind === 'missile' && p.target >= 0) locked.add(p.target);
  for (const r of ordered) {
    const v = r.v;
    let flags = 0;
    if (v.grounded) flags |= VF.GROUNDED;
    if (v.shieldT > 0) flags |= VF.SHIELD;
    if (v.boostT > 0) flags |= VF.BOOST;
    if (v.bits & 4) flags |= VF.AIRBRAKE_L;
    if (v.bits & 8) flags |= VF.AIRBRAKE_R;
    if (v.bits & 1) flags |= VF.THROTTLE;
    if (r.dead) flags |= VF.DEAD;
    if (r.finished) flags |= VF.FINISHED;
    if (r.burstT > 0) flags |= VF.FIRING;
    if (v.scraping) flags |= VF.SCRAPE;
    if (v.contactT > 0) flags |= VF.CONTACT;
    if (locked.has(r.id)) flags |= VF.LOCKED;
    if (r.disconnected) flags |= VF.DISCONNECTED;
    if (r.bot) flags |= VF.BOT;
    w.u8(r.id).u16(flags);
    w.f32(v.s).qi16(v.t, 100).qi16(v.h, 100).qi16(v.W, 50);
    w.qi16(v.vs, 50).qi16(v.vt, 50).angle(v.yaw);
    w.qu8(Math.max(0, r.hp), 1).u8(ITEMS[r.item].code).u8(r.ammo).u8(r.lap);
    w.qu8(v.shieldT, 20).qu8(v.boostT, 20).qu8(Math.max(0, r.burstT), 50);
    w.u8(r.rank);
  }
  w.u8(race.projectiles.length);
  for (const p of race.projectiles) {
    w.u16(p.id).u8(KIND_CODE[p.kind]).u8(p.owner).f32(p.s).qi16(p.t, 100).qi16(p.h, 100).angle(p.yaw).qu16(p.speed, 50)
      .u8(p.armed ? 1 : 0).qu8(Math.max(0, p.life), 4);
  }
  // pad availability bitfield
  const pads = race.pads;
  w.u8(pads.length);
  for (let i = 0; i < pads.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8 && i + k < pads.length; k++) if (pads[i + k].respawnTick <= race.tick) b |= 1 << k;
    w.u8(b);
  }
  return w.finish();
}

export function decodeRaceSnapshot(u8) {
  const r = new ByteReader(u8);
  const out = { raceTick: r.i32(), racers: [], projectiles: [], pads: [] };
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const rec = { id: r.u8(), flags: r.u16() };
    rec.s = r.f32(); rec.t = r.qi16(100); rec.h = r.qi16(100); rec.W = r.qi16(50);
    rec.vs = r.qi16(50); rec.vt = r.qi16(50); rec.yaw = r.angle();
    rec.hp = r.qu8(1); rec.item = ITEM_BY_CODE[r.u8()] || 'none'; rec.ammo = r.u8(); rec.lap = r.u8();
    rec.shieldT = r.qu8(20); rec.boostT = r.qu8(20); rec.burstT = r.qu8(50);
    rec.rank = r.u8();
    out.racers.push(rec);
  }
  const np = r.u8();
  for (let i = 0; i < np; i++) {
    out.projectiles.push({
      id: r.u16(), kind: KIND_BY_CODE[r.u8()], owner: r.u8(), s: r.f32(), t: r.qi16(100), h: r.qi16(100),
      yaw: r.angle(), speed: r.qu16(50), armed: !!r.u8(), life: r.qu8(4)
    });
  }
  const npads = r.u8();
  for (let i = 0; i < npads; i += 8) {
    const b = r.u8();
    for (let k = 0; k < 8 && i + k < npads; k++) out.pads.push(!!(b & (1 << k)));
  }
  return out;
}
