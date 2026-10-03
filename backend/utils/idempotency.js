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
//   if (idem.mode === 'replay') { /* return idem.body with idem.status */ }
//   ... run mutation ...
//   await idempotency.store(client, key, 201, responseBody); // before COMMIT
//
// claim modes:
//   'claimed' → key was free; we now own it. Finish by calling store().
//   'replay'  → key already committed by an earlier request; body/status are
//               the stored response — do NOT run the mutation.
//   'none'    → no usable key supplied; proceed normally (no protection).
// =============================================================================

const MAX_KEY_LEN = 128;

function _norm(key) {
    return typeof key === 'string' && key.trim() ? key.trim().slice(0, MAX_KEY_LEN) : null;
}

async function claim(client, key, endpoint, userId) {
    const k = _norm(key);
    if (!k) return { mode: 'none' };

    const ins = await client.query(
        `INSERT INTO idempotency_keys (key, endpoint, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING
         RETURNING key`,
        [k, endpoint, userId != null ? String(userId) : null]
    );
    if (ins.rowCount) return { mode: 'claimed', key: k };

    // Conflict means the key row committed already (an in-flight identical
    // request would have blocked our INSERT until it committed or rolled
    // back, in which case we claimed the key above).
    const hit = await client.query(
        `SELECT status_code, response_body FROM idempotency_keys WHERE key = $1`,
        [k]
    );
    const row = hit.rows[0];
    return row && row.response_body
        ? { mode: 'replay', status: row.status_code || 200, body: row.response_body }
        : { mode: 'none' };
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

module.exports = { claim, store };
