# RALLY — development plan

A top-down, parallax, car-combat racer in the spirit of *Death Rally*, as the third game on
the AGRAV games platform. Up to six drivers on three closed circuits, bots filling every
empty seat, a race won either by crossing the line first after the required laps or by
blowing up everyone else, and a persistent career: money, mandatory repairs, upgrades and a
ladder of cars from a weak beetle to elite hulls.

Working id: `rally` (folders `shared/rally/` and `rally/`). The display name is a
placeholder to be picked before the launcher card ships.

This document is the plan; it names the pieces, the order to build them in, what each
milestone must prove, and the decisions still open. It is meant to be revised as the work
lands.

---

## 1. What the platform already gives, and what it needs

The server (`server/room.js`, `lobby.js`, `session.js`) is game-agnostic: rooms, four-letter
codes, the public list, host/ready/start, lobby bots, reconnect with a grace period, the
60 Hz fixed step, 30 Hz binary snapshots, reliable events, results. A game is one module in
`shared/<game>/module.js` (contract in `shared/net/module-contract.md`), one client folder,
and one line in `server/games.js`. RALLY reuses all of that unchanged and adds two small,
generic platform features that neither existing game needed:

| Need | Why RALLY needs it | Change |
|---|---|---|
| **Auto-fill bots at start** | "bots fill the slots if players are not present" without the host clicking Add bot five times | `Room.requestStart`: if `game.fillBots?.(state)` returns true, add lobby bots up to `maxPlayers` before `start()`. Opt-in per module, so AGRAV and Volley keep their behaviour. |
| **Per-player persistent data** | money, car damage, upgrades and unlocks must survive the session token, which expires after a reconnect grace | a `server/store.js` (JSON files under `DATA_DIR`, atomic write, in-memory cache) and an optional module `career` hook set (§5). Namespaced by game id, so any future game can keep progression. |

Everything else the design needs (weapon choice before the race, mines, pickups, win by
elimination, lag-compensated guns, bots that shoot) has a working precedent in
`shared/agrav/` and is ported to a free 2D world rather than invented.

Protocol: two new JSON control messages (`CAREER` s→c, `CAREER_ACTION` c→s) and an optional
`careerKey` field on HELLO. `PROTOCOL_VERSION` goes to 2, as the comment in
`shared/net/protocol.js` asks whenever a control shape changes; the existing clients are
served from the same checkout so they move together.

---

## 2. Design, resolved into rules

The brief, turned into the numbers and rules the simulation will implement. Every value
here is a starting point for `shared/rally/constants.js` and is expected to move during the
balance pass (M6).

### Race

- Closed circuits seen from above. Three tracks (§7). Lap count is a host option, default 3,
  range 1–9 like AGRAV.
- Up to 6 drivers, `minPlayers: 1`. Empty seats fill with bots at start (host option
  `fillBots`, default on). The host can still add or kick bots by hand.
- **Two ways to win**: cross the line first after the required laps, or be the last car alive.
  When the alive count drops to one before anyone has finished, that car wins on the spot and
  the race ends. When the first car finishes, the others get a grace window (20 s) to finish
  for placing, exactly the AGRAV `FINISH_GRACE_SEC` pattern; an exploded car is placed by the
  distance it covered.
- Results: place, finished or eliminated, time, best lap, kills, money earned.

### Cars are light tanks

- Hull points (armour) come from the car and its Armour upgrade level. Zero hull explodes the
  car; the wreck stays on the track as an obstacle for the rest of the race, and the driver
  spectates (tap to follow another car, as in AGRAV).
- Walls scrape hull away when sliding along them and take a chunk on a hard hit. Manoeuvrability
  is what keeps you off them (§3, physics).
- Car-to-car contact is mass-weighted (heavier hull gives way less); a hard ram hurts both, a
  **spiked bumper** makes the rammer's side of the exchange free and the victim's much worse.

### Weapons

| | Type | Ammo | Notes |
|---|---|---|---|
| **Machine gun** | primary, fixed forward, hitscan | 300 rounds | default; low damage, high rate, accurate |
| **Shotgun** | primary, fixed forward, 6-pellet cone hitscan | 40 shells | huge close damage, useless at range, slow refire |
| **Minigun** | primary, fixed forward, hitscan | 600 rounds | spins up for 0.4 s, then the highest damage per second, strong spread |
| **Mines** | support, dropped behind | 3 per race | arm after 0.5 s, live for the race, hurt anyone including the owner |
| **Spiked bumper** | support, passive | owned upgrade | ram damage ×3 dealt, ×0.5 received |

- The primary weapon is **picked in the lobby** (a profile field, validated by `setProfile`) and
  costs nothing per race. Owning a weapon is a career purchase (§5); the machine gun is free.
- **Laser sight / auto-lock**: while a car is inside the gun's cone and within range, the sim
  marks it as the shooter's lock (nearest by angle, then distance); the client draws the laser
  line to it and the server applies a small aim assist (rounds curve toward the lock by up to a
  few degrees). Lock selection runs in the shared sim, so the client's laser line agrees with
  what the server will hit.
- Guns are **lag-compensated** with the pose-history rewind already used by the AGRAV
  minigun (`HISTORY_TICKS`, `HITSCAN_REWIND_TICKS`), rewound to what the shooter saw.
- Input bits: throttle, brake, fire, mine, nitro. Five bits in the existing `u8`.

### Pickups on the track

Spawn points are authored per track (a list of `{s, t}` in ribbon coordinates, like AGRAV pads).
A seeded schedule puts one of four items on a random free point every few seconds, so a race
never has more than a handful live at once. Driving over one takes it.

| Pickup | Effect | Weight |
|---|---|---|
| Ammo | +25 % of the equipped primary's capacity | 4 |
| Nitro | one charge, 2.5 s of +40 % top speed and accel, fired with the nitro bit | 3 |
| Repair kit | +30 hull, capped at max | 2 |
| Cash | money added to the career purse on settlement | 2 |

### Money

| Source | Amount |
|---|---|
| 1st place | 600 × track multiplier |
| 2nd | 350 × |
| 3rd | 200 × |
| 4th–6th | 60 × (participation) |
| Cash pickup | 50–150, rolled by the race rng |
| Kill | 75 |

Track multipliers: 1.0 / 1.3 / 1.6 for the three tracks in difficulty order.

### Persistent damage and mandatory repairs

- The hull you end the race with is the hull you start the next one with. An exploded car comes
  home at 0.
- Repair costs `(maxHull − hull) × repairRate` where `repairRate` rises with the car tier.
- **No purchase is possible while the hull is below max.** The shop returns
  `{error: 'repair-first'}` and the garage UI greys out every button but Repair.
- A driver may still race damaged. The garage shows the hull bar in red under a third, the same
  language as the AGRAV damage readout.

### Upgrades

Three stats per car, five levels each. Prices scale with car tier and level.

| Stat | What it moves |
|---|---|
| **Speed** | top speed and acceleration |
| **Handling** | lateral grip and steering rate; the difference between a corner and a wall |
| **Armour** | max hull (and mass, so contact favours you) |

### Cars and the ladder

Six cars, unlocked by **reputation** and bought with money. Reputation is one scale that
encodes all three of the brief's paths to the elite tier: a win is 3 points, second place is
1.5, any other finish (including exploding) is 1. Five wins, ten seconds or fifteen
participations all reach 15.

| Car | Inspiration | Reputation to unlock | Price | Base speed / handling / armour |
|---|---|---|---|---|
| **Vagabond** | a beetle | 0 (starter, owned) | — | low / low / low |
| **Mongrel** | a pickup | 3 | 1 500 | mid / low / mid |
| **Stiletto** | a coupé | 6 | 4 000 | high / mid / low |
| **Warden** | an armoured saloon | 9 | 7 000 | mid / mid / high |
| **Behemoth** | a truck cab | 12 | 11 000 | mid / low / very high |
| **Valkyrie** | an elite prototype | 15 | 18 000 | very high / high / high |

The names other than Vagabond are placeholders; only the tier structure and the thresholds
are design.

Bots drive the tier of the lobby: each bot gets the car and upgrade level of the average human
in the room, ±1 tier, so a new Vagabond driver is not fed to Valkyries and an elite driver is
not handed free wins.

---

## 3. Architecture

```
shared/rally/
  module.js        the contract object: match lifecycle, inputs, bots, snapshot, results, career hooks
  constants.js     tick/snapshot rates, physics, weapons, pickups, prizes, prices, PHASE, input bits
  cars.js          the six cars: base stats, tier, unlock reputation, price, upgrade tables, hull shape
  weapons.js       primaries, mines, bumper: fire, hitscan with rewind, cone/pellet spread, lock selection
  pickups.js       spawn schedule, collection, effects
  career.js        pure career rules: default profile, settle(results), apply(action) -> {career|error}
  bot.js           racing line follower + combat judgement; also drives tools/rallysim.js
  sim/
    track.js       track -> {ribbon, walls, spawn points, grid}; nearest-s progress; wall distance
    car.js         the 2D car model: stepCar(track, car, input, dt)
    race.js        createRace, addRacer, start, stepRace (contacts, laps, elimination, end), results
    snapshot.js    encode/decode: cars, wrecks, mines, live pickups, locks
  tracks/
    index.js       TRACK_IDS, getTrack
    scrapyard.js   track 1: junkyard — wide, forgiving, one hairpin
    harbour.js     track 2: docks — cranes and containers, a bridge crossing the parallax layer
    ridge.js       track 3: mountain pass — narrow, long drops beside the road, two chicanes

rally/
  index.html       screens: menu, garage, lobby, race HUD, results (CSS inline, as Volley does)
  manifest.webmanifest, sw.js, icons/
  src/
    main.js        wiring: menu → garage → lobby → race → results; loop
    net.js         the network client (prediction, reconciliation, interpolation, career messages)
    input.js       keyboard / gamepad / touch → {bits, steer}
    garage.js      the shop: repair, upgrades, weapons, cars; talks CAREER_ACTION
    hud.js         hull, ammo, lap, position, minimap, laser line, kill feed
    audio.js       engines, guns, explosions (synthesized, as AGRAV)
    render/
      scene.js     three.js top-down camera, layers, follow + look-ahead
      track.js     ground, road, kerbs, walls from track data; parallax props per theme
      car.js       car meshes (lofted or sprite-on-quad), liveries, damage state, wreck
      fx.js        tracers, muzzle flash, explosions, mine glow, nitro flame, pickups
      themes/      scrapyard.js, harbour.js, ridge.js — props and colours per track

server/
  store.js         JSON-on-disk key/value with atomic writes; DATA_DIR from config
  games.js         + rally line
  room.js          + fillBots at start; + career settle at _finish
  session.js       + careerKey on HELLO; + CAREER / CAREER_ACTION routing

tools/
  rallysim.js      headless bots-only race per track and car tier: finish rate, lap times, kills
  rallylint.js     track checks: closed, no self-intersection, min width, grid fits, spawn points on road
  netsim.js        --game rally (drives rally/src/net.js with the rally bot)
  racetest.js      --game rally (two Chromium clients + bots through to results and the garage)
```

### The world is free 2D, the track is still a ribbon

AGRAV moves craft in ribbon coordinates `(s, t)`. A top-down car has to be free to spin,
reverse, and cross the road at any angle, so RALLY simulates in world `(x, y, heading)` and
uses the ribbon only as a **reference**:

- `shared/sim/spline.js` builds the centreline (control points with `y = 0`) and gives arc
  length, frames and width. The track's left and right walls are the offset curves.
- Progress and laps: the car's nearest `s` (a per-car incremental search along the frames,
  not the coarse `nearestS`, which is meant for tools) and `deltaS` across ticks, as AGRAV
  does. A car driven backwards loses progress and cannot cheat a lap.
- Wall collision: signed lateral distance `|t| − width/2` at the nearest frame, resolved as
  a circle-vs-wall push with the scrape / hard-hit rule.
- Bots follow the ribbon with a lookahead point like the AGRAV bot, and the racing line is
  the same curvature-biased lane.

### Car model (`sim/car.js`)

An arcade model that reads as a heavy car and rewards handling upgrades:

- Longitudinal: throttle accel, brake decel, rolling drag, top speed; nitro multiplies the first
  and last.
- Steering: yaw rate proportional to the stick and to speed up to a cap, reduced at very high
  speed; the handling stat sets the cap.
- Lateral: velocity is decomposed into forward and sideways; sideways velocity decays with a
  grip factor per tick (the handling stat again). When sideways speed exceeds a threshold the
  car is **sliding**: less grip, tyre marks, the HUD nudge. Low handling cars slide on every
  fast corner and meet the wall; that is the brief's "fondamentale per non scivolare contro i
  muri".
- Contact: circle bodies (radius from the car's length) for cars and wrecks, mass = armour.
- Mines: static circles; wrecks: static circles with the dead car's mass.
- Fully deterministic: no `Math.random`, all randomness from the race rng, so the client's
  prediction of its own car is the server's step bit for bit (the property both existing games
  rely on).

### Netcode (`rally/src/net.js`)

Copied from the Volley client, which is the smaller and cleaner of the two, with the AGRAV
additions RALLY needs:

- 60 Hz inputs, last three bundled; `NetClock` for the tick estimate and lead.
- Own car: `stepCar` every tick, replaced by the snapshot record and replayed for pending inputs,
  the difference blended over ~100 ms.
- Others, wrecks, mines, pickups: interpolated 4 ticks behind between two snapshots.
- Hitscan shots are server-authoritative; the client draws its own tracer instantly from the fire
  input and reconciles hits from the `hit` events (the AGRAV minigun pattern).
- Snapshot payload budget: 6 cars × ~22 bytes + mines × 6 + pickups bitfield + locks ≈ 200
  bytes at 30 Hz. No delta compression needed.

### Rendering (`rally/src/render/`)

**Recommendation: three.js with a perspective camera looking straight down.** The parallax
the brief asks for then comes for free: the road sits at height 0, walls, buildings, cranes and
trees are extruded up toward the camera, and overhead pieces (a bridge, gantry, foliage) sit
above the cars, so everything tall leans away from the centre and slides against the ground as
the camera follows the car. This is the *Death Rally* 2012 look, and it reuses the vendored
three.js, `shared/gfx/bloom.js`, and the AGRAV procedural texture and prop code
(`agrav/src/render/surfaces.js`, `props.js`, `noise.js`) rather than a second renderer.

The alternative is Canvas 2D with hand-scrolled layers (as Volley draws), which is cheaper to
write and lighter on phones but gives only a flat, layered parallax. Keep `?lite=1` for weak
devices and headless tests either way: no props, no bloom, flat colours.

Camera: follows the own car with a look-ahead along its velocity, zooms out with speed, and
rotates never (north-up, so the minimap and the track read the same all race). Cars are
low-poly meshes with a painted livery atlas (the AGRAV livery generator, scaled down) that takes
scorch marks as hull drops, and a burnt wreck mesh on death.

---

## 4. Bots (`shared/rally/bot.js`)

- **Driving**: aim at a lookahead point on the ribbon, feed-forward the curvature, brake for
  corners it cannot make at its speed, hold a lane of its own on a full grid, and detour to a
  pickup ahead when it needs one (ammo when low, repair when hurt, nitro on a straight).
- **Combat**: fire the primary only when a victim is inside the cone the hitscan actually scores
  with (the AGRAV rule), drop a mine when someone is close behind on a bend, fire nitro on the
  longest straight or to escape a chaser.
- **Skill**: `skill` scales lookahead, reaction and how late it brakes; a bot's car and upgrades
  match the lobby tier (§2). A host option `botSkill` (easy / normal / hard) is worth adding,
  mirroring Volley's `botDifficulty`.
- Drives every seat the room has no human for: a lobby bot, an auto-filled seat, or a driver
  who dropped and ran out the reconnect grace (the AGRAV `onAbandon` behaviour: the car is
  eliminated, and in RALLY its wreck stays).

---

## 5. Career and persistence

### Identity

The platform's session token is meant for reconnecting a socket to a seat and expires
minutes after a disconnect. A career needs an identity that lasts months, so the client keeps a
second, random 128-bit **career key** in `localStorage` and presents it on HELLO. The key is
the whole identity: no accounts, no passwords, and losing the browser storage loses the
career. That matches the platform's "type a name and play" posture; a later account system can
map onto the same store. The garage shows the key once as a "transfer code" so a player can
move a career to another device.

### Store (`server/store.js`)

- `get(ns, key)` / `set(ns, key, value)`: one JSON file per record under
  `DATA_DIR/<ns>/<key>.json`, written to a temp file and renamed, with an in-memory map so the
  hot path never touches disk.
- `DATA_DIR` defaults to `./data` (git-ignored, added to the static server's `HIDDEN` set so it
  is never served); `deploy/agrav.service` gets `StateDirectory=agrav` and
  `Environment=DATA_DIR=/var/lib/agrav`, since the unit mounts the checkout read-only.
- Bounded: a record is at most a few KB and the map evicts idle careers after an hour; a
  careers-per-file layout keeps `ls` and backups obvious.

### Contract extension (added to `module-contract.md`)

```js
career: {
  create() -> career,                                  // a new driver: Vagabond, machine gun, 0 money
  apply(career, action) -> { career } | { error },     // repair | upgrade | buyWeapon | buyCar | selectCar | selectWeapon
  settle(career, results, id) -> career,               // money, reputation, persisted hull, kills, races
  profile(career) -> profile                           // what the lobby/seat starts from: car, upgrades, hull, weapon
}
```

All career mutation is on the server, in pure functions in `shared/rally/career.js` so the
garage UI can *preview* a purchase with the same code and tests can drive the whole ladder
without a server.

### Flow

1. HELLO carries `careerKey`; the session loads (or creates) the career and sends `CAREER`.
2. The garage sends `CAREER_ACTION {action, ...}`; the server applies, saves, replies `CAREER`.
3. Joining a room, the seat's profile is derived from the career by `career.profile`; the
   lobby lets the driver choose only among weapons and cars they own, and `setProfile` on the
   server rejects anything else.
4. At `_finish`, the room calls `career.settle` for every human seat with a career key and
   saves; the results screen shows money earned, reputation gained and the hull you came home
   with, with a button straight into the garage.
5. Bots have no career; their seat profile is synthesized from the lobby tier.

A player who races without a career key (storage blocked) still plays: a Vagabond with a
machine gun, nothing saved, and the garage explains why.

---

## 6. Testing and tools

| Test | Proves |
|---|---|
| `shared/test/rally-car.test.js` | determinism (same inputs → same state), top speed and handling monotone in their stats, sliding threshold, wall scrape and hard hit |
| `shared/test/rally-race.test.js` | laps count only forward, a backwards car cannot lap, elimination win ends the race, finish grace, results ordering, wrecks persist |
| `shared/test/rally-weapons.test.js` | hitscan rewinds to the shooter's tick, cone and pellet spread, lock selection, mines arm and hurt the owner, bumper multipliers |
| `shared/test/rally-career.test.js` | settle prizes and reputation, repair-first rule, unlock thresholds (5 wins / 10 seconds / 15 races), price checks, no negative money |
| `shared/test/rally-bot.test.js` | a bot alone finishes every track; six bots finish without a pile-up |
| `server/test/rally-room.test.js` | auto-fill to six, a career persists across two races in one lobby, a dropped driver becomes a wreck, snapshots decode |
| `server/test/store.test.js` | atomic write, reload from disk, eviction |
| `tools/rallysim.js` | balance: per car tier per track, lap time spread and bot kill rate |
| `tools/rallylint.js` | every track closed, wide enough, no self-intersection, spawn points on the road |
| `tools/netsim.js --game rally` | prediction error, corrections, bandwidth under 80 ms ± 20 ms, 2 % loss with six clients |
| `tools/racetest.js --game rally` | two Chromium clients race bots to the results and buy a repair |

`npm test` keeps running everything under `shared/test` and `server/test`, so the new tests
join the existing 54 without wiring.

---

## 7. Tracks

Three circuits, authored like the AGRAV tracks as control-point lists (`x, z`, width) with
theme props generated on the client. Each has a difficulty multiplier for prizes and a distinct
parallax layer.

| Track | Theme | Length | Character | Parallax layer |
|---|---|---|---|---|
| **Scrapyard** | junkyard, rust and oil | ~1 200 m | wide, forgiving, one hairpin, two long straights for nitro | car stacks and a crane arm over the back straight |
| **Harbour** | docks at night | ~1 500 m | medium width, a chicane between containers, a bridge crossing | gantry cranes, the bridge deck the road passes under, then over |
| **Ridge** | mountain pass | ~1 800 m | narrow, drops beside the road, two chicanes, a blind crest | cliff faces on one side, tree canopy over the road, a rock arch |

Authoring rules go in `tools/rallylint.js`: minimum width for six cars abreast on the start
straight, minimum corner radius the Vagabond can take at half throttle, and pickup spawn points
at least 40 m apart.

---

## 8. Milestones

Each milestone ends with something that runs and a check that proves it. Sizes are rough and
in working days for one developer; the order is chosen so the multiplayer loop is real from
M1 and every later milestone rides on it.

### M0 — Platform groundwork (1–2 days)

- `server/store.js` + tests; `DATA_DIR` in config, `HIDDEN`, `.gitignore`, systemd
  `StateDirectory`.
- `fillBots` hook in `Room.requestStart`; `careerKey` on HELLO; `CAREER` and `CAREER_ACTION`
  messages; `PROTOCOL_VERSION` 2; `module-contract.md` updated.
- `rally` registered in `server/games.js` with a stub module (an echo of the contract), the
  launcher card on `index.html`, empty `rally/` PWA shell.
- **Proves**: existing 54 tests pass; a stub RALLY room can be created, auto-filled and started
  in a test.

### M1 — Simulation core (4–5 days)

- `tracks/scrapyard.js`, `sim/track.js` (ribbon, walls, progress), `sim/car.js`,
  `sim/race.js` (grid, countdown, laps, finish, results), `snapshot.js`, `bot.js` driving only.
- `tools/rallysim.js` and `tools/rallylint.js`.
- **Proves**: six bots race three laps of Scrapyard headless and all finish; determinism and
  race tests green; the snapshot round-trips.

### M2 — Playable client (5–6 days)

- `rally/src/net.js`, `input.js`, `main.js` (menu, lobby, results), `render/scene.js`,
  `render/track.js` (road, kerbs, walls, flat ground), `render/car.js`, `hud.js`.
- Camera follow and look-ahead, minimap, position and lap readouts.
- **Proves**: two browsers and four bots complete a race; `netsim.js --game rally` reports
  no hard corrections at 80 ms RTT; `racetest.js --game rally` passes.

### M3 — Combat (4–5 days)

- `weapons.js`: machine gun, shotgun, minigun with rewind hitscan, lock selection and aim
  assist; mines; spiked bumper in contacts; `pickups.js` with the four items.
- Hull, wall damage, explosions, wrecks as obstacles, elimination win, spectating.
- Bot combat judgement. Client: tracers, laser line, muzzle flash, explosions, kill feed, mine
  and nitro FX, audio.
- **Proves**: weapons and race tests green; a bots-only race ends by elimination at least
  sometimes at hard skill; nobody can score a hit outside the cone.

### M4 — Career (3–4 days)

- `cars.js` full ladder and upgrade tables, `career.js` (create, apply, settle, profile),
  server settle at `_finish`, lobby restricted to owned cars and weapons.
- `rally/src/garage.js` and the garage screen: repair-first, upgrades, weapons, cars, transfer
  code. Results screen shows earnings.
- **Proves**: career tests green; a room test runs two races and the second starts with the
  persisted hull; a fresh driver cannot buy before repairing.

### M5 — Tracks and look (5–7 days)

- Harbour and Ridge, with their themes; parallax props (cranes, bridge, canopy, cliffs);
  liveries and damage states; wreck meshes; lite mode.
- Icons, manifest, service worker, `tools/shots.js` support for `rally` screenshots into
  `docs/screenshots/rally/`.
- **Proves**: `rallylint` clean on all three; `rallysim` lap-time spread per tier within the
  balance target on every track; screenshots in the README.

### M6 — Balance, hardening, docs (3–4 days)

- Balance pass on prices, prizes, repair rates and unlock pacing against the brief's "about 5
  wins to the elite cars"; bot tiering; weapon damage.
- Netsim with six clients and packet loss; reconnect mid-race; a slow client on the grid hold.
- `rally/README.md`, root README card and file map, `deploy/` notes for `DATA_DIR`.

Total: roughly 25–33 days of focused work, with M1–M3 as the critical path.

---

## 9. Decisions to confirm

Defaults are chosen so work can start now; each is a one-line change if the answer differs.

| Question | Default in this plan |
|---|---|
| Renderer | three.js perspective top-down (true parallax, reuses the AGRAV toolkit); Canvas 2D if phone performance turns out to matter more than the look |
| Identity for the career | a client-held career key, no accounts; store is file-backed JSON |
| Elimination win | ends the race immediately when one car is left, even mid-lap |
| Mines | 3 per race, free; hurt the owner too |
| Spiked bumper | a permanent career purchase, not a per-race consumable |
| Bot cars | matched to the lobby's average tier ±1 |
| Reputation scale | win 3, second 1.5, other finish 1, elite at 15 (which is exactly 5 wins, 10 seconds or 15 races) |
| Display name | placeholder; pick before the launcher card is written |
| Rockets / homing weapons | out of scope for the first release; the weapon table is data-driven so adding one is a row plus FX |

---

## 10. Risks

- **Physics feel** is the whole game; budget iteration in M1 with `rallysim` and a keyboard
  before any art. The brief's handling-versus-walls tension has to be felt at the Vagabond tier
  or the upgrade economy has nothing to sell.
- **Six cars in one corner**: circle contacts and wrecks as obstacles can produce pile-ups at
  the first bend; the grid spacing, contact loss and the bots' lane-keeping are the levers, and
  the bots-only race in `rallysim` is the regression test.
- **Persistence is new to the platform**: keep the store tiny, synchronous in the room tick
  (memory only) and asynchronous to disk, and never let a disk error kill a room.
- **Cheating**: all money and hull changes are server-side and the lobby validates picks against
  ownership, so the only thing a client controls is its inputs, as today.
