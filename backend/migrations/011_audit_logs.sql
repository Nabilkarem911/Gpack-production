-- =============================================================================
-- Migration 011: Audit Logs Table
-- Date: 2026-05-17
-- Description: Create audit logs table for tracking all system changes
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,        -- 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT'
    entity_type VARCHAR(50) NOT NULL,   -- 'order', 'invoice', 'client', 'product', etc.
    entity_id UUID,                     -- ID of the affected entity
    old_values JSONB,                   -- Previous state (for UPDATE/DELETE)
    new_values JSONB,                   -- New state (for CREATE/UPDATE)
    ip_address VARCHAR(45),             -- IPv4 or IPv6
    user_agent TEXT,                    -- Browser/client info
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- Add comments
COMMENT ON TABLE audit_logs IS 'System audit trail for all important actions';
COMMENT ON COLUMN audit_logs.action IS 'Type of action performed';
COMMENT ON COLUMN audit_logs.entity_type IS 'Type of entity affected';
COMMENT ON COLUMN audit_logs.entity_id IS 'ID of the affected entity';
COMMENT ON COLUMN audit_logs.old_values IS 'Previous state before change';
COMMENT ON COLUMN audit_logs.new_values IS 'New state after change';
