// ============================================================================
// Scrap Rally client: menu and lobby over the platform's room protocol, then
// the race — a fixed 60 Hz input and prediction loop, and a rendered view
// interpolated from snapshots.
// ============================================================================

import * as THREE from 'three';
import { Client } from './net.js';
import { Input, CONTROLS, keyLabel } from './input.js';
import { Hud } from './hud.js';
import { Scene, isLite } from './render/scene.js';
import { buildTrackScene, animatePads, animateOverhead } from './render/track.js';
import { makeCarMesh, makeWreckMesh, setDamage, animateCar, TEAM_COLOURS } from './render/car.js';
import { Fx } from './render/fx.js';
import { Audio } from './audio.js';
import { Garage } from './garage.js';
import { prizeFor } from '../../shared/rally/career.js';
import { TRACKS } from '../../shared/rally/tracks/index.js';
import { WEAPONS } from '../../shared/rally/constants.js';
import { DT, PHASE } from '../../shared/rally/constants.js';

const $ = (id) => document.getElementById(id);
const ui = {
  menu: $('menu'), lobby: $('lobby'), over: $('over'), garage: $('garage'), status: $('status'),
  name: $('name'), code: $('code'), rooms: $('rooms'), seats: $('seats'), roomcode: $('roomcode'),
  sharelink: $('sharelink'), hostopts: $('hostopts'), lobbymsg: $('lobbymsg'), controls: $('controls'),
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
  screen: 'menu', playing: false, imReady: false, room: null, solo: false,
  acc: 0, lastFrame: 0, message: '', messageUntil: 0,
  spectate: -1, built: null, meshes: new Map(), wreckMeshes: new Map()
};

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const net = new Client();
const input = new Input();
const scene = new Scene($('scene'));
const hud = new Hud($('hud'));
const audio = new Audio();
const garage = new Garage($('garage-body'), (action) => net.careerAction(action.action, action));
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
net.onCareer = (m) => {
  if (m.error && m.error !== 'no-key') garage.say(m.error);
  renderGarage();
  if (app.screen === 'lobby' && net.room) onRoom(net.room);   // the weapon list may have changed
};

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
  if (app.solo) { stopRace(); closeSoloHost(); show('menu'); return; }
  if (app.playing || net.room) { connectedName = null; ensureConnected(); }
  else { stopRace(); show('menu'); }
}

// Solo racing hosts the lobby/room engine in this page over a loopback channel
// (server/solo.js), so a static deploy with no server is still a whole game. The
// career is kept in localStorage there, so the garage survives a reload.
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
  app.solo = false;
}

// -------------------------------------------------------------------- menu --
async function refreshRooms() {
  if (net.room || !online) return;
  try {
    const res = await fetch('/api/rooms', { cache: 'no-store' });
    renderRooms((await res.json()).rooms);
  } catch { /* offline: leave the list alone */ }
}

/** is there a server behind this page? a static deploy (GitHub Pages, file://) has no /api */
let online = false;
async function probeServer() {
  if (new URLSearchParams(location.search).get('solo') === '1') return false;
  try { return (await fetch('/api/health', { cache: 'no-store' })).ok; } catch { return false; }
}
(async () => {
  online = await probeServer();
  $('online').classList.toggle('hidden', !online);
  $('online-rooms').classList.toggle('hidden', !online);
  $('offlinenote').classList.toggle('hidden', online);
  if (online) refreshRooms();
})();
setInterval(() => { if (app.screen === 'menu') refreshRooms(); }, 3000);

$('solo').onclick = () => playSolo();

/** connect to the in-page host and open a private race; the lobby then works as usual */
async function playSolo() {
  const btn = $('solo');
  btn.disabled = true;
  try {
    if (net.connected) net.close();
    const host = await openSoloHost();
    app.solo = true;
    await net.connectLocal(host.channel, ui.name.value.trim() || 'Driver');
    connectedName = null;
    setStatus('solo');
    net.createRoom({ ...menuOpts(), fillBots: true }, false);
  } catch {
    closeSoloHost();
    flash('Could not start solo racing', 1800);
  } finally {
    btn.disabled = false;
  }
}

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
$('open-garage').onclick = async () => { await ensureConnected(); net.requestCareer(); show('garage'); renderGarage(); };
$('garage-close').onclick = () => show(net.room ? 'lobby' : 'menu');
$('to-garage').onclick = () => { net.requestCareer(); show('garage'); renderGarage(); };

function renderGarage() {
  if (app.screen !== 'garage') return;
  garage.render(net.career, net.careerKey);
  const c = net.career;
  $('garage-sub').textContent = c
    ? `${(c.money ?? 0).toLocaleString()} in hand · ${c.races ?? 0} races`
    : 'repairs first, then anything else';
}

// ------------------------------------------------------------------- lobby --
ui.ready.onclick = () => { app.imReady = !app.imReady; net.setReady(app.imReady); };
ui.addbot.onclick = () => net.addBot();
ui.start.onclick = () => net.start();
$('leave').onclick = () => {
  net.leaveRoom(); stopRace();
  if (app.solo) { net.close(); closeSoloHost(); }
  show('menu'); history.replaceState(null, '', location.pathname);
};
$('again').onclick = () => show(net.room ? 'lobby' : 'menu');
$('fullscreen').onclick = () => { document.documentElement.requestFullscreen?.().catch(() => {}); };
for (const sel of [OPT.lobTrack, OPT.lobLaps, OPT.lobBots, OPT.lobFill]) {
  sel.onchange = () => net.setOpts({
    track: OPT.lobTrack.value, laps: Number(OPT.lobLaps.value),
    botDifficulty: OPT.lobBots.value, fillBots: OPT.lobFill.value === '1'
  });
}

/**
 * What each control is, written out of the same table the input code binds from,
 * so a key that is listed is a key that works. Drawn once: it never changes.
 */
function renderControls() {
  if (!ui.controls || ui.controls.childElementCount) return;
  ui.controls.innerHTML = CONTROLS.map(c =>
    `<div class="what">${c.what}</div>` +
    `<div class="bound">${c.keys.map(k => `<kbd>${keyLabel(k)}</kbd>`).join('')}` +
    (c.pad ? `<span class="pad">${c.pad}</span>` : '') + '</div>').join('');
}

function onRoom(room) {
  app.room = room;
  if (!room) return;
  renderControls();
  const isHost = room.hostId === room.you;
  const me = room.players.find(p => p.id === room.you);
  app.imReady = !!me?.ready;
  if (!app.solo) history.replaceState(null, '', `${location.pathname}?room=${room.code}`);

  // a solo race is private to this page: no code to share, and nobody to wait for
  // (changing a lobby option clears the ready flag, so re-arm it whenever it drops)
  ui.roomcode.textContent = app.solo ? 'SOLO' : room.code;
  ui.sharelink.parentElement.classList.toggle('hidden', app.solo);
  ui.ready.classList.toggle('hidden', app.solo);
  if (app.solo && room.phase === 'lobby' && me && !me.ready) net.setReady(true);
  if (!app.solo) ui.sharelink.href = `${location.origin}${location.pathname}?room=${room.code}`;
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
  net.state.cars.forEach((seat, i) => {
    const mesh = makeCarMesh(seat.stats.id, TEAM_COLOURS[seat.id % TEAM_COLOURS.length], {
      bumper: seat.stats.bumper,
      weapon: seat.weapon,
      armour: seat.stats.upgrades?.armour ?? 0,
      number: i + 1
    });
    scene.three.add(mesh);
    app.meshes.set(seat.id, mesh);
  });
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
  app.lastResults = r;
  const mine = r.order.find(o => o.id === net.me);
  ui.overtitle.textContent = mine && mine.place === 1 ? 'YOU WIN' : 'RESULTS';
  ui.oversub.textContent = r.byElimination ? 'won by being the last car still running' : `${r.laps} laps`;
  ui.overrows.innerHTML = '';
  for (const o of r.order) {
    const tr = document.createElement('tr');
    const prize = prizeFor(o, r.prizeMultiplier).total || '—';
    tr.innerHTML = `<td>${o.place}</td><td class="${o.id === net.me ? 'me' : ''}">${escapeHtml(o.name || nameOf(o.id))}</td>` +
      `<td class="muted">${o.car}</td><td>${o.time ? o.time.toFixed(2) + 's' : o.eliminated ? 'wrecked' : '—'}</td>` +
      `<td>${o.kills || 0}</td><td class="money">${prize}</td>`;
    ui.overrows.appendChild(tr);
  }
  if (mine) {
    const prize = prizeFor(mine, r.prizeMultiplier);
    const bits = [];
    if (prize.place) bits.push(`${prize.place.toLocaleString()} for ${ordinal(mine.place)}`);
    else bits.push('no place money — you did not come home');
    if (prize.kills) bits.push(`${prize.kills.toLocaleString()} for ${mine.kills} kill${mine.kills === 1 ? '' : 's'}`);
    if (prize.cash) bits.push(`${prize.cash.toLocaleString()} picked up`);
    const hull = `You came home with ${Math.round(mine.hull)} of ${mine.maxHull} hull, and the mechanic wants paying before anything else.`;
    ui.overmoney.textContent = `${bits.join(' · ')}. ${hull}`;
  } else ui.overmoney.textContent = '';
  show('over');
}
function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${suffix}`;
}

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

  // how far the frame sits into the tick that has not happened yet
  const view = app.playing ? net.viewState(app.acc / DT) : null;
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
    animateCar(mesh, car, dt);
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
  if (app.built?.overhead?.length) animateOverhead(app.built.overhead, scene.target.x, scene.target.z);
  fx?.update(view, dt);

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
