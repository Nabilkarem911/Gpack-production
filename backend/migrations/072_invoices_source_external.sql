-- =============================================================================
-- Migration 072: Add invoice source and external tracking
-- Purpose: Distinguish sales-invoices-page (reminder) invoices from
--          production-order invoices, and track Onyx issuance.
-- =============================================================================

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'orders',
    ADD COLUMN IF NOT EXISTS external_invoice_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS external_issued_at TIMESTAMP WITH TIME ZONE;

-- Backfill existing invoices so they continue to count in the account statement.
UPDATE invoices SET source = 'orders' WHERE source IS NULL;
