-- Migration 037: Add share_token_hash columns for deterministic lookup of encrypted tokens (D-005)

ALTER TABLE orders   ADD COLUMN IF NOT EXISTS share_token_hash VARCHAR(64);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS share_token_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_orders_share_token_hash   ON orders(share_token_hash)   WHERE share_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_share_token_hash ON invoices(share_token_hash) WHERE share_token_hash IS NOT NULL;
