// CAPE VANTA — coastal cliffs. Sea on the low side with a slow swell, cliff
// faces rising on the land side, a tunnel through the headland, spray.
import * as THREE from 'three';
import { setupSky, placeAlong, instanced, ground } from './common.js';
import { cliffTexture, groundTexture } from '../textures.js';
import { frameAt } from '../../../../shared/sim/spline.js';

const SEA_VERT = `uniform float time; varying vec2 vUv; varying float vH;
void main(){ vUv = uv; vec3 p = position; float w = sin(p.x*0.05 + time*0.9)*0.6 + sin(p.y*0.08 - time*1.3)*0.4 + sin((p.x+p.y)*0.02 + time*0.5)*0.8; p.z += w; vH = w; gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0); }`;
const SEA_FRAG = `uniform vec3 deep; uniform vec3 foam; uniform float time; varying vec2 vUv; varying float vH;
void main(){ float f = smoothstep(0.9, 1.6, vH + sin(vUv.x*400.0+time)*0.2); vec3 c = mix(deep, foam, f*0.6); gl_FragColor = vec4(c, 0.92); }`;

export function buildCoast(scene, ribbon, track) {
  const env = track.env;
  const group = new THREE.Group();
  setupSky(scene, env, 0x4f8fdf, 0xc9dcf0);
  ground(scene, 0.5, new THREE.MeshStandardMaterial({ map: groundTexture(0x8a9a6a, 0.1), roughness: 1 }));
  // sea: a large shader plane at y = 0, so beaches at y≈8-10 sit above it
  const seaMat = new THREE.ShaderMaterial({ vertexShader: SEA_VERT, fragmentShader: SEA_FRAG, uniforms: { time: { value: 0 }, deep: { value: new THREE.Color(env.sea) }, foam: { value: new THREE.Color(env.foam) } }, transparent: true });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000, 120, 120), seaMat);
  sea.rotation.x = -Math.PI / 2; sea.position.y = 1;
  group.add(sea);

  const cliff = new THREE.MeshStandardMaterial({ map: cliffTexture(env.cliff), roughness: 1 });
  const slab = new THREE.BoxGeometry(1, 1, 1); slab.translate(0, 0.5, 0);
  // the land side is whichever side is higher than the sea: sample the frame's right vector against world up bias; simpler: cliffs on the side away from the sea centre
  const seaCentre = { x: -400, z: 200 };   // the water lies west/north of the loop (mirrored world)
  const landward = (f) => { const dx = seaCentre.x - f.pos.x, dz = seaCentre.z - f.pos.z; return (dx * f.right.x + dz * f.right.z) > 0 ? -1 : 1; };
  const items = [];
  for (let s = 0; s < ribbon.length; s += 12) {
    const f = frameAt(ribbon, s);
    const sd = landward(f);
    for (let k = 0; k < 2; k++) {
      const d = f.width / 2 + 3 + k * 14 + Math.random() * 6;
      items.push({ x: f.pos.x + f.right.x * sd * d, y: f.pos.y, z: f.pos.z + f.right.z * sd * d, h: 12 + k * 18 + Math.random() * 14, w: 14 + Math.random() * 10, rot: Math.random() * 6.28 });
    }
  }
  group.add(instanced(slab, cliff, items, (it, pos, q, sc) => { pos.set(it.x, it.y - 24, it.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot); sc.set(it.w, it.h + 24, it.w); }));
  // sea-side: low rocks and the drop to the water
  const seaSide = placeAlong(ribbon, { every: 20, gap: 2, spread: 8, clear: 14, seed: 41 }).filter(it => landward(it.f) !== it.sd);
  group.add(instanced(slab, cliff, seaSide, (it, pos, q, sc) => { pos.set(it.p.x, -8, it.p.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 6.28); sc.set(6 + it.rng() * 8, it.p.y + 8 - 2 - it.rng() * 3, 6 + it.rng() * 8); }));
  // headland tunnel: a tube of rock around the narrow section (width <= 20)
  const tunnelFrames = ribbon.frames.filter(f => f.width < 19.5);
  if (tunnelFrames.length) {
    const ring = new THREE.TorusGeometry(15, 4, 6, 12);
    group.add(instanced(ring, cliff, tunnelFrames.filter((_, i) => i % 4 === 0), (f, pos, q, sc) => {
      pos.set(f.pos.x, f.pos.y + 6, f.pos.z);
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(f.tangent.x, f.tangent.y, f.tangent.z));
      sc.set(1, 0.8, 1);
    }));
  }
  // lighthouse on the far headland
  const lh = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 30, 10), new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.7 }));
  lh.position.set(-320, 45, -180); group.add(lh);
  const lamp = new THREE.PointLight(0xfff0c0, 0, 400); lamp.position.set(-320, 62, -180); group.add(lamp);
  scene.add(group);
  let t = 0;
  return {
    group,
    update(dt) { t += dt; seaMat.uniforms.time.value = t; lamp.intensity = 2 + Math.sin(t * 1.5) * 2; },
    lighting: { effects: true }
  };
}
