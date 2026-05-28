-- =============================================================================
-- Migration 010: Add supplier_type to suppliers table
-- Date: 2026-05-17
-- Description: Clarify that suppliers can be manufacturers, suppliers, or both
-- =============================================================================

-- Add supplier_type column to distinguish between suppliers and manufacturers
ALTER TABLE suppliers 
  ADD COLUMN IF NOT EXISTS supplier_type VARCHAR(20) DEFAULT 'supplier'
  CHECK (supplier_type IN ('supplier', 'manufacturer', 'both'));

COMMENT ON COLUMN suppliers.supplier_type IS 'Type of supplier: supplier (goods only), manufacturer (production), or both';

-- Update existing suppliers to 'manufacturer' if they have manufacturer_orders
UPDATE suppliers 
SET supplier_type = 'manufacturer'
WHERE id IN (
    SELECT DISTINCT manufacturer_id 
    FROM manufacturer_orders 
    WHERE manufacturer_id IS NOT NULL
);
