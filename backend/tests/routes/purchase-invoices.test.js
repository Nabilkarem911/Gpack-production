'use strict';

const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();

jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
}));
jest.mock('../../middleware/authMiddleware', () => ({
    authenticate: (req, _res, next) => {
        req.user = { id: '77777777-7777-4777-8777-777777777777', role: 'admin' };
        next();
    },
}));
jest.mock('../../middleware/authorize', () => () => (_req, _res, next) => next());

const purchaseInvoiceRoutes = require('../../routes/purchase-invoices');

function buildApp() {
    const app = express();
    app.use('/api/purchase-invoices', purchaseInvoiceRoutes);
    return app;
}

describe('purchase invoice direct receipt client linkage', () => {
    beforeEach(() => mockQuery.mockReset());

    test('returns direct-receipt client in the list while preserving manufacturer-order joins', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ total: 1 }] })
            .mockResolvedValueOnce({ rows: [{
                id: 'invoice-id',
                supplier_name: 'Supplier',
                client_id: 'client-id',
                client_name: 'Direct Receipt Client',
                is_from_direct_receipt: true,
                direct_receipt_number: 12,
                production_order_number: 1001,
            }] });

        const response = await request(buildApp()).get('/api/purchase-invoices');

        expect(response.status).toBe(200);
        expect(response.body.data[0]).toMatchObject({
            client_id: 'client-id',
            client_name: 'Direct Receipt Client',
        });
        const listSql = mockQuery.mock.calls[1][0];
        expect(listSql).toContain('LEFT JOIN manufacturer_orders mo');
        expect(listSql).toContain('COALESCE(c.id, dro.client_id) AS client_id');
        expect(listSql).toContain('COALESCE(c.name, dc.name) AS client_name');
        expect(listSql).toContain('LEFT JOIN direct_receipts dr');
    });

    test('returns direct-receipt client in invoice details', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{
                id: 'invoice-id',
                supplier_name: 'Supplier',
                client_id: 'client-id',
                client_name: 'Direct Receipt Client',
                direct_receipt_number: 12,
            }] })
            .mockResolvedValueOnce({ rows: [] });

        const response = await request(buildApp())
            .get('/api/purchase-invoices/11111111-1111-4111-8111-111111111111');

        expect(response.status).toBe(200);
        expect(response.body.data.invoice.client_name).toBe('Direct Receipt Client');
        const detailSql = mockQuery.mock.calls[0][0];
        expect(detailSql).toContain('COALESCE(c.id, dro.client_id) AS client_id');
        expect(detailSql).toContain('COALESCE(c.name, dc.name) AS client_name');
        expect(detailSql).toContain('LEFT JOIN manufacturer_orders mo');
    });
});
