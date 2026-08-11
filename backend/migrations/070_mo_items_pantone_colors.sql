-- =============================================================================
-- Migration 070: Add multiple Pantone colors support to manufacturer order items
-- =============================================================================

ALTER TABLE manufacturer_order_items
    ADD COLUMN IF NOT EXISTS pantone_colors JSONB DEFAULT '[]'::jsonb;
