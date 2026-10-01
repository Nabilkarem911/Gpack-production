'use strict';

// =============================================================================
// G.PACK 2.0 — Shelf Service (خدمة الرفوف)
// Transaction-aware helpers. The CALLER owns BEGIN/COMMIT/ROLLBACK —
// every function receives an already-connected pg client.
//
// Model:
//   warehouse_shelves  — master data (A1-01 … K4-05), occupancy_pct is a
//                        manual eye-estimate (25/50/75/100), auto-cleared when
//                        the shelf becomes empty, never auto-computed.
//   stock_placements   — live qty of a warehouse_stock row sitting on a shelf.
//   shelf_allocations  — append-only ledger (direction in/out, auto flag).
//
// Core invariant (enforced here inside the caller's transaction):
//   SUM(stock_placements.quantity for a stock_id) <= warehouse_stock.quantity
// Remainder = the "unassigned" bucket (غير موزّع) — always visible, assignable
// later via moveStockToShelf().
// =============================================================================

function shelfError(message, statusCode = 400) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

// ── Internal: write one ledger row ────────────────────────────────────────────
async function _ledger(client, { shelfId, stockId, direction, quantity, refType, refId, auto = false, notes = null, userId = null }) {
    await client.query(
        `INSERT INTO shelf_allocations
            (shelf_id, stock_id, direction, quantity, reference_type, reference_id, auto, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [shelfId, stockId, direction, quantity, refType, refId, auto, notes, userId]
    );
}

// ── Internal: if a shelf holds nothing, clear its eye-estimate ────────────────
async function _clearOccupancyIfEmpty(client, shelfId) {
    await client.query(
        `UPDATE warehouse_shelves
         SET occupancy_pct = NULL, occupancy_updated_at = NOW()
         WHERE id = $1
           AND NOT EXISTS (SELECT 1 FROM stock_placements sp WHERE sp.shelf_id = $1)`,
        [shelfId]
    );
}

// ── Internal: validate shelf exists, active, and load it ──────────────────────
async function _loadShelf(client, shelfId) {
    const r = await client.query(
        `SELECT id, warehouse_id, code, status FROM warehouse_shelves WHERE id = $1`,
        [shelfId]
    );
    if (r.rowCount === 0) throw shelfError(`الرف غير موجود.`, 404);
    if (r.rows[0].status !== 'active') throw shelfError(`الرف ${r.rows[0].code} غير نشط.`);
    return r.rows[0];
}

// =============================================================================
// placeOnShelf — add qty of a stock row onto a shelf.
// Locks the stock row, enforces the sum(placements) <= stock.quantity invariant.
// occupancyPct (optional): eye-estimate stored on the SHELF (not per item).
// =============================================================================
async function placeOnShelf(client, {
    shelfId, stockId, quantity,
    refType, refId = null, userId = null,
    occupancyPct = null, notes = null,
}) {
    const qty = parseFloat(quantity);
    if (!shelfId || !stockId || !(qty > 0)) {
        throw shelfError('بيانات تخصيص الرف غير مكتملة (shelf_id / stock_id / quantity).');
    }
    const shelf = await _loadShelf(client, shelfId);

    // Lock stock row + check the placement cap against real quantity.
    const stockRes = await client.query(
        `SELECT id, warehouse_id, quantity FROM warehouse_stock WHERE id = $1 FOR UPDATE`,
        [stockId]
    );
    if (stockRes.rowCount === 0) throw shelfError('سجل المخزون غير موجود.', 404);
    const stock = stockRes.rows[0];
    if (shelf.warehouse_id !== stock.warehouse_id) {
        throw shelfError(`الرف ${shelf.code} ليس في نفس مستودع سجل المخزون.`);
    }

    const placedRes = await client.query(
        `SELECT COALESCE(SUM(quantity), 0) AS placed FROM stock_placements WHERE stock_id = $1`,
        [stockId]
    );
    const unassigned = parseFloat(stock.quantity) - parseFloat(placedRes.rows[0].placed);
    if (qty - unassigned > 1e-9) {
        throw shelfError(`الكمية (${qty}) تتجاوز غير الموزّع من هذا الرصيد (${unassigned}).`);
    }

    await client.query(
        `INSERT INTO stock_placements (shelf_id, stock_id, quantity, created_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (shelf_id, stock_id)
         DO UPDATE SET quantity = stock_placements.quantity + EXCLUDED.quantity,
                       updated_at = NOW()`,
        [shelfId, stockId, qty, userId]
    );

    if (occupancyPct != null) {
        const pct = parseInt(occupancyPct, 10);
        if (![25, 50, 75, 100].includes(pct)) throw shelfError('نسبة الإشغال يجب أن تكون 25 أو 50 أو 75 أو 100.');
        await client.query(
            `UPDATE warehouse_shelves SET occupancy_pct = $1, occupancy_updated_at = NOW() WHERE id = $2`,
            [pct, shelfId]
        );
    }

    await _ledger(client, {
        shelfId, stockId, direction: 'in', quantity: qty,
        refType, refId, userId, notes,
    });
}

// =============================================================================
// pickFromShelf — remove qty of a stock row from a specific shelf.
// Throws if the shelf doesn't hold enough — never silently clamps.
// =============================================================================
async function pickFromShelf(client, {
    shelfId, stockId, quantity,
    refType, refId = null, userId = null,
    auto = false, notes = null,
}) {
    const qty = parseFloat(quantity);
    if (!shelfId || !stockId || !(qty > 0)) {
        throw shelfError('بيانات سحب الرف غير مكتملة (shelf_id / stock_id / quantity).');
    }

    const pRes = await client.query(
        `SELECT sp.id, sp.quantity, ws.code AS shelf_code
         FROM stock_placements sp
         JOIN warehouse_shelves ws ON ws.id = sp.shelf_id
         WHERE sp.shelf_id = $1 AND sp.stock_id = $2
         FOR UPDATE OF sp`,
        [shelfId, stockId]
    );
    if (pRes.rowCount === 0) {
        throw shelfError('لا يوجد رصيد لهذا الصنف على الرف المحدد.');
    }
    const placement = pRes.rows[0];
    if (parseFloat(placement.quantity) < qty - 1e-9) {
        throw shelfError(`الكمية على الرف ${placement.shelf_code} غير كافية — المتاح: ${placement.quantity}، المطلوب: ${qty}.`);
    }

    const remaining = parseFloat(placement.quantity) - qty;
    if (remaining <= 1e-9) {
        await client.query(`DELETE FROM stock_placements WHERE id = $1`, [placement.id]);
    } else {
        await client.query(
            `UPDATE stock_placements SET quantity = $1, updated_at = NOW() WHERE id = $2`,
            [remaining, placement.id]
        );
    }

    await _ledger(client, {
        shelfId, stockId, direction: 'out', quantity: qty,
        refType, refId, userId, auto, notes,
    });
    await _clearOccupancyIfEmpty(client, shelfId);
}

// =============================================================================
// deductFromStock — deduct qty from a warehouse_stock row keeping shelf
// placements consistent. Shelf-less deductions consume the UNASSIGNED bucket
// first, then auto-pick placements (largest first, marked auto=true) so the
// sum(placements) <= stock.quantity invariant can never be violated.
//
// Does NOT update warehouse_stock itself — the caller owns that update, because
// callers usually combine it with reserved_qty handling. Returns the number of
// units auto-picked from shelves.
// =============================================================================
async function deductFromStock(client, {
    stockId, quantity,
    refType, refId = null, userId = null,
    notes = null,
}) {
    const qty = parseFloat(quantity);
    if (!stockId || !(qty > 0)) return 0;

    // Lock the stock row FIRST, then read placements under that lock —
    // reading the placements sum before the lock lets a concurrent
    // placeOnShelf commit a new placement in between and breaks the
    // unassigned calculation (observed: placed 7 > qty 3).
    const stockRes = await client.query(
        `SELECT quantity FROM warehouse_stock WHERE id = $1 FOR UPDATE`,
        [stockId]
    );
    if (stockRes.rowCount === 0) throw shelfError('سجل المخزون غير موجود.', 404);
    const placedRes = await client.query(
        `SELECT COALESCE(SUM(quantity), 0) AS placed FROM stock_placements WHERE stock_id = $1`,
        [stockId]
    );

    const unassigned = parseFloat(stockRes.rows[0].quantity) - parseFloat(placedRes.rows[0].placed);
    let toPick = qty - unassigned;
    if (toPick <= 1e-9) return 0; // fully covered by the unassigned bucket

    // Auto-pick placements on this stock row, largest first.
    const pRes = await client.query(
        `SELECT id, shelf_id, quantity FROM stock_placements
         WHERE stock_id = $1
         ORDER BY quantity DESC
         FOR UPDATE`,
        [stockId]
    );
    let autoPicked = 0;
    for (const p of pRes.rows) {
        if (toPick <= 1e-9) break;
        const take = Math.min(toPick, parseFloat(p.quantity));
        await pickFromShelf(client, {
            shelfId: p.shelf_id, stockId, quantity: take,
            refType, refId, userId,
            auto: true,
            notes: notes || 'صرف بدون تحديد رف — استهلك من الرصيد الموزّع تلقائيًا',
        });
        autoPicked += take;
        toPick -= take;
    }
    if (toPick > 1e-9) {
        // Should be unreachable while the invariant holds — fail loud, never clamp.
        throw shelfError('تعارض في رصيد الرفوف — الكمية المطلوبة تتجاوز المتاح فعليًا.');
    }
    return autoPicked;
}

// =============================================================================
// moveStock — transfer qty of a stock row between shelves, or assign part of
// the unassigned bucket (fromShelfId = null) onto a shelf.
// =============================================================================
async function moveStock(client, {
    stockId, fromShelfId = null, toShelfId, quantity,
    userId = null, occupancyPct = null,
}) {
    const qty = parseFloat(quantity);
    if (!stockId || !toShelfId || !(qty > 0)) {
        throw shelfError('بيانات النقل غير مكتملة (stock_id / to_shelf_id / quantity).');
    }

    if (fromShelfId) {
        await pickFromShelf(client, {
            shelfId: fromShelfId, stockId, quantity: qty,
            refType: 'manual_move', refId: null, userId,
        });
    } else {
        // Source is the unassigned bucket — placeOnShelf enforces the cap.
    }

    await placeOnShelf(client, {
        shelfId: toShelfId, stockId, quantity: qty,
        refType: 'manual_move', refId: null, userId,
        occupancyPct,
    });
}

// =============================================================================
// unassignedQty — how much of a stock row is NOT on any shelf.
// =============================================================================
async function unassignedQty(client, stockId) {
    const r = await client.query(
        `SELECT ws.quantity - COALESCE((SELECT SUM(sp.quantity) FROM stock_placements sp WHERE sp.stock_id = ws.id), 0) AS unassigned
         FROM warehouse_stock ws WHERE ws.id = $1`,
        [stockId]
    );
    return r.rowCount ? Math.max(0, parseFloat(r.rows[0].unassigned)) : 0;
}

// =============================================================================
// reversePlacements — remove placements created by a reference (receipt reversal).
// Blocks if part of the placed qty was already picked (placement < allocated).
// =============================================================================
async function reversePlacements(client, { refType, refId, reverseRefType, userId = null }) {
    const allocs = await client.query(
        `SELECT id, shelf_id, stock_id, quantity
         FROM shelf_allocations
         WHERE reference_type = $1 AND reference_id = $2 AND direction = 'in'`,
        [refType, refId]
    );
    for (const a of allocs.rows) {
        const pRes = await client.query(
            `SELECT sp.id, sp.quantity, ws.code AS shelf_code
             FROM stock_placements sp JOIN warehouse_shelves ws ON ws.id = sp.shelf_id
             WHERE sp.shelf_id = $1 AND sp.stock_id = $2 FOR UPDATE OF sp`,
            [a.shelf_id, a.stock_id]
        );
        const have = pRes.rowCount ? parseFloat(pRes.rows[0].quantity) : 0;
        if (have < parseFloat(a.quantity) - 1e-9) {
            const code = pRes.rowCount ? pRes.rows[0].shelf_code : a.shelf_id;
            throw shelfError(`لا يمكن التراجع: كمية من الرف ${code} تم صرفها أو نقلها بالفعل.`, 409);
        }
        await pickFromShelf(client, {
            shelfId: a.shelf_id, stockId: a.stock_id, quantity: parseFloat(a.quantity),
            refType: reverseRefType, refId, userId,
        });
    }
    return allocs.rowCount;
}

// =============================================================================
// restorePicks — put back qty previously picked by a reference (delivery reversal).
// Re-creates the placement rows exactly where they were taken from.
// =============================================================================
async function restorePicks(client, { refType, refId, reverseRefType, userId = null }) {
    const allocs = await client.query(
        `SELECT id, shelf_id, stock_id, quantity
         FROM shelf_allocations
         WHERE reference_type = $1 AND reference_id = $2 AND direction = 'out'`,
        [refType, refId]
    );
    const stockAdds = new Map(); // stockId -> qty to re-add (covers NULL-shelf unassigned picks)
    for (const a of allocs.rows) {
        const qty = parseFloat(a.quantity);
        if (a.shelf_id) {
            await client.query(
                `INSERT INTO stock_placements (shelf_id, stock_id, quantity, created_by, updated_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (shelf_id, stock_id)
                 DO UPDATE SET quantity = stock_placements.quantity + EXCLUDED.quantity,
                               updated_at = NOW()`,
                [a.shelf_id, a.stock_id, qty, userId]
            );
        }
        stockAdds.set(a.stock_id, (stockAdds.get(a.stock_id) || 0) + qty);
        await _ledger(client, {
            shelfId: a.shelf_id, stockId: a.stock_id, direction: 'in',
            quantity: qty, refType: reverseRefType, refId, userId,
        });
    }
    return { count: allocs.rowCount, stockAdds };
}

// =============================================================================
// logUnassignedPick — ledger-only 'out' record (shelf_id NULL) for stock
// deducted from the unassigned bucket. Lets reversal flows re-add stock to the
// exact row that was consumed.
// =============================================================================
async function logUnassignedPick(client, { stockId, quantity, refType, refId = null, userId = null, notes = null }) {
    await _ledger(client, {
        shelfId: null, stockId, direction: 'out', quantity,
        refType, refId, userId, notes: notes || 'سحب من الرصيد غير الموزّع',
    });
}

module.exports = {
    placeOnShelf,
    pickFromShelf,
    deductFromStock,
    logUnassignedPick,
    moveStock,
    unassignedQty,
    reversePlacements,
    restorePicks,
    shelfError,
};
