'use strict';

// =============================================================================
// Durable idempotency for mutating POST routes.
//
// The claim INSERT doubles as a lock: a concurrent request carrying the same
// key blocks on the unique index until the first transaction commits — then
// replays the stored response instead of running the mutation again.
//
// Usage inside a transaction:
//   const idem = await idempotency.claim(client, key, 'POST /api/x', userId);
//   if (idem.mode === 'replay')   { /* respond idem.status + idem.body */ }
//   if (idem.mode === 'conflict') { /* roll back, respond 409 idem.body */ }
//   ... run mutation ...
//   await idempotency.store(client, key, 201, responseBody); // before COMMIT
//
// claim modes:
//   'claimed'  → key was free; we now own it. Finish by calling store().
//   'replay'   → key already committed by an earlier request; body/status are
//                the stored response — do NOT run the mutation.
//   'conflict' → the key exists but is unusable: either bound to a different
//                endpoint, or committed without a stored response (stuck
//                in-flight claim). Never proceed — respond 409.
//   'none'     → no key supplied; proceed normally (no protection).
//
// Retention: rows older than RETENTION_DAYS are pruned lazily inside claim()
// at most once per process-hour — keeps the table bounded without a cron job.
// =============================================================================

const MAX_KEY_LEN    = 128;
const RETENTION_DAYS = 30;
const PRUNE_EVERY_MS = 60 * 60 * 1000; // at most one prune pass per process-hour

let _lastPrune = 0;

function _norm(key) {
    return typeof key === 'string' && key.trim() ? key.trim().slice(0, MAX_KEY_LEN) : null;
}

// Exported for tests/ops; also invoked lazily from claim().
async function prune(client) {
    await client.query(
        `DELETE FROM idempotency_keys WHERE created_at < NOW() - ($1 || ' days')::interval`,
        [String(RETENTION_DAYS)]
    );
}

async function _maybePrune(client) {
    if (Date.now() - _lastPrune < PRUNE_EVERY_MS) return;
    _lastPrune = Date.now();
    try { await prune(client); } catch (e) { /* prune must never break a request */ }
}

async function claim(client, key, endpoint, userId) {
    const k = _norm(key);
    if (!k) return { mode: 'none' };

    await _maybePrune(client);

    const ins = await client.query(
        `INSERT INTO idempotency_keys (key, endpoint, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING
         RETURNING key`,
        [k, endpoint, userId != null ? String(userId) : null]
    );
    if (ins.rowCount) return { mode: 'claimed', key: k };

    // Conflict means the key row is committed already (an in-flight identical
    // request would have blocked our INSERT until it committed or rolled back,
    // in which case we claimed the key above). Three possible shapes:
    const hit = await client.query(
        `SELECT endpoint, status_code, response_body FROM idempotency_keys WHERE key = $1`,
        [k]
    );
    const row = hit.rows[0];
    if (!row) {
        // The conflicting row vanished between INSERT and SELECT — safest is
        // to fail loudly rather than risk a duplicate mutation.
        return { mode: 'conflict', status: 409, body: { error: 'تعذر التحقق من مفتاح الطلب — أعد المحاولة.' } };
    }
    if (row.endpoint !== endpoint) {
        return { mode: 'conflict', status: 409, body: { error: 'مفتاح الطلب مستخدم على مسار مختلف — أعد إرسال الطلب بمفتاح جديد.' } };
    }
    if (!row.response_body) {
        // Committed key with no stored response: a claim that never finished.
        // Refusing to re-run protects against executing the mutation twice.
        return { mode: 'conflict', status: 409, body: { error: 'الطلب السابق بهذا المفتاح لم يكتمل — أعد المحاولة بعد لحظات.' } };
    }
    return { mode: 'replay', status: row.status_code || 200, body: row.response_body };
}

// Store the response the caller is about to send — must run inside the same
// transaction as the mutation, before COMMIT, so claim+response are atomic.
async function store(client, key, status, body) {
    const k = _norm(key);
    if (!k) return;
    await client.query(
        `UPDATE idempotency_keys SET status_code = $2, response_body = $3::jsonb WHERE key = $1`,
        [k, status, JSON.stringify(body)]
    );
}

module.exports = { claim, store, prune };
