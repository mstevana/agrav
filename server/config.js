// ============================================================================
// Server configuration from the environment. Every knob has a sane default so
// `node server/index.js` on a laptop just works; deploy/agrav.service sets the
// production values.
// ============================================================================

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

const int = (v, d) => (v == null || v === '' ? d : parseInt(v, 10));

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: int(process.env.PORT, 8080),
  /** directory served as static files (the repo root: every game folder + shared/) */
  staticRoot: process.env.STATIC_ROOT || path.resolve(here, '..'),
  maxRooms: int(process.env.MAX_ROOMS, 64),
  /** durable records (careers) live here; empty keeps them in memory only */
  dataDir: process.env.DATA_DIR === '' ? '' : (process.env.DATA_DIR || path.resolve(here, '..', 'data')),
  /** a tick that runs longer than this is logged; sustained overruns shed snapshot rate */
  tickBudgetMs: int(process.env.TICK_BUDGET_MS, 8),
  /** how long a disconnected racer's vehicle waits for them before it is eliminated */
  reconnectGraceMs: int(process.env.RECONNECT_GRACE_MS, 10000),
  /** empty rooms are destroyed after this long */
  emptyRoomTtlMs: int(process.env.EMPTY_ROOM_TTL_MS, 60000),
  /** per-socket message rate limit (messages per second, burst) */
  rateLimitPerSec: int(process.env.RATE_LIMIT_PER_SEC, 200),
  maxNameLength: 16,
  logLevel: process.env.LOG_LEVEL || 'info'
};
