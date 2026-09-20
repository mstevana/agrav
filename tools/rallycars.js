#!/usr/bin/env node
// ============================================================================
// A contact sheet of the cars: every model in the showroom, photographed from
// the angle the game shows them at and from one low enough to see what it is.
//
//   node tools/rallycars.js [outdir] [--weapon minigun] [--bumper] [--armour 3]
//   node tools/rallycars.js --angle 0.55          # a lower, three-quarter view
//
// It serves the real client files and calls the real makeCarMesh, so what it
// photographs is what races.
// ============================================================================

import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const OUT = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) || 'docs/screenshots/rally';
const WEAPON = flag('--weapon', 'machinegun');
const ARMOUR = Number(flag('--armour', 0));
const ANGLE = Number(flag('--angle', 0.999));           // 1 = straight down
const BUMPER = args.includes('--bumper');

const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/cars') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const file = path.join(ROOT, url.pathname);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const PAGE = `<!doctype html><meta charset="utf-8"><title>cars</title>
<style>html,body{margin:0;background:#15130f;overflow:hidden}canvas{display:block}</style>
<canvas id="c"></canvas>
<script type="importmap">{ "imports": { "three": "/shared/vendor/three.module.min.js" } }</script>
<script type="module">
import * as THREE from 'three';
import { makeCarMesh, makeWreckMesh, carShape, TEAM_COLOURS } from '/rally/src/render/car.js';

const W = 1600, H = 900;
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
canvas.width = W; canvas.height = H;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2620);
const hemi = new THREE.HemisphereLight(0xcfd8e8, 0x5a5040, 1.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d4, 2.4);
sun.position.set(-26, 40, -18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const cam = sun.shadow.camera;
cam.left = -26; cam.right = 26; cam.top = 18; cam.bottom = -18; cam.near = 1; cam.far = 120;
scene.add(sun); scene.add(sun.target);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x5e564a, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const IDS = ['vagabond', 'mongrel', 'stiletto', 'warden', 'behemoth', 'valkyrie'];
const opts = JSON.parse(document.currentScript?.dataset?.opts || '{}');
const WEAPON = ${JSON.stringify(WEAPON)}, ARMOUR = ${ARMOUR}, BUMPER = ${BUMPER};
const COLS = 3, GAP_X = 7.6, GAP_Z = 8.4;
IDS.forEach((id, i) => {
  const col = i % COLS, row = (i / COLS) | 0;
  const m = makeCarMesh(id, TEAM_COLOURS[i], { weapon: WEAPON, bumper: BUMPER, armour: ARMOUR, number: i + 1 });
  m.position.set((col - (COLS - 1) / 2) * GAP_X, 0, (row - 0.5) * GAP_Z);
  scene.add(m);
  const w = makeWreckMesh(id);
  w.position.set((col - (COLS - 1) / 2) * GAP_X + 3.1, 0, (row - 0.5) * GAP_Z + 3.0);
  w.rotation.y = 0.5;
  scene.add(w);
});

const camera = new THREE.PerspectiveCamera(36, W / H, 0.5, 400);
camera.up.set(0, 0, -1);
const a = ${ANGLE};
const dist = 34;
camera.position.set(0, dist * a, dist * Math.sqrt(Math.max(0, 1 - a * a)) + 0.001);
camera.lookAt(0, 0.6, 0);
renderer.render(scene, camera);
window.__ready = true;
</script>`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', e => console.error('page error:', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.goto(`http://127.0.0.1:${port}/cars`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready, null, { timeout: 20000 });
await fs.mkdir(OUT, { recursive: true });
const name = path.join(OUT, `cars${ANGLE < 0.99 ? '-low' : ''}.png`);
await page.screenshot({ path: name });
console.log('wrote ' + name);
await browser.close();
server.close();
