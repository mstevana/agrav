// ============================================================================
// AGRAV — shader materials for shields and weapons. Shields are hex-cell
// energy skins with a fresnel rim, a scanning band and a ripple where a hit
// lands. Projectiles are bolts: a white core inside a coloured halo with
// streaks, trailing a fading ribbon. Explosions are noise-eroded fireballs
// with a shock ring. Everything is additive and unlit.
// ============================================================================

import * as THREE from 'three';

const NOISE = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
// distance to the nearest hex-cell edge, 0 on the edge, in a unit hex grid
float hexEdge(vec2 p) { p = abs(p); float c = dot(p, normalize(vec2(1.0, 1.7320508))); c = max(c, p.x); return abs(fract(c) - 0.5) * 2.0; }`;

const VIEW_VERT = `
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec2 vUv;
void main() { vUv = uv; vP = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;

function mat(frag, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({ vertexShader: VIEW_VERT, fragmentShader: frag, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...extra });
}

// ---------------------------------------------------------------- shield --
const SHIELD_FRAG = `
uniform vec3 color; uniform float time; uniform vec3 hit; uniform float hitT;
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec2 vUv;
${NOISE}
void main() {
  vec3 n = normalize(vN), p = normalize(vP);
  float fres = pow(1.0 - abs(dot(n, normalize(vV))), 2.4);
  // hex cells in a cylindrical wrap round the bubble
  vec2 hc = vec2(atan(p.z, p.x) * 3.2, p.y * 6.0 + 0.5);
  float edge = 1.0 - smoothstep(0.0, 0.14, hexEdge(hc));
  float cell = 0.35 + 0.65 * vnoise(floor(hc * 2.0) + time * 0.3);
  // a band that sweeps down the bubble
  float band = smoothstep(0.08, 0.0, abs(fract(time * 0.6) * 2.4 - 1.2 - p.y));
  // ripple ring spreading from the hit point
  float d = acos(clamp(dot(p, normalize(hit)), -1.0, 1.0));
  float ring = exp(-pow((d - hitT * 2.8) * 6.0, 2.0)) * (1.0 - hitT) * step(0.001, hitT);
  float a = fres * 0.9 + edge * 0.18 * cell + band * 0.25 + ring * 1.4;
  vec3 col = mix(color, vec3(1.0), ring * 0.8 + fres * 0.25);
  gl_FragColor = vec4(col * a * 1.5, a);
}`;
export function shieldMaterial(colour = 0x2df1ff) {
  return mat(SHIELD_FRAG, { color: { value: new THREE.Color(colour) }, time: { value: 0 }, hit: { value: new THREE.Vector3(0, 0, -1) }, hitT: { value: 0 } }, { side: THREE.DoubleSide });
}

// ------------------------------------------------------------------ bolt --
const BOLT_FRAG = `
uniform vec3 color; uniform float time; uniform float fade;
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec2 vUv;
${NOISE}
void main() {
  float rim = abs(dot(normalize(vN), normalize(vV)));
  // streaks racing back along the bolt
  float streak = 0.6 + 0.4 * vnoise(vec2(vUv.x * 9.0, vUv.y * 4.0 - time * 12.0));
  float core = pow(rim, 3.0);
  float a = (0.35 + 0.65 * rim) * streak * fade;
  vec3 col = mix(color, vec3(1.0, 0.98, 0.94), core);
  gl_FragColor = vec4(col * a * 2.2, a);
}`;
export function boltMaterial(colour) { return mat(BOLT_FRAG, { color: { value: new THREE.Color(colour) }, time: { value: 0 }, fade: { value: 1 } }); }

// ------------------------------------------------------------------ trail --
const TRAIL_FRAG = `
uniform vec3 color; uniform float time; uniform float fade;
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec2 vUv;
${NOISE}
void main() {
  float along = vUv.y;                                  // 0 at the projectile, 1 at the tail
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float wisps = 0.55 + 0.45 * fbm(vec2(vUv.x * 3.0, along * 5.0 - time * 9.0));
  float a = pow(across, 1.6) * (1.0 - along) * (1.0 - along) * wisps * fade;
  gl_FragColor = vec4(mix(color, vec3(1.0), 0.3 * (1.0 - along)) * a * 1.8, a);
}`;
export function trailMaterial(colour) { return mat(TRAIL_FRAG, { color: { value: new THREE.Color(colour) }, time: { value: 0 }, fade: { value: 1 } }, { side: THREE.DoubleSide }); }

// -------------------------------------------------------------- fireball --
const FIRE_FRAG = `
uniform float t; uniform float seed;
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec2 vUv;
${NOISE}
void main() {
  vec3 p = normalize(vP);
  float n = fbm(vec2(atan(p.z, p.x) * 1.5 + seed, p.y * 2.0 + seed) + t * 1.5);
  n = n * 0.7 + fbm(vec2(p.x * 4.0, p.z * 4.0 + seed * 3.0) + t) * 0.3;
  // the ball erodes from its noise as it ages: bright chunks tear apart into nothing
  float life = 1.0 - t;
  float body = smoothstep(1.0 - life, 1.0 - life + 0.35, n + 0.25);
  float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  vec3 hot = vec3(1.0, 0.95, 0.8), mid = vec3(1.0, 0.55, 0.15), dark = vec3(0.35, 0.08, 0.02);
  vec3 col = mix(mix(dark, mid, smoothstep(0.2, 0.6, n)), hot, smoothstep(0.55, 0.9, n) * life);
  float a = body * (0.6 + 0.4 * rim) * life;
  gl_FragColor = vec4(col * a * 2.0, a);
}`;
export function fireballMaterial(seed = 0) { return mat(FIRE_FRAG, { t: { value: 0 }, seed: { value: seed } }, { side: THREE.DoubleSide }); }

// ------------------------------------------------------------------ ring --
const RING_FRAG = `
uniform vec3 color; uniform float t;
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec2 vUv;
${NOISE}
void main() {
  vec2 c = vUv - 0.5; float r = length(c) * 2.0, ang = atan(c.y, c.x);
  float edge = t * 0.9 + 0.1;                              // the front spreads outward
  float shell = exp(-pow((r - edge) * 9.0, 2.0));
  float sparkle = 0.6 + 0.4 * vnoise(vec2(ang * 5.0, r * 6.0 - t * 4.0));
  float a = shell * sparkle * (1.0 - t) * step(r, 1.0);
  gl_FragColor = vec4(mix(color, vec3(1.0), 0.4 * (1.0 - t)) * a * 2.0, a);
}`;
export function ringMaterial(colour) { return mat(RING_FRAG, { color: { value: new THREE.Color(colour) }, t: { value: 0 } }, { side: THREE.DoubleSide }); }

// ------------------------------------------------------------------ mine --
const MINE_FRAG = `
uniform float time; uniform float armed;
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec2 vUv;
${NOISE}
void main() {
  vec3 p = normalize(vP);
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
  float bands = smoothstep(0.85, 1.0, abs(sin(p.y * 9.0 + time * 2.0)));
  float pulse = armed > 0.5 ? 0.5 + 0.5 * abs(sin(time * 7.0)) : 0.15;
  float a = fres * 0.6 + bands * 0.5 * pulse + 0.08;
  vec3 col = mix(vec3(0.35, 0.4, 0.5), vec3(1.0, 0.15, 0.1), pulse);
  gl_FragColor = vec4(col * a * 1.8, a);
}`;
export function mineMaterial() { return mat(MINE_FRAG, { time: { value: 0 }, armed: { value: 0 } }, { side: THREE.DoubleSide }); }

// ------------------------------------------------------------ geometries --
/** a bolt body pointing -z: capsule stretched along z, uv.y along its length */
export function boltGeometry(r, len) { const g = new THREE.CapsuleGeometry(r, len, 4, 10); g.rotateX(Math.PI / 2); return g; }
/** two crossed ribbons behind the origin (+z), uv.y 0 at the origin → 1 at the tail */
export function trailGeometry(w, len) {
  const parts = [];
  for (const rot of [0, Math.PI / 2]) { const p = new THREE.PlaneGeometry(w, len, 1, 6); p.rotateX(Math.PI / 2); p.translate(0, 0, len / 2); p.rotateZ(rot); parts.push(p); }
  // merge by hand: same layout, just concatenate
  const pos = [], uv = [], idx = []; let off = 0;
  for (const p of parts) { pos.push(...p.attributes.position.array); const u = p.attributes.uv.array; for (let i = 0; i < u.length; i += 2) uv.push(u[i], 1 - u[i + 1]); for (let i = 0; i < p.index.count; i++) idx.push(p.index.array[i] + off); off += p.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
