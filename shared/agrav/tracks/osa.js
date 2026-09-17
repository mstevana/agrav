// ============================================================================
// OSA REEF — a Costa Rican jungle coast. A causeway through the trees, a dive
// under the sea in a glass tunnel past a sunken city and the reef, up onto a
// mangrove beach, then a second dive into a tight three-quarter spiral (three
// right-handers in a row) that climbs until the tunnel crosses over its own
// entry, surfaces, and winds home through the jungle.
//
// Sea level is y = 0; frames below y = -2 are inside the glass tunnel.
// Plan coordinates (mirrored on load): y up; a corner that turns clockwise
// seen from above is a right-hander and banks negative.
// ============================================================================

import { mirrorX, startAt } from './util.js';

const W = 26;
const SC = { x: 190, z: -295 }, SR = 45;      // the spiral's centre and radius
const spiral = (deg, y, bank) => ({ x: SC.x + Math.cos(deg * Math.PI / 180) * SR, y, z: SC.z + Math.sin(deg * Math.PI / 180) * SR, width: W - 2, bank });

export default {
  id: 'osa', name: 'OSA REEF', theme: 'jungle', width: W, laps: 3,
  lengthHint: 2500,
  points: mirrorX(startAt([
    { x: 0,    y: 8,   z: 0,    width: W + 4 },             // the causeway
    { x: 0,    y: 8,   z: 120,  width: W + 4 },
    { x: 0,    y: 8,   z: 240,  width: W + 2 },
    { x: -40,  y: 10,  z: 400,  width: W, bank: 0.12 },     // left into the trees
    { x: -160, y: 12,  z: 500,  width: W, bank: 0.14 },
    { x: -300, y: 10,  z: 510,  width: W, bank: 0.08 },
    { x: -400, y: 4,   z: 440,  width: W, bank: 0.14 },     // left, down to the shore
    { x: -440, y: -6,  z: 330,  width: W - 2, bank: 0.06 }, // dive 1: into the glass tunnel
    { x: -445, y: -14, z: 200,  width: W - 2 },             // deep, past the sunken city
    { x: -420, y: -18, z: 90,   width: W - 2, bank: 0.1 },
    { x: -360, y: -16, z: -10,  width: W - 2, bank: 0.12 }, // left along the reef
    { x: -280, y: -10, z: -80,  width: W, bank: 0.08 },
    { x: -190, y: -2,  z: -130, width: W + 2 },             // surfacing
    { x: -100, y: 3,   z: -170, width: W + 2 },             // the mangrove beach
    { x: -10,  y: 0,   z: -215, width: W, bank: -0.06 },
    { x: 70,   y: -8,  z: -240, width: W },                 // dive 2: down into the sea, lining up with the spiral
    { x: 125,  y: -19, z: -249, width: W - 1 },
    { x: 165,  y: -27, z: -250, width: W - 2 },
    { x: 190,  y: -30, z: -250, width: W - 2 },             // the spiral's entry, deep
    spiral(60,  -28.5, -0.1),                               // three right-handers in a row, climbing…
    spiral(30,  -26, -0.16),
    spiral(0,   -23, -0.2),
    spiral(-30, -20, -0.2),
    spiral(-60, -17, -0.2),
    spiral(-90, -14, -0.2),
    spiral(-120, -11, -0.2),
    spiral(-150, -8, -0.16),
    spiral(-180, -5.5, -0.1),
    { x: SC.x - SR, y: -4,   z: -272, width: W - 1 },
    { x: SC.x - SR, y: -2.5, z: -250, width: W },           // …and over its own entry, still under the glass
    { x: 141,  y: -1.5, z: -228, width: W + 1, bank: 0.04 },
    { x: 133,  y: -0.5, z: -205, width: W + 2, bank: 0.08 }, // surfacing into a left arc through the jungle…
    { x: 107,  y: 2,   z: -176, width: W + 2, bank: 0.12 },
    { x: 73,   y: 4.5, z: -162, width: W + 2, bank: 0.06 },
    { x: 39,   y: 6.5, z: -148, width: W + 2, bank: -0.08 }, // …and a right arc onto the causeway
    { x: 13,   y: 7.5, z: -119, width: W + 4, bank: -0.1 },
    { x: 1,    y: 8,   z: -74,  width: W + 4, bank: -0.04 }
  ], 1)),
  pads: [
    { s: 150,  lanes: [-7, 0, 7] },
    { s: 470,  lanes: [-6, 6] },
    { s: 760,  lanes: [-5, 0, 5] },
    { s: 1050, lanes: [-6, 6] },
    { s: 1350, lanes: [-7, 0, 7] },
    { s: 1650, lanes: [-5, 5] },
    { s: 1950, lanes: [-6, 0, 6] },
    { s: 2200, lanes: [-6, 6] },
    { s: 2380, lanes: [-7, 0, 7] }
  ],
  env: {
    sky: 0x7fb8e8, fog: 0x9fd0c8, fogDensity: 0.0022, sun: 0xfff2d0, sunIntensity: 1.2, ambient: 0x5a7a60,
    surface: 0x6a6e66, seam: 0x3a3f3a, wet: true, edge: 0x3aff9a, curb: 0xffe070, lamp: 0xfff6e0, pad: 0x3aff9a, deck: 0x7a7a72, metal: 0x4a505c,
    sea: 0x0e4f6e, foam: 0xf0fff8, sand: 0xe8d8b0, cliff: 0x5a5e4a,
    underwater: { fog: 0x0b3a52, density: 0.012, sky: 0x08304a }
  }
};
