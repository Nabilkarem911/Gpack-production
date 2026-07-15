-- =============================================================================
-- Migration: Add phone column to users table
-- Allows login with either email or phone number
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50) UNIQUE;

-- Make email nullable (phone can be used instead)
-- But keep at least one of email/phone required via application logic
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- Add constraint: at least email or phone must be present
ALTER TABLE users ADD CONSTRAINT users_email_or_phone_required
    CHECK (email IS NOT NULL OR phone IS NOT NULL);
