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
            if (sql.includes('id <> $2')) return { rowCount: 0, rows: [] }; // no sibling active invoice
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
            if (sql.includes('status = ANY')) return { rowCount: 0, rows: [] }; // no duplicate invoice on the order
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
            if (sql.includes('status = ANY')) return { rowCount: 0, rows: [] };
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

describe('invoice payment voucher integration', () => {
    const cashAcc = '99999999-9999-4999-8999-999999999999';

    function mockInvoice(status = 'issued', grandTotal = '1000', paid = '0') {
        mockClientQuery.mockImplementation(async (sql, params) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('FROM invoices WHERE')) {
                return { rowCount: 1, rows: [{
                    id: 'invoice-id', invoice_number: 9001, grand_total: grandTotal,
                    status, client_id: 'c0ffee00-c0ff-4c0f-8c0f-fec0ffee0000', order_id: null,
                }] };
            }
            if (sql.includes('FROM client_transactions')) return { rowCount: 1, rows: [{ paid }] };
            if (sql.includes('FROM accounts') && sql.includes('1100')) return { rowCount: 1, rows: [{ id: cashAcc }] };
            if (sql.includes("code = '1300'")) return { rowCount: 1, rows: [{ id: 'ar-1' }] };
            if (sql.includes('INSERT INTO accounting_vouchers')) return { rowCount: 1, rows: [{ id: 'v-1', voucher_number: 10 }] };
            return { rowCount: 1, rows: [] };
        });
    }

    beforeEach(() => {
        mockQuery.mockReset();
        mockClientQuery.mockReset();
        mockClient.release.mockReset();
    });

    test('POST /:id/payment rejects when no cash account is selected', async () => {
        mockInvoice();
        const res = await request(buildApp())
            .post('/api/invoices/invoice-id/payment')
            .send({ client_id: 'c0ffee00-c0ff-4c0f-8c0f-fec0ffee0000', amount: 100, payment_method: 'cash' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/حساب الصندوق\/البنك/);
    });

    test('POST /:id/payment posts a receipt voucher linked to the ledger row', async () => {
        mockInvoice('issued', '1000', '0');
        const res = await request(buildApp())
            .post('/api/invoices/invoice-id/payment')
            .send({ client_id: 'c0ffee00-c0ff-4c0f-8c0f-fec0ffee0000', amount: 300, payment_method: 'cash', cash_account_id: cashAcc, voucher_date: '2026-09-10' });
        expect(res.status).toBe(201);

        const v = mockClientQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO accounting_vouchers'));
        expect(v[0]).toContain("'receipt'");
        expect(v[0]).toContain("'invoice'");
        expect(v[1][3]).toBe('2026-09-10'); // voucher_date param

        const ct = mockClientQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO client_transactions'));
        expect(ct[0]).toContain('linked_voucher_id');
        expect(ct[1]).toContain('v-1');
    });

    test('PATCH status→paid with a partial payment vouchers only the remaining balance', async () => {
        mockInvoice('issued', '1000', '300');
        const res = await request(buildApp())
            .patch('/api/invoices/invoice-id/status')
            .send({ status: 'paid', cash_account_id: cashAcc, payment_method: 'cash' });
        expect(res.status).toBe(200);

        const v = mockClientQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO accounting_vouchers'));
        expect(v[1][1]).toBe(700); // remaining, not full 1000
        const ct = mockClientQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO client_transactions'));
        expect(ct[1][2]).toBe(700);
    });

    test('PATCH status→paid with no remaining balance inserts nothing', async () => {
        mockInvoice('issued', '1000', '1000');
        const res = await request(buildApp())
            .patch('/api/invoices/invoice-id/status')
            .send({ status: 'paid' });
        expect(res.status).toBe(200);
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO accounting_vouchers'))).toBe(false);
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO client_transactions'))).toBe(false);
    });

    test('PATCH status→paid with remaining balance but no account is refused', async () => {
        mockInvoice('issued', '1000', '300');
        const res = await request(buildApp())
            .patch('/api/invoices/invoice-id/status')
            .send({ status: 'paid' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/متبقٍ/);
        // rolled back — status update must not commit without the collection
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('ROLLBACK'))).toBe(true);
    });

    // ── order-linked payments count toward the invoice (1:1 orders) ──────
    function mockOrderLinkedInvoice({ paid, hasSiblings = false, status = 'issued', grandTotal = '1000' }) {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('has_order_pay')) {
                return { rowCount: 1, rows: [{ has_order_pay: true, has_siblings: hasSiblings }] };
            }
            if (sql.includes('FROM invoices WHERE')) {
                return { rowCount: 1, rows: [{
                    id: 'invoice-id', invoice_number: 9001, grand_total: grandTotal,
                    status, client_id: 'c0ffee00-c0ff-4c0f-8c0f-fec0ffee0000', order_id: 'order-1',
                }] };
            }
            if (sql.includes('FROM client_transactions')) return { rowCount: 1, rows: [{ paid }] };
            if (sql.includes('FROM accounts') && sql.includes('1100')) return { rowCount: 1, rows: [{ id: cashAcc }] };
            if (sql.includes("code = '1300'")) return { rowCount: 1, rows: [{ id: 'ar-1' }] };
            if (sql.includes('INSERT INTO accounting_vouchers')) return { rowCount: 1, rows: [{ id: 'v-1', voucher_number: 10 }] };
            return { rowCount: 1, rows: [] };
        });
    }

    test('POST /:id/payment counts order-linked payments — overpayment rejected', async () => {
        mockOrderLinkedInvoice({ paid: '700' }); // 700 collected via the order screen
        const res = await request(buildApp())
            .post('/api/invoices/invoice-id/payment')
            .send({ client_id: 'c0ffee00-c0ff-4c0f-8c0f-fec0ffee0000', amount: 400, payment_method: 'cash', cash_account_id: cashAcc });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/المتبقي/);
    });

    test('POST /:id/payment accepts the true remaining on an order-paid invoice', async () => {
        mockOrderLinkedInvoice({ paid: '700' });
        const res = await request(buildApp())
            .post('/api/invoices/invoice-id/payment')
            .send({ client_id: 'c0ffee00-c0ff-4c0f-8c0f-fec0ffee0000', amount: 300, payment_method: 'cash', cash_account_id: cashAcc });
        expect(res.status).toBe(201);
    });

    test('POST /:id/payment refuses ambiguous multi-invoice orders with payments', async () => {
        mockOrderLinkedInvoice({ paid: '0', hasSiblings: true });
        const res = await request(buildApp())
            .post('/api/invoices/invoice-id/payment')
            .send({ client_id: 'c0ffee00-c0ff-4c0f-8c0f-fec0ffee0000', amount: 100, payment_method: 'cash', cash_account_id: cashAcc });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/فاتورة نشطة|المكررة|فواتير/);
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO accounting_vouchers'))).toBe(false);
    });

    test('PATCH status→paid on an order-paid invoice vouchers only the true remaining', async () => {
        mockOrderLinkedInvoice({ paid: '700', status: 'issued' });
        const res = await request(buildApp())
            .patch('/api/invoices/invoice-id/status')
            .send({ status: 'paid', cash_account_id: cashAcc, payment_method: 'cash' });
        expect(res.status).toBe(200);
        const v = mockClientQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO accounting_vouchers'));
        expect(v[1][1]).toBe(300); // 1000 − 700 paid on the order
    });

    test('PATCH status→issued is refused when the order already has an active invoice', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('id <> $2')) return { rowCount: 1, rows: [{ invoice_number: 5555 }] }; // sibling issued exists
            if (sql.includes('FROM invoices WHERE id = $1')) {
                return { rowCount: 1, rows: [{
                    id: 'invoice-id', invoice_number: 9002, grand_total: '100',
                    status: 'draft', client_id: 'client-id', order_id: 'order-1',
                }] };
            }
            return { rowCount: 1, rows: [] };
        });
        const res = await request(buildApp())
            .patch('/api/invoices/invoice-id/status')
            .send({ status: 'issued' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/فاتورة نشطة/);
    });

    test('POST / refuses a second issued invoice on the same order', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('status = ANY')) return { rowCount: 1, rows: [{ invoice_number: 88, status: 'issued' }] };
            if (sql.includes('FROM warehouses')) return { rowCount: 1, rows: [{ id: 'wh-1' }] };
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
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/فاتورة.*الطلب|نفس الطلب/);
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO invoices'))).toBe(false);
    });

    test('POST / replays the stored response for a repeated idempotency key — no second invoice', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
            if (sql.includes('INSERT INTO idempotency_keys')) return { rowCount: 0, rows: [] }; // key already taken
            if (sql.includes('FROM idempotency_keys')) {
                return { rowCount: 1, rows: [{
                    status_code: 201,
                    response_body: { success: true, data: { id: 'inv-first', invoice_number: 9007 }, message: 'تم إنشاء الفاتورة بنجاح' },
                }] };
            }
            return { rowCount: 1, rows: [] };
        });
        const res = await request(buildApp())
            .post('/api/invoices')
            .send({
                client_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                items: [{ variant_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', quantity: 1, unit_price: 10 }],
                idempotency_key: 'retry-key-1',
            });
        expect(res.status).toBe(201);
        expect(res.body.data.invoice_number).toBe(9007);
        expect(mockClientQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO invoices'))).toBe(false);
    });
});
