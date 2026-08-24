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
        expect(itemInsert[1]).toHaveLength(6);
    });
});
