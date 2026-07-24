-- =============================================================================
-- Migration 049: Design Client Review — share token for design review page
-- Adds design_share_token + design_token_expires_at to orders for public
-- client-facing design review (separate from quotation share_token).
-- =============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_share_token       TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_share_token_hash  VARCHAR(64) DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_token_expires_at  TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_sent_to_client_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_client_status     VARCHAR(20) DEFAULT NULL;
-- design_client_status values: NULL, 'sent', 'approved', 'revision_requested'

-- Per-item client feedback
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS client_design_status   VARCHAR(20) DEFAULT NULL;
-- client_design_status values: NULL, 'approved', 'revision_requested'
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS client_revision_notes  TEXT DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS client_approved_at     TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_design_share_token      ON orders(design_share_token)       WHERE design_share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_design_share_token_hash ON orders(design_share_token_hash)  WHERE design_share_token_hash IS NOT NULL;
