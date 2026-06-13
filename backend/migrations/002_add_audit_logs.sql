-- =============================================================================
-- G.PACK 2.0 — Audit Trail Migration
-- Creates audit_logs table to track all CUD operations (Create, Update, Delete)
-- on all major entities for security & compliance.
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id           SERIAL PRIMARY KEY,
    table_name   VARCHAR(100)  NOT NULL,   -- e.g. 'orders', 'invoices', 'clients'
    record_id    INTEGER       NOT NULL,   -- the PK of the affected record
    action       VARCHAR(20)   NOT NULL,   -- 'CREATE', 'UPDATE', 'DELETE'
    old_data     JSONB,                    -- previous state (NULL for CREATE)
    new_data     JSONB,                    -- new state (NULL for DELETE)
    user_id      INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    user_name    VARCHAR(150),             -- denormalized for quick lookup
    ip_address   VARCHAR(45),              -- client IP
    user_agent   TEXT,                     -- browser user-agent
    created_at   TIMESTAMPTZ   DEFAULT NOW()
);

-- Index for fast lookups by table + record
CREATE INDEX IF NOT EXISTS idx_audit_logs_record
    ON audit_logs (table_name, record_id);

-- Index for time-range queries (audit reports)
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON audit_logs (created_at DESC);

-- Index for user-based queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user
    ON audit_logs (user_id);

COMMENT ON TABLE audit_logs IS 'Tracks all CUD operations for security auditing and compliance';