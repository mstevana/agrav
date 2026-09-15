// ============================================================================
// Browser end-to-end: two headless Chromium clients join one room, race with
// a bot, and the test asserts the whole flow — connection, lobby, start,
// snapshots flowing, prediction reconciling, elimination and results.
//
//   node tools/racetest.js [--keep]        (starts its own server on a free port)
// ============================================================================

import { chromium } from 'playwright-core';
import { createServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';

const KEEP = process.argv.includes('--keep');
const { server, lobby } = createServer(new Lobby());
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/agrav/?lite=1`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function client(name) {
  const page = await browser.newPage({ viewport: { width: 720, height: 400 } });
  // the software renderer is slow: run the client at its lowest quality so the loop keeps up
  await page.addInitScript(() => { try { localStorage.setItem('agrav_settings_v1', JSON.stringify({ quality: 'low', sound: false, music: false })); } catch {} });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.fill('#name', name);
  return page;
}
const step = (msg) => console.log('  · ' + msg);
const fail = (msg) => { console.error('FAIL: ' + msg); if (errors.length) console.error(errors.join('\n')); process.exit(1); };

try {
  const host = await client('Host');
  const guest = await client('Guest');
  await host.click('#btn-create');
  await host.waitForSelector('#screen-lobby:not([hidden])', { timeout: 8000 });
  const code = await host.textContent('#lobby-code');
  step(`room ${code} created`);
  await guest.fill('#join-code', code);
  await guest.click('#btn-join');
  await guest.waitForSelector('#screen-lobby:not([hidden])', { timeout: 8000 });
  await host.waitForFunction(() => document.querySelectorAll('#players .prow').length === 2, null, { timeout: 5000 });
  step('guest joined');
  await guest.click('[data-vehicle="kestrel"]');
  await host.click('[data-track="vanta"]');
  await host.click('#laps-minus'); await host.click('#laps-minus');   // 1 lap
  await host.waitForFunction(() => document.getElementById('laps').textContent === '1', null, { timeout: 3000 });
  await host.click('#btn-addbot');
  await host.waitForFunction(() => document.querySelectorAll('#players .prow').length === 3, null, { timeout: 3000 });
  step('vanta, 1 lap, one bot');
  await host.click('#btn-ready'); await guest.click('#btn-ready');
  await host.waitForFunction(() => !document.getElementById('btn-start').disabled, null, { timeout: 3000 });
  await host.click('#btn-start');
  await host.waitForSelector('#hud:not([hidden])', { timeout: 8000 });
  await guest.waitForSelector('#hud:not([hidden])', { timeout: 8000 });
  step('race started on both clients');

  // the host drives by hand (throttle only) for the movement/prediction checks; the guest is on autopilot
  await host.keyboard.down('ArrowUp');
  await guest.evaluate(() => { window.__agrav.ui.autopilot = true; });
  await host.waitForFunction(() => window.__agrav.client.phase === 2, null, { timeout: 8000 });
  step('countdown done');
  await host.waitForTimeout(4000);
  const stats = await host.evaluate(() => {
    const c = window.__agrav.client;
    const me = c.myPose();
    const others = c.othersPoses();
    return { snaps: c.stats.snaps, inBytes: c.stats.in, outBytes: c.stats.out, maxErr: c.stats.maxErr, corrections: c.stats.corrections,
      rtt: c.rtt, lead: c.clock.leadTicks, resyncs: c.clock.resyncs || 0, myS: me.s, mySpeed: Math.hypot(me.vs, me.vt), others: others.racers.map(r => ({ id: r.id, s: r.s, speed: Math.hypot(r.vs, r.vt) })),
      fps: document.getElementById('hud-net').textContent };
  });
  const serverSpeed = (() => { const r = [...lobby.rooms.values()][0]; const hid = r && [...r.players.values()].find(p => p.name === 'Host'); return hid ? r.state.byId[hid.id].v.vs : 0; })();
  step(`server sees the host at ${serverSpeed.toFixed(1)} m/s after 4 s`);
  step(`host after 4 s: speed ${stats.mySpeed.toFixed(1)} m/s, ${stats.snaps} snapshots, ${(stats.inBytes / 4 / 1024).toFixed(1)} KB/s down, ${(stats.outBytes / 4 / 1024).toFixed(1)} KB/s up, max prediction error ${stats.maxErr.toFixed(2)} m, snaps ${stats.corrections}, lead ${stats.lead} ticks, ${stats.resyncs} clock resyncs, ${stats.fps}`);
  if (process.env.RACETEST_DEBUG) {
    await host.screenshot({ path: process.env.RACETEST_SHOT || '/tmp/racetest-host.png' });
    const room0 = [...lobby.rooms.values()][0];
    const hid = await host.evaluate(() => window.__agrav.client.me);
    const p0 = room0.players.get(hid), r0 = room0.state.byId[hid];
    console.log('SERVER host: input', JSON.stringify(r0.input), 'vs', r0.v.vs.toFixed(1), 's', r0.v.s.toFixed(1), 't', r0.v.t.toFixed(2), 'margin', p0.margin, 'lastSeq', p0.lastSeq, 'tick', room0.tick, 'phase', room0.state.phase, 'hp', r0.hp, 'dead', r0.dead);
    console.log('CLIENT host:', JSON.stringify(await host.evaluate(() => { const c = window.__agrav.client; return { read: window.__agrav.input?.read?.() ?? null, pending: c.pending.length, firstPending: c.pending[0], lastPending: c.pending[c.pending.length - 1], serverTick: c.serverTickNow(), nextInputTick: c.nextInputTick, phase: c.phase, predBits: c.pred.bits, predVs: c.pred.vs, latestTick: c.latest.tick }; })));
  }
  // the first seconds include the clock finding its feet; the steady state is what matters
  await host.evaluate(() => { window.__agrav.client.stats.maxErr = 0; window.__agrav.client.stats.corrections = 0; });
  await host.waitForTimeout(3000);
  const settled = await host.evaluate(() => { const c = window.__agrav.client; return { maxErr: c.stats.maxErr, corrections: c.stats.corrections, lead: c.clock.leadTicks, pendingTicks: c.pending.map(i => i.tick), speed: Math.hypot(c.myPose().vs, c.myPose().vt) }; });
  step(`settled: max prediction error ${settled.maxErr.toFixed(2)} m, ${settled.corrections} snaps, lead ${settled.lead}, speed ${settled.speed.toFixed(1)}, pending ticks ${settled.pendingTicks.join(',')}`);
  stats.maxErr = settled.maxErr;
  if (stats.snaps < 60) fail('too few snapshots');
  if (serverSpeed < 40) fail('host is not moving under throttle (server side)');
  if (stats.maxErr > 6) fail('prediction error too large');
  if (!stats.others.every(o => o.speed > 20)) fail('other racers not moving: ' + JSON.stringify(stats.others));

  // the guest gets a rocket and shoots the host (test hook: server-side item grant)
  const room = [...lobby.rooms.values()][0];
  const guestId = await guest.evaluate(() => window.__agrav.client.me);
  const hostId = await host.evaluate(() => window.__agrav.client.me);
  const g = room.state.byId[guestId], h = room.state.byId[hostId];
  await host.keyboard.up('ArrowUp');
  await host.evaluate(() => { window.__agrav.ui.autopilot = true; });
  h.hp = 5; h.v.shieldT = 0;
  // park host directly ahead of guest on the same line
  h.v.s = g.v.s + 30; h.v.t = g.v.t; h.v.vs = g.v.vs; h.v.yaw = 0;
  g.item = 'missile'; g.ammo = 1;
  await guest.keyboard.down('Space'); await guest.waitForTimeout(120); await guest.keyboard.up('Space');
  await host.waitForFunction(() => window.__agrav.client.race.byId[window.__agrav.client.me].dead, null, { timeout: 6000 }).catch(() => fail('host was not eliminated by the missile'));
  step('host eliminated by a missile, now spectating');
  const status = await host.textContent('#hud-status');
  if (!/ELIMINATED/.test(status)) fail('spectator status not shown: ' + status);

  // let the guest finish the lap; the bot finishes too; results appear
  await guest.waitForSelector('#screen-results:not([hidden])', { timeout: 120000 });
  await host.waitForSelector('#screen-results:not([hidden])', { timeout: 10000 });
  const rows = await host.$$eval('#results-table tbody tr', trs => trs.map(tr => tr.textContent.replace(/\s+/g, ' ').trim()));
  step('results: ' + rows.join(' | '));
  if (rows.length !== 3) fail('expected 3 result rows');
  if (!/destroyed by Guest/.test(rows.join(' '))) fail('host row should say destroyed by Guest');

  // room goes back to the lobby for a rematch
  await host.click('#btn-results-ready');
  await host.waitForSelector('#screen-lobby:not([hidden])', { timeout: 5000 });
  step('back in the lobby');
  if (errors.length) fail('page errors:\n' + errors.join('\n'));
  console.log('PASS racetest');
} catch (e) {
  console.error(e);
  fail(e.message);
} finally {
  if (!KEEP) { await browser.close(); lobby.close(); server.close(); }
}
