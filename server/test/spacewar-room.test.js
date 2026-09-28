import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../lobby.js';
import { MSG } from '../../shared/net/protocol.js';
import spacewar from '../../shared/spacewar/module.js';
import { BIT } from '../../shared/spacewar/constants.js';
import { TestClient, settle } from './helpers.js';

function lobby() { return new Lobby({ manualTick: true }); }

async function hostRoom(L, opts) {
  const host = new TestClient(L);
  await host.hello('Ann');
  host.send(MSG.CREATE_ROOM, { game: 'spacewar', opts, public: true });
  const room = await host.waitFor((m) => m.type === MSG.ROOM);
  return { host, room };
}

test('spacewar: host starts alone, empty seats fill with bots, snapshots and results flow', async () => {
  const L = lobby();
  const { host, room } = await hostRoom(L, { roundsToWin: 1 });
  assert.equal(room.game, 'spacewar');
  assert.equal(room.maxPlayers, 4);
  assert.equal(room.state.seats.length, 4);
  assert.equal(room.fillBots, true);

  host.send(MSG.READY, { ready: true });
  await settle();
  host.send(MSG.START, {});
  const started = await host.waitFor((m) => m.type === MSG.ROOM && m.phase === 'running');
  assert.equal(started.players.length, 4);
  assert.equal(started.players.filter((p) => p.bot).length, 3);

  const r = L.rooms.get(room.code);
  for (let t = 1; t <= 20; t++) host.sendInput(t, t, BIT.THRUST | BIT.FIRE, 1);
  await settle();
  for (let i = 0; i < 20; i++) r._doTick();
  await settle();
  const snap = host.last(MSG.SNAPSHOT);
  assert.ok(snap);
  assert.equal(snap.phase, spacewar.PHASE.INTRO);
  const d = spacewar.decodeSnapshot(snap.payload);
  assert.equal(d.ships.filter(Boolean).length, 4);
  assert.equal(d.round, 1);

  let guard = 0;
  while (r.phase === 'running' && guard++ < 60 * 60 * 5) r._doTick();
  await settle();
  const res = host.last(MSG.RESULTS);
  assert.ok(res, 'results were delivered');
  assert.ok(res.results.winner >= 0);
  assert.equal(res.results.standings.length, 4);
  assert.ok(host.all(MSG.EVENTS).some((m) => m.events.some((e) => e.kind === 'kill')), 'kill events were sent');
  L.close();
});

test('spacewar: with filling off, only the seats taken fly', async () => {
  const L = lobby();
  const { host, room } = await hostRoom(L, { fill: false });
  const guest = new TestClient(L);
  await guest.hello('Bob');
  guest.send(MSG.JOIN_ROOM, { code: room.code });
  await guest.waitFor((m) => m.type === MSG.ROOM);
  host.send(MSG.READY, { ready: true }); guest.send(MSG.READY, { ready: true });
  await settle();
  host.send(MSG.START, {});
  const started = await host.waitFor((m) => m.type === MSG.ROOM && m.phase === 'running');
  assert.equal(started.players.length, 2);
  assert.equal(started.players.filter((p) => p.bot).length, 0);
  const r = L.rooms.get(room.code);
  r._doTick(); r._doTick();
  await settle();
  const d = spacewar.decodeSnapshot(host.last(MSG.SNAPSHOT).payload);
  assert.deepEqual(d.ships.map(Boolean), [true, true, false, false]);
  L.close();
});

test('spacewar: a pilot who drops mid-match is flown by a bot', async () => {
  const L = lobby();
  const { host, room } = await hostRoom(L, { fill: false });
  const guest = new TestClient(L);
  await guest.hello('Bob');
  guest.send(MSG.JOIN_ROOM, { code: room.code });
  await guest.waitFor((m) => m.type === MSG.ROOM);
  host.send(MSG.READY, { ready: true }); guest.send(MSG.READY, { ready: true });
  await settle();
  host.send(MSG.START, {});
  await host.waitFor((m) => m.type === MSG.ROOM && m.phase === 'running');
  const r = L.rooms.get(room.code);
  guest.close();
  await settle();
  assert.equal(r.state.control[1], 'bot');
  assert.equal(r.state.control[0], 'human');
  L.close();
});
