-- Migration 041: Add has_supplier_invoice to purchase_invoices
-- Tracks whether the received goods came with a supplier invoice or not

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS has_supplier_invoice BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN purchase_invoices.has_supplier_invoice IS 'Whether the goods were received with a supplier invoice';
