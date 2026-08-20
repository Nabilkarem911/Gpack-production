'use strict';

// =============================================================================
// Public Client Portal — Permanent link for clients to view their orders,
// payments, delivery timeline, and order details.
//
// POST /api/public/client-portal/generate           → generate/reuse portal token (auth'd)
// GET  /api/public/client-portal/:token             → client profile + orders list (no auth)
// GET  /api/public/client-portal/:token/orders/:id  → single order detail with items/payments/timeline (no auth)
//
// Routes are mounted at /api/public in server.js.
// Token is permanent (no expiry) per user request.
// =============================================================================

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { success } = require('../utils/response');
const { encryptToken, hashToken, hasShareTokenSecret, decryptShareToken } = require('../utils/crypto');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

const ORDER_STATUS_LABELS = {
    quote: { label: 'عرض سعر', color: 'bg-amber-100 text-amber-700' },
    confirmed: { label: 'مؤكد', color: 'bg-blue-100 text-blue-700' },
    production: { label: 'قيد التصنيع', color: 'bg-purple-100 text-purple-700' },
    processing: { label: 'قيد التجهيز', color: 'bg-indigo-100 text-indigo-700' },
    completed: { label: 'تم الانتهاء', color: 'bg-emerald-100 text-emerald-700' },
    shipped: { label: 'تم الشحن', color: 'bg-cyan-100 text-cyan-700' },
    delivered: { label: 'تم التسليم', color: 'bg-teal-100 text-teal-700' },
    cancelled: { label: 'ملغي', color: 'bg-red-100 text-red-700' },
    archived: { label: 'مؤرشف', color: 'bg-slate-100 text-slate-500' },
    draft: { label: 'مسودة', color: 'bg-slate-100 text-slate-500' },
};

function _orderBadge(status) {
    return ORDER_STATUS_LABELS[status] || { label: status || '—', color: 'bg-slate-100 text-slate-600' };
}

function _safeDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function _dateOnly(value) {
    const d = _safeDate(value);
    if (!d) return null;
    return d.toISOString().slice(0, 10);
}

function _todayIso() {
    return new Date().toISOString().slice(0, 10);
}

async function _resolveClientFromToken(token) {
    let tokenHash = null;
    try { tokenHash = hashToken(token); } catch (_e) { /* SECRET missing — fallback */ }

    let result = null;
    if (tokenHash) {
        result = await db.query(
            `SELECT id, name, contact_person, phone, email, city, status, portal_token, portal_last_accessed
             FROM clients
             WHERE portal_token_hash = $1 AND status = 'active'`,
            [tokenHash]
        );
    }

    if (!result || result.rowCount === 0) {
        result = await db.query(
            `SELECT id, name, contact_person, phone, email, city, status, portal_token, portal_last_accessed
             FROM clients
             WHERE portal_token = $1 AND status = 'active'`,
            [token]
        );
    }

    return result.rowCount > 0 ? result.rows[0] : null;
}

function _deriveOrderStatus(order) {
    const status = order?.status || 'draft';
    if (status === 'delivered') return 'delivered';

    const deliveredQty = parseFloat(order?.delivered_qty || 0);
    const totalQty = parseFloat(order?.total_qty || 0);
    const releasedQty = parseFloat(order?.released_qty || 0);
    const receivedQty = parseFloat(order?.wh_received_qty || 0);
    const manufacturerQty = parseFloat(order?.manufacturer_po_qty || 0);
    const completedDeliveryAt = _safeDate(order?.completed_delivery_at);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (deliveredQty > 0 && totalQty > 0 && deliveredQty >= totalQty && completedDeliveryAt && completedDeliveryAt < todayStart) {
        return 'delivered';
    }
    if (releasedQty > 0 && totalQty > 0 && releasedQty >= totalQty) return 'shipped';
    if (receivedQty > 0 && totalQty > 0 && receivedQty >= totalQty) return 'completed';
    if (manufacturerQty > 0 || status === 'production' || status === 'processing') return 'production';
    return status;
}

function _buildTimeline(order) {
    const timeline = [];
    const totalQty = parseFloat(order?.total_qty || 0);
    const whReceivedQty = parseFloat(order?.wh_received_qty || 0);
    const releasedQty = parseFloat(order?.released_qty || 0);
    const deliveredQty = parseFloat(order?.delivered_qty || 0);

    timeline.push({
        key: 'production',
        label: 'قيد التصنيع',
        status: 'production',
        date: _dateOnly(order?.production_started_at) || _dateOnly(order?.updated_at) || _dateOnly(order?.order_date),
        active: ['production', 'processing', 'completed', 'shipped', 'delivered'].includes(order?.derived_status),
        description: 'تم إرسال الطلب للتصنيع لدى المورد/الإنتاج الداخلي.'
    });

    timeline.push({
        key: 'completed',
        label: 'تم الانتهاء',
        status: 'completed',
        date: whReceivedQty > 0 ? _dateOnly(order?.completed_at) || _dateOnly(order?.updated_at) || _dateOnly(order?.order_date) : null,
        active: ['completed', 'shipped', 'delivered'].includes(order?.derived_status) || (totalQty > 0 && whReceivedQty >= totalQty),
        description: 'تم الاستلام الكلي للصنف من المستودع.'
    });

    timeline.push({
        key: 'shipped',
        label: 'تم الشحن',
        status: 'shipped',
        date: releasedQty > 0 ? _dateOnly(order?.shipped_at) || _dateOnly(order?.updated_at) || _dateOnly(order?.order_date) : null,
        active: ['shipped', 'delivered'].includes(order?.derived_status) || (totalQty > 0 && releasedQty >= totalQty),
        description: 'تم التسليم الكامل من سندات التسليم.'
    });

    timeline.push({
        key: 'delivered',
        label: 'تم التسليم',
        status: 'delivered',
        date: order?.derived_status === 'delivered' ? _dateOnly(order?.completed_delivery_at) || _todayIso() : null,
        active: order?.derived_status === 'delivered',
        description: totalQty > 0 ? `إجمالي الكمية المتصلة بالطلب: ${totalQty}` : 'تم التسليم تلقائياً بعد منتصف الليل.'
    });

    if (deliveredQty > 0 && totalQty > 0 && deliveredQty < totalQty) {
        timeline[3].description = `تم تسليم ${deliveredQty} من ${totalQty}.`;
    }

    return timeline;
}

router.post('/client-portal/generate', authenticate, async (req, res) => {
    const { client_id } = req.body;

    if (!client_id) {
        return res.status(400).json({ error: 'client_id مطلوب.' });
    }

    try {
        const clientRes = await db.query(
            `SELECT id, name, portal_token FROM clients WHERE id = $1`,
            [client_id]
        );

        if (clientRes.rowCount === 0) {
            return res.status(404).json({ error: 'العميل غير موجود.' });
        }

        const client = clientRes.rows[0];

        let plainToken = null;
        if (client.portal_token) {
            plainToken = decryptShareToken(client.portal_token);
        }

        if (!plainToken) {
            plainToken = crypto.randomBytes(32).toString('hex');

            let storedToken = plainToken;
            let tokenHash;
            try {
                storedToken = encryptToken(plainToken);
                tokenHash = hashToken(plainToken);
            } catch (cryptoErr) {
                console.error('[ClientPortal] Crypto error:', cryptoErr.message);
                tokenHash = crypto.createHmac('sha256', plainToken).digest('hex');
                storedToken = plainToken;
            }

            await db.query(
                `UPDATE clients SET portal_token = $1, portal_token_hash = $2 WHERE id = $3`,
                [storedToken, tokenHash, client_id]
            );
        }

        const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const portalUrl = `${baseUrl}/public-client-portal.html?token=${plainToken}`;

        return success(res, {
            token: plainToken,
            portal_url: portalUrl,
            client_name: client.name,
        });
    } catch (err) {
        console.error('[ClientPortal] generate error:', err.message);
        const needsSecret = !hasShareTokenSecret();
        const message = needsSecret
            ? 'تعذّر إنشاء رابط البوابة. تأكد من إعداد SHARE_TOKEN_SECRET في ملف .env'
            : `تعذّر إنشاء رابط البوابة: ${err.message}`;
        return res.status(500).json({ error: message });
    }
});

router.get('/client-portal/:token', async (req, res) => {
    const { token } = req.params;

    try {
        const client = await _resolveClientFromToken(token);
        if (!client) {
            return res.status(404).json({ error: 'الرابط غير صالح.' });
        }

        await db.query(
            `UPDATE clients SET portal_last_accessed = NOW() WHERE id = $1`,
            [client.id]
        );

        const ordersRes = await db.query(
            `WITH order_item_totals AS (
                SELECT
                    oi.order_id,
                    COUNT(*)::int AS item_count,
                    COALESCE(SUM(oi.quantity), 0)::numeric AS total_qty,
                    COALESCE(SUM(oi.manufacturer_po_qty), 0)::numeric AS manufacturer_po_qty,
                    COALESCE(SUM(oi.wh_received_qty), 0)::numeric AS wh_received_qty,
                    COALESCE(SUM(oi.released_qty), 0)::numeric AS released_qty,
                    COALESCE(SUM(oi.delivered_qty), 0)::numeric AS delivered_qty
                FROM order_items oi
                GROUP BY oi.order_id
            ),
            invoice_totals AS (
                SELECT
                    i.order_id,
                    COALESCE(SUM(CASE WHEN i.status != 'cancelled' THEN i.grand_total ELSE 0 END), 0)::numeric AS invoice_total,
                    COALESCE(SUM(CASE WHEN i.status = 'final' THEN i.grand_total ELSE 0 END), 0)::numeric AS final_invoice_total,
                    MAX(i.created_at) AS last_invoice_at
                FROM invoices i
                GROUP BY i.order_id
            ),
            payment_totals AS (
                SELECT
                    ct.order_id,
                    COALESCE(SUM(CASE WHEN ct.type IN ('payment','receipt') THEN ct.amount ELSE 0 END), 0)::numeric AS paid_total,
                    MAX(ct.created_at) AS last_payment_at
                FROM client_transactions ct
                GROUP BY ct.order_id
            )
            SELECT
                o.id,
                o.order_number,
                o.status,
                o.order_date,
                o.created_at,
                o.updated_at,
                o.subtotal,
                o.tax_amount,
                o.grand_total,
                o.paid_amount,
                o.internal_notes,
                o.client_notes,
                COALESCE(oit.item_count, 0)::int AS item_count,
                COALESCE(oit.total_qty, 0)::numeric AS total_qty,
                COALESCE(oit.manufacturer_po_qty, 0)::numeric AS manufacturer_po_qty,
                COALESCE(oit.wh_received_qty, 0)::numeric AS wh_received_qty,
                COALESCE(oit.released_qty, 0)::numeric AS released_qty,
                COALESCE(oit.delivered_qty, 0)::numeric AS delivered_qty,
                COALESCE(it.invoice_total, 0)::numeric AS invoice_total,
                COALESCE(it.final_invoice_total, 0)::numeric AS final_invoice_total,
                it.last_invoice_at,
                COALESCE(pt.paid_total, 0)::numeric AS paid_total,
                pt.last_payment_at,
                dn_stats.completed_delivery_at,
                CASE
                    WHEN o.status = 'delivered' THEN 'delivered'
                    WHEN COALESCE(oit.delivered_qty, 0) > 0 AND COALESCE(oit.total_qty, 0) > 0 AND COALESCE(oit.delivered_qty, 0) >= COALESCE(oit.total_qty, 0) THEN 'delivered'
                    WHEN COALESCE(oit.released_qty, 0) > 0 AND COALESCE(oit.total_qty, 0) > 0 AND COALESCE(oit.released_qty, 0) >= COALESCE(oit.total_qty, 0) THEN 'shipped'
                    WHEN COALESCE(oit.wh_received_qty, 0) > 0 AND COALESCE(oit.total_qty, 0) > 0 AND COALESCE(oit.wh_received_qty, 0) >= COALESCE(oit.total_qty, 0) THEN 'completed'
                    WHEN COALESCE(oit.manufacturer_po_qty, 0) > 0 OR o.status IN ('production', 'processing') THEN 'production'
                    ELSE o.status
                END AS derived_status
            FROM orders o
            LEFT JOIN order_item_totals oit ON oit.order_id = o.id
            LEFT JOIN invoice_totals it ON it.order_id = o.id
            LEFT JOIN payment_totals pt ON pt.order_id = o.id
            LEFT JOIN LATERAL (
                SELECT MAX(COALESCE(dn.delivered_at, dn.updated_at, dn.created_at)) AS completed_delivery_at
                FROM delivery_notes dn
                WHERE dn.order_id = o.id AND dn.status = 'completed'
            ) dn_stats ON true
            WHERE o.client_id = $1 AND o.status NOT IN ('cancelled', 'archived')
            ORDER BY o.order_date DESC, o.created_at DESC`,
            [client.id]
        );

        const orders = ordersRes.rows.map(order => ({
            ...order,
            status_label: _orderBadge(order.derived_status).label,
            status_color: _orderBadge(order.derived_status).color,
        }));

        const totalValue = orders.reduce((sum, order) => sum + parseFloat(order.grand_total || 0), 0);
        const totalPaid = orders.reduce((sum, order) => sum + parseFloat(order.paid_total || order.paid_amount || 0), 0);

        const summaryRes = await db.query(
            `SELECT
                COALESCE(SUM(CASE WHEN status NOT IN ('cancelled','archived') THEN grand_total ELSE 0 END), 0)::numeric AS total_value,
                COALESCE(SUM(COALESCE(paid_amount, 0)), 0)::numeric AS total_paid,
                COUNT(*)::int AS total_orders,
                COUNT(*) FILTER (WHERE status = 'quote')::int AS quote_count,
                COUNT(*) FILTER (WHERE status IN ('production','processing','completed','delivered'))::int AS active_count
             FROM orders
             WHERE client_id = $1`,
            [client.id]
        );

        const paymentRes = await db.query(
            `SELECT
                ct.id,
                ct.amount,
                ct.payment_method,
                ct.description,
                ct.document_number,
                ct.created_at,
                ct.order_id,
                o.order_number
             FROM client_transactions ct
             LEFT JOIN orders o ON o.id = ct.order_id
             WHERE ct.client_id = $1 AND ct.type IN ('payment', 'receipt')
             ORDER BY ct.created_at DESC
             LIMIT 50`,
            [client.id]
        );

        return success(res, {
            client: {
                id: client.id,
                name: client.name,
                contact_person: client.contact_person,
                phone: client.phone,
                email: client.email,
                city: client.city,
                status: client.status,
            },
            orders,
            payments: paymentRes.rows,
            summary: {
                ...(summaryRes.rows[0] || {}),
                total_value: totalValue,
                total_paid: totalPaid,
                total_remaining: Math.max(0, totalValue - totalPaid),
            },
        });
    } catch (err) {
        console.error('[ClientPortal] GET list error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

router.get('/client-portal/:token/orders/:id', async (req, res) => {
    const { token, id } = req.params;

    try {
        const client = await _resolveClientFromToken(token);
        if (!client) {
            return res.status(404).json({ error: 'الرابط غير صالح.' });
        }

        const orderRes = await db.query(
            `SELECT
                o.id,
                o.order_number,
                o.status,
                o.order_date,
                o.created_at,
                o.updated_at,
                o.subtotal,
                o.tax_amount,
                o.grand_total,
                o.paid_amount,
                o.client_notes,
                o.internal_notes,
                o.client_response,
                o.rejection_reason,
                o.responded_at,
                c.name AS client_name
             FROM orders o
             LEFT JOIN clients c ON c.id = o.client_id
             WHERE o.id = $1 AND o.client_id = $2`,
            [id, client.id]
        );

        if (orderRes.rowCount === 0) {
            return res.status(404).json({ error: 'الطلب غير موجود.' });
        }

        const order = orderRes.rows[0];

        const itemsRes = await db.query(
            `SELECT
                oi.id,
                oi.quantity,
                oi.unit_price,
                oi.discount_percent,
                oi.discount_amount,
                oi.line_total,
                oi.manufacturer_po_qty,
                oi.wh_received_qty,
                oi.released_qty,
                oi.delivered_qty,
                oi.design_status,
                oi.notes,
                pv.size_name,
                p.name AS product_name,
                p.sku AS product_code
             FROM order_items oi
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
             LEFT JOIN products p ON p.id = pv.product_id
             WHERE oi.order_id = $1
             ORDER BY oi.created_at ASC`,
            [order.id]
        );

        const paymentsRes = await db.query(
            `SELECT
                ct.id,
                ct.amount,
                ct.payment_method,
                ct.description,
                ct.document_number,
                ct.created_at,
                ct.type,
                ct.order_id
             FROM client_transactions ct
             WHERE ct.client_id = $1 AND ct.order_id = $2 AND ct.type IN ('payment', 'receipt')
             ORDER BY ct.created_at ASC`,
            [client.id, order.id]
        );

        const invoicesRes = await db.query(
            `SELECT
                i.id,
                i.invoice_number,
                i.status,
                i.created_at,
                i.grand_total,
                i.paid_amount,
                i.tax_amount,
                i.subtotal
             FROM invoices i
             WHERE i.client_id = $1 AND i.order_id = $2 AND i.status != 'cancelled'
             ORDER BY i.created_at DESC`,
            [client.id, order.id]
        );

        const deliveryRes = await db.query(
            `SELECT
                dn.id,
                dn.note_number,
                dn.status,
                dn.delivery_date,
                dn.delivered_at,
                dn.notes,
                dn.created_at,
                dn.updated_at,
                COUNT(dni.id)::int AS item_count,
                COALESCE(SUM(dni.delivered_qty), 0)::numeric AS delivered_qty,
                COALESCE(SUM(dni.requested_qty), 0)::numeric AS requested_qty
             FROM delivery_notes dn
             LEFT JOIN delivery_note_items dni ON dni.delivery_note_id = dn.id
             WHERE dn.client_id = $1 AND dn.order_id = $2
             GROUP BY dn.id
             ORDER BY dn.created_at ASC`,
            [client.id, order.id]
        );

        const timeline = _buildTimeline({
            ...order,
            ...itemsRes.rows.reduce((acc, item) => {
                acc.total_qty = (parseFloat(acc.total_qty || 0) + parseFloat(item.quantity || 0)).toString();
                acc.wh_received_qty = (parseFloat(acc.wh_received_qty || 0) + parseFloat(item.wh_received_qty || 0)).toString();
                acc.released_qty = (parseFloat(acc.released_qty || 0) + parseFloat(item.released_qty || 0)).toString();
                acc.delivered_qty = (parseFloat(acc.delivered_qty || 0) + parseFloat(item.delivered_qty || 0)).toString();
                return acc;
            }, { total_qty: 0, wh_received_qty: 0, released_qty: 0, delivered_qty: 0 }),
        });

        const derivedStatus = _deriveOrderStatus({
            ...order,
            total_qty: itemsRes.rows.reduce((sum, item) => sum + parseFloat(item.quantity || 0), 0),
            wh_received_qty: itemsRes.rows.reduce((sum, item) => sum + parseFloat(item.wh_received_qty || 0), 0),
            released_qty: itemsRes.rows.reduce((sum, item) => sum + parseFloat(item.released_qty || 0), 0),
            delivered_qty: itemsRes.rows.reduce((sum, item) => sum + parseFloat(item.delivered_qty || 0), 0),
        });

        return success(res, {
            order: {
                ...order,
                derived_status: derivedStatus,
                status_label: _orderBadge(derivedStatus).label,
                status_color: _orderBadge(derivedStatus).color,
            },
            items: itemsRes.rows,
            payments: paymentsRes.rows,
            invoices: invoicesRes.rows,
            delivery_notes: deliveryRes.rows,
            timeline,
        });
    } catch (err) {
        console.error('[ClientPortal] GET order detail error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
