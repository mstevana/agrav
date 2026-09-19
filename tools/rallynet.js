#!/usr/bin/env node
// ============================================================================
// Network soak for Scrap Rally: boots a server, connects N synthetic clients
// over real WebSockets through a latency, jitter and loss shim, drives each one
// with the game's own bot, and reports what the netcode is doing — how far the
// prediction of a car drifts from the server before reconciliation puts it
// back, how often that gap is too big to blend away, and what it all costs in
// bandwidth and server tick time.
//
//   node tools/rallynet.js [--players 6] [--rtt 80] [--jitter 20] [--loss 0.02]
//                          [--laps 1] [--track scrapyard] [--seconds 120]
//
// The synthetic client is the real browser client class (rally/src/net.js):
// Node has a global WebSocket and the class touches no DOM until it renders.
// ============================================================================

import { createServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';
import { MemoryStore } from '../server/store.js';
import { HOT } from '../shared/net/protocol.js';
import { PHASE, TICK_RATE, DT } from '../shared/rally/constants.js';
import { botFor, botInput } from '../shared/rally/bot.js';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PLAYERS = parseInt(arg('--players', '6'), 10);
const RTT = parseFloat(arg('--rtt', '80'));
const JITTER = parseFloat(arg('--jitter', '20'));
const LOSS = parseFloat(arg('--loss', '0.02'));
const LAPS = parseInt(arg('--laps', '1'), 10);
const TRACK = arg('--track', 'scrapyard');
const SECONDS = parseInt(arg('--seconds', '150'), 10);

// --- a WebSocket that delays and drops frames in both directions
const RealWS = globalThis.WebSocket;
const unreliable = (data) => { const u8 = data instanceof Uint8Array ? data : new Uint8Array(data); return u8[0] >= HOT; };
class ShimWS extends EventTarget {
  constructor(url) {
    super();
    this.ws = new RealWS(url);
    this.ws.binaryType = 'arraybuffer';
    this.readyState = 0;
    this.ws.addEventListener('open', () => { this.readyState = 1; this.dispatchEvent(new Event('open')); });
    this.ws.addEventListener('close', () => { this.readyState = 3; this.dispatchEvent(new Event('close')); });
    this.ws.addEventListener('error', () => this.dispatchEvent(new Event('error')));
    this.ws.addEventListener('message', (e) => {
      if (unreliable(e.data) && Math.random() < LOSS) return;
      setTimeout(() => { const ev = new Event('message'); ev.data = e.data; this.dispatchEvent(ev); }, this.delay());
    });
  }
  set binaryType(v) { void v; }
  get binaryType() { return 'arraybuffer'; }
  delay() { return RTT / 2 + (Math.random() - 0.5) * JITTER; }
  send(data) {
    if (unreliable(data) && Math.random() < LOSS) return;
    const copy = data.slice ? data.slice() : data;
    setTimeout(() => { if (this.ws.readyState === 1) this.ws.send(copy); }, this.delay());
  }
  close(code, reason) { this.ws.close(code, reason); }
}
globalThis.WebSocket = ShimWS;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { Client } = await import('../rally/src/net.js');

const lobby = new Lobby({ store: new MemoryStore() });
const { server } = createServer(lobby);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `ws://127.0.0.1:${server.address().port}/ws`;
console.log(`rallynet: ${PLAYERS} players, rtt ${RTT} ms ±${JITTER}, loss ${(LOSS * 100).toFixed(1)}%, ${TRACK} × ${LAPS} lap(s)`);

const clients = [];
for (let i = 0; i < PLAYERS; i++) {
  const c = new Client();
  c.careerKey = null;                                   // synthetic drivers keep no record
  await c.connect(url, `sim${i}`);
  c.bot = botFor('normal', i, 1234);
  c.errors = [];
  const joined = new Promise(res => {
    c.onRoom = (m) => {
      if (m) res(m);
      if (m?.phase === 'running' && !c._loaded) { c._loaded = true; c.loaded(); }
    };
  });
  if (i === 0) c.createRoom({ track: TRACK, laps: LAPS, fillBots: false }, false);
  else c.joinRoom(clients[0].room.code);
  await joined;
  c.setReady(true);
  clients.push(c);
}
await new Promise(r => setTimeout(r, 400));
clients[0].start();
await new Promise(r => setTimeout(r, 600));

/**
 * A client only ever steps its own car; everyone else it draws by interpolating
 * between snapshots. A bot driving such a client therefore has to read the world
 * the same way the renderer does, or it is steering around cars that are still
 * sitting on the grid. Fold the interpolated view back into the local match
 * before asking the bot anything.
 */
function syncWorld(c) {
  const view = c.viewState();
  if (!view) return null;
  c.state.phase = c.headerPhase;
  c.state.tick = Math.round(c.serverTickNow());
  let mine = null;
  for (const car of view.cars) {
    const seat = c.state.byId[car.id];
    if (!seat) continue;
    seat.dead = car.dead;
    if (car.mine) { mine = { seat, rec: car }; continue; }
    seat.c.x = car.x; seat.c.z = car.z; seat.c.yaw = car.yaw;
  }
  if (!mine) return null;
  // the bot's stuck watchdog measures progress round the lap, which only the
  // server counts; lap and the ribbon hint between them are close enough
  const L = c.track.length;
  return { ...mine.seat, c: c.pred, id: c.me, stats: mine.seat.stats, progress: mine.rec.lap * L + c.pred.s };
}

// --- drive every client at exactly 60 Hz. A timer cannot be trusted to do that
// (Node rounds a 16.67 ms interval down to 16), so the loop consumes real time
// in fixed steps, exactly as the browser's animation frame does.
const t0 = performance.now();
let lastLoop = performance.now(), acc = 0;
const timer = setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - lastLoop) / 1000);
  lastLoop = now;
  let steps = 0;
  while (acc >= DT && steps++ < 8) {
    acc -= DT;
    for (const c of clients) {
      if (!c.state || !c.pred) continue;
      const shadow = syncWorld(c);
      if (!shadow) continue;
      c.tickInput(botInput(c.state, shadow, c.bot, Math.round(c.serverTickNow())));
      if (c.headerPhase === PHASE.RACING && c.raceTick > TICK_RATE) c.errors.push(c.predError);
    }
  }
}, 4);

const home = (c) => {
  const me = c.state?.byId?.[c.me];
  const rec = c.latest?.cars.find(r => r.id === c.me);
  return !!(rec && (rec.dead || rec.finished)) || !!me?.dead;
};
while (!clients.every(home) && performance.now() - t0 < SECONDS * 1000) await new Promise(r => setTimeout(r, 500));
clearInterval(timer);
const elapsed = (performance.now() - t0) / 1000;
const ranOut = !clients.every(home);

// --- report
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
let inB = 0, outB = 0, snaps = 0, hard = 0, resyncs = 0;
const errs = [];
for (const c of clients) {
  inB += c.stats.in; outB += c.stats.out; snaps += c.stats.snaps;
  hard += c.corrections; resyncs += c.clock.resyncs || 0; errs.push(...c.errors);
}
const rooms = [...lobby.rooms.values()];
const tickP95 = Math.max(0, ...rooms.map(r => r.tickP95()));
const finished = clients.filter(c => c.latest?.cars.find(r => r.id === c.me)?.finished).length;
const dead = clients.filter(c => c.latest?.cars.find(r => r.id === c.me)?.dead).length;

console.log(`ran ${elapsed.toFixed(1)} s · ${finished} finished, ${dead} wrecked of ${clients.length}` +
  (ranOut ? ` · ${clients.length - finished - dead} still out there when the window closed` : ''));
console.log(`server tick p95 ${tickP95.toFixed(2)} ms · ${snaps} snapshots · ${resyncs} clock resyncs`);
console.log(`per client: ${(inB / clients.length / elapsed / 1024).toFixed(1)} KB/s down · ${(outB / clients.length / elapsed / 1024).toFixed(1)} KB/s up`);
console.log(`prediction error after reconciliation: median ${pct(errs, 0.5).toFixed(3)} m · p95 ${pct(errs, 0.95).toFixed(3)} m · max ${pct(errs, 1).toFixed(3)} m · hard corrections ${hard}`);

// What this tool judges is the netcode, not the race: how far a car's own
// prediction drifts before reconciliation puts it back, how often that gap is
// too large to blend away, and what it all costs. Whether every car got home
// inside the window is a property of the circuit and the bots, and a long lap
// simply runs out of clock — it is reported, not failed on.
const raced = snaps > 0 && (finished + dead > 0 || ranOut);
const ok = tickP95 < 4 && pct(errs, 0.95) < 1.0 && hard === 0 && resyncs === 0 && raced;
console.log(ok
  ? `OK${ranOut ? ' (the race was still running; --seconds for a longer window)' : ''}`
  : 'FAIL: outside the baseline (tick p95 < 4 ms, error p95 < 1 m, no hard corrections, no clock resyncs)');
for (const c of clients) c.close();
lobby.close(); server.close();
process.exit(ok ? 0 : 1);
