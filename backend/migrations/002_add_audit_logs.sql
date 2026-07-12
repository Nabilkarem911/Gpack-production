-- =============================================================================
-- G.PACK 2.0 — Audit Trail Migration
-- Creates audit_logs table to track all CUD operations (Create, Update, Delete)
-- on all major entities for security & compliance.
-- Idempotent: safe to re-run if table already exists (e.g. created by 011).
-- =============================================================================

DO $$
BEGIN
    -- Only create the table if it does not already exist.
    -- Migration 011 creates a more modern schema; if that already ran we skip.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'audit_logs'
    ) THEN

        CREATE TABLE audit_logs (
            id           SERIAL PRIMARY KEY,
            table_name   VARCHAR(100)  NOT NULL,
            record_id    INTEGER       NOT NULL,
            action       VARCHAR(20)   NOT NULL,
            old_data     JSONB,
            new_data     JSONB,
            user_id      INTEGER       REFERENCES users(id) ON DELETE SET NULL,
            user_name    VARCHAR(150),
            ip_address   VARCHAR(45),
            user_agent   TEXT,
            created_at   TIMESTAMPTZ   DEFAULT NOW()
        );

        CREATE INDEX idx_audit_logs_record
            ON audit_logs (table_name, record_id);

        CREATE INDEX idx_audit_logs_created_at
            ON audit_logs (created_at DESC);

        CREATE INDEX idx_audit_logs_user
            ON audit_logs (user_id);

        COMMENT ON TABLE audit_logs IS 'Tracks all CUD operations for security auditing and compliance';

    END IF;
END $$;