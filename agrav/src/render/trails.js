// ============================================================================
// AGRAV — engine trails in the Homeworld manner: a ribbon of the last second
// of each engine's path, billboarded toward the camera. The moving part is
// emitted from the tip of the exhaust plume and left in world space, so it
// stays where the craft has been, tapering and closing to a point as it goes.
//
// Ahead of that the same ribbon carries two more points, pinned to the plume
// itself: one at the tip and one at the nozzle. The fire is transparent by its
// tip, so a trail that merely began there started in the middle of a gap; this
// bridges the length of the flame and fades out into it, since the fire is
// opaque at the nozzle and has nothing left to hide at the far end. It is the
// one ribbon throughout, so the join costs no seam and no second material.
// ============================================================================

import * as THREE from 'three';

const LIFE = 1.0;          // seconds a point lives
const MAX = 48;            // history points kept per trail
const MIN_STEP = 0.35;     // metres between samples
const TAIL = 0.85;         // the last stretch of a point's life, over which the ribbon closes to nothing
const HEAD = 2;            // the live points bridging the flame: its tip, then its nozzle
const NOZZLE_FADE = 0.8;   // how far down the fade the nozzle end sits, so the bridge dies inside the fire

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const VERT = `
attribute float age; attribute float side;
varying float vAge; varying float vSide;
void main() {
  vAge = age; vSide = side;
  // position already carries the ribbon corner: the width and the billboard are applied on the CPU
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = `
uniform vec3 color; uniform float intensity;
varying float vAge; varying float vSide;
void main() {
  float across = 1.0 - abs(vSide);
  float a = pow(across, 1.4) * pow(1.0 - vAge, 1.5) * intensity;
  vec3 col = mix(color, vec3(1.0, 0.98, 0.95), (1.0 - vAge) * 0.35 * across);
  gl_FragColor = vec4(col * a * 1.8, a);
}`;

export class EngineTrail {
  constructor(colour, width = 0.55) {
    this.pts = [];              // { p: Vector3, t: spawn time }
    this.width = width;
    this.geo = new THREE.BufferGeometry();
    const CAP = MAX + HEAD;
    this.pos = new Float32Array(CAP * 2 * 3); this.age = new Float32Array(CAP * 2); this.side = new Float32Array(CAP * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('age', new THREE.BufferAttribute(this.age, 1));
    this.geo.setAttribute('side', new THREE.BufferAttribute(this.side, 1));
    const idx = []; for (let i = 0; i < CAP - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { color: { value: new THREE.Color(colour) }, intensity: { value: 0.9 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    }));
    this.mesh.frustumCulled = false;
    this.mesh.userData.noShadow = true;
    this._tmp = new THREE.Vector3(); this._dir = new THREE.Vector3(); this._toCam = new THREE.Vector3(); this._sideV = new THREE.Vector3();
  }

  /**
   * Grow and rebuild the ribbon. `nozzle` and `tip` are the ends of the flame this frame, `emit` the
   * current thrust -- at zero the fire is out, so the bridge goes with it and the trail stops
   * growing. History runs oldest first; the two live points continue it forward into the flame.
   */
  update(nozzle, tip, emit, camera, now) {
    const pts = this.pts;
    const lit = emit > 0.05;
    if (lit && (!pts.length || pts[pts.length - 1].p.distanceToSquared(tip) > MIN_STEP * MIN_STEP)) {
      pts.push({ p: tip.clone(), t: now, e: emit });
      if (pts.length > MAX) pts.shift();
    }
    while (pts.length && now - pts[0].t > LIFE) pts.shift();
    const h = pts.length;
    const n = h + (lit ? HEAD : 0);
    if (n < 2) { this.geo.setDrawRange(0, 0); return; }
    // the width a freshly laid point has; the bridge holds it so the two meet without a step
    const live = this.width * (0.6 + 0.4 * emit);
    const at = (i) => (i < h ? pts[i].p : i === h ? tip : nozzle);
    for (let i = 0; i < n; i++) {
      const p = at(i);
      // ribbon side vector: perpendicular to both the path direction and the view direction
      this._dir.subVectors(at(Math.min(n - 1, i + 1)), at(Math.max(0, i - 1)));
      if (this._dir.lengthSq() < 1e-6) this._dir.set(0, 0, 1);
      this._toCam.subVectors(camera.position, p);
      this._sideV.crossVectors(this._dir, this._toCam).normalize();
      let age, w;
      if (i < h) {
        age = Math.min(1, (now - pts[i].t) / LIFE);
        // a slight taper along most of the ribbon, then closed off to a point over the last of it,
        // so the trail narrows away rather than ending in a blunt stub that simply fades
        w = this.width * (1 - 0.35 * age) * (1 - smoothstep(TAIL, 1, age)) * (0.6 + 0.4 * pts[i].e);
      } else {
        // the bridge: full at the tip, where the fire has gone, fading back into the bright part
        age = i === h ? 0 : NOZZLE_FADE;
        w = live;
      }
      for (const [k, sgn] of [[0, -1], [1, 1]]) {
        const v = i * 2 + k;
        this.pos[v * 3] = p.x + this._sideV.x * w * sgn; this.pos[v * 3 + 1] = p.y + this._sideV.y * w * sgn; this.pos[v * 3 + 2] = p.z + this._sideV.z * w * sgn;
        this.age[v] = age; this.side[v] = sgn;
      }
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.age.needsUpdate = true; this.geo.attributes.side.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }

  dispose() { this.geo.dispose(); this.mesh.material.dispose(); }
}
