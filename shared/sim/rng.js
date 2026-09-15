// ============================================================================
// Seeded RNG (mulberry32). Same sequence in Node and the browser, which is
// what lets both sides lay out a track's scenery or pick powerups identically
// from one seed.
// ============================================================================

export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  /** weighted pick: entries [{w, ...}] */
  next.weighted = (entries) => {
    let total = 0;
    for (const e of entries) total += e.w;
    let r = next() * total;
    for (const e of entries) { r -= e.w; if (r <= 0) return e; }
    return entries[entries.length - 1];
  };
  return next;
}

/** string -> 32-bit seed (FNV-1a) */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
