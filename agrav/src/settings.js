// ============================================================================
// AGRAV — persisted settings + adaptive quality governor.
// ============================================================================

const KEY = 'agrav_settings_v1';

const DEFAULTS = {
  name: '',
  vehicle: 'corsair',
  botDifficulty: 'normal',  // easy | normal | hard -- shown as Easy / Medium / Hard
  quality: 'auto',          // auto | high | low
  sound: true,
  music: true,
  touchSteer: 'drag',       // drag | tilt | buttons
  autoThrottle: true,       // touch: hold nothing to go
  reducedMotion: false,
  largeHud: false,
  server: ''                // '' = same origin
};

function load() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { return { ...DEFAULTS }; }
}
export const settings = load();
export function setSetting(k, v) {
  settings[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  applyDocumentSettings();
}
export function applyDocumentSettings() {
  const r = document.documentElement;
  r.classList.toggle('reduced-motion', !!settings.reducedMotion);
  r.classList.toggle('large-hud', !!settings.largeHud);
}

const MAX_LEVEL = 4;

/**
 * Watches the median frame time and sheds work in stages: MSAA first (costs
 * nothing in legibility), then shadows and bloom, then pixel ratio, then effect density.
 * Recovers slowly so an old phone settles instead of oscillating.
 */
export class QualityGovernor {
  constructor(hooks) {
    this.hooks = hooks;
    this.samples = [];
    this.level = 0;
    this.cooldown = 3;
    this.enabled = settings.quality === 'auto';
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  }
  applyManual() {
    this.enabled = settings.quality === 'auto';
    if (settings.quality === 'high') this._apply(0);
    else if (settings.quality === 'low') this._apply(MAX_LEVEL);
    else this._apply(Math.min(this.level, 1));
  }
  _apply(level) {
    this.level = level;
    this.hooks.setMsaa(level < 1 ? 4 : 0);
    this.hooks.setShadows?.(level < 2);
    this.hooks.setBloom(level < 2);
    this.hooks.setPixelRatio(level < 3 ? this.basePixelRatio : Math.min(1, this.basePixelRatio));
    this.hooks.setEffects(level < 4);
  }
  sample(dt) {
    if (!this.enabled) return;
    this.samples.push(dt);
    if (this.samples.length < 60) return;
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const med = sorted[30];
    this.samples.length = 0;
    if (--this.cooldown > 0) return;
    if (med > 0.022 && this.level < MAX_LEVEL) { this._apply(this.level + 1); this.cooldown = 4; }
    else if (med < 0.013 && this.level > 0) { this._apply(this.level - 1); this.cooldown = 8; }
  }
}
