// ============================================================================
// Everything that flashes, streaks or burns.
//
// The server never sends a message per bullet — a machine gun is nine a second
// and six cars would be a hundred messages a second for something the client
// already knows. The snapshot says who is firing and with what, so the tracers
// are traced here, against the same wrecks and scenery the server's rays stop
// on, and they land where the server's did.
// ============================================================================

import * as THREE from 'three';
import { WEAPONS } from '../../../shared/rally/constants.js';
import { isLite } from './scene.js';

const TRACER_LIFE = 0.06;
const MAX_TRACERS = 90;

export class Fx {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.group = new THREE.Group();
    scene.three.add(this.group);

    this.tracers = [];
    this.fireClocks = new Map();     // car id -> seconds owed at its weapon's rate
    this.blasts = [];
    this.mines = new Map();
    this.smoke = [];

    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.95 });
    this.tracerLines = new THREE.LineSegments(this.tracerGeo, this.tracerMat);
    this.tracerLines.frustumCulled = false;
    this.group.add(this.tracerLines);
    this.tracerBuf = new Float32Array(MAX_TRACERS * 6);
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerBuf, 3));
    this.tracerGeo.setDrawRange(0, 0);

    this.mineGeo = new THREE.CylinderGeometry(0.6, 0.7, 0.34, 10);
    this.mineMat = new THREE.MeshStandardMaterial({ color: 0x3a3a42, emissive: 0xff2a2a, emissiveIntensity: 0.2, roughness: 0.6 });
    this.blastGeo = new THREE.RingGeometry(0.6, 1, 22);
    this.flashGeo = new THREE.SphereGeometry(0.42, 8, 6);
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true });
  }

  dispose() { this.scene.three.remove(this.group); }

  /** one frame of effects, given the interpolated view */
  update(view, dt) {
    this._tracers(view, dt);
    this._mines(view, dt);
    this._blasts(dt);
    this._smoke(view, dt);
  }

  // --- gunfire: a streak per shot, at the weapon's own rate
  _tracers(view, dt) {
    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter(t => t.life > 0);

    for (const car of view.cars) {
      if (car.dead || car.finished) { this.fireClocks.delete(car.id); continue; }
      const w = WEAPONS[car.weapon] || WEAPONS.machinegun;
      if (!car.firing || car.ammo <= 0) { this.fireClocks.set(car.id, 0); continue; }
      let owed = (this.fireClocks.get(car.id) || 0) + dt * w.rate;
      let shots = 0;
      while (owed >= 1 && shots < 4) { owed -= 1; shots++; this._shoot(car, w, view); }
      this.fireClocks.set(car.id, owed);
    }

    let n = 0;
    for (const t of this.tracers) {
      if (n >= MAX_TRACERS) break;
      const i = n * 6;
      this.tracerBuf[i] = t.x0; this.tracerBuf[i + 1] = 0.85; this.tracerBuf[i + 2] = t.z0;
      this.tracerBuf[i + 3] = t.x1; this.tracerBuf[i + 4] = 0.85; this.tracerBuf[i + 5] = t.z1;
      n++;
    }
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.setDrawRange(0, n * 2);
    this.tracerLines.visible = n > 0;
  }

  _shoot(car, w, view) {
    for (let p = 0; p < (w.pellets || 1); p++) {
      const yaw = car.yaw + (Math.random() - 0.5) * 2 * w.spread;
      const x0 = car.x + Math.sin(yaw) * car.radius;
      const z0 = car.z + Math.cos(yaw) * car.radius;
      const hit = this._trace(x0, z0, yaw, w.range, view, car.id);
      this.tracers.push({ x0, z0, x1: hit.x, z1: hit.z, life: TRACER_LIFE });
      if (hit.on >= 0) this.spark(hit.x, hit.z, 0.5);
    }
    this.scene.kick(0.02);
  }

  /** the same things the server's ray stops on: cars, wrecks and the scenery */
  _trace(ox, oz, yaw, range, view, shooterId) {
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    let best = range, on = -1;
    const test = (cx, cz, r, id) => {
      const mx = cx - ox, mz = cz - oz;
      const along = mx * dx + mz * dz;
      if (along < 0 || along > best) return;
      const perp2 = mx * mx + mz * mz - along * along;
      if (perp2 > r * r) return;
      const t = along - Math.sqrt(Math.max(0, r * r - perp2));
      if (t >= 0 && t < best) { best = t; on = id; }
    };
    for (const c of view.cars) if (c.id !== shooterId && !c.dead && !c.finished) test(c.x, c.z, c.radius, c.id);
    for (const wreck of view.wrecks || []) test(wreck.x, wreck.z, (wreck.r || 1.2), -1);
    for (const o of this.track.obstacles) test(o.x, o.z, o.r, -1);
    return { x: ox + dx * best, z: oz + dz * best, on };
  }

  // --- mines sitting in the road; they pulse once they are live
  _mines(view, dt) {
    const seen = new Set();
    for (const e of view.entities || []) {
      if (e.kind !== 1) continue;
      seen.add(e.id);
      let mesh = this.mines.get(e.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.mineGeo, this.mineMat.clone());
        mesh.castShadow = !isLite();
        this.group.add(mesh);
        this.mines.set(e.id, mesh);
      }
      mesh.position.set(e.x, 0.18, e.z);
      mesh.material.emissiveIntensity = e.armed ? 0.5 + Math.sin(performance.now() / 120) * 0.45 : 0.08;
    }
    for (const [id, mesh] of this.mines) {
      if (seen.has(id)) continue;
      this.group.remove(mesh);
      this.mines.delete(id);
    }
    void dt;
  }

  // --- explosions: a fireball and a ring that runs out from it
  boom(x, z, size = 1) {
    const flash = new THREE.Mesh(this.flashGeo, this.flashMat.clone());
    flash.position.set(x, 1.1, z);
    flash.scale.setScalar(size * 2.4);
    this.group.add(flash);
    const ring = new THREE.Mesh(this.blastGeo, new THREE.MeshBasicMaterial({ color: 0xffb03a, transparent: true, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.2, z);
    this.group.add(ring);
    this.blasts.push({ flash, ring, t: 0, life: 0.65, size });
    this.scene.kick(Math.min(1.2, 0.5 * size));
  }

  spark(x, z, size = 0.4) {
    const flash = new THREE.Mesh(this.flashGeo, this.flashMat.clone());
    flash.position.set(x, 0.85, z);
    flash.scale.setScalar(size);
    this.group.add(flash);
    this.blasts.push({ flash, ring: null, t: 0, life: 0.12, size });
  }

  _blasts(dt) {
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t += dt;
      const u = b.t / b.life;
      if (u >= 1) {
        this.group.remove(b.flash);
        if (b.ring) this.group.remove(b.ring);
        this.blasts.splice(i, 1);
        continue;
      }
      b.flash.material.opacity = 1 - u;
      b.flash.scale.setScalar(b.size * (2.4 + u * 3));
      if (b.ring) {
        b.ring.scale.setScalar(1 + u * 9 * b.size);
        b.ring.material.opacity = 0.7 * (1 - u);
      }
    }
  }

  // --- a hurt car trails smoke, and a nitro bottle burns out of the back
  _smoke(view, dt) {
    if (isLite()) return;
    for (const car of view.cars) {
      if (car.dead) continue;
      const hurt = 1 - car.hull / Math.max(1, car.maxHull);
      if (hurt > 0.55 && Math.random() < hurt * dt * 9) {
        this._puff(car.x - Math.sin(car.yaw) * 1.6, car.z - Math.cos(car.yaw) * 1.6, 0x2a2622, 0.8, 1.1);
      }
      if (car.nitro && Math.random() < dt * 30) {
        this._puff(car.x - Math.sin(car.yaw) * 2.2, car.z - Math.cos(car.yaw) * 2.2, 0x4ad6ff, 0.45, 0.25);
      }
      if (car.sliding && Math.random() < dt * 14) {
        this._puff(car.x, car.z, 0x7a6b55, 0.5, 0.5);
      }
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i];
      s.t += dt;
      if (s.t >= s.life) { this.group.remove(s.mesh); this.smoke.splice(i, 1); continue; }
      const u = s.t / s.life;
      s.mesh.position.y += dt * 2.2;
      s.mesh.scale.setScalar(s.size * (1 + u * 2.2));
      s.mesh.material.opacity = 0.55 * (1 - u);
    }
  }

  _puff(x, z, colour, size, life) {
    if (this.smoke.length > 70) return;
    const mesh = new THREE.Mesh(this.flashGeo, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.55 }));
    mesh.position.set(x, 0.7, z);
    mesh.scale.setScalar(size);
    this.group.add(mesh);
    this.smoke.push({ mesh, t: 0, life, size });
  }
}
