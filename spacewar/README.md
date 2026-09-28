# Spacewar!

The 1962 PDP-1 classic, rebuilt for the browser: up to four ships on a wrapping arena,
optionally around a planet whose gravity pulls everything in. The fourth game on the AGRAV
games platform. It shares the platform's server, lobby, netcode, bots-in-the-lobby, reconnect
and solo play, and draws on a plain 2D canvas.

## Play

**Play solo vs bots** needs no server: the lobby and room engine runs inside the page, so the
game works from a static deploy (GitHub Pages) or offline once installed. Online, create a
room (you become the host) or join one with its four-letter code or from the public list.

Each seat has its own hull and colour: **Needle** (cyan), **Wedge** (pink), **Hornet**
(amber) and **Manta** (green). They look different and fly the same.

The host picks the options and launches:

- **Rounds to win**: 1, 3, 5 (default), 7 or 10.
- **Bots**: easy, normal or hard.
- **Planet & gravity**: a planet at the centre whose pull falls off with the square of the
  distance. Touching it is fatal. Torpedoes ignore its gravity and fly straight, but the
  planet swallows any that hit it. With it on, ships start each round in orbit.
- **Fill seats 3 and 4 with bots** (off by default): at launch every empty seat gets a bot.

A match always has at least two ships: a lone pilot gets one bot in seat 2. Seats 3 and 4 are
optional. They fly only if someone joins, the host adds a bot, or filling is on.

A player who drops mid-match is flown by a bot until they reconnect.

## Rules

- The arena wraps: a ship or torpedo leaving one edge comes back in at the opposite one.
- **Turn**, **thrust** and **fire**. Space has no drag. Thrust burns fuel, and each ship
  gets 20 seconds of burn and 24 torpedoes per round, shown on its HUD card.
- Torpedoes leave at a fixed speed on top of the ship's own velocity, fly in a straight
  line, wrap, and burn out after 2.5 s. A torpedo kills the ship it hits, including the one
  that fired it once it is clear of the launcher. Two torpedoes that meet destroy each other.
- **Hyperspace** jumps you to a random spot clear of the planet and the other ships. You are
  gone and untouchable for 0.6 s and come back with the velocity you left with, then it
  recharges for 5 s (the ring on your HUD card).
- Two ships that touch both explode.
- A round ends a moment after only one ship is left, so a torpedo already in flight can
  still change the result. The survivor takes the round. If nobody survives, the round is a
  draw. A round is also a draw after two minutes, or twelve seconds after every survivor has
  run out of torpedoes.
- The first to win the chosen number of rounds wins the match. The results list rounds,
  kills and deaths for every ship.

## Controls

| | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Turn | ← → or A D | left stick / d-pad | ⟲ ⟳ bottom left |
| Thrust | ↑ or W | A / RT | ▲ |
| Fire | Space, Ctrl, F or Enter | X / RB | ● |
| Hyperspace | ↓, S or Shift | B / Y / LB | ◇ |

## How it is built

```
shared/spacewar/constants.js   arena, physics and round tuning, the four hulls' colours
shared/spacewar/sim.js         deterministic simulation: stepShip() (shared with prediction) and step()
shared/spacewar/bot.js         bot pilots: dodge the planet, dodge torpedoes, lead the target
shared/spacewar/snapshot.js    binary snapshot: round, ships, every torpedo (about 13 bytes each)
shared/spacewar/module.js      the platform contract (shared/net/module-contract.md)
spacewar/src/net.js            prediction of your ship, interpolation of the rest, all wrap-aware
spacewar/src/render.js         canvas renderer: nebula and stars, planet, hulls, trails, particles, HUD
spacewar/src/input.js          keyboard, gamepad and touch -> {bits, steer}
spacewar/src/audio.js          synthesized sound (Web Audio, no files)
spacewar/src/main.js           menu, lobby, results, and the bot demo behind the menus
```

The server runs the match at 60 Hz and sends a snapshot 30 times a second. Your own ship runs
the same `stepShip()` locally on your inputs. Each snapshot replaces it with the server's copy
and replays the inputs the server has not seen yet, and any leftover error is eased out over
about 100 ms. Firing and hyperspace are decided by the server, because a jump's destination
comes from the match's random stream. Other ships and all torpedoes are drawn four ticks in
the past, between two snapshots, and every interpolation takes the short way round the wrap.

Hit tests are swept over the tick, so a torpedo can't skip through a ship between two frames.

```sh
npm test                           # includes shared/test/spacewar.test.js and server/test/spacewar-room.test.js
node tools/spacewarsim.js 5 4 hard # headless bot matches: how rounds end and how long they last
node tools/spacewartest.js         # two headless browsers online, through a match to the results
```
