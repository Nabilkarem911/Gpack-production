'use strict';

// =============================================================================
// G.PACK 2.0 — Reports API
// Comprehensive reporting endpoints for sales, finance, production,
// inventory, and design analytics.
// All endpoints require authentication.
// =============================================================================

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { success, error } = require('../utils/response');
const authorize = require('../middleware/authorize');

// All report endpoints require at least view permission on reports
router.use(authorize('reports', 'read'));

// =============================================================================
// Helper: Parse date range from query params
// Returns { from, to } as ISO date strings (YYYY-MM-DD)
// Defaults to current month if not provided
// =============================================================================
function _parseDateRange(req) {
    let from = req.query.from;
    let to   = req.query.to;

    if (!from || !to) {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        from = firstDay.toISOString().split('T')[0];
        to   = now.toISOString().split('T')[0];
    }

    return { from, to };
}

// =============================================================================
// Helper: Get previous period of same length for comparison
// =============================================================================
function _getPreviousPeriod(from, to) {
    const fromDate = new Date(from);
    const toDate   = new Date(to);
    const diffMs   = toDate.getTime() - fromDate.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1;

    const prevTo   = new Date(fromDate.getTime() - 86400000); // day before `from`
    const prevFrom = new Date(prevTo.getTime() - (diffDays - 1) * 86400000);

    return {
        from: prevFrom.toISOString().split('T')[0],
        to:   prevTo.toISOString().split('T')[0]
    };
}

// =============================================================================
// GET /api/reports/health
// Simple health check for the reports route
// =============================================================================
router.get('/health', (req, res) => {
    success(res, { status: 'ok', service: 'reports-api' });
});

// =============================================================================
// GET /api/reports/kpis
// Returns key performance indicators for the given date range
// =============================================================================
router.get('/kpis', async (req, res) => {
    try {
        const { from, to } = _parseDateRange(req);

        // 1. Total Sales (orders with financial data, excluding quotes/drafts/cancelled)
        const salesRes = await db.query(`
            SELECT COALESCE(SUM(grand_total), 0) AS total_sales,
                   COALESCE(SUM(subtotal), 0) AS total_subtotal,
                   COALESCE(SUM(tax_amount), 0) AS total_tax,
                   COUNT(*) AS order_count
            FROM orders
            WHERE status NOT IN ('quote', 'draft', 'cancelled')
              AND grand_total IS NOT NULL
              AND order_date BETWEEN $1 AND $2
        `, [from, to]);

        // 2. Active production orders
        const activeRes = await db.query(`
            SELECT COUNT(*) AS active_count,
                   COALESCE(SUM(grand_total), 0) AS active_value
            FROM orders
            WHERE status IN ('production', 'processing')
              AND order_date BETWEEN $1 AND $2
        `, [from, to]);

        // 3. Outstanding receivables (grand_total - paid_amount > 0)
        const outstandingRes = await db.query(`
            SELECT COALESCE(SUM(grand_total - paid_amount), 0) AS outstanding
            FROM orders
            WHERE status NOT IN ('quote', 'draft', 'cancelled')
              AND grand_total IS NOT NULL
              AND (grand_total - paid_amount) > 0
        `);

        // 4. Average delivery time (days)
        const deliveryRes = await db.query(`
            SELECT AVG(EXTRACT(EPOCH FROM (dn.delivered_at - o.order_date)) / 86400)::numeric(10,1) AS avg_delivery_days
            FROM delivery_notes dn
            JOIN orders o ON o.id = dn.order_id
            WHERE dn.status = 'completed'
              AND dn.delivered_at IS NOT NULL
              AND o.order_date BETWEEN $1 AND $2
        `, [from, to]);

        // 5. Production completion rate
        const completionRes = await db.query(`
            SELECT
              COUNT(*) FILTER (WHERE status = 'completed') AS completed,
              COUNT(*) FILTER (WHERE status IN ('production', 'processing')) AS in_progress,
              COUNT(*) AS total
            FROM orders
            WHERE status NOT IN ('quote', 'draft', 'cancelled')
              AND order_date BETWEEN $1 AND $2
        `, [from, to]);

        // 6. Stock value
        const stockRes = await db.query(`
            SELECT COALESCE(SUM(ws.quantity * pv.cost_price), 0) AS stock_value
            FROM warehouse_stock ws
            JOIN product_variants pv ON pv.id = ws.variant_id
            WHERE ws.quantity > 0
        `);

        // 7. Quotation conversion
        const quoteRes = await db.query(`
            SELECT
              COUNT(*) FILTER (WHERE status = 'quote') AS total_quotes,
              COUNT(*) FILTER (WHERE status IN ('confirmed', 'production', 'processing', 'completed', 'delivered')) AS converted
            FROM orders
            WHERE order_date BETWEEN $1 AND $2
        `, [from, to]);

        // 8. Total collected (receipt vouchers = accounting_vouchers with type 'receipt')
        const collectedRes = await db.query(`
            SELECT COALESCE(SUM(total_amount), 0) AS total_collected
            FROM accounting_vouchers
            WHERE voucher_type = 'receipt'
              AND status = 'posted'
              AND voucher_date BETWEEN $1 AND $2
        `, [from, to]);

        // 9. Total paid to suppliers (payment vouchers)
        const paidRes = await db.query(`
            SELECT COALESCE(SUM(total_amount), 0) AS total_paid
            FROM accounting_vouchers
            WHERE voucher_type = 'payment'
              AND status = 'posted'
              AND voucher_date BETWEEN $1 AND $2
        `, [from, to]);

        // 10. Previous period sales for trend
        const prev = _getPreviousPeriod(from, to);
        const prevSalesRes = await db.query(`
            SELECT COALESCE(SUM(grand_total), 0) AS total_sales
            FROM orders
            WHERE status NOT IN ('quote', 'draft', 'cancelled')
              AND grand_total IS NOT NULL
              AND order_date BETWEEN $1 AND $2
        `, [prev.from, prev.to]);

        const totalSales    = parseFloat(salesRes.rows[0].total_sales) || 0;
        const prevSales     = parseFloat(prevSalesRes.rows[0].total_sales) || 0;
        const salesTrend    = prevSales > 0 ? ((totalSales - prevSales) / prevSales) * 100 : 0;
        const completed     = parseInt(completionRes.rows[0].completed) || 0;
        const totalOrders   = parseInt(completionRes.rows[0].total) || 0;
        const totalQuotes   = parseInt(quoteRes.rows[0].total_quotes) || 0;
        const converted     = parseInt(quoteRes.rows[0].converted) || 0;

        const data = {
            total_sales:              totalSales,
            sales_trend_pct:          parseFloat(salesTrend.toFixed(1)),
            order_count:              parseInt(salesRes.rows[0].order_count) || 0,
            active_orders_count:      parseInt(activeRes.rows[0].active_count) || 0,
            active_orders_value:      parseFloat(activeRes.rows[0].active_value) || 0,
            outstanding_receivables:  parseFloat(outstandingRes.rows[0].outstanding) || 0,
            avg_delivery_days:        parseFloat(deliveryRes.rows[0].avg_delivery_days) || 0,
            production_completion_pct: totalOrders > 0 ? parseFloat(((completed / totalOrders) * 100).toFixed(1)) : 0,
            stock_value:              parseFloat(stockRes.rows[0].stock_value) || 0,
            quote_conversion_rate:    totalQuotes > 0 ? parseFloat(((converted / totalQuotes) * 100).toFixed(1)) : 0,
            total_collected:          parseFloat(collectedRes.rows[0].total_collected) || 0,
            total_paid_to_suppliers:  parseFloat(paidRes.rows[0].total_paid) || 0
        };

        success(res, data);
    } catch (err) {
        console.error('[Reports] KPIs error:', err.message);
        error(res, 'Failed to load KPIs data.', 500);
    }
});

// =============================================================================
// GET /api/reports/profit-loss
// Returns Profit & Loss statement for the given date range
// =============================================================================
router.get('/profit-loss', async (req, res) => {
    try {
        const { from, to } = _parseDateRange(req);

        // Revenue (subtotal only, excluding tax)
        const revenueRes = await db.query(`
            SELECT COALESCE(SUM(o.subtotal), 0) AS revenue
            FROM orders o
            WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
              AND o.subtotal IS NOT NULL
              AND o.order_date BETWEEN $1 AND $2
        `, [from, to]);

        // COGS (from manufacturer_order_items)
        const cogsRes = await db.query(`
            SELECT COALESCE(SUM(moi.total_cost), 0) AS cogs
            FROM manufacturer_order_items moi
            JOIN manufacturer_orders mo ON mo.id = moi.manufacturer_order_id
            WHERE mo.status NOT IN ('cancelled')
              AND mo.created_at >= $1::date
              AND mo.created_at < ($2::date + 1)
        `, [from, to]);

        // Additional expenses from invoices
        const expensesRes = await db.query(`
            SELECT COALESCE(SUM(amount), 0) AS additional_expenses
            FROM invoice_expenses ie
            JOIN invoices i ON i.id = ie.invoice_id
            WHERE i.invoice_date BETWEEN $1 AND $2
        `, [from, to]);

        // VAT collected
        const vatCollectedRes = await db.query(`
            SELECT COALESCE(SUM(tax_amount), 0) AS vat_collected
            FROM orders
            WHERE status NOT IN ('quote', 'draft', 'cancelled')
              AND tax_amount IS NOT NULL
              AND order_date BETWEEN $1 AND $2
        `, [from, to]);

        // VAT paid
        const vatPaidRes = await db.query(`
            SELECT COALESCE(SUM(tax_amount), 0) AS vat_paid
            FROM purchase_invoices
            WHERE tax_amount IS NOT NULL
              AND invoice_date BETWEEN $1 AND $2
        `, [from, to]);

        // Previous period for comparison
        const prev = _getPreviousPeriod(from, to);
        const prevRevenueRes = await db.query(`
            SELECT COALESCE(SUM(o.subtotal), 0) AS revenue
            FROM orders o
            WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
              AND o.subtotal IS NOT NULL
              AND o.order_date BETWEEN $1 AND $2
        `, [prev.from, prev.to]);

        const revenue     = parseFloat(revenueRes.rows[0].revenue) || 0;
        const cogs        = parseFloat(cogsRes.rows[0].cogs) || 0;
        const addExpenses = parseFloat(expensesRes.rows[0].additional_expenses) || 0;
        const vatCollected = parseFloat(vatCollectedRes.rows[0].vat_collected) || 0;
        const vatPaid      = parseFloat(vatPaidRes.rows[0].vat_paid) || 0;
        const prevRevenue  = parseFloat(prevRevenueRes.rows[0].revenue) || 0;

        const grossProfit   = revenue - cogs;
        const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
        const netProfit     = grossProfit - addExpenses;
        const netMarginPct  = revenue > 0 ? (netProfit / revenue) * 100 : 0;
        const revenueTrend  = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;

        const data = {
            revenue:            revenue,
            revenue_trend_pct:  parseFloat(revenueTrend.toFixed(1)),
            cogs:               cogs,
            gross_profit:       grossProfit,
            gross_margin_pct:   parseFloat(grossMarginPct.toFixed(1)),
            additional_expenses: addExpenses,
            net_profit:         netProfit,
            net_margin_pct:     parseFloat(netMarginPct.toFixed(1)),
            vat_collected:      vatCollected,
            vat_paid:           vatPaid,
            vat_net:            vatCollected - vatPaid
        };

        success(res, data);
    } catch (err) {
        console.error('[Reports] P&L error:', err.message);
        error(res, 'Failed to load profit & loss data.', 500);
    }
});

// =============================================================================
// GET /api/reports/profitability
// Returns profitability analysis grouped by order, client, product, or supplier
// Query param: group_by = order | client | product | supplier (default: order)
// =============================================================================
router.get('/profitability', async (req, res) => {
    try {
        const { from, to } = _parseDateRange(req);
        const groupBy = req.query.group_by || 'order';

        let data = [];

        if (groupBy === 'order') {
            const result = await db.query(`
                SELECT
                    o.id,
                    o.order_number,
                    c.name AS client_name,
                    COALESCE(o.grand_total - o.tax_amount, 0) AS revenue,
                    COALESCE(cogs.total_cost, 0) AS cogs,
                    COALESCE(o.grand_total - o.tax_amount, 0) - COALESCE(cogs.total_cost, 0) AS gross_profit,
                    CASE
                        WHEN o.grand_total IS NULL OR o.grand_total = 0 THEN 0
                        ELSE ROUND(((o.grand_total - o.tax_amount - COALESCE(cogs.total_cost, 0)) /
                              NULLIF(o.grand_total - o.tax_amount, 0)) * 100, 1)
                    END AS margin_pct
                FROM orders o
                LEFT JOIN clients c ON c.id = o.client_id
                LEFT JOIN (
                    SELECT mo.order_id, SUM(moi.total_cost) AS total_cost
                    FROM manufacturer_orders mo
                    JOIN manufacturer_order_items moi ON moi.manufacturer_order_id = mo.id
                    WHERE mo.status NOT IN ('cancelled')
                    GROUP BY mo.order_id
                ) cogs ON cogs.order_id = o.id
                WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
                  AND o.order_date BETWEEN $1 AND $2
                  AND o.grand_total IS NOT NULL
                ORDER BY gross_profit DESC
            `, [from, to]);
            data = result.rows;

        } else if (groupBy === 'client') {
            const result = await db.query(`
                SELECT
                    c.id,
                    c.name AS client_name,
                    COUNT(DISTINCT o.id) AS order_count,
                    COALESCE(SUM(o.grand_total - o.tax_amount), 0) AS revenue,
                    COALESCE(SUM(cogs.total_cost), 0) AS cogs,
                    COALESCE(SUM(o.grand_total - o.tax_amount), 0) - COALESCE(SUM(cogs.total_cost), 0) AS gross_profit,
                    CASE
                        WHEN SUM(o.grand_total - o.tax_amount) IS NULL OR SUM(o.grand_total - o.tax_amount) = 0 THEN 0
                        ELSE ROUND((SUM(o.grand_total - o.tax_amount - COALESCE(cogs.total_cost, 0)) /
                              NULLIF(SUM(o.grand_total - o.tax_amount), 0)) * 100, 1)
                    END AS margin_pct
                FROM clients c
                JOIN orders o ON o.client_id = c.id
                LEFT JOIN (
                    SELECT mo.order_id, SUM(moi.total_cost) AS total_cost
                    FROM manufacturer_orders mo
                    JOIN manufacturer_order_items moi ON moi.manufacturer_order_id = mo.id
                    WHERE mo.status NOT IN ('cancelled')
                    GROUP BY mo.order_id
                ) cogs ON cogs.order_id = o.id
                WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
                  AND o.order_date BETWEEN $1 AND $2
                  AND o.grand_total IS NOT NULL
                GROUP BY c.id, c.name
                ORDER BY gross_profit DESC
            `, [from, to]);
            data = result.rows;

        } else if (groupBy === 'product') {
            const result = await db.query(`
                SELECT
                    pv.id,
                    p.name AS product_name,
                    pv.size_name AS variant,
                    SUM(oi.quantity) AS qty_sold,
                    SUM(oi.line_total) AS revenue,
                    COALESCE(SUM(moi.total_cost), 0) AS cogs,
                    SUM(oi.line_total) - COALESCE(SUM(moi.total_cost), 0) AS gross_profit,
                    CASE
                        WHEN SUM(oi.line_total) IS NULL OR SUM(oi.line_total) = 0 THEN 0
                        ELSE ROUND((SUM(oi.line_total - COALESCE(moi.total_cost, 0)) /
                              NULLIF(SUM(oi.line_total), 0)) * 100, 1)
                    END AS margin_pct
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                JOIN product_variants pv ON pv.id = oi.variant_id
                JOIN products p ON p.id = pv.product_id
                LEFT JOIN manufacturer_order_items moi ON moi.order_item_id = oi.id
                LEFT JOIN manufacturer_orders mo ON mo.id = moi.manufacturer_order_id AND mo.status NOT IN ('cancelled')
                WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
                  AND o.order_date BETWEEN $1 AND $2
                  AND o.grand_total IS NOT NULL
                GROUP BY pv.id, p.name, pv.size_name
                ORDER BY gross_profit DESC
                LIMIT 50
            `, [from, to]);
            data = result.rows;

        } else if (groupBy === 'supplier') {
            const result = await db.query(`
                SELECT
                    s.id,
                    s.company_name AS supplier_name,
                    COUNT(DISTINCT mo.id) AS mo_count,
                    COALESCE(SUM(o.grand_total - o.tax_amount), 0) AS revenue,
                    COALESCE(SUM(moi.total_cost), 0) AS cogs,
                    COALESCE(SUM(o.grand_total - o.tax_amount), 0) - COALESCE(SUM(moi.total_cost), 0) AS gross_profit,
                    CASE
                        WHEN SUM(o.grand_total - o.tax_amount) IS NULL OR SUM(o.grand_total - o.tax_amount) = 0 THEN 0
                        ELSE ROUND((SUM(o.grand_total - o.tax_amount - COALESCE(moi.total_cost, 0)) /
                              NULLIF(SUM(o.grand_total - o.tax_amount), 0)) * 100, 1)
                    END AS margin_pct
                FROM suppliers s
                JOIN manufacturer_orders mo ON mo.manufacturer_id = s.id
                JOIN manufacturer_order_items moi ON moi.manufacturer_order_id = mo.id
                JOIN orders o ON o.id = mo.order_id
                WHERE mo.status NOT IN ('cancelled')
                  AND o.status NOT IN ('quote', 'draft', 'cancelled')
                  AND o.order_date BETWEEN $1 AND $2
                  AND o.grand_total IS NOT NULL
                GROUP BY s.id, s.company_name
                ORDER BY gross_profit DESC
            `, [from, to]);
            data = result.rows;
        }

        success(res, data);
    } catch (err) {
        console.error('[Reports] Profitability error:', err.message);
        error(res, 'Failed to load profitability data.', 500);
    }
});

// =============================================================================
// GET /api/reports/cash-flow
// Returns cash inflows and outflows for the given date range
// =============================================================================
router.get('/cash-flow', async (req, res) => {
    try {
        const { from, to } = _parseDateRange(req);

        // Inflows (receipt vouchers)
        const inflowRes = await db.query(`
            SELECT
                av.id,
                av.voucher_number,
                av.voucher_date,
                av.total_amount AS amount,
                av.description,
                'inflow' AS direction,
                COALESCE(
                    CASE WHEN av.reference_type = 'client' THEN c_direct.name END,
                    (SELECT cl.name FROM orders o JOIN clients cl ON cl.id = o.client_id WHERE o.id = av.reference_id LIMIT 1)
                ) AS party_name,
                'عميل' AS party_type
            FROM accounting_vouchers av
            LEFT JOIN clients c_direct ON c_direct.id = av.reference_id AND av.reference_type = 'client'
            WHERE av.voucher_type = 'receipt'
              AND av.status = 'posted'
              AND av.voucher_date BETWEEN $1 AND $2
        `, [from, to]);

        // Outflows (payment vouchers)
        const outflowRes = await db.query(`
            SELECT
                av.id,
                av.voucher_number,
                av.voucher_date,
                av.total_amount AS amount,
                av.description,
                'outflow' AS direction,
                COALESCE(
                    CASE WHEN av.reference_type = 'supplier' THEN s_direct.company_name END,
                    (SELECT sp.company_name FROM purchase_invoices pi JOIN suppliers sp ON sp.id = pi.supplier_id WHERE pi.id = av.reference_id LIMIT 1)
                ) AS party_name,
                'مورد' AS party_type
            FROM accounting_vouchers av
            LEFT JOIN suppliers s_direct ON s_direct.id = av.reference_id AND av.reference_type = 'supplier'
            WHERE av.voucher_type = 'payment'
              AND av.status = 'posted'
              AND av.voucher_date BETWEEN $1 AND $2
        `, [from, to]);

        const all = [...inflowRes.rows, ...outflowRes.rows].sort((a, b) => {
            return new Date(b.voucher_date) - new Date(a.voucher_date);
        });

        const totalInflow  = inflowRes.rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);
        const totalOutflow = outflowRes.rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);

        success(res, {
            transactions: all,
            total_inflow:  totalInflow,
            total_outflow: totalOutflow,
            net_flow:      totalInflow - totalOutflow
        });
    } catch (err) {
        console.error('[Reports] Cash flow error:', err.message);
        error(res, 'Failed to load cash flow data.', 500);
    }
});

// =============================================================================
// GET /api/reports/vat
// Returns VAT report (collected from sales, paid on purchases)
// =============================================================================
router.get('/vat', async (req, res) => {
    try {
        const { from, to } = _parseDateRange(req);

        // VAT collected from sales (orders)
        const salesVatRes = await db.query(`
            SELECT
                o.order_number::text AS doc_number,
                o.order_date AS doc_date,
                c.name AS party_name,
                o.subtotal,
                o.tax_amount,
                o.grand_total
            FROM orders o
            JOIN clients c ON c.id = o.client_id
            WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
              AND o.tax_amount IS NOT NULL
              AND o.order_date BETWEEN $1 AND $2
            ORDER BY o.order_date
        `, [from, to]);

        // VAT paid on purchases
        const purchaseVatRes = await db.query(`
            SELECT
                pi.invoice_number::text AS doc_number,
                pi.invoice_date AS doc_date,
                s.company_name AS party_name,
                pi.subtotal,
                pi.tax_amount,
                pi.grand_total
            FROM purchase_invoices pi
            JOIN suppliers s ON s.id = pi.supplier_id
            WHERE pi.tax_amount IS NOT NULL
              AND pi.invoice_date BETWEEN $1 AND $2
            ORDER BY pi.invoice_date
        `, [from, to]);

        const salesVatTotal   = salesVatRes.rows.reduce((sum, r) => sum + parseFloat(r.tax_amount || 0), 0);
        const purchaseVatTotal = purchaseVatRes.rows.reduce((sum, r) => sum + parseFloat(r.tax_amount || 0), 0);

        success(res, {
            sales_entries:    salesVatRes.rows,
            purchase_entries: purchaseVatRes.rows,
            sales_vat_total:    salesVatTotal,
            purchase_vat_total: purchaseVatTotal,
            net_vat:            salesVatTotal - purchaseVatTotal
        });
    } catch (err) {
        console.error('[Reports] VAT error:', err.message);
        error(res, 'Failed to load VAT report data.', 500);
    }
});

// =============================================================================
// GET /api/reports/sales
// Returns sales report grouped by period, client, or product
// Query param: group_by = day | week | month | client | product (default: month)
// =============================================================================
router.get('/sales', async (req, res) => {
    try {
        const { from, to } = _parseDateRange(req);
        const groupBy = req.query.group_by || 'month';

        let data = [];

        if (groupBy === 'day' || groupBy === 'week' || groupBy === 'month') {
            let dateFormat;
            if (groupBy === 'day')   dateFormat = 'YYYY-MM-DD';
            if (groupBy === 'week')  dateFormat = 'IYYY-IW';
            if (groupBy === 'month') dateFormat = 'YYYY-MM';

            const result = await db.query(`
                SELECT
                    TO_CHAR(o.order_date, '${dateFormat}') AS period,
                    COUNT(*) AS order_count,
                    COALESCE(SUM(o.subtotal), 0) AS subtotal,
                    COALESCE(SUM(o.tax_amount), 0) AS tax,
                    COALESCE(SUM(o.grand_total), 0) AS total
                FROM orders o
                WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
                  AND o.grand_total IS NOT NULL
                  AND o.order_date BETWEEN $1 AND $2
                GROUP BY TO_CHAR(o.order_date, '${dateFormat}')
                ORDER BY period
            `, [from, to]);
            data = result.rows;

        } else if (groupBy === 'client') {
            const result = await db.query(`
                SELECT
                    c.id,
                    c.name AS client_name,
                    COUNT(o.id) AS order_count,
                    COALESCE(SUM(o.grand_total), 0) AS total_sales,
                    COALESCE(SUM(o.paid_amount), 0) AS total_paid,
                    COALESCE(SUM(o.grand_total - o.paid_amount), 0) AS outstanding
                FROM clients c
                JOIN orders o ON o.client_id = c.id
                WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
                  AND o.grand_total IS NOT NULL
                  AND o.order_date BETWEEN $1 AND $2
                GROUP BY c.id, c.name
                ORDER BY total_sales DESC
            `, [from, to]);
            data = result.rows;

        } else if (groupBy === 'product') {
            const result = await db.query(`
                SELECT
                    pv.id,
                    p.name AS product_name,
                    pv.size_name AS variant,
                    SUM(oi.quantity) AS qty_sold,
                    SUM(oi.line_total) AS revenue
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                JOIN product_variants pv ON pv.id = oi.variant_id
                JOIN products p ON p.id = pv.product_id
                WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
                  AND o.grand_total IS NOT NULL
                  AND o.order_date BETWEEN $1 AND $2
                GROUP BY pv.id, p.name, pv.size_name
                ORDER BY revenue DESC
                LIMIT 50
            `, [from, to]);
            data = result.rows;
        }

        success(res, data);
    } catch (err) {
        console.error('[Reports] Sales error:', err.message);
        error(res, 'Failed to load sales report data.', 500);
    }
});

// =============================================================================
// GET /api/reports/quotations
// Returns quotation analytics for the given date range
// =============================================================================
router.get('/quotations', async (req, res) => {
    try {
        const { from, to } = _parseDateRange(req);

        const statsRes = await db.query(`
            SELECT
                COUNT(*) AS total_quotes,
                COUNT(*) FILTER (WHERE status = 'quote') AS pending,
                COUNT(*) FILTER (WHERE status = 'quote' AND valid_until < CURRENT_DATE) AS expired,
                COUNT(*) FILTER (WHERE client_response = 'approved') AS approved,
                COUNT(*) FILTER (WHERE client_response = 'rejected') AS rejected,
                COUNT(*) FILTER (WHERE status IN ('confirmed', 'production', 'processing', 'completed', 'delivered')) AS converted,
                COALESCE(AVG(grand_total), 0) AS avg_quote_value,
                COALESCE(AVG(grand_total) FILTER (WHERE status IN ('confirmed', 'production', 'processing', 'completed', 'delivered')), 0) AS avg_converted_value
            FROM orders
            WHERE order_date BETWEEN $1 AND $2
        `, [from, to]);

        const decisionTimeRes = await db.query(`
            SELECT AVG(EXTRACT(EPOCH FROM (responded_at - created_at)) / 86400)::numeric(10,1) AS avg_decision_days
            FROM orders
            WHERE responded_at IS NOT NULL
              AND order_date BETWEEN $1 AND $2
        `, [from, to]);

        // Expired quotes without response
        const expiredRes = await db.query(`
            SELECT
                o.order_number,
                c.name AS client_name,
                o.order_date,
                o.valid_until,
                o.grand_total
            FROM orders o
            LEFT JOIN clients c ON c.id = o.client_id
            WHERE o.status = 'quote'
              AND o.valid_until < CURRENT_DATE
              AND o.client_response IS NULL
              AND o.order_date BETWEEN $1 AND $2
            ORDER BY o.valid_until DESC
        `, [from, to]);

        const total    = parseInt(statsRes.rows[0].total_quotes) || 0;
        const converted = parseInt(statsRes.rows[0].converted) || 0;

        success(res, {
            total_quotes:      total,
            pending:           parseInt(statsRes.rows[0].pending) || 0,
            expired:           parseInt(statsRes.rows[0].expired) || 0,
            approved:          parseInt(statsRes.rows[0].approved) || 0,
            rejected:          parseInt(statsRes.rows[0].rejected) || 0,
            converted:         converted,
            conversion_rate:   total > 0 ? parseFloat(((converted / total) * 100).toFixed(1)) : 0,
            avg_quote_value:     parseFloat(statsRes.rows[0].avg_quote_value) || 0,
            avg_converted_value: parseFloat(statsRes.rows[0].avg_converted_value) || 0,
            avg_decision_days:   parseFloat(decisionTimeRes.rows[0].avg_decision_days) || 0,
            expired_quotes:    expiredRes.rows
        });
    } catch (err) {
        console.error('[Reports] Quotations error:', err.message);
        error(res, 'Failed to load quotations analytics.', 500);
    }
});

// =============================================================================
// GET /api/reports/client-behavior
// Returns top clients and inactive clients
// =============================================================================
router.get('/client-behavior', async (req, res) => {
    try {
        const { from, to } = _parseDateRange(req);

        // Top clients
        const topRes = await db.query(`
            SELECT
                c.id,
                c.name,
                COUNT(DISTINCT o.id) AS order_count,
                COALESCE(SUM(o.grand_total), 0) AS total_spent,
                COALESCE(AVG(o.grand_total), 0) AS avg_order_value,
                MIN(o.order_date) AS first_order,
                MAX(o.order_date) AS last_order
            FROM clients c
            JOIN orders o ON o.client_id = c.id
            WHERE o.status NOT IN ('quote', 'draft', 'cancelled')
              AND o.grand_total IS NOT NULL
              AND o.order_date BETWEEN $1 AND $2
            GROUP BY c.id, c.name
            ORDER BY total_spent DESC
            LIMIT 20
        `, [from, to]);

        // Inactive clients (90+ days without order)
        const inactiveRes = await db.query(`
            SELECT
                c.id,
                c.name,
                c.phone,
                MAX(o.order_date) AS last_order_date,
                COALESCE(EXTRACT(DAY FROM NOW() - MAX(o.order_date))::int, 9999) AS days_inactive
            FROM clients c
            LEFT JOIN orders o ON o.client_id = c.id
              AND o.status NOT IN ('quote', 'draft', 'cancelled')
            WHERE c.status = 'active'
            GROUP BY c.id, c.name, c.phone
            HAVING MAX(o.order_date) IS NULL OR MAX(o.order_date) < NOW() - INTERVAL '90 days'
            ORDER BY days_inactive DESC
        `);

        success(res, {
            top_clients:    topRes.rows,
            inactive_clients: inactiveRes.rows
        });
    } catch (err) {
        console.error('[Reports] Client behavior error:', err.message);
        error(res, 'Failed to load client behavior data.', 500);
    }
});

// =============================================================================
// GET /api/reports/supplier-performance
// Returns supplier performance metrics
// =============================================================================
router.get('/supplier-performance', async (req, res) => {
    try {
        const { from, to } = _parseDateRange(req);

        const result = await db.query(`
            SELECT
                s.id,
                s.company_name,
                COUNT(mo.id) AS total_orders,
                COUNT(mo.id) FILTER (WHERE mo.status = 'received') AS completed,
                COUNT(mo.id) FILTER (WHERE mo.status = 'sent') AS in_production,
                COUNT(mo.id) FILTER (WHERE mo.status = 'partially_received') AS partial,
                COALESCE(SUM(mo.total_cost), 0) AS total_cost,
                COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(mo.updated_at, NOW()) - mo.created_at)) / 86400)::numeric(10,1), 0) AS avg_lead_time_days
            FROM suppliers s
            JOIN manufacturer_orders mo ON mo.manufacturer_id = s.id
            WHERE mo.status NOT IN ('cancelled')
              AND mo.created_at >= $1::date
              AND mo.created_at < ($2::date + 1)
            GROUP BY s.id, s.company_name
            ORDER BY total_orders DESC
        `, [from, to]);

        success(res, result.rows);
    } catch (err) {
        console.error('[Reports] Supplier performance error:', err.message);
        error(res, 'Failed to load supplier performance data.', 500);
    }
});

// =============================================================================
// GET /api/reports/production-status
// Returns production status distribution
// =============================================================================
router.get('/production-status', async (req, res) => {
    try {
        const { from, to } = _parseDateRange(req);

        const result = await db.query(`
            SELECT
                status,
                COUNT(*) AS count,
                COALESCE(SUM(grand_total), 0) AS value
            FROM orders
            WHERE status NOT IN ('quote', 'draft', 'cancelled')
              AND order_date BETWEEN $1 AND $2
            GROUP BY status
            ORDER BY count DESC
        `, [from, to]);

        success(res, result.rows);
    } catch (err) {
        console.error('[Reports] Production status error:', err.message);
        error(res, 'Failed to load production status data.', 500);
    }
});

// =============================================================================
// GET /api/reports/production-cycle
// Returns production cycle time per order
// =============================================================================
router.get('/production-cycle', async (req, res) => {
    try {
        const { from, to } = _parseDateRange(req);

        const result = await db.query(`
            SELECT
                o.order_number,
                o.order_date,
                MIN(dn.delivered_at) AS first_delivery,
                MAX(dn.delivered_at) AS last_delivery,
                EXTRACT(EPOCH FROM (MAX(dn.delivered_at) - o.order_date)) / 86400 AS total_cycle_days
            FROM orders o
            JOIN delivery_notes dn ON dn.order_id = o.id
            WHERE dn.status = 'completed'
              AND dn.delivered_at IS NOT NULL
              AND o.order_date BETWEEN $1 AND $2
            GROUP BY o.order_number, o.order_date
            ORDER BY total_cycle_days DESC
        `, [from, to]);

        const cycles = result.rows.map(r => ({
            ...r,
            total_cycle_days: parseFloat(r.total_cycle_days).toFixed(1)
        }));

        const avgDays = cycles.length > 0
            ? parseFloat((cycles.reduce((sum, r) => sum + parseFloat(r.total_cycle_days), 0) / cycles.length).toFixed(1))
            : 0;
        const maxDays = cycles.length > 0 ? parseFloat(cycles[0].total_cycle_days) : 0;
        const minDays = cycles.length > 0 ? parseFloat(cycles[cycles.length - 1].total_cycle_days) : 0;

        success(res, {
            orders: cycles,
            avg_cycle_days: avgDays,
            max_cycle_days: maxDays,
            min_cycle_days: minDays
        });
    } catch (err) {
        console.error('[Reports] Production cycle error:', err.message);
        error(res, 'Failed to load production cycle data.', 500);
    }
});

// =============================================================================
// GET /api/reports/stock-value
// Returns stock value by warehouse and client
// =============================================================================
router.get('/stock-value', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                w.id,
                w.name AS warehouse_name,
                c.name AS client_name,
                COUNT(ws.id) AS sku_count,
                COALESCE(SUM(ws.quantity), 0) AS total_qty,
                COALESCE(SUM(ws.quantity * pv.cost_price), 0) AS cost_value,
                COALESCE(SUM(ws.quantity * pv.selling_price), 0) AS retail_value
            FROM warehouse_stock ws
            JOIN warehouses w ON w.id = ws.warehouse_id
            LEFT JOIN clients c ON c.id = ws.client_id
            JOIN product_variants pv ON pv.id = ws.variant_id
            WHERE ws.quantity > 0
            GROUP BY w.id, w.name, c.name
            ORDER BY cost_value DESC
        `);

        success(res, result.rows);
    } catch (err) {
        console.error('[Reports] Stock value error:', err.message);
        error(res, 'Failed to load stock value data.', 500);
    }
});

// =============================================================================
// GET /api/reports/stock-movement
// Returns stock movement summary by transaction type
// =============================================================================
router.get('/stock-movement', async (req, res) => {
    try {
        const { from, to } = _parseDateRange(req);

        const result = await db.query(`
            SELECT
                transaction_type,
                COUNT(*) AS count,
                COALESCE(SUM(quantity), 0) AS total_qty
            FROM inventory_transactions
            WHERE created_at >= $1::date
              AND created_at < ($2::date + 1)
            GROUP BY transaction_type
            ORDER BY total_qty DESC
        `, [from, to]);

        success(res, result.rows);
    } catch (err) {
        console.error('[Reports] Stock movement error:', err.message);
        error(res, 'Failed to load stock movement data.', 500);
    }
});

// =============================================================================
// GET /api/reports/stock-alerts
// Returns low stock and idle stock alerts
// =============================================================================
router.get('/stock-alerts', async (req, res) => {
    try {
        // Low stock / out of stock
        const lowStockRes = await db.query(`
            SELECT
                p.name,
                pv.size_name,
                w.name AS warehouse_name,
                ws.quantity,
                pv.min_stock_level,
                CASE WHEN ws.quantity = 0 THEN 'out' ELSE 'low' END AS alert_type
            FROM warehouse_stock ws
            JOIN product_variants pv ON pv.id = ws.variant_id
            JOIN products p ON p.id = pv.product_id
            JOIN warehouses w ON w.id = ws.warehouse_id
            WHERE ws.quantity <= pv.min_stock_level
              AND pv.min_stock_level > 0
            ORDER BY alert_type, p.name
        `);

        // Idle stock (90+ days without movement)
        const idleRes = await db.query(`
            SELECT
                p.name,
                pv.size_name,
                w.name AS warehouse_name,
                ws.quantity,
                ws.last_updated,
                EXTRACT(DAY FROM NOW() - ws.last_updated)::int AS days_idle
            FROM warehouse_stock ws
            JOIN product_variants pv ON pv.id = ws.variant_id
            JOIN products p ON p.id = pv.product_id
            JOIN warehouses w ON w.id = ws.warehouse_id
            WHERE ws.quantity > 0
              AND ws.last_updated < NOW() - INTERVAL '90 days'
            ORDER BY days_idle DESC
        `);

        success(res, {
            low_stock:  lowStockRes.rows,
            idle_stock: idleRes.rows
        });
    } catch (err) {
        console.error('[Reports] Stock alerts error:', err.message);
        error(res, 'Failed to load stock alerts data.', 500);
    }
});

// =============================================================================
// GET /api/reports/designer-productivity
// Returns designer productivity metrics
// =============================================================================
router.get('/designer-productivity', async (req, res) => {
    try {
        const { from, to } = _parseDateRange(req);

        // Designs created in the period, grouped by designer (via uploaded_by in design files)
        const result = await db.query(`
            SELECT
                u.name AS designer_name,
                COUNT(DISTINCT df.design_id) AS total_designs,
                COUNT(DISTINCT df.design_id) FILTER (WHERE cd.is_active = true) AS active_designs,
                COALESCE(AVG(EXTRACT(EPOCH FROM (cd.updated_at - cd.created_at)) / 86400)::numeric(10,1), 0) AS avg_completion_days
            FROM client_design_files df
            JOIN users u ON u.id = df.uploaded_by
            JOIN client_designs cd ON cd.id = df.design_id
            WHERE df.uploaded_at >= $1::date
              AND df.uploaded_at < ($2::date + 1)
            GROUP BY u.name
            ORDER BY total_designs DESC
        `, [from, to]);

        success(res, result.rows);
    } catch (err) {
        console.error('[Reports] Designer productivity error:', err.message);
        error(res, 'Failed to load designer productivity data.', 500);
    }
});

// =============================================================================
// GET /api/reports/design-approval
// Returns design approval status distribution from order_items
// =============================================================================
router.get('/design-approval', async (req, res) => {
    try {
        const { from, to } = _parseDateRange(req);

        const result = await db.query(`
            SELECT
                design_status,
                COUNT(*) AS count
            FROM order_items
            WHERE design_status != 'new'
              AND created_at >= $1::date
              AND created_at < ($2::date + 1)
            GROUP BY design_status
            ORDER BY count DESC
        `, [from, to]);

        const total = result.rows.reduce((sum, r) => sum + parseInt(r.count), 0);

        success(res, {
            statuses: result.rows,
            total: total
        });
    } catch (err) {
        console.error('[Reports] Design approval error:', err.message);
        error(res, 'Failed to load design approval data.', 500);
    }
});

module.exports = router;
