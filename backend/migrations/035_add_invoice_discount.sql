-- =============================================================================
-- 035: Add invoice-level discount_amount column to invoices table
-- Allows a global fixed-amount discount on the invoice subtotal (before tax).
-- =============================================================================

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15,2) DEFAULT 0;
