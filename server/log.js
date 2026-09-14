// Tiny leveled logger; one line per event, greppable under journalctl.
import { config } from './config.js';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const min = LEVELS[config.logLevel] ?? 1;
function emit(level, tag, msg, extra) {
  if (LEVELS[level] < min) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${tag}] ${msg}` +
    (extra ? ' ' + JSON.stringify(extra) : '');
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}
export const log = {
  debug: (tag, msg, extra) => emit('debug', tag, msg, extra),
  info:  (tag, msg, extra) => emit('info', tag, msg, extra),
  warn:  (tag, msg, extra) => emit('warn', tag, msg, extra),
  error: (tag, msg, extra) => emit('error', tag, msg, extra)
};
