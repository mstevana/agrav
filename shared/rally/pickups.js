// ============================================================================
// What is lying about on the road.
//
// Pads are authored where they are and always hand out the same thing, so a lap
// is learnable: you know where the repair kit is and you fight over it every
// time round. A taken pad comes back after twenty seconds.
//
// Cash is the exception. It has no pad of its own; every so often a free pad is
// dressed as a cash drop for a few seconds, from the race's own seeded
// generator, so money is a bonus you notice rather than a corner you farm.
// ============================================================================

import { PAD, NITRO, MINE } from './constants.js';
import { weaponDef } from './weapons.js';

export function resetPads(race) {
  for (const p of race.pads) { p.respawnTick = 0; p.live = p.item; p.cashUntil = 0; }
  race.nextCashTick = Math.round(PAD.cashEverySec * race.tickRate * (0.5 + race.rng()));
}

export function stepPickups(race, dt, tick, events) {
  scheduleCash(race, tick);
  for (let i = 0; i < race.pads.length; i++) {
    const pad = race.pads[i];
    if (pad.cashUntil && tick > pad.cashUntil && pad.respawnTick <= tick) { pad.cashUntil = 0; pad.live = pad.item; }
    if (pad.respawnTick > tick) continue;
    for (const car of race.cars) {
      if (car.dead || car.finished) continue;
      const d = Math.hypot(car.c.x - pad.x, car.c.z - pad.z);
      if (d > PAD.radius + car.c.radius) continue;
      collect(race, car, pad, tick, events);
      break;
    }
  }
  void dt;
}

/** dress a free pad as a cash drop for a few seconds */
function scheduleCash(race, tick) {
  if (tick < race.nextCashTick) return;
  race.nextCashTick = tick + Math.round(PAD.cashEverySec * race.tickRate * (0.6 + race.rng() * 0.8));
  const free = race.pads.filter(p => p.respawnTick <= tick && !p.cashUntil);
  if (!free.length) return;
  const pad = free[Math.floor(race.rng() * free.length)];
  pad.live = 'cash';
  pad.cashUntil = tick + Math.round(PAD.cashLifeSec * race.tickRate);
}

function collect(race, car, pad, tick, events) {
  const item = pad.live;
  let took = true;
  switch (item) {
    case 'ammo': {
      const w = weaponDef(car.weapon);
      const before = car.ammo;
      car.ammo = Math.min(w.ammo, car.ammo + Math.ceil(w.ammo * PAD.ammoShare));
      took = car.ammo > before;
      break;
    }
    case 'nitro':
      took = car.nitro < NITRO.maxCharges;
      if (took) car.nitro++;
      break;
    case 'repair':
      took = car.hull < car.maxHull;
      if (took) car.hull = Math.min(car.maxHull, car.hull + PAD.repair);
      break;
    case 'cash': {
      const amount = Math.round(race.cashMin + race.rng() * (race.cashMax - race.cashMin));
      car.cash += amount;
      events.push({ t: 'cash', id: car.id, amount });
      break;
    }
    case 'mines':
      took = car.mines < MINE.perRace;
      if (took) car.mines++;
      break;
    default: took = false;
  }
  if (!took) return;                       // full up: leave it for somebody who needs it
  pad.respawnTick = tick + PAD.respawnSec * race.tickRate;
  if (item === 'cash') { pad.cashUntil = 0; pad.live = pad.item; }
  events.push({ t: 'pickup', id: car.id, item, pad: pad.i });
}
