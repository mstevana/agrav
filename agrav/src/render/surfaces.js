// ============================================================================
// AGRAV — procedural material sets. A height field is evaluated once per
// texel, and from it come the albedo, the normal map (Sobel over the height),
// the bump map (the height itself), a roughness map and optionally an
// emissive map. Everything is a DataTexture built on the client from a seed;
// nothing is downloaded and the server knows nothing about it.
// ============================================================================

import * as THREE from 'three';
import { fbm2, ridged2, warp2, voronoi2, value2, clamp01, smoothstep } from './noise.js';
import { makeRng } from '../../../shared/sim/rng.js';

const cache = new Map();
function memo(key, f) { if (!cache.has(key)) cache.set(key, f()); return cache.get(key); }

function dataTex(data, size, { srgb = false, aniso = 4 } = {}) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
const rgb = (n) => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/**
 * Build a material set from a height function on the unit square (tiling).
 * spec: { height(u,v)→[0,1], albedo(u,v,h)→[r,g,b], roughness?(u,v,h)→[0,1],
 *         emissive?(u,v,h)→[r,g,b]|null, normalStrength?=3 }
 */
export function surfaceSet(key, size, spec) {
  return memo('set:' + key, () => {
    const n = size * size;
    const height = new Float32Array(n);
    const alb = new Uint8Array(n * 4), rgh = new Uint8Array(n * 4);
    const emi = spec.emissive ? new Uint8Array(n * 4) : null;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x, u = x / size, v = y / size;
      const h = clamp01(spec.height(u, v));
      height[i] = h;
      const c = spec.albedo(u, v, h);
      alb[i * 4] = c[0] * 255; alb[i * 4 + 1] = c[1] * 255; alb[i * 4 + 2] = c[2] * 255; alb[i * 4 + 3] = 255;
      const r = spec.roughness ? clamp01(spec.roughness(u, v, h)) : 0.9;
      rgh[i * 4] = rgh[i * 4 + 1] = rgh[i * 4 + 2] = r * 255; rgh[i * 4 + 3] = 255;
      if (emi) { const e = spec.emissive(u, v, h) || [0, 0, 0]; emi[i * 4] = e[0] * 255; emi[i * 4 + 1] = e[1] * 255; emi[i * 4 + 2] = e[2] * 255; emi[i * 4 + 3] = 255; }
    }
    return buildSet(height, alb, rgh, emi, size, spec.normalStrength ?? 3);
  });
}

/** pack height + colour arrays into the textures of a set (Sobel normal map, tiling) */
function buildSet(height, alb, rgh, emi, size, normalStrength) {
  const n = size * size;
  const nrm = new Uint8Array(n * 4), bmp = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { bmp[i * 4] = bmp[i * 4 + 1] = bmp[i * 4 + 2] = height[i] * 255; bmp[i * 4 + 3] = 255; }
  {
    const k = normalStrength * size / 128;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const H = (xx, yy) => height[((yy + size) % size) * size + ((xx + size) % size)];
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      let nx = -dx * k, ny = -dy * k, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      nrm[i] = (nx * 0.5 + 0.5) * 255; nrm[i + 1] = (ny * 0.5 + 0.5) * 255; nrm[i + 2] = (nz * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
    }
  }
  return {
    map: dataTex(alb, size, { srgb: true }), normalMap: dataTex(nrm, size), roughnessMap: dataTex(rgh, size), bumpMap: dataTex(bmp, size),
    emissiveMap: emi ? dataTex(emi, size, { srgb: true }) : null, height, size
  };
}

/**
 * A set painted on canvases (all `size` square): albedo, height (grey = 0.5),
 * roughness (grey) and optionally emissive. For liveries and other art that
 * is easier to draw than to compute per texel.
 */
export function setFromCanvases(key, size, { albedo, height, rough, emissive = null, normalStrength = 2.5 }) {
  return memo('set:' + key, () => {
    const px = (c) => c.getContext('2d').getImageData(0, 0, size, size).data;
    const alb = new Uint8Array(px(albedo)), hgt = px(height), rgh = new Uint8Array(px(rough));
    const emi = emissive ? new Uint8Array(px(emissive)) : null;
    const n = size * size, h = new Float32Array(n);
    for (let i = 0; i < n; i++) { h[i] = hgt[i * 4] / 255; alb[i * 4 + 3] = 255; rgh[i * 4 + 3] = 255; if (emi) emi[i * 4 + 3] = 255; }
    return buildSet(h, alb, rgh, emi, size, normalStrength);
  });
}

/** MeshStandardMaterial carrying a set; repeat is applied to every map */
export function standard(set, { repeat = [1, 1], bumpScale = 0.15, normalScale = 1, emissiveIntensity = 1, ...rest } = {}) {
  const maps = {};
  for (const name of ['map', 'normalMap', 'roughnessMap', 'bumpMap', 'emissiveMap']) {
    if (!set[name]) continue;
    const t = set[name].clone(); t.repeat.set(repeat[0], repeat[1]); t.needsUpdate = true;
    maps[name] = t;
  }
  const m = new THREE.MeshStandardMaterial({ ...maps, bumpScale, normalScale: new THREE.Vector2(normalScale, normalScale), roughness: 1, ...rest });
  if (maps.emissiveMap) { m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = emissiveIntensity; }
  return m;
}

/**
 * A material that blends two sets by a per-vertex `blend` attribute (0 = a,
 * 1 = b): terrain that is rock on the slopes and sand on the flats.
 */
export function blended(a, b, { repeat = [1, 1], bumpScale = 0.15, normalScale = 1, ...rest } = {}) {
  const m = standard(a, { repeat, bumpScale, normalScale, ...rest });
  const map2 = b.map.clone(), normal2 = b.normalMap.clone(), rough2 = b.roughnessMap.clone();
  for (const t of [map2, normal2, rough2]) { t.repeat.set(repeat[0], repeat[1]); t.needsUpdate = true; }
  m.onBeforeCompile = (shader) => {
    shader.uniforms.map2 = { value: map2 }; shader.uniforms.normalMap2 = { value: normal2 }; shader.uniforms.roughnessMap2 = { value: rough2 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float blend; varying float vBlend;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlend = blend;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D map2; uniform sampler2D normalMap2; uniform sampler2D roughnessMap2; varying float vBlend;')
      .replace('texture2D( map, vMapUv )', 'mix( texture2D( map, vMapUv ), texture2D( map2, vMapUv ), vBlend )')
      .replace('texture2D( normalMap, vNormalMapUv )', 'mix( texture2D( normalMap, vNormalMapUv ), texture2D( normalMap2, vNormalMapUv ), vBlend )')
      .replace('texture2D( roughnessMap, vRoughnessMapUv )', 'mix( texture2D( roughnessMap, vRoughnessMapUv ), texture2D( roughnessMap2, vRoughnessMapUv ), vBlend )');
  };
  m.customProgramCacheKey = () => 'blended';
  return m;
}

/**
 * Terrain material: two sets blended by the `blend` vertex attribute and
 * sampled triplanar in world space (a height field's planar UVs would smear
 * every cliff face). Normal maps use the whiteout blend and land in view
 * space where three's lighting expects them. `tile` is metres per texture
 * repeat; `wetBand` [y0, y1] darkens roughness below y1 (a tide line).
 */
export function triplanarBlended(a, b, { tile = 24, bumpScale = 0, normalScale = 1, wetBand = [-1e6, -1e6 + 1], ...rest } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: a.map, normalMap: a.normalMap, roughnessMap: a.roughnessMap, roughness: 1, normalScale: new THREE.Vector2(normalScale, normalScale), ...rest });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { map2: { value: b.map }, normalMap2: { value: b.normalMap }, roughnessMap2: { value: b.roughnessMap }, uvScale: { value: 1 / tile }, wetBand: { value: new THREE.Vector2(wetBand[0], wetBand[1]) } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float blend; varying float vBlend; varying vec3 vWorldPos; varying vec3 vWorldNormal;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvBlend = blend; vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D map2; uniform sampler2D normalMap2; uniform sampler2D roughnessMap2; uniform float uvScale; uniform vec2 wetBand;
varying float vBlend; varying vec3 vWorldPos; varying vec3 vWorldNormal;
vec3 triWeights(vec3 n) { vec3 w = pow(abs(n), vec3(5.0)); return w / (w.x + w.y + w.z); }
vec4 tri2(sampler2D ta, sampler2D tb, vec2 uv) { return mix(texture2D(ta, uv), texture2D(tb, uv), vBlend); }`)
      .replace('#include <map_fragment>', `
vec3 wN_ = normalize(vWorldNormal); vec3 bw_ = triWeights(wN_); vec3 p_ = vWorldPos * uvScale;
vec3 sgn_ = sign(wN_);
vec2 uvX_ = vec2(p_.z * sgn_.x, p_.y), uvY_ = vec2(p_.x * sgn_.y, p_.z), uvZ_ = vec2(p_.x * -sgn_.z, p_.y);
vec4 triDiffuse = tri2(map, map2, uvX_) * bw_.x + tri2(map, map2, uvY_) * bw_.y + tri2(map, map2, uvZ_) * bw_.z;
diffuseColor *= triDiffuse;`)
      .replace('#include <normal_fragment_maps>', `
{
  vec3 tX = tri2(normalMap, normalMap2, uvX_).xyz * 2.0 - 1.0; tX.xy *= normalScale; tX.x *= sgn_.x;
  vec3 tY = tri2(normalMap, normalMap2, uvY_).xyz * 2.0 - 1.0; tY.xy *= normalScale; tY.x *= sgn_.y;
  vec3 tZ = tri2(normalMap, normalMap2, uvZ_).xyz * 2.0 - 1.0; tZ.xy *= normalScale; tZ.x *= -sgn_.z;
  tX = vec3(tX.xy + wN_.zy, abs(tX.z) * wN_.x);
  tY = vec3(tY.xy + wN_.xz, abs(tY.z) * wN_.y);
  tZ = vec3(tZ.xy + wN_.xy, abs(tZ.z) * wN_.z);
  vec3 wn_ = normalize(tX.zyx * bw_.x + tY.xzy * bw_.y + tZ.xyz * bw_.z);
  normal = normalize((viewMatrix * vec4(wn_, 0.0)).xyz);
}`)
      .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = roughness;
{
  vec4 rr = tri2(roughnessMap, roughnessMap2, uvX_) * bw_.x + tri2(roughnessMap, roughnessMap2, uvY_) * bw_.y + tri2(roughnessMap, roughnessMap2, uvZ_) * bw_.z;
  roughnessFactor *= rr.g * mix(0.3, 1.0, smoothstep(wetBand.x, wetBand.y, vWorldPos.y));
}`);
  };
  m.customProgramCacheKey = () => 'triplanar';
  return m;
}

// ------------------------------------------------------------ presets ------

/** track: 4 m composite panels with recessed seams, grain, scuffs; wet adds puddles */
export function asphaltSet(base = 0x333948, seam = 0x1a1e28, wet = false) {
  const B = rgb(base), S = rgb(seam);
  return surfaceSet(`asphalt${base}${seam}${wet}`, 256, {
    normalStrength: 2.2,
    height(u, v) {
      const gu = u * 2 % 1, gv = v * 2 % 1;
      const seamD = Math.min(Math.min(gu, 1 - gu), Math.min(gv, 1 - gv)) * 2;   // 0 at seam
      const groove = smoothstep(0, 0.035, seamD);
      const grain = fbm2(u * 90, v * 90, { octaves: 4, seed: 4 }) * 0.08 + value2(u * 300, v * 300, 5) * 0.05;
      const puddle = wet ? smoothstep(0.15, 0.45, fbm2(u * 4 + 3, v * 4, { octaves: 3, seed: 9 })) * 0.12 : 0;
      return 0.55 * groove + 0.35 + grain - puddle;
    },
    albedo(u, v, h) {
      const gu = u * 2 % 1, gv = v * 2 % 1;
      const seamD = Math.min(Math.min(gu, 1 - gu), Math.min(gv, 1 - gv)) * 2;
      const panelTint = 0.92 + value2(Math.floor(u * 2) + 0.5, Math.floor(v * 2) + 0.5, 12) * 0.16;
      const scuff = 1 - smoothstep(0.35, 0.8, Math.abs(fbm2(u * 6, v * 30, { octaves: 3, seed: 21 }))) * 0.18;
      let c = mul(B, panelTint * scuff * (0.9 + h * 0.25));
      c = mix(S, c, smoothstep(0, 0.05, seamD));
      if (wet) { const p = smoothstep(0.15, 0.45, fbm2(u * 4 + 3, v * 4, { octaves: 3, seed: 9 })); c = mix(c, mul(c, 0.7), p); }
      return c;
    },
    roughness(u, v, h) {
      const p = wet ? smoothstep(0.15, 0.45, fbm2(u * 4 + 3, v * 4, { octaves: 3, seed: 9 })) : 0;
      return (wet ? 0.45 : 0.85) - p * 0.4 + (h - 0.5) * 0.1;
    }
  });
}

/** canyon rock: warped strata bands, cracks, ledges */
export function strataSet(colours) {
  const cols = colours.map(rgb);
  return surfaceSet('strata' + colours.join(), 512, {
    normalStrength: 2.4,
    height(u, v) {
      const w = warp2(u * 2, v * 4, 0.6, { octaves: 3, seed: 3 });
      const band = v * 6 + w * 0.7;
      const ledge = smoothstep(0.8, 1, band % 1) * 0.3;            // a step at every band top
      const cr = voronoi2(u * 4, v * 7, 8);
      const crack = smoothstep(0.02, 0.07, cr.f2 - cr.f1);          // 0 inside the crack
      const grain = fbm2(u * 30, v * 30, { octaves: 4, seed: 6 }) * 0.1;
      return 0.5 + ledge - (1 - crack) * 0.2 + grain;
    },
    albedo(u, v, h) {
      const w = warp2(u * 2, v * 4, 0.6, { octaves: 3, seed: 3 });
      const band = v * 6 + w * 0.7;
      const idx = Math.floor(band), f = band % 1;
      const c0 = cols[((idx % cols.length) + cols.length) % cols.length], c1 = cols[(((idx + 1) % cols.length) + cols.length) % cols.length];
      let c = mix(c0, c1, smoothstep(0.85, 1, f));
      const stain = fbm2(u * 4, v * 2, { octaves: 3, seed: 14 });
      c = mul(c, 0.9 + h * 0.25 + stain * 0.12);
      const cr = voronoi2(u * 4, v * 7, 8);
      c = mul(c, 0.78 + 0.22 * smoothstep(0.015, 0.06, cr.f2 - cr.f1));
      return c;
    },
    roughness: (u, v, h) => 0.95 - h * 0.1
  });
}

/** coastal rock: vertical striations, fracture planes, salt-bleached tops */
export function cliffSet(base = 0x8a7b68) {
  const B = rgb(base);
  return surfaceSet('cliff' + base, 256, {
    normalStrength: 3.5,
    height(u, v) {
      const stri = fbm2(u * 14, v * 1.6, { octaves: 4, seed: 5 }) * 0.35;
      const cr = voronoi2(u * 4, v * 3, 11);
      const plate = smoothstep(0.02, 0.09, cr.f2 - cr.f1);
      const plateH = cr.id * 0.25;
      const grain = fbm2(u * 60, v * 60, { octaves: 3, seed: 7 }) * 0.1;
      return 0.4 + stri + plate * plateH - (1 - plate) * 0.2 + grain;
    },
    albedo(u, v, h) {
      const cr = voronoi2(u * 4, v * 3, 11);
      const tint = 0.9 + cr.id * 0.3;
      let c = mul(B, tint * (0.85 + h * 0.4));
      const moss = smoothstep(0.55, 0.8, fbm2(u * 6, v * 6, { octaves: 3, seed: 19 }));
      c = mix(c, [0.4, 0.48, 0.3], moss * 0.3);
      c = mul(c, 0.72 + 0.28 * smoothstep(0.015, 0.06, cr.f2 - cr.f1));
      return c;
    },
    roughness: (u, v, h) => 0.92 - h * 0.08
  });
}

/** sand: wind ripples and pebbles */
export function sandSet(base = 0xc98a5a) {
  const B = rgb(base);
  return surfaceSet('sand' + base, 256, {
    normalStrength: 1.6,
    height(u, v) {
      const warp = fbm2(u * 2.5, v * 2.5, { octaves: 3, seed: 2 });
      const ripple = Math.sin((v * 14 + u * 3 + warp * 3.5) * Math.PI * 2) * 0.04 * (0.5 + 0.5 * fbm2(u * 4 + 7, v * 4, { octaves: 2, seed: 12 }));
      const peb = voronoi2(u * 40, v * 40, 3);
      const pebble = (1 - smoothstep(0.08, 0.22, peb.f1)) * (peb.id > 0.8 ? 0.3 : 0);
      const dune = fbm2(u * 6, v * 6, { octaves: 4, seed: 13 }) * 0.1;
      return 0.5 + ripple + pebble + dune + fbm2(u * 80, v * 80, { octaves: 2, seed: 8 }) * 0.05;
    },
    albedo(u, v, h) {
      const t = fbm2(u * 4, v * 4, { octaves: 3, seed: 15 });
      return mul(B, 0.85 + h * 0.3 + t * 0.12);
    },
    roughness: () => 1
  });
}

/** concrete: formwork panels, pits and rain streaks */
export function concreteSet(base = 0x8c8c90) {
  const B = rgb(base);
  return surfaceSet('concrete' + base, 256, {
    normalStrength: 2,
    height(u, v) {
      const gu = u * 2 % 1, gv = v * 4 % 1;
      const seam = smoothstep(0, 0.03, Math.min(gu, 1 - gu, gv, 1 - gv) * 2) * 0.3;
      const pits = (1 - smoothstep(0.05, 0.12, voronoi2(u * 30, v * 30, 4).f1)) * 0.25;
      return 0.4 + seam - pits + fbm2(u * 50, v * 50, { octaves: 3, seed: 9 }) * 0.1;
    },
    albedo(u, v, h) {
      const streak = smoothstep(0.3, 0.9, fbm2(u * 20, v * 1.5, { octaves: 3, seed: 22 })) * 0.25;
      return mul(B, 0.75 + h * 0.35 - streak);
    },
    roughness: () => 0.9
  });
}

/** riveted metal plating */
export function metalPlateSet(base = 0x5a6270) {
  const B = rgb(base);
  return surfaceSet('metal' + base, 256, {
    normalStrength: 2.5,
    height(u, v) {
      const gu = u * 2 % 1, gv = v * 2 % 1;
      const seam = smoothstep(0, 0.025, Math.min(gu, 1 - gu, gv, 1 - gv) * 2);
      // rivets along each plate edge
      const rx = Math.min(gu, 1 - gu), ry = Math.min(gv, 1 - gv);
      const onRow = (rx < 0.08 && Math.abs(((gv * 8) % 1) - 0.5) < 0.16) || (ry < 0.08 && Math.abs(((gu * 8) % 1) - 0.5) < 0.16);
      const rivet = onRow ? 0.35 : 0;
      return 0.45 + seam * 0.3 + rivet + fbm2(u * 70, v * 70, { octaves: 2, seed: 13 }) * 0.04;
    },
    albedo(u, v, h) {
      const scratch = smoothstep(0.6, 0.95, Math.abs(fbm2(u * 40, v * 3, { octaves: 2, seed: 25 }))) * 0.2;
      return mul(B, 0.7 + h * 0.5 + scratch);
    },
    roughness: (u, v, h) => 0.55 - h * 0.15
  });
}

/** tower facade: recessed window grid, mullions, lit windows on the emissive map, a neon spine */
export function facadeSet(seed, neon, cols = 8, rows = 16) {
  const rng = makeRng(seed);
  const warm = rng() < 0.5;
  const lit = []; for (let i = 0; i < cols * rows; i++) lit.push(rng() < 0.5 ? 0.4 + rng() * 0.6 : 0);
  const neonU = rng(), neonV = rng();
  const N = neon != null ? rgb(neon) : null;
  return surfaceSet(`facade${seed}${neon}`, 256, {
    normalStrength: 3,
    height(u, v) {
      const wu = u * cols % 1, wv = v * rows % 1;
      const inWin = wu > 0.12 && wu < 0.88 && wv > 0.15 && wv < 0.85;
      const glass = value2(u * 200, v * 200, 3) * 0.03;
      return inWin ? 0.3 + glass : 0.75 + fbm2(u * 60, v * 60, { octaves: 2, seed }) * 0.05;
    },
    albedo(u, v, h) {
      const wu = u * cols % 1, wv = v * rows % 1;
      const inWin = wu > 0.12 && wu < 0.88 && wv > 0.15 && wv < 0.85;
      if (inWin) return [0.05, 0.06, 0.09];
      const panel = 0.85 + value2(Math.floor(u * cols) + 0.5, Math.floor(v * rows) + 0.5, seed) * 0.3;
      return mul([0.09, 0.1, 0.14], panel);
    },
    roughness: (u, v, h) => h < 0.5 ? 0.15 : 0.7,
    emissive(u, v) {
      const cu = Math.floor(u * cols), cv = Math.floor(v * rows);
      const wu = u * cols % 1, wv = v * rows % 1;
      const inWin = wu > 0.16 && wu < 0.84 && wv > 0.2 && wv < 0.8;
      let e = [0, 0, 0];
      if (inWin) { const b = lit[cv * cols + cu]; e = warm ? [b, b * 0.8, b * 0.55] : [b * 0.6, b * 0.8, b]; }
      if (N && (Math.abs(v - neonV) < 0.012 || (neonU < 0.6 && Math.abs(u - neonU) < 0.012))) e = N;
      return e;
    }
  });
}

/** tiling water normal map (heights only used for the normal) */
export function waterSet(seed = 1) {
  return surfaceSet('water' + seed, 256, {
    normalStrength: 1.4,
    height: (u, v) => 0.5 + fbm2(u * 8, v * 8, { octaves: 4, seed }) * 0.4 + Math.sin((u * 9 + v * 4) * Math.PI * 2) * 0.08,
    albedo: () => [1, 1, 1],
    roughness: () => 0.1
  });
}

/** scrubby dry ground: cracked earth with dust */
export function scrubGroundSet(base = 0xb08a62) {
  const B = rgb(base);
  return surfaceSet('scrub' + base, 256, {
    normalStrength: 2,
    height(u, v) {
      const cr = voronoi2(u * 10, v * 10, 17);
      const crack = smoothstep(0.02, 0.08, cr.f2 - cr.f1);
      return 0.5 * crack + 0.2 + fbm2(u * 30, v * 30, { octaves: 3, seed: 18 }) * 0.12;
    },
    albedo(u, v, h) { const t = fbm2(u * 3, v * 3, { octaves: 3, seed: 27 }); return mul(B, 0.7 + h * 0.4 + t * 0.15); },
    roughness: () => 1
  });
}
