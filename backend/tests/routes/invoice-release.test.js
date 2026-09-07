'use strict';

const request = require('supertest');
const express = require('express');

const invoiceId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const warehouseId = '33333333-3333-4333-8333-333333333333';
const variantId = '44444444-4444-4444-8444-444444444444';
const stockId = '55555555-5555-4555-8555-555555555555';
const deliveryNoteId = '66666666-6666-4666-8666-666666666666';

const mockClientQuery = jest.fn();
const mockClient = {
    query: (...args) => mockClientQuery(...args),
    release: jest.fn(),
};

jest.mock('../../db', () => ({
    pool: { connect: jest.fn(() => Promise.resolve(mockClient)) },
}));
jest.mock('../../middleware/authorize', () => () => (_req, _res, next) => next());

const invoiceRoutes = require('../../routes/invoices');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: '77777777-7777-4777-8777-777777777777', role: 'admin' };
        next();
    });
    app.use('/api/invoices', invoiceRoutes);
    return app;
}

describe('warehouse sales invoice release workflow', () => {
    beforeEach(() => {
        mockClientQuery.mockReset();
        mockClient.release.mockReset();
    });

    test('issues a warehouse invoice without creating a delivery note automatically', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('SELECT id FROM warehouses')) return { rowCount: 1, rows: [{ id: warehouseId }] };
            if (sql.includes('SELECT ws.id, ws.quantity, ws.reserved_qty')) return { rowCount: 1, rows: [{ id: stockId, quantity: 10, reserved_qty: 0 }] };
            if (sql.includes('INSERT INTO invoices')) return { rowCount: 1, rows: [{ id: invoiceId, invoice_number: 1001 }] };
            return { rowCount: 1, rows: [] };
        });

        const response = await request(buildApp())
            .post('/api/invoices')
            .send({
                client_id: clientId,
                warehouse_id: warehouseId,
                source: 'warehouse',
                invoice_date: '2026-09-07',
                tax_rate: 0.15,
                items: [{ stock_id: stockId, variant_id: variantId, quantity: 2, unit_price: 50 }],
            });

        expect(response.status).toBe(201);
        expect(response.body.data.delivery_note_id).toBeNull();
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO delivery_notes'))).toBe(false);
    });

    test('registers a payment against the invoice and marks it paid when settled', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('SELECT id, invoice_number, client_id, grand_total, status')) {
                return { rowCount: 1, rows: [{ id: invoiceId, invoice_number: 1001, client_id: clientId, grand_total: 100, status: 'issued' }] };
            }
            if (sql.includes('SELECT COALESCE(SUM(amount)')) return { rowCount: 1, rows: [{ paid: 0 }] };
            return { rowCount: 1, rows: [] };
        });

        const response = await request(buildApp())
            .post(`/api/invoices/${invoiceId}/payment`)
            .send({ client_id: clientId, amount: 100, payment_method: 'cash' });

        expect(response.status).toBe(201);
        expect(response.body.data).toMatchObject({ invoice_id: invoiceId, paid: 100, remaining: 0, status: 'paid' });
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO client_transactions") && sql.includes("'receipt'"))).toBe(true);
    });

    test('deletes an unreleased invoice and returns its reserved stock', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('SELECT id, source, status, delivery_note_id')) {
                return { rowCount: 1, rows: [{ id: invoiceId, source: 'warehouse', status: 'issued', delivery_note_id: null }] };
            }
            if (sql.includes('SELECT 1 FROM client_transactions')) return { rowCount: 0, rows: [] };
            if (sql.includes('SELECT source_stock_id, quantity')) return { rowCount: 1, rows: [{ source_stock_id: stockId, quantity: 2 }] };
            return { rowCount: 1, rows: [] };
        });

        const response = await request(buildApp()).delete(`/api/invoices/${invoiceId}`);

        expect(response.status).toBe(200);
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('UPDATE warehouse_stock') && sql.includes('reserved_qty'))).toBe(true);
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('DELETE FROM invoices'))).toBe(true);
    });

    test('creates the delivery note only when release is issued manually', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('SELECT id, invoice_number, client_id, warehouse_id, source, status, delivery_note_id')) {
                return { rowCount: 1, rows: [{ id: invoiceId, invoice_number: 1001, client_id: clientId, warehouse_id: warehouseId, source: 'warehouse', status: 'issued', delivery_note_id: null, notes: null }] };
            }
            if (sql.includes('SELECT variant_id, quantity, source_stock_id')) return { rowCount: 1, rows: [{ variant_id: variantId, quantity: 2, source_stock_id: stockId }] };
            if (sql.includes('INSERT INTO delivery_notes')) return { rowCount: 1, rows: [{ id: deliveryNoteId, note_number: 2001 }] };
            return { rowCount: 1, rows: [] };
        });

        const response = await request(buildApp())
            .post(`/api/invoices/${invoiceId}/release`)
            .send({});

        expect(response.status).toBe(201);
        expect(response.body.data).toEqual({ delivery_note_id: deliveryNoteId, note_number: 2001 });
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO delivery_note_items'))).toBe(true);
    });
});
