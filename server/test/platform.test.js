// The two platform features a game can opt into: a grid filled with bots at the
// flag, and a durable per-player record. Driven with a throwaway module so the
// test says nothing about any particular game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../lobby.js';
import { registerGame } from '../games.js';
import { MemoryStore } from '../store.js';
import { MSG, PROTOCOL_VERSION } from '../../shared/net/protocol.js';
import { TestClient, settle } from './helpers.js';

/** a four-seat game that fills its grid, seats players from a record, and pays the winner */
const careerGame = {
  id: 'careertest', name: 'Career Test',
  minPlayers: 1, maxPlayers: 4,
  tickRate: 60, snapshotRate: 30,
  defaultOpts: {}, validateOpts: (o) => ({ prize: o?.prize ?? 100 }),
  createMatch(opts) { return { opts, seats: {}, over: false, ticks: 0 }; },
  addPlayer(state, id, profile, isBot) { state.seats[id] = { id, isBot, money: 0, car: 'vagabond' }; },
  removePlayer(state, id) { delete state.seats[id]; },
  setProfile(state, id, m) { return { car: state.seats[id]?.car }; },
  setCareer(state, id, career) {
    const s = state.seats[id];
    if (s) { s.car = career.car; s.money = career.money; }
    return { car: career.car, money: career.money };
  },
  fillBots() { return true; },
  publicState(state) { return { seats: Object.keys(state.seats).length }; },
  start() {}, phase() { return 0; },
  applyInput() {}, botInput() { return { bits: 0, steer: 0 }; },
  step(state) { state.ticks++; if (state.ticks >= 3) state.over = true; },
  onDisconnect() {}, onReconnect() {}, onAbandon() {},
  encodeSnapshot() { return new Uint8Array([7]); },
  decodeSnapshot(u8) { return { seven: u8[0] }; },
  isOver(state) { return state.over; },
  results(state) { return { order: Object.keys(state.seats).map(Number) }; },
  career: {
    create() { return { money: 0, car: 'vagabond', races: 0 }; },
    apply(career, action) {
      if (action.action !== 'buy') return { error: 'unknown' };
      if (career.money < 1000) return { error: 'funds' };
      return { career: { ...career, money: career.money - 1000, car: 'stiletto' } };
    },
    settle(career, results, id, opts) {
      return { ...career, money: career.money + (results.order[0] === id ? opts.prize : 0), races: career.races + 1 };
    }
  }
};

function lobby() {
  registerGame('careertest', careerGame);
  return new Lobby({ manualTick: true, store: new MemoryStore() });
}

test('platform: every empty seat becomes a bot when the host starts', async () => {
  const L = lobby();
  const host = new TestClient(L);
  await host.hello('Ann');
  host.send(MSG.CREATE_ROOM, { game: 'careertest', opts: {}, public: true });
  const room = await host.waitFor(m => m.type === MSG.ROOM);
  assert.equal(room.players.length, 1);
  assert.equal(room.fillBots, true, 'the lobby can show which seats a fill would take');
  assert.equal(room.maxPlayers, 4);

  host.send(MSG.READY, { ready: true });
  await settle();
  host.send(MSG.START, {});
  const started = await host.waitFor(m => m.type === MSG.ROOM && m.phase === 'running');
  assert.equal(started.players.length, 4, 'the grid is full');
  assert.equal(started.players.filter(p => p.bot).length, 3);
  assert.deepEqual(started.players.filter(p => p.bot).map(p => p.name), ['BOT 2', 'BOT 3', 'BOT 4'],
    'the filled seats are ordinary named players');
  L.close();
});

test('platform: a career is created on first sight, spent in the shop and kept', async () => {
  const L = lobby();
  const c = new TestClient(L);
  await c.hello('Ann', undefined, 'CAREERKEY0001');

  c.send(MSG.CAREER_ACTION, { game: 'careertest', action: 'get' });
  const first = await c.waitFor(m => m.type === MSG.CAREER);
  assert.deepEqual(first.career, { money: 0, car: 'vagabond', races: 0 });

  c.send(MSG.CAREER_ACTION, { game: 'careertest', action: 'buy' });
  const broke = await c.next(MSG.CAREER);
  assert.equal(broke.error, 'funds', 'the module refuses, and says why');
  assert.equal(broke.career.car, 'vagabond', 'nothing was spent');

  // give them the money the long way round: win a race
  c.send(MSG.CREATE_ROOM, { game: 'careertest', opts: { prize: 2500 }, public: false });
  const room = await c.waitFor(m => m.type === MSG.ROOM);
  await settle();
  c.send(MSG.READY, { ready: true });
  await settle();
  c.send(MSG.START, {});
  await c.waitFor(m => m.type === MSG.ROOM && m.phase === 'running');
  const r = L.rooms.get(room.code);
  for (let i = 0; i < 4; i++) r._doTick();
  await settle();
  const paid = await c.waitFor(m => m.type === MSG.CAREER && m.career.races === 1);
  assert.equal(paid.career.money, 2500, 'the winner was paid at the finish');

  c.send(MSG.CAREER_ACTION, { game: 'careertest', action: 'buy' });
  const bought = await c.next(MSG.CAREER);
  assert.equal(bought.career.car, 'stiletto');
  assert.equal(bought.career.money, 1500);
  assert.deepEqual(await L.store.get('careertest', 'CAREERKEY0001'), bought.career, 'and it is in the store');
  L.close();
});

test('platform: the seat is set from the record, and a keyless player still plays', async () => {
  const L = lobby();
  L.store.set('careertest', 'RICHKEY0001', { money: 9000, car: 'valkyrie', races: 12 });
  const rich = new TestClient(L), keyless = new TestClient(L);
  await rich.hello('Ann', undefined, 'RICHKEY0001');
  await keyless.hello('Bob');

  rich.send(MSG.CREATE_ROOM, { game: 'careertest', opts: {}, public: true });
  const room = await rich.waitFor(m => m.type === MSG.ROOM);
  const seated = await rich.waitFor(m => m.type === MSG.ROOM && m.players.some(p => p.profile?.car === 'valkyrie'));
  assert.equal(seated.players[0].profile.car, 'valkyrie', 'they start in the car they own');

  keyless.send(MSG.JOIN_ROOM, { code: room.code });
  const joined = await keyless.waitFor(m => m.type === MSG.ROOM);
  assert.equal(joined.players.length, 2, 'a player with no key joins and races as anyone else');
  keyless.send(MSG.CAREER_ACTION, { game: 'careertest', action: 'get' });
  const refused = await keyless.waitFor(m => m.type === MSG.CAREER);
  assert.equal(refused.error, 'no-key');
  L.close();
});

test('platform: a career key is never a path, and an unknown game is refused', async () => {
  const L = lobby();
  const c = new TestClient(L);
  await c.hello('Ann', undefined, '../../etc/passwd');
  c.send(MSG.CAREER_ACTION, { game: 'careertest', action: 'get' });
  const out = await c.waitFor(m => m.type === MSG.CAREER);
  assert.equal(out.error, 'no-key', 'the key was rejected at HELLO, so there is nothing to address');

  const ok = new TestClient(L);
  await ok.hello('Bob', undefined, 'GOODKEY0001');
  ok.send(MSG.CAREER_ACTION, { game: 'volley', action: 'get' });
  const nope = await ok.waitFor(m => m.type === MSG.CAREER);
  assert.equal(nope.error, 'game', 'a game that keeps no records has no career to hand out');
  L.close();
});

test('platform: games that want neither hook are untouched', async () => {
  const L = lobby();
  const host = new TestClient(L);
  await host.hello('Ann');
  host.send(MSG.CREATE_ROOM, { game: 'volley', opts: {}, public: true });
  const room = await host.waitFor(m => m.type === MSG.ROOM);
  assert.equal(room.fillBots, false);
  host.send(MSG.READY, { ready: true });
  await settle();
  host.send(MSG.START, {});
  const started = await host.waitFor(m => m.type === MSG.ROOM && m.phase === 'running');
  assert.equal(started.players.length, 1, 'Volley still starts with the seats it had');
  L.close();
});

test('platform: the version bump is visible, and the hot path is still binary', async () => {
  // Explicit, so that changing the wire has to be a decision and not a slip.
  assert.equal(PROTOCOL_VERSION, 3);
  const L = lobby();
  const c = new TestClient(L);
  c.send(MSG.HELLO, { v: PROTOCOL_VERSION - 1, name: 'Old' });
  const err = await c.waitFor(m => m.type === MSG.ERROR);
  assert.equal(err.code, 'version', 'a client built against the previous protocol is told plainly');
  L.close();
});
