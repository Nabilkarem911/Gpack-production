-- =============================================================================
-- Migration 015: Add Custom Terms per Quotation
-- Date: 2026-05-25
-- Description: Allow each quotation to have its own custom terms/conditions
--              while keeping default terms for new quotations.
-- =============================================================================

-- Add custom_terms column to orders table (stores JSON of custom terms)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS custom_terms JSONB DEFAULT NULL;

COMMENT ON COLUMN orders.custom_terms IS 'Custom terms/conditions for this specific quotation (overrides defaults)';

-- Verification query (commented out - for manual verification only)
-- SELECT column_name, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'orders' AND column_name = 'custom_terms';
