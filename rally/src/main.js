// ============================================================================
// Scrap Rally client: menu and lobby over the platform's room protocol, then
// the race — a fixed 60 Hz input and prediction loop, and a rendered view
// interpolated from snapshots.
// ============================================================================

import * as THREE from 'three';
import { Client } from './net.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Scene, isLite } from './render/scene.js';
import { buildTrackScene, animatePads } from './render/track.js';
import { makeCarMesh, makeWreckMesh, setDamage, TEAM_COLOURS } from './render/car.js';
import { Fx } from './render/fx.js';
import { Audio } from './audio.js';
import { TRACKS } from '../../shared/rally/tracks/index.js';
import { WEAPONS } from '../../shared/rally/constants.js';
import { DT, PHASE } from '../../shared/rally/constants.js';

const $ = (id) => document.getElementById(id);
const ui = {
  menu: $('menu'), lobby: $('lobby'), over: $('over'), garage: $('garage'), status: $('status'),
  name: $('name'), code: $('code'), rooms: $('rooms'), seats: $('seats'), roomcode: $('roomcode'),
  sharelink: $('sharelink'), hostopts: $('hostopts'), lobbymsg: $('lobbymsg'),
  ready: $('ready'), addbot: $('addbot'), start: $('start'),
  overtitle: $('overtitle'), oversub: $('oversub'), overrows: $('overrows'), overmoney: $('overmoney'),
  touch: $('touch')
};
const OPT = {
  track: $('opt-track'), laps: $('opt-laps'), bots: $('opt-bots'), fill: $('opt-fill'), public: $('opt-public'),
  lobTrack: $('lob-track'), lobLaps: $('lob-laps'), lobBots: $('lob-bots'), lobFill: $('lob-fill'),
  weapon: $('lob-weapon')
};

for (const sel of [OPT.track, OPT.lobTrack]) {
  for (const t of TRACKS) sel.add(new Option(t.name, t.id));
}
for (const w of Object.values(WEAPONS)) OPT.weapon.add(new Option(w.name, w.id));
OPT.weapon.onchange = () => net.setProfile({ weapon: OPT.weapon.value });

const app = {
  screen: 'menu', playing: false, imReady: false, room: null,
  acc: 0, lastFrame: 0, message: '', messageUntil: 0,
  spectate: -1, built: null, meshes: new Map(), wreckMeshes: new Map()
};

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const net = new Client();
const input = new Input();
const scene = new Scene($('scene'));
const hud = new Hud($('hud'));
const audio = new Audio();
let fx = null;
window.__rally = { app, net, scene, input, audio, fx: () => fx, THREE };
// browsers will not make a sound until the player has touched the page
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => audio.resume(), { once: true });

if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

// ---------------------------------------------------------------- identity --
try { ui.name.value = localStorage.getItem('rally.name') || `Driver${Math.floor(Math.random() * 900 + 100)}`; }
catch { ui.name.value = 'Driver'; }
ui.name.addEventListener('change', () => { try { localStorage.setItem('rally.name', ui.name.value); } catch { /* ignore */ } });

net.onState = (s) => { if (s === 'disconnected') onDisconnected(); };
net.onError = (m) => flash(m.message || 'error', 1800);
net.onRoom = (room) => onRoom(room);
net.onEvents = (m) => onEvents(m);
net.onResults = (r) => onResults(r);
net.onCareer = (m) => { if (m.error && m.error !== 'no-key') flash(m.error, 1600); renderGarage(); };

let connectedName = null;
async function ensureConnected() {
  const name = ui.name.value.trim() || 'Driver';
  if (net.connected && connectedName === name) return true;
  if (net.connected && !net.room) net.close();
  try {
    await net.connect(wsUrl, name);
    connectedName = name;
    setStatus('connected');
    return true;
  } catch {
    setStatus('offline');
    flash('Cannot reach the server', 1800);
    return false;
  }
}

function onDisconnected() {
  setStatus('reconnecting');
  if (app.playing || net.room) { connectedName = null; ensureConnected(); }
  else { stopRace(); show('menu'); }
}

// -------------------------------------------------------------------- menu --
async function refreshRooms() {
  if (net.room) return;
  try {
    const res = await fetch('/api/rooms', { cache: 'no-store' });
    renderRooms((await res.json()).rooms);
  } catch { /* offline: leave the list alone */ }
}
refreshRooms();
setInterval(() => { if (app.screen === 'menu') refreshRooms(); }, 3000);

let openRooms = [];
function renderRooms(rooms) {
  openRooms = (rooms || []).filter(r => r.game === 'rally');
  ui.rooms.innerHTML = '';
  const open = openRooms.filter(r => r.phase === 'lobby');
  if (!open.length) { ui.rooms.innerHTML = '<li class="muted">No open races. Create one.</li>'; return; }
  for (const r of open) {
    const li = document.createElement('li');
    const track = TRACKS.find(t => t.id === r.opts?.track)?.name || 'Scrapyard';
    li.innerHTML = `<span><code>${r.code}</code> ${escapeHtml(r.name || '')}</span>` +
      `<span class="muted">${track} · ${r.opts?.laps ?? 3} laps · ${r.players}/${r.max}</span>`;
    li.onclick = async () => { if (await ensureConnected()) net.joinRoom(r.code); };
    ui.rooms.appendChild(li);
  }
}

const menuOpts = () => ({
  track: OPT.track.value, laps: Number(OPT.laps.value),
  botDifficulty: OPT.bots.value, fillBots: OPT.fill.value === '1'
});

$('create').onclick = async () => { if (await ensureConnected()) net.createRoom(menuOpts(), OPT.public.checked); };
$('join').onclick = async () => {
  const c = ui.code.value.trim().toUpperCase();
  if (c && await ensureConnected()) net.joinRoom(c);
};
ui.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join').click(); });
$('quick').onclick = async () => {
  if (!await ensureConnected()) return;
  await refreshRooms();
  const open = openRooms.find(r => r.phase === 'lobby' && r.players < r.max);
  if (open) net.joinRoom(open.code);
  else net.createRoom(menuOpts(), OPT.public.checked);
};
$('open-garage').onclick = async () => { await ensureConnected(); show('garage'); renderGarage(); };
$('garage-close').onclick = () => show(net.room ? 'lobby' : 'menu');
$('to-garage').onclick = () => { show('garage'); renderGarage(); };

// The garage proper arrives with the career; until then it says what it knows.
function renderGarage() {
  const body = $('garage-body');
  const c = net.career;
  if (!net.careerKey) {
    body.innerHTML = '<p class="muted">This browser will not let the game store anything, so there is no record to keep. ' +
      'You can still race: every start is a stock Vagabond with a machine gun.</p>';
    return;
  }
  if (!c) { body.innerHTML = '<p class="muted">Loading your record…</p>'; return; }
  body.innerHTML =
    `<div class="seat"><span class="who">Money</span><span class="money">${c.money ?? 0}</span></div>` +
    `<div class="seat"><span class="who">Car</span><span class="tag">${c.car ?? 'vagabond'}</span></div>` +
    `<div class="seat"><span class="who">Hull</span><span class="tag">${Math.round(c.hull ?? 0)} / ${c.maxHull ?? '—'}</span></div>` +
    `<div class="seat"><span class="who">Races</span><span class="tag">${c.races ?? 0} · ${c.wins ?? 0} wins</span></div>` +
    '<p class="muted" style="margin-top:14px">Repairs, upgrades, weapons and the rest of the ladder open up shortly.</p>';
}

// ------------------------------------------------------------------- lobby --
ui.ready.onclick = () => { app.imReady = !app.imReady; net.setReady(app.imReady); };
ui.addbot.onclick = () => net.addBot();
ui.start.onclick = () => net.start();
$('leave').onclick = () => { net.leaveRoom(); stopRace(); show('menu'); history.replaceState(null, '', location.pathname); };
$('again').onclick = () => show(net.room ? 'lobby' : 'menu');
$('fullscreen').onclick = () => { document.documentElement.requestFullscreen?.().catch(() => {}); };
for (const sel of [OPT.lobTrack, OPT.lobLaps, OPT.lobBots, OPT.lobFill]) {
  sel.onchange = () => net.setOpts({
    track: OPT.lobTrack.value, laps: Number(OPT.lobLaps.value),
    botDifficulty: OPT.lobBots.value, fillBots: OPT.lobFill.value === '1'
  });
}

function onRoom(room) {
  app.room = room;
  if (!room) return;
  const isHost = room.hostId === room.you;
  const me = room.players.find(p => p.id === room.you);
  app.imReady = !!me?.ready;
  history.replaceState(null, '', `${location.pathname}?room=${room.code}`);

  ui.roomcode.textContent = room.code;
  ui.sharelink.href = `${location.origin}${location.pathname}?room=${room.code}`;
  const o = room.opts || {};
  OPT.lobTrack.value = o.track || 'scrapyard';
  OPT.lobLaps.value = String(o.laps ?? 3);
  OPT.lobBots.value = o.botDifficulty || 'normal';
  OPT.lobFill.value = o.fillBots === false ? '0' : '1';
  ui.hostopts.classList.toggle('locked', !isHost);
  for (const el of ui.hostopts.querySelectorAll('select')) el.disabled = !isHost;
  ui.addbot.classList.toggle('hidden', !isHost);
  ui.start.classList.toggle('hidden', !isHost);
  ui.ready.textContent = app.imReady ? 'Not ready' : 'Ready';

  // only what the record says you own is on the menu
  const owned = net.career?.weapons || ['machinegun'];
  for (const opt of OPT.weapon.options) {
    const w = WEAPONS[opt.value];
    opt.disabled = !owned.includes(opt.value);
    opt.textContent = opt.disabled ? `${w.name} — locked` : w.name;
  }
  const mySeat = room.state?.cars.find(c => c.id === room.you);
  if (mySeat?.weapon) OPT.weapon.value = mySeat.weapon;

  renderSeats(room);
  const humans = room.players.filter(p => !p.bot).length;
  const hostName = room.players.find(p => p.id === room.hostId)?.name || 'the host';
  if (room.phase === 'running') ui.lobbymsg.textContent = 'Race in progress…';
  else if (isHost) {
    ui.lobbymsg.textContent = o.fillBots === false
      ? `${humans} on the grid. Empty seats stay empty.`
      : `${humans} on the grid. Every empty seat becomes a bot when you start.`;
  } else ui.lobbymsg.textContent = `Ready up. Waiting for ${hostName} to start.`;

  if (room.phase === 'running') { if (!app.playing) startRace(room); }
  else if (!app.playing && app.screen !== 'over' && app.screen !== 'garage') show('lobby');
}

function renderSeats(room) {
  const seats = room.state?.cars || [];
  const byId = new Map(room.players.map(p => [p.id, p]));
  ui.seats.innerHTML = '';
  const max = room.maxPlayers || 6;
  for (let id = 0; id < max; id++) {
    const p = byId.get(id);
    const car = seats.find(c => c.id === id);
    const div = document.createElement('div');
    div.className = `seat${p ? '' : ' empty'}${id === room.you ? ' me' : ''}`;
    const colour = `#${TEAM_COLOURS[id % TEAM_COLOURS.length].toString(16).padStart(6, '0')}`;
    const who = p ? escapeHtml(p.name) : (room.opts?.fillBots === false ? 'empty' : 'empty → bot');
    const tag = p
      ? `${car?.car || 'vagabond'}${car ? ` · ${WEAPONS[car.weapon]?.name || car.weapon}` : ''}` +
        `${p.bot ? ' · bot' : p.ready ? ' · ready' : ''}`
      : '';
    const kick = (room.hostId === room.you && p && p.id !== room.hostId)
      ? `<button class="tag" data-kick="${p.id}">kick</button>` : '';
    div.innerHTML = `<span class="dot" style="background:${colour}"></span><span class="who">${who}</span><span class="tag">${tag}</span>${kick}`;
    ui.seats.appendChild(div);
  }
  for (const b of ui.seats.querySelectorAll('[data-kick]')) b.onclick = () => net.kick(Number(b.dataset.kick));
}

// -------------------------------------------------------------------- race --
function startRace(room) {
  app.playing = true;
  app.spectate = -1;
  show(null);
  buildScene(room);
  net.loaded();                    // the grid holds until every client says this
  flash('Get ready', 1400);
}

function buildScene(room) {
  for (const m of app.meshes.values()) scene.three.remove(m);
  for (const m of app.wreckMeshes.values()) scene.three.remove(m);
  app.meshes.clear(); app.wreckMeshes.clear();
  const track = net.track;
  app.built = buildTrackScene(scene, track, room.seed);
  fx?.dispose();
  fx = new Fx(scene, track);
  for (const seat of net.state.cars) {
    const mesh = makeCarMesh(seat.stats.id, TEAM_COLOURS[seat.id % TEAM_COLOURS.length], { bumper: seat.stats.bumper });
    scene.three.add(mesh);
    app.meshes.set(seat.id, mesh);
  }
  const me = net.state.byId[net.me];
  if (me) scene.follow({ x: me.c.x, z: me.c.z, vx: 0, vz: 0 }, 1, true);
}

function stopRace() {
  app.playing = false;
  input.enabled = false;
  ui.touch.classList.remove('on');
  audio.stopEngine();
}

function onEvents(m) {
  for (const ev of m.events || []) {
    switch (ev.t) {
      case 'go': flash('GO', 900); audio.beep(true); audio.startEngine(); break;
      case 'lap':
        if (ev.id === net.me) { flash(`Lap ${ev.lap} — ${ev.time.toFixed(2)}s`, 1500); audio.beep(); }
        break;
      case 'finish':
        flash(ev.id === net.me ? 'Finished' : `${nameOf(ev.id)} is home`, 1600);
        hud.say(`${nameOf(ev.id)} finished`, '#7dff9a');
        break;
      case 'laststanding':
        flash(ev.id === net.me ? 'LAST DRIVER STANDING' : `${nameOf(ev.id)} is the last one running`, 2600);
        break;
      case 'dead': {
        const car = net.viewState()?.cars.find(c => c.id === ev.id);
        if (car) { fx?.boom(car.x, car.z, 1.6); audio.explosion(1.4); }
        hud.say(ev.by >= 0 && ev.by !== ev.id
          ? `${nameOf(ev.id)} wrecked by ${nameOf(ev.by)}`
          : `${nameOf(ev.id)} wrecked`, ev.id === net.me ? '#ff6a5a' : '#ffb03a');
        if (ev.id === net.me) { scene.kick(1.4); flash('Wrecked', 2200); }
        break;
      }
      case 'blast':
        fx?.boom(ev.x, ev.z, 1.1);
        audio.explosion(0.9);
        break;
      case 'mine': if (ev.id === net.me) flash('Mine down', 900); break;
      case 'pickup':
        if (ev.id === net.me) { flash(PICKUP_TEXT[ev.item] || ev.item, 1100); audio.pickup(); }
        break;
      case 'cash':
        if (ev.id === net.me) { flash(`+${ev.amount}`, 1300); audio.cash(); }
        hud.say(`${nameOf(ev.id)} picked up ${ev.amount}`, '#c9f24a');
        break;
      case 'hit':
        if (ev.id === net.me) scene.kick(Math.min(0.4, ev.dmg / 90));
        break;
      case 'wall':
        if (ev.id === net.me && ev.force > 14) { scene.kick(Math.min(1, ev.force / 40)); audio.impact(Math.min(1, ev.force / 30)); }
        break;
      case 'bump':
        if ((ev.a === net.me || ev.b === net.me) && ev.force > 10) {
          scene.kick(Math.min(0.8, ev.force / 45));
          audio.impact(Math.min(1, ev.force / 35));
        }
        break;
      default: break;
    }
  }
}
const PICKUP_TEXT = { ammo: 'Ammo', nitro: 'Nitro', repair: 'Repaired', mines: 'Mine', cash: 'Cash' };

/** the room knows everyone's name; the race state only carries what a profile put there */
function nameOf(id) { return app.room?.players.find(p => p.id === id)?.name || `car ${id + 1}`; }

function onResults(r) {
  stopRace();
  const mine = r.order.find(o => o.id === net.me);
  ui.overtitle.textContent = mine && mine.place === 1 ? 'YOU WIN' : 'RESULTS';
  ui.oversub.textContent = r.byElimination ? 'won by being the last car still running' : `${r.laps} laps`;
  ui.overrows.innerHTML = '';
  for (const o of r.order) {
    const tr = document.createElement('tr');
    const prize = o.eliminated && !o.finished ? '—' : Math.round((PRIZES[o.place - 1] ?? 0) * (r.prizeMultiplier || 1));
    tr.innerHTML = `<td>${o.place}</td><td class="${o.id === net.me ? 'me' : ''}">${escapeHtml(o.name || nameOf(o.id))}</td>` +
      `<td class="muted">${o.car}</td><td>${o.time ? o.time.toFixed(2) + 's' : o.eliminated ? 'wrecked' : '—'}</td>` +
      `<td>${o.kills || 0}</td><td class="money">${prize}</td>`;
    ui.overrows.appendChild(tr);
  }
  ui.overmoney.textContent = mine
    ? `You came home with ${Math.round(mine.hull)} of ${mine.maxHull} hull. Repairs come out of the prize money.`
    : '';
  show('over');
}
const PRIZES = [600, 350, 200, 60, 60, 60];

// ------------------------------------------------------------------- loop --
function frame(now) {
  requestAnimationFrame(frame);
  if (!app.lastFrame) app.lastFrame = now;
  let dt = (now - app.lastFrame) / 1000;
  app.lastFrame = now;
  if (dt > 0.25) dt = 0.25;

  if (app.playing) {
    app.acc += dt;
    let steps = 0;
    while (app.acc >= DT && steps++ < 6) { app.acc -= DT; net.tickInput(input.sample(DT)); }
  }

  const view = app.playing ? net.viewState() : null;
  if (view) drawWorld(view, dt, now / 1000);
  scene.render();
  hud.draw(view, { message: now < app.messageUntil ? app.message : '', spectating: app.spectate >= 0 ? nameOf(app.spectate) : null });
  if (app.playing) setStatus(`${Math.round(net.rtt)} ms${isLite() ? ' · lite' : ''}`);
}
requestAnimationFrame(frame);

function drawWorld(view, dt, time) {
  for (const car of view.cars) {
    const mesh = app.meshes.get(car.id);
    if (!mesh) continue;
    mesh.visible = !car.dead;
    if (car.dead) continue;
    mesh.position.set(car.x, 0, car.z);
    mesh.rotation.y = car.yaw;
    setDamage(mesh, car.hull / Math.max(1, car.maxHull));
  }
  for (const w of view.wrecks || []) {
    let mesh = app.wreckMeshes.get(w.id);
    if (!mesh) {
      const seat = net.state.byId[w.id];
      mesh = makeWreckMesh(seat?.stats.id || 'vagabond');
      scene.three.add(mesh);
      app.wreckMeshes.set(w.id, mesh);
    }
    mesh.position.set(w.x, 0, w.z);
    mesh.rotation.y = w.yaw;
  }
  if (app.built) animatePads(app.built.pads, time, view.pads);
  fx?.update(view, dt, net.me);

  const me = view.cars.find(c => c.mine);
  if (me && !me.dead) {
    audio.engineAt(Math.min(1, me.speed / 45), me.speed > 1 ? 1 : 0.4);
    if (me.firing) audio.shot(me.weapon);
  }

  // follow my car, or whoever I am watching once mine is gone
  let subject = me;
  if (me?.dead) {
    const others = view.cars.filter(c => !c.dead);
    if (app.spectate < 0 || !others.some(c => c.id === app.spectate)) app.spectate = others[0]?.id ?? -1;
    subject = others.find(c => c.id === app.spectate) || me;
  } else app.spectate = -1;
  if (subject) scene.follow(subject, dt);
}

// tap or click while wrecked to watch somebody else
addEventListener('pointerdown', () => {
  if (!app.playing || app.spectate < 0) return;
  const view = net.viewState();
  const alive = view?.cars.filter(c => !c.dead) || [];
  if (alive.length < 2) return;
  const i = alive.findIndex(c => c.id === app.spectate);
  app.spectate = alive[(i + 1) % alive.length].id;
});

// ------------------------------------------------------------ touch input --
(() => {
  const zone = $('steerzone');
  let id = null, originX = 0;
  const set = (v) => input.setTouchSteer(v);
  zone.addEventListener('pointerdown', (e) => { id = e.pointerId; originX = e.clientX; zone.setPointerCapture(id); input.setTouch('throttle', true); });
  zone.addEventListener('pointermove', (e) => { if (e.pointerId !== id) return; set(Math.max(-1, Math.min(1, (e.clientX - originX) / 90))); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; set(0); input.setTouch('throttle', false); };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
  for (const [el, name] of [['t-brake', 'brake'], ['t-fire', 'fire'], ['t-mine', 'mine'], ['t-nitro', 'nitro']]) {
    const b = $(el);
    b.addEventListener('pointerdown', () => { b.classList.add('on'); input.setTouch(name, true); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
      b.addEventListener(ev, () => { b.classList.remove('on'); input.setTouch(name, false); });
    }
  }
})();

// ----------------------------------------------------------------- helpers --
function show(which) {
  app.screen = which;
  for (const key of ['menu', 'lobby', 'over', 'garage']) ui[key].classList.toggle('hidden', key !== which);
  const open = which !== null;
  input.enabled = !open && app.playing;
  ui.touch.classList.toggle('on', !open && app.playing);
  if (!open) document.activeElement?.blur?.();
}
function flash(text, ms) { app.message = text; app.messageUntil = performance.now() + ms; }
function setStatus(t) { ui.status.textContent = t; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// deep link ?room=CODE
(async () => {
  const wanted = new URLSearchParams(location.search).get('room');
  if (wanted && await ensureConnected()) net.joinRoom(wanted.toUpperCase());
})();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
