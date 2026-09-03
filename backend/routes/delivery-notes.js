/**
 * Delivery Notes Routes
 * /api/delivery-notes
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const authorize = require('../middleware/authorize');
const { validateBody, deliveryNoteCreate, deliveryNoteDispatch } = require('../utils/validators');
const eventBus = require('../utils/event-bus');

// ── Auto-complete order when all delivery notes are fully delivered ──────────
// Called after a delivery note becomes 'completed'.
// Checks if ALL delivery notes for the order are 'completed', and if so,
// transitions the order to 'completed' (if currently in production/processing).
async function _autoCompleteOrderOnDelivery(client, orderId) {
    if (!orderId) return;
    const orderRes = await client.query(
        `SELECT status FROM orders WHERE id = $1`,
        [orderId]
    );
    if (!orderRes.rows.length) return;
    const currentStatus = orderRes.rows[0].status;
    if (!['production', 'processing'].includes(currentStatus)) return;

    const dnRes = await client.query(
        `SELECT status FROM delivery_notes WHERE order_id = $1`,
        [orderId]
    );
    if (!dnRes.rows.length) return;
    const allCompleted = dnRes.rows.every(r => r.status === 'completed');
    if (!allCompleted) return;

    await client.query(
        `UPDATE orders SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [orderId]
    );
    console.log(`[autoStatus] Order ${orderId}: ${currentStatus} → completed (delivery finalized)`);
}

// View permission: 'vmi_dispatch' OR 'production_orders' view can access
router.use((req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { role, permissions } = req.user;
    if (role === 'super_admin' || role === 'admin') return next();
    if (permissions && permissions.all_access === true) return next();
    const _hasView = (key) => permissions && permissions[key] && (
        (typeof permissions[key] === 'object' && !Array.isArray(permissions[key]) && permissions[key].view === true) ||
        (Array.isArray(permissions[key]) && permissions[key].includes('view')) ||
        (typeof permissions[key] === 'boolean' && permissions[key] === true)
    );
    // GET: allow production_orders (hub tab shows delivery notes)
    if (req.method === 'GET' && (_hasView('vmi_dispatch') || _hasView('production_orders'))) return next();
    // Non-GET: require vmi_dispatch
    if (_hasView('vmi_dispatch')) return next();
    return res.status(403).json({ error: 'Forbidden: No view permission on vmi_dispatch.' });
});
const restrictWrite = authorize('vmi_dispatch', 'create');

// =============================================================================
// GET /api/delivery-notes
// List delivery notes with optional filters
// =============================================================================

router.get('/', async (req, res) => {
    const { status, client_id, order_id } = req.query;
    
    try {
        let query = `
            SELECT 
                dn.id,
                dn.note_number,
                dn.order_id,
                o.order_number,
                dn.client_id,
                dn.invoice_id,
                c.name AS client_name,
                pc.name AS parent_client_name,
                dn.status,
                dn.notes,
                dn.created_at,
                dn.updated_at,
                COUNT(dni.id) AS item_count,
                COALESCE((
                    SELECT json_agg(json_build_object(
                        'id', item.id,
                        'delivery_note_id', item.delivery_note_id,
                        'order_item_id', item.order_item_id,
                        'variant_id', item.variant_id,
                        'product_name', item.product_name,
                        'variant_name', item.variant_name,
                        'requested_qty', item.requested_qty,
                        'quantity', item.quantity,
                        'delivered_qty', item.delivered_qty,
                        'notes', item.notes
                    ) ORDER BY item.id)
                    FROM (
                        SELECT dni2.id,
                               dni2.delivery_note_id,
                               dni2.order_item_id,
                               dni2.variant_id,
                               p2.name AS product_name,
                               pv2.size_name AS variant_name,
                               dni2.requested_qty,
                               dni2.requested_qty AS quantity,
                               dni2.delivered_qty,
                               dni2.notes
                        FROM delivery_note_items dni2
                        LEFT JOIN order_items oi2 ON oi2.id = dni2.order_item_id
                        LEFT JOIN product_variants pv2 ON pv2.id = COALESCE(dni2.variant_id, oi2.variant_id)
                        LEFT JOIN products p2 ON p2.id = pv2.product_id
                        WHERE dni2.delivery_note_id = dn.id
                    ) item
                ), '[]'::json) AS items
            FROM delivery_notes dn
            LEFT JOIN orders o ON o.id = dn.order_id
            LEFT JOIN clients c ON c.id = dn.client_id
            LEFT JOIN clients pc ON pc.id = c.parent_id
            LEFT JOIN delivery_note_items dni ON dni.delivery_note_id = dn.id
            WHERE 1=1
        `;
        
        const params = [];
        let paramIdx = 1;
        
        if (status) {
            query += ` AND dn.status = $${paramIdx++}`;
            params.push(status);
        }
        
        if (client_id) {
            query += ` AND dn.client_id = $${paramIdx++}`;
            params.push(client_id);
        }
        
        if (order_id) {
            query += ` AND dn.order_id = $${paramIdx++}`;
            params.push(order_id);
        }
        
        query += ` GROUP BY dn.id, dn.note_number, dn.order_id, o.order_number, dn.client_id, dn.invoice_id, c.name, pc.name, dn.status, dn.notes, dn.created_at, dn.updated_at`;
        query += ` ORDER BY dn.created_at DESC`;
        
        const result = await db.query(query, params);
        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[DeliveryNotes] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/delivery-notes
// Create a delivery note (optionally tied to an order).
// Body: { order_id?, client_id, items: [{ variant_id, quantity/requested_qty }], notes, driver_name, vehicle_number }
// =============================================================================

router.post('/', restrictWrite, validateBody(deliveryNoteCreate), async (req, res) => {
    const {
        order_id = null,
        client_id,
        warehouse_id = null,
        items = [],
        notes = null,
        driver_name = null,
        vehicle_number = null
    } = req.validatedBody;

    if (!client_id) {
        return res.status(400).json({ error: 'يجب اختيار العميل.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'يجب إدراج أصناف.' });
    }

    try {
        const result = await db.withTransaction(async (client) => {
            // Verify client exists
            const clientCheck = await client.query('SELECT id, name FROM clients WHERE id = $1', [client_id]);
            if (clientCheck.rowCount === 0) throw new Error('العميل غير موجود.');

            // Validate items against warehouse_stock (only for standalone, non-order delivery notes)
            if (!order_id) {
                for (const item of items) {
                    if (!item.variant_id || !item.requested_qty || item.requested_qty <= 0) continue;

                    const stockRes = await client.query(
                        `SELECT id, quantity, available_qty FROM warehouse_stock
                         WHERE variant_id = $1
                         AND (
                             client_id = $2
                             OR client_id IS NULL
                             OR client_id IN (SELECT parent_id FROM clients WHERE id = $2)
                         )
                         ${warehouse_id ? 'AND warehouse_id = $3' : ''}
                         ORDER BY quantity DESC LIMIT 1`,
                        warehouse_id ? [item.variant_id, client_id, warehouse_id] : [item.variant_id, client_id]
                    );

                    if (stockRes.rowCount === 0) {
                        throw new Error('لا يوجد مخزون لهذا الصنف لهذا العميل.');
                    }
                    const available = parseFloat(stockRes.rows[0].available_qty || stockRes.rows[0].quantity || 0);
                    if (item.requested_qty > available) {
                        throw new Error(`الكمية المطلوبة (${item.requested_qty}) تتجاوز المتاح (${available}).`);
                    }
                }
            }

            // Create delivery note (with order_id if provided)
            const dnRes = await client.query(
                `INSERT INTO delivery_notes (order_id, client_id, warehouse_id, status, notes, driver_name, vehicle_number, created_by)
                 VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)
                 RETURNING id, note_number`,
                [order_id, client_id, warehouse_id, notes, driver_name, vehicle_number, req.user?.id]
            );
            const dnId = dnRes.rows[0].id;
            const noteNumber = dnRes.rows[0].note_number;

            // Insert items
            for (const item of items) {
                const qty = item.quantity || item.requested_qty || 0;
                if (!item.variant_id || qty <= 0) continue;

                // If order_id provided, resolve order_item_id
                let orderItemId = item.order_item_id || null;
                if (!orderItemId && order_id && item.variant_id) {
                    const oiRes = await client.query(
                        `SELECT id FROM order_items WHERE order_id = $1 AND variant_id = $2 LIMIT 1`,
                        [order_id, item.variant_id]
                    );
                    if (oiRes.rowCount > 0) orderItemId = oiRes.rows[0].id;
                }

                await client.query(
                    `INSERT INTO delivery_note_items (delivery_note_id, order_item_id, variant_id, requested_qty, delivered_qty, notes, created_at)
                     VALUES ($1, $2, $3, $4, 0, $5, NOW())`,
                    [dnId, orderItemId, item.variant_id, qty, item.notes || null]
                );
            }

            // ── Internal notification: release order for warehouse keeper ──────
            // Written inside the transaction so it's atomic with the delivery note.
            try {
                let orderNum = null;
                let clientName = clientCheck.rows[0]?.name || '—';
                let warehouseName = null;

                if (order_id) {
                    // Get order number + warehouse name from the first reserved
                    // stock row for this order (the warehouse the goods will be
                    // dispatched from). Falls back to the provided warehouse_id.
                    const ordRes = await client.query(
                        `SELECT o.order_number, w.name AS warehouse_name
                         FROM orders o
                         LEFT JOIN warehouses w ON w.id = COALESCE($2, (
                             SELECT ws.warehouse_id
                             FROM warehouse_stock ws
                             JOIN order_items oi ON oi.variant_id = ws.variant_id
                             WHERE oi.order_id = o.id
                               AND ws.reserved_qty > 0
                             LIMIT 1
                         ))
                         WHERE o.id = $1`,
                        [order_id, warehouse_id]
                    );
                    orderNum = ordRes.rows[0]?.order_number || null;
                    warehouseName = ordRes.rows[0]?.warehouse_name || null;
                }

                const itemsSummary = items
                    .map(i => `• ${i.variant_id || '—'} — ${i.requested_qty || i.quantity || 0}`)
                    .join('\n');

                // Resolve variant names for a readable items summary
                let itemsSummaryNamed = itemsSummary;
                const variantIds = items.map(i => i.variant_id).filter(Boolean);
                if (variantIds.length > 0) {
                    const varRes = await client.query(
                        `SELECT pv.id, p.name AS product_name, pv.size_name
                         FROM product_variants pv
                         JOIN products p ON p.id = pv.product_id
                         WHERE pv.id = ANY($1::uuid[])`,
                        [variantIds]
                    );
                    const varMap = {};
                    for (const v of varRes.rows) varMap[v.id] = `${v.product_name} (${v.size_name})`;
                    itemsSummaryNamed = items
                        .map(i => {
                            const name = varMap[i.variant_id] || '—';
                            const qty = i.requested_qty || i.quantity || 0;
                            return `• ${name} — ${qty}`;
                        })
                        .join('\n');
                }

                const NotificationService = require('../services/notification-service');
                await NotificationService.writeOutboxEvent({
                    event_type: 'release_order_created',
                    entity_type: 'delivery_note',
                    entity_id: dnId,
                    correlation_id: NotificationService.generateCorrelationId('REL'),
                    payload: {
                        order_id: order_id,
                        order_number: orderNum,
                        delivery_note_id: dnId,
                        delivery_note_number: noteNumber,
                        client_name: clientName,
                        items_summary: itemsSummaryNamed,
                        warehouse_name: warehouseName,
                    },
                    session: 'internal',
                }, client);
            } catch (outboxErr) {
                console.error('[DeliveryNotes] Outbox write error:', outboxErr.message);
            }

            return { id: dnId, note_number: noteNumber };
        });

        // Emit business event
        eventBus.emit({
            event_type: 'delivery_created',
            entity_type: 'delivery',
            entity_id: result.id,
            entity_name: `#${result.note_number}`,
            description: `سند تسليم جديد #${result.note_number}`,
            metadata: { order_id: order_id, client_id: client_id },
            created_by: req.user?.id,
        });

        return res.status(201).json({ data: result, message: 'تم إصدار سند التسليم بنجاح.' });
    } catch (err) {
        console.error('[DeliveryNotes] POST / error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/delivery-notes/:id
// Get single delivery note with items
// =============================================================================

router.get('/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Get delivery note header
        const dnResult = await db.query(
            `SELECT 
                dn.id,
                dn.note_number,
                dn.order_id,
                o.order_number,
                dn.client_id,
                dn.invoice_id,
                c.name AS client_name,
                pc.name AS parent_client_name,
                dn.warehouse_id,
                w.name AS warehouse_name,
                dn.status,
                dn.notes,
                dn.driver_name,
                dn.vehicle_number,
                dn.created_at,
                dn.updated_at
             FROM delivery_notes dn
             LEFT JOIN orders o ON o.id = dn.order_id
             LEFT JOIN clients c ON c.id = dn.client_id
             LEFT JOIN clients pc ON pc.id = c.parent_id
             LEFT JOIN warehouses w ON w.id = dn.warehouse_id
             WHERE dn.id = $1`,
            [id]
        );
        
        if (dnResult.rowCount === 0) {
            return res.status(404).json({ error: 'سند التسليم غير موجود.' });
        }
        
        const deliveryNote = dnResult.rows[0];
        
        // Get delivery note items
        const itemsResult = await db.query(
            `SELECT 
                dni.id,
                dni.delivery_note_id,
                dni.order_item_id,
                dni.variant_id,
                p.name AS product_name,
                pv.size_name AS variant_name,
                dni.requested_qty,
                dni.requested_qty AS quantity,
                dni.delivered_qty,
                dni.notes
             FROM delivery_note_items dni
             LEFT JOIN order_items oi ON oi.id = dni.order_item_id
             LEFT JOIN product_variants pv ON pv.id = COALESCE(dni.variant_id, oi.variant_id)
             LEFT JOIN products p ON p.id = pv.product_id
             WHERE dni.delivery_note_id = $1`,
            [id]
        );
        
        deliveryNote.items = itemsResult.rows;

        return res.status(200).json({ data: deliveryNote });
    } catch (err) {
        console.error('[DeliveryNotes] GET /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/delivery-notes/:id/dispatch
// Register a partial (or full) physical delivery. Creates a dispatch record.
// Body: { items: [{ item_id, quantity }], notes }
// =============================================================================

router.post('/:id/dispatch', restrictWrite, validateBody(deliveryNoteDispatch), async (req, res) => {
    const { id } = req.params;
    const { items, notes: deliveryNotes } = req.validatedBody;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items array is required.' });
    }

    try {
        const result = await db.withTransaction(async (client) => {
            // Load delivery note
            const dnCheck = await client.query(
                `SELECT dn.*, COALESCE(o.client_id, dn.client_id) AS client_id FROM delivery_notes dn
                 LEFT JOIN orders o ON o.id = dn.order_id
                 WHERE dn.id = $1`,
                [id]
            );
            if (dnCheck.rowCount === 0) throw new Error('سند التسليم غير موجود.');
            const dn = dnCheck.rows[0];

            // Create a dispatch record for this specific handover
            const nextNumRes = await client.query(
                `SELECT COALESCE(MAX(dispatch_number), 0) + 1 AS next_num FROM delivery_note_dispatches WHERE delivery_note_id = $1`,
                [id]
            );
            const dispatchNumber = nextNumRes.rows[0].next_num;

            const dispatchRes = await client.query(
                `INSERT INTO delivery_note_dispatches (delivery_note_id, dispatch_number, notes, created_by)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, dispatch_number`,
                [id, dispatchNumber, deliveryNotes || null, req.user?.id || null]
            );
            const dispatchId = dispatchRes.rows[0].id;

            // Process each item
            for (const item of items) {
                if (!item.item_id || !item.quantity || item.quantity <= 0) continue;

                // Validate: cannot exceed remaining qty
                const dniCheck = await client.query(
                    `SELECT requested_qty, delivered_qty FROM delivery_note_items WHERE id = $1`,
                    [item.item_id]
                );
                if (dniCheck.rowCount === 0) continue;

                const { requested_qty, delivered_qty } = dniCheck.rows[0];
                const remaining = parseFloat(requested_qty) - parseFloat(delivered_qty);
                if (item.quantity > remaining) {
                    throw new Error(`الكمية (${item.quantity}) تتجاوز المتبقي (${remaining}).`);
                }

                // Get variant + order item (use LEFT JOIN since standalone notes have no order_item_id)
                const itemResult = await client.query(
                    `SELECT dni.order_item_id, dni.source_stock_id,
                            COALESCE(dni.variant_id, oi.variant_id) AS variant_id
                     FROM delivery_note_items dni
                     LEFT JOIN order_items oi ON oi.id = dni.order_item_id
                     WHERE dni.id = $1`,
                    [item.item_id]
                );
                if (itemResult.rowCount === 0) continue;

                const { order_item_id: orderItemId, source_stock_id: sourceStockId, variant_id: variantId } = itemResult.rows[0];
                if (!variantId) continue;

                const stockResult = await client.query(
                    `SELECT ws.id, ws.quantity, ws.reserved_qty
                     FROM warehouse_stock ws
                     WHERE ws.variant_id = $1
                       AND ($2::uuid IS NULL OR ws.id = $2)
                       AND ($3::uuid IS NULL OR ws.warehouse_id = $3)
                       AND (
                           ws.client_id = $4
                           OR (ws.client_id IS NULL AND $2::uuid IS NULL)
                           OR (ws.client_id IN (SELECT parent_id FROM clients WHERE id = $4) AND $2::uuid IS NULL)
                       )
                     ORDER BY CASE WHEN ws.client_id = $4 THEN 0 ELSE 1 END, ws.quantity DESC
                     LIMIT 1
                     FOR UPDATE`,
                    [sourceStockId || null, sourceStockId || null, dn.warehouse_id || null, dn.client_id]
                );
                if (stockResult.rowCount === 0) throw new Error('سجل المخزون غير موجود في المستودع المحدد.');
                const stock = stockResult.rows[0];
                const quantity = parseFloat(stock.quantity || 0);
                const reserved = parseFloat(stock.reserved_qty || 0);
                const available = sourceStockId && reserved >= item.quantity ? quantity : quantity - reserved;
                if (item.quantity > available) {
                    throw new Error(`المخزون غير كافٍ — المتاح: ${available}، المطلوب: ${item.quantity}.`);
                }

                const stockId = stock.id;

                // Record this item in the dispatch
                await client.query(
                    `INSERT INTO delivery_dispatch_items (dispatch_id, dn_item_id, quantity)
                     VALUES ($1, $2, $3)`,
                    [dispatchId, item.item_id, item.quantity]
                );

                // Update delivered_qty on delivery_note_items
                await client.query(
                    `UPDATE delivery_note_items SET delivered_qty = delivered_qty + $1 WHERE id = $2`,
                    [item.quantity, item.item_id]
                );

                // Update order item delivered quantity (only if linked to an order)
                if (orderItemId) {
                    await client.query(
                        `UPDATE order_items SET delivered_qty = COALESCE(delivered_qty, 0) + $1 WHERE id = $2`,
                        [item.quantity, orderItemId]
                    );
                }

                // Deduct from stock
                await client.query(
                    `UPDATE warehouse_stock
                     SET quantity = quantity - $1,
                         reserved_qty = CASE WHEN $3::boolean THEN GREATEST(0, reserved_qty - $1) ELSE reserved_qty END,
                         last_updated = NOW()
                     WHERE id = $2`,
                    [item.quantity, stockId, Boolean(sourceStockId)]
                );

                // Create inventory transaction
                await client.query(
                    `INSERT INTO inventory_transactions (stock_id, variant_id, transaction_type, quantity, notes, reference_id, reference_type, created_by, created_at)
                     VALUES ($1, $2, 'dispense', $3, $4, $5, 'delivery_note', $6, NOW())`,
                    [stockId, variantId, item.quantity, deliveryNotes || `تسليم - سند تسليم #${dn.note_number}`, id, req.user?.id]
                );
            }

            // Update delivery note status
            const checkItems = await client.query(
                `SELECT requested_qty, delivered_qty FROM delivery_note_items WHERE delivery_note_id = $1`,
                [id]
            );
            const allDelivered = checkItems.rows.every(r => parseFloat(r.delivered_qty) >= parseFloat(r.requested_qty));
            const someDelivered = checkItems.rows.some(r => parseFloat(r.delivered_qty) > 0);
            const newStatus = allDelivered ? 'completed' : someDelivered ? 'partial' : 'pending';

            await client.query(
                `UPDATE delivery_notes SET status = $1, updated_at = NOW() WHERE id = $2`,
                [newStatus, id]
            );

            // Auto-complete parent order when all delivery notes are finalized
            if (newStatus === 'completed') {
                if (dn.order_id) await _autoCompleteOrderOnDelivery(client, dn.order_id);
                if (dn.invoice_id) {
                    await client.query(
                        `UPDATE invoices SET delivery_status = 'completed', status = 'archived' WHERE id = $1 AND status <> 'cancelled'`,
                        [dn.invoice_id]
                    );
                }
            } else if (dn.invoice_id) {
                await client.query(
                    `UPDATE invoices SET delivery_status = 'partial' WHERE id = $1 AND status <> 'cancelled'`,
                    [dn.invoice_id]
                );
            }

            return { status: newStatus, dispatch_id: dispatchId, dispatch_number: dispatchNumber };
        });

        // Emit business event
        eventBus.emit({
            event_type: result.status === 'completed' ? 'delivery_completed' : 'delivery_partial',
            entity_type: 'delivery',
            entity_id: id,
            entity_name: `#${result.dispatch_number}`,
            description: result.status === 'completed' ? `تسليم مكتمل` : `تسليم جزئي`,
            metadata: { dispatch_id: result.dispatch_id, status: result.status },
            created_by: req.user?.id,
        });

        return res.status(200).json({ message: 'تم تسجيل التسليم بنجاح.', data: result });
    } catch (err) {
        console.error('[DeliveryNotes] POST /:id/dispatch error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/delivery-notes/:id/dispatches
// List all dispatches for a delivery note (each = one physical handover)
// =============================================================================

router.get('/:id/dispatches', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            `SELECT dnd.id, dnd.dispatch_number, dnd.notes, dnd.created_at,
                    u.name AS created_by_name,
                    (SELECT COALESCE(SUM(ddi.quantity), 0) FROM delivery_dispatch_items ddi WHERE ddi.dispatch_id = dnd.id) AS total_qty,
                    (SELECT COUNT(*) FROM delivery_dispatch_items ddi WHERE ddi.dispatch_id = dnd.id) AS item_count
             FROM delivery_note_dispatches dnd
             LEFT JOIN users u ON u.id = dnd.created_by
             WHERE dnd.delivery_note_id = $1
             ORDER BY dnd.dispatch_number ASC`,
            [id]
        );
        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[DeliveryNotes] GET /:id/dispatches error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/delivery-notes/:id/dispatches/:dispatchId
// Get a single dispatch with its items (for printing individual delivery slip)
// =============================================================================

router.get('/:id/dispatches/:dispatchId', async (req, res) => {
    try {
        const { id, dispatchId } = req.params;

        const dnRes = await db.query(
            `SELECT dn.id, dn.note_number, dn.driver_name, dn.vehicle_number,
                    dn.client_id, c.name AS client_name, pc.name AS parent_client_name,
                    dn.order_id, o.order_number,
                    dn.status, dn.created_at
             FROM delivery_notes dn
             LEFT JOIN orders o ON o.id = dn.order_id
             LEFT JOIN clients c ON c.id = dn.client_id
             LEFT JOIN clients pc ON pc.id = c.parent_id
             WHERE dn.id = $1`,
            [id]
        );
        if (dnRes.rowCount === 0) return res.status(404).json({ error: 'سند التسليم غير موجود.' });

        const dispatchRes = await db.query(
            `SELECT dnd.id, dnd.dispatch_number, dnd.notes, dnd.created_at,
                    u.name AS created_by_name
             FROM delivery_note_dispatches dnd
             LEFT JOIN users u ON u.id = dnd.created_by
             WHERE dnd.delivery_note_id = $1 AND dnd.id = $2`,
            [id, dispatchId]
        );
        if (dispatchRes.rowCount === 0) return res.status(404).json({ error: 'سند التسليم غير موجود.' });

        const itemsRes = await db.query(
            `SELECT ddi.id, ddi.quantity,
                    dni.id AS dn_item_id, dni.requested_qty,
                    p.name AS product_name, pv.size_name AS variant_name
             FROM delivery_dispatch_items ddi
             JOIN delivery_note_items dni ON dni.id = ddi.dn_item_id
             LEFT JOIN product_variants pv ON pv.id = COALESCE(dni.variant_id, (SELECT oi.variant_id FROM order_items oi WHERE oi.id = dni.order_item_id))
             LEFT JOIN products p ON p.id = pv.product_id
             WHERE ddi.dispatch_id = $1
             ORDER BY ddi.id`,
            [dispatchId]
        );

        const data = {
            ...dnRes.rows[0],
            ...dispatchRes.rows[0],
            items: itemsRes.rows,
        };

        return res.status(200).json({ data });
    } catch (err) {
        console.error('[DeliveryNotes] GET /:id/dispatches/:dispatchId error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/delivery-notes/:id/confirm  (kept for backward compat — redirects to dispatch logic)
// =============================================================================

router.post('/:id/confirm', restrictWrite, validateBody(deliveryNoteDispatch), async (req, res) => {
    const { id } = req.params;
    const { items, notes: deliveryNotes } = req.validatedBody;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items array is required.' });
    }
    
    try {
        await db.withTransaction(async (client) => {
            // Get delivery note
            const dnCheck = await client.query(
                `SELECT dn.*, COALESCE(o.client_id, dn.client_id) AS client_id FROM delivery_notes dn
                 LEFT JOIN orders o ON o.id = dn.order_id
                 WHERE dn.id = $1`,
                [id]
            );
            
            if (dnCheck.rowCount === 0) {
                throw new Error('سند التسليم غير موجود.');
            }
            
            const dn = dnCheck.rows[0];

            if (dn.status === 'completed') {
                throw new Error('سند التسليم مكتمل بالفعل ولا يمكن التعديل عليه.');
            }
            
            // Process each item
            for (const item of items) {
                if (!item.item_id || !item.quantity || item.quantity <= 0) continue;

                // ── Validate: cannot exceed remaining qty ──────────────────────
                const dniCheck = await client.query(
                    `SELECT requested_qty, delivered_qty FROM delivery_note_items WHERE id = $1`,
                    [item.item_id]
                );
                if (dniCheck.rowCount === 0) continue;

                const { requested_qty, delivered_qty } = dniCheck.rows[0];
                const remaining = parseFloat(requested_qty) - parseFloat(delivered_qty);
                if (item.quantity > remaining) {
                    throw new Error(`الكمية المُسلَّمة (${item.quantity}) تتجاوز المتبقي (${remaining}) للصنف.`);
                }

                // Get variant + order item (use LEFT JOIN since standalone notes have no order_item_id)
                const itemResult = await client.query(
                    `SELECT dni.order_item_id, dni.source_stock_id,
                            COALESCE(dni.variant_id, oi.variant_id) AS variant_id
                     FROM delivery_note_items dni
                     LEFT JOIN order_items oi ON oi.id = dni.order_item_id
                     WHERE dni.id = $1`,
                    [item.item_id]
                );
                
                if (itemResult.rowCount === 0) continue;
                
                const orderItemId = itemResult.rows[0].order_item_id;
                const sourceStockId = itemResult.rows[0].source_stock_id;
                const variantId = itemResult.rows[0].variant_id;
                if (!variantId) continue;

                const stockResult = await client.query(
                    `SELECT id, quantity, reserved_qty FROM warehouse_stock
                     WHERE variant_id = $1
                       AND ($2::uuid IS NULL OR id = $2)
                       AND ($3::uuid IS NULL OR warehouse_id = $3)
                       AND (client_id = $4 OR (client_id IS NULL AND $2::uuid IS NULL) OR (client_id IN (SELECT parent_id FROM clients WHERE id = $4) AND $2::uuid IS NULL))
                     LIMIT 1 FOR UPDATE`,
                    [variantId, sourceStockId || null, dn.warehouse_id || null, dn.client_id]
                );

                if (stockResult.rowCount === 0) throw new Error('سجل المخزون غير موجود في المستودع المحدد.');
                const stock = stockResult.rows[0];
                const quantity = parseFloat(stock.quantity || 0);
                const reserved = parseFloat(stock.reserved_qty || 0);
                const available = sourceStockId && reserved >= item.quantity ? quantity : quantity - reserved;
                if (item.quantity > available) {
                    throw new Error(`المخزون غير كافٍ — المتاح: ${available}، المطلوب: ${item.quantity}.`);
                }

                const stockId = stock.id;

                // Update delivered quantity
                await client.query(
                    `UPDATE delivery_note_items 
                     SET delivered_qty = delivered_qty + $1
                     WHERE id = $2`,
                    [item.quantity, item.item_id]
                );
                
                // Update order item delivered quantity (only if linked to an order)
                if (orderItemId) {
                    await client.query(
                        `UPDATE order_items SET delivered_qty = COALESCE(delivered_qty, 0) + $1 WHERE id = $2`,
                        [item.quantity, orderItemId]
                    );
                }
                
                // Deduct from stock
                await client.query(
                    `UPDATE warehouse_stock
                     SET quantity = quantity - $1,
                         reserved_qty = CASE WHEN $3::boolean THEN GREATEST(0, reserved_qty - $1) ELSE reserved_qty END,
                         last_updated = NOW()
                     WHERE id = $2`,
                    [item.quantity, stockId, Boolean(sourceStockId)]
                );
                
                // Create inventory transaction
                await client.query(
                    `INSERT INTO inventory_transactions (stock_id, variant_id, transaction_type, quantity, notes, reference_id, reference_type, created_by, created_at)
                     VALUES ($1, $2, 'dispense', $3, $4, $5, 'delivery_note', $6, NOW())`,
                    [stockId, variantId, item.quantity, deliveryNotes || `تسليم - ${dn.note_number}`, id, req.user?.id]
                );
            }
            
            // Check if all items are fully delivered
            const checkItems = await client.query(
                `SELECT requested_qty AS quantity, delivered_qty FROM delivery_note_items WHERE delivery_note_id = $1`,
                [id]
            );
            
            const allDelivered = checkItems.rows.every(item => item.delivered_qty >= item.quantity);
            const someDelivered = checkItems.rows.some(item => item.delivered_qty > 0);
            
            let newStatus = 'pending';
            if (allDelivered) {
                newStatus = 'completed';
            } else if (someDelivered) {
                newStatus = 'partial';
            }
            
            // Update delivery note status and notes
            await client.query(
                `UPDATE delivery_notes SET status = $1, notes = COALESCE($2, notes), updated_at = NOW() WHERE id = $3`,
                [newStatus, deliveryNotes || null, id]
            );

            if (newStatus === 'completed') {
                if (dn.order_id) await _autoCompleteOrderOnDelivery(client, dn.order_id);
                if (dn.invoice_id) {
                    await client.query(
                        `UPDATE invoices SET delivery_status = 'completed', status = 'archived' WHERE id = $1 AND status <> 'cancelled'`,
                        [dn.invoice_id]
                    );
                }
            } else if (dn.invoice_id) {
                await client.query(
                    `UPDATE invoices SET delivery_status = 'partial' WHERE id = $1 AND status <> 'cancelled'`,
                    [dn.invoice_id]
                );
            }
        });
        
        return res.status(200).json({ message: 'تم تأكيد التسليم بنجاح.' });
    } catch (err) {
        console.error('[DeliveryNotes] POST /:id/confirm error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

// =============================================================================
// DELETE /api/delivery-notes/:id
// Delete delivery note (only if pending)
// =============================================================================
// POST /api/delivery-notes/:id/reverse
// Reverse all dispatches on a delivery note: return stock, reset delivered_qty,
// set status back to 'pending'. Only allowed if status is 'partial' or 'completed'.
// =============================================================================

router.post('/:id/reverse', restrictWrite, async (req, res) => {
    const { id } = req.params;

    try {
        const result = await db.withTransaction(async (client) => {
            const dnCheck = await client.query(
                `SELECT dn.id, dn.status, dn.note_number, dn.client_id, dn.warehouse_id, dn.invoice_id
                 FROM delivery_notes dn WHERE dn.id = $1 FOR UPDATE`,
                [id]
            );
            if (dnCheck.rowCount === 0) throw new Error('سند التسليم غير موجود.');
            const dn = dnCheck.rows[0];
            if (dn.status === 'pending') throw new Error('سند التسليم لم يتم تسليمه بعد، لا يوجد ما يمكن التراجع عنه.');

            // Get all items with their delivered_qty and variant info
            const itemsRes = await client.query(
                `SELECT dni.id, dni.order_item_id, dni.variant_id, dni.source_stock_id, dni.delivered_qty,
                        oi.id AS oi_id
                 FROM delivery_note_items dni
                 LEFT JOIN order_items oi ON oi.id = dni.order_item_id
                 WHERE dni.delivery_note_id = $1 AND dni.delivered_qty > 0`,
                [id]
            );

            for (const item of itemsRes.rows) {
                const delQty = parseFloat(item.delivered_qty);
                if (delQty <= 0) continue;

                const stockRes = await client.query(
                    `SELECT id, quantity FROM warehouse_stock
                     WHERE variant_id = $1
                       AND ($2::uuid IS NULL OR id = $2)
                       AND ($3::uuid IS NULL OR warehouse_id = $3)
                       AND (client_id = $4 OR (client_id IS NULL AND $2::uuid IS NULL) OR (client_id IN (SELECT parent_id FROM clients WHERE id = $4) AND $2::uuid IS NULL))
                     LIMIT 1 FOR UPDATE`,
                    [item.variant_id, item.source_stock_id || null, dn.warehouse_id || null, dn.client_id]
                );
                if (stockRes.rowCount > 0) {
                    await client.query(
                        `UPDATE warehouse_stock
                         SET quantity = quantity + $1,
                             reserved_qty = CASE WHEN $3::boolean THEN reserved_qty + $1 ELSE reserved_qty END,
                             last_updated = NOW()
                         WHERE id = $2`,
                        [delQty, stockRes.rows[0].id, Boolean(item.source_stock_id)]
                    );
                } else {
                    // Re-create stock record — use parent client_id if this is a branch
                    const parentRes = await client.query('SELECT parent_id FROM clients WHERE id = $1', [dn.client_id]);
                    const stockClientId = parentRes.rowCount > 0 && parentRes.rows[0].parent_id ? parentRes.rows[0].parent_id : dn.client_id;
                    await client.query(
                        `INSERT INTO warehouse_stock (variant_id, client_id, quantity, last_updated)
                         VALUES ($1, $2, $3, NOW())`,
                        [item.variant_id, stockClientId, delQty]
                    );
                }

                // Reverse order_items delivered_qty (only if linked to an order)
                if (item.order_item_id) {
                    await client.query(
                        `UPDATE order_items SET delivered_qty = GREATEST(0, COALESCE(delivered_qty, 0) - $1) WHERE id = $2`,
                        [delQty, item.order_item_id]
                    );
                }

                // Reset delivery_note_items delivered_qty
                await client.query(
                    `UPDATE delivery_note_items SET delivered_qty = 0 WHERE id = $1`,
                    [item.id]
                );

                // Create inventory transaction for reversal
                const stockId = stockRes.rowCount > 0 ? stockRes.rows[0].id : null;
                await client.query(
                    `INSERT INTO inventory_transactions (stock_id, variant_id, transaction_type, quantity, notes, reference_id, reference_type, created_by, created_at)
                     VALUES ($1, $2, 'return', $3, $4, $5, 'delivery_note', $6, NOW())`,
                    [stockId, item.variant_id, delQty, `تراجع عن تسليم - سند تسليم #${dn.note_number}`, id, req.user?.id]
                );
            }

            // Set status back to pending
            await client.query(
                `UPDATE delivery_notes SET status = 'pending', updated_at = NOW() WHERE id = $1`,
                [id]
            );
            if (dn.invoice_id) {
                await client.query(
                    `UPDATE invoices SET status = 'issued', delivery_status = 'pending' WHERE id = $1 AND status <> 'cancelled'`,
                    [dn.invoice_id]
                );
            }

            return { note_number: dn.note_number, reversed_items: itemsRes.rowCount };
        });

        return res.status(200).json({ data: result, message: 'تم التراجع عن التسليم بنجاح. تم إرجاع الكميات للمخزون.' });
    } catch (err) {
        console.error('[DeliveryNotes] POST /:id/reverse error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

// =============================================================================
// DELETE /api/delivery-notes/:id
// Delete delivery note (only if pending)
// =============================================================================
router.delete('/:id', restrictWrite, async (req, res) => {
    const { id } = req.params;
    
    try {
        await db.withTransaction(async (client) => {
            // Check delivery note exists and is pending
            const checkResult = await client.query(
                `SELECT status FROM delivery_notes WHERE id = $1`,
                [id]
            );
            
            if (checkResult.rowCount === 0) {
                throw new Error('سند التسليم غير موجود.');
            }
            
            if (checkResult.rows[0].status !== 'pending') {
                throw new Error('يمكن حذف سند التسليم في حالة "معلق" فقط.');
            }
            
            // Delete items
            await client.query(`DELETE FROM delivery_note_items WHERE delivery_note_id = $1`, [id]);
            
            // Delete delivery note
            await client.query(`DELETE FROM delivery_notes WHERE id = $1`, [id]);
        });
        
        return res.status(200).json({ message: 'تم حذف سند التسليم بنجاح.' });
    } catch (err) {
        console.error('[DeliveryNotes] DELETE /:id error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

// =============================================================================
// PUT /api/delivery-notes/:id
// Edit delivery note items (requested_qty), add new items (manual notes only),
// remove items, and notes. Only allowed if status is 'pending'.
// =============================================================================

router.put('/:id', restrictWrite, async (req, res) => {
    const { id } = req.params;
    const { items, notes } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'يجب إدراج أصناف.' });
    }

    try {
        const result = await db.withTransaction(async (client) => {
            const dnCheck = await client.query(
                `SELECT id, status, note_number, client_id, warehouse_id, order_id FROM delivery_notes WHERE id = $1 FOR UPDATE`,
                [id]
            );
            if (dnCheck.rowCount === 0) throw new Error('سند التسليم غير موجود.');
            if (dnCheck.rows[0].status !== 'pending') {
                throw new Error('يمكن تعديل سندات التسليم في حالة "معلق" فقط.');
            }

            const dn = dnCheck.rows[0];
            const clientId = dn.client_id;
            const warehouseId = dn.warehouse_id;
            const orderId = dn.order_id;
            const updatedItemIds = new Set();

            // 1. Update quantities for existing items
            for (const item of items) {
                if (!item.item_id) continue;
                const newQty = parseFloat(item.quantity || item.requested_qty) || 0;
                if (newQty <= 0) throw new Error('الكمية يجب أن تكون أكبر من صفر.');

                const itemCheck = await client.query(
                    `SELECT id, requested_qty, delivered_qty FROM delivery_note_items WHERE id = $1 AND delivery_note_id = $2`,
                    [item.item_id, id]
                );
                if (itemCheck.rowCount === 0) throw new Error('صنف غير موجود في السند.');

                const delivered = parseFloat(itemCheck.rows[0].delivered_qty) || 0;
                if (newQty < delivered) {
                    throw new Error(`لا يمكن أن تكون الكمية المطلوبة (${newQty}) أقل من الكمية المُسلّمة (${delivered}).`);
                }

                await client.query(
                    `UPDATE delivery_note_items SET requested_qty = $1 WHERE id = $2 AND delivery_note_id = $3`,
                    [newQty, item.item_id, id]
                );
                updatedItemIds.add(item.item_id);
            }

            // 2. Insert new items (manual/standalone delivery notes only)
            for (const item of items) {
                if (item.item_id || !item.variant_id) continue;
                if (orderId) {
                    throw new Error('لا يمكن إضافة أصناف جديدة على سند التسليم المرتبط بأمر تشغيل.');
                }
                const newQty = parseFloat(item.quantity || item.requested_qty) || 0;
                if (newQty <= 0) throw new Error('الكمية يجب أن تكون أكبر من صفر.');

                const stockRes = await client.query(
                    `SELECT id, quantity, available_qty FROM warehouse_stock
                     WHERE variant_id = $1
                     AND (
                         client_id = $2
                         OR client_id IS NULL
                         OR client_id IN (SELECT parent_id FROM clients WHERE id = $2)
                     )
                     ${warehouseId ? 'AND warehouse_id = $3' : ''}
                     ORDER BY quantity DESC LIMIT 1`,
                    warehouseId ? [item.variant_id, clientId, warehouseId] : [item.variant_id, clientId]
                );
                if (stockRes.rowCount === 0) throw new Error('لا يوجد مخزون لهذا الصنف لهذا العميل.');

                const available = parseFloat(stockRes.rows[0].available_qty || stockRes.rows[0].quantity || 0);
                if (newQty > available) {
                    throw new Error(`الكمية المطلوبة (${newQty}) تتجاوز المتاح (${available}).`);
                }

                await client.query(
                    `INSERT INTO delivery_note_items (delivery_note_id, order_item_id, variant_id, requested_qty, delivered_qty, notes, created_at)
                     VALUES ($1, NULL, $2, $3, 0, NULL, NOW())`,
                    [id, item.variant_id, newQty]
                );
            }

            // 3. Remove items that are no longer in the request (only if not delivered)
            const currentItems = await client.query(
                `SELECT id, delivered_qty FROM delivery_note_items WHERE delivery_note_id = $1`,
                [id]
            );
            for (const row of currentItems.rows) {
                if (updatedItemIds.has(row.id)) continue;
                const delivered = parseFloat(row.delivered_qty) || 0;
                if (delivered > 0) {
                    throw new Error('لا يمكن حذف صنف تم تسليم جزء منه.');
                }
                await client.query(
                    `DELETE FROM delivery_note_items WHERE id = $1 AND delivery_note_id = $2`,
                    [row.id, id]
                );
            }

            if (notes !== undefined) {
                await client.query(
                    `UPDATE delivery_notes SET notes = $1, updated_at = NOW() WHERE id = $2`,
                    [notes || null, id]
                );
            }

            return { note_number: dn.note_number };
        });

        return res.status(200).json({ data: result, message: 'تم تعديل سند التسليم بنجاح.' });
    } catch (err) {
        console.error('[DeliveryNotes] PUT /:id error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

module.exports = router;
