-- =============================================================================
-- Migration 095: Item-level cancellation on order_items
--
-- Allows cancelling a single order item (e.g. client cancelled a product)
-- while the production order is still in 'production'/'processing', WITHOUT
-- the full "revert & archive & re-convert" flow. Soft-cancel only: the row
-- and all its links (design_approvals, invoice_items, activity log) stay
-- intact; readers filter `cancelled_at IS NULL` to keep the item out of
-- operational paths (assignment, invoices, delivery, design workflow).
-- Fully additive: existing rows keep cancelled_at = NULL.
-- =============================================================================

ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Fast lookup of active items per order (the hot path for every reader).
CREATE INDEX IF NOT EXISTS idx_order_items_active_per_order
    ON order_items(order_id) WHERE cancelled_at IS NULL;
