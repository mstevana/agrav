// Tracks are authored looking down on a map with north = +z and east = +x, so
// "a right-hander" turns toward +x when heading north. The world is right-handed
// with y up, where +x is on the LEFT of a craft heading +z; mirroring x at load
// time makes the authored layout, the comments and the bank signs all true.
export const mirrorX = (points) => points.map(p => ({ ...p, x: -p.x }));
