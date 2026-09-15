// ============================================================================
// AGRAV — effects: projectiles, explosions, minigun tracers, sparks, pickup
// flashes, shield bubbles. Everything is pooled or short-lived and cheap.
// ============================================================================

import * as THREE from 'three';
import { toWorld, frameAt } from '../../../shared/sim/spline.js';
import { poseObject } from './track.js';
import { glowSprite } from './textures.js';

const SHIELD_VERT = `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`;
const SHIELD_FRAG = `uniform vec3 color; uniform float time; varying vec3 vN; varying vec3 vV;
void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2); float ripple = 0.75 + 0.25*sin(time*9.0 + vN.y*8.0); gl_FragColor = vec4(color, (0.08 + f*0.9)*ripple); }`;

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
      rocket: new THREE.ConeGeometry(0.28, 1.6, 6),
      missile: new THREE.ConeGeometry(0.34, 2.0, 6),
      mine: new THREE.OctahedronGeometry(0.7, 0),
      sphere: new THREE.SphereGeometry(1, 12, 8),
      ring: new THREE.RingGeometry(0.6, 1, 24)
    };
    this.geo.rocket.rotateX(-Math.PI / 2); this.geo.missile.rotateX(-Math.PI / 2);
    this.mat = {
      rocket: new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff6a00, emissiveIntensity: 1.6, roughness: 0.4 }),
      missile: new THREE.MeshStandardMaterial({ color: 0xff5577, emissive: 0xff2d95, emissiveIntensity: 1.6, roughness: 0.4 }),
      mine: new THREE.MeshStandardMaterial({ color: 0x444a55, emissive: 0xff2020, emissiveIntensity: 0.6, roughness: 0.6, metalness: 0.5 }),
      boom: new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      ring: new THREE.MeshBasicMaterial({ color: 0x2df1ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      tracer: new THREE.LineBasicMaterial({ color: 0xfff1a0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })
    };
    this.shieldMat = new THREE.ShaderMaterial({ vertexShader: SHIELD_VERT, fragmentShader: SHIELD_FRAG, uniforms: { color: { value: new THREE.Color(0x2df1ff) }, time: { value: 0 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide });
    this.shieldGeo = new THREE.SphereGeometry(1, 24, 16);
  }

  /** a shield bubble to parent under a craft; toggled with .visible */
  makeShield() { const m = new THREE.Mesh(this.shieldGeo, this.shieldMat); m.scale.set(4.2, 2.6, 5.2); m.position.y = 0.4; m.visible = false; return m; }

  /** sync projectile meshes to the interpolated list */
  setProjectiles(list) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let m = this.projectiles.get(p.id);
      if (!m) {
        m = new THREE.Mesh(this.geo[p.kind], this.mat[p.kind]);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: p.kind === 'missile' ? 0xff2d95 : p.kind === 'mine' ? 0xff3030 : 0xffa030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        sp.scale.set(2.2, 2.2, 1); sp.position.z = p.kind === 'mine' ? 0 : 1.2;
        m.add(sp);
        m.userData.sprite = sp;
        this.scene.add(m);
        this.projectiles.set(p.id, m);
      }
      poseObject(m, this.ribbon, p.s, p.t, p.h, p.yaw, 0, p.kind === 'mine' ? 0.7 : 0.9);
      if (p.kind === 'mine') { m.rotation.y += 0.05; m.userData.sprite.material.opacity = p.armed ? 0.5 + 0.5 * Math.abs(Math.sin(this.time * 8)) : 0.15; }
    }
    for (const [id, m] of this.projectiles) if (!seen.has(id)) { this.scene.remove(m); m.userData.sprite.material.dispose(); this.projectiles.delete(id); }
  }

  _spawn(obj, life, update) { this.scene.add(obj); this.live.push({ obj, t: 0, life, update }); }

  explosion(pos, size = 1, colour = 0xffc070) {
    if (!this.enabled && size < 2) return;
    const m = new THREE.Mesh(this.geo.sphere, this.mat.boom.clone());
    m.material.color.set(colour);
    m.position.copy(pos);
    this._spawn(m, 0.45, (o, k) => { const s = size * (1 + k * 6); o.scale.set(s, s, s); o.material.opacity = 0.9 * (1 - k); });
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
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    const l = new THREE.Line(g, this.mat.tracer.clone());
    this._spawn(l, 0.09, (o, k) => { o.material.opacity = 1 - k; });
    this.live[this.live.length - 1].dispose = () => { g.dispose(); l.material.dispose(); };
  }

  pickupFlash(pos, colour = 0x2df1ff) {
    const m = new THREE.Mesh(this.geo.ring, this.mat.ring.clone());
    m.material.color.set(colour);
    m.position.copy(pos); m.position.y += 0.3; m.rotation.x = -Math.PI / 2;
    this._spawn(m, 0.5, (o, k) => { const s = 2 + k * 10; o.scale.set(s, s, 1); o.material.opacity = 0.9 * (1 - k); });
  }

  /** world position of a ribbon point */
  world(s, t, h) { const w = toWorld(this.ribbon, s, t, h); return new THREE.Vector3(w.x, w.y, w.z); }

  /** game event → effect. poseOf(id) gives the display pose of a racer */
  onEvent(e, poseOf) {
    switch (e.t) {
      case 'boom': this.explosion(this.world(e.s, e.tt, e.h + 0.8), e.wall ? 0.8 : 1.2, e.hit != null ? 0xffd080 : 0xffa060); break;
      case 'dead': { const p = poseOf(e.id); if (p) this.explosion(this.world(p.s, p.t, p.h + 1), 3.2, 0xff8040); break; }
      case 'hit': { const p = poseOf(e.id); if (p && this.enabled) this.sparks(this.world(p.s, p.t, p.h + 1.2), 10, e.source === 'minigun' ? 0xfff1a0 : 0xffb060, 8); break; }
      case 'absorb': { const p = poseOf(e.id); if (p) this.pickupFlash(this.world(p.s, p.t, p.h + 0.5), 0x2df1ff); break; }
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
    this.shieldMat.uniforms.time.value = this.time;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const L = this.live[i];
      L.t += dt;
      const k = Math.min(1, L.t / L.life);
      L.update(L.obj, k, dt);
      if (k >= 1) { this.scene.remove(L.obj); if (L.dispose) L.dispose(); else if (L.obj.material && L.obj.material !== this.mat.boom) L.obj.material.dispose?.(); this.live.splice(i, 1); }
    }
  }

  dispose() {
    for (const m of this.projectiles.values()) this.scene.remove(m);
    this.projectiles.clear();
    for (const L of this.live) this.scene.remove(L.obj);
    this.live.length = 0;
  }
}
