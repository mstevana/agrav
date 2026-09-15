// ============================================================================
// Volley client wiring: menu + lobby UI over the shared server's lobby
// protocol, then the running match — fixed-timestep input/prediction at 60 Hz
// and a rendered view interpolated from snapshots.
// ============================================================================

import { Client } from './net.js';
import { Input } from './input.js';
import { Renderer } from './render.js';
import { DT, TEAM_NAMES } from '../../shared/volley/constants.js';

const $ = (id) => document.getElementById(id);
const ui = {
  menu: $('menu'), lobby: $('lobby'), over: $('over'), status: $('status'), banner: $('banner'),
  name: $('name'), code: $('code'), rooms: $('rooms'), slots: $('slots'), roomcode: $('roomcode'),
  sharelink: $('sharelink'), hostopts: $('hostopts'), lobbymsg: $('lobbymsg'),
  ready: $('ready'), addbot: $('addbot'), start: $('start'),
  optPoints: $('opt-points'), optBots: $('opt-bots'), optPublic: $('opt-public'),
  overtitle: $('overtitle'), overscore: $('overscore'),
};

const app = {
  screen: 'menu',
  playing: false,
  names: [],
  imReady: false,
  bannerUntil: 0,
  acc: 0,
  lastFrame: 0,
};

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const net = new Client();
const input = new Input();
const renderer = new Renderer($('game'));
window.__volley = { app, net }; // for debugging

// ---------------- name & connection ----------------
ui.name.value = localStorage.getItem('volley.name') || `Player${Math.floor(Math.random() * 900 + 100)}`;
ui.name.addEventListener('change', () => localStorage.setItem('volley.name', ui.name.value));

net.onState = (s) => { if (s === 'disconnected') onDisconnected(); };
net.onError = (m) => flash(m.message || 'error', 1600);
net.onRoom = (room) => onRoom(room);
net.onEvents = (m) => onEvents(m);
net.onResults = (r) => onResults(r);

// The socket opens lazily, the first time the player creates or joins a room, so it carries
// the name they typed. The public room list on the menu comes from the HTTP /api endpoint,
// so it works before any socket is open.
let connectedName = null;
async function ensureConnected() {
  const name = ui.name.value.trim() || 'Player';
  if (net.connected && connectedName === name) return true;
  if (net.connected && !net.room) net.close();   // reconnect so the new name takes effect
  try {
    await net.connect(wsUrl, name);
    connectedName = name;
    setStatus('connected');
    return true;
  } catch {
    setStatus('offline');
    flash('Cannot reach the server', 1600);
    return false;
  }
}

function onDisconnected() {
  setStatus('disconnected');
  if (app.playing || net.room) {
    // reattach: reconnecting with the same token resumes the room server-side
    connectedName = null;
    ensureConnected();
  } else { stopGame(); app.room = null; show('menu'); }
}

async function refreshRooms() {
  if (net.room) return;
  try {
    const res = await fetch('/api/rooms', { cache: 'no-store' });
    const { rooms } = await res.json();
    renderRooms(rooms);
  } catch { /* offline: leave the list as is */ }
}
refreshRooms();
setInterval(() => { if (app.screen === 'menu') refreshRooms(); }, 3000);

// deep link ?room=CODE joins straight away
(async () => {
  const wanted = new URLSearchParams(location.search).get('room');
  if (wanted && await ensureConnected()) net.joinRoom(wanted.toUpperCase());
})();

// ---------------- menu ----------------
$('quick').onclick = () => quickPlay();
$('create').onclick = async () => { if (await ensureConnected()) net.createRoom(readOpts(), ui.optPublic.checked); };
$('join').onclick = async () => { const c = ui.code.value.trim().toUpperCase(); if (c && await ensureConnected()) net.joinRoom(c); };
ui.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join').click(); });

let openRooms = [];
function renderRooms(rooms) {
  openRooms = rooms || [];
  ui.rooms.innerHTML = '';
  const volley = openRooms.filter((r) => r.game === 'volley' && r.phase === 'lobby');
  if (!volley.length) { ui.rooms.innerHTML = '<li class="muted">No open rooms. Create one!</li>'; return; }
  for (const r of volley) {
    const li = document.createElement('li');
    li.innerHTML = `<span><code>${r.code}</code> · ${escapeHtml(r.name || '')}</span><span class="muted">${r.players}/${r.max}</span>`;
    li.onclick = async () => { if (await ensureConnected()) net.joinRoom(r.code); };
    ui.rooms.appendChild(li);
  }
}

async function quickPlay() {
  if (!await ensureConnected()) return;
  await refreshRooms();
  const open = openRooms.find((r) => r.game === 'volley' && r.phase === 'lobby' && r.players < r.max);
  if (open) net.joinRoom(open.code);
  else net.createRoom(readOpts(), ui.optPublic.checked);
}

function readOpts() {
  return { pointsToWin: Number(ui.optPoints.value), botDifficulty: ui.optBots.value };
}

// ---------------- lobby ----------------
ui.ready.onclick = () => { app.imReady = !app.imReady; net.setReady(app.imReady); };
ui.addbot.onclick = () => net.addBot();
ui.start.onclick = () => net.start();
$('leave').onclick = () => { net.leaveRoom(); app.room = null; stopGame(); show('menu'); history.replaceState(null, '', location.pathname); };
$('rematch').onclick = () => show(net.room ? 'lobby' : 'menu');
for (const sel of [ui.optPoints, ui.optBots]) sel.onchange = () => net.setOpts(readOpts());
ui.optPublic.onchange = () => net.setOpts(readOpts());

function onRoom(room) {
  app.room = room;
  if (!room) { app.names = []; return; }
  app.names = [];
  for (const p of room.players) app.names[p.id] = p.name;
  const isHost = room.hostId === room.you;
  const me = room.players.find((p) => p.id === room.you);
  app.imReady = !!(me && me.ready);
  history.replaceState(null, '', `${location.pathname}?room=${room.code}`);

  ui.roomcode.textContent = room.code;
  ui.sharelink.href = `${location.origin}${location.pathname}?room=${room.code}`;
  const opts = room.opts || {};
  ui.optPoints.value = String(opts.pointsToWin ?? 15);
  ui.optBots.value = opts.botDifficulty || 'normal';
  ui.optPublic.checked = room.public !== false;
  ui.hostopts.classList.toggle('locked', !isHost);
  for (const el of ui.hostopts.querySelectorAll('select,input')) el.disabled = !isHost;
  ui.addbot.classList.toggle('hidden', !isHost);
  ui.start.classList.toggle('hidden', !isHost);
  ui.ready.textContent = app.imReady ? 'Not ready' : 'Ready';

  renderSlots(room);

  const humans = room.players.filter((p) => !p.bot).length;
  const hostName = room.players.find((p) => p.id === room.hostId)?.name || 'the host';
  if (room.phase === 'running') ui.lobbymsg.textContent = 'Match in progress…';
  else if (isHost) ui.lobbymsg.textContent = `${humans} player${humans === 1 ? '' : 's'} here. Add bots to fill the court, then start. Empty seats also play as bots.`;
  else ui.lobbymsg.textContent = `Ready up. Waiting for ${escapeHtml(hostName)} to start.`;

  if (room.phase === 'running') { if (!app.playing) startGame(room); }
  else if (!app.playing && app.screen !== 'over') show('lobby');
}

function renderSlots(room) {
  // fixed 2v2 court: show four seats left to right, humans/bots/empty
  const state = room.state || {};
  const seats = state.slots || [
    { slot: 0, team: 0, teamName: 'Blue', role: 'back' }, { slot: 1, team: 0, teamName: 'Blue', role: 'front' },
    { slot: 2, team: 1, teamName: 'Red', role: 'front' }, { slot: 3, team: 1, teamName: 'Red', role: 'back' },
  ];
  const byId = new Map(room.players.map((p) => [p.id, p]));
  ui.slots.innerHTML = '';
  for (const s of seats) {
    const p = byId.get(s.slot);
    const div = document.createElement('div');
    const mine = s.slot === room.you;
    div.className = `slot team${s.team}${mine ? ' me' : ''}`;
    let who, cls;
    if (p && !p.bot) { who = escapeHtml(p.name) + (p.ready ? '' : ''); cls = 'human' + (p.ready ? ' ready' : ''); }
    else if (p && p.bot) { who = escapeHtml(p.name); cls = 'bot'; }
    else { who = 'empty → bot'; cls = 'empty'; }
    const kick = (room.hostId === room.you && p && p.id !== room.hostId)
      ? `<button class="tag" data-kick="${p.id}">kick</button>` : '';
    div.innerHTML = `<span class="role">${s.teamName} · ${s.role}</span><span class="who ${cls}">${who}</span>${kick}`;
    ui.slots.appendChild(div);
  }
  for (const btn of ui.slots.querySelectorAll('[data-kick]')) btn.onclick = () => net.kick(Number(btn.dataset.kick));
}

// ---------------- match ----------------
function startGame(room) {
  app.playing = true;
  input.enabled = true;
  show(null);
  flash('Go!', 900);
}
function stopGame() { app.playing = false; input.enabled = false; }

function onEvents(m) {
  for (const ev of m.events || []) {
    if (ev.kind === 'point') {
      const why = ev.reason === 'touches' ? 'Too many touches' : 'Ball down';
      flash(`${why} — point ${TEAM_NAMES[ev.team]}`, 1300);
    }
  }
}

function onResults(r) {
  stopGame();
  const me = app.room?.players.find((p) => p.id === app.room.you);
  const myTeam = me ? (me.id <= 1 ? 0 : 1) : -1;
  const won = r.winner === myTeam;
  ui.overtitle.textContent = `${r.winnerName || TEAM_NAMES[r.winner]} wins${won ? ' — you win!' : ''}`;
  ui.overscore.textContent = `${r.score[0]} : ${r.score[1]}`;
  show('over');
}

// ---------------- loops ----------------
function frame(now) {
  requestAnimationFrame(frame);
  if (!app.lastFrame) app.lastFrame = now;
  let dt = (now - app.lastFrame) / 1000;
  app.lastFrame = now;
  if (dt > 0.25) dt = 0.25;

  if (app.playing) {
    app.acc += dt;
    while (app.acc >= DT) { app.acc -= DT; net.tickInput(input.sample()); }
  }

  const state = app.playing ? net.viewState() : null;
  let phaseText = '';
  if (state) {
    if (state.phase === 'point') phaseText = 'next serve…';
    else if (state.touchTeam >= 0) phaseText = `${state.touches}/3 touches`;
  }
  renderer.draw(state, { mySlot: net.me, names: app.names, time: now / 1000, phaseText });

  if (app.bannerUntil && now > app.bannerUntil) { ui.banner.classList.add('hidden'); app.bannerUntil = 0; }
  if (app.playing) setStatus(`${Math.round(net.rtt)} ms`);
}
requestAnimationFrame(frame);

// ---------------- helpers ----------------
function show(which) {
  app.screen = which;
  for (const key of ['menu', 'lobby', 'over']) ui[key].classList.toggle('hidden', key !== which);
  const open = which !== null;
  input.enabled = !open && app.playing;
  if (!open && document.activeElement?.blur) document.activeElement.blur();
}
function flash(text, ms) { ui.banner.textContent = text; ui.banner.classList.remove('hidden'); app.bannerUntil = performance.now() + ms; }
function setStatus(text) { ui.status.textContent = text; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
