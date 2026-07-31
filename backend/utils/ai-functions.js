'use strict';

// =============================================================================
// G.PACK 2.0 — AI Assistant Functions (ai-functions.js)
// Defines OpenAI function-calling schemas + their execution logic.
// ALL functions are READ-ONLY — no INSERT / UPDATE / DELETE.
// Each function receives (args, user) where user = { id, role, permissions }.
// =============================================================================

const db = require('../db');
const featureFlags = require('./ai-feature-flags');

// ── Helper: build sales-rep scope clause ─────────────────────────────────────
function _salesRepScope(user, alias) {
    const a = alias || 'o';
    if (user.role === 'sales_rep') return `AND ${a}.created_by = $1`;
    return '';
}

// ── Helper: sanitize result (strip sensitive fields) ────────────────────────
function _sanitize(rows) {
    if (!Array.isArray(rows)) return rows;
    const sensitive = ['password_hash', 'token_version', 'share_token', 'share_token_hash'];
    return rows.map(row => {
        const clean = { ...row };
        sensitive.forEach(k => delete clean[k]);
        return clean;
    });
}

// =============================================================================
// Function Definitions (OpenAI tool schema + executor)
// =============================================================================

const AI_FUNCTIONS = [

    // ── 1. getSalesSummary ───────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getSalesSummary',
            description: 'يرجع ملخص المبيعات (إجمالي، عدد فواتير، متوسط قيمة فاتورة) لفترة معينة. الفترات: today, week, month, quarter, year.',
            parameters: {
                type: 'object',
                properties: {
                    period: { type: 'string', enum: ['today', 'week', 'month', 'quarter', 'year'], description: 'الفترة الزمنية' }
                },
                required: ['period']
            }
        },
        async execute(args, user) {
            const { period } = args;
            let dateFilter;
            const params = [];
            if (period === 'today') {
                dateFilter = `DATE(i.invoice_date) = CURRENT_DATE`;
            } else if (period === 'week') {
                dateFilter = `i.invoice_date >= date_trunc('week', NOW())`;
            } else if (period === 'month') {
                dateFilter = `i.invoice_date >= date_trunc('month', NOW())`;
            } else if (period === 'quarter') {
                dateFilter = `i.invoice_date >= date_trunc('quarter', NOW())`;
            } else {
                dateFilter = `i.invoice_date >= date_trunc('year', NOW())`;
            }
            const result = await db.query(
                `SELECT COALESCE(SUM(i.grand_total), 0) as total_sales,
                        COUNT(*) as invoice_count,
                        COALESCE(AVG(i.grand_total), 0) as avg_invoice_value
                 FROM invoices i
                 WHERE i.status != 'cancelled' AND ${dateFilter}`
            );
            return _sanitize(result.rows);
        }
    },

    // ── 2. getTopProducts ────────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getTopProducts',
            description: 'يرجع أكثر المنتجات مبيعاً (أعلى 10) في فترة معينة.',
            parameters: {
                type: 'object',
                properties: {
                    period: { type: 'string', enum: ['week', 'month', 'quarter', 'year'], description: 'الفترة الزمنية' },
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 10)' }
                }
            }
        },
        async execute(args, user) {
            const { period = 'month', limit = 10 } = args;
            let dateFilter;
            if (period === 'week') dateFilter = `o.created_at >= date_trunc('week', NOW())`;
            else if (period === 'quarter') dateFilter = `o.created_at >= date_trunc('quarter', NOW())`;
            else if (period === 'year') dateFilter = `o.created_at >= date_trunc('year', NOW())`;
            else dateFilter = `o.created_at >= date_trunc('month', NOW())`;

            const result = await db.query(
                `SELECT p.name as product_name, pv.size_name as size,
                        SUM(oi.quantity)::numeric as total_qty,
                        SUM(oi.quantity * oi.unit_price)::numeric as total_revenue
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN product_variants pv ON pv.id = oi.variant_id
                 JOIN products p ON p.id = pv.product_id
                 WHERE o.status NOT IN ('quote', 'cancelled', 'draft')
                   AND ${dateFilter}
                 GROUP BY p.name, pv.size_name
                 ORDER BY total_qty DESC
                 LIMIT $1`,
                [parseInt(limit) || 10]
            );
            return _sanitize(result.rows);
        }
    },

    // ── 3. getClientAccount ──────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getClientAccount',
            description: 'يرجع ملخص حساب عميل: إجمالي الفواتير، المدفوع، المتبقي، عدد الطلبات. ابحث بالاسم أو جزء منه.',
            parameters: {
                type: 'object',
                properties: {
                    client_name: { type: 'string', description: 'اسم العميل أو جزء منه' }
                },
                required: ['client_name']
            }
        },
        async execute(args, user) {
            const { client_name } = args;
            const result = await db.query(
                `SELECT c.id, c.name,
                        COALESCE(SUM(i.grand_total), 0)::numeric as total_invoiced,
                        COALESCE(SUM(ct.paid), 0)::numeric as total_paid,
                        COALESCE(SUM(i.grand_total) - COALESCE(SUM(ct.paid), 0), 0)::numeric as balance_due,
                        COUNT(DISTINCT i.id) as invoice_count,
                        COUNT(DISTINCT o.id) as order_count
                 FROM clients c
                 LEFT JOIN invoices i ON i.client_id = c.id AND i.status != 'cancelled'
                 LEFT JOIN (
                     SELECT invoice_id, SUM(amount) as paid
                     FROM client_transactions
                     WHERE type = 'payment' AND invoice_id IS NOT NULL
                     GROUP BY invoice_id
                 ) ct ON ct.invoice_id = i.id
                 LEFT JOIN orders o ON o.client_id = c.id
                 WHERE c.name ILIKE $1
                 GROUP BY c.id, c.name
                 LIMIT 5`,
                [`%${client_name}%`]
            );
            return _sanitize(result.rows);
        }
    },

    // ── 4. getSupplierAccount ────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getSupplierAccount',
            description: 'يرجع ملخص حساب مورد: إجمالي المشتريات، المدفوع، المتبقي. ابحث بالاسم أو جزء منه.',
            parameters: {
                type: 'object',
                properties: {
                    supplier_name: { type: 'string', description: 'اسم المورد أو جزء منه' }
                },
                required: ['supplier_name']
            }
        },
        async execute(args, user) {
            const { supplier_name } = args;
            const result = await db.query(
                `SELECT s.id, s.company_name as name,
                        COALESCE(SUM(pi.grand_total), 0)::numeric as total_purchased,
                        COALESCE(SUM(pi.paid_amount), 0)::numeric as total_paid,
                        COALESCE(SUM(pi.grand_total - pi.paid_amount), 0)::numeric as balance_due,
                        COUNT(DISTINCT pi.id) as invoice_count
                 FROM suppliers s
                 LEFT JOIN purchase_invoices pi ON pi.supplier_id = s.id AND pi.status != 'cancelled'
                 WHERE s.company_name ILIKE $1
                 GROUP BY s.id, s.company_name
                 LIMIT 5`,
                [`%${supplier_name}%`]
            );
            return _sanitize(result.rows);
        }
    },

    // ── 5. getInventoryStatus ────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getInventoryStatus',
            description: 'يرجع حالة المخزون: الأصناف القاربت على النفاد (أقل من حد معين) أو النافدة تماماً. يمكن فلترة النتائج باسم مستودع معين.',
            parameters: {
                type: 'object',
                properties: {
                    threshold: { type: 'number', description: 'الحد الأدنى للتنبيه (افتراضي 100)' },
                    warehouse_name: { type: 'string', description: 'اسم المستودع أو جزء منه للفلترة (اختياري)' }
                }
            }
        },
        async execute(args, user) {
            const { threshold = 100, warehouse_name } = args;
            let query, params;

            if (warehouse_name) {
                // Filter by specific warehouse — use LEFT JOIN to show 0-stock items too
                query = `SELECT p.name as product_name, pv.size_name as size,
                                COALESCE(ws.quantity, 0)::numeric as total_stock,
                                w.name as warehouse_name,
                                COALESCE(ws.reserved_qty, 0)::numeric as reserved_qty,
                                (COALESCE(ws.quantity, 0) - COALESCE(ws.reserved_qty, 0))::numeric as available_qty
                         FROM product_variants pv
                         JOIN products p ON p.id = pv.product_id
                         JOIN warehouses w ON w.name ILIKE $1
                         LEFT JOIN warehouse_stock ws ON ws.variant_id = pv.id AND ws.warehouse_id = w.id
                         WHERE pv.status = 'active'
                           AND COALESCE(ws.quantity, 0) < $2
                         ORDER BY total_stock ASC
                         LIMIT 30`;
                params = [`%${warehouse_name}%`, parseFloat(threshold)];
            } else {
                // No warehouse filter — only show actual stock records (no CROSS JOIN)
                query = `SELECT p.name as product_name, pv.size_name as size,
                                COALESCE(ws.quantity, 0)::numeric as total_stock,
                                w.name as warehouse_name,
                                COALESCE(ws.reserved_qty, 0)::numeric as reserved_qty,
                                (COALESCE(ws.quantity, 0) - COALESCE(ws.reserved_qty, 0))::numeric as available_qty
                         FROM warehouse_stock ws
                         JOIN product_variants pv ON pv.id = ws.variant_id
                         JOIN products p ON p.id = pv.product_id
                         JOIN warehouses w ON w.id = ws.warehouse_id
                         WHERE pv.status = 'active'
                           AND ws.quantity < $1
                         ORDER BY ws.quantity ASC
                         LIMIT 30`;
                params = [parseFloat(threshold)];
            }

            const result = await db.query(query, params);
            return _sanitize(result.rows);
        }
    },

    // ── 6. getSupplierPricing ────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getSupplierPricing',
            description: 'يرجع أسعار مورد معين لمنتج معين. ابحث باسم المورد واسم المنتج.',
            parameters: {
                type: 'object',
                properties: {
                    supplier_name: { type: 'string', description: 'اسم المورد أو جزء منه' },
                    product_name: { type: 'string', description: 'اسم المنتج أو جزء منه' }
                },
                required: ['product_name']
            }
        },
        async execute(args, user) {
            const { supplier_name, product_name } = args;
            let query, params;
            if (supplier_name) {
                query = `SELECT s.company_name as supplier_name, p.name as product_name, pv.size_name as size,
                                pii.unit_cost as cost_price, pi.invoice_date
                         FROM purchase_invoice_items pii
                         JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
                         JOIN suppliers s ON s.id = pi.supplier_id
                         JOIN product_variants pv ON pv.id = pii.variant_id
                         JOIN products p ON p.id = pv.product_id
                         WHERE p.name ILIKE $1 AND s.company_name ILIKE $2 AND pi.status != 'cancelled'
                         ORDER BY pii.unit_cost ASC LIMIT 20`;
                params = [`%${product_name}%`, `%${supplier_name}%`];
            } else {
                query = `SELECT s.company_name as supplier_name, p.name as product_name, pv.size_name as size,
                                pii.unit_cost as cost_price, pi.invoice_date
                         FROM purchase_invoice_items pii
                         JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
                         LEFT JOIN suppliers s ON s.id = pi.supplier_id
                         JOIN product_variants pv ON pv.id = pii.variant_id
                         JOIN products p ON p.id = pv.product_id
                         WHERE p.name ILIKE $1 AND pi.status != 'cancelled'
                         ORDER BY pii.unit_cost ASC LIMIT 20`;
                params = [`%${product_name}%`];
            }
            const result = await db.query(query, params);
            return _sanitize(result.rows);
        }
    },

    // ── 7. compareSupplierPricing ────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'compareSupplierPricing',
            description: 'يقارن أسعار الموردين المختلفين لنفس المنتج ويرجعها مرتبة من الأرخص للأغلى.',
            parameters: {
                type: 'object',
                properties: {
                    product_name: { type: 'string', description: 'اسم المنتج أو جزء منه' }
                },
                required: ['product_name']
            }
        },
        async execute(args, user) {
            const { product_name } = args;
            const result = await db.query(
                `SELECT s.company_name as supplier_name, p.name as product_name, pv.size_name as size,
                        pii.unit_cost as cost_price, pi.invoice_date
                 FROM purchase_invoice_items pii
                 JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
                 JOIN suppliers s ON s.id = pi.supplier_id
                 JOIN product_variants pv ON pv.id = pii.variant_id
                 JOIN products p ON p.id = pv.product_id
                 WHERE p.name ILIKE $1 AND pi.status != 'cancelled'
                 ORDER BY pii.unit_cost ASC`,
                [`%${product_name}%`]
            );
            return _sanitize(result.rows);
        }
    },

    // ── 8. getProductCostHistory ─────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getProductCostHistory',
            description: 'يرجع تاريخ أسعار شراء منتج معين من فواتير المشتريات.',
            parameters: {
                type: 'object',
                properties: {
                    product_name: { type: 'string', description: 'اسم المنتج أو جزء منه' },
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 10)' }
                },
                required: ['product_name']
            }
        },
        async execute(args, user) {
            const { product_name, limit = 10 } = args;
            const result = await db.query(
                `SELECT pi.invoice_date, s.company_name as supplier_name,
                        pii.product_name, pii.quantity, pii.unit_cost as unit_price
                 FROM purchase_invoice_items pii
                 JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
                 LEFT JOIN suppliers s ON s.id = pi.supplier_id
                 WHERE pii.product_name ILIKE $1 AND pi.status != 'cancelled'
                 ORDER BY pi.invoice_date DESC
                 LIMIT $2`,
                [`%${product_name}%`, parseInt(limit) || 10]
            );
            return _sanitize(result.rows);
        }
    },

    // ── 9. getClientOrders ───────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getClientOrders',
            description: 'يرجع آخر طلبات عميل معين (عروض أسعار + فواتير). ابحث بالاسم.',
            parameters: {
                type: 'object',
                properties: {
                    client_name: { type: 'string', description: 'اسم العميل أو جزء منه' },
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 10)' }
                },
                required: ['client_name']
            }
        },
        async execute(args, user) {
            const { client_name, limit = 10 } = args;
            const result = await db.query(
                `SELECT o.id, o.order_number, o.status, o.pricing_status,
                        o.created_at, o.grand_total,
                        c.name as client_name
                 FROM orders o
                 JOIN clients c ON c.id = o.client_id
                 WHERE c.name ILIKE $1
                 ORDER BY o.created_at DESC
                 LIMIT $2`,
                [`%${client_name}%`, parseInt(limit) || 10]
            );
            return _sanitize(result.rows);
        }
    },

    // ── 10. getPendingQuotes ─────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getPendingQuotes',
            description: 'يرجع عروض الأسعار المعلقة (محتاجة تسعير أو بانتظار رد العميل).',
            parameters: {
                type: 'object',
                properties: {}
            }
        },
        async execute(args, user) {
            const scope = _salesRepScope(user);
            const params = user.role === 'sales_rep' ? [user.id] : [];
            const result = await db.query(
                `SELECT o.id, o.order_number, o.status, o.pricing_status,
                        o.client_response, o.created_at, o.valid_until,
                        c.name as client_name
                 FROM orders o
                 JOIN clients c ON c.id = o.client_id
                 WHERE o.status = 'quote'
                 ${scope}
                 ORDER BY o.created_at DESC LIMIT 20`,
                params
            );
            return _sanitize(result.rows);
        }
    },

    // ── 11. getOutstandingPayments ───────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getOutstandingPayments',
            description: 'يرجع المستحقات المعلقة على العملاء (فواتير لها رصيد مستحق).',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 20)' }
                }
            }
        },
        async execute(args, user) {
            const { limit = 20 } = args;
            const result = await db.query(
                `SELECT c.name as client_name, i.invoice_number, i.invoice_date,
                        i.grand_total,
                        COALESCE(ct.paid, 0)::numeric as paid_amount,
                        (i.grand_total - COALESCE(ct.paid, 0))::numeric as balance_due
                 FROM invoices i
                 JOIN clients c ON c.id = i.client_id
                 LEFT JOIN (
                     SELECT invoice_id, SUM(amount) as paid
                     FROM client_transactions
                     WHERE type = 'payment' AND invoice_id IS NOT NULL
                     GROUP BY invoice_id
                 ) ct ON ct.invoice_id = i.id
                 WHERE (i.grand_total - COALESCE(ct.paid, 0)) > 0 AND i.status != 'cancelled'
                 ORDER BY (i.grand_total - COALESCE(ct.paid, 0)) DESC
                 LIMIT $1`,
                [parseInt(limit) || 20]
            );
            return _sanitize(result.rows);
        }
    },

    // ── 12. getProductionStatus ──────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getProductionStatus',
            description: 'يرجع حالة أوامر التشغيل المفتوحة (معلقة أو قيد التنفيذ).',
            parameters: {
                type: 'object',
                properties: {}
            }
        },
        async execute(args, user) {
            const result = await db.query(
                `SELECT mo.id, mo.mo_number, mo.status, mo.created_at,
                        o.order_number, c.name as client_name
                 FROM manufacturer_orders mo
                 JOIN orders o ON o.id = mo.order_id
                 JOIN clients c ON c.id = o.client_id
                 WHERE mo.status IN ('pending', 'in_progress')
                 ORDER BY mo.created_at DESC LIMIT 20`
            );
            return _sanitize(result.rows);
        }
    },

    // ── 13. getTopClients ────────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getTopClients',
            description: 'يرجع أفضل العملاء حسب حجم المبيعات أو الإيرادات في فترة معينة.',
            parameters: {
                type: 'object',
                properties: {
                    period: { type: 'string', enum: ['month', 'quarter', 'year', 'all'], description: 'الفترة الزمنية (افتراضي: all)' },
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 10)' },
                    metric: { type: 'string', enum: ['revenue', 'orders'], description: 'معيار الترتيب: revenue (إيرادات) أو orders (عدد طلبات). افتراضي: revenue' }
                }
            }
        },
        async execute(args, user) {
            const { period = 'all', limit = 10, metric = 'revenue' } = args;
            let dateFilter = '';
            const params = [];
            if (period === 'month') dateFilter = `AND o.created_at >= date_trunc('month', NOW())`;
            else if (period === 'quarter') dateFilter = `AND o.created_at >= date_trunc('quarter', NOW())`;
            else if (period === 'year') dateFilter = `AND o.created_at >= date_trunc('year', NOW())`;

            const orderBy = metric === 'orders' ? 'order_count DESC' : 'total_revenue DESC';

            params.push(parseInt(limit) || 10);
            const result = await db.query(
                `SELECT c.id, c.name,
                        COUNT(DISTINCT o.id) as order_count,
                        COALESCE(SUM(o.grand_total), 0)::numeric as total_revenue,
                        COALESCE(SUM(o.paid_amount), 0)::numeric as total_paid,
                        COALESCE(SUM(o.grand_total - o.paid_amount), 0)::numeric as balance_due
                 FROM clients c
                 JOIN orders o ON o.client_id = c.id
                 WHERE o.status NOT IN ('cancelled', 'draft') ${dateFilter}
                 GROUP BY c.id, c.name
                 ORDER BY ${orderBy}
                 LIMIT $1`,
                params
            );
            return _sanitize(result.rows);
        }
    },

    // ── 14. getSalesTrend ────────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getSalesTrend',
            description: 'يرجع اتجاه المبيعات الشهري (آخر 6 أو 12 شهر) لمقارنة الأداء.',
            parameters: {
                type: 'object',
                properties: {
                    months: { type: 'integer', description: 'عدد الأشهر السابقة (افتراضي 6)' }
                }
            }
        },
        async execute(args, user) {
            const { months = 6 } = args;
            const result = await db.query(
                `SELECT TO_CHAR(date_trunc('month', o.created_at), 'YYYY-MM') as month,
                        COUNT(DISTINCT o.id) as order_count,
                        COALESCE(SUM(o.grand_total), 0)::numeric as total_revenue,
                        COALESCE(SUM(o.paid_amount), 0)::numeric as total_paid
                 FROM orders o
                 WHERE o.status NOT IN ('cancelled', 'draft')
                   AND o.created_at >= date_trunc('month', NOW()) - INTERVAL '${parseInt(months) || 6} months'
                 GROUP BY date_trunc('month', o.created_at)
                 ORDER BY month DESC`
            );
            return _sanitize(result.rows);
        }
    },

    // ── 15. getRecentOrders ──────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getRecentOrders',
            description: 'يرجع آخر الطلبات/العروض في النظام مع اسم العميل والحالة.',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 10)' },
                    status: { type: 'string', description: 'فلتر بالحالة (quote, confirmed, production, delivered, cancelled). اختياري.' }
                }
            }
        },
        async execute(args, user) {
            const { limit = 10, status } = args;
            let query, params;
            if (status) {
                query = `SELECT o.id, o.order_number, o.status, o.pricing_status,
                                o.created_at, o.grand_total, o.client_response,
                                c.name as client_name
                         FROM orders o
                         JOIN clients c ON c.id = o.client_id
                         WHERE o.status = $1
                         ORDER BY o.created_at DESC LIMIT $2`;
                params = [status, parseInt(limit) || 10];
            } else {
                query = `SELECT o.id, o.order_number, o.status, o.pricing_status,
                                o.created_at, o.grand_total, o.client_response,
                                c.name as client_name
                         FROM orders o
                         JOIN clients c ON c.id = o.client_id
                         ORDER BY o.created_at DESC LIMIT $1`;
                params = [parseInt(limit) || 10];
            }
            const result = await db.query(query, params);
            return _sanitize(result.rows);
        }
    },

    // ── 16. getDashboardStats ────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getDashboardStats',
            description: 'يرجع إحصائيات عامة للنظام: إجمالي المبيعات، عدد الطلبات، عدد العملاء، عدد المنتجات، المخزون الكلي.',
            parameters: {
                type: 'object',
                properties: {}
            }
        },
        async execute(args, user) {
            const salesRes = await db.query(
                `SELECT COALESCE(SUM(grand_total), 0)::numeric as total_sales,
                        COUNT(*) as total_orders
                 FROM orders WHERE status NOT IN ('cancelled', 'draft')`
            );
            const clientsRes = await db.query(
                `SELECT COUNT(*) as total_clients FROM clients WHERE status = 'active'`
            );
            const productsRes = await db.query(
                `SELECT COUNT(*) as total_products FROM products`
            );
            const stockRes = await db.query(
                `SELECT COALESCE(SUM(quantity), 0)::numeric as total_stock FROM warehouse_stock`
            );
            const invoicesRes = await db.query(
                `SELECT COALESCE(SUM(grand_total), 0)::numeric as total_invoiced,
                        COALESCE(SUM(ct.paid), 0)::numeric as total_collected,
                        COALESCE(SUM(grand_total) - COALESCE(SUM(ct.paid), 0), 0)::numeric as total_outstanding
                 FROM invoices i
                 LEFT JOIN (
                     SELECT invoice_id, SUM(amount) as paid
                     FROM client_transactions
                     WHERE type = 'payment' AND invoice_id IS NOT NULL
                     GROUP BY invoice_id
                 ) ct ON ct.invoice_id = i.id
                 WHERE i.status != 'cancelled'`
            );
            return _sanitize([{
                ...salesRes.rows[0],
                ...clientsRes.rows[0],
                ...productsRes.rows[0],
                ...stockRes.rows[0],
                ...invoicesRes.rows[0],
            }]);
        }
    },

    // ── 17. searchProducts ───────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'searchProducts',
            description: 'يبحث عن منتج بالاسم ويرجع تفاصيله: السعر، التكلفة، المقاسات المتاحة، المخزون.',
            parameters: {
                type: 'object',
                properties: {
                    product_name: { type: 'string', description: 'اسم المنتج أو جزء منه' }
                },
                required: ['product_name']
            }
        },
        async execute(args, user) {
            const { product_name } = args;
            const result = await db.query(
                `SELECT p.id, p.name, p.description,
                        pv.size_name, pv.sku, pv.selling_price, pv.cost_price, pv.status,
                        COALESCE(ws.qty, 0)::numeric as total_stock
                 FROM products p
                 JOIN product_variants pv ON pv.product_id = p.id
                 LEFT JOIN (
                     SELECT variant_id, SUM(quantity) as qty
                     FROM warehouse_stock GROUP BY variant_id
                 ) ws ON ws.variant_id = pv.id
                 WHERE p.name ILIKE $1
                 ORDER BY p.name, pv.size_name
                 LIMIT 20`,
                [`%${product_name}%`]
            );
            return _sanitize(result.rows);
        }
    },

    // ── 18. getClientBalance ─────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getClientBalance',
            description: 'يرجع كشف حساب عميل: الفواتير، المدفوعات، الرصيد المتبقي، وآخر نشاط.',
            parameters: {
                type: 'object',
                properties: {
                    client_name: { type: 'string', description: 'اسم العميل أو جزء منه' }
                },
                required: ['client_name']
            }
        },
        async execute(args, user) {
            const { client_name } = args;
            const summaryRes = await db.query(
                `SELECT c.id, c.name, c.phone, c.email,
                        COALESCE(SUM(i.grand_total), 0)::numeric as total_invoiced,
                        COALESCE(SUM(ct.paid), 0)::numeric as total_paid,
                        COALESCE(SUM(i.grand_total) - COALESCE(SUM(ct.paid), 0), 0)::numeric as balance_due,
                        COUNT(DISTINCT i.id) as invoice_count
                 FROM clients c
                 LEFT JOIN invoices i ON i.client_id = c.id AND i.status != 'cancelled'
                 LEFT JOIN (
                     SELECT invoice_id, SUM(amount) as paid
                     FROM client_transactions
                     WHERE type = 'payment' AND invoice_id IS NOT NULL
                     GROUP BY invoice_id
                 ) ct ON ct.invoice_id = i.id
                 WHERE c.name ILIKE $1
                 GROUP BY c.id, c.name, c.phone, c.email
                 LIMIT 1`,
                [`%${client_name}%`]
            );
            if (summaryRes.rows.length === 0) return { error: 'لم يتم العثور على العميل' };
            const clientId = summaryRes.rows[0].id;
            const invoicesRes = await db.query(
                `SELECT i.invoice_number, i.invoice_date, i.grand_total,
                        COALESCE(ct.paid, 0)::numeric as paid_amount,
                        (i.grand_total - COALESCE(ct.paid, 0))::numeric as balance_due, i.status
                 FROM invoices i
                 LEFT JOIN (
                     SELECT invoice_id, SUM(amount) as paid
                     FROM client_transactions
                     WHERE type = 'payment' AND invoice_id IS NOT NULL
                     GROUP BY invoice_id
                 ) ct ON ct.invoice_id = i.id
                 WHERE i.client_id = $1 AND i.status != 'cancelled'
                 ORDER BY i.invoice_date DESC LIMIT 10`,
                [clientId]
            );
            return _sanitize([{
                ...summaryRes.rows[0],
                recent_invoices: invoicesRes.rows,
            }]);
        }
    },

    // ── 19. getMonthlyComparison ─────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getMonthlyComparison',
            description: 'يقارن مبيعات الشهر الحالي بالشهر السابق: إجمالي المبيعات، عدد الطلبات، متوسط قيمة الطلب.',
            parameters: {
                type: 'object',
                properties: {}
            }
        },
        async execute(args, user) {
            const result = await db.query(
                `SELECT
                    CASE WHEN o.created_at >= date_trunc('month', NOW()) THEN 'current'
                         ELSE 'previous' END as period,
                    COUNT(DISTINCT o.id) as order_count,
                    COALESCE(SUM(o.grand_total), 0)::numeric as total_revenue,
                    COALESCE(AVG(o.grand_total), 0)::numeric as avg_order_value
                 FROM orders o
                 WHERE o.status NOT IN ('cancelled', 'draft')
                   AND o.created_at >= date_trunc('month', NOW()) - INTERVAL '1 month'
                 GROUP BY CASE WHEN o.created_at >= date_trunc('month', NOW()) THEN 'current'
                               ELSE 'previous' END`
            );
            return _sanitize(result.rows);
        }
    },

    // ── 20. getStockValuation ────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getStockValuation',
            description: 'يرجع تقييم المخزون: قيمة المخزون الكلية، عدد الأصناف، توزيع المخزون حسب المستودع.',
            parameters: {
                type: 'object',
                properties: {}
            }
        },
        async execute(args, user) {
            const totalRes = await db.query(
                `SELECT COALESCE(SUM(ws.quantity * pv.cost_price), 0)::numeric as total_value,
                        COUNT(DISTINCT ws.variant_id) as variant_count,
                        COALESCE(SUM(ws.quantity), 0)::numeric as total_quantity
                 FROM warehouse_stock ws
                 JOIN product_variants pv ON pv.id = ws.variant_id`
            );
            const byWarehouseRes = await db.query(
                `SELECT w.name as warehouse_name,
                        COALESCE(SUM(ws.quantity), 0)::numeric as total_quantity,
                        COALESCE(SUM(ws.quantity * pv.cost_price), 0)::numeric as stock_value
                 FROM warehouses w
                 LEFT JOIN warehouse_stock ws ON ws.warehouse_id = w.id
                 LEFT JOIN product_variants pv ON pv.id = ws.variant_id
                 GROUP BY w.name
                 ORDER BY stock_value DESC`
            );
            return _sanitize([{
                ...totalRes.rows[0],
                by_warehouse: byWarehouseRes.rows,
            }]);
        }
    },

    // ── 21. getPurchaseSummary ───────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getPurchaseSummary',
            description: 'يرجع ملخص المشتريات من الموردين (إجمالي، عدد فواتير، متوسط) لفترة معينة.',
            parameters: {
                type: 'object',
                properties: {
                    period: { type: 'string', enum: ['today', 'week', 'month', 'quarter', 'year'], description: 'الفترة الزمنية' }
                },
                required: ['period']
            }
        },
        async execute(args, user) {
            const { period } = args;
            let dateFilter;
            if (period === 'today') dateFilter = `DATE(pi.invoice_date) = CURRENT_DATE`;
            else if (period === 'week') dateFilter = `pi.invoice_date >= date_trunc('week', NOW())`;
            else if (period === 'quarter') dateFilter = `pi.invoice_date >= date_trunc('quarter', NOW())`;
            else if (period === 'year') dateFilter = `pi.invoice_date >= date_trunc('year', NOW())`;
            else dateFilter = `pi.invoice_date >= date_trunc('month', NOW())`;

            const result = await db.query(
                `SELECT COALESCE(SUM(pi.grand_total), 0)::numeric as total_purchased,
                        COUNT(*) as invoice_count,
                        COALESCE(AVG(pi.grand_total), 0)::numeric as avg_invoice_value,
                        COALESCE(SUM(pi.paid_amount), 0)::numeric as total_paid,
                        COALESCE(SUM(pi.grand_total - pi.paid_amount), 0)::numeric as total_outstanding
                 FROM purchase_invoices pi
                 WHERE pi.status != 'cancelled' AND ${dateFilter}`
            );
            return _sanitize(result.rows);
        }
    },

    // ── 22. getDeliveryStatus ────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getDeliveryStatus',
            description: 'يرجع حالة سندات التسليم: المعلقة، قيد التوصيل، المكتملة. اختياري فلترة بالحالة.',
            parameters: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: ['pending', 'in_transit', 'delivered', 'cancelled'], description: 'فلتر بالحالة. اختياري.' },
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 20)' }
                }
            }
        },
        async execute(args, user) {
            const { status, limit = 20 } = args;
            let query, params;
            if (status) {
                query = `SELECT dn.id, dn.note_number, dn.status, dn.delivery_date, dn.delivered_at,
                                dn.driver_name, dn.vehicle_number,
                                c.name as client_name, o.order_number
                         FROM delivery_notes dn
                         JOIN clients c ON c.id = dn.client_id
                         LEFT JOIN orders o ON o.id = dn.order_id
                         WHERE dn.status = $1
                         ORDER BY dn.created_at DESC LIMIT $2`;
                params = [status, parseInt(limit) || 20];
            } else {
                query = `SELECT dn.id, dn.note_number, dn.status, dn.delivery_date, dn.delivered_at,
                                dn.driver_name, dn.vehicle_number,
                                c.name as client_name, o.order_number
                         FROM delivery_notes dn
                         JOIN clients c ON c.id = dn.client_id
                         LEFT JOIN orders o ON o.id = dn.order_id
                         ORDER BY dn.created_at DESC LIMIT $1`;
                params = [parseInt(limit) || 20];
            }
            const result = await db.query(query, params);
            return _sanitize(result.rows);
        }
    },

    // ── 23. getVatReport ──────────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getVatReport',
            description: 'يرجع تقرير ضريبة القيمة المضافة (VAT) لفترة معينة: ضريبة المبيعات، ضريبة المشتريات، الصافي.',
            parameters: {
                type: 'object',
                properties: {
                    period: { type: 'string', enum: ['month', 'quarter', 'year'], description: 'الفترة الزمنية (افتراضي: month)' }
                }
            }
        },
        async execute(args, user) {
            const { period = 'month' } = args;
            let dateFilter;
            if (period === 'quarter') dateFilter = `date_trunc('quarter', NOW())`;
            else if (period === 'year') dateFilter = `date_trunc('year', NOW())`;
            else dateFilter = `date_trunc('month', NOW())`;

            const salesVat = await db.query(
                `SELECT COALESCE(SUM(tax_amount), 0)::numeric as output_vat,
                        COALESCE(SUM(grand_total), 0)::numeric as total_sales
                 FROM invoices
                 WHERE status != 'cancelled' AND invoice_date >= ${dateFilter}`
            );
            const purchaseVat = await db.query(
                `SELECT COALESCE(SUM(tax_amount), 0)::numeric as input_vat,
                        COALESCE(SUM(grand_total), 0)::numeric as total_purchases
                 FROM purchase_invoices
                 WHERE status != 'cancelled' AND invoice_date >= ${dateFilter}`
            );
            const outputVat = parseFloat(salesVat.rows[0].output_vat || 0);
            const inputVat = parseFloat(purchaseVat.rows[0].input_vat || 0);
            return _sanitize([{
                period,
                output_vat: outputVat,
                input_vat: inputVat,
                net_vat: outputVat - inputVat,
                total_sales: salesVat.rows[0].total_sales,
                total_purchases: purchaseVat.rows[0].total_purchases,
            }]);
        }
    },

    // ── 24. getOverdueTasks ───────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getOverdueTasks',
            description: 'يرجع المهام المتأخرة (due_date < اليوم ولم تكتمل) أو المهام المعلقة.',
            parameters: {
                type: 'object',
                properties: {
                    overdue_only: { type: 'boolean', description: 'true = المتأخرة فقط، false = كل المعلقة. افتراضي: true' }
                }
            }
        },
        async execute(args, user) {
            const { overdue_only = true } = args;
            let dateFilter = overdue_only
                ? `AND t.due_date < CURRENT_DATE`
                : '';
            const result = await db.query(
                `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date,
                        u.name as assigned_to_name
                 FROM tasks t
                 LEFT JOIN users u ON u.id = t.assigned_to
                 WHERE t.status NOT IN ('completed', 'cancelled') ${dateFilter}
                 ORDER BY t.due_date ASC NULLS LAST
                 LIMIT 30`
            );
            return _sanitize(result.rows);
        }
    },

    // ── 25. getProfitMargin ───────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getProfitMargin',
            description: 'يرجع هامش الربح للمنتجات: الفرق بين سعر البيع والتكلفة، ونسبة الربح.',
            parameters: {
                type: 'object',
                properties: {
                    product_name: { type: 'string', description: 'اسم المنتج أو جزء منه. اختياري — بدون اسم يرجع أعلى الهوامش.' },
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 20)' }
                }
            }
        },
        async execute(args, user) {
            const { product_name, limit = 20 } = args;
            let query, params;
            if (product_name) {
                query = `SELECT p.name as product_name, pv.size_name, pv.selling_price, pv.cost_price,
                                (pv.selling_price - pv.cost_price)::numeric as profit_per_unit,
                                CASE WHEN pv.cost_price > 0
                                     THEN ROUND(((pv.selling_price - pv.cost_price) / pv.cost_price * 100)::numeric, 2)
                                     ELSE 0 END as profit_margin_percent
                         FROM products p
                         JOIN product_variants pv ON pv.product_id = p.id
                         WHERE p.name ILIKE $1 AND pv.status = 'active'
                         ORDER BY profit_margin_percent DESC LIMIT $2`;
                params = [`%${product_name}%`, parseInt(limit) || 20];
            } else {
                query = `SELECT p.name as product_name, pv.size_name, pv.selling_price, pv.cost_price,
                                (pv.selling_price - pv.cost_price)::numeric as profit_per_unit,
                                CASE WHEN pv.cost_price > 0
                                     THEN ROUND(((pv.selling_price - pv.cost_price) / pv.cost_price * 100)::numeric, 2)
                                     ELSE 0 END as profit_margin_percent
                         FROM products p
                         JOIN product_variants pv ON pv.product_id = p.id
                         WHERE pv.status = 'active' AND pv.selling_price > 0 AND pv.cost_price > 0
                         ORDER BY profit_margin_percent DESC LIMIT $1`;
                params = [parseInt(limit) || 20];
            }
            const result = await db.query(query, params);
            return _sanitize(result.rows);
        }
    },

    // ── 26. suggestProductPrice ──────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'suggestProductPrice',
            description: 'يقترح سعر بيع لمنتج بناءً على التكلفة، السعر الحالي، متوسط أسعار البيع السابقة، وهامش الربح.',
            parameters: {
                type: 'object',
                properties: {
                    product_name: { type: 'string', description: 'اسم المنتج أو جزء منه' },
                    target_margin: { type: 'number', description: 'هامش الربح المستهدف بالنسبة المئوية (افتراضي 20%)' }
                },
                required: ['product_name']
            }
        },
        async execute(args, user) {
            const { product_name, target_margin = 20 } = args;
            const variantsRes = await db.query(
                `SELECT p.name as product_name, pv.id as variant_id, pv.size_name,
                        pv.selling_price, pv.cost_price, pv.sku
                 FROM products p
                 JOIN product_variants pv ON pv.product_id = p.id
                 WHERE p.name ILIKE $1 AND pv.status = 'active'
                 LIMIT 10`,
                [`%${product_name}%`]
            );
            if (variantsRes.rows.length === 0) return { error: 'لم يتم العثور على المنتج' };

            const results = [];
            for (const v of variantsRes.rows) {
                const histRes = await db.query(
                    `SELECT AVG(oi.unit_price)::numeric as avg_selling_price,
                            MAX(oi.unit_price)::numeric as max_price,
                            MIN(oi.unit_price)::numeric as min_price,
                            COUNT(*) as times_sold
                     FROM order_items oi
                     JOIN orders o ON o.id = oi.order_id
                     WHERE oi.variant_id = $1 AND o.status NOT IN ('cancelled', 'draft', 'quote')`,
                    [v.variant_id]
                );
                const cost = parseFloat(v.cost_price || 0);
                const currentPrice = parseFloat(v.selling_price || 0);
                const avgHist = parseFloat(histRes.rows[0].avg_selling_price || 0);
                const margin = cost > 0 ? ((currentPrice - cost) / cost * 100) : 0;
                const suggestedPrice = cost > 0 ? (cost * (1 + target_margin / 100)) : currentPrice;

                results.push({
                    product_name: v.product_name,
                    size_name: v.size_name,
                    sku: v.sku,
                    cost_price: cost,
                    current_selling_price: currentPrice,
                    current_margin_percent: Math.round(margin * 100) / 100,
                    avg_historical_price: avgHist,
                    min_historical_price: parseFloat(histRes.rows[0].min_price || 0),
                    max_historical_price: parseFloat(histRes.rows[0].max_price || 0),
                    times_sold: parseInt(histRes.rows[0].times_sold || 0),
                    suggested_price: Math.round(suggestedPrice * 100) / 100,
                    target_margin_percent: target_margin,
                });
            }
            return _sanitize(results);
        }
    },

    // ── 27. getStockoutForecast ───────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getStockoutForecast',
            description: 'يتوقع متى سينفد المخزون لكل صنف بناءً على معدل البيع في آخر 90 يوم.',
            parameters: {
                type: 'object',
                properties: {
                    product_name: { type: 'string', description: 'اسم المنتج أو جزء منه. اختياري — بدون اسم يرجع كل الأصناف.' },
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 20)' }
                }
            }
        },
        async execute(args, user) {
            const { product_name, limit = 20 } = args;
            let query, params;
            if (product_name) {
                query = `WITH sales_velocity AS (
                             SELECT oi.variant_id,
                                    SUM(oi.quantity) as total_sold,
                                    COUNT(DISTINCT DATE(o.created_at)) as selling_days
                             FROM order_items oi
                             JOIN orders o ON o.id = oi.order_id
                             WHERE o.status NOT IN ('cancelled', 'draft', 'quote')
                               AND o.created_at >= NOW() - INTERVAL '90 days'
                             GROUP BY oi.variant_id
                         )
                         SELECT p.name as product_name, pv.size_name, pv.sku,
                                COALESCE(ws.qty, 0) as current_stock,
                                COALESCE(sv.total_sold, 0) as total_sold_90d,
                                COALESCE(sv.selling_days, 0) as selling_days,
                                CASE WHEN COALESCE(sv.total_sold, 0) > 0 AND COALESCE(sv.selling_days, 0) > 0
                                     THEN ROUND((COALESCE(ws.qty, 0)::numeric / (sv.total_sold / sv.selling_days))::numeric, 1)
                                     ELSE NULL END as days_until_stockout,
                                CASE WHEN COALESCE(sv.total_sold, 0) > 0 AND COALESCE(sv.selling_days, 0) > 0
                                     THEN (NOW() + (COALESCE(ws.qty, 0)::numeric / (sv.total_sold / sv.selling_days)) * INTERVAL '1 day')::date
                                     ELSE NULL END as estimated_stockout_date
                         FROM product_variants pv
                         JOIN products p ON p.id = pv.product_id
                         LEFT JOIN (SELECT variant_id, SUM(quantity) as qty FROM warehouse_stock GROUP BY variant_id) ws ON ws.variant_id = pv.id
                         LEFT JOIN sales_velocity sv ON sv.variant_id = pv.id
                         WHERE pv.status = 'active' AND p.name ILIKE $1
                           AND COALESCE(ws.qty, 0) > 0
                         ORDER BY days_until_stockout ASC NULLS LAST
                         LIMIT $2`;
                params = [`%${product_name}%`, parseInt(limit) || 20];
            } else {
                query = `WITH sales_velocity AS (
                             SELECT oi.variant_id,
                                    SUM(oi.quantity) as total_sold,
                                    COUNT(DISTINCT DATE(o.created_at)) as selling_days
                             FROM order_items oi
                             JOIN orders o ON o.id = oi.order_id
                             WHERE o.status NOT IN ('cancelled', 'draft', 'quote')
                               AND o.created_at >= NOW() - INTERVAL '90 days'
                             GROUP BY oi.variant_id
                         )
                         SELECT p.name as product_name, pv.size_name, pv.sku,
                                COALESCE(ws.qty, 0) as current_stock,
                                COALESCE(sv.total_sold, 0) as total_sold_90d,
                                COALESCE(sv.selling_days, 0) as selling_days,
                                CASE WHEN COALESCE(sv.total_sold, 0) > 0 AND COALESCE(sv.selling_days, 0) > 0
                                     THEN ROUND((COALESCE(ws.qty, 0)::numeric / (sv.total_sold / sv.selling_days))::numeric, 1)
                                     ELSE NULL END as days_until_stockout,
                                CASE WHEN COALESCE(sv.total_sold, 0) > 0 AND COALESCE(sv.selling_days, 0) > 0
                                     THEN (NOW() + (COALESCE(ws.qty, 0)::numeric / (sv.total_sold / sv.selling_days)) * INTERVAL '1 day')::date
                                     ELSE NULL END as estimated_stockout_date
                         FROM product_variants pv
                         JOIN products p ON p.id = pv.product_id
                         LEFT JOIN (SELECT variant_id, SUM(quantity) as qty FROM warehouse_stock GROUP BY variant_id) ws ON ws.variant_id = pv.id
                         LEFT JOIN sales_velocity sv ON sv.variant_id = pv.id
                         WHERE pv.status = 'active' AND COALESCE(ws.qty, 0) > 0
                         ORDER BY days_until_stockout ASC NULLS LAST
                         LIMIT $1`;
                params = [parseInt(limit) || 20];
            }
            const result = await db.query(query, params);
            return _sanitize(result.rows);
        }
    },

    // ── 28. getSalesForecast ──────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getSalesForecast',
            description: 'يتوقع مبيعات الشهر القادم بناءً على اتجاه البيع في آخر 6 أشهر.',
            parameters: {
                type: 'object',
                properties: {}
            }
        },
        async execute(args, user) {
            // Get monthly sales for last 6 months
            const monthlyRes = await db.query(
                `SELECT DATE_TRUNC('month', o.created_at) as month,
                        COALESCE(SUM(o.grand_total), 0)::numeric as total,
                        COUNT(DISTINCT o.id) as order_count
                 FROM orders o
                 WHERE o.status NOT IN ('cancelled', 'draft', 'quote')
                   AND o.created_at >= NOW() - INTERVAL '6 months'
                 GROUP BY DATE_TRUNC('month', o.created_at)
                 ORDER BY month ASC`
            );

            if (monthlyRes.rows.length < 2) {
                return _sanitize([{ message: 'لا توجد بيانات كافية للتوقع (مطلوب شهرين على الأقل)' }]);
            }

            // Simple linear regression: y = a + b*x
            const n = monthlyRes.rows.length;
            const xs = monthlyRes.rows.map((_, i) => i);
            const ys = monthlyRes.rows.map(r => parseFloat(r.total || 0));
            const sumX = xs.reduce((a, b) => a + b, 0);
            const sumY = ys.reduce((a, b) => a + b, 0);
            const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
            const sumX2 = xs.reduce((acc, x) => acc + x * x, 0);
            const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
            const intercept = (sumY - slope * sumX) / n;
            const forecast = intercept + slope * n; // Next month (index n)
            const avgOrders = monthlyRes.rows.reduce((acc, r) => acc + parseInt(r.order_count), 0) / n;

            return _sanitize([{
                forecast_month: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().split('T')[0],
                forecasted_sales: Math.round(forecast * 100) / 100,
                forecasted_order_count: Math.round(avgOrders),
                trend: slope > 0 ? 'تصاعدي' : slope < 0 ? 'تنازلي' : 'مستقر',
                trend_slope: Math.round(slope * 100) / 100,
                historical_months: monthlyRes.rows.map(r => ({
                    month: r.month.toISOString().split('T')[0],
                    total: parseFloat(r.total),
                    order_count: parseInt(r.order_count),
                })),
            }]);
        }
    },

    // ── 29. getChurnRiskClients ───────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getChurnRiskClients',
            description: 'يحدد العملاء المعرضين لخطر التوقف عن التعامل بناءً على انخفاض معدل الطلبات.',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 15)' }
                }
            }
        },
        async execute(args, user) {
            const { limit = 15 } = args;
            const result = await db.query(
                `WITH client_activity AS (
                     SELECT c.id, c.name,
                            COUNT(DISTINCT o.id) as total_orders,
                            MAX(o.created_at) as last_order_date,
                            COUNT(DISTINCT CASE WHEN o.created_at >= NOW() - INTERVAL '30 days' THEN o.id END) as orders_last_30d,
                            COUNT(DISTINCT CASE WHEN o.created_at >= NOW() - INTERVAL '60 days' AND o.created_at < NOW() - INTERVAL '30 days' THEN o.id END) as orders_prev_30d,
                            COALESCE(SUM(o.grand_total), 0)::numeric as total_revenue
                     FROM clients c
                     LEFT JOIN orders o ON o.client_id = c.id AND o.status NOT IN ('cancelled', 'draft')
                     WHERE c.status = 'active'
                     GROUP BY c.id, c.name
                 )
                 SELECT name,
                        total_orders,
                        total_revenue,
                        last_order_date,
                        orders_last_30d,
                        orders_prev_30d,
                        CASE
                            WHEN last_order_date IS NULL THEN 'خطر عالي - لا توجد طلبات'
                            WHEN last_order_date < NOW() - INTERVAL '90 days' THEN 'خطر عالي - آخر طلب قبل 90 يوم'
                            WHEN last_order_date < NOW() - INTERVAL '60 days' THEN 'خطر متوسط - آخر طلب قبل 60 يوم'
                            WHEN orders_last_30d = 0 AND orders_prev_30d > 0 THEN 'خطر متوسط - توقف مفاجئ'
                            WHEN orders_last_30d < orders_prev_30d THEN 'خطر منخفض - انخفاض في الطلبات'
                            ELSE 'طبيعي'
                        END as risk_level,
                        EXTRACT(DAY FROM NOW() - last_order_date)::int as days_since_last_order
                 FROM client_activity
                 WHERE total_orders > 0
                 ORDER BY
                     CASE
                         WHEN last_order_date IS NULL THEN 1
                         WHEN last_order_date < NOW() - INTERVAL '90 days' THEN 2
                         WHEN last_order_date < NOW() - INTERVAL '60 days' THEN 3
                         WHEN orders_last_30d = 0 AND orders_prev_30d > 0 THEN 4
                         ELSE 5
                     END,
                     days_since_last_order DESC NULLS FIRST
                 LIMIT $1`,
                [parseInt(limit) || 15]
            );
            return _sanitize(result.rows);
        }
    },

    // ── 30. getReorderSuggestions ─────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getReorderSuggestions',
            description: 'يقترح أصناف تحتاج إعادة طلب بناءً على المخزون الحالي ومعدل البيع، مع اقتراح المورد الأرخص.',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 20)' }
                }
            }
        },
        async execute(args, user) {
            const { limit = 20 } = args;
            const result = await db.query(
                `WITH sales_velocity AS (
                     SELECT oi.variant_id,
                            SUM(oi.quantity) as total_sold_90d
                     FROM order_items oi
                     JOIN orders o ON o.id = oi.order_id
                     WHERE o.status NOT IN ('cancelled', 'draft', 'quote')
                       AND o.created_at >= NOW() - INTERVAL '90 days'
                     GROUP BY oi.variant_id
                 )
                 SELECT p.name as product_name, pv.size_name, pv.sku,
                        COALESCE(ws.qty, 0) as current_stock,
                        COALESCE(sv.total_sold_90d, 0) as monthly_demand_estimate,
                        CASE WHEN COALESCE(sv.total_sold_90d, 0) > 0
                             THEN CEIL(COALESCE(sv.total_sold_90d, 0) / 3.0)
                             ELSE 0 END as suggested_reorder_qty,
                        CASE WHEN COALESCE(ws.qty, 0) < COALESCE(pv.min_stock_level, 0) THEN true ELSE false END as needs_reorder,
                        (SELECT s.company_name FROM suppliers s
                         JOIN purchase_invoices pi ON pi.supplier_id = s.id
                         JOIN purchase_invoice_items pii ON pii.purchase_invoice_id = pi.id
                         WHERE pii.variant_id = pv.id AND pi.status != 'cancelled'
                         ORDER BY pii.unit_cost ASC LIMIT 1) as cheapest_supplier,
                        (SELECT pii.unit_cost FROM purchase_invoice_items pii
                         JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
                         WHERE pii.variant_id = pv.id AND pi.status != 'cancelled'
                         ORDER BY pii.unit_cost ASC LIMIT 1) as cheapest_supplier_price
                 FROM product_variants pv
                 JOIN products p ON p.id = pv.product_id
                 LEFT JOIN (SELECT variant_id, SUM(quantity) as qty FROM warehouse_stock GROUP BY variant_id) ws ON ws.variant_id = pv.id
                 LEFT JOIN sales_velocity sv ON sv.variant_id = pv.id
                 WHERE pv.status = 'active' AND COALESCE(ws.qty, 0) < 200
                 ORDER BY needs_reorder DESC, current_stock ASC
                 LIMIT $1`,
                [parseInt(limit) || 20]
            );
            return _sanitize(result.rows);
        }
    },

    // ── 17. globalSearch ─────────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'globalSearch',
            description: 'بحث شامل عبر العملاء، المنتجات، الطلبات، الفواتير، والموردين. يرجع نتائج مصنفة مع روابط تنقل.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'نص البحث (اسم، رقم، SKU)' },
                    limit: { type: 'number', description: 'أقصى عدد نتائج لكل فئة (افتراضي 5)' }
                },
                required: ['query']
            }
        },
        async execute(args, user) {
            const { query, limit } = args;
            const maxResults = parseInt(limit) || 5;
            const searchTerm = `%${query}%`;
            const results = { query, categories: {} };

            // Clients
            try {
                const clientsRes = await db.query(
                    `SELECT id, name, phone, email, status
                     FROM clients
                     WHERE name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1
                     ORDER BY name
                     LIMIT $2`,
                    [searchTerm, maxResults]
                );
                if (clientsRes.rows.length > 0) {
                    results.categories.clients = clientsRes.rows.map(r => ({
                        id: r.id, name: r.name, phone: r.phone, status: r.status,
                        page: 'clients', entity_type: 'client'
                    }));
                }
            } catch { /* ignore */ }

            // Products
            try {
                const productsRes = await db.query(
                    `SELECT p.id, p.name, cat.name as category, pv.sku, pv.selling_price
                     FROM products p
                     LEFT JOIN categories cat ON cat.id = p.category_id
                     LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.status = 'active'
                     WHERE p.name ILIKE $1 OR pv.sku ILIKE $1
                     ORDER BY p.name
                     LIMIT $2`,
                    [searchTerm, maxResults]
                );
                if (productsRes.rows.length > 0) {
                    results.categories.products = productsRes.rows.map(r => ({
                        id: r.id, name: r.name, category: r.category, sku: r.sku,
                        selling_price: r.selling_price,
                        page: 'products', entity_type: 'product'
                    }));
                }
            } catch { /* ignore */ }

            // Orders
            try {
                const ordersRes = await db.query(
                    `SELECT o.id, o.order_number, o.status, o.grand_total,
                            c.name as client_name
                     FROM orders o
                     LEFT JOIN clients c ON c.id = o.client_id
                     WHERE o.order_number::text ILIKE $1 OR c.name ILIKE $1
                     ORDER BY o.created_at DESC
                     LIMIT $2`,
                    [searchTerm, maxResults]
                );
                if (ordersRes.rows.length > 0) {
                    results.categories.orders = ordersRes.rows.map(r => ({
                        id: r.id, order_number: r.order_number, status: r.status,
                        grand_total: r.grand_total, client_name: r.client_name,
                        page: 'quotations', entity_type: 'order'
                    }));
                }
            } catch { /* ignore */ }

            // Invoices
            try {
                const invoicesRes = await db.query(
                    `SELECT i.id, i.invoice_number, i.status, i.grand_total,
                            c.name as client_name, i.invoice_date
                     FROM invoices i
                     LEFT JOIN clients c ON c.id = i.client_id
                     WHERE i.invoice_number::text ILIKE $1 OR c.name ILIKE $1
                     ORDER BY i.invoice_date DESC
                     LIMIT $2`,
                    [searchTerm, maxResults]
                );
                if (invoicesRes.rows.length > 0) {
                    results.categories.invoices = invoicesRes.rows.map(r => ({
                        id: r.id, invoice_number: r.invoice_number, status: r.status,
                        grand_total: r.grand_total, client_name: r.client_name,
                        invoice_date: r.invoice_date,
                        page: 'sales-invoices', entity_type: 'invoice'
                    }));
                }
            } catch { /* ignore */ }

            // Suppliers
            try {
                const suppliersRes = await db.query(
                    `SELECT id, company_name, phone, email, supplier_type
                     FROM suppliers
                     WHERE company_name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1
                     ORDER BY company_name
                     LIMIT $2`,
                    [searchTerm, maxResults]
                );
                if (suppliersRes.rows.length > 0) {
                    results.categories.suppliers = suppliersRes.rows.map(r => ({
                        id: r.id, name: r.company_name, phone: r.phone, type: r.supplier_type,
                        page: 'suppliers', entity_type: 'supplier'
                    }));
                }
            } catch { /* ignore */ }

            // Summary
            const totalResults = Object.values(results.categories).reduce((sum, arr) => sum + arr.length, 0);
            results.total = totalResults;
            results.found = totalResults > 0;

            return results;
        }
    },

    // ── 35. getOrderDetails ──────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getOrderDetails',
            description: 'يرجع تفاصيل طلب أو عرض سعر كامل: بيانات الطلب، الأصناف (الاسم، الكمية، السعر، الإجمالي)، والعميل. ابحث برقم الطلب أو اسم العميل.',
            parameters: {
                type: 'object',
                properties: {
                    order_number: { type: 'number', description: 'رقم الطلب' },
                    client_name: { type: 'string', description: 'اسم العميل أو جزء منه (بديل عن رقم الطلب)' }
                }
            }
        },
        async execute(args, user) {
            const { order_number, client_name } = args;
            let orderRes;

            if (order_number) {
                orderRes = await db.query(
                    `SELECT o.id, o.order_number, o.status, o.pricing_status,
                            o.created_at, o.grand_total, o.subtotal, o.tax_amount,
                            o.tax_rate, o.paid_amount, o.payment_method,
                            o.internal_notes, o.client_notes,
                            c.name as client_name, c.phone as client_phone
                     FROM orders o
                     JOIN clients c ON c.id = o.client_id
                     WHERE o.order_number = $1`,
                    [parseInt(order_number)]
                );
            } else if (client_name) {
                orderRes = await db.query(
                    `SELECT o.id, o.order_number, o.status, o.pricing_status,
                            o.created_at, o.grand_total, o.subtotal, o.tax_amount,
                            o.tax_rate, o.paid_amount, o.payment_method,
                            o.internal_notes, o.client_notes,
                            c.name as client_name, c.phone as client_phone
                     FROM orders o
                     JOIN clients c ON c.id = o.client_id
                     WHERE c.name ILIKE $1
                     ORDER BY o.created_at DESC
                     LIMIT 1`,
                    [`%${client_name}%`]
                );
            } else {
                return { error: 'حدد رقم الطلب أو اسم العميل' };
            }

            if (orderRes.rows.length === 0) {
                return { error: 'لم يتم العثور على الطلب' };
            }

            const order = orderRes.rows[0];

            const itemsRes = await db.query(
                `SELECT oi.id, oi.variant_id,
                        p.name as product_name,
                        pv.size_name, pv.sku,
                        oi.quantity, oi.unit_price,
                        oi.discount_percent,
                        oi.line_total
                 FROM order_items oi
                 LEFT JOIN product_variants pv ON pv.id = oi.variant_id
                 LEFT JOIN products p ON p.id = pv.product_id
                 WHERE oi.order_id = $1
                 ORDER BY oi.id`,
                [order.id]
            );

            order.items = itemsRes.rows;
            order.item_count = itemsRes.rows.length;

            return _sanitize(order);
        }
    },

    // ── 31. getProductMovements ──────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getProductMovements',
            description: 'يرجع حركات مخزون صنف معين (استلام، صرف، مرتجع) مع الكميات والتواريخ.',
            parameters: {
                type: 'object',
                properties: {
                    product_name: { type: 'string', description: 'اسم المنتج أو جزء منه' },
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 20)' }
                },
                required: ['product_name']
            }
        },
        async execute(args, user) {
            const { product_name, limit = 20 } = args;
            const result = await db.query(
                `SELECT it.id, it.transaction_type, it.quantity, it.created_at,
                        it.notes, it.reference_type,
                        pv.sku, p.name as product_name, pv.size_name,
                        c.name as client_name, s.company_name as supplier_name,
                        w.name as warehouse_name
                 FROM inventory_transactions it
                 JOIN product_variants pv ON pv.id = it.variant_id
                 JOIN products p ON p.id = pv.product_id
                 LEFT JOIN warehouse_stock ws ON ws.id = it.stock_id
                 LEFT JOIN warehouses w ON w.id = ws.warehouse_id
                 LEFT JOIN clients c ON c.id = it.client_id
                 LEFT JOIN suppliers s ON s.id = it.supplier_id
                 WHERE p.name ILIKE $1
                 ORDER BY it.created_at DESC
                 LIMIT $2`,
                [`%${product_name}%`, parseInt(limit) || 20]
            );
            return _sanitize(result.rows);
        }
    },

    // ── 32. getClientDeliveries ──────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getClientDeliveries',
            description: 'يرجع سندات التسليم لعميل معين مع الحالة والكميات المسلمة.',
            parameters: {
                type: 'object',
                properties: {
                    client_name: { type: 'string', description: 'اسم العميل أو جزء منه' },
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 10)' }
                },
                required: ['client_name']
            }
        },
        async execute(args, user) {
            const { client_name, limit = 10 } = args;
            const result = await db.query(
                `SELECT dn.id, dn.note_number, dn.status, dn.delivery_date, dn.delivered_at,
                        dn.driver_name, dn.vehicle_number,
                        o.order_number,
                        c.name as client_name,
                        COUNT(dni.id) as item_count,
                        COALESCE(SUM(dni.delivered_qty), 0) as total_delivered
                 FROM delivery_notes dn
                 JOIN clients c ON c.id = dn.client_id
                 LEFT JOIN orders o ON o.id = dn.order_id
                 LEFT JOIN delivery_note_items dni ON dni.delivery_note_id = dn.id
                 WHERE c.name ILIKE $1
                 GROUP BY dn.id, o.order_number, c.name
                 ORDER BY dn.created_at DESC
                 LIMIT $2`,
                [`%${client_name}%`, parseInt(limit) || 10]
            );
            return _sanitize(result.rows);
        }
    },

    // ── 33. getAccountingSummary ─────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getAccountingSummary',
            description: 'يرجع ملخص محاسبي: إجمالي المبيعات، المشتريات، المصروفات، والصافي.',
            parameters: {
                type: 'object',
                properties: {
                    period: { type: 'string', enum: ['month', 'quarter', 'year'], description: 'الفترة الزمنية (افتراضي: month)' }
                }
            }
        },
        async execute(args, user) {
            const { period = 'month' } = args;
            let dateFilter;
            if (period === 'quarter') dateFilter = `date_trunc('quarter', NOW())`;
            else if (period === 'year') dateFilter = `date_trunc('year', NOW())`;
            else dateFilter = `date_trunc('month', NOW())`;

            const salesRes = await db.query(
                `SELECT COALESCE(SUM(grand_total), 0)::numeric as total_sales,
                        COUNT(*) as invoice_count
                 FROM invoices WHERE status != 'cancelled' AND invoice_date >= ${dateFilter}`
            );
            const purchaseRes = await db.query(
                `SELECT COALESCE(SUM(grand_total), 0)::numeric as total_purchases,
                        COUNT(*) as invoice_count
                 FROM purchase_invoices WHERE status != 'cancelled' AND invoice_date >= ${dateFilter}`
            );
            const vatRes = await db.query(
                `SELECT
                    (SELECT COALESCE(SUM(tax_amount), 0)::numeric FROM invoices WHERE status != 'cancelled' AND invoice_date >= ${dateFilter}) as output_vat,
                    (SELECT COALESCE(SUM(tax_amount), 0)::numeric FROM purchase_invoices WHERE status != 'cancelled' AND invoice_date >= ${dateFilter}) as input_vat`
            );
            const outstandingRes = await db.query(
                `SELECT
                    (SELECT COALESCE(SUM(i.grand_total - COALESCE((SELECT SUM(ct.amount) FROM client_transactions ct WHERE ct.invoice_id = i.id AND ct.type = 'payment'), 0)), 0)::numeric FROM invoices i WHERE i.status != 'cancelled') as receivable,
                    (SELECT COALESCE(SUM(grand_total - paid_amount), 0)::numeric FROM purchase_invoices WHERE status != 'cancelled') as payable`
            );

            return _sanitize([{
                period,
                total_sales: salesRes.rows[0].total_sales,
                sales_invoice_count: parseInt(salesRes.rows[0].invoice_count),
                total_purchases: purchaseRes.rows[0].total_purchases,
                purchase_invoice_count: parseInt(purchaseRes.rows[0].invoice_count),
                output_vat: vatRes.rows[0].output_vat,
                input_vat: vatRes.rows[0].input_vat,
                net_vat: parseFloat(vatRes.rows[0].output_vat || 0) - parseFloat(vatRes.rows[0].input_vat || 0),
                total_receivable: outstandingRes.rows[0].receivable,
                total_payable: outstandingRes.rows[0].payable,
            }]);
        }
    },

    // ── 34. getManufacturerOrders ────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getManufacturerOrders',
            description: 'يرجع أوامر التصنيع مع الحالة والعميل والمنتجات.',
            parameters: {
                type: 'object',
                properties: {
                    status: { type: 'string', description: 'فلتر بالحالة (pending, in_progress, completed). اختياري.' },
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 20)' }
                }
            }
        },
        async execute(args, user) {
            const { status, limit = 20 } = args;
            let query, params;
            if (status) {
                query = `SELECT mo.id, mo.mo_number, mo.status, mo.created_at, mo.updated_at,
                                o.order_number, c.name as client_name,
                                COUNT(moi.id) as item_count
                         FROM manufacturer_orders mo
                         JOIN orders o ON o.id = mo.order_id
                         JOIN clients c ON c.id = o.client_id
                         LEFT JOIN manufacturer_order_items moi ON moi.manufacturer_order_id = mo.id
                         WHERE mo.status = $1
                         GROUP BY mo.id, o.order_number, c.name
                         ORDER BY mo.created_at DESC LIMIT $2`;
                params = [status, parseInt(limit) || 20];
            } else {
                query = `SELECT mo.id, mo.mo_number, mo.status, mo.created_at, mo.updated_at,
                                o.order_number, c.name as client_name,
                                COUNT(moi.id) as item_count
                         FROM manufacturer_orders mo
                         JOIN orders o ON o.id = mo.order_id
                         JOIN clients c ON c.id = o.client_id
                         LEFT JOIN manufacturer_order_items moi ON moi.manufacturer_order_id = mo.id
                         GROUP BY mo.id, o.order_number, c.name
                         ORDER BY mo.created_at DESC LIMIT $1`;
                params = [parseInt(limit) || 20];
            }
            const result = await db.query(query, params);
            return _sanitize(result.rows);
        }
    },

    // ── 35. getClientProfile ─────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getClientProfile',
            description: 'يرجع ملف شامل للعميل: البيانات الأساسية، الفروع التابعة، إجمالي الطلبات، الرصيد، آخر طلب، آخر تسليم.',
            parameters: {
                type: 'object',
                properties: {
                    client_name: { type: 'string', description: 'اسم العميل أو جزء منه' }
                },
                required: ['client_name']
            }
        },
        async execute(args, user) {
            const { client_name } = args;
            const clientRes = await db.query(
                `SELECT id, name, phone, email, address, tax_number, payment_terms,
                        credit_limit, status, parent_id, created_at
                 FROM clients WHERE name ILIKE $1 LIMIT 1`,
                [`%${client_name}%`]
            );
            if (clientRes.rows.length === 0) return { error: 'لم يتم العثور على العميل' };
            const client = clientRes.rows[0];

            // Get branches if parent
            const branchesRes = await db.query(
                `SELECT id, name, phone, status FROM clients WHERE parent_id = $1`,
                [client.id]
            );

            // Get order summary
            const ordersRes = await db.query(
                `SELECT COUNT(*) as total_orders,
                        COALESCE(SUM(grand_total), 0)::numeric as total_value,
                        COALESCE(SUM(paid_amount), 0)::numeric as total_paid,
                        MAX(created_at) as last_order_date
                 FROM orders WHERE client_id = $1 AND status NOT IN ('cancelled', 'draft')`,
                [client.id]
            );

            // Get last delivery
            const deliveryRes = await db.query(
                `SELECT dn.note_number, dn.status, dn.delivery_date
                 FROM delivery_notes dn WHERE dn.client_id = $1
                 ORDER BY dn.created_at DESC LIMIT 3`,
                [client.id]
            );

            return _sanitize([{
                ...client,
                branches: branchesRes.rows,
                order_summary: ordersRes.rows[0],
                recent_deliveries: deliveryRes.rows,
            }]);
        }
    },

    // ── 36. getSmartQuoteSuggestions ─────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getSmartQuoteSuggestions',
            description: 'تحليل ذكي لاقتراح أسعار عرض سعر: يجيب تكلفة المنتج، آخر سعر بيع للعميل، متوسط الأسعار التاريخية، ويقترح سعر بهامش ربح معقول.',
            parameters: {
                type: 'object',
                properties: {
                    client_name: { type: 'string', description: 'اسم العميل' },
                    product_name: { type: 'string', description: 'اسم المنتج' },
                    quantity: { type: 'number', description: 'الكمية المطلوبة (اختياري)' }
                },
                required: ['client_name', 'product_name']
            }
        },
        async execute(args, user) {
            const { client_name, product_name, quantity } = args;

            // 1. Get product variant + cost
            const variantRes = await db.query(
                `SELECT pv.id, pv.sku, pv.size_name, pv.selling_price, pv.cost_price,
                        p.name as product_name
                 FROM product_variants pv
                 JOIN products p ON p.id = pv.product_id
                 WHERE p.name ILIKE $1 AND pv.status = 'active'
                 LIMIT 5`,
                [`%${product_name}%`]
            );
            if (variantRes.rows.length === 0) return { error: 'لم يتم العثور على المنتج' };

            const results = [];
            for (const v of variantRes.rows) {
                const cost = parseFloat(v.cost_price || 0);
                const currentPrice = parseFloat(v.selling_price || 0);

                // 2. What did THIS client pay before?
                const clientHistRes = await db.query(
                    `SELECT oi.unit_price, oi.quantity, o.order_number, o.created_at
                     FROM order_items oi
                     JOIN orders o ON o.id = oi.order_id
                     JOIN clients c ON c.id = o.client_id
                     WHERE oi.variant_id = $1 AND c.name ILIKE $2
                       AND o.status NOT IN ('cancelled', 'draft')
                     ORDER BY o.created_at DESC LIMIT 5`,
                    [v.id, `%${client_name}%`]
                );
                const clientPrices = clientHistRes.rows.map(r => parseFloat(r.unit_price));
                const lastClientPrice = clientPrices.length > 0 ? clientPrices[0] : null;
                const avgClientPrice = clientPrices.length > 0
                    ? clientPrices.reduce((a, b) => a + b, 0) / clientPrices.length
                    : null;

                // 3. What did ALL clients pay (market average)?
                const marketHistRes = await db.query(
                    `SELECT AVG(oi.unit_price)::numeric as avg_price,
                            MAX(oi.unit_price)::numeric as max_price,
                            MIN(oi.unit_price)::numeric as min_price,
                            COUNT(*) as times_sold
                     FROM order_items oi
                     JOIN orders o ON o.id = oi.order_id
                     WHERE oi.variant_id = $1 AND o.status NOT IN ('cancelled', 'draft', 'quote')`,
                    [v.id]
                );
                const avgMarketPrice = parseFloat(marketHistRes.rows[0].avg_price || 0);
                const minMarketPrice = parseFloat(marketHistRes.rows[0].min_price || 0);
                const maxMarketPrice = parseFloat(marketHistRes.rows[0].max_price || 0);

                // 4. Calculate suggested price
                // Base: cost + 20% margin (default)
                // If client has history, lean towards their previous price
                // If market avg is higher, can go up
                let suggestedPrice;
                let reasoning;

                if (lastClientPrice) {
                    // Client has history — keep similar price, small increase
                    suggestedPrice = lastClientPrice * 1.03; // 3% increase
                    reasoning = `العميل اشترى قبل بسعر ${lastClientPrice} ريال. اقتراح زيادة 3% للحفاظ على العلاقة.`;
                } else if (avgMarketPrice > 0) {
                    // No client history but market data exists
                    suggestedPrice = Math.min(avgMarketPrice, cost * 1.25);
                    reasoning = `لا يوجد سجل سابق للعميل. متوسط سعر السوق ${avgMarketPrice.toFixed(2)} ريال. التكلفة ${cost} ريال.`;
                } else {
                    // No data — use cost + 20%
                    suggestedPrice = cost * 1.20;
                    reasoning = `لا توجد بيانات سابقة. التكلفة ${cost} ريال، هامش مقترح 20%.`;
                }

                // Volume discount: if quantity > 10000, reduce 5%
                if (quantity && quantity >= 10000) {
                    suggestedPrice = suggestedPrice * 0.95;
                    reasoning += ` خصم 5% للكمية الكبيرة (${quantity}).`;
                } else if (quantity && quantity >= 50000) {
                    suggestedPrice = suggestedPrice * 0.90;
                    reasoning += ` خصم 10% للكمية الكبيرة جداً (${quantity}).`;
                }

                const marginPercent = cost > 0
                    ? Math.round(((suggestedPrice - cost) / cost * 100) * 100) / 100
                    : 0;

                results.push({
                    product_name: v.product_name,
                    size_name: v.size_name,
                    sku: v.sku,
                    cost_price: cost,
                    current_selling_price: currentPrice,
                    last_client_price: lastClientPrice,
                    avg_client_price: avgClientPrice ? Math.round(avgClientPrice * 100) / 100 : null,
                    avg_market_price: avgMarketPrice > 0 ? Math.round(avgMarketPrice * 100) / 100 : null,
                    min_market_price: minMarketPrice > 0 ? minMarketPrice : null,
                    max_market_price: maxMarketPrice > 0 ? maxMarketPrice : null,
                    times_sold_market: parseInt(marketHistRes.rows[0].times_sold || 0),
                    suggested_price: Math.round(suggestedPrice * 100) / 100,
                    margin_percent: marginPercent,
                    reasoning: reasoning,
                    client_history_count: clientPrices.length,
                    _explanation: {
                        why: `اقترحت هذا السعر بناءً على: التكلفة ${cost} ريال، آخر سعر للعميل ${lastClientPrice || 'غير متوفر'}، متوسط السوق ${avgMarketPrice > 0 ? Math.round(avgMarketPrice * 100) / 100 : 'غير متوفر'} ريال. الهامش المتوقع ${marginPercent}%.`,
                        confidence: clientPrices.length > 3 && avgMarketPrice > 0 ? 85 : (clientPrices.length > 0 ? 60 : 40),
                        factors: [
                            { factor: 'التكلفة', value: cost, weight: 'high' },
                            { factor: 'آخر سعر للعميل', value: lastClientPrice, weight: clientPrices.length > 0 ? 'high' : 'low' },
                            { factor: 'متوسط السوق', value: avgMarketPrice > 0 ? Math.round(avgMarketPrice * 100) / 100 : null, weight: avgMarketPrice > 0 ? 'medium' : 'low' },
                            { factor: 'هامش الربح', value: marginPercent + '%', weight: 'high' },
                        ],
                    },
                });
            }
            return _sanitize(results);
        }
    },

    // ── 37. getNegotiationRoom ───────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getNegotiationRoom',
            description: 'يحسب أدنى سعر مقبول لمنتج مع هامش ربح محدد. استخدمه عندما يقول المستخدم "السعر غالي" أو يريد التفاوض.',
            parameters: {
                type: 'object',
                properties: {
                    product_name: { type: 'string', description: 'اسم المنتج' },
                    current_price: { type: 'number', description: 'السعر الحالي المقترح' },
                    target_margin: { type: 'number', description: 'هامش الربح الأدنى المقبول (افتراضي 10%)' }
                },
                required: ['product_name', 'current_price']
            }
        },
        async execute(args, user) {
            const { product_name, current_price, target_margin = 10 } = args;

            const variantRes = await db.query(
                `SELECT pv.id, pv.sku, pv.size_name, pv.cost_price, pv.selling_price,
                        p.name as product_name
                 FROM product_variants pv
                 JOIN products p ON p.id = pv.product_id
                 WHERE p.name ILIKE $1 AND pv.status = 'active'
                 LIMIT 5`,
                [`%${product_name}%`]
            );
            if (variantRes.rows.length === 0) return { error: 'لم يتم العثور على المنتج' };

            const results = [];
            for (const v of variantRes.rows) {
                const cost = parseFloat(v.cost_price || 0);
                const current = parseFloat(current_price);
                const currentMargin = cost > 0 ? ((current - cost) / cost * 100) : 0;

                // Minimum acceptable price = cost + target_margin%
                const minAcceptablePrice = cost * (1 + target_margin / 100);

                // How much room to negotiate?
                const negotiationRoom = current - minAcceptablePrice;
                const canReduce = negotiationRoom > 0;

                // Suggest 3 price tiers
                const tier1 = current; // Current
                const tier2 = (current + minAcceptablePrice) / 2; // Midpoint
                const tier3 = minAcceptablePrice; // Floor

                results.push({
                    product_name: v.product_name,
                    size_name: v.size_name,
                    sku: v.sku,
                    cost_price: cost,
                    current_price: current,
                    current_margin_percent: Math.round(currentMargin * 100) / 100,
                    min_acceptable_price: Math.round(minAcceptablePrice * 100) / 100,
                    min_margin_percent: target_margin,
                    can_reduce: canReduce,
                    negotiation_room: Math.round(negotiationRoom * 100) / 100,
                    price_tiers: {
                        premium: Math.round(tier1 * 100) / 100,
                        balanced: Math.round(tier2 * 100) / 100,
                        floor: Math.round(tier3 * 100) / 100,
                    },
                    recommendation: canReduce
                        ? `يمكن تخفيض السعر إلى ${Math.round(tier2 * 100) / 100} ريال (هامش ${Math.round(((tier2 - cost) / cost * 100) * 100) / 100}%) كحل وسط.`
                        : `السعر الحالي قريب من الحد الأدنى. التكلفة ${cost} ريال، لا يمكن تخفيض أكثر من ${Math.round(minAcceptablePrice * 100) / 100} ريال.`,
                    _explanation: {
                        why: canReduce
                            ? `السعر الحالي ${current} ريال بهامش ${Math.round(currentMargin * 100) / 100}%. الحد الأدنى المقبول ${Math.round(minAcceptablePrice * 100) / 100} ريال (هامش ${target_margin}%). متاح تخفيض ${Math.round(negotiationRoom * 100) / 100} ريال.`
                            : `السعر الحالي ${current} ريال قريب من الحد الأدنى ${Math.round(minAcceptablePrice * 100) / 100} ريال. التكلفة ${cost} ريال، الهامش الحالي ${Math.round(currentMargin * 100) / 100}% فقط.`,
                        confidence: cost > 0 ? 90 : 30,
                        factors: [
                            { factor: 'التكلفة', value: cost, weight: 'high' },
                            { factor: 'السعر الحالي', value: current, weight: 'high' },
                            { factor: 'الهامش الحالي', value: Math.round(currentMargin * 100) / 100 + '%', weight: 'high' },
                            { factor: 'الهامش الأدنى', value: target_margin + '%', weight: 'medium' },
                        ],
                    },
                });
            }
            return _sanitize(results);
        }
    },

    // ── 38. getClientPricingHistory ──────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getClientPricingHistory',
            description: 'يرجع تاريخ أسعار عميل معين لكل المنتجات: كم دفع، متى، وأي سعر. مفيد لمعرفة أنماط شراء العميل.',
            parameters: {
                type: 'object',
                properties: {
                    client_name: { type: 'string', description: 'اسم العميل' },
                    limit: { type: 'integer', description: 'عدد النتائج (افتراضي 20)' }
                },
                required: ['client_name']
            }
        },
        async execute(args, user) {
            const { client_name, limit = 20 } = args;
            const result = await db.query(
                `SELECT o.order_number, o.created_at, o.status,
                        p.name as product_name, pv.size_name, pv.sku,
                        oi.quantity, oi.unit_price, oi.line_total,
                        pv.cost_price
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN clients c ON c.id = o.client_id
                 LEFT JOIN product_variants pv ON pv.id = oi.variant_id
                 LEFT JOIN products p ON p.id = pv.product_id
                 WHERE c.name ILIKE $1 AND o.status NOT IN ('cancelled', 'draft')
                 ORDER BY o.created_at DESC
                 LIMIT $2`,
                [`%${client_name}%`, parseInt(limit) || 20]
            );

            // Add margin analysis for each item
            const enriched = result.rows.map(r => {
                const cost = parseFloat(r.cost_price || 0);
                const price = parseFloat(r.unit_price || 0);
                const margin = cost > 0 ? Math.round(((price - cost) / cost * 100) * 100) / 100 : null;
                return { ...r, margin_percent: margin };
            });

            return _sanitize(enriched);
        }
    },

    // ── 39. getProfitabilityAnalysis ─────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getProfitabilityAnalysis',
            description: 'تحليل ربحية عميل: إجمالي المشتريات، إجمالي التكلفة، صافي الربح، متوسط هامش الربح، وأكثر المنتجات ربحية.',
            parameters: {
                type: 'object',
                properties: {
                    client_name: { type: 'string', description: 'اسم العميل' }
                },
                required: ['client_name']
            }
        },
        async execute(args, user) {
            const { client_name } = args;

            const clientRes = await db.query(
                `SELECT id FROM clients WHERE name ILIKE $1 LIMIT 1`,
                [`%${client_name}%`]
            );
            if (clientRes.rows.length === 0) return { error: 'لم يتم العثور على العميل' };
            const clientId = clientRes.rows[0].id;

            // Overall profitability
            const overallRes = await db.query(
                `SELECT
                    COUNT(DISTINCT o.id) as total_orders,
                    COALESCE(SUM(oi.line_total), 0)::numeric as total_revenue,
                    COALESCE(SUM(oi.quantity * pv.cost_price), 0)::numeric as total_cost,
                    COALESCE(SUM(oi.line_total - oi.quantity * pv.cost_price), 0)::numeric as gross_profit
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 LEFT JOIN product_variants pv ON pv.id = oi.variant_id
                 WHERE o.client_id = $1 AND o.status NOT IN ('cancelled', 'draft')`,
                [clientId]
            );

            const totalRevenue = parseFloat(overallRes.rows[0].total_revenue || 0);
            const totalCost = parseFloat(overallRes.rows[0].total_cost || 0);
            const grossProfit = parseFloat(overallRes.rows[0].gross_profit || 0);
            const avgMargin = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue * 100) * 100) / 100 : 0;

            // Most profitable products for this client
            const topProductsRes = await db.query(
                `SELECT p.name as product_name, pv.size_name,
                        COUNT(*) as times_ordered,
                        SUM(oi.quantity) as total_qty,
                        SUM(oi.line_total)::numeric as revenue,
                        SUM(oi.quantity * pv.cost_price)::numeric as cost,
                        SUM(oi.line_total - oi.quantity * pv.cost_price)::numeric as profit,
                        CASE WHEN SUM(oi.line_total) > 0
                             THEN ROUND((SUM(oi.line_total - oi.quantity * pv.cost_price) / SUM(oi.line_total) * 100)::numeric, 2)
                             ELSE 0 END as margin_percent
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 LEFT JOIN product_variants pv ON pv.id = oi.variant_id
                 LEFT JOIN products p ON p.id = pv.product_id
                 WHERE o.client_id = $1 AND o.status NOT IN ('cancelled', 'draft')
                 GROUP BY p.name, pv.size_name
                 ORDER BY profit DESC
                 LIMIT 10`,
                [clientId]
            );

            // Monthly trend
            const trendRes = await db.query(
                `SELECT DATE_TRUNC('month', o.created_at) as month,
                        COUNT(DISTINCT o.id) as orders,
                        SUM(oi.line_total)::numeric as revenue,
                        SUM(oi.line_total - oi.quantity * pv.cost_price)::numeric as profit
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 LEFT JOIN product_variants pv ON pv.id = oi.variant_id
                 WHERE o.client_id = $1 AND o.status NOT IN ('cancelled', 'draft')
                   AND o.created_at >= NOW() - INTERVAL '6 months'
                 GROUP BY DATE_TRUNC('month', o.created_at)
                 ORDER BY month DESC`,
                [clientId]
            );

            return _sanitize([{
                total_orders: parseInt(overallRes.rows[0].total_orders || 0),
                total_revenue: totalRevenue,
                total_cost: totalCost,
                gross_profit: grossProfit,
                avg_margin_percent: avgMargin,
                top_profitable_products: topProductsRes.rows.map(r => ({
                    product_name: r.product_name,
                    size_name: r.size_name,
                    times_ordered: parseInt(r.times_ordered),
                    total_qty: parseInt(r.total_qty),
                    revenue: parseFloat(r.revenue),
                    cost: parseFloat(r.cost),
                    profit: parseFloat(r.profit),
                    margin_percent: parseFloat(r.margin_percent),
                })),
                monthly_trend: trendRes.rows.map(r => ({
                    month: r.month.toISOString().split('T')[0],
                    orders: parseInt(r.orders),
                    revenue: parseFloat(r.revenue),
                    profit: parseFloat(r.profit),
                })),
            }]);
        }
    },

    // ── 40. getProactiveAlerts ───────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getProactiveAlerts',
            description: 'يرجع تنبيهات استباقية: عملاء لم يطلبوا منذ فترة، مخزون منخفض، عروض أسعار متأخرة، دفعات مستحقة، فرص بيع.',
            parameters: {
                type: 'object',
                properties: {}
            }
        },
        async execute(args, user) {
            const alerts = [];

            // 1. Clients who haven't ordered in 30+ days
            const inactiveClientsRes = await db.query(
                `SELECT c.id, c.name, c.phone,
                        MAX(o.created_at) as last_order,
                        EXTRACT(DAY FROM NOW() - MAX(o.created_at))::int as days_inactive,
                        COALESCE(SUM(o.grand_total), 0)::numeric as lifetime_value
                 FROM clients c
                 LEFT JOIN orders o ON o.client_id = c.id AND o.status NOT IN ('cancelled', 'draft')
                 WHERE c.status = 'active' AND c.parent_id IS NULL
                 GROUP BY c.id, c.name, c.phone
                 HAVING MAX(o.created_at) IS NULL OR MAX(o.created_at) < NOW() - INTERVAL '30 days'
                 ORDER BY days_inactive DESC NULLS FIRST
                 LIMIT 5`
            );
            if (inactiveClientsRes.rows.length > 0) {
                alerts.push({
                    type: 'inactive_clients',
                    severity: 'high',
                    title: 'عملاء لم يطلبوا منذ 30 يوم',
                    count: inactiveClientsRes.rows.length,
                    items: inactiveClientsRes.rows.map(r => ({
                        name: r.name,
                        phone: r.phone,
                        days_inactive: r.days_inactive || 'لا طلبات',
                        lifetime_value: parseFloat(r.lifetime_value || 0),
                    })),
                    suggestion: 'تواصل مع هؤلاء العملاء لمعرفة أسباب عدم الطلب',
                });
            }

            // 2. Low stock items
            const lowStockRes = await db.query(
                `SELECT p.name, pv.size_name, pv.sku,
                        COALESCE(ws.qty, 0) as current_stock,
                        pv.min_stock_level,
                        pv.cost_price
                 FROM product_variants pv
                 JOIN products p ON p.id = pv.product_id
                 LEFT JOIN (SELECT variant_id, SUM(quantity) as qty FROM warehouse_stock GROUP BY variant_id) ws ON ws.variant_id = pv.id
                 WHERE pv.status = 'active' AND COALESCE(ws.qty, 0) < COALESCE(pv.min_stock_level, 100)
                 ORDER BY COALESCE(ws.qty, 0) ASC
                 LIMIT 5`
            );
            if (lowStockRes.rows.length > 0) {
                alerts.push({
                    type: 'low_stock',
                    severity: 'high',
                    title: 'مخزون منخفض',
                    count: lowStockRes.rows.length,
                    items: lowStockRes.rows.map(r => ({
                        product_name: r.name,
                        size_name: r.size_name,
                        current_stock: parseInt(r.current_stock || 0),
                        min_level: parseInt(r.min_stock_level || 100),
                    })),
                    suggestion: 'فكر في إعادة الطلب من الموردين قبل نفاد المخزون',
                });
            }

            // 3. Pending quotes older than 7 days
            const oldQuotesRes = await db.query(
                `SELECT o.order_number, o.created_at, c.name as client_name,
                        o.grand_total,
                        EXTRACT(DAY FROM NOW() - o.created_at)::int as days_pending
                 FROM orders o
                 LEFT JOIN clients c ON c.id = o.client_id
                 WHERE o.status = 'quote'
                   AND o.created_at < NOW() - INTERVAL '7 days'
                 ORDER BY o.created_at ASC
                 LIMIT 5`
            );
            if (oldQuotesRes.rows.length > 0) {
                alerts.push({
                    type: 'stale_quotes',
                    severity: 'medium',
                    title: 'عروض أسعار متأخرة (أكثر من 7 أيام)',
                    count: oldQuotesRes.rows.length,
                    items: oldQuotesRes.rows.map(r => ({
                        order_number: r.order_number,
                        client_name: r.client_name,
                        grand_total: parseFloat(r.grand_total || 0),
                        days_pending: r.days_pending,
                    })),
                    suggestion: 'تابع مع العملاء لتأكيد أو تعديل هذه العروض',
                });
            }

            // 4. Outstanding payments (paid_amount is not on invoices table — use client_transactions)
            const outstandingRes = await db.query(
                `SELECT i.invoice_number, c.name as client_name,
                        i.grand_total,
                        COALESCE((SELECT SUM(ct.amount) FROM client_transactions ct WHERE ct.invoice_id = i.id AND ct.type = 'payment'), 0)::numeric as paid_amount,
                        (i.grand_total - COALESCE((SELECT SUM(ct.amount) FROM client_transactions ct WHERE ct.invoice_id = i.id AND ct.type = 'payment'), 0))::numeric as remaining,
                        i.invoice_date
                 FROM invoices i
                 JOIN clients c ON c.id = i.client_id
                 WHERE i.status NOT IN ('cancelled', 'paid')
                 ORDER BY i.invoice_date ASC
                 LIMIT 5`
            );
            if (outstandingRes.rows.length > 0) {
                alerts.push({
                    type: 'outstanding_payments',
                    severity: 'high',
                    title: 'دفعات مستحقة',
                    count: outstandingRes.rows.length,
                    items: outstandingRes.rows.map(r => ({
                        invoice_number: r.invoice_number,
                        client_name: r.client_name,
                        remaining: parseFloat(r.remaining || 0),
                    })),
                    suggestion: 'تذكير العملاء بالمستحقات',
                });
            }

            return _sanitize(alerts);
        }
    },

    // ── getCompanyTimeline ──────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getCompanyTimeline',
            description: 'يعرض آخر الأحداث في الشركة (عروض، فواتير، دفعات، تسليمات، إنتاج) مرتبة زمنياً. يستخدم للإجابة على "إيه اللي حصل النهاردة؟" أو "وريني آخر الأحداث".',
            parameters: {
                type: 'object',
                properties: {
                    hours: { type: 'number', description: 'عدد الساعات الأخيرة (افتراضي 24)' },
                    limit: { type: 'number', description: 'عدد الأحداث الأقصى (افتراضي 30)' },
                    event_type: { type: 'string', description: 'فلترة بنوع الحدث (اختياري)' },
                },
            },
        },
        async execute(args, user) {
            const hours = parseInt(args.hours || 24, 10);
            const limit = Math.min(parseInt(args.limit || 30, 10), 100);
            const eventType = args.event_type || null;

            const conditions = [`be.created_at >= NOW() - INTERVAL '${hours} hours'`];
            const params = [];
            let idx = 1;

            if (eventType) {
                params.push(eventType);
                conditions.push(`be.event_type = $${idx++}`);
            }

            params.push(limit);
            const res = await db.query(
                `SELECT be.id, be.event_type, be.entity_type, be.entity_id, be.entity_name,
                        be.severity, be.description, be.metadata, be.created_at,
                        u.name AS created_by_name
                 FROM business_events be
                 LEFT JOIN users u ON u.id = be.created_by
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY be.created_at DESC
                 LIMIT $${idx}`,
                params
            );

            return _sanitize(res.rows);
        }
    },

    // ── getAuditReport ──────────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'getAuditReport',
            description: 'يفحص الشركة ويكتشف الأخطاء والمشاكل: فواتير ناقصة، بيع بخسارة، عملاء خاملين، مخزون غير منطقي، بيانات مكررة، مهام متأخرة. يستخدم للإجابة على "فيه أي مشاكل في النظام؟" أو "فحص الشركة".',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
        async execute(args, user) {
            const issues = [];

            // 1. Orders without invoices (quotes converted to production but no invoice)
            const noInvoiceRes = await db.query(
                `SELECT o.id, o.order_number, c.name as client_name, o.grand_total, o.created_at
                 FROM orders o
                 JOIN clients c ON c.id = o.client_id
                 LEFT JOIN invoices i ON i.order_id = o.id
                 WHERE o.status IN ('production', 'processing', 'completed')
                   AND i.id IS NULL
                 ORDER BY o.created_at DESC
                 LIMIT 10`
            );
            if (noInvoiceRes.rows.length > 0) {
                issues.push({
                    severity: 'warning',
                    category: 'missing_invoices',
                    title: 'طلبات بدون فواتير',
                    count: noInvoiceRes.rows.length,
                    items: noInvoiceRes.rows,
                    suggestion: 'إنشاء فواتير للطلبات المكتملة',
                });
            }

            // 2. Products selling at a loss (selling_price < cost_price)
            const lossRes = await db.query(
                `SELECT pv.id, p.name AS product_name, pv.size_name,
                        pv.cost_price, pv.selling_price,
                        (pv.selling_price - pv.cost_price) AS loss_per_unit
                 FROM product_variants pv
                 JOIN products p ON p.id = pv.product_id
                 WHERE pv.cost_price IS NOT NULL
                   AND pv.selling_price IS NOT NULL
                   AND pv.selling_price < pv.cost_price
                 LIMIT 20`
            );
            if (lossRes.rows.length > 0) {
                issues.push({
                    severity: 'critical',
                    category: 'selling_at_loss',
                    title: 'منتجات تباع بخسارة',
                    count: lossRes.rows.length,
                    items: lossRes.rows,
                    suggestion: 'مراجعة أسعار هذه المنتجات فوراً',
                });
            }

            // 3. Inactive clients (no orders in 30+ days)
            const inactiveRes = await db.query(
                `SELECT c.id, c.name, c.phone, c.city,
                        MAX(o.created_at) AS last_order_date,
                        EXTRACT(DAY FROM NOW() - MAX(o.created_at))::int AS days_inactive
                 FROM clients c
                 LEFT JOIN orders o ON o.client_id = c.id
                 WHERE c.status = 'active'
                 GROUP BY c.id, c.name, c.phone, c.city
                 HAVING MAX(o.created_at) IS NULL
                    OR MAX(o.created_at) < NOW() - INTERVAL '30 days'
                 ORDER BY days_inactive DESC
                 LIMIT 15`
            );
            if (inactiveRes.rows.length > 0) {
                issues.push({
                    severity: 'warning',
                    category: 'inactive_clients',
                    title: 'عملاء خاملون (30+ يوم)',
                    count: inactiveRes.rows.length,
                    items: inactiveRes.rows,
                    suggestion: 'التواصل مع هؤلاء العملاء لمعرفة أسباب الخمول',
                });
            }

            // 4. Overdue tasks
            const overdueTasksRes = await db.query(
                `SELECT id, title, assigned_to_name, due_date, priority,
                        EXTRACT(DAY FROM NOW() - due_date)::int AS days_overdue
                 FROM (
                    SELECT t.id, t.title, u.name AS assigned_to_name, t.due_date, t.priority
                    FROM tasks t
                    LEFT JOIN users u ON u.id = t.assigned_to
                    WHERE t.status NOT IN ('completed', 'cancelled')
                      AND t.due_date < NOW()
                 ) sub
                 ORDER BY days_overdue DESC
                 LIMIT 15`
            );
            if (overdueTasksRes.rows.length > 0) {
                issues.push({
                    severity: 'warning',
                    category: 'overdue_tasks',
                    title: 'مهام متأخرة',
                    count: overdueTasksRes.rows.length,
                    items: overdueTasksRes.rows,
                    suggestion: 'متابعة هذه المهام مع المسؤولين',
                });
            }

            // 5. Unreasonable stock (negative or very high)
            const stockIssuesRes = await db.query(
                `SELECT ws.id, p.name AS product_name, pv.size_name,
                        ws.quantity, c.name AS client_name
                 FROM warehouse_stock ws
                 JOIN product_variants pv ON pv.id = ws.variant_id
                 JOIN products p ON p.id = pv.product_id
                 LEFT JOIN clients c ON c.id = ws.client_id
                 WHERE ws.quantity < 0
                 LIMIT 10`
            );
            if (stockIssuesRes.rows.length > 0) {
                issues.push({
                    severity: 'critical',
                    category: 'negative_stock',
                    title: 'مخزون سالب',
                    count: stockIssuesRes.rows.length,
                    items: stockIssuesRes.rows,
                    suggestion: 'مراجعة حركات المخزون وتصحيح الكميات',
                });
            }

            // 6. Duplicate clients (same phone or similar name)
            const dupRes = await db.query(
                `SELECT phone, array_agg(name) AS names, array_agg(id) AS ids, COUNT(*) AS dup_count
                 FROM clients
                 WHERE phone IS NOT NULL AND phone != ''
                 GROUP BY phone
                 HAVING COUNT(*) > 1
                 LIMIT 10`
            );
            if (dupRes.rows.length > 0) {
                issues.push({
                    severity: 'warning',
                    category: 'duplicate_clients',
                    title: 'عملاء بنفس رقم الهاتف',
                    count: dupRes.rows.length,
                    items: dupRes.rows,
                    suggestion: 'دمج أو مراجعة العملاء المكررين',
                });
            }

            // 7. Overdue invoices
            const overdueInvRes = await db.query(
                `SELECT i.id, i.invoice_number, c.name AS client_name,
                        i.grand_total, i.due_date,
                        EXTRACT(DAY FROM NOW() - i.due_date)::int AS days_overdue
                 FROM invoices i
                 JOIN clients c ON c.id = i.client_id
                 WHERE i.status = 'issued'
                   AND i.due_date < NOW()
                 ORDER BY days_overdue DESC
                 LIMIT 10`
            );
            if (overdueInvRes.rows.length > 0) {
                issues.push({
                    severity: 'critical',
                    category: 'overdue_invoices',
                    title: 'فواتير متأخرة السداد',
                    count: overdueInvRes.rows.length,
                    items: overdueInvRes.rows,
                    suggestion: 'التواصل مع العملاء لتحصيل الفواتير المتأخرة',
                });
            }

            return {
                audit_date: new Date().toISOString(),
                total_issues: issues.length,
                issues,
            };
        }
    },

    // ── 41. getStockForecast ─────────────────────────────────────────────────
    // Predicts stock depletion based on consumption rate from inventory_transactions
    {
        type: 'function',
        function: {
            name: 'getStockForecast',
            description: 'تحليل تنبؤي للمخزون: يحسب معدل الاستهلاك اليومي من حركات المخزون آخر 90 يوم ويتنبأ متى سينفد المخزون. استخدمه عندما يسأل المستخدم عن المخزون أو يقول "هل نحتاج طلب شراء؟".',
            parameters: {
                type: 'object',
                properties: {
                    client_id: { type: 'string', description: 'معرف العميل (المستودع) — اختياري، لو لم يحدد سيتم تحليل كل المستودعات' },
                    threshold_days: { type: 'integer', description: 'عدد الأيام الحرجة (افتراضي 14 يوم)' }
                }
            }
        },
        async execute(args, user) {
            const { client_id, threshold_days = 14 } = args;

            // Get current stock levels
            let stockQuery, stockParams;
            if (client_id) {
                stockQuery = `
                    SELECT ws.id, ws.client_id, ws.variant_id, ws.quantity,
                           c.name AS client_name, p.name AS product_name,
                           pv.size_name, pv.sku
                    FROM warehouse_stock ws
                    JOIN clients c ON c.id = ws.client_id
                    JOIN product_variants pv ON pv.id = ws.variant_id
                    JOIN products p ON p.id = pv.product_id
                    WHERE ws.client_id = $1 AND ws.quantity > 0
                `;
                stockParams = [client_id];
            } else {
                stockQuery = `
                    SELECT ws.id, ws.client_id, ws.variant_id, ws.quantity,
                           c.name AS client_name, p.name AS product_name,
                           pv.size_name, pv.sku
                    FROM warehouse_stock ws
                    JOIN clients c ON c.id = ws.client_id
                    JOIN product_variants pv ON pv.id = ws.variant_id
                    JOIN products p ON p.id = pv.product_id
                    WHERE ws.quantity > 0
                `;
                stockParams = [];
            }

            const stockRes = await db.query(stockQuery, stockParams);
            if (stockRes.rows.length === 0) return { error: 'لا يوجد مخزون متاح للتحليل' };

            const results = [];
            let criticalCount = 0;

            for (const stock of stockRes.rows) {
                // Calculate daily consumption rate from inventory_transactions (dispense) last 90 days
                const consumptionRes = await db.query(
                    `SELECT COALESCE(SUM(ABS(quantity)), 0)::numeric as total_consumed,
                            COUNT(*) as transaction_count
                     FROM inventory_transactions
                     WHERE stock_id = $1
                       AND transaction_type = 'dispense'
                       AND created_at >= NOW() - INTERVAL '90 days'`,
                    [stock.id]
                );

                const totalConsumed = parseFloat(consumptionRes.rows[0].total_consumed || 0);
                const txnCount = parseInt(consumptionRes.rows[0].transaction_count || 0);

                if (totalConsumed === 0) {
                    // No consumption data — skip prediction
                    results.push({
                        client_name: stock.client_name,
                        product_name: stock.product_name,
                        size_name: stock.size_name,
                        sku: stock.sku,
                        current_stock: stock.quantity,
                        daily_consumption: 0,
                        days_remaining: null,
                        status: 'no_data',
                        recommendation: 'لا توجد بيانات استهلاك كافية للتنبؤ',
                    });
                    continue;
                }

                const dailyRate = totalConsumed / 90;
                const daysRemaining = Math.floor(stock.quantity / dailyRate);
                const status = daysRemaining < threshold_days ? 'critical' : daysRemaining < threshold_days * 2 ? 'warning' : 'ok';

                if (status === 'critical') criticalCount++;

                results.push({
                    client_name: stock.client_name,
                    product_name: stock.product_name,
                    size_name: stock.size_name,
                    sku: stock.sku,
                    current_stock: stock.quantity,
                    daily_consumption: Math.round(dailyRate * 100) / 100,
                    days_remaining: daysRemaining,
                    status: status,
                    recommendation: status === 'critical'
                        ? `تنبيه: المخزون سينفد خلال ${daysRemaining} يوم. يُنصح بطلب شراء فوري.`
                        : status === 'warning'
                        ? `تحذير: المخزون سينفد خلال ${daysRemaining} يوم. يُنصح بالبدء في طلب شراء.`
                        : `المخزون كافٍ لـ ${daysRemaining} يوم.`,
                    _explanation: {
                        why: `استهلاك ${totalConsumed} وحدة في 90 يوم = ${Math.round(dailyRate * 100) / 100} وحدة/يوم. المخزون الحالي ${stock.quantity} = ${daysRemaining} يوم متبقية.`,
                        confidence: txnCount >= 10 ? 85 : txnCount >= 5 ? 65 : 40,
                        factors: [
                            { factor: 'المخزون الحالي', value: stock.quantity, weight: 'high' },
                            { factor: 'معدل الاستهلاك اليومي', value: Math.round(dailyRate * 100) / 100, weight: 'high' },
                            { factor: 'بيانات الاستهلاك (90 يوم)', value: txnCount + ' حركة', weight: txnCount >= 10 ? 'high' : 'medium' },
                        ],
                    },
                });
            }

            // Sort: critical first, then warning, then ok
            results.sort((a, b) => {
                const order = { critical: 0, warning: 1, ok: 2, no_data: 3 };
                return (order[a.status] || 3) - (order[b.status] || 3);
            });

            return {
                forecast_date: new Date().toISOString(),
                threshold_days: threshold_days,
                total_items: results.length,
                critical_count: criticalCount,
                items: results,
            };
        }
    },

    // ── 42. getCreditRiskAssessment ──────────────────────────────────────────
    // Evaluates credit risk for a specific client or all clients
    {
        type: 'function',
        function: {
            name: 'getCreditRiskAssessment',
            description: 'تقييم مخاطر الائتمان لعميل: يحلل سجل الدفعات، الرصيد المستحق، حد الائتمان، ويصنف العميل (آمن/احذر/ممنوع). استخدمه عندما يسأل المستخدم عن جدارة عميل أو يقول "هل أعطيه آجل؟".',
            parameters: {
                type: 'object',
                properties: {
                    client_name: { type: 'string', description: 'اسم العميل' },
                    include_all: { type: 'boolean', description: 'لو true، يعرض تقييم كل العملاء (افتراضي false)' }
                }
            }
        },
        async execute(args, user) {
            const { client_name, include_all = false } = args;

            let clientFilter, clientParams;
            if (!include_all && client_name) {
                clientFilter = `AND c.name ILIKE $1`;
                clientParams = [`%${client_name}%`];
            } else {
                clientFilter = '';
                clientParams = [];
            }

            const clientsRes = await db.query(
                `SELECT c.id, c.name, c.credit_limit, c.status,
                        c.parent_id
                 FROM clients c
                 WHERE c.status = 'active' ${clientFilter}
                 ORDER BY c.name
                 LIMIT ${include_all ? '50' : '5'}`,
                clientParams
            );

            if (clientsRes.rows.length === 0) return { error: 'لم يتم العثور على العميل' };

            const results = [];

            for (const client of clientsRes.rows) {
                // Outstanding balance: total invoices - total payments
                const balanceRes = await db.query(
                    `SELECT
                        COALESCE(SUM(i.grand_total), 0)::numeric as total_invoiced,
                        COALESCE(SUM(COALESCE(ct.paid, 0)), 0)::numeric as total_paid
                     FROM invoices i
                     LEFT JOIN (
                         SELECT invoice_id, SUM(amount) as paid
                         FROM client_transactions
                         WHERE type = 'payment' AND invoice_id IS NOT NULL
                         GROUP BY invoice_id
                     ) ct ON ct.invoice_id = i.id
                     WHERE i.client_id = $1 AND i.status != 'cancelled'`,
                    [client.id]
                );

                const totalInvoiced = parseFloat(balanceRes.rows[0].total_invoiced || 0);
                const totalPaid = parseFloat(balanceRes.rows[0].total_paid || 0);
                const outstanding = totalInvoiced - totalPaid;

                // Overdue invoices count
                const overdueRes = await db.query(
                    `SELECT COUNT(*) as overdue_count,
                            COALESCE(SUM(i.grand_total - COALESCE(ct.paid, 0)), 0)::numeric as overdue_amount
                     FROM invoices i
                     LEFT JOIN (
                         SELECT invoice_id, SUM(amount) as paid
                         FROM client_transactions
                         WHERE type = 'payment' AND invoice_id IS NOT NULL
                         GROUP BY invoice_id
                     ) ct ON ct.invoice_id = i.id
                     WHERE i.client_id = $1 AND i.status = 'issued'
                       AND i.due_date < NOW()
                       AND (i.grand_total - COALESCE(ct.paid, 0)) > 0`,
                    [client.id]
                );

                const overdueCount = parseInt(overdueRes.rows[0].overdue_count || 0);
                const overdueAmount = parseFloat(overdueRes.rows[0].overdue_amount || 0);

                // Payment timeliness: average days to pay
                const payTimeRes = await db.query(
                    `SELECT AVG(EXTRACT(DAY FROM ct.created_at - i.invoice_date))::numeric as avg_days_to_pay,
                            COUNT(*) as payment_count
                     FROM client_transactions ct
                     JOIN invoices i ON i.id = ct.invoice_id
                     WHERE ct.type = 'payment' AND i.client_id = $1
                       AND ct.created_at >= NOW() - INTERVAL '180 days'`,
                    [client.id]
                );

                const avgDaysToPay = parseFloat(payTimeRes.rows[0].avg_days_to_pay || 0);
                const paymentCount = parseInt(payTimeRes.rows[0].payment_count || 0);

                // Credit limit utilization
                const creditLimit = parseFloat(client.credit_limit || 0);
                const utilizationPct = creditLimit > 0 ? (outstanding / creditLimit * 100) : 0;

                // Risk scoring
                let riskScore = 0;
                let riskLevel = 'safe';
                let riskReasons = [];

                if (creditLimit > 0 && utilizationPct > 90) {
                    riskScore += 30;
                    riskReasons.push(`استخدام حد الائتمان ${Math.round(utilizationPct)}%`);
                } else if (creditLimit > 0 && utilizationPct > 70) {
                    riskScore += 15;
                    riskReasons.push(`استخدام حد الائتمان ${Math.round(utilizationPct)}%`);
                }

                if (overdueCount > 0) {
                    riskScore += overdueCount * 10;
                    riskReasons.push(`${overdueCount} فاتورة متأخرة بقيمة ${Math.round(overdueAmount)} ر.س`);
                }

                if (avgDaysToPay > 45 && paymentCount > 0) {
                    riskScore += 20;
                    riskReasons.push(`متوسط تأخر الدفع ${Math.round(avgDaysToPay)} يوم`);
                } else if (avgDaysToPay > 30 && paymentCount > 0) {
                    riskScore += 10;
                    riskReasons.push(`متوسط تأخر الدفع ${Math.round(avgDaysToPay)} يوم`);
                }

                if (riskScore >= 40) {
                    riskLevel = 'blocked';
                } else if (riskScore >= 20) {
                    riskLevel = 'caution';
                }

                results.push({
                    client_name: client.name,
                    credit_limit: creditLimit,
                    total_invoiced: Math.round(totalInvoiced * 100) / 100,
                    total_paid: Math.round(totalPaid * 100) / 100,
                    outstanding: Math.round(outstanding * 100) / 100,
                    credit_utilization_pct: Math.round(utilizationPct * 100) / 100,
                    overdue_invoices: overdueCount,
                    overdue_amount: Math.round(overdueAmount * 100) / 100,
                    avg_days_to_pay: Math.round(avgDaysToPay),
                    payment_history_count: paymentCount,
                    risk_level: riskLevel,
                    risk_score: riskScore,
                    risk_reasons: riskReasons,
                    recommendation: riskLevel === 'blocked'
                        ? 'ممنوع منح آجل — مخاطر ائتمانية عالية'
                        : riskLevel === 'caution'
                        ? 'احذر — يُنصح بطلب دفعة مقدمة أو تقليل حد الائتمان'
                        : 'آمن — يمكن منح آجل ضمن حد الائتمان',
                    _explanation: {
                        why: `تقييم العميل ${client.name}: مستحق ${Math.round(outstanding)} ر.س من حد ائتمان ${creditLimit} ر.س (${Math.round(utilizationPct)}%). ${overdueCount} فاتورة متأخرة. متوسط الدفع ${Math.round(avgDaysToPay)} يوم. النتيجة: ${riskLevel}.`,
                        confidence: paymentCount >= 5 ? 85 : paymentCount >= 2 ? 60 : 35,
                        factors: [
                            { factor: 'المستحق', value: Math.round(outstanding), weight: 'high' },
                            { factor: 'حد الائتمان', value: creditLimit, weight: 'high' },
                            { factor: 'نسبة الاستخدام', value: Math.round(utilizationPct) + '%', weight: 'high' },
                            { factor: 'فواتير متأخرة', value: overdueCount, weight: overdueCount > 0 ? 'high' : 'low' },
                            { factor: 'متوسط أيام الدفع', value: Math.round(avgDaysToPay), weight: paymentCount > 0 ? 'medium' : 'low' },
                        ],
                    },
                });
            }

            return {
                assessment_date: new Date().toISOString(),
                clients_assessed: results.length,
                results,
            };
        }
    },

    // ── 43. getClientSegmentation ────────────────────────────────────────────
    // Classifies clients into VIP, regular, at_risk, credit_risk
    {
        type: 'function',
        function: {
            name: 'getClientSegmentation',
            description: 'تصنيف العملاء تلقائياً: VIP (مشتريات عالية + التزام دفع)، منتظم، معرض للضياع (ما طلبش من 30+ يوم)، مخاطر ائتمانية. استخدمه عندما يقول المستخدم "صنف لي العملاء" أو "مين أهم العملاء؟".',
            parameters: {
                type: 'object',
                properties: {}
            }
        },
        async execute(args, user) {
            // Get all active clients with their purchase stats
            const clientsRes = await db.query(
                `SELECT c.id, c.name, c.status, c.parent_id,
                        COALESCE(SUM(o.grand_total), 0)::numeric as total_purchases,
                        COUNT(o.id) as order_count,
                        MAX(o.created_at) as last_order_date
                 FROM clients c
                 LEFT JOIN orders o ON o.client_id = c.id AND o.status NOT IN ('cancelled', 'draft')
                 WHERE c.status = 'active' AND c.parent_id IS NULL
                 GROUP BY c.id, c.name, c.status, c.parent_id
                 ORDER BY total_purchases DESC`
            );

            if (clientsRes.rows.length === 0) return { error: 'لا يوجد عملاء' };

            const segments = {
                vip: [],
                regular: [],
                at_risk: [],
                credit_risk: [],
            };

            for (const client of clientsRes.rows) {
                const totalPurchases = parseFloat(client.total_purchases || 0);
                const orderCount = parseInt(client.order_count || 0);
                const lastOrderDate = client.last_order_date ? new Date(client.last_order_date) : null;
                const daysSinceLastOrder = lastOrderDate ? Math.floor((Date.now() - lastOrderDate.getTime()) / (1000 * 60 * 60 * 24)) : null;

                // Check credit risk: overdue invoices
                const overdueRes = await db.query(
                    `SELECT COUNT(*) as overdue_count
                     FROM invoices i
                     LEFT JOIN (
                         SELECT invoice_id, SUM(amount) as paid
                         FROM client_transactions
                         WHERE type = 'payment' AND invoice_id IS NOT NULL
                         GROUP BY invoice_id
                     ) ct ON ct.invoice_id = i.id
                     WHERE i.client_id = $1 AND i.status = 'issued'
                       AND i.due_date < NOW() - INTERVAL '60 days'
                       AND (i.grand_total - COALESCE(ct.paid, 0)) > 0`,
                    [client.id]
                );
                const overdueCount = parseInt(overdueRes.rows[0].overdue_count || 0);

                // Payment timeliness
                const payTimeRes = await db.query(
                    `SELECT AVG(EXTRACT(DAY FROM ct.created_at - i.invoice_date))::numeric as avg_days_to_pay
                     FROM client_transactions ct
                     JOIN invoices i ON i.id = ct.invoice_id
                     WHERE ct.type = 'payment' AND i.client_id = $1
                       AND ct.created_at >= NOW() - INTERVAL '180 days'`,
                    [client.id]
                );
                const avgDaysToPay = parseFloat(payTimeRes.rows[0].avg_days_to_pay || 0);

                let segment = 'regular';
                let reasons = [];

                // VIP: > 100k purchases + good payment behavior
                if (totalPurchases >= 100000 && avgDaysToPay <= 30 && overdueCount === 0) {
                    segment = 'vip';
                    reasons.push('مشتريات عالية (100k+)');
                    reasons.push('التزام في الدفع');
                } else if (overdueCount > 0) {
                    segment = 'credit_risk';
                    reasons.push(`${overdueCount} فاتورة متأخرة أكثر من 60 يوم`);
                } else if (daysSinceLastOrder !== null && daysSinceLastOrder > 30) {
                    segment = 'at_risk';
                    reasons.push(`لم يطلب منذ ${daysSinceLastOrder} يوم`);
                } else {
                    reasons.push('نشاط منتظم');
                }

                segments[segment].push({
                    client_name: client.name,
                    total_purchases: Math.round(totalPurchases * 100) / 100,
                    order_count: orderCount,
                    last_order_date: client.last_order_date,
                    days_since_last_order: daysSinceLastOrder,
                    avg_days_to_pay: Math.round(avgDaysToPay) || null,
                    overdue_invoices: overdueCount,
                    reasons: reasons,
                });
            }

            return {
                segmentation_date: new Date().toISOString(),
                total_clients: clientsRes.rows.length,
                summary: {
                    vip: segments.vip.length,
                    regular: segments.regular.length,
                    at_risk: segments.at_risk.length,
                    credit_risk: segments.credit_risk.length,
                },
                segments,
            };
        }
    },

    // ── 44. generateCustomReport ─────────────────────────────────────────────
    // Custom report generator: sales, profit, inventory, client reports
    {
        type: 'function',
        function: {
            name: 'generateCustomReport',
            description: 'مولد تقارير ذكية: يولد تقارير مخصصة حسب النوع والفترة. الأنواع: sales_summary (ملخص المبيعات)، profit_analysis (تحليل الأرباح)، inventory_valuation (تقييم المخزون)، client_performance (أداء العملاء)، top_products (المنتجات الأكثر مبيعاً). استخدمه عندما يطلب المستخدم تقريراً.',
            parameters: {
                type: 'object',
                properties: {
                    report_type: { type: 'string', enum: ['sales_summary', 'profit_analysis', 'inventory_valuation', 'client_performance', 'top_products'], description: 'نوع التقرير' },
                    period: { type: 'string', enum: ['today', 'week', 'month', 'quarter', 'year'], description: 'الفترة الزمنية (افتراضي month)' },
                    client_name: { type: 'string', description: 'اسم العميل — اختياري، لفلترة التقرير' }
                },
                required: ['report_type']
            }
        },
        async execute(args, user) {
            const { report_type, period = 'month', client_name } = args;

            // Build date filter
            const periodMap = {
                today: "DATE(created_at) = CURRENT_DATE",
                week: "created_at >= NOW() - INTERVAL '7 days'",
                month: "created_at >= NOW() - INTERVAL '30 days'",
                quarter: "created_at >= NOW() - INTERVAL '90 days'",
                year: "created_at >= NOW() - INTERVAL '365 days'",
            };
            const dateFilter = periodMap[period] || periodMap.month;

            let data = {};
            let summary = '';

            if (report_type === 'sales_summary') {
                const res = await db.query(
                    `SELECT
                        COUNT(*) as total_orders,
                        COALESCE(SUM(grand_total), 0)::numeric as total_sales,
                        COALESCE(AVG(grand_total), 0)::numeric as avg_order_value,
                        COUNT(CASE WHEN status = 'quote' THEN 1 END) as pending_quotes,
                        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_orders,
                        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders
                     FROM orders
                     WHERE ${dateFilter} AND status NOT IN ('cancelled', 'draft')`
                );
                const r = res.rows[0];
                data = {
                    period,
                    total_orders: parseInt(r.total_orders || 0),
                    total_sales: parseFloat(r.total_sales || 0),
                    avg_order_value: parseFloat(r.avg_order_value || 0),
                    pending_quotes: parseInt(r.pending_quotes || 0),
                    confirmed_orders: parseInt(r.confirmed_orders || 0),
                    delivered_orders: parseInt(r.delivered_orders || 0),
                };
                summary = `ملخص المبيعات (${period}): ${data.total_orders} طلب، إجمالي ${Math.round(data.total_sales)} ر.س، متوسط الطلب ${Math.round(data.avg_order_value)} ر.س`;
            } else if (report_type === 'profit_analysis') {
                const res = await db.query(
                    `SELECT
                        COALESCE(SUM(oi.line_total), 0)::numeric as revenue,
                        COALESCE(SUM(oi.quantity * pv.cost_price), 0)::numeric as cost,
                        COALESCE(SUM(oi.line_total - (oi.quantity * pv.cost_price)), 0)::numeric as gross_profit
                     FROM order_items oi
                     JOIN orders o ON o.id = oi.order_id
                     JOIN product_variants pv ON pv.id = oi.variant_id
                     WHERE ${dateFilter.replace('created_at', 'o.created_at')} AND o.status NOT IN ('cancelled', 'draft', 'quote')`
                );
                const r = res.rows[0];
                const revenue = parseFloat(r.revenue || 0);
                const cost = parseFloat(r.cost || 0);
                const profit = parseFloat(r.gross_profit || 0);
                const margin = revenue > 0 ? (profit / revenue * 100) : 0;
                data = {
                    period,
                    revenue: Math.round(revenue * 100) / 100,
                    cost: Math.round(cost * 100) / 100,
                    gross_profit: Math.round(profit * 100) / 100,
                    margin_pct: Math.round(margin * 100) / 100,
                };
                summary = `تحليل الأرباح (${period}): إيرادات ${Math.round(revenue)} ر.س، تكلفة ${Math.round(cost)} ر.س، ربح إجمالي ${Math.round(profit)} ر.س، هامش ${Math.round(margin)}%`;
            } else if (report_type === 'inventory_valuation') {
                const res = await db.query(
                    `SELECT
                        COUNT(*) as total_items,
                        COALESCE(SUM(ws.quantity), 0)::numeric as total_units,
                        COALESCE(SUM(ws.quantity * pv.cost_price), 0)::numeric as cost_value,
                        COALESCE(SUM(ws.quantity * pv.selling_price), 0)::numeric as retail_value
                     FROM warehouse_stock ws
                     JOIN product_variants pv ON pv.id = ws.variant_id
                     WHERE ws.quantity > 0`
                );
                const r = res.rows[0];
                const costValue = parseFloat(r.cost_value || 0);
                const retailValue = parseFloat(r.retail_value || 0);
                data = {
                    total_items: parseInt(r.total_items || 0),
                    total_units: parseFloat(r.total_units || 0),
                    cost_value: Math.round(costValue * 100) / 100,
                    retail_value: Math.round(retailValue * 100) / 100,
                    potential_profit: Math.round((retailValue - costValue) * 100) / 100,
                };
                summary = `تقييم المخزون: ${data.total_items} صنف، ${data.total_units} وحدة، تكلفة ${Math.round(costValue)} ر.س، قيمة بيع ${Math.round(retailValue)} ر.س`;
            } else if (report_type === 'client_performance') {
                let clientFilter = '';
                let params = [];
                if (client_name) {
                    clientFilter = `AND c.name ILIKE $1`;
                    params = [`%${client_name}%`];
                }
                const res = await db.query(
                    `SELECT c.name as client_name,
                            COUNT(o.id) as order_count,
                            COALESCE(SUM(o.grand_total), 0)::numeric as total_sales,
                            MAX(o.created_at) as last_order,
                            COALESCE(AVG(o.grand_total), 0)::numeric as avg_order
                     FROM clients c
                     LEFT JOIN orders o ON o.client_id = c.id AND o.status NOT IN ('cancelled', 'draft')
                         AND ${dateFilter.replace('created_at', 'o.created_at')}
                     WHERE c.status = 'active' AND c.parent_id IS NULL ${clientFilter}
                     GROUP BY c.name
                     ORDER BY total_sales DESC
                     LIMIT 20`,
                    params
                );
                data = {
                    period,
                    clients: res.rows.map(r => ({
                        client_name: r.client_name,
                        order_count: parseInt(r.order_count || 0),
                        total_sales: parseFloat(r.total_sales || 0),
                        avg_order: parseFloat(r.avg_order || 0),
                        last_order: r.last_order,
                    })),
                };
                summary = `أداء العملاء (${period}): ${data.clients.length} عميل، أعلى مبيعات: ${data.clients[0]?.client_name || 'لا يوجد'} (${Math.round(parseFloat(data.clients[0]?.total_sales || 0))} ر.س)`;
            } else if (report_type === 'top_products') {
                const res = await db.query(
                    `SELECT p.name as product_name, pv.size_name,
                            SUM(oi.quantity)::numeric as total_qty,
                            SUM(oi.line_total)::numeric as total_revenue,
                            COUNT(DISTINCT o.id) as order_count
                     FROM order_items oi
                     JOIN orders o ON o.id = oi.order_id
                     JOIN product_variants pv ON pv.id = oi.variant_id
                     JOIN products p ON p.id = pv.product_id
                     WHERE ${dateFilter.replace('created_at', 'o.created_at')} AND o.status NOT IN ('cancelled', 'draft', 'quote')
                     GROUP BY p.name, pv.size_name
                     ORDER BY total_revenue DESC NULLS LAST
                     LIMIT 15`
                );
                data = {
                    period,
                    products: res.rows.map(r => ({
                        product_name: r.product_name,
                        size_name: r.size_name,
                        total_qty: parseFloat(r.total_qty || 0),
                        total_revenue: parseFloat(r.total_revenue || 0),
                        order_count: parseInt(r.order_count || 0),
                    })),
                };
                summary = `المنتجات الأكثر مبيعاً (${period}): ${data.products.length} صنف، الأعلى: ${data.products[0]?.product_name || 'لا يوجد'} (${Math.round(parseFloat(data.products[0]?.total_revenue || 0))} ر.س)`;
            }

            return {
                report_type,
                period,
                generated_at: new Date().toISOString(),
                summary,
                data,
                _explanation: {
                    why: `تم توليد تقرير "${report_type}" للفترة ${period} بناءً على طلب المستخدم.`,
                    confidence: 90,
                    factors: [
                        { factor: 'نوع التقرير', value: report_type, weight: 'high' },
                        { factor: 'الفترة', value: period, weight: 'high' },
                    ],
                },
            };
        }
    },

    // ── 45. getSeasonalAnalysis ──────────────────────────────────────────────
    // 12-month seasonal trend analysis for products
    {
        type: 'function',
        function: {
            name: 'getSeasonalAnalysis',
            description: 'تحليل موسمي للمبيعات: يحلل مبيعات 12 شهر لكل منتج، يكتشف القمم والأودية، ويقترح زيادة مخزون قبل المواسم. استخدمه عندما يقول المستخدم "موسم" أو "أنماط البيع" أو "متى نبيع أكثر؟".',
            parameters: {
                type: 'object',
                properties: {
                    product_name: { type: 'string', description: 'اسم المنتج — اختياري، لو لم يحدد سيحلل كل المنتجات' }
                }
            }
        },
        async execute(args, user) {
            const { product_name } = args;

            let productFilter = '';
            let params = [];
            if (product_name) {
                productFilter = `AND p.name ILIKE $1`;
                params = [`%${product_name}%`];
            }

            // Get monthly sales for last 12 months
            const res = await db.query(
                `SELECT p.name as product_name,
                        TO_CHAR(o.created_at, 'YYYY-MM') as month,
                        SUM(oi.quantity)::numeric as total_qty,
                        SUM(oi.line_total)::numeric as total_revenue
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN product_variants pv ON pv.id = oi.variant_id
                 JOIN products p ON p.id = pv.product_id
                 WHERE o.status NOT IN ('cancelled', 'draft', 'quote')
                   AND o.created_at >= NOW() - INTERVAL '12 months'
                   ${productFilter}
                 GROUP BY p.name, TO_CHAR(o.created_at, 'YYYY-MM')
                 ORDER BY p.name, month`,
                params
            );

            if (res.rows.length === 0) return { error: 'لا توجد بيانات مبيعات كافية للتحليل الموسمي' };

            // Group by product
            const productMap = {};
            for (const row of res.rows) {
                if (!productMap[row.product_name]) {
                    productMap[row.product_name] = [];
                }
                productMap[row.product_name].push({
                    month: row.month,
                    qty: parseFloat(row.total_qty || 0),
                    revenue: parseFloat(row.total_revenue || 0),
                });
            }

            const results = [];
            for (const [name, months] of Object.entries(productMap)) {
                const qtyArr = months.map(m => m.qty);
                const avgQty = qtyArr.reduce((a, b) => a + b, 0) / qtyArr.length;
                const maxQty = Math.max(...qtyArr);
                const minQty = Math.min(...qtyArr);
                const peakMonth = months.find(m => m.qty === maxQty);
                const lowMonth = months.find(m => m.qty === minQty);

                // Seasonality index: how much peak exceeds average
                const seasonalityIndex = avgQty > 0 ? (maxQty / avgQty) : 1;
                const isSeasonal = seasonalityIndex > 1.5;

                // Current stock for this product
                const stockRes = await db.query(
                    `SELECT COALESCE(SUM(ws.quantity), 0)::numeric as current_stock
                     FROM warehouse_stock ws
                     JOIN product_variants pv ON pv.id = ws.variant_id
                     JOIN products p ON p.id = pv.product_id
                     WHERE p.name = $1`,
                    [name]
                );
                const currentStock = parseFloat(stockRes.rows[0].current_stock || 0);

                results.push({
                    product_name: name,
                    months_analyzed: months.length,
                    avg_monthly_qty: Math.round(avgQty * 100) / 100,
                    peak_month: peakMonth ? { month: peakMonth.month, qty: maxQty } : null,
                    low_month: lowMonth ? { month: lowMonth.month, qty: minQty } : null,
                    seasonality_index: Math.round(seasonalityIndex * 100) / 100,
                    is_seasonal: isSeasonal,
                    current_stock: currentStock,
                    recommendation: isSeasonal
                        ? `منتج موسمي: ذروة البيع في ${peakMonth?.month || '?'} (${maxQty} وحدة). يُنصح بزيادة المخزون قبل الموعد بشهر. المخزون الحالي: ${currentStock}.`
                        : `منتج منتظم: مبيعات مستقرة. متوسط شهري ${Math.round(avgQty)} وحدة. المخزون الحالي: ${currentStock}.`,
                    monthly_data: months,
                });
            }

            // Sort: seasonal products first
            results.sort((a, b) => (b.is_seasonal ? 1 : 0) - (a.is_seasonal ? 1 : 0));

            return {
                analysis_date: new Date().toISOString(),
                period_covered: '12 months',
                total_products: results.length,
                seasonal_count: results.filter(r => r.is_seasonal).length,
                results,
            };
        }
    },

    // ── 46. getSupplierIntelligence ──────────────────────────────────────────
    // Supplier comparison + delivery performance
    {
        type: 'function',
        function: {
            name: 'getSupplierIntelligence',
            description: 'ذكاء الموردين: يقارن أسعار الموردين لنفس المنتج، يحلل جودة التسليم (نسبة الالتزام بالمواعيد)، ويقترح أفضل مورد. استخدمه عندما يقول المستخدم "أفضل مورد" أو "قارن الموردين" أو "أداء الموردين".',
            parameters: {
                type: 'object',
                properties: {
                    product_name: { type: 'string', description: 'اسم المنتج — اختياري، للمقارنة على منتج معين' }
                }
            }
        },
        async execute(args, user) {
            const { product_name } = args;

            // 1. Supplier pricing comparison (from historical purchase invoices)
            let pricingQuery, pricingParams;
            if (product_name) {
                pricingQuery = `
                    SELECT pi.supplier_id, s.company_name as supplier_name,
                           pv.id as variant_id, p.name as product_name, pv.size_name,
                           pii.unit_cost as price, pi.invoice_date as updated_at
                    FROM purchase_invoice_items pii
                    JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
                    JOIN suppliers s ON s.id = pi.supplier_id
                    JOIN product_variants pv ON pv.id = pii.variant_id
                    JOIN products p ON p.id = pv.product_id
                    WHERE p.name ILIKE $1 AND s.status = 'active'
                    ORDER BY p.name, pv.size_name, pii.unit_cost
                `;
                pricingParams = [`%${product_name}%`];
            } else {
                pricingQuery = `
                    SELECT pi.supplier_id, s.company_name as supplier_name,
                           pv.id as variant_id, p.name as product_name, pv.size_name,
                           pii.unit_cost as price, pi.invoice_date as updated_at
                    FROM purchase_invoice_items pii
                    JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
                    JOIN suppliers s ON s.id = pi.supplier_id
                    JOIN product_variants pv ON pv.id = pii.variant_id
                    JOIN products p ON p.id = pv.product_id
                    WHERE s.status = 'active'
                    ORDER BY p.name, pv.size_name, pii.unit_cost
                    LIMIT 50
                `;
                pricingParams = [];
            }

            const pricingRes = await db.query(pricingQuery, pricingParams);

            // Group by product+variant to find cheapest supplier
            const productPrices = {};
            for (const row of pricingRes.rows) {
                const key = `${row.product_name}__${row.size_name || ''}`;
                if (!productPrices[key]) {
                    productPrices[key] = {
                        product_name: row.product_name,
                        size_name: row.size_name,
                        suppliers: [],
                    };
                }
                productPrices[key].suppliers.push({
                    supplier_name: row.supplier_name,
                    price: parseFloat(row.price || 0),
                });
            }

            // Find best supplier per product
            const priceComparison = Object.values(productPrices).map(item => {
                const sorted = item.suppliers.sort((a, b) => a.price - b.price);
                const cheapest = sorted[0];
                const expensive = sorted[sorted.length - 1];
                const savings = sorted.length > 1 ? (expensive.price - cheapest.price) : 0;
                return {
                    product_name: item.product_name,
                    size_name: item.size_name,
                    cheapest_supplier: cheapest ? cheapest.supplier_name : null,
                    cheapest_price: cheapest ? cheapest.price : null,
                    expensive_supplier: expensive ? expensive.supplier_name : null,
                    expensive_price: expensive ? expensive.price : null,
                    potential_savings: Math.round(savings * 100) / 100,
                    supplier_count: sorted.length,
                    all_suppliers: sorted,
                };
            });

            // 2. Delivery performance per supplier (uses manufacturer_orders, not purchase_orders)
            const deliveryRes = await db.query(
                `SELECT s.id, s.company_name as supplier_name,
                        COUNT(mo.id) as total_orders,
                        COUNT(CASE WHEN mo.status IN ('received', 'partially_received') THEN 1 END) as received_count,
                        AVG(CASE WHEN mo.status IN ('received', 'partially_received') AND mo.expected_delivery_date IS NOT NULL
                            THEN CASE WHEN mo.updated_at::date <= mo.expected_delivery_date THEN 1 ELSE 0 END
                            ELSE NULL END)::numeric as on_time_rate
                 FROM suppliers s
                 LEFT JOIN manufacturer_orders mo ON mo.manufacturer_id = s.id
                 WHERE s.status = 'active'
                 GROUP BY s.id, s.company_name
                 ORDER BY total_orders DESC`
            );

            const deliveryPerformance = deliveryRes.rows.map(r => ({
                supplier_name: r.supplier_name,
                total_orders: parseInt(r.total_orders || 0),
                received_orders: parseInt(r.received_count || 0),
                on_time_rate: Math.round(parseFloat(r.on_time_rate || 0) * 100) / 100,
                delivery_rating: parseFloat(r.on_time_rate || 0) >= 0.8 ? 'excellent'
                    : parseFloat(r.on_time_rate || 0) >= 0.6 ? 'good'
                    : parseFloat(r.on_time_rate || 0) >= 0.4 ? 'fair'
                    : 'poor',
            }));

            // 3. Overall supplier ranking (price + delivery)
            const supplierStats = {};
            for (const dp of deliveryPerformance) {
                supplierStats[dp.supplier_name] = {
                    supplier_name: dp.supplier_name,
                    delivery_rating: dp.delivery_rating,
                    on_time_rate: dp.on_time_rate,
                    total_orders: dp.total_orders,
                    cheapest_count: 0,
                    avg_price_rank: 0,
                };
            }

            for (const pc of priceComparison) {
                if (pc.cheapest_supplier && supplierStats[pc.cheapest_supplier]) {
                    supplierStats[pc.cheapest_supplier].cheapest_count++;
                }
            }

            const ranking = Object.values(supplierStats)
                .filter(s => s.total_orders > 0 || s.cheapest_count > 0)
                .sort((a, b) => (b.cheapest_count * 2 + b.on_time_rate) - (a.cheapest_count * 2 + a.on_time_rate));

            return {
                analysis_date: new Date().toISOString(),
                product_filter: product_name || 'all',
                price_comparison: priceComparison.slice(0, 20),
                delivery_performance: deliveryPerformance,
                supplier_ranking: ranking.slice(0, 10),
                top_recommendation: ranking[0]
                    ? `أفضل مورد: ${ranking[0].supplier_name} — أرخص في ${ranking[0].cheapest_count} منتج، نسبة الالتزام ${Math.round(ranking[0].on_time_rate * 100)}%`
                    : 'لا توجد بيانات كافية',
                _explanation: {
                    why: `تم تحليل ${priceComparison.length} مقارنة سعر و ${deliveryPerformance.length} مورد. التقييم يعتمد على السعر + جودة التسليم.`,
                    confidence: pricingRes.rows.length > 10 ? 80 : 50,
                    factors: [
                        { factor: 'مقارنات الأسعار', value: priceComparison.length, weight: 'high' },
                        { factor: 'الموردين النشطين', value: deliveryPerformance.length, weight: 'high' },
                        { factor: 'أوامر الشراء', value: deliveryRes.rows.reduce((s, r) => s + parseInt(r.total_orders || 0), 0), weight: 'medium' },
                    ],
                },
            };
        }
    },

    // ── 47. detectRecurringPatterns ──────────────────────────────────────────
    // Analyzes order history for repeating patterns and saves templates
    {
        type: 'function',
        function: {
            name: 'detectRecurringPatterns',
            description: 'كشف أنماط الطلبات المتكررة: يحلل طلبات كل عميل في آخر 90 يوم، يكتشف الأنماط المتكررة (نفس المنتجات + نفس الكميات)، ويحفظها كقوالب. استخدمه عندما يقول المستخدم "أنماط متكررة" أو "طلبات دورية" أو "عملاء بنمط ثابت".',
            parameters: {
                type: 'object',
                properties: {
                    client_name: { type: 'string', description: 'اسم العميل — اختياري، لتحليل عميل معين' },
                    min_occurrences: { type: 'integer', description: 'الحد الأدنى لتكرار النمط (افتراضي 2)' }
                }
            }
        },
        async execute(args, user) {
            if (!await featureFlags.isEnabled('ai_recurring')) {
                return { error: 'ميزة كشف الأنماط المتكررة معطلة بواسطة الإدارة' };
            }
            const { client_name, min_occurrences = 2 } = args;

            let clientFilter = '';
            let params = [];
            if (client_name) {
                clientFilter = `AND c.name ILIKE $1`;
                params = [`%${client_name}%`];
            }

            // Get all orders with items for last 90 days, grouped by client
            const ordersRes = await db.query(
                `SELECT o.id, o.client_id, c.name as client_name,
                        o.created_at, o.status,
                        json_agg(
                            json_build_object(
                                'variant_id', oi.variant_id,
                                'product_name', p.name,
                                'size_name', pv.size_name,
                                'quantity', oi.quantity,
                                'unit_price', oi.unit_price
                            ) ORDER BY p.name
                        ) as items
                 FROM orders o
                 JOIN clients c ON c.id = o.client_id
                 JOIN order_items oi ON oi.order_id = o.id
                 JOIN product_variants pv ON pv.id = oi.variant_id
                 JOIN products p ON p.id = pv.product_id
                 WHERE o.status NOT IN ('cancelled', 'draft')
                   AND o.created_at >= NOW() - INTERVAL '90 days'
                   ${clientFilter}
                 GROUP BY o.id, o.client_id, c.name, o.created_at, o.status
                 ORDER BY c.name, o.created_at`,
                params
            );

            if (ordersRes.rows.length === 0) return { error: 'لا توجد طلبات كافية للتحليل' };

            // Group orders by client
            const clientOrders = {};
            for (const order of ordersRes.rows) {
                if (!clientOrders[order.client_id]) {
                    clientOrders[order.client_id] = {
                        client_id: order.client_id,
                        client_name: order.client_name,
                        orders: [],
                    };
                }
                clientOrders[order.client_id].orders.push(order);
            }

            const detectedPatterns = [];

            for (const { client_id, client_name, orders } of Object.values(clientOrders)) {
                if (orders.length < min_occurrences) continue;

                // Create a signature for each order based on variant_id + quantity
                const orderSignatures = orders.map(order => {
                    const sig = order.items
                        .map(i => `${i.variant_id}:${i.quantity}`)
                        .sort()
                        .join('|');
                    return { order_id: order.id, signature: sig, created_at: order.created_at, items: order.items };
                });

                // Find repeating signatures
                const sigCounts = {};
                for (const os of orderSignatures) {
                    if (!sigCounts[os.signature]) {
                        sigCounts[os.signature] = [];
                    }
                    sigCounts[os.signature].push(os);
                }

                for (const [sig, occurrences] of Object.entries(sigCounts)) {
                    if (occurrences.length >= min_occurrences) {
                        // Calculate average interval
                        const dates = occurrences.map(o => new Date(o.created_at).getTime()).sort();
                        let avgInterval = 0;
                        if (dates.length >= 2) {
                            let totalDays = 0;
                            for (let i = 1; i < dates.length; i++) {
                                totalDays += (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24);
                            }
                            avgInterval = Math.round(totalDays / (dates.length - 1));
                        }

                        const lastOccurrence = occurrences[occurrences.length - 1];
                        const items = lastOccurrence.items;

                        // Check if template already exists
                        const existingRes = await db.query(
                            `SELECT id FROM recurring_order_templates
                             WHERE client_id = $1 AND items::text = $2::text AND is_active = true
                             LIMIT 1`,
                            [client_id, JSON.stringify(items.map(i => ({ variant_id: i.variant_id, quantity: i.quantity, unit_price: i.unit_price })))]
                        );

                        if (existingRes.rows.length === 0) {
                            // Save new template
                            await db.query(
                                `INSERT INTO recurring_order_templates
                                 (client_id, template_name, items, interval_days, last_order_date, last_order_id, occurrence_count, is_active, created_by)
                                 VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, true, $8)`,
                                [
                                    client_id,
                                    `${client_name} — ${items.length} أصناف`,
                                    JSON.stringify(items.map(i => ({ variant_id: i.variant_id, quantity: i.quantity, unit_price: i.unit_price }))),
                                    avgInterval || 30,
                                    lastOccurrence.created_at,
                                    lastOccurrence.order_id,
                                    occurrences.length,
                                    user.id,
                                ]
                            );
                        } else {
                            // Update existing template
                            await db.query(
                                `UPDATE recurring_order_templates
                                 SET occurrence_count = $1, last_order_date = $2, last_order_id = $3, interval_days = $4, updated_at = NOW()
                                 WHERE id = $5`,
                                [occurrences.length, lastOccurrence.created_at, lastOccurrence.order_id, avgInterval || 30, existingRes.rows[0].id]
                            );
                        }

                        detectedPatterns.push({
                            client_name,
                            occurrence_count: occurrences.length,
                            interval_days: avgInterval,
                            items: items.map(i => ({
                                product_name: i.product_name,
                                size_name: i.size_name,
                                quantity: i.quantity,
                                unit_price: i.unit_price,
                            })),
                            last_order_date: lastOccurrence.created_at,
                        });
                    }
                }
            }

            return {
                analysis_date: new Date().toISOString(),
                clients_analyzed: Object.keys(clientOrders).length,
                patterns_detected: detectedPatterns.length,
                patterns: detectedPatterns.sort((a, b) => b.occurrence_count - a.occurrence_count),
                _explanation: {
                    why: `تم تحليل ${Object.keys(clientOrders).length} عميل و ${ordersRes.rows.length} طلب. اكتشف ${detectedPatterns.length} نمط متكرر بحد أدنى ${min_occurrences} مرات.`,
                    confidence: detectedPatterns.length > 0 ? 80 : 50,
                    factors: [
                        { factor: 'العملاء المحللين', value: Object.keys(clientOrders).length, weight: 'high' },
                        { factor: 'الطلبات المحللة', value: ordersRes.rows.length, weight: 'high' },
                        { factor: 'الأنماط المكتشفة', value: detectedPatterns.length, weight: 'high' },
                    ],
                },
            };
        }
    },

    // ── 48. getRecurringTemplates ────────────────────────────────────────────
    // Retrieves saved recurring order templates
    {
        type: 'function',
        function: {
            name: 'getRecurringTemplates',
            description: 'عرض قوالب الطلبات المتكررة المحفوظة: يسترجع القوالب النشطة مع تفاصيل الأصناف وفترة التكرار. استخدمه عندما يقول المستخدم "القوالب المتكررة" أو "الطلبات الدورية".',
            parameters: {
                type: 'object',
                properties: {
                    client_name: { type: 'string', description: 'اسم العميل — اختياري، لفلترة القوالب' }
                }
            }
        },
        async execute(args, user) {
            if (!await featureFlags.isEnabled('ai_recurring')) {
                return { error: 'ميزة القوالب المتكررة معطلة بواسطة الإدارة' };
            }
            const { client_name } = args;

            let query, params;
            if (client_name) {
                query = `
                    SELECT rot.id, rot.template_name, rot.items, rot.interval_days,
                           rot.last_order_date, rot.occurrence_count, rot.is_active,
                           c.name as client_name
                    FROM recurring_order_templates rot
                    JOIN clients c ON c.id = rot.client_id
                    WHERE rot.is_active = true AND c.name ILIKE $1
                    ORDER BY rot.occurrence_count DESC, rot.last_order_date DESC
                `;
                params = [`%${client_name}%`];
            } else {
                query = `
                    SELECT rot.id, rot.template_name, rot.items, rot.interval_days,
                           rot.last_order_date, rot.occurrence_count, rot.is_active,
                           c.name as client_name
                    FROM recurring_order_templates rot
                    JOIN clients c ON c.id = rot.client_id
                    WHERE rot.is_active = true
                    ORDER BY rot.occurrence_count DESC, rot.last_order_date DESC
                `;
                params = [];
            }

            const res = await db.query(query, params);

            if (res.rows.length === 0) return { error: 'لا توجد قوالب متكررة محفوظة. استخدم detectRecurringPatterns لاكتشافها.' };

            // Enrich items with product names
            const templates = [];
            for (const row of res.rows) {
                const items = Array.isArray(row.items) ? row.items : JSON.parse(row.items);
                const enrichedItems = [];
                for (const item of items) {
                    const productRes = await db.query(
                        `SELECT p.name as product_name, pv.size_name, pv.sku
                         FROM product_variants pv
                         JOIN products p ON p.id = pv.product_id
                         WHERE pv.id = $1`,
                        [item.variant_id]
                    );
                    enrichedItems.push({
                        product_name: productRes.rows[0]?.product_name || 'غير معروف',
                        size_name: productRes.rows[0]?.size_name || null,
                        sku: productRes.rows[0]?.sku || null,
                        quantity: item.quantity,
                        unit_price: item.unit_price,
                    });
                }

                // Calculate next expected order date
                const lastDate = new Date(row.last_order_date);
                const nextDate = new Date(lastDate.getTime() + row.interval_days * 24 * 60 * 60 * 1000);
                const daysUntilNext = Math.ceil((nextDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

                templates.push({
                    id: row.id,
                    client_name: row.client_name,
                    template_name: row.template_name,
                    interval_days: row.interval_days,
                    occurrence_count: row.occurrence_count,
                    last_order_date: row.last_order_date,
                    next_expected_date: nextDate.toISOString(),
                    days_until_next: daysUntilNext,
                    status: daysUntilNext <= 0 ? 'overdue' : daysUntilNext <= 7 ? 'due_soon' : 'upcoming',
                    items: enrichedItems,
                });
            }

            return {
                retrieved_at: new Date().toISOString(),
                total_templates: templates.length,
                overdue_count: templates.filter(t => t.status === 'overdue').length,
                due_soon_count: templates.filter(t => t.status === 'due_soon').length,
                templates,
            };
        }
    },

    // ── 49. getDiscountDecision ──────────────────────────────────────────────
    // Decision engine: evaluates discount requests and gives recommendation
    {
        type: 'function',
        function: {
            name: 'getDiscountDecision',
            description: 'محرك القرارات: يقيم طلب خصم من عميل ويوصي بقبوله أو رفضه أو التفاوض. يحلل الهامش، تاريخ العميل، حجم التعامل، والحد الأدنى للربح. استخدمه عندما يقول المستخدم "العميل طلب خصم" أو "أعطيه كام خصم؟".',
            parameters: {
                type: 'object',
                properties: {
                    client_name: { type: 'string', description: 'اسم العميل' },
                    order_total: { type: 'number', description: 'إجمالي الطلب قبل الخصم' },
                    requested_discount_pct: { type: 'number', description: 'نسبة الخصم المطلوبة (مثال: 10 لـ 10%)' },
                    cost_estimate: { type: 'number', description: 'تكلفة الطلب التقديرية — اختياري، سيحسب تلقائياً لو لم يحدد' }
                },
                required: ['client_name', 'order_total', 'requested_discount_pct']
            }
        },
        async execute(args, user) {
            if (!await featureFlags.isEnabled('ai_discount_decision')) {
                return { error: 'ميزة محرك قرارات الخصم معطلة بواسطة الإدارة' };
            }
            const { client_name, order_total, requested_discount_pct, cost_estimate } = args;

            // Find client
            const clientRes = await db.query(
                `SELECT id, name, credit_limit, status, parent_id FROM clients WHERE name ILIKE $1 AND status = 'active' LIMIT 1`,
                [`%${client_name}%`]
            );
            if (clientRes.rows.length === 0) return { error: 'العميل غير موجود' };
            const client = clientRes.rows[0];

            // Get client's purchase history (last 12 months)
            const historyRes = await db.query(
                `SELECT COUNT(*) as order_count,
                        COALESCE(SUM(grand_total), 0)::numeric as total_purchases,
                        COALESCE(AVG(grand_total), 0)::numeric as avg_order_value
                 FROM orders
                 WHERE client_id = $1 AND status NOT IN ('cancelled', 'draft')
                   AND created_at >= NOW() - INTERVAL '365 days'`,
                [client.id]
            );
            const history = historyRes.rows[0];
            const orderCount = parseInt(history.order_count || 0);
            const totalPurchases = parseFloat(history.total_purchases || 0);
            const avgOrder = parseFloat(history.avg_order_value || 0);

            // Payment timeliness
            const payTimeRes = await db.query(
                `SELECT AVG(EXTRACT(DAY FROM ct.created_at - i.invoice_date))::numeric as avg_days_to_pay,
                        COUNT(*) as payment_count
                 FROM client_transactions ct
                 JOIN invoices i ON i.id = ct.invoice_id
                 WHERE ct.type = 'payment' AND i.client_id = $1
                   AND ct.created_at >= NOW() - INTERVAL '180 days'`,
                [client.id]
            );
            const avgDaysToPay = parseFloat(payTimeRes.rows[0].avg_days_to_pay || 0);
            const paymentCount = parseInt(payTimeRes.rows[0].payment_count || 0);

            // Calculate cost if not provided
            let cost = cost_estimate;
            if (cost === undefined || cost === null) {
                // Estimate cost as 70% of order total (conservative estimate)
                cost = order_total * 0.7;
            }

            // Calculate margins
            const currentMargin = order_total > 0 ? ((order_total - cost) / order_total * 100) : 0;
            const discountAmount = order_total * (requested_discount_pct / 100);
            const discountedTotal = order_total - discountAmount;
            const discountedMargin = discountedTotal > 0 ? ((discountedTotal - cost) / discountedTotal * 100) : 0;
            const minAcceptableMargin = 15; // 15% minimum

            // Decision logic
            let decision = 'reject';
            let recommendedDiscount = 0;
            let reasons = [];

            // Factor 1: Client value (tier)
            let clientTier = 'regular';
            if (totalPurchases >= 100000 && avgDaysToPay <= 30) {
                clientTier = 'vip';
                reasons.push(`عميل VIP: مشتريات ${Math.round(totalPurchases)} ر.س سنة، التزام دفع`);
            } else if (totalPurchases >= 50000) {
                clientTier = 'good';
                reasons.push(`عميل جيد: مشتريات ${Math.round(totalPurchases)} ر.س سنة`);
            } else if (orderCount === 0) {
                clientTier = 'new';
                reasons.push(`عميل جديد: لا يوجد تاريخ تعامل`);
            } else {
                reasons.push(`عميل منتظم: ${orderCount} طلب، ${Math.round(totalPurchases)} ر.س`);
            }

            // Factor 2: Margin analysis
            reasons.push(`الهامش الحالي: ${Math.round(currentMargin)}%، بعد الخصم: ${Math.round(discountedMargin)}%`);

            // Factor 3: Order size relative to average
            if (order_total > avgOrder * 1.5 && avgOrder > 0) {
                reasons.push(`طلب أكبر من المتوسط (${Math.round(avgOrder)} ر.س) — مرن في الخصم`);
            }

            // Decision matrix
            if (discountedMargin >= minAcceptableMargin) {
                // Margin still acceptable
                if (clientTier === 'vip' && requested_discount_pct <= 15) {
                    decision = 'approve';
                    recommendedDiscount = requested_discount_pct;
                    reasons.push(`العميل VIP والهامش بعد الخصم (${Math.round(discountedMargin)}%) فوق الحد الأدنى (${minAcceptableMargin}%) → موافقة`);
                } else if (clientTier === 'good' && requested_discount_pct <= 10) {
                    decision = 'approve';
                    recommendedDiscount = requested_discount_pct;
                    reasons.push(`العميل جيد والخصم معقول → موافقة`);
                } else if (discountedMargin >= 20) {
                    decision = 'approve';
                    recommendedDiscount = requested_discount_pct;
                    reasons.push(`الهامش بعد الخصم (${Math.round(discountedMargin)}%) مريح → موافقة`);
                } else {
                    // Counter-offer
                    const maxDiscount = ((order_total - cost) / order_total - minAcceptableMargin / 100) * 100;
                    recommendedDiscount = Math.max(0, Math.min(maxDiscount, requested_discount_pct));
                    decision = 'negotiate';
                    reasons.push(`الهامش بعد الخصم (${Math.round(discountedMargin)}%) قريب من الحد الأدنى → اقترح خصم ${Math.round(recommendedDiscount)}% بدلاً من ذلك`);
                }
            } else {
                // Margin too low
                const maxDiscount = ((order_total - cost) / order_total - minAcceptableMargin / 100) * 100;
                if (maxDiscount > 0) {
                    recommendedDiscount = Math.round(maxDiscount * 100) / 100;
                    decision = 'negotiate';
                    reasons.push(`الخصم المطلوب (${requested_discount_pct}%) يخفض الهامش لـ ${Math.round(discountedMargin)}% — تحت الحد الأدنى. أقصى خصم ممكن: ${recommendedDiscount}%`);
                } else {
                    decision = 'reject';
                    recommendedDiscount = 0;
                    reasons.push(`لا يمكن منح أي خصم — التكلفة (${Math.round(cost)} ر.س) قريبة من السعر (${order_total} ر.س)`);
                }
            }

            return {
                client_name: client.name,
                client_tier: clientTier,
                order_total: Math.round(order_total * 100) / 100,
                cost: Math.round(cost * 100) / 100,
                requested_discount_pct: requested_discount_pct,
                recommended_discount_pct: recommendedDiscount,
                current_margin_pct: Math.round(currentMargin * 100) / 100,
                discounted_margin_pct: Math.round(discountedMargin * 100) / 100,
                min_acceptable_margin_pct: minAcceptableMargin,
                decision: decision,
                recommendation: decision === 'approve'
                    ? `وافق على خصم ${requested_discount_pct}%`
                    : decision === 'negotiate'
                    ? `تفاوض: اقترح خصم ${recommendedDiscount}% بدلاً من ${requested_discount_pct}%`
                    : `ارفض — الهامش لا يسمح`,
                reasons: reasons,
                client_stats: {
                    total_purchases_12m: Math.round(totalPurchases * 100) / 100,
                    order_count_12m: orderCount,
                    avg_order_value: Math.round(avgOrder * 100) / 100,
                    avg_days_to_pay: Math.round(avgDaysToPay),
                    payment_history_count: paymentCount,
                },
                _explanation: {
                    why: `قرار الخصم للعميل ${client.name}: طلب ${requested_discount_pct}%، الهامش الحالي ${Math.round(currentMargin)}% → بعد الخصم ${Math.round(discountedMargin)}%. العميل ${clientTier}. القرار: ${decision}.`,
                    confidence: orderCount >= 5 ? 85 : orderCount >= 2 ? 65 : 40,
                    factors: [
                        { factor: 'الهامش الحالي', value: Math.round(currentMargin) + '%', weight: 'high' },
                        { factor: 'الهامش بعد الخصم', value: Math.round(discountedMargin) + '%', weight: 'high' },
                        { factor: 'تصنيف العميل', value: clientTier, weight: 'high' },
                        { factor: 'إجمالي مشتريات 12 شهر', value: Math.round(totalPurchases), weight: 'medium' },
                        { factor: 'متوسط أيام الدفع', value: Math.round(avgDaysToPay), weight: paymentCount > 0 ? 'medium' : 'low' },
                    ],
                },
            };
        }
    },

    // ── 50. getRootCauseAnalysis ─────────────────────────────────────────────
    // Root cause analysis: "why did sales drop?" etc.
    {
        type: 'function',
        function: {
            name: 'getRootCauseAnalysis',
            description: 'تحليل سببي: يجيب على سؤال "ليه؟" — ليه المبيعات قلت؟ ليه الأرباح نزلت؟ يحلل الأسباب المحتملة ويربط الأحداث ببعض. استخدمه عندما يسأل المستخدم "ليه" أو "سبب" أو "تحليل سببي".',
            parameters: {
                type: 'object',
                properties: {
                    metric: { type: 'string', enum: ['sales', 'profit', 'collections', 'orders'], description: 'المؤشر المراد تحليله' },
                    comparison: { type: 'string', enum: ['month', 'quarter'], description: 'فترة المقارنة (افتراضي month)' }
                },
                required: ['metric']
            }
        },
        async execute(args, user) {
            if (!await featureFlags.isEnabled('ai_root_cause')) {
                return { error: 'ميزة التحليل السببي معطلة بواسطة الإدارة' };
            }
            const { metric, comparison = 'month' } = args;

            const interval = comparison === 'quarter' ? '90 days' : '30 days';
            const label = comparison === 'quarter' ? 'ربع سنة' : 'شهر';

            // Current period vs previous period
            let currentRes, previousRes;
            let metricLabel = '';

            if (metric === 'sales') {
                metricLabel = 'المبيعات';
                currentRes = await db.query(
                    `SELECT COALESCE(SUM(grand_total), 0)::numeric as value, COUNT(*) as count
                     FROM orders WHERE status NOT IN ('cancelled', 'draft')
                       AND created_at >= NOW() - INTERVAL '${interval}'`
                );
                previousRes = await db.query(
                    `SELECT COALESCE(SUM(grand_total), 0)::numeric as value, COUNT(*) as count
                     FROM orders WHERE status NOT IN ('cancelled', 'draft')
                       AND created_at >= NOW() - INTERVAL '${parseInt(interval) * 2} days'
                       AND created_at < NOW() - INTERVAL '${interval}'`
                );
            } else if (metric === 'profit') {
                metricLabel = 'الأرباح';
                currentRes = await db.query(
                    `SELECT COALESCE(SUM(oi.line_total - oi.quantity * pv.cost_price), 0)::numeric as value, COUNT(*) as count
                     FROM order_items oi
                     JOIN orders o ON o.id = oi.order_id
                     JOIN product_variants pv ON pv.id = oi.variant_id
                     WHERE o.status NOT IN ('cancelled', 'draft', 'quote')
                       AND o.created_at >= NOW() - INTERVAL '${interval}'`
                );
                previousRes = await db.query(
                    `SELECT COALESCE(SUM(oi.line_total - oi.quantity * pv.cost_price), 0)::numeric as value, COUNT(*) as count
                     FROM order_items oi
                     JOIN orders o ON o.id = oi.order_id
                     JOIN product_variants pv ON pv.id = oi.variant_id
                     WHERE o.status NOT IN ('cancelled', 'draft', 'quote')
                       AND o.created_at >= NOW() - INTERVAL '${parseInt(interval) * 2} days'
                       AND o.created_at < NOW() - INTERVAL '${interval}'`
                );
            } else if (metric === 'collections') {
                metricLabel = 'تحصيل الديون';
                currentRes = await db.query(
                    `SELECT COALESCE(SUM(amount), 0)::numeric as value, COUNT(*) as count
                     FROM client_transactions WHERE type = 'payment'
                       AND created_at >= NOW() - INTERVAL '${interval}'`
                );
                previousRes = await db.query(
                    `SELECT COALESCE(SUM(amount), 0)::numeric as value, COUNT(*) as count
                     FROM client_transactions WHERE type = 'payment'
                       AND created_at >= NOW() - INTERVAL '${parseInt(interval) * 2} days'
                       AND created_at < NOW() - INTERVAL '${interval}'`
                );
            } else {
                metricLabel = 'عدد الطلبات';
                currentRes = await db.query(
                    `SELECT COALESCE(SUM(grand_total), 0)::numeric as value, COUNT(*) as count
                     FROM orders WHERE status NOT IN ('cancelled', 'draft')
                       AND created_at >= NOW() - INTERVAL '${interval}'`
                );
                previousRes = await db.query(
                    `SELECT COALESCE(SUM(grand_total), 0)::numeric as value, COUNT(*) as count
                     FROM orders WHERE status NOT IN ('cancelled', 'draft')
                       AND created_at >= NOW() - INTERVAL '${parseInt(interval) * 2} days'
                       AND created_at < NOW() - INTERVAL '${interval}'`
                );
            }

            const currentValue = parseFloat(currentRes.rows[0].value || 0);
            const previousValue = parseFloat(previousRes.rows[0].value || 0);
            const currentCount = parseInt(currentRes.rows[0].count || 0);
            const previousCount = parseInt(previousRes.rows[0].count || 0);
            const changePct = previousValue > 0 ? ((currentValue - previousValue) / previousValue * 100) : 0;
            const isDecrease = currentValue < previousValue;

            // Find potential causes
            const causes = [];

            // Cause 1: Clients who stopped ordering
            const inactiveClientsRes = await db.query(
                `SELECT c.name, MAX(o.created_at) as last_order,
                        COALESCE(SUM(o.grand_total), 0)::numeric as total_before
                 FROM clients c
                 JOIN orders o ON o.client_id = c.id AND o.status NOT IN ('cancelled', 'draft')
                 WHERE c.status = 'active' AND c.parent_id IS NULL
                   AND o.created_at < NOW() - INTERVAL '${interval}'
                 GROUP BY c.name
                 HAVING MAX(o.created_at) < NOW() - INTERVAL '${interval}'`
            );
            if (inactiveClientsRes.rows.length > 0 && isDecrease) {
                causes.push({
                    cause: 'عملاء توقفوا عن الطلب',
                    severity: 'high',
                    details: `${inactiveClientsRes.rows.length} عميل لم يطلب في ${label} الحالي`,
                    clients: inactiveClientsRes.rows.slice(0, 5).map(r => ({
                        name: r.name,
                        last_order: r.last_order,
                        previous_value: parseFloat(r.total_before || 0),
                    })),
                });
            }

            // Cause 2: Out-of-stock products
            const stockoutRes = await db.query(
                `SELECT p.name, pv.size_name, ws.quantity
                 FROM warehouse_stock ws
                 JOIN product_variants pv ON pv.id = ws.variant_id
                 JOIN products p ON p.id = pv.product_id
                 WHERE ws.quantity <= 0
                 LIMIT 10`
            );
            if (stockoutRes.rows.length > 0 && isDecrease) {
                causes.push({
                    cause: 'منتجات نفدت من المخزون',
                    severity: 'high',
                    details: `${stockoutRes.rows.length} صنف غير متوفر — يمنع البيع`,
                    products: stockoutRes.rows,
                });
            }

            // Cause 3: Business events in the period
            const eventsRes = await db.query(
                `SELECT event_type, COUNT(*) as count
                 FROM business_events
                 WHERE created_at >= NOW() - INTERVAL '${interval}'
                 GROUP BY event_type
                 ORDER BY count DESC
                 LIMIT 10`
            );
            if (eventsRes.rows.length > 0) {
                causes.push({
                    cause: 'أحداث في الفترة',
                    severity: 'info',
                    details: `${eventsRes.rows.length} أنواع أحداث في ${label} الحالي`,
                    events: eventsRes.rows,
                });
            }

            // Cause 4: Average order value change
            const currentAvg = currentCount > 0 ? currentValue / currentCount : 0;
            const previousAvg = previousCount > 0 ? previousValue / previousCount : 0;
            const avgChangePct = previousAvg > 0 ? ((currentAvg - previousAvg) / previousAvg * 100) : 0;
            if (Math.abs(avgChangePct) > 10) {
                causes.push({
                    cause: avgChangePct < 0 ? 'انخفاض متوسط قيمة الطلب' : 'ارتفاع متوسط قيمة الطلب',
                    severity: 'medium',
                    details: `متوسط الطلب: ${Math.round(currentAvg)} ر.س مقابل ${Math.round(previousAvg)} ر.س (${Math.round(avgChangePct)}%)`,
                });
            }

            // Cause 5: Order count change
            const countChangePct = previousCount > 0 ? ((currentCount - previousCount) / previousCount * 100) : 0;
            if (Math.abs(countChangePct) > 10) {
                causes.push({
                    cause: countChangePct < 0 ? 'انخفاض عدد الطلبات' : 'ارتفاع عدد الطلبات',
                    severity: 'medium',
                    details: `${currentCount} طلب مقابل ${previousCount} طلب (${Math.round(countChangePct)}%)`,
                });
            }

            return {
                analysis_date: new Date().toISOString(),
                metric: metricLabel,
                comparison_period: label,
                current_value: Math.round(currentValue * 100) / 100,
                previous_value: Math.round(previousValue * 100) / 100,
                change_pct: Math.round(changePct * 100) / 100,
                direction: isDecrease ? 'decrease' : 'increase',
                current_order_count: currentCount,
                previous_order_count: previousCount,
                current_avg_order: Math.round(currentAvg * 100) / 100,
                previous_avg_order: Math.round(previousAvg * 100) / 100,
                causes_found: causes.length,
                causes,
                conclusion: isDecrease
                    ? `${metricLabel} انخفضت ${Math.abs(Math.round(changePct))}% مقارنة بـ${label} السابق. الأسباب المحتملة: ${causes.map(c => c.cause).join('، ') || 'غير محدد'}.`
                    : `${metricLabel} ارتفعت ${Math.round(changePct)}% مقارنة بـ${label} السابق.`,
                _explanation: {
                    why: `تمت مقارنة ${metricLabel} في ${label} الحالي (${Math.round(currentValue)}) مع ${label} السابق (${Math.round(previousValue)}). التغير: ${Math.round(changePct)}%. تم تحديد ${causes.length} سبب محتمل.`,
                    confidence: 75,
                    factors: [
                        { factor: 'القيمة الحالية', value: Math.round(currentValue), weight: 'high' },
                        { factor: 'القيمة السابقة', value: Math.round(previousValue), weight: 'high' },
                        { factor: 'نسبة التغير', value: Math.round(changePct) + '%', weight: 'high' },
                        { factor: 'عدد الأسباب', value: causes.length, weight: 'medium' },
                    ],
                },
            };
        }
    },

    // ── 51. getKPIStatus ─────────────────────────────────────────────────────
    // KPI Engine: monitors key performance indicators and alerts on deviation
    {
        type: 'function',
        function: {
            name: 'getKPIStatus',
            description: 'محرك مؤشرات الأداء: يراقب KPIs (الإيرادات، الأرباح، التحصيل، الإنتاج، دوران المخزون، التسليم) وينبه عند الانحراف > 15%. استخدمه عندما يقول المستخدم "مؤشرات الأداء" أو "KPIs" أو "كيف أداء الشركة؟".',
            parameters: {
                type: 'object',
                properties: {
                    period: { type: 'string', enum: ['week', 'month', 'quarter'], description: 'الفترة (افتراضي month)' }
                }
            }
        },
        async execute(args, user) {
            if (!await featureFlags.isEnabled('ai_kpi_engine')) {
                return { error: 'ميزة مؤشرات الأداء معطلة بواسطة الإدارة' };
            }
            const { period = 'month' } = args;
            const interval = period === 'quarter' ? '90 days' : period === 'week' ? '7 days' : '30 days';
            const label = period === 'quarter' ? 'ربع سنة' : period === 'week' ? 'أسبوع' : 'شهر';

            const kpis = [];

            // KPI 1: Revenue
            const revenueRes = await db.query(
                `SELECT COALESCE(SUM(grand_total), 0)::numeric as actual
                 FROM orders WHERE status NOT IN ('cancelled', 'draft')
                   AND created_at >= NOW() - INTERVAL '${interval}'`
            );
            const revenueActual = parseFloat(revenueRes.rows[0].actual || 0);
            // Target: based on previous period + 10% growth expectation
            const prevRevenueRes = await db.query(
                `SELECT COALESCE(SUM(grand_total), 0)::numeric as prev
                 FROM orders WHERE status NOT IN ('cancelled', 'draft')
                   AND created_at >= NOW() - INTERVAL '${parseInt(interval) * 2} days'
                   AND created_at < NOW() - INTERVAL '${interval}'`
            );
            const revenuePrev = parseFloat(prevRevenueRes.rows[0].prev || 0);
            const revenueTarget = revenuePrev * 1.1; // 10% growth target
            const revenueDeviation = revenueTarget > 0 ? ((revenueActual - revenueTarget) / revenueTarget * 100) : 0;
            kpis.push({
                name: 'الإيرادات',
                actual: Math.round(revenueActual * 100) / 100,
                target: Math.round(revenueTarget * 100) / 100,
                deviation_pct: Math.round(revenueDeviation * 100) / 100,
                status: Math.abs(revenueDeviation) > 15 ? 'alert' : 'ok',
                unit: 'ر.س',
            });

            // KPI 2: Profit margin
            const profitRes = await db.query(
                `SELECT COALESCE(SUM(oi.line_total - oi.quantity * pv.cost_price), 0)::numeric as profit,
                        COALESCE(SUM(oi.line_total), 0)::numeric as revenue
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN product_variants pv ON pv.id = oi.variant_id
                 WHERE o.status NOT IN ('cancelled', 'draft', 'quote')
                   AND o.created_at >= NOW() - INTERVAL '${interval}'`
            );
            const profitActual = parseFloat(profitRes.rows[0].profit || 0);
            const profitRevenue = parseFloat(profitRes.rows[0].revenue || 0);
            const marginActual = profitRevenue > 0 ? (profitActual / profitRevenue * 100) : 0;
            const marginTarget = 25; // 25% target margin
            const marginDeviation = marginActual - marginTarget;
            kpis.push({
                name: 'هامش الربح',
                actual: Math.round(marginActual * 100) / 100,
                target: marginTarget,
                deviation_pct: Math.round(marginDeviation * 100) / 100,
                status: Math.abs(marginDeviation) > 15 ? 'alert' : 'ok',
                unit: '%',
            });

            // KPI 3: Collection rate
            const collectionRes = await db.query(
                `SELECT COALESCE(SUM(amount), 0)::numeric as collected
                 FROM client_transactions WHERE type = 'payment'
                   AND created_at >= NOW() - INTERVAL '${interval}'`
            );
            const invoicedRes = await db.query(
                `SELECT COALESCE(SUM(grand_total), 0)::numeric as invoiced
                 FROM invoices WHERE status != 'cancelled'
                   AND created_at >= NOW() - INTERVAL '${interval}'`
            );
            const collected = parseFloat(collectionRes.rows[0].collected || 0);
            const invoiced = parseFloat(invoicedRes.rows[0].invoiced || 0);
            const collectionRate = invoiced > 0 ? (collected / invoiced * 100) : 0;
            const collectionTarget = 80; // 80% collection target
            const collectionDeviation = collectionRate - collectionTarget;
            kpis.push({
                name: 'معدل التحصيل',
                actual: Math.round(collectionRate * 100) / 100,
                target: collectionTarget,
                deviation_pct: Math.round(collectionDeviation * 100) / 100,
                status: Math.abs(collectionDeviation) > 15 ? 'alert' : 'ok',
                unit: '%',
            });

            // KPI 4: Inventory turnover (simplified: sales / stock value)
            const stockValueRes = await db.query(
                `SELECT COALESCE(SUM(ws.quantity * pv.cost_price), 0)::numeric as stock_value
                 FROM warehouse_stock ws
                 JOIN product_variants pv ON pv.id = ws.variant_id
                 WHERE ws.quantity > 0`
            );
            const stockValue = parseFloat(stockValueRes.rows[0].stock_value || 0);
            const turnover = stockValue > 0 ? (profitRevenue / stockValue) : 0;
            const turnoverTarget = 2; // 2x per period
            const turnoverDeviation = turnoverTarget > 0 ? ((turnover - turnoverTarget) / turnoverTarget * 100) : 0;
            kpis.push({
                name: 'دوران المخزون',
                actual: Math.round(turnover * 100) / 100,
                target: turnoverTarget,
                deviation_pct: Math.round(turnoverDeviation * 100) / 100,
                status: Math.abs(turnoverDeviation) > 15 ? 'alert' : 'ok',
                unit: 'x',
            });

            // KPI 5: Order count
            const orderCountRes = await db.query(
                `SELECT COUNT(*) as count FROM orders
                 WHERE status NOT IN ('cancelled', 'draft')
                   AND created_at >= NOW() - INTERVAL '${interval}'`
            );
            const orderCount = parseInt(orderCountRes.rows[0].count || 0);
            const prevOrderCountRes = await db.query(
                `SELECT COUNT(*) as count FROM orders
                 WHERE status NOT IN ('cancelled', 'draft')
                   AND created_at >= NOW() - INTERVAL '${parseInt(interval) * 2} days'
                   AND created_at < NOW() - INTERVAL '${interval}'`
            );
            const prevOrderCount = parseInt(prevOrderCountRes.rows[0].count || 0);
            const orderTarget = prevOrderCount > 0 ? prevOrderCount : 10;
            const orderDeviation = orderTarget > 0 ? ((orderCount - orderTarget) / orderTarget * 100) : 0;
            kpis.push({
                name: 'عدد الطلبات',
                actual: orderCount,
                target: orderTarget,
                deviation_pct: Math.round(orderDeviation * 100) / 100,
                status: Math.abs(orderDeviation) > 15 ? 'alert' : 'ok',
                unit: 'طلب',
            });

            const alertCount = kpis.filter(k => k.status === 'alert').length;

            return {
                period: label,
                measured_at: new Date().toISOString(),
                total_kpis: kpis.length,
                alerts: alertCount,
                kpis,
                summary: alertCount > 0
                    ? `${alertCount} من ${kpis.length} مؤشر يحتاج انتباه (انحراف > 15%)`
                    : `كل المؤشرات ضمن النطاق المقبول`,
                _explanation: {
                    why: `تم قياس ${kpis.length} مؤشر أداء لـ${label}. ${alertCount} مؤشر ينحرف عن الهدف بأكثر من 15%.`,
                    confidence: 85,
                    factors: kpis.map(k => ({ factor: k.name, value: k.actual + ' ' + k.unit, weight: k.status === 'alert' ? 'high' : 'medium' })),
                },
            };
        }
    },

    // ── 52. simulateAction ───────────────────────────────────────────────────
    // AI Sandbox: simulates action impact without writing to DB
    {
        type: 'function',
        function: {
            name: 'simulateAction',
            description: 'بيئة محاكاة: يحاكي أثر إجراء قبل تنفيذه. مثال: "لو رفعت الأسعار 5%؟" أو "لو فقدت هذا العميل؟". يحسب الأثر المتوقع على المبيعات والأرباح بدون كتابة في DB. استخدمه عندما يقول المستخدم "لو" أو "ماذا لو" أو "حاكي".',
            parameters: {
                type: 'object',
                properties: {
                    scenario: { type: 'string', enum: ['price_increase', 'price_decrease', 'lose_client', 'lose_product', 'increase_inventory'], description: 'نوع السيناريو' },
                    pct: { type: 'number', description: 'نسبة التغيير (مثال: 5 لـ 5%)' },
                    client_name: { type: 'string', description: 'اسم العميل — لسيناريو lose_client' },
                    product_name: { type: 'string', description: 'اسم المنتج — لسيناريو lose_product' }
                },
                required: ['scenario']
            }
        },
        async execute(args, user) {
            if (!await featureFlags.isEnabled('ai_sandbox')) {
                return { error: 'ميزة بيئة المحاكاة معطلة بواسطة الإدارة' };
            }
            const { scenario, pct = 10, client_name, product_name } = args;

            // Get current baseline metrics
            const baselineRes = await db.query(
                `SELECT COALESCE(SUM(grand_total), 0)::numeric as monthly_revenue,
                        COUNT(DISTINCT o.id) as order_count
                 FROM orders o
                 WHERE o.status NOT IN ('cancelled', 'draft')
                   AND o.created_at >= NOW() - INTERVAL '30 days'`
            );
            const baselineRevenue = parseFloat(baselineRes.rows[0].monthly_revenue || 0);
            const baselineOrders = parseInt(baselineRes.rows[0].order_count || 0);

            const profitRes = await db.query(
                `SELECT COALESCE(SUM(oi.line_total - oi.quantity * pv.cost_price), 0)::numeric as profit
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN product_variants pv ON pv.id = oi.variant_id
                 WHERE o.status NOT IN ('cancelled', 'draft', 'quote')
                   AND o.created_at >= NOW() - INTERVAL '30 days'`
            );
            const baselineProfit = parseFloat(profitRes.rows[0].profit || 0);

            let projectedRevenue = baselineRevenue;
            let projectedProfit = baselineProfit;
            let projectedOrders = baselineOrders;
            let assumptions = [];
            let risks = [];

            if (scenario === 'price_increase') {
                // Assume 20% volume drop per 10% price increase (elasticity)
                const elasticity = 0.2 * (pct / 10);
                const volumeMultiplier = 1 - elasticity;
                projectedRevenue = baselineRevenue * (1 + pct / 100) * volumeMultiplier;
                projectedProfit = baselineProfit * (1 + pct / 100) * volumeMultiplier;
                projectedOrders = Math.round(baselineOrders * volumeMultiplier);
                assumptions.push(`زيادة سعر ${pct}% مع مرونة سعرية ${elasticity * 100}% (انخفاض حجم البيع)`);
                risks.push('العملاء قد يتحولون للمنافسين');
                risks.push('قد ينخفض عدد الطلبات بنسبة ' + Math.round(elasticity * 100) + '%');
            } else if (scenario === 'price_decrease') {
                // Assume 15% volume increase per 10% price decrease
                const volumeBoost = 0.15 * (pct / 10);
                const volumeMultiplier = 1 + volumeBoost;
                projectedRevenue = baselineRevenue * (1 - pct / 100) * volumeMultiplier;
                projectedProfit = baselineProfit * (1 - pct / 100) * volumeMultiplier;
                projectedOrders = Math.round(baselineOrders * volumeMultiplier);
                assumptions.push(`خفض سعر ${pct}% مع زيادة حجم متوقع ${Math.round(volumeBoost * 100)}%`);
                risks.push('قد لا يتحقق الزيادة المتوقعة في الحجم');
                risks.push('ضغط على الهامش');
            } else if (scenario === 'lose_client' && client_name) {
                const clientRes = await db.query(
                    `SELECT c.id, c.name,
                            COALESCE(SUM(o.grand_total), 0)::numeric as monthly_avg,
                            COUNT(o.id) as order_count
                     FROM clients c
                     LEFT JOIN orders o ON o.client_id = c.id AND o.status NOT IN ('cancelled', 'draft')
                         AND o.created_at >= NOW() - INTERVAL '90 days'
                     WHERE c.name ILIKE $1 AND c.status = 'active'
                     GROUP BY c.id, c.name`,
                    [`%${client_name}%`]
                );
                if (clientRes.rows.length === 0) return { error: 'العميل غير موجود' };
                const client = clientRes.rows[0];
                const clientRevenue = parseFloat(client.monthly_avg || 0) / 3; // monthly avg from 90 days
                projectedRevenue = baselineRevenue - clientRevenue;
                projectedProfit = baselineProfit - (clientRevenue * 0.25); // assume 25% margin
                projectedOrders = baselineOrders - Math.round(parseInt(client.order_count || 0) / 3);
                assumptions.push(`فقدان العميل ${client.name} بمتوسط شهري ${Math.round(clientRevenue)} ر.س`);
                risks.push('العملاء المرتبطين بهذا العميل قد يتأثرون');
                risks.push('الحصة السوقية تنخفض');
            } else if (scenario === 'lose_product' && product_name) {
                const prodRes = await db.query(
                    `SELECT COALESCE(SUM(oi.line_total), 0)::numeric as monthly_revenue,
                            COALESCE(SUM(oi.quantity), 0)::numeric as monthly_qty
                     FROM order_items oi
                     JOIN orders o ON o.id = oi.order_id
                     JOIN product_variants pv ON pv.id = oi.variant_id
                     JOIN products p ON p.id = pv.product_id
                     WHERE o.status NOT IN ('cancelled', 'draft', 'quote')
                       AND o.created_at >= NOW() - INTERVAL '30 days'
                       AND p.name ILIKE $1`,
                    [`%${product_name}%`]
                );
                if (prodRes.rows.length === 0 || parseFloat(prodRes.rows[0].monthly_revenue || 0) === 0) {
                    return { error: 'المنتج غير موجود أو لا يوجد مبيعات' };
                }
                const productRevenue = parseFloat(prodRes.rows[0].monthly_revenue || 0);
                projectedRevenue = baselineRevenue - productRevenue;
                projectedProfit = baselineProfit - (productRevenue * 0.25);
                assumptions.push(`فقدان المنتج "${product_name}" بمبيعات شهرية ${Math.round(productRevenue)} ر.س`);
                risks.push('العملاء الذين يشترون هذا المنتج قد يبحثون عن بديل');
                risks.push('مخزون قد يتراكم');
            } else if (scenario === 'increase_inventory') {
                const stockValueRes = await db.query(
                    `SELECT COALESCE(SUM(ws.quantity * pv.cost_price), 0)::numeric as current_value
                     FROM warehouse_stock ws
                     JOIN product_variants pv ON pv.id = ws.variant_id
                     WHERE ws.quantity > 0`
                );
                const currentStockValue = parseFloat(stockValueRes.rows[0].current_value || 0);
                const additionalInvestment = currentStockValue * (pct / 100);
                // Assume increased availability leads to 5% revenue boost per 10% inventory increase
                const revenueBoost = 0.05 * (pct / 10);
                projectedRevenue = baselineRevenue * (1 + revenueBoost);
                projectedProfit = baselineProfit * (1 + revenueBoost) - (additionalInvestment * 0.1); // carrying cost
                assumptions.push(`زيادة مخزون ${pct}% باستثمار ${Math.round(additionalInvestment)} ر.س`);
                assumptions.push(`زيادة متوقعة في الإيرادات ${Math.round(revenueBoost * 100)}%`);
                risks.push('تكلفة تخزين إضافية');
                risks.push('خطر بطء الحركة');
            }

            const revenueChange = projectedRevenue - baselineRevenue;
            const profitChange = projectedProfit - baselineProfit;
            const revenueChangePct = baselineRevenue > 0 ? (revenueChange / baselineRevenue * 100) : 0;
            const profitChangePct = baselineProfit > 0 ? (profitChange / baselineProfit * 100) : 0;

            return {
                scenario,
                simulated_at: new Date().toISOString(),
                baseline: {
                    monthly_revenue: Math.round(baselineRevenue * 100) / 100,
                    monthly_profit: Math.round(baselineProfit * 100) / 100,
                    order_count: baselineOrders,
                },
                projected: {
                    monthly_revenue: Math.round(projectedRevenue * 100) / 100,
                    monthly_profit: Math.round(projectedProfit * 100) / 100,
                    order_count: projectedOrders,
                },
                impact: {
                    revenue_change: Math.round(revenueChange * 100) / 100,
                    revenue_change_pct: Math.round(revenueChangePct * 100) / 100,
                    profit_change: Math.round(profitChange * 100) / 100,
                    profit_change_pct: Math.round(profitChangePct * 100) / 100,
                    order_count_change: projectedOrders - baselineOrders,
                },
                assumptions,
                risks,
                recommendation: revenueChange > 0 && profitChange > 0
                    ? 'السيناريو إيجابي — قد يكون مفيداً'
                    : revenueChange < 0 && profitChange < 0
                    ? 'السيناريو سلبي — يُنصح بالحذر'
                    : 'السيناريو متفاوت — راجع الافتراضات بعناية',
                _explanation: {
                    why: `محاكاة "${scenario}" بنسبة ${pct}%. الأثر: الإيراد ${revenueChangePct >= 0 ? '+' : ''}${Math.round(revenueChangePct)}%، الربح ${profitChangePct >= 0 ? '+' : ''}${Math.round(profitChangePct)}%.`,
                    confidence: 60,
                    factors: [
                        { factor: 'الإيراد الحالي', value: Math.round(baselineRevenue), weight: 'high' },
                        { factor: 'الربح الحالي', value: Math.round(baselineProfit), weight: 'high' },
                        { factor: 'تغير الإيراد', value: Math.round(revenueChangePct) + '%', weight: 'high' },
                        { factor: 'تغير الربح', value: Math.round(profitChangePct) + '%', weight: 'high' },
                    ],
                },
            };
        }
    },

    // ── 53. getTimelineReplay ────────────────────────────────────────────────
    // Timeline Replay: shows events for a specific period
    {
        type: 'function',
        function: {
            name: 'getTimelineReplay',
            description: 'إعادة عرض الزمن: يعرض أحداث فترة محددة يوم بيوم مع شرح كل حدث وربطه بالأحداث الأخرى. استخدمه عندما يقول المستخدم "وريني الأسبوع اللي فات" أو "أحداث أمس" أو "ملخص الفترة".',
            parameters: {
                type: 'object',
                properties: {
                    period: { type: 'string', enum: ['today', 'yesterday', 'week', 'month'], description: 'الفترة (افتراضي week)' }
                }
            }
        },
        async execute(args, user) {
            const { period = 'week' } = args;

            let interval, label;
            if (period === 'today') { interval = "DATE(created_at) = CURRENT_DATE"; label = 'اليوم'; }
            else if (period === 'yesterday') { interval = "DATE(created_at) = CURRENT_DATE - 1"; label = 'أمس'; }
            else if (period === 'week') { interval = "created_at >= NOW() - INTERVAL '7 days'"; label = 'الأسبوع'; }
            else { interval = "created_at >= NOW() - INTERVAL '30 days'"; label = 'الشهر'; }

            // Try business_events first
            let eventsRes;
            try {
                eventsRes = await db.query(
                    `SELECT id, event_type, entity_type, entity_id, description, created_at, metadata
                     FROM business_events
                     WHERE ${interval}
                     ORDER BY created_at DESC
                     LIMIT 100`
                );
            } catch (e) {
                eventsRes = { rows: [] };
            }

            // If no business_events, fallback to reconstructing from actual tables
            if (eventsRes.rows.length === 0) {
                const fallbackEvents = [];

                // Orders
                const ordersRes = await db.query(
                    `SELECT id, client_id, grand_total, status, created_at,
                            (SELECT name FROM clients WHERE id = orders.client_id) as client_name
                     FROM orders
                     WHERE ${interval.replace('created_at', 'orders.created_at')}
                     ORDER BY created_at DESC LIMIT 30`
                );
                for (const o of ordersRes.rows) {
                    fallbackEvents.push({
                        event_type: 'order_' + o.status,
                        entity_type: 'order',
                        entity_id: o.id,
                        description: `طلب من ${o.client_name || 'عميل'} — ${o.grand_total} ر.س (${o.status})`,
                        created_at: o.created_at,
                    });
                }

                // Invoices
                try {
                    const invRes = await db.query(
                        `SELECT i.id, i.invoice_number, i.grand_total, i.status, i.created_at,
                                (SELECT name FROM clients WHERE id = i.client_id) as client_name
                         FROM invoices i
                         WHERE ${interval.replace('created_at', 'i.created_at')}
                         ORDER BY i.created_at DESC LIMIT 20`
                    );
                    for (const inv of invRes.rows) {
                        fallbackEvents.push({
                            event_type: 'invoice_' + inv.status,
                            entity_type: 'invoice',
                            entity_id: inv.id,
                            description: `فاتورة ${inv.invoice_number} لـ ${inv.client_name || 'عميل'} — ${inv.grand_total} ر.س`,
                            created_at: inv.created_at,
                        });
                    }
                } catch (e) { /* invoices table might not exist */ }

                // Payments
                try {
                    const payRes = await db.query(
                        `SELECT ct.id, ct.amount, ct.created_at,
                                (SELECT name FROM clients WHERE id = ct.client_id) as client_name
                         FROM client_transactions ct
                         WHERE ct.type = 'payment' AND ${interval.replace('created_at', 'ct.created_at')}
                         ORDER BY ct.created_at DESC LIMIT 20`
                    );
                    for (const p of payRes.rows) {
                        fallbackEvents.push({
                            event_type: 'payment_received',
                            entity_type: 'payment',
                            entity_id: p.id,
                            description: `دفعة من ${p.client_name || 'عميل'} — ${p.amount} ر.س`,
                            created_at: p.created_at,
                        });
                    }
                } catch (e) { /* table might not exist */ }

                // Sort by created_at DESC
                fallbackEvents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                eventsRes = { rows: fallbackEvents.slice(0, 50) };
            }

            if (eventsRes.rows.length === 0) {
                return { error: `لا توجد أحداث في ${label}` };
            }

            // Group by day
            const byDay = {};
            for (const ev of eventsRes.rows) {
                const day = new Date(ev.created_at).toLocaleDateString('ar-SA');
                if (!byDay[day]) byDay[day] = [];
                byDay[day].push({
                    event_type: ev.event_type,
                    entity_type: ev.entity_type,
                    description: ev.description || ev.event_type,
                    time: new Date(ev.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
                });
            }

            // Build timeline
            const timeline = Object.entries(byDay).map(([day, events]) => ({
                day,
                event_count: events.length,
                events: events.sort((a, b) => a.time.localeCompare(b.time)),
            }));

            // Summary stats
            const typeCounts = {};
            for (const ev of eventsRes.rows) {
                typeCounts[ev.event_type] = (typeCounts[ev.event_type] || 0) + 1;
            }

            return {
                period: label,
                replayed_at: new Date().toISOString(),
                total_events: eventsRes.rows.length,
                days_covered: timeline.length,
                event_type_summary: typeCounts,
                timeline,
                _explanation: {
                    why: `تم استرجاع ${eventsRes.rows.length} حدث من ${label} موزعة على ${timeline.length} يوم.`,
                    confidence: 80,
                    factors: [
                        { factor: 'إجمالي الأحداث', value: eventsRes.rows.length, weight: 'high' },
                        { factor: 'الأيام المغطاة', value: timeline.length, weight: 'medium' },
                    ],
                },
            };
        }
    },

    // ── 54. getAIMetrics ─────────────────────────────────────────────────────
    // AI Metrics Dashboard: measures AI assistant performance
    {
        type: 'function',
        function: {
            name: 'getAIMetrics',
            description: 'لوحة أداء الـ AI: يقيس أداء المساعد الذكي — عدد المحادثات، نسبة نجاح الإجراءات، الاقتراحات المقبولة vs المرفوضة، أكثر الدوال استخداماً، متوسط زمن الرد. استخدمه عندما يقول المستخدم "أداء الـ AI" أو "إحصائيات المساعد".',
            parameters: {
                type: 'object',
                properties: {
                    period: { type: 'string', enum: ['week', 'month', 'quarter'], description: 'الفترة (افتراضي month)' }
                }
            }
        },
        async execute(args, user) {
            const { period = 'month' } = args;
            const interval = period === 'quarter' ? '90 days' : period === 'week' ? '7 days' : '30 days';
            const label = period === 'quarter' ? 'ربع سنة' : period === 'week' ? 'أسبوع' : 'شهر';

            // 1. Chat conversations count (session_id is in conversation_context, not ai_chat_history)
            let chatCount = 0;
            try {
                const chatRes = await db.query(
                    `SELECT COUNT(DISTINCT user_id) as count
                     FROM ai_chat_history
                     WHERE created_at >= NOW() - INTERVAL '${interval}'`
                );
                chatCount = parseInt(chatRes.rows[0].count || 0);
            } catch (e) { /* table might not exist */ }

            // 1b. Session count from conversation_context
            let sessionCount = 0;
            try {
                const sessRes = await db.query(
                    `SELECT COUNT(DISTINCT session_id) as count
                     FROM conversation_context
                     WHERE created_at >= NOW() - INTERVAL '${interval}'`
                );
                sessionCount = parseInt(sessRes.rows[0].count || 0);
            } catch (e) { /* table might not exist */ }

            // 2. Action success/failure
            const actionRes = await db.query(
                `SELECT status, COUNT(*) as count
                 FROM ai_action_log
                 WHERE created_at >= NOW() - INTERVAL '${interval}'
                 GROUP BY status`
            );
            const actionStats = {};
            let totalActions = 0;
            for (const r of actionRes.rows) {
                actionStats[r.status] = parseInt(r.count || 0);
                totalActions += parseInt(r.count || 0);
            }
            const successRate = totalActions > 0
                ? Math.round((actionStats.executed || 0) / totalActions * 100)
                : 0;

            // 3. Feedback stats
            let feedbackStats = { positive: 0, negative: 0 };
            try {
                const fbRes = await db.query(
                    `SELECT rating, COUNT(*) as count
                     FROM ai_feedback
                     WHERE created_at >= NOW() - INTERVAL '${interval}'
                     GROUP BY rating`
                );
                for (const r of fbRes.rows) {
                    feedbackStats[r.rating] = parseInt(r.count || 0);
                }
            } catch (e) { /* table might not exist */ }

            const totalFeedback = feedbackStats.positive + feedbackStats.negative;
            const satisfactionRate = totalFeedback > 0
                ? Math.round(feedbackStats.positive / totalFeedback * 100)
                : 0;

            // 4. Most used functions (from ai_action_log action_type)
            const funcRes = await db.query(
                `SELECT action_type, COUNT(*) as count
                 FROM ai_action_log
                 WHERE created_at >= NOW() - INTERVAL '${interval}'
                 GROUP BY action_type
                 ORDER BY count DESC
                 LIMIT 10`
            );
            const topActions = funcRes.rows.map(r => ({
                action_type: r.action_type,
                count: parseInt(r.count || 0),
            }));

            // 5. Errors
            const errorRes = await db.query(
                `SELECT error_message, COUNT(*) as count
                 FROM ai_action_log
                 WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '${interval}'
                   AND error_message IS NOT NULL
                 GROUP BY error_message
                 ORDER BY count DESC
                 LIMIT 5`
            );
            const topErrors = errorRes.rows.map(r => ({
                error: r.error_message,
                count: parseInt(r.count || 0),
            }));

            // 6. Briefing engagement
            let briefingCount = 0;
            try {
                const briefRes = await db.query(
                    `SELECT COUNT(*) as count FROM ai_briefings
                     WHERE created_at >= NOW() - INTERVAL '${interval}'`
                );
                briefingCount = parseInt(briefRes.rows[0].count || 0);
            } catch (e) { /* table might not exist */ }

            return {
                period: label,
                measured_at: new Date().toISOString(),
                conversations: chatCount,
                sessions: sessionCount,
                actions: {
                    total: totalActions,
                    by_status: actionStats,
                    success_rate: successRate,
                },
                feedback: {
                    positive: feedbackStats.positive,
                    negative: feedbackStats.negative,
                    satisfaction_rate: satisfactionRate,
                },
                top_actions: topActions,
                top_errors: topErrors,
                briefings_generated: briefingCount,
                summary: `${chatCount} محادثة، ${totalActions} إجراء (${successRate}% نجاح)، ${totalFeedback} تقييم (${satisfactionRate}% رضا) في ${label}`,
                _explanation: {
                    why: `تم قياس أداء الـ AI لـ${label}: ${chatCount} محادثة، ${totalActions} إجراء بنسبة نجاح ${successRate}%، رضا ${satisfactionRate}%.`,
                    confidence: 90,
                    factors: [
                        { factor: 'المحادثات', value: chatCount, weight: 'medium' },
                        { factor: 'الإجراءات', value: totalActions, weight: 'high' },
                        { factor: 'نسبة النجاح', value: successRate + '%', weight: 'high' },
                        { factor: 'الرضا', value: satisfactionRate + '%', weight: 'high' },
                    ],
                },
            };
        }
    },

    // ── 55. getGoalStatus ────────────────────────────────────────────────────
    // Goal Engine: tracks business goals and progress
    {
        type: 'function',
        function: {
            name: 'getGoalStatus',
            description: 'محرك الأهداف: يعرض الأهداف النشطة وحالة التقدم نحوها. يحسب النسبة المئوية لكل هدف ويقترح إجراءات للوصول. استخدمه عندما يقول المستخدم "الأهداف" أو "هدف الشهر" أو "كيف نحن مقابل الهدف؟".',
            parameters: {
                type: 'object',
                properties: {
                    include_completed: { type: 'boolean', description: 'تضمين الأهداف المكتملة (افتراضي false)' }
                }
            }
        },
        async execute(args, user) {
            const { include_completed = false } = args;

            const goalsRes = await db.query(
                `SELECT * FROM ai_goals WHERE ${include_completed ? "status IN ('active', 'completed')" : "status = 'active'"} ORDER BY end_date ASC`
            );

            if (goalsRes.rows.length === 0) {
                return {
                    goals: [],
                    summary: 'لا توجد أهداف نشطة. أنشئ هدفاً جديداً من خلال الإعدادات.',
                };
            }

            const goals = [];

            for (const goal of goalsRes.rows) {
                let currentValue = 0;

                // Calculate current value based on goal_type
                if (goal.goal_type === 'revenue') {
                    const res = await db.query(
                        `SELECT COALESCE(SUM(grand_total), 0)::numeric as val
                         FROM orders WHERE status NOT IN ('cancelled', 'draft')
                           AND created_at >= $1 AND created_at <= $2`,
                        [goal.start_date, goal.end_date]
                    );
                    currentValue = parseFloat(res.rows[0].val || 0);
                } else if (goal.goal_type === 'profit') {
                    const res = await db.query(
                        `SELECT COALESCE(SUM(oi.line_total - oi.quantity * pv.cost_price), 0)::numeric as val
                         FROM order_items oi
                         JOIN orders o ON o.id = oi.order_id
                         JOIN product_variants pv ON pv.id = oi.variant_id
                         WHERE o.status NOT IN ('cancelled', 'draft', 'quote')
                           AND o.created_at >= $1 AND o.created_at <= $2`,
                        [goal.start_date, goal.end_date]
                    );
                    currentValue = parseFloat(res.rows[0].val || 0);
                } else if (goal.goal_type === 'orders') {
                    const res = await db.query(
                        `SELECT COUNT(*) as val FROM orders
                         WHERE status NOT IN ('cancelled', 'draft')
                           AND created_at >= $1 AND created_at <= $2`,
                        [goal.start_date, goal.end_date]
                    );
                    currentValue = parseInt(res.rows[0].val || 0);
                } else if (goal.goal_type === 'collections') {
                    const res = await db.query(
                        `SELECT COALESCE(SUM(amount), 0)::numeric as val
                         FROM client_transactions WHERE type = 'payment'
                           AND created_at >= $1 AND created_at <= $2`,
                        [goal.start_date, goal.end_date]
                    );
                    currentValue = parseFloat(res.rows[0].val || 0);
                } else if (goal.goal_type === 'new_clients') {
                    const res = await db.query(
                        `SELECT COUNT(*) as val FROM clients
                         WHERE status = 'active' AND parent_id IS NULL
                           AND created_at >= $1 AND created_at <= $2`,
                        [goal.start_date, goal.end_date]
                    );
                    currentValue = parseInt(res.rows[0].val || 0);
                }

                const targetValue = parseFloat(goal.target_value);
                const progressPct = targetValue > 0 ? Math.min(100, Math.round(currentValue / targetValue * 100)) : 0;
                const remaining = Math.max(0, targetValue - currentValue);
                const daysLeft = Math.ceil((new Date(goal.end_date) - new Date()) / (1000 * 60 * 60 * 24));
                const daysTotal = Math.ceil((new Date(goal.end_date) - new Date(goal.start_date)) / (1000 * 60 * 60 * 24));
                const daysElapsed = daysTotal - daysLeft;
                const expectedPct = daysTotal > 0 ? Math.min(100, Math.round(daysElapsed / daysTotal * 100)) : 100;
                const onTrack = progressPct >= expectedPct;

                // Update current_value in DB
                await db.query(
                    `UPDATE ai_goals SET current_value = $1, updated_at = NOW() WHERE id = $2`,
                    [currentValue, goal.id]
                );

                // Auto-complete if reached
                let status = goal.status;
                if (progressPct >= 100 && goal.status === 'active') {
                    status = 'completed';
                    await db.query(`UPDATE ai_goals SET status = 'completed' WHERE id = $1`, [goal.id]);
                }

                goals.push({
                    id: goal.id,
                    title: goal.title,
                    goal_type: goal.goal_type,
                    target: targetValue,
                    current: Math.round(currentValue * 100) / 100,
                    remaining: Math.round(remaining * 100) / 100,
                    unit: goal.unit,
                    progress_pct: progressPct,
                    expected_pct: expectedPct,
                    on_track: onTrack,
                    days_left: daysLeft,
                    status,
                    description: goal.description,
                });
            }

            const activeGoals = goals.filter(g => g.status === 'active');
            const completedGoals = goals.filter(g => g.status === 'completed');
            const offTrack = activeGoals.filter(g => !g.on_track);

            let summary = `${activeGoals.length} أهداف نشطة، ${completedGoals.length} مكتملة`;
            if (offTrack.length > 0) {
                summary += `، ${offTrack.length} متأخرة عن الجدول`;
            }

            return {
                total_goals: goals.length,
                active: activeGoals.length,
                completed: completedGoals.length,
                off_track: offTrack.length,
                goals,
                summary,
                recommendations: offTrack.map(g => ({
                    goal: g.title,
                    issue: `التقدم ${g.progress_pct}% مقابل المتوقع ${g.expected_pct}% — متأخر بـ ${g.expected_pct - g.progress_pct}%`,
                    action: g.goal_type === 'revenue' ? 'ركز على العملاء النشطين وقدم عروض خاصة'
                        : g.goal_type === 'orders' ? 'تواصل مع العملاء الخاملين'
                        : g.goal_type === 'collections' ? 'تابع الفواتير المتأخرة بقوة'
                        : g.goal_type === 'new_clients' ? 'فعّل حملة تسويقية'
                        : 'راجع استراتيجية الهدف',
                })),
                _explanation: {
                    why: `${activeGoals.length} أهداف نشطة، ${offTrack.length} متأخرة عن الجدول الزمني.`,
                    confidence: 85,
                    factors: goals.map(g => ({
                        factor: g.title,
                        value: `${g.progress_pct}% (${g.current}/${g.target} ${g.unit})`,
                        weight: g.on_track ? 'medium' : 'high',
                    })),
                },
            };
        }
    },

    // ── 56. getCompanyLearning ───────────────────────────────────────────────
    // Learning Layer: extracts patterns and insights from company history
    {
        type: 'function',
        function: {
            name: 'getCompanyLearning',
            description: 'التعلم من الشركة: يستخرج أنماط ودروس من بيانات الشركة التاريخية. يكتشف: أفضل العملاء، المنتجات الرابحة، أنماط الطلب، المواسم النشطة، العملاء المعرضون للضياع. استخدمه عندما يقول المستخدم "تعلم من بياناتي" أو "أنماط الشركة" أو "دروس من الماضي".',
            parameters: {
                type: 'object',
                properties: {
                    focus: { type: 'string', enum: ['clients', 'products', 'sales_patterns', 'all'], description: 'محور التحليل (افتراضي all)' }
                }
            }
        },
        async execute(args, user) {
            const { focus = 'all' } = args;
            const insights = [];

            // 1. Client patterns
            if (focus === 'all' || focus === 'clients') {
                // Top clients by revenue
                const topClientsRes = await db.query(
                    `SELECT c.id, c.name,
                            COUNT(o.id) as order_count,
                            COALESCE(SUM(o.grand_total), 0)::numeric as total_revenue,
                            COALESCE(AVG(o.grand_total), 0)::numeric as avg_order,
                            MAX(o.created_at) as last_order
                     FROM clients c
                     JOIN orders o ON o.client_id = c.id AND o.status NOT IN ('cancelled', 'draft')
                     WHERE c.status = 'active' AND c.parent_id IS NULL
                       AND o.created_at >= NOW() - INTERVAL '12 months'
                     GROUP BY c.id, c.name
                     ORDER BY total_revenue DESC
                     LIMIT 5`
                );
                if (topClientsRes.rows.length > 0) {
                    insights.push({
                        category: 'clients',
                        type: 'top_clients',
                        title: 'أفضل 5 عملاء',
                        data: topClientsRes.rows.map(r => ({
                            name: r.name,
                            orders: parseInt(r.order_count),
                            revenue: Math.round(parseFloat(r.total_revenue)),
                            avg_order: Math.round(parseFloat(r.avg_order)),
                            last_order: r.last_order,
                        })),
                        lesson: `هؤلاء العملاء يمثلون العمود الفقري للإيرادات. ${topClientsRes.rows[0].name} هو الأهم بـ ${Math.round(parseFloat(topClientsRes.rows[0].total_revenue))} ر.س`,
                    });
                }

                // Churn risk clients
                const churnRes = await db.query(
                    `SELECT c.id, c.name,
                            COUNT(o.id) as order_count,
                            COALESCE(SUM(o.grand_total), 0)::numeric as total_revenue,
                            MAX(o.created_at) as last_order,
                            EXTRACT(DAYS FROM NOW() - MAX(o.created_at))::int as days_since_last
                     FROM clients c
                     JOIN orders o ON o.client_id = c.id AND o.status NOT IN ('cancelled', 'draft')
                     WHERE c.status = 'active' AND c.parent_id IS NULL
                     GROUP BY c.id, c.name
                     HAVING MAX(o.created_at) < NOW() - INTERVAL '45 days'
                       AND COUNT(o.id) >= 3
                     ORDER BY days_since_last DESC
                     LIMIT 5`
                );
                if (churnRes.rows.length > 0) {
                    insights.push({
                        category: 'clients',
                        type: 'churn_risk',
                        title: 'عملاء معرضون للضياع',
                        data: churnRes.rows.map(r => ({
                            name: r.name,
                            orders: parseInt(r.order_count),
                            revenue: Math.round(parseFloat(r.total_revenue)),
                            days_since_last: r.days_since_last,
                        })),
                        lesson: `${churnRes.rows.length} عملاء نشطين سابقاً لم يطلبوا منذ 45+ يوم. تواصل معهم فوراً.`,
                    });
                }
            }

            // 2. Product patterns
            if (focus === 'all' || focus === 'products') {
                // Best selling products
                const topProductsRes = await db.query(
                    `SELECT p.id, p.name,
                            SUM(oi.quantity)::numeric as total_qty,
                            SUM(oi.line_total)::numeric as total_revenue,
                            COUNT(DISTINCT o.id) as order_count
                     FROM order_items oi
                     JOIN orders o ON o.id = oi.order_id
                     JOIN product_variants pv ON pv.id = oi.variant_id
                     JOIN products p ON p.id = pv.product_id
                     WHERE o.status NOT IN ('cancelled', 'draft', 'quote')
                       AND o.created_at >= NOW() - INTERVAL '12 months'
                     GROUP BY p.id, p.name
                     ORDER BY total_revenue DESC
                     LIMIT 5`
                );
                if (topProductsRes.rows.length > 0) {
                    insights.push({
                        category: 'products',
                        type: 'top_products',
                        title: 'المنتجات الأكثر مبيعاً',
                        data: topProductsRes.rows.map(r => ({
                            name: r.name,
                            quantity: parseInt(r.total_qty),
                            revenue: Math.round(parseFloat(r.total_revenue)),
                            order_count: parseInt(r.order_count),
                        })),
                        lesson: `${topProductsRes.rows[0].name} هو الأكثر مبيعاً بـ ${parseInt(topProductsRes.rows[0].total_qty)} وحدة. ركز عليه في المخزون.`,
                    });
                }

                // Low performance products
                const lowProductsRes = await db.query(
                    `SELECT p.id, p.name,
                            COALESCE(SUM(oi.quantity), 0)::numeric as total_qty,
                            COALESCE(SUM(oi.line_total), 0)::numeric as total_revenue
                     FROM products p
                     LEFT JOIN product_variants pv ON pv.product_id = p.id
                     LEFT JOIN order_items oi ON oi.variant_id = pv.id
                     LEFT JOIN orders o ON o.id = oi.order_id AND o.status NOT IN ('cancelled', 'draft', 'quote')
                         AND o.created_at >= NOW() - INTERVAL '90 days'
                     WHERE p.status = 'active'
                     GROUP BY p.id, p.name
                     HAVING COALESCE(SUM(oi.line_total), 0) = 0
                     LIMIT 5`
                );
                if (lowProductsRes.rows.length > 0) {
                    insights.push({
                        category: 'products',
                        type: 'dead_stock',
                        title: 'منتجات راكدة (لا مبيعات في 90 يوم)',
                        data: lowProductsRes.rows.map(r => ({
                            name: r.name,
                        })),
                        lesson: `${lowProductsRes.rows.length} منتجات لم تبع منذ 90 يوم. فكر في عروض تصفية أو إيقافها.`,
                    });
                }
            }

            // 3. Sales patterns
            if (focus === 'all' || focus === 'sales_patterns') {
                // Day of week pattern
                const dowRes = await db.query(
                    `SELECT EXTRACT(DOW FROM created_at)::int as dow,
                            COUNT(*) as order_count,
                            COALESCE(SUM(grand_total), 0)::numeric as revenue
                     FROM orders
                     WHERE status NOT IN ('cancelled', 'draft')
                       AND created_at >= NOW() - INTERVAL '90 days'
                     GROUP BY dow ORDER BY revenue DESC`
                );
                const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                if (dowRes.rows.length > 0) {
                    const bestDay = dowRes.rows[0];
                    insights.push({
                        category: 'sales_patterns',
                        type: 'best_day',
                        title: 'أفضل أيام الأسبوع',
                        data: dowRes.rows.map(r => ({
                            day: dayNames[r.dow] || r.dow,
                            orders: parseInt(r.order_count),
                            revenue: Math.round(parseFloat(r.revenue)),
                        })),
                        lesson: `${dayNames[bestDay.dow]} هو أنشط يوم بـ ${Math.round(parseFloat(bestDay.revenue))} ر.س. جهّز المخزون والطاقه لهذا اليوم.`,
                    });
                }

                // Average order value trend
                const aovRes = await db.query(
                    `SELECT DATE_TRUNC('month', created_at) as month,
                            COUNT(*) as orders,
                            COALESCE(AVG(grand_total), 0)::numeric as aov
                     FROM orders
                     WHERE status NOT IN ('cancelled', 'draft')
                       AND created_at >= NOW() - INTERVAL '6 months'
                     GROUP BY month ORDER BY month DESC LIMIT 6`
                );
                if (aovRes.rows.length >= 2) {
                    const latest = aovRes.rows[0];
                    const prev = aovRes.rows[1];
                    const aovChange = parseFloat(prev.aov) > 0
                        ? Math.round((parseFloat(latest.aov) - parseFloat(prev.aov)) / parseFloat(prev.aov) * 100)
                        : 0;
                    insights.push({
                        category: 'sales_patterns',
                        type: 'aov_trend',
                        title: 'اتجاه متوسط قيمة الطلب',
                        data: {
                            current_aov: Math.round(parseFloat(latest.aov)),
                            previous_aov: Math.round(parseFloat(prev.aov)),
                            change_pct: aovChange,
                        },
                        lesson: aovChange > 0
                            ? `متوسط الطلب ارتفع ${aovChange}% — العملاء يشترون أكثر. استمر في التوصيات المتقاطعة.`
                            : `متوسط الطلب انخفض ${Math.abs(aovChange)}% — فكر في عروض bundle أو خصومات كمية.`,
                    });
                }
            }

            return {
                focus,
                analyzed_at: new Date().toISOString(),
                insight_count: insights.length,
                insights,
                summary: insights.length > 0
                    ? `${insights.length} نمط مكتشف من بيانات الشركة`
                    : 'لا توجد بيانات كافية للتحليل',
                _explanation: {
                    why: `تم تحليل ${focus === 'all' ? 'كل الأنماط' : focus} واكتشاف ${insights.length} نمط.`,
                    confidence: 80,
                    factors: insights.slice(0, 5).map(i => ({
                        factor: i.title,
                        value: i.data ? (Array.isArray(i.data) ? i.data.length + ' عناصر' : 'اتجاه') : 'نمط',
                        weight: i.type === 'churn_risk' || i.type === 'dead_stock' ? 'high' : 'medium',
                    })),
                },
            };
        }
    },

    // ── 57. getBusinessPlanner ───────────────────────────────────────────────
    // Business Planner: generates actionable plans based on goals and data
    {
        type: 'function',
        function: {
            name: 'getBusinessPlanner',
            description: 'مخطط الأعمال: يولّد خطة عمل عملية بناءً على الأهداف والبيانات الحالية. يقترح خطوات محددة مع الأولوية والجدول الزمني. استخدمه عندما يقول المستخدم "خطة الشهر" أو "ماذا أفعل؟" أو "اقترح خطة" أو "خطوات قادمة".',
            parameters: {
                type: 'object',
                properties: {
                    horizon: { type: 'string', enum: ['week', 'month', 'quarter'], description: 'أفق التخطيط (افتراضي month)' }
                }
            }
        },
        async execute(args, user) {
            const { horizon = 'month' } = args;
            const days = horizon === 'quarter' ? 90 : horizon === 'week' ? 7 : 30;
            const label = horizon === 'quarter' ? 'ربع سنة' : horizon === 'week' ? 'أسبوع' : 'شهر';

            const tasks = [];

            // 1. Check overdue invoices → collection task
            const overdueRes = await db.query(
                `SELECT COUNT(*) as count, COALESCE(SUM(i.grand_total - COALESCE(ct.paid, 0)), 0)::numeric as amount
                 FROM invoices i
                 LEFT JOIN (
                     SELECT invoice_id, SUM(amount) as paid
                     FROM client_transactions WHERE type = 'payment' AND invoice_id IS NOT NULL
                     GROUP BY invoice_id
                 ) ct ON ct.invoice_id = i.id
                 WHERE i.status = 'issued' AND i.due_date < NOW()
                   AND (i.grand_total - COALESCE(ct.paid, 0)) > 0`
            );
            const overdueCount = parseInt(overdueRes.rows[0].count || 0);
            const overdueAmount = parseFloat(overdueRes.rows[0].amount || 0);
            if (overdueCount > 0) {
                tasks.push({
                    priority: 'critical',
                    category: 'collections',
                    title: `تحصيل ${overdueCount} فاتورة متأخرة`,
                    description: `فاتورات متأخرة بقيمة ${Math.round(overdueAmount)} ر.س. تواصل مع العملاء فوراً.`,
                    action: 'اتصل بكل عميل متأخر وحدد موعد دفع. ابدأ بالأكبر قيمة.',
                    deadline: '3 أيام',
                    expected_impact: Math.round(overdueAmount),
                });
            }

            // 2. Check stockouts → reorder task
            const stockoutRes = await db.query(
                `SELECT ws.variant_id, pv.sku, p.name,
                        ws.quantity
                 FROM warehouse_stock ws
                 JOIN product_variants pv ON pv.id = ws.variant_id
                 JOIN products p ON p.id = pv.product_id
                 WHERE ws.quantity <= 0
                 LIMIT 10`
            );
            if (stockoutRes.rows.length > 0) {
                tasks.push({
                    priority: 'critical',
                    category: 'inventory',
                    title: `إعادة طلب ${stockoutRes.rows.length} صنف نفد`,
                    description: `أصناف نفدت من المخزون: ${stockoutRes.rows.slice(0, 3).map(r => r.name).join('، ')}${stockoutRes.rows.length > 3 ? '...' : ''}`,
                    action: 'أنشئ أوامر شراء للأصناف النافدة. رتّب حسب معدل البيع.',
                    deadline: '2 أيام',
                    expected_impact: 'منع فقدان مبيعات',
                });
            }

            // 3. Inactive clients → reactivation task
            const inactiveRes = await db.query(
                `SELECT c.id, c.name, c.phone,
                        MAX(o.created_at) as last_order,
                        EXTRACT(DAYS FROM NOW() - MAX(o.created_at))::int as days_inactive
                 FROM clients c
                 LEFT JOIN orders o ON o.client_id = c.id AND o.status NOT IN ('cancelled', 'draft')
                 WHERE c.status = 'active' AND c.parent_id IS NULL
                 GROUP BY c.id, c.name, c.phone
                 HAVING MAX(o.created_at) < NOW() - INTERVAL '30 days'
                    OR MAX(o.created_at) IS NULL
                 ORDER BY days_inactive DESC NULLS LAST
                 LIMIT 10`
            );
            if (inactiveRes.rows.length > 0) {
                tasks.push({
                    priority: 'high',
                    category: 'client_reactivation',
                    title: `إعادة تنشيط ${inactiveRes.rows.length} عميل خامل`,
                    description: `عملاء لم يطلبوا منذ 30+ يوم. ${inactiveRes.rows.slice(0, 3).map(r => r.name).join('، ')}${inactiveRes.rows.length > 3 ? '...' : ''}`,
                    action: 'اتصل أو أرسل واتساب بعرض خاص. ابدأ بالعملاء الذين كانوا يطلبون بكثرة.',
                    deadline: 'أسبوع',
                    expected_impact: 'استعادة ' + inactiveRes.rows.length + ' عميل',
                });
            }

            // 4. Pending quotes → follow-up task
            const pendingQuotesRes = await db.query(
                `SELECT COUNT(*) as count, COALESCE(SUM(grand_total), 0)::numeric as value
                 FROM orders WHERE status = 'quote' AND created_at >= NOW() - INTERVAL '30 days'`
            );
            const pendingCount = parseInt(pendingQuotesRes.rows[0].count || 0);
            const pendingValue = parseFloat(pendingQuotesRes.rows[0].value || 0);
            if (pendingCount > 0) {
                tasks.push({
                    priority: 'high',
                    category: 'quotes',
                    title: `متابعة ${pendingCount} عرض سعر معلق`,
                    description: `عروض بانتظار الرد بقيمة ${Math.round(pendingValue)} ر.س.`,
                    action: 'اتصل بالعملاء واكتسب ملاحظاتهم. عدّل العرض لو لازم.',
                    deadline: '5 أيام',
                    expected_impact: Math.round(pendingValue),
                });
            }

            // 5. Revenue goal check
            try {
                const goalRes = await db.query(
                    `SELECT title, target_value, current_value, end_date
                     FROM ai_goals WHERE status = 'active' AND goal_type = 'revenue'
                     ORDER BY end_date ASC LIMIT 1`
                );
                if (goalRes.rows.length > 0) {
                    const goal = goalRes.rows[0];
                    const target = parseFloat(goal.target_value);
                    const current = parseFloat(goal.current_value || 0);
                    const remaining = Math.max(0, target - current);
                    const progress = target > 0 ? Math.round(current / target * 100) : 0;
                    if (progress < 100) {
                        tasks.push({
                            priority: 'medium',
                            category: 'goal',
                            title: `العمل على هدف: ${goal.title}`,
                            description: `التقدم ${progress}% — تبقى ${Math.round(remaining)} ر.س لتحقيق الهدف.`,
                            action: 'ركز على العملاء النشطين. اعرض bundle deals. فعّل حملة تسويقية محدودة.',
                            deadline: goal.end_date,
                            expected_impact: Math.round(remaining),
                        });
                    }
                }
            } catch (e) { /* goals table might not exist */ }

            // Sort by priority
            const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
            tasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

            return {
                horizon: label,
                generated_at: new Date().toISOString(),
                total_tasks: tasks.length,
                critical_count: tasks.filter(t => t.priority === 'critical').length,
                tasks,
                summary: tasks.length > 0
                    ? `${tasks.length} مهام لـ${label} — ${tasks.filter(t => t.priority === 'critical').length} حرجة، ${tasks.filter(t => t.priority === 'high').length} عالية الأولوية`
                    : `لا توجد مهام عاجلة لـ${label}. الوضع مستقر.`,
                _explanation: {
                    why: `خطة ${label} تحتوي على ${tasks.length} مهام. ${tasks.filter(t => t.priority === 'critical').length} حرجة تحتاج تنفيذ فوري.`,
                    confidence: 85,
                    factors: tasks.slice(0, 5).map(t => ({
                        factor: t.title,
                        value: t.priority,
                        weight: t.priority === 'critical' ? 'high' : t.priority === 'high' ? 'medium' : 'low',
                    })),
                },
            };
        }
    },

    // ── 58. getVoiceCommands ─────────────────────────────────────────────────
    // Voice Assistant: maps Arabic voice commands to system actions
    {
        type: 'function',
        function: {
            name: 'getVoiceCommands',
            description: 'مساعد صوتي للمستودع: يحول الأوامر الصوتية العربية إلى إجراءات في النظام. استخدمه عندما يقول المستخدم "أوامر صوتية" أو "اشرح الأوامر" أو "ماذا أقول للمساعد الصوتي".',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'الأمر الصوتي المطلوب تفسيره (اختياري)' }
                }
            }
        },
        async execute(args, user) {
            const { query } = args;

            const commands = [
                { phrase: 'كم المخزون', action: 'navigate', target: 'inventory', description: 'عرض صفحة المخزون' },
                { phrase: 'كم طلب اليوم', action: 'query', target: 'today_orders', description: 'عدد طلبات اليوم' },
                { phrase: 'فواتير متأخرة', action: 'query', target: 'overdue_invoices', description: 'عرض الفواتير المتأخرة' },
                { phrase: 'افتح العملاء', action: 'navigate', target: 'clients', description: 'صفحة العملاء' },
                { phrase: 'افتح المنتجات', action: 'navigate', target: 'products', description: 'صفحة المنتجات' },
                { phrase: 'افتح الفواتير', action: 'navigate', target: 'sales-invoices', description: 'صفحة فواتير المبيعات' },
                { phrase: 'افتح عروض الأسعار', action: 'navigate', target: 'quotations', description: 'صفحة عروض الأسعار' },
                { phrase: 'افتح الموردين', action: 'navigate', target: 'suppliers', description: 'صفحة الموردين' },
                { phrase: 'افتح لوحة التحكم', action: 'navigate', target: 'dashboard', description: 'لوحة التحكم الرئيسية' },
                { phrase: 'افتح المخازن', action: 'navigate', target: 'warehouses', description: 'صفحة المخازن' },
                { phrase: 'افتح أوامر التشغيل', action: 'navigate', target: 'production_orders', description: 'أوامر التشغيل' },
                { phrase: 'ملخص اليوم', action: 'briefing', target: 'briefing', description: 'الملخص اليومي' },
                { phrase: 'الأهداف', action: 'query', target: 'goals', description: 'حالة الأهداف' },
                { phrase: 'مؤشرات الأداء', action: 'query', target: 'kpis', description: 'مؤشرات الأداء' },
                { phrase: 'كم باقي من المخزون', action: 'query', target: 'stock_forecast', description: 'التنبؤ بنفاد المخزون' },
                { phrase: 'أفضل العملاء', action: 'query', target: 'top_clients', description: 'أفضل العملاء' },
                { phrase: 'المنتجات الراكدة', action: 'query', target: 'dead_stock', description: 'منتجات لم تبع' },
                { phrase: 'خطة الشهر', action: 'query', target: 'business_planner', description: 'خطة عمل شهرية' },
            ];

            if (query) {
                // Try to match the voice command
                const normalized = query.trim().toLowerCase();
                let bestMatch = null;
                let bestScore = 0;

                for (const cmd of commands) {
                    const cmdNormalized = cmd.phrase.toLowerCase();
                    if (normalized.includes(cmdNormalized) || cmdNormalized.includes(normalized)) {
                        const score = Math.min(normalized.length, cmdNormalized.length) / Math.max(normalized.length, cmdNormalized.length);
                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = cmd;
                        }
                    }
                }

                if (bestMatch) {
                    // Execute the matched command
                    if (bestMatch.action === 'navigate') {
                        return {
                            understood: true,
                            command: bestMatch.phrase,
                            action: 'navigate',
                            target: bestMatch.target,
                            description: bestMatch.description,
                            response: `فتح ${bestMatch.description}`,
                        };
                    } else if (bestMatch.action === 'briefing') {
                        return {
                            understood: true,
                            command: bestMatch.phrase,
                            action: 'briefing',
                            target: bestMatch.target,
                            description: bestMatch.description,
                            response: 'جاري توليد الملخص اليومي...',
                        };
                    } else {
                        return {
                            understood: true,
                            command: bestMatch.phrase,
                            action: 'query',
                            target: bestMatch.target,
                            description: bestMatch.description,
                            response: `جاري البحث عن ${bestMatch.description}...`,
                        };
                    }
                }

                return {
                    understood: false,
                    query: query,
                    response: 'لم أتعرف على هذا الأمر. الأوامر المتاحة: ' + commands.map(c => `"${c.phrase}"`).join('، '),
                };
            }

            return {
                commands_available: commands.length,
                commands,
                summary: `${commands.length} أمر صوتي متاح. قل أحد الأوامر التالية للمساعد الصوتي.`,
                _explanation: {
                    why: `المساعد الصوتي يدعم ${commands.length} أمر بالعربية للتنفيذ في النظام.`,
                    confidence: 95,
                    factors: [
                        { factor: 'أوامر التنقل', value: commands.filter(c => c.action === 'navigate').length, weight: 'medium' },
                        { factor: 'أوامر الاستعلام', value: commands.filter(c => c.action === 'query').length, weight: 'medium' },
                    ],
                },
            };
        }
    },

];

// =============================================================================
// Export
// =============================================================================

module.exports = {
    AI_FUNCTIONS,
    // Map for quick lookup by name
    FUNCTION_MAP: AI_FUNCTIONS.reduce((map, fn) => {
        map[fn.function.name] = fn;
        return map;
    }, {}),
};
