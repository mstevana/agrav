// The bots have to be able to get round. Everything else about them is taste;
// this is the part that is a bug when it is wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import rally from '../rally/module.js';
import { TRACK_IDS } from '../rally/tracks/index.js';
import { buildTrack } from '../rally/sim/track.js';
import { CAR_IDS } from '../rally/cars.js';
import { PHASE } from '../rally/constants.js';

/** run a bots-only race to its end (or the cap) and report what happened */
function race({ track, laps = 1, cars = 1, difficulty = 'normal', seed = 99, profile = null, maxSeconds = 400 }) {
  const state = rally.createMatch({ track, laps, botDifficulty: difficulty, fillBots: true }, seed);
  for (let i = 0; i < cars; i++) rally.addPlayer(state, i, profile ? profile(i) : {}, true);
  rally.start(state, 0);
  const events = [];
  let wall = 0, ticks = 0;
  // how much of its own racing life each car spent crawling: the honest test of
  // whether a bot is wedged on something, and one that does not care how the
  // race happened to end
  const alive = new Map(), crawling = new Map();
  while (!rally.isOver(state) && ticks < maxSeconds * 60) {
    ticks++;
    for (const c of state.cars) rally.applyInput(state, c.id, rally.botInput(state, c.id, ticks));
    rally.step(state, ticks, events);
    for (const c of state.cars) {
      if (c.c.scraping || c.c.wallHit) wall++;
      if (c.dead || c.finished || state.phase !== PHASE.RACING) continue;
      alive.set(c.id, (alive.get(c.id) || 0) + 1);
      if (Math.abs(c.c.fwd) < 5) crawling.set(c.id, (crawling.get(c.id) || 0) + 1);
    }
  }
  const stuckShare = (id) => (crawling.get(id) || 0) / Math.max(1, alive.get(id) || 0);
  return { state, results: rally.results(state), ticks, stuckShare,
           wallShare: wall / Math.max(1, ticks * cars) };
}

for (const track of TRACK_IDS) {
  test(`bot: one bot gets round ${track} on its own`, () => {
    const r = race({ track, laps: 2, cars: 1 });
    const me = r.results.order[0];
    assert.ok(me.finished, `it did not finish (${me.laps} laps in ${(r.ticks / 60).toFixed(0)}s)`);
    assert.ok(r.wallShare < 0.2, `it spent ${(r.wallShare * 100).toFixed(0)}% of the race against a barrier`);
    assert.ok(me.bestLap > 10 && me.bestLap < 200, `a lap took ${me.bestLap.toFixed(1)}s`);
  });

  test(`bot: every car in the ladder gets round ${track}`, () => {
    for (const car of CAR_IDS) {
      const r = race({ track, laps: 1, cars: 1, profile: () => ({ car }) });
      assert.ok(r.results.order[0].finished, `a stock ${car} could not finish a lap`);
      const tuned = race({ track, laps: 1, cars: 1, profile: () => ({ car, upgrades: { speed: 4, handling: 4, armour: 4 } }) });
      assert.ok(tuned.results.order[0].finished, `a fully upgraded ${car} could not finish a lap`);
    }
  });

  test(`bot: a full grid of six gets round ${track} without piling up`, () => {
    // Finishing is not the measure once there are weapons on the grid: plenty of
    // races end with cars wrecked, and one that ends because a single car is left
    // standing stops wherever that car happened to be. What is measured is that
    // the field raced — most of it moving most of the time, and nobody parked
    // against something from early on and never seen again.
    //
    // A single bot on the narrow circuits can still lose a lot of a race to a
    // pocket of wrecks in a chicane; getting that number down is the balance and
    // hardening pass, not a reason to let a silent pile-up through here.
    for (const seed of [11, 2027, 55555]) {
      const r = race({ track, laps: 2, cars: 6, seed });
      assert.equal(r.state.phase, PHASE.FINISHED, 'the race reached an ending');
      const shares = r.state.cars.map(c => r.stuckShare(c.id));
      const average = shares.reduce((a, b) => a + b, 0) / shares.length;
      assert.ok(average < 0.32,
        `the field spent ${(average * 100).toFixed(0)}% of the race crawling on average (seed ${seed})`);
      const distance = r.state.ribbon.length * 2;
      for (const car of r.state.cars) {
        const went = car.progress / distance;
        assert.ok(car.dead || car.finished || car.id === r.state.lastAlive || went > 0.08,
          `car ${car.id} covered ${(went * 100).toFixed(0)}% of the race, still running and not the survivor (seed ${seed})`);
      }
      assert.ok(r.wallShare < 0.14, `the field spent ${(r.wallShare * 100).toFixed(0)}% of its time against barriers`);
    }
  });
}

test('bot: harder bots are faster bots', () => {
  // one race is noise: a bot that detours for a pickup loses a second and the
  // ordering flips, so ask several and compare the best lap each level managed
  const best = (d) => Math.min(...[3, 77, 4242, 90210].map(seed =>
    Math.min(...race({ track: TRACK_IDS[0], laps: 2, cars: 1, difficulty: d, seed }).results.order.map(o => o.bestLap || 1e9))));
  const easy = best('easy'), hard = best('hard');
  assert.ok(hard < easy, `hard (${hard.toFixed(1)}s) should lap quicker than easy (${easy.toFixed(1)}s)`);
});

test('bot: a wedged car backs out instead of leaning on the barrier all race', () => {
  const track = buildTrack(TRACK_IDS[0]);
  const state = rally.createMatch({ track: TRACK_IDS[0], laps: 3 }, 5);
  rally.addPlayer(state, 0, {}, true);
  rally.start(state, 0);
  for (let t = 1; t <= 60 * 5; t++) { rally.applyInput(state, 0, rally.botInput(state, 0, t)); rally.step(state, t, []); }
  // jam it nose-first into the outside barrier, stopped
  const car = state.cars[0];
  const half = track.ribbon.frames[100].width / 2;
  const f = track.ribbon.frames[100];
  Object.assign(car.c, {
    x: f.pos.x + f.right.x * (half - car.c.radius), z: f.pos.z + f.right.z * (half - car.c.radius),
    yaw: Math.atan2(f.right.x, f.right.z), vx: 0, vz: 0, fwd: 0, lat: 0, s: f.s, t: half - car.c.radius
  });
  const stuckProgress = car.progress;
  for (let t = 60 * 5 + 1; t <= 60 * 20; t++) { rally.applyInput(state, 0, rally.botInput(state, 0, t)); rally.step(state, t, []); }
  assert.ok(car.progress > stuckProgress + 50, `it only made ${(car.progress - stuckProgress).toFixed(0)} m in fifteen seconds`);
});

test('bot: the grid it is dropped into decides what it drives', () => {
  const state = rally.createMatch({ track: TRACK_IDS[0], laps: 1 }, 7);
  rally.addPlayer(state, 0, { car: 'valkyrie', upgrades: { speed: 4, handling: 4, armour: 4 } }, false);
  for (let i = 1; i < 6; i++) rally.addPlayer(state, i, {}, true);
  const tiers = state.cars.filter(c => c.bot).map(c => c.stats.tier);
  assert.ok(Math.min(...tiers) >= 4, `bots brought ${tiers.join(',')} to a Valkyrie race`);

  const humble = rally.createMatch({ track: TRACK_IDS[0], laps: 1 }, 7);
  rally.addPlayer(humble, 0, { car: 'vagabond' }, false);
  for (let i = 1; i < 6; i++) rally.addPlayer(humble, i, {}, true);
  const low = humble.cars.filter(c => c.bot).map(c => c.stats.tier);
  assert.ok(Math.max(...low) <= 1, `bots brought ${low.join(',')} to a Vagabond race`);
});
