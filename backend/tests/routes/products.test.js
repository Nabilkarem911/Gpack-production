'use strict';

const request = require('supertest');
const express = require('express');

const productId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const variantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mockQuery = jest.fn();

jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
    withTransaction: jest.fn(async (fn) => fn({ query: mockQuery })),
}));
jest.mock('../../middleware/authorize', () => () => (_req, _res, next) => next());

const productsRouter = require('../../routes/products');

function buildApp(user) {
    const app = express();
    app.use(express.json());
    if (user) {
        app.use((req, _res, next) => { req.user = user; next(); });
    }
    app.use('/api/products', productsRouter);
    return app;
}

const adminUser = { id: 'u1', role: 'admin', permissions: { all_access: true } };
const productsViewer = { id: 'u2', role: 'user', permissions: { products: { view: true } } };
const stockViewer = { id: 'u3', role: 'user', permissions: { inventory: { view: true }, products: { view: true } } };

const PRODUCT_ROW = {
    id: productId, name: 'صنف اختبار', description: 'وصف', category_id: null,
    sku: 'PRD-00001', barcode: null, status: 'active',
    created_by: null, created_by_name: null,
    category_name: null, created_at: '2026-01-01', updated_at: '2026-01-01',
};

const VARIANT_ROW = {
    id: variantId, product_id: productId, size_name: '1 كجم', sku: 'V-1', barcode: '123',
    unit_id: null, unit_name: 'كجم', unit_abbreviation: 'kg',
    selling_price: '50.00', cost_price: '30.00',
    min_stock_level: 5, max_stock_level: null,
    weight: null, dimensions: null, status: 'active',
    created_at: '2026-01-01', updated_at: '2026-01-01',
};

function setupMock() {
    mockQuery.mockImplementation(async (sql) => {
        // Product existence/base lookup
        if (sql.includes('FROM products p') && sql.includes('WHERE p.id')) {
            return { rowCount: 1, rows: [PRODUCT_ROW] };
        }
        // sales — distinguish the 4 sub-queries (most specific first)
        if (sql.includes('TO_CHAR(o.order_date')) {
            return { rows: [{ month: '2026-01', qty: '10', revenue: '550' }] };
        }
        if (sql.includes('JOIN clients c') && sql.includes('ORDER BY revenue DESC')) {
            return { rows: [{ id: 'c1', name: 'عميل 1', qty: '10', revenue: '550' }] };
        }
        if (sql.includes('o.order_number')) {
            return { rows: [{
                order_id: 'o1', order_number: 1001, order_date: '2026-01-02', status: 'delivered',
                client_name: 'عميل 1', size_name: '1 كجم', quantity: '10', unit_price: '55', line_total: '550',
            }] };
        }
        if (sql.includes('COUNT(DISTINCT o.id)')) {
            return { rows: [{
                variant_id: variantId, size_name: '1 كجم', qty_sold: '10', revenue: '550',
                order_count: 1, avg_price: '55', min_price: '45', max_price: '60',
            }] };
        }
        // prices query (contains stats.avg_price + pcost LATERAL with UNION ALL)
        if (sql.includes('stats.avg_price')) {
            return { rows: [{ ...VARIANT_ROW, avg_price: '55', min_price: '45', max_price: '60', qty_sold: '10', revenue: '550', avg_purchase_cost: '28', last_purchase_cost: '30' }] };
        }
        // purchases — 3 sub-queries
        if (sql.includes('UNION ALL')) {
            return { rows: [{ unit_cost: '30', created_at: '2026-01-03', src: 'manufacturer_order' }] };
        }
        if (sql.includes('GROUP BY mo.id')) {
            return { rows: [{
                id: 'mo1', mo_number: 2001, status: 'in_production', expected_delivery_date: '2026-02-01',
                company_name: 'مورد 1', qty: '20', received: '5',
            }] };
        }
        if (sql.includes('FROM manufacturer_order_items moi')) {
            return { rows: [{
                id: 'sup1', company_name: 'مورد 1', total_ordered: '20',
                total_received: '5', last_order_at: '2026-01-03',
            }] };
        }
        // movements
        if (sql.includes('FROM inventory_transactions it')) {
            return { rows: [{
                id: 't1', transaction_type: 'receipt', quantity: '5', unit_cost: '30',
                created_at: '2026-01-03', notes: null, reference_type: 'manufacturer_order',
                reference_id: 'r1', size_name: '1 كجم', client_name: null,
                warehouse_from_name: null, warehouse_to_name: 'المستودع الرئيسي',
                mo_number: 2001, manufacturer_id: 'sup1', supplier_name: 'مورد 1',
                delivery_note_number: null,
            }] };
        }
        // stock
        if (sql.includes('FROM warehouse_stock ws')) {
            return { rows: [{
                stock_id: 's1', warehouse_id: 'w1', warehouse_name: 'المستودع الرئيسي',
                client_id: 'c1', client_name: 'عميل 1', client_parent_name: null,
                variant_id: variantId, size_name: '1 كجم', variant_sku: 'V-1',
                min_stock_level: 5, max_stock_level: null,
                unit_name: 'كجم', unit_abbreviation: 'kg',
                quantity: '10', reserved_qty: '2', available_qty: '8', last_updated: '2026-01-05',
            }] };
        }
        // overview variants
        if (sql.includes('FROM product_variants pv')) {
            return { rows: [VARIANT_ROW] };
        }
        throw new Error(`Unexpected query: ${sql}`);
    });
}

describe('GET /api/products/:id/lifecycle', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        setupMock();
    });

    test('returns 403 when the user has no view permission', async () => {
        const res = await request(buildApp(null)).get(`/api/products/${productId}/lifecycle`);
        expect(res.status).toBe(403);
    });

    test('returns 400 for an unknown section', async () => {
        const res = await request(buildApp(adminUser)).get(`/api/products/${productId}/lifecycle?section=bogus`);
        expect(res.status).toBe(400);
    });

    test('overview returns the product with all variants', async () => {
        const res = await request(buildApp(adminUser)).get(`/api/products/${productId}/lifecycle`);
        expect(res.status).toBe(200);
        expect(res.body.data.section).toBe('overview');
        expect(res.body.data.product.id).toBe(productId);
        expect(res.body.data.variants).toHaveLength(1);
        expect(res.body.data.variants[0].size_name).toBe('1 كجم');
    });

    test('returns 404 when the product does not exist', async () => {
        mockQuery.mockImplementation(async () => ({ rowCount: 0, rows: [] }));
        const res = await request(buildApp(adminUser)).get(`/api/products/${productId}/lifecycle`);
        expect(res.status).toBe(404);
    });

    test('stock section returns rows and per-variant totals', async () => {
        const res = await request(buildApp(stockViewer)).get(`/api/products/${productId}/lifecycle?section=stock`);
        expect(res.status).toBe(200);
        expect(res.body.data.stock).toHaveLength(1);
        expect(res.body.data.totals[0]).toMatchObject({ variant_id: variantId });
        expect(parseFloat(res.body.data.totals[0].available_qty)).toBe(8);
    });

    test('stock section applies client_id scoping when provided', async () => {
        const res = await request(buildApp(adminUser))
            .get(`/api/products/${productId}/lifecycle?section=stock&client_id=cccccccc-cccc-4ccc-8ccc-cccccccccccc`);
        expect(res.status).toBe(200);
        const stockCall = mockQuery.mock.calls.find(([sql]) => sql.includes('FROM warehouse_stock ws'));
        expect(stockCall[1]).toContain('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    });

    test('movements section returns recent transactions', async () => {
        const res = await request(buildApp(stockViewer)).get(`/api/products/${productId}/lifecycle?section=movements`);
        expect(res.status).toBe(200);
        expect(res.body.data.movements).toHaveLength(1);
        expect(res.body.data.movements[0].mo_number).toBe(2001);
    });

    test('sales section is denied for a products-only viewer', async () => {
        const res = await request(buildApp(productsViewer)).get(`/api/products/${productId}/lifecycle?section=sales`);
        expect(res.status).toBe(403);
    });

    test('sales section returns aggregates for an authorized user', async () => {
        const salesUser = { id: 'u4', role: 'user', permissions: { sales: { view: true }, products: { view: true } } };
        const res = await request(buildApp(salesUser)).get(`/api/products/${productId}/lifecycle?section=sales`);
        expect(res.status).toBe(200);
        expect(res.body.data.by_variant[0].qty_sold).toBe('10');
        expect(res.body.data.monthly[0].month).toBe('2026-01');
        expect(res.body.data.top_clients[0].name).toBe('عميل 1');
        expect(res.body.data.recent_lines[0].order_number).toBe(1001);
    });

    test('purchases section returns suppliers, last cost and open MOs', async () => {
        const purUser = { id: 'u5', role: 'user', permissions: { purchasing: { view: true }, products: { view: true } } };
        const res = await request(buildApp(purUser)).get(`/api/products/${productId}/lifecycle?section=purchases`);
        expect(res.status).toBe(200);
        expect(res.body.data.suppliers[0].company_name).toBe('مورد 1');
        expect(res.body.data.last_cost.unit_cost).toBe('30');
        expect(res.body.data.open_manufacturer_orders[0].mo_number).toBe(2001);
    });

    test('prices section returns variant prices with historical stats', async () => {
        const res = await request(buildApp(adminUser)).get(`/api/products/${productId}/lifecycle?section=prices`);
        expect(res.status).toBe(200);
        expect(res.body.data.prices[0].selling_price).toBe('50.00');
        expect(res.body.data.prices[0].avg_price).toBe('55');
    });
});
