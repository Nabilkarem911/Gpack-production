-- =============================================================================
-- Migration 009: Critical Database Fixes
-- Date: 2026-05-17
-- Description: Add missing columns and constraints for proper system operation
-- =============================================================================

-- Fix 1: Add received_qty to manufacturer_order_items
-- This column tracks how much has been received from each manufacturer order item
ALTER TABLE manufacturer_order_items 
  ADD COLUMN IF NOT EXISTS received_qty DECIMAL(15,3) DEFAULT 0;

COMMENT ON COLUMN manufacturer_order_items.received_qty IS 'Quantity received from manufacturer for this item';

-- Fix 2: Add has_supplier_invoice to manufacturer_orders
-- This flag indicates if a supplier invoice has been created for this order
ALTER TABLE manufacturer_orders 
  ADD COLUMN IF NOT EXISTS has_supplier_invoice BOOLEAN DEFAULT false;

COMMENT ON COLUMN manufacturer_orders.has_supplier_invoice IS 'Whether a supplier invoice has been created for this order';

-- Fix 3: Add order_type to orders table (commercial vs VMI)
-- This distinguishes between regular commercial orders and VMI dispatch orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_type VARCHAR(20) DEFAULT 'commercial'
  CHECK (order_type IN ('commercial', 'vmi'));

COMMENT ON COLUMN orders.order_type IS 'Type of order: commercial (regular) or vmi (vendor-managed inventory dispatch)';

-- Fix 4: Add status CHECK constraints to prevent invalid values
-- This ensures data integrity by only allowing valid status values

-- Orders table status constraint
ALTER TABLE orders 
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('quote', 'confirmed', 'production', 'processing', 'completed', 'delivered', 'cancelled', 'archived'));

-- Manufacturer orders status constraint
-- First, update old status values to new standard values
UPDATE manufacturer_orders SET status = 'sent' WHERE status = 'ordered';
UPDATE manufacturer_orders SET status = 'partially_received' WHERE status = 'partial';
-- 'received' is already correct

ALTER TABLE manufacturer_orders
  DROP CONSTRAINT IF EXISTS mo_status_check;

ALTER TABLE manufacturer_orders
  ADD CONSTRAINT mo_status_check
  CHECK (status IN ('pending', 'sent', 'partially_received', 'received', 'cancelled'));

-- Verification queries (commented out - for manual verification only)
-- SELECT column_name, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'manufacturer_order_items' AND column_name = 'received_qty';

-- SELECT column_name, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'manufacturer_orders' AND column_name = 'has_supplier_invoice';

-- SELECT column_name, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'orders' AND column_name = 'order_type';
