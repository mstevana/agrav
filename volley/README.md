# Volley

Blobby 2-on-2 beach volleyball for up to four players, in the browser. The second game on
the AGRAV games platform, sharing its server, lobby, netcode and reconnect for free.

## Play

Create a room (you become the host) or join one by four-letter code or from the public list.
Pick a mode on the menu:

- **2 vs 2** — two Blue seats on the left, two Red on the right, each split into a back and a
  front zone (up to four players).
- **1 vs 1** — one blob per side, each owning a whole half (up to two players).

Each player owns their zone and cannot leave it, so blobs never collide with each other or
the net.

The host readies up and starts. **Empty seats and lobby bots play as bots**, so one player
can start alone and get three bots; the host can also add bots to fill the court, and a
player who drops mid-match is replaced by a bot so the game goes on.

Rules: the ball must not land on your side; three touches per team, a fourth is a fault; the
team that won the last point serves. First to the target score (default 15) by two wins. The
ball bounces off the walls, the ceiling and the net. A blob has no hands: the ball leaves it
at a fixed speed along the line from the body to the ball, so where it meets your head aims
the shot. Blobs squash and stretch as they jump, land and strike the ball.

| Keyboard | Gamepad | Touch |
|---|---|---|
| ← → or A D move | left stick / d-pad | on-screen ◀ ▶ |
| ↑ / W / Space jump (hold to jump higher) | A / RT / up | ▲ |

## Files

```
index.html        screens + CSS            src/net.js     prediction, reconciliation, interpolation
src/main.js       menu/lobby wiring, loop  src/input.js   keyboard / gamepad / touch -> {bits, steer}
src/render.js     Canvas 2D scene + squash-and-stretch
../shared/volley/ the simulation the server runs (module.js, sim.js, bot.js, constants.js, snapshot.js)
```

The client imports the same `shared/volley/` modules the server runs, so its prediction of the
local blob is bit-for-bit the server's simulation. See
[`../shared/net/module-contract.md`](../shared/net/module-contract.md) for how the game plugs
into the platform.
