// Scrap Rally through the real server: a room, a grid filled with bots at the
// flag, snapshots on the wire and a result at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../lobby.js';
import { MemoryStore } from '../store.js';
import { MSG, IN } from '../../shared/net/protocol.js';
import rally from '../../shared/rally/module.js';
import { TestClient, settle } from './helpers.js';

const lobby = () => new Lobby({ manualTick: true, store: new MemoryStore() });
const spin = (room, n) => { for (let i = 0; i < n; i++) room._doTick(); };

test('rally: one player starts alone and the grid fills itself with five bots', async () => {
  const L = lobby();
  const host = new TestClient(L);
  await host.hello('Ann');
  host.send(MSG.CREATE_ROOM, { game: 'rally', opts: { laps: 1 }, public: true });
  const room = await host.waitFor(m => m.type === MSG.ROOM);
  assert.equal(room.game, 'rally');
  assert.equal(room.maxPlayers, 6);
  assert.equal(room.state.trackName, 'Scrapyard');
  assert.equal(room.opts.laps, 1);

  host.send(MSG.READY, { ready: true });
  await settle();
  host.send(MSG.START, {});
  const started = await host.waitFor(m => m.type === MSG.ROOM && m.phase === 'running');
  assert.equal(started.players.length, 6, 'a full grid');
  assert.equal(started.players.filter(p => p.bot).length, 5);

  const r = L.rooms.get(room.code);
  r.loaded(host.session);                                  // the client reports its scene built
  for (let t = 1; t <= 40; t++) host.sendInput(t, t, IN.THROTTLE, 0.2);
  await settle();
  spin(r, 60 * 6);
  await settle();

  const snap = host.last(MSG.SNAPSHOT);
  assert.ok(snap, 'snapshots are flowing');
  const d = rally.decodeSnapshot(snap.payload);
  assert.equal(d.cars.length, 6);
  assert.equal(d.cars[0].id, 0, 'the recipient first');
  assert.equal(d.pads.length, 8);
  L.close();
});

test('rally: the host can switch the fill off and race the seats that are taken', async () => {
  const L = lobby();
  const host = new TestClient(L);
  await host.hello('Ann');
  host.send(MSG.CREATE_ROOM, { game: 'rally', opts: { laps: 1, fillBots: false }, public: true });
  const room = await host.waitFor(m => m.type === MSG.ROOM);
  assert.equal(room.fillBots, false);
  host.send(MSG.READY, { ready: true });
  await settle();
  host.send(MSG.START, {});
  const started = await host.waitFor(m => m.type === MSG.ROOM && m.phase === 'running');
  assert.equal(started.players.length, 1);
  L.close();
});

test('rally: a race run to the flag delivers results everyone can read', async () => {
  const L = lobby();
  const host = new TestClient(L);
  await host.hello('Ann');
  host.send(MSG.CREATE_ROOM, { game: 'rally', opts: { laps: 1, botDifficulty: 'hard' }, public: false });
  const room = await host.waitFor(m => m.type === MSG.ROOM);
  host.send(MSG.READY, { ready: true });
  await settle();
  host.send(MSG.START, {});
  await host.waitFor(m => m.type === MSG.ROOM && m.phase === 'running');
  const r = L.rooms.get(room.code);
  r.loaded(host.session);
  let guard = 0;
  while (r.phase === 'running' && guard++ < 60 * 400) r._doTick();
  await settle();
  const res = host.last(MSG.RESULTS);
  assert.ok(res, 'results were delivered');
  assert.equal(res.results.order.length, 6);
  assert.deepEqual(res.results.order.map(o => o.place), [1, 2, 3, 4, 5, 6]);
  assert.ok(res.results.order.some(o => o.finished), 'somebody got home');
  assert.ok(res.results.prizeMultiplier > 1, 'a hard race is worth more');
  L.close();
});

test('rally: a driver who never comes back is out, and leaves no wreck behind', async () => {
  const L = lobby();
  const host = new TestClient(L), guest = new TestClient(L);
  await host.hello('Ann'); await guest.hello('Bob');
  host.send(MSG.CREATE_ROOM, { game: 'rally', opts: { laps: 3 }, public: true });
  const room = await host.waitFor(m => m.type === MSG.ROOM);
  guest.send(MSG.JOIN_ROOM, { code: room.code });
  await guest.waitFor(m => m.type === MSG.ROOM);
  host.send(MSG.READY, { ready: true });
  guest.send(MSG.READY, { ready: true });
  await settle();
  host.send(MSG.START, {});
  await host.waitFor(m => m.type === MSG.ROOM && m.phase === 'running');

  const r = L.rooms.get(room.code);
  r.loaded(host.session); r.loaded(guest.session);
  spin(r, 60 * 6);
  const guestCar = r.state.byId[1];
  assert.ok(guestCar && !guestCar.dead);
  r.game.onAbandon(r.state, 1, r.tick);
  spin(r, 2);
  assert.ok(guestCar.abandoned && guestCar.dead, 'their car is out of the race');
  assert.equal(r.state.wrecks.length, 0, 'but there is no shell in the road for the others to hit');
  L.close();
});

test('rally: a player can only pick a car their record actually owns', async () => {
  const L = lobby();
  const host = new TestClient(L);
  await host.hello('Ann', undefined, 'RALLYKEY0001');
  host.send(MSG.CREATE_ROOM, { game: 'rally', opts: {}, public: true });
  const room = await host.waitFor(m => m.type === MSG.ROOM);
  const r = L.rooms.get(room.code);
  // the seat is set from the record the server loaded, not from anything the client said
  r.game.setCareer(r.state, 0, { car: 'mongrel', upgrades: { speed: 1, handling: 0, armour: 2 }, bumper: false, hull: 90, weapon: 'machinegun', weapons: ['machinegun'] });
  assert.equal(r.state.byId[0].stats.id, 'mongrel');
  assert.equal(r.state.byId[0].hull, 90, 'and it starts on the damage it drove home with');

  host.send(MSG.SET_PROFILE, { car: 'valkyrie' });
  await settle();
  assert.equal(r.state.byId[0].stats.id, 'mongrel', 'asking for a car you do not own changes nothing');
  L.close();
});
