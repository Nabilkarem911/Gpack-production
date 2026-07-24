-- =============================================================================
-- Migration 050: Design Approvals + Activity Log
-- Stores electronic signature, IP, device info, approval PDF path.
-- Activity log is INSERT-only (immutable) for legal traceability.
-- =============================================================================

-- Table: design_approvals
-- One record per order (when client approves all items)
CREATE TABLE IF NOT EXISTS design_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id),
    client_name VARCHAR(255),
    order_number VARCHAR(50),

    -- Signature data
    signature_image TEXT,                    -- Base64 PNG of canvas signature
    signer_name VARCHAR(255),                -- Client typed name

    -- Technical metadata (legal proof)
    client_ip VARCHAR(100),
    user_agent TEXT,
    device_info TEXT,                        -- Parsed device summary
    approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Generated PDF
    approval_pdf_path VARCHAR(500),          -- /uploads/designs/{orderId}/approval.pdf

    -- WhatsApp notification
    whatsapp_message TEXT,                   -- The message that was pre-filled
    whatsapp_sent_at TIMESTAMPTZ,

    -- Revision tracking
    revision_count INT DEFAULT 0,            -- How many times client requested changes before final approval

    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(order_id)                         -- One approval per order
);

CREATE INDEX IF NOT EXISTS idx_design_approvals_order ON design_approvals(order_id);
CREATE INDEX IF NOT EXISTS idx_design_approvals_client ON design_approvals(client_id);

-- Table: design_activity_log
-- INSERT-ONLY (immutable) log of all design workflow events
CREATE TABLE IF NOT EXISTS design_activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,

    event_type VARCHAR(50) NOT NULL,         -- 'link_opened', 'design_viewed', 'approved', 'rejected', 'revision_requested', 'pdf_generated', 'whatsapp_opened', 'signature_captured'
    event_details TEXT,                      -- JSON string with extra context
    actor VARCHAR(50) NOT NULL,              -- 'client', 'designer', 'manager', 'system'

    -- Technical metadata for client actions
    client_ip VARCHAR(100),
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_activity_order ON design_activity_log(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_design_activity_event ON design_activity_log(event_type);

-- Prevent UPDATE and DELETE on activity log (immutable)
CREATE OR REPLACE FUNCTION prevent_activity_log_modify()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'design_activity_log is immutable — INSERT only';
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS prevent_update_design_activity_log ON design_activity_log;
CREATE TRIGGER prevent_update_design_activity_log
    BEFORE UPDATE ON design_activity_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_activity_log_modify();

DROP TRIGGER IF EXISTS prevent_delete_design_activity_log ON design_activity_log;
CREATE TRIGGER prevent_delete_design_activity_log
    BEFORE DELETE ON design_activity_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_activity_log_modify();
