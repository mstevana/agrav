// End to end over a real WebSocket: the ws package's client speaks the same
// event API as the browser's, so this is the exact path a browser takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer } from '../index.js';
import { Lobby } from '../lobby.js';
import { registerGame } from '../games.js';
import { makeEchoModule } from './echo-module.js';
import { WsChannel } from '../../shared/net/channel.js';
import { MSG, PROTOCOL_VERSION, encodeJson, decodeJson, messageType, encodePing, decodePong } from '../../shared/net/protocol.js';

registerGame('echo', makeEchoModule());

test('websocket handshake, ping/pong, health and static files', async () => {
  const { server, lobby } = createServer(new Lobby({ manualTick: true }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.rooms, 0);

  const readme = await fetch(`http://127.0.0.1:${port}/README.md`);
  assert.equal(readme.status, 200);
  assert.match(readme.headers.get('content-type'), /markdown/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/server/index.js`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/../etc/passwd`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/shared/net/protocol.js`)).status, 200);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const chan = new WsChannel(ws);
  const inbox = [];
  chan.onMessage = (u8) => inbox.push(u8);
  const wait = (pred) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), 2000);
    const poll = () => { const m = inbox.find(pred); if (m) { clearTimeout(t); res(m); } else setTimeout(poll, 5); };
    poll();
  });

  chan.send(encodeJson(MSG.HELLO, { v: PROTOCOL_VERSION, name: 'Sock<script>' }));
  const welcome = decodeJson(await wait(u8 => messageType(u8) === MSG.WELCOME));
  assert.equal(welcome.name, 'Sockscript');
  assert.ok(welcome.games.includes('agrav'));

  chan.send(encodePing(12345));
  const pong = decodePong(await wait(u8 => messageType(u8) === MSG.PONG));
  assert.equal(pong.clientMs, 12345);
  assert.ok(Math.abs(pong.tickMs - 1000 / 60) < 0.02);

  chan.send(encodeJson(MSG.CREATE_ROOM, { game: 'echo', public: true }));
  const room = decodeJson(await wait(u8 => messageType(u8) === MSG.ROOM));
  const rooms = await (await fetch(`http://127.0.0.1:${port}/api/rooms`)).json();
  assert.equal(rooms.rooms[0].code, room.code);

  chan.close();
  await new Promise(r => setTimeout(r, 20));
  lobby.close();
  await new Promise(r => server.close(r));
});
