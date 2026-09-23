// ============================================================================
// AGRAV — input: keyboard, gamepad and touch, all reduced to {bits, steer}.
//
// Keyboard: ←/→ or A/D steer, ↑/W throttle, ↓/S brake, Q/E airbrakes (also
// shift+steer), space / ctrl / X fire. Gamepad: left stick / d-pad steer,
// A (0) or RT throttle, LT brake, LB/RB airbrakes, X/B fire.
// Touch: tilt the phone to steer (the default), or drag left/right in the
// steering zone on the left; fire and airbrake buttons on the right. Throttle
// is automatic on touch unless the player turns it off.
//
// A key is a switch, so keyboard steering would otherwise slam from 0 to full
// lock in one tick. It is ramped here, in the input, rather than in the sim:
// the ramped value is what gets sent and what the local prediction steps, so
// the server and the client still agree. Gamepad and touch are already analog
// and pass through untouched. The result is quantised to the wire's own grid
// for the same reason -- see read().
// ============================================================================

import { IN } from '../../shared/net/protocol.js';
import { settings } from './settings.js';
import { DT } from '../../shared/agrav/constants.js';

const STEER_ON = 1 / 0.12;    // full lock in 0.12 s
const STEER_OFF = 1 / 0.07;   // and back to centre a little faster, so it stops feeling soggy
const STEER_STEP = 127;       // the wire quantises steer to an i8 at this scale
const TILT_LOCK = 26;         // degrees off neutral for full lock: a wrist, not a shoulder
const TILT_DEAD = 2.5;        // and a little slop around neutral, or a held phone wanders

export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.steerRamp = 0;    // the ramped keyboard steer, advanced once per input tick
    this.touchSteer = 0;
    this.touchBits = 0;
    this.tilt = 0;
    this.tiltZero = null;    // the angle the phone was held at when steering began: that is straight ahead
    this.tiltLive = false;   // a reading has actually arrived, so tilt can be trusted over the drag zone
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
    // Tilt steering means a player may never put a finger on the steering zone, and touch input --
    // auto throttle included -- is gated on having been touched. The taps that get you into a race
    // are enough to arm it.
    window.addEventListener('touchstart', () => { this.touched = true; }, { passive: true, once: true });
    window.addEventListener('deviceorientation', (e) => this._orient(e));
    // a phone turned end for end in landscape reads the other way up, so neutral is taken again
    window.addEventListener('orientationchange', () => { this.tiltZero = null; });
    screen.orientation?.addEventListener?.('change', () => { this.tiltZero = null; });
  }

  /**
   * Held in landscape, beta is the axis you roll to steer. Which way round depends on which end of
   * the phone is up. Neutral is wherever the phone was the first time we heard from it rather than
   * beta zero, which is the phone lying flat on its back -- nobody drives holding it there.
   */
  _orient(e) {
    if (e.beta == null) return;
    this.tiltLive = true;
    const raw = (screen.orientation?.angle ?? window.orientation ?? 90) === 90 ? e.beta : -e.beta;
    if (this.tiltZero == null) this.tiltZero = raw;
    let off = raw - this.tiltZero;
    if (off > 180) off -= 360; else if (off < -180) off += 360;   // beta wraps at ±180
    const mag = (Math.abs(off) - TILT_DEAD) / (TILT_LOCK - TILT_DEAD);
    this.tilt = Math.sign(off) * Math.max(0, Math.min(1, mag));
  }

  /**
   * iOS 13 and later deliver nothing until the page asks, and it only asks from inside a user
   * gesture -- so this hangs off the buttons that start a race. Everywhere else the events simply
   * arrive and there is nothing to request. A refusal is not an error: the drag zone still steers.
   */
  requestTilt() {
    const req = window.DeviceOrientationEvent?.requestPermission;
    if (typeof req === 'function') req.call(window.DeviceOrientationEvent).catch(() => {});
  }

  /** take the phone's current angle as straight ahead -- called as a race starts */
  recentreTilt() { this.tiltZero = null; }

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

  /**
   * One input tick. Called once per fixed 60 Hz step, so the steering ramp advances by DT.
   * @returns {{bits:number, steer:number}}
   */
  read() {
    if (!this.enabled) { this.steerRamp = 0; return { bits: 0, steer: 0 }; }
    const k = this.keys;
    let bits = 0, want = 0;
    if (k.has('ArrowLeft') || k.has('KeyA')) want -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) want += 1;
    // ease toward the key, faster when it is releasing or reversing than when it is winding on
    const rate = (want === 0 || want * this.steerRamp < 0 ? STEER_OFF : STEER_ON) * DT;
    this.steerRamp += Math.max(-rate, Math.min(rate, want - this.steerRamp));
    let steer = this.steerRamp;
    if (k.has('ArrowUp') || k.has('KeyW')) bits |= IN.THROTTLE;
    if (k.has('ArrowDown') || k.has('KeyS')) bits |= IN.BRAKE;
    if (k.has('KeyQ') || (k.has('ShiftLeft') && want < 0)) bits |= IN.AIRBRAKE_L;
    if (k.has('KeyE') || (k.has('ShiftRight') && want > 0) || (k.has('ShiftLeft') && want > 0)) bits |= IN.AIRBRAKE_R;
    if (k.has('Space') || k.has('ControlLeft') || k.has('KeyX') || k.has('Enter')) bits |= IN.FIRE;

    const gp = this._gamepad();
    if (gp) { bits |= gp.bits; if (gp.steer) steer = gp.steer; }

    if (this.touched) {
      bits |= this.touchBits;
      // a phone with no motion sensor, or one whose owner refused it, falls back to the drag zone
      const ts = settings.touchSteer === 'tilt' && this.tiltLive ? this.tilt : this.touchSteer;
      if (ts) steer = ts;
      if (settings.autoThrottle && !(bits & IN.BRAKE)) bits |= IN.THROTTLE;
    }
    // Snap to the wire's grid before it leaves: the client predicts with this float while the
    // server gets it through qi8(steer, 127), and anything off the grid is a standing divergence
    // for reconciliation to chase.
    return { bits, steer: Math.round(Math.max(-1, Math.min(1, steer)) * STEER_STEP) / STEER_STEP };
  }
}
