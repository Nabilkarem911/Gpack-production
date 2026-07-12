'use strict';

// =============================================================================
// G.PACK 2.0 — Public Invoice View API (No Auth Required)
// =============================================================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashToken } = require('../utils/crypto');

// ── GET /api/public/invoice/:id ─────────────────────────────────────────────
// Public invoice details (view only, no auth required)
router.get('/:identifier', async (req, res) => {
    try {
        const { identifier } = req.params;

        // Try lookup by share_token_hash first (secure links)
        let viaToken = false;
        let invRes = null;

        const selectFields = `
            i.id, i.invoice_number, i.invoice_date, i.due_date,
            i.status, i.subtotal, i.tax_rate, i.tax_amount, i.additional_expenses,
            i.discount_amount, i.grand_total,
            i.notes, i.created_at, i.share_token, i.token_expires_at,
            c.id AS client_id, c.name AS client_name, c.phone AS client_phone,
            c.email AS client_email, c.address AS client_address,
            c.tax_id AS client_tax_number,
            o.id AS order_id, o.order_number
        `;

        try {
            const tokenHash = hashToken(identifier);
            invRes = await db.query(`
                SELECT ${selectFields}
                FROM invoices i
                LEFT JOIN clients c ON c.id = i.client_id
                LEFT JOIN orders o ON o.id = i.order_id
                WHERE i.share_token_hash = $1 AND i.status != 'cancelled'
            `, [tokenHash]);
            if (invRes.rows.length > 0) viaToken = true;
        } catch (_e) { /* hashToken may throw if SHARE_TOKEN_SECRET missing */ }

        // Fallback: plaintext share_token (backward compatibility)
        if (!invRes || invRes.rows.length === 0) {
            invRes = await db.query(`
                SELECT ${selectFields}
                FROM invoices i
                LEFT JOIN clients c ON c.id = i.client_id
                LEFT JOIN orders o ON o.id = i.order_id
                WHERE i.share_token = $1 AND i.status != 'cancelled'
            `, [identifier]);
            if (invRes.rows.length > 0) viaToken = true;
        }

        // Fallback to ID lookup for backward compatibility
        if (!invRes || invRes.rows.length === 0) {
            invRes = await db.query(`
                SELECT ${selectFields}
                FROM invoices i
                LEFT JOIN clients c ON c.id = i.client_id
                LEFT JOIN orders o ON o.id = i.order_id
                WHERE i.id = $1 AND i.status != 'cancelled'
            `, [identifier]);
        }

        if (!invRes.rows.length) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        const invoice = invRes.rows[0];

        // If accessed via share_token, check expiry
        if (viaToken && invoice.token_expires_at && new Date(invoice.token_expires_at) < new Date()) {
            return res.status(410).json({ error: 'انتهت صلاحية هذا الرابط.' });
        }

        const id = invoice.id;

        // Invoice items
        const itemsRes = await db.query(`
            SELECT
                ii.id, ii.quantity, ii.unit_price, ii.discount_percent, ii.line_total,
                pv.id AS variant_id, pv.size_name,
                p.id AS product_id, p.name AS product_name
            FROM invoice_items ii
            JOIN product_variants pv ON pv.id = ii.variant_id
            JOIN products p ON p.id = pv.product_id
            WHERE ii.invoice_id = $1
        `, [id]);

        invoice.items = itemsRes.rows;

        // Additional expenses
        const expRes = await db.query(`
            SELECT id, description, amount
            FROM invoice_expenses
            WHERE invoice_id = $1
        `, [id]);
        invoice.expenses = expRes.rows;

        // Payments (stored in client_transactions linked by invoice_id OR order_id)
        const orderId = invoice.order_id;
        const payRes = await db.query(`
            SELECT id, amount, payment_method, description, created_at
            FROM client_transactions
            WHERE (invoice_id = $1 OR (order_id = $2 AND type = 'payment'))
              AND type IN ('receipt', 'payment')
            ORDER BY created_at ASC
        `, [id, orderId]);
        invoice.payments = payRes.rows;

        res.json({ data: invoice });

    } catch (err) {
        console.error('[PublicInvoice] GET error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
