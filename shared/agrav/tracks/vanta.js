// ============================================================================
// CAPE VANTA — coastal cliffs. Cliff-edge sweepers over the sea, a tunnel
// through the headland, a jump across a cove, late-afternoon light and spray.
// ============================================================================

import { mirrorX } from './util.js';

const W = 26;
export default {
  id: 'vanta', name: 'CAPE VANTA', theme: 'coast', width: W, laps: 3,
  lengthHint: 2700,
  points: mirrorX([
    { x: 0,    y: 30, z: 0,    width: W + 4 },            // start along the cliff top
    { x: 0,    y: 30, z: 100,  width: W + 4 },
    { x: 0,    y: 30, z: 200,  width: W + 2 },
    { x: 30,   y: 28, z: 330,  width: W, bank: -0.16 },    // right sweep, sea on the left
    { x: 130,  y: 24, z: 400,  width: W, bank: -0.2 },
    { x: 260,  y: 22, z: 380,  width: W - 2 },
    { x: 340,  y: 26, z: 290,  width: W - 4, bank: -0.24 }, // tight right climbing to the headland
    { x: 340,  y: 34, z: 180,  width: W - 8 },              // tunnel entrance (narrow)
    { x: 300,  y: 36, z: 90,   width: W - 8, bank: -0.1 },  // inside the tunnel, gentle right
    { x: 230,  y: 34, z: 20,   width: W - 4 },
    { x: 200,  y: 26, z: -80,  width: W },                  // out into the light, dropping
    { x: 230,  y: 18, z: -190, width: W, bank: 0.15 },      // left toward the cove
    { x: 320,  y: 14, z: -260, width: W + 2 },
    { x: 430,  y: 16, z: -240, width: W, bank: 0.22 },      // left onto the ramp
    { x: 472,  y: 22, z: -175, width: W - 2, bank: 0.1 },   // ramp
    { x: 484,  y: 27, z: -140, width: W - 2 },              // lip: the jump over the cove
    { x: 476,  y: 14, z: -80,  width: W + 6 },              // landing zone (wide)
    { x: 460,  y: 11, z: -30,  width: W + 4 },
    { x: 420,  y: 10, z: 40,   width: W + 2, bank: 0.18 },  // left, low along the beach
    { x: 320,  y: 8,  z: 60,   width: W },
    { x: 220,  y: 10, z: 0,    width: W, bank: 0.14 },      // chicane: left
    { x: 150,  y: 14, z: -80,  width: W, bank: -0.14 },     // chicane: right
    { x: 80,   y: 18, z: -170, width: W },
    { x: 20,   y: 22, z: -260, width: W, bank: -0.1 },      // long right sweep round the south point
    { x: -60,  y: 25, z: -300, width: W, bank: -0.2 },
    { x: -140, y: 27, z: -250, width: W, bank: -0.2 },
    { x: -140, y: 29, z: -160, width: W + 2 },
    { x: -95,  y: 30, z: -95,  width: W + 2, bank: -0.12 }, // right onto the cliff top
    { x: -45,  y: 30, z: -40,  width: W + 4 }
  ]),
  pads: [
    { s: 160,  lanes: [-7, 0, 7] },
    { s: 470,  lanes: [-6, 6] },
    { s: 780,  lanes: [-4, 0, 4] },
    { s: 1080, lanes: [-6, 6] },
    { s: 1380, lanes: [-7, 0, 7] },
    { s: 1650, lanes: [-6, 6] },
    { s: 1950, lanes: [-6, 0, 6] },
    { s: 2250, lanes: [-6, 6] },
    { s: 2550, lanes: [-7, 0, 7] },
    { s: 2760, lanes: [-6, 6] }
  ],
  env: { sky: 0x9fc9ff, fog: 0xc9dcf0, fogDensity: 0.0012, sun: 0xffd9a0, sunIntensity: 1.15, ambient: 0x6d86a8, sea: 0x1e5f8a, foam: 0xeaf6ff, cliff: 0x8a7b68 }
};
