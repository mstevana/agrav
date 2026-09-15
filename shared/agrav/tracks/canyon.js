// ============================================================================
// SUNFALL CANYON — grand-canyon desert. A rim run, a long descent to the
// river floor, a hairpin climb back up through the strata, sand haze.
// ============================================================================

import { mirrorX, startAt } from './util.js';

const W = 28;
export default {
  id: 'canyon', name: 'SUNFALL CANYON', theme: 'canyon', width: W, laps: 3,
  lengthHint: 3200,
  points: mirrorX(startAt([
    { x: 0,    y: 60,  z: 0,    width: W + 4 },          // start on the rim
    { x: 0,    y: 60,  z: 120,  width: W + 4 },
    { x: 0,    y: 60,  z: 240,  width: W + 2 },
    { x: -40,  y: 58,  z: 400,  width: W, bank: 0.12 },   // left sweep along the rim
    { x: -160, y: 54,  z: 500,  width: W, bank: 0.18 },
    { x: -300, y: 50,  z: 480,  width: W },
    { x: -400, y: 42,  z: 380,  width: W - 2, bank: 0.2 }, // the descent begins
    { x: -420, y: 30,  z: 240,  width: W - 2 },
    { x: -400, y: 30,  z: 190,  width: W - 2, bank: 0.1 },   // the shelf, bearing left
    { x: -382, y: 32,  z: 160,  width: W - 2, bank: 0.12 },  // lip: the drop off the shelf (jump)
    { x: -345, y: 18,  z: 118,  width: W + 4, bank: 0.16 },  // landing on the lower bench, wide
    { x: -240, y: 4,   z: 60,   width: W + 2 },
    { x: -100, y: 0,   z: 20,   width: W + 4 },            // river floor straight
    { x: 80,   y: 0,   z: -20,  width: W + 4 },
    { x: 240,  y: 2,   z: -80,  width: W, bank: -0.16 },   // right along the water
    { x: 340,  y: 6,   z: -200, width: W - 2, bank: -0.28 },
    { x: 300,  y: 12,  z: -330, width: W - 6, bank: -0.3 }, // hairpin (narrow, banked)
    { x: 180,  y: 18,  z: -350, width: W - 4 },
    { x: 80,   y: 26,  z: -330, width: W - 2, bank: -0.12 }, // climbing right through the strata
    { x: 10,   y: 34,  z: -270, width: W - 2 },
    { x: -50,  y: 42,  z: -190, width: W, bank: -0.18 },     // right, still climbing
    { x: -30,  y: 50,  z: -120, width: W, bank: -0.16 },     // right onto the mesa
    { x: -12,  y: 56,  z: -80,  width: W + 4 },               // onto the start straight
    { x: 0,    y: 59,  z: -35,  width: W + 4 }
  ], 1)),
  pads: [
    { s: 180,  lanes: [-7, 0, 7] },
    { s: 520,  lanes: [-6, 6] },
    { s: 900,  lanes: [-6, 0, 6] },
    { s: 1250, lanes: [-8, 0, 8] },
    { s: 1600, lanes: [-6, 6] },
    { s: 1950, lanes: [-5, 0, 5] },
    { s: 2300, lanes: [-6, 6] },
    { s: 2550, lanes: [-7, 0, 7] }
  ],
  env: { sky: 0xffc38a, fog: 0xe8b98a, fogDensity: 0.0016, sun: 0xfff1d6, sunIntensity: 1.3, ambient: 0x8a6a50, strata: [0xc7654a, 0xe08a5c, 0xf0b07a, 0x9c4b3a, 0xd9a06e] }
};
