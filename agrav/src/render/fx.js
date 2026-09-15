// ============================================================================
// AGRAV — effects: projectiles, explosions, minigun tracers, sparks, pickup
// flashes, shield bubbles. Everything is pooled or short-lived and cheap.
// ============================================================================

import * as THREE from 'three';
import { toWorld, frameAt } from '../../../shared/sim/spline.js';
import { poseObject } from './track.js';
import { glowSprite } from './textures.js';
import { shieldMaterial, boltMaterial, trailMaterial, fireballMaterial, ringMaterial, mineMaterial, boltGeometry, trailGeometry } from './fxshaders.js';
import { makePlume } from './exhaust.js';


export class Fx {
  constructor(scene, ribbon) {
    this.scene = scene;
    this.ribbon = ribbon;
    this.enabled = true;
    this.projectiles = new Map();   // id -> mesh
    this.live = [];                 // short-lived effects {obj, t, life, update}
    this.glow = glowSprite();
    this.time = 0;
    this.geo = {
      rocket: boltGeometry(0.16, 1.2), missile: boltGeometry(0.22, 1.6),
      rocketTrail: trailGeometry(0.5, 5), missileTrail: trailGeometry(0.7, 7),
      mine: new THREE.IcosahedronGeometry(0.55, 1), mineCore: new THREE.OctahedronGeometry(0.28, 0),
      sphere: new THREE.SphereGeometry(1, 20, 14),
      plane: new THREE.PlaneGeometry(2, 2)
    };
    this.colour = { rocket: 0xffa030, missile: 0xff2d95 };
    this.mat = { tracer: boltMaterial(0xfff1a0), mineCore: new THREE.MeshBasicMaterial({ color: 0x15171c }) };
    this.tracerGeo = boltGeometry(0.06, 1);
    this.shieldGeo = new THREE.SphereGeometry(1, 32, 20);
    this.shields = new Map();       // racer id → shield mesh (for hit ripples)
    this.uniformed = new Set();     // materials whose `time` ticks
  }

  /** a shield bubble to parent under a craft; toggled with .visible. `id` lets hits ripple on the right one. */
  makeShield(id = -1) {
    const m = new THREE.Mesh(this.shieldGeo, shieldMaterial(0x2df1ff));
    m.scale.set(4.2, 2.6, 5.2); m.position.y = 0.4; m.visible = false;
    m.userData.noShadow = true;
    if (id >= 0) this.shields.set(id, m);
    this.uniformed.add(m.material);
    return m;
  }
  /** a hit landed on racer `id` from world point `from`: start the ripple there */
  shieldHit(id, from) {
    const m = this.shields.get(id); if (!m) return;
    const local = m.worldToLocal(from.clone());
    m.material.uniforms.hit.value.copy(local.normalize()); m.material.uniforms.hitT.value = 0.001;
  }

  /** sync projectile meshes to the interpolated list */
  setProjectiles(list) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let m = this.projectiles.get(p.id);
      if (!m) {
        m = new THREE.Group();
        const mats = [];
        if (p.kind === 'mine') {
          const shell = new THREE.Mesh(this.geo.mine, mineMaterial()); mats.push(shell.material);
          const core = new THREE.Mesh(this.geo.mineCore, this.mat.mineCore);
          m.add(shell, core); m.userData.shell = shell;
        } else {
          const c = this.colour[p.kind];
          const body = new THREE.Mesh(this.geo[p.kind], boltMaterial(c)); mats.push(body.material);
          const trail = new THREE.Mesh(this.geo[p.kind + 'Trail'], trailMaterial(c)); mats.push(trail.material);
          m.add(body, trail);
          if (p.kind === 'missile') { const plume = makePlume(0xffb060, 0.2, p.id); plume.position.z = 0.8; plume.scale.set(1, 1, 2.2); plume.material.uniforms.heat.value = 1.1; m.add(plume); mats.push(plume.material); }
        }
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: p.kind === 'missile' ? 0xff2d95 : p.kind === 'mine' ? 0xff3030 : 0xffa030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        sp.scale.set(p.kind === 'mine' ? 1.6 : 2.4, p.kind === 'mine' ? 1.6 : 2.4, 1); sp.position.z = p.kind === 'mine' ? 0 : 0.3;
        m.add(sp);
        m.userData.sprite = sp; m.userData.mats = mats;
        for (const mt of mats) this.uniformed.add(mt);
        this.scene.add(m);
        this.projectiles.set(p.id, m);
      }
      poseObject(m, this.ribbon, p.s, p.t, p.h, p.yaw, 0, p.kind === 'mine' ? 0.7 : 0.9);
      if (p.kind === 'mine') { m.rotation.y += 0.05; m.userData.shell.material.uniforms.armed.value = p.armed ? 1 : 0; m.userData.sprite.material.opacity = p.armed ? 0.5 + 0.5 * Math.abs(Math.sin(this.time * 8)) : 0.15; }
    }
    for (const [id, m] of this.projectiles) if (!seen.has(id)) { this.scene.remove(m); m.userData.sprite.material.dispose(); for (const mt of m.userData.mats) { this.uniformed.delete(mt); mt.dispose(); } this.projectiles.delete(id); }
  }

  _spawn(obj, life, update) { this.scene.add(obj); this.live.push({ obj, t: 0, life, update }); }

  explosion(pos, size = 1, colour = 0xffc070) {
    if (!this.enabled && size < 2) return;
    // fireball: a noise-eroded ball that swells and tears apart
    const ball = new THREE.Mesh(this.geo.sphere, fireballMaterial(Math.random() * 10));
    ball.position.copy(pos); ball.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    this._spawn(ball, 0.6, (o, k) => { const s = size * (1.2 + Math.pow(k, 0.5) * 5); o.scale.set(s, s, s); o.material.uniforms.t.value = k; });
    this.live[this.live.length - 1].dispose = () => ball.material.dispose();
    // shock ring on the road plane
    const ring = new THREE.Mesh(this.geo.plane, ringMaterial(colour));
    ring.position.copy(pos); ring.position.y += 0.2; ring.rotation.x = -Math.PI / 2;
    this._spawn(ring, 0.5, (o, k) => { const s = size * (2 + k * 12); o.scale.set(s, s, 1); o.material.uniforms.t.value = k; });
    this.live[this.live.length - 1].dispose = () => ring.material.dispose();
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.copy(pos);
    this._spawn(sp, 0.3, (o, k) => { const s = size * (6 + k * 14); o.scale.set(s, s, 1); o.material.opacity = 1 - k; });
    if (this.enabled) this.sparks(pos, Math.round(24 * size), colour, 14 * size);
  }

  sparks(pos, n, colour, speed) {
    const pts = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) { pts[i * 3] = pos.x; pts[i * 3 + 1] = pos.y; pts[i * 3 + 2] = pos.z; vel.push(new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.8, (Math.random() - 0.5)).multiplyScalar(speed * (0.5 + Math.random()))); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ color: colour, size: 0.35, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    this._spawn(p, 0.7, (o, k, dt) => {
      const a = o.geometry.attributes.position.array;
      for (let i = 0; i < n; i++) { vel[i].y -= 30 * dt; a[i * 3] += vel[i].x * dt; a[i * 3 + 1] += vel[i].y * dt; a[i * 3 + 2] += vel[i].z * dt; }
      o.geometry.attributes.position.needsUpdate = true; o.material.opacity = 1 - k;
    }, );
    this.live[this.live.length - 1].dispose = () => { g.dispose(); p.material.dispose(); };
  }

  tracer(from, to) {
    if (!this.enabled) return;
    // a bolt stretched from muzzle to impact, fading fast
    const len = from.distanceTo(to);
    const b = new THREE.Mesh(this.tracerGeo, this.mat.tracer.clone());
    b.position.copy(from).lerp(to, 0.5); b.lookAt(to); b.scale.set(1, 1, len);
    this._spawn(b, 0.1, (o, k) => { o.material.uniforms.fade.value = 1 - k; o.material.uniforms.time.value = this.time; });
    this.live[this.live.length - 1].dispose = () => b.material.dispose();
  }

  pickupFlash(pos, colour = 0x2df1ff) {
    const m = new THREE.Mesh(this.geo.plane, ringMaterial(colour));
    m.position.copy(pos); m.position.y += 0.3; m.rotation.x = -Math.PI / 2;
    this._spawn(m, 0.5, (o, k) => { const s = 2 + k * 10; o.scale.set(s, s, 1); o.material.uniforms.t.value = k; });
    this.live[this.live.length - 1].dispose = () => m.material.dispose();
  }

  /** world position of a ribbon point */
  world(s, t, h) { const w = toWorld(this.ribbon, s, t, h); return new THREE.Vector3(w.x, w.y, w.z); }

  /** game event → effect. poseOf(id) gives the display pose of a racer */
  onEvent(e, poseOf) {
    switch (e.t) {
      case 'boom': this.explosion(this.world(e.s, e.tt, e.h + 0.8), e.wall ? 0.8 : 1.2, e.hit != null ? 0xffd080 : 0xffa060); break;
      case 'dead': { const p = poseOf(e.id); if (p) this.explosion(this.world(p.s, p.t, p.h + 1), 3.2, 0xff8040); break; }
      case 'hit': { const p = poseOf(e.id); if (p && this.enabled) this.sparks(this.world(p.s, p.t, p.h + 1.2), 10, e.source === 'minigun' ? 0xfff1a0 : 0xffb060, 8); break; }
      case 'absorb': { const p = poseOf(e.id); if (p) { const a = e.by != null ? poseOf(e.by) : null; this.shieldHit(e.id, a ? this.world(a.s, a.t, a.h + 1) : this.world(p.s - 6, p.t, p.h + 1)); } break; }
      case 'wall': { const p = poseOf(e.id); if (p && this.enabled) { const f = frameAt(this.ribbon, p.s); const side = p.t > 0 ? 1 : -1; this.sparks(this.world(p.s, side * (f.width / 2 - 0.5), p.h + 0.8), 8, 0xffe0a0, 10); } break; }
      case 'shot': { const p = poseOf(e.id); if (p) { const a = this.world(p.s + 3, p.t, p.h + 1.2); const b = this.world(p.s + Math.min(e.range, 150), p.t + Math.tan(p.yaw) * Math.min(e.range, 150), p.h + 1.2); this.tracer(a, b); } break; }
      case 'pickup': { const p = poseOf(e.id); if (p) this.pickupFlash(this.world(p.s, p.t, p.h), 0x2df1ff); break; }
      case 'use': { const p = poseOf(e.id); if (p) this.pickupFlash(this.world(p.s, p.t, p.h), e.item === 'health' ? 0x5cff8a : e.item === 'speed' ? 0xffd54a : 0x2df1ff); break; }
      case 'lap': case 'finish': case 'go': break;
      default: break;
    }
  }

  update(dt) {
    this.time += dt;
    for (const m of this.uniformed) {
      if (m.uniforms.time) m.uniforms.time.value = this.time;
      if (m.uniforms.hitT && m.uniforms.hitT.value > 0) { m.uniforms.hitT.value += dt * 2.2; if (m.uniforms.hitT.value >= 1) m.uniforms.hitT.value = 0; }
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const L = this.live[i];
      L.t += dt;
      const k = Math.min(1, L.t / L.life);
      L.update(L.obj, k, dt);
      if (k >= 1) { this.scene.remove(L.obj); if (L.dispose) L.dispose(); else L.obj.material?.dispose?.(); this.live.splice(i, 1); }
    }
  }

  dispose() {
    for (const m of this.projectiles.values()) this.scene.remove(m);
    this.projectiles.clear(); this.shields.clear(); this.uniformed.clear();
    for (const L of this.live) this.scene.remove(L.obj);
    this.live.length = 0;
  }
}
