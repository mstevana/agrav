// ============================================================================
// The race HUD, drawn on a 2D canvas over the scene: hull, speed, lap, place,
// a minimap of the circuit with everyone on it, and the countdown.
//
// It only writes when something has actually changed, so a static HUD costs
// nothing per frame.
// ============================================================================

import { frameAt } from '../../shared/sim/spline.js';
import { TEAM_COLOURS } from './render/car.js';
import { PHASE } from '../../shared/rally/constants.js';

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = null;
    this.mapTrack = null;
    this.feed = [];          // {text, colour, until}
    this._resize();
    addEventListener('resize', () => { this._resize(); this.map = null; });
  }

  _resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth; this.h = innerHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.mapSize = Math.round(Math.min(190, Math.max(120, Math.min(this.w, this.h) * 0.24)));
  }

  draw(view, extra = {}) {
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    if (!view) return;
    const me = view.cars.find(c => c.mine) || view.cars[0];
    if (!me) return;

    this._hull(g, me);
    this._readout(g, view, me);
    this._minimap(g, view, me);
    this._feed(g);
    if (view.phase === PHASE.COUNTDOWN) this._countdown(g, view);
    if (me.dead) this._banner(g, 'WRECKED', '#ff6a5a', extra.spectating ? `following ${extra.spectating}` : 'tap to follow another car');
    else if (me.finished) this._banner(g, 'FINISHED', '#7dff9a', 'cool-down lap');
    if (extra.message) this._toast(g, extra.message);
  }

  // --- bottom left: the hull, in ten segments with a ghost of where it was
  _hull(g, me) {
    const x = 22, y = this.h - 64, w = 210, h = 16;
    const f = Math.max(0, Math.min(1, me.hull / Math.max(1, me.maxHull)));
    if (this.ghost === undefined || me.hull > this.ghostHull) { this.ghost = f; this.ghostHull = me.hull; }
    this.ghost += (f - this.ghost) * 0.06;
    this.ghostHull = me.hull;

    g.save();
    g.fillStyle = 'rgba(8,10,16,0.62)';
    g.fillRect(x - 8, y - 26, w + 16, h + 42);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillRect(x, y, w * this.ghost, h);
    g.fillStyle = f > 0.5 ? '#5cff8f' : f > 0.3 ? '#ffc24a' : '#ff4d3a';
    g.fillRect(x, y, w * f, h);
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo(x + w * i / 10, y); g.lineTo(x + w * i / 10, y + h); g.stroke(); }
    g.fillStyle = f > 0.3 ? '#d8e2f5' : '#ff6a5a';
    g.font = '600 12px system-ui, sans-serif';
    g.fillText('HULL', x, y - 10);
    g.textAlign = 'right';
    g.fillText(`${Math.round(me.hull)} / ${me.maxHull}`, x + w, y - 10);
    g.textAlign = 'left';
    g.font = '600 11px system-ui, sans-serif';
    g.fillStyle = me.ammo > 0 ? '#8b95b4' : '#ff6a5a';
    g.fillText(`${(me.weapon || 'machinegun').toUpperCase()}  ${me.ammo ?? 0}`, x, y + h + 14);
    g.fillStyle = '#8b95b4';
    g.fillText(`MINES ${me.mines ?? 0}`, x + 108, y + h + 14);
    g.fillStyle = (me.nitroCharges || 0) > 0 ? '#4ad6ff' : '#4a5168';
    g.fillText(`NOS ${me.nitroCharges ?? 0}`, x + 168, y + h + 14);
    g.restore();
  }

  // --- bottom right: speed, lap, place
  _readout(g, view, me) {
    const x = this.w - 24, y = this.h - 30;
    g.save();
    g.textAlign = 'right';
    g.fillStyle = 'rgba(8,10,16,0.62)';
    g.fillRect(x - 172, y - 84, 180, 96);
    g.fillStyle = '#ffffff';
    g.font = '800 40px system-ui, sans-serif';
    g.fillText(String(Math.round(me.speed * 3.6)), x - 42, y - 44);
    g.font = '600 13px system-ui, sans-serif';
    g.fillStyle = '#8b95b4';
    g.fillText('km/h', x - 6, y - 44);
    g.font = '700 18px system-ui, sans-serif';
    g.fillStyle = '#d8e2f5';
    g.fillText(`LAP ${Math.min(view.laps, me.lap + 1)}/${view.laps}`, x - 6, y - 18);
    const alive = view.cars.length;
    g.fillStyle = '#ffc24a';
    g.fillText(`P${me.rank + 1} of ${alive}`, x - 6, y + 4);
    g.restore();
  }

  // --- top right: the circuit, north up, everyone on it
  _minimap(g, view, me) {
    const size = this.mapSize, pad = 16;
    const ox = this.w - size - pad, oy = pad;
    if (!this.map || this.mapTrack !== view.track.id) this._bakeMap(view.track, size);
    g.save();
    g.globalAlpha = 0.88;
    g.drawImage(this.map, ox, oy);
    g.globalAlpha = 1;
    const put = (x, z) => ({ x: ox + (x - this.mapOff.x) * this.mapScale, y: oy + (z - this.mapOff.z) * this.mapScale });
    for (const w of view.wrecks || []) {
      const p = put(w.x, w.z);
      g.fillStyle = '#4a4a4a';
      g.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    for (const c of view.cars) {
      if (c.dead) continue;
      const p = put(c.x, c.z);
      g.beginPath();
      g.arc(p.x, p.y, c.mine ? 4.5 : 3.2, 0, Math.PI * 2);
      g.fillStyle = c.mine ? '#ffffff' : `#${TEAM_COLOURS[c.id % TEAM_COLOURS.length].toString(16).padStart(6, '0')}`;
      g.fill();
      if (c.mine) { g.strokeStyle = '#000'; g.lineWidth = 1.2; g.stroke(); }
    }
    void me;
    g.restore();
  }

  _bakeMap(track, size) {
    const b = track.bounds;
    const w = b.maxX - b.minX, h = b.maxZ - b.minZ;
    const scale = (size - 16) / Math.max(w, h);
    this.mapScale = scale;
    this.mapOff = { x: b.minX - (size / scale - w) / 2, z: b.minZ - (size / scale - h) / 2 };
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(8,10,16,0.72)';
    g.fillRect(0, 0, size, size);
    g.strokeStyle = '#6f7d9c';
    g.lineWidth = Math.max(2.5, 18 * scale);
    g.lineJoin = 'round';
    g.beginPath();
    for (let s = 0; s <= track.ribbon.length; s += 8) {
      const f = frameAt(track.ribbon, s % track.ribbon.length);
      const x = (f.pos.x - this.mapOff.x) * scale, y = (f.pos.z - this.mapOff.z) * scale;
      if (s === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.stroke();
    const start = frameAt(track.ribbon, 0);
    g.fillStyle = '#ffffff';
    g.fillRect((start.pos.x - this.mapOff.x) * scale - 3, (start.pos.z - this.mapOff.z) * scale - 3, 6, 6);
    this.map = c;
    this.mapTrack = track.id;
  }

  /** somebody did something to somebody: three lines, top left, then gone */
  say(text, colour = '#d8e2f5') {
    this.feed.unshift({ text, colour, until: performance.now() + 4200 });
    if (this.feed.length > 4) this.feed.length = 4;
  }

  _feed(g) {
    const now = performance.now();
    this.feed = this.feed.filter(f => f.until > now);
    g.save();
    g.font = '600 13px system-ui, sans-serif';
    let y = 38;
    for (const f of this.feed) {
      const left = (f.until - now) / 4200;
      g.globalAlpha = Math.min(1, left * 3);
      g.fillStyle = 'rgba(8,10,16,0.6)';
      const w = g.measureText(f.text).width + 16;
      g.fillRect(14, y - 14, w, 20);
      g.fillStyle = f.colour;
      g.fillText(f.text, 22, y);
      y += 24;
    }
    g.restore();
  }

  _countdown(g, view) {
    const n = view.countdown;
    const text = n > 0 ? String(n) : 'GO';
    g.save();
    g.textAlign = 'center';
    g.font = '900 120px system-ui, sans-serif';
    g.fillStyle = n > 0 ? 'rgba(255,255,255,0.92)' : '#5cff8f';
    g.fillText(text, this.w / 2, this.h / 2 + 30);
    g.restore();
  }

  _banner(g, text, colour, sub) {
    g.save();
    g.textAlign = 'center';
    g.font = '800 44px system-ui, sans-serif';
    g.fillStyle = colour;
    g.fillText(text, this.w / 2, this.h * 0.34);
    if (sub) {
      g.font = '600 15px system-ui, sans-serif';
      g.fillStyle = '#a8b2c8';
      g.fillText(sub, this.w / 2, this.h * 0.34 + 26);
    }
    g.restore();
  }

  _toast(g, text) {
    g.save();
    g.textAlign = 'center';
    g.font = '700 20px system-ui, sans-serif';
    const w = g.measureText(text).width + 28;
    g.fillStyle = 'rgba(8,10,16,0.75)';
    g.fillRect(this.w / 2 - w / 2, 22, w, 38);
    g.fillStyle = '#d8e2f5';
    g.fillText(text, this.w / 2, 47);
    g.restore();
  }
}
