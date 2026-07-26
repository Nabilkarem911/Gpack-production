-- =============================================================================
-- G.PACK 2.0 — Migration 060: Enterprise Hardening
-- Append-only audit + Approval manifest + WAHA health + Metrics
-- =============================================================================

-- ── 1. Append-only: workflow_history (no UPDATE, no DELETE) ────────────────
-- Revoke UPDATE and DELETE from all roles on workflow_history
-- Only super_admin can bypass via SECURITY DEFINER functions if needed
REVOKE UPDATE, DELETE ON workflow_history FROM PUBLIC;
REVOKE UPDATE, DELETE ON workflow_history FROM gpack_user;

-- Same for design_approvals — once written, never modified
REVOKE UPDATE, DELETE ON design_approvals FROM PUBLIC;
REVOKE UPDATE, DELETE ON design_approvals FROM gpack_user;

-- Same for design_activity_log — immutable audit trail
REVOKE UPDATE, DELETE ON design_activity_log FROM PUBLIC;
REVOKE UPDATE, DELETE ON design_activity_log FROM gpack_user;

-- ── 2. Approval Package Manifest ────────────────────────────────────────────
-- Store manifest JSON (file hashes, sizes, mime types) per approval
ALTER TABLE design_approvals ADD COLUMN IF NOT EXISTS package_manifest JSONB;

-- ── 3. WAHA Health Monitor ──────────────────────────────────────────────────
-- Track WAHA connectivity status over time
CREATE TABLE IF NOT EXISTS waha_health_log (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(20) NOT NULL,
    latency_ms      INTEGER,
    error           TEXT,
    checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waha_health_checked_at
    ON waha_health_log(checked_at DESC);

-- ── 4. Notification Metrics (materialized for dashboard) ────────────────────
-- Store hourly metrics snapshot for the dashboard
CREATE TABLE IF NOT EXISTS notification_metrics (
    id              SERIAL PRIMARY KEY,
    metric_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    metric_hour     SMALLINT NOT NULL DEFAULT EXTRACT(HOUR FROM NOW()),
    total_sent      INTEGER NOT NULL DEFAULT 0,
    total_failed    INTEGER NOT NULL DEFAULT 0,
    total_pending   INTEGER NOT NULL DEFAULT 0,
    total_retried   INTEGER NOT NULL DEFAULT 0,
    avg_send_time_ms INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (metric_date, metric_hour)
);

-- ── 5. Notification Templates ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_templates (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(100) NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    lang            VARCHAR(5) NOT NULL DEFAULT 'ar',
    subject         VARCHAR(500),
    body            TEXT NOT NULL,
    variables       JSONB DEFAULT '[]',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (code, version, lang)
);

-- Seed default templates
INSERT INTO notification_templates (code, version, lang, subject, body, variables)
VALUES
    ('design_approved_client', 1, 'ar',
     'اعتماد تصميم — {{certificate_number}}',
     'شكراً لكم.\n\nتم تسجيل اعتماد التصميم بنجاح.\n\nرقم الاعتماد\n{{certificate_number}}\n\nالمنتج\n{{product_name}}\n\nتاريخ الاعتماد\n{{approved_date}}\n\nيمكنكم التحقق من الاعتماد عبر\n{{verify_url}}',
     '["certificate_number","product_name","approved_date","verify_url"]')
ON CONFLICT (code, version, lang) DO NOTHING;

INSERT INTO notification_templates (code, version, lang, subject, body, variables)
VALUES
    ('design_approved_admin', 1, 'ar',
     'اعتماد تصميم — {{certificate_number}}',
     'تم اعتماد التصميم\n\nالعميل\n{{client_name}}\n\nالمنتج\n{{product_name}}\n\nالمعتمد\n{{signer_name}}\n\nوقت الاعتماد\n{{approved_time}}\n\nرقم الاعتماد\n{{certificate_number}}\n\nCorrelation ID\n{{correlation_id}}',
     '["certificate_number","client_name","product_name","signer_name","approved_time","correlation_id"]')
ON CONFLICT (code, version, lang) DO NOTHING;

INSERT INTO notification_templates (code, version, lang, subject, body, variables)
VALUES
    ('design_approved_designer', 1, 'ar',
     'تصميم معتمد — Offer #{{order_number}}',
     '🎉 تم اعتماد تصميمك\n\nOffer #{{order_number}}\nItem\n{{product_name}}\n\nالعميل اعتمد التصميم.\n\nCorrelation ID\n{{correlation_id}}',
     '["order_number","product_name","correlation_id"]')
ON CONFLICT (code, version, lang) DO NOTHING;

INSERT INTO notification_templates (code, version, lang, subject, body, variables)
VALUES
    ('design_sent_to_client', 1, 'ar',
     'مراجعة تصميم — Offer #{{order_number}}',
     'مرحباً {{client_name}}\n\nتم إرسال تصميم لمراجعتك.\nرقم العرض: #{{order_number}}\n\nيرجى مراجعة التصميم عبر الرابط التالي:\n{{share_url}}',
     '["client_name","order_number","share_url"]')
ON CONFLICT (code, version, lang) DO NOTHING;

-- ── 6. Index for notification_metrics queries ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notif_metrics_date
    ON notification_metrics(metric_date DESC, metric_hour DESC);
