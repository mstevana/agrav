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

    // Every short-lived effect used to build its materials and geometry and throw them away when it
    // finished. Disposing a material releases its compiled shader program, so the next explosion
    // compiled the same shaders over again -- a stall on every blast, and sparks fire on every
    // minigun hit. Effects now animate a slot from a pool that stays in the scene for good: during
    // a race nothing is created or disposed, and these programs compile once with the rest of the
    // scene, in the lobby. A pool is sized for the overlap its effect can reach, and when it does
    // run out the oldest slot restarts rather than a blast being dropped.
    this.SPARK_MAX = 96;            // a craft dying throws about eighty
    this.slots = [];
    const mk = (n, make, life, step) => {
      const a = [];
      for (let i = 0; i < n; i++) {
        const s = { o: make(i), t: 1, life, step, size: 1, n: 0 };
        s.o.visible = false; s.o.userData.noShadow = true;
        this.scene.add(s.o); this.slots.push(s); a.push(s);
      }
      return a;
    };
    const sprite = (colour) => new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: colour, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const flat = (colour) => { const o = new THREE.Mesh(this.geo.plane, ringMaterial(colour)); o.rotation.x = -Math.PI / 2; return o; };
    this.pool = {
      balls: mk(5, (i) => new THREE.Mesh(this.geo.sphere, fireballMaterial(i * 2.1)), 0.6,
        (s, k) => { const v = s.size * (1.2 + Math.sqrt(k) * 5); s.o.scale.set(v, v, v); s.o.material.uniforms.t.value = k; }),
      rings: mk(5, () => flat(0xffc070), 0.5,
        (s, k) => { const v = s.size * (2 + k * 12); s.o.scale.set(v, v, 1); s.o.material.uniforms.t.value = k; }),
      flares: mk(5, () => sprite(0xffffff), 0.3,
        (s, k) => { const v = s.size * (6 + k * 14); s.o.scale.set(v, v, 1); s.o.material.opacity = 1 - k; }),
      sparks: mk(10, () => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.SPARK_MAX * 3), 3));
        // the points travel far from where they started, so the bounding sphere three computes once
        // would cull them wrongly part way through
        const o = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffb060, size: 0.35, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
        o.frustumCulled = false;
        return o;
      }, 0.7, (s, k, dt) => {
        const a = s.o.geometry.attributes.position.array;
        for (let i = 0; i < s.n; i++) { s.vel[i].y -= 30 * dt; a[i * 3] += s.vel[i].x * dt; a[i * 3 + 1] += s.vel[i].y * dt; a[i * 3 + 2] += s.vel[i].z * dt; }
        s.o.geometry.attributes.position.needsUpdate = true; s.o.material.opacity = 1 - k;
      }),
      tracers: mk(8, () => new THREE.Mesh(this.tracerGeo, boltMaterial(0xfff1a0)), 0.1,
        (s, k) => { s.o.material.uniforms.fade.value = 1 - k; s.o.material.uniforms.time.value = this.time; }),
      pickups: mk(4, () => flat(0x2df1ff), 0.5,
        (s, k) => { const v = 2 + k * 10; s.o.scale.set(v, v, 1); s.o.material.uniforms.t.value = k; })
    };
    for (const s of this.pool.sparks) s.vel = Array.from({ length: this.SPARK_MAX }, () => new THREE.Vector3());
    this.spent = { rocket: [], missile: [], mine: [] };   // projectile meshes kept back for the next shot
  }

  /** the slot furthest through its life: an idle one if there is one, else the oldest still running */
  _take(list) { const s = list.reduce((a, b) => (b.t > a.t ? b : a)); s.t = 0; s.o.visible = true; return s; }
  /** retire every running effect at once (the screenshot tool wants a clean frame) */
  clearEffects() { for (const s of this.slots) { s.t = 1; s.o.visible = false; } }

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
      if (!m) m = this.spent[p.kind]?.pop();
      if (m) { m.visible = true; this.projectiles.set(p.id, m); }
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
        m.userData.sprite = sp; m.userData.mats = mats; m.userData.kind = p.kind;
        for (const mt of mats) this.uniformed.add(mt);
        this.scene.add(m);
        this.projectiles.set(p.id, m);
      }
      poseObject(m, this.ribbon, p.s, p.t, p.h, p.yaw, 0, p.kind === 'mine' ? 0.7 : 0.9);
      if (p.kind === 'mine') { m.rotation.y += 0.05; m.userData.shell.material.uniforms.armed.value = p.armed ? 1 : 0; m.userData.sprite.material.opacity = p.armed ? 0.5 + 0.5 * Math.abs(Math.sin(this.time * 8)) : 0.15; }
    }
    // A spent rocket is parked, not destroyed: disposing its materials would release their compiled
    // shader programs, so the very next shot of the same kind would compile them again.
    for (const [id, m] of this.projectiles) if (!seen.has(id)) { m.visible = false; this.spent[m.userData.kind]?.push(m); this.projectiles.delete(id); }
  }

  explosion(pos, size = 1, colour = 0xffc070) {
    if (!this.enabled && size < 2) return;
    // fireball: a noise-eroded ball that swells and tears apart
    const b = this._take(this.pool.balls);
    b.size = size; b.o.position.copy(pos); b.o.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    // shock ring on the road plane
    const r = this._take(this.pool.rings);
    r.size = size; r.o.position.copy(pos); r.o.position.y += 0.2; r.o.material.uniforms.color.value.set(colour);
    const f = this._take(this.pool.flares);
    f.size = size; f.o.position.copy(pos); f.o.material.opacity = 1;
    if (this.enabled) this.sparks(pos, Math.round(24 * size), colour, 14 * size);
  }

  sparks(pos, n, colour, speed) {
    const s = this._take(this.pool.sparks);
    s.n = Math.min(n, this.SPARK_MAX);
    const a = s.o.geometry.attributes.position.array;
    for (let i = 0; i < s.n; i++) {
      a[i * 3] = pos.x; a[i * 3 + 1] = pos.y; a[i * 3 + 2] = pos.z;
      s.vel[i].set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(speed * (0.5 + Math.random()));
    }
    s.o.geometry.attributes.position.needsUpdate = true;
    s.o.geometry.setDrawRange(0, s.n);          // the buffer is sized for the worst case, not this blast
    s.o.material.color.set(colour); s.o.material.opacity = 1;
  }

  tracer(from, to) {
    if (!this.enabled) return;
    // a bolt stretched from muzzle to impact, fading fast
    const s = this._take(this.pool.tracers);
    s.o.position.copy(from).lerp(to, 0.5); s.o.lookAt(to); s.o.scale.set(1, 1, from.distanceTo(to));
  }

  pickupFlash(pos, colour = 0x2df1ff) {
    const s = this._take(this.pool.pickups);
    s.o.position.copy(pos); s.o.position.y += 0.3; s.o.material.uniforms.color.value.set(colour);
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
    for (const s of this.slots) {
      if (s.t >= 1) continue;
      s.t = Math.min(1, s.t + dt / s.life);
      s.step(s, s.t, dt);
      if (s.t >= 1) s.o.visible = false;
    }
  }

  dispose() {
    for (const m of this.projectiles.values()) this.scene.remove(m);
    for (const list of Object.values(this.spent)) { for (const m of list) this.scene.remove(m); list.length = 0; }
    this.projectiles.clear(); this.shields.clear(); this.uniformed.clear();
    for (const s of this.slots) this.scene.remove(s.o);
    this.slots.length = 0;
  }
}
