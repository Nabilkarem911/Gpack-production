-- =============================================================================
-- G.PACK 2.0 — Migration 058: Queue Idempotency + Priority + Webhook Support
-- =============================================================================

-- ── Idempotency: prevent duplicate message delivery ─────────────────────────
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);

-- Unique constraint on idempotency_key — prevents same message being enqueued twice
ALTER TABLE notification_queue ADD CONSTRAINT uq_notification_idempotency
    UNIQUE (idempotency_key);

-- ── Priority: HIGH (approval), NORMAL (default), LOW (announcements) ─────────
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS priority VARCHAR(10) NOT NULL DEFAULT 'normal';

-- Index for priority-based processing (HIGH first)
CREATE INDEX IF NOT EXISTS idx_notif_queue_priority
    ON notification_queue(priority, next_attempt_at)
    WHERE status = 'pending';

-- ── Webhook delivery tracking ───────────────────────────────────────────────
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS waha_message_id VARCHAR(255);
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS waha_status VARCHAR(50);
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- ── Retry history (JSON array of attempts) ──────────────────────────────────
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS retry_history JSONB DEFAULT '[]';

-- ── Cancelled status support ────────────────────────────────────────────────
-- status already supports 'cancelled' as a value, just adding index
CREATE INDEX IF NOT EXISTS idx_notif_queue_priority_status
    ON notification_queue(priority, status, next_attempt_at);
