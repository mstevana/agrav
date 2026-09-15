# shared/volley

The Volley simulation: pure, deterministic JavaScript with no DOM, imported unchanged by the
server (`server/room.js` drives `module.js`) and by the browser client (for prediction and
snapshot decoding). It implements the contract in
[`../net/module-contract.md`](../net/module-contract.md).

```
module.js      the game-module contract: createMatch/addPlayer/step/encodeSnapshot/...
sim.js         the physics: createState(opts), step(state, inputs), stepBlob(blob, input)
bot.js         createBot(slot,{difficulty,seed}) -> {think(state)}; predicts the ball and jumps to it
constants.js   field geometry, physics tuning, tick/snapshot rates, the phase enum
snapshot.js    the ~40-byte binary snapshot: ball, four blobs, score, touch state
```

## The court

Always 2 vs 2, four blob seats laid left to right, ids `0..3` = blob slots:

```
| 0 Blue back | 1 Blue front |net| 2 Red front | 3 Red back |
0            200            400            600            800   (field units, y up, ground at 0)
```

Each seat owns a movement zone and cannot leave it, so blobs never touch each other or the net.
The server assigns ids in join order and passes them to `addPlayer`; a player's id is its slot.

## How it drives

`step(state, tick, events)` builds one move per seat — the human's if a connected human holds
it, otherwise the seat's bot brain — runs the deterministic `sim.step`, and pushes a reliable
event when a point is scored or the match ends. Any seat without a connected human (an empty
seat, a lobby bot, or a disconnected player) is bot-driven, which is how one player can start
alone against three bots. Movement input on the wire is `{bits, steer}`: `steer` −1/+1 moves
left/right, bit 0 jumps.

## Physics

A blob is two stacked circles. The ball leaves a blob at a fixed speed along the contact
normal (body-to-ball), like the original Blobby Volley, so aim comes from where the ball meets
the blob. The ball bounces off the side walls, the ceiling and the net. Three touches per team;
a fourth is a fault. Gravity, speeds and restitutions live in `constants.js`.

## Tuning

```sh
node tools/volleysim.js 15 2 hard      # a headless bots-vs-bots match: [pointsToWin] [teamSize] [difficulty...]
```
