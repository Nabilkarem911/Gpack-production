'use strict';

const express = require('express');
const db = require('../db');
const authorize = require('../middleware/authorize');
const { validateBody, supplierCreate, supplierUpdate } = require('../utils/validators');

const router = express.Router();

// View permission: all authenticated users with 'suppliers' view can list/get
router.use(authorize('suppliers', 'view'));

// Write/Delete permissions (already defined per-route below)

// =============================================================================
// GET /api/suppliers
// Returns list of suppliers (manufacturers/vendors).
// Query params:
//   ?status=active|inactive — default shows all
//   ?type=manufacturer|vendor|both
//   ?search=<string> — matches name or contact_person
// =============================================================================

router.get('/', async (req, res) => {
    try {
        const { status, type, search } = req.query;

        const conditions = [];
        const params = [];

        if (status) {
            params.push(status);
            conditions.push(`status = $${params.length}`);
        }

        if (type && type !== 'both') {
            params.push(type);
            conditions.push(`supplier_type = $${params.length}`);
        }

        if (search) {
            params.push(`%${search}%`);
            const idx = params.length;
            conditions.push(
                `(company_name ILIKE $${idx} OR contact_person ILIKE $${idx} OR phone ILIKE $${idx})`
            );
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const result = await db.query(
            `SELECT
                id,
                company_name AS name,
                contact_person,
                phone,
                email,
                address,
                city,
                commercial_register,
                tax_id,
                payment_terms,
                status,
                supplier_type,
                created_at,
                updated_at
             FROM suppliers
             ${whereClause}
             ORDER BY company_name ASC`,
            params
        );

        return res.status(200).json({ data: result.rows });
    } catch (err) {
        console.error('[Suppliers] GET / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/suppliers/:id
// Returns single supplier with statistics.
// =============================================================================

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const supplierResult = await db.query(
            `SELECT
                id,
                company_name AS name,
                contact_person,
                phone,
                email,
                address,
                city,
                commercial_register,
                tax_id,
                payment_terms,
                status,
                supplier_type,
                created_at,
                updated_at
             FROM suppliers
             WHERE id = $1
             LIMIT 1`,
            [id]
        );

        if (supplierResult.rowCount === 0) {
            return res.status(404).json({ error: 'المورد غير موجود.' });
        }

        const supplier = supplierResult.rows[0];

        // Get statistics
        const statsResult = await db.query(
            `SELECT
                COUNT(*)::int as total_orders,
                COALESCE(SUM(total_cost), 0)::numeric as total_value
             FROM manufacturer_orders
             WHERE manufacturer_id = $1 AND status != 'cancelled'`,
            [id]
        );

        supplier.statistics = statsResult.rows[0];

        return res.status(200).json({ data: supplier });
    } catch (err) {
        console.error('[Suppliers] GET /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/suppliers/:id/profile
// Returns comprehensive 360-degree supplier profile:
//   - Supplier info
//   - Manufacturer orders with item counts
//   - Purchase invoices
//   - Financial stats
// =============================================================================

router.get('/:id/profile', async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Supplier info
        const supplierRes = await db.query(
            `SELECT id, company_name AS name, contact_person, phone, email,
                    address, city, commercial_register, tax_id, payment_terms,
                    status, supplier_type, created_at
             FROM suppliers WHERE id = $1 LIMIT 1`,
            [id]
        );
        if (supplierRes.rowCount === 0) {
            return res.status(404).json({ error: 'المورد غير موجود.' });
        }
        const supplier = supplierRes.rows[0];

        // 2. Manufacturer orders with item count & linked client order number
        const ordersRes = await db.query(
            `SELECT mo.id, mo.mo_number, mo.status, mo.total_amount,
                    mo.paid_amount, mo.created_at, mo.expected_delivery_date,
                    mo.has_supplier_invoice, mo.tax_rate,
                    o.order_number AS client_order_number,
                    COUNT(moi.id)::int AS item_count
             FROM manufacturer_orders mo
             LEFT JOIN orders o ON o.id = mo.order_id
             LEFT JOIN manufacturer_order_items moi ON moi.manufacturer_order_id = mo.id
             WHERE mo.manufacturer_id = $1
             GROUP BY mo.id, o.order_number
             ORDER BY mo.created_at DESC`,
            [id]
        );

        // 3. Purchase invoices
        const invoicesRes = await db.query(
            `SELECT pi.id, pi.invoice_number, pi.invoice_date, pi.supplier_invoice_ref,
                    pi.subtotal, pi.tax_rate, pi.tax_amount, pi.grand_total,
                    pi.status, pi.created_at,
                    mo.mo_number
             FROM purchase_invoices pi
             LEFT JOIN manufacturer_orders mo ON mo.id = pi.manufacturer_order_id
             WHERE pi.supplier_id = $1
             ORDER BY pi.created_at DESC`,
            [id]
        );

        // 4. Financial stats
        const statsRes = await db.query(
            `SELECT
                COUNT(DISTINCT mo.id)::int                                          AS total_orders,
                COUNT(DISTINCT CASE WHEN mo.status = 'pending'    THEN mo.id END)::int AS pending_count,
                COUNT(DISTINCT CASE WHEN mo.status = 'completed'  THEN mo.id END)::int AS completed_count,
                COALESCE(SUM(mo.total_amount), 0)                                   AS total_value,
                COALESCE(SUM(mo.paid_amount),  0)                                   AS total_paid,
                COALESCE(SUM(mo.total_amount) - SUM(mo.paid_amount), 0)             AS total_remaining,
                COUNT(DISTINCT pi.id)::int                                          AS invoice_count
             FROM manufacturer_orders mo
             LEFT JOIN purchase_invoices pi ON pi.manufacturer_order_id = mo.id
             WHERE mo.manufacturer_id = $1`,
            [id]
        );

        return res.status(200).json({
            data: {
                supplier,
                orders:   ordersRes.rows,
                invoices: invoicesRes.rows,
                stats:    statsRes.rows[0] || {},
            }
        });

    } catch (err) {
        console.error('[Suppliers] GET /:id/profile error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/suppliers/purchase-invoices/:invoiceId
// Returns full purchase invoice with items and supplier info for printing.
// =============================================================================

router.get('/purchase-invoices/:invoiceId', async (req, res) => {
    const { invoiceId } = req.params;
    try {
        const invRes = await db.query(
            `SELECT pi.id, pi.invoice_number, pi.invoice_date, pi.supplier_invoice_ref,
                    pi.subtotal, pi.tax_rate, pi.tax_amount, pi.grand_total,
                    pi.status, pi.notes, pi.created_at,
                    mo.mo_number,
                    s.company_name AS supplier_name, s.phone AS supplier_phone,
                    s.city AS supplier_city, s.commercial_register, s.tax_id AS supplier_tax_id
             FROM purchase_invoices pi
             LEFT JOIN manufacturer_orders mo ON mo.id = pi.manufacturer_order_id
             LEFT JOIN suppliers s ON s.id = pi.supplier_id
             WHERE pi.id = $1
             LIMIT 1`,
            [invoiceId]
        );
        if (invRes.rowCount === 0) {
            return res.status(404).json({ error: 'الفاتورة غير موجودة.' });
        }
        const invoice = invRes.rows[0];

        const itemsRes = await db.query(
            `SELECT pii.product_name, pii.quantity, pii.unit_cost, pii.total_cost,
                    pv.size_name
             FROM purchase_invoice_items pii
             LEFT JOIN product_variants pv ON pv.id = pii.variant_id
             WHERE pii.purchase_invoice_id = $1
             ORDER BY pii.created_at ASC`,
            [invoiceId]
        );

        return res.status(200).json({ data: { invoice, items: itemsRes.rows } });
    } catch (err) {
        console.error('[Suppliers] GET /purchase-invoices/:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/suppliers
// Creates a new supplier.
// =============================================================================

router.post('/', authorize('suppliers', 'create'), validateBody(supplierCreate), async (req, res) => {
    const {
        company_name,
        contact_person,
        phone,
        email,
        address,
        city,
        commercial_register,
        tax_id,
        payment_terms
    } = req.validatedBody;

    if (!company_name) {
        return res.status(400).json({ error: 'اسم المورد مطلوب.' });
    }

    try {
        const supplier_type = req.validatedBody.supplier_type || req.validatedBody.type || 'supplier';

        const result = await db.query(
            `INSERT INTO suppliers (
                company_name, contact_person, phone, email, address, city,
                commercial_register, tax_id, payment_terms, supplier_type, status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', NOW(), NOW())
            RETURNING *, company_name AS name`,
            [
                company_name,
                contact_person || null,
                phone || null,
                email || null,
                address || null,
                city || null,
                commercial_register || null,
                tax_id || null,
                payment_terms || null,
                supplier_type
            ]
        );

        return res.status(201).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Suppliers] POST / error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// PATCH /api/suppliers/:id
// Updates supplier details.
// =============================================================================

router.patch('/:id', authorize('suppliers', 'edit'), validateBody(supplierUpdate), async (req, res) => {
    const { id } = req.params;
    const {
        company_name,
        contact_person,
        phone,
        email,
        address,
        city,
        commercial_register,
        tax_id,
        payment_terms,
        supplier_type,
        status
    } = req.validatedBody;

    try {
        const updates = ['updated_at = NOW()'];
        const params = [];

        if (company_name !== undefined) {
            updates.push(`company_name = $${params.length + 1}`);
            params.push(company_name);
        }
        if (contact_person !== undefined) {
            updates.push(`contact_person = $${params.length + 1}`);
            params.push(contact_person);
        }
        if (phone !== undefined) {
            updates.push(`phone = $${params.length + 1}`);
            params.push(phone);
        }
        if (email !== undefined) {
            updates.push(`email = $${params.length + 1}`);
            params.push(email);
        }
        if (address !== undefined) {
            updates.push(`address = $${params.length + 1}`);
            params.push(address);
        }
        if (city !== undefined) {
            updates.push(`city = $${params.length + 1}`);
            params.push(city);
        }
        if (commercial_register !== undefined) {
            updates.push(`commercial_register = $${params.length + 1}`);
            params.push(commercial_register);
        }
        if (tax_id !== undefined) {
            updates.push(`tax_id = $${params.length + 1}`);
            params.push(tax_id);
        }
        if (payment_terms !== undefined) {
            updates.push(`payment_terms = $${params.length + 1}`);
            params.push(payment_terms);
        }
        if (status !== undefined) {
            updates.push(`status = $${params.length + 1}`);
            params.push(status);
        }
        if (supplier_type !== undefined) {
            updates.push(`supplier_type = $${params.length + 1}`);
            params.push(supplier_type);
        }

        params.push(id);
        const result = await db.query(
            `UPDATE suppliers
             SET ${updates.join(', ')}
             WHERE id = $${params.length}
             RETURNING *`,
            params
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'المورد غير موجود.' });
        }

        return res.status(200).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Suppliers] PATCH /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// DELETE /api/suppliers/:id
// Soft delete — sets status to 'inactive' if has orders, otherwise hard delete.
// =============================================================================

router.delete('/:id', authorize('suppliers', 'delete'), async (req, res) => {
    const { id } = req.params;

    try {
        // Check if supplier has manufacturer orders
        const checkResult = await db.query(
            `SELECT COUNT(*)::int as count FROM manufacturer_orders WHERE manufacturer_id = $1`,
            [id]
        );

        const hasOrders = checkResult.rows[0].count > 0;

        if (hasOrders) {
            // Soft delete
            await db.query(
                `UPDATE suppliers SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
                [id]
            );
            return res.status(200).json({ message: 'تم إلغاء تنشيط المورد (يحتوي على سجلات).' });
        } else {
            // Hard delete
            const result = await db.query(
                `DELETE FROM suppliers WHERE id = $1`,
                [id]
            );
            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'المورد غير موجود.' });
            }
            return res.status(200).json({ message: 'تم حذف المورد بنجاح.' });
        }
    } catch (err) {
        console.error('[Suppliers] DELETE /:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
