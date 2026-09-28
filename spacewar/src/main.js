// ============================================================================
// Spacewar client wiring: menu + lobby UI over the shared server's lobby
// protocol, then the running match — fixed-timestep input/prediction at 60 Hz
// and a rendered view interpolated from snapshots. Behind the menus, bots fly
// a demo match entirely in the page.
// ============================================================================

import { Client } from './net.js';
import { Input } from './input.js';
import { Renderer } from './render.js';
import { Audio } from './audio.js';
import spacewar from '../../shared/spacewar/module.js';
import { DT, SHIPS, FIELD_W, CX } from '../../shared/spacewar/constants.js';

const $ = (id) => document.getElementById(id);
const ui = {
  menu: $('menu'), lobby: $('lobby'), over: $('over'), status: $('status'), banner: $('banner'),
  name: $('name'), code: $('code'), rooms: $('rooms'), slots: $('slots'), roomtitle: $('roomtitle'), shareline: $('shareline'),
  sharelink: $('sharelink'), hostopts: $('hostopts'), lobbymsg: $('lobbymsg'),
  ready: $('ready'), addbot: $('addbot'), start: $('start'),
  optRounds: $('opt-rounds'), optBots: $('opt-bots'), optPlanet: $('opt-planet'), optFill: $('opt-fill'), optPublic: $('opt-public'),
  overtitle: $('overtitle'), standings: $('standings'),
  solo: $('solo'), online: $('online'), offlinenote: $('offlinenote'), mute: $('mute'), quit: $('quit'),
};

const app = {
  screen: 'menu',
  playing: false,
  names: [],
  imReady: false,
  bannerUntil: 0,
  acc: 0,
  lastFrame: 0,
  solo: false,        // this match is hosted in the page, not on a server
  go: 0,              // seconds the GO! stays up
  lastPhase: null,
};

// Solo play hosts the lobby/room engine in the page over a loopback channel, so the
// game runs with no server at all — that is what makes a static deploy playable.
let soloHost = null;
async function openSoloHost() {
  if (soloHost) return soloHost;
  const { createSoloHost } = await import('../../server/solo.js');
  soloHost = createSoloHost();
  return soloHost;
}
function closeSoloHost() {
  if (!soloHost) return;
  soloHost.stop();
  soloHost = null;
  app.solo = false;
}

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const net = new Client();
const input = new Input();
const renderer = new Renderer($('game'));
const audio = new Audio();
window.__spacewar = { app, net, renderer }; // for debugging and the browser test

// ---------------- sound ----------------
try { audio.setMuted(localStorage.getItem('spacewar.muted') === '1'); } catch { /* ignore */ }
ui.mute.classList.toggle('off', audio.muted);
ui.mute.onclick = () => {
  audio.resume();
  audio.setMuted(!audio.muted);
  ui.mute.classList.toggle('off', audio.muted);
  try { localStorage.setItem('spacewar.muted', audio.muted ? '1' : '0'); } catch { /* ignore */ }
};
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => audio.resume(), { passive: true });

// ---------------- name & connection ----------------
let savedName = null;
try { savedName = localStorage.getItem('spacewar.name'); } catch { /* storage blocked */ }
ui.name.value = savedName || `Pilot${Math.floor(Math.random() * 900 + 100)}`;
ui.name.addEventListener('change', () => { try { localStorage.setItem('spacewar.name', ui.name.value); } catch { /* ignore */ } });

net.onState = (s) => { if (s === 'disconnected') onDisconnected(); };
net.onError = (m) => flash(m.message || 'error', 1800);
net.onRoom = (room) => onRoom(room);
net.onEvents = (m) => onEvents(m);
net.onResults = (r) => onResults(r);

// The socket opens lazily, the first time the player creates or joins a room, so it carries
// the name they typed. The public room list on the menu comes from the HTTP /api endpoint.
let connectedName = null;
async function ensureConnected() {
  const name = ui.name.value.trim() || 'Pilot';
  if (net.connected && connectedName === name && !app.solo) return true;
  if (net.connected && (!net.room || app.solo)) { net.close(); closeSoloHost(); }
  try {
    await net.connect(wsUrl, name);
    connectedName = name;
    setStatus('online');
    return true;
  } catch {
    setStatus('offline');
    flash('Cannot reach the server', 1800);
    return false;
  }
}

function onDisconnected() {
  setStatus('disconnected');
  if (app.solo) {
    stopGame();
    app.room = null;
    closeSoloHost();
    show('menu');
    return;
  }
  if (app.playing || net.room) {
    connectedName = null;    // reattach: the same token resumes the room server-side
    ensureConnected();
  } else { stopGame(); app.room = null; show('menu'); }
}

let online = false;
const params = new URLSearchParams(location.search);
async function probeServer() {
  if (params.get('solo') === '1') return false;
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    return res.ok;
  } catch { return false; }
}
async function refreshRooms() {
  if (net.room || !online) return;
  try {
    const res = await fetch('/api/rooms', { cache: 'no-store' });
    const { rooms } = await res.json();
    renderRooms(rooms);
  } catch { /* offline: leave the list as is */ }
}
(async () => {
  online = await probeServer();
  ui.online.classList.toggle('hidden', !online);
  ui.offlinenote.classList.toggle('hidden', online);
  if (online) {
    refreshRooms();
    const wanted = params.get('room');   // deep link ?room=CODE joins straight away
    if (wanted && await ensureConnected()) net.joinRoom(wanted.toUpperCase());
  }
})();
setInterval(() => { if (app.screen === 'menu') refreshRooms(); }, 3000);

// ---------------- menu ----------------
ui.solo.onclick = () => playSolo();

async function playSolo() {
  ui.solo.disabled = true;
  try {
    if (net.connected) net.close();
    const host = await openSoloHost();
    app.solo = true;
    await net.connectLocal(host.channel, ui.name.value.trim() || 'Pilot');
    connectedName = null;
    setStatus('solo');
    net.createRoom(readOpts(), false);
  } catch {
    closeSoloHost();
    flash('Could not start solo play', 1800);
  } finally {
    ui.solo.disabled = false;
  }
}

$('quick').onclick = () => quickPlay();
$('create').onclick = async () => { if (await ensureConnected()) net.createRoom(readOpts(), ui.optPublic.checked); };
$('join').onclick = async () => { const c = ui.code.value.trim().toUpperCase(); if (c && await ensureConnected()) net.joinRoom(c); };
ui.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join').click(); });

let openRooms = [];
function renderRooms(rooms) {
  openRooms = (rooms || []).filter((r) => r.game === 'spacewar' && r.phase === 'lobby');
  ui.rooms.innerHTML = '';
  if (!openRooms.length) { ui.rooms.innerHTML = '<li class="muted">No open rooms. Create one!</li>'; return; }
  for (const r of openRooms) {
    const li = document.createElement('li');
    li.innerHTML = `<span><code>${r.code}</code> · ${escapeHtml(r.name || '')}</span><span class="muted">${r.players}/${r.max}</span>`;
    li.onclick = async () => { if (await ensureConnected()) net.joinRoom(r.code); };
    ui.rooms.appendChild(li);
  }
}

async function quickPlay() {
  if (!await ensureConnected()) return;
  await refreshRooms();
  const open = openRooms.find((r) => r.players < r.max);
  if (open) net.joinRoom(open.code);
  else net.createRoom(readOpts(), true);
}

function readOpts() {
  return {
    roundsToWin: Number(ui.optRounds.value),
    botDifficulty: ui.optBots.value,
    planet: ui.optPlanet.checked,
    fill: ui.optFill.checked,
  };
}

// ---------------- lobby ----------------
ui.ready.onclick = () => { app.imReady = !app.imReady; net.setReady(app.imReady); };
ui.addbot.onclick = () => net.addBot();
ui.start.onclick = () => net.start();
function leave() {
  net.leaveRoom();
  app.room = null;
  stopGame();
  if (app.solo) { net.close(); closeSoloHost(); }
  show('menu');
  history.replaceState(null, '', location.pathname);
}
$('leave').onclick = leave;
// two taps to leave: the first arms the button for a few seconds (no confirm(), which embedded pages may not get)
let quitArmed = 0;
ui.quit.onclick = () => {
  if (performance.now() < quitArmed) { quitArmed = 0; ui.quit.classList.remove('armed'); ui.quit.textContent = '✕'; leave(); return; }
  quitArmed = performance.now() + 3000;
  ui.quit.classList.add('armed'); ui.quit.textContent = 'Leave?';
  flash('Tap again to leave the match', 2500);
  setTimeout(() => { if (performance.now() >= quitArmed) { ui.quit.classList.remove('armed'); ui.quit.textContent = '✕'; } }, 3100);
};
$('rematch').onclick = () => show(net.room ? 'lobby' : 'menu');
for (const el of [ui.optRounds, ui.optBots, ui.optPlanet, ui.optFill]) el.onchange = () => net.setOpts(readOpts());
ui.optPublic.onchange = () => net.setOpts({}, ui.optPublic.checked);

function onRoom(room) {
  app.room = room;
  if (!room) { app.names = []; return; }
  app.names = [];
  for (const p of room.players) app.names[p.id] = p.name;
  const isHost = room.hostId === room.you;
  const me = room.players.find((p) => p.id === room.you);
  app.imReady = !!(me && me.ready);
  if (!app.solo) history.replaceState(null, '', `${location.pathname}?room=${room.code}`);

  ui.roomtitle.textContent = app.solo ? 'Solo match' : `Room ${room.code}`;
  ui.shareline.classList.toggle('hidden', app.solo);
  if (!app.solo) ui.sharelink.href = `${location.origin}${location.pathname}?room=${room.code}`;
  if (app.solo && room.phase !== 'running' && me && !me.ready) { app.imReady = true; net.setReady(true); }
  const opts = room.opts || {};
  ui.optRounds.value = String(opts.roundsToWin ?? 5);
  if (![...ui.optRounds.options].some((o) => o.value === ui.optRounds.value)) ui.optRounds.add(new Option(ui.optRounds.value));
  ui.optBots.value = opts.botDifficulty || 'normal';
  ui.optPlanet.checked = opts.planet !== false;
  ui.optFill.checked = opts.fill !== false;
  ui.optPublic.checked = room.public !== false;
  for (const el of ui.hostopts.querySelectorAll('select,input')) el.disabled = !isHost;
  ui.addbot.classList.toggle('hidden', !isHost);
  ui.start.classList.toggle('hidden', !isHost);
  ui.ready.textContent = app.imReady ? 'Not ready' : 'Ready';
  ui.ready.classList.toggle('hidden', app.solo);
  ui.optPublic.parentElement.classList.toggle('hidden', app.solo);

  renderSlots(room);

  const humans = room.players.filter((p) => !p.bot).length;
  const hostName = room.players.find((p) => p.id === room.hostId)?.name || 'the host';
  const fill = opts.fill !== false;
  const ships = room.players.length;
  if (room.phase === 'running') ui.lobbymsg.textContent = 'Match in progress…';
  else if (app.solo) ui.lobbymsg.textContent = fill ? 'Every empty seat gets a bot. Press Launch.' : `${ships} ship${ships === 1 ? '' : 's'}. Add bots, or turn on filling — a lone ship always gets company.`;
  else if (isHost) ui.lobbymsg.textContent = `${humans} pilot${humans === 1 ? '' : 's'} here. ${fill ? 'Empty seats will be filled with bots.' : 'Only the seats taken will fly.'} Launch when everyone is ready.`;
  else ui.lobbymsg.textContent = `Ready up. Waiting for ${hostName} to launch.`;

  if (room.phase === 'running') { if (!app.playing) startGame(); }
  else if (!app.playing && app.screen !== 'over') show('lobby');
}

function renderSlots(room) {
  const byId = new Map(room.players.map((p) => [p.id, p]));
  const fill = room.opts?.fill !== false;
  ui.slots.innerHTML = '';
  SHIPS.forEach((sh, id) => {
    const p = byId.get(id);
    const div = document.createElement('div');
    div.className = `slot${id === room.you ? ' me' : ''}`;
    div.style.setProperty('--c', sh.color);
    let who, cls;
    if (p && !p.bot) { who = escapeHtml(p.name); cls = 'human' + (p.ready ? ' ready' : ''); }
    else if (p) { who = escapeHtml(p.name); cls = 'bot'; }
    else { who = fill ? 'empty → bot' : 'empty'; cls = 'empty'; }
    const kick = (room.hostId === room.you && p && p.id !== room.hostId && room.phase !== 'running')
      ? `<button class="tag" data-kick="${p.id}">${p.bot ? 'remove' : 'kick'}</button>` : '';
    div.innerHTML = `<span class="role">${sh.name}</span><span class="who ${cls}">${who}</span>${kick}`;
    ui.slots.appendChild(div);
  });
  for (const btn of ui.slots.querySelectorAll('[data-kick]')) btn.onclick = () => net.kick(Number(btn.dataset.kick));
}

// ---------------- match ----------------
function startGame() {
  app.playing = true;
  app.lastPhase = null;
  renderer.clear();
  input.enabled = true;
  show(null);
}
function stopGame() { app.playing = false; input.enabled = false; input.showTouch(false); audio.thrust(false); }

const nameOf = (id) => (id === net.me ? 'You' : app.names[id] || SHIPS[id]?.name || '?');
const panOf = (x) => (x - CX) / (FIELD_W / 2);

function onEvents(m) {
  for (const ev of m.events || []) effect(ev, true);
}

/** turn a game event into sound, effects and a line of text; `live` is false for the demo */
function effect(ev, live) {
  switch (ev.kind) {
    case 'kill': {
      renderer.explode(ev.x, ev.y, ev.vx, ev.vy, ev.id);
      if (live) {
        audio.explode(panOf(ev.x), ev.id === net.me ? 1.2 : 0.8);
        let text;
        if (ev.cause === 'planet') text = `${nameOf(ev.id)} fell into the planet`;
        else if (ev.cause === 'collision') text = `${nameOf(ev.id)} collided with ${nameOf(ev.by)}`;
        else if (ev.by === ev.id) text = `${nameOf(ev.id)} ${ev.id === net.me ? 'were' : 'was'} hit by ${ev.id === net.me ? 'your' : 'their'} own torpedo`;
        else text = `${nameOf(ev.by)} destroyed ${ev.id === net.me ? 'you' : nameOf(ev.id)}`;
        if (ev.cause !== 'collision' || ev.id < ev.by) flash(text, 1800);
      }
      break;
    }
    case 'hyper':
      renderer.hyperOut(ev.x0, ev.y0, ev.id);
      renderer.hyperIn(ev.x, ev.y, ev.id);
      if (live) audio.hyper(panOf(ev.x0));
      break;
    case 'go':
      if (live) { app.go = 0.8; audio.blip(880, 0.18, 0.16); }
      break;
    case 'round':
      if (live) audio.fanfare(ev.winner === net.me);
      break;
    default:
  }
}

function onResults(r) {
  stopGame();
  const won = r.winner === net.me;
  ui.overtitle.textContent = r.winner >= 0 ? (won ? 'Victory!' : `${nameOf(r.winner)} wins`) : 'Match over';
  ui.standings.innerHTML = '<tr><th>Pilot</th><th>Rounds</th><th>Kills</th><th>Deaths</th></tr>' + r.standings.map((s) =>
    `<tr class="${s.id === r.winner ? 'win' : ''}"><td><span class="dot" style="color:${s.color}"></span>${escapeHtml(nameOf(s.id))}</td>` +
    `<td>${s.wins}</td><td>${s.kills}</td><td>${s.deaths}</td></tr>`).join('');
  setTimeout(() => { if (!app.playing) show('over'); }, 1200);
}

// ---------------- the demo behind the menus ----------------
const demo = {
  state: null, acc: 0,
  reset() {
    this.state = spacewar.createMatch({ roundsToWin: 99, planet: true, botDifficulty: 'normal' }, (Math.random() * 1e9) >>> 0);
    for (let id = 0; id < 4; id++) spacewar.addPlayer(this.state, id, {}, true);
    spacewar.start(this.state, 0);
    renderer.clear();
  },
  step(dt) {
    if (!this.state) this.reset();
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= DT) {
      this.acc -= DT;
      const events = [];
      spacewar.step(this.state, this.state.tick + 1, events);
      for (const ev of events) effect(ev, false);
    }
    const s = this.state;
    return { phase: s.phase, round: s.round, timer: s.timer, roundWinner: s.roundWinner, winner: -1, opts: s.opts, ships: s.ships, torps: s.torps };
  },
};

// ---------------- loops ----------------
function frame(now) {
  requestAnimationFrame(frame);
  if (!app.lastFrame) app.lastFrame = now;
  let dt = (now - app.lastFrame) / 1000;
  app.lastFrame = now;
  if (dt > 0.25) dt = 0.25;

  let view = null, info;
  if (app.playing) {
    app.acc += dt;
    while (app.acc >= DT) { app.acc -= DT; net.tickInput(input.sample()); }
    net.decay(dt);
    view = net.viewState();
    app.go = Math.max(0, app.go - dt);
    const mine = view?.ships[net.me];
    audio.thrust(!!(mine && mine.alive && !mine.hyper && mine.thrust && app.screen === null));
    if (view && mine) sounds(view);
    input.showTouch(app.screen === null);
    info = { me: net.me, names: app.names, dt, go: app.go, phaseText: phaseText(view) };
    setStatus(app.solo ? 'solo' : `${Math.round(net.rtt)} ms`);
  }
  if (!view) {
    view = demo.step(dt);
    info = { me: -1, names: [], dt, demo: true };
    view = { ...view, demo: true };
  } else if (demo.state) demo.state = null;
  renderer.draw(view, info);

  if (app.bannerUntil && now > app.bannerUntil) { ui.banner.classList.add('hidden'); app.bannerUntil = 0; }
}
requestAnimationFrame(frame);

/** new torpedoes make a sound where they leave the gun */
const heard = new Set();
function sounds(view) {
  for (const t of view.torps) {
    if (heard.has(t.id)) continue;
    heard.add(t.id);
    if (t.age < 12) audio.fire(panOf(t.x), t.owner === net.me ? 1 : 0.45);
  }
  if (heard.size > 400) for (const id of [...heard].slice(0, 200)) heard.delete(id);
  if (view.phase !== app.lastPhase) {
    if (view.phase === 'intro') audio.blip(440, 0.12, 0.12);
    app.lastPhase = view.phase;
  }
}

function phaseText(view) {
  if (!view) return '';
  if (view.phase === 'play') {
    const alive = view.ships.filter((s) => s && s.alive);
    if (alive.length > 1 && alive.every((s) => s.torps === 0)) return 'Out of torpedoes — the round will be a draw';
  }
  return '';
}

// ---------------- helpers ----------------
function show(which) {
  app.screen = which;
  for (const key of ['menu', 'lobby', 'over']) ui[key].classList.toggle('hidden', key !== which);
  const open = which !== null;
  input.enabled = !open && app.playing;
  ui.quit.classList.toggle('hidden', open || !app.playing);
  if (!open && document.activeElement?.blur) document.activeElement.blur();
}
function flash(text, ms) { ui.banner.textContent = text; ui.banner.classList.remove('hidden'); app.bannerUntil = performance.now() + ms; }
function setStatus(text) { ui.status.textContent = text; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
