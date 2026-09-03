-- G.PACK 2.0 — Migration 088: Enforce a single item per design request.
--
-- This migration:
--   1. Backs up design_request_items (in case manual recovery is needed).
--   2. Reconciles any pre-existing rows with duplicate request_id by collapsing
--      them into a single item, preserving versions, revisions, and messages.
--   3. Adds the UNIQUE(request_id) constraint.
--
-- Backup: the table design_request_items_088_backup is created once and left
-- in the database for recovery. It can be removed after the deployment is
-- confirmed healthy.

BEGIN;

-- 0. Make the migration idempotent by dropping the new constraint first.
--    If it does not exist, this is a no-op.
ALTER TABLE design_request_items
    DROP CONSTRAINT IF EXISTS design_request_items_request_id_unique;

-- 1. Drop the previous per-request, per-variant unique key if it still exists.
ALTER TABLE design_request_items
    DROP CONSTRAINT IF EXISTS design_request_items_request_id_variant_id_key;

-- 2. Back up design_request_items before any change.
CREATE TABLE IF NOT EXISTS design_request_items_088_backup AS
SELECT * FROM design_request_items WHERE 1=0;

INSERT INTO design_request_items_088_backup
SELECT i.*
FROM design_request_items i
WHERE NOT EXISTS (SELECT 1 FROM design_request_items_088_backup LIMIT 1);

-- 3. Create a helper table with the chosen keeper item per duplicated request.
--    Preference: most versions, then most revisions, then oldest created_at, then smallest id.
DROP TABLE IF EXISTS _design_request_keepers;

CREATE TABLE _design_request_keepers (
    request_id UUID PRIMARY KEY,
    keep_id UUID
);

WITH item_stats AS (
    SELECT i.id, i.request_id, i.created_at,
           (SELECT COUNT(*) FROM design_request_versions v WHERE v.item_id = i.id) AS v_count,
           (SELECT COUNT(*) FROM design_request_revisions r WHERE r.item_id = i.id) AS r_count
    FROM design_request_items i
    WHERE i.request_id IN (
        SELECT request_id FROM design_request_items GROUP BY request_id HAVING COUNT(*) > 1
    )
),
ranked AS (
    SELECT id, request_id,
           ROW_NUMBER() OVER (
               PARTITION BY request_id
               ORDER BY v_count DESC, r_count DESC, created_at ASC, id ASC
           ) AS rn
    FROM item_stats
)
INSERT INTO _design_request_keepers (request_id, keep_id)
SELECT request_id, id
FROM ranked
WHERE rn = 1;

-- 4. Renumber versions in affected requests so they are sequential per request.
--    This prevents (request_id, version_number) and
--    (request_id, item_id, version_number) unique-constraint collisions
--    once all versions are attached to the keeper.
WITH ranked AS (
    SELECT v.id,
           ROW_NUMBER() OVER (PARTITION BY v.request_id ORDER BY v.version_number, v.created_at) AS new_version_number
    FROM design_request_versions v
    WHERE v.request_id IN (SELECT request_id FROM _design_request_keepers)
)
UPDATE design_request_versions v
SET version_number = r.new_version_number
FROM ranked r
WHERE v.id = r.id;

-- 5. Reassign versions, revisions, and messages from non-keeper items to the keeper.
UPDATE design_request_versions v
SET item_id = k.keep_id
FROM design_request_items i
JOIN _design_request_keepers k ON i.request_id = k.request_id
WHERE v.item_id = i.id AND i.id <> k.keep_id;

UPDATE design_request_revisions r
SET item_id = k.keep_id
FROM design_request_items i
JOIN _design_request_keepers k ON i.request_id = k.request_id
WHERE r.item_id = i.id AND i.id <> k.keep_id;

UPDATE design_request_messages m
SET item_id = k.keep_id
FROM design_request_items i
JOIN _design_request_keepers k ON i.request_id = k.request_id
WHERE m.item_id = i.id AND i.id <> k.keep_id;

-- 6. Recompute the keeper item's workflow fields from the (now merged) versions.
UPDATE design_request_items i
SET current_version_id = latest.id,
    approved_version_id = CASE WHEN latest.status = 'approved' THEN latest.id ELSE NULL END,
    status = CASE
        WHEN latest.status = 'approved' THEN 'approved'
        WHEN latest.status = 'revision_requested' THEN 'revision_requested'
        ELSE 'client_review'
    END,
    approved_at = CASE WHEN latest.status = 'approved' THEN latest.created_at ELSE NULL END
FROM (
    SELECT DISTINCT ON (item_id) item_id, id, status, created_at
    FROM design_request_versions
    WHERE item_id IS NOT NULL
    ORDER BY item_id, version_number DESC
) latest
WHERE i.id = latest.item_id;

-- 6a. Sync the parent design_requests row with the keeper item.
UPDATE design_requests dr
SET item_name = i.product_name,
    item_size = i.size_name,
    approved_version_id = i.approved_version_id,
    approved_at = i.approved_at,
    status = CASE
        WHEN dr.status IN ('completed', 'cancelled') THEN dr.status
        WHEN i.status = 'approved' THEN 'approved'
        ELSE i.status
    END
FROM design_request_items i
JOIN _design_request_keepers k ON i.request_id = k.request_id
WHERE dr.id = i.request_id;

-- 7. Delete the duplicate items that are not keepers.
DELETE FROM design_request_items i
USING _design_request_keepers k
WHERE i.request_id = k.request_id AND i.id <> k.keep_id;

-- 8. Add the per-request uniqueness constraint.
ALTER TABLE design_request_items
    ADD CONSTRAINT design_request_items_request_id_unique
    UNIQUE (request_id);

-- 9. Clean up helper table.
DROP TABLE _design_request_keepers;

COMMIT;
