-- Purchase invoice additional expense lines (shipping, customs, etc.).
-- Each line is retained as an auditable invoice component and posted to the
-- configured operating expense account when the invoice is approved.
CREATE TABLE IF NOT EXISTS purchase_invoice_expenses (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
    label               VARCHAR(255) NOT NULL,
    amount              DECIMAL(15,2) NOT NULL CHECK (amount >= 0),
    account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pie_invoice_id
    ON purchase_invoice_expenses(purchase_invoice_id);

-- Default account used by the purchase-invoice UI for shipping/customs and
-- similar landed operating charges. Existing installations already seed 6100.
