-- =============================================================================
-- Migration 094: Extra invoice items (بنود إضافية على الفاتورة)
--
-- Allows invoice lines that are NOT linked to a quotation/order item or a
-- catalog variant — e.g. cliché (كلايش) charges discovered after production.
-- Such lines carry a free-text item_name, have variant_id = NULL, and are
-- flagged is_extra = TRUE so they can be copied from the proforma (draft)
-- invoice to the final invoice and excluded from stock/return flows.
-- Fully additive: existing rows keep item_name = NULL and is_extra = FALSE.
-- =============================================================================

ALTER TABLE invoice_items
    ADD COLUMN IF NOT EXISTS item_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS is_extra BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_invoice_items_extra
    ON invoice_items(invoice_id) WHERE is_extra = TRUE;
