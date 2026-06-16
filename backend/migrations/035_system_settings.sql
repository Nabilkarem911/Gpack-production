-- Migration 035: Create system_settings table for configurable values
-- Move hardcoded VAT_RATE (0.15) into the database.

CREATE TABLE IF NOT EXISTS system_settings (
    id          SERIAL PRIMARY KEY,
    key         VARCHAR(100) NOT NULL UNIQUE,
    value       TEXT NOT NULL,
    type        VARCHAR(20) NOT NULL DEFAULT 'string', -- 'string', 'number', 'boolean', 'json'
    description TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default VAT rate (15%)
INSERT INTO system_settings (key, value, type, description)
VALUES ('vat_rate', '0.15', 'number', 'ضريبة القيمة المضافة (VAT) الافتراضية')
ON CONFLICT (key) DO NOTHING;
