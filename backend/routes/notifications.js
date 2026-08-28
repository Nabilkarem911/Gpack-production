'use strict';

// =============================================================================
// G.PACK 2.0 — Notifications API Route
// Endpoints for the in-app Notification Center (bell icon) and WhatsApp Center.
// =============================================================================

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/authMiddleware');
const authorize = require('../middleware/authorize');
const WhatsApp = require('../services/whatsapp-service');
const CircuitBreaker = require('../services/circuit-breaker');

// ── GET /api/notifications ──────────────────────────────────────────────────
// Fetch notifications for the current user (or by target_role).
router.get('/', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const unreadOnly = req.query.unread === 'true';

        let query, params;

        if (unreadOnly) {
            query = `SELECT * FROM notifications
                     WHERE (user_id = $1 OR (user_id IS NULL AND target_role IN ($2, 'all')))
                       AND is_read = false
                     ORDER BY created_at DESC
                     LIMIT $3 OFFSET $4`;
            params = [userId, role, limit, offset];
        } else {
            query = `SELECT * FROM notifications
                     WHERE (user_id = $1 OR (user_id IS NULL AND target_role IN ($2, 'all')))
                     ORDER BY created_at DESC
                     LIMIT $3 OFFSET $4`;
            params = [userId, role, limit, offset];
        }

        const result = await db.query(query, params);

        // Get unread count
        const countRes = await db.query(
            `SELECT COUNT(*) as count FROM notifications
             WHERE (user_id = $1 OR (user_id IS NULL AND target_role IN ($2, 'all')))
               AND is_read = false`,
            [userId, role]
        );

        res.json({
            success: true,
            notifications: result.rows,
            unread_count: parseInt(countRes.rows[0].count),
        });
    } catch (err) {
        console.error('[Notifications] Fetch error:', err.message);
        res.status(500).json({ error: 'فشل في جلب الإشعارات' });
    }
});

// ── PUT /api/notifications/:id/read ─────────────────────────────────────────
// Mark a single notification as read.
router.put('/:id/read', authenticate, async (req, res) => {
    try {
        await db.query(
            `UPDATE notifications SET is_read = true, read_at = NOW() WHERE id = $1`,
            [req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'فشل في تحديث الإشعار' });
    }
});

// ── PUT /api/notifications/read-all ─────────────────────────────────────────
// Mark all notifications as read for the current user.
router.put('/read-all', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        await db.query(
            `UPDATE notifications SET is_read = true, read_at = NOW()
             WHERE (user_id = $1 OR (user_id IS NULL AND target_role IN ($2, 'all')))
               AND is_read = false`,
            [userId, role]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'فشل في تحديث الإشعارات' });
    }
});

// ── GET /api/notifications/whatsapp/status ──────────────────────────────────
// Get WAHA session status for the WhatsApp Center dashboard.
router.get('/whatsapp/status', authenticate, authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        const status = await WhatsApp.getSessionStatus();

        // Get queue stats
        const queueStats = await db.query(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'processing') as processing,
                COUNT(*) FILTER (WHERE status = 'sent') as sent,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) as total
             FROM notification_queue
             WHERE channel = 'whatsapp'`
        );

        // Get today's stats
        const todayStats = await db.query(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'sent' AND sent_at::date = NOW()::date) as sent_today,
                COUNT(*) FILTER (WHERE status = 'failed' AND updated_at::date = NOW()::date) as failed_today
             FROM notification_queue
             WHERE channel = 'whatsapp'`
        );

        res.json({
            success: true,
            session: status,
            queue: queueStats.rows[0],
            today: todayStats.rows[0],
        });
    } catch (err) {
        console.error('[WhatsApp] Status error:', err.message);
        res.status(500).json({ error: 'فشل في جلب حالة واتساب' });
    }
});

// ── GET /api/notifications/whatsapp/queue ───────────────────────────────────
// Get the notification queue (for WhatsApp Center dashboard).
router.get('/whatsapp/queue', authenticate, authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        const status = req.query.status || 'all';
        const limit = parseInt(req.query.limit) || 50;

        let query, params;
        if (status === 'all') {
            query = `SELECT id, channel, recipient, recipient_name, recipient_role,
                            message_type, subject, body, status, attempts, max_attempts,
                            last_error, last_attempt_at, next_attempt_at,
                            created_at, sent_at
                     FROM notification_queue
                     WHERE channel = 'whatsapp'
                     ORDER BY created_at DESC
                     LIMIT $1`;
            params = [limit];
        } else {
            query = `SELECT id, channel, recipient, recipient_name, recipient_role,
                            message_type, subject, body, status, attempts, max_attempts,
                            last_error, last_attempt_at, next_attempt_at,
                            created_at, sent_at
                     FROM notification_queue
                     WHERE channel = 'whatsapp' AND status = $1
                     ORDER BY created_at DESC
                     LIMIT $2`;
            params = [status, limit];
        }

        const result = await db.query(query, params);
        res.json({ success: true, queue: result.rows });
    } catch (err) {
        console.error('[WhatsApp] Queue fetch error:', err.message);
        res.status(500).json({ error: 'فشل في جلب قائمة الانتظار' });
    }
});

// ── POST /api/notifications/whatsapp/retry/:id ──────────────────────────────
// Retry a failed notification.
router.post('/whatsapp/retry/:id', authenticate, authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        await db.query(
            `UPDATE notification_queue
             SET status = 'pending',
                 attempts = 0,
                 last_error = NULL,
                 next_attempt_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1 AND status = 'failed'`,
            [req.params.id]
        );
        res.json({ success: true, message: 'تم إعادة جدولة الإشعار' });
    } catch (err) {
        res.status(500).json({ error: 'فشل في إعادة الجدولة' });
    }
});

// ── POST /api/notifications/whatsapp/start-session ──────────────────────────
// Start/restart WAHA session.
router.post('/whatsapp/start-session', authenticate, authorize(['admin', 'super_admin']), async (req, res) => {
    try {
        const result = await WhatsApp.startSession();
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/notifications/whatsapp/qr ──────────────────────────────────────
// Get QR code for WAHA session pairing.
router.get('/whatsapp/qr', authenticate, authorize(['admin', 'super_admin']), async (req, res) => {
    try {
        const result = await WhatsApp.getQRCode();
        res.json({ success: true, qr: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/notifications/whatsapp/qr/:session ─────────────────────────────
// Get QR code for a specific WAHA session (e.g. internal session).
router.get('/whatsapp/qr/:session', authenticate, authorize(['admin', 'super_admin']), async (req, res) => {
    try {
        const result = await WhatsApp.getQRCode(req.params.session);
        res.json({ success: true, qr: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/notifications/whatsapp/internal-settings ───────────────────────
// Get internal WhatsApp notification settings.
router.get('/whatsapp/internal-settings', authenticate, authorize(['admin', 'super_admin', 'manager']), async (req, res) => {
    try {
        const keys = [
            'internal_whatsapp_enabled',
            'manager_whatsapp_phone',
            'warehouse_keeper_whatsapp_phone',
        ];
        const settings = {};
        for (const key of keys) {
            const result = await db.query(
                `SELECT value FROM notification_settings WHERE key = $1`,
                [key]
            );
            let val = null;
            if (result.rows.length > 0) {
                val = result.rows[0].value;
                if (typeof val === 'string') { try { val = JSON.parse(val); } catch { val = null; } }
            }
            settings[key] = val;
        }

        res.json({
            success: true,
            enabled: settings.internal_whatsapp_enabled === true || settings.internal_whatsapp_enabled === 'true',
            manager_phone: settings.manager_whatsapp_phone || '',
            warehouse_keeper_phone: settings.warehouse_keeper_whatsapp_phone || '',
        });
    } catch (err) {
        console.error('[Notifications] Internal settings fetch error:', err.message);
        res.status(500).json({ error: 'فشل في جلب الإعدادات' });
    }
});

// ── PUT /api/notifications/whatsapp/internal-settings ───────────────────────
// Update internal WhatsApp notification settings.
router.put('/whatsapp/internal-settings', authenticate, authorize(['admin', 'super_admin']), async (req, res) => {
    try {
        const { manager_phone, warehouse_keeper_phone, enabled } = req.body;

        // Normalize phone numbers (strip non-digits)
        const normalize = (phone) => phone ? String(phone).replace(/[^0-9]/g, '') : '';
        const managerPhone = normalize(manager_phone);
        const warehousePhone = normalize(warehouse_keeper_phone);

        // Basic Saudi number validation (optional but helpful)
        const isValid = (phone) => !phone || (phone.startsWith('05') && phone.length === 10) || phone.startsWith('966');
        if (managerPhone && !isValid(managerPhone)) {
            return res.status(400).json({ error: 'رقم المدير غير صالح' });
        }
        if (warehousePhone && !isValid(warehousePhone)) {
            return res.status(400).json({ error: 'رقم أمين المستودع غير صالح' });
        }

        const settings = [
            { key: 'internal_whatsapp_enabled', value: enabled === true || enabled === 'true' },
            { key: 'manager_whatsapp_phone', value: managerPhone || null },
            { key: 'warehouse_keeper_whatsapp_phone', value: warehousePhone || null },
        ];

        for (const s of settings) {
            await db.query(
                `INSERT INTO notification_settings (key, value, description)
                 VALUES ($1, $2, 'internal whatsapp notification setting')
                 ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
                [s.key, JSON.stringify(s.value)]
            );
        }

        res.json({ success: true, message: 'تم حفظ الإعدادات' });
    } catch (err) {
        console.error('[Notifications] Internal settings update error:', err.message);
        res.status(500).json({ error: 'فشل في حفظ الإعدادات' });
    }
});

// ── POST /api/notifications/whatsapp/webhook ────────────────────────────────
// WAHA webhook receiver — WAHA calls this when message status changes.
// Configure in WAHA: webhook URL = https://erp.gpacksa.com/api/notifications/whatsapp/webhook
// This is UNAUTHENTICATED (WAHA can't send JWT) — but we verify via a shared secret.
router.post('/whatsapp/webhook', async (req, res) => {
    try {
        const webhookSecret = process.env.WAHA_WEBHOOK_SECRET || '';

        // HMAC Signature verification + Replay Attack prevention
        if (webhookSecret) {
            const signature = req.headers['x-webhook-signature'] || '';
            const timestamp = req.headers['x-webhook-timestamp'] || '';
            const nonce = req.headers['x-webhook-nonce'] || '';
            const rawBody = JSON.stringify(req.body);

            // 1. Verify timestamp (reject if older than 5 minutes)
            if (timestamp) {
                const ageSeconds = Math.abs(Date.now() - parseInt(timestamp)) / 1000;
                if (ageSeconds > 300) {
                    console.warn('[WAHA Webhook] Rejected: timestamp too old (>5min)');
                    return res.status(403).json({ error: 'Timestamp expired' });
                }
            }

            // 2. Verify nonce (prevent replay — same nonce can't be used twice)
            if (nonce) {
                const nonceKey = `waha_webhook_nonce:${nonce}`;
                const seen = await db.query(
                    `INSERT INTO notification_settings (key, value, description)
                     VALUES ($1, '{"used": true, "ts": "' || NOW() || '"}', 'webhook nonce')
                     ON CONFLICT (key) DO NOTHING
                     RETURNING key`,
                    [nonceKey]
                );
                if (seen.rows.length === 0) {
                    console.warn('[WAHA Webhook] Rejected: duplicate nonce (replay attack)');
                    return res.status(403).json({ error: 'Duplicate nonce' });
                }
            }

            // 3. Verify HMAC signature (includes timestamp + nonce in the signed payload)
            const signedPayload = timestamp + nonce + rawBody;
            const expectedSig = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');

            if (signature !== expectedSig) {
                console.warn('[WAHA Webhook] Invalid signature — rejecting');
                return res.status(403).json({ error: 'Invalid signature' });
            }
        }

        const event = req.body;
        const eventType = event.event || event.type || 'unknown';
        const session = event.session || event.sessionName || '';
        const messageData = event.message || event.data || event.payload || {};

        // Extract message ID and status
        const messageId = messageData.id?._serialized || messageData.id || event.id || null;
        const from = messageData.from || event.from || '';
        const to = messageData.to || event.to || '';
        const status = event.status || event.state || eventType;

        console.log(`[WAHA Webhook] Event: ${eventType}, Session: ${session}, MsgID: ${messageId}, Status: ${status}`);

        // Update queue item if we have a message ID match
        if (messageId) {
            // Try to find queue item by waha_message_id
            const queueRes = await db.query(
                `SELECT id, status FROM notification_queue WHERE waha_message_id = $1 AND status = 'sent'`,
                [messageId]
            );

            if (queueRes.rows.length > 0) {
                const item = queueRes.rows[0];

                if (eventType === 'message.delivered' || status === 'delivered') {
                    await db.query(
                        `UPDATE notification_queue SET waha_status = 'delivered', delivered_at = NOW(), updated_at = NOW() WHERE id = $1`,
                        [item.id]
                    );
                    console.log(`[WAHA Webhook] Marked ${item.id} as delivered`);
                } else if (eventType === 'message.read' || status === 'read') {
                    await db.query(
                        `UPDATE notification_queue SET waha_status = 'read', updated_at = NOW() WHERE id = $1`,
                        [item.id]
                    );
                    console.log(`[WAHA Webhook] Marked ${item.id} as read`);
                } else if (eventType === 'message.failed' || status === 'failed') {
                    await db.query(
                        `UPDATE notification_queue SET waha_status = 'failed', last_error = $1, updated_at = NOW() WHERE id = $2`,
                        [JSON.stringify(event).substring(0, 500), item.id]
                    );
                    console.log(`[WAHA Webhook] Marked ${item.id} as failed by WAHA`);
                }
            }
        }

        // Handle session status events
        if (eventType === 'session.status' || eventType === 'status') {
            const sessionStatus = event.status || event.state;
            console.log(`[WAHA Webhook] Session ${session} status: ${sessionStatus}`);
        }

        // ── Cleanup expired webhook nonces ─────────────────────────────────────
        // Nonces older than 10 minutes are safe to delete: the replay window is
        // 5 minutes (timestamp check above), so any nonce older than 10 min can
        // never be valid again. This prevents notification_settings from growing
        // indefinitely. Fire-and-forget — failure must not affect the webhook.
        try {
            await db.query(
                `DELETE FROM notification_settings
                 WHERE key LIKE 'waha_webhook_nonce:%'
                   AND updated_at < NOW() - INTERVAL '10 minutes'`
            );
        } catch (cleanupErr) {
            console.warn('[WAHA Webhook] Nonce cleanup skipped:', cleanupErr.message);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[WAHA Webhook] Error:', err.message);
        res.status(200).json({ success: true }); // Always 200 so WAHA doesn't retry
    }
});

// ── GET /api/notifications/queue/:id ────────────────────────────────────────
// Get full details of a queue item (payload, error, retry history).
router.get('/queue/:id', authenticate, authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        const result = await db.query(
            `SELECT * FROM notification_queue WHERE id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'not found' });
        }
        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'failed to fetch' });
    }
});

// ── PUT /api/notifications/queue/:id/cancel ─────────────────────────────────
// Cancel a pending/processing queue item.
router.put('/queue/:id/cancel', authenticate, authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        await db.query(
            `UPDATE notification_queue SET status = 'cancelled', updated_at = NOW()
             WHERE id = $1 AND status IN ('pending', 'processing')`,
            [req.params.id]
        );
        res.json({ success: true, message: 'تم إلغاء الإشعار' });
    } catch (err) {
        res.status(500).json({ error: 'فشل في الإلغاء' });
    }
});

// ── PUT /api/notifications/queue/:id/priority ───────────────────────────────
// Change priority of a queue item.
router.put('/queue/:id/priority', authenticate, authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        const { priority } = req.body;
        if (!['high', 'normal', 'low'].includes(priority)) {
            return res.status(400).json({ error: 'priority must be high, normal, or low' });
        }
        await db.query(
            `UPDATE notification_queue SET priority = $1, updated_at = NOW() WHERE id = $2`,
            [priority, req.params.id]
        );
        res.json({ success: true, message: 'تم تغيير الأولوية' });
    } catch (err) {
        res.status(500).json({ error: 'فشل في تغيير الأولوية' });
    }
});

// ── GET /api/notifications/queue ────────────────────────────────────────────
// Get all queue items (unified queue dashboard — not just WhatsApp).
router.get('/queue', authenticate, authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        const status = req.query.status || 'all';
        const limit = parseInt(req.query.limit) || 100;

        let query, params;
        if (status === 'all') {
            query = `SELECT id, channel, recipient, recipient_name, recipient_role,
                            message_type, subject, body, status, priority, attempts, max_attempts,
                            last_error, last_attempt_at, next_attempt_at,
                            retry_history, idempotency_key, waha_message_id, waha_status,
                            created_at, sent_at, delivered_at
                     FROM notification_queue
                     ORDER BY
                        CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                        created_at DESC
                     LIMIT $1`;
            params = [limit];
        } else {
            query = `SELECT id, channel, recipient, recipient_name, recipient_role,
                            message_type, subject, body, status, priority, attempts, max_attempts,
                            last_error, last_attempt_at, next_attempt_at,
                            retry_history, idempotency_key, waha_message_id, waha_status,
                            created_at, sent_at, delivered_at
                     FROM notification_queue
                     WHERE status = $1
                     ORDER BY
                        CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                        created_at DESC
                     LIMIT $2`;
            params = [status, limit];
        }

        const result = await db.query(query, params);

        // Get summary stats
        const statsRes = await db.query(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'processing') as processing,
                COUNT(*) FILTER (WHERE status = 'sent') as sent,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
                COUNT(*) FILTER (WHERE priority = 'high' AND status = 'pending') as high_pending,
                COUNT(*) as total
             FROM notification_queue`
        );

        res.json({ success: true, queue: result.rows, stats: statsRes.rows[0] });
    } catch (err) {
        console.error('[Notifications] Queue fetch error:', err.message);
        res.status(500).json({ error: 'فشل في جلب القائمة' });
    }
});

// ── GET /api/notifications/whatsapp/health ──────────────────────────────────
// WAHA health monitor — shows current status, latency, last 20 checks.
router.get('/whatsapp/health', authenticate, authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        // Get current status
        const current = await WhatsApp.getSessionStatus();

        // Get last 20 health checks from DB
        const history = await db.query(
            `SELECT status, latency_ms, error, checked_at
             FROM waha_health_log
             ORDER BY checked_at DESC
             LIMIT 20`
        );

        // Get last connected/disconnected timestamps
        const lastConnected = await db.query(
            `SELECT checked_at FROM waha_health_log WHERE status = 'connected' ORDER BY checked_at DESC LIMIT 1`
        );
        const lastDisconnected = await db.query(
            `SELECT checked_at FROM waha_health_log WHERE status = 'disconnected' ORDER BY checked_at DESC LIMIT 1`
        );

        // Calculate uptime percentage (last 24h)
        const uptimeRes = await db.query(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'connected') as connected_count,
                COUNT(*) as total_count
             FROM waha_health_log
             WHERE checked_at > NOW() - INTERVAL '24 hours'`
        );
        const uptimePct = uptimeRes.rows[0].total_count > 0
            ? Math.round((uptimeRes.rows[0].connected_count / uptimeRes.rows[0].total_count) * 100)
            : null;

        res.json({
            success: true,
            current: {
                connected: current?.connected || false,
                error: current?.error || null,
            },
            circuit_breaker: CircuitBreaker.getState(),
            history: history.rows,
            last_connected_at: lastConnected.rows[0]?.checked_at || null,
            last_disconnected_at: lastDisconnected.rows[0]?.checked_at || null,
            uptime_24h_pct: uptimePct,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/notifications/metrics ──────────────────────────────────────────
// Notification metrics dashboard — success rate, avg time, queue length, etc.
router.get('/metrics', authenticate, authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        // Overall stats
        const overallRes = await db.query(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'sent') as total_sent,
                COUNT(*) FILTER (WHERE status = 'failed') as total_failed,
                COUNT(*) FILTER (WHERE status = 'pending') as total_pending,
                COUNT(*) FILTER (WHERE status = 'processing') as total_processing,
                COUNT(*) FILTER (WHERE status = 'cancelled') as total_cancelled,
                COUNT(*) as total_all
             FROM notification_queue`
        );

        // Today's stats
        const todayRes = await db.query(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'sent' AND sent_at::date = CURRENT_DATE) as sent_today,
                COUNT(*) FILTER (WHERE status = 'failed' AND last_attempt_at::date = CURRENT_DATE) as failed_today,
                COUNT(*) FILTER (WHERE attempts > 1 AND last_attempt_at::date = CURRENT_DATE) as retried_today,
                COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as created_today
             FROM notification_queue`
        );

        // Dead letter queue count
        const dlqRes = await db.query(
            `SELECT COUNT(*) as dlq_count FROM notification_dead_queue`
        );

        // Average send time (from created_at to sent_at, for sent items in last 7 days)
        const avgTimeRes = await db.query(
            `SELECT AVG(EXTRACT(EPOCH FROM (sent_at - created_at)) * 1000)::INTEGER as avg_send_time_ms
             FROM notification_queue
             WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '7 days'`
        );

        // Queue by priority
        const priorityRes = await db.query(
            `SELECT priority,
                    COUNT(*) FILTER (WHERE status = 'pending') as pending,
                    COUNT(*) FILTER (WHERE status = 'sent') as sent,
                    COUNT(*) FILTER (WHERE status = 'failed') as failed
             FROM notification_queue
             GROUP BY priority`
        );

        // Success rate
        const overall = overallRes.rows[0];
        const totalAttempted = parseInt(overall.total_sent) + parseInt(overall.total_failed);
        const successRate = totalAttempted > 0
            ? Math.round((parseInt(overall.total_sent) / totalAttempted) * 100)
            : 100;

        // Last 7 days trend
        const trendRes = await db.query(
            `SELECT
                created_at::date as date,
                COUNT(*) FILTER (WHERE status = 'sent') as sent,
                COUNT(*) FILTER (WHERE status = 'failed') as failed
             FROM notification_queue
             WHERE created_at > NOW() - INTERVAL '7 days'
             GROUP BY created_at::date
             ORDER BY date DESC`
        );

        res.json({
            success: true,
            metrics: {
                overall: {
                    ...overall,
                    success_rate_pct: successRate,
                    dlq_count: parseInt(dlqRes.rows[0].dlq_count),
                    avg_send_time_ms: avgTimeRes.rows[0]?.avg_send_time_ms || null,
                },
                today: todayRes.rows[0],
                by_priority: priorityRes.rows,
                last_7_days: trendRes.rows,
            },
        });
    } catch (err) {
        console.error('[Notifications] Metrics error:', err.message);
        res.status(500).json({ error: 'فشل في جلب المقاييس' });
    }
});

module.exports = router;
