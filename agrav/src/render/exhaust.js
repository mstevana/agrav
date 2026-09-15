// ============================================================================
// AGRAV — engine exhaust as a shader plume. An open tube behind each nozzle:
// the fragment shader burns a white-hot core into the team colour, breaks the
// edge up with scrolling noise, thins toward the tip and fades where the
// surface turns away from the eye, so the plume reads as glowing gas rather
// than a painted cone. Throttle and boost drive its length and heat.
// ============================================================================

import * as THREE from 'three';

const VERT = `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  vUv = uv;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform float time; uniform vec3 colour; uniform float heat; uniform float seed;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main() {
  float along = vUv.y;                                   // 0 at the nozzle, 1 at the tip
  float around = vUv.x * 6.2832;
  // turbulence scrolls away from the nozzle; wraps cleanly round the tube
  vec2 q = vec2(cos(around) * 1.2 + seed, sin(around) * 1.2 + along * 3.0 - time * 7.0);
  float n = fbm(q);
  float body = smoothstep(1.0, 0.3, along + (n - 0.5) * 0.5);           // ragged, thinning tip
  float core = smoothstep(0.85, 0.0, along) * (0.7 + 0.3 * n);
  float shock = 0.5 + 0.5 * sin(along * 28.0 - time * 3.0);              // faint shock diamonds
  // gas is densest where the eye looks through the middle of the tube, thin at the silhouette
  float thick = abs(dot(normalize(vN), normalize(vV)));
  float alpha = body * (0.3 + 0.7 * thick) * heat;
  vec3 hot = vec3(1.0, 0.97, 0.9);
  vec3 col = mix(colour * 1.8, hot, clamp(core * 1.1 + shock * 0.15 * (1.0 - along), 0.0, 1.0));
  col *= 1.0 + heat * 0.8;
  gl_FragColor = vec4(col * alpha * 3.0, alpha);
}`;

/** a plume for a nozzle of radius r, pointing +z from the origin; scale.z sets its length */
export function makePlume(colour, r, seed = 0) {
  // cylinder top (narrow) → +z tip, bottom (wide) → the nozzle at z = 0; uv.y then runs 0 → 1 nozzle → tip
  const geo = new THREE.CylinderGeometry(r * 0.45, r * 1.25, 1, 18, 8, true);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, 0.5);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { time: { value: 0 }, colour: { value: new THREE.Color(colour) }, heat: { value: 0.6 }, seed: { value: seed } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.userData.noShadow = true;
  return m;
}

/** drive a plume: throttle 0/1, boost, speed fraction, dead */
export function animatePlume(plume, { throttle, boost, speedFrac, dead }, t) {
  const len = dead ? 0.001 : throttle ? (boost ? 4.0 : 1.8 + speedFrac * 1.6) : 0.6;
  plume.scale.set(1, 1, len);
  plume.material.uniforms.time.value = t;
  plume.material.uniforms.heat.value = dead ? 0 : throttle ? (boost ? 1.3 : 0.75 + speedFrac * 0.25) : 0.35;
}
