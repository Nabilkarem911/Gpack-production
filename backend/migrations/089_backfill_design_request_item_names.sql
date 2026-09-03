-- G.PACK 2.0 — Migration 089: Backfill design_requests item_name and item_size
-- from the canonical product/variant data in design_request_items.
--
-- Why: older requests created by the itemized form left design_requests.item_name
-- empty and item_size null because the backend relied on UI-supplied text.
-- This migration derives the display fields from the item row.
--
-- Idempotency: It is safe to re-run; it only touches rows where item_name
-- is empty/blank or item_size is null, and uses the current item values.
--
-- Reversibility: This is NOT a reversible migration. Once item_name and
-- item_size are overwritten, the original empty/null values cannot be
-- recovered unless a pre-migration backup exists. To roll back manually,
-- restore the affected rows from a backup, or run a targeted UPDATE that
-- sets item_name = '' and item_size = NULL for the rows modified by this
-- migration. The recommended rollback mechanism is to keep this migration
-- wrapped in a deployment snapshot/backup and restore from that backup if
-- needed, rather than relying on a SQL-only DOWN migration.

BEGIN;

UPDATE design_requests dr
SET item_name = i.product_name
FROM design_request_items i
WHERE i.request_id = dr.id
  AND NULLIF(TRIM(dr.item_name), '') IS NULL
  AND i.product_name IS NOT NULL
  AND i.product_name <> '';

UPDATE design_requests dr
SET item_size = i.size_name
FROM design_request_items i
WHERE i.request_id = dr.id
  AND dr.item_size IS NULL
  AND i.size_name IS NOT NULL
  AND i.size_name <> '';

COMMIT;
