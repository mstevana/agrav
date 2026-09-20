// ============================================================================
// Guns, mines and the spiked bumper.
//
// The three primaries are all hitscan: a ray from the muzzle, scored against
// the poses every car held a few ticks ago rather than where they are now, so a
// shot hits what the shooter could see when they pulled the trigger. The client
// draws each one as a tracer streaking from the muzzle to the impact, so it
// reads as a bullet crossing the screen without a bullet having to exist.
//
// Wrecks and the scenery stop a bullet. That is what turns the crusher and a
// burnt-out shell into cover.
// ============================================================================

import { IN } from '../net/protocol.js';
import { ENTITY } from './sim/snapshot.js';
import { WEAPONS, MINE, NITRO, HITSCAN_REWIND_TICKS } from './constants.js';

let nextEntityId = 1;
export function resetEntityIds() { nextEntityId = 1; }

export const weaponDef = (id) => WEAPONS[id] || WEAPONS.machinegun;
export const WEAPON_IDS = Object.keys(WEAPONS);
export const isWeaponId = (id) => Object.prototype.hasOwnProperty.call(WEAPONS, id);

/** fill a car's magazines at the start of a race */
export function armCar(car) {
  const w = weaponDef(car.weapon);
  car.ammo = w.ammo;
  car.mines = MINE.perRace;
  car.nitro = 0;
  car.refireT = 0;
  car.spinT = 0;
  car.burstT = 0;
  car.fireHeld = false;
  car.mineHeld = false;
  car.nitroHeld = false;
}

/**
 * One tick of everything that shoots. Damage is gathered per victim and applied
 * once, so a minigun does not push twenty separate events down the wire in a
 * second for what the eye reads as one burst.
 */
export function stepWeapons(race, dt, tick, events, applyDamage) {
  const pending = new Map();
  const hurt = (victim, dmg, by, source) => {
    if (victim.dead || victim.finished) return;
    const rec = pending.get(victim.id);
    if (rec) { rec.dmg += dmg; if (source === 'mine') rec.source = source; }
    else pending.set(victim.id, { victim, dmg, by, source });
  };

  for (const car of race.cars) {
    if (car.dead || car.finished) continue;
    const bits = car.disconnected ? 0 : (car.input.bits | 0);
    stepNitro(car, bits, dt);
    stepMines(race, car, bits, tick, events);
    stepGun(race, car, bits, dt, tick, events, hurt);
  }

  stepEntities(race, dt, tick, events, hurt);

  for (const { victim, dmg, by, source } of pending.values()) applyDamage(victim, dmg, by, source, events);
}

// ------------------------------------------------------------------ nitro --

function stepNitro(car, bits, dt) {
  const want = !!(bits & IN.NITRO);
  if (want && !car.nitroHeld && car.nitro > 0 && car.c.nitroT <= 0) {
    car.nitro--;
    car.c.nitroT = NITRO.duration;
  }
  car.nitroHeld = want;
  void dt;
}

// ------------------------------------------------------------------ mines --

function stepMines(race, car, bits, tick, events) {
  const want = !!(bits & IN.MINE);
  if (want && !car.mineHeld && car.mines > 0) {
    car.mines--;
    const back = MINE.dropBack + car.c.radius;
    race.entities.push({
      id: (nextEntityId++) & 0xffff, kind: ENTITY.MINE, owner: car.id,
      x: car.c.x - Math.sin(car.c.yaw) * back, z: car.c.z - Math.cos(car.c.yaw) * back,
      yaw: car.c.yaw, armT: MINE.armSec, armed: false, life: 0, born: tick
    });
    events.push({ t: 'mine', id: car.id });
  }
  car.mineHeld = want;
}

/** the things sitting in the road. A mine hurts whoever touches it, its owner included. */
function stepEntities(race, dt, tick, events, hurt) {
  for (let i = race.entities.length - 1; i >= 0; i--) {
    const e = race.entities[i];
    if (!e.armed) {
      e.armT -= dt;
      if (e.armT <= 0) { e.armed = true; e.life = 1; }
      continue;
    }
    let hit = null;
    for (const car of race.cars) {
      if (car.dead || car.finished) continue;
      const d = Math.hypot(car.c.x - e.x, car.c.z - e.z);
      if (d < car.c.radius + MINE.radius) { hit = car; break; }
    }
    if (!hit) continue;
    // everything close enough feels it, not only whoever set it off
    for (const car of race.cars) {
      if (car.dead || car.finished) continue;
      const d = Math.hypot(car.c.x - e.x, car.c.z - e.z);
      if (d > MINE.blastRadius) continue;
      const share = 1 - Math.min(1, d / MINE.blastRadius) * MINE.falloff;
      hurt(car, MINE.damage * share, e.owner, 'mine');
    }
    events.push({ t: 'blast', x: e.x, z: e.z, by: e.owner, kind: 'mine' });
    race.entities.splice(i, 1);
  }
  void tick;
}

// ------------------------------------------------------------------- guns --

function stepGun(race, car, bits, dt, tick, events, hurt) {
  const w = weaponDef(car.weapon);
  const firing = !!(bits & IN.FIRE) && car.ammo > 0;

  // the minigun takes a moment to come up to speed, and spins down when let go
  if (w.spinUp) {
    car.spinT = firing ? Math.min(w.spinUp, car.spinT + dt) : Math.max(0, car.spinT - dt * 1.6);
  } else car.spinT = firing ? w.spinUp || 0 : 0;
  const spun = !w.spinUp || car.spinT >= w.spinUp;

  car.refireT = Math.max(0, car.refireT - dt);
  car.burstT = Math.max(0, car.burstT - dt);
  car.fireHeld = !!(bits & IN.FIRE);
  if (!firing || !spun || car.refireT > 0) return;

  car.refireT = 1 / w.rate;
  car.ammo = Math.max(0, car.ammo - 1);
  // No event per shot. A machine gun is nine of them a second and a shotgun is
  // six pellets at a time; six cars doing that would be a hundred JSON messages
  // a second for something the client can work out for itself. The snapshot
  // already says who is firing and with what, and the client traces its own
  // rays for the tracer and the sound. Damage still arrives as a hit event,
  // gathered per victim per tick.
  car.burstT = Math.max(car.burstT, 1 / w.rate + 0.05);

  const rewound = poseAt(race, tick - HITSCAN_REWIND_TICKS);
  const rng = race.rng;
  for (let p = 0; p < (w.pellets || 1); p++) {
    // the spread is drawn from the race's own generator, so the server and any
    // replay of it agree on where every pellet went
    const spread = (rng() - 0.5) * 2 * w.spread;
    const yaw = car.c.yaw + spread;
    const hit = raycast(race, car, yaw, w.range, rewound);
    if (!hit) continue;
    if (hit.car) hurt(hit.car, w.damage, car.id, w.pellets > 1 ? 'pellet' : 'bullet');
  }
}

/** every car's position a few ticks ago: what the shooter was actually looking at */
function poseAt(race, tick) {
  return race.history.get(Math.max(0, tick)) || null;
}

/**
 * The first thing a ray from this car's muzzle meets. Cars are scored against
 * their rewound poses; wrecks and the scenery are static, so they are scored
 * where they are, and they stop the bullet without taking anything from it.
 */
function raycast(race, shooter, yaw, range, rewound) {
  const ox = shooter.c.x + Math.sin(yaw) * shooter.c.radius;
  const oz = shooter.c.z + Math.cos(yaw) * shooter.c.radius;
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  let best = range, hitCar = null;

  for (const car of race.cars) {
    if (car.id === shooter.id || car.dead || car.finished) continue;
    const pose = rewound?.[car.id];
    const cx = pose ? pose.x : car.c.x, cz = pose ? pose.z : car.c.z;
    const t = hitCircle(ox, oz, dx, dz, cx, cz, car.c.radius, best);
    if (t !== null) { best = t; hitCar = car; }
  }
  for (const wreck of race.wrecks) {
    const t = hitCircle(ox, oz, dx, dz, wreck.x, wreck.z, wreck.r, best);
    if (t !== null) { best = t; hitCar = null; }
  }
  for (const o of race.track.obstacles) {
    const t = hitCircle(ox, oz, dx, dz, o.x, o.z, o.r, best);
    if (t !== null) { best = t; hitCar = null; }
  }
  if (best >= range && !hitCar) return null;
  return { x: ox + dx * best, z: oz + dz * best, dist: best, car: hitCar };
}

/** distance along a ray to a circle, or null if it misses or is further than `max` */
function hitCircle(ox, oz, dx, dz, cx, cz, r, max) {
  const mx = cx - ox, mz = cz - oz;
  const along = mx * dx + mz * dz;
  if (along < 0 || along > max) return null;
  const perp2 = mx * mx + mz * mz - along * along;
  if (perp2 > r * r) return null;
  const back = Math.sqrt(Math.max(0, r * r - perp2));
  const t = along - back;
  return t < 0 ? (along <= max ? 0 : null) : (t <= max ? t : null);
}

/**
 * The car a shot from here would hit, or null. This is the same ray the server
 * will trace when the trigger goes, against the same rewound poses, so a bot
 * that asks first is not guessing: it holds fire until the shot is real. The
 * range is trimmed a little so it does not open up at the very edge, where the
 * target would be gone before the bullet arrived.
 */
export function wouldHitCar(race, shooter, tick) {
  const w = weaponDef(shooter.weapon);
  const rewound = poseAt(race, tick - HITSCAN_REWIND_TICKS);
  const hit = raycast(race, shooter, shooter.c.yaw, w.range * 0.92, rewound);
  return hit && hit.car ? hit.car : null;
}
