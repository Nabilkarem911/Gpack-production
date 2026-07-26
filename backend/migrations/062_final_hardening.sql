-- =============================================================================
-- G.PACK 2.0 — Migration 062: Final Hardening
-- lease_version, signature_sha256, comprehensive audit fields
-- =============================================================================

-- ── 1. lease_version for optimistic locking ─────────────────────────────────
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS lease_version INTEGER NOT NULL DEFAULT 0;

-- ── 2. Signature SHA-256 on design_approvals ────────────────────────────────
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS signature_sha256 VARCHAR(64);

-- ── 3. Audit enrichment fields on design_approvals ──────────────────────────
-- Store client environment at time of approval (for legal disputes)
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_timezone VARCHAR(50);
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_language VARCHAR(10);
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_viewport VARCHAR(30);
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_referrer TEXT;
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS client_device_fingerprint VARCHAR(128);
