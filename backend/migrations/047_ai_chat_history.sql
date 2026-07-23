-- =============================================================================
-- G.PACK 2.0 — Migration 047: AI Chat History
-- Stores conversation history between users and the AI assistant.
-- All columns are nullable/defaulted — zero impact on existing tables.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_chat_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(20)  NOT NULL,        -- 'user' | 'assistant'
    content         TEXT         NOT NULL,        -- message text
    function_name   VARCHAR(100),                 -- which function was called (null for plain text)
    function_args   JSONB,                        -- arguments passed to the function
    function_result JSONB,                        -- raw result returned by the function
    created_at      TIMESTAMPTZ  DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ai_chat_user_id    ON ai_chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_created    ON ai_chat_history(created_at DESC);
