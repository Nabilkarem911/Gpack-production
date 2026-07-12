-- Migration: create pos_terminals table for POS devices
CREATE TABLE IF NOT EXISTS pos_terminals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    code        VARCHAR(20)  NOT NULL UNIQUE,
    location    VARCHAR(200),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE pos_terminals IS 'Point-of-sale terminals / devices';

-- Insert default POS terminals
INSERT INTO pos_terminals (name, code, location, is_active) VALUES
    ('جهاز رئيسي - مكتب', 'POS_MAIN', 'المكتب الرئيسي', true),
    ('جهاز المستودع', 'POS_WH', 'المستودع', true)
ON CONFLICT (code) DO NOTHING;
