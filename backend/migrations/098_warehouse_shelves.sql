-- =============================================================================
-- Migration 098: Warehouse Shelves (نظام الرفوف)
-- Physical shelf layer UNDER warehouse_stock.
--
--   warehouse_shelves   — shelf master data per warehouse (code like A1-01)
--   stock_placements    — how much of a warehouse_stock row sits on a shelf
--   shelf_allocations   — append-only ledger of every shelf in/out/move
--
-- Invariant (enforced in application transactions, never by trigger):
--   SUM(stock_placements.quantity per stock_id) <= warehouse_stock.quantity
-- The remainder is the "unassigned" bucket (مخزون غير موزّع على رفوف).
--
-- Shelf numbering:
--   Zones A–I : floors 1–4, shelves 01–08  → 9 × 4 × 8 = 288
--   Zone  J   : floors 1–4, shelves 01–04  → 4 × 4     = 16
--   Zone  K   : floors 1–4, shelves 01–05  → 4 × 5     = 20
--   Total per warehouse = 324 shelves.
-- =============================================================================

-- ── 1. Shelves master ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_shelves (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id         UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    code                 VARCHAR(20) NOT NULL,               -- e.g. 'A1-01'
    zone                 VARCHAR(2)  NOT NULL,               -- 'A' … 'K'
    floor                SMALLINT    NOT NULL,               -- 1..4
    slot                 SMALLINT    NOT NULL,               -- shelf number in floor
    occupancy_pct        SMALLINT    CHECK (occupancy_pct IN (25, 50, 75, 100)),
    occupancy_updated_at TIMESTAMP WITH TIME ZONE,
    status               VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | inactive
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (warehouse_id, code)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_shelves_wh_zone
    ON warehouse_shelves(warehouse_id, zone, floor, slot);

-- ── 2. Placements: stock row → shelf quantities ───────────────────────────────
CREATE TABLE IF NOT EXISTS stock_placements (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shelf_id   UUID NOT NULL REFERENCES warehouse_shelves(id) ON DELETE RESTRICT,
    stock_id   UUID NOT NULL REFERENCES warehouse_stock(id) ON DELETE CASCADE,
    quantity   DECIMAL(15,3) NOT NULL CHECK (quantity > 0),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (shelf_id, stock_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_placements_stock ON stock_placements(stock_id);

-- ── 3. Shelf allocations ledger (append-only) ─────────────────────────────────
-- direction 'in'  = qty placed onto the shelf
-- direction 'out' = qty picked/moved off the shelf
-- auto = true     → the row was system-generated (shelf-less deduction that had
--                   to consume placements), not an explicit keeper choice.
CREATE TABLE IF NOT EXISTS shelf_allocations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shelf_id       UUID REFERENCES warehouse_shelves(id) ON DELETE CASCADE,  -- NULL = unassigned-bucket movement
    stock_id       UUID NOT NULL REFERENCES warehouse_stock(id) ON DELETE CASCADE,
    direction      VARCHAR(5)  NOT NULL CHECK (direction IN ('in', 'out')),
    quantity       DECIMAL(15,3) NOT NULL CHECK (quantity > 0),
    reference_type VARCHAR(50) NOT NULL,
    reference_id   UUID,
    auto           BOOLEAN NOT NULL DEFAULT FALSE,
    notes          TEXT,
    created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shelf_allocations_ref
    ON shelf_allocations(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_shelf_allocations_shelf
    ON shelf_allocations(shelf_id, created_at);
CREATE INDEX IF NOT EXISTS idx_shelf_allocations_stock
    ON shelf_allocations(stock_id, created_at);

-- ── 4. order_items.reserved_stock_id — pin the stock row a release order ──────
--     reserved on, so dispatch can release the hold instead of leaking it.
ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS reserved_stock_id UUID REFERENCES warehouse_stock(id) ON DELETE SET NULL;

-- ── 5. receiving_voucher_items.warehouse_stock_id — exact row a voucher ───────
--     credited, so voiding the voucher deducts from that row only.
ALTER TABLE receiving_voucher_items
    ADD COLUMN IF NOT EXISTS warehouse_stock_id UUID REFERENCES warehouse_stock(id) ON DELETE SET NULL;

-- ── 6. Seed shelf codes for the main warehouse(s) ─────────────────────────────
-- Runs only for warehouses of type 'main' that have no shelves yet. Other
-- warehouses can be provisioned later via POST /api/inventory/warehouses/:id/shelves/provision.
INSERT INTO warehouse_shelves (warehouse_id, code, zone, floor, slot)
SELECT w.id,
       z.zone || f.floor || '-' || LPAD(s.slot::text, 2, '0'),
       z.zone, f.floor, s.slot
FROM warehouses w
CROSS JOIN (
        SELECT chr(ascii('A') + g) AS zone FROM generate_series(0, 8) g
        UNION ALL SELECT 'J' UNION ALL SELECT 'K'
) z
CROSS JOIN LATERAL (
    SELECT generate_series(1, 4) AS floor
) f
CROSS JOIN LATERAL (
    SELECT generate_series(1,
        CASE WHEN z.zone = 'J' THEN 4
             WHEN z.zone = 'K' THEN 5
             ELSE 8 END) AS slot
) s
WHERE w.warehouse_type = 'main'
  AND NOT EXISTS (SELECT 1 FROM warehouse_shelves ws WHERE ws.warehouse_id = w.id)
ON CONFLICT (warehouse_id, code) DO NOTHING;

-- =============================================================================
-- purchase_return_items.warehouse_id — optional warehouse scope recorded at
-- return creation so voiding can restore stock to the right warehouse
-- confidently when logged movements are unavailable.
-- =============================================================================
ALTER TABLE purchase_return_items
    ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
