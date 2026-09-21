// ============================================================================
// AGRAV — the sea: a shoreline-aware water surface. The vertex shader rolls
// three sine swells into the plane; the fragment shader reads the terrain's
// height texture to know the depth under every pixel, mixes shallow to deep
// water by it, adds a fresnel sky tint, sun glitter, foam along the shoreline
// and on the crests, and vanishes over land. Shared by the coast and the
// jungle (which also looks up at it from below, and hands it a carve mask so
// the water leaves a hole where a tunnel comes up through it).
// ============================================================================

import * as THREE from 'three';
import { waterSet } from '../../../../shared/gfx/surfaces.js';

const CARVE_RANGE = 4;   // metres either side of a hole's edge that the mask can still measure

const SEA_VERT = `
#include <fog_pars_vertex>
uniform float time; varying vec2 vUv; varying vec3 vWorld; varying float vH;
void main(){ vUv = uv; vec3 p = position; float w = sin(p.x*0.05 + time*0.9)*0.5 + sin(p.y*0.08 - time*1.3)*0.35 + sin((p.x+p.y)*0.02 + time*0.5)*0.7; p.z += w; vH = w;
  vec4 wp = modelMatrix*vec4(p,1.0); vWorld = wp.xyz; vec4 mvPosition = viewMatrix*wp; gl_Position = projectionMatrix*mvPosition;
#include <fog_vertex>
}`;
const seaFrag = (carve) => `
#include <fog_pars_fragment>
uniform vec3 deep; uniform vec3 shallow; uniform vec3 foam; uniform vec3 sunDir; uniform vec3 skyCol; uniform float time; uniform float seaLevel;
uniform sampler2D normalMap; uniform sampler2D shore; uniform vec4 bounds;${carve ? '\nuniform sampler2D carve;' : ''}
varying vec2 vUv; varying vec3 vWorld; varying float vH;
void main(){
  vec2 suv = (vWorld.xz - bounds.xy) / (bounds.zw - bounds.xy);
  bool inside = suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0;${carve ? `
  // metres to the nearest carved hole, negative inside one: the sea simply is not there, and
  // discarding rather than fading to nothing also keeps it from writing depth over the glass
  float cd = inside ? texture2D(carve, suv).r * ${(2 * CARVE_RANGE).toFixed(1)} - ${CARVE_RANGE.toFixed(1)} : ${CARVE_RANGE.toFixed(1)};
  if (cd < 0.0) discard;` : ''}
  float th = texture2D(shore, suv).r * 80.0 - 30.0;
  float depth = inside ? (seaLevel - th) : 30.0;
  vec2 wuv = vWorld.xz / 18.0;
  vec3 n1 = texture2D(normalMap, wuv + vec2(time*0.02, time*0.013)).xyz*2.0-1.0;
  vec3 n2 = texture2D(normalMap, wuv*1.7 - vec2(time*0.017, -time*0.021)).xyz*2.0-1.0;
  vec3 N = normalize(vec3(n1.x + n2.x, 3.2, n1.y + n2.y));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 col = mix(shallow, deep, smoothstep(0.0, 14.0, depth));
  col = mix(col, skyCol, fres * 0.55);
  float spec = pow(max(dot(reflect(-sunDir, N), V), 0.0), 120.0);
  col += vec3(1.0, 0.95, 0.85) * spec * 1.6;
  float f = smoothstep(3.5, 0.3, depth) * (0.55 + 0.45*sin(vWorld.x*0.35 + vWorld.z*0.3 + time*2.0 + vH*3.0));
  f += smoothstep(0.9, 1.5, vH + sin(vUv.x*400.0+time)*0.2) * 0.35;${carve ? `
  f += smoothstep(1.6, 0.2, cd) * 0.45;   // it laps white against the glass` : ''}
  col = mix(col, foam, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, ${carve ? '(depth < -0.5 ? 0.0 : 0.93) * smoothstep(0.0, 1.5, cd)' : 'depth < -0.5 ? 0.0 : 0.93'});
#include <fog_fragment>
}`;

/**
 * Holes for the sea to leave, as a mask in the same bounds-UV space as the shoreline texture:
 * the red channel carries the signed distance in metres (negative inside a hole, clamped to
 * ±CARVE_RANGE) to the union of `polys`, each a closed ring of [x, z] in world space. A distance
 * field because bilinear filtering reconstructs a straight edge from it to well under a metre,
 * where a coverage mask at this grid would give a staircase; and the union is a min, which is
 * exact in sign, so two rings meeting leave no seam.
 */
export function carveMask(bounds, polys, { size = 512 } = {}) {
  const W = bounds.maxX - bounds.minX, H = bounds.maxZ - bounds.minZ;
  const sd = new Float32Array(size * size).fill(CARVE_RANGE);
  for (const poly of polys) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const i0 = Math.max(0, Math.floor((x0 - CARVE_RANGE - bounds.minX) / W * size)), i1 = Math.min(size - 1, Math.ceil((x1 + CARVE_RANGE - bounds.minX) / W * size));
    const j0 = Math.max(0, Math.floor((z0 - CARVE_RANGE - bounds.minZ) / H * size)), j1 = Math.min(size - 1, Math.ceil((z1 + CARVE_RANGE - bounds.minZ) / H * size));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = bounds.minX + (i + 0.5) / size * W, z = bounds.minZ + (j + 0.5) / size * H;   // where the sampler reads, not the grid corner
      let best = Infinity, within = false;
      for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
        const ax = poly[k][0], az = poly[k][1], bx = poly[m][0], bz = poly[m][1];
        const vx = bx - ax, vz = bz - az, wx = x - ax, wz = z - az, L = vx * vx + vz * vz;
        const u = L ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / L)) : 0;
        best = Math.min(best, Math.hypot(wx - vx * u, wz - vz * u));
        if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) within = !within;
      }
      if (within) best = -best;
      const k = j * size + i;
      if (best < sd[k]) sd[k] = best;
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let k = 0; k < sd.length; k++) {
    const v = Math.round(Math.max(0, Math.min(1, (sd[k] + CARVE_RANGE) / (2 * CARVE_RANGE))) * 255);
    data[k * 4] = data[k * 4 + 1] = data[k * 4 + 2] = v; data[k * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}

/**
 * @param terrain   a buildTerrain() result (bounds + heightTexture for the shoreline)
 * @param env       track env with `sea` (deep colour) and `foam`
 * @param sunPos    world position of the sun, for the glitter
 * @param opts      { level, size, segments, doubleSide (visible from underneath), shallow, skyCol, normalSeed, carve (a carveMask) }
 * @returns { mesh, material }  tick `material.uniforms.time.value`
 */
export function makeSea(terrain, env, sunPos, { level = 1, size = 6000, segments = 140, doubleSide = false, shallow = 0x3fa3b8, skyCol = 0xa8c8f0, normalSeed = 7, carve = null } = {}) {
  const b = terrain.bounds;
  const material = new THREE.ShaderMaterial({
    vertexShader: SEA_VERT, fragmentShader: seaFrag(carve), transparent: true, fog: true, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, deep: { value: new THREE.Color(env.sea) }, shallow: { value: new THREE.Color(shallow) }, foam: { value: new THREE.Color(env.foam) },
      sunDir: { value: new THREE.Vector3(sunPos.x, sunPos.y, sunPos.z).normalize() }, skyCol: { value: new THREE.Color(skyCol) }, seaLevel: { value: level },
      normalMap: { value: null }, shore: { value: null }, bounds: { value: new THREE.Vector4(b.minX, b.minZ, b.maxX, b.maxZ) },
      ...(carve ? { carve: { value: null } } : {})
    }])
  });
  material.uniforms.normalMap.value = waterSet(normalSeed).normalMap;
  material.uniforms.shore.value = terrain.heightTexture();
  if (carve) material.uniforms.carve.value = carve;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, segments, segments), material);
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = level;
  mesh.userData.noShadow = true;
  return { mesh, material };
}
