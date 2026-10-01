'use strict';

// =============================================================================
// shelf-service unit tests — in-memory fake pg client.
// Simulates warehouse_stock / warehouse_shelves / stock_placements /
// shelf_allocations so the invariant  Σplacements ≤ stock.quantity  and the
// in/out ledger are exercised for real.
// =============================================================================

const shelfService = require('../../services/shelf-service');

const WH   = 'w0000000-0000-4000-8000-000000000001';
const STK  = 's1000000-0000-4000-8000-000000000001';
const STK2 = 's2000000-0000-4000-8000-000000000001';
const SH_A = 'a1000000-0000-4000-8000-000000000001';
const SH_B = 'b2000000-0000-4000-8000-000000000001';
const SH_C = 'c3000000-0000-4000-8000-000000000001';
const USER = 'u0000000-0000-4000-8000-000000000001';

function makeFakeDb(seed) {
    const state = {
        shelves: new Map(Object.entries(seed.shelves || {})),       // id -> {id, warehouse_id, code, status, occupancy_pct}
        stock:   new Map(Object.entries(seed.stock || {})),         // id -> {id, warehouse_id, quantity, reserved_qty}
        placements: new Map(),                                      // placementKey -> {id, shelf_id, stock_id, quantity}
        allocations: [],                                            // ledger rows
        _pid: 0,
    };
    const pkey = (shelfId, stockId) => `${shelfId}|${stockId}`;

    async function query(sql, params = []) {
        // ── shelf load ────────────────────────────────────────────
        if (/SELECT id, warehouse_id, code, status FROM warehouse_shelves WHERE id = \$1/.test(sql)) {
            const row = state.shelves.get(params[0]);
            return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
        }
        // ── stock lock (placeOnShelf) ─────────────────────────────
        if (/SELECT id, warehouse_id, quantity FROM warehouse_stock WHERE id = \$1 FOR UPDATE/.test(sql)) {
            const row = state.stock.get(params[0]);
            return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
        }
        // ── stock lock (deductFromStock) ──────────────────────────
        if (/SELECT quantity FROM warehouse_stock WHERE id = \$1 FOR UPDATE/.test(sql)) {
            const row = state.stock.get(params[0]);
            return { rowCount: row ? 1 : 0, rows: row ? [{ quantity: row.quantity }] : [] };
        }
        // ── placed sum ────────────────────────────────────────────
        if (/SUM\(quantity\), 0\) AS placed FROM stock_placements WHERE stock_id = \$1/.test(sql)) {
            let sum = 0;
            for (const p of state.placements.values()) if (p.stock_id === params[0]) sum += p.quantity;
            return { rowCount: 1, rows: [{ placed: sum }] };
        }
        // ── placement upsert (INSERT ... ON CONFLICT) ─────────────
        if (/INSERT INTO stock_placements/.test(sql)) {
            const [shelfId, stockId, qty, userId] = params;
            const key = pkey(shelfId, stockId);
            const ex = state.placements.get(key);
            if (ex) ex.quantity += qty;
            else state.placements.set(key, { id: 'p' + (++state._pid), shelf_id: shelfId, stock_id: stockId, quantity: qty, created_by: userId || null });
            return { rowCount: 1, rows: [] };
        }
        // ── occupancy set ─────────────────────────────────────────
        if (/UPDATE warehouse_shelves SET occupancy_pct = \$1/.test(sql)) {
            const s = state.shelves.get(params[1]);
            if (s) s.occupancy_pct = params[0];
            return { rowCount: s ? 1 : 0, rows: [] };
        }
        // ── occupancy auto-clear ──────────────────────────────────
        if (/SET occupancy_pct = NULL/.test(sql)) {
            const shelfId = params[0];
            const hasAny = [...state.placements.values()].some(p => p.shelf_id === shelfId);
            const s = state.shelves.get(shelfId);
            if (s && !hasAny) s.occupancy_pct = null;
            return { rowCount: 1, rows: [] };
        }
        // ── ledger insert ─────────────────────────────────────────
        if (/INSERT INTO shelf_allocations/.test(sql)) {
            const [shelfId, stockId, direction, quantity, refType, refId, auto, notes, userId] = params;
            state.allocations.push({ shelf_id: shelfId, stock_id: stockId, direction, quantity, reference_type: refType, reference_id: refId, auto, notes, created_by: userId });
            return { rowCount: 1, rows: [] };
        }
        // ── placement lookup (shelf+stock, join shelf code) ───────
        if (/FROM stock_placements sp\s+JOIN warehouse_shelves/.test(sql) && /sp\.shelf_id = \$1 AND sp\.stock_id = \$2/.test(sql)) {
            const p = state.placements.get(pkey(params[0], params[1]));
            if (!p) return { rowCount: 0, rows: [] };
            const shelf = state.shelves.get(p.shelf_id);
            return { rowCount: 1, rows: [{ id: p.id, quantity: p.quantity, shelf_code: shelf ? shelf.code : '?' }] };
        }
        // ── placements of one stock row (deductFromStock) ─────────
        if (/SELECT id, shelf_id, quantity FROM stock_placements\s+WHERE stock_id = \$1\s+ORDER BY quantity DESC/.test(sql)) {
            const rows = [...state.placements.values()].filter(p => p.stock_id === params[0])
                .sort((a, b) => b.quantity - a.quantity)
                .map(p => ({ id: p.id, shelf_id: p.shelf_id, quantity: p.quantity }));
            return { rowCount: rows.length, rows };
        }
        // ── placement delete/update ───────────────────────────────
        if (/DELETE FROM stock_placements WHERE id = \$1/.test(sql)) {
            for (const [k, p] of state.placements) if (p.id === params[0]) { state.placements.delete(k); return { rowCount: 1, rows: [] }; }
            return { rowCount: 0, rows: [] };
        }
        if (/UPDATE stock_placements SET quantity = \$1.*WHERE id = \$2/.test(sql)) {
            for (const p of state.placements.values()) if (p.id === params[1]) p.quantity = params[0];
            return { rowCount: 1, rows: [] };
        }
        // ── ledger select by reference ────────────────────────────
        if (/FROM shelf_allocations\s+WHERE reference_type = \$1 AND reference_id = \$2 AND direction = '(in|out)'/.test(sql)) {
            const dir = /direction = '(in|out)'/.exec(sql)[1];
            const rows = state.allocations.filter(a => a.reference_type === params[0] && a.reference_id === params[1] && a.direction === dir);
            return { rowCount: rows.length, rows };
        }
        // ── unassignedQty ─────────────────────────────────────────
        if (/AS unassigned\s+FROM warehouse_stock/.test(sql)) {
            const s = state.stock.get(params[0]);
            if (!s) return { rowCount: 0, rows: [] };
            let placed = 0;
            for (const p of state.placements.values()) if (p.stock_id === params[0]) placed += p.quantity;
            return { rowCount: 1, rows: [{ unassigned: s.quantity - placed }] };
        }
        throw new Error(`[fakeDb] unhandled SQL: ${sql}`);
    }

    return { client: { query }, state };
}

function seedBase() {
    return {
        shelves: {
            [SH_A]: { id: SH_A, warehouse_id: WH, code: 'A1-01', status: 'active', occupancy_pct: null },
            [SH_B]: { id: SH_B, warehouse_id: WH, code: 'A1-02', status: 'active', occupancy_pct: null },
            [SH_C]: { id: SH_C, warehouse_id: WH, code: 'B1-01', status: 'active', occupancy_pct: null },
        },
        stock: {
            [STK]:  { id: STK,  warehouse_id: WH, quantity: 100, reserved_qty: 0 },
            [STK2]: { id: STK2, warehouse_id: WH, quantity: 20,  reserved_qty: 0 },
        },
    };
}

const placedTotal = (state, stockId) =>
    [...state.placements.values()].filter(p => p.stock_id === stockId).reduce((s, p) => s + p.quantity, 0);

describe('shelf-service — placeOnShelf', () => {
    test('splits one stock row across multiple shelves, ledgered per allocation', async () => {
        const { client, state } = makeFakeDb(seedBase());
        await shelfService.placeOnShelf(client, { shelfId: SH_A, stockId: STK, quantity: 60, occupancyPct: 50, refType: 'mo_receipt', refId: 'r1', userId: USER });
        await shelfService.placeOnShelf(client, { shelfId: SH_B, stockId: STK, quantity: 40, refType: 'mo_receipt', refId: 'r1', userId: USER });

        expect(placedTotal(state, STK)).toBe(100);
        expect(state.shelves.get(SH_A).occupancy_pct).toBe(50);
        const ins = state.allocations.filter(a => a.direction === 'in' && a.reference_id === 'r1');
        expect(ins.map(a => [a.shelf_id, a.quantity]).sort()).toEqual([[SH_A, 60], [SH_B, 40]]);
    });

    test('multiple stock rows can share one shelf', async () => {
        const { client, state } = makeFakeDb(seedBase());
        await shelfService.placeOnShelf(client, { shelfId: SH_A, stockId: STK,  quantity: 10, refType: 'x', refId: 'a' });
        await shelfService.placeOnShelf(client, { shelfId: SH_A, stockId: STK2, quantity: 20, refType: 'x', refId: 'b' });
        const onShelf = [...state.placements.values()].filter(p => p.shelf_id === SH_A);
        expect(onShelf.length).toBe(2);
    });

    test('rejects allocation beyond the unassigned bucket', async () => {
        const { client } = makeFakeDb(seedBase());
        await shelfService.placeOnShelf(client, { shelfId: SH_A, stockId: STK, quantity: 80, refType: 'x', refId: 'a' });
        await expect(
            shelfService.placeOnShelf(client, { shelfId: SH_B, stockId: STK, quantity: 30, refType: 'x', refId: 'a' })
        ).rejects.toThrow(/غير الموزّع/);
    });

    test('rejects invalid occupancy percent and wrong-warehouse shelf', async () => {
        const { client } = makeFakeDb(seedBase());
        await expect(
            shelfService.placeOnShelf(client, { shelfId: SH_A, stockId: STK, quantity: 5, occupancyPct: 33, refType: 'x', refId: 'a' })
        ).rejects.toThrow(/25 أو 50 أو 75 أو 100/);
        const other = { ...seedBase() };
        other.shelves[SH_A] = { ...other.shelves[SH_A], warehouse_id: 'other-wh' };
        const db2 = makeFakeDb(other);
        await expect(
            shelfService.placeOnShelf(db2.client, { shelfId: SH_A, stockId: STK, quantity: 5, refType: 'x', refId: 'a' })
        ).rejects.toThrow(/نفس مستودع/);
    });
});

describe('shelf-service — deductFromStock (unassigned first, then auto-pick)', () => {
    test('deduction within unassigned touches no placement', async () => {
        const { client, state } = makeFakeDb(seedBase());
        await shelfService.placeOnShelf(client, { shelfId: SH_A, stockId: STK, quantity: 30, refType: 'x', refId: 'a' });
        const auto = await shelfService.deductFromStock(client, { stockId: STK, quantity: 50, refType: 'd', refId: 'd1' });
        expect(auto).toBe(0); // unassigned was 70
        expect(placedTotal(state, STK)).toBe(30);
    });

    test('overflow auto-picks placements largest-first and marks them auto', async () => {
        const { client, state } = makeFakeDb(seedBase());
        await shelfService.placeOnShelf(client, { shelfId: SH_A, stockId: STK, quantity: 40, refType: 'x', refId: 'a' });
        await shelfService.placeOnShelf(client, { shelfId: SH_B, stockId: STK, quantity: 50, refType: 'x', refId: 'a' });
        // stock=100, placed=90, unassigned=10. Deduct 35 → 10 unassigned + 25 auto.
        const auto = await shelfService.deductFromStock(client, { stockId: STK, quantity: 35, refType: 'd', refId: 'd1' });
        expect(auto).toBe(25);
        // Largest placement (B:50) picked first
        const b = [...state.placements.values()].find(p => p.shelf_id === SH_B);
        expect(b.quantity).toBe(25);
        const autoRows = state.allocations.filter(a => a.auto && a.direction === 'out');
        expect(autoRows.length).toBe(1);
        expect(autoRows[0].shelf_id).toBe(SH_B);
    });

    test('deduction bigger than the whole row fails loud, never clamps', async () => {
        const { client } = makeFakeDb(seedBase());
        await shelfService.placeOnShelf(client, { shelfId: SH_A, stockId: STK, quantity: 20, refType: 'x', refId: 'a' });
        await expect(
            shelfService.deductFromStock(client, { stockId: STK, quantity: 500, refType: 'd', refId: 'd1' })
        ).rejects.toThrow(/تتجاوز المتاح/);
    });
});

describe('shelf-service — pickFromShelf', () => {
    test('explicit pick removes placement and clears occupancy when emptied', async () => {
        const { client, state } = makeFakeDb(seedBase());
        await shelfService.placeOnShelf(client, { shelfId: SH_A, stockId: STK, quantity: 10, occupancyPct: 25, refType: 'x', refId: 'a' });
        await shelfService.pickFromShelf(client, { shelfId: SH_A, stockId: STK, quantity: 10, refType: 'd', refId: 'd1' });
        expect([...state.placements.values()].filter(p => p.shelf_id === SH_A).length).toBe(0);
        expect(state.shelves.get(SH_A).occupancy_pct).toBe(null);
    });

    test('pick beyond shelf balance throws, never silently clamps', async () => {
        const { client } = makeFakeDb(seedBase());
        await shelfService.placeOnShelf(client, { shelfId: SH_A, stockId: STK, quantity: 10, refType: 'x', refId: 'a' });
        await expect(
            shelfService.pickFromShelf(client, { shelfId: SH_A, stockId: STK, quantity: 11, refType: 'd', refId: 'd1' })
        ).rejects.toThrow(/غير كافية/);
    });
});

describe('shelf-service — reversal symmetry', () => {
    test('reversePlacements removes exactly the session allocations', async () => {
        const { client, state } = makeFakeDb(seedBase());
        await shelfService.placeOnShelf(client, { shelfId: SH_A, stockId: STK, quantity: 60, refType: 'mo_receipt', refId: 's1' });
        await shelfService.placeOnShelf(client, { shelfId: SH_B, stockId: STK, quantity: 20, refType: 'mo_receipt', refId: 's1' });
        // unrelated placement stays
        await shelfService.placeOnShelf(client, { shelfId: SH_C, stockId: STK, quantity: 5, refType: 'mo_receipt', refId: 's2' });

        await shelfService.reversePlacements(client, { refType: 'mo_receipt', refId: 's1', reverseRefType: 'mo_receipt_reversal' });
        expect(placedTotal(state, STK)).toBe(5); // only s2's remains
        const rev = state.allocations.filter(a => a.reference_type === 'mo_receipt_reversal');
        expect(rev.length).toBe(2);
    });

    test('reversePlacements blocks when part of a placement was consumed', async () => {
        const { client } = makeFakeDb(seedBase());
        await shelfService.placeOnShelf(client, { shelfId: SH_A, stockId: STK, quantity: 50, refType: 'mo_receipt', refId: 's1' });
        await shelfService.pickFromShelf(client, { shelfId: SH_A, stockId: STK, quantity: 10, refType: 'delivery_dispatch', refId: 'd1' });
        await expect(
            shelfService.reversePlacements(client, { refType: 'mo_receipt', refId: 's1', reverseRefType: 'rev' })
        ).rejects.toThrow(/لا يمكن التراجع/);
    });

    test('restorePicks re-creates placements and maps stock re-adds (incl. NULL shelf)', async () => {
        const { client, state } = makeFakeDb(seedBase());
        await shelfService.placeOnShelf(client, { shelfId: SH_A, stockId: STK, quantity: 30, refType: 'x', refId: 'a' });
        await shelfService.pickFromShelf(client, { shelfId: SH_A, stockId: STK, quantity: 12, refType: 'delivery_dispatch', refId: 'dn-item-1' });
        await shelfService.logUnassignedPick(client, { stockId: STK, quantity: 8, refType: 'delivery_dispatch', refId: 'dn-item-1' });

        const { count, stockAdds } = await shelfService.restorePicks(client, { refType: 'delivery_dispatch', refId: 'dn-item-1', reverseRefType: 'delivery_reversal' });
        expect(count).toBe(2);
        expect(stockAdds.get(STK)).toBe(20); // 12 shelf + 8 unassigned
        const a = [...state.placements.values()].find(p => p.shelf_id === SH_A);
        expect(a.quantity).toBe(30); // 18 remaining + 12 restored
    });
});

describe('shelf-service — moveStock', () => {
    test('assigns unassigned bucket onto a shelf', async () => {
        const { client, state } = makeFakeDb(seedBase());
        await shelfService.moveStock(client, { stockId: STK, fromShelfId: null, toShelfId: SH_B, quantity: 15, occupancyPct: 75 });
        const b = [...state.placements.values()].find(p => p.shelf_id === SH_B);
        expect(b.quantity).toBe(15);
        expect(state.shelves.get(SH_B).occupancy_pct).toBe(75);
        expect(await shelfService.unassignedQty(client, STK)).toBe(85);
    });

    test('moves between shelves', async () => {
        const { client, state } = makeFakeDb(seedBase());
        await shelfService.placeOnShelf(client, { shelfId: SH_A, stockId: STK, quantity: 20, refType: 'x', refId: 'a' });
        await shelfService.moveStock(client, { stockId: STK, fromShelfId: SH_A, toShelfId: SH_C, quantity: 8 });
        expect([...state.placements.values()].find(p => p.shelf_id === SH_A).quantity).toBe(12);
        expect([...state.placements.values()].find(p => p.shelf_id === SH_C).quantity).toBe(8);
    });
});
