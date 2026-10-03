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
            if (sql.includes('SELECT id, invoice_number, client_id, delivery_status')) {
                return { rowCount: 1, rows: [{ id: invoiceId, client_id: clientId, delivery_status: 'completed', delivery_note_id: 'delivery-note-id', source: 'warehouse', status: 'issued', tax_rate: 0.15 }] };
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

    test('cash_refund requires an explicit cash/bank account', async () => {
        const response = await request(buildApp())
            .post('/api/sales-returns')
            .send({
                invoice_id: invoiceId,
                destination_warehouse_id: warehouseId,
                return_action: 'cash_refund',
                items: [{ invoice_item_id: itemId, quantity: 2 }],
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/حساب الصندوق\/البنك/);
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO accounting_vouchers'))).toBe(false);
    });

    test('cash_refund is rejected when paid amount is below the return total', async () => {
        mockClientQuery.mockImplementation(async (sql, params) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('SELECT id, invoice_number, client_id, delivery_status')) {
                return { rowCount: 1, rows: [{ id: invoiceId, invoice_number: 9001, client_id: clientId, delivery_status: 'completed', delivery_note_id: 'delivery-note-id', source: 'warehouse', status: 'issued', tax_rate: 0.15 }] };
            }
            if (sql.includes('SELECT id FROM warehouses')) return { rowCount: 1, rows: [{ id: warehouseId }] };
            if (sql.includes('SELECT ii.id, ii.variant_id')) return { rowCount: 1, rows: [{ id: itemId, variant_id: variantId, quantity: 5, unit_price: 10, remaining_qty: 5 }] };
            if (sql.includes('FROM accounts') && sql.includes('1100')) return { rowCount: 1, rows: [{ id: 'cash-acc-1' }] };
            // invoice paid = 0 → any cash refund must be refused
            if (sql.includes('FROM client_transactions')) return { rowCount: 1, rows: [{ paid: '0' }] };
            return { rowCount: 1, rows: [] };
        });

        const response = await request(buildApp())
            .post('/api/sales-returns')
            .send({
                invoice_id: invoiceId,
                destination_warehouse_id: warehouseId,
                return_action: 'cash_refund',
                refund_account_id: '77777777-7777-4777-8777-777777777777',
                items: [{ invoice_item_id: itemId, quantity: 2 }],
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/لا يمكن رد/);
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO accounting_vouchers'))).toBe(false);
    });

    test('cash_refund posts one payment voucher against account 1300 and the chosen cash account', async () => {
        const cashAcc = '77777777-7777-4777-8777-777777777777';
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('SELECT id, invoice_number, client_id, delivery_status')) {
                return { rowCount: 1, rows: [{ id: invoiceId, invoice_number: 9001, client_id: clientId, delivery_status: 'completed', delivery_note_id: 'delivery-note-id', source: 'warehouse', status: 'issued', tax_rate: 0.15 }] };
            }
            if (sql.includes('SELECT id FROM warehouses')) return { rowCount: 1, rows: [{ id: warehouseId }] };
            if (sql.includes('SELECT ii.id, ii.variant_id')) return { rowCount: 1, rows: [{ id: itemId, variant_id: variantId, quantity: 5, unit_price: 10, remaining_qty: 5 }] };
            if (sql.includes('INSERT INTO sales_returns')) return { rowCount: 1, rows: [{ id: returnId, return_number: 8001 }] };
            if (sql.includes('SELECT id FROM warehouse_stock')) return { rowCount: 0, rows: [] };
            if (sql.includes('FROM accounts') && sql.includes('1100')) return { rowCount: 1, rows: [{ id: cashAcc }] };
            if (sql.includes("code = '1300'")) return { rowCount: 1, rows: [{ id: 'ar-acc-1' }] };
            if (sql.includes('FROM client_transactions')) return { rowCount: 1, rows: [{ paid: '100' }] };
            if (sql.includes('INSERT INTO accounting_vouchers')) return { rowCount: 1, rows: [{ id: 'pv-1', voucher_number: 50 }] };
            return { rowCount: 1, rows: [] };
        });

        const response = await request(buildApp())
            .post('/api/sales-returns')
            .send({
                invoice_id: invoiceId,
                destination_warehouse_id: warehouseId,
                return_action: 'cash_refund',
                refund_account_id: cashAcc,
                items: [{ invoice_item_id: itemId, quantity: 2 }],
            });

        expect(response.status).toBe(201);

        const voucherInsert = mockClientQuery.mock.calls.find(([sql]) =>
            sql.includes('INSERT INTO accounting_vouchers'));
        expect(voucherInsert).toBeDefined();
        expect(voucherInsert[0]).toContain("'payment'");
        expect(voucherInsert[0]).toContain("'sales_return'");

        const lines = mockClientQuery.mock.calls.filter(([sql]) =>
            sql.includes('INSERT INTO accounting_voucher_lines'));
        expect(lines).toHaveLength(2);
        // DR 1300 / client sub-account, CR chosen cash account — balanced
        const dr = lines.find(([, p]) => p[1] === 'ar-acc-1');
        const cr = lines.find(([, p]) => p[1] === cashAcc);
        expect(dr?.[1][2]).toBe(23);
        expect(cr?.[1][2]).toBe(23);

        const ctInsert = mockClientQuery.mock.calls.find(([sql]) =>
            sql.includes("'sales_return'") && sql.includes('linked_voucher_id'));
        expect(ctInsert?.[1]).toContain('pv-1');
    });
});
