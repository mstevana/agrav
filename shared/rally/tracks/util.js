// Tracks are authored looking down on a map with north = +z and east = +x. The
// world is right-handed with y up, where +x sits on the LEFT of a car heading
// north, so mirroring x at load time makes the authored map, the comments and
// every "right-hander" in them true of the ribbon's own right-hand basis.
export const mirrorX = (points) => points.map(p => ({ ...p, x: -p.x, y: 0 }));

/** the same mirror for anything else authored in map space: obstacles, props */
export const mirrorPoint = (p) => ({ ...p, x: -p.x });

/**
 * Rotate the point list so the loop starts at index i. The first point is s = 0
 * (the start line) and the grid sits at negative s just before it, so the line
 * belongs one point INTO a straight, never at its entry.
 */
export const startAt = (points, i) => [...points.slice(i), ...points.slice(0, i)];
