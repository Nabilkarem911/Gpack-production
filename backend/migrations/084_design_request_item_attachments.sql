-- Add per-item reference files after 083 may already have been applied.
-- Idempotent so it is safe on every deployment.
ALTER TABLE design_request_items
    ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
