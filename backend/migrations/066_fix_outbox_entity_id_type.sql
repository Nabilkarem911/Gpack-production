-- Migration 066: Fix notification_outbox.entity_id type
-- Migration 065 was applied but the ALTER TABLE statement was filtered out
-- by a bug in the migration runner (statements starting with -- comments were skipped).
-- This migration is guaranteed to run because it's a new filename.

ALTER TABLE notification_outbox ALTER COLUMN entity_id TYPE VARCHAR(100) USING entity_id::text;
