-- =============================================================================
-- Migration 012: Drop Manufacturers Table
-- Date: 2026-05-17
-- Description: Remove unused manufacturers table. The suppliers table serves
--              as both suppliers and manufacturers, differentiated by the
--              supplier_type column ('supplier' or 'manufacturer').
-- =============================================================================

-- Drop manufacturers table (it's empty and unused)
DROP TABLE IF EXISTS manufacturers CASCADE;

-- Add comment to suppliers table for clarity
COMMENT ON TABLE suppliers IS 'Suppliers and manufacturers table. Use supplier_type column to differentiate: ''supplier'' for regular suppliers, ''manufacturer'' for manufacturers.';
COMMENT ON COLUMN suppliers.supplier_type IS 'Type of supplier: ''supplier'' or ''manufacturer''';
