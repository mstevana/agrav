// ============================================================================
// NEON MERIDIAN — cyberpunk city. A canyon between towers, an elevated ramp
// section, a plunge into an underpass and a fast sweep home. Rain, neon, fog.
//
// Control points are metres; y is up. Width is the full track width, bank in
// radians (positive raises the right side, so left-hand corners bank +).
// ============================================================================

import { mirrorX, startAt } from './util.js';

const W = 26;
export default {
  id: 'meridian', name: 'NEON MERIDIAN', theme: 'city', width: W, laps: 3,
  lengthHint: 2900,
  points: mirrorX(startAt([
    { x: 0,    y: 0,   z: 0,    width: W + 4 },      // start straight
    { x: 0,    y: 0,   z: 110,  width: W + 4 },
    { x: 0,    y: 0,   z: 220,  width: W + 4 },
    { x: 20,   y: 2,   z: 380,  width: W },
    { x: 90,   y: 6,   z: 470,  width: W, bank: -0.18 },   // right sweep 1
    { x: 200,  y: 8,   z: 500,  width: W, bank: -0.12 },
    { x: 320,  y: 10,  z: 470,  width: W - 2 },
    { x: 380,  y: 18,  z: 380,  width: W - 4, bank: -0.22 }, // climbing right-hander onto the ramp
    { x: 360,  y: 28,  z: 260,  width: W - 4 },
    { x: 330,  y: 33,  z: 222,  width: W - 2 },              // ramp up
    { x: 312,  y: 37,  z: 200,  width: W - 2 },              // the lip: the crest launches the craft
    { x: 285,  y: 30,  z: 166,  width: W + 2 },              // landing, wide
    { x: 250,  y: 24,  z: 120,  width: W },
    { x: 220,  y: 12,  z: 20,   width: W },
    { x: 260,  y: 4,   z: -90,  width: W, bank: 0.15 },     // left into the plaza
    { x: 350,  y: 0,   z: -170, width: W + 6 },
    { x: 470,  y: -6,  z: -190, width: W + 2, bank: 0.1 },
    { x: 560,  y: -12, z: -120, width: W - 2, bank: 0.25 },  // tight left, diving into the underpass
    { x: 560,  y: -16, z: -10,  width: W - 6 },              // underpass (narrow)
    { x: 510,  y: -14, z: 80,   width: W - 6, bank: 0.2 },   // left, climbing out
    { x: 420,  y: -8,  z: 130,  width: W - 2 },
    { x: 330,  y: -4,  z: 160,  width: W },                  // under the elevated ramp
    { x: 240,  y: -2,  z: 140,  width: W, bank: 0.12 },      // chicane: left
    { x: 170,  y: 0,   z: 70,   width: W, bank: -0.14 },     // chicane: right
    { x: 120,  y: -2,  z: -20,  width: W },
    { x: 90,   y: -4,  z: -120, width: W + 2 },
    { x: 45,   y: -2,  z: -220, width: W + 2, bank: -0.16 }, // right hairpin home
    { x: -30,  y: 0,   z: -268, width: W + 2, bank: -0.2 },
    { x: -110, y: 0,   z: -215, width: W + 2, bank: -0.2 },
    { x: -105, y: 0,   z: -140, width: W + 2, bank: -0.12 },
    { x: -50,  y: 0,   z: -95,  width: W + 4, bank: -0.06 },
    { x: 0,    y: 0,   z: -55,  width: W + 4 }
  ], 1)),
  pads: [
    { s: 150,  lanes: [-7, 0, 7] },
    { s: 480,  lanes: [-6, 6] },
    { s: 760,  lanes: [-5, 0, 5] },
    { s: 1050, lanes: [-6, 6] },
    { s: 1330, lanes: [-7, 0, 7] },
    { s: 1600, lanes: [-5, 5] },
    { s: 1900, lanes: [-6, 0, 6] },
    { s: 2200, lanes: [-6, 6] },
    { s: 2550, lanes: [-7, 0, 7] }
  ],
  env: { sky: 0x0b0d1f, fog: 0x141a3a, fogDensity: 0.0026, sun: 0x8090ff, sunIntensity: 0.35, ambient: 0x303860, neon: [0xff2d95, 0x2df1ff, 0xffe14d, 0x9d4dff] }
};
