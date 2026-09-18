// ============================================================================
// AGRAV — race HUD (DOM). Everything here is set from the latest snapshot and
// the local prediction; nothing is authoritative.
// ============================================================================

import { ITEMS } from '../../shared/agrav/constants.js';
import { VEHICLES } from '../../shared/agrav/vehicles.js';

const $ = (id) => document.getElementById(id);
const ITEM_LABEL = { none: '', rocket: 'ROCKETS', missile: 'MISSILE', minigun: 'MINIGUN', mines: 'MINES', health: 'REPAIR', shield: 'SHIELD', speed: 'TURBO' };
const ITEM_GLYPH = { none: '', rocket: '➶', missile: '➹', minigun: '⁂', mines: '◉', health: '✚', shield: '◍', speed: '»' };

// A craft seen from above, nose up, in a 128 unit box: enough of a delta to read as your own hull
// at a glance. Scorch marks are laid on fixed spots so damage accumulates in the same places.
const HULL = [[64, 6], [76, 40], [96, 54], [116, 96], [92, 92], [80, 108], [48, 108], [36, 92], [12, 96], [32, 54], [52, 40]];
const SCORCH = [[52, 46], [82, 62], [40, 82], [92, 88], [64, 34], [26, 92], [104, 92], [64, 96]];
const CRITICAL = 0.3;       // below this the readout goes red and the vignette pulses
const GHOST_HOLD = 900;     // ms the "hull you had a moment ago" marker lingers
const ARC_HOLD = 1100;      // ms a directional hit arc stays up

export class Hud {
  constructor() {
    this.el = {
      root: $('hud'), speed: $('hud-speed'), lap: $('hud-lap'), pos: $('hud-pos'), hpText: $('hud-hp-text'),
      hull: $('hud-hull'), hullCanvas: $('hud-hull-canvas'), fill: $('hud-armour-fill'), ghost: $('hud-armour-ghost'),
      damage: $('hud-damage'), arc: $('hud-damage-arc'),
      item: $('hud-item'), itemGlyph: $('hud-item-glyph'), itemLabel: $('hud-item-label'), itemAmmo: $('hud-item-ammo'),
      countdown: $('hud-countdown'), feed: $('hud-feed'), banner: $('hud-banner'), net: $('hud-net'), status: $('hud-status'),
      time: $('hud-time'), minimap: $('hud-minimap'), places: $('hud-places')
    };
    this.feed = [];
    this.lastItem = null;
    this.ctx = this.el.minimap.getContext('2d');
    this.mapPath = null;
    this.hullCtx = this.el.hullCanvas.getContext('2d');
    this.ghostPct = 1; this.ghostAt = 0;
    this.arcAt = -1e9; this.arcAngle = 0;
    this.lastPct = 1;
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

  /**
   * A hit landed on me: flash the cluster and swing an arc to the side it came from.
   * `bearing` is radians in craft space, 0 dead ahead and + to the right; null for an unknown source.
   */
  hitFrom(bearing) {
    const e = this.el;
    e.hull.classList.remove('hit'); void e.hull.offsetWidth; e.hull.classList.add('hit');
    if (bearing == null) return;
    this.arcAngle = bearing; this.arcAt = performance.now();
  }

  /** the hull silhouette, tinted and scorched by how much of it is left */
  drawHull(pct, colour) {
    const g = this.hullCtx;
    g.clearRect(0, 0, 128, 128);
    // team paint while healthy, through amber, to red as the plating goes
    const tint = pct > 0.5 ? mix(0xffb020, colour, (pct - 0.5) * 2) : mix(0xff3040, 0xffb020, pct * 2);
    g.beginPath();
    HULL.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = rgba(tint, 0.2 + (1 - pct) * 0.32);
    g.fill();
    g.strokeStyle = rgba(tint, 0.95); g.lineWidth = 3; g.lineJoin = 'round'; g.stroke();
    // scorch: one more burn for every sixth of the hull lost, always in the same places
    g.fillStyle = 'rgba(8,6,10,0.8)';
    const burns = Math.min(5, Math.round((1 - pct) * 6));
    for (let i = 0; i < burns; i++) {
      const [x, y] = SCORCH[i];
      g.beginPath(); g.ellipse(x, y, 9, 7, i * 1.1, 0, Math.PI * 2); g.fill();
    }
    // the ring the directional hit arcs are drawn on
    const age = (performance.now() - this.arcAt) / ARC_HOLD;
    if (age < 1) {
      g.beginPath();
      g.arc(64, 64, 60, this.arcAngle - Math.PI / 2 - 0.5, this.arcAngle - Math.PI / 2 + 0.5);
      g.strokeStyle = `rgba(255,90,90,${(1 - age).toFixed(3)})`; g.lineWidth = 7; g.lineCap = 'round'; g.stroke();
    }
  }

  update({ me, racers, phase, raceTick, tickRate, laps, rtt, fps, interp, spectating, elapsed }) {
    const e = this.el;
    if (me) {
      const kmh = Math.round(Math.hypot(me.vs, me.vt) * 3.6);
      e.speed.textContent = kmh;
      e.lap.textContent = `LAP ${Math.min(laps, me.lap + 1)}/${laps}`;
      e.pos.textContent = ordinal(me.rank + 1) + (racers.length ? ` / ${racers.length}` : '');
      // --- hull: segmented bar, a ghost marking where it was before the last hit, and the silhouette
      const pct = Math.max(0, Math.min(1, me.hp / me.maxHp));
      const now = performance.now();
      if (pct < this.lastPct - 0.001) { this.ghostPct = Math.max(this.ghostPct, this.lastPct); this.ghostAt = now; }
      if (now - this.ghostAt > GHOST_HOLD || pct > this.lastPct) this.ghostPct = pct;
      this.lastPct = pct;
      e.fill.style.transform = `scaleX(${pct.toFixed(4)})`;
      e.fill.style.background = pct > 0.5 ? 'var(--ok)' : pct > CRITICAL ? 'var(--warn)' : 'var(--bad)';
      e.ghost.style.transform = `scaleX(${Math.max(pct, this.ghostPct).toFixed(4)})`;
      e.hpText.textContent = Math.round(pct * 100);
      e.root.classList.toggle('critical', pct <= CRITICAL && !me.dead);
      // the screen edge reddens as the hull goes, and flares for a moment on each hit
      // it has to stay readable to drive through, so the wash only starts once the hull is really going
      const flare = Math.max(0, 1 - (now - this.arcAt) / 420) * 0.25;
      e.damage.style.opacity = Math.min(1, Math.max(0, (0.45 - pct) / 0.45) * 0.55 + flare).toFixed(3);
      // a wash from the edge the hit came from: 0 rad is dead ahead, so red starts at the top
      e.arc.style.opacity = (Math.max(0, 1 - (now - this.arcAt) / ARC_HOLD) * 0.7).toFixed(3);
      e.arc.style.background = `linear-gradient(${(180 + this.arcAngle * 180 / Math.PI).toFixed(0)}deg, rgba(255,70,70,0.5), transparent 38%)`;
      this.drawHull(pct, VEHICLES.find(v => v.id === me.vehicle)?.colour ?? 0x3fd1ff);
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
const mix = (a, b, k) => {
  k = Math.max(0, Math.min(1, k));
  const c = (sh) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * k);
  return (c(16) << 16) | (c(8) << 8) | c(0);
};
const rgba = (c, a) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a.toFixed(3)})`;

export function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
