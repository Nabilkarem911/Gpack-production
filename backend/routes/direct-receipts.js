'use strict';

// =============================================================================
// G.PACK 2.0 — Direct Receipts API (استلام مؤقت)
// Purpose: Warehouse keeper records incoming goods without prior order.
//          Manager reviews and converts to purchase invoice.
// =============================================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { authenticate } = require('../middleware/authMiddleware');
const authorize = require('../middleware/authorize');
const { getVatRate } = require('../utils/settings');

// ── Upload config ────────────────────────────────────────────────────────────
const UPLOAD_BASE = path.join(__dirname, '../uploads/direct-receipts');
if (!fs.existsSync(UPLOAD_BASE)) fs.mkdirSync(UPLOAD_BASE, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
        const tempDir = path.join(UPLOAD_BASE, 'temp');
        fs.mkdirSync(tempDir, { recursive: true });
        cb(null, tempDir);
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, unique + ext);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp|pdf/;
        const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
        const mimeOk = allowed.test(file.mimetype);
        cb(null, extOk && mimeOk);
    },
});

router.use(authenticate);

// ── Helpers ──────────────────────────────────────────────────────────────────
function _moveFile(tempPath, targetDir, fileName) {
    if (!tempPath || !fs.existsSync(tempPath)) return null;
    fs.mkdirSync(targetDir, { recursive: true });
    const target = path.join(targetDir, fileName);
    fs.renameSync(tempPath, target);
    return `/uploads/direct-receipts/${path.basename(targetDir)}/${fileName}`;
}

// =============================================================================
// GET /api/direct-receipts
// List direct receipts with filters
// Query: ?status=pending_review|converted|cancelled &search &limit &offset
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const { status, search, limit = 20, offset = 0 } = req.query;
        let where = ['1=1'];
        const params = [];
        let idx = 1;

        if (status) {
            where.push(`dr.status = $${idx++}`);
            params.push(status);
        }
        if (search) {
            where.push(`(dr.receipt_number::text ILIKE $${idx} OR dri.product_name ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx++;
        }

        const whereClause = where.join(' AND ');

        const countRes = await db.query(`
            SELECT COUNT(DISTINCT dr.id)::int AS total
            FROM direct_receipts dr
            LEFT JOIN direct_receipt_items dri ON dri.direct_receipt_id = dr.id
            WHERE ${whereClause}
        `, params);

        const dataRes = await db.query(`
            SELECT dr.id, dr.receipt_number, dr.has_invoice, dr.status,
                   dr.received_at, dr.notes, dr.converted_at,
                   dr.supplier_id, s.company_name AS supplier_name,
                   dr.warehouse_id, w.name AS warehouse_name,
                   dr.purchase_invoice_id,
                   u.name AS received_by_name,
                   (SELECT COUNT(*)::int FROM direct_receipt_items WHERE direct_receipt_id = dr.id) AS item_count
            FROM direct_receipts dr
            LEFT JOIN suppliers s ON s.id = dr.supplier_id
            LEFT JOIN warehouses w ON w.id = dr.warehouse_id
            LEFT JOIN users u ON u.id = dr.received_by
            WHERE ${whereClause}
            GROUP BY dr.id, s.company_name, w.name, u.name
            ORDER BY dr.received_at DESC
            LIMIT $${idx++} OFFSET $${idx++}
        `, [...params, parseInt(limit), parseInt(offset)]);

        res.json({
            data: dataRes.rows,
            total: countRes.rows[0].total,
            limit: parseInt(limit),
            offset: parseInt(offset),
        });
    } catch (err) {
        console.error('[DirectReceipts] GET / error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// GET /api/direct-receipts/:id
// Get single direct receipt with items
// =============================================================================
router.get('/:id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', async (req, res) => {
    try {
        const { id } = req.params;

        const hdrRes = await db.query(`
            SELECT dr.*, s.company_name AS supplier_name, w.name AS warehouse_name,
                   u.name AS received_by_name, u2.name AS converted_by_name,
                   pi.invoice_number AS purchase_invoice_number
            FROM direct_receipts dr
            LEFT JOIN suppliers s ON s.id = dr.supplier_id
            LEFT JOIN warehouses w ON w.id = dr.warehouse_id
            LEFT JOIN users u ON u.id = dr.received_by
            LEFT JOIN users u2 ON u2.id = dr.converted_by
            LEFT JOIN purchase_invoices pi ON pi.id = dr.purchase_invoice_id
            WHERE dr.id = $1
        `, [id]);

        if (!hdrRes.rows.length) {
            return res.status(404).json({ error: 'Receipt not found' });
        }

        const itemsRes = await db.query(`
            SELECT dri.*, pv.size_name, p.name AS matched_product_name,
                   u.name AS matched_unit_name
            FROM direct_receipt_items dri
            LEFT JOIN product_variants pv ON pv.id = dri.variant_id
            LEFT JOIN products p ON p.id = pv.product_id
            LEFT JOIN units u ON u.id = dri.unit_id
            WHERE dri.direct_receipt_id = $1
            ORDER BY dri.sort_order
        `, [id]);

        res.json({
            data: {
                ...hdrRes.rows[0],
                items: itemsRes.rows,
            },
        });
    } catch (err) {
        console.error('[DirectReceipts] GET /:id error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// =============================================================================
// POST /api/direct-receipts
// Create new direct receipt (warehouse keeper)
// multipart/form-data:
//   has_invoice, notes, items (JSON array: [{product_name, unit_name, quantity, notes}])
//   product_photos[] (optional), invoice_photos[] (optional)
// =============================================================================
router.post('/', upload.fields([
    { name: 'product_photos', maxCount: 20 },
    { name: 'invoice_photos', maxCount: 5 },
]), async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const hasInvoice = req.body.has_invoice === 'true' || req.body.has_invoice === true;
        const notes = req.body.notes || null;
        let items = [];

        try {
            items = typeof req.body.items === 'string' ? JSON.parse(req.body.items) : req.body.items;
        } catch (_e) {
            return res.status(400).json({ error: 'Invalid items JSON' });
        }

        if (!items || !Array.isArray(items) || !items.length) {
            return res.status(400).json({ error: 'At least one item is required' });
        }

        // Create receipt header
        const receiptRes = await client.query(`
            INSERT INTO direct_receipts (has_invoice, status, received_by, received_at, notes)
            VALUES ($1, 'pending_review', $2, NOW(), $3)
            RETURNING id, receipt_number
        `, [hasInvoice, req.user.id, notes]);

        const receiptId = receiptRes.rows[0].id;
        const receiptNumber = receiptRes.rows[0].receipt_number;
        const receiptDir = path.join(UPLOAD_BASE, receiptId);
        fs.mkdirSync(receiptDir, { recursive: true });

        const productPhotos = req.files?.product_photos || [];
        const invoicePhotos = req.files?.invoice_photos || [];

        // Create items
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            let productPhotoUrl = null;
            let invoicePhotoUrl = null;

            if (productPhotos[i]) {
                productPhotoUrl = _moveFile(productPhotos[i].path, receiptDir, productPhotos[i].filename);
            }
            if (hasInvoice && invoicePhotos[i]) {
                invoicePhotoUrl = _moveFile(invoicePhotos[i].path, receiptDir, invoicePhotos[i].filename);
            }

            await client.query(`
                INSERT INTO direct_receipt_items (
                    direct_receipt_id, product_name, unit_name, quantity,
                    product_photo_url, invoice_photo_url, notes, sort_order
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                receiptId,
                item.product_name || '',
                item.unit_name || '',
                parseFloat(item.quantity) || 0,
                productPhotoUrl,
                invoicePhotoUrl,
                item.notes || null,
                i,
            ]);
        }

        // Clean up temp files that weren't moved
        const tempDir = path.join(UPLOAD_BASE, 'temp');
        if (fs.existsSync(tempDir)) {
            fs.readdirSync(tempDir).forEach(f => {
                const fp = path.join(tempDir, f);
                if (fs.existsSync(fp)) {
                    try { fs.unlinkSync(fp); } catch (_e) {}
                }
            });
        }

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Direct receipt created',
            data: { id: receiptId, receipt_number: receiptNumber },
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[DirectReceipts] POST / error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    } finally {
        client.release();
    }
});

// =============================================================================
// PUT /api/direct-receipts/:id/review
// Manager reviews and updates items with variant_id, unit_id, warehouse, supplier, costs
// Body: {
//   supplier_id, supplier_invoice_ref, supplier_invoice_date, warehouse_id,
//   items: [{ id, variant_id, unit_id, confirmed_quantity, unit_cost }]
// }
// =============================================================================
router.put('/:id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/review',
    authorize('purchasing', 'create'),
    async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const { id } = req.params;
        const {
            supplier_id,
            supplier_invoice_ref,
            supplier_invoice_date,
            warehouse_id,
            items,
        } = req.body;

        if (!supplier_id || !warehouse_id || !items?.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'supplier_id, warehouse_id, and items are required' });
        }

        // Verify receipt exists and is pending
        const checkRes = await client.query(
            'SELECT status FROM direct_receipts WHERE id = $1 FOR UPDATE',
            [id]
        );
        if (!checkRes.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Receipt not found' });
        }
        if (checkRes.rows[0].status !== 'pending_review') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Receipt already processed' });
        }

        // Update receipt header with review data
        await client.query(`
            UPDATE direct_receipts
            SET supplier_id = $1, supplier_invoice_ref = $2, supplier_invoice_date = $3,
                warehouse_id = $4, updated_at = NOW()
            WHERE id = $5
        `, [supplier_id, supplier_invoice_ref || null, supplier_invoice_date || null, warehouse_id, id]);

        // Update each item with reviewed data
        for (const item of items) {
            if (!item.variant_id) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: `Item "${item.product_name}" must be linked to a product variant` });
            }
            await client.query(`
                UPDATE direct_receipt_items
                SET variant_id = $1, unit_id = $2, confirmed_quantity = $3, unit_cost = $4
                WHERE id = $5 AND direct_receipt_id = $6
            `, [
                item.variant_id,
                item.unit_id || null,
                parseFloat(item.confirmed_quantity) || 0,
                parseFloat(item.unit_cost) || 0,
                item.id,
                id,
            ]);
        }

        await client.query('COMMIT');

        res.json({ message: 'Review saved successfully' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[DirectReceipts] PUT /review error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    } finally {
        client.release();
    }
});

// =============================================================================
// POST /api/direct-receipts/:id/convert
// Convert reviewed direct receipt to purchase invoice + update warehouse stock
// =============================================================================
router.post('/:id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/convert',
    authorize('purchasing', 'create'),
    async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const { id } = req.params;

        // Lock receipt
        const receiptRes = await client.query(`
            SELECT dr.*, s.company_name AS supplier_name
            FROM direct_receipts dr
            LEFT JOIN suppliers s ON s.id = dr.supplier_id
            WHERE dr.id = $1 FOR UPDATE
        `, [id]);

        if (!receiptRes.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Receipt not found' });
        }

        const receipt = receiptRes.rows[0];

        if (receipt.status !== 'pending_review') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Receipt already processed' });
        }

        if (!receipt.supplier_id || !receipt.warehouse_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Receipt must be reviewed first (supplier and warehouse required)' });
        }

        // Get reviewed items
        const itemsRes = await client.query(`
            SELECT dri.*, pv.product_id
            FROM direct_receipt_items dri
            JOIN product_variants pv ON pv.id = dri.variant_id
            WHERE dri.direct_receipt_id = $1 AND dri.variant_id IS NOT NULL
            ORDER BY dri.sort_order
        `, [id]);

        if (!itemsRes.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No items linked to product variants' });
        }

        const items = itemsRes.rows;

        // Calculate totals
        let subtotal = 0;
        for (const item of items) {
            const qty = parseFloat(item.confirmed_quantity) || 0;
            const cost = parseFloat(item.unit_cost) || 0;
            subtotal += qty * cost;
        }

        const taxRate = await getVatRate();
        const taxAmount = subtotal * taxRate;
        const grandTotal = subtotal + taxAmount;

        // Generate purchase invoice number
        const seqRes = await client.query(`SELECT nextval('purchase_invoice_seq') AS next`);
        const invoiceNumber = seqRes.rows[0].next;

        // Create purchase invoice
        const invRes = await client.query(`
            INSERT INTO purchase_invoices (
                supplier_id, invoice_number, invoice_date,
                supplier_invoice_ref, subtotal, tax_rate, tax_amount, grand_total,
                status, has_supplier_invoice, notes, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unpaid', $9, $10, $11)
            RETURNING id, invoice_number
        `, [
            receipt.supplier_id,
            invoiceNumber,
            receipt.supplier_invoice_date || new Date().toISOString().slice(0, 10),
            receipt.supplier_invoice_ref || null,
            subtotal,
            taxRate,
            taxAmount,
            grandTotal,
            receipt.has_invoice,
            `محول من استلام مؤقت #${receipt.receipt_number}`,
            req.user.id,
        ]);

        const purchaseInvoiceId = invRes.rows[0].id;

        // Create purchase invoice items + update warehouse stock
        for (const item of items) {
            const qty = parseFloat(item.confirmed_quantity) || 0;
            const cost = parseFloat(item.unit_cost) || 0;

            await client.query(`
                INSERT INTO purchase_invoice_items (
                    purchase_invoice_id, variant_id, quantity, unit_cost, total_cost, product_name
                ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                purchaseInvoiceId,
                item.variant_id,
                qty,
                cost,
                qty * cost,
                item.product_name,
            ]);

            // Update warehouse_stock (upsert — client_id is NULL for direct receipts)
            // PostgreSQL: ON CONFLICT doesn't match NULL values, so we use a manual merge
            const stockRes = await client.query(`
                SELECT id, quantity FROM warehouse_stock
                WHERE warehouse_id = $1 AND variant_id = $2 AND client_id IS NULL
                FOR UPDATE
            `, [receipt.warehouse_id, item.variant_id]);

            if (stockRes.rows.length) {
                await client.query(`
                    UPDATE warehouse_stock
                    SET quantity = quantity + $1, last_updated = NOW()
                    WHERE id = $2
                `, [qty, stockRes.rows[0].id]);
            } else {
                await client.query(`
                    INSERT INTO warehouse_stock (warehouse_id, variant_id, client_id, quantity)
                    VALUES ($1, $2, NULL, $3)
                `, [receipt.warehouse_id, item.variant_id, qty]);
            }

            // Record inventory transaction
            await client.query(`
                INSERT INTO inventory_transactions (
                    warehouse_id, variant_id, transaction_type, quantity,
                    reference_type, reference_id, notes, created_by
                ) VALUES ($1, $2, 'receipt', $3, 'direct_receipt', $4, $5, $6)
            `, [
                receipt.warehouse_id,
                item.variant_id,
                qty,
                id,
                `استلام مؤقت #${receipt.receipt_number}`,
                req.user.id,
            ]);
        }

        // Mark receipt as converted
        await client.query(`
            UPDATE direct_receipts
            SET status = 'converted', converted_at = NOW(),
                purchase_invoice_id = $1, converted_by = $2, updated_at = NOW()
            WHERE id = $3
        `, [purchaseInvoiceId, req.user.id, id]);

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Converted to purchase invoice successfully',
            data: {
                purchase_invoice_id: purchaseInvoiceId,
                invoice_number: invRes.rows[0].invoice_number,
            },
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[DirectReceipts] POST /convert error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    } finally {
        client.release();
    }
});

// =============================================================================
// PUT /api/direct-receipts/:id/cancel
// Cancel a pending direct receipt
// =============================================================================
router.put('/:id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/cancel',
    authorize('purchasing', 'create'),
    async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(`
            UPDATE direct_receipts
            SET status = 'cancelled', updated_at = NOW()
            WHERE id = $1 AND status = 'pending_review'
            RETURNING id
        `, [id]);

        if (!result.rows.length) {
            return res.status(400).json({ error: 'Receipt not found or already processed' });
        }

        res.json({ message: 'Receipt cancelled' });
    } catch (err) {
        console.error('[DirectReceipts] PUT /cancel error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
