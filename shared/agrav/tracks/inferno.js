// ============================================================================
// INFERNO BASIN — a red desert ringed by volcanoes. A causeway across a lava
// lake, a long left sweeper, a climb up a volcano's flank to a lip and a long
// jump over a lava chasm, esses through the cinder field, a wide banked loop
// round a caldera and home. Meteors, cinders and ash the whole way; the road
// itself glows like cooling lava.
//
// The jump is a ski hill, not a brow. A craft leaves the ground at the slope of
// the lip times its speed and falls at GRAVITY from there, and the landing hurts
// by how far the road's own descent misses that. A hill at one constant angle
// ties the two together -- height = impact^2 / 2g -- which is why a big jump on
// a straight slope always lands hard. So the shoulder past the lip is shallow,
// and the craft climbs away from it; the hill then steepens to meet the craft's
// own descent where it comes down, and flattens again for the outrun.
//
// Plan coordinates (mirrored on load): y up; a corner that turns clockwise
// seen from above is a right-hander and banks negative.
// ============================================================================

import { mirrorX, startAt } from './util.js';

const W = 26;
export default {
  id: 'inferno', name: 'INFERNO BASIN', theme: 'hell', width: W, laps: 3,
  lengthHint: 2700,
  points: mirrorX(startAt([
    { x: 0,    y: 18, z: 0,    width: W + 4 },              // the causeway over the lava lake
    { x: 0,    y: 18, z: 110,  width: W + 4 },
    { x: 0,    y: 18, z: 220,  width: W + 2 },
    { x: -30,  y: 20, z: 360,  width: W, bank: 0.14 },      // long left sweeper off the lake
    { x: -140, y: 24, z: 470,  width: W, bank: 0.18 },
    { x: -280, y: 30, z: 500,  width: W, bank: 0.1 },
    { x: -400, y: 40, z: 440,  width: W - 2, bank: 0.16 },  // left, climbing the volcano's flank
    { x: -470, y: 54, z: 330,  width: W - 2, bank: 0.1 },
    { x: -480, y: 64, z: 220,  width: W - 4 },              // straight up the flank
    { x: -472, y: 71, z: 148,  width: W - 4 },              // the ramp
    { x: -461, y: 78, z: 102,  width: W - 2 },              // steepening into the lip
    { x: -453, y: 82, z: 72,   width: W },                  // the lip: the jump over the lava chasm
    { x: -434, y: 76, z: 14,   width: W + 8 },              // the shoulder stays shallow: the craft climbs away from it
    { x: -404, y: 60, z: -50,  width: W + 8 },              // the landing hill rolls over and plunges
    { x: -370, y: 44, z: -95,  width: W + 6 },              // steepest where the craft comes down, so it lands square
    { x: -310, y: 40, z: -130, width: W, bank: -0.12 },     // the outrun flattens into the cinder-field esses: right
    { x: -260, y: 36, z: -220, width: W, bank: 0.14 },      // left
    { x: -170, y: 32, z: -270, width: W, bank: -0.14 },     // right
    { x: -100, y: 30, z: -350, width: W, bank: 0.12 },      // left
    { x: 0,    y: 27, z: -390, width: W, bank: 0.06 },
    { x: 110,  y: 26, z: -400, width: W, bank: 0.1 },       // the caldera: a wide banked left loop
    { x: 210,  y: 27, z: -370, width: W - 2, bank: 0.18 },
    { x: 260,  y: 29, z: -290, width: W - 4, bank: 0.28 },
    { x: 240,  y: 29, z: -200, width: W - 4, bank: 0.3 },
    { x: 170,  y: 27, z: -160, width: W - 2, bank: 0.24 },
    { x: 90,   y: 22, z: -160, width: W, bank: 0.1 },
    { x: 20,   y: 19, z: -130, width: W + 2, bank: -0.06 }, // easing right onto the causeway
    { x: 0,    y: 18, z: -70,  width: W + 4, bank: -0.06 }
  ], 1)),
  pads: [
    { s: 150,  lanes: [-7, 0, 7] },
    { s: 450,  lanes: [-6, 6] },
    { s: 750,  lanes: [-5, 0, 5] },
    { s: 1000, lanes: [-6, 6] },     // ahead of the ramp: airborne craft take no pickups
    { s: 1350, lanes: [-7, 0, 7] },
    { s: 1650, lanes: [-6, 6] },
    { s: 1950, lanes: [-5, 0, 5] },
    { s: 2250, lanes: [-6, 6] },
    { s: 2500, lanes: [-7, 0, 7] }
  ],
  env: {
    sky: 0x2a0806, fog: 0x4a1408, fogDensity: 0.0024, sun: 0xffa060, sunIntensity: 1.15, ambient: 0x6a2a1a,
    edge: 0xff7a20, curb: 0xff5a10, lamp: 0xffa040, pad: 0xffb060, deck: 0x2a1c18, metal: 0x3a2a26,
    lava: 0xff5a10, strata: [0x6a2a1e, 0x8a3a24, 0x4a1c14, 0x9a4a2c, 0x3a1810], sand: 0xa8482a
  }
};
