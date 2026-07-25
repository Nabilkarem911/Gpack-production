-- =============================================================================
-- Migration 052: Item-Level Designer Assignment
-- Allows assigning different designers to different items within the same order.
-- =============================================================================

-- Add assigned_designer_id to order_items for per-item designer assignment
-- users.id is UUID, so the column must be UUID type
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS assigned_designer_id UUID REFERENCES users(id);

-- Index for fast lookup of items by designer
CREATE INDEX IF NOT EXISTS idx_order_items_assigned_designer
    ON order_items(assigned_designer_id)
    WHERE assigned_designer_id IS NOT NULL;

-- Backfill: for existing orders with assigned_designer_id, copy it to order_items
-- so old assignments continue to work
UPDATE order_items oi
SET assigned_designer_id = o.assigned_designer_id
FROM orders o
WHERE oi.order_id = o.id
  AND o.assigned_designer_id IS NOT NULL
  AND oi.assigned_designer_id IS NULL;
