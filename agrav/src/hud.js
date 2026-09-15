// ============================================================================
// AGRAV — race HUD (DOM). Everything here is set from the latest snapshot and
// the local prediction; nothing is authoritative.
// ============================================================================

import { ITEMS } from '../../shared/agrav/constants.js';
import { VEHICLES } from '../../shared/agrav/vehicles.js';

const $ = (id) => document.getElementById(id);
const ITEM_LABEL = { none: '', rocket: 'ROCKETS', missile: 'MISSILE', minigun: 'MINIGUN', mines: 'MINES', health: 'REPAIR', shield: 'SHIELD', speed: 'TURBO' };
const ITEM_GLYPH = { none: '', rocket: '➶', missile: '➹', minigun: '⁂', mines: '◉', health: '✚', shield: '◍', speed: '»' };

export class Hud {
  constructor() {
    this.el = {
      root: $('hud'), speed: $('hud-speed'), lap: $('hud-lap'), pos: $('hud-pos'), hp: $('hud-hp-fill'), hpText: $('hud-hp-text'),
      item: $('hud-item'), itemGlyph: $('hud-item-glyph'), itemLabel: $('hud-item-label'), itemAmmo: $('hud-item-ammo'),
      countdown: $('hud-countdown'), feed: $('hud-feed'), banner: $('hud-banner'), net: $('hud-net'), status: $('hud-status'),
      time: $('hud-time'), minimap: $('hud-minimap'), places: $('hud-places')
    };
    this.feed = [];
    this.lastItem = null;
    this.ctx = this.el.minimap.getContext('2d');
    this.mapPath = null;
  }

  show(on) { this.el.root.hidden = !on; }

  setTrackMap(ribbon) {
    // normalised top-down path, drawn once into an offscreen canvas
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const f of ribbon.frames) { minX = Math.min(minX, f.pos.x); maxX = Math.max(maxX, f.pos.x); minZ = Math.min(minZ, f.pos.z); maxZ = Math.max(maxZ, f.pos.z); }
    const span = Math.max(maxX - minX, maxZ - minZ) || 1;
    this.map = { minX, minZ, span, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    ribbon.frames.forEach((f, i) => { const p = this.mapPoint(f.pos); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
    g.closePath(); g.stroke();
    this.mapPath = c;
  }

  mapPoint(p) {
    const m = this.map, s = 140 / m.span;
    // x is mirrored so the map reads like the authored plan (north up, east right)
    return { x: 80 - (p.x - m.cx) * s, y: 80 - (p.z - m.cz) * s };
  }

  drawMap(racers, meId, ribbonPos) {
    if (!this.mapPath) return;
    const g = this.ctx;
    g.clearRect(0, 0, 160, 160);
    g.drawImage(this.mapPath, 0, 0);
    for (const r of racers) {
      if (r.dead) continue;
      const p = this.mapPoint(ribbonPos(r));
      g.beginPath(); g.arc(p.x, p.y, r.id === meId ? 4.5 : 3, 0, Math.PI * 2);
      g.fillStyle = r.id === meId ? '#fff' : '#' + (VEHICLES.find(v => v.id === r.vehicle)?.colour ?? 0x888888).toString(16).padStart(6, '0');
      g.fill();
    }
  }

  update({ me, racers, phase, raceTick, tickRate, laps, rtt, fps, interp, spectating, elapsed }) {
    const e = this.el;
    if (me) {
      const kmh = Math.round(Math.hypot(me.vs, me.vt) * 3.6);
      e.speed.textContent = kmh;
      e.lap.textContent = `LAP ${Math.min(laps, me.lap + 1)}/${laps}`;
      e.pos.textContent = ordinal(me.rank + 1) + (racers.length ? ` / ${racers.length}` : '');
      const pct = Math.max(0, Math.min(1, me.hp / me.maxHp));
      e.hp.style.width = (pct * 100).toFixed(1) + '%';
      e.hp.style.background = pct > 0.5 ? 'var(--ok)' : pct > 0.25 ? 'var(--warn)' : 'var(--bad)';
      e.hpText.textContent = Math.round(me.hp);
      e.item.classList.toggle('has', me.item !== 'none');
      e.itemGlyph.textContent = ITEM_GLYPH[me.item] || '';
      e.itemLabel.textContent = ITEM_LABEL[me.item] || '';
      e.itemAmmo.textContent = me.item !== 'none' && ITEMS[me.item].ammo > 1 ? `×${me.ammo}` : '';
      if (me.item !== this.lastItem) { e.item.classList.remove('pop'); void e.item.offsetWidth; e.item.classList.add('pop'); this.lastItem = me.item; }
      e.root.classList.toggle('shielded', me.shieldT > 0);
      e.root.classList.toggle('boosting', me.boostT > 0);
    }
    if (phase === 1) {
      // the grid holds until every client is in ("GET READY"), then counts 3, 2, 1, 0, one second each
      const n = Math.floor(-raceTick / tickRate);
      e.countdown.textContent = n > 3 ? 'GET READY' : n >= 0 ? String(n) : 'GO';
      e.countdown.classList.toggle('small', n > 3);
      e.countdown.hidden = false;
    } else if (phase === 2 && raceTick < tickRate * 1.2) {
      e.countdown.classList.remove('small');
      e.countdown.textContent = 'GO'; e.countdown.hidden = false;
    } else e.countdown.hidden = true;
    e.time.textContent = fmtTime(Math.max(0, elapsed));
    e.net.textContent = `${Math.round(rtt)} ms · ${fps} fps · ${interp}`;
    e.banner.hidden = !spectating;
    if (spectating) e.banner.textContent = spectating;
    // standings strip
    const top = [...racers].sort((a, b) => a.rank - b.rank).slice(0, 12);
    e.places.innerHTML = top.map(r => `<div class="place${r.id === me?.id ? ' me' : ''}${r.dead ? ' dead' : ''}${r.finished ? ' fin' : ''}"><span>${r.rank + 1}</span>${esc(r.name || r.vehicle)}</div>`).join('');
  }

  say(text, cls = '') {
    this.feed.push({ text, cls, t: performance.now() });
    if (this.feed.length > 5) this.feed.shift();
    this.renderFeed();
  }
  renderFeed() {
    const now = performance.now();
    this.feed = this.feed.filter(f => now - f.t < 5000);
    this.el.feed.innerHTML = this.feed.map(f => `<div class="${f.cls}">${esc(f.text)}</div>`).join('');
  }
  status(text) { this.el.status.textContent = text || ''; this.el.status.hidden = !text; }
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
export function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
export function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
