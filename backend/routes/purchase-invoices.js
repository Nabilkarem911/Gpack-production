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

// Allow purchasing OR receiving roles to view purchase invoices
router.use((req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { role, permissions } = req.user;
    if (role === 'super_admin' || role === 'admin') return next();
    if (permissions && permissions.all_access === true) return next();
    const has = (res, act) => permissions && permissions[res] &&
        ((typeof permissions[res] === 'object' && !Array.isArray(permissions[res]) && permissions[res][act] === true) ||
         (Array.isArray(permissions[res]) && permissions[res].includes(act)) ||
         (typeof permissions[res] === 'boolean' && permissions[res] === true));
    if (req.method === 'GET' && (has('purchasing', 'view') || has('receiving', 'view'))) return next();
    if (has('purchasing', 'view')) return next();
    return res.status(403).json({ error: 'Forbidden: No view permission on purchasing.' });
});
const restrictWrite  = authorize('purchasing', 'create');
const restrictEdit   = authorize('purchasing', 'edit');
const restrictDelete = authorize('purchasing', 'delete');

// =============================================================================
// GET /api/purchase-invoices
// List purchase invoices with filters
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const { supplier_id, search, status, exclude_status, from, to, has_invoice, limit = 20, offset = 0 } = req.query;

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
        if (exclude_status) {
            const excludeStatuses = exclude_status.split(',').filter(s => s.trim());
            if (excludeStatuses.length === 1) {
                where.push(`pi.status != $${paramIdx++}`);
                params.push(excludeStatuses[0]);
            } else if (excludeStatuses.length > 1) {
                const placeholders = excludeStatuses.map((_, i) => `$${paramIdx + i}`).join(', ');
                paramIdx += excludeStatuses.length;
                where.push(`pi.status NOT IN (${placeholders})`);
                params.push(...excludeStatuses);
            }
        }
        if (from) {
            where.push(`pi.invoice_date >= $${paramIdx++}`);
            params.push(from);
        }
        if (to) {
            where.push(`pi.invoice_date <= $${paramIdx++}`);
            params.push(to);
        }
        if (has_invoice === 'true' || has_invoice === 'false') {
            where.push(`pi.has_supplier_invoice = $${paramIdx++}`);
            params.push(has_invoice === 'true');
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
                   pi.status, pi.has_supplier_invoice, pi.notes, pi.created_at,
                   pi.merged_into_invoice_id,
                   (EXISTS(SELECT 1 FROM purchase_invoice_mo_links WHERE purchase_invoice_id = pi.id)) AS is_consolidated,
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
                   pi.status, pi.has_supplier_invoice, pi.notes, pi.created_at,
                   s.id AS supplier_id, s.company_name AS supplier_name,
                   s.phone AS supplier_phone, s.city AS supplier_city,
                   s.commercial_register, s.tax_id AS supplier_tax_id,
                   mo.id AS mo_id, mo.mo_number,
                   c.id AS client_id, c.name AS client_name,
                   u.name AS created_by_name
            FROM purchase_invoices pi
            LEFT JOIN suppliers s ON s.id = pi.supplier_id
            LEFT JOIN manufacturer_orders mo ON mo.id = pi.manufacturer_order_id
            LEFT JOIN orders o ON o.id = mo.order_id
            LEFT JOIN clients c ON c.id = o.client_id
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

// =============================================================================
// POST /api/purchase-invoices/merge
// Merge multiple draft purchase invoices from the SAME supplier into one
// consolidated invoice. The consolidated invoice has manufacturer_order_id=NULL
// and is linked to each original MO via purchase_invoice_mo_links.
//
// Body: { invoice_ids: [uuid, ...], supplier_invoice_ref?: string, notes?: string }
//
// Validations:
//   - At least 2 invoices required
//   - All invoices must have status='draft'
//   - All invoices must belong to the SAME supplier
//   - None of the invoices should already be merged or a consolidated invoice
// =============================================================================
router.post('/merge', restrictEdit, async (req, res) => {
    const { invoice_ids, supplier_invoice_ref, notes } = req.body;

    if (!Array.isArray(invoice_ids) || invoice_ids.length < 2) {
        return res.status(400).json({ error: 'يجب اختيار فاتورتين على الأقل للدمج' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // 1. Load all selected invoices with FOR UPDATE
        const invRes = await client.query(
            `SELECT pi.id, pi.invoice_number, pi.supplier_id, pi.manufacturer_order_id,
                    pi.status, pi.merged_into_invoice_id, pi.has_supplier_invoice,
                    s.company_name AS supplier_name
             FROM purchase_invoices pi
             JOIN suppliers s ON s.id = pi.supplier_id
             WHERE pi.id = ANY($1::uuid[])
             FOR UPDATE OF pi`,
            [invoice_ids]
        );

        if (invRes.rows.length !== invoice_ids.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'بعض الفواتير المختارة غير موجودة' });
        }

        // 2. Validate: all draft, same supplier, not already merged
        const supplierIds = [...new Set(invRes.rows.map(r => r.supplier_id))];
        if (supplierIds.length > 1) {
            await client.query('ROLLBACK');
            const supplierNames = [...new Set(invRes.rows.map(r => r.supplier_name))];
            return res.status(400).json({
                error: `لا يمكن دمج فواتير من موردين مختلفين (${supplierNames.join(' / ')})`
            });
        }

        for (const inv of invRes.rows) {
            if (inv.status !== 'draft') {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: `الفاتورة #${inv.invoice_number} ليست مسودة (حالتها: ${inv.status}) — يمكن دمج المسودات فقط`
                });
            }
            if (inv.merged_into_invoice_id) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: `الفاتورة #${inv.invoice_number} تم دمجها مسبقاً`
                });
            }
        }

        const supplierId = supplierIds[0];

        // 3. Generate new consolidated invoice number
        const seqRes = await client.query(`SELECT nextval('purchase_invoice_seq') AS next`);
        const newInvoiceNumber = seqRes.rows[0].next;

        // 4. Create consolidated invoice (manufacturer_order_id = NULL)
        const consRes = await client.query(
            `INSERT INTO purchase_invoices
               (supplier_id, manufacturer_order_id, invoice_number, invoice_date,
                supplier_invoice_ref, subtotal, tax_rate, tax_amount, grand_total,
                status, notes, created_by, has_supplier_invoice)
             VALUES ($1, NULL, $2, CURRENT_DATE, $3, 0, 0, 0, 0, 'draft', $4, $5, false)
             RETURNING id, invoice_number`,
            [supplierId, newInvoiceNumber, supplier_invoice_ref || null, notes || null, req.user?.id]
        );
        const consolidatedId = consRes.rows[0].id;

        // 5. Copy all items from original invoices into consolidated invoice
        const moIds = new Set();
        for (const inv of invRes.rows) {
            const itemsRes = await client.query(
                `SELECT id, variant_id, quantity, unit_cost, total_cost, manufacturer_order_item_id
                 FROM purchase_invoice_items
                 WHERE purchase_invoice_id = $1`,
                [inv.id]
            );

            for (const item of itemsRes.rows) {
                await client.query(
                    `INSERT INTO purchase_invoice_items
                       (purchase_invoice_id, variant_id, quantity, unit_cost, total_cost,
                        manufacturer_order_item_id)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [consolidatedId, item.variant_id, item.quantity, item.unit_cost,
                     item.total_cost, item.manufacturer_order_item_id]
                );
            }

            // Track MO for junction table
            if (inv.manufacturer_order_id) {
                moIds.add(inv.manufacturer_order_id);
            }

            // 6. Mark original invoice as merged
            await client.query(
                `UPDATE purchase_invoices
                 SET status = 'merged', merged_into_invoice_id = $1, updated_at = NOW()
                 WHERE id = $2`,
                [consolidatedId, inv.id]
            );

            // 7. Re-link receipt sessions to consolidated invoice
            await client.query(
                `UPDATE mo_receipt_sessions
                 SET purchase_invoice_id = $1
                 WHERE purchase_invoice_id = $2`,
                [consolidatedId, inv.id]
            );
        }

        // 8. Create purchase_invoice_mo_links for each MO
        for (const moId of moIds) {
            // Find the original invoice for this MO
            const origInv = invRes.rows.find(r => r.manufacturer_order_id === moId);
            await client.query(
                `INSERT INTO purchase_invoice_mo_links
                   (purchase_invoice_id, manufacturer_order_id, original_invoice_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (purchase_invoice_id, manufacturer_order_id) DO NOTHING`,
                [consolidatedId, moId, origInv?.id || null]
            );
        }

        await client.query('COMMIT');

        return res.status(201).json({
            message: `تم دمج ${invoice_ids.length} فواتير في فاتورة مجمعة #${newInvoiceNumber}`,
            data: {
                consolidated_invoice_id: consolidatedId,
                consolidated_invoice_number: newInvoiceNumber,
                merged_count: invoice_ids.length,
                supplier_id: supplierId,
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[PurchaseInvoices] POST /merge error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    } finally {
        client.release();
    }
});

// =============================================================================
// GET /api/purchase-invoices/mergeable
// Returns draft invoices grouped by supplier, ready for merging
// =============================================================================
router.get('/mergeable', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT
                pi.id,
                pi.invoice_number,
                pi.invoice_date,
                pi.supplier_invoice_ref,
                pi.has_supplier_invoice,
                pi.created_at,
                pi.supplier_id,
                s.company_name AS supplier_name,
                mo.id AS mo_id,
                mo.mo_number,
                o.order_number,
                c.name AS client_name,
                COUNT(pii.id)::int AS item_count,
                COALESCE(SUM(pii.quantity), 0)::numeric AS total_qty
             FROM purchase_invoices pi
             JOIN suppliers s ON s.id = pi.supplier_id
             LEFT JOIN manufacturer_orders mo ON mo.id = pi.manufacturer_order_id
             LEFT JOIN orders o ON o.id = mo.order_id
             LEFT JOIN clients c ON c.id = o.client_id
             LEFT JOIN purchase_invoice_items pii ON pii.purchase_invoice_id = pi.id
             WHERE pi.status = 'draft'
               AND pi.merged_into_invoice_id IS NULL
             GROUP BY pi.id, pi.invoice_number, pi.invoice_date, pi.supplier_invoice_ref,
                      pi.has_supplier_invoice, pi.created_at, pi.supplier_id,
                      s.company_name, mo.id, mo.mo_number, o.order_number, c.name
             ORDER BY s.company_name ASC, pi.invoice_number ASC`
        );

        // Group by supplier
        const bySupplier = {};
        for (const row of result.rows) {
            if (!bySupplier[row.supplier_id]) {
                bySupplier[row.supplier_id] = {
                    supplier_id: row.supplier_id,
                    supplier_name: row.supplier_name,
                    invoices: []
                };
            }
            bySupplier[row.supplier_id].invoices.push({
                id: row.id,
                invoice_number: row.invoice_number,
                invoice_date: row.invoice_date,
                supplier_invoice_ref: row.supplier_invoice_ref,
                has_supplier_invoice: row.has_supplier_invoice,
                created_at: row.created_at,
                mo_id: row.mo_id,
                mo_number: row.mo_number,
                order_number: row.order_number,
                client_name: row.client_name,
                item_count: row.item_count,
                total_qty: parseFloat(row.total_qty)
            });
        }

        // Only include suppliers with 2+ draft invoices
        const mergeable = Object.values(bySupplier).filter(s => s.invoices.length >= 2);

        return res.json({ data: mergeable });
    } catch (err) {
        console.error('[PurchaseInvoices] GET /mergeable error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/purchase-invoices/:id/approve
// Manager approves a draft invoice: sets unit costs, tax, optional payment
// Creates accounting vouchers and updates invoice status to 'posted'
// =============================================================================

async function _getAccountIds(client) {
    const res = await client.query(
        `SELECT code, id FROM accounts WHERE code IN ('1400','2100','1200','2200')`
    );
    const map = {};
    for (const r of res.rows) map[r.code] = r.id;
    return {
        inventory: map['1400'],
        payable:   map['2100'],
        bank:      map['1200'],
        vatInput:  map['2200'],
    };
}

router.post('/:id/approve', restrictEdit, async (req, res) => {
    const { id } = req.params;
    const { items, tax_rate = 0, pay_now = false, pay_amount = 0, pay_notes = '' } = req.body;

    if (!items || !Array.isArray(items) || !items.length) {
        return res.status(400).json({ error: 'يجب إدخال أسعار الأصناف' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // 1. Load invoice and verify it's draft
        const invRes = await client.query(
            `SELECT pi.id, pi.invoice_number, pi.supplier_id, pi.manufacturer_order_id, pi.status, pi.has_supplier_invoice
             FROM purchase_invoices pi WHERE pi.id = $1 FOR UPDATE`,
            [id]
        );
        if (invRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'الفاتورة غير موجودة' });
        }
        const inv = invRes.rows[0];
        if (inv.status !== 'draft') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'الفاتورة ليست مسودة — تم اعتمادها بالفعل' });
        }

        // Get account IDs dynamically from DB
        const acct = await _getAccountIds(client);
        if (!acct.inventory || !acct.payable || !acct.bank) {
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'حسابات المحاسبة غير موجودة — تأكد من seed الـ accounts' });
        }

        // 2. Update each invoice item with unit_cost
        let subtotal = 0;
        for (const item of items) {
            const unitCost = parseFloat(item.unit_cost || 0);
            const itemRes = await client.query(
                `SELECT quantity FROM purchase_invoice_items WHERE id = $1 AND purchase_invoice_id = $2`,
                [item.id, id]
            );
            if (itemRes.rowCount === 0) continue;
            const qty = parseFloat(itemRes.rows[0].quantity || 0);
            const lineTotal = qty * unitCost;
            subtotal += lineTotal;

            await client.query(
                `UPDATE purchase_invoice_items SET unit_cost = $1, total_cost = $2 WHERE id = $3`,
                [unitCost, lineTotal, item.id]
            );
        }

        // 3. Update invoice totals and status
        const taxAmt = subtotal * parseFloat(tax_rate || 0);
        const grandTotal = subtotal + taxAmt;

        await client.query(
            `UPDATE purchase_invoices
             SET subtotal = $1, tax_rate = $2, tax_amount = $3, grand_total = $4, status = 'posted', updated_at = NOW()
             WHERE id = $5`,
            [subtotal, parseFloat(tax_rate || 0), taxAmt, grandTotal, id]
        );

        // 4. Create accounting voucher
        const voucherRes = await client.query(
            `INSERT INTO accounting_vouchers
               (voucher_type, voucher_date, description, total_amount, status, reference_type, reference_id, created_by)
             VALUES ('purchase', CURRENT_DATE, $1, $2, 'posted', 'purchase_invoice', $3, $4)
             RETURNING id`,
            [
                `فاتورة مشتريات #${inv.invoice_number}`,
                grandTotal,
                id,
                req.user?.id
            ]
        );
        const voucherId = voucherRes.rows[0].id;

        // DR Inventory Asset
        await client.query(
            `INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
             VALUES ($1, $2, $3, 0, 'purchase_invoice', $4, $5)`,
            [voucherId, acct.inventory, subtotal, id, `تكلفة بضاعة — فاتورة #${inv.invoice_number}`]
        );

        // DR VAT Input (if tax > 0)
        if (taxAmt > 0) {
            await client.query(
                `INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                 VALUES ($1, $2, $3, 0, 'purchase_invoice', $4, $5)`,
                [voucherId, acct.vatInput, taxAmt, id, `ضريبة مدخلات — فاتورة #${inv.invoice_number}`]
            );
        }

        // CR Accounts Payable
        await client.query(
            `INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
             VALUES ($1, $2, 0, $3, 'supplier', $4, $5)`,
            [voucherId, acct.payable, grandTotal, inv.supplier_id, `مستحق للمورد — فاتورة #${inv.invoice_number}`]
        );

        // Link voucher to receipt sessions
        await client.query(
            `UPDATE mo_receipt_sessions SET accounting_voucher_id = $1 WHERE purchase_invoice_id = $2`,
            [voucherId, id]
        );

        // 5. Optional immediate payment
        let paymentVoucherId = null;
        if (pay_now && parseFloat(pay_amount) > 0) {
            const paidAmt = parseFloat(pay_amount);

            const payVoucherRes = await client.query(
                `INSERT INTO accounting_vouchers
                   (voucher_type, voucher_date, description, total_amount, status, reference_type, reference_id, created_by)
                 VALUES ('payment', CURRENT_DATE, $1, $2, 'posted', 'purchase_invoice', $3, $4)
                 RETURNING id`,
                [
                    `دفع للمورد — فاتورة #${inv.invoice_number}${pay_notes ? ' — ' + pay_notes : ''}`,
                    paidAmt,
                    id,
                    req.user?.id
                ]
            );
            paymentVoucherId = payVoucherRes.rows[0].id;

            await client.query(
                `INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                 VALUES ($1, $2, $3, 0, 'supplier', $4, $5)`,
                [paymentVoucherId, acct.payable, paidAmt, inv.supplier_id, `تسوية ذمة مورد — فاتورة #${inv.invoice_number}`]
            );
            await client.query(
                `INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                 VALUES ($1, $2, 0, $3, 'purchase_invoice', $4, $5)`,
                [paymentVoucherId, acct.bank, paidAmt, id, `دفع بنكي — فاتورة #${inv.invoice_number}`]
            );

            await client.query(
                `UPDATE purchase_invoices SET paid_amount = $1 WHERE id = $2`,
                [paidAmt, id]
            );
        }

        await client.query('COMMIT');

        return res.json({
            message: 'تم اعتماد الفاتورة وإنشاء القيود المحاسبية بنجاح',
            data: { invoice_id: id, subtotal, tax_amount: taxAmt, grand_total: grandTotal, voucher_id: voucherId, payment_voucher_id: paymentVoucherId }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[PurchaseInvoices] POST /:id/approve error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    } finally {
        client.release();
    }
});

// =============================================================================
// POST /api/purchase-invoices/:id/edit
// Edit an approved/posted invoice: revert old vouchers, update prices/tax, recreate vouchers
// =============================================================================
router.post('/:id/edit', restrictEdit, async (req, res) => {
    const { id } = req.params;
    const { items, tax_rate = 0, pay_now = false, pay_amount = 0, pay_notes = '' } = req.body;

    if (!items || !Array.isArray(items) || !items.length) {
        return res.status(400).json({ error: 'يجب إدخال أسعار الأصناف' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // 1. Load invoice
        const invRes = await client.query(
            `SELECT pi.id, pi.invoice_number, pi.supplier_id, pi.manufacturer_order_id, pi.status, pi.has_supplier_invoice
             FROM purchase_invoices pi WHERE pi.id = $1 FOR UPDATE`,
            [id]
        );
        if (invRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'الفاتورة غير موجودة' });
        }
        const inv = invRes.rows[0];
        if (inv.status === 'draft') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'الفاتورة مسودة — استخدم الاعتماد بدلاً من التعديل' });
        }
        if (inv.status === 'cancelled') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'الفاتورة ملغية — لا يمكن تعديلها' });
        }

        // Get account IDs dynamically from DB
        const acct = await _getAccountIds(client);
        if (!acct.inventory || !acct.payable || !acct.bank) {
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'حسابات المحاسبة غير موجودة — تأكد من seed الـ accounts' });
        }

        // 2. Revert old accounting vouchers (delete all vouchers linked to this invoice)
        const oldVouchers = await client.query(
            `SELECT id FROM accounting_vouchers WHERE reference_type = 'purchase_invoice' AND reference_id = $1`,
            [id]
        );
        for (const v of oldVouchers.rows) {
            await client.query(`DELETE FROM accounting_voucher_lines WHERE voucher_id = $1`, [v.id]);
            await client.query(`DELETE FROM accounting_vouchers WHERE id = $1`, [v.id]);
        }

        // 3. Update each invoice item with new unit_cost
        let subtotal = 0;
        for (const item of items) {
            const unitCost = parseFloat(item.unit_cost || 0);
            const itemRes = await client.query(
                `SELECT quantity FROM purchase_invoice_items WHERE id = $1 AND purchase_invoice_id = $2`,
                [item.id, id]
            );
            if (itemRes.rowCount === 0) continue;
            const qty = parseFloat(itemRes.rows[0].quantity || 0);
            const lineTotal = qty * unitCost;
            subtotal += lineTotal;

            await client.query(
                `UPDATE purchase_invoice_items SET unit_cost = $1, total_cost = $2 WHERE id = $3`,
                [unitCost, lineTotal, item.id]
            );
        }

        // 4. Update invoice totals
        const taxAmt = subtotal * parseFloat(tax_rate || 0);
        const grandTotal = subtotal + taxAmt;

        await client.query(
            `UPDATE purchase_invoices
             SET subtotal = $1, tax_rate = $2, tax_amount = $3, grand_total = $4, paid_amount = 0, updated_at = NOW()
             WHERE id = $5`,
            [subtotal, parseFloat(tax_rate || 0), taxAmt, grandTotal, id]
        );

        // 5. Create new accounting voucher
        const voucherRes = await client.query(
            `INSERT INTO accounting_vouchers
               (voucher_type, voucher_date, description, total_amount, status, reference_type, reference_id, created_by)
             VALUES ('purchase', CURRENT_DATE, $1, $2, 'posted', 'purchase_invoice', $3, $4)
             RETURNING id`,
            [
                `فاتورة مشتريات #${inv.invoice_number} (تعديل)`,
                grandTotal,
                id,
                req.user?.id
            ]
        );
        const voucherId = voucherRes.rows[0].id;

        // DR Inventory Asset
        await client.query(
            `INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
             VALUES ($1, $2, $3, 0, 'purchase_invoice', $4, $5)`,
            [voucherId, acct.inventory, subtotal, id, `تكلفة بضاعة — فاتورة #${inv.invoice_number} (تعديل)`]
        );

        // DR VAT Input (if tax > 0)
        if (taxAmt > 0) {
            await client.query(
                `INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                 VALUES ($1, $2, $3, 0, 'purchase_invoice', $4, $5)`,
                [voucherId, acct.vatInput, taxAmt, id, `ضريبة مدخلات — فاتورة #${inv.invoice_number} (تعديل)`]
            );
        }

        // CR Accounts Payable
        await client.query(
            `INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
             VALUES ($1, $2, 0, $3, 'supplier', $4, $5)`,
            [voucherId, acct.payable, grandTotal, inv.supplier_id, `مستحق للمورد — فاتورة #${inv.invoice_number} (تعديل)`]
        );

        // Link voucher to receipt sessions
        await client.query(
            `UPDATE mo_receipt_sessions SET accounting_voucher_id = $1 WHERE purchase_invoice_id = $2`,
            [voucherId, id]
        );

        // 6. Optional immediate payment
        let paymentVoucherId = null;
        if (pay_now && parseFloat(pay_amount) > 0) {
            const paidAmt = parseFloat(pay_amount);

            const payVoucherRes = await client.query(
                `INSERT INTO accounting_vouchers
                   (voucher_type, voucher_date, description, total_amount, status, reference_type, reference_id, created_by)
                 VALUES ('payment', CURRENT_DATE, $1, $2, 'posted', 'purchase_invoice', $3, $4)
                 RETURNING id`,
                [
                    `دفع للمورد — فاتورة #${inv.invoice_number} (تعديل)${pay_notes ? ' — ' + pay_notes : ''}`,
                    paidAmt,
                    id,
                    req.user?.id
                ]
            );
            paymentVoucherId = payVoucherRes.rows[0].id;

            await client.query(
                `INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                 VALUES ($1, $2, $3, 0, 'supplier', $4, $5)`,
                [paymentVoucherId, acct.payable, paidAmt, inv.supplier_id, `تسوية ذمة مورد — فاتورة #${inv.invoice_number} (تعديل)`]
            );
            await client.query(
                `INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id, description)
                 VALUES ($1, $2, 0, $3, 'purchase_invoice', $4, $5)`,
                [paymentVoucherId, acct.bank, paidAmt, id, `دفع بنكي — فاتورة #${inv.invoice_number} (تعديل)`]
            );

            await client.query(
                `UPDATE purchase_invoices SET paid_amount = $1 WHERE id = $2`,
                [paidAmt, id]
            );
        }

        await client.query('COMMIT');

        return res.json({
            message: 'تم تعديل الفاتورة وإعادة إنشاء القيود المحاسبية بنجاح',
            data: { invoice_id: id, subtotal, tax_amount: taxAmt, grand_total: grandTotal, voucher_id: voucherId, payment_voucher_id: paymentVoucherId }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[PurchaseInvoices] POST /:id/edit error:', err.message);
        return res.status(400).json({ error: err.message || 'Internal server error.' });
    } finally {
        client.release();
    }
});

module.exports = router;
