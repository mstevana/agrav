// ============================================================================
// AGRAV — the sea: a shoreline-aware water surface. The vertex shader rolls
// three sine swells into the plane; the fragment shader reads the terrain's
// height texture to know the depth under every pixel, mixes shallow to deep
// water by it, adds a fresnel sky tint, sun glitter, foam along the shoreline
// and on the crests, and vanishes over land. Shared by the coast and the
// jungle (which also looks up at it from below).
// ============================================================================

import * as THREE from 'three';
import { waterSet } from '../../../../shared/gfx/surfaces.js';

const SEA_VERT = `
#include <fog_pars_vertex>
uniform float time; varying vec2 vUv; varying vec3 vWorld; varying float vH;
void main(){ vUv = uv; vec3 p = position; float w = sin(p.x*0.05 + time*0.9)*0.5 + sin(p.y*0.08 - time*1.3)*0.35 + sin((p.x+p.y)*0.02 + time*0.5)*0.7; p.z += w; vH = w;
  vec4 wp = modelMatrix*vec4(p,1.0); vWorld = wp.xyz; vec4 mvPosition = viewMatrix*wp; gl_Position = projectionMatrix*mvPosition;
#include <fog_vertex>
}`;
const SEA_FRAG = `
#include <fog_pars_fragment>
uniform vec3 deep; uniform vec3 shallow; uniform vec3 foam; uniform vec3 sunDir; uniform vec3 skyCol; uniform float time; uniform float seaLevel;
uniform sampler2D normalMap; uniform sampler2D shore; uniform vec4 bounds;
varying vec2 vUv; varying vec3 vWorld; varying float vH;
void main(){
  vec2 suv = (vWorld.xz - bounds.xy) / (bounds.zw - bounds.xy);
  bool inside = suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0;
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
  f += smoothstep(0.9, 1.5, vH + sin(vUv.x*400.0+time)*0.2) * 0.35;
  col = mix(col, foam, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, depth < -0.5 ? 0.0 : 0.93);
#include <fog_fragment>
}`;

/**
 * @param terrain   a buildTerrain() result (bounds + heightTexture for the shoreline)
 * @param env       track env with `sea` (deep colour) and `foam`
 * @param sunPos    world position of the sun, for the glitter
 * @param opts      { level, size, segments, doubleSide (visible from underneath), shallow, skyCol, normalSeed }
 * @returns { mesh, material }  tick `material.uniforms.time.value`
 */
export function makeSea(terrain, env, sunPos, { level = 1, size = 6000, segments = 140, doubleSide = false, shallow = 0x3fa3b8, skyCol = 0xa8c8f0, normalSeed = 7 } = {}) {
  const b = terrain.bounds;
  const material = new THREE.ShaderMaterial({
    vertexShader: SEA_VERT, fragmentShader: SEA_FRAG, transparent: true, fog: true, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, deep: { value: new THREE.Color(env.sea) }, shallow: { value: new THREE.Color(shallow) }, foam: { value: new THREE.Color(env.foam) },
      sunDir: { value: new THREE.Vector3(sunPos.x, sunPos.y, sunPos.z).normalize() }, skyCol: { value: new THREE.Color(skyCol) }, seaLevel: { value: level },
      normalMap: { value: null }, shore: { value: null }, bounds: { value: new THREE.Vector4(b.minX, b.minZ, b.maxX, b.maxZ) }
    }])
  });
  material.uniforms.normalMap.value = waterSet(normalSeed).normalMap;
  material.uniforms.shore.value = terrain.heightTexture();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, segments, segments), material);
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = level;
  mesh.userData.noShadow = true;
  return { mesh, material };
}
