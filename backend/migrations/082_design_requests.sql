-- G.PACK 2.0 — Independent design requests
-- A design request is created before quotation and product selection.

CREATE TABLE IF NOT EXISTS design_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_number BIGSERIAL UNIQUE NOT NULL,
    client_id UUID NOT NULL REFERENCES clients(id),
    designer_id UUID NOT NULL REFERENCES users(id),
    item_name VARCHAR(255) NOT NULL,
    item_size VARCHAR(255),
    brief TEXT,
    status VARCHAR(40) NOT NULL DEFAULT 'waiting_design'
        CHECK (status IN ('waiting_design', 'in_progress', 'designer_review', 'client_review', 'revision_requested', 'approved', 'completed', 'cancelled')),
    client_token_hash VARCHAR(255) UNIQUE NOT NULL,
    designer_token_hash VARCHAR(255) UNIQUE NOT NULL,
    client_token_expires_at TIMESTAMPTZ,
    designer_token_expires_at TIMESTAMPTZ,
    approved_version_id UUID,
    selected_product_id UUID,
    converted_quotation_id UUID,
    created_by UUID REFERENCES users(id),
    started_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS design_request_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES design_requests(id) ON DELETE CASCADE,
    sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('client', 'designer', 'manager', 'system')),
    sender_id UUID REFERENCES users(id),
    sender_name VARCHAR(255),
    message TEXT,
    attachment JSONB,
    is_internal BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (message IS NOT NULL OR attachment IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS design_request_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES design_requests(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    file JSONB NOT NULL,
    designer_notes TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'revision_requested', 'approved', 'superseded')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (request_id, version_number)
);

CREATE TABLE IF NOT EXISTS design_request_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES design_requests(id) ON DELETE CASCADE,
    version_id UUID REFERENCES design_request_versions(id),
    notes TEXT NOT NULL,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_requests_status ON design_requests(status);
CREATE INDEX IF NOT EXISTS idx_design_requests_client ON design_requests(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_design_requests_designer ON design_requests(designer_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_design_requests_client_token ON design_requests(client_token_hash);
CREATE INDEX IF NOT EXISTS idx_design_requests_designer_token ON design_requests(designer_token_hash);
CREATE INDEX IF NOT EXISTS idx_design_request_messages_request ON design_request_messages(request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_design_request_versions_request ON design_request_versions(request_id, version_number DESC);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'design_requests_approved_version_fk') THEN
        ALTER TABLE design_requests
            ADD CONSTRAINT design_requests_approved_version_fk
            FOREIGN KEY (approved_version_id) REFERENCES design_request_versions(id);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION design_requests_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_design_requests_updated_at ON design_requests;
CREATE TRIGGER trg_design_requests_updated_at
BEFORE UPDATE ON design_requests
FOR EACH ROW EXECUTE FUNCTION design_requests_set_updated_at();
