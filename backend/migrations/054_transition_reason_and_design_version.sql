-- =============================================================================
-- G.PACK 2.0 — Migration 054: transition_reason + design_version
-- 1. Add transition_reason column to workflow_history (structured, for reports)
-- 2. Add design_version column to order_items (versioning for rework cycles)
-- =============================================================================

-- ── 1. transition_reason on workflow_history ─────────────────────────────────
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS transition_reason VARCHAR(50) DEFAULT NULL;

COMMENT ON COLUMN workflow_history.transition_reason IS
    'Structured reason code: designer_assigned, designer_started, designer_submitted, manager_approved, manager_rejected, sent_to_client, client_approved, client_requested_change, rework_started';

CREATE INDEX IF NOT EXISTS idx_workflow_history_reason
    ON workflow_history(transition_reason) WHERE transition_reason IS NOT NULL;

-- ── 2. design_version on order_items ─────────────────────────────────────────
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS design_version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN order_items.design_version IS
    'Incremented each time the designer resubmits after a revision cycle. 0 = initial, 1 = first rework, etc.';

-- Backfill: set design_version = 1 for items that already have design_files
-- (they were submitted at least once)
UPDATE order_items SET design_version = 1
 WHERE design_files IS NOT NULL AND design_files != '[]'::jsonb AND design_version = 0;
