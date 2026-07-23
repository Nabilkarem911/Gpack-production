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
                `SELECT pv.product_name, pv.size,
                        SUM(oi.quantity)::numeric as total_qty,
                        SUM(oi.quantity * oi.unit_price)::numeric as total_revenue
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN product_variants pv ON pv.id = oi.variant_id
                 WHERE o.status NOT IN ('quote', 'cancelled', 'draft')
                   AND ${dateFilter}
                 GROUP BY pv.product_name, pv.size
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
                        COALESCE(SUM(i.balance_due), 0)::numeric as balance_due,
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
                `SELECT s.id, s.name,
                        COALESCE(SUM(pi.total_amount), 0)::numeric as total_purchased,
                        COALESCE(SUM(pi.paid_amount), 0)::numeric as total_paid,
                        COALESCE(SUM(pi.balance_due), 0)::numeric as balance_due,
                        COUNT(DISTINCT pi.id) as invoice_count
                 FROM suppliers s
                 LEFT JOIN purchase_invoices pi ON pi.supplier_id = s.id AND pi.status != 'cancelled'
                 WHERE s.name ILIKE $1
                 GROUP BY s.id, s.name
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
                `SELECT pv.product_name, pv.size,
                        COALESCE(SUM(ws.quantity), 0)::numeric as total_stock,
                        w.name as warehouse_name
                 FROM product_variants pv
                 CROSS JOIN warehouses w
                 LEFT JOIN warehouse_stock ws ON ws.variant_id = pv.id AND ws.warehouse_id = w.id
                 GROUP BY pv.product_name, pv.size, w.name
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
                query = `SELECT s.name as supplier_name, pv.product_name, pv.size, pv.cost_price
                         FROM product_variants pv
                         JOIN suppliers s ON s.id = pv.supplier_id
                         WHERE pv.product_name ILIKE $1 AND s.name ILIKE $2
                         ORDER BY pv.cost_price ASC LIMIT 20`;
                params = [`%${product_name}%`, `%${supplier_name}%`];
            } else {
                query = `SELECT s.name as supplier_name, pv.product_name, pv.size, pv.cost_price
                         FROM product_variants pv
                         LEFT JOIN suppliers s ON s.id = pv.supplier_id
                         WHERE pv.product_name ILIKE $1
                         ORDER BY pv.cost_price ASC LIMIT 20`;
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
                `SELECT s.name as supplier_name, pv.product_name, pv.size, pv.cost_price
                 FROM product_variants pv
                 JOIN suppliers s ON s.id = pv.supplier_id
                 WHERE pv.product_name ILIKE $1
                 ORDER BY pv.cost_price ASC`,
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
                `SELECT pi.invoice_date, s.name as supplier_name,
                        pii.product_name, pii.quantity, pii.unit_price
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
                        i.grand_total, i.paid_amount, i.balance_due
                 FROM invoices i
                 JOIN clients c ON c.id = i.client_id
                 WHERE i.balance_due > 0 AND i.status != 'cancelled'
                 ORDER BY i.balance_due DESC
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
