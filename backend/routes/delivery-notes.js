/**
 * Delivery Notes Routes
 * /api/delivery-notes
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const authorize = require('../middleware/authorize');
const { validateBody, deliveryNoteCreate, deliveryNoteDispatch } = require('../utils/validators');

router.use(authorize('vmi_dispatch', 'view'));
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
                c.name AS client_name,
                dn.status,
                dn.notes,
                dn.created_at,
                dn.updated_at,
                COUNT(dni.id) AS item_count
            FROM delivery_notes dn
            LEFT JOIN orders o ON o.id = dn.order_id
            LEFT JOIN clients c ON c.id = dn.client_id
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
        
        query += ` GROUP BY dn.id, dn.note_number, dn.order_id, o.order_number, dn.client_id, c.name, dn.status, dn.notes, dn.created_at, dn.updated_at`;
        query += ` ORDER BY dn.created_at DESC`;
        
        const result = await db.query(query, params);
        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[DeliveryNotes] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
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
                c.name AS client_name,
                dn.status,
                dn.notes,
                dn.created_at,
                dn.updated_at
             FROM delivery_notes dn
             LEFT JOIN orders o ON o.id = dn.order_id
             LEFT JOIN clients c ON c.id = dn.client_id
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
                oi.variant_id,
                p.name AS product_name,
                pv.size_name AS variant_name,
                dni.requested_qty,
                dni.requested_qty AS quantity,
                dni.delivered_qty,
                dni.notes
             FROM delivery_note_items dni
             JOIN order_items oi ON oi.id = dni.order_item_id
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
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
// POST /api/delivery-notes
// Create new delivery note
// =============================================================================

router.post('/', restrictWrite, validateBody(deliveryNoteCreate), async (req, res) => {
    const { order_id, client_id, items, notes } = req.validatedBody;
    
    if (!order_id || !client_id || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'order_id, client_id, and items array are required.' });
    }
    
    try {
        const result = await db.withTransaction(async (client) => {
            // Create delivery note (note_number is auto-generated by sequence)
            const dnResult = await client.query(
                `INSERT INTO delivery_notes (order_id, client_id, status, notes, created_by, created_at, updated_at)
                 VALUES ($1, $2, 'pending', $3, $4, NOW(), NOW())
                 RETURNING *`,
                [order_id, client_id, notes || null, req.user?.id]
            );
            
            const deliveryNote = dnResult.rows[0];
            
            // Create delivery note items - resolve order_item_id from variant_id if needed
            for (const item of items) {
                let orderItemId = item.order_item_id || null;

                if (!orderItemId && item.variant_id) {
                    const oiRes = await client.query(
                        `SELECT id FROM order_items WHERE order_id = $1 AND variant_id = $2 LIMIT 1`,
                        [order_id, item.variant_id]
                    );
                    if (oiRes.rowCount > 0) orderItemId = oiRes.rows[0].id;
                }

                if (!orderItemId) continue;

                await client.query(
                    `INSERT INTO delivery_note_items (delivery_note_id, order_item_id, variant_id, requested_qty, delivered_qty, notes, created_at)
                     VALUES ($1, $2, $3, $4, 0, $5, NOW())`,
                    [deliveryNote.id, orderItemId, item.variant_id || null, item.quantity || item.requested_qty || 0, item.notes || null]
                );
            }
            
            return deliveryNote;
        });
        
        return res.status(201).json({ data: result, message: 'تم إنشاء سند التسليم بنجاح.' });
    } catch (err) {
        console.error('[DeliveryNotes] POST / error:', err.message);
        return res.status(500).json({ error: err.message || 'Internal server error.' });
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
                `SELECT dn.*, o.client_id FROM delivery_notes dn
                 JOIN orders o ON o.id = dn.order_id
                 WHERE dn.id = $1`,
                [id]
            );
            if (dnCheck.rowCount === 0) throw new Error('أمر الفسح غير موجود.');

            const dn = dnCheck.rows[0];
            if (dn.status === 'completed') throw new Error('أمر الفسح مكتمل بالفعل ولا يمكن التعديل عليه.');

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

                // Get variant + order item
                const itemResult = await client.query(
                    `SELECT dni.order_item_id, oi.variant_id
                     FROM delivery_note_items dni
                     JOIN order_items oi ON oi.id = dni.order_item_id
                     WHERE dni.id = $1`,
                    [item.item_id]
                );
                if (itemResult.rowCount === 0) continue;

                const { order_item_id: orderItemId, variant_id: variantId } = itemResult.rows[0];

                // Validate: sufficient stock
                const stockResult = await client.query(
                    `SELECT id, quantity FROM warehouse_stock
                     WHERE variant_id = $1 AND (client_id = $2 OR (client_id IS NULL AND $2 IS NULL))
                     ORDER BY quantity DESC LIMIT 1`,
                    [variantId, dn.client_id]
                );
                if (stockResult.rowCount === 0 || parseFloat(stockResult.rows[0].quantity) < item.quantity) {
                    const available = stockResult.rowCount > 0 ? stockResult.rows[0].quantity : 0;
                    throw new Error(`المخزون غير كافٍ — المتاح: ${available}، المطلوب: ${item.quantity}.`);
                }

                const stockId = stockResult.rows[0].id;

                // Update delivered_qty on delivery_note_items
                await client.query(
                    `UPDATE delivery_note_items SET delivered_qty = delivered_qty + $1 WHERE id = $2`,
                    [item.quantity, item.item_id]
                );

                // Update order item delivered quantity
                await client.query(
                    `UPDATE order_items SET delivered_qty = COALESCE(delivered_qty, 0) + $1 WHERE id = $2`,
                    [item.quantity, orderItemId]
                );

                // Deduct from stock
                await client.query(
                    `UPDATE warehouse_stock SET quantity = quantity - $1, last_updated = NOW() WHERE id = $2`,
                    [item.quantity, stockId]
                );

                // Create inventory transaction
                await client.query(
                    `INSERT INTO inventory_transactions (stock_id, variant_id, transaction_type, quantity, notes, reference_id, reference_type, created_by, created_at)
                     VALUES ($1, $2, 'dispense', $3, $4, $5, 'delivery_note', $6, NOW())`,
                    [stockId, variantId, item.quantity, deliveryNotes || `تسليم - أمر فسح #${dn.note_number}`, id, req.user?.id]
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

            return { status: newStatus };
        });

        return res.status(200).json({ message: 'تم تسجيل التسليم بنجاح.', data: result });
    } catch (err) {
        console.error('[DeliveryNotes] POST /:id/dispatch error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
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
                `SELECT dn.*, o.client_id FROM delivery_notes dn
                 JOIN orders o ON o.id = dn.order_id
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

                // Get order item details
                const itemResult = await client.query(
                    `SELECT dni.order_item_id, oi.variant_id
                     FROM delivery_note_items dni
                     JOIN order_items oi ON oi.id = dni.order_item_id
                     WHERE dni.id = $1`,
                    [item.item_id]
                );
                
                if (itemResult.rowCount === 0) continue;
                
                const orderItemId = itemResult.rows[0].order_item_id;
                const variantId = itemResult.rows[0].variant_id;

                // ── Validate: sufficient stock ─────────────────────────────────
                const stockResult = await client.query(
                    `SELECT id, quantity FROM warehouse_stock 
                     WHERE variant_id = $1 AND (client_id = $2 OR (client_id IS NULL AND $2 IS NULL))
                     ORDER BY quantity DESC LIMIT 1`,
                    [variantId, dn.client_id]
                );

                if (stockResult.rowCount === 0 || parseFloat(stockResult.rows[0].quantity) < item.quantity) {
                    const available = stockResult.rowCount > 0 ? stockResult.rows[0].quantity : 0;
                    throw new Error(`المخزون غير كافٍ — المتاح: ${available}، المطلوب: ${item.quantity}.`);
                }

                const stockId = stockResult.rows[0].id;
                
                // Update delivered quantity
                await client.query(
                    `UPDATE delivery_note_items 
                     SET delivered_qty = delivered_qty + $1
                     WHERE id = $2`,
                    [item.quantity, item.item_id]
                );
                
                // Update order item delivered quantity
                await client.query(
                    `UPDATE order_items SET delivered_qty = COALESCE(delivered_qty, 0) + $1 WHERE id = $2`,
                    [item.quantity, orderItemId]
                );
                
                // Deduct from stock
                await client.query(
                    `UPDATE warehouse_stock 
                     SET quantity = quantity - $1, last_updated = NOW()
                     WHERE id = $2`,
                    [item.quantity, stockId]
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
// Edit delivery note items (requested_qty) and notes. Only allowed if status is 'pending'.
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
                `SELECT id, status, note_number FROM delivery_notes WHERE id = $1 FOR UPDATE`,
                [id]
            );
            if (dnCheck.rowCount === 0) throw new Error('أمر الفسح غير موجود.');
            if (dnCheck.rows[0].status !== 'pending') {
                throw new Error('يمكن تعديل أوامر الفسح في حالة "معلق" فقط.');
            }

            for (const item of items) {
                if (!item.item_id || !item.quantity || item.quantity <= 0) continue;
                await client.query(
                    `UPDATE delivery_note_items SET requested_qty = $1 WHERE id = $2 AND delivery_note_id = $3`,
                    [item.quantity, item.item_id, id]
                );
            }

            if (notes !== undefined) {
                await client.query(
                    `UPDATE delivery_notes SET notes = $1, updated_at = NOW() WHERE id = $2`,
                    [notes || null, id]
                );
            }

            return { note_number: dnCheck.rows[0].note_number };
        });

        return res.status(200).json({ data: result, message: 'تم تعديل أمر الفسح بنجاح.' });
    } catch (err) {
        console.error('[DeliveryNotes] PUT /:id error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    }
});

module.exports = router;
