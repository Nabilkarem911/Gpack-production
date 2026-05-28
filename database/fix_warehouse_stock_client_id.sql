-- =============================================================================
-- MIGRATION: Fix warehouse_stock client_id constraint
-- Issue: warehouse_stock has client_id NOT NULL, but warehouses allows NULL
-- for general warehouses. This causes errors when creating stock for general
-- warehouses.
-- =============================================================================

-- Drop the NOT NULL constraint on client_id in warehouse_stock
ALTER TABLE warehouse_stock 
ALTER COLUMN client_id DROP NOT NULL;

-- Add comment explaining the change
COMMENT ON COLUMN warehouse_stock.client_id IS 
'Client ID for this stock. NULL for general warehouse stock, set for client-specific stock. Previously required NOT NULL but changed to support general warehouses.';
