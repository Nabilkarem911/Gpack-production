-- =============================================================================
-- 060: Add share token columns to manufacturer_orders for supplier sharing
-- Allows generating a public link (no auth) so suppliers can view designs + download files
-- =============================================================================

ALTER TABLE manufacturer_orders
    ADD COLUMN IF NOT EXISTS share_token TEXT;

ALTER TABLE manufacturer_orders
    ADD COLUMN IF NOT EXISTS share_token_hash VARCHAR(255);

ALTER TABLE manufacturer_orders
    ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

-- Index for fast token-hash lookups on the public route
CREATE INDEX IF NOT EXISTS idx_manufacturer_orders_share_token_hash
    ON manufacturer_orders(share_token_hash)
    WHERE share_token_hash IS NOT NULL;
