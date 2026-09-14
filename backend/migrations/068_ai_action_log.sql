-- =============================================================================
-- G.PACK 2.0 — Migration 068: AI Action Log
-- Audit trail for AI-initiated write actions (create quote, add payment, etc).
-- All columns nullable/defaulted — zero impact on existing tables.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_action_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type     VARCHAR(50)  NOT NULL,          -- 'create_quote' | 'convert_quote' | 'add_payment' | 'create_production_order'
    proposal        JSONB        NOT NULL,          -- AI-proposed action parameters
    result          JSONB,                          -- execution result (null if not executed)
    status          VARCHAR(20)  NOT NULL DEFAULT 'proposed',  -- 'proposed' | 'confirmed' | 'executed' | 'failed' | 'rejected'
    error_message   TEXT,
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    executed_at     TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_action_log_user_id    ON ai_action_log(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_action_log_status     ON ai_action_log(status);
CREATE INDEX IF NOT EXISTS idx_ai_action_log_created    ON ai_action_log(created_at DESC);

DO $$
BEGIN
    IF to_regclass('public.ai_feedback') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conname = 'ai_feedback_action_id_fkey'
             AND conrelid = 'public.ai_feedback'::regclass
       ) THEN
        ALTER TABLE ai_feedback
            ADD CONSTRAINT ai_feedback_action_id_fkey
            FOREIGN KEY (action_id) REFERENCES ai_action_log(id) ON DELETE SET NULL;
    END IF;
END $$;
