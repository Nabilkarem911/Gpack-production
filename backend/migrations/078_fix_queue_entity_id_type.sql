-- =============================================================================
-- G.PACK 2.0 — Migration 078: Ensure notification_queue.entity_id is VARCHAR
--
-- Migration 066 was supposed to change notification_outbox.entity_id to
-- VARCHAR, but notification_queue.entity_id may still be UUID if the earlier
-- migration only touched the outbox table. Internal notifications need to
-- store composite ids like "order_id_rev12" which are not valid UUIDs.
-- =============================================================================

ALTER TABLE notification_queue
    ALTER COLUMN entity_id TYPE VARCHAR(100) USING entity_id::text;

ALTER TABLE notification_dead_queue
    ALTER COLUMN entity_id TYPE VARCHAR(100) USING entity_id::text;
