// ============================================================================
// Server configuration from the environment. Every knob has a sane default so
// `node server/index.js` on a laptop just works; deploy/agrav.service sets the
// production values.
//
// This file has no Node-only imports on purpose: the room/lobby/session engine
// also runs inside the browser for solo play (see server/solo.js), where there
// is no process and no filesystem. Paths are left unresolved here and settled by the
// Node-only modules that use them (server/index.js serves files, store-file.js writes them).
// ============================================================================

const env = (typeof process !== 'undefined' && process.env) ? process.env : {};

const int = (v, d) => (v == null || v === '' ? d : parseInt(v, 10));

export const config = {
  host: env.HOST || '0.0.0.0',
  port: int(env.PORT, 8080),
  /** directory served as static files; null means "the repo root" (server/index.js resolves it) */
  staticRoot: env.STATIC_ROOT || null,
  maxRooms: int(env.MAX_ROOMS, 64),
  /** durable records (careers) live here; '' keeps them in memory, null means the default
      data/ dir (resolved by server/store-file.js, the only place that touches a disk) */
  dataDir: env.DATA_DIR === '' ? '' : (env.DATA_DIR || null),
  /** a tick that runs longer than this is logged; sustained overruns shed snapshot rate */
  tickBudgetMs: int(env.TICK_BUDGET_MS, 8),
  /** how long a disconnected racer's vehicle waits for them before it is eliminated */
  reconnectGraceMs: int(env.RECONNECT_GRACE_MS, 10000),
  /** empty rooms are destroyed after this long */
  emptyRoomTtlMs: int(env.EMPTY_ROOM_TTL_MS, 60000),
  /** per-socket message rate limit (messages per second, burst) */
  rateLimitPerSec: int(env.RATE_LIMIT_PER_SEC, 200),
  maxNameLength: 16,
  logLevel: env.LOG_LEVEL || 'info'
};
