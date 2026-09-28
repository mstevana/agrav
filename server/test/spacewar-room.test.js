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

test('spacewar: a lone pilot gets one bot; seats 3 and 4 stay empty', async () => {
  const L = lobby();
  const { host, room } = await hostRoom(L, {});
  assert.equal(room.fillBots, 2, 'the lobby is told two seats will fly');
  host.send(MSG.READY, { ready: true });
  await settle();
  host.send(MSG.START, {});
  const started = await host.waitFor((m) => m.type === MSG.ROOM && m.phase === 'running');
  assert.equal(started.players.length, 2);
  assert.deepEqual(started.players.map((p) => p.bot), [false, true]);
  const r = L.rooms.get(room.code);
  r._doTick(); r._doTick();
  await settle();
  const d = spacewar.decodeSnapshot(host.last(MSG.SNAPSHOT).payload);
  assert.deepEqual(d.ships.map(Boolean), [true, true, false, false]);
  L.close();
});

test('spacewar: the host puts bots in chosen seats, takes one out, and the match flows', async () => {
  const L = lobby();
  const { host, room } = await hostRoom(L, { roundsToWin: 1 });
  assert.equal(room.game, 'spacewar');
  assert.equal(room.maxPlayers, 4);
  assert.equal(room.state.seats.length, 4);
  for (const id of [3, 1, 2]) host.send(MSG.ADD_BOT, { id });
  await settle();
  assert.deepEqual(host.last(MSG.ROOM).players.map((p) => p.id).sort(), [0, 1, 2, 3], 'each bot went where it was put');
  host.send(MSG.ADD_BOT, { id: 2 });
  assert.equal((await host.next(MSG.ERROR)).message, 'that seat is taken');
  host.send(MSG.KICK, { id: 2 });
  host.send(MSG.ADD_BOT, { id: 2 });
  await settle();
  assert.equal(host.last(MSG.ROOM).players.length, 4, 'a seat emptied can be filled again');

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

test('spacewar: two pilots fly alone, with no bots added', async () => {
  const L = lobby();
  const { host, room } = await hostRoom(L, {});
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
  const { host, room } = await hostRoom(L, {});
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
