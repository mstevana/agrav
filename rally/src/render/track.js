// ============================================================================
// The circuit as geometry: the road surface swept along the ribbon, kerbs, the
// barriers the simulation actually collides against, the obstacles, the pickup
// pads, the furniture that tells you where you are, and the ground it all sits
// on.
//
// Everything is generated from the same track data the server races on, so the
// wall you can see is the wall the car hits, and every material is built on the
// client from a height function — nothing is downloaded and the server knows
// nothing about any of it.
// ============================================================================

import * as THREE from 'three';
import { frameAt } from '../../../shared/sim/spline.js';
import { standard, blended } from '../../../shared/gfx/surfaces.js';
import { smoothstep, fbm2 } from '../../../shared/gfx/noise.js';
import { flatten } from '../../../shared/gfx/merge.js';
import { isLite } from './scene.js';
import { THEMES } from './themes.js';

const ROAD_STEP = 3;        // metres between road cross-sections
const KERB_WIDTH = 1.15;
const KERB_PERIOD = 4.5;    // metres per red/white block
const WALL_HEIGHT = 2.5;
const WALL_DEPTH = 1.3;     // how thick the barrier looks from directly above
const POST_SPACING = 9;
const ROAD_COLS = 8;        // lateral segments, so the road can be shaded across its width
const ROAD_TILE = 20;       // metres per texture repeat on the road
const GROUND_TILE = 26;     // metres per texture repeat on the landscape, unless a theme says otherwise

export function buildTrackScene(scene, track, seed = 1) {
  const theme = THEMES[track.theme] || THEMES.scrapyard;
  scene.build(theme);
  const group = new THREE.Group();
  scene.three.add(group);

  const rng = mulberry(seed >>> 0);
  const lite = isLite();

  group.add(ground(track, theme, lite));
  const road = roadSurface(track, theme, lite);
  group.add(road.mesh);
  group.add(road.kerbs);
  // Everything static is merged down to one mesh per material before it goes
  // in: the verges alone are a few thousand little props, and a few thousand
  // draw calls is how a scene like this stops being sixty frames a second.
  if (!lite) group.add(flatten(skidMarks(track, rng)));
  if (!lite) group.add(flatten(roadWear(track, rng)));
  group.add(lite ? startLine(track) : flatten(startLine(track)));
  group.add(barriers(track, theme, lite));
  const decor = lite ? null : furniture(track, theme);
  group.add(lite ? obstacleMeshes(track, theme, lite) : flatten(obstacleMeshes(track, theme, lite)));
  const pads = padMeshes(track);
  group.add(pads.group);
  let overhead = [];
  if (!lite) {
    const scenery = theme.scenery(track, rng, THREE);
    scenery.userData.overhead = [...(scenery.userData.overhead || []), ...(decor.userData.overhead || [])];
    scenery.add(decor);
    // Anything that passes over the road is pulled out before the merge: it has
    // to keep its own material so it can be faded as the camera goes under it.
    overhead = scenery.userData.overhead || [];
    // The world matrix has to be read while the piece is still parented to
    // whatever placed it, and only then can it be lifted out of the merge.
    scenery.updateMatrixWorld(true);
    for (const o of overhead) {
      o.obj.matrix.copy(o.obj.matrixWorld);
      o.obj.matrix.decompose(o.obj.position, o.obj.quaternion, o.obj.scale);
      o.obj.removeFromParent();
    }
    group.add(flatten(scenery));
    for (const o of overhead) {
      o.obj.traverse(m => {
        if (!m.isMesh) return;
        m.material = m.material.clone();
        m.material.transparent = true;
        m.castShadow = true;
      });
      group.add(o.obj);
    }
  }

  return { group, theme, pads: pads.items, overhead };
}

// ------------------------------------------------------------------ ground --

/**
 * The floor the circuit sits on. Not a flat plane: a grid pushed about by noise
 * so the middle distance has some shape to it, held flat in a corridor around
 * the road so nothing ever pokes up through the racing surface.
 */
function ground(track, theme, lite) {
  const b = track.bounds;
  const pad = 320;
  const x0 = b.minX - pad, x1 = b.maxX + pad;
  const z0 = b.minZ - pad, z1 = b.maxZ + pad;
  const cells = lite ? 1 : 96;
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, cells, cells);
  geo.rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);

  const tile = theme.groundTile ?? GROUND_TILE;
  if (!lite) {
    // a coarse sample of the centreline is enough to know how far off the road a
    // vertex is, and it is thousands of times cheaper than asking properly
    const marks = [];
    for (let i = 0; i < track.ribbon.count; i += 6) marks.push(track.ribbon.frames[i]);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      let near = Infinity, width = 24;
      for (const f of marks) {
        const d = (f.pos.x - x) ** 2 + (f.pos.z - z) ** 2;
        if (d < near) { near = d; width = f.width; }
      }
      const away = Math.sqrt(near) - width;
      // flat under the road, easing into the landscape over thirty metres
      const free = smoothstep(4, 34, away);
      const h = theme.groundHeight(x, z, away);
      p.setY(i, -0.14 + h * free);
    }
    geo.computeVertexNormals();
    // world-scale UVs, so the material tiles at a believable size, and a slow
    // vertex tint over the top: without it a landscape this large is one
    // texture repeated until the eye counts the repeats.
    const uv = new Float32Array(p.count * 2);
    const col = new Float32Array(p.count * 3);
    const blend = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      uv[i * 2] = x / tile; uv[i * 2 + 1] = z / tile;
      const broad = fbm2(x * 0.0042, z * 0.0042, { octaves: 3, seed: 61 });
      const fine = fbm2(x * 0.019, z * 0.019, { octaves: 2, seed: 62 });
      // which of the two ground materials wins here, and a slow tint on top:
      // one texture repeated over a kilometre of landscape is a chequerboard
      blend[i] = smoothstep(-0.12, 0.22, broad + fine * 0.35);
      const k = 0.8 + broad * 0.42 + fine * 0.16;
      const c = theme.groundTint ? theme.groundTint(k, broad) : [k, k, k];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('blend', new THREE.BufferAttribute(blend, 1));
  } else {
    geo.translate(0, -0.14, 0);
  }

  const mesh = new THREE.Mesh(geo, lite
    ? new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 1 })
    : blended(theme.groundSet(), theme.groundSet2(), { repeat: [1, 1], bumpScale: 0.3, normalScale: 1.05, roughness: 1, vertexColors: true }));
  mesh.receiveShadow = !lite;
  return mesh;
}

// -------------------------------------------------------------------- road --

/** the road itself, plus a kerb strip down each edge */
function roadSurface(track, theme, lite) {
  const { ribbon } = track;
  const n = Math.ceil(ribbon.length / ROAD_STEP);
  const cols = lite ? 1 : ROAD_COLS;
  const pos = [], uv = [], col = [], idx = [];
  const kpos = [], kidx = [], kcol = [];
  const kerbColours = [new THREE.Color(theme.kerbA), new THREE.Color(theme.kerbB)];

  for (let i = 0; i <= n; i++) {
    const s = (i / n) * ribbon.length;
    const f = frameAt(ribbon, s);
    const half = f.width / 2;
    for (let j = 0; j <= cols; j++) {
      const side = j / cols * 2 - 1;                  // -1 at one kerb, +1 at the other
      const t = half * side;
      pos.push(f.pos.x + f.right.x * t, 0, f.pos.z + f.right.z * t);
      // metres in both directions, so the surface tiles at its real size
      uv.push(t / ROAD_TILE, s / ROAD_TILE);
      // Two things the eye reads instantly from above and a tiling texture can
      // never give: rubber laid down where the field runs, and dust and grit
      // washed to the edges. A slow patch noise on top keeps the tile invisible.
      const rubber = Math.exp(-((side / 0.55) ** 2)) * 0.2;
      const edge = smoothstep(0.62, 1, Math.abs(side)) * 0.16;
      const patch = fbm2(f.pos.x * 0.012, f.pos.z * 0.012, { octaves: 3, seed: 41 }) * 0.18 - 0.09;
      const k = 1 - rubber + edge + patch;
      col.push(k, k, k);
    }
    const c = kerbColours[Math.floor(s / KERB_PERIOD) % 2];
    for (const side of [-1, 1]) {
      for (const w of [half - KERB_WIDTH, half]) {
        kpos.push(f.pos.x + f.right.x * w * side, w === half ? 0.09 : 0.03, f.pos.z + f.right.z * w * side);
        kcol.push(c.r, c.g, c.b);
      }
    }
  }
  // Winding decides which way a face looks, and a road that faces the ground is
  // a road you can see straight through. Both strips are wound so their normals
  // come out pointing up; for a kerb that depends on which side it is on,
  // because "outward" flips from one edge of a road to the other.
  const row = cols + 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    for (let side = 0; side < 2; side++) {
      const k = i * 4 + side * 2, k2 = k + 4;
      if (side === 0) kidx.push(k, k2, k + 1, k + 1, k2, k2 + 1);
      else kidx.push(k, k + 1, k2, k + 1, k2 + 1, k2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, lite
    ? new THREE.MeshStandardMaterial({ color: theme.road, roughness: 0.94 })
    : standard(theme.roadSet(), { repeat: [1, 1], bumpScale: 0.05, normalScale: 0.45, vertexColors: true }));
  mesh.receiveShadow = !lite;

  const kgeo = new THREE.BufferGeometry();
  kgeo.setAttribute('position', new THREE.Float32BufferAttribute(kpos, 3));
  kgeo.setAttribute('color', new THREE.Float32BufferAttribute(kcol, 3));
  kgeo.setIndex(kidx);
  kgeo.computeVertexNormals();
  const kerbs = new THREE.Mesh(kgeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 }));
  kerbs.receiveShadow = !lite;
  return { mesh, kerbs };
}

/**
 * Rubber laid down where the field brakes. The heavy braking is wherever the
 * road is about to tighten, so the marks are put exactly where the bots — and
 * everybody else — are hardest on the brakes.
 */
function skidMarks(track, rng) {
  const { ribbon } = track;
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x14120f, transparent: true, opacity: 0.32, depthWrite: false });
  for (let s = 0; s < ribbon.length; s += 6) {
    const here = Math.abs(frameAt(ribbon, s).curvature);
    const soon = Math.abs(frameAt(ribbon, s + 30).curvature);
    if (soon - here < 0.006) continue;                 // not a braking zone
    const f = frameAt(ribbon, s);
    for (let k = 0; k < 2; k++) {
      const t = (rng() - 0.5) * (f.width - 6);
      const geo = new THREE.PlaneGeometry(0.42, 7 + rng() * 9);
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -Math.atan2(f.tangent.x, f.tangent.z);
      m.position.set(f.pos.x + f.right.x * t, 0.02, f.pos.z + f.right.z * t);
      group.add(m);
    }
  }
  return group;
}

/**
 * The things that make a road look used rather than extruded: tar-filled
 * cracks, patches where the surface has been dug up and put back, and a drain
 * cover every so often against the kerb. All flat quads a hair above the
 * surface, sharing three materials between them.
 */
function roadWear(track, rng) {
  const { ribbon } = track;
  const group = new THREE.Group();
  const crackMat = new THREE.MeshBasicMaterial({ color: 0x141210, transparent: true, opacity: 0.5, depthWrite: false });
  const patchMat = new THREE.MeshBasicMaterial({ color: 0x1d1b18, transparent: true, opacity: 0.26, depthWrite: false });
  const palePatch = new THREE.MeshBasicMaterial({ color: 0xa79d8e, transparent: true, opacity: 0.16, depthWrite: false });
  const drainMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.5, metalness: 0.6 });
  const lay = (mesh, f, t, yaw, y) => {
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.atan2(f.tangent.x, f.tangent.z) + yaw;
    mesh.position.set(f.pos.x + f.right.x * t, y, f.pos.z + f.right.z * t);
    group.add(mesh);
  };
  for (let s = 0; s < ribbon.length; s += 5) {
    const f = frameAt(ribbon, s);
    const half = f.width / 2;
    if (rng() < 0.55) {
      const long = 1.6 + rng() * 5;
      lay(new THREE.Mesh(new THREE.PlaneGeometry(0.1 + rng() * 0.1, long), crackMat),
        f, (rng() - 0.5) * (f.width - 1.5), (rng() - 0.5) * 1.1, 0.014);
    }
    if (rng() < 0.22) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6 + rng() * 3.4, 1.2 + rng() * 3.6), rng() < 0.55 ? patchMat : palePatch);
      lay(m, f, (rng() - 0.5) * (f.width - 4), (rng() - 0.5) * 0.5, 0.016);
    }
    if (rng() < 0.06) {
      const side = rng() < 0.5 ? 1 : -1;
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 10), drainMat);
      d.position.set(f.pos.x + f.right.x * (half - 1.4) * side, 0.02, f.pos.z + f.right.z * (half - 1.4) * side);
      group.add(d);
    }
  }
  return group;
}

// ---------------------------------------------------------------- barriers --

/**
 * The barrier the simulation collides against, drawn exactly where it is: a
 * rail with a post every few metres and a kerb-height base, so the eye can
 * read the edge of the road from directly overhead.
 */
function barriers(track, theme, lite) {
  const { ribbon } = track;
  const group = new THREE.Group();
  const n = Math.ceil(ribbon.length / ROAD_STEP);
  const pos = [], idx = [], uv = [];
  // Three strips per side: the face the car hits, the top of the wall, and the
  // back of it. The top strip is the one that matters from directly above — a
  // single vertical plane is one pixel wide up there and the eye loses the edge.
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * ribbon.length;
    const f = frameAt(ribbon, s);
    const half = f.width / 2;
    for (const side of [-1, 1]) {
      const ix = f.pos.x + f.right.x * half * side, iz = f.pos.z + f.right.z * half * side;
      const ox = f.pos.x + f.right.x * (half + WALL_DEPTH) * side, oz = f.pos.z + f.right.z * (half + WALL_DEPTH) * side;
      pos.push(ix, 0, iz, ix, WALL_HEIGHT, iz, ox, WALL_HEIGHT, oz, ox, 0, oz);
      const v = s / 5;
      uv.push(v, 0, v, 1, v, 1 + WALL_DEPTH / WALL_HEIGHT, v, 2 + WALL_DEPTH / WALL_HEIGHT);
    }
  }
  const ring = 8;                                     // four vertices per side, two sides
  for (let i = 0; i < n; i++) {
    for (let side = 0; side < 2; side++) {
      const base = i * ring + side * 4;
      for (let k = 0; k < 3; k++) {
        const a = base + k, b = a + 1, c = a + ring, d = c + 1;
        if (side === 0) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const wall = new THREE.Mesh(geo, lite
    ? new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.8, side: THREE.DoubleSide })
    : standard(theme.wallSet(), { repeat: [1, 1], bumpScale: 0.2, side: THREE.DoubleSide }));
  wall.castShadow = !lite;
  wall.receiveShadow = !lite;
  group.add(wall);
  if (lite) return group;

  // A rail capping the wall and a post every few metres, instanced: a few
  // hundred of each for one draw call apiece. The rail is wide enough to read
  // as a line from above, which is the whole job it has to do.
  const count = Math.ceil(ribbon.length / POST_SPACING) * 2;
  const postGeo = new THREE.BoxGeometry(WALL_DEPTH + 0.5, 0.5, 0.34);
  const postMat = new THREE.MeshStandardMaterial({ color: theme.post ?? 0x6a6f78, roughness: 0.55, metalness: 0.5 });
  const posts = new THREE.InstancedMesh(postGeo, postMat, count);
  const railGeo = new THREE.BoxGeometry(0.5, 0.42, POST_SPACING + 0.3);
  const railMat = new THREE.MeshStandardMaterial({ color: theme.rail ?? 0xb9bec6, roughness: 0.42, metalness: 0.65 });
  const rails = new THREE.InstancedMesh(railGeo, railMat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (let s = 0; s < ribbon.length; s += POST_SPACING) {
    const f = frameAt(ribbon, s);
    const yaw = Math.atan2(f.tangent.x, f.tangent.z);
    q.setFromAxisAngle(up, yaw);
    for (const side of [-1, 1]) {
      const half = f.width / 2;
      const rx = f.pos.x + f.right.x * (half + 0.2) * side, rz = f.pos.z + f.right.z * (half + 0.2) * side;
      const px = f.pos.x + f.right.x * (half + WALL_DEPTH / 2) * side, pz = f.pos.z + f.right.z * (half + WALL_DEPTH / 2) * side;
      m.compose(new THREE.Vector3(px, WALL_HEIGHT + 0.22, pz), q, one);
      posts.setMatrixAt(k, m);
      m.compose(new THREE.Vector3(rx, WALL_HEIGHT + 0.38, rz), q, one);
      rails.setMatrixAt(k, m);
      k++;
    }
  }
  posts.count = rails.count = k;
  posts.castShadow = rails.castShadow = true;
  group.add(posts); group.add(rails);
  return group;
}

// --------------------------------------------------------------- furniture --

/** the things that tell you where you are: the gantry, and boards counting down */
function furniture(track, theme) {
  const { ribbon } = track;
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.5, metalness: 0.55 });

  // a gantry over the start line
  const f0 = frameAt(ribbon, 0);
  const gantry = new THREE.Group();
  const span = f0.width + 4;
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 7.5, 0.7), steel);
    leg.position.set(side * span / 2, 3.75, 0);
    gantry.add(leg);
  }
  const crown = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 1, 1.1, 0.8), steel);
  beam.position.y = 8;
  crown.add(beam);
  gantry.add(crown);
  const board = new THREE.Mesh(new THREE.BoxGeometry(span * 0.5, 1.9, 0.3),
    new THREE.MeshStandardMaterial({ color: theme.sign ?? 0x1d2430, roughness: 0.6 }));
  board.position.set(0, 6.6, 0.1);
  crown.add(board);
  for (let i = -2; i <= 2; i++) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6),
      new THREE.MeshBasicMaterial({ color: i === 0 ? 0xff5a3a : 0xffe0a0 }));
    lamp.position.set(i * span * 0.12, 7.5, 0.3);
    crown.add(lamp);
  }
  gantry.position.set(f0.pos.x, 0, f0.pos.z);
  gantry.rotation.y = Math.atan2(f0.tangent.x, f0.tangent.z);
  gantry.traverse(o => { if (o.isMesh) o.castShadow = true; });
  group.add(gantry);
  (group.userData.overhead ||= []).push({ obj: crown, x: f0.pos.x, z: f0.pos.z, r: 18 });

  // distance boards on the approach to the tightest corners
  const marks = [];
  for (let s = 0; s < ribbon.length; s += 8) {
    const soon = Math.abs(frameAt(ribbon, s + 40).curvature);
    if (soon > 0.02 && !marks.some(m => Math.abs(m - s) < 120)) marks.push(s);
  }
  const boardMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.7 });
  for (const s of marks) {
    for (let n = 3; n >= 1; n--) {
      const f = frameAt(ribbon, (s - n * 18 + ribbon.length) % ribbon.length);
      const side = f.curvature >= 0 ? -1 : 1;
      const stand = new THREE.Group();
      const postM = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.9, 6), steel);
      postM.position.y = 0.95;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.12), boardMat);
      plate.position.y = 2.2;
      stand.add(postM); stand.add(plate);
      const off = f.width / 2 + 1.6;
      stand.position.set(f.pos.x + f.right.x * off * side, 0, f.pos.z + f.right.z * off * side);
      stand.rotation.y = Math.atan2(f.tangent.x, f.tangent.z);
      stand.traverse(o => { if (o.isMesh) o.castShadow = true; });
      group.add(stand);
    }
  }
  return group;
}

function startLine(track) {
  const group = new THREE.Group();
  const f = frameAt(track.ribbon, 0);
  const geo = new THREE.PlaneGeometry(f.width, 2.6);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
    g.fillStyle = (x + y) % 2 ? '#f0f0f0' : '#151515';
    g.fillRect(x * 16, y * 16, 16, 16);
  }
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = -Math.atan2(f.tangent.x, f.tangent.z);
  mesh.position.set(f.pos.x, 0.06, f.pos.z);
  group.add(mesh);

  // the boxes the field lines up in, painted where the simulation actually puts
  // them, so the grid on the road is the grid the cars are standing on
  const paint = new THREE.MeshBasicMaterial({ color: 0xe6e2d8, transparent: true, opacity: 0.62, depthWrite: false });
  const box = new THREE.Shape();
  const bw = 2.5, bl = 5.2, t = 0.16;
  box.moveTo(-bw, -bl); box.lineTo(bw, -bl); box.lineTo(bw, bl); box.lineTo(-bw, bl); box.lineTo(-bw, -bl);
  const hole = new THREE.Path();
  hole.moveTo(-bw + t, -bl + t); hole.lineTo(-bw + t, bl - t); hole.lineTo(bw - t, bl - t); hole.lineTo(bw - t, -bl + t); hole.lineTo(-bw + t, -bl + t);
  box.holes.push(hole);
  const boxGeo = new THREE.ShapeGeometry(box);
  for (const slot of track.grid) {
    const m = new THREE.Mesh(boxGeo, paint);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -slot.yaw;
    m.position.set(slot.x, 0.05, slot.z);
    group.add(m);
  }
  return group;
}

function obstacleMeshes(track, theme, lite) {
  const group = new THREE.Group();
  for (const o of track.obstacles) {
    const mesh = theme.obstacle(o, THREE);
    mesh.position.set(o.x, 0, o.z);
    mesh.traverse(m => { if (m.isMesh) m.castShadow = !lite; });
    group.add(mesh);
  }
  return group;
}

// -------------------------------------------------------------------- pads --

/** the pads: a lit disc on the road with a floating token over it */
function padMeshes(track) {
  const group = new THREE.Group();
  const items = [];
  const disc = new THREE.CircleGeometry(2.4, 24);
  const ring = new THREE.RingGeometry(2.4, 2.75, 24);
  const token = new THREE.OctahedronGeometry(0.9);
  for (const p of track.pads) {
    const colour = PAD_COLOURS[p.item] || 0xffffff;
    const base = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.3, depthWrite: false }));
    base.rotation.x = -Math.PI / 2;
    base.position.set(p.x, 0.07, p.z);
    const rim = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.7, depthWrite: false }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(p.x, 0.08, p.z);
    const gem = new THREE.Mesh(token, new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.8, roughness: 0.25, metalness: 0.3 }));
    gem.position.set(p.x, 1.6, p.z);
    group.add(base); group.add(rim); group.add(gem);
    items.push({ pad: p, base, rim, gem });
  }
  return { group, items };
}

export const PAD_COLOURS = { ammo: 0xffc24a, nitro: 0x4ad6ff, repair: 0x5cff8f, cash: 0xc9f24a, mines: 0xff7a5a };

/** the pads bob and spin, and go dark while they are used up */
/**
 * Fade the things that pass over the road as the camera comes under them. A
 * bridge you can see from a distance is scenery; a bridge you are under is a
 * lid, and the car you are steering is beneath it.
 */
export function animateOverhead(items, x, z) {
  for (const o of items) {
    const d = Math.hypot(x - o.x, z - o.z);
    const k = smoothstep(o.r * 0.6, o.r * 1.8, d);
    const opacity = 0.06 + k * 0.94;
    o.obj.visible = opacity > 0.08;
    o.obj.traverse(m => { if (m.isMesh) m.material.opacity = opacity; });
  }
}

export function animatePads(items, time, live) {
  for (let i = 0; i < items.length; i++) {
    const { gem, base, rim } = items[i];
    const item = live ? live[i] : items[i].pad.item;
    const up = !!item;
    gem.visible = up;
    base.material.opacity = up ? 0.3 : 0.06;
    rim.material.opacity = up ? 0.7 : 0.12;
    if (!up) continue;
    const colour = PAD_COLOURS[item] || 0xffffff;
    if (gem.material.color.getHex() !== colour) {
      gem.material.color.setHex(colour);
      gem.material.emissive.setHex(colour);
      base.material.color.setHex(colour);
      rim.material.color.setHex(colour);
    }
    gem.rotation.y = time * 1.6 + i;
    gem.position.y = 1.6 + Math.sin(time * 2.4 + i) * 0.3;
    rim.scale.setScalar(1 + Math.sin(time * 2 + i) * 0.06);
  }
}

function mulberry(a) {
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
