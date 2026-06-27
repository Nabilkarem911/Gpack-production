'use strict';

const express = require('express');
const db = require('../db');
const authorize = require('../middleware/authorize');

const router = express.Router();

// All routes are protected by the authenticate middleware mounted in server.js.
// SCHEMA RULE: warehouse_stock is strictly tied to client_id (VMI / Franchise logic).
// Stock is NEVER fetched globally — always scoped by client unless the caller has all_access.

// View permission: all authenticated users with 'inventory' view can list/get
router.use(authorize('inventory', 'view'));

// Write permission: users with 'inventory' create/edit
const restrictWrite = authorize('inventory', 'create');
const restrictEdit  = authorize('inventory', 'edit');

// =============================================================================
// GET /api/inventory/warehouses
// Returns all warehouses.
// Query params:
//   ?client_id=<uuid>  — filter warehouses associated with a specific client
//   ?status=active|inactive
// =============================================================================

router.get('/warehouses', async (req, res) => {
    try {
        const { client_id, status } = req.query;

        const conditions = [];
        const params     = [];

        if (client_id) {
            params.push(client_id);
            conditions.push(`w.client_id = $${params.length}`);
        }

        if (status) {
            params.push(status);
            conditions.push(`w.status = $${params.length}`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const result = await db.query(
            `SELECT
                w.id,
                w.name,
                w.code,
                w.warehouse_type,
                w.address,
                w.client_id,
                c.name   AS client_name,
                w.status,
                w.created_at
             FROM warehouses w
             LEFT JOIN clients c ON c.id = w.client_id
             ${whereClause}
             ORDER BY w.name ASC`,
            params
        );

        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[Inventory] GET /warehouses error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/inventory/warehouses/:id
// Returns a single warehouse by ID.
// =============================================================================

router.get('/warehouses/:id', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT
                w.id,
                w.name,
                w.code,
                w.warehouse_type,
                w.address,
                w.client_id,
                c.name   AS client_name,
                w.status,
                w.created_at
             FROM warehouses w
             LEFT JOIN clients c ON c.id = w.client_id
             WHERE w.id = $1
             LIMIT 1`,
            [req.params.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'المستودع غير موجود.' });
        }

        return res.status(200).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Inventory] GET /warehouses/:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/inventory/warehouses
// Creates a new warehouse.
// =============================================================================

router.post('/warehouses', restrictWrite, async (req, res) => {
    const { name, location, client_id, status } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'اسم المستودع مطلوب.' });
    }

    try {
        const result = await db.query(
            `INSERT INTO warehouses (name, address, client_id, status)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [name.trim(), req.body.address || null, client_id || null, status || 'active']
        );

        return res.status(201).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Inventory] POST /warehouses error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// PUT /api/inventory/warehouses/:id
// Updates a warehouse.
// =============================================================================

router.put('/warehouses/:id', restrictEdit, async (req, res) => {
    const { name, location, client_id, status } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'اسم المستودع مطلوب.' });
    }

    try {
        const result = await db.query(
            `UPDATE warehouses SET
                name      = $1,
                address   = $2,
                client_id = $3,
                status    = $4
             WHERE id = $5
             RETURNING *`,
            [name.trim(), req.body.address || null, client_id || null, status || 'active', req.params.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'المستودع غير موجود.' });
        }

        return res.status(200).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Inventory] PUT /warehouses/:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/inventory/stock
// Returns warehouse_stock rows joined with product_variants, products, clients,
// and warehouses.
//
// FRANCHISE / VMI SCOPING RULES:
//   - ?client_id=<uuid>   REQUIRED unless user has all_access permission.
//     A sales_rep always sees only their own client's stock.
//     A super_admin / inventory_manager can pass any client_id or omit for all.
//   - ?warehouse_id=<uuid> — further filter by specific warehouse.
//   - ?product_id=<uuid>   — filter by product.
//   - ?low_stock=true      — return only rows where qty_on_hand <= min_stock_level.
// =============================================================================

router.get('/stock', async (req, res) => {
    try {
        const { client_id, warehouse_id, product_id, low_stock } = req.query;

        const isAllAccess = req.user.permissions && req.user.permissions.all_access === true;
        const isSalesRep  = req.user.role === 'sales_rep';
        const isAdmin     = ['admin', 'super_admin', 'manager', 'warehouse_keeper'].includes(req.user.role);

        // sales_rep must always be scoped to a client_id.
        // admin/manager/warehouse_keeper can view all stock without client_id.
        if (!isAllAccess && !isAdmin && !client_id) {
            return res.status(400).json({ error: 'client_id مطلوب لتحديد نطاق المخزون.' });
        }

        const conditions = [];
        const params     = [];

        if (client_id) {
            params.push(client_id);
            conditions.push(`ws.client_id = $${params.length}`);
        }

        if (warehouse_id) {
            params.push(warehouse_id);
            conditions.push(`ws.warehouse_id = $${params.length}`);
        }

        if (product_id) {
            params.push(product_id);
            conditions.push(`p.id = $${params.length}`);
        }

        if (low_stock === 'true') {
            conditions.push(`ws.quantity <= pv.min_stock_level`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const result = await db.query(
            `SELECT
                ws.id                       AS stock_id,
                ws.client_id,
                c.name                      AS client_name,
                c.parent_id                 AS client_parent_id,
                cp.name                     AS client_parent_name,
                ws.warehouse_id,
                w.name                      AS warehouse_name,
                w.address                   AS warehouse_address,
                ws.variant_id,
                pv.size_name                AS variant_size,
                pv.sku                      AS variant_sku,
                pv.selling_price,
                pv.cost_price,
                pv.min_stock_level,
                pv.max_stock_level,
                pv.unit_id,
                u.name                      AS unit_name,
                u.abbreviation              AS unit_abbreviation,
                p.id                        AS product_id,
                p.name                      AS product_name,
                p.category_id,
                cat.name                    AS category_name,
                ws.quantity                 AS qty_on_hand,
                ws.reserved_qty,
                (ws.quantity - ws.reserved_qty) AS available_qty,
                ws.last_updated             AS stock_updated_at
             FROM warehouse_stock ws
             INNER JOIN product_variants pv ON pv.id = ws.variant_id
             INNER JOIN products p           ON p.id  = pv.product_id
             LEFT  JOIN categories cat       ON cat.id = p.category_id
             LEFT  JOIN units u              ON u.id   = pv.unit_id
             INNER JOIN clients c            ON c.id   = ws.client_id
             LEFT  JOIN clients cp           ON cp.id  = c.parent_id
             INNER JOIN warehouses w         ON w.id   = ws.warehouse_id
             ${whereClause}
             ORDER BY p.name ASC, pv.size_name ASC
            `,
            params
        );

        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[Inventory] GET /stock error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/inventory/stock/:clientId/summary
// Returns a per-product stock summary for a given client.
// Useful for dashboard and quick overviews.
// =============================================================================

router.get('/stock/:clientId/summary', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT
                p.id                                    AS product_id,
                p.name                                  AS product_name,
                COUNT(DISTINCT ws.variant_id)           AS variant_count,
                SUM(ws.quantity)                        AS total_qty_on_hand,
                SUM(ws.quantity)                        AS total_qty_available,
                SUM(CASE WHEN ws.quantity <= pv.min_stock_level THEN 1 ELSE 0 END) AS low_stock_variants
             FROM warehouse_stock ws
             INNER JOIN product_variants pv ON pv.id = ws.variant_id
             INNER JOIN products p           ON p.id  = pv.product_id
             WHERE ws.client_id = $1
             GROUP BY p.id, p.name
             ORDER BY p.name ASC`,
            [req.params.clientId]
        );

        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[Inventory] GET /stock/:clientId/summary error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/inventory/stock/adjust
// Manual stock adjustment (add or subtract qty_on_hand for a specific record).
// Body: { stock_id, adjustment, reason }
//   adjustment: positive = add stock, negative = remove stock.
// This does NOT create a VMI production order — it is a direct correction.
// =============================================================================

router.post('/stock/adjust', restrictEdit, async (req, res) => {
    const { stock_id, adjustment, reason, items } = req.body;

    // Support both single adjustment and batch items
    if (items && Array.isArray(items) && items.length > 0) {
        // Batch adjustment from warehouses.js cart
        try {
            const results = [];
            
            for (const item of items) {
                const { warehouse_id, variant_id, quantity, adjustment_type } = item;
                
                if (!warehouse_id || !variant_id || !quantity) {
                    continue;
                }
                
                // Get client_id from warehouse (if warehouse is dedicated to a client)
                let effectiveClientId = item.client_id;
                if (!effectiveClientId) {
                    const whResult = await db.query(
                        `SELECT client_id FROM warehouses WHERE id = $1`,
                        [warehouse_id]
                    );
                    effectiveClientId = whResult.rows[0]?.client_id || '00000000-0000-0000-0000-000000000000'; // Default system client
                }
                
                // Check if stock record exists
                let stockResult = await db.query(
                    `SELECT id FROM warehouse_stock 
                     WHERE warehouse_id = $1 AND variant_id = $2 AND (client_id = $3 OR (client_id IS NULL AND $3 IS NULL))`,
                    [warehouse_id, variant_id, effectiveClientId]
                );
                
                let stockId;
                // Calculate actual quantity change (positive for increase, negative for decrease)
                const qtyChange = (adjustment_type === 'decrease') ? -quantity : quantity;
                
                if (stockResult.rowCount === 0) {
                    // Create new stock record - only use quantity column
                    // For new records, if it's a decrease, we can't go below 0
                    const initialQty = Math.max(0, qtyChange);
                    const insertResult = await db.query(
                        `INSERT INTO warehouse_stock (warehouse_id, variant_id, client_id, quantity, last_updated)
                         VALUES ($1, $2, $3, $4, NOW())
                         RETURNING id`,
                        [warehouse_id, variant_id, effectiveClientId, initialQty]
                    );
                    stockId = insertResult.rows[0].id;
                } else {
                    // Update existing stock
                    stockId = stockResult.rows[0].id;
                    await db.query(
                        `UPDATE warehouse_stock 
                         SET quantity = GREATEST(0, quantity + $1), last_updated = NOW()
                         WHERE id = $2`,
                        [qtyChange, stockId]
                    );
                }
                
                // Create inventory transaction record
                // For decrease adjustments, record as 'dispense' with positive quantity
                const transactionType = (adjustment_type === 'decrease') ? 'dispense' : 'receipt';
                await db.query(
                    `INSERT INTO inventory_transactions (stock_id, transaction_type, quantity, notes, created_by, created_at)
                     VALUES ($1, $2, $3, $4, $5, NOW())`,
                    [stockId, transactionType, quantity, reason || 'تسوية يدوية', req.user?.id]
                );
                
                results.push({ stock_id: stockId, quantity });
            }
            
            return res.status(200).json({ data: results, message: 'تمت التسوية بنجاح' });
        } catch (err) {
            console.error('[Inventory] POST /stock/adjust batch error:', err.message);
            return res.status(500).json({ error: 'فشل في حفظ التسوية: ' + err.message });
        }
    }

    // Single adjustment (original behavior)
    if (!stock_id) {
        return res.status(400).json({ error: 'stock_id مطلوب.' });
    }

    const qty = parseFloat(adjustment);
    if (isNaN(qty) || qty === 0) {
        return res.status(400).json({ error: 'يجب أن تكون كمية التعديل رقماً غير صفري.' });
    }

    try {
        const result = await db.query(
            `UPDATE warehouse_stock
             SET quantity = quantity + $1,
                 last_updated = NOW()
             WHERE id = $2
             RETURNING *`,
            [qty, stock_id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'سجل المخزون غير موجود.' });
        }

        if (result.rows[0].quantity < 0) {
            // Roll back — we never allow negative stock
            await db.query(
                `UPDATE warehouse_stock SET quantity = quantity - $1, last_updated = NOW() WHERE id = $2`,
                [qty, stock_id]
            );
            return res.status(400).json({ error: 'لا يمكن أن يكون المخزون سالباً.' });
        }

        // Create transaction record
        await db.query(
            `INSERT INTO inventory_transactions (stock_id, transaction_type, quantity, notes, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [stock_id, qty > 0 ? 'receipt' : 'dispense', Math.abs(qty), reason || 'تسوية', req.user?.id]
        );

        return res.status(200).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Inventory] POST /stock/adjust error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/inventory/transactions
// Get inventory transaction history
// =============================================================================

router.get('/transactions', async (req, res) => {
    try {
        const { type, from, to, warehouse_id, limit = 100 } = req.query;
        
        let query = `
            SELECT 
                it.id,
                it.transaction_type,
                it.quantity,
                it.notes,
                it.created_at,
                ws.warehouse_id,
                w.name AS warehouse_name,
                ws.client_id,
                c.name AS client_name,
                ws.variant_id,
                p.name AS product_name,
                pv.size_name AS variant_name
            FROM inventory_transactions it
            JOIN warehouse_stock ws ON ws.id = it.stock_id
            JOIN warehouses w ON w.id = ws.warehouse_id
            LEFT JOIN clients c ON c.id = ws.client_id
            LEFT JOIN product_variants pv ON pv.id = ws.variant_id
            LEFT JOIN products p ON p.id = pv.product_id
            WHERE 1=1
        `;
        
        const params = [];
        let paramIdx = 1;
        
        if (type) {
            query += ` AND it.transaction_type = $${paramIdx++}`;
            params.push(type);
        }
        
        if (warehouse_id) {
            query += ` AND ws.warehouse_id = $${paramIdx++}`;
            params.push(warehouse_id);
        }
        
        if (from) {
            query += ` AND it.created_at >= $${paramIdx++}`;
            params.push(from);
        }
        
        if (to) {
            query += ` AND it.created_at <= $${paramIdx++}`;
            params.push(to + 'T23:59:59');
        }
        
        query += ` ORDER BY it.created_at DESC LIMIT $${paramIdx++}`;
        params.push(parseInt(limit));
        
        const result = await db.query(query, params);
        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[Inventory] GET /transactions error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/inventory/client-analytics
// تحليل دوران المخزون per عميل — معدل صرف + أيام تغطية + مقارنة أشهر
// Query params:
//   ?client_id=<uuid>  (إلزامي)
//   ?from=YYYY-MM-DD   (افتراضي: آخر 90 يوم)
//   ?to=YYYY-MM-DD
// =============================================================================

router.get('/client-analytics', async (req, res) => {
    try {
        const { client_id, from, to } = req.query;

        if (!client_id) {
            return res.status(400).json({ error: 'client_id مطلوب.' });
        }

        const toDate   = to   ? `${to} 23:59:59`   : new Date().toISOString();
        const fromDate = from ? `${from} 00:00:00`  : new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();

        // ── 1. إجمالي صرف per صنف في الفترة ─────────────────────────────────
        const dispenseResult = await db.query(`
            SELECT
                p.name                          AS product_name,
                pv.size_name                    AS variant_name,
                pv.id                           AS variant_id,
                ws.warehouse_id,
                w.name                          AS warehouse_name,
                SUM(ABS(it.quantity))           AS total_dispensed,
                COUNT(DISTINCT it.id)           AS tx_count,
                MAX(it.created_at)              AS last_dispense_date,
                MIN(it.created_at)              AS first_dispense_date
            FROM inventory_transactions it
            JOIN warehouse_stock ws   ON ws.id = it.stock_id
            JOIN warehouses w         ON w.id  = ws.warehouse_id
            JOIN product_variants pv  ON pv.id = ws.variant_id
            JOIN products p           ON p.id  = pv.product_id
            WHERE it.transaction_type = 'dispense'
              AND ws.client_id        = $1
              AND it.created_at      >= $2
              AND it.created_at      <= $3
            GROUP BY p.name, pv.size_name, pv.id, ws.warehouse_id, w.name
            ORDER BY total_dispensed DESC
        `, [client_id, fromDate, toDate]);

        // ── 2. الرصيد الحالي per صنف لنفس العميل ────────────────────────────
        const stockResult = await db.query(`
            SELECT
                ws.variant_id,
                ws.warehouse_id,
                COALESCE(ws.quantity, 0) AS current_qty
            FROM warehouse_stock ws
            WHERE ws.client_id = $1
        `, [client_id]);

        const stockMap = {};
        stockResult.rows.forEach(r => {
            stockMap[`${r.variant_id}_${r.warehouse_id}`] = parseFloat(r.current_qty || 0);
        });

        // ── 3. مقارنة أشهر (آخر 6 أشهر per صنف) ─────────────────────────────
        const monthlyResult = await db.query(`
            SELECT
                p.name                              AS product_name,
                pv.size_name                        AS variant_name,
                TO_CHAR(it.created_at, 'YYYY-MM')  AS month,
                SUM(ABS(it.quantity))               AS dispensed_qty
            FROM inventory_transactions it
            JOIN warehouse_stock ws  ON ws.id = it.stock_id
            JOIN product_variants pv ON pv.id = ws.variant_id
            JOIN products p          ON p.id  = pv.product_id
            WHERE it.transaction_type = 'dispense'
              AND ws.client_id        = $1
              AND it.created_at      >= NOW() - INTERVAL '6 months'
            GROUP BY p.name, pv.size_name, TO_CHAR(it.created_at, 'YYYY-MM')
            ORDER BY month ASC
        `, [client_id]);

        // ── 4. احسب معدل يومي + أيام تغطية ──────────────────────────────────
        const periodDays = Math.max(1,
            (new Date(toDate) - new Date(fromDate)) / (1000 * 60 * 60 * 24)
        );

        const items = dispenseResult.rows.map(row => {
            const totalDispensed = parseFloat(row.total_dispensed || 0);
            const dailyRate      = totalDispensed / periodDays;
            const currentQty     = stockMap[`${row.variant_id}_${row.warehouse_id}`] || 0;
            const coverageDays   = dailyRate > 0 ? Math.round(currentQty / dailyRate) : null;

            return {
                product_name:       row.product_name,
                variant_name:       row.variant_name,
                warehouse_name:     row.warehouse_name,
                total_dispensed:    totalDispensed,
                tx_count:           parseInt(row.tx_count),
                daily_rate:         Math.round(dailyRate * 10) / 10,
                current_qty:        currentQty,
                coverage_days:      coverageDays,
                last_dispense_date: row.last_dispense_date,
                first_dispense_date: row.first_dispense_date
            };
        });

        // ── 5. بناء monthly breakdown ─────────────────────────────────────────
        const monthlyMap = {};
        monthlyResult.rows.forEach(r => {
            const key = `${r.product_name}||${r.variant_name}`;
            if (!monthlyMap[key]) monthlyMap[key] = {};
            monthlyMap[key][r.month] = parseFloat(r.dispensed_qty);
        });

        // قائمة الأشهر المتاحة
        const allMonths = [...new Set(monthlyResult.rows.map(r => r.month))].sort();

        return res.status(200).json({
            data: {
                items,
                monthly:     monthlyMap,
                months:      allMonths,
                period_days: Math.round(periodDays),
                from:        fromDate,
                to:          toDate
            }
        });

    } catch (err) {
        console.error('[Inventory] GET /client-analytics error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
