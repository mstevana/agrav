// ============================================================================
// AGRAV — seeded noise for procedural textures and displaced geometry. Pure
// number functions, no three.js: the same code drives canvas pixels, height
// fields and per-vertex displacement, so every client builds the same world
// from the same seeds and the server never sees any of it.
// ============================================================================

// integer hash → [0,1)
function hash(ix, iy, iz, seed) {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** value noise 2D in [0,1] */
export function value2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = fade(x - ix), fy = fade(y - iy);
  const a = hash(ix, iy, 0, seed), b = hash(ix + 1, iy, 0, seed), c = hash(ix, iy + 1, 0, seed), d = hash(ix + 1, iy + 1, 0, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

// gradient (Perlin-style) noise, output roughly [-1,1]
function grad2(ix, iy, seed, dx, dy) {
  const h = hash(ix, iy, 0, seed) * 8;
  const i = Math.floor(h);
  // 8 directions
  const gx = [1, -1, 1, -1, 1.4142, -1.4142, 0, 0][i], gy = [1, 1, -1, -1, 0, 0, 1.4142, -1.4142][i];
  return gx * dx + gy * dy;
}
export function perlin2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const dx = x - ix, dy = y - iy;
  const u = fade(dx), v = fade(dy);
  const n00 = grad2(ix, iy, seed, dx, dy), n10 = grad2(ix + 1, iy, seed, dx - 1, dy);
  const n01 = grad2(ix, iy + 1, seed, dx, dy - 1), n11 = grad2(ix + 1, iy + 1, seed, dx - 1, dy - 1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 0.7;
}
function grad3(ix, iy, iz, seed, dx, dy, dz) {
  const h = Math.floor(hash(ix, iy, iz, seed) * 12);
  const gx = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0][h], gy = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1][h], gz = [0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1][h];
  return gx * dx + gy * dy + gz * dz;
}
export function perlin3(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const dx = x - ix, dy = y - iy, dz = z - iz;
  const u = fade(dx), v = fade(dy), w = fade(dz);
  const c = (ox, oy, oz) => grad3(ix + ox, iy + oy, iz + oz, seed, dx - ox, dy - oy, dz - oz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w) * 0.9;
}

/** fractal Brownian motion, [-1,1]-ish */
export function fbm2(x, y, { octaves = 5, lacunarity = 2.02, gain = 0.5, seed = 0 } = {}) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) { sum += perlin2(x * f, y * f, seed + i * 17) * amp; norm += amp; amp *= gain; f *= lacunarity; }
  return sum / norm;
}
export function fbm3(x, y, z, { octaves = 4, lacunarity = 2.02, gain = 0.5, seed = 0 } = {}) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) { sum += perlin3(x * f, y * f, z * f, seed + i * 17) * amp; norm += amp; amp *= gain; f *= lacunarity; }
  return sum / norm;
}
/** ridged multifractal: sharp crests, [0,1] */
export function ridged2(x, y, { octaves = 5, lacunarity = 2.1, gain = 0.5, seed = 0 } = {}) {
  let sum = 0, amp = 0.5, f = 1, weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(perlin2(x * f, y * f, seed + i * 31));
    n *= n * weight;
    weight = Math.min(1, Math.max(0, n * 2));
    sum += n * amp; amp *= gain; f *= lacunarity;
  }
  return Math.min(1, sum);
}
/** domain-warped fbm: swirled bands, [-1,1] */
export function warp2(x, y, strength = 1, opts = {}) {
  const qx = fbm2(x + 1.7, y + 9.2, opts), qy = fbm2(x + 8.3, y + 2.8, opts);
  return fbm2(x + strength * qx, y + strength * qy, opts);
}
/** Worley / voronoi: {f1, f2, id} distances to nearest and second nearest feature point */
export function voronoi2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0, nx = 0, ny = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j;
    const px = cx + hash(cx, cy, 1, seed), py = cy + hash(cx, cy, 2, seed);
    const d = Math.hypot(px - x, py - y);
    if (d < f1) { f2 = f1; f1 = d; id = hash(cx, cy, 3, seed); nx = px; ny = py; } else if (d < f2) f2 = d;
  }
  // nx, ny: the nearest cell's own point, so callers can work out a direction from its centre
  return { f1, f2, id, nx, ny };
}
export const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
export const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
/** smooth minimum (polynomial) */
export const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export const smax = (a, b, k) => -smin(-a, -b, k);
