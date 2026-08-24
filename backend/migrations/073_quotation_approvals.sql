-- =============================================================================
-- Migration 073: Immutable quotation approvals with electronic signature
-- =============================================================================

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS quotation_revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_quotation_revision_positive;

ALTER TABLE orders
    ADD CONSTRAINT orders_quotation_revision_positive CHECK (quotation_revision > 0);

CREATE TABLE IF NOT EXISTS quotation_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    quotation_revision INTEGER NOT NULL,
    client_id UUID REFERENCES clients(id),
    client_name VARCHAR(255),
    order_number INTEGER,
    signer_name VARCHAR(255) NOT NULL,
    signature_path VARCHAR(500) NOT NULL,
    signature_sha256 VARCHAR(64) NOT NULL,
    declaration_text TEXT NOT NULL,
    client_ip VARCHAR(100),
    user_agent TEXT,
    device_info TEXT,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT quotation_approvals_revision_positive CHECK (quotation_revision > 0),
    CONSTRAINT quotation_approvals_order_revision_unique UNIQUE (order_id, quotation_revision)
);

CREATE INDEX IF NOT EXISTS idx_quotation_approvals_order
    ON quotation_approvals(order_id, quotation_revision DESC);

CREATE OR REPLACE FUNCTION prevent_quotation_approval_modify()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'quotation_approvals is immutable — INSERT only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_update_quotation_approvals ON quotation_approvals;
CREATE TRIGGER prevent_update_quotation_approvals
    BEFORE UPDATE ON quotation_approvals
    FOR EACH ROW
    EXECUTE FUNCTION prevent_quotation_approval_modify();

DROP TRIGGER IF EXISTS prevent_delete_quotation_approvals ON quotation_approvals;
CREATE TRIGGER prevent_delete_quotation_approvals
    BEFORE DELETE ON quotation_approvals
    FOR EACH ROW
    EXECUTE FUNCTION prevent_quotation_approval_modify();
