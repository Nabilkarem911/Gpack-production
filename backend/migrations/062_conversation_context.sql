-- 062_conversation_context.sql
-- Conversation Memory — persists context across chat sessions
-- Allows the AI to remember what was discussed, what entities were referenced,
-- and what actions were proposed/executed in previous turns.
-- Idempotent: uses CREATE TABLE IF NOT EXISTS

CREATE TABLE IF NOT EXISTS conversation_context (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id      VARCHAR(100) NOT NULL,           -- groups messages in one conversation
    role            VARCHAR(10)  NOT NULL,            -- 'user' | 'assistant' | 'system'
    content         TEXT         NOT NULL,            -- message text
    metadata        JSONB,                             -- { proposed_actions, referenced_entities, page_context }
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Indexes for fast retrieval
CREATE INDEX IF NOT EXISTS idx_conversation_context_user_session ON conversation_context(user_id, session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversation_context_user_recent   ON conversation_context(user_id, created_at DESC);

-- DOWN: DROP TABLE IF EXISTS conversation_context;
