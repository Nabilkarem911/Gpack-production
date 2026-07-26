-- =============================================================================
-- Fix: Migration 056 was marked applied but columns don't exist in production DB.
-- This re-adds ALL columns from 056 with IF NOT EXISTS (safe, idempotent).
-- Also re-adds columns from 061/062 that may also be missing.
-- =============================================================================

-- ── From migration 056: design_approvals columns ─────────────────────────────
ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES order_items(id) ON DELETE CASCADE;

ALTER TABLE design_approvals
    DROP CONSTRAINT IF EXISTS design_approvals_order_id_key;

ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS verification_hash VARCHAR(64) UNIQUE;

ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS certificate_number VARCHAR(30) UNIQUE;

ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS declaration_text TEXT;

ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS signature_path VARCHAR(500);

ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS signature_sha256 VARCHAR(64);

ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS approval_image_path VARCHAR(500);

ALTER TABLE design_approvals
    ADD COLUMN IF NOT EXISTS approval_pdf_path VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_design_approvals_item ON design_approvals(item_id);
CREATE INDEX IF NOT EXISTS idx_design_approvals_verification ON design_approvals(verification_hash);
CREATE INDEX IF NOT EXISTS idx_design_approvals_certificate ON design_approvals(certificate_number);

-- ── From migration 056: order_items columns ──────────────────────────────────
ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS approval_certificate_number VARCHAR(30),
    ADD COLUMN IF NOT EXISTS approval_verification_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS review_token_used BOOLEAN DEFAULT false;

-- ── From migration 061: package state machine + hashes ───────────────────────
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS package_state VARCHAR(30) DEFAULT 'pending';
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS package_state_updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS manifest_sha256 VARCHAR(64);
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS design_snapshot_files JSONB;
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS pdf_sha256 VARCHAR(64);
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS certificate_sha256 VARCHAR(64);

-- ── From migration 060: package manifest ─────────────────────────────────────
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS package_manifest JSONB;

-- ── From migration 062: audit enrichment ─────────────────────────────────────
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_timezone VARCHAR(50);
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_language VARCHAR(10);
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_viewport VARCHAR(30);
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_referrer TEXT;
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_device_fingerprint VARCHAR(128);

-- ── From migration 061: activity log enrichment ──────────────────────────────
ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS timezone VARCHAR(50);
ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS language VARCHAR(10);
ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS viewport VARCHAR(30);
ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS referrer TEXT;
ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(128);

-- ── From migration 059: notification queue lease ─────────────────────────────
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS lease_id UUID;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS processing_owner VARCHAR(100);
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS lease_version INTEGER NOT NULL DEFAULT 0;

-- ── From migration 058: queue idempotency + priority ─────────────────────────
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'normal';
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS retry_history JSONB DEFAULT '[]'::jsonb;

-- ── Verify: print column list for design_approvals ───────────────────────────
-- (diagnostic — safe to run, output goes to PostgreSQL log)
