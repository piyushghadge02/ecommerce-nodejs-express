'use strict';

/**
 * Structured logging. Emits one JSON line per record on stdout: timestamp,
 * level, logger, message and any extra fields. Never logs secrets.
 *
 * Mirrors app/core/logging.py from the Python reference implementation.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function getLogger(name) {
  const levelName = (process.env.LOG_LEVEL || 'info').toLowerCase();
  const threshold = LEVELS[levelName] ?? LEVELS.info;

  function emit(level, msg, extra) {
    if (LEVELS[level] < threshold) return;
    const payload = {
      ts: new Date().toISOString(),
      level: level.toUpperCase(),
      logger: name,
      msg: String(msg),
    };
    if (extra && typeof extra === 'object') {
      for (const [k, v] of Object.entries(extra)) {
        try {
          payload[k] = JSON.parse(JSON.stringify(v));
        } catch {
          payload[k] = String(v);
        }
      }
    }
    process.stdout.write(JSON.stringify(payload) + '\n');
  }

  return {
    debug: (msg, extra) => emit('debug', msg, extra),
    info: (msg, extra) => emit('info', msg, extra),
    warn: (msg, extra) => emit('warn', msg, extra),
    error: (msg, extra) => emit('error', msg, extra),
  };
}

module.exports = { getLogger };
