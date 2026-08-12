-- =============================================================================
-- 061: Add portal_token columns to suppliers table
-- Allows generating a permanent (non-expiring) public link so suppliers can
-- view all their manufacturer orders in one portal page and update statuses.
-- =============================================================================

ALTER TABLE suppliers
    ADD COLUMN IF NOT EXISTS portal_token TEXT;

ALTER TABLE suppliers
    ADD COLUMN IF NOT EXISTS portal_token_hash VARCHAR(255);

ALTER TABLE suppliers
    ADD COLUMN IF NOT EXISTS portal_last_accessed TIMESTAMPTZ;

-- Index for fast token-hash lookups on the public portal route
CREATE INDEX IF NOT EXISTS idx_suppliers_portal_token_hash
    ON suppliers(portal_token_hash)
    WHERE portal_token_hash IS NOT NULL;
