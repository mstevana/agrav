// ============================================================================
// AGRAV — persisted settings + adaptive quality governor.
// ============================================================================

const KEY = 'agrav_settings_v1';

const DEFAULTS = {
  version: 2,               // bumped when a changed default has to reach phones that already played
  name: '',
  vehicle: 'corsair',
  botDifficulty: 'normal',  // easy | normal | hard -- shown as Easy / Medium / Hard
  quality: 'auto',          // auto | high | low
  sound: true,
  music: true,
  touchSteer: 'tilt',       // drag | tilt -- tilt is the phone default, drag is the fallback
  autoThrottle: true,       // touch: hold nothing to go
  reducedMotion: false,
  largeHud: false,
  server: ''                // '' = same origin
};

/**
 * Stored settings win over the defaults, which is what makes a changed default invisible to anyone
 * who has played before: setSetting writes the whole merged object, so the first time a player typed
 * their name the defaults of that day were frozen into their phone. A default worth changing
 * therefore needs a migration, and this is the list of them.
 */
function migrate(s, from) {
  // 2: tilt became the default way to steer a phone. Nobody can have chosen the old tilt mode on
  // purpose -- it never asked iOS for the motion sensor, so on an iPhone it did nothing at all --
  // and drag is one tap away in Settings for anyone who prefers it.
  if (from < 2) s.touchSteer = 'tilt';
  return s;
}
function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY)) || {};
    const s = { ...DEFAULTS, ...stored };
    s.version = DEFAULTS.version;
    return Object.keys(stored).length ? migrate(s, stored.version || 1) : s;
  } catch { return { ...DEFAULTS }; }
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
  r.classList.toggle('tilt-steer', settings.touchSteer === 'tilt');
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
