// ============================================================================
// Screenshots: three frames of a bot race on every track, and every craft on
// its own plus the whole grid. Full render quality through headless Chromium.
//
//   node tools/shots.js [outdir] [--only meridian,canyon] [--times 5,15,25]   default docs/screenshots, all tracks and craft
// ============================================================================

import { chromium } from 'playwright-core';
import { mkdirSync } from 'fs';
import { createServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';
import { TRACK_IDS } from '../shared/agrav/tracks/index.js';
import { VEHICLE_IDS } from '../shared/agrav/vehicles.js';

const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx > 0 ? process.argv[onlyIdx + 1].split(',') : null;
const hideIdx = process.argv.indexOf('--hide');
const HIDE = hideIdx > 0 ? process.argv[hideIdx + 1].split(',') : [];   // object names to hide before capture (diagnostics)
const OUT = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : new URL('../docs/screenshots', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const { server, lobby } = createServer(new Lobby());
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/agrav/`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
ctx.setDefaultTimeout(180000);   // software GL builds a full scene in tens of seconds
await ctx.addInitScript(() => { try { localStorage.setItem('agrav_settings_v1', JSON.stringify({ quality: 'high', sound: false, music: false, name: 'Pilot' })); } catch {} });

// where along the lap to capture (fractions of the lap length), or --times for race seconds. Under software
// GL every capture costs about a lap of race time, so waiting for a position is what spreads the frames out.
const timesIdx = process.argv.indexOf('--times');
const TIMES = timesIdx > 0 ? process.argv[timesIdx + 1].split(',').map(Number) : null;
const atIdx = process.argv.indexOf('--at');
const AT = atIdx > 0 ? process.argv[atIdx + 1].split(',').map(Number) : [0.12, 0.45, 0.78];
for (const track of TRACK_IDS.filter(t => !ONLY || ONLY.includes(t))) {
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error(track, 'pageerror', e.message));
  page.on('console', m => { if (m.text().startsWith('pose')) console.log(track, m.text()); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.click('#btn-create');
  await page.waitForSelector('#screen-lobby:not([hidden])');
  await page.click(`[data-track="${track}"]`);
  await page.waitForFunction((t) => window.__agrav.client.room?.opts.track === t, track);
  await page.evaluate(() => window.__agrav.client.setOpts({ laps: 6 }));   // room to wait for three positions
  await page.waitForFunction(() => window.__agrav.client.room?.opts.laps === 6);
  for (let i = 0; i < 5; i++) await page.click('#btn-addbot');
  await page.waitForFunction(() => document.querySelectorAll('#players .prow').length === 6);
  await page.click('[data-vehicle="corsair"]');
  await page.click('#btn-ready');
  await page.waitForFunction(() => !document.getElementById('btn-start').disabled);
  await page.click('#btn-start');
  await page.waitForSelector('#hud:not([hidden])');
  await page.evaluate(() => { window.__agrav.scene().fx.pickupFlash = () => {}; });   // the shield absorbs bot fire with a flash ring every hit: not scenery
  await page.waitForFunction(() => window.__agrav.client.phase === 2, null, { timeout: 15000 });
  // the pilot is here to be photographed, not shot: a permanent shield absorbs everything, and the
  // server drives the craft with the shared bot, because a software-GL client at 4 fps cannot get its
  // own inputs there in time
  const room = [...lobby.rooms.values()][0];
  const hostPlayer = [...room.players.values()].find(p => !p.bot);
  const hostRacer = room.state.byId[hostPlayer.id];
  const origTick = room._doTick.bind(room), origInputs = room.onInputs.bind(room);
  room._doTick = () => { const t = room.tick + 1; const b = room.game.botInput(room.state, hostPlayer.id, t); if (b) hostPlayer.inputs.set(t, { bits: b.bits, steer: b.steer, seq: 0 }); origTick(); };
  room.onInputs = (session, records) => { if (session.playerId === hostPlayer.id) return; origInputs(session, records); };
  const topUp = setInterval(() => { hostRacer.hp = hostRacer.maxHp; hostRacer.v.shieldT = 60; }, 100);
  // the software renderer runs slow: wait on the race clock, not wall time
  const shots = TIMES ? TIMES.length : AT.length;
  for (let i = 0; i < shots; i++) {
    if (TIMES) await page.waitForFunction((t) => window.__agrav.client.raceTickNow() >= t * 60, TIMES[i], { timeout: 120000 });
    else await page.waitForFunction((frac) => { const c = window.__agrav.client; const p = c.myPose(); if (!p || c.raceTickNow() < 300) return false; const L = c.ribbon.length, s0 = frac * L; const d = ((p.s - s0) % L + L) % L; return d < 160; }, AT[i], { timeout: 240000 });
    await page.waitForTimeout(300);
    // pickup flashes and hit rings are not scenery: clear them right before the capture
    await page.evaluate((hide) => { const sc = window.__agrav.scene(); const fx = sc.fx; for (const e of fx.live) e.obj?.parent?.remove(e.obj); fx.live.length = 0; sc.three.traverse(o => { if (hide.includes(o.name)) o.visible = false; }); const p = window.__agrav.client.myPose(); const { camera, THREE } = window.__agrav;
      // what stands between the camera and the craft (diagnostics for furniture in the shot)
      const me = sc.crafts.get(window.__agrav.client.me); let hit = null;
      if (me) { const dir = new THREE.Vector3(); camera.getWorldDirection(dir); const ray = new THREE.Raycaster(camera.position, dir, 0.1, 60); ray.camera = camera; const hits = ray.intersectObjects(sc.three.children, true).filter(h => !h.object.isSprite && h.object.geometry?.type !== 'SphereGeometry'); hit = hits[0] ? { name: hits[0].object.name || hits[0].object.type, d: +hits[0].distance.toFixed(1), geo: hits[0].object.geometry?.type } : null; }
      console.log('pose', JSON.stringify({ s: p?.s, t: p?.t, h: p?.h, hit })); }, HIDE);
    const file = `${OUT}/${track}-${i + 1}.png`;
    await page.screenshot({ path: file });
    const info = await page.evaluate(() => { const r = window.__agrav.renderer.info; return { tris: r.render.triangles, calls: r.render.calls, geos: r.memory.geometries, tex: r.memory.textures }; });
    console.log('wrote', file, `triangles=${info.tris} calls=${info.calls} geometries=${info.geos} textures=${info.tex}`);
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
