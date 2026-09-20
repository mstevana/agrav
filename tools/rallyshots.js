#!/usr/bin/env node
// ============================================================================
// Screenshots of Scrap Rally: boots a server, starts a bots-only race on each
// circuit and photographs it from the car that is leading.
//
//   node tools/rallyshots.js [outdir] [--lite] [--track scrapyard] [--at 8,22]
//
// Headless Chromium on software GL, so the frame counter reads low; a real GPU
// runs the same scene at sixty.
// ============================================================================

import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { createServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';
import { MemoryStore } from '../server/store.js';
import { TRACK_IDS } from '../shared/rally/tracks/index.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const OUT = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--track' && args[args.indexOf(a) - 1] !== '--at') || 'docs/screenshots/rally';
const LITE = args.includes('--lite');
const TRACKS = flag('--track', null) ? [flag('--track', null)] : [...TRACK_IDS];
const AT = flag('--at', '10,26').split(',').map(Number);

const lobby = new Lobby({ store: new MemoryStore() });
const { server } = createServer(lobby);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await fs.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
});

for (const track of TRACKS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${port}/rally/${LITE ? '?lite=1' : ''}`, { waitUntil: 'networkidle' });
  await page.fill('#name', 'Camera');
  await page.selectOption('#opt-track', track);
  await page.selectOption('#opt-laps', '7');
  await page.click('#create');
  await page.waitForSelector('#lobby:not(.hidden)', { timeout: 10000 });
  await page.click('#ready');
  await page.click('#start');
  await page.waitForFunction(() => window.__rally.app.playing, null, { timeout: 15000 });
  // watch the race rather than drive it: follow whoever is leading
  await page.evaluate(() => { window.__rally.app.spectate = -1; });
  let last = 0;
  for (const at of AT) {
    await page.waitForTimeout(Math.max(0, (at - last) * 1000));
    last = at;
    await page.evaluate(() => {
      const v = window.__rally.net.viewState();
      const lead = v?.cars.filter(c => !c.dead).sort((a, b) => a.rank - b.rank)[0];
      if (lead) window.__rally.app.spectate = lead.id;
      const me = window.__rally.net.state.byId[window.__rally.net.me];
      if (me) me.dead = true;                       // so the camera is free to follow
    });
    await page.waitForTimeout(400);
    const file = `${OUT}/${track}-${AT.indexOf(at) + 1}.png`;
    await page.screenshot({ path: file });
    console.log('wrote', file);
  }
  await page.close();
}

await browser.close();
server.close();
lobby.close();
process.exit(0);
