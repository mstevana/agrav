import { test } from 'node:test';
import assert from 'node:assert/strict';
import module from '../agrav/module.js';
import { IN } from '../net/protocol.js';
import { PHASE, COUNTDOWN_SEC, WEAPON, TICK_RATE, CONTACT, VF } from '../agrav/constants.js';
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

test('bot difficulty is a validated room option', () => {
  assert.deepEqual(module.validateOpts({}), { track: 'meridian', laps: 3, botDifficulty: 'normal' });
  assert.equal(module.validateOpts({ botDifficulty: 'easy' }).botDifficulty, 'easy');
  assert.equal(module.validateOpts({ botDifficulty: 'hard' }).botDifficulty, 'hard');
  // whatever a client sends, only the three levels can reach the sim
  assert.equal(module.validateOpts({ botDifficulty: 'impossible' }).botDifficulty, 'normal');
  assert.equal(module.validateOpts({ botDifficulty: { toString: () => 'hard' } }).botDifficulty, 'normal');
});

test('the hard edge lands on the bots only, and only on the craft', () => {
  // What hard buys is a better craft than the one in your hands -- top speed, wind-up and how much
  // it can carry through a bend. A human on the same hull gets none of it, at any difficulty.
  const stats = (botDifficulty, bot) => {
    const st = module.createMatch({ track: 'meridian', laps: 1, botDifficulty }, 3);
    module.addPlayer(st, 0, { vehicle: 'corsair' }, bot);
    return st.racers[0].stats;
  };
  const human = stats('hard', false), normal = stats('normal', true), hard = stats('hard', true);
  assert.deepEqual(human, stats('normal', false), 'difficulty never touches a human craft');
  assert.deepEqual(normal, human, 'and medium bots drive exactly the craft you drive');
  assert.ok(hard.topSpeed > normal.topSpeed, 'hard bots are faster flat out');
  assert.ok(hard.accel > normal.accel * 1.1, 'and wind up harder out of a corner');
  assert.ok(hard.turnRate > normal.turnRate && hard.grip > normal.grip, 'and turn and hold on better');
  assert.equal(hard.armor, normal.armor, 'but they are no tougher');
  assert.equal(hard.damage, normal.damage, 'and their guns hit no harder');
});

test('harder bots lap faster', () => {
  // Pace is what the setting is for, so lap time is what this measures -- not distance covered,
  // which combat and eliminations muddle. Several seeds, because one bot race proves nothing.
  const lap = (botDifficulty) => {
    const times = [];
    for (const seed of [1, 2, 3]) {
      const st = module.createMatch({ track: 'meridian', laps: 9, botDifficulty }, seed);
      for (let i = 0; i < 3; i++) module.addPlayer(st, i, { vehicle: 'corsair', name: 'P' + i }, true);
      module.start(st, 0);
      for (let t = 1; t <= 100 * TICK_RATE; t++) {
        for (const r of st.racers) module.applyInput(st, r.id, module.botInput(st, r.id, t), t);
        module.step(st, t, []);
      }
      for (const r of st.racers) if (r.bestLap) times.push(r.bestLap);
    }
    assert.ok(times.length >= 3, `${botDifficulty} bots set ${times.length} laps`);
    return times.reduce((a, b) => a + b, 0) / times.length;
  };
  const easy = lap('easy'), normal = lap('normal'), hard = lap('hard');
  assert.ok(hard < normal, `hard ${hard.toFixed(1)}s should beat medium ${normal.toFixed(1)}s`);
  assert.ok(normal < easy, `medium ${normal.toFixed(1)}s should beat easy ${easy.toFixed(1)}s`);
  // the gap has to be worth choosing between, not a rounding difference
  assert.ok(easy - hard > 2, `only ${(easy - hard).toFixed(1)}s between easy and hard`);
  // hard is not just a tidier medium: the craft edge is worth better than two seconds a lap here
  assert.ok(normal - hard > 2, `only ${(normal - hard).toFixed(1)}s between medium and hard`);
});

test('zero health eliminates; a dead racer stops and ranks below the living', () => {
  const st = race({ track: 'meridian', laps: 3 }, 2);
  module.start(st, 0);
  run(st, COUNTDOWN_SEC * TICK_RATE + 60, throttle);
  const victim = st.racers[1];
  victim.hp = 1;
  victim.v.t = 0;
  // drop a mine right on the victim from the other racer
  const shooter = st.racers[0];
  shooter.item = 'mines'; shooter.ammo = 1;
  const ev = [];
  shooter.v.s = victim.v.s + WEAPON.mines.dropBehind; shooter.v.t = victim.v.t;
  run(st, 1, (r) => r === shooter ? { bits: IN.THROTTLE | IN.FIRE, steer: 0 } : idle(), ev);
  assert.ok(ev.some(e => e.t === 'fire' && e.item === 'mine'));
  // it lands on the victim, live at once, and goes off there and then
  run(st, 2, idle, ev);
  assert.ok(ev.some(e => e.t === 'boom'), 'the mine went off');
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

test('a mine dropped in front of a close follower hits it, not the one who dropped it', () => {
  // Nose to tail at racing speed: the follower reaches the drop point a few hundredths of a second
  // after it lands, so a mine that only becomes live after a delay is driven straight over.
  for (const gap of [8, 15, 25]) {
    const st = race({ track: 'meridian', laps: 3 }, 2);
    module.start(st, 0);
    run(st, COUNTDOWN_SEC * TICK_RATE + 90, throttle);   // up to speed down the opening straight
    const [lead, tail] = st.racers, L = st.ribbon.length;
    lead.v.t = 0; lead.v.vt = 0; lead.v.yaw = 0;
    Object.assign(tail.v, { s: (lead.v.s - gap + L) % L, t: 0, vt: 0, yaw: 0, vs: lead.v.vs });
    for (const r of st.racers) { r.hp = r.maxHp; r.v.shieldT = 0; }
    lead.item = 'mines'; lead.ammo = 1;
    const ev = [];
    run(st, 1, (r) => r === lead ? { bits: IN.THROTTLE | IN.FIRE, steer: 0 } : throttle(), ev);
    assert.ok(ev.some(e => e.t === 'fire' && e.item === 'mine'), `gap ${gap}: the mine was dropped`);
    run(st, TICK_RATE, throttle, ev);
    const hits = ev.filter(e => e.t === 'hit' && e.source === 'mine');
    assert.ok(hits.some(e => e.id === tail.id), `gap ${gap} m at ${lead.v.vs.toFixed(0)} m/s: the follower drove over it untouched`);
    assert.ok(!hits.some(e => e.id === lead.id), `gap ${gap}: the dropper was hit by its own mine`);
  }
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

test('the racer a missile is chasing is told, so the cockpit can warn them', () => {
  // The projectile on the wire carries where a missile is, not who it wants. Without this the
  // client cannot tell a missile flying past from one coming for it, so the lock goes to the target.
  const st = race({ track: 'meridian', laps: 3 }, 2);
  module.start(st, 0);
  run(st, COUNTDOWN_SEC * TICK_RATE + 120, throttle);
  const [me, them] = st.racers;
  them.v.s = me.v.s + 60; them.v.t = me.v.t; them.v.h = me.v.h;   // dead ahead, inside the lock cone
  const flags = (id) => module.decodeSnapshot(module.encodeSnapshot(st, id)).racers[0].flags;
  assert.ok(!(flags(them.id) & VF.LOCKED), 'nothing is chasing anyone yet');
  me.item = 'missile'; me.ammo = 1;
  const ev = run(st, 2, (r) => (r.id === me.id ? { bits: IN.FIRE | IN.THROTTLE, steer: 0 } : throttle()));
  assert.ok(ev.some(e => e.t === 'fire' && e.item === 'missile'), 'it went');
  const missile = st.projectiles.find(p => p.kind === 'missile');
  assert.equal(missile.target, them.id, 'and it locked on');
  assert.ok(flags(them.id) & VF.LOCKED, 'so the target is warned');
  assert.ok(!(flags(me.id) & VF.LOCKED), 'and the shooter is not');
  // the warning lasts exactly as long as the missile does
  st.projectiles.length = 0;
  assert.ok(!(flags(them.id) & VF.LOCKED), 'gone with it');
});

test('a contact raises a flag the client can see, and holds it past the hulls parting', () => {
  // The local craft cannot predict a collision: it draws the others in the past, so its prediction
  // drives straight through a hull the server has it stopped against. The flag is how it finds out,
  // and it has to outlive the contact by a round trip or the correction lands with no explanation.
  const st = race({ track: 'meridian', laps: 3 }, 2);
  module.start(st, 0);
  run(st, COUNTDOWN_SEC * TICK_RATE + 120, throttle);
  const [a, b] = st.racers;
  assert.equal(a.v.contactT, 0, 'nobody has touched yet');
  b.v.s = a.v.s + 1.5; b.v.t = a.v.t + 0.5; b.v.h = a.v.h;     // park it inside us
  const ev = run(st, 1, throttle);
  assert.ok(ev.some(e => e.t === 'bump'), 'that is a contact');
  assert.equal(a.v.contactT, CONTACT.holdTicks, 'and both hulls are marked for the client');
  assert.equal(b.v.contactT, CONTACT.holdTicks);
  const flags = module.decodeSnapshot(module.encodeSnapshot(st, a.id)).racers[0].flags;
  assert.ok(flags & VF.CONTACT, 'the flag goes out on the wire');
  // drive them apart and let the mark age out
  b.v.s = a.v.s + 200;
  run(st, CONTACT.holdTicks, throttle);
  assert.equal(a.v.contactT, 0, 'and it clears on its own');
  assert.ok(!(module.decodeSnapshot(module.encodeSnapshot(st, a.id)).racers[0].flags & VF.CONTACT));
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
