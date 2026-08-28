-- =============================================================================
-- G.PACK 2.0 — Migration 076: Reclaim stuck outbox events
-- Adds processing timestamps to notification_outbox and resets any events
-- that were stuck in 'processing' due to a worker crash/restart.
-- =============================================================================

-- Track when an outbox event started processing and which worker owns it.
ALTER TABLE notification_outbox
    ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS processing_owner VARCHAR(100);

-- Index to speed up stuck-outbox sweeps.
CREATE INDEX IF NOT EXISTS idx_outbox_processing_started_at
    ON notification_outbox(processing_started_at)
    WHERE status = 'processing';

-- Reset any events left in 'processing' due to a previous crash/restart.
-- These are safe to retry because outbox events are idempotent.
UPDATE notification_outbox
SET status = 'pending',
    processing_started_at = NULL,
    processing_owner = NULL,
    error = 'Reclaimed: worker restarted while processing'
WHERE status = 'processing';
