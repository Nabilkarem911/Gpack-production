-- =============================================================================
-- Migration 060: Add financial totals columns to direct_receipts
-- Purpose: The review endpoint calculates subtotal, tax_rate, tax_amount, and
--          grand_total after manager review, but these columns were missing from
--          the original 046_direct_receipts schema. This migration adds them.
-- =============================================================================

ALTER TABLE direct_receipts
    ADD COLUMN IF NOT EXISTS subtotal    DECIMAL(15,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tax_rate    DECIMAL(5,4)   NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tax_amount  DECIMAL(15,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS grand_total DECIMAL(15,4) NOT NULL DEFAULT 0;
