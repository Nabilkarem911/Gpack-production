-- =============================================================================
-- Migration 102: Durable idempotency keys for mutating POST routes.
--
-- Network retries and double-submits bypass the UI button lock — the same
-- request can arrive twice. This table lets a route claim a client-supplied
-- key inside its transaction and store the response; a repeated key replays
-- the stored response instead of executing the mutation again.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key           TEXT PRIMARY KEY,
    endpoint      TEXT NOT NULL,
    user_id       TEXT,
    status_code   INTEGER,
    response_body JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at
    ON idempotency_keys (created_at);

COMMIT;
