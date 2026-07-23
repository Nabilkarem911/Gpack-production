'use strict';

// =============================================================================
// G.PACK 2.0 — AI Assistant Functions (ai-functions.js)
// Defines OpenAI function-calling schemas + their execution logic.
// ALL functions are READ-ONLY — no INSERT / UPDATE / DELETE.
// Each function receives (args, user) where user = { id, role, permissions }.
// =============================================================================

const db = require('../db');

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
                        COALESCE(SUM(i.paid_amount), 0)::numeric as total_paid,
                        COALESCE(SUM(i.grand_total - i.paid_amount), 0)::numeric as balance_due,
                        COUNT(DISTINCT i.id) as invoice_count,
                        COUNT(DISTINCT o.id) as order_count
                 FROM clients c
                 LEFT JOIN invoices i ON i.client_id = c.id AND i.status != 'cancelled'
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
            description: 'يرجع حالة المخزون: الأصناف القاربت على النفاد (أقل من حد معين) أو النافدة تماماً.',
            parameters: {
                type: 'object',
                properties: {
                    threshold: { type: 'number', description: 'الحد الأدنى للتنبيه (افتراضي 100)' }
                }
            }
        },
        async execute(args, user) {
            const { threshold = 100 } = args;
            const result = await db.query(
                `SELECT p.name as product_name, pv.size_name as size,
                        COALESCE(SUM(ws.quantity), 0)::numeric as total_stock,
                        w.name as warehouse_name
                 FROM product_variants pv
                 JOIN products p ON p.id = pv.product_id
                 CROSS JOIN warehouses w
                 LEFT JOIN warehouse_stock ws ON ws.variant_id = pv.id AND ws.warehouse_id = w.id
                 GROUP BY p.name, pv.size_name, w.name
                 HAVING COALESCE(SUM(ws.quantity), 0) < $1
                 ORDER BY total_stock ASC
                 LIMIT 20`,
                [parseFloat(threshold)]
            );
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
                query = `SELECT s.name as supplier_name, p.name as product_name, pv.size_name as size,
                                pii.unit_cost as cost_price, pi.invoice_date
                         FROM purchase_invoice_items pii
                         JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
                         JOIN suppliers s ON s.id = pi.supplier_id
                         JOIN product_variants pv ON pv.id = pii.variant_id
                         JOIN products p ON p.id = pv.product_id
                         WHERE p.name ILIKE $1 AND s.name ILIKE $2 AND pi.status != 'cancelled'
                         ORDER BY pii.unit_cost ASC LIMIT 20`;
                params = [`%${product_name}%`, `%${supplier_name}%`];
            } else {
                query = `SELECT s.name as supplier_name, p.name as product_name, pv.size_name as size,
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
                `SELECT s.name as supplier_name, p.name as product_name, pv.size_name as size,
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
                        i.grand_total, i.paid_amount,
                        (i.grand_total - i.paid_amount) as balance_due
                 FROM invoices i
                 JOIN clients c ON c.id = i.client_id
                 WHERE (i.grand_total - i.paid_amount) > 0 AND i.status != 'cancelled'
                 ORDER BY (i.grand_total - i.paid_amount) DESC
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
                        COALESCE(SUM(paid_amount), 0)::numeric as total_collected,
                        COALESCE(SUM(grand_total - paid_amount), 0)::numeric as total_outstanding
                 FROM invoices WHERE status != 'cancelled'`
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
                        COALESCE(SUM(i.paid_amount), 0)::numeric as total_paid,
                        COALESCE(SUM(i.grand_total - i.paid_amount), 0)::numeric as balance_due,
                        COUNT(DISTINCT i.id) as invoice_count
                 FROM clients c
                 LEFT JOIN invoices i ON i.client_id = c.id AND i.status != 'cancelled'
                 WHERE c.name ILIKE $1
                 GROUP BY c.id, c.name, c.phone, c.email
                 LIMIT 1`,
                [`%${client_name}%`]
            );
            if (summaryRes.rows.length === 0) return { error: 'لم يتم العثور على العميل' };
            const clientId = summaryRes.rows[0].id;
            const invoicesRes = await db.query(
                `SELECT i.invoice_number, i.invoice_date, i.grand_total, i.paid_amount,
                        (i.grand_total - i.paid_amount) as balance_due, i.status
                 FROM invoices i
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
