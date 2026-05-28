-- =============================================================================
-- Migration 014: Client Pantone Colors
-- Description: Stores brand/pantone color swatches per client
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_pantone_colors (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    color_code  VARCHAR(50)  NOT NULL,          -- e.g. "Pantone 185 C"
    color_name  VARCHAR(100),                   -- e.g. "أحمر العلامة التجارية"
    hex_value   VARCHAR(7),                     -- e.g. "#E03C31"
    notes       TEXT,
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pantone_client ON client_pantone_colors(client_id);
