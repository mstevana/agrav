# AGRAV

Anti-gravity combat racing for up to twelve players, in the browser.

## Race

Create a race (you become the host) or join one by code or from the public list. The host
picks the track and the lap count, can add bots and starts once everyone is ready. Three
laps by default. **Zero health eliminates you**: the craft explodes and you spectate
(tap or click to follow another racer) until the race ends. A race ends when every
surviving craft has finished, or 45 seconds after the first one did. Finished craft keep
driving a cool-down lap. Results rank finishers by time, then everyone else by distance.

| Keyboard | Gamepad | Touch |
|---|---|---|
| ← → or A D steer | left stick / d-pad | drag left/right in the steering zone (or tilt, in settings) |
| ↑ / W throttle · ↓ / S brake | A or RT throttle · LT brake | automatic throttle · BRK button |
| Q / E airbrakes | LB / RB | AIR L / AIR R |
| space fire | X or B | FIRE |

Airbrakes tighten a turn and bleed speed; you need them for the hairpins. Hands off the
stick and the craft settles back along the track, but it never steers a bend for you.
Walls scrape health away; hit one hard and you lose speed and armour. A crest that falls
away faster than gravity launches you.

## Craft

| | Speed | Accel | Turn | Damage | Armour |
|---|---|---|---|---|---|
| **Kestrel** | + | − | − | − | − |
| **Talon** | | ++ | | | − |
| **Vantage** | − | | ++ | | − |
| **Bulwark** | − | − | | | ++ |
| **Reaper** | | | − | ++ | |
| **Corsair** | the honest choice | | | | |

`tools/balance.js` keeps every craft's solo lap time within 3 % of the others on every track.

## Tracks

- **Neon Meridian** — night city: a canyon between towers, a climb onto an elevated ramp
  with a jump, a plunge into an underpass, a chicane under the ramp, a hairpin home.
- **Sunfall Canyon** — desert: a rim run, a drop off a shelf onto the river floor, a
  banked hairpin, a climb back through the strata.
- **Cape Vanta** — coastal cliffs: cliff-edge sweepers, a tunnel through the headland, a
  jump across the cove, a chicane on the beach, a long sweep round the south point.

## Items

Pads on the track hand out one item; drive over one while holding nothing. Trailing racers
get better odds of missiles and shields, leaders of mines and the minigun.

| Item | |
|---|---|
| Rockets ×3 | fast and straight; hold fire for the burst |
| Missile | locks the nearest craft ahead and homes; a shield absorbs it |
| Minigun | two seconds of hitscan, lag-compensated |
| Mines ×3 | dropped behind you; arm after half a second; live 30 s |
| Repair | +40 health |
| Shield | 5 s of invulnerability |
| Turbo | 3 s at +35 % top speed |

## Screenshots

Rendered by `node tools/shots.js` (headless Chromium, software GL, so the frame counter
in the corner reads low; a real GPU runs the same scene at 60 fps).

| Neon Meridian | Sunfall Canyon | Cape Vanta |
|---|---|---|
| ![](../docs/screenshots/meridian-1.png) | ![](../docs/screenshots/canyon-1.png) | ![](../docs/screenshots/vanta-1.png) |
| ![](../docs/screenshots/meridian-2.png) | ![](../docs/screenshots/canyon-2.png) | ![](../docs/screenshots/vanta-2.png) |
| ![](../docs/screenshots/meridian-3.png) | ![](../docs/screenshots/canyon-3.png) | ![](../docs/screenshots/vanta-3.png) |

| Kestrel | Talon | Vantage |
|---|---|---|
| ![](../docs/screenshots/craft-kestrel.png) | ![](../docs/screenshots/craft-talon.png) | ![](../docs/screenshots/craft-vantage.png) |

| Bulwark | Reaper | Corsair |
|---|---|---|
| ![](../docs/screenshots/craft-bulwark.png) | ![](../docs/screenshots/craft-reaper.png) | ![](../docs/screenshots/craft-corsair.png) |

![The grid](../docs/screenshots/craft-all.png)

## Files

```
index.html          screens + CSS          src/net.js        prediction, reconciliation, interpolation
src/main.js         wiring, camera, loop   src/input.js      keyboard / gamepad / touch
src/hud.js          race HUD, minimap      src/audio.js      synthesized engines, weapons, music
src/render/         track ribbon, craft meshes, effects, procedural textures, three environments
../shared/agrav/    the simulation the server runs (module.js, sim/, tracks/, vehicles.js, bot.js)
```

Add `?lite=1` to the URL for a scenery-free, bloom-free client (weak devices, headless tests).
