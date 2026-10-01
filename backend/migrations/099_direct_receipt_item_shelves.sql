-- 099 — Shelf allocations on direct-receipt (استلام مؤقت) items.
-- The keeper records a draft receipt; the manager links variants + picks the
-- warehouse at review time. Shelf splits are stored with each item at review
-- and applied exactly once when the receipt converts to a purchase invoice.
ALTER TABLE direct_receipt_items
    ADD COLUMN IF NOT EXISTS shelf_allocations JSONB NOT NULL DEFAULT '[]'::jsonb;
