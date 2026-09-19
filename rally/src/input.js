// ============================================================================
// Keyboard, gamepad and touch, all reduced to the one record the wire carries:
// five bits and a steering axis. Steering is car-relative (+1 is the driver's
// right), throttle and brake are switches, and holding the brake at rest backs
// the car up, so there is no separate reverse control to find.
//
// A key is a switch and a stick is not, so keyboard steering winds on over about
// a tenth of a second rather than snapping to full lock: the same lock, reached
// the way a wheel reaches it.
// ============================================================================

import { IN } from '../../shared/net/protocol.js';

const WIND_ON = 9;        // steering units per second while a key is held
const WIND_OFF = 14;      // and how fast it centres again

export class Input {
  constructor() {
    this.enabled = false;
    this.keys = new Set();
    this.steer = 0;
    this.touch = { steer: 0, throttle: false, brake: false, fire: false, mine: false, nitro: false };
    this.lastSource = 'keyboard';
    this._bind();
  }

  _bind() {
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.repeat) return;
      this.keys.add(e.code);
      this.lastSource = 'keyboard';
      if (HANDLED.has(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('blur', () => this.keys.clear());
  }

  /** the on-screen controls call these */
  setTouch(name, on) { this.touch[name] = on; this.lastSource = 'touch'; }
  setTouchSteer(v) { this.touch.steer = Math.max(-1, Math.min(1, v)); this.lastSource = 'touch'; }

  gamepad() {
    const pads = navigator.getGamepads?.() || [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** one tick of input, ready for the wire */
  sample(dt = 1 / 60) {
    if (!this.enabled) return { bits: 0, steer: 0 };
    const k = this.keys;
    let bits = 0;
    let target = 0;
    let analog = null;

    if (k.has('ArrowLeft') || k.has('KeyA')) target -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) target += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) bits |= IN.THROTTLE;
    if (k.has('ArrowDown') || k.has('KeyS')) bits |= IN.BRAKE;
    if (k.has('Space')) bits |= IN.FIRE;
    if (k.has('KeyM')) bits |= IN.MINE;
    if (k.has('KeyN') || k.has('ShiftLeft')) bits |= IN.NITRO;

    const pad = this.gamepad();
    if (pad) {
      const ax = pad.axes[0] || 0;
      if (Math.abs(ax) > 0.15) { analog = ax; this.lastSource = 'gamepad'; }
      const b = (i) => pad.buttons[i]?.pressed;
      if (b(7) || b(0)) bits |= IN.THROTTLE;
      if (b(6) || b(2)) bits |= IN.BRAKE;
      if (b(5) || b(3)) bits |= IN.FIRE;
      if (b(1)) bits |= IN.MINE;
      if (b(4)) bits |= IN.NITRO;
      if (b(14)) target -= 1;
      if (b(15)) target += 1;
    }

    if (this.touch.steer) { analog = this.touch.steer; }
    if (this.touch.throttle) bits |= IN.THROTTLE;
    if (this.touch.brake) bits |= IN.BRAKE;
    if (this.touch.fire) bits |= IN.FIRE;
    if (this.touch.mine) bits |= IN.MINE;
    if (this.touch.nitro) bits |= IN.NITRO;

    if (analog !== null) {
      this.steer = analog;                        // a stick is already the answer
    } else {
      const rate = target === 0 ? WIND_OFF : WIND_ON;
      const want = target;
      if (want > this.steer) this.steer = Math.min(want, this.steer + rate * dt);
      else if (want < this.steer) this.steer = Math.max(want, this.steer - rate * dt);
    }
    return { bits, steer: Math.max(-1, Math.min(1, this.steer)) };
  }
}

const HANDLED = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyM', 'KeyN']);
