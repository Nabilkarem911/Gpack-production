'use strict';

// =============================================================================
// G.PACK 2.0 — Purchase Invoices API
// فواتير المشتريات من الموردين
// =============================================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate } = require('../middleware/authMiddleware');
const authorize = require('../middleware/authorize');
const { getVatRate } = require('../utils/settings');
const { validateBody, purchaseInvoiceCreate } = require('../utils/validators');

router.use(authenticate);
router.use(authorize('purchasing', 'view'));
const restrictWrite  = authorize('purchasing', 'create');
const restrictEdit   = authorize('purchasing', 'edit');
const restrictDelete = authorize('purchasing', 'delete');

// =============================================================================
// GET /api/purchase-invoices
// List purchase invoices with filters
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const { supplier_id, search, status, from, to, limit = 20, offset = 0 } = req.query;

        let where = ['1=1'];
        const params = [];
        let paramIdx = 1;

        if (supplier_id) {
            where.push(`pi.supplier_id = $${paramIdx++}`);
            params.push(supplier_id);
        }
        if (search) {
            where.push(`(pi.invoice_number::text ILIKE $${paramIdx} OR s.company_name ILIKE $${paramIdx} OR pi.supplier_invoice_ref ILIKE $${paramIdx} OR c.name ILIKE $${paramIdx})`);
            params.push(`%${search}%`);
            paramIdx++;
        }
        if (status) {
            where.push(`pi.status = $${paramIdx++}`);
            params.push(status);
        }
        if (from) {
            where.push(`pi.invoice_date >= $${paramIdx++}`);
            params.push(from);
        }
        if (to) {
            where.push(`pi.invoice_date <= $${paramIdx++}`);
            params.push(to);
        }

        const whereClause = where.join(' AND ');

        // Count
        const countRes = await db.query(`
            SELECT COUNT(*)::int AS total FROM purchase_invoices pi
            LEFT JOIN suppliers s ON s.id = pi.supplier_id
            LEFT JOIN manufacturer_orders mo ON mo.id = pi.manufacturer_order_id
            LEFT JOIN orders o ON o.id = mo.order_id
            LEFT JOIN clients c ON c.id = o.client_id
            WHERE ${whereClause}
        `, params);

        // Data
        const dataRes = await db.query(`
            SELECT pi.id, pi.invoice_number, pi.invoice_date, pi.supplier_invoice_ref,
                   pi.subtotal, pi.tax_rate, pi.tax_amount, pi.grand_total, pi.paid_amount,
                   pi.status, pi.notes, pi.created_at,
                   s.id AS supplier_id, s.company_name AS supplier_name,
                   mo.id AS mo_id, mo.mo_number,
                   c.id AS client_id, c.name AS client_name
            FROM purchase_invoices pi
            LEFT JOIN suppliers s ON s.id = pi.supplier_id
            LEFT JOIN manufacturer_orders mo ON mo.id = pi.manufacturer_order_id
            LEFT JOIN orders o ON o.id = mo.order_id
            LEFT JOIN clients c ON c.id = o.client_id
            WHERE ${whereClause}
            ORDER BY pi.invoice_date DESC, pi.invoice_number DESC
            LIMIT $${paramIdx++} OFFSET $${paramIdx++}
        `, [...params, parseInt(limit), parseInt(offset)]);

        res.json({
            data: dataRes.rows,
            total: countRes.rows[0].total,
            limit: parseInt(limit),
            offset: parseInt(offset),
        });

    } catch (err) {
        console.error('[PurchaseInvoices] GET / error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/purchase-invoices/:id
// Get single purchase invoice with items
// =============================================================================
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Invoice header
        const invRes = await db.query(`
            SELECT pi.id, pi.invoice_number, pi.invoice_date, pi.due_date, pi.supplier_invoice_ref,
                   pi.subtotal, pi.tax_rate, pi.tax_amount, pi.grand_total, pi.paid_amount,
                   pi.status, pi.notes, pi.created_at,
                   s.id AS supplier_id, s.company_name AS supplier_name,
                   s.phone AS supplier_phone, s.city AS supplier_city,
                   s.commercial_register, s.tax_id AS supplier_tax_id,
                   mo.id AS mo_id, mo.mo_number,
                   u.name AS created_by_name
            FROM purchase_invoices pi
            LEFT JOIN suppliers s ON s.id = pi.supplier_id
            LEFT JOIN manufacturer_orders mo ON mo.id = pi.manufacturer_order_id
            LEFT JOIN users u ON u.id = pi.created_by
            WHERE pi.id = $1
        `, [id]);

        if (!invRes.rows.length) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        // Invoice items
        const itemsRes = await db.query(`
            SELECT pii.id, pii.variant_id, pii.quantity, pii.unit_cost AS unit_price, pii.total_cost AS line_total,
                   p.name AS product_name, pv.size_name
            FROM purchase_invoice_items pii
            JOIN product_variants pv ON pv.id = pii.variant_id
            JOIN products p ON p.id = pv.product_id
            WHERE pii.purchase_invoice_id = $1
            ORDER BY pii.created_at
        `, [id]);

        res.json({
            data: {
                invoice: invRes.rows[0],
                items: itemsRes.rows,
            }
        });

    } catch (err) {
        console.error('[PurchaseInvoices] GET /:id error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/purchase-invoices
// Create new purchase invoice
// =============================================================================
router.post('/', restrictWrite, validateBody(purchaseInvoiceCreate), async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const {
            supplier_id,
            manufacturer_order_id,
            invoice_date,
            due_date,
            supplier_invoice_ref,
            tax_rate,
            notes,
            items,
        } = req.validatedBody;

        const effectiveTaxRate = tax_rate ?? await getVatRate();

        // Validate
        if (!supplier_id || !items?.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'supplier_id and items are required' });
        }

        // Calculate totals
        let subtotal = 0;
        for (const item of items) {
            const lineTotal = (item.quantity || 0) * (item.unit_price || 0);
            subtotal += lineTotal;
        }
        const taxAmount = subtotal * effectiveTaxRate;
        const grandTotal = subtotal + taxAmount;

        // Generate invoice number
        const seqRes = await client.query(`
            SELECT nextval('purchase_invoice_seq') AS next
        `);
        const invoiceNumber = seqRes.rows[0].next;

        // Create invoice
        const invRes = await client.query(`
            INSERT INTO purchase_invoices (
                supplier_id, manufacturer_order_id, invoice_number, invoice_date, due_date,
                supplier_invoice_ref, subtotal, tax_rate, tax_amount, grand_total,
                status, notes, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id, invoice_number
        `, [
            supplier_id,
            manufacturer_order_id || null,
            invoiceNumber,
            invoice_date,
            due_date || null,
            supplier_invoice_ref || null,
            subtotal,
            effectiveTaxRate,
            taxAmount,
            grandTotal,
            'unpaid', // unpaid, paid, partially_paid, cancelled
            notes || '',
            req.user.id,
        ]);

        const invoiceId = invRes.rows[0].id;

        // Create invoice items
        for (const item of items) {
            await client.query(`
                INSERT INTO purchase_invoice_items (
                    purchase_invoice_id, variant_id, quantity, unit_cost, total_cost
                ) VALUES ($1, $2, $3, $4, $5)
            `, [
                invoiceId,
                item.variant_id,
                item.quantity,
                item.unit_price,
                item.quantity * item.unit_price,
            ]);
        }

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Purchase invoice created successfully',
            invoice: invRes.rows[0],
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[PurchaseInvoices] POST / error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    } finally {
        client.release();
    }
});

// =============================================================================
// GET /api/purchase-invoices/suppliers/:supplierId/orders-ready
// Get manufacturer orders ready for invoicing from this supplier
// =============================================================================
router.get('/suppliers/:supplierId/orders-ready', async (req, res) => {
    try {
        const { supplierId } = req.params;

        const result = await db.query(`
            SELECT mo.id, mo.mo_number, mo.created_at, mo.status,
                   s.company_name AS supplier_name,
                   o.id AS order_id, o.order_number,
                   c.id AS client_id, c.name AS client_name,
                   COUNT(moi.id) AS item_count,
                   SUM(moi.mo_quantity * moi.unit_price) AS estimated_total
            FROM manufacturer_orders mo
            JOIN suppliers s ON s.id = mo.manufacturer_id
            JOIN manufacturer_order_items moi ON moi.manufacturer_order_id = mo.id
            JOIN orders o ON o.id = mo.order_id
            JOIN clients c ON c.id = o.client_id
            WHERE mo.manufacturer_id = $1
              AND mo.status IN ('received', 'partially_received')
              AND NOT EXISTS (
                  SELECT 1 FROM purchase_invoices pi 
                  WHERE pi.manufacturer_order_id = mo.id
              )
            GROUP BY mo.id, mo.mo_number, mo.created_at, mo.status, s.company_name,
                     o.id, o.order_number, c.id, c.name
            ORDER BY mo.mo_number DESC
        `, [supplierId]);

        res.json({ data: result.rows });

    } catch (err) {
        console.error('[PurchaseInvoices] GET /orders-ready error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
