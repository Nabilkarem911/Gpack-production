// backend/utils/ai-briefing.js
// Phase 8.1: Morning Briefing — generates daily AI summary
// Called by cron job or on-demand endpoint

const db = require('../config/db');

// =============================================================================
// Generate daily briefing
// =============================================================================
async function generateBriefing(userId) {
    const alerts = [];
    const stats = {};
    let summaryParts = [];

    // 1. Overdue invoices
    const overdueRes = await db.query(
        `SELECT COUNT(*) as count, COALESCE(SUM(i.grand_total - COALESCE(ct.paid, 0)), 0)::numeric as amount
         FROM invoices i
         LEFT JOIN (
             SELECT invoice_id, SUM(amount) as paid
             FROM client_transactions
             WHERE type = 'payment' AND invoice_id IS NOT NULL
             GROUP BY invoice_id
         ) ct ON ct.invoice_id = i.id
         WHERE i.status = 'issued' AND i.due_date < NOW()
           AND (i.grand_total - COALESCE(ct.paid, 0)) > 0`
    );
    const overdueCount = parseInt(overdueRes.rows[0].count || 0);
    const overdueAmount = parseFloat(overdueRes.rows[0].amount || 0);
    stats.overdue_invoices = overdueCount;
    stats.overdue_amount = Math.round(overdueAmount);
    if (overdueCount > 0) {
        alerts.push({
            severity: 'critical',
            type: 'overdue_invoices',
            title: 'فواتير متأخرة',
            count: overdueCount,
            amount: Math.round(overdueAmount),
            message: `${overdueCount} فاتورة متأخرة بقيمة ${Math.round(overdueAmount)} ر.س`,
        });
        summaryParts.push(`${overdueCount} فاتورة متأخرة بقيمة ${Math.round(overdueAmount)} ر.س`);
    }

    // 2. Low stock items
    const lowStockRes = await db.query(
        `SELECT COUNT(*) as count
         FROM warehouse_stock
         WHERE quantity <= 0`
    );
    const stockoutCount = parseInt(lowStockRes.rows[0].count || 0);
    stats.stockout_items = stockoutCount;
    if (stockoutCount > 0) {
        alerts.push({
            severity: 'critical',
            type: 'stockout',
            title: 'مخزون نفد',
            count: stockoutCount,
            message: `${stockoutCount} صنف نفد من المخزون`,
        });
        summaryParts.push(`${stockoutCount} صنف نفد من المخزون`);
    }

    // 3. Pending quotes (not converted)
    const pendingQuotesRes = await db.query(
        `SELECT COUNT(*) as count, COALESCE(SUM(grand_total), 0)::numeric as value
         FROM orders WHERE status = 'quote' AND created_at >= NOW() - INTERVAL '30 days'`
    );
    const pendingCount = parseInt(pendingQuotesRes.rows[0].count || 0);
    const pendingValue = parseFloat(pendingQuotesRes.rows[0].value || 0);
    stats.pending_quotes = pendingCount;
    stats.pending_quotes_value = Math.round(pendingValue);
    if (pendingCount > 0) {
        alerts.push({
            severity: 'warning',
            type: 'pending_quotes',
            title: 'عروض أسعار معلقة',
            count: pendingCount,
            value: Math.round(pendingValue),
            message: `${pendingCount} عرض سعر بانتظار الرد بقيمة ${Math.round(pendingValue)} ر.س`,
        });
        summaryParts.push(`${pendingCount} عرض سعر معلق`);
    }

    // 4. Inactive clients (30+ days)
    const inactiveRes = await db.query(
        `SELECT COUNT(*) as count
         FROM clients c
         WHERE c.status = 'active' AND c.parent_id IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM orders o
               WHERE o.client_id = c.id AND o.status NOT IN ('cancelled', 'draft')
                 AND o.created_at >= NOW() - INTERVAL '30 days'
           )`
    );
    const inactiveCount = parseInt(inactiveRes.rows[0].count || 0);
    stats.inactive_clients = inactiveCount;
    if (inactiveCount > 0) {
        alerts.push({
            severity: 'warning',
            type: 'inactive_clients',
            title: 'عملاء خاملون',
            count: inactiveCount,
            message: `${inactiveCount} عميل لم يطلب منذ 30+ يوم`,
        });
        summaryParts.push(`${inactiveCount} عميل خامل`);
    }

    // 5. Today's sales summary
    const todaySalesRes = await db.query(
        `SELECT COUNT(*) as count, COALESCE(SUM(grand_total), 0)::numeric as total
         FROM orders WHERE status NOT IN ('cancelled', 'draft')
           AND DATE(created_at) = CURRENT_DATE`
    );
    stats.today_orders = parseInt(todaySalesRes.rows[0].count || 0);
    stats.today_sales = Math.round(parseFloat(todaySalesRes.rows[0].total || 0));

    // 6. This month sales vs last month
    const monthSalesRes = await db.query(
        `SELECT COALESCE(SUM(grand_total), 0)::numeric as total
         FROM orders WHERE status NOT IN ('cancelled', 'draft')
           AND created_at >= DATE_TRUNC('month', NOW())`
    );
    const lastMonthSalesRes = await db.query(
        `SELECT COALESCE(SUM(grand_total), 0)::numeric as total
         FROM orders WHERE status NOT IN ('cancelled', 'draft')
           AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
           AND created_at < DATE_TRUNC('month', NOW())`
    );
    const monthSales = parseFloat(monthSalesRes.rows[0].total || 0);
    const lastMonthSales = parseFloat(lastMonthSalesRes.rows[0].total || 0);
    stats.month_sales = Math.round(monthSales);
    stats.last_month_sales = Math.round(lastMonthSales);
    stats.month_change_pct = lastMonthSales > 0 ? Math.round((monthSales - lastMonthSales) / lastMonthSales * 100) : 0;

    // Build summary text
    let summary = `ملخص يومي — ${new Date().toLocaleDateString('ar-SA')}\n`;
    if (summaryParts.length > 0) {
        summary += `تنبيهات: ${summaryParts.join('، ')}.\n`;
    } else {
        summary += `لا توجد تنبيهات حرجة اليوم.\n`;
    }
    summary += `مبيعات اليوم: ${stats.today_orders} طلب بقيمة ${stats.today_sales} ر.س.\n`;
    summary += `مبيعات الشهر: ${stats.month_sales} ر.س (${stats.month_change_pct >= 0 ? '+' : ''}${stats.month_change_pct}% عن الشهر السابق).`;

    // Save to DB
    const existingRes = await db.query(
        `SELECT id FROM ai_briefings WHERE briefing_date = CURRENT_DATE ${userId ? 'AND user_id = $1' : 'AND user_id IS NULL'} LIMIT 1`,
        userId ? [userId] : []
    );

    let briefingId;
    if (existingRes.rows.length > 0) {
        const updateRes = await db.query(
            `UPDATE ai_briefings SET summary = $1, alerts = $2::jsonb, stats = $3::jsonb, updated_at = NOW()
             WHERE id = $4 RETURNING id`,
            [summary, JSON.stringify(alerts), JSON.stringify(stats), existingRes.rows[0].id]
        );
        briefingId = updateRes.rows[0].id;
    } else {
        const insertRes = await db.query(
            `INSERT INTO ai_briefings (user_id, briefing_date, summary, alerts, stats)
             VALUES ($1, CURRENT_DATE, $2, $3::jsonb, $4::jsonb) RETURNING id`,
            [userId || null, summary, JSON.stringify(alerts), JSON.stringify(stats)]
        );
        briefingId = insertRes.rows[0].id;
    }

    return { id: briefingId, summary, alerts, stats };
}

// =============================================================================
// Get latest unread briefing
// =============================================================================
async function getLatestBriefing(userId) {
    const res = await db.query(
        `SELECT id, briefing_date, summary, alerts, stats, is_read, created_at
         FROM ai_briefings
         WHERE ${userId ? 'user_id = $1 OR user_id IS NULL' : 'user_id IS NULL'}
         ORDER BY briefing_date DESC LIMIT 1`,
        userId ? [userId] : []
    );
    return res.rows[0] || null;
}

// =============================================================================
// Mark briefing as read
// =============================================================================
async function markBriefingRead(briefingId) {
    await db.query(
        `UPDATE ai_briefings SET is_read = true WHERE id = $1`,
        [briefingId]
    );
}

module.exports = {
    generateBriefing,
    getLatestBriefing,
    markBriefingRead,
};
