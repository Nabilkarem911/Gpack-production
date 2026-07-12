-- =============================================================================
-- Migration 038: Add missing columns referenced in routes
-- Date: 2026-06-22
-- Description: Adds paid_amount, total_cost to manufacturer_orders.
--              These columns are referenced in suppliers.js profile route
--              but were never created by any migration.
-- =============================================================================

-- manufacturer_orders: paid_amount for tracking supplier payments
ALTER TABLE manufacturer_orders
    ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(15,2) DEFAULT 0;

-- manufacturer_orders: total_cost alias for total_amount (used in supplier stats)
ALTER TABLE manufacturer_orders
    ADD COLUMN IF NOT EXISTS total_cost DECIMAL(15,2) DEFAULT 0;

-- Update total_cost to match total_amount for existing rows
UPDATE manufacturer_orders SET total_cost = total_amount WHERE total_cost = 0 AND total_amount > 0;
