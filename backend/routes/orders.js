'use strict';

const express = require('express');
const db      = require('../db');
const { success, created, paginated } = require('../utils/response');
const { getVatRate } = require('../utils/settings');

const router = express.Router();

// All routes are protected by the authenticate middleware mounted in server.js.
// FINANCIAL RULE: subtotal, tax_amount (15%), and grand_total are calculated
// SERVER-SIDE only. Client payload values for these fields are IGNORED.


// =============================================================================
// GET /api/orders
// Returns orders list with client name and item count.
// Query params:
//   ?status=quote|confirmed|production|processing|completed|delivered|cancelled|archived
//   ?statuses=production,processing,completed  — comma-separated for multiple statuses
//   ?client_id=<uuid>
//   ?search=<string>  — matches order_number or client name
//   ?page=1&limit=20  — pagination (default: page=1, limit=50)
// DATA SCOPING:
//   sales_rep → only orders they created (created_by = req.user.id)
//   others    → all orders
// =============================================================================

router.get('/', async (req, res) => {
    try {
        const { status, statuses, client_id, search, page = 1, limit = 50 } = req.query;
        const isSalesRep = req.user.role === 'sales_rep';
        
        // Pagination
        const pageNum = parseInt(page) || 1;
        const limitNum = Math.min(parseInt(limit) || 50, 100); // Max 100 items per page
        const offset = (pageNum - 1) * limitNum;

        const conditions = [];
        const params     = [];

        if (isSalesRep) {
            params.push(req.user.id);
            conditions.push(`o.created_by = $${params.length}`);
        }

        if (statuses) {
            const statusList = statuses.split(',').map(s => s.trim()).filter(Boolean);
            if (statusList.length > 0) {
                const placeholders = statusList.map((_, i) => `$${params.length + i + 1}`).join(', ');
                params.push(...statusList);
                conditions.push(`o.status IN (${placeholders})`);
            }
        } else if (status) {
            params.push(status);
            conditions.push(`o.status = $${params.length}`);
        }

        if (client_id) {
            params.push(client_id);
            conditions.push(`o.client_id = $${params.length}`);
        }

        if (search) {
            params.push(`%${search}%`);
            const idx = params.length;
            conditions.push(
                `(c.name ILIKE $${idx} OR CAST(o.order_number AS TEXT) ILIKE $${idx})`
            );
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Add pagination parameters
        params.push(limitNum, offset);
        const limitParam = params.length - 1;
        const offsetParam = params.length;

        const result = await db.query(
            `SELECT
                o.id,
                o.order_number,
                o.status,
                o.client_id,
                c.name          AS client_name,
                o.order_date,
                o.valid_until,
                o.subtotal,
                o.tax_amount,
                o.grand_total,
                o.paid_amount,
                o.client_notes,
                o.internal_notes,
                o.created_by,
                o.created_at,
                o.updated_at,
                o.share_token,
                o.client_response,
                o.rejection_reason,
                o.responded_at,
                o.pricing_status,
                o.pricing_notes,
                COUNT(oi.id)::int AS item_count,
                COALESCE(SUM(oi.quantity), 0)::numeric AS total_order_qty,
                -- Receiving status aggregation
                COALESCE(mo_stats.mo_count, 0)::int AS mo_count,
                COALESCE(mo_stats.total_mo_qty, 0)::numeric AS total_mo_qty,
                COALESCE(mo_stats.total_received, 0)::numeric AS total_received,
                CASE
                    WHEN mo_stats.mo_count IS NULL OR mo_stats.mo_count = 0 THEN 'none'
                    WHEN mo_stats.total_received >= mo_stats.total_mo_qty THEN 'full'
                    WHEN mo_stats.total_received > 0 THEN 'partial'
                    ELSE 'ordered'
                END AS receive_status,
                COUNT(*) OVER() AS total_count
             FROM orders o
             LEFT JOIN clients c  ON c.id = o.client_id
             LEFT JOIN order_items oi ON oi.order_id = o.id
             LEFT JOIN (
                 SELECT
                     mo.order_id,
                     COUNT(DISTINCT mo.id)::int AS mo_count,
                     COALESCE(SUM(moi.mo_quantity), 0) AS total_mo_qty,
                     COALESCE(SUM(moi.received_qty), 0) AS total_received
                 FROM manufacturer_orders mo
                 LEFT JOIN manufacturer_order_items moi ON moi.manufacturer_order_id = mo.id
                 WHERE mo.status NOT IN ('cancelled')
                 GROUP BY mo.order_id
             ) mo_stats ON mo_stats.order_id = o.id
             ${whereClause}
             GROUP BY o.id, c.name, o.paid_amount, o.pricing_status, o.pricing_notes, mo_stats.mo_count, mo_stats.total_mo_qty, mo_stats.total_received
             ORDER BY o.created_at DESC
             LIMIT $${limitParam} OFFSET $${offsetParam}`,
            params
        );

        const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;
        const orders = result.rows.map(row => {
            const { total_count, ...order } = row;
            return order;
        });

        return paginated(res, orders, total, pageNum, limitNum);
    } catch (err) {
        console.error('[Orders] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/orders/lookup/cash-bank-accounts
// Returns asset accounts that can receive cash (Cash on Hand, Bank Accounts).
// MUST be defined BEFORE /:id to avoid Express matching 'lookup' as a UUID.
// =============================================================================

// =============================================================================
// GET /api/orders/lookup/cash-accounts
// Returns child accounts of '1100' (Cash on Hand) for cash payments.
// These are created in Chart of Accounts as sub-accounts under 1100.
// =============================================================================
router.get('/lookup/cash-accounts', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT a.id, a.code, a.name, a.location
             FROM accounts a
             JOIN accounts p ON p.id = a.parent_id
             WHERE p.code = '1100'
               AND a.is_active = true
             ORDER BY a.code`
        );
        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[Orders] GET /lookup/cash-accounts error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/orders/lookup/bank-accounts
// Returns child accounts of '1200' (Bank Accounts) for bank transfers.
// These are created in Chart of Accounts as sub-accounts under 1200.
// =============================================================================
router.get('/lookup/bank-accounts', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT a.id, a.code, a.name, a.location
             FROM accounts a
             JOIN accounts p ON p.id = a.parent_id
             WHERE p.code = '1200'
               AND a.is_active = true
             ORDER BY a.code`
        );
        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[Orders] GET /lookup/bank-accounts error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/orders/lookup/pos-terminals
// Returns active POS terminals.
// =============================================================================
router.get('/lookup/pos-terminals', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, code, name, location
             FROM pos_terminals
             WHERE is_active = true
             ORDER BY code`
        );
        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[Orders] GET /lookup/pos-terminals error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/orders/ready-for-invoice
// Returns orders ready for PREPAYMENT invoicing (invoice before delivery).
// Orders must be production/processing/completed and not yet have a final invoice.
// =============================================================================

router.get('/ready-for-invoice', async (req, res) => {
    try {
        const { client_id, search, limit = 50, offset = 0 } = req.query;

        let where = ['o.status IN (\'production\', \'processing\', \'completed\')'];
        const params = [];
        let paramIdx = 1;

        if (client_id) {
            where.push(`o.client_id = $${paramIdx++}`);
            params.push(client_id);
        }
        if (search) {
            where.push(`(o.order_number::text ILIKE $${paramIdx} OR c.name ILIKE $${paramIdx})`);
            params.push(`%${search}%`);
            paramIdx++;
        }

        const whereClause = where.join(' AND ');

        // Count - orders without final invoices (prepayment flow)
        const countRes = await db.query(`
            SELECT COUNT(DISTINCT o.id)::int AS total
            FROM orders o
            JOIN clients c ON c.id = o.client_id
            JOIN order_items oi ON oi.order_id = o.id
            WHERE ${whereClause}
              AND NOT EXISTS (
                  SELECT 1 FROM invoices inv WHERE inv.order_id = o.id AND inv.status = 'final'
              )
        `, params);

        // Data - show order quantities (not received quantities) for prepayment
        const dataRes = await db.query(`
            SELECT
                o.id, o.order_number, o.order_date, o.status, o.internal_notes, o.created_at,
                c.id AS client_id, c.name AS client_name,
                COUNT(oi.id) AS items_count,
                SUM(oi.quantity * oi.unit_price) AS estimated_total
            FROM orders o
            JOIN clients c ON c.id = o.client_id
            JOIN order_items oi ON oi.order_id = o.id
            WHERE ${whereClause}
              AND NOT EXISTS (
                  SELECT 1 FROM invoices inv WHERE inv.order_id = o.id AND inv.status = 'final'
              )
            GROUP BY o.id, o.order_number, o.order_date, o.status, o.internal_notes, o.created_at,
                     c.id, c.name
            ORDER BY o.order_number DESC
            LIMIT $${paramIdx++} OFFSET $${paramIdx++}
        `, [...params, parseInt(limit), parseInt(offset)]);

        res.json({
            data: dataRes.rows,
            total: countRes.rows[0].total,
            limit: parseInt(limit),
            offset: parseInt(offset),
        });

    } catch (err) {
        console.error('[Orders] GET /ready-for-invoice error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/orders/last-price
// Returns the most recent unit_price for a given client + variant combo.
// Query: ?client_id=X&variant_id=Y
// MUST be defined BEFORE /:id to avoid Express treating 'last-price' as a UUID.
// =============================================================================

router.get('/last-price', async (req, res) => {
    try {
        const { client_id, variant_id } = req.query;

        if (!client_id || !variant_id) {
            return res.status(400).json({ error: 'client_id and variant_id are required.' });
        }

        const result = await db.query(
            `SELECT oi.unit_price
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE o.client_id = $1
               AND oi.variant_id = $2
               AND o.status != 'cancelled'
             ORDER BY oi.created_at DESC
             LIMIT 1`,
            [client_id, variant_id]
        );

        const lastPrice = result.rowCount > 0 ? Number(result.rows[0].unit_price) : null;
        return res.status(200).json({ last_price: lastPrice });
    } catch (err) {
        console.error('[Orders] GET /last-price error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/orders/price-history
// Returns price history (orders with this client + variant) for popup display.
// Query: ?client_id=X&variant_id=Y
// =============================================================================

router.get('/price-history', async (req, res) => {
    try {
        const { client_id, variant_id } = req.query;

        if (!client_id || !variant_id) {
            return res.status(400).json({ error: 'client_id and variant_id are required.' });
        }

        const result = await db.query(
            `SELECT
                o.id,
                o.order_number,
                o.status,
                o.order_date,
                o.grand_total,
                o.pricing_notes,
                o.client_notes,
                oi.quantity,
                oi.unit_price,
                oi.line_total,
                (SELECT COUNT(*) FROM order_items oi2 WHERE oi2.order_id = o.id)::int as item_count,
                (SELECT COALESCE(SUM(oi3.quantity), 0) FROM order_items oi3 WHERE oi3.order_id = o.id)::numeric as total_qty
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE o.client_id = $1
               AND oi.variant_id = $2
               AND o.status != 'cancelled'
             ORDER BY o.order_date DESC, oi.created_at DESC
             LIMIT 10`,
            [client_id, variant_id]
        );

        return res.status(200).json({ history: result.rows });
    } catch (err) {
        console.error('[Orders] GET /price-history error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/orders/:id/details
// Returns full order details with items for popup display.
// =============================================================================

router.get('/:id/details', async (req, res) => {
    try {
        const { id } = req.params;
        const isSalesRep = req.user.role === 'sales_rep';

        // Get order header
        const orderResult = await db.query(
            `SELECT
                o.id,
                o.order_number,
                o.status,
                o.order_date,
                o.grand_total,
                o.client_id,
                o.created_by,
                c.name as client_name
             FROM orders o
             LEFT JOIN clients c ON c.id = o.client_id
             WHERE o.id = $1`,
            [id]
        );

        if (orderResult.rowCount === 0) {
            return res.status(404).json({ error: 'Order not found.' });
        }

        const order = orderResult.rows[0];
        if (isSalesRep && order.created_by !== req.user.id) {
            return res.status(403).json({ error: 'غير مصرح لك بعرض هذا الطلب.' });
        }

        // Get order items with product details
        const itemsResult = await db.query(
            `SELECT
                oi.id,
                oi.quantity,
                oi.unit_price,
                oi.line_total,
                oi.discount_percent,
                pv.size_name,
                p.name as product_name,
                p.sku as product_code
             FROM order_items oi
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
             LEFT JOIN products p ON p.id = pv.product_id
             WHERE oi.order_id = $1
             ORDER BY oi.created_at ASC`,
            [id]
        );

        return res.status(200).json({
            order: order,
            items: itemsResult.rows
        });
    } catch (err) {
        console.error('[Orders] GET /:id/details error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/orders/client-history/:clientId
// Returns recent orders/quotes for a specific client.
// =============================================================================

router.get('/client-history/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;

        const result = await db.query(
            `SELECT
                o.id,
                o.order_number,
                o.status,
                o.order_date,
                o.grand_total
             FROM orders o
             WHERE o.client_id = $1
             ORDER BY o.created_at DESC
             LIMIT 20`,
            [clientId]
        );

        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[Orders] GET /client-history/:clientId error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/orders/:id
// Returns a single order with all its items, product names, and variant details.
// DATA SCOPING: sales_rep can only view their own orders.
// =============================================================================

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const isSalesRep = req.user.role === 'sales_rep';

        const orderResult = await db.query(
            `SELECT
                o.id,
                o.order_number,
                o.status,
                o.client_id,
                c.name          AS client_name,
                o.order_date,
                o.valid_until,
                o.subtotal,
                o.tax_amount,
                o.grand_total,
                o.paid_amount,
                o.client_notes,
                o.internal_notes,
                o.terms_conditions,
                o.created_by,
                o.created_at,
                o.updated_at,
                o.share_token,
                o.token_expires_at,
                o.client_response,
                o.rejection_reason,
                o.deposit_receipt,
                o.responded_at,
                o.custom_terms,
                o.down_payment_required
             FROM orders o
             LEFT JOIN clients c ON c.id = o.client_id
             WHERE o.id = $1
             LIMIT 1`,
            [id]
        );

        if (orderResult.rowCount === 0) {
            return res.status(404).json({ error: 'الطلب غير موجود.' });
        }

        const order = orderResult.rows[0];

        if (isSalesRep && order.created_by !== req.user.id) {
            return res.status(403).json({ error: 'غير مصرح لك بعرض هذا الطلب.' });
        }

        const itemsResult = await db.query(
            `SELECT
                oi.id,
                oi.order_id,
                oi.variant_id,
                oi.variant_id      AS product_variant_id,
                pv.size_name,
                pv.size_name       AS variant_name,
                pv.sku             AS variant_sku,
                p.id               AS product_id,
                p.name             AS product_name,
                u.name             AS unit_name,
                u.abbreviation     AS unit_abbreviation,
                oi.quantity,
                oi.unit_price,
                oi.line_total,
                oi.manufacturer_po_qty,
                oi.wh_received_qty,
                oi.design_status,
                oi.design_id,
                cd.design_name     AS design_name,
                (SELECT file_path FROM client_design_files WHERE design_id = oi.design_id AND file_type = 'thumbnail' LIMIT 1) AS design_thumbnail,
                oi.notes
             FROM order_items oi
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
             LEFT JOIN products p          ON p.id  = pv.product_id
             LEFT JOIN units u             ON u.id  = pv.unit_id
             LEFT JOIN client_designs cd   ON cd.id = oi.design_id
             WHERE oi.order_id = $1
             ORDER BY oi.id ASC`,
            [id]
        );

        order.items = itemsResult.rows;

        return res.status(200).json({ data: order });
    } catch (err) {
        console.error('[Orders] GET /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/orders
// Creates a new order + its items in a single atomic transaction.
// FINANCIAL RULE: subtotal / tax_amount / grand_total calculated server-side.
// Body:
//   {
//     client_id, status, order_date, valid_until, notes, internal_notes,
//     items: [{ product_variant_id, quantity, unit_price, notes }]
//   }
// =============================================================================

router.post('/', async (req, res) => {
    const {
        client_id,
        status,
        order_date,
        valid_until,
        client_notes,
        internal_notes,
        terms_conditions,
        custom_terms,
        down_payment_required,
        items,
    } = req.body;

    if (!client_id) {
        return res.status(400).json({ error: 'العميل مطلوب.' });
    }

    const vatRate = await getVatRate();

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'يجب إضافة صنف واحد على الأقل.' });
    }

    // Validate each item
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.product_variant_id) {
            return res.status(400).json({ error: `الصف ${i + 1}: يجب اختيار متغير المنتج.` });
        }
        const qty = parseFloat(item.quantity);
        if (!qty || qty <= 0) {
            return res.status(400).json({ error: `الصف ${i + 1}: الكمية يجب أن تكون أكبر من صفر.` });
        }
        const price = parseFloat(item.unit_price);
        if (price < 0 || isNaN(price)) {
            return res.status(400).json({ error: `الصف ${i + 1}: السعر غير صالح.` });
        }
    }

    try {
        // Sales rep can only create orders for their own clients
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep) {
            const clientCheck = await db.query(
                'SELECT id, created_by FROM clients WHERE id = $1 LIMIT 1',
                [client_id]
            );
            if (clientCheck.rowCount === 0) {
                throw new Error('العميل المحدد غير موجود.');
            }
            if (clientCheck.rows[0].created_by !== req.user.id) {
                throw new Error('غير مصرح لك بإنشاء طلب لهذا العميل.');
            }
        }

        const result = await db.withTransaction(async (client) => {

            // Verify client exists
            const clientCheck = await client.query(
                'SELECT id FROM clients WHERE id = $1 LIMIT 1',
                [client_id]
            );
            if (clientCheck.rowCount === 0) {
                throw new Error('العميل المحدد غير موجود.');
            }

            // ── Determine order type: VMI (production) vs Commercial ──────────
            // VMI orders (status = 'production') MUST NOT have financial fields.
            // VMI rule: only insert client_id, status, order_number, internal_notes.
            const isVmiOrder = (status === 'production');

            // ── Calculate totals server-side (Commercial only) ────────────────
            let subtotal    = null;
            let tax_amount  = null;
            let grand_total = null;
            let processedItems;

            if (isVmiOrder) {
                // VMI: Store items without prices (financial fields stay NULL)
                processedItems = items.map(item => {
                    const qty = parseFloat(item.quantity);
                    return { ...item, qty, price: 0, lineTotal: 0 };
                });
            } else {
                // Commercial: Calculate financial totals
                subtotal = 0;
                processedItems = items.map(item => {
                    const qty      = parseFloat(item.quantity);
                    const price    = parseFloat(item.unit_price) || 0;
                    const lineTotal = Math.round(qty * price * 100) / 100;
                    subtotal += lineTotal;
                    return { ...item, qty, price, lineTotal };
                });
                subtotal            = Math.round(subtotal * 100) / 100;
                tax_amount          = Math.round(subtotal * vatRate * 100) / 100;
                grand_total         = Math.round((subtotal + tax_amount) * 100) / 100;
            }

            // ── Insert order ──────────────────────────────────────────────────
            const termsJson = Array.isArray(terms_conditions) ? JSON.stringify(terms_conditions) : '[]';

            const customTermsJson = custom_terms ? JSON.stringify(custom_terms) : null;

            const downPaymentAmount = down_payment_required ? parseFloat(down_payment_required) : null;

            const orderInsert = await client.query(
                `INSERT INTO orders
                    (client_id, status, pricing_status, order_date, valid_until,
                     subtotal, tax_amount, grand_total,
                     client_notes, internal_notes, terms_conditions, custom_terms, down_payment_required, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14)
                 RETURNING *`,
                [
                    client_id,
                    status || 'quote',
                    req.body.pricing_status || (isVmiOrder ? null : 'priced'),
                    order_date || new Date().toISOString().split('T')[0],
                    valid_until || null,
                    subtotal,    // NULL for VMI
                    tax_amount,  // NULL for VMI
                    grand_total, // NULL for VMI
                    client_notes   || null,
                    internal_notes || null,
                    termsJson,
                    customTermsJson,
                    isVmiOrder ? null : downPaymentAmount,
                    req.user.id,
                ]
            );

            const order = orderInsert.rows[0];
            order.items = [];

            // ── Insert order items ────────────────────────────────────────────
            // NOTE: line_total is a GENERATED column — never inserted manually.
            for (const item of processedItems) {
                const itemInsert = await client.query(
                    `INSERT INTO order_items
                        (order_id, variant_id, quantity, unit_price, design_status, design_id, notes)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     RETURNING *`,
                    [
                        order.id,
                        item.product_variant_id,
                        item.qty,
                        item.price,
                        item.design_status || 'new',
                        item.design_id || null,
                        item.notes || null,
                    ]
                );
                order.items.push(itemInsert.rows[0]);
            }

            return order;
        });

        return res.status(201).json({ data: result });
    } catch (err) {
        console.error('[Orders] POST / error:', err.message);
        if (err.code === '23503') {
            return res.status(400).json({ error: 'أحد المنتجات أو البيانات المرجعية غير موجودة.' });
        }
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

// =============================================================================
// PUT /api/orders/:id
// Updates an order's header fields and recalculates totals.
// Only allowed if status = 'quote'. Confirmed/delivered orders are immutable.
// DATA SCOPING: sales_rep can only edit their own orders.
// =============================================================================

router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const {
        client_id,
        status,
        order_date,
        valid_until,
        client_notes,
        internal_notes,
        terms_conditions,
        custom_terms,
        down_payment_required,
        items,
    } = req.body;

    const vatRate = await getVatRate();

    try {
        const existing = await db.query(
            'SELECT id, status, created_by FROM orders WHERE id = $1 LIMIT 1',
            [id]
        );
        if (existing.rowCount === 0) {
            return res.status(404).json({ error: 'الطلب غير موجود.' });
        }

        const order      = existing.rows[0];
        const isSalesRep = req.user.role === 'sales_rep';

        if (isSalesRep && order.created_by !== req.user.id) {
            return res.status(403).json({ error: 'غير مصرح لك بتعديل هذا الطلب.' });
        }

        if (!['quote'].includes(order.status)) {
            return res.status(400).json({ error: 'لا يمكن تعديل طلب تم تأكيده أو إغلاقه.' });
        }

        if (!client_id) {
            return res.status(400).json({ error: 'العميل مطلوب.' });
        }

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'يجب إضافة صنف واحد على الأقل.' });
        }

        const result = await db.withTransaction(async (client) => {

            // ── Determine if this is a VMI order (existing order is 'production') ──
            // If the order is already in production status, it's a VMI order
            // and financial fields (subtotal, tax_amount, grand_total) must remain NULL.
            const isVmiOrder = (order.status === 'production' || status === 'production');

            // ── Recalculate totals (Commercial only) ─────────────────────────
            let subtotal    = null;
            let tax_amount  = null;
            let grand_total = null;
            let processedItems;

            if (isVmiOrder) {
                // VMI: Store items without prices (financial fields stay NULL)
                processedItems = items.map(item => {
                    const qty = parseFloat(item.quantity);
                    return { ...item, qty, price: 0, lineTotal: 0 };
                });
            } else {
                // Commercial: Calculate financial totals
                subtotal = 0;
                processedItems = items.map(item => {
                    const qty       = parseFloat(item.quantity);
                    const price     = parseFloat(item.unit_price) || 0;
                    const lineTotal = Math.round(qty * price * 100) / 100;
                    subtotal += lineTotal;
                    return { ...item, qty, price, lineTotal };
                });
                subtotal          = Math.round(subtotal * 100) / 100;
                tax_amount        = Math.round(subtotal * vatRate * 100) / 100;
                grand_total       = Math.round((subtotal + tax_amount) * 100) / 100;
            }

            // ── Update order header ──────────────────────────────────────────
            const termsJson = Array.isArray(terms_conditions) ? JSON.stringify(terms_conditions) : '[]';
            const customTermsJson = custom_terms ? JSON.stringify(custom_terms) : null;

            const downPaymentAmount = down_payment_required ? parseFloat(down_payment_required) : null;

            await client.query(
                `UPDATE orders SET
                    client_id             = $1,
                    status                = $2,
                    pricing_status        = COALESCE($14, pricing_status),
                    order_date            = $3,
                    valid_until           = $4,
                    subtotal              = $5,
                    tax_amount            = $6,
                    grand_total           = $7,
                    client_notes          = $8,
                    internal_notes        = $9,
                    terms_conditions      = $10::jsonb,
                    custom_terms          = $11::jsonb,
                    down_payment_required = $12,
                    client_response       = NULL,
                    rejection_reason      = NULL,
                    deposit_receipt       = NULL,
                    responded_at          = NULL,
                    updated_at            = NOW()
                 WHERE id = $13`,
                [
                    client_id,
                    status || 'quote',
                    order_date || new Date().toISOString().split('T')[0],
                    valid_until || null,
                    subtotal,     // NULL for VMI
                    tax_amount,   // NULL for VMI
                    grand_total,  // NULL for VMI
                    client_notes   || null,
                    internal_notes || null,
                    termsJson,
                    customTermsJson,
                    isVmiOrder ? null : downPaymentAmount,
                    id,
                    req.body.pricing_status || null,
                ]
            );

            // Delete old items and re-insert
            await client.query('DELETE FROM order_items WHERE order_id = $1', [id]);

            const newItems = [];
            for (const item of processedItems) {
                const itemInsert = await client.query(
                    `INSERT INTO order_items
                        (order_id, variant_id, quantity, unit_price, design_status, design_id, notes)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     RETURNING *`,
                    [
                        id,
                        item.product_variant_id,
                        item.qty,
                        item.price,
                        item.design_status || 'new',
                        item.design_id || null,
                        item.notes || null,
                    ]
                );
                newItems.push(itemInsert.rows[0]);
            }

            return { id, subtotal, tax_amount, grand_total, items: newItems };
        });

        return res.status(200).json({ data: result });
    } catch (err) {
        console.error('[Orders] PUT /:id error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

// =============================================================================
// PATCH /api/orders/:id/status
// Updates only the status field (e.g. quote → confirmed).
// Non-sales_rep roles only.
// =============================================================================

router.patch('/:id/status', async (req, res) => {
    const { id }     = req.params;
    const { status } = req.body;

    const VALID_STATUSES = ['quote', 'confirmed', 'production', 'processing', 'completed', 'delivered', 'cancelled', 'archived'];

    if (!status || !VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: `الحالة غير صالحة. القيم المقبولة: ${VALID_STATUSES.join(', ')}.` });
    }

    // Non-admin roles cannot change order status
    const isAdmin = ['super_admin', 'admin', 'manager'].includes(req.user.role);
    if (!isAdmin) {
        return res.status(403).json({ error: 'غير مصرح لك بتغيير حالة الطلب.' });
    }

    try {
        const result = await db.query(
            `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status`,
            [status, id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'الطلب غير موجود.' });
        }
        return res.status(200).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Orders] PATCH /:id/status error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/orders/:id/convert-to-production
// Converts a quote to a production order. Optionally records a down payment.
// ATOMIC TRANSACTION — wraps status change + accounting in one commit.
//
// Payload:
//   { down_payment_amount, payment_method, cash_bank_account_id }
//
// Accounting (if down_payment_amount > 0):
//   DEBIT  cash_bank_account_id   (Cash / Bank)
//   CREDIT accounts_receivable    (code '1300', sub_account = client)
// =============================================================================

router.post('/:id/convert-to-production', async (req, res) => {
    const { id } = req.params;
    const {
        down_payment_amount,
        payment_method,
        cash_box,
        bank_account,
        bank_ref,
        pos_terminal,
        pos_ref,
    } = req.body;

    const paymentAmt = parseFloat(down_payment_amount) || 0;

    if (paymentAmt < 0) {
        return res.status(400).json({ error: 'مبلغ الدفعة المقدمة لا يمكن أن يكون سالباً.' });
    }

    try {
        const result = await db.withTransaction(async (client) => {

            // ── 1. Fetch & validate order (lock row, no JOIN for FOR UPDATE) ──
            const orderRes = await client.query(
                `SELECT id, order_number, status, client_id, grand_total, paid_amount, created_by
                 FROM orders
                 WHERE id = $1
                 FOR UPDATE`,
                [id]
            );

            if (orderRes.rowCount === 0) {
                throw new Error('الطلب غير موجود.');
            }

            const order = orderRes.rows[0];

            // Role check: sales_rep can only convert their own orders
            const isAdmin = ['super_admin', 'admin', 'manager'].includes(req.user.role);
            const isSalesRep = req.user.role === 'sales_rep';
            if (isSalesRep && order.created_by !== req.user.id) {
                throw new Error('غير مصرح لك بتحويل هذا الطلب.');
            }

            // Fetch client name separately
            const clientRes = await client.query(
                `SELECT name FROM clients WHERE id = $1 LIMIT 1`,
                [order.client_id]
            );
            order.client_name = clientRes.rowCount > 0 ? clientRes.rows[0].name : '';

            if (order.status !== 'quote') {
                throw new Error('لا يمكن تحويل هذا الطلب — الحالة الحالية ليست "عرض سعر".');
            }

            // ── 2. Update order → production ─────────────────────────────────
            const newPaidAmount = Math.round((parseFloat(order.paid_amount || 0) + paymentAmt) * 100) / 100;

            await client.query(
                `UPDATE orders
                 SET status      = 'production',
                     paid_amount = $1,
                     payment_method = $2,
                     updated_at  = NOW()
                 WHERE id = $3`,
                [newPaidAmount, payment_method || null, id]
            );

            let voucherId = null;

            // ── 3. Accounting (only if down payment > 0) ─────────────────────
            if (paymentAmt > 0) {

                // 3a. Lookup Accounts Receivable (code '1300')
                const arRes = await client.query(
                    `SELECT id FROM accounts WHERE code = '1300' LIMIT 1`
                );
                if (arRes.rowCount === 0) {
                    throw new Error('حساب المدينون (1300) غير موجود في دليل الحسابات.');
                }
                const arAccountId = arRes.rows[0].id;

                // ── Resolve payment account based on method ──────────────────
                let glAccountId = null;

                if (payment_method === 'cash' && cash_box) {
                    const accRes = await client.query(
                        `SELECT id FROM accounts WHERE code = $1 AND account_type = 'asset' LIMIT 1`,
                        [cash_box]
                    );
                    if (accRes.rowCount === 0) {
                        throw new Error(`حساب الصندوق "${cash_box}" غير موجود في دليل الحسابات.`);
                    }
                    glAccountId = accRes.rows[0].id;
                } else if (payment_method === 'bank_transfer' && bank_account) {
                    const accRes = await client.query(
                        `SELECT id FROM accounts WHERE code = $1 AND account_type = 'asset' LIMIT 1`,
                        [bank_account]
                    );
                    if (accRes.rowCount === 0) {
                        throw new Error(`حساب البنك "${bank_account}" غير موجود في دليل الحسابات.`);
                    }
                    glAccountId = accRes.rows[0].id;
                } else if (payment_method === 'pos' && pos_terminal) {
                    const posRes = await client.query(
                        `SELECT t.account_id, a.id AS fallback_id
                         FROM pos_terminals t
                         LEFT JOIN accounts a ON a.code = '1200'
                         WHERE t.code = $1 LIMIT 1`,
                        [pos_terminal]
                    );
                    if (posRes.rowCount === 0) {
                        throw new Error(`جهاز نقاط البيع "${pos_terminal}" غير موجود.`);
                    }
                    glAccountId = posRes.rows[0].account_id || posRes.rows[0].fallback_id;
                }

                if (!glAccountId) {
                    throw new Error('يجب اختيار حساب الصندوق/البنك عند تسجيل دفعة مقدمة.');
                }

                // 3b. Create Receipt Voucher
                const voucherRes = await client.query(
                    `INSERT INTO accounting_vouchers
                        (voucher_type, voucher_date, description, total_amount,
                         status, reference_type, reference_id, created_by)
                     VALUES ('receipt', CURRENT_DATE, $1, $2, 'posted', 'order', $3, $4)
                     RETURNING id, voucher_number`,
                    [
                        `دفعة مقدمة — طلب #${order.order_number} — ${order.client_name || ''}`,
                        paymentAmt,
                        id,
                        req.user.id,
                    ]
                );
                voucherId = voucherRes.rows[0].id;
                const voucherNumber = voucherRes.rows[0].voucher_number;

                // 3c. Double-Entry Lines
                // DEBIT: Cash/Bank
                await client.query(
                    `INSERT INTO accounting_voucher_lines
                        (voucher_id, account_id, debit, credit, description)
                     VALUES ($1, $2, $3, 0, $4)`,
                    [
                        voucherId,
                        glAccountId,
                        paymentAmt,
                        `قبض دفعة مقدمة — طلب #${order.order_number}`,
                    ]
                );

                // CREDIT: Accounts Receivable (sub_account = client)
                await client.query(
                    `INSERT INTO accounting_voucher_lines
                        (voucher_id, account_id, debit, credit,
                         sub_account_type, sub_account_id, description)
                     VALUES ($1, $2, 0, $3, 'client', $4, $5)`,
                    [
                        voucherId,
                        arAccountId,
                        paymentAmt,
                        order.client_id,
                        `دفعة مقدمة من العميل — طلب #${order.order_number}`,
                    ]
                );

                // Build description with payment details
                let description = `دفعة مقدمة — طلب #${order.order_number}`;
                if (payment_method === 'cash' && cash_box) {
                    description = `[صندوق: ${cash_box}] ${description}`;
                } else if (payment_method === 'bank_transfer') {
                    if (bank_account) description = `[حساب: ${bank_account}] ${description}`;
                    if (bank_ref) description = `[رقم الحوالة: ${bank_ref}] ${description}`;
                } else if (payment_method === 'pos') {
                    if (pos_terminal) description = `[جهاز: ${pos_terminal}] ${description}`;
                    if (pos_ref) description = `[رقم العملية: ${pos_ref}] ${description}`;
                }

                // 3d. Client Transaction
                await client.query(
                    `INSERT INTO client_transactions
                        (client_id, order_id, type, amount, payment_method,
                         description, linked_voucher_id)
                     VALUES ($1, $2, 'payment', $3, $4, $5, $6)`,
                    [
                        order.client_id,
                        id,
                        paymentAmt,
                        payment_method || null,
                        description,
                        voucherId,
                    ]
                );
            }

            return {
                order_id:     id,
                order_number: order.order_number,
                new_status:   'production',
                paid_amount:  newPaidAmount,
                voucher_id:   voucherId,
            };
        });

        return res.status(200).json({ data: result });
    } catch (err) {
        console.error('[Orders] POST /:id/convert-to-production error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

// =============================================================================
// DELETE /api/orders/:id
// Permanently deletes an order. ONLY allowed if status = 'archived'.
// Deletes order_items first, then the order itself.
// =============================================================================

// =============================================================================
// GET /api/orders/:orderId/invoice/:invoiceId
// Returns full invoice details with items for printing.
// =============================================================================

router.get('/:orderId/invoice/:invoiceId', async (req, res) => {
    const { orderId, invoiceId } = req.params;
    try {
        const invRes = await db.query(
            `SELECT i.*, o.order_number, o.paid_amount AS order_paid_amount, o.grand_total AS order_grand_total,
                    c.name AS client_name, c.phone AS client_phone, c.email AS client_email,
                    c.address AS client_address, c.tax_id AS client_tax_number
             FROM invoices i
             JOIN orders o ON o.id = i.order_id
             LEFT JOIN clients c ON c.id = i.client_id
             WHERE i.id = $1 AND i.order_id = $2`,
            [invoiceId, orderId]
        );
        if (invRes.rowCount === 0) return res.status(404).json({ error: 'الفاتورة غير موجودة.' });

        const itemsRes = await db.query(
            `SELECT ii.*, p.name AS product_name, pv.size_name
             FROM invoice_items ii
             LEFT JOIN product_variants pv ON pv.id = ii.variant_id
             LEFT JOIN products p ON p.id = pv.product_id
             WHERE ii.invoice_id = $1
             ORDER BY ii.created_at ASC`,
            [invoiceId]
        );

        const paymentsRes = await db.query(
            `SELECT ct.amount, ct.payment_method, ct.created_at, ct.description
             FROM client_transactions ct
             WHERE ct.order_id = $1 AND ct.type = 'payment'
             ORDER BY ct.created_at ASC`,
            [orderId]
        );

        return success(res, {
            ...invRes.rows[0],
            items: itemsRes.rows,
            payments: paymentsRes.rows
        });
    } catch (err) {
        console.error('[Orders] GET /:orderId/invoice/:invoiceId error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/orders/:id/financial
// Returns full financial summary for an order:
// invoices list, payments list, totals.
// =============================================================================

router.get('/:id/financial', async (req, res) => {
    const { id } = req.params;
    try {
        const orderRes = await db.query(
            `SELECT o.id, o.order_number, o.grand_total, o.paid_amount, o.status,
                    o.created_by, c.name AS client_name
             FROM orders o
             LEFT JOIN clients c ON c.id = o.client_id
             WHERE o.id = $1`,
            [id]
        );
        if (orderRes.rowCount === 0) return res.status(404).json({ error: 'الطلب غير موجود.' });

        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep && orderRes.rows[0].created_by !== req.user.id) {
            return res.status(403).json({ error: 'غير مصرح لك بعرض البيانات المالية لهذا الطلب.' });
        }

        const invoicesRes = await db.query(
            `SELECT i.id, i.invoice_number, i.invoice_date, i.grand_total, i.status,
                    i.subtotal, i.tax_amount, i.additional_expenses
             FROM invoices i
             WHERE i.order_id = $1
             ORDER BY i.created_at ASC`,
            [id]
        );

        const paymentsRes = await db.query(
            `SELECT ct.id, ct.amount, ct.payment_method, ct.description,
                    ct.document_number, ct.created_at
             FROM client_transactions ct
             WHERE ct.order_id = $1 AND ct.type = 'payment'
             ORDER BY ct.created_at ASC`,
            [id]
        );

        return success(res, {
            order: orderRes.rows[0],
            invoices: invoicesRes.rows,
            payments: paymentsRes.rows
        });
    } catch (err) {
        console.error('[Orders] GET /:id/financial error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/orders/:id/invoice
// Creates an invoice for a production order.
// Body: { type: 'proforma'|'final', items: [{variant_id, qty, unit_price}],
//         additional_expenses, notes }
// 'final' invoice deducts from warehouse_stock via delivery_notes logic.
// =============================================================================

router.post('/:id/invoice', async (req, res) => {
    const isAdmin = ['super_admin', 'admin', 'manager'].includes(req.user.role);
    if (!isAdmin) {
        return res.status(403).json({ error: 'غير مصرح لك بإصدار الفواتير.' });
    }
    const { id } = req.params;
    const { type = 'proforma', items = [], additional_expenses = 0, notes = '' } = req.body;

    const vatRate = await getVatRate();

    if (!['proforma', 'final'].includes(type)) {
        return res.status(400).json({ error: 'نوع الفاتورة غير صحيح. يجب أن يكون proforma أو final.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'يجب إدراج أصناف في الفاتورة.' });
    }

    try {
        const result = await db.withTransaction(async (client) => {
            const orderRes = await client.query(
                `SELECT o.id, o.order_number, o.client_id, o.status, o.grand_total
                 FROM orders o WHERE o.id = $1 FOR UPDATE`,
                [id]
            );
            if (orderRes.rowCount === 0) throw new Error('الطلب غير موجود.');
            const order = orderRes.rows[0];
            if (!['production', 'processing', 'completed'].includes(order.status)) {
                throw new Error('لا يمكن إصدار فاتورة إلا لأوامر الإنتاج.');
            }

            // ── Validate received qty per order item (final invoices only) ──
            // A final invoice must not exceed the quantity physically received for
            // THIS order. We check wh_received_qty on order_items, not total
            // warehouse_stock (which is shared across all orders).
            // Proforma = pre-payment before goods arrive, no check needed.
            for (const item of (type === 'final' ? items : [])) {
                if (!item.variant_id || !item.qty || item.qty <= 0) continue;

                const oi = await client.query(
                    `SELECT COALESCE(wh_received_qty, 0) AS received,
                            p.name AS product_name, pv.size_name
                     FROM order_items oi
                     JOIN product_variants pv ON pv.id = oi.variant_id
                     JOIN products p          ON p.id  = pv.product_id
                     WHERE oi.order_id = $1 AND oi.variant_id = $2
                     LIMIT 1`,
                    [id, item.variant_id]
                );
                if (oi.rowCount === 0) continue;
                const received = parseFloat(oi.rows[0].received || 0);
                if (item.qty > received) {
                    const label = `${oi.rows[0].product_name} ${oi.rows[0].size_name || ''}`.trim();
                    throw new Error(`الكمية المطلوبة (${item.qty}) تتجاوز الكمية المستلمة لهذا الطلب (${received}) للصنف "${label}".`);
                }
            }

            // Calculate totals
            let subtotal = 0;
            for (const item of items) {
                subtotal += parseFloat(item.unit_price || 0) * parseFloat(item.qty || 0);
            }
            subtotal = Math.round(subtotal * 100) / 100;
            const taxAmount = Math.round(subtotal * vatRate * 100) / 100;
            const addExp = Math.round(parseFloat(additional_expenses || 0) * 100) / 100;
            const grandTotal = Math.round((subtotal + taxAmount + addExp) * 100) / 100;

            // Insert invoice
            const invRes = await client.query(
                `INSERT INTO invoices (order_id, client_id, subtotal, tax_rate, tax_amount,
                                       additional_expenses, grand_total, status, notes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING id, invoice_number`,
                [id, order.client_id, subtotal, vatRate, taxAmount, addExp, grandTotal,
                 type === 'final' ? 'issued' : 'draft', notes || null]
            );
            const invoice = invRes.rows[0];

            // Insert invoice items
            for (const item of items) {
                const lineTotal = Math.round(parseFloat(item.unit_price || 0) * parseFloat(item.qty || 0) * 100) / 100;
                await client.query(
                    `INSERT INTO invoice_items (invoice_id, variant_id, quantity, unit_price)
                     VALUES ($1, $2, $3, $4)`,
                    [invoice.id, item.variant_id, item.qty, item.unit_price]
                );
            }

            // Sync orders.grand_total with the sum of all FINAL invoices for this order.
            // This keeps the order header (total / remaining) accurate after invoicing.
            if (type === 'final') {
                await client.query(
                    `UPDATE orders
                     SET grand_total = (
                         SELECT COALESCE(SUM(grand_total), 0)
                         FROM invoices
                         WHERE order_id = $1 AND status = 'issued'
                     ),
                     updated_at = NOW()
                     WHERE id = $1`,
                    [id]
                );
            }

            return { invoice_id: invoice.id, invoice_number: invoice.invoice_number, grand_total: grandTotal };
        });

        return created(res, result);
    } catch (err) {
        console.error('[Orders] POST /:id/invoice error:', err.message);
        return res.status(400).json({ error: err.message });
    }
});

// =============================================================================
// POST /api/orders/:id/payment
// Registers a client payment against a production order.
// Body: { amount, payment_method, notes }
// Creates client_transaction of type 'payment'.
// =============================================================================

router.post('/:id/payment', async (req, res) => {
    const isAdmin = ['super_admin', 'admin', 'manager'].includes(req.user.role);
    if (!isAdmin) {
        return res.status(403).json({ error: 'غير مصرح لك بتسجيل الدفعات.' });
    }
    const { id } = req.params;
    const { amount, payment_method = 'cash', notes = '', cash_box, bank_account, bank_ref, pos_terminal, pos_ref } = req.body;

    const payAmt = parseFloat(amount);
    if (!payAmt || payAmt <= 0) {
        return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر.' });
    }

    try {
        const result = await db.withTransaction(async (client) => {
            const orderRes = await client.query(
                `SELECT id, order_number, client_id, grand_total, paid_amount, status
                 FROM orders WHERE id = $1 FOR UPDATE`,
                [id]
            );
            if (orderRes.rowCount === 0) throw new Error('الطلب غير موجود.');
            const order = orderRes.rows[0];
            if (!['production', 'processing', 'completed'].includes(order.status)) {
                throw new Error('لا يمكن تسجيل دفعة إلا لأوامر الإنتاج.');
            }

            const newPaid = Math.round((parseFloat(order.paid_amount || 0) + payAmt) * 100) / 100;

            // Update paid_amount on order
            await client.query(
                `UPDATE orders SET paid_amount = $1, updated_at = now() WHERE id = $2`,
                [newPaid, id]
            );

            // Build description with extra payment details
            let description = notes || '';
            if (payment_method === 'cash' && cash_box) {
                description = `[صندوق: ${cash_box}] ${description}`;
            } else if (payment_method === 'bank_transfer') {
                if (bank_account) description = `[حساب: ${bank_account}] ${description}`;
                if (bank_ref) description = `[رقم الحوالة: ${bank_ref}] ${description}`;
            } else if (payment_method === 'pos') {
                if (pos_terminal) description = `[جهاز: ${pos_terminal}] ${description}`;
                if (pos_ref) description = `[رقم العملية: ${pos_ref}] ${description}`;
            }

            // Insert client_transaction
            const txRes = await client.query(
                `INSERT INTO client_transactions
                 (client_id, order_id, type, amount, payment_method, description)
                 VALUES ($1, $2, 'payment', $3, $4, $5)
                 RETURNING id, document_number`,
                [order.client_id, id, payAmt, payment_method, description || null]
            );

            return {
                transaction_id: txRes.rows[0].id,
                paid_amount: newPaid,
                remaining: Math.round((parseFloat(order.grand_total || 0) - newPaid) * 100) / 100,
            };
        });

        return created(res, result);
    } catch (err) {
        console.error('[Orders] POST /:id/payment error:', err.message);
        return res.status(400).json({ error: err.message });
    }
});

// =============================================================================
// DELETE /api/orders/:id
router.delete('/:id', async (req, res) => {
    const isAdmin = ['super_admin', 'admin', 'manager'].includes(req.user.role);
    if (!isAdmin) {
        return res.status(403).json({ error: 'غير مصرح لك بحذف الطلبات.' });
    }
    const { id } = req.params;

    try {
        const check = await db.query('SELECT id, status FROM orders WHERE id = $1', [id]);
        if (check.rowCount === 0) {
            return res.status(404).json({ error: 'الطلب غير موجود.' });
        }
        if (check.rows[0].status !== 'archived') {
            return res.status(400).json({ error: 'يمكن حذف العروض المؤرشفة فقط. قم بالأرشفة أولاً.' });
        }

        await db.query('DELETE FROM order_items WHERE order_id = $1', [id]);
        await db.query('DELETE FROM orders WHERE id = $1', [id]);

        return res.status(200).json({ message: 'تم حذف العرض نهائياً.' });
    } catch (err) {
        console.error('[Orders] DELETE /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/orders/:id/notes
// Returns all chat notes for an order, ordered by created_at ASC.
// =============================================================================
router.get('/:id/notes', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            `SELECT id, order_id, user_id, user_name, message, created_at
             FROM order_notes
             WHERE order_id = $1
             ORDER BY created_at ASC`,
            [id]
        );
        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[Orders] GET /:id/notes error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/orders/:id/notes
// Adds a new chat note to an order.
// Body: { message: string }
// =============================================================================
router.post('/:id/notes', async (req, res) => {
    try {
        const { id } = req.params;
        const { message } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'الرسالة مطلوبة.' });
        }

        // Get user info from JWT token (set by authenticate middleware)
        const userId   = req.user?.id   || null;
        const userName = req.user?.name || req.user?.username || req.user?.email || 'مستخدم';

        const result = await db.query(
            `INSERT INTO order_notes (order_id, user_id, user_name, message)
             VALUES ($1, $2, $3, $4)
             RETURNING id, order_id, user_id, user_name, message, created_at`,
            [id, userId, userName, message.trim()]
        );

        return res.status(201).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Orders] POST /:id/notes error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/orders/:id/release
// Release order for delivery by reserving stock from warehouse
// Business Logic: Moves stock from available to reserved state
// =============================================================================
router.post('/:id/release', async (req, res) => {
    const { id } = req.params;
    const { warehouse_id } = req.body;
    
    try {
        const result = await db.withTransaction(async (client) => {
        
        // 1. Get order with client_id
        const orderResult = await client.query(
            `SELECT o.id, o.client_id, o.status, o.order_number
             FROM orders o
             WHERE o.id = $1`,
            [id]
        );
        
        if (orderResult.rowCount === 0) {
            throw new Error('Order not found');
        }
        
        const order = orderResult.rows[0];
        
        // Only confirmed or production orders can be released
        if (!['confirmed', 'production'].includes(order.status)) {
            throw new Error(`Cannot release order with status: ${order.status}. Order must be confirmed or in production.`);
        }
        
        // 2. Get order items
        const itemsResult = await client.query(
            `SELECT oi.id, oi.variant_id, oi.quantity, 
                    pv.size_name, p.name AS product_name
             FROM order_items oi
             JOIN product_variants pv ON pv.id = oi.variant_id
             JOIN products p ON p.id = pv.product_id
             WHERE oi.order_id = $1`,
            [id]
        );
        
        if (itemsResult.rowCount === 0) {
            throw new Error('Order has no items');
        }
        
        const items = itemsResult.rows;
        
        // 3. Check stock availability for each item
        const insufficientStock = [];
        
        for (const item of items) {
            const stockResult = await client.query(
                `SELECT ws.id, ws.quantity, ws.reserved_qty, ws.available_qty
                 FROM warehouse_stock ws
                 WHERE ws.variant_id = $1 
                   AND ws.client_id = $2
                   AND ($3::uuid IS NULL OR ws.warehouse_id = $3)
                 ORDER BY ws.available_qty DESC
                 LIMIT 1`,
                [item.variant_id, order.client_id, warehouse_id || null]
            );
            
            if (stockResult.rowCount === 0 || stockResult.rows[0].available_qty < item.quantity) {
                insufficientStock.push({
                    product: `${item.product_name} - ${item.size_name}`,
                    required: parseFloat(item.quantity),
                    available: stockResult.rowCount > 0 ? parseFloat(stockResult.rows[0].available_qty) : 0
                });
            }
        }
        
        if (insufficientStock.length > 0) {
            const error = new Error('Insufficient stock for some items');
            error.details = insufficientStock;
            throw error;
        }
        
        // 4. Reserve stock (update reserved_qty, available_qty will auto-update)
        for (const item of items) {
            await client.query(
                `UPDATE warehouse_stock 
                 SET reserved_qty = reserved_qty + $1
                 WHERE variant_id = $2 
                   AND client_id = $3
                   AND ($4::uuid IS NULL OR warehouse_id = $4)`,
                [item.quantity, item.variant_id, order.client_id, warehouse_id || null]
            );
        }
        
        // 5. Update order status to 'processing' (ready for delivery)
        await client.query(
            `UPDATE orders 
             SET status = 'processing', 
                 updated_at = NOW() 
             WHERE id = $1`,
            [id]
        );
        
        return {
            order_id: id,
            order_number: order.order_number,
            status: 'processing',
            message: 'Order released successfully. Stock has been reserved for delivery.'
        };
        
        }); // end withTransaction
        
        return success(res, result);
        
    } catch (err) {
        console.error('[Orders] POST /:id/release error:', err.message);
        return res.status(400).json({ 
            error: err.message || 'Failed to release order', 
            details: err.details || null 
        });
    }
});

module.exports = router;
