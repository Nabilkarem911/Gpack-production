-- Migration 039: Add design_id column to order_items
-- Links order items to client-specific designs
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS design_id UUID REFERENCES client_designs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_design_id ON order_items(design_id);
