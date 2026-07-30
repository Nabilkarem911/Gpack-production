-- 061_action_policies.sql
-- Action Policies — business rules enforced before AI executes any write action
-- Idempotent: uses CREATE TABLE IF NOT EXISTS

CREATE TABLE IF NOT EXISTS action_policies (
    id              SERIAL PRIMARY KEY,
    action_type     VARCHAR(50)  NOT NULL,          -- create_quote | create_client | create_production_order | etc.
    rule_name       VARCHAR(100) NOT NULL,           -- human-readable rule name
    rule_condition  TEXT         NOT NULL,           -- JS expression string, evaluated against { proposal, user, args }
    severity        VARCHAR(10)  NOT NULL DEFAULT 'block',  -- block | warn
    message         TEXT         NOT NULL,           -- Arabic message shown to user
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed default policies
INSERT INTO action_policies (action_type, rule_name, rule_condition, severity, message)
VALUES
    -- create_quote: prevent quote with total < 0
    ('create_quote', 'no_negative_total', 'proposal.summary.grand_total >= 0', 'block', 'لا يمكن إنشاء عرض سعر بإجمالي سالب.'),

    -- create_quote: warn if margin < 5%
    ('create_quote', 'low_margin_warning', 'proposal.summary.margin_pct >= 5', 'warn', 'هامش الربح أقل من 5% — يُنصح بمراجعة الأسعار.'),

    -- create_client: prevent duplicate phone
    ('create_client', 'phone_required', '!!(args.phone && args.phone.length >= 8)', 'block', 'رقم الهاتف مطلوب لإنشاء عميل (8 أرقام على الأقل).'),

    -- create_client: name required
    ('create_client', 'name_required', '!!(args.name && args.name.trim().length >= 2)', 'block', 'اسم العميل مطلوب (حرفين على الأقل).'),

    -- create_production_order: prevent empty items
    ('create_production_order', 'items_required', 'Array.isArray(args.items) && args.items.length > 0', 'block', 'لا يمكن إنشاء أمر إنتاج بدون أصناف.'),

    -- bulk_update_prices: prevent price increase > 50%
    ('bulk_update_prices', 'max_price_increase', 'Math.abs(args.adjustment_pct) <= 50', 'block', 'لا يمكن تغيير الأسعار بأكثر من 50% دفعة واحدة.'),

    -- add_payment: prevent negative payment
    ('add_payment', 'positive_amount', 'parseFloat(args.amount) > 0', 'block', 'مبلغ الدفعة يجب أن يكون أكبر من صفر.')

ON CONFLICT DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_action_policies_type   ON action_policies(action_type);
CREATE INDEX IF NOT EXISTS idx_action_policies_active ON action_policies(is_active) WHERE is_active = true;

-- DOWN: DROP TABLE IF EXISTS action_policies;
