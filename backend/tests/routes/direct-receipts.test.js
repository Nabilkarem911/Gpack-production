'use strict';

const request = require('supertest');
const express = require('express');

const receiptId = '11111111-1111-4111-8111-111111111111';
const invoiceId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const variantId = '44444444-4444-4444-8444-444444444444';
const clientId = '55555555-5555-4555-8555-555555555555';
const warehouseId = '66666666-6666-4666-8666-666666666666';

const mockClientQuery = jest.fn();
const mockClient = {
    query: (...args) => mockClientQuery(...args),
    release: jest.fn(),
};
const mockCreateProductionOrderFromReceipt = jest.fn();
const mockRevertDirectReceiptToReview = jest.fn();

jest.mock('../../db', () => ({
    getClient: jest.fn(() => Promise.resolve(mockClient)),
}));
jest.mock('../../middleware/authMiddleware', () => ({
    authenticate: (req, _res, next) => {
        req.user = { id: '77777777-7777-4777-8777-777777777777' };
        next();
    },
}));
jest.mock('../../middleware/authorize', () => () => (_req, _res, next) => next());
jest.mock('../../utils/settings', () => ({ getVatRate: jest.fn(async () => 0) }));
jest.mock('../../services/direct-receipt-order-service', () => ({
    createProductionOrderFromReceipt: mockCreateProductionOrderFromReceipt,
    revertDirectReceiptToReview: mockRevertDirectReceiptToReview,
}));

const directReceiptRoutes = require('../../routes/direct-receipts');

function buildApp() {
    const app = express();
    app.use('/api/direct-receipts', directReceiptRoutes);
    return app;
}

describe('direct receipt conversion idempotency', () => {
    let converted;

    beforeEach(() => {
        converted = false;
        mockClientQuery.mockReset();
        mockClient.release.mockReset();
        mockCreateProductionOrderFromReceipt.mockReset();
        mockCreateProductionOrderFromReceipt.mockResolvedValue({ id: orderId, order_number: 1001 });

        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('FROM direct_receipts dr')) {
                return { rowCount: 1, rows: [{
                    receipt_number: 12,
                    status: converted ? 'converted' : 'pending_review',
                    supplier_id: '88888888-8888-4888-8888-888888888888',
                    warehouse_id: warehouseId,
                    has_invoice: false,
                    supplier_invoice_date: null,
                    supplier_invoice_ref: null,
                }] };
            }
            if (sql.includes('FROM direct_receipt_items')) {
                return { rowCount: 1, rows: [{
                    variant_id: variantId,
                    product_id: '99999999-9999-4999-8999-999999999999',
                    confirmed_quantity: 4,
                    unit_cost: 10,
                    product_name: 'Test product',
                    client_id: clientId,
                }] };
            }
            if (sql.includes("nextval('purchase_invoice_seq')")) return { rows: [{ next: 2001 }] };
            if (sql.includes('INSERT INTO purchase_invoices')) return { rows: [{ id: invoiceId, invoice_number: 2001 }] };
            if (sql.includes('INSERT INTO purchase_invoice_items')) return {};
            if (sql.includes('FROM warehouse_stock')) return { rowCount: 0, rows: [] };
            if (sql.includes('INSERT INTO warehouse_stock')) return {};
            if (sql.includes('INSERT INTO inventory_transactions')) return {};
            if (sql.includes('UPDATE direct_receipts')) {
                converted = true;
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Unexpected query: ${sql}`);
        });
    });

    test('creates only one purchase invoice and one order across repeated submissions', async () => {
        const first = await request(buildApp())
            .post(`/api/direct-receipts/${receiptId}/convert`)
            .field('items', JSON.stringify([{ product_variant_id: variantId, quantity: 4 }]));
        expect(first.status).toBe(201);

        const second = await request(buildApp())
            .post(`/api/direct-receipts/${receiptId}/convert`)
            .field('items', JSON.stringify([{ product_variant_id: variantId, quantity: 4 }]));
        expect(second.status).toBe(400);
        expect(second.body.error).toMatch(/already processed|تمت معالجة/);

        expect(mockClientQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO purchase_invoices'))).toHaveLength(1);
        expect(mockCreateProductionOrderFromReceipt).toHaveBeenCalledTimes(1);
    });
});
