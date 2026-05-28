-- Migration 025: Add missing columns to orders table
-- These columns are referenced in the orders route but missing from the deployed schema.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS share_token       VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS token_expires_at  TIMESTAMP WITH TIME ZONE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_response   VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rejection_reason  TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS responded_at      TIMESTAMP WITH TIME ZONE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_receipt   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom_terms      JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS down_payment_required DECIMAL(15,2);

CREATE INDEX IF NOT EXISTS idx_orders_share_token ON orders(share_token) WHERE share_token IS NOT NULL;
