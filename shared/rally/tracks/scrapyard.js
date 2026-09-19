// ============================================================================
// SCRAPYARD — a circuit beaten into a junkyard between stacks of dead cars.
// The easy one: wide, forgiving, two long straights worth a nitro charge, one
// proper hairpin at the bottom of the map and a lazy chicane through the middle
// of the yard where the crusher stands.
//
// Control points are metres in map space (x east, z north); y is flat. Width is
// the full road width. Obstacles are static circles the cars bounce off.
// ============================================================================

import { mirrorX } from './util.js';

const W = 22;

export default {
  id: 'scrapyard', name: 'Scrapyard', theme: 'scrapyard',
  width: W, laps: 3, prize: 1.0,
  blurb: 'Rust, oil and two long straights. The one where nobody has an excuse.',

  points: mirrorX([
    { x:   0, z:    0, width: W + 6 },   // start line, heading north up the main straight
    { x:   0, z:   95, width: W + 6 },
    { x:   2, z:  190, width: W + 4 },
    { x:  18, z:  252 },                 // turn 1: opening right-hander
    { x:  68, z:  296 },
    { x: 140, z:  308 },
    { x: 206, z:  288 },                 // long right sweep across the top
    { x: 248, z:  238 },
    { x: 256, z:  178 },                 // now heading south down the far side
    { x: 236, z:  126 },
    { x: 192, z:  100, width: W - 2 },   // into the yard: chicane left
    { x: 140, z:  104, width: W - 2 },
    { x: 100, z:   74, width: W - 2 },   // chicane right, past the crusher
    { x:  88, z:   22 },
    { x: 104, z:  -34 },                 // out of the yard, opening onto the bottom straight
    { x: 150, z:  -72 },
    { x: 212, z:  -88 },                 // bottom straight, heading east
    { x: 262, z: -116 },                 // hairpin entry
    { x: 272, z: -166 },
    { x: 236, z: -198, width: W + 2 },   // the hairpin itself
    { x: 184, z: -188, width: W + 2 },
    { x: 158, z: -146 },                 // out of it, heading back west
    { x: 110, z: -120 },
    { x:  46, z: -110 },
    { x:  -6, z:  -96 },                 // the run back to the line
    { x:  -8, z:  -48 }
  ]),

  /**
   * Static circles the cars bounce off, placed along the road like the pads:
   * s is metres round the centreline, t is metres to the driver's right. Each
   * one eats a chunk of one side and leaves the other side open — tools/rallylint.js
   * refuses a track where an obstacle leaves no lane worth the name.
   */
  obstacles: [
    { s:  310, t: -7.0, r: 3.2, kind: 'stack' },    // a car stack on the outside of turn 1's exit
    { s:  755, t:  6.0, r: 3.0, kind: 'crusher' },  // the crusher, tightening the chicane
    { s: 1210, t: -8.0, r: 3.0, kind: 'drums' },    // drums on the inside of the hairpin
    { s: 1414, t:  7.0, r: 2.6, kind: 'stack' }     // one more on the run home
  ],

  /** pickup pads: s is metres along the centreline, t is metres right of it */
  pads: [
    { s: 120, t: -6, item: 'ammo' },
    { s: 120, t:  6, item: 'ammo' },
    { s: 330, t:  0, item: 'nitro' },
    { s: 520, t: -7, item: 'repair' },
    { s: 660, t:  7, item: 'ammo' },
    { s: 780, t:  0, item: 'nitro' },
    { s: 940, t: -6, item: 'repair' },
    { s: 940, t:  6, item: 'ammo' }
  ]
};
