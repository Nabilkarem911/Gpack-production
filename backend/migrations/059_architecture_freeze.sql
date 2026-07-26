-- =============================================================================
-- G.PACK 2.0 — Migration 059: Architecture Freeze
-- Dead Letter Queue + Outbox Pattern + Processing Lease + Correlation ID
-- =============================================================================

-- ── 1. Dead Letter Queue ────────────────────────────────────────────────────
-- Permanently failed messages move here, keeping the main queue clean.
CREATE TABLE IF NOT EXISTS notification_dead_queue (
    id              SERIAL PRIMARY KEY,
    original_id     INTEGER NOT NULL,
    channel         VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
    recipient       VARCHAR(255) NOT NULL,
    recipient_name  VARCHAR(255),
    recipient_role  VARCHAR(50),
    message_type    VARCHAR(100) NOT NULL,
    subject         VARCHAR(500),
    body            TEXT,
    attachments     JSONB,
    entity_type     VARCHAR(50),
    entity_id       INTEGER,
    metadata        JSONB,
    idempotency_key VARCHAR(64),
    priority        VARCHAR(10) DEFAULT 'normal',
    correlation_id  VARCHAR(100),
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 5,
    last_error      TEXT,
    retry_history   JSONB DEFAULT '[]',
    waha_message_id VARCHAR(255),
    waha_status     VARCHAR(50),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    failed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    moved_by        VARCHAR(100) DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_dead_queue_correlation
    ON notification_dead_queue(correlation_id);
CREATE INDEX IF NOT EXISTS idx_dead_queue_message_type
    ON notification_dead_queue(message_type);
CREATE INDEX IF NOT EXISTS idx_dead_queue_failed_at
    ON notification_dead_queue(failed_at DESC);

-- ── 2. Outbox Pattern ───────────────────────────────────────────────────────
-- Events are written in the same DB transaction as the business operation.
-- The worker reads from the outbox, processes, and marks as processed.
-- This guarantees no message is lost even if the server crashes mid-approval.
CREATE TABLE IF NOT EXISTS notification_outbox (
    id              SERIAL PRIMARY KEY,
    event_type      VARCHAR(100) NOT NULL,
    entity_type     VARCHAR(50) NOT NULL,
    entity_id       INTEGER NOT NULL,
    correlation_id  VARCHAR(100) NOT NULL,
    payload         JSONB NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ,
    error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_status_created
    ON notification_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_correlation
    ON notification_outbox(correlation_id);

-- ── 3. Processing Lease / Timeout ───────────────────────────────────────────
-- If a worker crashes while processing, the message is stuck in 'processing'.
-- This column tracks when processing started; a sweeper reclaims stuck items.
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

-- Index for sweeper: find items stuck in processing for > 10 minutes
CREATE INDEX IF NOT EXISTS idx_notif_queue_processing_stuck
    ON notification_queue(status, processing_started_at)
    WHERE status = 'processing';

-- ── 4. Correlation ID ───────────────────────────────────────────────────────
-- Links all related records: approval, notifications, queue, logs, files.
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(100);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_notif_queue_correlation
    ON notification_queue(correlation_id);
CREATE INDEX IF NOT EXISTS idx_notifications_correlation
    ON notifications(correlation_id);

-- ── 5. Admin notification recipients from DB (not env var) ──────────────────
-- Instead of WAHA_ADMIN_CHAT_ID env var, store admin recipients in settings.
CREATE TABLE IF NOT EXISTS notification_settings (
    id              SERIAL PRIMARY KEY,
    key             VARCHAR(100) NOT NULL UNIQUE,
    value           JSONB NOT NULL,
    description     TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      INTEGER
);

-- Seed default admin recipients (empty — to be configured via ERP UI)
INSERT INTO notification_settings (key, value, description)
VALUES ('admin_whatsapp_recipients', '[]', 'List of admin phone numbers for management notifications (JSON array of {name, phone})')
ON CONFLICT (key) DO NOTHING;

INSERT INTO notification_settings (key, value, description)
VALUES ('waha_health_check_enabled', 'true', 'Enable periodic WAHA health check')
ON CONFLICT (key) DO NOTHING;

INSERT INTO notification_settings (key, value, description)
VALUES ('waha_health_check_interval_sec', '60', 'WAHA health check interval in seconds')
ON CONFLICT (key) DO NOTHING;
