# SCRAP RALLY — development plan

A top-down, parallax, car-combat racer in the spirit of *Death Rally*, as the third game on
the AGRAV games platform. Up to six drivers on three closed circuits, bots filling every
empty seat, a race won either by crossing the line first after the required laps or by
blowing up everyone else, and a persistent career: money, mandatory repairs, upgrades and a
ladder of cars from a weak beetle to elite hulls.

Id: `rally` (folders `shared/rally/` and `rally/`). Display name: **Scrap Rally**.

This document is the plan: the pieces, the order to build them in, what each milestone must
prove, and the decisions taken. Every decision below was reviewed one by one; the plan is
meant to be revised as the work lands, but the decisions stand unless revisited explicitly.

**The game is built.** Every decision below was carried out as written. Section 12 records
where the implementation departed from the plan's own detail, and why.

---

## 1. Decisions

The resolved decision tree, in dependency order. Sections 2 onward describe how each is
built.

| # | Decision | Chosen |
|---|---|---|
| 1 | Primary device | desktop first, phone supported |
| 2 | Renderer | three.js, straight-down perspective camera (real parallax), lite mode for weak devices |
| 3 | Camera | north-up, never rotates; follows the car with look-ahead, zooms out with speed |
| 4 | Car physics space | free 2D body (x, y, heading); the ribbon is a reference only |
| 5 | Track boundaries | corridor walls from the ribbon plus authored static circle obstacles |
| 6 | Death | the wreck stays for the race with a 60 % collision circle; a driver who drops out vanishes |
| 7 | Elimination win | the race ends immediately when one car is left alive |
| 8 | Finish | 20-second grace after the first finisher; finished cars take and deal no damage |
| 9 | Primaries | permanent career purchases, equipped free each race; machine gun owned from the start |
| 10 | Guns | hitscan with rewind, drawn as tracers; mines are the only simulated entity |
| 11 | Missiles | not in the first release; the snapshot carries a generic entity list so they can be added |
| 12 | Laser sight | dropped after playtesting: a line the gun did not obey read as aim assist |
| 13 | Mines | 3 per race, free for everyone, hurt the owner too, not refilled by ammo pickups |
| 14 | Spiked bumper and upgrades | bought per car; a new car starts at level 0 without a bumper |
| 15 | Career identity | a random key held in the browser, shown once as a transfer code; no accounts |
| 16 | Store | JSON files on disk behind a three-method `Store` interface |
| 17 | Entry cost | racing is free; exploded cars earn no place money, only cash pickups and kill bonuses |
| 18 | Car unlocks | money alone; no reputation gate |
| 19 | "5 wins / 10 seconds / 15 races" | a balance target for prizes and prices, tested by `rallysim`; wins and places are statistics only |
| 20 | Buying a car | trade-in: 50 % of the old car's price plus 25 % of what was spent on its upgrades |
| 21 | Mixed-tier lobbies | allowed; bots take the average human tier; tiers shown in the room list and lobby |
| 22 | Auto-filled bots | room-level players via a `fillBots` hook; visible, kickable, named in results |
| 23 | Bot difficulty | host option easy / normal / hard; prizes scale 60 / 100 / 130 % |
| 24 | Road elevation | flat road; parallax from props, walls and overhead decoration only |
| 25 | Track selection | host choice, all three from the start; prize multiplier per track |
| 26 | Steering | car-relative; reverse on brake when stopped |
| 27 | Input | digital throttle and brake, analog steer; the existing input record is unchanged |
| 28 | Pickups | fixed authored pads with fixed item types, 20 s respawn; cash spawns randomly |
| 29 | Milestone order | sim core, client, combat, career, tracks and look, balance |
| 30 | Delivery | one pull request per milestone; the launcher card ships with M2 |
| 31 | Name | Scrap Rally |

---

## 2. What the platform already gives, and what it needs

The server (`server/room.js`, `lobby.js`, `session.js`) is game-agnostic: rooms, four-letter
codes, the public list, host/ready/start, lobby bots, reconnect with a grace period, the
60 Hz fixed step, 30 Hz binary snapshots, reliable events, results. A game is one module in
`shared/<game>/module.js` (contract in `shared/net/module-contract.md`), one client folder,
and one line in `server/games.js`. Scrap Rally reuses all of that unchanged and adds two
small, generic platform features that neither existing game needed:

| Need | Why | Change |
|---|---|---|
| **Auto-fill bots at start** | empty seats become bots without the host clicking Add bot five times | `Room.requestStart`: if `game.fillBots?.(state, opts)` returns true, add lobby bots up to `maxPlayers` before `start()`. Opt-in per module, so AGRAV and Volley keep their behaviour. The lobby shows unfilled seats as "empty → bot", the Volley wording. |
| **Per-player persistent data** | money, car damage, upgrades and ownership must survive the session token, which expires after a reconnect grace | `server/store.js` (JSON files under `DATA_DIR`, atomic write, in-memory cache) and an optional module `career` hook set (§6). Namespaced by game id, so any future game can keep progression. |

Everything else the design needs (weapon choice before the race, mines, pickups, win by
elimination, lag-compensated guns, bots that shoot) has a working precedent in
`shared/agrav/` and is ported to a free 2D world rather than invented.

Protocol: two new JSON control messages (`CAREER` s→c, `CAREER_ACTION` c→s) and an optional
`careerKey` field on HELLO. The binary input and snapshot layouts do not change.
`PROTOCOL_VERSION` goes to 2, as the comment in `shared/net/protocol.js` asks whenever a
control shape changes; the existing clients are served from the same checkout so they move
together.

The platform work lands first, as its own pull request (M0), so the two existing games are
proven unaffected before any game code depends on it.

---

## 3. Design, resolved into rules

Every value here is a starting point for `shared/rally/constants.js` and is expected to move
during the balance pass (M6).

### Race

- Closed circuits seen from above, north-up. Three tracks (§8). Lap count is a host option,
  default 3, range 1–9 like AGRAV. The host picks the track.
- Up to 6 drivers, `minPlayers: 1`. Empty seats fill with bots at start (host option
  `fillBots`, default on). The host can still add or kick bots by hand.
- **Two ways to win**: cross the line first after the required laps, or be the last car alive.
  When the alive count drops to one before anyone has finished, that car wins on the spot: a
  "last driver standing" banner, then results. When the first car finishes, the others get
  20 seconds to finish for placing (the AGRAV `FINISH_GRACE_SEC` pattern); during the grace a
  finished car keeps driving but takes no damage and deals none, so a winner cannot camp the
  line and shoot the second-place car out of its prize. An exploded car is placed by the
  distance it covered.
- Results: place, finished or eliminated, time, best lap, kills, money earned.

### Cars are light tanks

- Hull points (armour) come from the car and its Armour upgrade level. Zero hull explodes the
  car; the wreck stays on the track for the rest of the race as a burnt shell with a collision
  circle 60 % of a live car's, so a lane always stays open on the narrowest track. The driver
  spectates (tap to follow another car, as in AGRAV). A driver who disconnects and runs out
  the reconnect grace vanishes without a wreck.
- Walls scrape hull away when sliding along them and take a chunk on a hard hit. Handling is
  what keeps you off them (§4, physics).
- Car-to-car contact is mass-weighted (heavier hull gives way less); a hard ram hurts both, a
  **spiked bumper** makes the rammer's side of the exchange cheap and the victim's much worse.

### Weapons

| | Type | Ammo | Notes |
|---|---|---|---|
| **Machine gun** | primary, fixed forward, hitscan | 300 rounds | owned from the start; low damage, high rate, accurate |
| **Shotgun** | primary, fixed forward, 6-pellet cone hitscan | 40 shells | huge close damage, useless at range, slow refire |
| **Minigun** | primary, fixed forward, hitscan | 600 rounds | spins up for 0.4 s, then the highest damage per second, strong spread |
| **Mines** | support, dropped behind | 3 per race | arm after 0.5 s, live for the race, hurt anyone including the owner; free for everyone; ammo pickups do not refill them |
| **Spiked bumper** | support, passive | per-car purchase | ram damage ×3 dealt, ×0.5 received |

- The primary is a **permanent career purchase** (§6) and is **picked in the lobby** among the
  weapons the driver owns (a profile field validated by `setProfile`). Ammo is full at every
  race start.
- Guns are hitscan: an instant ray (or six rays in a cone for the shotgun) from the muzzle,
  **lag-compensated** with the pose-history rewind the AGRAV minigun uses (`HISTORY_TICKS`,
  `HITSCAN_REWIND_TICKS`), so a hit is scored against what the shooter saw. The client draws
  each shot as a fast tracer streak from the muzzle to the impact point, so it reads as a
  bullet crossing the screen.
- **Aiming** is the car. Every gun is fixed and forward, nothing bends a shot toward anything,
  and there is no sight of any kind: lining a target up is the whole skill of shooting it. The
  bots ask `wouldHitCar` before they pull the trigger, which traces the same ray the server
  will, so they hold fire rather than spraying the scenery.
- **The guns are cold for `CEASEFIRE_SEC` after the flag.** The grid is six cars two lengths
  apart pointing the same way, which makes the opening seconds a firing squad rather than a
  start. A minigun may still wind up during it, because the wind-up is not a shot and making
  one weapon arrive late to its own ceasefire would only move the unfairness. Mines and the
  bumper are not part of it. Enforced in `stepGun` alone, so there is one rule in one place.
- Missiles are out of scope for the first release. The snapshot's entity list is generic
  (`kind` byte, owner, position, heading, speed, flags), so a rocket is a new kind, not a new
  format.
- Input bits: throttle, brake, fire, mine, nitro. Five bits in the existing `u8`; steer stays
  the one analog value. Throttle and brake are digital.

### Pickups on the track

Pads are authored per track as `{s, t, item}` in ribbon coordinates, each with a fixed item
type, so the track is learnable and the bots can plan for them. A taken pad respawns after
20 seconds. The snapshot carries one availability bit per pad, as AGRAV's does. Cash is the
exception: it spawns on a seeded random schedule at a random free pad, so it is a bonus and
not a farm.

| Pickup | Effect |
|---|---|
| Ammo | +25 % of the equipped primary's capacity |
| Nitro | one charge, 2.5 s of +40 % top speed and accel, fired with the nitro bit |
| Repair kit | +30 hull, capped at max |
| Cash | 50–150 credits, rolled by the race rng, added to the purse on settlement |

### Money

Racing costs nothing to enter. Place money goes only to cars that finished or were alive when
the race ended; an exploded car keeps its cash pickups and kill bonuses.

| Source | Amount |
|---|---|
| 1st place | 600 × multipliers |
| 2nd | 350 × |
| 3rd | 200 × |
| 4th–6th, alive at the end | 60 × |
| Cash pickup | 50–150 |
| Kill | 75 |

Multipliers stack in one place in `career.settle`: track 1.0 / 1.3 / 1.6 in difficulty order,
bot difficulty 0.6 / 1.0 / 1.3 for easy / normal / hard.

### Persistent damage and mandatory repairs

- The hull you end the race with is the hull you start the next one with. An exploded car comes
  home at 0.
- Repair costs `(maxHull − hull) × repairRate`, where `repairRate` rises with the car tier.
- **No purchase is possible while the hull is below max.** The shop returns
  `{error: 'repair-first'}` and the garage greys out every button but Repair.
- A driver may still race damaged: there is no gate. The garage shows the hull bar in red
  under a third, the AGRAV damage-readout language. Racing a wreck is a gamble, since an
  exploded car earns no place money.

### Upgrades

Three stats per car, five levels each, **bought per car**: a new car starts at level 0.
Prices scale with car tier and level.

| Stat | What it moves |
|---|---|
| **Speed** | top speed and acceleration |
| **Handling** | lateral grip and steering rate; the difference between a corner and a wall |
| **Armour** | max hull (and mass, so contact favours you) |

### Cars and the ladder

Six cars, each bought with money; there is no other gate. A driver owns one car at a time:
buying the next is a **trade-in** that refunds 50 % of the old car's price plus 25 % of what
was spent on its upgrades, shown before confirming. Upgrades and the bumper do not carry over.

| Car | Inspiration | Price | Base speed / handling / armour |
|---|---|---|---|
| **Vagabond** | a beetle | starter, owned | low / low / low |
| **Mongrel** | a pickup | 1 500 | mid / low / mid |
| **Stiletto** | a coupé | 4 000 | high / mid / low |
| **Warden** | an armoured saloon | 7 000 | mid / mid / high |
| **Behemoth** | a truck cab | 11 000 | mid / low / very high |
| **Valkyrie** | an elite prototype | 18 000 | very high / high / high |

The names other than Vagabond are placeholders.

**Pacing target.** The brief's ladder ("elite cars after about 5 wins, 10 second places, or
15 participations") is the balance target for prizes and prices, not a rule in the code:
`tools/rallysim.js` simulates each of the three careers at normal difficulty with the
expected repair bills and mid-tier trade-ins on the way, and the check is that all three reach
the Valkyrie within one or two races of those counts. Wins, places and races are stored as
statistics for the garage and results screens only.

**Mixed lobbies.** Any career can join any room. The room list and the lobby show each
driver's car tier so a newcomer sees what they are joining, and the bots take the car and
upgrade level of the average human in the room, ±1 tier, so a new Vagabond driver is not
fed to Valkyries and an elite driver is not handed free wins.

---

## 4. Architecture

```
shared/rally/
  module.js        the contract object: match lifecycle, inputs, bots, fillBots, snapshot, results, career hooks
  constants.js     tick/snapshot rates, physics, weapons, pickups, prizes, prices, PHASE, input bits
  cars.js          the six cars: base stats, tier, price, trade-in, upgrade tables, repair rate, hull shape
  weapons.js       primaries, mines, bumper: fire, hitscan with rewind, cone/pellet spread, lock selection
  pickups.js       pads, respawn, the cash schedule, collection, effects
  career.js        pure career rules: create, apply(action) -> {career|error}, settle(results), profile
  bot.js           racing line follower + combat judgement; also drives tools/rallysim.js
  sim/
    track.js       track -> {ribbon, walls, obstacles, pads, grid}; incremental nearest-s; wall distance
    car.js         the 2D car model: stepCar(track, car, input, dt), reverse, sliding
    race.js        createRace, addRacer, start, stepRace (contacts, laps, elimination, end), results
    snapshot.js    encode/decode: cars, wrecks, entities (mines), pad bits, locks
  tracks/
    index.js       TRACK_IDS, getTrack
    scrapyard.js   track 1: junkyard — wide, forgiving, one hairpin
    harbour.js     track 2: docks — cranes and containers, a bridge deck overhead as scenery
    ridge.js       track 3: mountain pass — narrow, drops beside the road, two chicanes

rally/
  index.html       screens: menu, garage, lobby, race HUD, results (CSS inline, as Volley does)
  manifest.webmanifest, sw.js, icons/
  src/
    main.js        wiring: menu → garage → lobby → race → results; loop
    net.js         the network client (prediction, reconciliation, interpolation, career messages)
    input.js       keyboard / gamepad / touch → {bits, steer}
    garage.js      the shop: repair, upgrades, bumper, weapons, trade-in, transfer code
    hud.js         hull, ammo, mines, nitro, lap, position, minimap, kill feed
    audio.js       engines, guns, explosions (synthesized, as AGRAV)
    render/
      scene.js     three.js top-down perspective camera, follow + look-ahead, speed zoom, lite mode
      track.js     ground, road, kerbs, walls, obstacles from track data; parallax props per theme
      car.js       car meshes, liveries, damage state, wreck
      fx.js        tracers, muzzle flash, explosions, mine glow, nitro flame, pickups
      themes/      scrapyard.js, harbour.js, ridge.js — props and colours per track

server/
  store.js         Store interface (get, set, list) over JSON files; atomic writes; DATA_DIR from config
  games.js         + rally line
  room.js          + fillBots at start; + career settle at _finish
  session.js       + careerKey on HELLO; + CAREER / CAREER_ACTION routing

tools/
  rallysim.js      headless bots-only races and career pacing: finish rate, lap times, kills, money curves
  rallylint.js     track checks: closed, no self-intersection, min width with a wreck, obstacles passable, pads on road
  netsim.js        --game rally (drives rally/src/net.js with the rally bot)
  racetest.js      --game rally (two Chromium clients + bots through to results and a repair in the garage)
```

### The world is free 2D, the track is still a ribbon

AGRAV moves craft in ribbon coordinates `(s, t)`. A top-down car has to spin out on a hit,
reverse out of a wall and fight in every direction, so Scrap Rally simulates in world
`(x, y, heading, vx, vy)` and uses the ribbon only as a **reference**:

- `shared/sim/spline.js` builds the centreline (control points with `y = 0`) and gives arc
  length, frames and width. The track's left and right walls are the offset curves. The road
  is flat: no height, no jumps, no crossings in the first release. The ribbon already carries
  a per-point height, so a later bridge crossing changes the sim, not the authoring format.
- Progress and laps: each car keeps its nearest `s` by an incremental search along the frames
  (not the coarse `nearestS`, which is meant for tools) and accumulates `deltaS` across ticks,
  as AGRAV does. A car driven backwards loses progress and cannot cheat a lap.
- Wall collision: signed lateral distance `|t| − width/2` at the nearest frame, resolved as a
  circle-vs-wall push with the scrape / hard-hit rule.
- Obstacles: authored static circles `{x, y, r}` per track (container stacks, pillars, a
  wrecked bus). They use the same contact code as wrecks and mines, so they cost nothing in the
  sim, and the bots steer around them with the same logic they need for wrecks. No polygons,
  no forks: a fork would break single-ribbon lap counting.
- Bots follow the ribbon with a lookahead point like the AGRAV bot, on the same
  curvature-biased racing line.

### Car model (`sim/car.js`)

An arcade model that reads as a heavy car and rewards handling upgrades:

- Longitudinal: throttle accel, brake decel, rolling drag, top speed; nitro multiplies the first
  and last. Holding brake at rest engages reverse at a fraction of top speed.
- Steering is car-relative: yaw rate proportional to the stick and to speed up to a cap,
  reduced at very high speed; the handling stat sets the cap. Reversing steers the other way,
  as a car does.
- Lateral: velocity is decomposed into forward and sideways; sideways velocity decays with a
  grip factor per tick (the handling stat again). When sideways speed exceeds a threshold the
  car is **sliding**: less grip, tyre marks, a HUD nudge. Low-handling cars slide on every
  fast corner and meet the wall; that is the brief's "fondamentale per non scivolare contro i
  muri".
- Contact: circle bodies (radius from the car's length) for cars, wrecks (60 %), obstacles and
  mines; mass = armour.
- Fully deterministic: no `Math.random`, all randomness from the race rng, so the client's
  prediction of its own car is the server's step bit for bit (the property both existing games
  rely on).

### Netcode (`rally/src/net.js`)

Copied from the Volley client, which is the smaller and cleaner of the two, with the AGRAV
additions Scrap Rally needs:

- 60 Hz inputs, last three bundled; `NetClock` for the tick estimate and lead. The input record
  is unchanged: five bits of the `u8` plus the signed steer byte.
- Own car: `stepCar` every tick, replaced by the snapshot record and replayed for pending inputs,
  the difference blended over ~100 ms.
- Others, wrecks, mines, pads: interpolated 4 ticks behind between two snapshots.
- Hitscan shots are server-authoritative; the client draws its own tracer instantly from the fire
  input and reconciles hits from the `hit` events (the AGRAV minigun pattern).
- Snapshot payload budget: 6 cars × ~22 bytes + entities × 8 + pad bits + locks ≈ 200 bytes at
  30 Hz. No delta compression needed.

### Rendering (`rally/src/render/`)

Three.js with a **perspective camera looking straight down, north-up**. The parallax comes
free: the road sits at height 0, walls, buildings, cranes and trees are extruded up toward the
camera, and overhead pieces (a bridge deck, a gantry, foliage) sit above the cars, so
everything tall leans away from the centre and slides against the ground as the camera follows
the car. This reuses the vendored three.js and the procedural texture, noise and geometry
toolkit, which now lives in `shared/gfx/` (`surfaces.js`, `noise.js`, `geom.js`, `merge.js`)
because two games use it.

The camera follows the own car with a look-ahead along its velocity and zooms out with speed.
It never rotates, so the minimap and the track read the same all race. Cars are bodies lofted
from a per-model plan outline, wearing a livery painted in plan on a canvas and projected
straight down; the paint takes scorch marks as hull drops, and death leaves a burnt-out shell
of the same body.

`?lite=1` (weak devices, headless tests): flat colours, no props, no bloom, the AGRAV quality
governor for everything in between.

### Controls

| Keyboard | Gamepad | Touch |
|---|---|---|
| ← → or A D steer (car-relative) | left stick / d-pad | drag left/right in the steering zone |
| ↑ / W throttle · ↓ / S brake, reverse when stopped | RT throttle · LT brake | automatic throttle · BRK button |
| space fire | X or RB | FIRE |
| M drop mine · N nitro | B mine · A nitro | MINE · NITRO buttons |

---

## 5. Bots (`shared/rally/bot.js`)

- **Driving**: aim at a lookahead point on the ribbon, feed-forward the curvature, brake for
  corners it cannot make at its speed, hold a lane of its own on a full grid, steer around
  obstacles and wrecks, and detour to a pad ahead when it needs one (ammo when low, repair when
  hurt, nitro on a straight). Pads have fixed types, so the detour is a static plan per lap.
- **Combat**: fire the primary only when a victim is inside the cone the hitscan actually scores
  with (the AGRAV rule), drop a mine when someone is close behind on a bend, fire nitro on the
  longest straight or to escape a chaser.
- **Skill**: the host option `botDifficulty` (easy / normal / hard) scales lookahead, reaction
  and how late it brakes, and scales the prizes (§3) so it is a difficulty choice and not a
  money exploit. A bot's car and upgrades match the lobby tier (§3).
- **Seats**: bots are room-level players. Auto-fill adds them at start through `fillBots`; the
  host can add or kick them beforehand; they appear in the lobby, the snapshot and the results
  like any AGRAV lobby bot. A human who drops and runs out the reconnect grace is removed and
  vanishes from the track (no wreck).

---

## 6. Career and persistence

### Identity

The platform's session token reconnects a socket to a seat and expires minutes after a
disconnect. A career needs an identity that lasts months, so the client keeps a random 128-bit
**career key** in `localStorage` and presents it on HELLO. The key is the whole identity: no
accounts, no passwords; losing the browser storage loses the career. The garage shows the key
once as a **transfer code** so a player can move a career to another device. The store is
keyed so an account layer can later map one account to one key without migrating anything.
Sharing a key between friends is harmless: there is no leaderboard, and nothing to gain but a
friend's car.

### Store (`server/store.js`)

- A `Store` interface with `get(ns, key)`, `set(ns, key, value)` and `list(ns)`, and one
  implementation: one JSON file per record under `DATA_DIR/<ns>/<key>.json`, written to a temp
  file and renamed, with an in-memory map so the hot path never touches disk. If a leaderboard
  or admin queries ever arrive, a SQLite implementation slots in behind the same three methods.
- `DATA_DIR` defaults to `./data` (git-ignored, added to the static server's `HIDDEN` set so it
  is never served); `deploy/agrav.service` gets `StateDirectory=agrav` and
  `Environment=DATA_DIR=/var/lib/agrav`, since the unit mounts the checkout read-only.
- Bounded: a record is a few KB and the map evicts idle careers after an hour. A disk error is
  logged and never kills a room.

### Contract extension (added to `module-contract.md`)

```js
fillBots(state, opts) -> bool,                       // add lobby bots up to maxPlayers at start
career: {
  create() -> career,                                  // a new driver: Vagabond, machine gun, 0 money
  apply(career, action) -> { career } | { error },     // repair | upgrade | buyBumper | buyWeapon | buyCar (trade-in) | selectWeapon
  settle(career, results, id, opts) -> career,         // money with multipliers, persisted hull, stats
  profile(career) -> profile                           // what the seat starts from: car, upgrades, bumper, hull, weapon
}
```

All career mutation is on the server, in pure functions in `shared/rally/career.js`, so the
garage can *preview* a purchase or a trade-in with the same code and tests can drive the whole
ladder without a server.

### Flow

1. HELLO carries `careerKey`; the session loads (or creates) the career and sends `CAREER`.
2. The garage sends `CAREER_ACTION {action, ...}`; the server applies, saves, replies `CAREER`
   (or the error, such as `repair-first` or `funds`).
3. Joining a room, the seat's profile is derived from the career by `career.profile`; the lobby
   lets the driver choose only among weapons they own, and `setProfile` on the server rejects
   anything else. The room list and the lobby show each driver's car tier.
4. At `_finish`, the room calls `career.settle` for every human seat with a career key, passing
   the room options (track, bot difficulty) for the multipliers, and saves. The results screen
   shows money earned and the hull you came home with, with a button straight into the garage.
5. Bots have no career; their seat profile is synthesized from the lobby tier.

A player who races without a career key (storage blocked) still plays: a Vagabond with a
machine gun, nothing saved, and the garage explains why.

---

## 7. Testing and tools

| Test | Proves |
|---|---|
| `shared/test/rally-car.test.js` | determinism (same inputs → same state), top speed and handling monotone in their stats, sliding threshold, reverse, wall scrape and hard hit |
| `shared/test/rally-race.test.js` | laps count only forward, a backwards car cannot lap, last-alive ends the race at once, 20 s finish grace with finished cars immune, results ordering, wrecks persist at 60 %, a dropout vanishes |
| `shared/test/rally-weapons.test.js` | hitscan rewinds to the shooter's tick, cone and pellet spread, the lock never moves the ray, mines arm and hurt the owner, bumper multipliers |
| `shared/test/rally-career.test.js` | prizes with stacked multipliers, no place money for exploded cars, repair-first rule, trade-in refund, per-car upgrades reset, no negative money, storage-less driver |
| `shared/test/rally-bot.test.js` | a bot alone finishes every track; six bots finish without a pile-up; bots avoid obstacles |
| `server/test/rally-room.test.js` | auto-fill to six, a career persists across two races in one lobby, a dropped driver is removed, snapshots decode, tiers in the room state |
| `server/test/store.test.js` | atomic write, reload from disk, eviction, a disk error does not throw into the room |
| `tools/rallysim.js` | balance: per car tier per track, lap time spread, bot kill rate, elimination-ending rate, and the three career pacing curves (§3) |
| `tools/rallylint.js` | every track closed, wide enough for a car past a wreck, no self-intersection, obstacles passable by the Vagabond at speed, pads on the road and 40 m apart |
| `tools/netsim.js --game rally` | prediction error, corrections, bandwidth under 80 ms ± 20 ms, 2 % loss with six clients |
| `tools/racetest.js --game rally` | two Chromium clients race bots to the results and buy a repair |

`npm test` keeps running everything under `shared/test` and `server/test`, so the new tests
join the existing 54 without wiring.

---

## 8. Tracks

Three flat circuits, authored like the AGRAV tracks as control-point lists (`x, z`, width)
plus obstacle circles and typed pads, with theme props generated on the client. Each has a
prize multiplier and a distinct parallax layer. The host picks any of them from the start.

| Track | Theme | Length | Character | Parallax layer | Prize × |
|---|---|---|---|---|---|
| **Scrapyard** | junkyard, rust and oil | ~1 200 m | wide, forgiving, one hairpin, two long straights for nitro; a few car-stack obstacles | car stacks and a crane arm over the back straight | 1.0 |
| **Harbour** | docks at night | ~1 500 m | medium width, a chicane between container obstacles, a bridge deck overhead as scenery | gantry cranes, the bridge deck the road passes under | 1.3 |
| **Ridge** | mountain pass | ~1 800 m | narrow, drops beside the road, two chicanes, a blind crest, fallen-rock obstacles | cliff faces on one side, tree canopy over the road, a rock arch | 1.6 |

Authoring rules go in `tools/rallylint.js`: minimum width for six cars abreast on the start
straight, minimum width for a live car to pass a wreck anywhere, minimum corner radius the
Vagabond can take at half throttle, every obstacle passable on both sides or flagged as
one-sided with the open side wide enough, and pads at least 40 m apart.

---

## 9. Milestones

Each milestone is one pull request, merged before the next begins, with `npm test` green.
Sizes are rough and in working days for one developer; the order puts the multiplayer loop
first so every later piece rides on it.

### M0 — Platform groundwork (1–2 days)

- `server/store.js` + tests; `DATA_DIR` in config, `HIDDEN`, `.gitignore`, systemd
  `StateDirectory`.
- `fillBots` hook in `Room.requestStart`; `careerKey` on HELLO; `CAREER` and `CAREER_ACTION`
  messages; `PROTOCOL_VERSION` 2; `module-contract.md` updated.
- `rally` registered in `server/games.js` with a stub module. No launcher card yet.
- **Proves**: existing 54 tests pass; a stub Scrap Rally room can be created, auto-filled and
  started in a test; a career round-trips through the store.

### M1 — Simulation core (4–5 days)

- `tracks/scrapyard.js`, `sim/track.js` (ribbon, walls, obstacles, progress), `sim/car.js`,
  `sim/race.js` (grid, countdown, laps, finish grace, results), `snapshot.js`, `bot.js`
  driving only.
- `tools/rallysim.js` (races only) and `tools/rallylint.js`.
- **Proves**: six bots race three laps of Scrapyard headless and all finish; determinism and
  race tests green; the snapshot round-trips.

### M2 — Playable client (5–6 days)

- `rally/src/net.js`, `input.js`, `main.js` (menu, lobby, results), `render/scene.js`,
  `render/track.js` (road, kerbs, walls, obstacles, flat ground), `render/car.js`, `hud.js`.
- Camera follow, look-ahead and speed zoom, minimap, position and lap readouts, lite mode.
- The launcher card on `index.html`.
- **Proves**: two browsers and four bots complete a race; `netsim.js --game rally` reports no
  hard corrections at 80 ms RTT; `racetest.js --game rally` passes.

### M3 — Combat (4–5 days)

- `weapons.js`: machine gun, shotgun, minigun with rewind hitscan and cosmetic lock; mines;
  spiked bumper in contacts; `pickups.js` with typed pads and the cash schedule.
- Hull, wall damage, explosions, wrecks as obstacles, last-alive win, spectating.
- Bot combat judgement. Client: tracers, muzzle flash, explosions, kill feed, mine
  and nitro FX, audio.
- **Proves**: weapons and race tests green; `rallysim` reports the elimination-ending rate at
  each difficulty; nobody can score a hit outside the cone.

### M4 — Career (3–4 days)

- `cars.js` full ladder, trade-in and upgrade tables; `career.js` (create, apply, settle,
  profile); server settle at `_finish` with the multipliers; lobby restricted to owned weapons;
  tiers in the room list and lobby; bot tiering.
- `rally/src/garage.js` and the garage screen: repair-first, upgrades, bumper, weapons,
  trade-in preview, transfer code. Results screen shows earnings.
- `rallysim` career pacing curves.
- **Proves**: career tests green; a room test runs two races and the second starts with the
  persisted hull; a fresh driver cannot buy before repairing; the three pacing curves reach the
  Valkyrie near the brief's counts.

### M5 — Tracks and look (5–7 days)

- Harbour and Ridge, with their obstacles, pads and themes; parallax props (cranes, bridge deck,
  canopy, cliffs); liveries and damage states; wreck meshes.
- Icons, manifest, service worker, `tools/shots.js` support for `rally` screenshots into
  `docs/screenshots/rally/`.
- **Proves**: `rallylint` clean on all three; `rallysim` lap-time spread per tier within the
  balance target on every track; screenshots in the README.

### M6 — Balance, hardening, docs (3–4 days)

- Balance pass on prices, prizes, repair rates, trade-in and the pacing target; bot tiering and
  difficulty; weapon damage and the elimination rate.
- Netsim with six clients and packet loss; reconnect mid-race; a slow client on the grid hold.
- `rally/README.md`, root README card and file map, `deploy/` notes for `DATA_DIR`.

Total: roughly 25–33 days of focused work, with M1–M3 as the critical path.

---

## 10. Deferred, by decision

Not in the first release; each has a place prepared for it.

- **Missiles / rockets**: a new entity kind in the generic snapshot list, a support-slot
  alternative to mines, straight and not homing so the cosmetic lock stays a gun feature.
- **Road crossings and jumps**: a `layer` per ribbon segment and per car; the authoring format
  already carries height.
- **Accounts**: map one account to one career key in the store; no migration.
- **Leaderboards / admin queries**: a SQLite `Store` behind the same three methods.
- **Lobby tier cap**: one host option and one check in `setProfile`.
- **Per-race ammo purchase**: a difficulty option in `career.settle` and the lobby, no wire
  change.

---

## 11. Risks (as written before the work)

- **Physics feel** is the whole game; budget iteration in M1 with `rallysim` and a keyboard
  before any art. The handling-versus-walls tension has to be felt at the Vagabond tier or the
  upgrade economy has nothing to sell.
- **Six cars in one corner**: circle contacts, obstacles and wrecks can produce pile-ups at the
  first bend; grid spacing, contact loss, the wreck's 60 % circle and the bots' lane-keeping are
  the levers, and the bots-only race in `rallysim` is the regression test.
- **Elimination as the default ending**: with an immediate last-alive win, weapon damage that is
  too high turns every race into a hunt; `rallysim`'s elimination-ending rate at normal
  difficulty is the number to watch, and the target is that racing wins more often than
  killing.
- **Money-only ladder**: with no gate but price, the pacing lives entirely in the prize and
  price tables; the three pacing curves in `rallysim` are the guard against a ladder that is
  climbed in five races or never.
- **Persistence is new to the platform**: keep the store tiny, synchronous in the room tick
  (memory only) and asynchronous to disk, and never let a disk error kill a room.
- **Cheating**: all money and hull changes are server-side and the lobby validates picks against
  ownership, so the only thing a client controls is its inputs, as today.

---

## 12. What the work changed

The decisions in section 1 all stand. These are the places where the plan's own detail
turned out to be wrong, or where building it suggested something better.

**Tooling is per game, not per flag.** The plan said `tools/netsim.js --game rally` and
`tools/racetest.js --game rally`. Both of those tools reach deep into AGRAV's client
internals, so a flag would have meant branching most of their length. Scrap Rally has its
own `rallynet.js`, `rallytest.js` and `rallyshots.js` instead, which sit beside
`rallysim.js` and `rallylint.js` and read as a set.

**The career is read through an action, not pushed at HELLO.** The plan had the server send
the record as soon as a client said hello. The server does not know which game's record to
send at that point — a session has not joined a room yet — so `CAREER_ACTION {game, action}`
reads it, and the room also sends it unprompted when a player joins, which is when the lobby
needs it.

**A module is seated from its record through `setCareer`, not `career.profile`.** The
contract ended up with the server handing the module the record and the module deciding what
that means for the seat. It keeps every rule about a car in one place.

**Pads carry a byte, not a bit.** The plan had one availability bit per pad. Cash is a
dressing on an existing pad rather than a pad of its own, so what a pad holds can change
during a race, and the snapshot carries the item rather than a yes or no.

**No event per shot.** The plan had the server tell the client about hits. At nine rounds a
second per car that is a hundred messages a second, so the client traces its own rays for
the tracers and the sound against the same obstacles, and only damage — gathered per victim
per tick — comes down the wire.

**The lint grew two rules the plan did not foresee**, both of them paid for in debugging
time: a road may not come back within its own width of itself, and an obstacle may not leave
a slot too narrow to drive through but wide enough to aim at.

**Two simulation rules were added for the same reason**: a wreck settles toward the side of
the road until the rest of it is open, and the barrier gets the last word in a step. Without
either, an obstacle and a couple of shells could close a chicane into a pocket that nothing
got out of.

**The numbers moved a long way.** Hulls went up by about two and a half times and the guns
came down, because a Vagabond died in four seconds of held fire and every race ended with
the whole field wrecked. Prizes went up and car prices came down until the brief's three
paths landed near their stated counts. Bot difficulty was recalibrated after "hard" turned
out to be *slower* than "easy": skill above one told the bot to carry more speed than the
car can hold, so it simply arrived at the barrier sooner.

**The wedging on the narrow circuits is fixed**, and it took five things rather than one.
Measured over a hundred and forty-four three-lap races of six bots, the longest a car spends
sitting in one place went from a hundred and one seconds to nine, and the share of its race
an average bot spends going nowhere went from fifteen per cent to three.

  · A car pressed against a barrier used to lose almost all its speed within a
    second, because the wall took a share of everything it was doing on every
    step rather than scrubbing along the surface it was against. It now slows at
    a rate set by how hard it is pressed, which a car can drive out of.
  · Two cars touching with no closing speed between them stayed glued, since only
    a closing impulse ever pushed anything apart. They now separate in proportion
    to how far they overlap.
  · A bot could want a lane and not take it: aiming at a point sixty metres ahead
    turns a six-metre lane change into a tenth of a radian, which the feed-forward
    for the bend it was already in swamped completely. A cross-track term, the
    one a Stanley controller uses, closes the gap to the lane it has chosen.
  · Anything the car was jammed against but slightly behind its own middle was
    invisible to the gap search, so a bot would aim a lane straight back through
    the wreck it was stuck on. Things level with or just behind the car now count.
  · The widest gap is not always the right one. A car boxed in with clear road on
    the far side of a wreck cannot reach it, and aiming there anyway is how a bot
    sat in one place for a minute and a half. A gap is now worth what it is wide,
    less what it costs to reach, and crossing something to get there costs a lot.

Backing out also holds its clock while the car is still within touching distance of
whatever it is on, because a fixed count was exactly enough to break contact and no more:
the car would roll forward a metre and jam on the same shell again.

With the bots no longer losing races to the scenery, the aggression that had been turned
down while they were sitting still being shot at went back up, and five per cent of races
now end with one car left standing rather than none.

**The detail pass on the three maps** changed how the circuits are drawn rather than what
they are. None of it reaches the server: every material is still computed on the client from
a height function, and the simulation never hears about any of it.

  · The procedural toolkit moved out of AGRAV. `noise.js` and `surfaces.js` are now
    `shared/gfx/`, the geometry helpers they were tangled up with came out into
    `shared/gfx/geom.js`, and `agrav/src/render/props.js` re-exports the five it
    used to own so nothing in AGRAV had to change beyond an import path.
  · The ground is two materials, not one, mixed by a `blend` vertex attribute
    from slow noise and tinted per theme on top. A single texture repeated over a
    kilometre of landscape is a chequerboard, and no amount of detail in the
    texture hides it.
  · Materials are tiled at roughly one texture to a screen's worth of ground.
    They had been packed six times finer, which sounds like more detail and is
    in fact less: every repeat was minified into mush before it reached a pixel.
  · The barrier is a solid wall with a top and a back, not a single plane. From
    directly above a plane is one pixel wide, and the eye loses the edge of the
    road exactly where it most needs it.
  · The road is shaded across its width as well as along it: rubber down the
    racing line, grit at the edges, patch noise over the top. Tar-filled cracks,
    patches and drain covers are laid on as flat quads, and the grid boxes are
    painted where `gridSlot` actually puts the cars.
  · Anything that passes over the road — a bridge deck, the arch on Ridge, the
    beam of the start gantry — fades out as the camera comes under it. A slab of
    concrete between the camera and your own car is not a detail, it is a
    blindfold.
  · Scenery is merged down to one mesh per material by `flatten()`. The verges
    are a few thousand little props now, and a few thousand draw calls is how a
    scene like this stops being sixty frames a second: on the software renderer
    the screenshot tool uses, merging took a frame from 3.6 s to 0.45 s.

**The cars were rebuilt** for the same reason the maps were: a box with a smaller
box on top is a car only if you already know it is one.

  · The body is lofted along stations from nose to tail, three levels to a
    section — sill, belt line, then deck or roof — and the plan half-width down
    the length is what makes a Vagabond a beetle, a Stiletto a coupe and a
    Behemoth a slab. At racing zoom the outline is most of what the eye gets,
    so the outline is where the shape lives.
  · The paint is a canvas drawn in plan and projected straight down, which puts
    the windscreen, the roof, the panel lines, the rust and a race number
    exactly where they belong, and hands the flanks the smeared edge of it —
    which is what a flank should show. It carries its own height and roughness
    maps, so the glass is glass and the rust is rust.
  · Headlamps and tail lamps are unlit meshes set into the leading and trailing
    edges of the deck. On a real car they live on the front face, where from
    directly above they are one pixel of nothing; where they are now they are
    the first thing you can see of a car at any distance. The tail lamps
    brighten under braking and the headlamps go out below a third of a hull.
  · What the driver bought is on the car: the machine gun, shotgun or minigun
    on the bonnet, the spiked bumper, and a plate of armour for each upgrade.
    A minigun's barrels spin while it fires.
  · The wheels roll at road speed and the front pair steers, the body leans
    into a slide and pitches under the brakes. None of it is simulated — it is
    read back out of what the snapshot already said, so it costs nothing and
    the server never hears about it.
  · A wreck is the same body sat down on its rims with the roof gone, in
    scorched metal rather than black, with the cabin a soot-filled hole, ribs
    where the pillars were, a door off its hinges and panels thrown clear.
  · `tools/rallycars.js` photographs the whole showroom, from the angle the
    game uses and from one low enough to see what the shapes are.

**The laser sight is gone.** Decision 12 gave the gun a line to whatever sat in its
cone, and said plainly that the line was cosmetic. On screen it did not read that
way: a red line from your nose to another car looks like the gun is pointing at
that car, and it is not, so every shot that went straight past the thing the line
touched felt like the game lying. Cosmetic aim is worse than none.

  · `acquireLock` is deleted, along with the `LOCK` cone, the `lockOn` field on
    a car, the byte it took in every snapshot and the line the client drew.
  · The bots used the lock as a cheap gate before the real check. They now ask
    `wouldHitCar`, which traces the same ray the server will and answers with
    the car it would hit. It is one raycast per armed bot per tick, where the
    lock was a cone scan over every car for every car, so the sim does less
    work than it did.
  · The snapshot is a byte a car shorter, so `PROTOCOL_VERSION` goes to 3.
  · Bot aggression came down, from `0.34 + skill × 0.60` to `0.24 + skill × 0.48`.
    The old gate was accidentally restrictive: a bot only fired at whichever car
    sat nearest the middle of its cone, so it declined shots that would have hit
    somebody else. Asking the ray directly is better aim, and better aim over
    seventy-two measured races was an extra fifth of the kills and four times
    the elimination endings. Re-tuned until the sweep matched what it read
    before the sight was removed: elimination endings 3 races in 72 either way,
    finishers 49 per cent against 50, kills 183 against 184.

**The guns start cold.** Five seconds of ceasefire after the flag, which the brief
never asked for and the first race made obvious: six cars two lengths apart all
pointing the same way means the opening corner is settled by whoever was holding
the trigger at the lights. It is one guard in `stepGun`, so bots and players are
bound by the same rule in the same place, and the HUD counts it down where the
ammo usually sits — a trigger that does nothing and does not say why reads as a
bug. Over seventy-two measured races it did what it was meant to: kills down a
sixth, finishers from 49 per cent to 54, hull lost per race from 1360 to 1290.
Mines and the bumper are untouched, so there is still something to do with the
first five seconds besides steer.

**Buying a car did not change the car you raced.** The shop wrote the purchase to
the store and told the buyer, and the room never heard about it, so the seat kept
the profile it was given when the player joined. The model on track was the
visible half of it; the other half was that the race ran on the old car's stats
and hull.

  · A career action now reaches the room as well as the store. `setCareerRecord`
    takes the new record, and mid-race it deliberately does nothing: a seat races
    what it started the race in.
  · That alone was not enough. The shop is used on the results screen, where the
    last race's state is `FINISHED`, and `setCarProfile` refuses a profile change
    on anything but a lobby state — so seating the new car into it did nothing at
    all. The rematch rebuild that `start` already did is now `_rebuildAfterRace`,
    shared by both, so a purchase builds the next race there and then. That is
    what was going to happen at the flag anyway.
  · `tools/rallytest.js` buys an armour upgrade in a real browser after a real
    race and checks the seat's `maxHull` moved with the record — it reads 260
    before and 294 after — then buys a car when one is affordable. Removing the
    fix makes it fail, which is the only way to know a regression test works.

**The career read path never ran.** `lobby.career` takes the whole message as its
action and then compared that object to the string `'get'`, which is never true,
so every read fell through to the shop's `apply` and came back `{error: 'unknown'}`
with the record attached. Nothing showed it: the client never sends a bare read,
because the room hands the record over unprompted when a player joins. The
platform test sent one and only ever looked at `.career`.

Fixing the comparison exposed the other half. The re-seat added for the car bug
was gated on there being no error, and a read had always carried one — so making
reads succeed would have made every read disturb the room, which on the results
screen means throwing away the finished race and re-rolling the seed for the next
one. `lobby.career` now says `changed: true` when a record actually moved, the
session re-seats on that alone, and the flag is stripped before the reply goes out.
The test for it runs on the results screen with the finished race still in place,
because anywhere else it passes whether or not the code is right.

**Changing a room option took your gun away.** What a seat owns lives in the match
state, because that is where `setProfile` looks to refuse a gun nobody bought. The
room rebuilds the match in three places and only two of them put ownership back:
the rematch did, an option change did not. So after the host touched the track,
the laps or the difficulty, the lobby picker fell back to the loadout of a player
with no record at all — whose only gun is the machine gun — and a driver who asked
for the minigun took to the grid without it. Nothing said so. The garage healed it,
because that path re-seats from the record, so the bug only bit between an option
change and the next visit to the shop, which is exactly when people pick a gun and
press ready.

The one-line fix would have been to copy the missing line into `setOpts`. Instead
every rebuild now goes through `_reseat`, so there is one place to forget it in
rather than three, and a fourth rebuild site cannot quietly reintroduce it. The
car was never affected: the picker falls back to whatever is already seated, and a
driver never re-asserts their car in the lobby.
