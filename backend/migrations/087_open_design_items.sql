-- G.PACK 2.0 — Migration 087: Allow open-ended design request items
-- A design request can be a project whose items are not tied to the catalog.

BEGIN;

-- Allow design_request_items to exist without a catalog variant
-- (custom product/size names may be provided instead).
ALTER TABLE design_request_items
    ALTER COLUMN variant_id DROP NOT NULL;

COMMIT;
