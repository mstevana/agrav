// ============================================================================
// The Scrap Rally snapshot: every car in full (so the recipient can reconcile
// its own prediction against its own record), the burnt shells, the live
// entities and which pads are up.
//
// Positions ride as f32 rather than a quantised metre: a car predicts its own
// position every tick and replays inputs against the server's, so a centimetre
// of rounding would show up as a permanent small correction. Six cars of 26
// bytes, a handful of entities and a bitfield is around 200 bytes at 30 Hz.
//
// `kind` on an entity is a byte with one value used today (a mine). A rocket is
// a new value here and a new case in the client's effects, not a new format.
// ============================================================================

import { ByteWriter, ByteReader } from '../../net/bytes.js';
import { CF } from '../constants.js';

export const ENTITY = Object.freeze({ MINE: 1, ROCKET: 2, MISSILE: 3 });
const ENTITY_NAME = Object.freeze({ 1: 'mine', 2: 'rocket', 3: 'missile' });
export const entityName = (k) => ENTITY_NAME[k] || 'unknown';

const VEL = 100;          // m/s -> i16, 1 cm/s
const SMALL = 100;

export function encodeRallySnapshot(race, forId) {
  const w = new ByteWriter(64 + race.cars.length * 28 + race.entities.length * 16);
  w.i32(race.raceTick);
  w.u8(race.cars.length);
  // the recipient first, so a client reconciling its own car can stop after the first record
  const ordered = [...race.cars].sort((a, b) => (a.id === forId ? -1 : b.id === forId ? 1 : 0));
  for (const c of ordered) {
    const v = c.c;
    let flags = 0;
    if (v.bits & 1) flags |= CF.THROTTLE;
    if (v.bits & 2) flags |= CF.BRAKE;
    if (v.sliding) flags |= CF.SLIDING;
    if (c.dead) flags |= CF.DEAD;
    if (c.finished) flags |= CF.FINISHED;
    if (c.bot) flags |= CF.BOT;
    if (c.disconnected) flags |= CF.DISCONNECTED;
    if (v.fwd < -0.4) flags |= CF.REVERSING;
    if (v.nitroT > 0) flags |= CF.NITRO;
    if (c.burstT > 0) flags |= CF.FIRING;
    if (v.scraping) flags |= CF.SCRAPE;
    w.u8(c.id).u16(flags);
    w.f32(v.x).f32(v.z).angle(v.yaw);
    w.qi16(v.vx, VEL).qi16(v.vz, VEL);
    w.qu16(Math.max(0, c.hull), SMALL).u16(Math.max(0, Math.min(65535, c.maxHull)));
    w.u8(c.lap).u8(c.rank);
    w.qu8(Math.min(12.75, v.nitroT), 20);
    w.u8(weaponCode(c.weapon)).u16(Math.max(0, Math.min(65535, c.ammo | 0)))
     .u8(Math.max(0, Math.min(255, c.mines | 0))).u8(Math.max(0, Math.min(255, c.nitro | 0)));
    w.qu8(Math.max(0, Math.min(12.75, c.burstT || 0)), 20);
  }
  w.u8(Math.min(255, race.wrecks.length));
  for (const k of race.wrecks.slice(0, 255)) w.u8(k.id).f32(k.x).f32(k.z).angle(k.yaw);
  w.u8(Math.min(255, race.entities.length));
  for (const e of race.entities.slice(0, 255)) {
    w.u16(e.id).u8(e.kind).u8(e.owner).f32(e.x).f32(e.z).angle(e.yaw)
     .qu8(Math.max(0, Math.min(12.75, e.life ?? 0)), 20).u8(e.armed ? 1 : 0);
  }
  // a byte per pad rather than a bit, because what a pad is holding can change:
  // zero means taken, anything else is the item currently sitting on it
  const pads = race.pads;
  w.u8(pads.length);
  for (const pad of pads) w.u8(pad.respawnTick > race.tick ? 0 : itemCode(pad.live || pad.item));
  return w.finish();
}

export function decodeRallySnapshot(u8) {
  const r = new ByteReader(u8);
  const out = { raceTick: r.i32(), cars: [], wrecks: [], entities: [], pads: [] };
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const c = { id: r.u8(), flags: r.u16() };
    c.x = r.f32(); c.z = r.f32(); c.yaw = r.angle();
    c.vx = r.qi16(VEL); c.vz = r.qi16(VEL);
    c.hull = r.qu16(SMALL); c.maxHull = r.u16();
    c.lap = r.u8(); c.rank = r.u8();
    c.nitroT = r.qu8(20);
    c.weapon = weaponName(r.u8()); c.ammo = r.u16(); c.mines = r.u8(); c.nitro = r.u8();
    c.burstT = r.qu8(20);
    c.dead = !!(c.flags & CF.DEAD);
    c.finished = !!(c.flags & CF.FINISHED);
    c.sliding = !!(c.flags & CF.SLIDING);
    out.cars.push(c);
  }
  const nk = r.u8();
  for (let i = 0; i < nk; i++) out.wrecks.push({ id: r.u8(), x: r.f32(), z: r.f32(), yaw: r.angle() });
  const ne = r.u8();
  for (let i = 0; i < ne; i++) {
    out.entities.push({
      id: r.u16(), kind: r.u8(), owner: r.u8(), x: r.f32(), z: r.f32(), yaw: r.angle(),
      life: r.qu8(20), armed: !!r.u8()
    });
  }
  const np = r.u8();
  for (let i = 0; i < np; i++) {
    const code = r.u8();
    out.pads.push(code === 0 ? null : itemName(code));
  }
  return out;
}

const ITEM_CODE = Object.freeze({ ammo: 1, nitro: 2, repair: 3, cash: 4, mines: 5 });
const ITEM_NAME = Object.freeze({ 1: 'ammo', 2: 'nitro', 3: 'repair', 4: 'cash', 5: 'mines' });
export const itemCode = (i) => ITEM_CODE[i] || 1;
export const itemName = (c) => ITEM_NAME[c] || 'ammo';

const WEAPON_CODE = Object.freeze({ machinegun: 1, shotgun: 2, minigun: 3 });
const WEAPON_NAME = Object.freeze({ 1: 'machinegun', 2: 'shotgun', 3: 'minigun' });
export const weaponCode = (w) => WEAPON_CODE[w] || 1;
export const weaponName = (c) => WEAPON_NAME[c] || 'machinegun';
