#!/usr/bin/env node
// ============================================================================
// Browser end to end for Scrap Rally: two headless Chromium clients join one
// race, the grid fills itself with bots, both drive, and the run asserts the
// whole flow — connection, lobby, the grid hold, the countdown, snapshots
// flowing, prediction reconciling against the server, and a result at the end.
//
//   node tools/rallytest.js [--keep] [--shots DIR]
// ============================================================================

import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { createServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';
import { MemoryStore } from '../server/store.js';

const KEEP = process.argv.includes('--keep');
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;

const lobby = new Lobby({ store: new MemoryStore() });
const { server } = createServer(lobby);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/rally/?lite=1`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
});
const errors = [];
const step = (m) => console.log('  · ' + m);
const fail = (m) => { console.error('FAIL: ' + m); if (errors.length) console.error(errors.join('\n')); process.exit(1); };

async function client(name) {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  // not networkidle: the client polls /api/health, so the network never goes idle
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.fill('#name', name);
  return page;
}

try {
  const host = await client('Host');
  const guest = await client('Guest');

  await host.selectOption('#opt-laps', '1');
  await host.click('#create');
  await host.waitForSelector('#lobby:not(.hidden)', { timeout: 8000 });
  const code = (await host.textContent('#roomcode')).trim();
  step(`race ${code} created`);

  await guest.fill('#code', code);
  await guest.click('#join');
  await guest.waitForSelector('#lobby:not(.hidden)', { timeout: 8000 });
  await host.waitForFunction(() => window.__rally.app.room?.players.length === 2, null, { timeout: 5000 });
  step('guest joined');

  await host.click('#ready');
  await guest.click('#ready');
  await host.click('#start');
  await host.waitForFunction(() => window.__rally.app.playing, null, { timeout: 10000 });
  await guest.waitForFunction(() => window.__rally.app.playing, null, { timeout: 10000 });
  const seats = await host.evaluate(() => window.__rally.app.room.players.length);
  if (seats !== 6) fail(`the grid should have filled to six, got ${seats}`);
  step('race started on both clients, grid filled to six');

  // hold the throttle on both and let the countdown run out
  await host.keyboard.down('ArrowUp');
  await guest.keyboard.down('ArrowUp');
  await host.waitForFunction(() => window.__rally.net.headerPhase === 2, null, { timeout: 15000 });
  step('countdown finished, flag dropped');

  await host.waitForTimeout(4000);
  const room = [...lobby.rooms.values()][0];
  const hostId = await host.evaluate(() => window.__rally.net.me);
  const serverCar = room.state.byId[hostId];
  const serverSpeed = Math.hypot(serverCar.c.vx, serverCar.c.vz);
  step(`the server has the host at ${serverSpeed.toFixed(1)} m/s`);
  if (serverSpeed < 12) fail('the host is not moving on the server under throttle');

  const stats = await host.evaluate(() => {
    const n = window.__rally.net;
    return { snaps: n.snaps.length, corrections: n.corrections, predError: n.predError, rtt: n.rtt,
             cars: n.viewState()?.cars.length ?? 0, moving: n.viewState()?.cars.filter(c => c.speed > 8).length ?? 0 };
  });
  step(`client: ${stats.cars} cars drawn, ${stats.moving} of them moving, prediction error ${stats.predError.toFixed(3)} m, ` +
       `${stats.corrections} hard corrections, ${Math.round(stats.rtt)} ms`);
  if (stats.cars !== 6) fail(`the client should be drawing six cars, got ${stats.cars}`);
  if (stats.moving < 4) fail('the bots are not driving on the client');
  if (stats.predError > 1.5) fail(`prediction error of ${stats.predError.toFixed(2)} m is too large on a local socket`);
  if (stats.corrections > 0) fail(`${stats.corrections} hard corrections on a local socket`);

  if (SHOTS) {
    await fs.mkdir(SHOTS, { recursive: true });
    await host.screenshot({ path: `${SHOTS}/rally-race.png` });
    step(`screenshot written to ${SHOTS}/rally-race.png`);
  }

  // let it run to the flag
  await host.waitForSelector('#over:not(.hidden)', { timeout: 180000 });
  await guest.waitForSelector('#over:not(.hidden)', { timeout: 20000 });
  const rows = await host.$$eval('#overrows tr', trs => trs.map(tr => tr.textContent.replace(/\s+/g, ' ').trim()));
  step('results: ' + rows.join(' | '));
  if (rows.length !== 6) fail(`expected six result rows, got ${rows.length}`);
  if (SHOTS) await host.screenshot({ path: `${SHOTS}/rally-results.png` });

  // The garage, on the driver who actually came home: a wrecked car earns
  // nothing but what it picked up, which is the whole point of the rule.
  await guest.click('#to-garage');
  await guest.waitForSelector('#garage:not(.hidden)', { timeout: 8000 });
  await guest.waitForFunction(() => !!window.__rally.net.career, null, { timeout: 8000 });
  const record = await guest.evaluate(() => window.__rally.net.career);
  const offersRepair = await guest.evaluate(() => document.body.innerHTML.includes('Repair for'));
  step(`garage: ${record.money} in hand after ${record.races} race, repair offered: ${offersRepair}`);
  if (!(record.money > 0)) fail('placing in the race paid nothing');
  if (!(record.races === 1)) fail('the race was not recorded');
  if (!offersRepair) fail('a damaged car was not offered a repair');

  // and nothing else is for sale until it is paid for
  const lockedOut = await guest.evaluate(() =>
    [...document.querySelectorAll('[data-action="buyCar"],[data-action="upgrade"]')].every(b => b.disabled));
  if (!lockedOut) fail('the shop was open while the car was damaged');

  const before = record.money;
  await guest.click('[data-action="repair"]');
  await guest.waitForFunction((m) => window.__rally.net.career.money < m, before, { timeout: 8000 });
  const after = await guest.evaluate(() => window.__rally.net.career);
  step(`repaired: ${before} -> ${after.money}, hull back to ${Math.round(after.hull)}`);
  if (after.money >= before) fail('the repair cost nothing');
  const openNow = await guest.evaluate(() =>
    [...document.querySelectorAll('[data-action="upgrade"]')].some(b => !b.disabled));
  if (!openNow) fail('the shop stayed shut after the repair');

  // What the shop changes has to reach the seat, not just the record. The room
  // broadcast is what the next race is built from, on the server and on every
  // client, so a seat still showing the pre-purchase car means the next race is
  // run in the car you just traded away.
  const seatOf = (page) => page.evaluate(() => {
    const net = window.__rally.net;
    return net.room?.players.find(p => p.id === net.me)?.profile ?? null;
  });
  const seatCatchesUp = (page, key, want) => page.waitForFunction(({ k, v }) => {
    const net = window.__rally.net;
    const seat = net.room?.players.find(p => p.id === net.me)?.profile;
    return seat && seat[k] === v;
  }, { k: key, v: want }, { timeout: 8000 }).catch(() => {});

  // an armour upgrade raises maxHull, which the seat only knows if it was
  // re-seated: a stale seat keeps the number the car had when it joined
  const armourBefore = (await seatOf(guest))?.maxHull;
  const canUpgrade = await guest.evaluate(() =>
    !!document.querySelector('[data-action="upgrade"][data-stat="armour"]:not([disabled])'));
  if (!canUpgrade) fail('armour could not be upgraded after the repair, so the seat check has nothing to bite on');
  await guest.click('[data-action="upgrade"][data-stat="armour"]');
  await guest.waitForFunction(() => window.__rally.net.career.upgrades.armour > 0, null, { timeout: 8000 });
  const recordAfterUpgrade = await guest.evaluate(() => window.__rally.net.career);
  await seatCatchesUp(guest, 'maxHull', recordAfterUpgrade.maxHull ?? -1);
  const seatAfterUpgrade = await seatOf(guest);
  if (!seatAfterUpgrade) fail('the guest has no seat in the room');
  if (seatAfterUpgrade.upgrades?.armour !== recordAfterUpgrade.upgrades.armour) {
    fail(`the record is on armour ${recordAfterUpgrade.upgrades.armour} but the seat still says ${seatAfterUpgrade.upgrades?.armour}`);
  }
  step(`armour upgrade reached the seat: maxHull ${armourBefore} -> ${seatAfterUpgrade.maxHull}, armour ${seatAfterUpgrade.upgrades.armour}`);

  // and the same for a whole car, when the guest can still afford one
  const buyable = await guest.evaluate(() => {
    const b = [...document.querySelectorAll('[data-action="buyCar"]')].find(x => !x.disabled);
    return b ? b.dataset.car : null;
  });
  if (buyable) {
    await guest.click(`[data-action="buyCar"][data-car="${buyable}"]`);
    await guest.waitForFunction((car) => window.__rally.net.career.car === car, buyable, { timeout: 8000 });
    await seatCatchesUp(guest, 'car', buyable);
    const seatAfterBuy = await seatOf(guest);
    if (seatAfterBuy?.car !== buyable) fail(`bought a ${buyable} but the seat still says ${seatAfterBuy?.car}`);
    step(`bought a ${buyable} and the seat says ${seatAfterBuy.car}`);
  } else {
    step('no car was affordable after the upgrade, so only the upgrade was checked against the seat');
  }

  // the damage is persistent: whatever the host finished the race on is what its
  // record now says, and a car that exploded earns no place money for it
  const hostRecord = await host.evaluate(() => window.__rally.net.career);
  const hostRow = await host.evaluate(() => {
    const r = window.__rally.app.lastResults;
    return r?.order.find(o => o.id === window.__rally.net.me) || null;
  });
  if (!hostRow) fail('the host never saw its own result');
  step(`the host came home ${hostRow.eliminated ? 'wrecked' : `on ${hostRow.hull} hull`}` +
       ` and its record says ${Math.round(hostRecord.hull)}, with ${hostRecord.money} in hand`);
  if (Math.round(hostRecord.hull) !== Math.round(hostRow.hull)) {
    fail(`the record kept ${hostRecord.hull} hull but the race ended on ${hostRow.hull}`);
  }
  if (hostRow.eliminated && !hostRow.finished && hostRecord.money > (hostRow.cash || 0) + (hostRow.kills || 0) * 1000) {
    fail('an exploded car was paid place money');
  }

  if (errors.length) fail('page errors:\n' + errors.join('\n'));
  console.log('PASS');
} catch (e) {
  console.error(e);
  fail(e.message);
} finally {
  if (!KEEP) { await browser.close(); server.close(); lobby.close(); process.exit(0); }
}
