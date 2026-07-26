'use strict';

// =============================================================================
// G.PACK 2.0 — Structured JSON Logger
// Every log line is a JSON object with consistent fields for observability.
// Designed for log aggregation (ELK, Loki, Datadog, etc.)
//
// Usage:
//   const log = require('./utils/logger');
//   log.info('pdf_generated', { certificate_number, duration_ms: 842 });
//   log.error('waha_failed', { correlation_id, error: err.message });
// =============================================================================

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL || 'info'] || LEVELS.info;

function _format(level, step, meta) {
    const entry = {
        ts: new Date().toISOString(),
        level,
        step,
        ...meta,
    };
    return JSON.stringify(entry);
}

function _log(level, step, meta) {
    if (LEVELS[level] < MIN_LEVEL) return;
    const line = _format(level, step, meta);
    if (level === 'error' || level === 'fatal') {
        process.stderr.write(line + '\n');
    } else {
        process.stdout.write(line + '\n');
    }
}

module.exports = {
    debug: (step, meta = {}) => _log('debug', step, meta),
    info: (step, meta = {}) => _log('info', step, meta),
    warn: (step, meta = {}) => _log('warn', step, meta),
    error: (step, meta = {}) => _log('error', step, meta),
    fatal: (step, meta = {}) => _log('fatal', step, meta),

    // Timer helper: log.info('pdf_generated', { duration_ms, ... })
    timer: (step, meta = {}) => {
        const start = Date.now();
        return {
            done: (extra = {}) => {
                const duration_ms = Date.now() - start;
                _log('info', step, { duration_ms, ...meta, ...extra });
                return duration_ms;
            },
            error: (err, extra = {}) => {
                const duration_ms = Date.now() - start;
                _log('error', step, { duration_ms, error: err.message, ...meta, ...extra });
            },
        };
    },
};
