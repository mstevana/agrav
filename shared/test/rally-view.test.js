// What the client draws, as opposed to what the server simulates. Both of the
// rules here are about the player's own car, which is the one car the client
// predicts rather than interpolates, and so the one car that can be drawn wrong
// in ways nobody else is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '../../rally/src/net.js';
import rally from '../rally/module.js';

/** a client mid-race, with a snapshot to draw from and its own car predicted */
function racing(cars = 2) {
  const c = new Client();
  c.state = rally.createMatch({ track: 'scrapyard', laps: 3 }, 11);
  for (let i = 0; i < cars; i++) rally.addPlayer(c.state, i, {}, i > 0);
  rally.start(c.state, 0);
  c.track = c.state.track;
  c.me = 0;
  c.pred = c.state.byId[0].c;
  c.predPrev = { x: c.pred.x, z: c.pred.z, yaw: c.pred.yaw };
  const snap = {
    tick: 100,
    cars: c.state.cars.map(s => ({
      id: s.id, x: s.c.x, z: s.c.z, yaw: s.c.yaw, vx: 0, vz: 0, sliding: false,
      hull: s.hull, maxHull: s.maxHull, lap: 0, rank: s.id + 1, nitroT: 0,
      weapon: 'machinegun', ammo: 10, mines: 3, nitro: 0, burstT: 0,
      dead: false, finished: false
    })),
    wrecks: [], entities: [], pads: []
  };
  c.snaps = [snap];
  c.latest = snap;
  c.raceTick = 100;
  return c;
}

test('view: the own car is drawn between ticks, not only on them', () => {
  const c = racing();
  // a whole tick of movement, with the previous pose a metre behind
  c.predPrev = { x: c.pred.x, z: c.pred.z - 1, yaw: c.pred.yaw };

  const at = (a) => c.viewState(a).cars.find(x => x.mine);
  const p0 = at(0), pHalf = at(0.5), p1 = at(1);

  assert.ok(Math.abs(p0.z - c.predPrev.z) < 1e-9, 'at the start of a tick it is where the tick started');
  assert.ok(Math.abs(p1.z - c.pred.z) < 1e-9, 'at the end of one it is where the tick finished');
  const full = p1.z - p0.z, half = pHalf.z - p0.z;
  assert.ok(Math.abs(half / full - 0.5) < 1e-6,
    `halfway through a tick it is halfway along it (got ${(half / full).toFixed(3)} of the way)`);
});

test('view: the own car is never drawn inside another one', () => {
  const c = racing();
  const me = c.state.byId[0], them = c.state.byId[1];
  // drive mine on top of theirs: the prediction knows nothing about other cars,
  // so without the renderer refusing it, this is what would be drawn
  c.pred.x = them.c.x + 0.2; c.pred.z = them.c.z + 0.2;
  c.predPrev = { x: c.pred.x, z: c.pred.z, yaw: c.pred.yaw };
  c.latest.cars[1].x = them.c.x; c.latest.cars[1].z = them.c.z;
  c.snaps[0] = c.latest;

  const v = c.viewState(1);
  const drawnMe = v.cars.find(x => x.mine), drawnThem = v.cars.find(x => x.id === 1);
  const gap = Math.hypot(drawnMe.x - drawnThem.x, drawnMe.z - drawnThem.z);
  assert.ok(gap >= drawnMe.radius + drawnThem.radius - 1e-6,
    `drawn ${gap.toFixed(2)} m apart, which is inside ${(drawnMe.radius + drawnThem.radius).toFixed(2)} m of radii`);

  // and the prediction itself is untouched: it is what the server will replay,
  // and nudging it here is what put the reconciliation error up by fifty times
  assert.equal(c.pred.x, them.c.x + 0.2, 'the predicted position is left exactly alone');
  assert.equal(c.pred.z, them.c.z + 0.2);
});
