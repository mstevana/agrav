// ============================================================================
// AGRAV — track rendering: the ribbon surface, the walls, pads, the start
// line, and the pose helper that turns (s, t, h, yaw) into a world transform.
// ============================================================================

import * as THREE from 'three';
import { frameAt, toWorld } from '../../../shared/sim/spline.js';
import { HOVER_HEIGHT } from '../../../shared/agrav/constants.js';
import { trackSurface, padTexture, checkerTexture } from './textures.js';

const ACROSS = 8;    // lateral subdivisions

export function buildTrack(ribbon, track, env) {
  const group = new THREE.Group();
  const n = ribbon.count;
  const verts = [], normals = [], uvs = [], colors = [], idx = [];
  const edge = new THREE.Color(env.edge ?? 0x2df1ff);
  for (let i = 0; i <= n; i++) {
    const f = ribbon.frames[i % n];
    for (let k = 0; k <= ACROSS; k++) {
      const u = k / ACROSS, t = (u - 0.5) * f.width;
      verts.push(f.pos.x + f.right.x * t, f.pos.y + f.right.y * t, f.pos.z + f.right.z * t);
      normals.push(f.up.x, f.up.y, f.up.z);
      uvs.push(u, i * ribbon.step / 8);
      // bright edge strips, darker centre
      const e = Math.min(1, Math.max(0, (Math.abs(u - 0.5) - 0.44) / 0.06));
      colors.push(1 - e + edge.r * e, 1 - e + edge.g * e, 1 - e + edge.b * e);
    }
  }
  const stride = ACROSS + 1;
  // counter-clockwise seen from above: (along × across) must point along `up`, so the
  // across edge comes first
  for (let i = 0; i < n; i++) for (let k = 0; k < ACROSS; k++) {
    const a = i * stride + k, b = a + stride;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(idx);
  const surface = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: trackSurface(env.surface ?? 0x333948, env.seam ?? 0x1a1e28), vertexColors: true, roughness: env.wet ? 0.35 : 0.85, metalness: env.wet ? 0.35 : 0.05
  }));
  surface.receiveShadow = false;
  group.add(surface);

  // walls: a translucent energy barrier along each edge, glowing at the base
  const wallGeo = (side) => {
    const v = [], c = [], id = [];
    const H = 2.6;
    for (let i = 0; i <= n; i++) {
      const f = ribbon.frames[i % n], t = side * f.width / 2;
      const bx = f.pos.x + f.right.x * t, by = f.pos.y + f.right.y * t, bz = f.pos.z + f.right.z * t;
      v.push(bx, by, bz, bx + f.up.x * H, by + f.up.y * H, bz + f.up.z * H);
      c.push(1, 1, 1, 0.05, 0.05, 0.05);
    }
    for (let i = 0; i < n; i++) { const a = i * 2; id.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.setIndex(id);
    return g;
  };
  const wallMat = new THREE.MeshBasicMaterial({ color: env.edge ?? 0x2df1ff, vertexColors: true, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  group.add(new THREE.Mesh(wallGeo(1), wallMat), new THREE.Mesh(wallGeo(-1), wallMat));

  // pads
  const padGeo = new THREE.PlaneGeometry(5, 6);
  const padMat = new THREE.MeshBasicMaterial({ map: padTexture(env.pad ?? 0x2df1ff), transparent: true, opacity: 0.95 });
  const padOff = new THREE.MeshBasicMaterial({ map: padTexture(0x3a4050), transparent: true, opacity: 0.6 });
  const pads = [];
  const rows = [];
  for (const row of track.pads) for (const t of row.lanes) rows.push({ s: row.s, t });
  for (const p of rows) {
    const m = new THREE.Mesh(padGeo, padMat);
    poseObject(m, ribbon, p.s, p.t, 0.08, 0);
    m.rotateX(-Math.PI / 2);
    group.add(m);
    pads.push({ mesh: m, on: padMat, off: padOff });
  }

  // start line
  const f0 = frameAt(ribbon, 0);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(f0.width, 4), new THREE.MeshBasicMaterial({ map: checkerTexture() }));
  poseObject(line, ribbon, 0, 0, 0.06, 0);
  line.rotateX(-Math.PI / 2);
  group.add(line);

  return { group, pads, surface };
}

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _q = new THREE.Quaternion();

/**
 * Place an object at ribbon coords with its -z toward the heading (three's
 * forward), leaning `roll` radians about that heading.
 */
export function poseObject(obj, ribbon, s, t, h, yaw, roll = 0, hover = 0) {
  const w = toWorld(ribbon, s, t, h + hover);
  const f = w.frame;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  // heading = tangent rotated by yaw toward right
  _z.set(-(f.tangent.x * cy + f.right.x * sy), -(f.tangent.y * cy + f.right.y * sy), -(f.tangent.z * cy + f.right.z * sy));
  _y.set(f.up.x, f.up.y, f.up.z);
  _x.crossVectors(_y, _z).normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  if (roll) { _q.setFromAxisAngle(_z, roll); obj.quaternion.premultiply(_q); }
  obj.position.set(w.x, w.y, w.z);
  return w;
}

export { HOVER_HEIGHT };
