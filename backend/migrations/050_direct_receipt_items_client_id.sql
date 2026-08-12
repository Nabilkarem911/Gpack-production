-- =============================================================================
-- Migration 050: Add client_id to direct_receipt_items
-- Purpose: Allow manager to assign each received item to a specific client
--          during review, so warehouse_stock is created with the correct
--          client_id instead of always NULL (general stock).
-- =============================================================================

ALTER TABLE direct_receipt_items
    ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_direct_receipt_items_client_id
    ON direct_receipt_items(client_id);
