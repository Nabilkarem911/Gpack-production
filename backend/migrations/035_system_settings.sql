-- Migration 035: Create system_settings table for configurable values
-- Move hardcoded VAT_RATE (0.15) into the database.
-- Idempotent: handles both fresh installs and upgrades from init.sql

-- Create table if it doesn't exist at all (fresh install without init.sql)
CREATE TABLE IF NOT EXISTS system_settings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key         VARCHAR(100) NOT NULL UNIQUE,
    value       TEXT,
    data_type   VARCHAR(20) DEFAULT 'string',
    description TEXT,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- If table was created by init.sql, ensure all columns exist
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS data_type VARCHAR(20) DEFAULT 'string';
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Insert default VAT rate (15%)
INSERT INTO system_settings (key, value, data_type, description)
VALUES ('vat_rate', '0.15', 'number', 'Default VAT rate (15%)')
ON CONFLICT (key) DO NOTHING;
