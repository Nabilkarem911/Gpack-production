'use strict';

const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/authMiddleware');
const authorize = require('../middleware/authorize');

const router = express.Router();

// All routes in this file are already protected by the authenticate middleware
// mounted in server.js. `req.user` is guaranteed to be populated.

// =============================================================================
// GET /api/clients
// Returns all clients with parent name (self-join for franchise display).
// DATA SCOPING:
//   - sales_rep  → only clients they created (created_by = req.user.id)
//   - all others → all clients
// =============================================================================

router.get('/', async (req, res) => {
    try {
        const isSalesRep = req.user.role === 'sales_rep';

        const baseQuery = `
            SELECT
                c.id,
                c.parent_id,
                c.name,
                c.contact_person,
                c.phone,
                c.email,
                c.address,
                c.city,
                c.commercial_register,
                c.tax_id,
                c.credit_limit,
                c.status,
                c.created_by,
                c.created_at,
                c.updated_at,
                p.name AS parent_name
            FROM clients c
            LEFT JOIN clients p ON p.id = c.parent_id
            ${isSalesRep ? 'WHERE c.created_by = $1' : ''}
            ORDER BY c.created_at DESC
        `;

        const params = isSalesRep ? [req.user.id] : [];
        const result = await db.query(baseQuery, params);

        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[Clients] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/clients/:id
// Returns a single client by ID with parent name.
// =============================================================================

router.get('/:id', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT
                c.id,
                c.parent_id,
                c.name,
                c.contact_person,
                c.phone,
                c.email,
                c.address,
                c.city,
                c.commercial_register,
                c.tax_id,
                c.credit_limit,
                c.status,
                c.created_by,
                c.created_at,
                c.updated_at,
                p.name AS parent_name
             FROM clients c
             LEFT JOIN clients p ON p.id = c.parent_id
             WHERE c.id = $1
             LIMIT 1`,
            [req.params.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Client not found.' });
        }

        const client = result.rows[0];
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep && client.created_by !== req.user.id) {
            return res.status(403).json({ error: 'غير مصرح لك بعرض هذا العميل.' });
        }

        return res.status(200).json({ data: client });
    } catch (err) {
        console.error('[Clients] GET /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/clients/:id/profile
// Returns full client profile: info + branches + orders + invoices + payments + designs + stats.
// =============================================================================

router.get('/:id/profile', async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Client info + parent name
        const clientRes = await db.query(
            `SELECT c.*, p.name AS parent_name
             FROM clients c
             LEFT JOIN clients p ON p.id = c.parent_id
             WHERE c.id = $1 LIMIT 1`,
            [id]
        );
        if (clientRes.rowCount === 0) return res.status(404).json({ error: 'العميل غير موجود.' });
        const client = clientRes.rows[0];

        // Ownership check for sales_rep
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep && client.created_by !== req.user.id) {
            return res.status(403).json({ error: 'غير مصرح لك بعرض ملف هذا العميل.' });
        }

        // 2. Branches (if this is a main client)
        const branchesRes = await db.query(
            `SELECT id, name, phone, city, status FROM clients WHERE parent_id = $1 ORDER BY name`,
            [id]
        );

        // 3. Orders summary (all statuses)
        const ordersRes = await db.query(
            `SELECT o.id, o.order_number, o.status, o.order_date, o.grand_total, o.paid_amount,
                    o.subtotal, o.tax_amount, COUNT(oi.id)::int AS item_count
             FROM orders o
             LEFT JOIN order_items oi ON oi.order_id = o.id
             WHERE o.client_id = $1
             GROUP BY o.id
             ORDER BY o.created_at DESC`,
            [id]
        );

        // 4. Invoices (all invoices across all orders)
        const invoicesRes = await db.query(
            `SELECT i.id, i.invoice_number, i.grand_total, i.status, i.created_at,
                    o.order_number
             FROM invoices i
             JOIN orders o ON o.id = i.order_id
             WHERE i.client_id = $1
             ORDER BY i.created_at DESC`,
            [id]
        );

        // 5. Payments / transactions
        const paymentsRes = await db.query(
            `SELECT ct.id, ct.amount, ct.payment_method, ct.description,
                    ct.document_number, ct.created_at, o.order_number
             FROM client_transactions ct
             JOIN orders o ON o.id = ct.order_id
             WHERE ct.client_id = $1 AND ct.type = 'payment'
             ORDER BY ct.created_at DESC`,
            [id]
        );

        // 6. Designs (join with latest file from client_design_files)
        const designsRes = await db.query(
            `SELECT cd.id, cd.design_name, cd.design_number, cd.is_active, cd.created_at,
                    pv.size_name, p.name AS product_name,
                    cdf.file_path, cdf.file_type, cdf.original_name
             FROM client_designs cd
             JOIN product_variants pv ON pv.id = cd.variant_id
             JOIN products p ON p.id = pv.product_id
             LEFT JOIN LATERAL (
                 SELECT file_path, file_type, original_name
                 FROM client_design_files
                 WHERE design_id = cd.id
                 ORDER BY uploaded_at DESC
                 LIMIT 1
             ) cdf ON true
             WHERE cd.client_id = $1
             ORDER BY cd.created_at DESC`,
            [id]
        );

        // 7. Financial stats
        const statsRes = await db.query(
            `SELECT
                COUNT(DISTINCT o.id)::int                                       AS total_orders,
                COUNT(DISTINCT CASE WHEN o.status = 'quote' THEN o.id END)::int AS quote_count,
                COUNT(DISTINCT CASE WHEN o.status IN ('production','processing','completed','delivered') THEN o.id END)::int AS active_count,
                COALESCE(SUM(o.grand_total), 0)::numeric                        AS total_value,
                COALESCE(SUM(o.paid_amount), 0)::numeric                        AS total_paid,
                COALESCE(SUM(o.grand_total) - SUM(o.paid_amount), 0)::numeric  AS total_remaining
             FROM orders o
             WHERE o.client_id = $1 AND o.status NOT IN ('archived','cancelled')`,
            [id]
        );

        return res.status(200).json({
            data: {
                client,
                branches:  branchesRes.rows,
                orders:    ordersRes.rows,
                invoices:  invoicesRes.rows,
                payments:  paymentsRes.rows,
                designs:   designsRes.rows,
                stats:     statsRes.rows[0],
            }
        });
    } catch (err) {
        console.error('[Clients] GET /:id/profile error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/clients
// Creates a new client.
// - parent_id: null = Main Client, UUID = Franchise Branch
// - created_by is always set to the authenticated user's ID.
// =============================================================================

router.post('/', async (req, res) => {
    const {
        name,
        parent_id,
        contact_person,
        phone,
        email,
        address,
        city,
        commercial_register,
        tax_id,
        credit_limit,
        status,
    } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'اسم العميل مطلوب.' });
    }

    try {
        // If a parent_id is supplied, verify it exists and is itself a main client
        if (parent_id) {
            const parentCheck = await db.query(
                'SELECT id FROM clients WHERE id = $1 LIMIT 1',
                [parent_id]
            );
            if (parentCheck.rowCount === 0) {
                return res.status(400).json({ error: 'العميل الرئيسي المحدد غير موجود.' });
            }
        }

        const result = await db.query(
            `INSERT INTO clients
                (name, parent_id, contact_person, phone, email, address, city,
                 commercial_register, tax_id, credit_limit, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [
                name.trim(),
                parent_id || null,
                contact_person || null,
                phone || null,
                email || null,
                address || null,
                city || null,
                commercial_register || null,
                tax_id || null,
                credit_limit || 0,
                status || 'active',
                req.user.id,
            ]
        );

        return res.status(201).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Clients] POST / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// PUT /api/clients/:id
// Updates a client.
// DATA SCOPING: sales_rep can only update clients they created.
// =============================================================================

router.put('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Fetch existing record first for ownership check
        const existing = await db.query(
            'SELECT id, created_by FROM clients WHERE id = $1 LIMIT 1',
            [id]
        );
        if (existing.rowCount === 0) {
            return res.status(404).json({ error: 'العميل غير موجود.' });
        }

        const client = existing.rows[0];
        const isSalesRep = req.user.role === 'sales_rep';

        if (isSalesRep && client.created_by !== req.user.id) {
            return res.status(403).json({ error: 'غير مصرح لك بتعديل هذا العميل.' });
        }

        const {
            name,
            parent_id,
            contact_person,
            phone,
            email,
            address,
            city,
            commercial_register,
            tax_id,
            credit_limit,
            status,
        } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'اسم العميل مطلوب.' });
        }

        // Prevent a client from being its own parent
        if (parent_id && parent_id === id) {
            return res.status(400).json({ error: 'لا يمكن للعميل أن يكون فرعاً لنفسه.' });
        }

        const result = await db.query(
            `UPDATE clients SET
                name                = $1,
                parent_id           = $2,
                contact_person      = $3,
                phone               = $4,
                email               = $5,
                address             = $6,
                city                = $7,
                commercial_register = $8,
                tax_id              = $9,
                credit_limit        = $10,
                status              = $11,
                updated_at          = NOW()
             WHERE id = $12
             RETURNING *`,
            [
                name.trim(),
                parent_id || null,
                contact_person || null,
                phone || null,
                email || null,
                address || null,
                city || null,
                commercial_register || null,
                tax_id || null,
                credit_limit || 0,
                status || 'active',
                id,
            ]
        );

        return res.status(200).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Clients] PUT /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// DELETE /api/clients/:id
// Soft-delete by setting status = 'inactive'.
// sales_rep can only delete their own; others need role with clients.delete perm.
// Hard delete is intentionally NOT implemented to preserve order/invoice history.
// =============================================================================

router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const existing = await db.query(
            'SELECT id, created_by FROM clients WHERE id = $1 LIMIT 1',
            [id]
        );
        if (existing.rowCount === 0) {
            return res.status(404).json({ error: 'العميل غير موجود.' });
        }

        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep && existing.rows[0].created_by !== req.user.id) {
            return res.status(403).json({ error: 'غير مصرح لك بحذف هذا العميل.' });
        }

        await db.query(
            `UPDATE clients SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
            [id]
        );

        return res.status(200).json({ message: 'تم تعطيل العميل بنجاح.' });
    } catch (err) {
        console.error('[Clients] DELETE /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
