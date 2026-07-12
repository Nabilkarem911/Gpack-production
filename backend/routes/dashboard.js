'use strict';

const express = require('express');
const db = require('../db');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/authMiddleware');
const authorize = require('../middleware/authorize');
const { getVatRate } = require('../utils/settings');
const { pendingPricingUpdate, validateBody } = require('../utils/validators');

const router = express.Router();

// View permission: users with 'dashboard' view can access
router.use(authorize('dashboard', 'view'));

// =============================================================================
// Role Helpers
// =============================================================================
function _getRoleInfo(req) {
    const userRole = req.user?.role?.toLowerCase() || '';
    const userId   = req.user?.id;
    const perms    = req.user?.permissions || {};
    const isAdmin  = ['super_admin', 'admin', 'manager'].includes(userRole);
    const isSalesRep = userRole === 'sales_rep' || (!isAdmin && (perms.sales?.view === true));
    const isWarehouse = ['warehouse', 'warehouse_keeper'].includes(userRole)
        || (!isAdmin && !isSalesRep && (perms.warehouses?.view === true || perms.inventory?.view === true));
    return { userRole, userId, isAdmin, isSalesRep, isWarehouse };
}

// =============================================================================
// GET /api/dashboard/stats
// Returns dashboard statistics including orders, sales, stock, and clients
// =============================================================================

router.get('/stats', authenticate, async (req, res) => {
    try {
        const { isAdmin, isSalesRep, isWarehouse, userId } = _getRoleInfo(req);
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const startOfMonthStr = startOfMonth.toISOString().split('T')[0];

        let ordersWhere = '';
        let ordersParams = [startOfMonthStr];
        let pendingOrdersWhere = '';
        let quotationsWhere = '';

        if (isSalesRep) {
            ordersWhere = ' AND created_by = $2';
            ordersParams.push(userId);
            pendingOrdersWhere = ' AND created_by = $1';
            quotationsWhere = ' AND created_by = $1';
        }

        // 1. Total Orders This Month
        const ordersResult = await db.query(
            `SELECT COUNT(*) as total_orders,
                    COALESCE(SUM(grand_total), 0) as total_sales
             FROM orders
             WHERE created_at >= $1 AND status != 'cancelled'${ordersWhere}`,
            ordersParams
        );

        // 2. Active Clients Count (visible to admin/manager; sales_rep sees their own)
        let clientsQuery = `SELECT COUNT(*) as total_clients FROM clients WHERE status = 'active'`;
        let clientsParams = [];
        if (isSalesRep) {
            clientsQuery += ` AND created_by = $1`;
            clientsParams.push(userId);
        }
        const clientsResult = await db.query(clientsQuery, clientsParams);

        // 3. Pending Orders Count
        const pendingResult = await db.query(
            `SELECT COUNT(*) as pending_orders
             FROM orders
             WHERE status IN ('quote', 'confirmed', 'processing')${pendingOrdersWhere}`,
            isSalesRep ? [userId] : []
        );

        // 4. Low Stock Items Count
        let lowStockQuery = `SELECT COUNT(*) as low_stock_count
             FROM warehouse_stock ws
             JOIN product_variants pv ON ws.variant_id = pv.id
             WHERE ws.quantity <= COALESCE(pv.min_stock_level, 10)`;
        if (isSalesRep) {
            lowStockQuery = `SELECT 0 as low_stock_count`;
        }
        const lowStockResult = await db.query(lowStockQuery);

        // 5. Total Products Count
        const productsResult = await db.query(
            `SELECT COUNT(*) as total_products FROM products WHERE status = 'active'`
        );

        // 6. Manufacturer Orders Status
        let moQuery = `SELECT
                COUNT(*) FILTER (WHERE status = 'pending') as pending_mo,
                COUNT(*) FILTER (WHERE status = 'sent') as sent_mo,
                COUNT(*) FILTER (WHERE status = 'received') as received_mo,
                COUNT(*) FILTER (WHERE status IN ('pending','sent','partially_received')) as awaiting_receiving
             FROM manufacturer_orders`;
        if (isSalesRep) {
            moQuery = `SELECT 0 as pending_mo, 0 as sent_mo, 0 as received_mo, 0 as awaiting_receiving`;
        }
        const manufacturerOrdersResult = await db.query(moQuery, isSalesRep ? [] : []);

        // 7. Quotations Count
        const quotationsResult = await db.query(
            `SELECT COUNT(*) as quotations_count FROM orders WHERE status = 'quote'${quotationsWhere}`,
            isSalesRep ? [userId] : []
        );

        // 8. Outstanding Receivables (financial — hide from non-admin)
        let receivablesQuery = `SELECT COALESCE(SUM(grand_total), 0) as outstanding FROM invoices WHERE status IN ('sent', 'overdue')`;
        if (isSalesRep || isWarehouse) {
            receivablesQuery = `SELECT 0 as outstanding`;
        }
        const receivablesResult = await db.query(receivablesQuery);

        const stats = {
            quotations_count: parseInt(quotationsResult.rows[0]?.quotations_count || 0),
            orders_count: parseInt(pendingResult.rows[0]?.pending_orders || 0),
            total_revenue: isAdmin ? parseFloat(ordersResult.rows[0]?.total_sales || 0) : 0,
            outstanding_receivables: isAdmin ? parseFloat(receivablesResult.rows[0]?.outstanding || 0) : 0,
            orders_this_month: parseInt(ordersResult.rows[0]?.total_orders || 0),
            sales_this_month: parseFloat(ordersResult.rows[0]?.total_sales || 0),
            active_clients: parseInt(clientsResult.rows[0]?.total_clients || 0),
            pending_orders: parseInt(pendingResult.rows[0]?.pending_orders || 0),
            low_stock_items: parseInt(lowStockResult.rows[0]?.low_stock_count || 0),
            total_products: parseInt(productsResult.rows[0]?.total_products || 0),
            manufacturer_orders: {
                pending: parseInt(manufacturerOrdersResult.rows[0]?.pending_mo || 0),
                sent: parseInt(manufacturerOrdersResult.rows[0]?.sent_mo || 0),
                received: parseInt(manufacturerOrdersResult.rows[0]?.received_mo || 0),
                awaiting_receiving: parseInt(manufacturerOrdersResult.rows[0]?.awaiting_receiving || 0)
            }
        };

        return success(res, stats);
    } catch (err) {
        console.error('Dashboard stats error:', err);
        return res.status(500).json({ error: 'فشل في تحميل الإحصائيات' });
    }
});

// =============================================================================
// GET /api/dashboard/alerts
// Returns critical alerts (low stock, pending orders, etc.)
// =============================================================================

router.get('/alerts', authenticate, async (req, res) => {
    try {
        const { isAdmin, isSalesRep, isWarehouse, userId } = _getRoleInfo(req);
        const alerts = [];

        // Sales Rep: only their own pending orders
        if (isSalesRep || isAdmin) {
            const pendingOrdersResult = await db.query(
                `SELECT
                    o.id as order_id,
                    o.order_number,
                    c.name as client_name,
                    o.grand_total,
                    o.created_at,
                    EXTRACT(DAY FROM NOW() - o.created_at) as days_pending
                 FROM orders o
                 JOIN clients c ON o.client_id = c.id
                 WHERE o.status IN ('pending', 'confirmed')
                 AND o.created_at < NOW() - INTERVAL '3 days'
                 ${isSalesRep ? `AND o.created_by = $1` : ''}
                 ORDER BY o.created_at ASC
                 LIMIT 5`,
                isSalesRep ? [userId] : []
            );

            pendingOrdersResult.rows.forEach(row => {
                alerts.push({
                    type: 'pending_order',
                    severity: row.days_pending > 7 ? 'critical' : 'warning',
                    title: `طلب معلق: ${row.order_number}`,
                    message: `العميل: ${row.client_name} - مُعلّق منذ ${Math.floor(row.days_pending)} يوم`,
                    order_id: row.order_id,
                    created_at: row.created_at
                });
            });
        }

        // Warehouse / Admin: low stock + out of stock + pending receiving
        if (isWarehouse || isAdmin) {
            // 0. Pending Receiving (manufacturer orders sent to suppliers)
            const pendingReceivingResult = await db.query(
                `SELECT
                    mo.id as mo_id,
                    mo.mo_number AS po_number,
                    mo.status,
                    mo.created_at,
                    s.company_name AS supplier_name,
                    EXTRACT(DAY FROM NOW() - mo.created_at) as days_pending
                 FROM manufacturer_orders mo
                 LEFT JOIN suppliers s ON s.id = mo.manufacturer_id
                 WHERE mo.status IN ('sent', 'partially_received')
                 ORDER BY mo.created_at ASC
                 LIMIT 5`
            );

            pendingReceivingResult.rows.forEach(row => {
                alerts.push({
                    type: 'pending_receiving',
                    severity: row.days_pending > 7 ? 'critical' : 'warning',
                    title: `بضاعة منتظر استلامها: ${row.po_number || row.mo_id}`,
                    message: `المورد: ${row.supplier_name || 'غير محدد'} - منذ ${Math.floor(row.days_pending)} يوم`,
                    mo_id: row.mo_id,
                    created_at: row.created_at
                });
            });

            // 1. Low Stock Alerts
            const lowStockResult = await db.query(
                `SELECT
                    ws.id as stock_id,
                    p.name as product_name,
                    pv.size_name as variant_size,
                    ws.quantity as current_qty,
                    COALESCE(pv.min_stock_level, 10) as min_level,
                    w.name as warehouse_name
                 FROM warehouse_stock ws
                 JOIN product_variants pv ON ws.variant_id = pv.id
                 JOIN products p ON pv.product_id = p.id
                 JOIN warehouses w ON ws.warehouse_id = w.id
                 WHERE ws.quantity <= COALESCE(pv.min_stock_level, 10)
                 AND ws.quantity > 0
                 ORDER BY ws.quantity ASC
                 LIMIT 10`
            );

            lowStockResult.rows.forEach(row => {
                alerts.push({
                    type: 'low_stock',
                    severity: row.current_qty < row.min_level * 0.5 ? 'critical' : 'warning',
                    title: `مخزون منخفض: ${row.product_name}`,
                    message: `الكمية: ${row.current_qty} (الحد الأدنى: ${row.min_level}) - ${row.warehouse_name}`,
                    stock_id: row.stock_id,
                    created_at: new Date().toISOString()
                });
            });

            // 2. Out of Stock Items
            const outOfStockResult = await db.query(
                `SELECT
                    ws.id as stock_id,
                    p.name as product_name,
                    pv.size_name as variant_size,
                    w.name as warehouse_name
                 FROM warehouse_stock ws
                 JOIN product_variants pv ON ws.variant_id = pv.id
                 JOIN products p ON pv.product_id = p.id
                 JOIN warehouses w ON ws.warehouse_id = w.id
                 WHERE ws.quantity = 0
                 ORDER BY p.name
                 LIMIT 5`
            );

            outOfStockResult.rows.forEach(row => {
                alerts.push({
                    type: 'out_of_stock',
                    severity: 'critical',
                    title: `نفاد المخزون: ${row.product_name}`,
                    message: `نفد المخزون - ${row.warehouse_name}`,
                    stock_id: row.stock_id,
                    created_at: new Date().toISOString()
                });
            });
        }

        // Sort by severity (critical first)
        alerts.sort((a, b) => {
            const severityOrder = { critical: 0, warning: 1, info: 2 };
            return severityOrder[a.severity] - severityOrder[b.severity];
        });

        return success(res, alerts);
    } catch (err) {
        console.error('Dashboard alerts error:', err);
        return res.status(500).json({ error: 'فشل في تحميل التنبيهات' });
    }
});

// =============================================================================
// GET /api/dashboard/recent-orders
// Returns recent orders with client info
// =============================================================================

router.get('/recent-orders', authenticate, async (req, res) => {
    try {
        const { isAdmin, isSalesRep, isWarehouse, userId } = _getRoleInfo(req);
        const { limit = 10 } = req.query;

        let whereClause = '';
        let params = [limit];

        if (isSalesRep) {
            whereClause = `WHERE o.created_by = $2`;
            params = [limit, userId];
        } else if (isWarehouse) {
            // Warehouse sees production-ready orders
            whereClause = `WHERE o.status IN ('production', 'processing', 'ready')`;
        }

        const result = await db.query(
            `SELECT
                o.id,
                o.order_number,
                c.name as client_name,
                o.status,
                o.grand_total,
                o.created_at,
                COUNT(oi.id) as items_count
             FROM orders o
             JOIN clients c ON o.client_id = c.id
             LEFT JOIN order_items oi ON o.id = oi.order_id
             ${whereClause}
             GROUP BY o.id, o.order_number, c.name, o.status, o.grand_total, o.created_at
             ORDER BY o.created_at DESC
             LIMIT $1`,
            params
        );

        const orders = result.rows.map(row => ({
            id: row.id,
            order_number: row.order_number,
            client_name: row.client_name,
            status: row.status,
            total_amount: parseFloat(row.grand_total || 0),
            items_count: parseInt(row.items_count),
            created_at: row.created_at,
            formatted_date: new Date(row.created_at).toLocaleDateString('ar-SA')
        }));

        return success(res, orders);
    } catch (err) {
        console.error('Recent orders error:', err);
        return res.status(500).json({ error: 'فشل في تحميل الطلبات' });
    }
});

// =============================================================================
// GET /api/dashboard/chart-data
// Returns data for charts (monthly sales, etc.)
// =============================================================================

router.get('/chart-data', authenticate, async (req, res) => {
    try {
        const { isAdmin, isSalesRep, userId } = _getRoleInfo(req);

        // Financial charts — admin/manager only
        if (!isAdmin && !isSalesRep) {
            return success(res, { monthly_sales: [], sales_by_status: [], top_products: [] });
        }

        let whereFilter = '';
        const params = [];
        if (isSalesRep) {
            whereFilter = `AND created_by = $1`;
            params.push(userId);
        }

        // Monthly sales for last 6 months
        const monthlySalesResult = await db.query(
            `SELECT
                DATE_TRUNC('month', created_at) as month,
                COUNT(*) as orders_count,
                COALESCE(SUM(grand_total), 0) as total_sales
             FROM orders
             WHERE status != 'cancelled'
             AND created_at >= NOW() - INTERVAL '6 months'
             ${whereFilter}
             GROUP BY DATE_TRUNC('month', created_at)
             ORDER BY month ASC`,
            params
        );

        const monthlySales = monthlySalesResult.rows.map(row => ({
            month: new Date(row.month).toLocaleDateString('ar-SA', { month: 'short', year: 'numeric' }),
            orders_count: parseInt(row.orders_count),
            total_sales: parseFloat(row.total_sales)
        }));

        // Sales by status
        const statusResult = await db.query(
            `SELECT
                status,
                COUNT(*) as count
             FROM orders
             WHERE created_at >= NOW() - INTERVAL '30 days'
             ${whereFilter}
             GROUP BY status`,
            params
        );

        const salesByStatus = statusResult.rows.map(row => ({
            status: row.status,
            count: parseInt(row.count)
        }));

        // Top selling products
        let topProductsQuery = `SELECT
                p.name as product_name,
                SUM(oi.quantity) as total_quantity,
                SUM(oi.quantity * oi.unit_price) as total_revenue
             FROM order_items oi
             JOIN product_variants pv ON oi.variant_id = pv.id
             JOIN products p ON pv.product_id = p.id
             JOIN orders o ON oi.order_id = o.id
             WHERE o.status != 'cancelled'
             AND o.created_at >= NOW() - INTERVAL '30 days'
             ${isSalesRep ? `AND o.created_by = $1` : ''}
             GROUP BY p.name
             ORDER BY total_quantity DESC
             LIMIT 5`;

        const topProductsResult = await db.query(topProductsQuery, isSalesRep ? [userId] : []);

        const topProducts = topProductsResult.rows.map(row => ({
            product_name: row.product_name,
            total_quantity: parseInt(row.total_quantity),
            total_revenue: parseFloat(row.total_revenue)
        }));

        return success(res, {
            monthly_sales: monthlySales,
            sales_by_status: salesByStatus,
            top_products: topProducts
        });
    } catch (err) {
        console.error('Chart data error:', err);
        return res.status(500).json({ error: 'فشل في تحميل بيانات الرسوم البيانية' });
    }
});

// =============================================================================
// GET /api/dashboard/activities
// Returns recent system activities
// =============================================================================

router.get('/activities', authenticate, async (req, res) => {
    try {
        const { isAdmin, isSalesRep, isWarehouse, userId } = _getRoleInfo(req);
        const { limit = 10 } = req.query;

        let activities = [];

        if (isWarehouse || isAdmin) {
            // Inventory transactions
            const transactionsResult = await db.query(
                `SELECT
                    it.id,
                    it.transaction_type,
                    it.quantity,
                    it.created_at,
                    p.name as product_name,
                    pv.size_name as variant_size,
                    w.name as warehouse_name,
                    u.name as created_by_name
                 FROM inventory_transactions it
                 JOIN product_variants pv ON it.variant_id = pv.id
                 JOIN products p ON pv.product_id = p.id
                 JOIN warehouses w ON it.warehouse_from = w.id OR it.warehouse_to = w.id
                 LEFT JOIN users u ON it.created_by = u.id
                 ORDER BY it.created_at DESC
                 LIMIT $1`,
                [limit]
            );

            activities = transactionsResult.rows.map(row => ({
                id: row.id,
                type: 'inventory',
                action: row.transaction_type,
                description: `${row.product_name} ${row.variant_size ? '- ' + row.variant_size : ''}`,
                warehouse: row.warehouse_name,
                quantity: row.quantity,
                created_by: row.created_by_name,
                created_at: row.created_at
            }));
        } else if (isSalesRep) {
            // Sales rep sees their own order-related activities (mock via audit_logs if available)
            activities = [];
        }

        return success(res, activities);
    } catch (err) {
        console.error('Activities error:', err);
        return res.status(500).json({ error: 'فشل في تحميل الأنشطة' });
    }
});

// =============================================================================
// GET /api/dashboard/pending-pricing
// Returns quotations (status='quote') that have items with zero/null unit_price
// and pricing_status = 'pending'. Visible to admin/manager only.
// =============================================================================

router.get('/pending-pricing', authenticate, authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    try {
        // Find quote orders with at least one item having unit_price = 0 or NULL
        const result = await db.query(
            `SELECT 
                o.id,
                o.order_number,
                o.order_date,
                o.valid_until,
                o.internal_notes,
                o.pricing_status,
                o.pricing_notes,
                c.name as client_name,
                u.name as created_by_name,
                o.created_at,
                COUNT(oi.id) as total_items,
                COUNT(CASE WHEN COALESCE(oi.unit_price, 0) = 0 THEN 1 END) as unpriced_items
             FROM orders o
             JOIN clients c ON o.client_id = c.id
             LEFT JOIN users u ON o.created_by = u.id
             JOIN order_items oi ON oi.order_id = o.id
             WHERE o.status = 'quote'
             AND (
                 o.pricing_status = 'pending'
                 OR EXISTS (
                     SELECT 1 FROM order_items oi2 
                     WHERE oi2.order_id = o.id 
                     AND COALESCE(oi2.unit_price, 0) = 0
                 )
             )
             GROUP BY o.id, o.order_number, o.order_date, o.valid_until, 
                      o.internal_notes, o.pricing_status, o.pricing_notes,
                      c.name, u.name, o.created_at
             ORDER BY o.created_at DESC`
        );

        const pending = result.rows.map(row => ({
            id: row.id,
            order_number: row.order_number,
            order_date: row.order_date,
            valid_until: row.valid_until,
            client_name: row.client_name,
            created_by_name: row.created_by_name,
            total_items: parseInt(row.total_items),
            unpriced_items: parseInt(row.unpriced_items),
            pricing_status: row.pricing_status || 'pending',
            pricing_notes: row.pricing_notes,
            internal_notes: row.internal_notes,
            created_at: row.created_at
        }));

        return success(res, pending);
    } catch (err) {
        console.error('Pending pricing error:', err);
        return res.status(500).json({ error: 'فشل في تحميل عروض الأسعار المستنّدة' });
    }
});

// =============================================================================
// PUT /api/dashboard/pending-pricing/:id
// Manager updates unit prices for items and sets pricing_status to 'priced'
// Body: { items: [{id, unit_price}], pricing_notes }
// =============================================================================

router.put('/pending-pricing/:id', authenticate, authorize(['admin', 'manager', 'super_admin']), validateBody(pendingPricingUpdate), async (req, res) => {
    const { id } = req.params;
    const { items, pricing_notes } = req.validatedBody;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'يجب إرسال قائمة الأسعار' });
    }

    try {
        const fallbackVatRate = await getVatRate();

        await db.withTransaction(async (client) => {
            // Update each item price (line_total is GENERATED — auto-calculates)
            for (const item of items) {
                if (item.id && item.unit_price !== undefined) {
                    await client.query(
                        `UPDATE order_items 
                         SET unit_price = $1
                         WHERE id = $2 AND order_id = $3`,
                        [item.unit_price, item.id, id]
                    );
                }
            }

            // Recalculate order totals
            await client.query(
                `UPDATE orders
                 SET subtotal = (SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE order_id = $1),
                     tax_amount = (SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE order_id = $1) * COALESCE(tax_rate, $3),
                     grand_total = (SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE order_id = $1) * (1 + COALESCE(tax_rate, $3)),
                     pricing_status = 'priced',
                     pricing_notes = COALESCE($2, pricing_notes),
                     updated_at = NOW()
                 WHERE id = $1`,
                [id, pricing_notes || null, fallbackVatRate]
            );
        });

        return success(res, { message: 'تم تحديث الأسعار بنجاح' });
    } catch (err) {
        console.error('Update pricing error:', err);
        return res.status(500).json({ error: 'فشل في تحديث الأسعار' });
    }
});

// =============================================================================
// GET /api/dashboard/pending-pricing/:id
// Get full quotation details with items for pricing modal
// =============================================================================

router.get('/pending-pricing/:id', authenticate, authorize(['admin', 'manager', 'super_admin']), async (req, res) => {
    const { id } = req.params;
    try {
        const orderResult = await db.query(
            `SELECT
                o.id, o.order_number, o.order_date, o.valid_until,
                o.internal_notes, o.pricing_status, o.pricing_notes,
                o.client_id,
                c.name as client_name, u.name as created_by_name,
                o.created_at
             FROM orders o
             JOIN clients c ON o.client_id = c.id
             LEFT JOIN users u ON o.created_by = u.id
             WHERE o.id = $1 AND o.status = 'quote'`,
            [id]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: 'عرض السعر غير موجود' });
        }

        const order = orderResult.rows[0];

        const itemsResult = await db.query(
            `SELECT
                oi.id, oi.quantity, oi.unit_price, oi.discount_percent,
                oi.line_total, oi.variant_id,
                p.name as product_name, pv.size_name as variant_size,
                pv.sku
             FROM order_items oi
             JOIN product_variants pv ON oi.variant_id = pv.id
             JOIN products p ON pv.product_id = p.id
             WHERE oi.order_id = $1
             ORDER BY oi.created_at ASC`,
            [id]
        );

        return success(res, {
            ...order,
            items: itemsResult.rows
        });
    } catch (err) {
        console.error('Get pricing detail error:', err);
        return res.status(500).json({ error: 'فشل في تحميل تفاصيل عرض السعر' });
    }
});

module.exports = router;
