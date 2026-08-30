-- =============================================================================
-- Migration 079: MO Receipt Session Item Images
-- Purpose: Allow warehouse keepers to attach photos of received goods
--          to each line item in a receipt session. Photos are displayed
--          in the receiving archive / session detail view.
-- =============================================================================

-- ── 1. Images table (one item may have multiple photos) ───────────────────────
CREATE TABLE IF NOT EXISTS mo_receipt_session_item_images (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_item_id      UUID NOT NULL REFERENCES mo_receipt_session_items(id) ON DELETE CASCADE,
    image_path           VARCHAR(500) NOT NULL,
    file_name            VARCHAR(255),
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by           UUID REFERENCES users(id) ON DELETE SET NULL
);

-- ── 2. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mo_receipt_session_item_images_session_item_id
    ON mo_receipt_session_item_images(session_item_id);
