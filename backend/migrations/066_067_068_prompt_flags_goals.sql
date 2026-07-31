-- Migration: 066_ai_prompt_versions.sql
-- Phase 28.1: Prompt Versioning — track SYSTEM_PROMPT changes and A/B test

CREATE TABLE IF NOT EXISTS ai_prompt_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version VARCHAR(20) NOT NULL UNIQUE,
    prompt_text TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT false,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Migration: 067_ai_feature_flags.sql
-- Phase 29.1: Feature Flags — toggle AI features on/off per environment

CREATE TABLE IF NOT EXISTS ai_feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_key VARCHAR(100) NOT NULL UNIQUE,
    flag_name TEXT NOT NULL,
    description TEXT,
    is_enabled BOOLEAN DEFAULT true,
    config JSONB DEFAULT '{}',
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Migration: 068_ai_goals.sql
-- Phase 23.1: Goal Engine — track business goals and progress

CREATE TABLE IF NOT EXISTS ai_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_type VARCHAR(50) NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    target_value NUMERIC NOT NULL,
    current_value NUMERIC DEFAULT 0,
    unit VARCHAR(20) DEFAULT 'ر.س',
    period VARCHAR(20) DEFAULT 'month',
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_goals_status ON ai_goals(status);
CREATE INDEX IF NOT EXISTS idx_ai_goals_dates ON ai_goals(start_date, end_date);

-- Enable RLS
ALTER TABLE ai_prompt_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_prompt_versions_all ON ai_prompt_versions;
CREATE POLICY ai_prompt_versions_all ON ai_prompt_versions
    FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE ai_feature_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_feature_flags_all ON ai_feature_flags;
CREATE POLICY ai_feature_flags_all ON ai_feature_flags
    FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE ai_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_goals_all ON ai_goals;
CREATE POLICY ai_goals_all ON ai_goals
    FOR ALL USING (true) WITH CHECK (true);

-- Seed default feature flags
INSERT INTO ai_feature_flags (flag_key, flag_name, description, is_enabled) VALUES
    ('ai_chat', 'المساعد الذكي', 'تفعيل/تعطيل المساعد الذكي', true),
    ('ai_propose_actions', 'اقتراح الإجراءات', 'السماح للـ AI باقتراح إجراءات كتابية', true),
    ('ai_batch_execute', 'التنفيذ الجماعي', 'تنفيذ عدة إجراءات دفعة واحدة', true),
    ('ai_briefing', 'الملخص اليومي', 'توليد ملخص يومي تلقائي', true),
    ('ai_feedback', 'تقييم الاقتراحات', 'أزرار 👍👎 تحت كل رد', true),
    ('ai_discount_decision', 'محرك القرارات', 'تقييم طلبات الخصم', true),
    ('ai_sandbox', 'بيئة المحاكاة', 'محاكاة الأثر المتوقع', true),
    ('ai_kpi_engine', 'مؤشرات الأداء', 'مراقبة KPIs', true),
    ('ai_root_cause', 'التحليل السببي', 'تحليل أسباب التغيرات', true),
    ('ai_recurring', 'القوالب المتكررة', 'كشف الأنماط المتكررة', true)
ON CONFLICT (flag_key) DO NOTHING;
