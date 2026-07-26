-- =============================================================================
-- G.PACK 2.0 — Migration 053: Item-Level Design State Machine
-- 1. Rename design_status values on order_items and orders to new state machine
-- 2. Add item-level client review token columns (hash-only, no plain token)
-- 3. Create generic workflow_history table for audit trail
-- =============================================================================

-- ── 1. Rename design_status values on order_items ───────────────────────────
UPDATE order_items SET design_status = 'waiting_design'   WHERE design_status = 'pending';
UPDATE order_items SET design_status = 'manager_review'    WHERE design_status = 'completed';
UPDATE order_items SET design_status = 'client_revision'   WHERE design_status = 'revision';
-- 'in_progress' stays the same
-- 'approved' stays the same
-- 'client_review' is new (will be set by backend when item sent to client)

-- ── 2. Rename design_status values on orders (summary field) ────────────────
UPDATE orders SET design_status = 'waiting_design'   WHERE design_status = 'pending';
UPDATE orders SET design_status = 'manager_review'    WHERE design_status = 'in_review';
UPDATE orders SET design_status = 'client_revision'   WHERE design_status = 'revision';
-- 'in_progress', 'client_review', 'completed' stay

-- ── 3. Add item-level client review token columns (hash-only) ───────────────
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS review_token_hash       VARCHAR(64) DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS review_token_expires_at  TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS review_sent_at           TIMESTAMPTZ DEFAULT NULL;

-- design_client_status on order_items already exists from migration 049
-- values: NULL, 'sent', 'approved', 'revision_requested'

-- ── 4. Generic workflow_history table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_history (
    id           BIGSERIAL PRIMARY KEY,
    entity_type  VARCHAR(30) NOT NULL,
    entity_id    BIGINT NOT NULL,
    workflow     VARCHAR(30) NOT NULL,
    from_state   VARCHAR(30),
    to_state     VARCHAR(30) NOT NULL,
    actor_id     UUID REFERENCES users(id),
    actor_role   VARCHAR(30),
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes        TEXT,
    metadata     JSONB DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_history_entity
    ON workflow_history(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_workflow_history_workflow
    ON workflow_history(workflow, to_state);
CREATE INDEX IF NOT EXISTS idx_order_items_review_token
    ON order_items(review_token_hash) WHERE review_token_hash IS NOT NULL;

-- ── 5. Update column comments for clarity ───────────────────────────────────
COMMENT ON COLUMN order_items.design_status IS 'Design state machine: waiting_design, in_progress, manager_review, client_review, client_revision, approved';
COMMENT ON COLUMN orders.design_status IS 'Summary of design workflow across items (derived)';
