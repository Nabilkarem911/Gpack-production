-- =============================================================================
-- Migration 074: Link direct receipts to generated VMI production orders
-- Safe additive migration: no existing data or columns are deleted.
-- =============================================================================

ALTER TABLE direct_receipts
    ADD COLUMN IF NOT EXISTS production_order_id UUID
        REFERENCES orders(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reverted_by UUID
        REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_direct_receipts_production_order
    ON direct_receipts(production_order_id)
    WHERE production_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_direct_receipts_production_order
    ON direct_receipts(production_order_id);
