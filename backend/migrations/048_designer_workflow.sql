-- =============================================================================
-- G.PACK 2.0 — Migration 048: Designer Workflow
-- Adds design-related columns to orders & order_items.
-- ALL columns DEFAULT NULL — zero impact on existing code.
-- =============================================================================

-- ── Order-level design fields ───────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_status        VARCHAR(20)  DEFAULT NULL;
-- Values: NULL (not sent), 'pending', 'in_progress', 'in_review', 'completed', 'revision'

ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_designer_id UUID         DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_brief          TEXT         DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_brief_files    JSONB        DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_sent_at        TIMESTAMPTZ  DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_completed_at   TIMESTAMPTZ  DEFAULT NULL;

-- ── Order-item-level design fields (per-item files & notes) ─────────────────
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS design_notes        TEXT         DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS design_files        JSONB        DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS design_status       VARCHAR(20)  DEFAULT NULL;
-- Values: NULL, 'pending', 'in_progress', 'completed', 'approved', 'revision'

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS designer_notes      TEXT         DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS revision_notes      TEXT         DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS design_completed_at TIMESTAMPTZ  DEFAULT NULL;

-- ── Indexes for designer queries ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_designer        ON orders(assigned_designer_id) WHERE assigned_designer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_design_status   ON orders(design_status)        WHERE design_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_design_st  ON order_items(design_status)   WHERE design_status IS NOT NULL;
