-- =============================================================================
-- Migration 065: Force-fix all missing columns from migrations 056-064
-- This migration is guaranteed to run because it's a new filename.
-- The migration runner now splits statements and skips "already exists" errors,
-- so every ALTER will either add the column or skip it if it exists.
-- =============================================================================

-- ── design_approvals: columns from migration 056 ─────────────────────────────
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES order_items(id) ON DELETE CASCADE;

ALTER TABLE design_approvals DROP CONSTRAINT IF EXISTS design_approvals_order_id_key;

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS verification_hash VARCHAR(64) UNIQUE;

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS certificate_number VARCHAR(30) UNIQUE;

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS declaration_text TEXT;

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS signature_path VARCHAR(500);

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS signature_sha256 VARCHAR(64);

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS approval_image_path VARCHAR(500);

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS approval_pdf_path VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_design_approvals_item ON design_approvals(item_id);

CREATE INDEX IF NOT EXISTS idx_design_approvals_verification ON design_approvals(verification_hash);

CREATE INDEX IF NOT EXISTS idx_design_approvals_certificate ON design_approvals(certificate_number);

-- ── order_items: columns from migration 056 ──────────────────────────────────
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS approval_certificate_number VARCHAR(30);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS approval_verification_hash VARCHAR(64);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS review_token_used BOOLEAN DEFAULT false;

-- ── design_approvals: columns from migration 061 ─────────────────────────────
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS package_state VARCHAR(30) DEFAULT 'pending';

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS package_state_updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS manifest_sha256 VARCHAR(64);

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS design_snapshot_files JSONB;

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS pdf_sha256 VARCHAR(64);

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS certificate_sha256 VARCHAR(64);

-- ── design_approvals: columns from migration 060 ─────────────────────────────
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS package_manifest JSONB;

-- ── design_approvals: columns from migration 062 ─────────────────────────────
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_timezone VARCHAR(50);

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_language VARCHAR(10);

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_viewport VARCHAR(30);

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_referrer TEXT;

ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_device_fingerprint VARCHAR(128);

-- ── design_activity_log: columns from migration 061 ──────────────────────────
ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS timezone VARCHAR(50);

ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS language VARCHAR(10);

ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS viewport VARCHAR(30);

ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS referrer TEXT;

ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(128);

-- ── notification_queue: columns from migrations 058-062 ──────────────────────
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS lease_id UUID;

ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS processing_owner VARCHAR(100);

ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS lease_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);

ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'normal';

ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS retry_history JSONB DEFAULT '[]'::jsonb;

-- ── notification_outbox: fix entity_id type from INTEGER to VARCHAR ──────────
-- This is the critical fix for the "invalid input syntax for type integer" error
-- when passing UUID values as entity_id.
-- Using USING clause to safely convert existing integer data to text.
ALTER TABLE notification_outbox ALTER COLUMN entity_id TYPE VARCHAR(100) USING entity_id::text;
