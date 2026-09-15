import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../lobby.js';
import { MSG, IN } from '../../shared/net/protocol.js';
import volley from '../../shared/volley/module.js';
import { TestClient, settle } from './helpers.js';

function lobby() { return new Lobby({ manualTick: true }); }

test('volley: host starts alone, empty seats play as bots, snapshots and results flow', async () => {
  const L = lobby();
  const host = new TestClient(L);
  await host.hello('Ann');
  host.send(MSG.CREATE_ROOM, { game: 'volley', opts: { pointsToWin: 2 }, public: true });
  let room = await host.waitFor((m) => m.type === MSG.ROOM);
  assert.equal(room.game, 'volley');
  assert.equal(room.state.slots.length, 4);
  assert.equal(room.state.pointsToWin, 2);

  // one human is enough to start (minPlayers 1)
  host.send(MSG.READY, { ready: true });
  await settle();
  host.send(MSG.START, {});
  const started = await host.waitFor((m) => m.type === MSG.ROOM && m.phase === 'running');
  assert.equal(started.phase, 'running');

  const r = L.rooms.get(room.code);
  // hold jump+right for a while; the room fills the ticks the client did not send
  for (let t = 1; t <= 20; t++) host.sendInput(t, t, IN.THROTTLE, 1);
  await settle();
  for (let i = 0; i < 20; i++) r._doTick();
  await settle();

  const snap = host.last(MSG.SNAPSHOT);
  assert.ok(snap, 'a snapshot was sent');
  const d = volley.decodeSnapshot(snap.payload);
  assert.equal(d.blobs.length, 4, 'all four blobs are simulated even with three empty seats');
  assert.ok(snap.phase === volley.PHASE.PLAY || snap.phase === volley.PHASE.POINT);

  // run the match to completion; an idle-ish human tends to lose, but either winner is fine
  let guard = 0;
  while (r.phase === 'running' && guard++ < 60 * 60 * 4) r._doTick();
  await settle();
  const res = host.last(MSG.RESULTS);
  assert.ok(res, 'results were delivered');
  assert.ok(res.results.winner === 0 || res.results.winner === 1);
  assert.ok(Math.max(...res.results.score) >= 2);
  L.close();
});

test('volley: a second human joins the other team', async () => {
  const L = lobby();
  const host = new TestClient(L), guest = new TestClient(L);
  await host.hello('Ann'); await guest.hello('Bob');
  host.send(MSG.CREATE_ROOM, { game: 'volley', opts: {}, public: true });
  const room = await host.waitFor((m) => m.type === MSG.ROOM);
  guest.send(MSG.JOIN_ROOM, { code: room.code });
  const g = await guest.waitFor((m) => m.type === MSG.ROOM);
  assert.equal(g.players.length, 2);
  // host is seat 0 (Blue), guest takes the next free id
  const guestId = g.players.find((p) => p.name === 'Bob').id;
  assert.ok(guestId >= 1 && guestId <= 3);

  host.send(MSG.ADD_BOT, {});
  const withBot = await host.next(MSG.ROOM);
  assert.ok(withBot.players.some((p) => p.bot), 'host can add a bot to fill a seat');
  L.close();
});
