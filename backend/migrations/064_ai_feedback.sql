-- Migration: 064_ai_feedback.sql
-- Phase 24.1: Recommendation Feedback — 👍/👎 under each AI suggestion

CREATE TABLE IF NOT EXISTS ai_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id VARCHAR(100), -- reference to chat message ID
    action_id UUID,
    rating VARCHAR(10) NOT NULL CHECK (rating IN ('positive', 'negative')),
    reason TEXT, -- why the user disagreed (optional)
    function_name VARCHAR(100), -- which AI function generated the suggestion
    metadata JSONB, -- additional context
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_user ON ai_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_rating ON ai_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_function ON ai_feedback(function_name);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_created ON ai_feedback(created_at DESC);

DO $$
BEGIN
    IF to_regclass('public.ai_action_log') IS NOT NULL
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

-- Enable RLS
ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_feedback_all ON ai_feedback;
CREATE POLICY ai_feedback_all ON ai_feedback
    FOR ALL USING (true) WITH CHECK (true);
