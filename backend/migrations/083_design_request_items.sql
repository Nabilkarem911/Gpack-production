-- Independent design requests may contain multiple real catalog items.
CREATE TABLE IF NOT EXISTS design_request_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES design_requests(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    product_name VARCHAR(255) NOT NULL,
    size_name VARCHAR(255),
    notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (request_id, variant_id)
);
CREATE INDEX IF NOT EXISTS idx_design_request_items_request ON design_request_items(request_id, sort_order);
