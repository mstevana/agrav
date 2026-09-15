import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../lobby.js';
import { registerGame } from '../games.js';
import { MSG, IN, PROTOCOL_VERSION } from '../../shared/net/protocol.js';
import { makeEchoModule } from './echo-module.js';
import { TestClient, settle } from './helpers.js';

registerGame('echo', makeEchoModule());
registerGame('boom', makeEchoModule({ id: 'boom', step(state, tick) { if (tick >= 3) throw new Error('kaboom'); } }));

function lobby() { return new Lobby({ manualTick: true }); }

test('HELLO with the wrong protocol version is refused', async () => {
  const L = lobby();
  const c = new TestClient(L);
  c.send(MSG.HELLO, { v: PROTOCOL_VERSION + 1, name: 'x' });
  const m = await c.waitFor(m => m.type === MSG.ERROR);
  assert.equal(m.code, 'version');
  await settle();
  assert.ok(c.chan.closed);
  L.close();
});

test('control messages before HELLO are rejected', async () => {
  const L = lobby();
  const c = new TestClient(L);
  c.send(MSG.CREATE_ROOM, { game: 'echo' });
  const m = await c.waitFor(m => m.type === MSG.ERROR);
  assert.equal(m.code, 'hello');
  L.close();
});

test('create, join, ready, start, inputs drive state, results', async () => {
  const L = lobby();
  const host = new TestClient(L), guest = new TestClient(L);
  await host.hello('Host'); await guest.hello('Guest');
  host.send(MSG.CREATE_ROOM, { game: 'echo', opts: { ticks: 10 }, public: true });
  let room = await host.waitFor(m => m.type === MSG.ROOM);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.hostId, room.you);
  assert.equal(room.code.length, 4);

  guest.send(MSG.JOIN_ROOM, { code: room.code.toLowerCase() });
  const g = await guest.waitFor(m => m.type === MSG.ROOM);
  assert.equal(g.players.length, 2);
  assert.equal(L.listPublic()[0].players, 2);

  guest.send(MSG.SET_PROFILE, { colour: 'blue', junk: 1 });
  await guest.next(MSG.ROOM);
  const r = L.rooms.get(room.code);
  assert.deepEqual(r.players.get(g.you).profile, { colour: 'blue' });

  // start refused until everyone is ready
  host.send(MSG.START, {});
  assert.equal((await host.waitFor(m => m.type === MSG.ERROR)).code, 'ready');
  host.send(MSG.READY, { ready: true }); guest.send(MSG.READY, { ready: true });
  await settle();
  guest.send(MSG.START, {});
  assert.equal((await guest.next(MSG.ERROR)).code, 'host');
  host.send(MSG.START, {});
  const started = await host.waitFor(m => m.type === MSG.ROOM && m.phase === 'running');
  assert.equal(started.phase, 'running');

  // guest holds throttle for ticks 1..10; host sends nothing
  for (let t = 1; t <= 10; t++) guest.sendInput(t, t, IN.THROTTLE);
  await settle();
  for (let i = 0; i < 10; i++) r._doTick();
  await settle();
  const snap = guest.last(MSG.SNAPSHOT);
  assert.ok(snap, 'guest got a snapshot');
  assert.equal(snap.phase, 1);
  assert.equal(snap.lastInputSeq, 10);
  const decoded = makeEchoModule().decodeSnapshot(snap.payload);
  assert.equal(decoded[g.you].x, 10);
  assert.equal(decoded[room.you].x, 0);

  const res = await host.waitFor(m => m.type === MSG.RESULTS);
  assert.equal(res.results.x[g.you], 10);
  const after = await host.waitFor(m => m.type === MSG.ROOM && m.phase === 'results');
  assert.equal(after.phase, 'results');
  assert.equal(r.phase, 'results');
  L.close();
});

test('after a race the lobby works again: options apply, the phase returns to lobby, the rematch starts fresh', async () => {
  const L = lobby();
  const host = new TestClient(L);
  await host.hello('Host');
  host.send(MSG.CREATE_ROOM, { game: 'echo', opts: { ticks: 3 }, public: true });
  const room = await host.waitFor(m => m.type === MSG.ROOM);
  const r = L.rooms.get(room.code);
  host.send(MSG.READY, { ready: true }); await settle();
  host.send(MSG.START, {}); await host.waitFor(m => m.type === MSG.ROOM && m.phase === 'running');
  for (let t = 1; t <= 3; t++) host.sendInput(t, t, IN.THROTTLE);
  await settle();
  for (let i = 0; i < 3; i++) r._doTick();
  await host.waitFor(m => m.type === MSG.ROOM && m.phase === 'results');
  assert.equal(r.state.players[room.you].x, 3);

  // the host changes an option from the post-race lobby: it applies and the room is a lobby again
  host.send(MSG.SET_OPTS, { opts: { ticks: 7 } }); await settle();
  const back = host.last(MSG.ROOM);
  assert.equal(back.phase, 'lobby');
  assert.equal(back.opts.ticks, 7);
  assert.equal(r.phase, 'lobby');
  assert.equal(L.listPublic()[0].phase, 'lobby');

  // readying and starting again runs on a fresh match, not the finished one
  host.send(MSG.READY, { ready: true }); await settle();
  host.send(MSG.START, {}); await settle();
  assert.equal(r.phase, 'running');
  assert.equal(r.state.players[room.you].x, 0);
  assert.equal(r.state.opts.ticks, 7);
  L.close();
});

test('a missing input tick is filled from the newest earlier input', async () => {
  const L = lobby();
  const c = new TestClient(L);
  await c.hello();
  c.send(MSG.CREATE_ROOM, { game: 'echo', opts: { ticks: 100 } });
  const room = await c.waitFor(m => m.type === MSG.ROOM);
  c.send(MSG.READY, { ready: true }); c.send(MSG.START, {});
  await c.waitFor(m => m.type === MSG.ROOM && m.phase === 'running');
  const r = L.rooms.get(room.code);
  c.sendInput(1, 1, IN.THROTTLE);      // only tick 1 arrives; ticks 2..5 are lost
  await settle();
  for (let i = 0; i < 5; i++) r._doTick();
  assert.equal(r.state.players[room.you].x, 5);
  // an input too far in the future is ignored, a stale seq too
  c.sendInput(2, 500, IN.BRAKE);
  c.sendInput(1, 6, IN.BRAKE);
  await settle();
  r._doTick();
  assert.equal(r.state.players[room.you].x, 6);
  L.close();
});

test('bots are driven by the module and the host can add them', async () => {
  const L = lobby();
  const c = new TestClient(L);
  await c.hello();
  c.send(MSG.CREATE_ROOM, { game: 'echo', opts: { ticks: 5 } });
  const room = await c.waitFor(m => m.type === MSG.ROOM);
  c.send(MSG.ADD_BOT, {});
  const withBot = await c.next(MSG.ROOM);
  assert.equal(withBot.players.filter(p => p.bot).length, 1);
  c.send(MSG.READY, { ready: true }); c.send(MSG.START, {});
  await c.waitFor(m => m.type === MSG.ROOM && m.phase === 'running');
  const r = L.rooms.get(room.code);
  for (let i = 0; i < 5; i++) r._doTick();
  const res = await c.waitFor(m => m.type === MSG.RESULTS);
  const botId = withBot.players.find(p => p.bot).id;
  assert.equal(res.results.x[botId], 5);
  L.close();
});

test('a disconnected racer can reattach with their token; abandoning eliminates', async () => {
  const L = lobby();
  const a = new TestClient(L), b = new TestClient(L);
  await a.hello('A'); await b.hello('B');
  a.send(MSG.CREATE_ROOM, { game: 'echo', opts: { ticks: 1000 } });
  const room = await a.waitFor(m => m.type === MSG.ROOM);
  b.send(MSG.JOIN_ROOM, { code: room.code });
  const bj = await b.waitFor(m => m.type === MSG.ROOM);
  a.send(MSG.READY, { ready: true }); b.send(MSG.READY, { ready: true });
  await settle();
  a.send(MSG.START, {});
  await b.waitFor(m => m.type === MSG.ROOM && m.phase === 'running');
  const r = L.rooms.get(room.code);

  b.close();
  await settle();
  assert.equal(r.state.players[bj.you].dc, true);
  assert.equal(r.players.get(bj.you).session, null);

  const b2 = new TestClient(L);
  const w = await b2.hello('B again', b.token);
  assert.equal(w.type, MSG.WELCOME);
  const back = await b2.waitFor(m => m.type === MSG.ROOM);
  assert.equal(back.you, bj.you);
  assert.equal(back.phase, 'running');
  assert.equal(r.state.players[bj.you].dc, false);

  // a stranger cannot use the token while it is attached
  const thief = new TestClient(L);
  await thief.hello('thief', b.token);
  assert.equal(thief.session.token !== b.token, true);

  // explicit leave mid-race abandons the vehicle
  b2.send(MSG.LEAVE_ROOM, {});
  await settle();
  assert.equal(r.state.players[bj.you].gone, true);
  assert.equal(b2.session.room, null);
  L.close();
});

test('a module that throws closes only its own room', async () => {
  const L = lobby();
  const x = new TestClient(L), y = new TestClient(L);
  await x.hello(); await y.hello();
  x.send(MSG.CREATE_ROOM, { game: 'boom' });
  y.send(MSG.CREATE_ROOM, { game: 'echo', opts: { ticks: 100 } });
  const rx = await x.waitFor(m => m.type === MSG.ROOM);
  const ry = await y.waitFor(m => m.type === MSG.ROOM);
  for (const c of [x, y]) { c.send(MSG.READY, { ready: true }); c.send(MSG.START, {}); }
  await x.waitFor(m => m.type === MSG.ROOM && m.phase === 'running');
  await y.waitFor(m => m.type === MSG.ROOM && m.phase === 'running');
  const roomX = L.rooms.get(rx.code), roomY = L.rooms.get(ry.code);
  for (let i = 0; i < 4; i++) { roomX._doTick(); roomY._doTick(); }
  const err = await x.waitFor(m => m.type === MSG.ERROR);
  assert.equal(err.code, 'crash');
  assert.equal(L.rooms.has(rx.code), false);
  assert.equal(L.rooms.has(ry.code), true);
  assert.equal(roomY.tick, 4);
  assert.equal(x.session.room, null);
  L.close();
});

test('empty rooms are reaped after the ttl', async () => {
  const L = lobby();
  const c = new TestClient(L);
  await c.hello();
  c.send(MSG.CREATE_ROOM, { game: 'echo' });
  const room = await c.waitFor(m => m.type === MSG.ROOM);
  c.close();
  await settle();
  const r = L.rooms.get(room.code);
  assert.ok(r);
  r.emptySince = Date.now() - 10 * 60 * 1000;
  L.reap();
  assert.equal(L.rooms.has(room.code), false);
  L.close();
});
