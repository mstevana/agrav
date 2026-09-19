import { test } from 'node:test';
import assert from 'node:assert/strict';
import module from '../agrav/module.js';
import { IN } from '../net/protocol.js';
import { PHASE, COUNTDOWN_SEC, WEAPON, TICK_RATE } from '../agrav/constants.js';
import { deltaS } from '../sim/spline.js';

function race(opts = { track: 'meridian', laps: 1 }, n = 2, bots = false) {
  const st = module.createMatch(opts, 3);
  for (let i = 0; i < n; i++) module.addPlayer(st, i, { vehicle: 'corsair', name: 'P' + i }, bots);
  return st;
}
function run(st, ticks, inputFor, ev = []) {
  for (let i = 0; i < ticks; i++) {
    const t = st.tick + 1;
    for (const r of st.racers) module.applyInput(st, r.id, inputFor(r, t), t);
    module.step(st, t, ev);
  }
  return ev;
}
const throttle = () => ({ bits: IN.THROTTLE, steer: 0 });
const idle = () => ({ bits: 0, steer: 0 });

test('grid sits behind the line and the countdown freezes everyone', () => {
  const st = race();
  module.start(st, 0);
  assert.equal(st.phase, PHASE.COUNTDOWN);
  for (const r of st.racers) assert.ok(r.progress < 0 && r.v.s > st.ribbon.length - 60);
  const ev = run(st, COUNTDOWN_SEC * TICK_RATE - 1, throttle);
  for (const r of st.racers) assert.equal(Math.hypot(r.v.vs, r.v.vt), 0);
  assert.ok(!ev.some(e => e.t === 'go'));
  run(st, 1, throttle, ev);
  assert.equal(st.phase, PHASE.RACING);
  assert.ok(ev.some(e => e.t === 'go'));
});

test('bots complete laps; lap and finish events fire; results are ordered', () => {
  const st = race({ track: 'meridian', laps: 2 }, 3, true);
  module.start(st, 0);
  const ev = [];
  let n = 0;
  while (!module.isOver(st) && n++ < 60 * 200) {
    const t = st.tick + 1;
    for (const r of st.racers) module.applyInput(st, r.id, module.botInput(st, r.id, t), t);
    module.step(st, t, ev);
  }
  assert.ok(module.isOver(st), 'race finished');
  const laps = ev.filter(e => e.t === 'lap');
  const fin = ev.filter(e => e.t === 'finish');
  assert.ok(laps.length >= 1 && fin.length >= 1);
  const res = module.results(st);
  assert.equal(res.order.length, 3);
  for (let i = 1; i < res.order.length; i++) {
    const a = res.order[i - 1], b = res.order[i];
    if (a.finished && b.finished) assert.ok(a.time <= b.time);
    if (!a.finished) assert.ok(!b.finished, 'finishers rank above everyone else');
  }
});

test('bots take weapon pads and shoot each other', () => {
  // A six-bot race is chaotic: across seeds the same fixture ranges over 13-30 pickups and 5-84
  // hits, so a single race proves nothing and a threshold fitted to one is a tripwire for any
  // balance change. Sum four seeds and leave the bounds slack -- what is being asserted is that
  // bots arm themselves and shoot each other at all, not a particular number.
  let pickups = 0, weaponHits = 0, selfHits = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const st = module.createMatch({ track: 'meridian', laps: 9 }, seed);
    for (let i = 0; i < 6; i++) module.addPlayer(st, i, { vehicle: 'corsair', name: 'P' + i }, true);
    module.start(st, 0);
    for (let t = 1; t <= 90 * TICK_RATE; t++) {
      for (const r of st.racers) module.applyInput(st, r.id, module.botInput(st, r.id, t), t);
      const ev = [];
      module.step(st, t, ev);
      for (const e of ev) {
        if (e.t === 'pickup') pickups++;
        if (e.t === 'hit' && e.by >= 0 && e.source !== 'ram') { weaponHits++; if (e.by === e.id) selfHits++; }
      }
    }
  }
  assert.ok(pickups >= 50, `bots collected ${pickups} items over four races`);
  assert.ok(weaponHits >= 40, `bots landed ${weaponHits} weapon hits on each other over four races`);
  assert.equal(selfHits, 0, 'nobody shoots themselves');
});

test('zero health eliminates; a dead racer stops and ranks below the living', () => {
  const st = race({ track: 'meridian', laps: 3 }, 2);
  module.start(st, 0);
  run(st, COUNTDOWN_SEC * TICK_RATE + 60, throttle);
  const victim = st.racers[1];
  victim.hp = 1;
  victim.v.t = 0;
  // drop a mine right on the victim from the other racer and wait for it to arm
  const shooter = st.racers[0];
  shooter.item = 'mines'; shooter.ammo = 1;
  const ev = [];
  shooter.v.s = victim.v.s + WEAPON.mines.dropBehind; shooter.v.t = victim.v.t;
  run(st, 1, (r) => r === shooter ? { bits: IN.THROTTLE | IN.FIRE, steer: 0 } : idle(), ev);
  assert.ok(ev.some(e => e.t === 'fire' && e.item === 'mine'));
  const mine = st.projectiles.find(p => p.kind === 'mine');
  assert.ok(mine);
  // park the victim on the mine until it arms
  run(st, Math.ceil(WEAPON.mines.arm * TICK_RATE) + 2, (r) => { if (r === victim) { r.v.s = mine.s; r.v.vs = 0; r.v.t = mine.t; } return idle(); }, ev);
  assert.ok(ev.some(e => e.t === 'dead' && e.id === victim.id), 'victim died: ' + JSON.stringify(ev.filter(e => e.t !== 'bump').slice(-6)));
  assert.equal(victim.dead, true);
  assert.equal(shooter.kills, 1);
  run(st, 30, throttle);
  assert.equal(Math.hypot(victim.v.vs, victim.v.vt), 0);
  const res = module.results(st);
  assert.equal(res.order[0].id, shooter.id);
  assert.equal(res.order[1].eliminated, true);
  assert.equal(res.order[1].by, shooter.id);
});

test('a shield absorbs a rocket; a missile tracks a racer ahead', () => {
  const st = race({ track: 'meridian', laps: 3 }, 2);
  module.start(st, 0);
  run(st, COUNTDOWN_SEC * TICK_RATE + 1, idle);
  const [a, b] = st.racers;
  // on the start straight: b 40 m ahead of a; give a a rocket
  a.v.s = 60; a.v.t = 0; b.v.s = 100; b.v.t = 0; b.v.yaw = 0;
  b.v.shieldT = 3;
  a.item = 'rocket'; a.ammo = 1; a.v.yaw = 0;
  const ev = [];
  run(st, 1, (r) => r === a ? { bits: IN.FIRE, steer: 0 } : idle(), ev);
  run(st, 90, (r) => idle(), ev);
  assert.ok(ev.some(e => e.t === 'absorb' && e.id === b.id), 'shield absorbed');
  assert.equal(b.hp, b.maxHp);
  // missile with the target offset laterally: it must steer into them
  b.v.shieldT = 0; b.v.s = a.v.s + 60; b.v.t = a.v.t + 6;
  a.item = 'missile'; a.ammo = 1;
  const ev2 = [];
  run(st, 1, (r) => r === a ? { bits: IN.FIRE, steer: 0 } : idle(), ev2);
  const fire = ev2.find(e => e.t === 'fire' && e.item === 'missile');
  assert.equal(fire.target, b.id);
  run(st, 150, (r) => idle(), ev2);
  assert.ok(ev2.some(e => e.t === 'hit' && e.id === b.id && e.source === 'missile'), 'missile hit');
});

test('a pad hands out an item once and respawns later', () => {
  const st = race({ track: 'meridian', laps: 3 }, 1);
  module.start(st, 0);
  run(st, COUNTDOWN_SEC * TICK_RATE + 1, idle);
  const r = st.racers[0];
  const pad = st.pads[0];
  r.v.s = pad.s; r.v.t = pad.t; r.v.vs = 0;
  const ev = run(st, 1, idle);
  assert.ok(ev.some(e => e.t === 'pickup' && e.id === r.id));
  assert.notEqual(r.item, 'none');
  assert.ok(pad.respawnTick > st.tick);
  r.item = 'none';
  const ev2 = run(st, 1, idle);
  assert.ok(!ev2.some(e => e.t === 'pickup'), 'pad is spent');
});

test('snapshot round trip preserves state within quantisation', () => {
  const st = race({ track: 'meridian', laps: 3 }, 3, true);
  module.start(st, 0);
  run(st, COUNTDOWN_SEC * TICK_RATE + 240, (r, t) => module.botInput(st, r.id, t));
  st.racers[1].item = 'rocket'; st.racers[1].ammo = 2; st.racers[1].v.boostT = 1.5;
  const u8 = module.encodeSnapshot(st, 1);
  const d = module.decodeSnapshot(u8);
  assert.equal(d.raceTick, st.raceTick);
  assert.equal(d.racers[0].id, 1, 'recipient first');
  for (const rec of d.racers) {
    const r = st.byId[rec.id];
    assert.ok(Math.abs(rec.s - r.v.s) < 0.01);
    assert.ok(Math.abs(rec.t - r.v.t) < 0.011);
    assert.ok(Math.abs(rec.vs - r.v.vs) < 0.021);
    assert.ok(Math.abs(rec.yaw - r.v.yaw) < 0.001);
    assert.equal(rec.item, r.item);
    assert.equal(rec.ammo, r.ammo);
    assert.equal(rec.hp, Math.round(r.hp));
    assert.equal(rec.rank, r.rank);
  }
  assert.ok(Math.abs(d.racers[0].boostT - 1.5) < 0.06);
  assert.equal(d.pads.length, st.pads.length);
  assert.ok(u8.length < 40 + 30 * st.racers.length + 16 * st.projectiles.length);
});

test('disconnect, reconnect and abandon', () => {
  const st = race({ track: 'meridian', laps: 3 }, 2);
  module.start(st, 0);
  run(st, COUNTDOWN_SEC * TICK_RATE + 1, throttle);
  module.onDisconnect(st, 1, st.tick);
  const before = st.racers[1].v.s;
  run(st, 120, throttle);
  // a disconnected racer coasts with no throttle: slower than the connected one
  assert.ok(deltaS(st.ribbon, before, st.racers[1].v.s) < deltaS(st.ribbon, before, st.racers[0].v.s));
  module.onReconnect(st, 1, st.tick);
  assert.equal(st.racers[1].disconnected, false);
  module.onAbandon(st, 1, st.tick);
  assert.equal(st.racers[1].dead, true);
  run(st, 1, throttle);
  assert.equal(module.results(st).order[1].abandoned, true);
});
