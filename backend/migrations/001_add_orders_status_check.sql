-- =============================================================================
-- Migration 001: Add CHECK constraint to orders.status
-- Prevents invalid status values from being inserted directly.
-- Idempotent: safe to re-run if constraint already exists.
-- =============================================================================

-- First, clean up any invalid values (set to 'draft' if unknown)
UPDATE orders
SET status = 'draft'
WHERE status NOT IN ('draft', 'quote', 'needs_pricing', 'confirmed', 'production', 'processing', 'completed', 'invoiced', 'delivered', 'cancelled', 'archived');

-- Add CHECK constraint only if it doesn't already exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'orders_status_check'
          AND conrelid = 'orders'::regclass
    ) THEN
        ALTER TABLE orders
        ADD CONSTRAINT orders_status_check
        CHECK (status IN ('draft', 'quote', 'needs_pricing', 'confirmed', 'production', 'processing', 'completed', 'invoiced', 'delivered', 'cancelled', 'archived'));
    END IF;
END $$;