'use strict';

// =============================================================================
// G.PACK 2.0 — Circuit Breaker for WAHA Provider
// States: CLOSED → OPEN → HALF_OPEN → CLOSED
//
// CLOSED:    All requests go through. Failures are counted.
// OPEN:      All requests fail fast (no WAHA call). Messages stay in queue.
// HALF_OPEN: After cooldown, one request is allowed through.
//            If it succeeds → CLOSED. If it fails → OPEN again.
//
// Config (stored in notification_settings DB table):
//   failure_threshold: 5 consecutive failures → OPEN
//   cooldown_ms:        60000 (1 min) before HALF_OPEN
//   half_open_max:      1 request allowed in HALF_OPEN
// =============================================================================

const db = require('../db');

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 60000; // 1 minute

let _state = 'closed';
let _failureCount = 0;
let _lastFailureAt = null;
let _openedAt = null;
let _halfOpenInFlight = false;
let _initialized = false;

// ── Load state from DB on startup ────────────────────────────────────────────
async function _loadState() {
    if (_initialized) return;
    _initialized = true;
    try {
        const res = await db.query(
            `SELECT value FROM notification_settings WHERE key = 'waha_circuit_breaker'`
        );
        if (res.rows.length > 0) {
            const val = typeof res.rows[0].value === 'string'
                ? JSON.parse(res.rows[0].value)
                : res.rows[0].value;
            _state = val.state || 'closed';
            _failureCount = val.failure_count || 0;
            _lastFailureAt = val.last_failure_at ? new Date(val.last_failure_at) : null;
            _openedAt = val.opened_at ? new Date(val.opened_at) : null;
        }
    } catch (err) {
        console.error('[CircuitBreaker] Load error:', err.message);
    }
}

// ── Persist state to DB ──────────────────────────────────────────────────────
async function _saveState() {
    try {
        await db.query(
            `UPDATE notification_settings SET value = $1 WHERE key = 'waha_circuit_breaker'`,
            [JSON.stringify({
                state: _state,
                failure_count: _failureCount,
                last_failure_at: _lastFailureAt?.toISOString() || null,
                opened_at: _openedAt?.toISOString() || null,
            })]
        );
    } catch (err) {
        console.error('[CircuitBreaker] Save error:', err.message);
    }
}

// ── Check if request is allowed ──────────────────────────────────────────────
// Returns true if the request should proceed, false if circuit is open.
async function canProceed() {
    await _loadState();

    if (_state === 'closed') {
        return true;
    }

    if (_state === 'open') {
        // Check if cooldown has passed → transition to half_open
        if (_openedAt && Date.now() - _openedAt.getTime() >= COOLDOWN_MS) {
            _state = 'half_open';
            _halfOpenInFlight = false;
            await _saveState();
            console.log('[CircuitBreaker] OPEN → HALF_OPEN (cooldown passed)');
            return true;
        }
        return false; // Circuit open — fail fast
    }

    if (_state === 'half_open') {
        if (_halfOpenInFlight) {
            return false; // Only one request allowed in half_open
        }
        _halfOpenInFlight = true;
        return true;
    }

    return true;
}

// ── Record a successful request ──────────────────────────────────────────────
async function recordSuccess() {
    if (_state === 'half_open') {
        _state = 'closed';
        _failureCount = 0;
        _halfOpenInFlight = false;
        _openedAt = null;
        await _saveState();
        console.log('[CircuitBreaker] HALF_OPEN → CLOSED (success)');
    } else if (_state === 'closed' && _failureCount > 0) {
        _failureCount = 0;
        await _saveState();
    }
}

// ── Record a failed request ──────────────────────────────────────────────────
async function recordFailure() {
    _failureCount++;
    _lastFailureAt = new Date();

    if (_state === 'half_open') {
        // Half-open failure → back to open
        _state = 'open';
        _openedAt = new Date();
        _halfOpenInFlight = false;
        await _saveState();
        console.log('[CircuitBreaker] HALF_OPEN → OPEN (failure)');
    } else if (_state === 'closed' && _failureCount >= FAILURE_THRESHOLD) {
        // Threshold reached → open
        _state = 'open';
        _openedAt = new Date();
        await _saveState();
        console.log(`[CircuitBreaker] CLOSED → OPEN (${_failureCount} consecutive failures)`);
    } else {
        await _saveState();
    }
}

// ── Get current state (for dashboard) ────────────────────────────────────────
function getState() {
    return {
        state: _state,
        failure_count: _failureCount,
        failure_threshold: FAILURE_THRESHOLD,
        last_failure_at: _lastFailureAt,
        opened_at: _openedAt,
        cooldown_ms: COOLDOWN_MS,
    };
}

module.exports = { canProceed, recordSuccess, recordFailure, getState };
