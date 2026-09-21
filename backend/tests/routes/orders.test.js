// =============================================================================
// Tests: routes/orders.js  (Zod validation integration)
// =============================================================================

const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockWriteOutboxEvent = jest.fn();
jest.mock('../../services/notification-service', () => ({
    writeOutboxEvent: (...args) => mockWriteOutboxEvent(...args),
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

describe('Orders Routes — Zod Validation', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        // Simulate req.user as the authenticate middleware would
        app.use((req, res, next) => {
            req.user = { id: 1, role: 'admin', permissions: {} };
            next();
        });
        app.use('/api/orders', orderRoutes);
        mockQuery.mockClear();
        mockRelease.mockClear();
        mockWriteOutboxEvent.mockClear();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('POST / should reject missing client_id (Zod)', async () => {
        const res = await request(app)
            .post('/api/orders')
            .send({
                items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440000', quantity: 10 }],
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation failed');
        expect(res.body.field).toBe('client_id');
    });

    test('POST / should reject empty items array (Zod)', async () => {
        const res = await request(app)
            .post('/api/orders')
            .send({
                client_id: '550e8400-e29b-41d4-a716-446655440000',
                items: [],
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation failed');
        expect(res.body.message).toMatch(/at least one item/i);
    });

    test('POST / should reject invalid item quantity (Zod)', async () => {
        const res = await request(app)
            .post('/api/orders')
            .send({
                client_id: '550e8400-e29b-41d4-a716-446655440000',
                items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440000', quantity: -5 }],
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation failed');
        expect(res.body.field).toMatch(/items/);
    });

    test('POST / should reject invalid date format (Zod)', async () => {
        const res = await request(app)
            .post('/api/orders')
            .send({
                client_id: '550e8400-e29b-41d4-a716-446655440000',
                order_date: '16-06-2026',
                items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440000', quantity: 10 }],
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation failed');
        expect(res.body.field).toMatch(/order_date/);
    });

    test('converting a quotation queues one manager notification with client and products', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM orders') && sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{
                    id: 'order-1', order_number: 123, status: 'quote', client_id: 'client-1',
                    grand_total: '1000', paid_amount: '0', created_by: 1,
                }] };
            }
            if (sql.includes('SELECT name FROM clients')) {
                return { rowCount: 1, rows: [{ name: 'عميل الاختبار' }] };
            }
            if (sql.includes("UPDATE orders\n                 SET status")) return { rowCount: 1, rows: [] };
            if (sql.includes('FROM notification_settings')) {
                return { rows: [
                    { key: 'internal_whatsapp_enabled', value: true },
                    { key: 'manager_whatsapp_phone', value: '0550000000' },
                ] };
            }
            if (sql.includes('FROM order_items oi')) {
                return { rows: [{ product_name: 'منتج أول' }, { product_name: 'منتج ثان' }] };
            }
            return { rowCount: 1, rows: [] };
        });

        const res = await request(app)
            .post('/api/orders/order-1/convert-to-production')
            .send({});

        expect(res.status).toBe(200);
        expect(mockWriteOutboxEvent).toHaveBeenCalledWith(expect.objectContaining({
            event_type: 'quotation_converted_to_production',
            entity_type: 'order',
            entity_id: 'order-1',
            payload: expect.objectContaining({
                order_number: 123,
                client_name: 'عميل الاختبار',
                products: ['منتج أول', 'منتج ثان'],
            }),
            session: 'internal',
        }), expect.anything());
    });

    test('GET / exposes has_final_invoice derived from valid final invoice statuses', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [
            { id: 'o1', status: 'completed', has_final_invoice: true,  total_count: 2 },
            { id: 'o2', status: 'delivered', has_final_invoice: false, total_count: 2 },
        ] });

        const res = await request(app).get('/api/orders?statuses=completed,delivered');

        expect(res.status).toBe(200);
        const sql = mockQuery.mock.calls[0][0];
        expect(sql).toContain('has_final_invoice');
        expect(sql).toContain("'issued', 'paid', 'overdue', 'archived'");
        expect(sql).not.toContain("inv.status = 'final'");
        expect(res.body.data[0].has_final_invoice).toBe(true);
        expect(res.body.data[1].has_final_invoice).toBe(false);
    });

    test('GET /ready-for-invoice excludes orders having a final-status invoice', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ total: 1 }] })
            .mockResolvedValueOnce({ rows: [{ id: 'o1', order_number: 7, status: 'delivered' }] });

        const res = await request(app).get('/api/orders/ready-for-invoice');

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
        for (const call of mockQuery.mock.calls) {
            expect(call[0]).toContain("'issued', 'paid', 'overdue', 'archived'");
            expect(call[0]).not.toContain("inv.status = 'final'");
            expect(call[0]).not.toContain("status = 'final'");
        }
        // delivered orders without a final invoice are eligible for invoicing
        expect(mockQuery.mock.calls[0][0]).toContain("'delivered'");
    });

    test('POST /:id/invoice issues a final invoice for a delivered order', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('system_settings')) return { rows: [] };
            if (sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{ id: 'o1', order_number: 1, client_id: 'c1', status: 'delivered', grand_total: '0' }] };
            }
            if (sql.includes('FROM invoices') && sql.includes("status = 'issued'")) return { rowCount: 0, rows: [] };
            if (sql.includes('FROM order_items oi')) return { rowCount: 1, rows: [{ received: '10', product_name: 'P', size_name: 'M' }] };
            if (sql.includes('INSERT INTO invoices')) return { rowCount: 1, rows: [{ id: 'inv1', invoice_number: 42 }] };
            if (sql.includes('INSERT INTO invoice_items')) return { rowCount: 1, rows: [] };
            if (sql.includes('UPDATE orders')) return { rowCount: 1, rows: [] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app)
            .post('/api/orders/o1/invoice')
            .send({ type: 'final', items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440000', qty: 2, unit_price: 100 }] });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ invoice_id: 'inv1', invoice_number: 42 });
    });

    test('POST /:id/invoice still rejects non-production statuses like quote', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('system_settings')) return { rows: [] };
            if (sql.includes('FOR UPDATE')) {
                return { rowCount: 1, rows: [{ id: 'o1', order_number: 1, client_id: 'c1', status: 'quote', grand_total: '0' }] };
            }
            return { rowCount: 0, rows: [] };
        });

        const res = await request(app)
            .post('/api/orders/o1/invoice')
            .send({ type: 'final', items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440000', qty: 1, unit_price: 10 }] });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('فاتورة');
    });

    test('GET /:id includes direct receipt supplier and source metadata', async () => {
        mockQuery
            .mockResolvedValueOnce({ rowCount: 1, rows: [{
                id: '550e8400-e29b-41d4-a716-446655440000',
                order_number: 1001,
                status: 'production',
                client_id: '660e8400-e29b-41d4-a716-446655440000',
                client_name: 'Test Client',
                direct_receipt_id: '770e8400-e29b-41d4-a716-446655440000',
                direct_receipt_supplier_name: 'Test Supplier',
                direct_receipt_number: 12,
                direct_receipt_purchase_invoice_number: 2001,
            }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const res = await request(app)
            .get('/api/orders/550e8400-e29b-41d4-a716-446655440000');

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            direct_receipt_supplier_name: 'Test Supplier',
            direct_receipt_number: 12,
            direct_receipt_purchase_invoice_number: 2001,
        });
        expect(mockQuery.mock.calls[0][0]).toContain('direct_receipt_supplier_name');
    });
});
