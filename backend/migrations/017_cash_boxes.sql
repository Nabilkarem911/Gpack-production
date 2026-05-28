-- Migration: create cash_boxes table for physical cash boxes / registers
CREATE TABLE IF NOT EXISTS cash_boxes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    code        VARCHAR(20)  NOT NULL UNIQUE,
    location    VARCHAR(200),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE cash_boxes IS 'Physical cash boxes / registers for cash payments';

-- Insert default cash boxes
INSERT INTO cash_boxes (name, code, location, is_active) VALUES
    ('الصندوق الرئيسي', 'MAIN', 'المكتب الرئيسي', true),
    ('صندوق فرع 1', 'BRANCH_1', 'الفرع الأول', true),
    ('صندوق فرع 2', 'BRANCH_2', 'الفرع الثاني', true)
ON CONFLICT (code) DO NOTHING;
