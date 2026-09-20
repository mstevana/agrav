// ============================================================================
// RIDGE — a pass cut into the side of a mountain. The hard one: narrow, with a
// drop on one side for most of the lap, two chicanes where the road threads
// between fallen rock, and a blind crest on the descent where the next corner
// is not visible until you are in it.
//
// Nothing here is fast except the one straight along the valley floor, and
// that is where everyone spends their nitro and their ammunition.
// ============================================================================

import { mirrorX } from './util.js';

const W = 18;

export default {
  id: 'ridge', name: 'Ridge', theme: 'ridge',
  width: W, laps: 3, prize: 1.6,
  blurb: 'A narrow pass with a long way down on one side. Bring the handling.',

  points: mirrorX([
    { x:    0, z:  340, width: W + 5 },   // start line, along the top of the pass
    { x:  110, z:  330, width: W + 5 },
    { x:  216, z:  292 },
    { x:  300, z:  216 },                 // over the shoulder and down the east face
    { x:  336, z:  126 },
    { x:  312, z:   54, width: W - 1 },   // first chicane: the road threads the rockfall
    { x:  348, z:   -6, width: W - 1 },
    { x:  330, z:  -86 },
    { x:  268, z: -168 },                 // the long left round the head of the valley
    { x:  168, z: -232 },
    { x:   52, z: -258 },
    { x:  -68, z: -244 },
    { x: -176, z: -190 },
    { x: -248, z: -102 },                 // and up the west face, with the drop on your right
    { x: -262, z:  -14, width: W - 1 },   // second chicane, blind over the crest
    { x: -226, z:   56, width: W - 1 },
    { x: -262, z:  124, width: W - 1 },
    { x: -248, z:  206 },
    { x: -186, z:  278 },
    { x: -100, z:  326 }
  ]),

  obstacles: [
    { s:  500, t:  7.0, r: 2.2, kind: 'rock' },     // in the first chicane, east face
    { s:  580, t: -6.8, r: 2.2, kind: 'rock' },
    { s: 1460, t:  7.0, r: 2.2, kind: 'rock' },     // and in the blind one on the west
    { s: 1600, t: -6.7, r: 2.2, kind: 'rock' }
  ],

  pads: [
    { s:   90, t: -6, item: 'nitro' },
    { s:   90, t:  6, item: 'ammo' },
    { s:  340, t:  0, item: 'ammo' },
    { s:  700, t: -6, item: 'repair' },
    { s:  950, t:  6, item: 'ammo' },
    { s: 1180, t:  0, item: 'nitro' },
    { s: 1340, t: -6, item: 'repair' },
    { s: 1760, t:  6, item: 'ammo' },
    { s: 1900, t:  0, item: 'ammo' }
  ]
};
