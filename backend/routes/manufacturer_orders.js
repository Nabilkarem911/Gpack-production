'use strict';

const express = require('express');
const db = require('../db');
const { success, error: errorResponse } = require('../utils/response');
const authorize = require('../middleware/authorize');
const { validateBody, manufacturerOrderCreate, manufacturerOrderStatusUpdate, manufacturerOrderUpdate, manufacturerOrderReceive, manufacturerOrderPricing, moFinalize } = require('../utils/validators');

const router = express.Router();
router.use(authorize('production_orders', 'view'));
const restrictWrite  = authorize('production_orders', 'create');
const restrictEdit   = authorize('production_orders', 'edit');
const restrictDelete = authorize('production_orders', 'delete');

// =============================================================================
// GET /api/manufacturer-orders
// Returns manufacturer orders with supplier info and item counts.
// Query params:
//   ?order_id=<uuid> — filter by parent order
//   ?supplier_id=<uuid> — filter by supplier/manufacturer
//   ?status=pending|ordered|received|cancelled
// =============================================================================

router.get('/', async (req, res) => {
    try {
        const { order_id, supplier_id, status } = req.query;

        const conditions = [];
        const params = [];

        if (order_id) {
            params.push(order_id);
            conditions.push(`mo.order_id = $${params.length}`);
        }

        if (supplier_id) {
            params.push(supplier_id);
            conditions.push(`mo.manufacturer_id = $${params.length}`);
        }

        if (status) {
            const statuses = status.split(',').filter(s => s.trim());
            if (statuses.length === 1) {
                params.push(statuses[0]);
                conditions.push(`mo.status = $${params.length}`);
            } else if (statuses.length > 1) {
                const placeholders = statuses.map((_, i) => `$${params.length + i + 1}`).join(', ');
                params.push(...statuses);
                conditions.push(`mo.status IN (${placeholders})`);
            }
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const moResult = await db.query(
            `SELECT
                mo.id,
                mo.order_id,
                mo.manufacturer_id AS supplier_id,
                s.company_name AS supplier_name,
                mo.mo_number AS po_number,
                mo.status,
                mo.created_at AS order_date,
                mo.expected_delivery_date AS expected_delivery,
                mo.notes,
                mo.has_supplier_invoice,
                mo.created_at,
                mo.updated_at,
                COUNT(moi.id)::int AS item_count,
                COALESCE(SUM(mo.total_amount), 0)::numeric AS total_cost,
                c.name AS client_name,
                o.order_number,
                o.status AS order_status,
                s.company_name AS supplier_name
             FROM manufacturer_orders mo
             LEFT JOIN suppliers s ON s.id = mo.manufacturer_id
             LEFT JOIN orders o ON o.id = mo.order_id
             LEFT JOIN clients c ON c.id = o.client_id
             LEFT JOIN manufacturer_order_items moi ON moi.manufacturer_order_id = mo.id
             ${whereClause}
             GROUP BY mo.id, s.company_name, c.name, o.order_number, o.status
             ORDER BY mo.created_at DESC`,
            params
        );

        // Fetch items for all MOs in one query
        if (moResult.rows.length === 0) {
            return res.status(200).json({ data: [] });
        }

        const moIds = moResult.rows.map(r => r.id);
        const itemsResult = await db.query(
            `SELECT
                moi.manufacturer_order_id,
                moi.id,
                moi.order_item_id,
                oi.variant_id,
                moi.mo_quantity,
                moi.received_qty,
                moi.unit_cost,
                p.name AS product_name,
                pv.size_name
             FROM manufacturer_order_items moi
             LEFT JOIN order_items oi ON oi.id = moi.order_item_id
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
             LEFT JOIN products p ON p.id = pv.product_id
             WHERE moi.manufacturer_order_id = ANY($1::uuid[])`,
            [moIds]
        );

        // Group items by MO id
        const itemsByMO = {};
        for (const item of itemsResult.rows) {
            if (!itemsByMO[item.manufacturer_order_id]) itemsByMO[item.manufacturer_order_id] = [];
            itemsByMO[item.manufacturer_order_id].push(item);
        }

        const data = moResult.rows.map(mo => ({
            ...mo,
            items: itemsByMO[mo.id] || [],
        }));

        return res.status(200).json({ data });
    } catch (err) {
        console.error('[ManufacturerOrders] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/manufacturer-orders/by-order/:orderId
// MUST be before /:id to avoid Express matching 'by-order' as a UUID.
// Returns all manufacturer orders for a specific parent order.
// =============================================================================

router.get('/by-order/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;

        // Fetch all MOs for the order
        const moResult = await db.query(
            `SELECT
                mo.id,
                mo.manufacturer_id AS supplier_id,
                s.company_name AS supplier_name,
                mo.mo_number AS po_number,
                mo.status,
                mo.expected_delivery_date AS expected_delivery,
                mo.notes,
                mo.has_supplier_invoice,
                mo.created_at,
                COALESCE(mo.total_amount, 0)::numeric AS total_cost
             FROM manufacturer_orders mo
             LEFT JOIN suppliers s ON s.id = mo.manufacturer_id
             WHERE mo.order_id = $1
             ORDER BY mo.created_at DESC`,
            [orderId]
        );

        if (!moResult.rows.length) {
            return res.status(200).json({ data: [] });
        }

        // Fetch items for all MOs in one query
        const moIds = moResult.rows.map(r => r.id);
        const itemsResult = await db.query(
            `SELECT
                moi.manufacturer_order_id,
                moi.id,
                moi.id AS manufacturer_order_item_id,
                oi.id AS order_item_id,
                oi.variant_id,
                moi.mo_quantity AS po_quantity,
                moi.mo_quantity,
                moi.received_qty,
                oi.wh_received_qty,
                moi.unit_cost,
                p.name AS product_name,
                pv.size_name
             FROM manufacturer_order_items moi
             LEFT JOIN order_items oi ON oi.id = moi.order_item_id
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
             LEFT JOIN products p ON p.id = pv.product_id
             WHERE moi.manufacturer_order_id = ANY($1::uuid[])`,
            [moIds]
        );

        // Group items by MO id
        const itemsByMO = {};
        for (const item of itemsResult.rows) {
            if (!itemsByMO[item.manufacturer_order_id]) itemsByMO[item.manufacturer_order_id] = [];
            itemsByMO[item.manufacturer_order_id].push(item);
        }

        const data = moResult.rows.map(mo => ({
            ...mo,
            items: itemsByMO[mo.id] || [],
        }));

        return res.status(200).json({ data });
    } catch (err) {
        console.error('[ManufacturerOrders] GET /by-order/:orderId error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/manufacturer-orders/:id
// Returns single manufacturer order with all its items.
// =============================================================================

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const moResult = await db.query(
            `SELECT
                mo.id,
                mo.order_id,
                mo.manufacturer_id AS supplier_id,
                s.company_name AS supplier_name,
                s.contact_person AS supplier_contact,
                s.phone AS supplier_phone,
                mo.mo_number,
                mo.mo_number AS po_number,
                mo.status,
                mo.total_amount,
                mo.created_at AS order_date,
                mo.expected_delivery_date AS expected_delivery,
                mo.notes,
                mo.created_at,
                mo.updated_at
             FROM manufacturer_orders mo
             LEFT JOIN suppliers s ON s.id = mo.manufacturer_id
             WHERE mo.id = $1
             LIMIT 1`,
            [id]
        );

        if (moResult.rowCount === 0) {
            return res.status(404).json({ error: 'أمر التشغيل غير موجود.' });
        }

        const manufacturerOrder = moResult.rows[0];

        const itemsResult = await db.query(
            `SELECT
                moi.id,
                moi.manufacturer_order_id,
                moi.order_item_id,
                oi.variant_id,
                pv.size_name,
                pv.size_name AS variant_name,
                p.name AS product_name,
                u.name AS unit_name,
                moi.mo_quantity,
                moi.unit_cost,
                moi.total_cost,
                oi.wh_received_qty,
                moi.design_status,
                moi.design_id,
                cd.design_name,
                cd.design_number,
                cdf.file_path AS design_thumbnail,
                moi.created_at
             FROM manufacturer_order_items moi
             JOIN order_items oi ON oi.id = moi.order_item_id
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
             LEFT JOIN products p ON p.id = pv.product_id
             LEFT JOIN units u ON u.id = pv.unit_id
             LEFT JOIN client_designs cd ON cd.id = moi.design_id
             LEFT JOIN client_design_files cdf ON cdf.design_id = moi.design_id AND cdf.file_type = 'thumbnail'
             WHERE moi.manufacturer_order_id = $1
             ORDER BY moi.id ASC`,
            [id]
        );

        manufacturerOrder.items = itemsResult.rows;

        return res.status(200).json({ data: manufacturerOrder });
    } catch (err) {
        console.error('[ManufacturerOrders] GET /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/manufacturer-orders
// Creates a new manufacturer order (PO to supplier) with items.
// Atomically updates order_items.manufacturer_po_qty for tracking.
// =============================================================================

router.post('/', restrictWrite, validateBody(manufacturerOrderCreate), async (req, res) => {
    const {
        order_id,
        supplier_id,
        po_number,
        order_date,
        expected_delivery,
        notes,
        items
    } = req.validatedBody;

    if (!order_id || !supplier_id || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
            error: 'البيانات غير مكتملة. order_id و supplier_id والبنود مطلوبة.'
        });
    }

    try {
        const result = await db.withTransaction(async (client) => {
            // Verify parent order exists and is in production/processing status
            const orderCheck = await client.query(
                `SELECT id, status FROM orders WHERE id = $1`,
                [order_id]
            );
            if (orderCheck.rowCount === 0) {
                throw new Error('الطلب الأب غير موجود.');
            }
            const orderStatus = orderCheck.rows[0].status;
            if (!['production', 'processing'].includes(orderStatus)) {
                throw new Error('لا يمكن إنشاء أمر تشغيل إلا للطلبات في حالة الإنتاج أو قيد التنفيذ.');
            }

            // Generate MO number if not provided (INTEGER from sequence)
            let finalMoNumber = po_number;
            if (!finalMoNumber) {
                const moSeq = await client.query(
                    `SELECT nextval('manufacturer_order_number_seq') as num`
                );
                finalMoNumber = parseInt(moSeq.rows[0].num, 10);
            } else {
                finalMoNumber = parseInt(finalMoNumber, 10);
            }

            // Create manufacturer order
            const moResult = await client.query(
                `INSERT INTO manufacturer_orders (
                    order_id, manufacturer_id, mo_number, status,
                    expected_delivery_date, notes, created_by, created_at, updated_at
                ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, NOW(), NOW())
                RETURNING *, mo_number AS po_number, manufacturer_id AS supplier_id`,
                [
                    order_id,
                    supplier_id,
                    finalMoNumber,
                    expected_delivery || null,
                    notes || null,
                    req.user ? req.user.id : null
                ]
            );
            const manufacturerOrder = moResult.rows[0];

            // Insert items and update order_items manufacturer_po_qty
            const insertedItems = [];
            for (const item of items) {
                if (!item.order_item_id || !item.quantity) continue;

                const itemResult = await client.query(
                    `INSERT INTO manufacturer_order_items (
                        manufacturer_order_id, order_item_id, mo_quantity, design_status, design_id, created_at
                    ) VALUES ($1, $2, $3, $4, $5, NOW())
                    RETURNING *`,
                    [
                        manufacturerOrder.id,
                        item.order_item_id,
                        item.quantity,
                        item.design_status || 'new',
                        item.design_id || null
                    ]
                );
                insertedItems.push(itemResult.rows[0]);

                // Update order_items manufacturer_po_qty (accumulate)
                await client.query(
                    `UPDATE order_items
                     SET manufacturer_po_qty = COALESCE(manufacturer_po_qty, 0) + $1
                     WHERE id = $2`,
                    [item.quantity, item.order_item_id]
                );
            }

            manufacturerOrder.items = insertedItems;
            return manufacturerOrder;
        });

        return res.status(201).json({ data: result });
    } catch (err) {
        console.error('[ManufacturerOrders] POST / error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

// =============================================================================
// PATCH /api/manufacturer-orders/:id/status
// Updates manufacturer order status.
// Valid transitions: pending -> ordered -> received
// =============================================================================

router.patch('/:id/status', restrictEdit, validateBody(manufacturerOrderStatusUpdate), async (req, res) => {
    const { id } = req.params;
    const { status, actual_delivery } = req.validatedBody;

    const VALID_STATUSES = ['pending', 'sent', 'partially_received', 'received', 'cancelled'];

    if (!status || !VALID_STATUSES.includes(status)) {
        return res.status(400).json({
            error: `الحالة غير صالحة. القيم المقبولة: ${VALID_STATUSES.join(', ')}.`
        });
    }

    try {
        const result = await db.withTransaction(async (client) => {
            // Get current status
            const currentResult = await client.query(
                `SELECT status FROM manufacturer_orders WHERE id = $1`,
                [id]
            );
            if (currentResult.rowCount === 0) {
                throw new Error('أمر التشغيل غير موجود.');
            }
            const currentStatus = currentResult.rows[0].status;

            // Validate transition
            const validTransitions = {
                'pending': ['sent', 'cancelled'],
                'sent': ['partially_received', 'received', 'cancelled'],
                'partially_received': ['received', 'cancelled'],
                'received': [],
                'cancelled': ['pending']
            };

            if (!validTransitions[currentStatus].includes(status)) {
                throw new Error(`لا يمكن الانتقال من "${currentStatus}" إلى "${status}".`);
            }

            // Build update fields
            const updates = ['status = $1', 'updated_at = NOW()'];
            const params = [status];

            params.push(id);
            const updateQuery = `
                UPDATE manufacturer_orders
                SET ${updates.join(', ')}
                WHERE id = $${params.length}
                RETURNING *, mo_number AS po_number, manufacturer_id AS supplier_id
            `;

            const updateResult = await client.query(updateQuery, params);

            // If received, update order_items received quantities
            if (status === 'received') {
                const itemsResult = await client.query(
                    `SELECT order_item_id, mo_quantity
                     FROM manufacturer_order_items
                     WHERE manufacturer_order_id = $1`,
                    [id]
                );

                for (const item of itemsResult.rows) {
                    await client.query(
                        `UPDATE order_items
                         SET wh_received_qty = COALESCE(wh_received_qty, 0) + $1
                         WHERE id = $2`,
                        [item.mo_quantity, item.order_item_id]
                    );
                }
            }

            return updateResult.rows[0];
        });

        return res.status(200).json({ data: result });
    } catch (err) {
        console.error('[ManufacturerOrders] PATCH /:id/status error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

// =============================================================================
// PATCH /api/manufacturer-orders/:id
// Updates manufacturer order details (supplier, dates, notes).
// Cannot edit if status is received or cancelled.
// =============================================================================

router.patch('/:id', restrictEdit, validateBody(manufacturerOrderUpdate), async (req, res) => {
    const { id } = req.params;
    const { supplier_id, expected_delivery, notes } = req.validatedBody;

    try {
        const checkResult = await db.query(
            `SELECT status FROM manufacturer_orders WHERE id = $1`,
            [id]
        );
        if (checkResult.rowCount === 0) {
            return res.status(404).json({ error: 'أمر التشغيل غير موجود.' });
        }

        const currentStatus = checkResult.rows[0].status;
        if (['received', 'cancelled'].includes(currentStatus)) {
            return res.status(400).json({
                error: 'لا يمكن تعديل أمر التشغيل بعد استلامه أو إلغائه.'
            });
        }

        const updates = ['updated_at = NOW()'];
        const params = [];

        if (supplier_id !== undefined) {
            updates.push(`manufacturer_id = $${params.length + 1}`);
            params.push(supplier_id);
        }

        if (expected_delivery !== undefined) {
            updates.push(`expected_delivery_date = $${params.length + 1}`);
            params.push(expected_delivery);
        }

        if (notes !== undefined) {
            updates.push(`notes = $${params.length + 1}`);
            params.push(notes);
        }

        params.push(id);
        const result = await db.query(
            `UPDATE manufacturer_orders
             SET ${updates.join(', ')}
             WHERE id = $${params.length}
             RETURNING *`,
            params
        );

        return res.status(200).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[ManufacturerOrders] PATCH /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/manufacturer-orders/:id/receipts
// Returns all receipt sessions for a manufacturer order (active + reversed).
// =============================================================================
router.get('/:id/receipts', async (req, res) => {
    const { id } = req.params;
    try {
        const sessionsRes = await db.query(
            `SELECT
                s.id, s.session_number, s.received_date, s.subtotal,
                s.tax_rate, s.tax_amount, s.grand_total,
                s.has_supplier_invoice, s.supplier_invoice_ref, s.notes,
                s.status, s.created_at, s.reversed_at,
                w.name AS warehouse_name,
                u.name AS created_by_name,
                ur.name AS reversed_by_name
             FROM mo_receipt_sessions s
             LEFT JOIN warehouses w ON w.id = s.warehouse_id
             LEFT JOIN users u  ON u.id = s.created_by
             LEFT JOIN users ur ON ur.id = s.reversed_by
             WHERE s.manufacturer_order_id = $1
             ORDER BY s.session_number DESC`,
            [id]
        );

        const sessionIds = sessionsRes.rows.map(r => r.id);
        let itemsBySession = {};
        if (sessionIds.length > 0) {
            const itemsRes = await db.query(
                `SELECT
                    si.session_id, si.id, si.quantity, si.unit_cost, si.line_total,
                    p.name AS product_name, pv.size_name
                 FROM mo_receipt_session_items si
                 JOIN product_variants pv ON pv.id = si.variant_id
                 JOIN products p ON p.id = pv.product_id
                 WHERE si.session_id = ANY($1::uuid[])
                 ORDER BY si.created_at`,
                [sessionIds]
            );
            for (const row of itemsRes.rows) {
                if (!itemsBySession[row.session_id]) itemsBySession[row.session_id] = [];
                itemsBySession[row.session_id].push(row);
            }
        }

        const data = sessionsRes.rows.map(s => ({ ...s, items: itemsBySession[s.id] || [] }));
        return res.json({ data });
    } catch (err) {
        console.error('[ManufacturerOrders] GET /:id/receipts error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// DELETE /api/manufacturer-orders/:id/receipts/:sessionId
// Reverses a receipt session:
//   - Deducts stock
//   - Reverts received_qty on manufacturer_order_items
//   - Reverts wh_received_qty on order_items
//   - Reverses accounting voucher (marks as reversed)
//   - Reverses purchase invoice (marks as cancelled)
//   - Updates MO status
// BLOCKED only if the parent ORDER status is completed/archived/cancelled.
// =============================================================================
router.delete('/:id/receipts/:sessionId', restrictDelete, async (req, res) => {
    const { id, sessionId } = req.params;

    try {
        const result = await db.withTransaction(async (client) => {

            // ── 1. Load MO ───────────────────────────────────────────────────
            const moRes = await client.query(
                `SELECT mo.*, o.client_id, o.status AS order_status
                 FROM manufacturer_orders mo
                 JOIN orders o ON o.id = mo.order_id
                 WHERE mo.id = $1`,
                [id]
            );
            if (moRes.rowCount === 0) throw new Error('أمر التشغيل غير موجود.');
            const mo = moRes.rows[0];
            const lockedOrderStatuses = ['completed', 'archived', 'cancelled'];
            if (lockedOrderStatuses.includes(mo.order_status)) {
                throw new Error('لا يمكن التراجع — الطلب الأصلي مُقفل (' + mo.order_status + ').');
            }

            // ── 2. Load session ──────────────────────────────────────────────
            const sessionRes = await client.query(
                `SELECT * FROM mo_receipt_sessions WHERE id = $1 AND manufacturer_order_id = $2`,
                [sessionId, id]
            );
            if (sessionRes.rowCount === 0) throw new Error('جلسة الاستلام غير موجودة.');
            const session = sessionRes.rows[0];
            if (session.status === 'reversed') throw new Error('هذه الجلسة تم التراجع عنها مسبقاً.');

            // ── 3. Load session items ────────────────────────────────────────
            const itemsRes = await client.query(
                `SELECT si.*, moi.order_item_id
                 FROM mo_receipt_session_items si
                 JOIN manufacturer_order_items moi ON moi.id = si.manufacturer_order_item_id
                 WHERE si.session_id = $1`,
                [sessionId]
            );

            // ── 4. Revert each item ──────────────────────────────────────────
            for (const item of itemsRes.rows) {
                // 4a. Revert received_qty on manufacturer_order_items
                await client.query(
                    `UPDATE manufacturer_order_items
                     SET received_qty = GREATEST(0, received_qty - $1)
                     WHERE id = $2`,
                    [item.quantity, item.manufacturer_order_item_id]
                );

                // 4b. Revert wh_received_qty on order_items
                if (item.order_item_id) {
                    await client.query(
                        `UPDATE order_items
                         SET wh_received_qty = GREATEST(0, COALESCE(wh_received_qty, 0) - $1)
                         WHERE id = $2`,
                        [item.quantity, item.order_item_id]
                    );
                }

                // 4c. Deduct from warehouse_stock
                await client.query(
                    `UPDATE warehouse_stock
                     SET quantity = GREATEST(0, quantity - $1), last_updated = NOW()
                     WHERE warehouse_id = $2 AND variant_id = $3
                       AND (client_id = $4 OR (client_id IS NULL AND $4::uuid IS NULL))`,
                    [item.quantity, session.warehouse_id, item.variant_id, mo.client_id]
                );

                // 4d. Log reversal in inventory_transactions
                await client.query(
                    `INSERT INTO inventory_transactions
                       (variant_id, transaction_type, quantity, notes, reference_id, reference_type, created_by, created_at)
                     VALUES ($1, 'reversal', $2, $3, $4, 'mo_receipt_session', $5, NOW())`,
                    [item.variant_id, item.quantity,
                     `تراجع عن استلام — أمر ${mo.mo_number} جلسة #${session.session_number}`,
                     sessionId, req.user?.id]
                );
            }

            // ── 5. Reverse accounting voucher ────────────────────────────────
            if (session.accounting_voucher_id) {
                await client.query(
                    `UPDATE accounting_vouchers
                     SET status = 'reversed', updated_at = NOW()
                     WHERE id = $1`,
                    [session.accounting_voucher_id]
                );
            }

            // ── 6. Cancel purchase invoice ───────────────────────────────────
            if (session.purchase_invoice_id) {
                await client.query(
                    `UPDATE purchase_invoices
                     SET status = 'cancelled'
                     WHERE id = $1`,
                    [session.purchase_invoice_id]
                );
            }

            // ── 7. Mark session as reversed ──────────────────────────────────
            await client.query(
                `UPDATE mo_receipt_sessions
                 SET status = 'reversed', reversed_at = NOW(), reversed_by = $1
                 WHERE id = $2`,
                [req.user?.id, sessionId]
            );

            // ── 8. Recalculate MO status ─────────────────────────────────────
            const itemsStatusRes = await client.query(
                `SELECT mo_quantity, received_qty FROM manufacturer_order_items WHERE manufacturer_order_id = $1`,
                [id]
            );
            const anyReceived = itemsStatusRes.rows.some(r => parseFloat(r.received_qty) > 0);
            const newStatus = anyReceived ? 'partially_received' : 'sent';
            await client.query(
                `UPDATE manufacturer_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
                [newStatus, id]
            );

            return { newStatus };
        });

        return res.json({ message: 'تم التراجع عن عملية الاستلام بنجاح.', data: result });
    } catch (err) {
        console.error('[ManufacturerOrders] DELETE /:id/receipts/:sessionId error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/manufacturer-orders/:id/receive
// Partial or full receipt of goods from manufacturer.
//
// Body: {
//   warehouse_id: uuid,                             (required)
//   items: [{ manufacturer_order_item_id, variant_id, order_item_id, quantity }],
//   pay_now:   boolean,                             (optional — pay supplier immediately)
//   pay_amount: number,                             (required if pay_now = true)
//   pay_notes:  string,                             (optional)
// }
//
// Accounting entries on RECEIPT:
//   DR  Inventory Asset       (value of goods received)
//   CR  Accounts Payable      (liability to supplier)
//
// Accounting entries on IMMEDIATE PAYMENT:
//   DR  Accounts Payable      (settle the liability)
//   CR  Bank Accounts         (cash out)
//
// Allows multiple partial receipts. Status becomes:
//   'partial'  — if at least one item still has received_qty < mo_quantity
//   'received' — if all items are fully received
// =============================================================================

const ACCOUNT_INVENTORY  = 'c1ad0786-b968-4bc9-abd7-3a508e6f4e52'; // Inventory Asset
const ACCOUNT_PAYABLE    = '3e118831-0022-47de-acfe-b06a1cd8b9d2'; // Accounts Payable
const ACCOUNT_BANK       = 'c715d163-4bd7-41f4-8251-dcd8fed13297'; // Bank Accounts
const ACCOUNT_VAT_INPUT  = 'a1b2c3d4-5678-9abc-def0-111222333444'; // VAT Input (Receivable)

router.post('/:id/receive', restrictEdit, validateBody(manufacturerOrderReceive), async (req, res) => {
    const { id } = req.params;
    const {
        warehouse_id, items,
        has_supplier_invoice = false,
        tax_rate = 0, supplier_invoice_ref = '', notes = '',
        pay_now = false, pay_amount = 0, pay_notes = ''
    } = req.validatedBody;

    if (!warehouse_id) {
        return res.status(400).json({ error: 'warehouse_id مطلوب.' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items array مطلوب.' });
    }
    if (pay_now && (!pay_amount || parseFloat(pay_amount) <= 0)) {
        return res.status(400).json({ error: 'أدخل مبلغ الدفع.' });
    }

    try {
        const result = await db.withTransaction(async (client) => {

            // ── 1. Load MO ───────────────────────────────────────────────────
            const moCheck = await client.query(
                `SELECT mo.*, o.client_id
                 FROM manufacturer_orders mo
                 JOIN orders o ON o.id = mo.order_id
                 WHERE mo.id = $1`,
                [id]
            );
            if (moCheck.rowCount === 0) throw new Error('أمر التشغيل غير موجود.');
            const mo = moCheck.rows[0];
            if (mo.status === 'cancelled') throw new Error('لا يمكن الاستلام على أمر ملغى.');
            if (mo.status === 'received')  throw new Error('تم استلام هذا الأمر بالكامل مسبقاً.');

            // ── 2. Load all MO items to check totals ─────────────────────────
            const moItemsRes = await client.query(
                `SELECT id, order_item_id, mo_quantity, received_qty, unit_cost
                 FROM manufacturer_order_items
                 WHERE manufacturer_order_id = $1`,
                [id]
            );
            const moItemsMap = {};
            for (const r of moItemsRes.rows) moItemsMap[r.id] = r;

            // ── 3. Process each received item ────────────────────────────────
            let subtotal = 0;
            const invoiceItems = [];

            for (const item of items) {
                const qty = parseFloat(item.quantity);
                if (!item.variant_id || !qty || qty <= 0) continue;

                const moItem = moItemsMap[item.manufacturer_order_item_id];
                if (!moItem) continue;

                const alreadyReceived = parseFloat(moItem.received_qty || 0);
                // Allow receiving more than assigned (overproduction scenario common in printing)
                // But warn if receiving more than ordered
                const actualQty = qty;
                const unitCost  = parseFloat(item.unit_cost || moItem.unit_cost || 0);
                const lineTotal = actualQty * unitCost;
                subtotal += lineTotal;

                invoiceItems.push({
                    manufacturer_order_item_id: moItem.id,
                    variant_id: item.variant_id,
                    quantity: actualQty,
                    unit_cost: unitCost,
                    total_cost: lineTotal,
                });

                // 3a. Update received_qty on manufacturer_order_items
                await client.query(
                    `UPDATE manufacturer_order_items
                     SET received_qty = received_qty + $1, unit_cost = $3
                     WHERE id = $2`,
                    [actualQty, moItem.id, unitCost]
                );

                // 3b. Update wh_received_qty on order_items
                if (moItem.order_item_id) {
                    await client.query(
                        `UPDATE order_items
                         SET wh_received_qty = COALESCE(wh_received_qty, 0) + $1
                         WHERE id = $2`,
                        [actualQty, moItem.order_item_id]
                    );
                }

                // 3c. Upsert warehouse_stock
                const stockRes = await client.query(
                    `SELECT id FROM warehouse_stock
                     WHERE warehouse_id = $1 AND variant_id = $2
                       AND (client_id = $3 OR (client_id IS NULL AND $3 IS NULL))`,
                    [warehouse_id, item.variant_id, mo.client_id]
                );
                let stockId;
                if (stockRes.rowCount === 0) {
                    const ins = await client.query(
                        `INSERT INTO warehouse_stock (warehouse_id, variant_id, client_id, quantity, last_updated)
                         VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
                        [warehouse_id, item.variant_id, mo.client_id, actualQty]
                    );
                    stockId = ins.rows[0].id;
                } else {
                    stockId = stockRes.rows[0].id;
                    await client.query(
                        `UPDATE warehouse_stock SET quantity = quantity + $1, last_updated = NOW() WHERE id = $2`,
                        [actualQty, stockId]
                    );
                }

                // 3d. Inventory transaction log
                await client.query(
                    `INSERT INTO inventory_transactions
                       (stock_id, variant_id, transaction_type, quantity, notes, reference_id, reference_type, created_by, created_at)
                     VALUES ($1, $2, 'receipt', $3, $4, $5, 'manufacturer_order', $6, NOW())`,
                    [stockId, item.variant_id, actualQty,
                     `استلام من مورد — أمر ${mo.mo_number}`,
                     id, req.user?.id]
                );
            }

            // ── 4. Determine new MO status ───────────────────────────────────
            const updatedItemsRes = await client.query(
                `SELECT mo_quantity, received_qty FROM manufacturer_order_items WHERE manufacturer_order_id = $1`,
                [id]
            );
            const allFull = updatedItemsRes.rows.every(
                r => parseFloat(r.received_qty) >= parseFloat(r.mo_quantity)
            );
            const anyReceived = updatedItemsRes.rows.some(r => parseFloat(r.received_qty) > 0);
            const newStatus = allFull ? 'received' : anyReceived ? 'partially_received' : mo.status;

            await client.query(
                `UPDATE manufacturer_orders SET status = $1, has_supplier_invoice = $2, updated_at = NOW() WHERE id = $3`,
                [newStatus, has_supplier_invoice, id]
            );

            // ── 4b. Create receipt session record ────────────────────────────
            const sessionNumRes = await client.query(
                `SELECT COALESCE(MAX(session_number), 0) + 1 AS next
                 FROM mo_receipt_sessions WHERE manufacturer_order_id = $1`,
                [id]
            );
            const sessionNumber = sessionNumRes.rows[0].next;
            const taxAmt0   = subtotal * parseFloat(tax_rate || 0);
            const grandTotal0 = subtotal + taxAmt0;

            const sessionRes = await client.query(
                `INSERT INTO mo_receipt_sessions
                   (manufacturer_order_id, warehouse_id, received_date, session_number,
                    subtotal, tax_rate, tax_amount, grand_total,
                    has_supplier_invoice, supplier_invoice_ref, notes,
                    status, created_by)
                 VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11)
                 RETURNING id`,
                [id, warehouse_id, sessionNumber,
                 subtotal, parseFloat(tax_rate || 0), taxAmt0, grandTotal0,
                 has_supplier_invoice, supplier_invoice_ref || null, notes || null,
                 req.user?.id]
            );
            const sessionId = sessionRes.rows[0].id;

            // Insert session items
            for (const ii of invoiceItems) {
                await client.query(
                    `INSERT INTO mo_receipt_session_items
                       (session_id, manufacturer_order_item_id, variant_id, quantity, unit_cost, line_total)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [sessionId, ii.manufacturer_order_item_id, ii.variant_id,
                     ii.quantity, ii.unit_cost, ii.total_cost]
                );
            }

            // ── 5. Create Purchase Invoice (DRAFT — manager will set prices and approve) ──
            let purchaseInvoiceId = null;

            // Always create a draft invoice with quantities (prices = 0, manager fills later)
            const invRes = await client.query(
                `INSERT INTO purchase_invoices
                   (supplier_id, manufacturer_order_id, supplier_invoice_ref, invoice_date, subtotal, tax_rate, tax_amount, grand_total, status, notes, created_by, has_supplier_invoice)
                 VALUES ($1, $2, $3, CURRENT_DATE, 0, 0, 0, 0, 'draft', $4, $5, $6)
                 RETURNING id, invoice_number`,
                [
                    mo.manufacturer_id, id, supplier_invoice_ref,
                    notes, req.user?.id, has_supplier_invoice
                ]
            );
            purchaseInvoiceId = invRes.rows[0].id;
            const invoiceNumber = invRes.rows[0].invoice_number;

            // Insert invoice items with quantities but unit_cost = 0 (manager sets later)
            for (const ii of invoiceItems) {
                await client.query(
                    `INSERT INTO purchase_invoice_items
                       (purchase_invoice_id, manufacturer_order_item_id, variant_id, quantity, unit_cost, total_cost)
                     VALUES ($1, $2, $3, $4, 0, 0)`,
                    [purchaseInvoiceId, ii.manufacturer_order_item_id, ii.variant_id, ii.quantity, ii.total_cost]
                );
            }

            // ── 6. Link purchase invoice to session (no accounting voucher yet) ──
            if (purchaseInvoiceId) {
                await client.query(
                    `UPDATE mo_receipt_sessions
                     SET purchase_invoice_id = $1
                     WHERE id = $2`,
                    [purchaseInvoiceId, sessionId]
                );
            }

            // No accounting vouchers or payments — manager approves invoice later

            return { newStatus, purchaseInvoiceId, invoiceNumber };
        });

        return res.status(200).json({
            message: result.newStatus === 'received'
                ? 'تم استلام البضاعة بالكامل وإنشاء فاتورة مشتريات (مسودة). المدير يجب اعتماد الفاتورة وإدخال الأسعار.'
                : 'تم تسجيل الاستلام الجزئي وإنشاء فاتورة مشتريات (مسودة). يمكنك إكمال الاستلام لاحقاً.',
            data: result,
        });
    } catch (err) {
        console.error('[ManufacturerOrders] POST /:id/receive error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

// =============================================================================
// DELETE /api/manufacturer-orders/:id
// Deletes manufacturer order and its items. Only allowed if status is pending.
// Reverts order_items manufacturer_po_qty.
// =============================================================================

router.delete('/:id', restrictDelete, async (req, res) => {
    const { id } = req.params;

    try {
        await db.withTransaction(async (client) => {
            const checkResult = await client.query(
                `SELECT status FROM manufacturer_orders WHERE id = $1`,
                [id]
            );
            if (checkResult.rowCount === 0) {
                throw new Error('أمر التشغيل غير موجود.');
            }

            const status = checkResult.rows[0].status;
            if (status !== 'pending') {
                throw new Error('يمكن حذف أوامر التشغيل في حالة "معلق" فقط.');
            }

            // Get items to revert order_items quantities
            const itemsResult = await client.query(
                `SELECT order_item_id, mo_quantity
                 FROM manufacturer_order_items
                 WHERE manufacturer_order_id = $1`,
                [id]
            );

            // Revert manufacturer_po_qty on order_items
            for (const item of itemsResult.rows) {
                if (item.order_item_id) {
                    await client.query(
                        `UPDATE order_items
                         SET manufacturer_po_qty = GREATEST(0, COALESCE(manufacturer_po_qty, 0) - $1)
                         WHERE id = $2`,
                        [item.mo_quantity, item.order_item_id]
                    );
                }
            }

            // Delete manufacturer order items
            await client.query(
                `DELETE FROM manufacturer_order_items WHERE manufacturer_order_id = $1`,
                [id]
            );

            // Delete manufacturer order
            await client.query(
                `DELETE FROM manufacturer_orders WHERE id = $1`,
                [id]
            );
        });

        return res.status(200).json({ message: 'تم حذف أمر التشغيل بنجاح.' });
    } catch (err) {
        console.error('[ManufacturerOrders] DELETE /:id error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/manufacturer-orders/:id/pricing
// Save/update purchase unit costs for received items (Manager only).
// =============================================================================

router.post('/:id/pricing', restrictEdit, validateBody(manufacturerOrderPricing), async (req, res) => {
    const { id } = req.params;
    const { items } = req.validatedBody;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'يجب إرسال بنود للتسعير.' });
    }

    try {
        const result = await db.withTransaction(async (client) => {
            // Verify MO exists
            const moCheck = await client.query(
                `SELECT mo.id, mo.manufacturer_id, mo.mo_number, mo.status
                 FROM manufacturer_orders mo
                 WHERE mo.id = $1`,
                [id]
            );
            if (moCheck.rowCount === 0) throw new Error('أمر التشغيل غير موجود.');
            const mo = moCheck.rows[0];

            // Update unit_cost for each item
            let updatedCount = 0;
            let totalCost = 0;

            for (const item of items) {
                if (!item.manufacturer_order_item_id || !item.unit_cost) continue;

                const unitCost = parseFloat(item.unit_cost);
                if (isNaN(unitCost) || unitCost < 0) continue;

                // Get quantity to calculate total
                const qtyRes = await client.query(
                    `SELECT received_qty FROM manufacturer_order_items WHERE id = $1`,
                    [item.manufacturer_order_item_id]
                );
                if (qtyRes.rowCount === 0) continue;

                const receivedQty = parseFloat(qtyRes.rows[0].received_qty || 0);
                const lineTotal = unitCost * receivedQty;
                totalCost += lineTotal;

                await client.query(
                    `UPDATE manufacturer_order_items
                     SET unit_cost = $1
                     WHERE id = $2`,
                    [unitCost, item.manufacturer_order_item_id]
                );
                updatedCount++;
            }

            // Update MO total_amount and tax_rate
            const taxRate = parseFloat(req.validatedBody.tax_rate || 0);
            await client.query(
                `UPDATE manufacturer_orders
                 SET total_amount = (
                     SELECT COALESCE(SUM(unit_cost * received_qty), 0) FROM manufacturer_order_items
                     WHERE manufacturer_order_id = $1
                 ),
                 tax_rate = $2,
                 updated_at = NOW()
                 WHERE id = $1`,
                [id, taxRate]
            );

            return { updatedCount, totalCost, taxRate };
        });

        return res.status(200).json({
            message: `تم تحديث أسعار ${result.updatedCount} صنف بنجاح.`,
            data: result
        });
    } catch (err) {
        console.error('[ManufacturerOrders] POST /:id/pricing error:', err.message);
        return res.status(400).json({ error: err.message || 'فشل تحديث الأسعار.' });
    }
});

// ── POST /api/manufacturer-orders/by-order/:orderId/finalize ─────────────────
// Manager confirms final receive — updates stock, wh_received_qty, and MO status.
// Safe to call even if /receive was already called (uses delta = received_qty - wh_received_qty).
router.post('/by-order/:orderId/finalize', restrictEdit, validateBody(moFinalize), async (req, res) => {
    const { orderId } = req.params;
    const { tax_rate } = req.validatedBody;

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Load order + client_id
        const orderRes = await client.query(
            `SELECT id, client_id FROM orders WHERE id = $1`,
            [orderId]
        );
        if (orderRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'الطلب غير موجود' });
        }
        const clientId = orderRes.rows[0].client_id;

        // Get default warehouse
        const whRes = await client.query(`SELECT id FROM warehouses ORDER BY created_at LIMIT 1`);
        const warehouseId = whRes.rows[0]?.id;
        if (!warehouseId) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'لا يوجد مستودع مُعرَّف في النظام' });
        }

        // Get all MOs for this order
        const moRes = await client.query(
            `SELECT id, manufacturer_id, mo_number, status FROM manufacturer_orders WHERE order_id = $1`,
            [orderId]
        );
        const mos = moRes.rows;
        if (!mos.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'لا توجد أوامر تشغيل لهذا الطلب' });
        }

        let totalUpdated = 0;
        for (const mo of mos) {
            // Get items with received qty and linked order_item
            const itemsRes = await client.query(
                `SELECT moi.id, moi.received_qty, moi.unit_cost, moi.order_item_id,
                        oi.variant_id,
                        COALESCE(oi.wh_received_qty, 0) AS already_in_stock
                 FROM manufacturer_order_items moi
                 LEFT JOIN order_items oi ON oi.id = moi.order_item_id
                 WHERE moi.manufacturer_order_id = $1 AND moi.received_qty > 0`,
                [mo.id]
            );

            if (!itemsRes.rows.length) continue;

            let subtotal = 0;
            for (const item of itemsRes.rows) {
                const received   = parseFloat(item.received_qty || 0);
                const unitCost   = parseFloat(item.unit_cost || 0);
                subtotal += received * unitCost;

                if (!item.variant_id) continue;

                // Delta = qty not yet added to stock (prevents double-counting if /receive was called)
                const alreadyInStock = parseFloat(item.already_in_stock || 0);
                const delta = received - alreadyInStock;

                if (delta <= 0) continue; // already added via /receive

                // Upsert warehouse_stock
                const stockCheck = await client.query(
                    `SELECT id FROM warehouse_stock
                     WHERE warehouse_id = $1 AND variant_id = $2
                       AND (client_id = $3 OR (client_id IS NULL AND $3 IS NULL))`,
                    [warehouseId, item.variant_id, clientId]
                );
                let stockId;
                if (stockCheck.rowCount === 0) {
                    const ins = await client.query(
                        `INSERT INTO warehouse_stock (warehouse_id, variant_id, client_id, quantity, last_updated)
                         VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
                        [warehouseId, item.variant_id, clientId, delta]
                    );
                    stockId = ins.rows[0].id;
                } else {
                    stockId = stockCheck.rows[0].id;
                    await client.query(
                        `UPDATE warehouse_stock SET quantity = quantity + $1, last_updated = NOW() WHERE id = $2`,
                        [delta, stockId]
                    );
                }

                // Update wh_received_qty on order_items to match received_qty
                if (item.order_item_id) {
                    await client.query(
                        `UPDATE order_items SET wh_received_qty = $1 WHERE id = $2`,
                        [received, item.order_item_id]
                    );
                }

                // Inventory transaction log
                await client.query(
                    `INSERT INTO inventory_transactions
                       (stock_id, variant_id, transaction_type, quantity, notes, reference_id, reference_type, created_by, created_at)
                     VALUES ($1, $2, 'receipt', $3, $4, $5, 'manufacturer_order', $6, NOW())`,
                    [stockId, item.variant_id, delta,
                     `تأكيد استلام نهائي — أمر ${mo.mo_number}`,
                     mo.id, req.user?.id]
                );
            }

            // Update MO status to 'received' and save tax_rate
            await client.query(
                `UPDATE manufacturer_orders
                 SET status = 'received', tax_rate = $1, updated_at = NOW()
                 WHERE id = $2`,
                [parseFloat(tax_rate || 0), mo.id]
            );

            totalUpdated++;
        }

        await client.query('COMMIT');
        res.json({
            success: true,
            message: `تم تأكيد ${totalUpdated} أمر مورد وتحديث المخزون بنجاح`,
            updated_count: totalUpdated
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[finalize] Error:', err);
        res.status(500).json({ message: err.message || 'فشل تأكيد الاستلام' });
    } finally {
        client.release();
    }
});

// ── POST /api/manufacturer-orders/:id/revert-send ────────────────────────────
// Revert send to supplier - change status from 'ordered' back to 'pending'
// Only allowed if no items have been received yet
router.post('/:id/revert-send', restrictEdit, async (req, res) => {
    const { id } = req.params;
    
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        
        // Check current status and if any items received
        const moRes = await client.query(
            `SELECT mo.status, COALESCE(SUM(moi.received_qty), 0) as total_received
             FROM manufacturer_orders mo
             LEFT JOIN manufacturer_order_items moi ON moi.manufacturer_order_id = mo.id
             WHERE mo.id = $1
             GROUP BY mo.id, mo.status`,
            [id]
        );
        
        if (!moRes.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'أمر المورد غير موجود' });
        }
        
        const mo = moRes.rows[0];
        
        // Only allow revert if status is 'ordered'
        if (mo.status !== 'sent') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'لا يمكن التراجع إلا إذا كان الأمر في حالة "تم الإرسال"' });
        }
        
        // Only allow if nothing received yet
        if (parseFloat(mo.total_received) > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'لا يمكن التراجع بعد بدء الاستلام' });
        }
        
        // Revert status to 'pending'
        await client.query(
            `UPDATE manufacturer_orders 
             SET status = 'pending', updated_at = NOW() 
             WHERE id = $1`,
            [id]
        );
        
        await client.query('COMMIT');
        return success(res, { message: 'تم تراجع الإرسال بنجاح - الأمر عاد لحالة "معلق"' });
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[revert-send] Error:', err);
        res.status(500).json({ message: err.message || 'فشل تراجع الإرسال' });
    } finally {
        client.release();
    }
});

// ── DELETE /api/manufacturer-orders/:id ───────────────────────────────────────
// Cancel/Delete MO - only allowed if status is 'pending' or 'ordered' (not received)
// Resets order items' manufacturer_po_qty to 0 (unassign them)
router.delete('/:id', restrictDelete, async (req, res) => {
    const { id } = req.params;
    
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        
        // Check MO status and get order_id
        const moRes = await client.query(
            `SELECT mo.status, mo.order_id, COALESCE(SUM(moi.received_qty), 0) as total_received
             FROM manufacturer_orders mo
             LEFT JOIN manufacturer_order_items moi ON moi.manufacturer_order_id = mo.id
             WHERE mo.id = $1
             GROUP BY mo.id, mo.status, mo.order_id`,
            [id]
        );
        
        if (!moRes.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'أمر المورد غير موجود' });
        }
        
        const mo = moRes.rows[0];
        
        // Only allow cancel if status is 'pending' or 'ordered' AND nothing received
        if (!['pending', 'sent'].includes(mo.status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'لا يمكن الإلغاء إلا للأوامر المعلقة أو المرسلة' });
        }
        
        if (parseFloat(mo.total_received) > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'لا يمكن الإلغاء بعد بدء الاستلام' });
        }
        
        // Get all order_item_ids to reset manufacturer_po_qty
        const itemsRes = await client.query(
            `SELECT order_item_id, mo_quantity FROM manufacturer_order_items WHERE manufacturer_order_id = $1`,
            [id]
        );
        
        // Reset manufacturer_po_qty for each order item
        for (const item of itemsRes.rows) {
            if (item.order_item_id) {
                // Get current manufacturer_po_qty and subtract this MO's quantity
                const currentRes = await client.query(
                    `SELECT manufacturer_po_qty FROM order_items WHERE id = $1`,
                    [item.order_item_id]
                );
                const currentQty = parseFloat(currentRes.rows[0]?.manufacturer_po_qty || 0);
                const moQty = parseFloat(item.mo_quantity || 0);
                const newQty = Math.max(0, currentQty - moQty);
                
                await client.query(
                    `UPDATE order_items SET manufacturer_po_qty = $1 WHERE id = $2`,
                    [newQty, item.order_item_id]
                );
            }
        }
        
        // Delete MO items first (foreign key constraint)
        await client.query(
            `DELETE FROM manufacturer_order_items WHERE manufacturer_order_id = $1`,
            [id]
        );
        
        // Delete the MO
        await client.query(
            `DELETE FROM manufacturer_orders WHERE id = $1`,
            [id]
        );
        
        await client.query('COMMIT');
        res.json({ 
            success: true, 
            message: 'تم إلغاء أمر المورد بنجاح',
            order_id: mo.order_id
        });
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[cancel-mo] Error:', err);
        res.status(500).json({ message: err.message || 'فشل إلغاء أمر المورد' });
    } finally {
        client.release();
    }
});

// ── POST /api/manufacturer-orders/revert-order/:orderId ───────────────────────
// Reverts entire order to archived (quotation) status.
// CONDITIONS: No MO may have any received items (received_qty > 0).
// ACTIONS:
//   1. Delete all MOs and their items
//   2. Reset manufacturer_po_qty = 0 on all order_items
//   3. Set order status = 'archived'
router.post('/revert-order/:orderId', restrictDelete, async (req, res) => {
    const { orderId } = req.params;

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // 1. Get all MOs for this order and check for any received items
        const mosRes = await client.query(
            `SELECT mo.id, mo.status,
                    COALESCE(SUM(moi.received_qty), 0) AS total_received
             FROM manufacturer_orders mo
             LEFT JOIN manufacturer_order_items moi ON moi.manufacturer_order_id = mo.id
             WHERE mo.order_id = $1
             GROUP BY mo.id, mo.status`,
            [orderId]
        );

        if (!mosRes.rows.length) {
            // No MOs — just archive the order
        } else {
            // Check if any MO has received items
            const hasReceived = mosRes.rows.some(mo => parseFloat(mo.total_received) > 0);
            if (hasReceived) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    message: 'لا يمكن التراجع — يوجد بضاعة مستلمة. يمكنك فقط إلغاء الموردين الذين لم يتم استلامهم.'
                });
            }

            // 2. For each MO, reset manufacturer_po_qty on order_items then delete MO
            for (const mo of mosRes.rows) {
                // Get this MO's items
                const itemsRes = await client.query(
                    `SELECT order_item_id, mo_quantity
                     FROM manufacturer_order_items
                     WHERE manufacturer_order_id = $1`,
                    [mo.id]
                );

                // Reset manufacturer_po_qty
                for (const item of itemsRes.rows) {
                    if (item.order_item_id) {
                        await client.query(
                            `UPDATE order_items
                             SET manufacturer_po_qty = GREATEST(0, COALESCE(manufacturer_po_qty, 0) - $1)
                             WHERE id = $2`,
                            [item.mo_quantity, item.order_item_id]
                        );
                    }
                }

                // Delete MO items then MO
                await client.query(
                    `DELETE FROM manufacturer_order_items WHERE manufacturer_order_id = $1`,
                    [mo.id]
                );
                await client.query(
                    `DELETE FROM manufacturer_orders WHERE id = $1`,
                    [mo.id]
                );
            }
        }

        // 3. Archive the order
        const orderRes = await client.query(
            `UPDATE orders SET status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING id, order_number`,
            [orderId]
        );

        if (!orderRes.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'الأوردر غير موجود' });
        }

        await client.query('COMMIT');
        res.json({
            success: true,
            message: `تم أرشفة الأوردر #${orderRes.rows[0].order_number} بنجاح`,
            order_number: orderRes.rows[0].order_number
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[revert-order] Error:', err);
        res.status(500).json({ message: err.message || 'فشل التراجع عن الأوردر' });
    } finally {
        client.release();
    }
});

module.exports = router;
