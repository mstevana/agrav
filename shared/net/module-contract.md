# Game module contract

A game is an ES module at `shared/<game>/module.js` whose default export is a plain object.
The server (`server/room.js`) drives it and never imports anything else from the game;
the browser client imports the same module for prediction and decoding. Everything here is
pure JS with no DOM and no three.js.

```js
export default {
  id: 'agrav', name: 'AGRAV',
  minPlayers: 1, maxPlayers: 12,
  tickRate: 60,                 // simulation Hz
  snapshotRate: 30,             // snapshots per second to each client
  defaultOpts: { track: 'meridian', laps: 3 },
  validateOpts(opts) -> opts,   // clamp/complete host-supplied options

  createMatch(opts, seed) -> state,      // whole match state; must be JSON-free of functions
  addPlayer(state, id, profile, isBot),  // id is a small integer unique in the room
  removePlayer(state, id),
  setProfile(state, id, profile) -> profile,   // validated; lobby phase only
  publicState(state) -> {...},           // JSON for the ROOM message (picks, phase, timers)

  start(state, tick),                    // lobby -> countdown/running
  phase(state) -> u8,                    // byte placed in the snapshot header
  applyInput(state, id, input, tick),    // {bits, steer}
  botInput(state, id, tick) -> input,    // AI driver for bot players
  step(state, tick, events),             // one fixed step; events.push({...}) for reliable game events
  onDisconnect(state, id, tick), onReconnect(state, id, tick), onAbandon(state, id, tick),

  encodeSnapshot(state, forId) -> Uint8Array,
  decodeSnapshot(u8) -> {...},           // used by the client
  isOver(state) -> bool,
  results(state) -> {...}                // JSON for the RESULTS message
}
```

The server appends the module's snapshot payload after its own header
(`tick, lastInputSeq, margin, phase`) — see `shared/net/protocol.js`.
