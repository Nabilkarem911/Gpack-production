-- =============================================================================
-- Migration 001: Add CHECK constraint to orders.status
-- Prevents invalid status values from being inserted directly.
-- =============================================================================

-- First, clean up any invalid values (set to 'draft' if unknown)
UPDATE orders
SET status = 'draft'
WHERE status NOT IN ('draft', 'quote', 'needs_pricing', 'confirmed', 'production', 'processing', 'completed', 'invoiced', 'delivered', 'cancelled', 'archived');

-- Add CHECK constraint
-- Note: The schema already uses VARCHAR(50), we add constraint to restrict values
ALTER TABLE orders
ADD CONSTRAINT orders_status_check
CHECK (status IN ('draft', 'quote', 'needs_pricing', 'confirmed', 'production', 'processing', 'completed', 'invoiced', 'delivered', 'cancelled', 'archived'));