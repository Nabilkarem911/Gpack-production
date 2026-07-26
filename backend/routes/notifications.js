'use strict';

// =============================================================================
// G.PACK 2.0 — Notifications API Route
// Endpoints for the in-app Notification Center (bell icon) and WhatsApp Center.
// =============================================================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const WhatsApp = require('../services/whatsapp-service');

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

module.exports = router;
