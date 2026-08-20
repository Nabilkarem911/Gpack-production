-- =============================================================================
-- 062: Add portal token columns to clients table
-- Allows generating a permanent public link so clients can view their orders.
-- =============================================================================

ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS portal_token TEXT;

ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS portal_token_hash VARCHAR(255);

ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS portal_last_accessed TIMESTAMPTZ;

-- Index for fast token-hash lookups on the public portal route
CREATE INDEX IF NOT EXISTS idx_clients_portal_token_hash
    ON clients(portal_token_hash)
    WHERE portal_token_hash IS NOT NULL;
