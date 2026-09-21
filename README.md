# AGRAV games

A platform for small multiplayer browser games: one authoritative Node.js server that
hosts many rooms of many games at once, a `shared/` simulation and protocol layer that the
server and the browser import **unchanged**, and one three.js PWA client per game. No build
step anywhere: ES modules are served as they are written.

Three games ship today:

- **[AGRAV](agrav/README.md)** — a 12-player anti-gravity combat racer in the spirit of the
  original Wipeout.
- **[Volley](volley/README.md)** — blobby beach volleyball in 1-on-1, 2-on-2 or 3-on-3, for up
  to six players, bots filling any empty seat.
- **[Scrap Rally](rally/README.md)** — top-down car combat for six, won by the flag or by
  being the last car running, with a career that remembers your money and your damage.

```
server/     Node 22 · rooms, sessions, lobby, static files, /api, /ws · one dependency (ws)
            the room/lobby engine also runs in the browser for solo play (solo.js)
shared/     net protocol + transport, sim primitives, gfx helpers, and shared/<game>/ per game
agrav/      the AGRAV client (PWA)
volley/     the Volley client (PWA)
rally/      the Scrap Rally client (PWA)
tools/      lint, balance, network soak, browser end-to-end, icon rendering
deploy/     systemd unit, nginx site, Ubuntu install script
data/       durable player records, when a game keeps any (git-ignored)
```

## Run it

```sh
npm install          # installs ws (and playwright-core for the browser test)
npm start            # http://localhost:8080  → the launcher; /agrav/ and /volley/ are the games
```

Open the same URL on a phone on the same network and play yourself. Rooms are joined by a
four-letter code or from the public list on the menu; the host can add bots.

## Playing without a server

All three games also run **solo against bots with no server at all**, so the whole repo can
be published as static files — GitHub Pages, any CDN, even `file://`. The menu's first
button (*Play solo vs bots* / *Race solo vs bots*) is all it takes.

This is not a second implementation. The page imports the very same room, lobby and session
modules the Node server runs and wires them to the client over `LoopbackChannel`, the
in-process transport the server tests use (see [`server/solo.js`](server/solo.js)). The
client keeps its prediction, reconciliation and interpolation; the round trip is simply
zero, and the bots are the ones the server always ran.

Nothing the page imports touches a `node:` builtin, which a test enforces: paths are left
unresolved in `config.js`, tokens come from Web Crypto, and the on-disk record store lives
apart in `store-file.js`, which only the Node entry point loads. In the page, Scrap Rally's
career is kept in `localStorage` instead, so the garage survives a reload.

Each client probes `/api/health` on load: with a server behind it the online half of the
menu appears, and without one (a static deploy) the menu is solo-only. `?solo=1` forces
solo play anywhere.

`.github/workflows/pages.yml` runs the tests and publishes the site to GitHub Pages on
every push to `main`. There is no build step — the files are served exactly as written.

## Architecture in one paragraph

Clients send **inputs only** (`{seq, tick, bits, steer}` at 60 Hz, the last three bundled so
one lost packet costs nothing); the server simulates every room at a fixed 60 Hz and sends a
binary snapshot 30 times a second to each player, with the newest input it saw and how early
that input arrived. The client runs the same simulation code for its own craft
(prediction), replaces its state with the server's on every snapshot and replays the inputs
the server has not seen yet (reconciliation), blends any difference over ~100 ms, and draws
everyone else a few ticks in the past between two snapshots (interpolation). That prediction
steps the local craft alone against the track, so the pose handed to the renderer is pushed clear
of the craft drawn around it -- only the drawn pose, because those craft are a moment in the past
and moving the prediction to suit them puts it where the server never agrees. A clock
estimates the server tick from ping round trips and stamps inputs just far enough ahead to
arrive on time, resyncing from the server-measured margin when the estimate is off. The
minigun is lag-compensated against a 250 ms pose history. Transport is WebSocket behind a
two-class channel abstraction (reliable / unreliable), so an unreliable WebRTC DataChannel or
WebTransport path can be added without touching game code.

## Adding a game

1. `shared/<game>/module.js` implementing the contract in
   [`shared/net/module-contract.md`](shared/net/module-contract.md) — pure JS, no DOM.
2. `<game>/` — the client: `index.html`, `src/`, a manifest and service worker.
3. One line in [`server/games.js`](server/games.js).

The room, lobby, sessions, reconnect, snapshots, bots-in-the-lobby and solo play all come
for free.

Two more things a game can ask for, and neither costs the others anything:

- **`fillBots`** — at the flag, every seat nobody took becomes an ordinary room player
  driven by the game's own bot, so one person can start a full grid.
- **`career`** — a JSON record the server keeps per player in `server/store.js`, addressed
  by a long-lived key the client makes once and presents on `HELLO`. Every rule about it is
  one of the game module's own pure functions; the server only moves records between the
  store and the module. Scrap Rally keeps money, damage and what you own in one.

## Tools

```sh
npm test                       # node --test: shared sim + server (all three games)

# AGRAV
node tools/tracklint.js        # every track: width, radius, overlap, banking, pads, jumps
node tools/balance.js          # each craft solo on each track; lap times within ±3 %
node tools/netsim.js --players 12 --rtt 80 --jitter 20 --loss 0.02
                               # headless clients over real sockets through a lossy shim
node tools/racetest.js         # two headless Chromium clients + a bot race to the results
node tools/shots.js            # screenshots of every track and craft into docs/screenshots

# Volley
node tools/volleysim.js 15 2 hard          # a headless bots-vs-bots match

# Scrap Rally
node tools/rallylint.js        # every circuit: closure, width, obstacles, pads, the grid
node tools/rallysim.js         # headless bots; --sweep how races end, --career the ladder
node tools/rallynet.js --players 6         # synthetic clients over a lossy socket
node tools/rallytest.js        # two headless browsers through a race and into the garage
node tools/rallyshots.js       # screenshots of every circuit

node tools/icons.js            # re-render the PWA icons
```

Netsim baseline on a 4-core box (12 racers, 80 ms ±20 ms RTT, 2 % loss, one lap of Neon
Meridian, server and all twelve clients in one process): server tick p95 0.44 ms,
10 KB/s down and 1.5 KB/s up per client, prediction error after reconciliation 0.00 m
median and p95, no hard corrections and no clock resyncs while racing.

`tools/rallynet.js` is the same soak for Scrap Rally (six cars, 80 ms ±20 ms, 2 % loss):
server tick p95 under 0.3 ms, about 7.5 KB/s down and 1.5 KB/s up per client, prediction
error after reconciliation 0.001 m median and 0.05 m at the 95th percentile, no hard
corrections and no clock resyncs.

## Deploy on Ubuntu

```sh
sudo bash deploy/install.sh https://github.com/mstevana/agrav.git games.example.com
sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d games.example.com
curl -s http://127.0.0.1:8080/api/health
```

`deploy/agrav.service` runs the server as a system user on `127.0.0.1:8080`;
`deploy/nginx.conf` terminates TLS, serves the static files and proxies `/api` and `/ws`.
Environment knobs: `PORT`, `HOST`, `STATIC_ROOT`, `MAX_ROOMS`, `TICK_BUDGET_MS`,
`RECONNECT_GRACE_MS`, `EMPTY_ROOM_TTL_MS`, `RATE_LIMIT_PER_SEC`, `LOG_LEVEL`, `DATA_DIR`.

`DATA_DIR` is where durable player records live (Scrap Rally careers). It defaults to
`./data` beside the checkout; the systemd unit mounts the checkout read-only and points it
at `/var/lib/agrav` through `StateDirectory`, which is the directory to back up. Setting it
to the empty string keeps records in memory only, so nothing survives a restart.
Update with `git pull && npm install --omit=dev && systemctl restart agrav`
(a restart drops live races; do it between sessions or run a second instance on another
port and switch nginx).

## Licence

MIT. three.js r160 is vendored under `shared/vendor/` (MIT, see `THREE-LICENSE`).
