// =============================================================================
// Tests: GET /api/orders/:id/cost-calculator
// Verifies consumed-qty costing (contract vs received), preliminary vs approved
// costs, approval deltas, discounts, and invoice-status filtering.
// pg returns DECIMAL columns as strings — mocks mimic that.
// =============================================================================

const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
const mockRelease = jest.fn();
jest.mock('../../services/notification-service', () => ({
    writeOutboxEvent: jest.fn(),
    generateCorrelationId: jest.fn(() => 'QTP-test'),
}));
jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
    withTransaction: async callback => callback({ query: (...args) => mockQuery(...args) }),
    pool: {
        connect: jest.fn(() => Promise.resolve({
            query: (...args) => mockQuery(...args),
            release: mockRelease,
        })),
    },
    getClient: jest.fn(() => Promise.resolve({
        query: (...args) => mockQuery(...args),
        release: mockRelease,
    })),
}));

const orderRoutes = require('../../routes/orders');

const CALC_SQL = (sql) => sql.includes('LEFT JOIN LATERAL') && sql.includes('FROM order_items oi');

function buildApp(role = 'admin') {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.user = { id: 1, role, permissions: {} };
        next();
    });
    app.use('/api/orders', orderRoutes);
    return app;
}

// Mirrors the cost-calculator SELECT shape. Defaults: nothing received, avg cost 1.00.
const itemRow = (over = {}) => ({
    order_item_id: 'i1',
    variant_id: 'v1',
    product_name: 'منتج اختبار',
    size_name: 'وسط',
    sku: 'SKU-1',
    quantity: '100',
    wh_received_qty: '0',
    sale_unit_price: '1.50',
    discount_percent: '0',
    discount_amount: '0',
    sale_total: '150.00',
    avg_unit_cost: '1.00',
    invoice_count: 2,
    latest_invoice_date: '2026-09-01',
    sess_qty: '0',
    approved_qty: '0',
    approved_cost: '0',
    approved_sess_cost: '0',
    preliminary_qty: '0',
    preliminary_cost: '0',
    uncosted_qty: '0',
    ...over,
});

describe('GET /api/orders/:id/cost-calculator', () => {
    let app;

    beforeEach(() => {
        app = buildApp('admin');
        mockQuery.mockClear();
        mockRelease.mockClear();
    });

    afterEach(() => jest.clearAllMocks());

    test('computes totals via historical average when nothing was received yet', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (CALC_SQL(sql)) return { rows: [
                itemRow(),
                itemRow({ order_item_id: 'i2', variant_id: 'v2', quantity: '200',
                          sale_unit_price: '0.75', sale_total: '150.00', avg_unit_cost: '0.50' }),
            ] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app).get('/api/orders/o1/cost-calculator');

        expect(res.status).toBe(200);
        const { items, summary } = res.body.data;

        // item 1: 100 remaining × avg 1.00 = 100 | profit 50 | margin 33.33%
        expect(items[0].cost_total).toBe(100);
        expect(items[0].profit).toBe(50);
        expect(items[0].margin_percent).toBe(33.33);
        expect(items[0].cost_status).toBe('estimated');
        expect(items[0].qty_variance).toBe(false);
        expect(items[1].cost_total).toBe(100);

        expect(summary).toMatchObject({
            sales_total: 300,
            cost_total: 200,
            profit: 100,
            margin_percent: 33.33,
            missing_cost_items: 0,
            qty_variance_items: 0,
            preliminary_cost_items: 0,
            contract_cost_total: 200,
            contract_profit: 100,
            contract_margin_percent: 33.33,
        });
    });

    test('charges the actually-received qty when it exceeds the contract (over-receipt)', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (CALC_SQL(sql)) return { rows: [
                // Ordered 20, received 21, all approved at actual invoice cost 8/unit
                itemRow({ quantity: '20', wh_received_qty: '21', sale_unit_price: '10', sale_total: '200',
                          avg_unit_cost: null, invoice_count: 0,
                          sess_qty: '21', approved_qty: '21',
                          approved_cost: '168', approved_sess_cost: '168' }),
            ] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app).get('/api/orders/o1/cost-calculator');
        const { items, summary } = res.body.data;

        // Consumed basis: 21 × 8 = 168 → profit 32, margin 16%
        expect(items[0].cost_total).toBe(168);
        expect(items[0].unit_cost).toBe(8);
        expect(items[0].profit).toBe(32);
        expect(items[0].margin_percent).toBe(16);
        expect(items[0].cost_status).toBe('final');
        expect(items[0].qty_variance).toBe(true);
        // Contract reference: 20 × 8 = 160 → profit 40, margin 20%
        expect(items[0].contract_cost_total).toBe(160);
        expect(items[0].contract_profit).toBe(40);
        expect(items[0].contract_margin_percent).toBe(20);

        expect(summary.cost_total).toBe(168);
        expect(summary.profit).toBe(32);
        expect(summary.qty_variance_items).toBe(1);
        expect(summary.contract_cost_total).toBe(160);
        expect(summary.contract_profit).toBe(40);
        expect(summary.contract_margin_percent).toBe(20);
    });

    test('uses session cost as preliminary while the purchase invoice is still draft', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (CALC_SQL(sql)) return { rows: [
                // 10 received, invoice still draft → session cost 7/unit is preliminary
                itemRow({ quantity: '10', wh_received_qty: '10', sale_unit_price: '10', sale_total: '100',
                          avg_unit_cost: null, invoice_count: 0,
                          sess_qty: '10', preliminary_qty: '10', preliminary_cost: '70' }),
            ] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app).get('/api/orders/o1/cost-calculator');
        const { items, summary } = res.body.data;

        expect(items[0].cost_total).toBe(70);
        expect(items[0].cost_status).toBe('preliminary');
        expect(items[0].profit).toBe(30);
        expect(summary.cost_total).toBe(70);
        expect(summary.profit).toBe(30);
        expect(summary.missing_cost_items).toBe(0);
        expect(summary.preliminary_cost_items).toBe(1);
    });

    test('replaces the session estimate with the approved invoice cost and exposes the delta', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (CALC_SQL(sql)) return { rows: [
                // Session estimated 7/unit (70); manager approved invoice at 8/unit (80)
                itemRow({ quantity: '10', wh_received_qty: '10', sale_total: '100',
                          avg_unit_cost: null, invoice_count: 1,
                          sess_qty: '10', approved_qty: '10',
                          approved_cost: '80', approved_sess_cost: '70' }),
            ] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app).get('/api/orders/o1/cost-calculator');
        const item = res.body.data.items[0];

        expect(item.cost_status).toBe('final');
        expect(item.approved_cost).toBe(80);
        expect(item.approval_delta).toBe(10);   // invoice was 10 above the estimate
        expect(item.cost_total).toBe(80);
    });

    test('partial receipt: approved cost for received units + average for the remainder', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (CALC_SQL(sql)) return { rows: [
                // 19 of 20 received and approved @8; the last unit still expected at avg 8
                itemRow({ quantity: '20', wh_received_qty: '19', sale_total: '200',
                          avg_unit_cost: '8',
                          sess_qty: '19', approved_qty: '19',
                          approved_cost: '152', approved_sess_cost: '152' }),
            ] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app).get('/api/orders/o1/cost-calculator');
        const item = res.body.data.items[0];

        expect(item.cost_total).toBe(160);      // 152 approved + 1 × 8 estimated
        expect(item.cost_status).toBe('mixed');
        expect(item.estimated_cost).toBe(8);
        expect(item.qty_variance).toBe(true);
    });

    test('marks item unknown when received units have no cost anywhere', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (CALC_SQL(sql)) return { rows: [
                itemRow({ quantity: '10', wh_received_qty: '5', sale_total: '100',
                          avg_unit_cost: null,
                          sess_qty: '5', uncosted_qty: '5' }),
            ] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app).get('/api/orders/o1/cost-calculator');
        const { items, summary } = res.body.data;

        expect(items[0].cost_known).toBe(false);
        expect(items[0].cost_status).toBe('unknown');
        expect(items[0].cost_total).toBeNull();
        expect(items[0].profit).toBeNull();
        expect(summary.missing_cost_items).toBe(1);
        expect(summary.cost_total).toBeNull();
        expect(summary.profit).toBeNull();
    });

    test('nulls summary aggregates when any item lacks cost data', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (CALC_SQL(sql)) return { rows: [
                itemRow(),
                itemRow({ order_item_id: 'i2', variant_id: 'v2', avg_unit_cost: null }),
            ] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app).get('/api/orders/o1/cost-calculator');
        const { items, summary } = res.body.data;

        expect(items[0].profit).toBe(50);
        expect(items[1].cost_known).toBe(false);
        expect(items[1].profit).toBeNull();

        expect(summary.sales_total).toBe(300);
        expect(summary.missing_cost_items).toBe(1);
        expect(summary.known_cost_total).toBe(100);
        expect(summary.cost_total).toBeNull();
        expect(summary.profit).toBeNull();
        expect(summary.contract_profit).toBeNull();
    });

    test('uses post-discount line_total for sale_total and profit', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (CALC_SQL(sql)) return { rows: [
                itemRow({ discount_percent: '10', sale_total: '135.00' }),
            ] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app).get('/api/orders/o1/cost-calculator');
        const { items, summary } = res.body.data;

        expect(items[0].sale_unit_price).toBe(1.5);
        expect(items[0].sale_total).toBe(135);
        expect(items[0].profit).toBe(35);
        expect(items[0].margin_percent).toBe(25.93);
        expect(summary.sales_total).toBe(135);
        expect(summary.profit).toBe(35);
    });

    test('returns null margin when an item sells for zero', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (CALC_SQL(sql)) return { rows: [
                itemRow({ sale_unit_price: '0', sale_total: '0' }),
            ] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app).get('/api/orders/o1/cost-calculator');
        const { items, summary } = res.body.data;

        expect(items[0].profit).toBe(-100);
        expect(items[0].margin_percent).toBeNull();
        expect(summary.profit).toBe(-100);
        expect(summary.margin_percent).toBeNull();
    });

    test('returns zeroed summary for an order with no items', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (CALC_SQL(sql)) return { rowCount: 0, rows: [] };
            if (sql.includes('SELECT id FROM orders')) return { rowCount: 1, rows: [{ id: 'o1' }] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app).get('/api/orders/o1/cost-calculator');

        expect(res.status).toBe(200);
        expect(res.body.data.items).toEqual([]);
        expect(res.body.data.summary).toMatchObject({
            sales_total: 0, cost_total: 0, profit: 0,
            missing_cost_items: 0, margin_percent: null,
            contract_profit: 0, contract_margin_percent: null,
        });
    });

    test('returns 404 when the order does not exist', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (CALC_SQL(sql)) return { rowCount: 0, rows: [] };
            if (sql.includes('SELECT id FROM orders')) return { rowCount: 0, rows: [] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app).get('/api/orders/nope/cost-calculator');
        expect(res.status).toBe(404);
    });

    test('cost query excludes draft/merged/cancelled invoices and reversed sessions', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (CALC_SQL(sql)) return { rows: [itemRow()] };
            return { rowCount: 0, rows: [] };
        });

        await request(app).get('/api/orders/o1/cost-calculator');

        const sql = mockQuery.mock.calls.find(([s]) => CALC_SQL(s))[0];
        expect(sql).toContain("pi.status NOT IN ('draft', 'merged', 'cancelled')");
        expect(sql).toMatch(/SUM\(pii\.quantity \* pii\.unit_cost\)\s*\/\s*NULLIF\(SUM\(pii\.quantity\)/);
        expect(sql).toContain('pii.unit_cost > 0');
        expect(sql).toContain("rs.status <> 'reversed'");
        expect(sql).toContain('moi.order_item_id = oi.id');
    });

    test('rounds weighted-average cost totals to 2 decimals', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (CALC_SQL(sql)) return { rows: [
                itemRow({ quantity: '3', sale_total: '10.00', avg_unit_cost: '0.3333333' }),
            ] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app).get('/api/orders/o1/cost-calculator');
        expect(res.body.data.items[0].cost_total).toBe(1);
        expect(res.body.data.items[0].profit).toBe(9);
    });

    test('returns discount fields so exports can reconcile sale totals', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (CALC_SQL(sql)) return { rows: [itemRow({ discount_percent: '10', discount_amount: '5', sale_total: '130.00' })] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app).get('/api/orders/o1/cost-calculator');
        expect(res.body.data.items[0].discount_percent).toBe(10);
        expect(res.body.data.items[0].discount_amount).toBe(5);
    });

    test('rejects non-admin users', async () => {
        const staffApp = buildApp('sales_rep');
        const res = await request(staffApp).get('/api/orders/o1/cost-calculator');
        expect(res.status).toBe(403);
        expect(mockQuery).not.toHaveBeenCalled();
    });
});
