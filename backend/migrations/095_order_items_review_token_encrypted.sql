-- =============================================================================
-- Migration 095: Encrypted copy of the item-level design review token
--
-- order_items.review_token_hash is hash-only, so the backend can never return
-- the existing /design-review/{token} URL — the UI's "copy link" action was
-- forced to rotate the token (resend-review), which broke links already sent
-- to the client.
--
-- review_token_encrypted stores the AES-256-GCM encrypted token (same pattern
-- as orders.share_token / invoices.share_token) so the saved link can be
-- read back and copied without regeneration. The hash stays the lookup key.
-- Existing rows keep NULL — old links still work via hash lookup, and the
-- next send/resend populates the encrypted copy.
-- =============================================================================

ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS review_token_encrypted TEXT DEFAULT NULL;

COMMENT ON COLUMN order_items.review_token_encrypted IS 'AES-256-GCM encrypted review token — allows re-displaying the existing share link without rotating it';
