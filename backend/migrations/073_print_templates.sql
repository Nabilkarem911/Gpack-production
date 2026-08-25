-- =============================================================================
-- Migration 073: Print template catalog
-- A print template groups all client designs for one product variant.
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS print_template_code_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS print_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id UUID NOT NULL UNIQUE REFERENCES product_variants(id) ON DELETE RESTRICT,
    template_code VARCHAR(20) NOT NULL UNIQUE DEFAULT (
        'PT-' || LPAD(nextval('print_template_code_seq')::text, 6, '0')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_print_templates_variant ON print_templates(variant_id);

-- Idempotent legacy backfill: one card per existing product variant used with a design.
INSERT INTO print_templates (variant_id)
SELECT DISTINCT oi.variant_id
FROM manufacturer_order_items moi
JOIN order_items oi ON oi.id = moi.order_item_id
WHERE moi.design_id IS NOT NULL
  AND oi.variant_id IS NOT NULL
ORDER BY oi.variant_id
ON CONFLICT (variant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION update_print_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS print_templates_updated_at ON print_templates;
CREATE TRIGGER print_templates_updated_at
    BEFORE UPDATE ON print_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_print_templates_updated_at();
