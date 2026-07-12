-- =============================================================================
-- MIGRATION: Add stock_id column to inventory_transactions
-- Issue: Backend code references stock_id but column doesn't exist in DB
-- =============================================================================

-- Add stock_id column to inventory_transactions table
ALTER TABLE inventory_transactions 
ADD COLUMN IF NOT EXISTS stock_id UUID REFERENCES warehouse_stock(id);

-- Add comment
COMMENT ON COLUMN inventory_transactions.stock_id IS 'Reference to warehouse_stock record that was affected by this transaction';
