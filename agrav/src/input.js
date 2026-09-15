// ============================================================================
// AGRAV — input: keyboard, gamepad and touch, all reduced to {bits, steer}.
//
// Keyboard: ←/→ or A/D steer, ↑/W throttle, ↓/S brake, Q/E airbrakes (also
// shift+steer), space / ctrl / X fire. Gamepad: left stick / d-pad steer,
// A (0) or RT throttle, LT brake, LB/RB airbrakes, X/B fire.
// Touch: a steering zone on the left (drag left/right from where you touch,
// or tilt the phone), fire and airbrake buttons on the right. Throttle is
// automatic on touch unless the player turns it off.
// ============================================================================

import { IN } from '../../shared/net/protocol.js';
import { settings } from './settings.js';

export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.touchSteer = 0;
    this.touchBits = 0;
    this.tilt = 0;
    this.touched = false;
    this.steerPointer = null;
    this.enabled = true;
    this.onAny = null;     // first interaction (audio unlock)

    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this._any();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    this._bindTouch(dom);
    window.addEventListener('deviceorientation', (e) => {
      // landscape: beta is left/right tilt; sign depends on which way the phone is held
      const landscapeLeft = (screen.orientation?.angle ?? window.orientation ?? 90) === 90;
      const raw = e.beta == null ? 0 : e.beta;
      this.tilt = Math.max(-1, Math.min(1, (landscapeLeft ? raw : -raw) / 28));
    });
  }

  _any() { if (this.onAny) { const f = this.onAny; this.onAny = null; f(); } }

  _bindTouch(dom) {
    const zone = document.getElementById('touch-steer');
    const buttons = document.querySelectorAll('[data-touch-bit]');
    if (zone) {
      const start = (e) => {
        if (this.steerPointer != null) return;
        this.steerPointer = e.pointerId;
        this.touched = true;
        this.originX = e.clientX;
        this.touchSteer = 0;
        zone.setPointerCapture(e.pointerId);
        this._any();
        e.preventDefault();
      };
      const move = (e) => {
        if (e.pointerId !== this.steerPointer) return;
        const dx = e.clientX - this.originX;
        const range = Math.min(160, window.innerWidth * 0.18);
        this.touchSteer = Math.max(-1, Math.min(1, dx / range));
        // walk the origin along so a long swipe never runs out of travel
        if (Math.abs(dx) > range) this.originX = e.clientX - Math.sign(dx) * range;
      };
      const end = (e) => { if (e.pointerId === this.steerPointer) { this.steerPointer = null; this.touchSteer = 0; } };
      zone.addEventListener('pointerdown', start);
      zone.addEventListener('pointermove', move);
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
    }
    for (const b of buttons) {
      const bit = parseInt(b.dataset.touchBit, 10);
      const down = (e) => { this.touchBits |= bit; this.touched = true; b.classList.add('down'); this._any(); e.preventDefault(); };
      const up = () => { this.touchBits &= ~bit; b.classList.remove('down'); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    }
  }

  _gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      const b = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
      let steer = Math.abs(ax) > 0.12 ? ax : 0;
      if (b(14)) steer = -1; if (b(15)) steer = 1;
      let bits = 0;
      if (b(0) || b(7)) bits |= IN.THROTTLE;
      if (b(6)) bits |= IN.BRAKE;
      if (b(4)) bits |= IN.AIRBRAKE_L;
      if (b(5)) bits |= IN.AIRBRAKE_R;
      if (b(2) || b(1)) bits |= IN.FIRE;
      if (bits || steer) { this._any(); return { bits, steer }; }
    }
    return null;
  }

  /** @returns {{bits:number, steer:number}} */
  read() {
    if (!this.enabled) return { bits: 0, steer: 0 };
    const k = this.keys;
    let bits = 0, steer = 0;
    if (k.has('ArrowLeft') || k.has('KeyA')) steer -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) steer += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) bits |= IN.THROTTLE;
    if (k.has('ArrowDown') || k.has('KeyS')) bits |= IN.BRAKE;
    if (k.has('KeyQ') || (k.has('ShiftLeft') && steer < 0)) bits |= IN.AIRBRAKE_L;
    if (k.has('KeyE') || (k.has('ShiftRight') && steer > 0) || (k.has('ShiftLeft') && steer > 0)) bits |= IN.AIRBRAKE_R;
    if (k.has('Space') || k.has('ControlLeft') || k.has('KeyX') || k.has('Enter')) bits |= IN.FIRE;

    const gp = this._gamepad();
    if (gp) { bits |= gp.bits; if (gp.steer) steer = gp.steer; }

    if (this.touched) {
      bits |= this.touchBits;
      const ts = settings.touchSteer === 'tilt' ? this.tilt : this.touchSteer;
      if (ts) steer = ts;
      if (settings.autoThrottle && !(bits & IN.BRAKE)) bits |= IN.THROTTLE;
    }
    return { bits, steer: Math.max(-1, Math.min(1, steer)) };
  }
}
