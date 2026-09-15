# AGRAV games

A platform for small multiplayer browser games: one authoritative Node.js server that
hosts many rooms of many games at once, a `shared/` simulation and protocol layer that the
server and the browser import **unchanged**, and one three.js PWA client per game. No build
step anywhere: ES modules are served as they are written.

Two games ship today:

- **[AGRAV](agrav/README.md)** — a 12-player anti-gravity combat racer in the spirit of the
  original Wipeout.
- **[Volley](volley/README.md)** — blobby beach volleyball, 2-on-2 or 1-on-1, for up to four
  players, bots filling any empty seat.

```
server/     Node 22 · rooms, sessions, lobby, static files, /api, /ws · one dependency (ws)
shared/     net protocol + transport, sim primitives, gfx helpers, and shared/<game>/ per game
agrav/      the AGRAV client (PWA)
volley/     the Volley client (PWA)
tools/      lint, balance, network soak, browser end-to-end, icon rendering
deploy/     systemd unit, nginx site, Ubuntu install script
```

## Run it

```sh
npm install          # installs ws (and playwright-core for the browser test)
npm start            # http://localhost:8080  → the launcher; /agrav/ and /volley/ are the games
```

Open the same URL on a phone on the same network and play yourself. Rooms are joined by a
four-letter code or from the public list on the menu; the host can add bots.

## Architecture in one paragraph

Clients send **inputs only** (`{seq, tick, bits, steer}` at 60 Hz, the last three bundled so
one lost packet costs nothing); the server simulates every room at a fixed 60 Hz and sends a
binary snapshot 30 times a second to each player, with the newest input it saw and how early
that input arrived. The client runs the same simulation code for its own craft
(prediction), replaces its state with the server's on every snapshot and replays the inputs
the server has not seen yet (reconciliation), blends any difference over ~100 ms, and draws
everyone else a few ticks in the past between two snapshots (interpolation). A clock
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

The room, lobby, sessions, reconnect, snapshots and bots-in-the-lobby all come for free.

## Tools

```sh
npm test                       # node --test: shared sim + server (54 tests, AGRAV + Volley)
node tools/tracklint.js        # every track: width, radius, overlap, banking, pads, jumps
node tools/balance.js          # each craft solo on each track; lap times within ±3 %
node tools/netsim.js --players 12 --rtt 80 --jitter 20 --loss 0.02
                               # headless clients over real sockets through a lossy shim
node tools/racetest.js         # two headless Chromium clients + a bot race to the results
node tools/icons.js            # re-render the PWA icons
node tools/shots.js            # screenshots of every track and craft into docs/screenshots
                               #   [outdir] [--only meridian,craft] [--times 5,15,25] [--hide water]
```

Netsim baseline on a 4-core box (12 racers, 80 ms ±20 ms RTT, 2 % loss, one lap of Neon
Meridian, server and all twelve clients in one process): server tick p95 0.44 ms,
10 KB/s down and 1.5 KB/s up per client, prediction error after reconciliation 0.00 m
median and p95, no hard corrections and no clock resyncs while racing.

## Deploy on Ubuntu

```sh
sudo bash deploy/install.sh https://github.com/mstevana/agrav.git games.example.com
sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d games.example.com
curl -s http://127.0.0.1:8080/api/health
```

`deploy/agrav.service` runs the server as a system user on `127.0.0.1:8080`;
`deploy/nginx.conf` terminates TLS, serves the static files and proxies `/api` and `/ws`.
Environment knobs: `PORT`, `HOST`, `STATIC_ROOT`, `MAX_ROOMS`, `TICK_BUDGET_MS`,
`RECONNECT_GRACE_MS`, `EMPTY_ROOM_TTL_MS`, `RATE_LIMIT_PER_SEC`, `LOG_LEVEL`.
Update with `git pull && npm install --omit=dev && systemctl restart agrav`
(a restart drops live races; do it between sessions or run a second instance on another
port and switch nginx).

## Licence

MIT. three.js r160 is vendored under `shared/vendor/` (MIT, see `THREE-LICENSE`).
