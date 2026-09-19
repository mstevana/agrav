// ============================================================================
// HARBOUR — the container docks, after dark. A paperclip: a long quay straight
// up one side, a fast open sweep round the north basin, then the return leg
// down between the stacks, where a chicane has been left between two rows of
// containers. The south end is a tight hairpin round the end of the wharf.
//
// Faster than the Scrapyard and less forgiving: the walls are closer and the
// two ends ask completely different questions.
// ============================================================================

import { mirrorX } from './util.js';

const W = 20;

export default {
  id: 'harbour', name: 'Harbour', theme: 'harbour',
  width: W, laps: 3, prize: 1.3,
  blurb: 'Cranes, containers and black water. Quick, and the walls are close.',

  points: mirrorX([
    { x:   0, z:  -60, width: W + 6 },   // start line, up the quay
    { x:   0, z:   40, width: W + 6 },
    { x:   0, z:  150 },
    { x:   0, z:  260 },
    { x:   6, z:  330 },                 // turn 1: the long open sweep round the basin
    { x:  40, z:  396, width: W + 2 },
    { x: 104, z:  434, width: W + 2 },
    { x: 186, z:  438, width: W + 2 },
    { x: 252, z:  412 },
    { x: 292, z:  356 },
    { x: 300, z:  290 },                 // heading south down the stacks
    { x: 300, z:  210 },
    { x: 268, z:  168, width: W - 1 },   // chicane: left between the rows
    { x: 264, z:  120, width: W - 1 },
    { x: 300, z:   84, width: W - 1 },   // and right again, back onto the line
    { x: 302, z:   20 },
    { x: 300, z:  -40 },
    { x: 286, z: -104 },                 // the hairpin round the end of the wharf
    { x: 238, z: -148, width: W + 3 },
    { x: 176, z: -154, width: W + 3 },
    { x: 118, z: -136 },
    { x:  58, z: -120 },
    { x:  14, z: -104 }
  ]),

  obstacles: [
    { s:  660, t:  8.5, r: 2.8, kind: 'container' },   // narrowing the basin exit
    { s:  980, t: -7.5, r: 2.4, kind: 'container' },   // the chicane's first stack
    { s: 1060, t:  7.5, r: 2.4, kind: 'container' },   // and its second
    { s: 1400, t: -9.4, r: 2.6, kind: 'bollard' }      // on the inside of the hairpin
  ],

  pads: [
    { s:  110, t: -6, item: 'ammo' },
    { s:  110, t:  6, item: 'nitro' },
    { s:  420, t:  0, item: 'repair' },
    { s:  600, t: -7, item: 'ammo' },
    { s:  820, t:  7, item: 'nitro' },
    { s: 1160, t:  0, item: 'ammo' },
    { s: 1300, t: -6, item: 'repair' },
    { s: 1500, t:  6, item: 'ammo' }
  ]
};
