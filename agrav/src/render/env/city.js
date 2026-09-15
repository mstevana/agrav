// NEON MERIDIAN — night city. Towers with lit facades either side of the
// canyon, neon strips, holo billboards, rain haze, pillars under the ramp.
import * as THREE from 'three';
import { setupSky, placeAlong, instanced, ground } from './common.js';
import { facadeTexture, groundTexture, glowSprite } from '../textures.js';
import { makeRng } from '../../../../shared/sim/rng.js';

export function buildCity(scene, ribbon, track) {
  const env = track.env;
  const group = new THREE.Group();
  setupSky(scene, env, 0x05061a, 0x1a1f45);
  // street level glow so the surface and the craft read at night
  const under = new THREE.HemisphereLight(0x2a3a6a, 0x101830, 1.2);
  scene.add(under);
  ground(scene, -22, new THREE.MeshStandardMaterial({ map: groundTexture(0x0b0d16, 0.06), roughness: 0.9 }));

  // towers: three rings of placement at increasing distance
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const mats = [0, 1, 2, 3].map(i => new THREE.MeshStandardMaterial({ map: facadeTexture(100 + i, env.neon[i % env.neon.length]), emissive: 0xffffff, emissiveMap: facadeTexture(100 + i, env.neon[i % env.neon.length]), emissiveIntensity: 0.55, roughness: 0.7 }));
  const towerHalf = (rng) => 7 + rng() * 11;      // half of a 14–36 m footprint
  const layers = [
    placeAlong(ribbon, { every: 22, gap: 4, spread: 20, seed: 3, halfExtent: towerHalf }),
    placeAlong(ribbon, { every: 30, gap: 40, spread: 70, seed: 4, halfExtent: towerHalf }),
    placeAlong(ribbon, { every: 40, gap: 110, spread: 160, seed: 5, halfExtent: towerHalf })
  ];
  layers.forEach((items, li) => {
    for (let mi = 0; mi < mats.length; mi++) {
      const mine = items.filter((_, i) => i % mats.length === mi);
      if (!mine.length) continue;
      group.add(instanced(box, mats[mi], mine, (it, pos, q, sc) => {
        const w = it.r * 2, d = it.r * (1.4 + it.rng() * 1.2), h = 40 + it.rng() * (90 + li * 60);
        pos.set(it.p.x, -22, it.p.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rng() * 0.3);
        sc.set(w, h, Math.min(d, it.r * 2));
      }));
    }
  });
  // neon edge strips floating beside the track
  const strip = new THREE.BoxGeometry(0.3, 0.3, 12);
  const neonItems = placeAlong(ribbon, { every: 18, gap: 1.5, spread: 0.5, seed: 9, yOffset: 3.5, halfExtent: -3 });
  env.neon.forEach((c, ci) => {
    const mine = neonItems.filter((_, i) => i % env.neon.length === ci);
    group.add(instanced(strip, new THREE.MeshBasicMaterial({ color: c }), mine, (it, pos, q, sc) => {
      pos.set(it.p.x, it.p.y, it.p.z);
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(it.f.tangent.x, 0, it.f.tangent.z).normalize());
      sc.set(1, 1, 1);
    }));
  });
  // billboards: glowing planes
  const bb = new THREE.PlaneGeometry(18, 9);
  const bbItems = placeAlong(ribbon, { every: 140, gap: 6, spread: 10, seed: 12, yOffset: 22, halfExtent: 9 });
  group.add(instanced(bb, new THREE.MeshBasicMaterial({ color: 0xff2d95, transparent: true, opacity: 0.55, side: THREE.DoubleSide }), bbItems, (it, pos, q, sc) => {
    pos.set(it.p.x, it.p.y, it.p.z);
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-it.f.right.x * it.sd, 0, -it.f.right.z * it.sd).normalize());
    sc.set(1, 1, 1);
  }));
  // pillars under elevated sections
  const pillar = new THREE.CylinderGeometry(1.2, 1.6, 1, 8); pillar.translate(0, 0.5, 0);
  const pil = [];
  for (let s = 0; s < ribbon.length; s += 24) { const f = ribbon.frames[Math.floor(s / ribbon.step) % ribbon.count]; if (f.pos.y > 4) pil.push({ f }); }
  group.add(instanced(pillar, new THREE.MeshStandardMaterial({ color: 0x2a2f3b, roughness: 0.8 }), pil, (it, pos, q, sc) => {
    pos.set(it.f.pos.x, -22, it.f.pos.z); q.identity(); sc.set(1, it.f.pos.y + 21.6, 1);
  }));
  // rain: a drifting particle field around the camera
  const rainN = 900, rp = new Float32Array(rainN * 3);
  const rng = makeRng(77);
  for (let i = 0; i < rainN; i++) { rp[i * 3] = (rng() - 0.5) * 120; rp[i * 3 + 1] = rng() * 60; rp[i * 3 + 2] = (rng() - 0.5) * 120; }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0x9fb8ff, size: 0.25, transparent: true, opacity: 0.45, sizeAttenuation: true, depthWrite: false }));
  group.add(rain);
  // street glow sprites
  const glowItems = placeAlong(ribbon, { every: 60, gap: 3, spread: 4, seed: 21, yOffset: 1, halfExtent: -3 });
  const glow = glowSprite();
  for (const it of glowItems) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: env.neon[Math.floor(it.u * env.neon.length)], transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.set(it.p.x, it.p.y, it.p.z); sp.scale.set(14, 14, 1); group.add(sp);
  }
  scene.add(group);
  return {
    group,
    update(dt, camera) {
      const a = rain.geometry.attributes.position.array;
      for (let i = 0; i < rainN; i++) { a[i * 3 + 1] -= 40 * dt; if (a[i * 3 + 1] < 0) a[i * 3 + 1] += 60; }
      rain.geometry.attributes.position.needsUpdate = true;
      rain.position.set(camera.position.x, camera.position.y - 30, camera.position.z);
    },
    lighting: { effects: true }
  };
}
