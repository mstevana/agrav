import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MSG, PROTOCOL_VERSION, encodeJson, decodeJson, messageType, isJsonType,
         decodeSnapshotHeader } from '../../shared/net/protocol.js';
import { createSoloHost } from '../solo.js';

const settle = () => new Promise((r) => setTimeout(r, 0));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Everything the page imports for solo play must load in a browser, which has no
 * node: builtins. This is the guard that keeps the engine portable — if it fails,
 * solo play and the static (GitHub Pages) deploy are broken, not just this test.
 */
test('the engine the browser loads has no node: imports', () => {
  const browserLoaded = [
    'server/solo.js', 'server/lobby.js', 'server/room.js', 'server/session.js',
    'server/config.js', 'server/log.js', 'server/games.js', 'server/store.js',
    'shared/net/protocol.js', 'shared/net/bytes.js', 'shared/net/channel.js', 'shared/net/clock.js',
    'shared/sim/ring-buffer.js',
    'shared/volley/module.js', 'shared/agrav/module.js', 'shared/rally/module.js',
  ];
  for (const rel of browserLoaded) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const hit = src.match(/^\s*import[^\n]*from\s+['"]node:[^'"]+['"]/m);
    assert.equal(hit, null, `${rel} imports a node: builtin (${hit && hit[0].trim()})`);
    assert.equal(/\brequire\s*\(/.test(src), false, `${rel} uses require()`);
  }
});

/** a bare `process.env` would throw in a browser; config guards it */
test('config reads the environment without assuming Node', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/config.js'), 'utf8');
  assert.match(src, /typeof process !== 'undefined'/);
  assert.equal(/[^.\w]process\.env\./.test(src.replace(/typeof process !== 'undefined' && process\.env/g, '')), false,
    'config.js touches process.env outside the guard');
});

/** a small client speaking the real protocol over the loopback the page would use */
function soloClient(host) {
  const seen = [];
  const waiters = [];
  host.channel.onMessage = (u8) => {
    const type = messageType(u8);
    const m = isJsonType(type) ? { type, ...decodeJson(u8) }
      : type === MSG.SNAPSHOT ? { type, ...decodeSnapshotHeader(u8) } : { type };
    seen.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  };
  return {
    seen,
    send: (type, obj) => host.channel.send(encodeJson(type, obj)),
    last: (type) => [...seen].reverse().find((m) => m.type === type) || null,
    waitFor(pred, ms = 2000) {
      const hit = seen.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), ms);
        waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
      });
    },
  };
}

test('solo host: one player plus bots plays a whole match with no server', async () => {
  const host = createSoloHost({ manualTick: true });
  const c = soloClient(host);

  c.send(MSG.HELLO, { v: PROTOCOL_VERSION, name: 'Solo' });
  const welcome = await c.waitFor((m) => m.type === MSG.WELCOME);
  assert.ok(welcome.token, 'the in-page session still issues a token');
  assert.ok(welcome.games.includes('volley'), 'games are registered in the page');

  c.send(MSG.CREATE_ROOM, { game: 'volley', opts: { pointsToWin: 1 }, public: false });
  const room = await c.waitFor((m) => m.type === MSG.ROOM && m.code);
  assert.equal(room.game, 'volley');
  assert.equal(room.players.length, 1, 'just me; the empty seats play as bots');
  assert.equal(host.lobby.rooms.size, 1);

  c.send(MSG.READY, { ready: true });
  await settle();
  c.send(MSG.START, {});
  await c.waitFor((m) => m.type === MSG.ROOM && m.phase === 'running');

  const r = host.lobby.rooms.get(room.code);
  let guard = 0;
  while (r.phase === 'running' && guard++ < 60 * 60 * 4) r._doTick();
  await settle();

  assert.ok(c.last(MSG.SNAPSHOT), 'snapshots reached the page');
  const results = c.last(MSG.RESULTS);
  assert.ok(results, 'the match finished and reported results');
  assert.ok(results.results.winner === 0 || results.results.winner === 1);

  host.stop();
  assert.equal(host.lobby.rooms.size, 0, 'stopping the host tears the room down');
});

test('solo host: a second game id works the same way', async () => {
  const host = createSoloHost({ manualTick: true });
  const c = soloClient(host);
  c.send(MSG.HELLO, { v: PROTOCOL_VERSION, name: 'Solo' });
  await c.waitFor((m) => m.type === MSG.WELCOME);
  c.send(MSG.CREATE_ROOM, { game: 'volley3', opts: {}, public: false });
  const room = await c.waitFor((m) => m.type === MSG.ROOM && m.code);
  assert.equal(room.game, 'volley3');
  assert.equal(room.state.slots.length, 6);
  host.stop();
});
