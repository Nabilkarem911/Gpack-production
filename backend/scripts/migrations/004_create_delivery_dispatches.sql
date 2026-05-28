-- =============================================================================
-- 004_create_delivery_dispatches.sql
-- Each row = one actual partial delivery against a delivery note.
-- The original delivery_note is the "order to deliver".
-- Each dispatch is the real physical handover with its own number.
-- =============================================================================

CREATE TABLE IF NOT EXISTS delivery_note_dispatches (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_note_id  UUID NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
    dispatch_number   INTEGER NOT NULL,
    notes             TEXT,
    created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_dispatch_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_id     UUID NOT NULL REFERENCES delivery_note_dispatches(id) ON DELETE CASCADE,
    dn_item_id      UUID NOT NULL REFERENCES delivery_note_items(id) ON DELETE CASCADE,
    quantity        NUMERIC(15,3) NOT NULL CHECK (quantity > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_number_per_dn
    ON delivery_note_dispatches (delivery_note_id, dispatch_number);

CREATE INDEX IF NOT EXISTS idx_dispatch_items_dispatch
    ON delivery_dispatch_items (dispatch_id);
