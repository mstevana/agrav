// ============================================================================
// AGRAV — effects: projectiles, explosions, minigun tracers, sparks, pickup
// flashes, shield bubbles. Everything is pooled or short-lived and cheap.
// ============================================================================

import * as THREE from 'three';
import { toWorld, frameAt } from '../../../shared/sim/spline.js';
import { CONTACT } from '../../../shared/agrav/constants.js';
import { poseObject } from './track.js';
import { glowSprite } from './textures.js';
import { shieldMaterial, boltMaterial, trailMaterial, fireballMaterial, ringMaterial, mineMaterial, boltGeometry, trailGeometry } from './fxshaders.js';
import { makePlume } from './exhaust.js';

// Two hulls pressed together bump on every tick they overlap, so the shower is throttled per pair:
// one every SCRAPE_GAP for as long as the grind lasts, and a big burst the moment a pair meets hard.
const SCRAPE_GAP = 0.12;
const HARD_GAP = 0.35;

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
    this.bumps = new Map();         // pair key -> when it last sparked, so a long scrape cannot thrash the pool
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
      sparks: mk(14, () => {   // a pack scrapping down a straight can have three pairs grinding at once
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
    for (const kind of Object.keys(this.spent)) { const m = this._buildProjectile(kind); m.visible = false; this.spent[kind].push(m); }
  }

  /** the slot furthest through its life: an idle one if there is one, else the oldest still running */
  _take(list) { const s = list.reduce((a, b) => (b.t > a.t ? b : a)); s.t = 0; s.o.visible = true; return s; }
  /** retire every running effect at once (the screenshot tool wants a clean frame) */
  clearEffects() { for (const s of this.slots) { s.t = 1; s.o.visible = false; } this.bumps.clear(); }

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

  /**
   * One projectile of a kind. Building one compiles its shaders, so the pool is seeded at
   * construction and these compile in the lobby with the rest of the scene rather than when the
   * first rocket of the race is fired.
   */
  _buildProjectile(kind) {
    const m = new THREE.Group();
    const mats = [];
    if (kind === 'mine') {
      const shell = new THREE.Mesh(this.geo.mine, mineMaterial()); mats.push(shell.material);
      const core = new THREE.Mesh(this.geo.mineCore, this.mat.mineCore);
      m.add(shell, core); m.userData.shell = shell;
    } else {
      const c = this.colour[kind];
      const body = new THREE.Mesh(this.geo[kind], boltMaterial(c)); mats.push(body.material);
      const trail = new THREE.Mesh(this.geo[kind + 'Trail'], trailMaterial(c)); mats.push(trail.material);
      m.add(body, trail);
      if (kind === 'missile') { const plume = makePlume(0xffb060, 0.2, 7); plume.position.z = 0.8; plume.scale.set(1, 1, 2.2); plume.material.uniforms.heat.value = 1.1; m.add(plume); mats.push(plume.material); }
    }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: kind === 'missile' ? 0xff2d95 : kind === 'mine' ? 0xff3030 : 0xffa030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.scale.set(kind === 'mine' ? 1.6 : 2.4, kind === 'mine' ? 1.6 : 2.4, 1); sp.position.z = kind === 'mine' ? 0 : 0.3;
    m.add(sp);
    m.userData.sprite = sp; m.userData.mats = mats; m.userData.kind = kind;
    for (const mt of mats) this.uniformed.add(mt);
    this.scene.add(m);
    return m;
  }

  /** sync projectile meshes to the interpolated list */
  setProjectiles(list) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let m = this.projectiles.get(p.id);
      const fresh = !m;
      if (!m) m = this.spent[p.kind]?.pop();
      if (m) { m.visible = true; this.projectiles.set(p.id, m); }
      if (!m) { m = this._buildProjectile(p.kind); this.projectiles.set(p.id, m); }
      poseObject(m, this.ribbon, p.s, p.t, p.h, p.yaw, 0, p.kind === 'mine' ? 0.7 : 0.9);
      if (p.kind === 'mine') {
        m.rotation.y += 0.05;
        m.userData.shell.material.uniforms.armed.value = p.armed ? 1 : 0;
        // Unarmed used to mean a dim 0.15, which is invisible at racing speed -- and the unarmed
        // half second is exactly the moment the driver who dropped it is looking. It strobes hard
        // while it arms instead, then settles to the slow pulse an armed mine has always had.
        const sp = m.userData.sprite, v = p.armed ? 1.6 : 2.4;
        sp.material.opacity = p.armed ? 0.5 + 0.5 * Math.abs(Math.sin(this.time * 8)) : Math.abs(Math.sin(this.time * 26));
        sp.scale.set(v, v, 1);
        if (fresh && !p.armed) this.mineDrop(m.position);
      }
    }
    // A spent rocket is parked, not destroyed: disposing its materials would release their compiled
    // shader programs, so the very next shot of the same kind would compile them again.
    for (const [id, m] of this.projectiles) if (!seen.has(id)) { m.visible = false; this.spent[m.userData.kind]?.push(m); this.projectiles.delete(id); }
  }

  /**
   * A mine hitting the road. You drop it behind you at two hundred klicks and it is gone from the
   * mirror before you can register it, so the drop itself is the feedback: a flash, a ring that
   * opens on the road around it, and a scatter of sparks. The ring outlives the flash by a good
   * half second, which is what you actually see as you pull away. Fired when the mine first
   * appears rather than on the event, so it lands on the mine as drawn instead of where the
   * dropper has already got to.
   */
  mineDrop(at) {
    const f = this._take(this.pool.flares);
    f.size = 0.3; f.o.position.copy(at); f.o.material.opacity = 1;
    const r = this._take(this.pool.rings);
    r.size = 0.75; r.o.position.copy(at); r.o.position.y -= 0.35; r.o.material.uniforms.color.value.set(0xff5030);
    if (this.enabled) this.sparks(at, 10, 0xff8050, 5);
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

  /**
   * Hull on hull: sparks off the contact face, at the midpoint of the two craft, which is where
   * the panels are actually touching. A side swipe at speed runs for half a second of ticks, so
   * `force` (relative speed, m/s) picks between a steady grind of small showers and the one hot
   * burst a fresh ram throws -- both throttled per pair. One measured swipe runs 82 bump events in
   * 1.4 s: unthrottled that restarts all fourteen spark slots six times over and leaves nothing for
   * the explosions; throttled it is eleven showers and never more than six slots in the air.
   */
  bump(a, b, force, poseOf) {
    const key = Math.min(a, b) * 64 + Math.max(a, b);
    const last = this.bumps.get(key);
    const hard = force >= CONTACT.hardHit && (!last || this.time - last.hard >= HARD_GAP);
    if (!hard && last && this.time - last.soft < SCRAPE_GAP) return;
    const p = poseOf(a), q = poseOf(b);
    if (!p || !q) return;
    this.bumps.set(key, { soft: this.time, hard: hard ? this.time : (last ? last.hard : -HARD_GAP) });
    const at = this.world(p.s, p.t, p.h + 1).lerp(this.world(q.s, q.t, q.h + 1), 0.5);   // flank height, not under the skirts
    const f = Math.min(1, force / CONTACT.hardHit);
    this.sparks(at, hard ? 18 : 4 + Math.round(6 * f), hard ? 0xfff0c0 : 0xffd080, (hard ? 9 : 4) + 6 * f);
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

  /**
   * game event → effect. poseOf(id) gives the display pose of a racer; muzzleOf(id) gives the
   * world position and direction of its minigun barrel, when the turret is up.
   */
  onEvent(e, poseOf, muzzleOf = null) {
    switch (e.t) {
      case 'boom': this.explosion(this.world(e.s, e.tt, e.h + 0.8), e.wall ? 0.8 : 1.2, e.hit != null ? 0xffd080 : 0xffa060); break;
      case 'dead': { const p = poseOf(e.id); if (p) this.explosion(this.world(p.s, p.t, p.h + 1), 3.2, 0xff8040); break; }
      case 'hit': { const p = poseOf(e.id); if (p && this.enabled) this.sparks(this.world(p.s, p.t, p.h + 1.2), 10, e.source === 'minigun' ? 0xfff1a0 : 0xffb060, 8); break; }
      case 'absorb': { const p = poseOf(e.id); if (p) { const a = e.by != null ? poseOf(e.by) : null; this.shieldHit(e.id, a ? this.world(a.s, a.t, a.h + 1) : this.world(p.s - 6, p.t, p.h + 1)); } break; }
      case 'wall': { const p = poseOf(e.id); if (p && this.enabled) { const f = frameAt(this.ribbon, p.s); const side = p.t > 0 ? 1 : -1; this.sparks(this.world(p.s, side * (f.width / 2 - 0.5), p.h + 0.8), 8, 0xffe0a0, 10); } break; }
      case 'shot': {
        const p = poseOf(e.id); if (!p) break;
        const m = muzzleOf?.(e.id);                                   // out of the barrel once the gun is up
        const reach = Math.min(e.range, 150);
        const from = m ? m.pos : this.world(p.s + 3, p.t, p.h + 1.2);
        let to = null;
        if (e.hit >= 0) { const q = poseOf(e.hit); if (q) to = this.world(q.s, q.t, q.h + 1.2); }
        if (!to) to = m ? m.pos.clone().addScaledVector(m.dir, reach) : this.world(p.s + reach, p.t + Math.tan(p.yaw) * reach, p.h + 1.2);
        this.tracer(from, to);
        break;
      }
      case 'bump': if (this.enabled) this.bump(e.a, e.b, e.force, poseOf); break;
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
    this.projectiles.clear(); this.shields.clear(); this.uniformed.clear(); this.bumps.clear();
    for (const s of this.slots) this.scene.remove(s.o);
    this.slots.length = 0;
  }
}
