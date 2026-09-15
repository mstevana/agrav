// ============================================================================
// Screenshots: three frames of a bot race on every track, and every craft on
// its own plus the whole grid. Full render quality through headless Chromium.
//
//   node tools/shots.js [outdir] [--only meridian,canyon]   default docs/screenshots, all tracks and craft
// ============================================================================

import { chromium } from 'playwright-core';
import { mkdirSync } from 'fs';
import { createServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';
import { TRACK_IDS } from '../shared/agrav/tracks/index.js';
import { VEHICLE_IDS } from '../shared/agrav/vehicles.js';

const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx > 0 ? process.argv[onlyIdx + 1].split(',') : null;
const OUT = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : new URL('../docs/screenshots', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const { server, lobby } = createServer(new Lobby());
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/agrav/`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { try { localStorage.setItem('agrav_settings_v1', JSON.stringify({ quality: 'high', sound: false, music: false, name: 'Pilot' })); } catch {} });

const TIMES = [5, 15, 25];   // seconds after the flag
for (const track of TRACK_IDS.filter(t => !ONLY || ONLY.includes(t))) {
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error(track, 'pageerror', e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.click('#btn-create');
  await page.waitForSelector('#screen-lobby:not([hidden])');
  await page.click(`[data-track="${track}"]`);
  await page.waitForFunction((t) => window.__agrav.client.room?.opts.track === t, track);
  for (let i = 0; i < 5; i++) await page.click('#btn-addbot');
  await page.waitForFunction(() => document.querySelectorAll('#players .prow').length === 6);
  await page.click('[data-vehicle="corsair"]');
  await page.click('#btn-ready');
  await page.waitForFunction(() => !document.getElementById('btn-start').disabled);
  await page.click('#btn-start');
  await page.waitForSelector('#hud:not([hidden])');
  await page.evaluate(() => { window.__agrav.ui.autopilot = true; });
  await page.waitForFunction(() => window.__agrav.client.phase === 2, null, { timeout: 15000 });
  // the pilot is here to be photographed, not shot: a permanent shield absorbs everything
  const room = [...lobby.rooms.values()][0];
  const hostRacer = room.state.byId[[...room.players.values()].find(p => !p.bot).id];
  const topUp = setInterval(() => { hostRacer.hp = hostRacer.maxHp; hostRacer.v.shieldT = 60; }, 100);
  // the software renderer runs slow: wait on the race clock, not wall time
  let last = 0;
  for (let i = 0; i < TIMES.length; i++) {
    await page.waitForFunction((t) => window.__agrav.client.raceTickNow() >= t * 60, TIMES[i], { timeout: 120000 });
    await page.waitForTimeout(300);
    const file = `${OUT}/${track}-${i + 1}.png`;
    await page.screenshot({ path: file });
    console.log('wrote', file);
    last = TIMES[i];
  }
  clearInterval(topUp);
  await page.close();
  for (const r of [...lobby.rooms.values()]) lobby.destroyRoom(r);
}
void 0;
for (const id of [...VEHICLE_IDS, 'all'].filter(v => !ONLY || ONLY.includes('craft'))) {
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error(id, 'pageerror', e.message));
  await page.goto(`${base}?showcase=${id}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__agrav?.showcaseReady, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const file = `${OUT}/craft-${id}.png`;
  await page.screenshot({ path: file });
  console.log('wrote', file);
  await page.close();
}
await browser.close();
server.close();
process.exit(0);
