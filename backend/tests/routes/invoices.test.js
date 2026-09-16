'use strict';

const request = require('supertest');
const express = require('express');

const mockClientQuery = jest.fn();
const mockClient = {
    query: (...args) => mockClientQuery(...args),
    release: jest.fn(),
};
const mockQuery = jest.fn();

jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
    pool: { connect: jest.fn(() => Promise.resolve(mockClient)) },
}));
jest.mock('../../middleware/authMiddleware', () => ({
    authenticate: (req, _res, next) => {
        req.user = { id: '77777777-7777-4777-8777-777777777777', role: 'admin' };
        next();
    },
}));
jest.mock('../../middleware/authorize', () => () => (_req, _res, next) => next());
jest.mock('../../utils/settings', () => ({ getVatRate: jest.fn(async () => 0.15) }));

const invoiceRoutes = require('../../routes/invoices');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/invoices', invoiceRoutes);
    return app;
}

describe('invoice generated line_total handling', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockClientQuery.mockReset();
        mockClient.release.mockReset();
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM invoices WHERE')) {
                return { rowCount: 1, rows: [{ id: 'invoice-id', invoice_number: 9001, status: 'draft', client_id: 'client-id', order_id: null }] };
            }
            return { rowCount: 1, rows: [] };
        });
    });

    test('rejects quantity changes when editing a final production invoice', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('FROM invoices WHERE id = $1 FOR UPDATE')) {
                return { rowCount: 1, rows: [{
                    id: 'invoice-id', invoice_number: 9001, status: 'issued', client_id: 'client-id',
                    order_id: null, source: 'sales_invoices', warehouse_id: null, delivery_note_id: null,
                }] };
            }
            if (sql.includes('FROM invoice_items')) {
                return { rowCount: 1, rows: [{
                    variant_id: '11111111-1111-4111-8111-111111111111', order_item_id: null, quantity: '2',
                }] };
            }
            return { rowCount: 0, rows: [] };
        });

        const response = await request(buildApp())
            .put('/api/invoices/invoice-id')
            .send({
                items: [{
                    variant_id: '11111111-1111-4111-8111-111111111111',
                    quantity: 3,
                    unit_price: 25,
                    discount_percent: 0,
                }],
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('لا يمكن تعديل الكميات');
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('UPDATE invoices'))).toBe(false);
    });

    test('saves invoice items without inserting generated line_total', async () => {
        const response = await request(buildApp())
            .put('/api/invoices/invoice-id')
            .send({
                items: [{
                    variant_id: '11111111-1111-4111-8111-111111111111',
                    quantity: 2,
                    unit_price: 25,
                    discount_percent: 0,
                }],
            });

        expect(response.status).toBe(200);
        const itemInsert = mockClientQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO invoice_items'));
        expect(itemInsert).toBeDefined();
        expect(itemInsert[0]).not.toContain('line_total');
        expect(itemInsert[1]).toHaveLength(7);
    });
});
