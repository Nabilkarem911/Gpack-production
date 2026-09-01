-- Persist encrypted share tokens so management can re-open and copy links later.
ALTER TABLE design_requests
    ADD COLUMN IF NOT EXISTS client_token_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS designer_token_encrypted TEXT;
