// ============================================================================
// Spacewar input: keyboard, gamepad and touch, all reduced to {bits, steer}.
//   steer  -1 turn left · +1 turn right
//   bits   THRUST · FIRE · HYPER (see shared/spacewar/constants.js)
// Keyboard: ←/A ←, →/D →, ↑/W thrust, Space/Ctrl/F fire, ↓/S/Shift hyperspace.
// Gamepad: left stick or d-pad turns, A/RT thrust, X/RB fire, B/Y/LB hyperspace.
// Touch: turn buttons bottom left, thrust / fire / jump bottom right.
// ============================================================================

import { BIT } from '../../shared/spacewar/constants.js';

const CAPTURED = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, thrust: false, fire: false, hyper: false };
    this.enabled = true;
    this.hasTouch = false;

    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      this.keys.add(e.code);
      if (CAPTURED.includes(e.code) && this.enabled) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this._bindTouch();
  }

  _bindTouch() {
    const pad = document.getElementById('touch');
    if (!pad) return;
    this.hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!this.hasTouch) return;
    for (const btn of pad.querySelectorAll('[data-key]')) {
      const key = btn.dataset.key;
      const set = (on) => (e) => {
        e.preventDefault();
        if (on) btn.setPointerCapture?.(e.pointerId);
        btn.classList.toggle('down', on);
        this.touch[key] = on;
      };
      btn.addEventListener('pointerdown', set(true));
      btn.addEventListener('pointerup', set(false));
      btn.addEventListener('pointercancel', set(false));
      btn.addEventListener('lostpointercapture', set(false));
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  /** show the on-screen controls while a match is being played on a touch screen */
  showTouch(on) {
    document.getElementById('touch')?.classList.toggle('hidden', !(on && this.hasTouch));
  }

  _gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      const b = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
      const steer = Math.abs(ax) > 0.2 ? ax : (b(14) ? -1 : b(15) ? 1 : 0);
      const thrust = b(0) || b(7) || b(12);
      const fire = b(2) || b(5);
      const hyper = b(1) || b(3) || b(4) || b(13);
      if (steer || thrust || fire || hyper) return { steer, thrust, fire, hyper };
    }
    return null;
  }

  /** current input as {bits, steer} for the wire */
  sample() {
    if (!this.enabled) return { bits: 0, steer: 0 };
    const k = (...codes) => codes.some((c) => this.keys.has(c));
    let steer = (k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0);
    let thrust = k('ArrowUp', 'KeyW');
    let fire = k('Space', 'ControlLeft', 'ControlRight', 'KeyF', 'Enter');
    let hyper = k('ArrowDown', 'KeyS', 'ShiftLeft', 'ShiftRight');
    const gp = this._gamepad();
    if (gp) {
      if (!steer) steer = gp.steer;
      thrust ||= gp.thrust; fire ||= gp.fire; hyper ||= gp.hyper;
    }
    const t = this.touch;
    if (t.left || t.right) steer = (t.right ? 1 : 0) - (t.left ? 1 : 0);
    thrust ||= t.thrust; fire ||= t.fire; hyper ||= t.hyper;
    const bits = (thrust ? BIT.THRUST : 0) | (fire ? BIT.FIRE : 0) | (hyper ? BIT.HYPER : 0);
    return { bits, steer: Math.max(-1, Math.min(1, steer)) };
  }
}
