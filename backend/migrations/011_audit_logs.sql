-- =============================================================================
-- Migration 011: Audit Logs Table
-- Date: 2026-05-17
-- Description: Create audit logs table for tracking all system changes
-- Idempotent: handles both fresh installs and upgrades from 002 schema
-- =============================================================================

-- Create table if it doesn't exist at all (fresh install)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- If table was created by 002 (old schema), add missing columns
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_id UUID;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS old_values JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS new_values JSONB;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- Add comments (safe — wrapped in DO block to avoid errors on old schema)
DO $$
BEGIN
    COMMENT ON TABLE audit_logs IS 'System audit trail for all important actions';
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'action') THEN
        COMMENT ON COLUMN audit_logs.action IS 'Type of action performed';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'entity_type') THEN
        COMMENT ON COLUMN audit_logs.entity_type IS 'Type of entity affected';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'entity_id') THEN
        COMMENT ON COLUMN audit_logs.entity_id IS 'ID of the affected entity';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'old_values') THEN
        COMMENT ON COLUMN audit_logs.old_values IS 'Previous state before change';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'new_values') THEN
        COMMENT ON COLUMN audit_logs.new_values IS 'New state after change';
    END IF;
END $$;
