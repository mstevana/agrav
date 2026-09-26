// ============================================================================
// AGRAV — craft preview: the selected hull on a turntable in the lobby.
//
// It draws into its own small canvas with its own renderer. The lobby panels
// sit over the track backdrop behind a backdrop blur, so a craft drawn into
// the main canvas under them would come out blurred along with the track.
//
// A second context is not free, and the lifecycle is built around that:
//
// - Every hull wears five 1024² maps, about 27 MB with mipmaps. The preview
//   draws with its own copies at half size, so a player flicking through all
//   six craft costs the lobby about 40 MB rather than 160.
// - Leaving the lobby releases the context outright (release()), so none of
//   it is held through a race, which on a phone is where memory runs out.
// - The craft prototypes -- geometry, some materials, the glow sprite -- are
//   still shared with the race, and three hangs a dispose listener on every
//   one of those a renderer touches. Left there, each released renderer would
//   stay reachable through them, a dead renderer leaked per lobby visit. So
//   the preview notes exactly which listeners its renderer added and takes
//   them off again on release. It never disposes anything it does not own:
//   that would release the race's own uploaded copies with it.
// ============================================================================

import * as THREE from 'three';
import { buildCraft, animateCraft } from './vehicle.js';

const SPIN = 0.55;          // rad/s: one turn in a little over eleven seconds
const RESUME = 1500;        // ms after a drag lets go before the turntable takes over again
const POP = 0.35;           // s for a newly picked craft to settle onto the pad
const ELEVATION = 0.3;      // rad the camera looks down from: enough to read the top of the hull
const FOV = 28;
const MAP = 512;            // largest map edge the preview uploads; the stage is under 200 px tall
const WATCH = 3;            // renders after a swap to watch for listeners, in case an upload is deferred
// Engines ticking over, as on the grid. Any throttle at all lights the full white-hot racing plume,
// which is longer than some hulls and runs off the side of a stage this size when the craft is side-on.
const IDLE = { throttle: false, abL: false, abR: false, boost: false, speedFrac: 0, dead: false };

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class CraftPreview {
  /**
   * @param stage the element holding the preview canvas; it takes the drags, since the canvas
   *              itself is swapped for a fresh one whenever a context is released
   * @param opts { lite: software-renderer build, reducedMotion(): whether to hold the turntable still }
   */
  constructor(stage, { lite = false, reducedMotion = () => false } = {}) {
    this.stage = stage;
    this.canvas = stage.querySelector('canvas');
    this.lite = lite;
    this.reducedMotion = reducedMotion;
    this.want = null;
    this.yaw = -0.7;           // start on the three-quarter front, the flattering side
    this.t = 0;
    this.dragging = false;
    this.resumeAt = 0;
    this._reset();
    this._bindDrag();
  }

  /** pick the craft to show; cheap to call with the same id on every lobby update */
  show(vehicleId) { this.want = vehicleId; }

  /** one frame, called only while the lobby is on screen */
  render(dt) {
    if (!this.want) return;
    if (!this.renderer) this._init();
    if (!this.renderer) return;
    if (this.current?.def.id !== this.want) this._swap(this.want);
    if (!this._resize()) return;   // not laid out yet

    const still = this.reducedMotion();
    if (!still && !this.dragging && performance.now() > this.resumeAt) this.yaw += dt * SPIN;
    this.t += dt;
    this.pop = Math.min(1, this.pop + dt / POP);
    const e = 1 - Math.pow(1 - this.pop, 3);
    this.turntable.rotation.y = this.yaw;
    this.turntable.scale.setScalar(0.84 + 0.16 * e);
    const c = this.current, m = c.preview;
    // the hover: a slow bob and the faintest roll, which is what makes it read as floating
    c.group.position.y = m.lift + (still ? 0 : Math.sin(this.t * 1.7) * 0.07);
    c.group.rotation.z = still ? 0 : Math.sin(this.t * 0.9) * 0.025;
    animateCraft(c, IDLE, dt);

    // ease the camera between hull sizes rather than cutting
    this.dist += (m.dist - this.dist) * (1 - Math.exp(-dt * 8));
    this.camera.position.set(0, m.lookY + this.dist * Math.sin(ELEVATION), this.dist * Math.cos(ELEVATION));
    this.camera.lookAt(0, m.lookY, 0);

    const noted = this.watch > 0 ? this._noteListeners() : null;
    this.renderer.render(this.scene, this.camera);
    if (noted) { noted(); this.watch--; }
  }

  /**
   * Give the context back: called on leaving the lobby. The next render builds everything again,
   * which costs a moment on returning to the lobby and nothing at all during the race.
   */
  release() {
    if (!this.renderer) return;
    for (const [obj, fn] of this.hooks) obj.removeEventListener('dispose', fn);
    for (const t of this.shrunk.values()) t.dispose();
    for (const m of this.owned.values()) m.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this._freshCanvas();
    this._reset();
  }

  _reset() {
    this.renderer = null;
    this.scene = null;
    this.crafts = new Map();   // vehicle id -> built craft, so flicking back and forth never rebuilds
    this.current = null;
    this.owned = new Map();    // shared material -> this preview's copy, wearing the small maps
    this.shrunk = new Map();   // shared texture -> its small copy
    this.hooks = [];           // [object, listener] this renderer hung on things it does not own
    this.watch = 0;
    this.pop = 1;
    this.dist = 0;
    this.w = 0; this.h = 0;
  }

  // A context that has been lost cannot be had again from the same canvas, so a released or lost
  // context always comes back on a new one.
  _freshCanvas() {
    const fresh = this.canvas.cloneNode(false);
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
  }

  _init() {
    let r;
    try {
      r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !this.lite, alpha: true });
    } catch { this.want = null; return; }   // no second context to be had: the cards still work
    r.setPixelRatio(this.lite ? 1 : Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.setClearColor(0x000000, 0);   // clear to nothing, so the panel's own blurred backdrop is the background
    // Lost without being asked (the browser reclaiming memory): same as a release, minus the context
    // call, which there is no longer a context for.
    this.canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      if (this.renderer !== r) return;
      for (const [obj, fn] of this.hooks) obj.removeEventListener('dispose', fn);
      this._freshCanvas();
      this._reset();
    }, { once: true });
    this.renderer = r;

    const scene = new THREE.Scene();
    scene.environment = studio(r);
    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x0c0e16, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(4, 7, 5); scene.add(key);
    this.rim = new THREE.DirectionalLight(0xffffff, 1.6); this.rim.position.set(-5, 3, -6); scene.add(this.rim);
    this.pad = pad(); scene.add(this.pad);
    this.turntable = new THREE.Group(); scene.add(this.turntable);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(FOV, 2, 0.1, 200);
    this.w = this.h = 0;
    this.watch = WATCH;
  }

  _swap(id) {
    if (this.current) this.turntable.remove(this.current.group);
    let c = this.crafts.get(id);
    if (!c) { c = buildCraft(id); this._own(c); measure(c); this.crafts.set(id, c); }
    this.turntable.add(c.group);
    this.current = c;
    this.rim.color.setHex(c.def.colour);
    this.pad.material.color.setHex(c.def.colour);
    this.pad.scale.setScalar(c.preview.reach * 2.3);   // puts the ring on the disc the hull sweeps
    this.pop = 0;
    this.watch = WATCH;
    this._fit();
    if (!this.dist) this.dist = c.preview.dist;
  }

  /** swap every material carrying a big map for this preview's own copy wearing small ones */
  _own(craft) {
    const big = (v) => v?.isDataTexture && v.image?.data instanceof Uint8Array && v.image.width > MAP;
    const own = (m) => {
      if (!Object.values(m).some(big)) return m;
      let mine = this.owned.get(m);
      if (!mine) {
        mine = m.clone();
        for (const [k, v] of Object.entries(m)) if (big(v)) mine[k] = this._shrink(v);
        this.owned.set(m, mine);
      }
      return mine;
    };
    craft.group.traverse((o) => {
      if (!o.isMesh || o.isSprite || !o.material) return;
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
    });
  }

  _shrink(tex) {
    let t = this.shrunk.get(tex);
    if (t) return t;
    let { data, width: w, height: h } = tex.image;
    while (w > MAP) ({ data, w, h } = halve(data, w, h));
    t = new THREE.DataTexture(data, w, h, tex.format, tex.type);
    // Field by field rather than clone(): a clone shares the source image, and giving it the small
    // pixels would hand them to the race's own texture as well.
    for (const k of ['wrapS', 'wrapT', 'magFilter', 'minFilter', 'generateMipmaps', 'anisotropy', 'colorSpace', 'flipY', 'unpackAlignment']) t[k] = tex[k];
    t.repeat.copy(tex.repeat); t.offset.copy(tex.offset); t.center.copy(tex.center); t.rotation = tex.rotation;
    t.needsUpdate = true;
    this.shrunk.set(tex, t);
    return t;
  }

  /**
   * Snapshot the dispose listeners on everything the scene draws with, and return a function that
   * records whichever the render in between added. Nothing else runs between the two -- script is
   * single-threaded and the main renderer is not drawing -- so whatever appears is this renderer's.
   */
  _noteListeners() {
    const before = new Map();
    this.scene.traverse((o) => { for (const r of resourcesOf(o)) if (!before.has(r)) before.set(r, (r._listeners?.dispose || []).slice()); });
    return () => {
      for (const [r, had] of before) for (const fn of r._listeners?.dispose || []) if (!had.includes(fn)) this.hooks.push([r, fn]);
    };
  }

  _resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return false;
    if (w !== this.w || h !== this.h) {
      this.w = w; this.h = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this._fit();
    }
    return true;
  }

  /**
   * Distance that keeps the whole turn in frame, pad included. The hull sweeps a disc of radius
   * `reach` as it spins and the pad's ring sits on that disc at floor level, so the frame has to
   * hold the ring's near edge at the bottom and the hull's top over its far edge at the top; looking
   * at half the hull's height balances the two. Across, the sides of the sweep have to fit, with a
   * little over for the idling flames. The near edge is also the nearest point to the camera, so
   * it is allowed for in the distance rather than only in the angle.
   */
  _fit() {
    const c = this.current;
    if (!c || !this.w) return;
    const m = c.preview;
    const v = THREE.MathUtils.degToRad(FOV) / 2;
    const hz = Math.atan(Math.tan(v) * this.camera.aspect);
    const cs = Math.cos(ELEVATION), sn = Math.sin(ELEVATION);
    m.lookY = m.top / 2;
    const tall = (m.top / 2 * cs + m.reach * sn) / Math.tan(v) + m.reach * cs;
    const across = m.reach * 1.15 / Math.tan(hz);
    m.dist = Math.max(tall, across) * 1.04;
  }

  _bindDrag() {
    // drag sideways to turn it by hand; vertical drags stay with the page, which scrolls on a phone
    let id = null, x0 = 0;
    const s = this.stage;
    s.addEventListener('pointerdown', (e) => { id = e.pointerId; x0 = e.clientX; this.dragging = true; s.setPointerCapture?.(id); });
    s.addEventListener('pointermove', (e) => { if (e.pointerId !== id) return; this.yaw += (e.clientX - x0) * 0.012; x0 = e.clientX; });
    const end = (e) => { if (e.pointerId !== id) return; id = null; this.dragging = false; this.resumeAt = performance.now() + RESUME; };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
  }
}

/** every geometry, material and texture an object draws with: what a renderer hangs listeners on */
function resourcesOf(o) {
  const out = [];
  if (o.geometry) out.push(o.geometry);
  const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
  for (const m of mats) {
    out.push(m);
    for (const v of Object.values(m)) if (v?.isTexture) out.push(v);
    if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u?.value?.isTexture) out.push(u.value);
  }
  return out;
}

/** a 2×2 box filter over RGBA bytes: half the edge, a quarter of the memory */
function halve(data, w, h) {
  const W = w >> 1, H = h >> 1, out = new Uint8Array(W * H * 4), row = w * 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * 2 * w + x * 2) * 4, o = (y * W + x) * 4;
    for (let c = 0; c < 4; c++) out[o + c] = (data[i + c] + data[i + 4 + c] + data[i + row + c] + data[i + row + 4 + c] + 2) >> 2;
  }
  return { data: out, w: W, h: H };
}

/**
 * Size a craft up from its solid hull. The plumes, glow sprites and trails reach well behind the
 * nozzles and would make every craft frame as a long thin comet, so only opaque meshes count.
 * The hull is recentred on the turntable's axis and lifted to hover over the pad.
 */
function measure(c) {
  c.group.updateMatrixWorld(true);
  const box = new THREE.Box3(), part = new THREE.Box3();
  c.group.traverse((o) => {
    if (!o.isMesh || o.isSprite || !o.geometry || o.material?.transparent || o.material?.isShaderMaterial) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
  });
  const ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  c.group.position.set(-ctr.x, 0, -ctr.z);
  const clear = Math.max(0.35, size.y * 0.35);   // daylight between the skirts and the pad
  c.preview = { lift: clear - box.min.y, reach: Math.hypot(size.x, size.z) / 2, top: clear + size.y, lookY: 0, dist: 0 };
}

/**
 * A dark room with a bright strip overhead, a cool fill to one side and a cyan rim behind: enough
 * for the metal and the canopy glass to have something to reflect, which lights alone do not give.
 * Built in this renderer's own context, since an environment map cannot cross contexts.
 */
function studio(renderer) {
  const room = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const pos = geo.attributes.position, col = [];
  const floor = new THREE.Color(0x05060c), band = new THREE.Color(0x1b3448), top = new THREE.Color(0x56687c), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    c.copy(floor).lerp(band, smooth(-0.15, 0.2, y)).lerp(top, smooth(0.35, 1, y));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  room.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const box = (w, h, x, y, z, colour) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); room.add(m);
  };
  box(9, 2.5, 0, 8.5, 1.5, 0xffffff);    // the overhead strip: the long highlight down the spine
  box(4, 4, 7.5, 2, 5, 0xbcd8f0);        // cool fill, key side
  box(3, 5, -7, 1, -5, 0x2df1ff);        // the game's cyan, behind
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(room, 0.03).texture;
  pm.dispose();
  room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return tex;
}

/** the hover pad: a soft pool of shadow under the hull and a thin ring of light round it, tinted per craft */
function pad() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const shade = g.createRadialGradient(128, 128, 0, 128, 128, 118);
  shade.addColorStop(0, 'rgba(0,0,0,0.6)'); shade.addColorStop(0.6, 'rgba(0,0,0,0.25)'); shade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = shade; g.fillRect(0, 0, 256, 256);
  g.shadowColor = '#fff'; g.shadowBlur = 10;
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2.5;
  g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 1;
  g.beginPath(); g.arc(128, 128, 96, 0, Math.PI * 2); g.stroke();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}
