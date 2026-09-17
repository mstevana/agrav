// ============================================================================
// MARE SELENE — a lunar mare under the Milky Way. A sweep along a crater rim,
// a long straight into a full loop-the-loop, a descent through the boulder
// field, a chicane past the moon base and home. No air, no haze: hard sun,
// black shadows, sharp rock.
//
// The loop is a one-turn helix: `loop: 1` on its control points gives those
// frames a parallel-transported basis so the road inverts cleanly. Its
// approach and exit are already angled by the helix's lateral drift so the
// heading never jogs at the joins.
//
// Plan coordinates (mirrored on load): y up; a corner that turns clockwise
// seen from above is a right-hander and banks negative.
// ============================================================================

import { mirrorX, startAt } from './util.js';

const W = 26;
const R = 50, PITCH = 42, N = 12;           // loop radius, lateral shift over one turn, control points round it
const X0 = 440, Z0 = 60, Y0 = 10;           // where the loop starts (heading -z)
const DRIFT = PITCH / (2 * Math.PI * R);    // lateral metres per metre of arc
const helix = [];
for (let k = 0; k <= N; k++) {
  const a = k / N * Math.PI * 2;
  helix.push({ x: X0 + PITCH * k / N, y: Y0 + R * (1 - Math.cos(a)), z: Z0 - R * Math.sin(a), width: W, loop: 1 });
}
const X1 = X0 + PITCH;

export default {
  id: 'selene', name: 'MARE SELENE', theme: 'moon', width: W, laps: 3,
  lengthHint: 2750,
  points: mirrorX(startAt([
    { x: 0,    y: 10, z: 0,    width: W + 4 },              // start on the mare
    { x: 0,    y: 10, z: 120,  width: W + 4 },
    { x: 0,    y: 10, z: 240,  width: W + 2 },
    { x: 30,   y: 12, z: 380,  width: W, bank: -0.14 },     // right, along the crater rim
    { x: 130,  y: 16, z: 460,  width: W, bank: -0.16 },
    { x: 250,  y: 18, z: 470,  width: W, bank: -0.08 },
    { x: 360,  y: 16, z: 420,  width: W, bank: -0.12 },
    { x: 400,  y: 14, z: 360,  width: W, bank: -0.1 },      // right onto the long straight
    { x: X0 - DRIFT * 220, y: 12, z: Z0 + 220, width: W + 2 },
    { x: X0 - DRIFT * 80,  y: Y0, z: Z0 + 80,  width: W + 2 },   // the approach
    ...helix,                                               // the loop-the-loop
    { x: X1 + DRIFT * 80,  y: Y0, z: Z0 - 80,  width: W + 2 },   // the exit
    { x: X1 + DRIFT * 200, y: 10, z: Z0 - 200, width: W + 2, bank: -0.08 },
    { x: 470,  y: 8,  z: -260, width: W, bank: -0.12 },     // right, dropping into the boulder field
    { x: 380,  y: 4,  z: -340, width: W, bank: -0.1 },
    { x: 270,  y: 2,  z: -360, width: W, bank: -0.12 },     // esses: right
    { x: 170,  y: 0,  z: -320, width: W, bank: 0.12 },      // left
    { x: 80,   y: 0,  z: -340, width: W, bank: -0.1 },      // right
    { x: 0,    y: 2,  z: -320, width: W, bank: -0.1 },      // past the base: a right arc…
    { x: -58,  y: 4,  z: -299, width: W, bank: -0.16 },
    { x: -89,  y: 6,  z: -246, width: W, bank: -0.16 },
    { x: -78,  y: 8,  z: -185, width: W, bank: -0.14 },
    { x: -45,  y: 9,  z: -152, width: W + 2, bank: -0.06 },
    { x: -21,  y: 10, z: -132, width: W + 2, bank: 0.04 },  // …then a gentle left onto the start straight
    { x: -5,   y: 10, z: -105, width: W + 4, bank: 0.06 },
    { x: 0,    y: 10, z: -74,  width: W + 4, bank: 0.02 }
  ], 1)),
  pads: [
    { s: 150,  lanes: [-7, 0, 7] },
    { s: 480,  lanes: [-6, 6] },
    { s: 760,  lanes: [-5, 0, 5] },
    { s: 1550, lanes: [-6, 6] },
    { s: 1850, lanes: [-7, 0, 7] },
    { s: 2150, lanes: [-5, 5] },
    { s: 2450, lanes: [-6, 0, 6] },
    { s: 2650, lanes: [-6, 6] }
  ],
  env: {
    sky: 0x000004, fog: 0x000006, fogDensity: 0.00004, sun: 0xffffff, sunIntensity: 1.35, ambient: 0x0c0c14,
    surface: 0x3a3a40, seam: 0x1c1c22, edge: 0x8ad8ff, curb: 0xdfefff, lamp: 0xeaf4ff, pad: 0x8ad8ff, deck: 0x55555c, metal: 0x6a6e78,
    regolith: 0x8a8a90, rock: 0x6e6e74
  }
};
