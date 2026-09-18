// ============================================================================
// AGRAV — procedural craft in the WipEout idiom. Each ship is a table of
// lofted parts (superellipse hulls, airfoil wings, fins, nacelles) merged per
// material: the painted livery (atlas with albedo / normal / bump /
// roughness / emissive), engine alloy, tinted canopy glass and unlit lights.
// Panel grooves are pressed into the mesh along the same seams the livery
// paints. Facing -z, base at y = 0, inside the 6.4 × 3.2 m collision box.
// ============================================================================

import * as THREE from 'three';
import { mergeGeometries } from '../../../shared/gfx/merge.js';
import { VEHICLES, BASE } from '../../../shared/agrav/vehicles.js';
import { glowSprite } from './textures.js';
import { loft, displaceAlongNormal } from './props.js';
import { metalPlateSet, standard } from './surfaces.js';
import { liverySet, ATLAS } from './livery.js';
import { fbm3 } from './noise.js';
import { makePlume, animatePlume, plumeTip } from './exhaust.js';
import { EngineTrail } from './trails.js';

const protos = new Map();
const L = BASE.length, W = BASE.width;

// ------------------------------------------------------------ part makers --

/** fuselage-type body along z: stations [z, y, halfWidth, halfHeight, k, flat] */
const body = (rows, uv = ATLAS.fuselage, segments = 28) => loft(rows.map(([p, b0, w, h, k, flat]) => ({ p, b0, w, h, k: k ?? 2.6, flat: flat ?? 0.35 })), { axis: 'z', segments, uv });
/** a nacelle: round body along z with a pinched intake and an open-looking nozzle */
const nacelle = (x, y, z0, z1, r, uv = ATLAS.nacelle) => {
  const g = loft([
    { p: z0, a0: x, b0: y, w: r * 0.55, h: r * 0.55, k: 2 }, { p: z0 + 0.25, a0: x, b0: y, w: r * 0.9, h: r * 0.9, k: 2 },
    { p: z0 + (z1 - z0) * 0.5, a0: x, b0: y, w: r, h: r, k: 2.2 }, { p: z1 - 0.35, a0: x, b0: y, w: r * 0.95, h: r * 0.95, k: 2.2 },
    { p: z1, a0: x, b0: y, w: r * 0.8, h: r * 0.8, k: 2 }
  ], { axis: 'z', segments: 18, uv });
  return g;
};
/** a wing spanning x0..x1 at height y: chord centre zc(x) and chord c(x) as functions of the span fraction */
const wing = (x0, x1, y, zc, c, t = 0.1, uv = ATLAS.wing, n = 7) => {
  const st = [];
  for (let i = 0; i <= n; i++) { const f = i / n, x = x0 + (x1 - x0) * f, s = Math.abs(2 * f - 1); st.push({ p: x, a0: zc(s), b0: y, w: c(s) / 2, h: t * (1 - s * 0.4), k: 2.2, flat: 0.5 }); }
  return loft(st, { axis: 'x', segments: 14, uv });
};
/** a fin rising from y0 to y1 at x, chord centre zc(f) and chord c(f) over the height fraction */
const fin = (x, z, y0, y1, c0, c1, sweep, t = 0.09, uv = ATLAS.fin) => loft([
  { p: y0, a0: z, b0: x, w: c0 / 2, h: t, k: 2.2 }, { p: y0 + (y1 - y0) * 0.5, a0: z + sweep * 0.5, b0: x, w: (c0 + c1) / 4, h: t * 0.8, k: 2.2 }, { p: y1, a0: z + sweep, b0: x, w: c1 / 2, h: t * 0.5, k: 2.2 }
], { axis: 'y', segments: 12, uv });
/** the canopy bubble */
const canopy = (z, len, w, h, y) => loft([
  { p: z - len / 2, b0: y, w: w * 0.3, h: h * 0.25, k: 2 }, { p: z - len * 0.2, b0: y, w: w, h, k: 2 }, { p: z + len * 0.2, b0: y, w: w * 0.95, h: h * 0.9, k: 2 }, { p: z + len / 2, b0: y, w: w * 0.5, h: h * 0.3, k: 2 }
], { axis: 'z', segments: 16, uv: ATLAS.misc });
/** a dorsal spine running back from the canopy to the fin root */
const spine = (z0, z1, y, w, h) => loft([{ p: z0, b0: y, w: w * 0.3, h: h * 0.3, k: 2.2 }, { p: z0 + 0.6, b0: y + h * 0.3, w, h, k: 2.4, flat: 0.8 }, { p: z1 - 0.4, b0: y + h * 0.3, w: w * 0.9, h: h * 0.9, k: 2.4, flat: 0.8 }, { p: z1, b0: y, w: w * 0.4, h: h * 0.3, k: 2.2 }], { axis: 'z', segments: 12, uv: ATLAS.misc });
/** a slab of armour or an intake: a squared-off loft along z */
const slab = (x, y, z0, z1, w, h, uv = ATLAS.misc) => loft([{ p: z0, a0: x, b0: y, w: w * 0.7, h: h * 0.7, k: 4 }, { p: z0 + 0.15, a0: x, b0: y, w, h, k: 4 }, { p: z1 - 0.15, a0: x, b0: y, w, h, k: 4 }, { p: z1, a0: x, b0: y, w: w * 0.85, h: h * 0.85, k: 4 }], { axis: 'z', segments: 12, uv });

// --------------------------------------------------------------- the six --
// Each returns { livery: [geo], metal: [geo], glass: [geo], nozzles: [{x,y,z,r}], flaps: {x, y, z, w}, canopyZ }

const HULLS = {
  kestrel() {   // slim centre body, long forward-swept pontoons, thin joining wing, twin small nozzles
    const livery = [
      body([[-3.15, 0.42, 0.1, 0.06], [-2.5, 0.42, 0.32, 0.18], [-1.4, 0.45, 0.5, 0.3], [0, 0.48, 0.58, 0.34], [1.4, 0.48, 0.56, 0.32], [2.6, 0.46, 0.46, 0.28], [3.05, 0.44, 0.3, 0.22]]),
      wing(-1.35, 1.35, 0.5, () => 1.0, (s) => 0.9 - s * 0.1, 0.07),
      fin(0, 2.3, 0.7, 1.25, 0.9, 0.35, 0.35), spine(-0.2, 2.4, 0.78, 0.16, 0.12)
    ];
    for (const sd of [-1, 1]) livery.push(loft([{ p: -2.9, a0: sd * 1.3, b0: 0.32, w: 0.08, h: 0.06, k: 2 }, { p: -2.2, a0: sd * 1.32, b0: 0.34, w: 0.26, h: 0.2, k: 2.4, flat: 0.4 }, { p: 0, a0: sd * 1.34, b0: 0.36, w: 0.3, h: 0.24, k: 2.6, flat: 0.4 }, { p: 1.8, a0: sd * 1.32, b0: 0.36, w: 0.26, h: 0.22, k: 2.6, flat: 0.4 }, { p: 2.4, a0: sd * 1.3, b0: 0.36, w: 0.14, h: 0.14, k: 2 }], { axis: 'z', segments: 16, uv: ATLAS.pontoon }));
    return { livery, metal: [nacelle(-0.42, 0.44, 2.2, 3.25, 0.22), nacelle(0.42, 0.44, 2.2, 3.25, 0.22)], glass: [canopy(-1.0, 1.5, 0.28, 0.22, 0.74)], nozzles: [{ x: -0.42, y: 0.44, z: 3.25, r: 0.2 }, { x: 0.42, y: 0.44, z: 3.25, r: 0.2 }], flaps: { x: 1.0, y: 0.56, z: 1.35, w: 0.5 } };
  },
  talon() {     // short blunt nose, wide delta deck, one big engine with a broad slot, intakes beside the canopy
    const livery = [
      body([[-2.95, 0.4, 0.28, 0.1, 3.2, 0.5], [-2.2, 0.42, 0.85, 0.24, 3.2, 0.5], [-0.8, 0.44, 1.35, 0.32, 3.4, 0.55], [0.8, 0.44, 1.5, 0.34, 3.4, 0.55], [2.2, 0.44, 1.35, 0.32, 3.4, 0.55], [3.0, 0.44, 0.95, 0.28, 3.2, 0.5]], ATLAS.fuselage, 32),
      fin(-1.35, 2.2, 0.7, 1.05, 0.7, 0.3, 0.3, 0.08), fin(1.35, 2.2, 0.7, 1.05, 0.7, 0.3, 0.3, 0.08)
    ];
    const metal = [loft([{ p: 1.4, b0: 0.5, w: 0.7, h: 0.3, k: 3 }, { p: 2.4, b0: 0.5, w: 0.85, h: 0.32, k: 3.2 }, { p: 3.3, b0: 0.5, w: 0.8, h: 0.26, k: 3.2 }], { axis: 'z', segments: 20, uv: ATLAS.nacelle }), slab(-0.85, 0.66, -1.4, 0.3, 0.22, 0.14), slab(0.85, 0.66, -1.4, 0.3, 0.22, 0.14)];
    return { livery, metal, glass: [canopy(-1.5, 1.4, 0.34, 0.24, 0.7)], nozzles: [{ x: -0.35, y: 0.5, z: 3.3, r: 0.26 }, { x: 0.35, y: 0.5, z: 3.3, r: 0.26 }], flaps: { x: 1.1, y: 0.62, z: 2.2, w: 0.6 } };
  },
  vantage() {   // catamaran: two full hulls, a bridge deck with the canopy, pylon nacelles, forward planes
    const livery = [];
    for (const sd of [-1, 1]) livery.push(loft([{ p: -3.1, a0: sd * 1.05, b0: 0.36, w: 0.08, h: 0.06, k: 2 }, { p: -2.2, a0: sd * 1.06, b0: 0.38, w: 0.32, h: 0.24, k: 2.6, flat: 0.4 }, { p: -0.5, a0: sd * 1.08, b0: 0.4, w: 0.4, h: 0.3, k: 2.8, flat: 0.4 }, { p: 1.4, a0: sd * 1.08, b0: 0.4, w: 0.38, h: 0.3, k: 2.8, flat: 0.4 }, { p: 2.6, a0: sd * 1.06, b0: 0.4, w: 0.3, h: 0.24, k: 2.4 }, { p: 3.1, a0: sd * 1.04, b0: 0.4, w: 0.16, h: 0.16, k: 2 }], { axis: 'z', segments: 18, uv: ATLAS.pontoon }));
    livery.push(body([[-1.6, 0.6, 0.6, 0.08, 3.2, 0.3], [-0.8, 0.62, 1.1, 0.14, 3.4, 0.3], [0.6, 0.62, 1.15, 0.15, 3.4, 0.3], [2.0, 0.6, 1.0, 0.13, 3.4, 0.3], [2.6, 0.58, 0.8, 0.1, 3.2, 0.3]]));
    livery.push(wing(-1.3, 1.3, 0.42, () => -2.2, (s) => 0.5 - s * 0.15, 0.04));
    livery.push(fin(0, 2.3, 0.72, 1.15, 0.7, 0.3, 0.35, 0.08));
    return { livery, metal: [nacelle(-0.55, 0.85, 1.2, 3.2, 0.26), nacelle(0.55, 0.85, 1.2, 3.2, 0.26)], glass: [canopy(-0.4, 1.4, 0.3, 0.24, 0.76)], nozzles: [{ x: -0.55, y: 0.85, z: 3.2, r: 0.24 }, { x: 0.55, y: 0.85, z: 3.2, r: 0.24 }], flaps: { x: 1.0, y: 0.72, z: 1.9, w: 0.5 } };
  },
  bulwark() {   // heavy slab, stepped armour, ram nose, four stubby nozzles, low thick fin
    const livery = [
      body([[-3.05, 0.42, 0.55, 0.2, 3.4, 0.6], [-2.3, 0.44, 1.05, 0.36, 3.4, 0.6], [-0.9, 0.46, 1.42, 0.46, 3.6, 0.6], [0.9, 0.46, 1.48, 0.48, 3.6, 0.6], [2.3, 0.46, 1.36, 0.44, 3.6, 0.6], [3.1, 0.44, 1.1, 0.36, 3.4, 0.6]], ATLAS.fuselage, 32),
      fin(0, 2.1, 0.9, 1.4, 1.2, 0.7, 0.3, 0.18)
    ];
    const metal = [slab(0, 0.98, -1.2, 1.4, 1.15, 0.07), slab(-0.8, 0.9, -2.2, 0.6, 0.3, 0.1), slab(0.8, 0.9, -2.2, 0.6, 0.3, 0.1)];
    for (const x of [-1.05, -0.45, 0.45, 1.05]) metal.push(nacelle(x, 0.46, 2.5, 3.35, 0.2));
    return { livery, metal, glass: [canopy(-1.5, 1.3, 0.4, 0.2, 0.86)], nozzles: [-1.05, -0.45, 0.45, 1.05].map(x => ({ x, y: 0.46, z: 3.35, r: 0.18 })), flaps: { x: 1.25, y: 0.9, z: 2.2, w: 0.5 } };
  },
  reaper() {    // knife nose, forward-canted side fins, tall sharp tail, nacelles under the wings
    const livery = [
      body([[-3.2, 0.4, 0.05, 0.04], [-2.3, 0.42, 0.32, 0.2], [-0.9, 0.46, 0.68, 0.34], [0.6, 0.48, 0.84, 0.38], [2.0, 0.48, 0.74, 0.34], [3.05, 0.46, 0.48, 0.26]]),
      wing(-1.55, 1.55, 0.44, (s) => 1.1 + s * 0.5, (s) => 1.3 - s * 0.5, 0.09),
      fin(0, 2.35, 0.8, 1.55, 1.0, 0.3, 0.7, 0.09), spine(-0.4, 2.3, 0.84, 0.18, 0.14),
      fin(-1.1, 0.2, 0.5, 1.0, 0.7, 0.25, -0.5, 0.06), fin(1.1, 0.2, 0.5, 1.0, 0.7, 0.25, -0.5, 0.06)
    ];
    return { livery, metal: [nacelle(-0.95, 0.28, 1.1, 3.3, 0.28), nacelle(0.95, 0.28, 1.1, 3.3, 0.28), slab(-0.62, 0.5, -0.9, 0.5, 0.16, 0.12), slab(0.62, 0.5, -0.9, 0.5, 0.16, 0.12)], glass: [canopy(-1.2, 1.5, 0.3, 0.22, 0.78)], nozzles: [{ x: -0.95, y: 0.28, z: 3.3, r: 0.26 }, { x: 0.95, y: 0.28, z: 3.3, r: 0.26 }], flaps: { x: 1.2, y: 0.5, z: 1.9, w: 0.5 } };
  },
  corsair() {   // teardrop fuselage, swept wing, tall fin, nacelles blended into the wing roots
    const livery = [
      body([[-3.1, 0.42, 0.08, 0.06], [-2.1, 0.44, 0.44, 0.28], [-0.7, 0.48, 0.7, 0.4], [0.8, 0.5, 0.74, 0.4], [2.2, 0.48, 0.58, 0.32], [3.05, 0.46, 0.38, 0.24]]),
      wing(-1.55, 1.55, 0.44, (s) => 0.9 + s * 0.9, (s) => 1.9 - s * 1.1, 0.1),
      fin(0, 2.4, 0.85, 1.55, 0.95, 0.35, 0.6, 0.08), spine(-0.5, 2.4, 0.88, 0.2, 0.14)
    ];
    return { livery, metal: [nacelle(-0.72, 0.36, 0.9, 3.3, 0.3), nacelle(0.72, 0.36, 0.9, 3.3, 0.3), slab(-0.66, 0.55, -1.0, 0.3, 0.16, 0.12), slab(0.66, 0.55, -1.0, 0.3, 0.16, 0.12)], glass: [canopy(-1.25, 1.5, 0.32, 0.24, 0.8)], nozzles: [{ x: -0.72, y: 0.36, z: 3.3, r: 0.28 }, { x: 0.72, y: 0.36, z: 3.3, r: 0.28 }], flaps: { x: 1.2, y: 0.5, z: 1.75, w: 0.5 } };
  }
};

// panel seams the livery paints along v (fuselage region) — pressed into the mesh too
const SEAMS = [0.12, 0.3, 0.46, 0.62, 0.78, 0.9];
function pressPanels(geo, seed) {
  displaceAlongNormal(geo, (x, y, z, u, v) => {
    // only the fuselage region carries the seam list; other regions get the ripple alone
    let d = 0;
    if (v < 0.5) { const vv = v / 0.5; for (const s of SEAMS) { const t = Math.abs(vv - s); if (t < 0.012) d -= 0.012 * (1 - t / 0.012); } }
    return d + fbm3(x * 1.7 + seed, y * 1.7, z * 1.7, { octaves: 2, seed }) * 0.012;
  });
  return geo;
}

function prototype(def) {
  if (protos.has(def.id)) return protos.get(def.id);
  const parts = (HULLS[def.id] || HULLS.corsair)();
  const livery = standard(liverySet(def), { bumpScale: 0.02, normalScale: 0.9, metalness: 0.35, emissiveIntensity: 1.2 });
  const metal = standard(metalPlateSet(0x4a505c), { repeat: [2, 2], bumpScale: 0.02, metalness: 0.6, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b1424, roughness: 0.08, metalness: 0.9, emissive: 0x102040, emissiveIntensity: 0.3 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(pressPanels(mergeGeometries(parts.livery), def.id.length * 7), livery));
  g.add(new THREE.Mesh(mergeGeometries(parts.metal), metal));
  g.add(new THREE.Mesh(mergeGeometries(parts.glass), glass));
  // nozzle throats: dark rings that read as the engine bells
  const rings = parts.nozzles.map(n => { const r = new THREE.TorusGeometry(n.r * 0.9, n.r * 0.16, 6, 16); r.translate(n.x, n.y, n.z); return r; });
  g.add(new THREE.Mesh(mergeGeometries(rings), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.5, metalness: 0.8 })));
  g.userData.parts = parts;
  protos.set(def.id, g);
  return g;
}

/** @returns {{group, exhaust:[Sprite], flames:[Mesh], flapL, flapR, light, colour, def}} */
export function buildCraft(vehicleId) {
  const def = VEHICLES.find(v => v.id === vehicleId) || VEHICLES[5];
  const proto = prototype(def);
  const group = proto.clone();
  const parts = proto.userData.parts;
  const glow = glowSprite();
  const exhaust = [], flames = [];
  parts.nozzles.forEach((n, i) => {
    // a small hot glow at the throat, and the shader plume behind it
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff0d0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.set(n.x, n.y, n.z + 0.1); sp.scale.set(n.r * 3, n.r * 3, 1);
    group.add(sp); exhaust.push(sp);
    const plume = makePlume(def.colour, n.r, i * 3.7 + def.id.length);
    plume.position.set(n.x, n.y, n.z + 0.05); group.add(plume); flames.push(plume);
  });
  // airbrake panels hinge up from the wing / outrigger trailing edges
  const flapMat = new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.5, metalness: 0.4 });
  const fp = parts.flaps;
  const flapGeo = new THREE.BoxGeometry(fp.w, 0.05, 0.5); flapGeo.translate(0, 0, 0.25);
  const flapL = new THREE.Mesh(flapGeo, flapMat), flapR = new THREE.Mesh(flapGeo, flapMat);
  flapL.position.set(-fp.x, fp.y, fp.z); flapR.position.set(fp.x, fp.y, fp.z);
  group.add(flapL, flapR);
  // a point light under the hull washes the track in team colour
  const light = new THREE.PointLight(def.colour, 0, 14, 2);
  light.position.set(0, -0.5, 0);
  group.add(light);
  // World-space engine trails, one per nozzle; the scene owner adds their meshes beside the group.
  // Each is paired with its plume and emitted from that plume's tip, so the ribbon starts where the
  // fire ends instead of being born inside it — which also means it starts at the flame's thin end.
  const trails = parts.nozzles.map((n, i) => ({ trail: new EngineTrail(def.colour, 0.22 + n.r * 0.7), plume: flames[i] }));
  return { group, exhaust, flames, flapL, flapR, light, colour: def.colour, def, trails, thrust: null };
}

/** call once per frame after the craft is posed: grows the trails from the flame tips toward the camera's view */
const _w = new THREE.Vector3();
export function updateTrails(craft, camera, now) {
  // the trails are grown before the renderer updates matrices, so bring the plumes' own up to date
  craft.group.updateWorldMatrix(true, false);
  for (const t of craft.trails) {
    t.plume.updateWorldMatrix(false, false);
    plumeTip(t.plume, _w);
    t.trail.update(_w, craft.group.visible ? (craft.thrust || 0) : 0, camera, now);
  }
}
export function disposeTrails(craft) { for (const t of craft.trails) t.trail.dispose(); }

/** per-frame animation of a craft's dressing. Everything here eases: the throttle is a switch, the engine is not. */
const THRUST_RATE = 9, FLAP_RATE = 18;
export function animateCraft(craft, { throttle, abL, abR, boost, speedFrac, dead }, dt = 1 / 60) {
  const t = performance.now() * 0.001;
  const wantThrust = dead ? 0 : throttle ? (boost ? 1.4 : 0.55 + speedFrac * 0.45) : 0.12;
  craft.thrust = craft.thrust === null ? wantThrust : craft.thrust + (wantThrust - craft.thrust) * (1 - Math.exp(-dt * THRUST_RATE));
  const e = 0.5 + craft.thrust * 1.36;                      // the throat glow tracks the eased thrust
  for (const sp of craft.exhaust) { sp.scale.set(sp.userData.s ?? (sp.userData.s = sp.scale.x), sp.userData.s, 1); sp.scale.multiplyScalar(e / 1.4); sp.material.opacity = dead ? 0 : 0.7; }
  for (const f of craft.flames || []) animatePlume(f, { throttle, boost, speedFrac, dead }, t, dt);
  const fk = 1 - Math.exp(-dt * FLAP_RATE);                 // was a per-frame lerp, so it ran at the frame rate
  craft.flapL.rotation.x += ((abL ? -0.9 : 0) - craft.flapL.rotation.x) * fk;
  craft.flapR.rotation.x += ((abR ? -0.9 : 0) - craft.flapR.rotation.x) * fk;
  craft.light.intensity = dead ? 0 : (boost ? 3 : 1.2);
  craft.group.visible = !dead;
}
