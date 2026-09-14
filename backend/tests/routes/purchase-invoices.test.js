'use strict';

const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
const mockClient = {
    query: jest.fn(),
    release: jest.fn(),
};

jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
    getClient: () => mockClient,
    withTransaction: async (callback) => callback(mockClient),
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
    app.use(express.json());
    app.use('/api/purchase-invoices', purchaseInvoiceRoutes);
    return app;
}

describe('purchase invoice direct receipt client linkage', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockClient.query.mockReset();
        mockClient.release.mockReset();
    });

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

describe('purchase invoice reopen workflow', () => {
    const invoiceId = '22222222-2222-4222-8222-222222222222';

    beforeEach(() => {
        mockQuery.mockReset();
        mockClient.query.mockReset();
        mockClient.release.mockReset();
    });

    test('reopens a posted invoice with reversal voucher and audit record without touching stock', async () => {
        mockClient.query.mockImplementation(async (sql) => {
            if (sql.includes('FROM purchase_invoices pi')) {
                return { rows: [{
                    id: invoiceId,
                    invoice_number: 7001,
                    supplier_id: '33333333-3333-4333-8333-333333333333',
                    status: 'posted',
                    subtotal: '100.00',
                    tax_amount: '15.00',
                    grand_total: '115.00',
                    paid_amount: '0.00',
                    merged_into_invoice_id: null,
                }] };
            }
            if (sql.includes('FROM purchase_invoice_mo_links')) return { rows: [] };
            if (sql.includes("av.voucher_type = 'payment'")) return { rows: [] };
            if (sql.includes('FROM purchase_returns')) return { rows: [] };
            if (sql.includes("av.voucher_type = 'purchase'")) {
                return { rows: [{ id: '44444444-4444-4444-8444-444444444444', voucher_number: 9001, total_amount: '115.00' }] };
            }
            if (sql.includes('FROM accounting_voucher_lines')) {
                return { rows: [{
                    account_id: '55555555-5555-4555-8555-555555555555',
                    debit: '100.00',
                    credit: '0.00',
                    sub_account_type: 'purchase_invoice',
                    sub_account_id: invoiceId,
                    description: 'تكلفة بضاعة',
                }, {
                    account_id: '66666666-6666-4666-8666-666666666666',
                    debit: '0.00',
                    credit: '115.00',
                    sub_account_type: 'supplier',
                    sub_account_id: '33333333-3333-4333-8333-333333333333',
                    description: 'مستحق للمورد',
                }] };
            }
            if (sql.includes('INSERT INTO accounting_vouchers')) {
                return { rows: [{ id: '77777777-7777-4777-8777-777777777777', voucher_number: 9002 }] };
            }
            return { rows: [] };
        });

        const response = await request(buildApp())
            .post(`/api/purchase-invoices/${invoiceId}/reopen`)
            .send({ reason: 'تم إنشاء فاتورة منفردة بدل فاتورة مجمعة لإمداد باك وليزوان' });

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({
            invoice_id: invoiceId,
            invoice_number: 7001,
            reversal_voucher_ids: ['77777777-7777-4777-8777-777777777777'],
        });

        const queries = mockClient.query.mock.calls.map(([sql]) => sql);
        expect(queries[0]).toContain('FOR UPDATE');
        expect(queries.some(sql => sql.includes("SET status = 'reversed'"))).toBe(true);
        expect(queries.some(sql => sql.includes("SET status = 'draft'"))).toBe(true);
        expect(queries.some(sql => sql.includes('accounting_voucher_id = NULL'))).toBe(true);
        expect(queries.some(sql => sql.includes('INSERT INTO audit_logs'))).toBe(true);
        expect(queries.some(sql => sql.includes('warehouse_stock'))).toBe(false);

        const auditCall = mockClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_logs'));
        expect(auditCall[1][4]).toContain('تم إنشاء فاتورة منفردة');
    });

    test('rejects reopening when a posted supplier payment exists', async () => {
        mockClient.query.mockImplementation(async (sql) => {
            if (sql.includes('FROM purchase_invoices pi')) {
                return { rows: [{
                    id: invoiceId,
                    invoice_number: 7001,
                    supplier_id: '33333333-3333-4333-8333-333333333333',
                    status: 'posted',
                    paid_amount: '0.00',
                    merged_into_invoice_id: null,
                }] };
            }
            if (sql.includes('FROM purchase_invoice_mo_links')) return { rows: [] };
            if (sql.includes("av.voucher_type = 'payment'")) return { rows: [{ id: 'payment-voucher' }] };
            return { rows: [] };
        });

        const response = await request(buildApp())
            .post(`/api/purchase-invoices/${invoiceId}/reopen`)
            .send({ reason: 'اختبار منع التراجع بعد الدفع' });

        expect(response.status).toBe(409);
        expect(response.body.error).toContain('دفعات');
        expect(mockClient.query.mock.calls.some(([sql]) => sql.includes("SET status = 'draft'"))).toBe(false);
    });

    test('requires a reason before opening a transaction', async () => {
        const response = await request(buildApp())
            .post(`/api/purchase-invoices/${invoiceId}/reopen`)
            .send({});

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('سبب');
        expect(mockClient.query).not.toHaveBeenCalled();
    });
});
