-- =============================================================================
-- G.PACK 2.0 — Migration 075: Internal WhatsApp Notifications
-- Adds multi-session support and settings for internal operational alerts.
--
-- Backward compatibility:
--   - All new 'session' columns have DEFAULT 'default'.
--   - Existing rows get 'default' automatically.
--   - Feature flag defaults to false (internal alerts disabled until admin enables).
-- =============================================================================

-- 1. notification_queue: which WAHA session to use when sending
ALTER TABLE notification_queue
    ADD COLUMN IF NOT EXISTS session VARCHAR(50) NOT NULL DEFAULT 'default';

-- 2. notification_outbox: same session column for outbox events
ALTER TABLE notification_outbox
    ADD COLUMN IF NOT EXISTS session VARCHAR(50) NOT NULL DEFAULT 'default';

-- 3. notification_dead_queue: keep schema symmetry
ALTER TABLE notification_dead_queue
    ADD COLUMN IF NOT EXISTS session VARCHAR(50) NOT NULL DEFAULT 'default';

-- 4. Index on session for queue queries
CREATE INDEX IF NOT EXISTS idx_notif_queue_session
    ON notification_queue(session);

-- 5. Index on outbox session
CREATE INDEX IF NOT EXISTS idx_outbox_session
    ON notification_outbox(session);

-- 6. Default settings (disabled by default)
INSERT INTO notification_settings (key, value, description) VALUES
    ('internal_whatsapp_enabled', 'false', 'تفعيل الإشعارات الداخلية على رقم الإدارة'),
    ('manager_whatsapp_phone', 'null', 'رقم واتساب المدير لاستلام التنبيهات الداخلية'),
    ('warehouse_keeper_whatsapp_phone', 'null', 'رقم واتساب أمين المستودع لاستلام أوامر الفسح')
ON CONFLICT (key) DO NOTHING;
