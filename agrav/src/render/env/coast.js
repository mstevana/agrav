// CAPE VANTA — coastal cliffs. A terrain height field that rises into ridged
// cliffs inland and falls through a beach into the sea, a shoreline-aware sea
// shader with foam and sun glitter, sea stacks, a displaced rock tunnel
// through the headland, a lighthouse with a sweeping beam, grass and spray.
import * as THREE from 'three';
import { setupSky, placeAlong, instancedVariants, merged, placed, particleField, flock, billboards } from './common.js';
import { glowSprite } from '../textures.js';
import { cliffSet, sandSet, metalPlateSet, waterSet, standard, triplanarBlended } from '../surfaces.js';
import { rock, cliffSlab, seaStack, grassGeo, sweep, frameRuns } from '../props.js';
import { buildTerrain, corridor } from '../terrain.js';
import { fbm2, fbm3, ridged2, smoothstep } from '../noise.js';

const SEA_LEVEL = 1;
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

/** the height field plus the two rules it is built from (cached per track) */
function terrainFor(ribbon, env) {
  // which side of each frame is land: the side away from the sea centre
  const seaCentre = { x: -400, z: 200 };
  const landward = (f) => { const dx = seaCentre.x - f.pos.x, dz = seaCentre.z - f.pos.z; return (dx * f.right.x + dz * f.right.z) > 0 ? -1 : 1; };
  const isTunnel = (f) => f.width < 19.5;

  const terrainMat = triplanarBlended(cliffSet(env.cliff), sandSet(0xd8c8a0), { tile: 20, normalScale: 1.0, wetBand: [SEA_LEVEL + 0.3, SEA_LEVEL + 3.5] });
  const terrain = buildTerrain(ribbon, {
    cacheKey: 'coast', cells: 200, pad: 420, orient: landward, noCap: isTunnel, corridor: { drop: 4, margin: 6, fade: 40 },
    profile(info) {
      const edge = Math.max(0, info.d - info.w / 2);
      const L = smoothstep(-0.35, 0.35, info.sideSmooth);
      const ridge = ridged2(info.x / 120, info.z / 120, { octaves: 4, seed: 4 });
      const landY = info.tySmooth + smoothstep(3, 70, edge) * (16 + ridge * 38) + fbm2(info.x / 40, info.z / 40, { octaves: 3, seed: 5 }) * 3;
      const beach = info.tySmooth - 3 + (2.6 - (info.tySmooth - 3)) * smoothstep(0, 30, edge);
      const seaY = beach + (-14 - ridge * 6 - beach) * smoothstep(30, 95, edge);
      let land = seaY + (landY - seaY) * L;
      if (isTunnel(info.f)) land = Math.max(land, info.ty + 13 + ridge * 8 + smoothstep(0, 40, edge) * 12);
      return corridor(info, land);
    },
    colour(info, y, ny) { const g = smoothstep(0.82, 0.96, ny) * smoothstep(5, 9, y); return [1 - g * 0.35, 1 - g * 0.1, 1 - g * 0.5]; },
    blend: (info, y, ny) => smoothstep(6, 3.5, y),
    material: terrainMat
  });
  return { terrain, landward, isTunnel };
}

export function prewarmCoast(ribbon, track) { terrainFor(ribbon, track.env); cliffSet(track.env.cliff); waterSet(7); }

export function buildCoast(scene, ribbon, track) {
  const env = track.env;
  const group = new THREE.Group(), fine = new THREE.Group();
  const sunPos = { x: -900, y: 420, z: 700 };
  const sky = setupSky(scene, env, 0x4f8fdf, 0xc9dcf0, { clouds: true, seed: 9, sunPos, sunDisc: { colour: 0xfff0d0, size: 50 } });

  const { terrain, landward, isTunnel } = terrainFor(ribbon, env);
  group.add(terrain.mesh);
  const { heightAt } = terrain;

  // sea
  const b = terrain.bounds;
  const seaMat = new THREE.ShaderMaterial({
    vertexShader: SEA_VERT, fragmentShader: SEA_FRAG, transparent: true, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, deep: { value: new THREE.Color(env.sea) }, shallow: { value: new THREE.Color(0x3fa3b8) }, foam: { value: new THREE.Color(env.foam) },
      sunDir: { value: new THREE.Vector3(sunPos.x, sunPos.y, sunPos.z).normalize() }, skyCol: { value: new THREE.Color(0xa8c8f0) }, seaLevel: { value: SEA_LEVEL },
      normalMap: { value: null }, shore: { value: null }, bounds: { value: new THREE.Vector4(b.minX, b.minZ, b.maxX, b.maxZ) }
    }])
  });
  seaMat.uniforms.normalMap.value = waterSet(7).normalMap;
  seaMat.uniforms.shore.value = terrain.heightTexture();
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000, 140, 140), seaMat);
  sea.rotation.x = -Math.PI / 2; sea.position.y = SEA_LEVEL;
  group.add(sea);

  const cliff = standard(cliffSet(env.cliff), { repeat: [2, 2], bumpScale: 0.35, normalScale: 1.2 });
  const slabs = [cliffSlab(5), cliffSlab(6), cliffSlab(7), cliffSlab(8)];
  const landSide = (it) => landward(it.f) === it.sd;
  const nearCliff = placeAlong(ribbon, { every: 12, gap: 1, spread: 5, seed: 40, halfExtent: (rng) => 6 + rng() * 5, y: heightAt }).filter(landSide);
  const farCliff = placeAlong(ribbon, { every: 16, gap: 16, spread: 22, seed: 42, halfExtent: (rng) => 8 + rng() * 7, y: heightAt }).filter(landSide);
  for (const [items, extra] of [[nearCliff, 0], [farCliff, 14]]) {
    group.add(instancedVariants(slabs, cliff, items, (it, pos, q, sc) => { pos.set(it.p.x, it.p.y - 5, it.p.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28); sc.set(it.r * 2, 12 + extra + it.rng() * 16, it.r * 1.6); }));
  }
  // beach boulders and sea stacks on the sea side
  const rocks = [rock(31), rock(32), rock(33)];
  const beachRocks = placeAlong(ribbon, { every: 16, gap: 2, spread: 24, seed: 41, halfExtent: 2, y: heightAt }).filter(it => !landSide(it) && it.p.y > -1);
  group.add(instancedVariants(rocks, cliff, beachRocks, (it, pos, q, sc) => { const r = 1 + it.rng() * 2.5; pos.set(it.p.x, it.p.y + r * 0.2, it.p.z); q.setFromEuler(new THREE.Euler(0, it.rng() * 6.28, 0)); sc.set(r, r * 0.8, r); }));
  const stacks = [seaStack(35), seaStack(36), seaStack(37)];
  const stackItems = placeAlong(ribbon, { every: 36, gap: 55, spread: 170, seed: 43, halfExtent: (rng) => 5 + rng() * 8, y: heightAt }).filter(it => !landSide(it) && it.p.y < -4);
  group.add(instancedVariants(stacks, cliff, stackItems, (it, pos, q, sc) => { pos.set(it.p.x, -6, it.p.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28); const h = 8 + it.rng() * 20; sc.set(it.r, h / 1.8 + 6, it.r); }));

  // headland tunnel: a noisy rock tube around the narrow section, portal rocks at each mouth
  const portalRocks = [];
  for (const [i0, i1] of frameRuns(ribbon, isTunnel)) {
    const a = (i0 - 3 + ribbon.count) % ribbon.count, bb = (i1 + 3) % ribbon.count;
    const prof = [];
    const N = 14;
    for (let k = 0; k <= N; k++) { const ang = Math.PI * (1 - k / N); prof.push({ t: (f) => Math.cos(ang) * (f.width / 2 + 3.5), h: (f) => Math.sin(ang) * 11.5 - 1.5, m: k === 0 || k === N ? 0 : 1 }); }
    prof.push({ t: (f) => f.width / 2 + 3.5, h: -3 }, { t: (f) => -f.width / 2 - 3.5, h: -3 });
    const tube = new THREE.Mesh(sweep(ribbon, a, bb, prof, {
      uvScale: 7, closeProfile: true,
      displace: (x, y, z, m, f) => { const n = fbm3(x * 0.12, y * 0.12, z * 0.12, { octaves: 3, seed: 8 }); const dx = x - f.pos.x, dy = y - f.pos.y - 5, dz = z - f.pos.z; const l = Math.hypot(dx, dy, dz) || 1; const k = n * 2.6 * m; return [dx / l * k, dy / l * k, dz / l * k]; }
    }), cliff.clone());
    tube.material.side = THREE.DoubleSide;
    tube.frustumCulled = false;
    group.add(tube);
    for (const i of [a, bb]) {
      const f = ribbon.frames[i];
      for (const sd of [1, -1]) { const t = sd * (f.width / 2 + 7); portalRocks.push(placed(rock(40 + i % 3), f.pos.x + f.right.x * t, f.pos.y - 5, f.pos.z + f.right.z * t, i * 0.7, 9, 12, 9)); }
      portalRocks.push(placed(rock(44), f.pos.x, f.pos.y + 12, f.pos.z, i, 14, 7, 11));
    }
  }
  if (portalRocks.length) group.add(merged(portalRocks, cliff));

  // lighthouse on the far headland with a sweeping beam
  const lhx = -320, lhz = -180, lhy = Math.max(6, heightAt(lhx, lhz)) - 1;
  const lhMat = new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.7 });
  const tower = new THREE.CylinderGeometry(3, 4.2, 30, 14); tower.translate(0, 15, 0);
  const band = new THREE.CylinderGeometry(3.1, 3.1, 3, 14); band.translate(0, 12, 0);
  const gallery = new THREE.CylinderGeometry(4.2, 3.6, 1.2, 14); gallery.translate(0, 30.4, 0);
  const roof = new THREE.ConeGeometry(3.4, 3, 14); roof.translate(0, 35.5, 0);
  const lh = new THREE.Group();
  lh.add(new THREE.Mesh(tower, lhMat), new THREE.Mesh(gallery, lhMat), new THREE.Mesh(roof, new THREE.MeshStandardMaterial({ color: 0x8a2a2a, roughness: 0.6 })));
  lh.add(new THREE.Mesh(band, new THREE.MeshStandardMaterial({ color: 0xc03a3a, roughness: 0.7 })));
  const lampHouse = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3.2, 14), new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xffe0a0, emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.4 }));
  lampHouse.position.y = 32.6; lh.add(lampHouse);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(28, 420, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.geometry.rotateX(Math.PI / 2); beam.geometry.translate(0, 0, -210);
  beam.position.y = 32.6; lh.add(beam);
  const lamp = new THREE.PointLight(0xfff0c0, 0, 400); lamp.position.y = 34; lh.add(lamp);
  lh.position.set(lhx, lhy, lhz);
  group.add(lh);

  // grass tufts on the inland flats
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x7a9a4e, roughness: 1, side: THREE.DoubleSide });
  // wind: sway the tips in world space, coherent across the field
  const wind = { value: 0 };
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <project_vertex>', `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition.x += (sin(uTime * 1.7 + mvPosition.z * 0.12 + mvPosition.x * 0.07) * 0.35 + 0.15) * transformed.y * transformed.y;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`);
  };
  grassMat.customProgramCacheKey = () => 'grass-sway';
  const grass = placeAlong(ribbon, { every: 5, gap: 2, spread: 45, seed: 45, halfExtent: 0.5, y: heightAt }).filter(it => landSide(it) && it.p.y > 5 && terrain.slopeAt(it.p.x, it.p.z) < 0.3);
  fine.add(instancedVariants([grassGeo()], grassMat, grass, (it, pos, q, sc) => { pos.set(it.p.x, it.p.y - 0.1, it.p.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28); const s = 0.8 + it.rng() * 0.8; sc.set(s * 1.4, s, s * 1.4); }));
  // spray: a low mist over the water line
  const spray = particleField(160, { seed: 46, box: [240, 6, 240], colour: 0xffffff, size: 1.6, opacity: 0.1, drift: [2, 0, 0.5], map: glowSprite(), fixedY: SEA_LEVEL + 0.5 });
  fine.add(spray);

  // sponsor billboards on posts beside the road
  const bb = billboards(ribbon, { every: 200, seed: 9, y: heightAt });
  group.add(bb.ads, merged(bb.frames, standard(metalPlateSet(0x4a505c), { bumpScale: 0.05, metalness: 0.6, roughness: 0.5 })));
  // gulls over the cove and round the lighthouse
  const gulls = flock(12, { x: lhx + 40, z: lhz + 30 }, 70, lhy + 50, { seed: 12, colour: 0xf4f4f8, size: 1.3, speed: 0.3 });
  const gulls2 = flock(10, { x: -470, z: 110 }, 60, 30, { seed: 13, colour: 0xf4f4f8, size: 1.2, speed: 0.4 });
  fine.add(gulls, gulls2);

  scene.add(group, fine);
  let t = 0;
  return {
    group, fine, terrain, sky,
    update(dt, camera) {
      t += dt; seaMat.uniforms.time.value = t; wind.value = t; gulls.tick(dt); gulls2.tick(dt);
      beam.rotation.y = t * 0.5; lamp.intensity = 2 + Math.sin(t * 1.5) * 2;
      spray.tick(dt, camera);
    },
    setDetail(on) { fine.visible = on; },
    lighting: { effects: true }
  };
}
