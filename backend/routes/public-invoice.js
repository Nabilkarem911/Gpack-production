'use strict';

// =============================================================================
// G.PACK 2.0 — Public Invoice View API (No Auth Required)
// =============================================================================

const express = require('express');
const router = express.Router();
const db = require('../db');

// ── GET /api/public/invoice/:id ─────────────────────────────────────────────
// Public invoice details (view only, no auth required)
router.get('/:identifier', async (req, res) => {
    try {
        const { identifier } = req.params;

        // Try lookup by share_token first (secure links)
        let invRes = await db.query(`
            SELECT
                i.id, i.invoice_number, i.invoice_date, i.due_date,
                i.status, i.subtotal, i.tax_amount, i.additional_expenses, i.grand_total,
                i.notes, i.created_at, i.share_token, i.token_expires_at,
                c.id AS client_id, c.name AS client_name, c.phone AS client_phone
            FROM invoices i
            LEFT JOIN clients c ON c.id = i.client_id
            WHERE i.share_token = $1 AND i.status != 'cancelled'
        `, [identifier]);

        let viaToken = false;
        if (invRes.rows.length > 0) {
            viaToken = true;
        } else {
            // Fallback to ID lookup for backward compatibility
            invRes = await db.query(`
                SELECT
                    i.id, i.invoice_number, i.invoice_date, i.due_date,
                    i.status, i.subtotal, i.tax_amount, i.additional_expenses, i.grand_total,
                    i.notes, i.created_at, i.share_token, i.token_expires_at,
                    c.id AS client_id, c.name AS client_name, c.phone AS client_phone
                FROM invoices i
                LEFT JOIN clients c ON c.id = i.client_id
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

        res.json({ data: invoice });

    } catch (err) {
        console.error('[PublicInvoice] GET error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
