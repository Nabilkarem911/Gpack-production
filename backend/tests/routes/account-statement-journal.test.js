'use strict';

const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../middleware/authMiddleware', () => ({
    authenticate: (req, _res, next) => { req.user = { id: 'user-1', role: 'admin' }; next(); },
}));
jest.mock('../../middleware/authorize', () => () => (_req, _res, next) => next());

const accountStatementRoutes = require('../../routes/account-statement');

function buildApp() {
    const app = express();
    app.use('/api/account-statement', accountStatementRoutes);
    return app;
}

const clientId = '11111111-1111-4111-8111-111111111111';
const supplierId = '22222222-2222-4222-8222-222222222222';

describe('account statement journal entries', () => {
    beforeEach(() => mockQuery.mockReset());

    test('shows client journal and opening-balance lines with correct directions and running balance', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: clientId, name: 'عميل اليومية', phone: null, city: null }] })
            .mockResolvedValueOnce({ rows: [
                {
                    transaction_id: 'opening-client', document_type: 'رصيد افتتاحي', document_number: 'OB-1',
                    debit: '100', credit: '0', trans_date: '2026-01-01',
                },
                {
                    transaction_id: 'journal-client', document_type: 'قيد يومية', document_number: 'J-100',
                    debit: '300', credit: '50', trans_date: '2026-02-01',
                },
            ] })
            .mockResolvedValueOnce({ rows: [{ total_invoices: '400', total_payments: '50', total_debit: '400', total_credit: '50' }] });

        const response = await request(buildApp())
            .get(`/api/account-statement/client/${clientId}?from=2026-01-01&to=2026-02-28`);

        expect(response.status).toBe(200);
        expect(response.body.transactions).toHaveLength(2);
        expect(response.body.transactions.filter(t => t.document_type === 'قيد يومية')).toHaveLength(1);
        expect(response.body.transactions.find(t => t.document_type === 'رصيد افتتاحي')).toMatchObject({ debit: '100', credit: '0' });
        expect(response.body.transactions.find(t => t.document_type === 'قيد يومية')).toMatchObject({ debit: '300', credit: '50' });
        expect(response.body.summary).toMatchObject({ total_debit: 400, total_credit: 50, balance: 350 });
        expect(response.body.transactions[0].running_balance).toBe(350);

        const transactionParams = mockQuery.mock.calls[1][1];
        expect(transactionParams).toEqual([clientId, '2026-01-01', '2026-02-28', 100, 0]);
        expect(mockQuery.mock.calls[1][0]).toContain("av.voucher_type IN ('journal', 'opening_balance')");
        expect(mockQuery.mock.calls[1][0]).toContain('avl.sub_account_type = \'client\'');
    });

    test('shows supplier journal and opening-balance lines without duplication and with opposite balance direction', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: supplierId, name: 'مورد اليومية', phone: null, city: null }] })
            .mockResolvedValueOnce({ rows: [
                {
                    transaction_id: 'opening-supplier', document_type: 'رصيد افتتاحي', document_number: 'OB-2',
                    debit: '0', credit: '800', trans_date: '2026-01-01',
                },
                {
                    transaction_id: 'journal-supplier', document_type: 'قيد يومية', document_number: 'J-200',
                    debit: '100', credit: '200', trans_date: '2026-02-01',
                },
            ] })
            .mockResolvedValueOnce({ rows: [{ total_invoices: '1000', total_payments: '100', total_debit: '100', total_credit: '1000' }] });

        const response = await request(buildApp()).get(`/api/account-statement/supplier/${supplierId}`);

        expect(response.status).toBe(200);
        expect(response.body.transactions.filter(t => t.document_type === 'قيد يومية')).toHaveLength(1);
        expect(response.body.transactions.filter(t => t.document_type === 'رصيد افتتاحي')).toHaveLength(1);
        expect(response.body.summary).toMatchObject({ total_debit: 100, total_credit: 1000, balance: -900 });
        expect(response.body.transactions[0].running_balance).toBe(-900);
        expect(mockQuery.mock.calls[1][0]).toContain("avl.sub_account_type = 'supplier'");
    });
});
