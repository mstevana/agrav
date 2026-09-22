// ============================================================================
// AGRAV — entry point: screens, renderer, the race scene, and the loop.
// ============================================================================

import * as THREE from 'three';
import { BloomComposer } from '../../shared/gfx/bloom.js';
import { TRACKS, TRACK_IDS } from '../../shared/agrav/tracks/index.js';
import { VEHICLES } from '../../shared/agrav/vehicles.js';
import { PHASE, TICK_RATE, DT, HOVER_HEIGHT, VF, WEAPON } from '../../shared/agrav/constants.js';
import { toWorld, frameAt, deltaS } from '../../shared/sim/spline.js';
import { wrapAngle } from '../../shared/sim/vec.js';
import { IN } from '../../shared/net/protocol.js';
import { ribbonFor } from '../../shared/agrav/sim/race.js';
import { Client } from './net.js';
import { Input } from './input.js';
import { Hud, fmtTime, ordinal, esc } from './hud.js';
import { audio } from './audio.js';
import { settings, setSetting, applyDocumentSettings, QualityGovernor } from './settings.js';
import { buildTrack, prewarmTrack, poseObject } from './render/track.js';
import { buildCraft, animateCraft, updateTrails, disposeTrails } from './render/vehicle.js';
import { flashMinigun, minigunMuzzle } from './render/minigun.js';
import { buildEnvironment, prewarmEnvironment } from './render/env/index.js';
import { skyEnvironment, markShadows } from './render/env/common.js';
import { Fx } from './render/fx.js';
import { makeBot, botInput } from '../../shared/agrav/bot.js';

const ATTITUDE_RATE = 11;   // 1/s: how fast the hull's roll and pitch chase what the controls ask for

const $ = (id) => document.getElementById(id);
// `racing` marks the screenless state -- the 3D view with nothing over it -- which is the only one
// that needs landscape, and so the only one the rotate prompt appears in.
const show = (id) => {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  document.documentElement.classList.toggle('racing', id === null);
};
const toast = (msg, ms = 2600) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, ms); };

// ----------------------------------------------------------------- three ----
// ?lite=1: no scenery, no bloom, half resolution — for headless tests and very weak devices
const LITE = new URLSearchParams(location.search).has('lite');
// ?showcase=<vehicleId|all>: no menu, one craft (or the whole grid) posed on a straight. &track=<id>
// picks the track, &at=<metres> the point on the lap, &gun deploys the minigun -- between them the
// photographer (tools/shots.js) can frame any part of any map without racing to it.
const SHOWCASE = new URLSearchParams(location.search).get('showcase');
const SHOWCASE_GUN = new URLSearchParams(location.search).has('gun');            // photograph the minigun deployed
const SHOWCASE_AT = +(new URLSearchParams(location.search).get('at') ?? 60);     // and from anywhere on the lap
const SHOWCASE_TRACK = new URLSearchParams(location.search).get('track') || 'meridian';
const renderer = new THREE.WebGLRenderer({ antialias: !LITE, powerPreference: 'high-performance' });
renderer.setPixelRatio(LITE ? 0.5 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.info.autoReset = false;   // reset per frame so tools can read the whole frame's counts
renderer.shadowMap.enabled = !LITE;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('canvas-host').appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.5, 4000);
const bloom = new BloomComposer(renderer, { strength: 0.65, threshold: 0.86, enabled: !LITE });
bloom.setSize();
let effectsOn = true;
// the current 3D scene (menu backdrop or the race); declared before the governor's hooks can touch it
let scene = { three: null, trackId: null, env: null, track: null, crafts: new Map(), fx: null, ribbon: null };
const quality = new QualityGovernor({
  setMsaa: (n) => { if (bloom.samples === n) return; bloom.samples = n; if (bloom.enabled) bloom.setSize(); },
  setBloom: (on) => bloom.setEnabled(on && !LITE),
  setPixelRatio: (r) => { if (LITE) return; renderer.setPixelRatio(r); if (bloom.enabled) bloom.setSize(); },
  setEffects: (on) => { effectsOn = on; if (scene.fx) scene.fx.enabled = on; scene.env?.setDetail?.(on); },
  setShadows: (on) => { const want = on && !LITE; if (renderer.shadowMap.enabled === want) return; renderer.shadowMap.enabled = want; scene.three?.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
});
quality.applyManual();
applyDocumentSettings();
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  if (bloom.enabled) bloom.setSize();
});

// a menu backdrop scene: the first track, slowly orbited
function buildScene(trackId, ribbon) {
  if (scene.three && scene.trackId === trackId) return;
  disposeScene();
  const three = new THREE.Scene();
  const track = TRACKS[trackId];
  const t = buildTrack(ribbon, track, track.env);
  three.add(t.group);
  const env = LITE ? liteEnvironment(three, track) : buildEnvironment(three, ribbon, track);
  const fx = new Fx(three, ribbon); fx.enabled = effectsOn;
  env.setDetail?.(effectsOn);
  if (!LITE && env.sky) {
    // reflections come from the sky dome; the sun casts shadows in a box that follows the camera
    three.environment = skyEnvironment(renderer, env.sky.dome);
    const sun = env.sky.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -170; sun.shadow.camera.right = sun.shadow.camera.top = 170;
    sun.shadow.camera.near = 20; sun.shadow.camera.far = 1400;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 1.2;
    three.add(sun.target);
    env.sunDir = sun.position.clone().normalize();
    markShadows(env.group); if (env.fine) markShadows(env.fine, { cast: false, receive: true });
    markShadows(t.group, { cast: false, receive: true });
  }
  scene = { three, trackId, env, track: t, crafts: new Map(), fx, ribbon, trackDef: track };
  hud.setTrackMap(ribbon);
}
// The heavy procedural work -- texture sets, terrain, then the scene itself and its shaders --
// happens here, in the lobby, off the race start. Debounced, because a host reading down the track
// list should not build a scene for every card it touches on the way.
let prewarmed = null, prewarmTimer = 0, prewarmGen = 0;
function prewarm(trackId) {
  if (prewarmed === trackId || !TRACKS[trackId]) return;
  prewarmed = trackId;
  clearTimeout(prewarmTimer);
  const gen = ++prewarmGen;
  prewarmTimer = setTimeout(() => prewarmRun(trackId, gen).catch(e => console.warn('prewarm', e)), 400);
}
/** wait for a painted frame, so the progress bar the player is watching actually moves */
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
function prewarmProgress(frac, label) {
  const el = $('prep');
  if (frac == null) { el.hidden = true; return; }
  el.hidden = false;
  if (label) $('prep-label').textContent = label;
  const pct = Math.round(frac * 100);
  $('prep-fill').style.width = pct + '%';
  $('prep-pct').textContent = pct + '%';
}
/**
 * Prepare a track while the player waits in the lobby. The two procedural steps are single
 * synchronous blocks and can only move the bar either side of themselves; the shader compile is the
 * long pole and it is sliced across frames, so that part genuinely animates. The slice is by
 * elapsed time rather than a fixed count, so a slow machine yields just as often as a fast one.
 */
async function prewarmRun(trackId, gen) {
  const live = () => gen === prewarmGen && ui.screen === 'lobby';
  const name = TRACKS[trackId].name || 'the track';
  try {
    prewarmProgress(0.02, `Preparing ${name}`);
    await nextFrame();
    if (!live()) return;
    prewarmTrack(TRACKS[trackId].env);
    if (LITE || !live()) return;
    prewarmProgress(0.12, 'Raising the terrain');
    await nextFrame();
    prewarmEnvironment(ribbonFor(trackId), TRACKS[trackId]);
    if (!live()) return;
    prewarmProgress(0.4, `Building ${name}`);
    await nextFrame();
    buildScene(trackId, ribbonFor(trackId));
    if (!live()) return;
    // One object per distinct material: compiling them is what used to happen lazily over the
    // opening frames of the race. renderer.compile takes any object and, given the real scene as
    // its third argument, compiles against that scene's lighting -- so a subtree at a time still
    // produces exactly the programs the race will ask for.
    prewarmProgress(0.5, 'Compiling shaders');
    await nextFrame();
    const owners = new Map();
    scene.three.traverse(o => {
      const m = o.material;
      if (m) for (const x of (Array.isArray(m) ? m : [m])) if (x && !owners.has(x.uuid)) owners.set(x.uuid, o);
    });
    const items = [...owners.values()];
    let t0 = performance.now();
    for (let i = 0; i < items.length; i++) {
      renderer.compile(items[i], camera, scene.three);
      if (performance.now() - t0 < 12) continue;
      prewarmProgress(0.5 + 0.5 * (i + 1) / items.length, 'Compiling shaders');
      await nextFrame();
      if (!live()) return;
      t0 = performance.now();
    }
    prewarmProgress(1, `${name} ready`);
    await nextFrame();
  } finally {
    prewarmProgress(null);
  }
}
const _sunTarget = new THREE.Vector3(), _fwd = new THREE.Vector3();
function followSun(camera) {
  const sky = scene.env?.sky; if (!sky || !scene.env.sunDir) return;
  camera.getWorldDirection(_fwd);
  _sunTarget.copy(camera.position).addScaledVector(_fwd, 90);
  sky.sun.target.position.copy(_sunTarget);
  sky.sun.position.copy(_sunTarget).addScaledVector(scene.env.sunDir, 600);
  sky.sun.target.updateMatrixWorld();
}
function liteEnvironment(three, track) {
  three.background = new THREE.Color(track.env.sky);
  three.add(new THREE.HemisphereLight(0xffffff, 0x303030, 0.9));
  return { group: null, update() {} };
}
function disposeScene() {
  if (!scene.three) return;
  for (const c of scene.crafts.values()) removeCraft(c);
  scene.fx?.dispose();
  scene.three.traverse(o => { if (o.geometry && !o.isInstancedMesh) o.geometry.dispose?.(); });
  scene = { three: null, trackId: null, env: null, track: null, crafts: new Map(), fx: null, ribbon: null };
}
function removeCraft(c) { scene.three.remove(c.group); for (const t of c.trails) scene.three.remove(t.trail.mesh); disposeTrails(c); }
function craftFor(id, vehicleId) {
  let c = scene.crafts.get(id);
  if (c && c.def.id === vehicleId) return c;
  if (c) removeCraft(c);
  c = buildCraft(vehicleId);
  c.shield = scene.fx.makeShield(id); c.group.add(c.shield);
  if (!LITE) c.group.traverse(o => { if (o.isMesh && !o.isSprite) { o.castShadow = true; o.receiveShadow = true; } });
  scene.three.add(c.group);
  for (const t of c.trails) scene.three.add(t.trail.mesh);
  scene.crafts.set(id, c);
  return c;
}

// ------------------------------------------------------------------ state ----
const client = new Client();
audio.onTrack = (title) => { if (ui.screen === 'race') hud.say(`♪ ${title}`, 'good'); };
window.addEventListener('keydown', (e) => { if (e.code === 'KeyN' && ui.screen === 'race') audio.nextTrack(); });
const input = new Input(renderer.domElement);
const hud = new Hud();
let ui = { screen: 'menu', ready: false, solo: false, soloFilled: false, vehicle: settings.vehicle, results: null, spectateId: -1, lastPhase: -1, lastCount: 99, elapsedAtFinish: null };
let menuOrbit = 0;
const SOLO_BOTS = 7;   // opponents on a solo grid

function serverUrl() {
  if (settings.server) return settings.server.replace(/^http/, 'ws').replace(/\/?$/, '') + (settings.server.endsWith('/ws') ? '' : '/ws');
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
async function ensureConnected() {
  if (client.connected) return true;
  $('overlay-text').textContent = 'Connecting…'; $('overlay-retry').hidden = true; $('overlay-menu').hidden = true; $('overlay').hidden = false;
  try {
    await client.connect(serverUrl(), $('name').value.trim() || 'player');
    $('overlay').hidden = true;
    return true;
  } catch (e) {
    $('overlay-text').textContent = 'Could not reach the server. ' + (e.message || '');
    $('overlay-retry').hidden = false; $('overlay-menu').hidden = false;
    return false;
  }
}

// Solo racing hosts the lobby/room engine in this page over a loopback channel
// (server/solo.js), so a static deploy with no server at all is still playable.
let soloHost = null;
async function openSoloHost() {
  if (!soloHost) {
    const { createSoloHost } = await import('../../server/solo.js');
    soloHost = createSoloHost();
  }
  return soloHost;
}
function closeSoloHost() {
  if (!soloHost) return;
  soloHost.stop();
  soloHost = null;
  ui.solo = false;
  ui.soloFilled = false;
}

/** is there a server behind this page? a static deploy (GitHub Pages, file://) has no /api */
let online = false;
async function probeServer() {
  if (new URLSearchParams(location.search).get('solo') === '1') return false;
  try {
    const base = settings.server ? settings.server.replace(/^ws/, 'http').replace(/\/ws$/, '') : '';
    const res = await fetch(base + '/api/health', { cache: 'no-store' });
    return res.ok;
  } catch { return false; }
}
(async () => {
  online = await probeServer();
  $('online-only').hidden = !online;
  $('offline-note').hidden = online;
  if (online) refreshRooms();
})();

// ------------------------------------------------------------------- menu ----
$('name').value = settings.name;
$('name').addEventListener('change', () => setSetting('name', $('name').value.trim().slice(0, 16)));
$('btn-settings').addEventListener('click', () => $('settings').classList.toggle('open'));
const bindToggle = (id, key, on = 'On', off = 'Off', after) => {
  const b = $(id); const paint = () => { b.textContent = settings[key] ? on : off; b.classList.toggle('on', !!settings[key]); };
  b.addEventListener('click', () => { setSetting(key, !settings[key]); paint(); after?.(); }); paint();
};
bindToggle('set-sound', 'sound', 'On', 'Off', () => audio.setMuted(!settings.sound));
bindToggle('set-music', 'music', 'On', 'Off', () => audio.setMusic(settings.music));
bindToggle('set-autothrottle', 'autoThrottle');
bindToggle('set-largehud', 'largeHud');
bindToggle('set-motion', 'reducedMotion');
$('set-quality').value = settings.quality; $('set-quality').addEventListener('change', (e) => { setSetting('quality', e.target.value); quality.applyManual(); });
$('set-touch').value = settings.touchSteer; $('set-touch').addEventListener('change', (e) => setSetting('touchSteer', e.target.value));
$('set-server').value = settings.server; $('set-server').addEventListener('change', (e) => { setSetting('server', e.target.value.trim()); client.close(); });
audio.muted = !settings.sound; audio.musicOn = settings.music;

$('btn-solo').addEventListener('click', () => { unlockAudio(); playSolo(); });

/** connect to the in-page host, open a private race and fill the grid with bots */
async function playSolo() {
  const btn = $('btn-solo');
  btn.disabled = true;
  try {
    if (client.connected) client.close();
    const host = await openSoloHost();
    ui.solo = true;
    ui.soloFilled = false;
    await client.connectLocal(host.channel, $('name').value.trim() || 'player');
    client.createRoom({ track: settings.track || 'meridian', laps: 3, botDifficulty: settings.botDifficulty }, false);
  } catch (e) {
    closeSoloHost();
    toast('Could not start solo racing');
  } finally {
    btn.disabled = false;
  }
}

$('btn-create').addEventListener('click', async () => { unlockAudio(); if (await ensureConnected()) client.createRoom({ track: 'meridian', laps: 3, botDifficulty: settings.botDifficulty }, true); });
$('btn-join').addEventListener('click', async () => {
  unlockAudio();
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length !== 4) return toast('Enter the 4-letter room code');
  if (await ensureConnected()) client.joinRoom(code);
});
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
$('overlay-retry').addEventListener('click', () => reconnect());
$('overlay-menu').addEventListener('click', () => { $('overlay').hidden = true; leaveToMenu(); });

async function refreshRooms() {
  if (ui.screen !== 'menu' || !online) return;
  try {
    const base = settings.server ? settings.server.replace(/^ws/, 'http').replace(/\/ws$/, '') : '';
    const res = await fetch(base + '/api/rooms', { cache: 'no-store' });
    const { rooms } = await res.json();
    const el = $('rooms');
    if (!rooms.length) { el.innerHTML = '<div class="muted">No open races right now. Create one.</div>'; return; }
    el.innerHTML = rooms.map(r => `<div class="roomrow"><span><b>${esc(r.name)}</b> · ${esc(TRACKS[r.opts.track]?.name || r.opts.track)} · ${r.opts.laps} laps</span><span>${r.players}/${r.max} <button class="btn small" data-join="${r.code}" ${r.phase === 'running' ? 'disabled' : ''}>${r.phase === 'running' ? 'Racing' : 'Join'}</button></span></div>`).join('');
    for (const b of el.querySelectorAll('[data-join]')) b.addEventListener('click', async () => { unlockAudio(); if (await ensureConnected()) client.joinRoom(b.dataset.join); });
  } catch { $('rooms').innerHTML = '<div class="muted">Server unreachable.</div>'; }
}
setInterval(refreshRooms, 3000);

function unlockAudio() { audio.ensure(); if (audio.ready) audio.setMusicMode(ui.screen === 'race' ? 'race' : 'menu'); }
input.onAny = unlockAudio;
window.addEventListener('pointerdown', () => { unlockAudio(); }, { once: true });
window.addEventListener('touchstart', () => document.documentElement.classList.add('touch'), { once: true, passive: true });

// ------------------------------------------------------------------ lobby ----
$('btn-leave').addEventListener('click', () => { client.leaveRoom(); leaveToMenu(); });
$('btn-ready').addEventListener('click', () => { ui.ready = !ui.ready; client.setReady(ui.ready); audio.play('ui'); });
$('btn-start').addEventListener('click', () => client.start());
$('btn-addbot').addEventListener('click', () => client.addBot());
$('btn-public').addEventListener('click', () => client.setPublic(!client.room?.public));
$('laps-minus').addEventListener('click', () => client.setOpts({ laps: (client.room?.opts.laps || 3) - 1 }));
$('laps-plus').addEventListener('click', () => client.setOpts({ laps: (client.room?.opts.laps || 3) + 1 }));
// bots run on the server, so difficulty is a room option rather than a local preference. It is also
// remembered, so a solo race starts at the level you last played.
$('set-difficulty').addEventListener('change', (e) => { setSetting('botDifficulty', e.target.value); client.setOpts({ botDifficulty: e.target.value }); });
$('btn-chat').addEventListener('click', sendChat);
$('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
function sendChat() { const t = $('chat-input').value.trim(); if (!t) return; client.chat(t); $('chat-input').value = ''; }
$('btn-results-ready').addEventListener('click', () => { ui.ready = true; ui.results = null; client.setReady(true); showLobby(client.room); });
$('btn-results-leave').addEventListener('click', () => { client.leaveRoom(); leaveToMenu(); });

// The lobby is the one moment a player is sitting still, so it is where the fullscreen prompt goes.
// F11 belongs to the browser and cannot be bound from a page -- the hint is all we can do there --
// but the Fullscreen API gives the same result from a click, so the button is the reliable path.
// It needs a user gesture, which a click is; calling it any other way is rejected.
const fsRoot = document.documentElement;
const enterFullscreen = fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen;
const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
// F11 is the shortcut on Windows and Linux only; on a Mac it is a Mission Control key and does
// nothing to the browser, so name the shortcut that actually works there.
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
if (mac) $('fullscreen-key').textContent = '⌃⌘F';
function syncFullscreen() {
  const full = isFullscreen();
  $('btn-fullscreen').textContent = full ? 'Exit fullscreen' : 'Fullscreen';
  // no keyboard to press F11 with, and nothing to advertise once we are already there
  $('fullscreen-tip').hidden = full || document.documentElement.classList.contains('touch');
  // iOS Safari has no Fullscreen API outside video; hide the row rather than offer a dead button
  $('btn-fullscreen').hidden = !enterFullscreen;
  $('fullscreen').hidden = $('fullscreen-tip').hidden && $('btn-fullscreen').hidden;
}
$('btn-fullscreen').addEventListener('click', () => {
  audio.play('ui');
  const req = isFullscreen() ? exitFullscreen?.call(document) : enterFullscreen?.call(fsRoot);
  Promise.resolve(req).catch(() => toast('Fullscreen was refused'));
});
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('webkitfullscreenchange', syncFullscreen);
syncFullscreen();

/**
 * On a phone the browser's own chrome is a large slice of a small screen, so going into a race
 * takes the whole of it. Fullscreen needs a user gesture, and the tap that starts the race is one --
 * hence this hangs off the buttons rather than off entering the race, which the server triggers.
 * Where there is no Fullscreen API (Safari has none outside video) it quietly does nothing; the
 * manifest asks for a fullscreen display mode, so installing to the home screen is the way there.
 */
function fullscreenForRace() {
  if (!document.documentElement.classList.contains('touch')) return;   // desktop keeps the button
  if (!enterFullscreen || isFullscreen()) { lockLandscape(); return; }
  // refusal is not worth a toast here; the lock is attempted once fullscreen is actually granted,
  // because that is the only state the browser will allow it in
  Promise.resolve(enterFullscreen.call(fsRoot)).then(lockLandscape, () => {});
}
/**
 * Hold the phone in landscape. Only Chromium implements this, and only inside fullscreen -- Safari
 * has no screen.orientation.lock at all -- so being refused is the ordinary case, not an error, and
 * the rotate prompt is what covers it. Leaving fullscreen releases the lock on its own.
 */
function lockLandscape() {
  try { screen.orientation?.lock?.('landscape')?.catch(() => {}); } catch { /* unsupported */ }
}
for (const id of ['btn-solo', 'btn-start', 'btn-ready', 'btn-results-ready']) $(id).addEventListener('click', fullscreenForRace);

// Safari has ignored user-scalable=no since iOS 10, so a pinch still zooms the page and -- with the
// meta tag refusing to scale back -- leaves it stuck. These are the events that pinch arrives on.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

function leaveToMenu() {
  ui.screen = 'menu'; ui.ready = false; ui.results = null;
  if (ui.solo) { client.close(); closeSoloHost(); }
  show('screen-menu'); hud.show(false);
  audio.stopAllEngines(); audio.setMusicMode('menu');
  refreshRooms();
}

function renderLobby(room) {
  const me = room.players.find(p => p.id === room.you);
  const isHost = room.hostId === room.you;
  $('lobby-code').textContent = ui.solo ? 'SOLO' : room.code;
  // solo has nobody to wait for: stay ready (changing an option clears the flag) and fill
  // the grid with bots once — every addBot echoes a room update, so this must not repeat
  if (ui.solo && room.phase === 'lobby') {
    if (me && !me.ready) client.setReady(true);
    if (!ui.soloFilled) {
      ui.soloFilled = true;
      const want = SOLO_BOTS - room.players.filter(p => p.bot).length;
      for (let i = 0; i < want; i++) client.addBot();
    }
  }
  const DIFFICULTY_LABEL = { easy: 'EASY', normal: 'MEDIUM', hard: 'HARD' };
  const diff = room.opts.botDifficulty || 'normal';
  $('lobby-track-name').textContent = `${TRACKS[room.opts.track]?.name || ''} · ${room.opts.laps} LAPS · ${DIFFICULTY_LABEL[diff]} BOTS${room.public ? ' · PUBLIC' : ' · PRIVATE'}`;
  $('set-difficulty').value = diff;
  prewarm(room.opts.track);
  $('host-opts').style.display = isHost ? '' : 'none';
  $('laps').textContent = room.opts.laps;
  $('btn-public').classList.toggle('on', !!room.public);
  $('btn-public').hidden = ui.solo;
  $('btn-ready').hidden = ui.solo;
  $('tracks').innerHTML = TRACK_IDS.map(id => `<div class="card${room.opts.track === id ? ' sel' : ''}" data-track="${id}"><div class="name">${TRACKS[id].name}</div><div class="team">${TRACKS[id].theme}</div></div>`).join('');
  for (const c of $('tracks').querySelectorAll('[data-track]')) c.addEventListener('click', () => client.setOpts({ track: c.dataset.track }));
  const myVehicle = me?.profile?.vehicle || ui.vehicle;
  $('vehicles').innerHTML = VEHICLES.map(v => `<div class="card${myVehicle === v.id ? ' sel' : ''}" data-vehicle="${v.id}">
    <div class="name"><span class="swatch" style="background:#${v.colour.toString(16).padStart(6, '0')}"></span>${v.name}</div><div class="team">${v.team}</div><div class="desc">${v.desc}</div>
    <div class="bars">${['topSpeed', 'accel', 'turnRate', 'damage', 'armor'].map(k => `<span>${{ topSpeed: 'SPD', accel: 'ACC', turnRate: 'TRN', damage: 'DMG', armor: 'ARM' }[k]}</span><i><b style="width:${Math.round((v[k] - 0.7) / 0.7 * 100)}%"></b></i>`).join('')}</div></div>`).join('');
  for (const c of $('vehicles').querySelectorAll('[data-vehicle]')) c.addEventListener('click', () => { ui.vehicle = c.dataset.vehicle; setSetting('vehicle', ui.vehicle); client.setProfile({ vehicle: ui.vehicle, name: $('name').value.trim() }); audio.play('ui'); });
  $('players').innerHTML = room.players.map(p => `<div class="prow${p.ready ? ' ready' : ''}${p.connected ? '' : ' off'}"><span>${esc(p.name)}${p.id === room.hostId ? ' <span class="muted">HOST</span>' : ''}${p.id === room.you ? ' <span class="muted">YOU</span>' : ''}</span><span class="muted">${esc(VEHICLES.find(v => v.id === p.profile?.vehicle)?.name || '—')}</span><span class="st">${p.bot ? 'BOT' : p.connected ? (p.ready ? 'READY' : 'waiting') : 'offline'}${isHost && p.id !== room.you ? ` <button class="btn small" data-kick="${p.id}">✕</button>` : ''}</span></div>`).join('');
  for (const b of $('players').querySelectorAll('[data-kick]')) b.addEventListener('click', () => client.kick(+b.dataset.kick));
  ui.ready = !!me?.ready;
  $('btn-ready').textContent = ui.ready ? 'Ready ✓' : 'Ready';
  $('btn-ready').classList.toggle('on', ui.ready);
  $('btn-start').hidden = !isHost;
  const humans = room.players.filter(p => !p.bot && p.connected);
  $('btn-start').disabled = !humans.every(p => p.ready);
}
function showLobby(room) { ui.screen = 'lobby'; show('screen-lobby'); hud.show(false); renderLobby(room); syncFullscreen(); audio.setMusicMode('menu'); }

// ----------------------------------------------------------------- client ----
client.onRoom = (room) => {
  if (!room) { if (ui.screen !== 'menu') { toast('Left the room'); leaveToMenu(); } return; }
  if (!client.race && room.phase !== 'running') { /* lobby */ }
  const me = room.players.find(p => p.id === room.you);
  if (me && (!me.profile?.vehicle) && ui.screen !== 'race') client.setProfile({ vehicle: ui.vehicle, name: $('name').value.trim() });
  if (room.phase === 'running') { if (ui.screen !== 'race') enterRace(room); }
  else if (room.phase === 'results' && ui.screen === 'results') { /* stay on results until the player leaves them */ }
  else showLobby(room);
};
client.onChat = (m) => { const c = $('chat'); c.insertAdjacentHTML('beforeend', `<div><b>${esc(m.from)}</b> ${esc(m.text)}</div>`); c.scrollTop = c.scrollHeight; if (ui.screen === 'race') hud.say(`${m.from}: ${m.text}`); };
client.onError = (m) => toast(m.message || m.code);
client.onState = (s) => {
  if (s !== 'disconnected') return;
  if (ui.solo) { closeSoloHost(); if (ui.screen !== 'menu') leaveToMenu(); return; }
  if (ui.screen !== 'menu') reconnect();
};
client.onResults = (results) => { ui.results = results; showResults(results); };
client.onEvents = ({ events }) => { for (const e of events) onEvent(e); };

async function reconnect() {
  $('overlay-text').textContent = 'Connection lost. Reconnecting…'; $('overlay-retry').hidden = true; $('overlay-menu').hidden = true; $('overlay').hidden = false;
  for (let i = 0; i < 4; i++) {
    try { await client.connect(serverUrl(), $('name').value.trim() || 'player'); $('overlay').hidden = true; return; }
    catch { await new Promise(r => setTimeout(r, 800 * (i + 1))); }
  }
  $('overlay-text').textContent = 'Could not reconnect.'; $('overlay-retry').hidden = false; $('overlay-menu').hidden = false;
}

// ------------------------------------------------------------------- race ----
function enterRace(room) {
  ui.screen = 'race'; ui.results = null; ui.spectateId = -1; ui.lastPhase = -1; ui.lastCount = 99; ui.elapsedAtFinish = null;
  show(null); hud.show(true);
  buildScene(room.opts.track, client.ribbon);
  for (const c of scene.crafts.values()) removeCraft(c);
  scene.crafts.clear();
  client.loaded();   // the grid waits for this before it counts down
  hud.status('');
  audio.setMusicMode('race');
}
const poseOf = (id) => id === client.me ? client.myPose() : lastOthers.racers.find(r => r.id === id) || client.latest?.byId[id] || null;
let lastOthers = { racers: [], projectiles: [] };
const nameOf = (id) => client.race?.byId[id]?.name || `#${id}`;
/**
 * Which way a hit on me came from, in craft space: 0 dead ahead, + to the right. Attackers are
 * placed from their pose relative to mine; a wall is simply whichever side of the road I am on.
 */
function hitBearing(e) {
  const mine = client.myPose();
  if (!mine) return null;
  if (e.by < 0) return e.source === 'wall' ? (mine.t >= 0 ? Math.PI / 2 : -Math.PI / 2) : null;
  const them = poseOf(e.by);
  if (!them) return null;
  const ds = deltaS(client.ribbon, mine.s, them.s);
  return wrapAngle(Math.atan2(them.t - mine.t, ds) - mine.yaw);
}
// Where a craft's minigun barrel is and which way it points, for the tracer to leave from. Null
// while the gun is still coming up out of its hatch, and fx falls back to the nose line.
const _muzzlePos = new THREE.Vector3(), _muzzleDir = new THREE.Vector3(), _muzzle = { pos: _muzzlePos, dir: _muzzleDir };
const muzzleOf = (id) => { const c = scene.crafts?.get(id); return c && minigunMuzzle(c, _muzzlePos, _muzzleDir) ? _muzzle : null; };

function onEvent(e) {
  if (!scene.fx) return;
  scene.fx.onEvent(e, poseOf, muzzleOf);
  const p = poseOf(e.id ?? e.a);
  const pos = p ? scene.fx.world(p.s, p.t, p.h) : null;
  const me = client.me;
  switch (e.t) {
    case 'go': audio.play('go'); hud.say('GO', 'good'); break;
    case 'fire': audio.play(e.item === 'mine' ? 'mine' : e.item, pos); if (e.item === 'mine' && e.id === me) hud.say('MINE DROPPED', 'good'); break;
    case 'shot': audio.play('minigun', pos); flashMinigun(scene.crafts.get(e.id)); break;
    case 'hit': if (e.dmg < 1) break; audio.play('hit', pos); if (e.id === me) { hud.hitFrom(hitBearing(e)); if (e.source !== 'wall' || e.dmg >= 4) hud.say(`−${e.dmg} from ${e.by >= 0 ? nameOf(e.by) : e.source}`, 'me'); } break;
    case 'absorb': audio.play('absorb', pos); break;
    case 'boom': audio.play('boom', scene.fx.world(e.s, e.tt, e.h)); break;
    case 'dead': audio.play('dead', pos); hud.say(e.by >= 0 && e.by !== e.id ? `${nameOf(e.by)} destroyed ${nameOf(e.id)}` : `${nameOf(e.id)} was destroyed`, 'kill'); if (e.id === me) hud.status('ELIMINATED — spectating'); break;
    case 'wall': if (e.id === me) audio.play('wall', null, { force: e.force }); break;
    case 'bump': if (e.a === me || e.b === me) audio.play('bump', null, { force: e.force }); break;
    case 'pickup': audio.play('pickup', pos); if (e.id === me) hud.say(`Picked up ${e.item.toUpperCase()}`, 'good'); break;
    case 'use': audio.play(e.item, pos); break;
    case 'lap': if (e.id === me) { audio.play('lap'); hud.say(`Lap ${e.lap} · ${fmtTime(e.time)}`, 'good'); } break;
    case 'finish': if (e.id === me) { audio.play('finish'); hud.say(`FINISHED · ${fmtTime(e.time)}`, 'good'); hud.status('FINISHED — spectating'); ui.elapsedAtFinish = e.time; } else hud.say(`${nameOf(e.id)} finished`); break;
    case 'end': break;
    default: break;
  }
}

function showResults(results) {
  ui.screen = 'results';
  show('screen-results'); hud.show(false);
  audio.stopAllEngines();
  const room = client.room;
  $('results-title').textContent = `${TRACKS[results.track]?.name || ''} · RESULTS`;
  $('results-table').querySelector('tbody').innerHTML = results.order.map(r => `<tr class="${r.id === client.me ? 'me' : ''} ${r.eliminated ? 'dead' : ''}">
    <td class="place">${r.finished ? ordinal(r.place) : '—'}</td><td>${esc(r.name || nameOf(r.id))}</td><td>${esc(VEHICLES.find(v => v.id === r.vehicle)?.name || r.vehicle)}</td>
    <td>${r.finished ? fmtTime(r.time) : r.abandoned ? 'left' : r.eliminated ? `destroyed${r.by >= 0 && r.by !== r.id ? ' by ' + esc(nameOf(r.by)) : ''}` : `${r.laps} laps`}</td><td>${r.bestLap ? fmtTime(r.bestLap) : '—'}</td><td>${r.kills}</td></tr>`).join('');
  const isHost = room && room.hostId === room.you;
  $('results-hint').textContent = isHost ? 'When everyone is ready, start the next race from the lobby.' : 'The host starts the next race once everyone is ready.';
  audio.setMusicMode('menu');
}

// spectate: tap/click cycles the followed racer
renderer.domElement.addEventListener('pointerdown', () => {
  if (ui.screen !== 'race' || !client.race) return;
  const me = client.race.byId[client.me];
  if (me && !me.dead) return;
  const alive = client.race.racers.filter(r => !r.dead && r.id !== client.me).sort((a, b) => a.rank - b.rank);
  if (!alive.length) return;
  const i = alive.findIndex(r => r.id === ui.spectateId);
  ui.spectateId = alive[(i + 1) % alive.length].id;
});

// ------------------------------------------------------------------- loop ----
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmpV = new THREE.Vector3();
const camUp = new THREE.Vector3(0, 1, 0), tmpUp = new THREE.Vector3(), tmpFrameUp = new THREE.Vector3();   // rolls with the road through a loop-the-loop
let acc = 0, last = performance.now(), fpsN = 0, fpsT = 0, fps = 0;
let camInit = false;

function frame(now) {
  requestAnimationFrame(frame);
  renderer.info.reset();
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  fpsN++; fpsT += dt; if (fpsT >= 1) { fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
  quality.sample(dt);
  hud.renderFeed();

  if (SHOWCASE) { renderShowcase(dt); return; }
  if (ui.screen === 'race' || (ui.screen === 'results' && scene.three)) {
    // fixed-rate input ticks
    acc += dt;
    let n = 0;
    while (acc >= DT && n++ < 15) { acc -= DT; if (ui.screen === 'race') client.tickInput(readInput()); }
    if (acc > DT * 4) acc = 0;   // a very long stall: drop the backlog instead of spiralling
    client.frame(dt);
    renderRace(dt);
  } else {
    if (!scene.three) buildScene('meridian', ribbonFor('meridian'));
    if (scene.three) {
      menuOrbit += dt * 0.08;
      const s = (menuOrbit * 60) % scene.ribbon.length;
      const w = toWorld(scene.ribbon, s, 0, 18);
      const f = w.frame;
      camera.position.set(w.x - f.tangent.x * 40 + f.right.x * 20, w.y + 14, w.z - f.tangent.z * 40 + f.right.z * 20);
      camera.lookAt(w.x, w.y, w.z);
      followSun(camera); scene.env?.update(dt, camera);
      scene.fx?.update(dt);
      bloom.render(scene.three, camera);
    }
  }
}

// showcase: static craft on the start straight, three-quarter front camera
const SHOWCASE_ANIM = { throttle: true, abL: false, abR: false, boost: false, speedFrac: 0.6, dead: false, firing: SHOWCASE_GUN, aimAt: null };
let showcaseT = 0;
function renderShowcase(dt) {
  if (!scene.three) {
    show(null); hud.show(false);
    buildScene(SHOWCASE_TRACK, ribbonFor(SHOWCASE_TRACK));
    const ids = SHOWCASE === 'all' ? VEHICLES.map(v => v.id) : [SHOWCASE];
    ids.forEach((id, i) => {
      const c = craftFor(i, VEHICLES.some(v => v.id === id) ? id : 'corsair');
      const row = Math.floor(i / 2), col = i % 2;
      const s = ids.length === 1 ? SHOWCASE_AT : SHOWCASE_AT + 10 - row * 9, t = ids.length === 1 ? 0 : (col - 0.5) * 11;
      poseObject(c.group, scene.ribbon, s, t, 0, 0, 0, HOVER_HEIGHT);
      animateCraft(c, SHOWCASE_ANIM);
    });
    // a soft key light so the hulls read under any theme's sky
    const key = new THREE.PointLight(0xfff4e0, 60, 60, 1.6); const kw = toWorld(scene.ribbon, SHOWCASE_AT + 4, -6, 9); key.position.set(kw.x, kw.y, kw.z); scene.three.add(key);
    window.__agrav.showcaseReady = true;
  }
  showcaseT += dt;
  const single = SHOWCASE !== 'all';
  const cw = single ? toWorld(scene.ribbon, SHOWCASE_AT + 6.2, 4.6, 2.4) : toWorld(scene.ribbon, SHOWCASE_AT + 28, 12, 8);
  const lw = single ? toWorld(scene.ribbon, SHOWCASE_AT - 0.4, -0.2, 0.9) : toWorld(scene.ribbon, SHOWCASE_AT - 2, 0, 1);
  camera.position.set(cw.x, cw.y, cw.z);
  camera.lookAt(lw.x, lw.y, lw.z);
  if (Math.abs(camera.fov - 50) > 0.1) { camera.fov = 50; camera.updateProjectionMatrix(); }
  for (const c of scene.crafts.values()) { animateCraft(c, SHOWCASE_ANIM, dt); for (const sp of c.exhaust) sp.material.opacity = 0.8 + Math.sin(showcaseT * 20) * 0.15; }
  followSun(camera); scene.env?.update(dt, camera);
  scene.fx?.update(dt);
  bloom.render(scene.three, camera);
}

// autopilot: the shared bot drives the predicted craft (demo mode, AFK, and the browser test)
let autopilotBot = null;
function readInput() {
  if (!ui.autopilot || !client.race || !client.pred) return input.read();
  const me = client.race.byId[client.me];
  if (!me) return input.read();
  autopilotBot ||= makeBot({ skill: 1, noise: 0.1 });
  const bot = botInput(client.race, { ...me, v: client.pred }, autopilotBot, Math.round(client.serverTickNow()));
  const human = input.read();
  return human.bits & IN.FIRE ? { bits: bot.bits | IN.FIRE, steer: bot.steer } : bot;
}

/**
 * A missile with my name on it: the server flags the lock (it knows which racer each missile is
 * chasing; the projectile on the wire does not say), and the nearest missile that is not mine gives
 * the bearing to put on the HUD ring. The alarm repeats while it holds, quicker as it closes.
 */
const _lockAt = new THREE.Vector3();
let lockBeepAt = 0;
function missileLock(pool, mine, flags) {
  if (!(flags & VF.LOCKED) || !mine) { hud.lock(false, null); return; }
  let near = null, nd = Infinity;
  for (const p of pool) {
    if (p.kind !== 'missile' || p.owner === client.me) continue;
    const ds = Math.abs(deltaS(client.ribbon, mine.s, p.s));
    if (ds < nd) { nd = ds; near = p; }
  }
  const bearing = near ? wrapAngle(Math.atan2(near.t - mine.t, deltaS(client.ribbon, mine.s, near.s)) - mine.yaw) : null;   // 0 is dead ahead, as hitBearing has it
  hud.lock(true, bearing);
  const now = performance.now(), gap = nd < 70 ? 220 : nd < 160 ? 380 : 620;
  if (now - lockBeepAt > gap) { lockBeepAt = now; audio.play('lock', null); }
}

/**
 * The car a burst is trained on: the nearest one ahead that is inside the gun's cone, which is the
 * same test `stepMinigun` picks its victim with — so the barrel points at whatever the shot will
 * actually hit, and at nothing when the nose is not lined up.
 */
const _aimAt = new THREE.Vector3();
function gunTarget(pool, from, id) {
  const M = WEAPON.minigun;
  let best = null, bd = M.range;
  for (const p of pool) {
    if (p.id === id) continue;
    const o = client.race.byId[p.id];
    if (!o || o.dead || o.finished) continue;
    const ds = deltaS(client.ribbon, from.s, p.s);
    if (ds <= 1 || ds > bd) continue;
    if (Math.abs((p.t - from.t) - Math.tan(from.yaw) * ds) > M.spread + ds * M.cone) continue;
    bd = ds; best = p;
  }
  if (!best) return null;
  const w = toWorld(client.ribbon, best.s, best.t, best.h + HOVER_HEIGHT + 0.4);
  return _aimAt.set(w.x, w.y, w.z);
}

function renderRace(dt) {
  const race = client.race;
  if (!race || !scene.three) return;
  const ribbon = scene.ribbon;
  const others = lastOthers = client.othersPoses();
  const myPose = client.myPose();
  const me = race.byId[client.me];
  const latest = client.latest;
  const phase = client.phase;

  // craft
  const seen = new Set();
  const aimPool = [];
  if (me && myPose) aimPool.push({ id: me.id, s: myPose.s, t: myPose.t, h: myPose.h });
  for (const p of others.racers) aimPool.push({ id: p.id, s: p.s, t: p.t, h: p.h });
  const place = (r, pose, isMe) => {
    seen.add(r.id);
    const c = craftFor(r.id, r.vehicle);
    const flags = latest?.byId[r.id]?.flags ?? 0;
    const dead = !!(flags & VF.DEAD);
    const bits = isMe ? pose.bits : (flags & VF.THROTTLE ? IN.THROTTLE : 0) | (flags & VF.AIRBRAKE_L ? IN.AIRBRAKE_L : 0) | (flags & VF.AIRBRAKE_R ? IN.AIRBRAKE_R : 0);
    const speed = Math.hypot(pose.vs, pose.vt);
    // How hard the craft is turning, as a fraction of full lock. My own craft knows its stick; for
    // everyone else it is recovered from the pose, and the curvature term is what makes it work --
    // yaw is measured against the tangent, so it barely moves through a steady bend even though
    // that is exactly where the lean should be deepest.
    let lock;
    if (isMe) lock = pose.steer;
    else {
      const f = frameAt(ribbon, pose.s);
      const turn = wrapAngle(pose.yaw - (c.lastYaw ?? pose.yaw)) / Math.max(1e-3, dt) + f.curvature * pose.vs;
      lock = Math.max(-1, Math.min(1, turn / Math.max(0.3, r.stats.turnRate / (1 + (speed / r.stats.topSpeed) * 0.55))));
    }
    c.lastYaw = pose.yaw;
    // nose follows the vertical motion in the air, and squats under power / lifts under braking
    const airborne = !(isMe ? pose.grounded : flags & VF.GROUNDED) || pose.h > 0.05;
    const pitchWant = airborne ? Math.max(-0.3, Math.min(0.3, -(pose.W || 0) / 30))
      : (bits & IN.BRAKE ? 0.10 : bits & IN.THROTTLE ? -0.06 : 0) * Math.min(1, speed / 25);
    const rollWant = -lock * 0.35 + (pose.vt / Math.max(20, speed)) * -0.4;
    // ease both: a key is a switch, and a hull this size does not snap 20 degrees in one frame
    const k = 1 - Math.exp(-dt * ATTITUDE_RATE);
    c.visRoll = (c.visRoll ?? rollWant) + (rollWant - (c.visRoll ?? rollWant)) * k;
    c.visPitch = (c.visPitch ?? pitchWant) + (pitchWant - (c.visPitch ?? pitchWant)) * k;
    const bob = Math.sin(performance.now() * 0.004 + r.id) * 0.08;
    poseObject(c.group, ribbon, pose.s, pose.t, pose.h, pose.yaw, c.visRoll, HOVER_HEIGHT + bob, c.visPitch);
    const firing = (latest?.byId[r.id]?.burstT ?? 0) > 0;
    animateCraft(c, { throttle: !!(bits & IN.THROTTLE), abL: !!(bits & IN.AIRBRAKE_L), abR: !!(bits & IN.AIRBRAKE_R), boost: !!(flags & VF.BOOST), speedFrac: Math.min(1, speed / r.stats.topSpeed), dead,
      firing, aimAt: firing ? gunTarget(aimPool, pose, r.id) : null }, dt);
    c.shield.visible = !!(flags & VF.SHIELD) && !dead;
    return c;
  };
  if (me && myPose) place(me, myPose, true);
  for (const p of others.racers) { const r = race.byId[p.id]; if (r) place(r, p, false); }
  for (const [id, c] of scene.crafts) if (!seen.has(id)) { removeCraft(c); scene.crafts.delete(id); }

  missileLock(others.projectiles, myPose, latest?.byId[client.me]?.flags ?? 0);

  // projectiles, pads
  scene.fx.setProjectiles(others.projectiles);
  if (latest) scene.track.pads.forEach((p, i) => { p.mesh.material = latest.pads[i] ? p.on : p.off; });

  // camera: chase my craft, or spectate
  let target = myPose, targetId = client.me;
  const meDead = me && me.dead;   // finished racers keep driving their cool-down lap
  if (meDead || !myPose) {
    const alive = race.racers.filter(r => !r.dead && r.id !== client.me).sort((a, b) => a.rank - b.rank);
    let pick = alive.find(r => r.id === ui.spectateId) || alive[0];
    if (pick) { target = others.racers.find(p => p.id === pick.id) || null; targetId = pick.id; ui.spectateId = pick.id; if (me?.dead) hud.status(`ELIMINATED — following ${nameOf(pick.id)} (tap to cycle)`); }
    else if (myPose) target = myPose;
  }
  if (target) {
    const speed = Math.hypot(target.vs, target.vt);
    const back = 11 + speed * 0.02, up = 4.2 + speed * 0.008;
    const cw = toWorld(ribbon, target.s - back, target.t * 0.6, target.h + up);
    const lw = toWorld(ribbon, target.s + 16, target.t, target.h + 1.6);
    tmpV.set(cw.x, cw.y, cw.z);
    if (!camInit) { camPos.copy(tmpV); camLook.set(lw.x, lw.y, lw.z); camInit = true; }
    const k = 1 - Math.exp(-dt * 12);
    camPos.lerp(tmpV, k);
    camLook.lerp(tmpV.set(lw.x, lw.y, lw.z), k);
    camera.position.copy(camPos);
    // through a loop the camera's up follows the road (weighted by the loop flag, so flat tracks keep world up exactly)
    const fr = cw.frame;
    tmpFrameUp.set(fr.up.x, fr.up.y, fr.up.z);
    tmpUp.set(0, 1, 0).lerp(tmpFrameUp, fr.loop || 0);
    if (tmpUp.lengthSq() < 0.01) tmpUp.copy(tmpFrameUp);
    camUp.lerp(tmpUp.normalize(), k).normalize();
    camera.up.copy(camUp);
    camera.lookAt(camLook);
    const boosting = !!(latest?.byId[targetId]?.flags & VF.BOOST);
    const fov = 72 + Math.min(1, speed / 100) * 10 + (boosting ? 8 : 0);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
  }
  for (const c of scene.crafts.values()) updateTrails(c, camera, performance.now() * 0.001);
  followSun(camera); scene.env?.update(dt, camera);
  scene.fx.update(dt);
  audio.setListener(camera);

  // audio: engines for the nearest few craft
  if (audio.ready) {
    const list = [];
    if (me && myPose) list.push({ id: me.id, pose: myPose, r: me, mine: true });
    for (const p of others.racers) { const r = race.byId[p.id]; if (r) list.push({ id: p.id, pose: p, r, mine: false }); }
    for (const it of list) {
      const flags = latest?.byId[it.id]?.flags ?? 0;
      if (flags & VF.DEAD) { audio.stopEngine(it.id); continue; }
      const c = scene.crafts.get(it.id);
      const d = c ? c.group.position.distanceTo(camera.position) : 999;
      if (!it.mine && d > 120) { audio.stopEngine(it.id); continue; }
      audio.engine(it.id, { speedFrac: Math.min(1, Math.hypot(it.pose.vs, it.pose.vt) / it.r.stats.topSpeed), throttle: it.mine ? !!(it.pose.bits & IN.THROTTLE) : !!(flags & VF.THROTTLE), boost: !!(flags & VF.BOOST), pos: c?.group.position, mine: it.mine });
    }
    if (myPose?.scraping) audio.play('scrape');
    // countdown beeps
    if (phase === PHASE.COUNTDOWN) { const n = Math.floor(-client.raceTickNow() / TICK_RATE); if (n !== ui.lastCount && n >= 0 && n <= 3) { audio.play('count'); ui.lastCount = n; } }
  }

  // HUD
  const raceTickNow = client.raceTickNow();
  const meRec = latest?.byId[client.me];
  hud.update({
    me: me && meRec ? { ...meRec, id: me.id, maxHp: me.maxHp, vehicle: me.vehicle, dead: me.dead, vs: myPose?.vs ?? meRec.vs, vt: myPose?.vt ?? meRec.vt } : null,
    racers: race.racers, phase, raceTick: raceTickNow, tickRate: TICK_RATE, laps: race.opts.laps,
    rtt: client.rtt, fps, interp: `${client.clock.leadTicks}t`, elapsed: ui.elapsedAtFinish ?? Math.max(0, raceTickNow / TICK_RATE),
    spectating: null
  });
  hud.drawMap(race.racers, client.me, (r) => { const p = r.id === client.me ? myPose : others.racers.find(x => x.id === r.id); const w = p ? toWorld(ribbon, p.s, p.t, 0) : toWorld(ribbon, r.v.s, r.v.t, 0); return w; });

  bloom.render(scene.three, camera);
}

// PWA
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
requestAnimationFrame(frame);
// expose for tools/racetest.js
window.__agrav = { client, input, hud, scene: () => scene, ui, settings, renderer, camera, THREE };
