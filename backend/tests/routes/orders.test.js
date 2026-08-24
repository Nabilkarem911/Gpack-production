// =============================================================================
// Tests: routes/orders.js  (Zod validation integration)
// =============================================================================

const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
const mockRelease = jest.fn();
jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
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
