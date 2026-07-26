-- =============================================================================
-- G.PACK 2.0 — Migration 055: Fix workflow_history.entity_id from BIGINT to UUID
-- order_items.id is UUID, but workflow_history.entity_id was BIGINT (migration 053).
-- This caused: "invalid input syntax for type bigint: <uuid>"
-- =============================================================================

-- Drop indexes that reference entity_id (will recreate after type change)
DROP INDEX IF EXISTS idx_workflow_history_entity;

-- Change entity_id column type from BIGINT to UUID
-- Cast existing values through text in case any rows exist
ALTER TABLE workflow_history
    ALTER COLUMN entity_id TYPE UUID USING entity_id::text::UUID;

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_workflow_history_entity
    ON workflow_history(entity_type, entity_id);
