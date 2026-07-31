-- Migration: 063_recurring_order_templates.sql
-- Phase 2.4: Recurring order templates — detect and store repeating order patterns

CREATE TABLE IF NOT EXISTS recurring_order_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    template_name VARCHAR(200) NOT NULL,
    items JSONB NOT NULL, -- [{ variant_id, quantity, unit_price }]
    interval_days INTEGER NOT NULL DEFAULT 30, -- expected reorder interval
    last_order_date TIMESTAMP, -- last time this pattern was ordered
    last_order_id UUID, -- reference to the last matching order
    occurrence_count INTEGER DEFAULT 1, -- how many times this pattern occurred
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_templates_client ON recurring_order_templates(client_id);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_active ON recurring_order_templates(is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE recurring_order_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS recurring_templates_all ON recurring_order_templates
    FOR ALL USING (true) WITH CHECK (true);
