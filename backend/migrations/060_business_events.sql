-- 060_business_events.sql
-- Business Event Bus — unified event log for all company activities
-- Idempotent: uses CREATE TABLE IF NOT EXISTS

CREATE TABLE IF NOT EXISTS business_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(50)  NOT NULL,
    entity_type     VARCHAR(30)  NOT NULL,  -- client | order | product | invoice | supplier | payment | delivery | production | task
    entity_id       UUID,                    -- FK to the related entity (nullable for system-wide events)
    entity_name     VARCHAR(255),            -- human-readable name for quick display
    severity        VARCHAR(10)  NOT NULL DEFAULT 'info',  -- info | warning | critical
    description     TEXT,
    metadata        JSONB,                   -- additional context (amounts, quantities, etc.)
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_business_events_type        ON business_events(event_type);
CREATE INDEX IF NOT EXISTS idx_business_events_entity      ON business_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_business_events_created_at  ON business_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_events_severity    ON business_events(severity);

-- DOWN: DROP TABLE IF EXISTS business_events;
