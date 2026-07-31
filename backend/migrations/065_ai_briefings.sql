-- Migration: 065_ai_briefings.sql
-- Phase 8.1: Morning Briefing — auto-generated daily AI summary

CREATE TABLE IF NOT EXISTS ai_briefings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    briefing_date DATE NOT NULL DEFAULT CURRENT_DATE,
    summary TEXT NOT NULL,
    alerts JSONB NOT NULL DEFAULT '[]', -- array of alert objects
    stats JSONB NOT NULL DEFAULT '{}', -- key metrics snapshot
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_briefings_date ON ai_briefings(briefing_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_briefings_unread ON ai_briefings(is_read) WHERE is_read = false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_briefings_user_date ON ai_briefings(user_id, briefing_date);

-- Enable RLS
ALTER TABLE ai_briefings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_briefings_all ON ai_briefings;
CREATE POLICY ai_briefings_all ON ai_briefings
    FOR ALL USING (true) WITH CHECK (true);
