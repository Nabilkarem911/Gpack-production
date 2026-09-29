-- Migration 096: add mockup_path to manufacturer_order_items
-- Stores the uploaded mockup image path shown to the supplier on the public link.
ALTER TABLE manufacturer_order_items ADD COLUMN IF NOT EXISTS mockup_path TEXT DEFAULT NULL;

COMMENT ON COLUMN manufacturer_order_items.mockup_path IS 'Optional mockup image path (/uploads/mockups/...) displayed with the item on the supplier share link';
