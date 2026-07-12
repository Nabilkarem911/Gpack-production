-- Migration 034: Add share_token and token_expires_at to invoices for secure public access
-- Pattern matches existing orders table share_token implementation (public_quotation.js)

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS share_token       VARCHAR(100);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS token_expires_at  TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_invoices_share_token ON invoices(share_token) WHERE share_token IS NOT NULL;
