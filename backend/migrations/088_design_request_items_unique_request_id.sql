-- G.PACK 2.0 — Migration 088: Enforce a single item per design request.
-- This is a defensive constraint to prevent race conditions and duplicates.
-- It does not delete or modify existing rows; it only adds a uniqueness rule.

BEGIN;

-- Drop the previous per-request, per-variant unique key if it exists.
-- It is replaced by the stricter per-request unique key because each design
-- request may now contain exactly one item, regardless of catalog variant.
ALTER TABLE design_request_items
    DROP CONSTRAINT IF EXISTS design_request_items_request_id_variant_id_key;

-- Add the new constraint. The migration will fail only if the database
-- already contains a request with more than one item (which must be
-- reconciled manually before deployment).
ALTER TABLE design_request_items
    ADD CONSTRAINT design_request_items_request_id_unique
    UNIQUE (request_id);

COMMIT;
