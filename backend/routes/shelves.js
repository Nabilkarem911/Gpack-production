'use strict';

// =============================================================================
// G.PACK 2.0 — Warehouse Shelves Routes (mounted under /api/inventory)
//
//   GET    /shelves?warehouse_id=                shelf grid (zones → floors)
//   GET    /shelves/:id/contents                 what sits on one shelf
//   PATCH  /shelves/:id/occupancy                manual eye-estimate update
//   POST   /warehouses/:id/shelves/provision     generate the 324 shelf codes
//   POST   /placements/move                      move qty shelf↔shelf / unassigned→shelf
//   GET    /shelf-availability                   shelves holding a variant (dispatch picker)
//   GET    /placements?stock_id=                 placements + unassigned of a stock row
// =============================================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const authorize = require('../middleware/authorize');
const { shelfMove, shelfOccupancyUpdate, validateBody } = require('../utils/validators');
const shelfService = require('../services/shelf-service');

// Same view gate as inventory.js — warehouses/inventory/receiving/vmi_dispatch/production_orders
router.use((req, res, next) => {
    const perms = req.user && req.user.permissions;
    const role  = req.user && req.user.role;
    if (role === 'super_admin' || role === 'admin') return next();
    if (perms && perms.all_access === true) return next();
    const _hasView = (key) => perms && perms[key] && (perms[key].view === true || perms[key] === true || (Array.isArray(perms[key]) && perms[key].includes('view')));
    if (_hasView('inventory') || _hasView('warehouses') || _hasView('receiving') || _hasView('vmi_dispatch') || _hasView('production_orders')) return next();
    return res.status(403).json({ error: 'Forbidden: No view permission on inventory or warehouses.' });
});

const restrictEdit = authorize('inventory', 'edit');

// =============================================================================
// POST /warehouses/:id/shelves/provision
// Generate the 324 shelf records (A–I ×4×8, J ×4×4, K ×4×5) for a warehouse.
// Idempotent — safe to call again; existing shelves are left untouched.
// =============================================================================
router.post('/warehouses/:id/shelves/provision', restrictEdit, async (req, res) => {
    try {
        const { id } = req.params;
        const wh = await db.query(`SELECT id, name FROM warehouses WHERE id = $1`, [id]);
        if (wh.rowCount === 0) return res.status(404).json({ error: 'المستودع غير موجود.' });

        const result = await db.query(
            `INSERT INTO warehouse_shelves (warehouse_id, code, zone, floor, slot)
             SELECT $1,
                    z.zone || f.floor || '-' || LPAD(s.slot::text, 2, '0'),
                    z.zone, f.floor, s.slot
             FROM (
                    SELECT chr(ascii('A') + g) AS zone FROM generate_series(0, 8) g
                    UNION ALL SELECT 'J' UNION ALL SELECT 'K'
             ) z
             CROSS JOIN (SELECT generate_series(1, 4) AS floor) f
             CROSS JOIN LATERAL (
                    SELECT generate_series(1,
                        CASE WHEN z.zone = 'J' THEN 4
                             WHEN z.zone = 'K' THEN 5
                             ELSE 8 END) AS slot
             ) s
             ON CONFLICT (warehouse_id, code) DO NOTHING
             RETURNING id`,
            [id]
        );
        return res.status(201).json({
            data: { created: result.rowCount },
            message: result.rowCount > 0
                ? `تم إنشاء ${result.rowCount} رف للمستودع «${wh.rows[0].name}».`
                : 'الرفوف موجودة مسبقًا لهذا المستودع.',
        });
    } catch (err) {
        console.error('[Shelves] provision error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /shelves?warehouse_id=<uuid>
// Grid payload: all shelves of the warehouse with occupancy + item counts.
// Shape per row: {id, code, zone, floor, slot, status, occupancy_pct,
//                 occupancy_updated_at, items_count, total_qty}
// =============================================================================
router.get('/shelves', async (req, res) => {
    try {
        const { warehouse_id } = req.query;
        if (!warehouse_id) return res.status(400).json({ error: 'warehouse_id مطلوب.' });

        const shelvesSql =
            `SELECT ws.id, ws.code, ws.zone, ws.floor, ws.slot, ws.status,
                    ws.occupancy_pct, ws.occupancy_updated_at,
                    COUNT(sp.id)                       AS items_count,
                    COALESCE(SUM(sp.quantity), 0)      AS total_qty
             FROM warehouse_shelves ws
             LEFT JOIN stock_placements sp ON sp.shelf_id = ws.id
             WHERE ws.warehouse_id = $1
             GROUP BY ws.id
             ORDER BY ws.zone, ws.floor, ws.slot`;

        let result = await db.query(shelvesSql, [warehouse_id]);

        // Lazy-provision: migration 098 only seeds 'main' warehouses — any other
        // warehouse gets its 324 shelves on first read instead of staying empty.
        if (result.rowCount === 0) {
            await db.query(
                `INSERT INTO warehouse_shelves (warehouse_id, code, zone, floor, slot)
                 SELECT $1,
                        z.zone || f.floor || '-' || LPAD(s.slot::text, 2, '0'),
                        z.zone, f.floor, s.slot
                 FROM (
                        SELECT chr(ascii('A') + g) AS zone FROM generate_series(0, 8) g
                        UNION ALL SELECT 'J' UNION ALL SELECT 'K'
                 ) z
                 CROSS JOIN (SELECT generate_series(1, 4) AS floor) f
                 CROSS JOIN LATERAL (
                        SELECT generate_series(1,
                            CASE WHEN z.zone = 'J' THEN 4
                                 WHEN z.zone = 'K' THEN 5
                                 ELSE 8 END) AS slot
                 ) s
                 WHERE EXISTS (SELECT 1 FROM warehouses w WHERE w.id = $1)
                 ON CONFLICT (warehouse_id, code) DO NOTHING`,
                [warehouse_id]
            );
            result = await db.query(shelvesSql, [warehouse_id]);
        }

        // Stock rows in this warehouse with quantity not placed on any shelf —
        // the "غير موزّع" bucket, shown separately so nothing hides.
        const unassigned = await db.query(
            `SELECT ws.id AS stock_id, ws.variant_id, ws.client_id,
                    ws.quantity - COALESCE((
                        SELECT SUM(sp.quantity) FROM stock_placements sp WHERE sp.stock_id = ws.id
                    ), 0) AS unassigned_qty,
                    p.name AS product_name, pv.size_name, c.name AS client_name
             FROM warehouse_stock ws
             JOIN product_variants pv ON pv.id = ws.variant_id
             JOIN products p          ON p.id  = pv.product_id
             LEFT JOIN clients c      ON c.id  = ws.client_id
             WHERE ws.warehouse_id = $1
               AND ws.quantity - COALESCE((
                        SELECT SUM(sp.quantity) FROM stock_placements sp WHERE sp.stock_id = ws.id
                   ), 0) > 0
             ORDER BY p.name, pv.size_name`,
            [warehouse_id]
        );

        return res.json({ data: { shelves: result.rows, unassigned: unassigned.rows } });
    } catch (err) {
        console.error('[Shelves] GET /shelves error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /shelves/:id/contents
// What's physically on one shelf: product/variant/client/qty per placement.
// =============================================================================
router.get('/shelves/:id/contents', async (req, res) => {
    try {
        const { id } = req.params;
        const shelfRes = await db.query(
            `SELECT ws.id, ws.code, ws.zone, ws.floor, ws.slot, ws.warehouse_id,
                    ws.occupancy_pct, ws.occupancy_updated_at, ws.status, w.name AS warehouse_name
             FROM warehouse_shelves ws
             JOIN warehouses w ON w.id = ws.warehouse_id
             WHERE ws.id = $1`,
            [id]
        );
        if (shelfRes.rowCount === 0) return res.status(404).json({ error: 'الرف غير موجود.' });

        const items = await db.query(
            `SELECT sp.id AS placement_id, sp.stock_id, sp.quantity, sp.updated_at,
                    ws.variant_id, ws.client_id, ws.warehouse_id,
                    p.name AS product_name, pv.size_name, pv.sku AS variant_sku,
                    c.name AS client_name
             FROM stock_placements sp
             JOIN warehouse_stock ws   ON ws.id = sp.stock_id
             JOIN product_variants pv  ON pv.id = ws.variant_id
             JOIN products p           ON p.id  = pv.product_id
             LEFT JOIN clients c       ON c.id  = ws.client_id
             WHERE sp.shelf_id = $1
             ORDER BY p.name, pv.size_name`,
            [id]
        );

        return res.json({ data: { shelf: shelfRes.rows[0], items: items.rows } });
    } catch (err) {
        console.error('[Shelves] GET /shelves/:id/contents error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// PATCH /shelves/:id/occupancy  —  { occupancy_pct: 25|50|75|100|null }
// Manual eye-estimate. Null clears it (only meaningful on an empty shelf).
// =============================================================================
router.patch('/shelves/:id/occupancy', restrictEdit, validateBody(shelfOccupancyUpdate), async (req, res) => {
    try {
        const { id } = req.params;
        const pct = req.validatedBody.occupancy_pct;
        if (pct !== null && ![25, 50, 75, 100].includes(pct)) {
            return res.status(400).json({ error: 'نسبة الإشغال يجب أن تكون 25 أو 50 أو 75 أو 100.' });
        }
        const result = await db.query(
            `UPDATE warehouse_shelves
             SET occupancy_pct = $1, occupancy_updated_at = NOW()
             WHERE id = $2 RETURNING id, code, occupancy_pct`,
            [pct, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'الرف غير موجود.' });
        return res.json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Shelves] PATCH occupancy error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /placements/move
// { stock_id, from_shelf_id|null, to_shelf_id, quantity, occupancy_pct? }
// from_shelf_id = null → take from the unassigned bucket (غير موزّع).
// =============================================================================
router.post('/placements/move', restrictEdit, validateBody(shelfMove), async (req, res) => {
    try {
        const { stock_id, from_shelf_id, to_shelf_id, quantity, occupancy_pct } = req.validatedBody;
        if (from_shelf_id && from_shelf_id === to_shelf_id) {
            return res.status(400).json({ error: 'لا يمكن النقل إلى نفس الرف.' });
        }
        await db.withTransaction(async (client) => {
            await shelfService.moveStock(client, {
                stockId: stock_id,
                fromShelfId: from_shelf_id || null,
                toShelfId: to_shelf_id,
                quantity,
                userId: req.user?.id || null,
                occupancyPct: occupancy_pct ?? null,
            });
        });
        return res.json({ message: 'تم النقل بنجاح.' });
    } catch (err) {
        console.error('[Shelves] move error:', err.message);
        return res.status(err.statusCode || 400).json({ error: err.message || 'فشل النقل.' });
    }
});

// =============================================================================
// GET /shelf-availability?variant_id=&client_id=&warehouse_id=
// For the dispatch picker: which shelves hold this variant for this client
// (same client-scope rules as dispatch: own + parent + general stock),
// plus the unassigned remainder per stock row.
// =============================================================================
router.get('/shelf-availability', async (req, res) => {
    try {
        const { variant_id, client_id, warehouse_id } = req.query;
        if (!variant_id) return res.status(400).json({ error: 'variant_id مطلوب.' });

        const params = [variant_id];
        let whCond   = '';
        let clientCond = '';
        if (warehouse_id) { params.push(warehouse_id); whCond = `AND ws.warehouse_id = $${params.length}`; }
        if (client_id) {
            params.push(client_id);
            clientCond = `AND (
                ws.client_id = $${params.length}
                OR ws.client_id IS NULL
                OR ws.client_id IN (SELECT parent_id FROM clients WHERE id = $${params.length})
            )`;
        }

        // Placements (shelf → qty) per eligible stock row
        const placed = await db.query(
            `SELECT sp.shelf_id, sh.code AS shelf_code, sh.zone, sh.floor, sh.slot,
                    sh.occupancy_pct, sp.stock_id, sp.quantity,
                    w.name AS warehouse_name
             FROM stock_placements sp
             JOIN warehouse_shelves sh ON sh.id = sp.shelf_id AND sh.status = 'active'
             JOIN warehouse_stock ws   ON ws.id = sp.stock_id
             JOIN warehouses w         ON w.id  = ws.warehouse_id
             WHERE ws.variant_id = $1 ${whCond} ${clientCond}
             ORDER BY sh.code`,
            params
        );

        // Eligible stock rows → unassigned remainder per row
        const stocks = await db.query(
            `SELECT ws.id AS stock_id, ws.warehouse_id, w.name AS warehouse_name,
                    ws.quantity, ws.reserved_qty,
                    ws.quantity - COALESCE((
                        SELECT SUM(sp.quantity) FROM stock_placements sp WHERE sp.stock_id = ws.id
                    ), 0) AS unassigned_qty
             FROM warehouse_stock ws
             JOIN warehouses w ON w.id = ws.warehouse_id
             WHERE ws.variant_id = $1 ${whCond} ${clientCond}
             ORDER BY ws.quantity DESC`,
            params
        );

        return res.json({
            data: {
                placements: placed.rows,
                stocks:     stocks.rows,
            },
        });
    } catch (err) {
        console.error('[Shelves] GET /shelf-availability error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /placements?stock_id=<uuid>
// Placements of one stock row + its unassigned remainder (storage page detail).
// =============================================================================
router.get('/placements', async (req, res) => {
    try {
        const { stock_id } = req.query;
        if (!stock_id) return res.status(400).json({ error: 'stock_id مطلوب.' });

        const [placed, unassigned] = await Promise.all([
            db.query(
                `SELECT sp.id AS placement_id, sp.shelf_id, sh.code AS shelf_code,
                        sh.zone, sh.floor, sh.slot, sp.quantity, sp.updated_at
                 FROM stock_placements sp
                 JOIN warehouse_shelves sh ON sh.id = sp.shelf_id
                 WHERE sp.stock_id = $1
                 ORDER BY sh.code`,
                [stock_id]
            ),
            db.query(
                `SELECT ws.id, ws.quantity,
                        ws.quantity - COALESCE((
                            SELECT SUM(sp.quantity) FROM stock_placements sp WHERE sp.stock_id = ws.id
                        ), 0) AS unassigned_qty
                 FROM warehouse_stock ws WHERE ws.id = $1`,
                [stock_id]
            ),
        ]);

        return res.json({
            data: {
                placements:    placed.rows,
                unassigned_qty: unassigned.rowCount ? parseFloat(unassigned.rows[0].unassigned_qty) : 0,
            },
        });
    } catch (err) {
        console.error('[Shelves] GET /placements error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
