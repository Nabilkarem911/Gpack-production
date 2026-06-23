'use strict';

// =============================================================================
// G.PACK 2.0 — VMI Dispatch Routes
// POST /api/vmi/dispatch   — dispense stock to a client/branch (± invoice)
// GET  /api/vmi/stock      — get all stock for a client (+ branches)
// GET  /api/vmi/clients    — list VMI clients (those with warehouse_stock)
// =============================================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { getVatRate } = require('../utils/settings');
const { success } = require('../utils/response');
const authorize = require('../middleware/authorize');

// ── GET /api/vmi/clients ─────────────────────────────────────────────────────
// Returns distinct clients who have warehouse_stock > 0, with their branches
router.get('/clients', async (req, res) => {
    try {
        const isSalesRep = req.user.role === 'sales_rep';
        let query = `
            SELECT DISTINCT
                c.id, c.name, c.parent_id,
                pc.name AS parent_name
            FROM clients c
            JOIN warehouse_stock ws ON ws.client_id = c.id
            LEFT JOIN clients pc ON pc.id = c.parent_id
            WHERE ws.quantity > 0
        `;
        const params = [];
        if (isSalesRep) {
            query += ` AND c.created_by = $1`;
            params.push(req.user.id);
        }
        query += ` ORDER BY c.name`;

        const result = await db.query(query, params);
        res.json({ data: result.rows });
    } catch (err) {
        console.error('[VMI] GET /clients error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// ── GET /api/vmi/stock?client_id=<uuid> ──────────────────────────────────────
// Returns warehouse_stock for a given client (includes parent stock if branch)
router.get('/stock', async (req, res) => {
    try {
        const { client_id } = req.query;
        if (!client_id) return res.status(400).json({ error: 'client_id required' });

        // Get the client + check if it has a parent
        const clientRes = await db.query(
            'SELECT id, name, parent_id, created_by FROM clients WHERE id = $1',
            [client_id]
        );
        if (!clientRes.rows.length) return res.status(404).json({ error: 'Client not found' });
        const client = clientRes.rows[0];

        // Ownership check for sales_rep
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep && client.created_by !== req.user.id) {
            return res.status(403).json({ error: 'غير مصرح لك بعرض مخزون هذا العميل.' });
        }

        // Stock owned by this client (in any warehouse)
        const stockRes = await db.query(`
            SELECT
                ws.id          AS stock_id,
                ws.warehouse_id,
                w.name         AS warehouse_name,
                ws.variant_id,
                pv.size_name,
                pv.selling_price,
                pv.cost_price,
                p.id           AS product_id,
                p.name         AS product_name,
                cat.name       AS category_name,
                ws.quantity,
                ws.available_qty
            FROM warehouse_stock ws
            JOIN warehouses        w   ON w.id   = ws.warehouse_id
            JOIN product_variants  pv  ON pv.id  = ws.variant_id
            JOIN products          p   ON p.id   = pv.product_id
            LEFT JOIN categories   cat ON cat.id = p.category_id
            WHERE ws.client_id = $1
              AND ws.quantity   > 0
            ORDER BY p.name, pv.size_name
        `, [client_id]);

        res.json({
            client,
            data: stockRes.rows,
        });
    } catch (err) {
        console.error('[VMI] GET /stock error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// ── GET /api/vmi/branches?parent_id=<uuid> ───────────────────────────────────
// Returns branches (child clients) of a given parent client
router.get('/branches', async (req, res) => {
    try {
        const { parent_id } = req.query;
        if (!parent_id) return res.status(400).json({ error: 'parent_id required' });

        // Ownership check for sales_rep
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep) {
            const parentCheck = await db.query(
                'SELECT created_by FROM clients WHERE id = $1',
                [parent_id]
            );
            if (!parentCheck.rows.length || parentCheck.rows[0].created_by !== req.user.id) {
                return res.status(403).json({ error: 'غير مصرح لك بعرض فروع هذا العميل.' });
            }
        }

        const result = await db.query(`
            SELECT id, name, parent_id
            FROM clients
            WHERE parent_id = $1 OR id = $1
            ORDER BY parent_id NULLS FIRST, name
        `, [parent_id]);

        res.json({ data: result.rows });
    } catch (err) {
        console.error('[VMI] GET /branches error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// ── POST /api/vmi/dispatch ───────────────────────────────────────────────────
// Body:
//   stock_client_id  — client who OWNS the stock
//   recipient_id     — client/branch receiving the goods
//   warehouse_id     — source warehouse
//   items[]          — [{ stock_id, variant_id, quantity, unit_price }]
//   with_invoice     — boolean (default false)
//   notes            — optional string
//   delivery_date    — optional ISO date
router.post('/dispatch', authorize(['admin', 'manager', 'super_admin', 'warehouse', 'warehouse_keeper']), async (req, res) => {
    const client = await db.pool.connect();
    try {
        const {
            stock_client_id,
            recipient_id,
            warehouse_id,
            items,
            with_invoice = false,
            notes        = '',
            delivery_date,
        } = req.body;

        if (!stock_client_id || !recipient_id || !warehouse_id || !Array.isArray(items) || !items.length) {
            return res.status(400).json({ error: 'stock_client_id, recipient_id, warehouse_id, items[] required' });
        }

        const userId = req.user?.id || null;

        await client.query('BEGIN');

        // ── 1. Create delivery note ────────────────────────────────────────────
        const dnRes = await client.query(`
            INSERT INTO delivery_notes
                (client_id, status, delivery_date, notes, created_by)
            VALUES ($1, 'dispatched', $2, $3, $4)
            RETURNING id, note_number
        `, [
            recipient_id,
            delivery_date || new Date().toISOString().split('T')[0],
            notes,
            userId,
        ]);
        const dn       = dnRes.rows[0];
        const dnId     = dn.id;
        const dnNumber = dn.note_number;

        // ── 2. Process each item ───────────────────────────────────────────────
        for (const item of items) {
            const { stock_id, variant_id, quantity, unit_price } = item;
            const qty = parseFloat(quantity);
            if (!qty || qty <= 0) continue;

            // Validate available stock
            const stockCheck = await client.query(
                'SELECT available_qty FROM warehouse_stock WHERE id = $1 FOR UPDATE',
                [stock_id]
            );
            if (!stockCheck.rows.length) throw new Error(`Stock record ${stock_id} not found`);
            const available = parseFloat(stockCheck.rows[0].available_qty);
            if (qty > available) {
                throw new Error(`الكمية المطلوبة (${qty}) تتجاوز المتاح (${available})`);
            }

            // Insert delivery note item
            await client.query(`
                INSERT INTO delivery_note_items
                    (delivery_note_id, variant_id, requested_qty, delivered_qty)
                VALUES ($1, $2, $3, $3)
            `, [dnId, variant_id, qty]);

            // Deduct from warehouse_stock
            await client.query(`
                UPDATE warehouse_stock
                SET quantity     = quantity - $1,
                    last_updated = NOW()
                WHERE id = $2
            `, [qty, stock_id]);

            // Insert inventory_transaction (dispense)
            await client.query(`
                INSERT INTO inventory_transactions
                    (stock_id, variant_id, transaction_type, quantity,
                     warehouse_from, client_id, reference_id, reference_type,
                     notes, created_by, created_at)
                VALUES ($1, $2, 'dispense', $3, $4, $5, $6, 'delivery_note', $7, $8, NOW())
            `, [
                stock_id, variant_id, qty,
                warehouse_id, recipient_id,
                dnId,
                `VMI صرف — ${notes || ''}`,
                userId,
            ]);
        }

        // ── 3. Optional: Create sales invoice ─────────────────────────────────
        let invoiceId     = null;
        let invoiceNumber = null;

        if (with_invoice) {
            const validItems = items.filter(i => parseFloat(i.quantity) > 0);
            const subtotal   = validItems.reduce((sum, i) => sum + parseFloat(i.quantity) * parseFloat(i.unit_price || 0), 0);
            const taxRate    = await getVatRate();
            const taxAmount  = parseFloat((subtotal * taxRate).toFixed(2));
            const grandTotal = parseFloat((subtotal + taxAmount).toFixed(2));

            const invRes = await client.query(`
                INSERT INTO invoices
                    (client_id, invoice_date, subtotal, tax_rate, tax_amount, grand_total,
                     status, notes, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, 'issued', $7, $8)
                RETURNING id, invoice_number
            `, [
                recipient_id,
                delivery_date || new Date().toISOString().split('T')[0],
                subtotal, taxRate, taxAmount, grandTotal,
                `فاتورة VMI — مذكرة تسليم #${dnNumber}`,
                userId,
            ]);
            invoiceId     = invRes.rows[0].id;
            invoiceNumber = invRes.rows[0].invoice_number;

            // Insert invoice items
            for (const item of validItems) {
                const qty   = parseFloat(item.quantity);
                const price = parseFloat(item.unit_price || 0);
                if (!qty || !price) continue;
                await client.query(`
                    INSERT INTO invoice_items (invoice_id, variant_id, quantity, unit_price)
                    VALUES ($1, $2, $3, $4)
                `, [invoiceId, item.variant_id, qty, price]);
            }

            // Client ledger transaction
            await client.query(`
                INSERT INTO client_transactions
                    (client_id, invoice_id, type, amount, description, created_at)
                VALUES ($1, $2, 'invoice', $3, $4, NOW())
            `, [
                recipient_id, invoiceId, grandTotal,
                `فاتورة VMI رقم ${invoiceNumber} — مذكرة #${dnNumber}`,
            ]);
        }

        await client.query('COMMIT');

        return success(res, {
            delivery_note: { id: dnId, note_number: dnNumber },
            invoice:       invoiceId ? { id: invoiceId, invoice_number: invoiceNumber } : null,
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[VMI] POST /dispatch error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    } finally {
        client.release();
    }
});

module.exports = router;
