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
    app.use((req, _res, next) => {
        req.user = { id: '77777777-7777-4777-8777-777777777777', role: 'admin' };
        next();
    });
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

    test('returns parent branch context for invoice list rows and preserves root clients', async () => {
        mockQuery.mockImplementation(async (sql) => {
            if (sql.includes('SELECT COUNT(*)')) return { rows: [{ total: 2 }] };
            return { rows: [
                { id: 'branch-invoice', client_name: 'فرع الابن', parent_client_name: 'الفرع الأب' },
                { id: 'root-invoice', client_name: 'عميل رئيسي', parent_client_name: null },
            ] };
        });

        const response = await request(buildApp()).get('/api/invoices?source=warehouse');

        expect(response.status).toBe(200);
        expect(response.body.data).toEqual(expect.arrayContaining([
            expect.objectContaining({ client_name: 'فرع الابن', parent_client_name: 'الفرع الأب' }),
            expect.objectContaining({ client_name: 'عميل رئيسي', parent_client_name: null }),
        ]));
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
        expect(itemInsert[0]).toContain('item_name');
        expect(itemInsert[0]).toContain('is_extra');
        expect(itemInsert[1]).toHaveLength(9);
    });
});

describe('closed_without_invoice flag clearing on order-linked invoices', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockClientQuery.mockReset();
        mockClient.release.mockReset();
    });

    test('mark-issued on an order-linked invoice clears the order closure flag', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('FROM invoices WHERE id = $1 FOR UPDATE')) {
                return { rowCount: 1, rows: [{
                    id: 'invoice-id', invoice_number: 9001, source: 'sales_invoices',
                    status: 'draft', order_id: 'order-1',
                }] };
            }
            if (sql.includes('UPDATE invoices')) {
                return { rowCount: 1, rows: [{ id: 'invoice-id', invoice_number: 9001, status: 'issued' }] };
            }
            if (sql.includes('UPDATE orders')) return { rowCount: 1, rows: [] };
            return { rowCount: 0, rows: [] };
        });

        const res = await request(buildApp())
            .patch('/api/invoices/invoice-id/mark-issued')
            .send({});

        expect(res.status).toBe(200);
        const flagClear = mockClientQuery.mock.calls.find(([sql, params]) =>
            sql.includes('UPDATE orders') && sql.includes('closed_without_invoice = FALSE') && params.includes('order-1'));
        expect(flagClear).toBeDefined();
    });

    test('mark-issued on an invoice without order_id does not touch orders', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('FROM invoices WHERE id = $1 FOR UPDATE')) {
                return { rowCount: 1, rows: [{
                    id: 'invoice-id', invoice_number: 9001, source: 'sales_invoices',
                    status: 'draft', order_id: null,
                }] };
            }
            if (sql.includes('UPDATE invoices')) {
                return { rowCount: 1, rows: [{ id: 'invoice-id', invoice_number: 9001, status: 'issued' }] };
            }
            return { rowCount: 0, rows: [] };
        });

        const res = await request(buildApp())
            .patch('/api/invoices/invoice-id/mark-issued')
            .send({});

        expect(res.status).toBe(200);
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('UPDATE orders'))).toBe(false);
    });

    test('PATCH status → issued on an order-linked invoice clears the order closure flag', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('FROM invoices WHERE id = $1')) {
                return { rowCount: 1, rows: [{
                    id: 'invoice-id', invoice_number: 9001, grand_total: '100',
                    status: 'draft', client_id: 'client-id', order_id: 'order-1',
                }] };
            }
            return { rowCount: 1, rows: [] };
        });

        const res = await request(buildApp())
            .patch('/api/invoices/invoice-id/status')
            .send({ status: 'issued' });

        expect(res.status).toBe(200);
        const flagClear = mockClientQuery.mock.calls.find(([sql, params]) =>
            sql.includes('UPDATE orders') && sql.includes('closed_without_invoice = FALSE') && params.includes('order-1'));
        expect(flagClear).toBeDefined();
    });

    test('POST / warehouse invoice linked to an order is issued immediately and clears the closure flag', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('FROM warehouses')) return { rowCount: 1, rows: [{ id: 'wh-1' }] };
            if (sql.includes('FROM warehouse_stock')) return { rowCount: 1, rows: [{ id: 'stock-1', quantity: '10', reserved_qty: '0' }] };
            if (sql.includes('INSERT INTO invoices')) return { rowCount: 1, rows: [{ id: 'inv-x', invoice_number: 700 }] };
            return { rowCount: 1, rows: [] };
        });

        const res = await request(buildApp())
            .post('/api/invoices')
            .send({
                client_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                order_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                warehouse_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                source: 'warehouse',
                items: [{ variant_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', quantity: 1, unit_price: 10 }],
            });

        expect(res.status).toBe(201);
        const flagClear = mockClientQuery.mock.calls.find(([sql, params]) =>
            sql.includes('UPDATE orders') && sql.includes('closed_without_invoice = FALSE') && params.includes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
        expect(flagClear).toBeDefined();
    });

    test('POST / sales_invoices draft linked to an order does NOT clear the flag until issued', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('INSERT INTO invoices')) return { rowCount: 1, rows: [{ id: 'inv-y', invoice_number: 701 }] };
            return { rowCount: 1, rows: [] };
        });

        const res = await request(buildApp())
            .post('/api/invoices')
            .send({
                client_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                order_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                items: [{ variant_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', quantity: 1, unit_price: 10 }],
            });

        expect(res.status).toBe(201);
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('UPDATE orders'))).toBe(false);
    });
});
