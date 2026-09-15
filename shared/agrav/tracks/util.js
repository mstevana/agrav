// Tracks are authored looking down on a map with north = +z and east = +x, so
// "a right-hander" turns toward +x when heading north. The world is right-handed
// with y up, where +x is on the LEFT of a craft heading +z; mirroring x at load
// time makes the authored layout, the comments and the bank signs all true.
export const mirrorX = (points) => points.map(p => ({ ...p, x: -p.x }));

/**
 * Rotate the control-point list so the loop starts at index i. The first
 * point is s = 0 (the start line) and the grid sits at negative s just before
 * it, so the line belongs one point INTO a straight, never at its entry.
 */
export const startAt = (points, i) => [...points.slice(i), ...points.slice(0, i)];
