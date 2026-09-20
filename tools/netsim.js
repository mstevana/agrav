// ============================================================================
// Headless network soak: boots a server, connects N synthetic clients over
// real WebSockets through a latency/jitter/loss shim, drives each with the
// bot, and reports what the netcode is doing: prediction error after
// reconciliation, hard corrections, bandwidth, server tick time.
//
//   node tools/netsim.js [--players 12] [--rooms 1] [--rtt 80] [--jitter 20]
//                        [--loss 0.02] [--laps 1] [--track meridian] [--seconds 90]
//
// The synthetic client is the real browser client class (agrav/src/net.js):
// Node 22 has a global WebSocket and the class touches no DOM.
// ============================================================================

import { createServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';
import { Client } from '../agrav/src/net.js';
import { makeBot, botInput } from '../shared/agrav/bot.js';
import { HOT } from '../shared/net/protocol.js';
import { PHASE, TICK_RATE } from '../shared/agrav/constants.js';
import { VEHICLE_IDS } from '../shared/agrav/vehicles.js';

const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const PLAYERS = parseInt(arg('--players', '12'), 10);
const ROOMS = parseInt(arg('--rooms', '1'), 10);
const RTT = parseFloat(arg('--rtt', '80'));
const JITTER = parseFloat(arg('--jitter', '20'));
const LOSS = parseFloat(arg('--loss', '0.02'));
const LAPS = parseInt(arg('--laps', '1'), 10);
const TRACK = arg('--track', 'meridian');
const SECONDS = parseInt(arg('--seconds', '90'), 10);

// --- a WebSocket shim that delays and drops frames in both directions
const RealWS = globalThis.WebSocket;
// only the hot path (ping/pong, inputs, snapshots) may be dropped; control frames are reliable
const unreliable = (data) => { const u8 = data instanceof Uint8Array ? data : new Uint8Array(data); return u8[0] >= HOT; };
class ShimWS extends EventTarget {
  constructor(url) {
    super();
    this.ws = new RealWS(url);
    this.ws.binaryType = 'arraybuffer';
    this.readyState = 0;
    this.ws.addEventListener('open', () => { this.readyState = 1; this.dispatchEvent(new Event('open')); });
    this.ws.addEventListener('close', (e) => { this.readyState = 3; this.dispatchEvent(new Event('close')); });
    this.ws.addEventListener('error', () => this.dispatchEvent(new Event('error')));
    this.ws.addEventListener('message', (e) => {
      if (unreliable(e.data) && Math.random() < LOSS) return;
      setTimeout(() => { const ev = new Event('message'); ev.data = e.data; this.dispatchEvent(ev); }, this.delay());
    });
  }
  set binaryType(v) { /* always arraybuffer */ }
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

const { server, lobby } = createServer(new Lobby());
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `ws://127.0.0.1:${server.address().port}/ws`;
console.log(`netsim: ${ROOMS} room(s) × ${PLAYERS} players, rtt ${RTT} ms ±${JITTER}, loss ${(LOSS * 100).toFixed(1)}%, ${TRACK} × ${LAPS} lap(s)`);

const clients = [];
for (let r = 0; r < ROOMS; r++) {
  const room = [];
  for (let i = 0; i < PLAYERS; i++) {
    const c = new Client();
    c.token = null;
    await c.connect(url, `sim${r}-${i}`);
    c.bot = makeBot({ skill: 0.85 + (i % 5) * 0.05, noise: 0.2, lane: ((i % 5) - 2) * 2.2, phase: i * 0.37 });
    c.errSamples = []; c.snapsHard = 0;
    c.onEvents = ({ events }) => { if (events.some(e => e.t === 'go')) c.stats.corrections = 0; };
    room.push(c);
    clients.push(c);
    const roomMsg = new Promise(res => { c.onRoom = (m) => { if (m) res(m); if (m?.phase === 'running' && !c._loadedSent) { c._loadedSent = true; c.loaded(); } }; });   // a real client reports its scene built; so do we
    if (i === 0) c.createRoom({ track: TRACK, laps: LAPS }, false); else c.joinRoom(room[0].room.code);
    await roomMsg;
    c.setProfile({ vehicle: VEHICLE_IDS[i % VEHICLE_IDS.length], name: `sim${i}` });
    c.setReady(true);
  }
  await new Promise(r => setTimeout(r, 300));
  room[0].start();
}
await new Promise(r => setTimeout(r, 500));

// --- drive every client at 60 Hz with the bot, on the client's own predicted state
const t0 = performance.now();
let ticks = 0;
const timer = setInterval(() => {
  ticks++;
  for (const c of clients) {
    if (!c.race || !c.pred) continue;
    const me = c.race.byId[c.me];
    if (!me) continue;
    // the bot reads a racer whose vehicle state is our prediction
    const shadow = { ...me, v: c.pred, stats: me.stats, id: me.id };
    const input = botInput(c.race, shadow, c.bot, Math.round(c.serverTickNow()));
    const before = c.stats.maxErr;
    c.tickInput(input);
    c.frame(1 / TICK_RATE);
    // the grid reset at the countdown→racing edge is a deliberate snap, not a prediction miss
    if (c.stats.maxErr !== before) { if (c.phase === PHASE.RACING && c.raceTickNow() > TICK_RATE) c.errSamples.push(c.stats.maxErr); c.stats.maxErr = 0; }
  }
}, 1000 / TICK_RATE);

const done = () => clients.every(c => c.phase === PHASE.FINISHED || (c.race && c.race.byId[c.me] && (c.race.byId[c.me].dead || c.race.byId[c.me].finished)));
while (!done() && performance.now() - t0 < SECONDS * 1000) await new Promise(r => setTimeout(r, 500));
clearInterval(timer);
const elapsed = (performance.now() - t0) / 1000;

// --- report
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
let inB = 0, outB = 0, snaps = 0, hard = 0, resyncs = 0;
const errs = [];
for (const c of clients) { inB += c.stats.in; outB += c.stats.out; snaps += c.stats.snaps; hard += c.stats.corrections; resyncs += c.clock.resyncs || 0; errs.push(...c.errSamples); }
const rooms = [...lobby.rooms.values()];
const tickP95 = Math.max(...rooms.map(r => r.tickP95()));
const finished = clients.filter(c => c.race?.byId[c.me]?.finished).length;
const dead = clients.filter(c => c.race?.byId[c.me]?.dead).length;
console.log(`ran ${elapsed.toFixed(1)} s · ${finished} finished, ${dead} eliminated of ${clients.length}`);
for (const c of clients) { const r = c.race?.byId[c.me]; if (r && !r.finished && !r.dead) console.log(`  unfinished: ${r.name} lap ${r.lap} s=${c.pred.s.toFixed(0)} t=${c.pred.t.toFixed(1)} vs=${c.pred.vs.toFixed(1)} hp=${r.hp} phase=${c.phase} pending=${c.pending.length} lead=${c.clock.leadTicks}`); }
console.log(`server tick p95 ${tickP95.toFixed(2)} ms (${rooms.length} rooms) · snapshots ${snaps}`);
console.log(`per client: ${(inB / clients.length / elapsed / 1024).toFixed(1)} KB/s down · ${(outB / clients.length / elapsed / 1024).toFixed(1)} KB/s up · lead ${(clients.reduce((s, c) => s + (c.nextInputTick - c.serverTickNow()), 0) / clients.length).toFixed(1)} ticks`);
for (const c of clients) if (c.stats.corrections) console.log(`  hard snaps for ${c.name}: ${c.stats.corrections}\n    ${(c.stats.snapLog || []).slice(0, 6).map(x => JSON.stringify(x)).join('\n    ')}`);
console.log(`prediction error after reconciliation: median ${pct(errs, 0.5).toFixed(2)} m · p95 ${pct(errs, 0.95).toFixed(2)} m · max ${pct(errs, 1).toFixed(2)} m · hard snaps ${hard}`);
const ok = tickP95 < 4 && pct(errs, 0.95) < 1.0 && hard === 0 && finished + dead === clients.length;
console.log(ok ? 'OK' : 'FAIL: outside the baseline (tick p95 < 4 ms, error p95 < 1 m, no hard snaps, everyone finished or eliminated)');
for (const c of clients) c.close();
lobby.close(); server.close();
process.exit(ok ? 0 : 1);
