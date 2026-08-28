-- =============================================================================
-- G.PACK 2.0 — Migration 077: Fix outbox entity_id type to VARCHAR
--
-- The outbox table was created with entity_id as UUID, but internal
-- notification events (e.g. quotation_needs_pricing with revision suffix)
-- need to store composite ids like "order_id_rev12" which are not valid UUIDs.
--
-- Migration 066 already did this for the queue table; this does the same for
-- the outbox and dead queue tables to keep schema symmetry.
-- =============================================================================

ALTER TABLE notification_outbox
    ALTER COLUMN entity_id TYPE VARCHAR(100) USING entity_id::text;

-- Reset any outbox events that failed due to the UUID type error so the
-- worker retries them with the corrected code.
UPDATE notification_outbox
SET status = 'pending',
    error = NULL,
    processing_started_at = NULL,
    processing_owner = NULL
WHERE status = 'pending'
  AND error LIKE '%invalid input syntax for type uuid%';
