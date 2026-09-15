// ============================================================================
// Items and projectiles, in ribbon space. Server-only for authority; the
// client uses the same projectile stepping to draw smooth motion between
// snapshots and to show its own shots the instant they are fired.
// ============================================================================

import { deltaS, wrapS, frameAt } from '../../sim/spline.js';
import { wrapAngle, turnToward } from '../../sim/vec.js';
import { ITEMS, WEAPON } from '../constants.js';

/** pick an item for a racer given their rank (0 = leader) among `count` racers */
export function rollItem(rng, rank, count) {
  const tier = count <= 1 ? 1 : Math.min(2, Math.floor((rank / Math.max(1, count - 1)) * 3));
  const entries = Object.entries(ITEMS).filter(([k]) => k !== 'none').map(([k, v]) => ({ k, w: v.w[tier] }));
  return rng.weighted(entries).k;
}

let nextProjectileId = 1;
export function resetProjectileIds() { nextProjectileId = 1; }

/**
 * Handle the fire button for one racer. Returns true if the item was used.
 * `race` is the match state; `r` the racer; `events` the reliable event list.
 */
export function useItem(race, r, tick, events) {
  const v = r.v;
  switch (r.item) {
    case 'rocket': return launch(race, r, 'rocket', tick, events);
    case 'missile': return launch(race, r, 'missile', tick, events);
    case 'mines': return launch(race, r, 'mine', tick, events);
    case 'minigun':
      if (r.burstT > 0) return false;
      r.burstT = WEAPON.minigun.burst;
      r.burstNext = 0;
      consume(r, 1);
      events.push({ t: 'fire', id: r.id, item: 'minigun' });
      return true;
    case 'health':
      r.hp = Math.min(r.maxHp, r.hp + WEAPON.health.amount);
      consume(r, 1);
      events.push({ t: 'use', id: r.id, item: 'health' });
      return true;
    case 'shield':
      v.shieldT = WEAPON.shield.duration;
      consume(r, 1);
      events.push({ t: 'use', id: r.id, item: 'shield' });
      return true;
    case 'speed':
      v.boostT = WEAPON.speed.duration;
      consume(r, 1);
      events.push({ t: 'use', id: r.id, item: 'speed' });
      return true;
    default: return false;
  }
}

function consume(r, n) {
  r.ammo -= n;
  if (r.ammo <= 0) { r.item = 'none'; r.ammo = 0; }
}

function launch(race, r, kind, tick, events) {
  if (r.refireT > 0) return false;
  const v = r.v;
  const ribbon = race.ribbon;
  const p = {
    id: nextProjectileId++ & 0xffff, kind, owner: r.id, born: tick,
    s: v.s, t: v.t, h: v.h + 0.6, yaw: v.yaw, speed: 0, life: 0, target: -1, armed: false, dmg: 1
  };
  if (kind === 'rocket') {
    p.speed = Math.hypot(v.vs, v.vt) + WEAPON.rocket.speed;
    p.life = WEAPON.rocket.life;
    p.dmg = WEAPON.rocket.damage * r.stats.damage;
    p.s = wrapS(ribbon, v.s + 4);
    r.refireT = WEAPON.rocket.refire;
  } else if (kind === 'missile') {
    p.speed = Math.hypot(v.vs, v.vt) + WEAPON.missile.speed;
    p.life = WEAPON.missile.life;
    p.dmg = WEAPON.missile.damage * r.stats.damage;
    p.s = wrapS(ribbon, v.s + 4);
    p.target = acquireTarget(race, r);
    r.refireT = 0.4;
  } else {
    p.speed = 0;
    p.life = WEAPON.mines.life;
    p.dmg = WEAPON.mines.damage * r.stats.damage;
    p.s = wrapS(ribbon, v.s - WEAPON.mines.dropBehind);
    p.h = 0;
    r.refireT = WEAPON.mines.dropGap;
  }
  race.projectiles.push(p);
  consume(r, 1);
  events.push({ t: 'fire', id: r.id, item: kind, pid: p.id, target: p.target });
  return true;
}

/** nearest live racer ahead inside the missile's lock cone */
export function acquireTarget(race, r) {
  const W = WEAPON.missile;
  let best = -1, bd = Infinity;
  for (const o of race.racers) {
    if (o.id === r.id || o.dead || o.finished) continue;
    const ds = deltaS(race.ribbon, r.v.s, o.v.s);
    if (ds <= 2 || ds > W.lockRange) continue;
    const dt = o.v.t - r.v.t;
    const ang = Math.abs(wrapAngle(Math.atan2(dt, ds) - r.v.yaw));
    if (ang > W.lockAngle) continue;
    if (ds < bd) { bd = ds; best = o.id; }
  }
  return best;
}

/** advance every projectile; resolve hits; returns nothing, pushes events */
export function stepProjectiles(race, dt, tick, events, applyDamage) {
  const ribbon = race.ribbon;
  const list = race.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life -= dt;
    if (p.life <= 0) { list.splice(i, 1); events.push({ t: 'expire', pid: p.id }); continue; }
    if (p.kind === 'mine') {
      if (!p.armed && tick - p.born >= WEAPON.mines.arm * race.tickRate) p.armed = true;
      if (!p.armed) continue;
      const victim = mineVictim(race, p, tick);
      if (victim) {
        applyDamage(victim, p.dmg, p.owner, 'mine', events);
        events.push({ t: 'boom', pid: p.id, s: p.s, tt: p.t, h: p.h });
        list.splice(i, 1);
      }
      continue;
    }
    // guided: turn toward the target's current spot
    if (p.kind === 'missile' && p.target >= 0) {
      const tgt = race.byId[p.target];
      if (!tgt || tgt.dead || tgt.finished) p.target = -1;
      else {
        const ds = deltaS(ribbon, p.s, tgt.v.s);
        const want = Math.atan2(tgt.v.t - p.t, Math.max(1, ds));
        p.yaw = turnToward(p.yaw, want, WEAPON.missile.turnRate * dt);
      }
    }
    const f = frameAt(ribbon, p.s);
    const ds = Math.cos(p.yaw) * p.speed * dt;
    const inner = Math.max(0.35, 1 - f.curvature * p.t);
    const dCentre = ds / inner;
    p.s = wrapS(ribbon, p.s + dCentre);
    p.t += Math.sin(p.yaw) * p.speed * dt;
    p.yaw = wrapAngle(p.yaw - f.curvature * dCentre);
    // straight rockets ride the surface; missiles also
    const f1 = frameAt(ribbon, p.s);
    const half = f1.width / 2;
    if (p.t > half || p.t < -half) {
      events.push({ t: 'boom', pid: p.id, s: p.s, tt: Math.max(-half, Math.min(half, p.t)), h: p.h, wall: true });
      list.splice(i, 1);
      continue;
    }
    const W = WEAPON[p.kind];
    const victim = projectileVictim(race, p, W.hitDs, W.hitDt, tick);
    if (victim) {
      applyDamage(victim, p.dmg, p.owner, p.kind, events);
      events.push({ t: 'boom', pid: p.id, s: p.s, tt: p.t, h: p.h, hit: victim.id });
      list.splice(i, 1);
    }
  }
}

function projectileVictim(race, p, hitDs, hitDt, tick) {
  for (const o of race.racers) {
    if (o.dead || o.finished) continue;
    if (o.id === p.owner && tick - p.born < 12) continue;   // clears its own launcher
    const ds = Math.abs(deltaS(race.ribbon, p.s, o.v.s));
    if (ds > hitDs) continue;
    if (Math.abs(o.v.t - p.t) > hitDt) continue;
    if (Math.abs(o.v.h - p.h) > 3.5) continue;
    return o;
  }
  return null;
}

function mineVictim(race, p, tick) {
  const M = WEAPON.mines;
  for (const o of race.racers) {
    if (o.dead || o.finished) continue;
    if (o.id === p.owner && tick - p.born < M.ownerImmune * race.tickRate) continue;
    const ds = Math.abs(deltaS(race.ribbon, p.s, o.v.s));
    if (ds > M.radius + 2) continue;
    if (Math.abs(o.v.t - p.t) > M.radius) continue;
    if (o.v.h > 2.5) continue;
    return o;
  }
  return null;
}

/**
 * Minigun: while a burst is running, one hitscan shot every `interval`.
 * Victims are tested against poses from `rewind` ticks ago (what the shooter saw).
 */
export function stepMinigun(race, r, dt, tick, events, applyDamage, poseAt) {
  if (r.burstT <= 0) return;
  r.burstT -= dt;
  r.burstNext -= dt;
  if (r.burstNext > 0) return;
  r.burstNext = WEAPON.minigun.interval;
  const M = WEAPON.minigun;
  const shooter = r.v;
  let victim = null, bd = Infinity;
  for (const o of race.racers) {
    if (o.id === r.id || o.dead || o.finished) continue;
    const pose = poseAt(o.id) || o.v;
    const ds = deltaS(race.ribbon, shooter.s, pose.s);
    if (ds <= 1 || ds > M.range) continue;
    const dt_ = pose.t - shooter.t;
    const aim = shooter.yaw;
    const lateral = Math.abs(dt_ - Math.tan(aim) * ds);
    if (lateral > M.spread + ds * M.cone) continue;
    if (ds < bd) { bd = ds; victim = o; }
  }
  const shot = { t: 'shot', id: r.id, hit: victim ? victim.id : -1, range: victim ? bd : M.range };
  events.push(shot);
  if (victim) applyDamage(victim, M.damage * r.stats.damage, r.id, 'minigun', events);
  if (r.burstT <= 0) events.push({ t: 'burstEnd', id: r.id });
}
