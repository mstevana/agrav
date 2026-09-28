// ============================================================================
// Browser end-to-end: two headless Chromium clients join one Spacewar room,
// click bots into seats 3 and 4, and fly a one-round match to the results.
// Asserts the whole flow — connection, lobby, launch, snapshots flowing,
// prediction following the server, torpedoes, and the standings.
//
//   node tools/spacewartest.js [--shots DIR]   (starts its own server on a free port)
// ============================================================================

import { chromium } from 'playwright-core';
import { createServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';

const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
const { server } = createServer(new Lobby());
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/spacewar/`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const errors = [];
async function client(name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#online:not(.hidden)', { timeout: 5000 });
  await page.fill('#name', name);
  await page.dispatchEvent('#name', 'change');
  return page;
}
const step = (msg) => console.log('  · ' + msg);
const fail = (msg) => { console.error('FAIL: ' + msg); if (errors.length) console.error(errors.join('\n')); process.exit(1); };
const view = (page) => page.evaluate(() => {
  const { net } = window.__spacewar;
  const v = net.viewState();
  return v && { phase: v.phase, round: v.round, me: net.me, torps: v.torps.length,
    ships: v.ships.map((s) => s && { id: s.id, x: s.x, y: s.y, alive: s.alive, torps: s.torps }) };
});

try {
  const host = await client('Host');
  const guest = await client('Guest');
  await host.click('#create');
  await host.waitForSelector('#lobby:not(.hidden)', { timeout: 5000 });
  const code = (await host.textContent('#roomtitle')).replace('Room ', '').trim();
  step(`room ${code} created`);
  await guest.fill('#code', code);
  await guest.click('#join');
  await guest.waitForSelector('#lobby:not(.hidden)', { timeout: 5000 });
  await host.waitForFunction(() => document.querySelectorAll('#slots .who.human').length === 2, null, { timeout: 5000 });
  step('guest joined');
  await host.selectOption('#opt-rounds', '1');
  await guest.waitForFunction(() => document.getElementById('opt-rounds').value === '1', null, { timeout: 3000 });
  // the guest moves to the Manta, then the host puts bots in the two seats left
  await guest.click('#slots .slot.open >> nth=-1');
  await host.waitForFunction(() => window.__spacewar.net.room?.players.some((p) => p.id === 3 && !p.bot), null, { timeout: 3000 });
  step('guest picked the Manta');
  await host.click('#slots [data-bot] >> nth=0');
  await host.waitForFunction(() => document.querySelectorAll('#slots .who.bot').length === 1, null, { timeout: 3000 });
  await host.click('#slots [data-bot] >> nth=0');
  await host.waitForFunction(() => document.querySelectorAll('#slots .who.bot').length === 2, null, { timeout: 3000 });
  step('host added bots to the Wedge and the Hornet');
  if (!(await host.isDisabled('#start'))) fail('Launch is enabled while the guest is not ready');
  await guest.click('#ready');
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 3000 });
  step('Launch enabled once the guest is ready; the host never pressed Ready');
  await host.click('#start');
  await host.waitForFunction(() => window.__spacewar.app.playing, null, { timeout: 5000 });
  await guest.waitForFunction(() => window.__spacewar.app.playing, null, { timeout: 5000 });
  step('launched on both clients');

  await host.waitForFunction(() => window.__spacewar.net.viewState()?.phase === 'play', null, { timeout: 8000 });
  const v0 = await view(host);
  if (v0.ships.filter(Boolean).length !== 4) fail(`expected 4 ships, saw ${v0.ships.filter(Boolean).length}`);
  step('round 1 released: two pilots and two bots');
  if (SHOTS) await host.screenshot({ path: `${SHOTS}/e2e-host.png` });

  // the guest turns, burns and fires; its own ship must move under prediction at once
  const before = (await view(guest)).ships[3];
  await guest.keyboard.down('ArrowUp'); await guest.keyboard.down('Space'); await guest.keyboard.down('ArrowRight');
  await guest.waitForTimeout(700);
  const after = await view(guest);
  await guest.keyboard.up('ArrowUp'); await guest.keyboard.up('ArrowRight');
  if (after.ships[3].alive && Math.hypot(after.ships[3].x - before.x, after.ships[3].y - before.y) < 5) fail('guest ship did not move');
  step('guest ship flies');
  // and the host sees the guest's torpedoes, drawn from snapshots
  await host.waitForFunction(() => window.__spacewar.net.latest?.torps.some((t) => t.owner === 3) || !window.__spacewar.net.latest?.ships[3]?.alive, null, { timeout: 4000 })
    .catch(() => fail('host never saw a guest torpedo'));
  step('host sees the guest torpedoes');
  // the two clients agree on where the host's ship is, to within the interpolation delay
  const [h, g] = await Promise.all([view(host), view(guest)]);
  const hs = h.ships[0], gs = g.ships[0];
  if (hs.alive && gs.alive) {
    const dx = Math.abs(hs.x - gs.x), dy = Math.abs(hs.y - gs.y);
    const d = Math.hypot(Math.min(dx, 1600 - dx), Math.min(dy, 900 - dy));
    if (d > 80) fail(`clients disagree about the host ship by ${d.toFixed(1)} px`);
    step(`clients agree on the host ship (${d.toFixed(1)} px apart)`);
  }
  await guest.keyboard.up('Space');

  // a one-round match: wait for the standings on both
  await host.waitForSelector('#over:not(.hidden)', { timeout: 150000 });
  await guest.waitForSelector('#over:not(.hidden)', { timeout: 10000 });
  const rows = await host.$$eval('#standings tr', (trs) => trs.length - 1);
  if (rows !== 4) fail(`standings list ${rows} ships`);
  step(`results: ${await host.textContent('#overtitle')}`);
  if (SHOTS) await host.screenshot({ path: `${SHOTS}/e2e-results.png` });
  await host.click('#rematch');
  await host.waitForSelector('#lobby:not(.hidden)', { timeout: 3000 });
  step('back in the room');
  if (errors.length) fail('page errors');
  console.log('PASS');
} catch (e) {
  fail(e.stack || e.message);
} finally {
  await browser.close();
  server.close();
  process.exit(0);
}
