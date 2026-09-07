'use strict';

const request = require('supertest');
const express = require('express');

const invoiceId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const warehouseId = '33333333-3333-4333-8333-333333333333';
const itemId = '44444444-4444-4444-8444-444444444444';
const variantId = '55555555-5555-4555-8555-555555555555';
const returnId = '66666666-6666-4666-8666-666666666666';

const mockClientQuery = jest.fn();
const mockClient = { query: (...args) => mockClientQuery(...args), release: jest.fn() };

jest.mock('../../db', () => ({
    query: jest.fn(),
    pool: { connect: jest.fn(() => Promise.resolve(mockClient)) },
}));
jest.mock('../../middleware/authorize', () => () => (_req, _res, next) => next());

const salesReturnRoutes = require('../../routes/sales-returns');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: '77777777-7777-4777-8777-777777777777', role: 'admin' };
        next();
    });
    app.use('/api/sales-returns', salesReturnRoutes);
    return app;
}

describe('sales returns', () => {
    beforeEach(() => {
        mockClientQuery.mockReset();
        mockClient.release.mockReset();
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('SELECT id, client_id, delivery_status')) {
                return { rowCount: 1, rows: [{ id: invoiceId, client_id: clientId, delivery_status: 'completed', delivery_note_id: 'delivery-note-id', source: 'warehouse', status: 'paid', tax_rate: 0.15 }] };
            }
            if (sql.includes('SELECT id FROM warehouses')) return { rowCount: 1, rows: [{ id: warehouseId }] };
            if (sql.includes('SELECT ii.id, ii.variant_id')) return { rowCount: 1, rows: [{ id: itemId, variant_id: variantId, quantity: 5, unit_price: 10, remaining_qty: 5 }] };
            if (sql.includes('INSERT INTO sales_returns')) return { rowCount: 1, rows: [{ id: returnId, return_number: 8001 }] };
            if (sql.includes('SELECT id FROM warehouse_stock')) return { rowCount: 0, rows: [] };
            return { rowCount: 1, rows: [] };
        });
    });

    test('accepts a partial return only after delivery completion and restores stock', async () => {
        const response = await request(buildApp())
            .post('/api/sales-returns')
            .send({
                invoice_id: invoiceId,
                destination_warehouse_id: warehouseId,
                return_action: 'credit_note',
                items: [{ invoice_item_id: itemId, quantity: 2 }],
            });

        expect(response.status).toBe(201);
        expect(response.body.data).toMatchObject({ id: returnId, return_number: 8001, total_amount: 23 });
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO warehouse_stock'))).toBe(true);
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes("'sales_return'"))).toBe(true);
    });
});
