-- =============================================================================
-- Migration 069: Add optional Pantone color to manufacturer order items
-- =============================================================================

ALTER TABLE manufacturer_order_items
    ADD COLUMN IF NOT EXISTS pantone_color VARCHAR(50);
