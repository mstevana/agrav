// ============================================================================
// The view: a perspective camera looking straight down at the ground plane.
//
// That is where the parallax comes from and why the camera is not orthographic.
// The road is at height zero and everything else — barriers, car stacks, cranes,
// the crusher — is extruded up toward the lens, so a tall thing leans away from
// the middle of the screen and slides against the ground as the camera follows
// the car. Nothing has to be faked in layers; the depth is real.
//
// The camera never rotates. North is up all race, so the minimap and the road
// read the same way every lap and you can see who is behind you without the
// world spinning. It follows the car with a look-ahead along its velocity and
// pulls back as the speed rises.
// ============================================================================

import * as THREE from 'three';

const LITE = new URLSearchParams(location.search).get('lite') === '1';
export const isLite = () => LITE;

const HEIGHT_BASE = 64;        // metres above the road at rest
const HEIGHT_PER_SPEED = 0.62; // and how much further back it pulls with speed
const LOOK_AHEAD = 0.55;       // seconds of velocity the camera leads by
const FOLLOW_LAG = 7.5;        // how briskly the camera catches its target

export class Scene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !LITE, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, LITE ? 1 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = !LITE;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.three = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 3000);
    this.camera.up.set(0, 0, -1);            // north up: -z points to the top of the screen

    this.target = new THREE.Vector3();
    this.eye = new THREE.Vector3(0, HEIGHT_BASE, 0);
    this.shake = 0;
    this.ready = false;
    this._resize();
    addEventListener('resize', () => this._resize());
  }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** the lights and the sky a theme asks for; the track's own geometry is added by track.js */
  build(theme) {
    for (let i = this.three.children.length - 1; i >= 0; i--) this.three.remove(this.three.children[i]);
    this.three.background = new THREE.Color(theme.sky);
    this.three.fog = LITE ? null : new THREE.Fog(theme.sky, 260, 900);

    const hemi = new THREE.HemisphereLight(theme.skyLight, theme.groundLight, 1.0);
    this.three.add(hemi);
    const sun = new THREE.DirectionalLight(theme.sunColour, 1.45);
    sun.position.set(-160, 260, -120);
    if (!LITE) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      const d = 180;
      Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 40, far: 620 });
      sun.shadow.bias = -0.0012;
    }
    this.three.add(sun);
    this.three.add(sun.target);
    this.sun = sun;
    this.ready = true;
  }

  /** put the camera over a car, leading it by where it is going */
  follow(car, dt, instant = false) {
    const lead = Math.min(46, LOOK_AHEAD * Math.hypot(car.vx || 0, car.vz || 0));
    const speed = Math.hypot(car.vx || 0, car.vz || 0);
    const fx = car.x + (car.vx || 0) * LOOK_AHEAD * (lead > 0 ? 1 : 0);
    const fz = car.z + (car.vz || 0) * LOOK_AHEAD * (lead > 0 ? 1 : 0);
    const k = instant ? 1 : Math.min(1, FOLLOW_LAG * dt);
    this.target.x += (fx - this.target.x) * k;
    this.target.z += (fz - this.target.z) * k;
    const height = HEIGHT_BASE + speed * HEIGHT_PER_SPEED;
    this.eye.y += (height - this.eye.y) * (instant ? 1 : Math.min(1, 3 * dt));

    let sx = 0, sz = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.4);
      const a = this.shake * 1.6;
      sx = (Math.random() - 0.5) * a; sz = (Math.random() - 0.5) * a;
    }
    this.camera.position.set(this.target.x + sx, this.eye.y, this.target.z + sz + 0.001);
    this.camera.lookAt(this.target.x + sx, 0, this.target.z + sz);
    if (this.sun) {
      this.sun.position.set(this.target.x - 160, 260, this.target.z - 120);
      this.sun.target.position.set(this.target.x, 0, this.target.z);
    }
  }

  kick(amount) { this.shake = Math.min(1.6, this.shake + amount); }

  render() { if (this.ready) this.renderer.render(this.three, this.camera); }

  /** how many metres of ground the screen is showing, for the minimap and culling */
  viewRadius() {
    const h = this.eye.y;
    return h * Math.tan(this.camera.fov / 2 * Math.PI / 180) * Math.max(1, this.camera.aspect);
  }
}
