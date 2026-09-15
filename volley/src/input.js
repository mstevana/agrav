// ============================================================================
// Volley input: keyboard, gamepad and touch, all reduced to {bits, steer}.
//   steer  -1 left · +1 right     bit 0 (JUMP) jump / hold to jump higher
// Keyboard: ←/A left, →/D right, ↑/W/Space jump. Gamepad: left stick / d-pad
// steer, A/RT/up jump. Touch: on-screen left, right and jump buttons.
// ============================================================================

export const JUMP = 1;

export class Input {
  constructor() {
    this.keys = new Set();
    this.touchSteer = 0;   // -1/0/+1 from the on-screen arrows
    this.touchJump = false;
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this._bindTouch();
  }

  _bindTouch() {
    const pad = document.getElementById('touch');
    if (!pad) return;
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!hasTouch) return;
    pad.classList.remove('hidden');
    for (const btn of pad.querySelectorAll('[data-key]')) {
      const key = btn.dataset.key;
      const down = (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        btn.classList.add('down');
        if (key === 'left') this.touchSteer = -1;
        else if (key === 'right') this.touchSteer = 1;
        else this.touchJump = true;
      };
      const up = (e) => {
        e.preventDefault();
        btn.classList.remove('down');
        if (key === 'left' && this.touchSteer < 0) this.touchSteer = 0;
        else if (key === 'right' && this.touchSteer > 0) this.touchSteer = 0;
        else if (key === 'jump') this.touchJump = false;
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  _gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      const b = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
      const steer = Math.abs(ax) > 0.25 ? ax : (b(14) ? -1 : b(15) ? 1 : 0);
      const jump = b(0) || b(7) || b(12);
      if (steer || jump) return { steer, jump };
    }
    return null;
  }

  /** current input as {bits, steer} for the wire */
  sample() {
    if (!this.enabled) return { bits: 0, steer: 0 };
    let steer = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) steer -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) steer += 1;
    let jump = this.keys.has('ArrowUp') || this.keys.has('KeyW') || this.keys.has('Space');
    if (!steer && !jump) {
      const gp = this._gamepad();
      if (gp) { steer = gp.steer; jump = gp.jump; }
    }
    if (this.touchSteer) steer = this.touchSteer;
    if (this.touchJump) jump = true;
    return { bits: jump ? JUMP : 0, steer: Math.max(-1, Math.min(1, steer)) };
  }
}
