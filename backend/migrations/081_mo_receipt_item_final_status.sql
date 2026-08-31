-- =============================================================================
-- Migration 081: Preserve final/partial status per received item
-- =============================================================================

ALTER TABLE mo_receipt_session_items
    ADD COLUMN IF NOT EXISTS is_final BOOLEAN NOT NULL DEFAULT FALSE;
