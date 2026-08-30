-- =============================================================================
-- Migration 080: Add warehouse_id to delivery_notes
-- Purpose: Preserve the warehouse selected when manually issuing a delivery
--          note so it can be used when editing and adding more items later.
-- =============================================================================

ALTER TABLE delivery_notes
    ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_notes_warehouse_id
    ON delivery_notes(warehouse_id);
