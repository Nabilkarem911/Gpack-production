-- =============================================================================
-- G.PACK 2.0 — Migration 061: Production Hardening v2
-- Lease tokens, Package state machine, Manifest hash, Activity enrichment,
-- Immutable design snapshot, Circuit breaker state
-- =============================================================================

-- ── 1. Lease Token on notification_queue ────────────────────────────────────
-- Prevents double processing when multiple workers compete for the same item.
-- lease_id (UUID) ensures only the worker that claimed the item can update it.
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS lease_id UUID;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS processing_owner VARCHAR(100);

-- Index for lease-based claiming
CREATE INDEX IF NOT EXISTS idx_notif_queue_lease
    ON notification_queue(lease_id) WHERE lease_id IS NOT NULL;

-- ── 2. Approval Package State Machine ───────────────────────────────────────
-- Tracks the multi-step package generation process so crashes don't leave
-- half-generated packages. Worker can resume from the last completed step.
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS package_state VARCHAR(30)
    DEFAULT 'pending';
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS package_state_updated_at TIMESTAMPTZ
    DEFAULT NOW();

-- Valid states: pending → pdf_done → image_done → zip_done → manifest_done → notified
CREATE INDEX IF NOT EXISTS idx_design_approvals_pkg_state
    ON design_approvals(package_state) WHERE package_state != 'notified';

-- ── 3. Manifest SHA-256 in DB (file immutability chain) ─────────────────────
-- The manifest itself gets hashed. This hash is stored in DB.
-- Verification: recompute manifest hash → compare to DB → if mismatch, files were tampered.
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS manifest_sha256 VARCHAR(64);

-- ── 4. Activity Timeline enrichment ─────────────────────────────────────────
ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS timezone VARCHAR(50);
ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS language VARCHAR(10);
ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS viewport VARCHAR(30);
ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS referrer TEXT;
ALTER TABLE design_activity_log ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(128);

-- ── 5. Immutable Design Snapshot ────────────────────────────────────────────
-- When a design is approved, the exact files the client saw are copied to the
-- approval package directory. This snapshot is read-only and never changes,
-- even if the designer uploads new files later.
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS design_snapshot_files JSONB;

-- ── 6. Circuit Breaker state storage ────────────────────────────────────────
-- Stored in notification_settings as a JSON value, updated by the worker.
-- No separate table needed — just a key-value entry.
INSERT INTO notification_settings (key, value, description)
VALUES (
    'waha_circuit_breaker',
    '{"state": "closed", "failure_count": 0, "last_failure_at": null, "opened_at": null}',
    'Circuit breaker state for WAHA provider (closed/open/half_open)'
)
ON CONFLICT (key) DO NOTHING;

-- ── 7. Design approvals: add file hash columns for quick verification ───────
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS pdf_sha256 VARCHAR(64);
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS certificate_sha256 VARCHAR(64);
