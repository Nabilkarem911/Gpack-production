-- =============================================================================
-- G.PACK 2.0 — Migration 057: Notification Queue + Notification Center
-- DB-backed queue for async notifications (WhatsApp, Email, SMS, Push)
-- With exponential backoff retry and in-app notification center.
-- =============================================================================

-- ── notification_queue ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Targeting
    channel VARCHAR(20) NOT NULL DEFAULT 'whatsapp',  -- 'whatsapp', 'email', 'sms', 'push'
    recipient VARCHAR(255) NOT NULL,                   -- phone number, email, user id, etc.
    recipient_name VARCHAR(255),                        -- display name for logging
    recipient_role VARCHAR(50),                         -- 'client', 'designer', 'manager', 'admin'

    -- Content
    message_type VARCHAR(50) NOT NULL,                  -- 'design_approved_client', 'design_approved_admin', 'design_approved_designer', etc.
    subject VARCHAR(255),
    body TEXT,                                          -- message text (plain or formatted)
    attachments JSONB,                                  -- [{type, path, filename, caption}]

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending',      -- 'pending', 'processing', 'sent', 'failed', 'cancelled'
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    last_error TEXT,
    last_attempt_at TIMESTAMPTZ,

    -- Scheduling (exponential backoff)
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Context
    entity_type VARCHAR(50),                            -- 'order_item', 'order', etc.
    entity_id UUID,                                     -- item id, order id, etc.
    metadata JSONB,                                     -- extra context (certificate_number, etc.)

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notif_queue_status ON notification_queue(status);
CREATE INDEX IF NOT EXISTS idx_notif_queue_next_attempt ON notification_queue(next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_notif_queue_entity ON notification_queue(entity_type, entity_id);

-- ── notifications (in-app Notification Center) ──────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Target user in ERP
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,

    -- Broadcast (if user_id is NULL, show to all managers/admins)
    target_role VARCHAR(50),                            -- 'admin', 'manager', 'designer', 'all'

    -- Content
    category VARCHAR(50) NOT NULL,                      -- 'design', 'order', 'whatsapp', 'system', 'approval'
    icon VARCHAR(50) DEFAULT 'fa-bell',                 -- FontAwesome icon class
    title VARCHAR(255) NOT NULL,
    body TEXT,
    link VARCHAR(500),                                  -- SPA route to navigate to

    -- Status
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,

    -- Priority
    priority VARCHAR(10) DEFAULT 'normal',              -- 'low', 'normal', 'high', 'urgent'

    -- Context
    entity_type VARCHAR(50),
    entity_id UUID,
    metadata JSONB,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_target_role ON notifications(target_role);

-- ── Add phone column to clients if not exists (already in 000_init_schema but ensure) ──
-- clients.phone already exists from 000_init_schema.sql
-- users.phone already exists from 005_add_phone_to_users.sql
