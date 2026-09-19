// ============================================================================
// The circuit as geometry: the road surface swept along the ribbon, kerbs, the
// barriers that the simulation actually collides against, the obstacles, the
// pickup pads, and the scenery beyond the barriers that gives the top-down view
// its parallax.
//
// Everything is generated from the same track data the server races on, so the
// wall you can see is the wall the car hits.
// ============================================================================

import * as THREE from 'three';
import { frameAt } from '../../../shared/sim/spline.js';
import { isLite } from './scene.js';
import { THEMES } from './themes.js';

const ROAD_STEP = 4;        // metres between road cross-sections
const WALL_HEIGHT = 2.6;
const KERB_WIDTH = 1.1;

export function buildTrackScene(scene, track, seed = 1) {
  const theme = THEMES[track.theme] || THEMES.scrapyard;
  scene.build(theme);
  const group = new THREE.Group();
  scene.three.add(group);

  const rng = mulberry(seed >>> 0);
  group.add(ground(track, theme));
  const { road, kerbs } = roadSurface(track, theme);
  group.add(road);
  group.add(kerbs);
  group.add(barriers(track, theme));
  group.add(startLine(track));
  const obstacles = obstacleMeshes(track, theme);
  group.add(obstacles);
  const pads = padMeshes(track, theme);
  group.add(pads.group);
  if (!isLite()) group.add(theme.scenery(track, rng, THREE));

  return { group, theme, pads: pads.items };
}

/** the floor the whole circuit sits on */
function ground(track, theme) {
  const b = track.bounds;
  const pad = 400;
  const geo = new THREE.PlaneGeometry(
    (b.maxX - b.minX) + pad * 2, (b.maxZ - b.minZ) + pad * 2, 1, 1);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 1 }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((b.minX + b.maxX) / 2, -0.12, (b.minZ + b.maxZ) / 2);
  mesh.receiveShadow = !isLite();
  return mesh;
}

/** the road itself, plus a kerb strip down each edge */
function roadSurface(track, theme) {
  const { ribbon } = track;
  const n = Math.ceil(ribbon.length / ROAD_STEP);
  const pos = [], uv = [], idx = [];
  const kpos = [], kidx = [], kcol = [];
  const kerbColours = [new THREE.Color(theme.kerbA), new THREE.Color(theme.kerbB)];

  for (let i = 0; i <= n; i++) {
    const s = (i / n) * ribbon.length;
    const f = frameAt(ribbon, s);
    const half = f.width / 2;
    for (const side of [-1, 1]) {
      pos.push(f.pos.x + f.right.x * half * side, 0, f.pos.z + f.right.z * half * side);
      uv.push(side < 0 ? 0 : 1, s / 14);
    }
    // kerbs sit just inside the barrier, alternating colour every few metres
    const c = kerbColours[Math.floor(s / 5) % 2];
    for (const side of [-1, 1]) {
      const inner = half - KERB_WIDTH, outer = half;
      for (const w of [inner, outer]) {
        kpos.push(f.pos.x + f.right.x * w * side, 0.04, f.pos.z + f.right.z * w * side);
        kcol.push(c.r, c.g, c.b);
      }
    }
  }
  // Winding decides which way a face looks, and a road that faces the ground is a
  // road you can see straight through. Both strips are wound so their normals
  // come out pointing up: for the road that is (left, right, next-left), and for
  // a kerb it depends on which side of the road it is, because "outward" flips.
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;      // left_i, right_i, left_i+1, right_i+1
    idx.push(a, b, c, b, d, c);
    for (let side = 0; side < 2; side++) {
      const k = i * 4 + side * 2, k2 = k + 4;              // inner_i, outer_i, inner_i+1, outer_i+1
      if (side === 0) kidx.push(k, k2, k + 1, k + 1, k2, k2 + 1);
      else kidx.push(k, k + 1, k2, k + 1, k2 + 1, k2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: theme.road, roughness: 0.92, metalness: 0.02 }));
  road.receiveShadow = !isLite();

  const kgeo = new THREE.BufferGeometry();
  kgeo.setAttribute('position', new THREE.Float32BufferAttribute(kpos, 3));
  kgeo.setAttribute('color', new THREE.Float32BufferAttribute(kcol, 3));
  kgeo.setIndex(kidx);
  kgeo.computeVertexNormals();
  const kerbs = new THREE.Mesh(kgeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  return { road, kerbs };
}

/** the barrier the simulation collides against, drawn exactly where it is */
function barriers(track, theme) {
  const { ribbon } = track;
  const n = Math.ceil(ribbon.length / ROAD_STEP);
  const pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const f = frameAt(ribbon, (i / n) * ribbon.length);
    const half = f.width / 2;
    for (const side of [-1, 1]) {
      const x = f.pos.x + f.right.x * half * side, z = f.pos.z + f.right.z * half * side;
      pos.push(x, 0, z, x, WALL_HEIGHT, z);
    }
  }
  // one consistent winding, and a two-sided material: you see a barrier from the
  // road and from behind it, but the normals still mean something for the light
  for (let i = 0; i < n; i++) {
    for (let side = 0; side < 2; side++) {
      const a = i * 4 + side * 2, b = a + 1, c = a + 4, d = a + 5;
      if (side === 0) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.75, side: THREE.DoubleSide }));
  mesh.castShadow = !isLite();
  return mesh;
}

function startLine(track) {
  const f = frameAt(track.ribbon, 0);
  const geo = new THREE.PlaneGeometry(f.width, 2.4);
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
  mesh.position.set(f.pos.x, 0.05, f.pos.z);
  return mesh;
}

function obstacleMeshes(track, theme) {
  const group = new THREE.Group();
  for (const o of track.obstacles) {
    const mesh = theme.obstacle(o, THREE);
    mesh.position.set(o.x, 0, o.z);
    mesh.castShadow = !isLite();
    group.add(mesh);
  }
  return group;
}

/** the pads: a lit disc on the road with a floating token over it */
function padMeshes(track, theme) {
  const group = new THREE.Group();
  const items = [];
  const disc = new THREE.CircleGeometry(2.2, 20);
  const token = new THREE.OctahedronGeometry(0.85);
  for (const p of track.pads) {
    const colour = PAD_COLOURS[p.item] || 0xffffff;
    const base = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.32 }));
    base.rotation.x = -Math.PI / 2;
    base.position.set(p.x, 0.06, p.z);
    const gem = new THREE.Mesh(token, new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.7, roughness: 0.3 }));
    gem.position.set(p.x, 1.5, p.z);
    group.add(base); group.add(gem);
    items.push({ pad: p, base, gem });
  }
  void theme;
  return { group, items };
}

export const PAD_COLOURS = { ammo: 0xffc24a, nitro: 0x4ad6ff, repair: 0x5cff8f, cash: 0xc9f24a };

/** the pads bob and spin, and go dark while they are used up */
export function animatePads(items, time, live) {
  for (let i = 0; i < items.length; i++) {
    const { gem, base } = items[i];
    const item = live ? live[i] : items[i].pad.item;
    const up = !!item;
    gem.visible = up;
    base.material.opacity = up ? 0.32 : 0.07;
    if (!up) continue;
    const colour = PAD_COLOURS[item] || 0xffffff;
    if (gem.material.color.getHex() !== colour) {
      gem.material.color.setHex(colour);
      gem.material.emissive.setHex(colour);
      base.material.color.setHex(colour);
    }
    gem.rotation.y = time * 1.6 + i;
    gem.position.y = 1.5 + Math.sin(time * 2.4 + i) * 0.28;
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
