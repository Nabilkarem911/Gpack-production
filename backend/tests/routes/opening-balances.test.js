'use strict';

const request = require('supertest');
const express = require('express');

const mockPoolQuery   = jest.fn();
const mockClientQuery = jest.fn();
const mockClient  = { query: (...a) => mockClientQuery(...a), release: jest.fn() };

jest.mock('../../db', () => ({
    query: (...a) => mockPoolQuery(...a),
    getClient: jest.fn(async () => mockClient),
}));
jest.mock('../../middleware/authorize', () => () => (_req, _res, next) => next());

const router = require('../../routes/opening-balances');

function buildApp(user = { id: 'u1', role: 'admin' }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api/opening-balances', router);
    return app;
}

const accountId = 'aaaa1111-0000-4000-8000-0000000000aa';
const clientId  = 'bbbb2222-0000-4000-8000-0000000000bb';
const openingId = 'cccc3333-0000-4000-8000-0000000000cc';

function setupTxMock(overrides = {}) {
    mockClientQuery.mockImplementation(async (sql, params) => {
        const s = sql.trim();
        if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
        if (s.includes('FROM clients')) {
            if (overrides.noClient) return { rows: [] };
            return { rows: [{ id: clientId, label: 'عميل تجريبي' }] };
        }
        if (s.includes('FROM suppliers')) return { rows: [{ id: params[0], label: 'مورد تجريبي' }] };
        if (s.includes('FROM accounts WHERE id = $1')) {
            if (overrides.noAccount) return { rows: [] };
            return { rows: [{ id: params[0], code: '1110', name: 'الصندوق الرئيسي', account_type: 'asset' }] };
        }
        if (s.includes('FROM accounts WHERE code = $1')) {
            return { rows: [{ id: 'ctrl-' + params[0] }] };
        }
        if (s.includes('INSERT INTO opening_balances')) {
            if (overrides.dup) { const e = new Error('duplicate'); e.code = '23505'; throw e; }
            return { rows: [{ id: openingId }] };
        }
        if (s.includes('INSERT INTO accounting_vouchers')) {
            return { rows: [{ id: 'v1', voucher_number: 5001 }] };
        }
        if (s.includes('INSERT INTO accounting_voucher_lines')) return { rows: [] };
        if (s.includes('FROM opening_balances WHERE id = $1')) {
            if (overrides.notFound) return { rows: [] };
            return { rows: [{
                id: openingId, account_id: accountId, sub_account_type: null,
                sub_account_id: null, side: 'debit', amount: '100.00',
                balance_date: '2026-01-01', description: null, reference: null,
                voucher_id: 'v-old', status: overrides.cancelled ? 'cancelled' : 'posted',
            }] };
        }
        if (s.includes('UPDATE accounting_vouchers') || s.includes('UPDATE opening_balances')) {
            return { rows: [] };
        }
        throw new Error('Unexpected query: ' + s);
    });
}

describe('Opening Balances', () => {
    beforeEach(() => {
        mockPoolQuery.mockReset();
        mockClientQuery.mockReset();
        mockClient.release.mockClear();
        setupTxMock();
    });

    test('GET / returns list rows', async () => {
        mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: openingId, amount: '500', side: 'debit', status: 'posted' }] });
        const res = await request(buildApp()).get('/api/opening-balances');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
    });

    test('GET /meta returns pickers data', async () => {
        mockPoolQuery
            .mockResolvedValueOnce({ rows: [{ id: accountId, code: '1110', name: 'الصندوق' }] })
            .mockResolvedValueOnce({ rows: [{ id: clientId, name: 'عميل' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });
        const res = await request(buildApp()).get('/api/opening-balances/meta');
        expect(res.status).toBe(200);
        expect(res.body.data.accounts).toHaveLength(1);
        expect(res.body.data.clients).toHaveLength(1);
    });

    test('POST rejects invalid amount', async () => {
        const res = await request(buildApp()).post('/api/opening-balances')
            .send({ account_kind: 'account', account_id: accountId, side: 'debit', amount: -5, balance_date: '2026-01-01' });
        expect(res.status).toBe(400);
    });

    test('POST rejects missing account', async () => {
        const res = await request(buildApp()).post('/api/opening-balances')
            .send({ account_kind: 'account', side: 'debit', amount: 100, balance_date: '2026-01-01' });
        expect(res.status).toBe(400);
    });

    test('POST creates balanced voucher for a GL account (debit side)', async () => {
        const res = await request(buildApp()).post('/api/opening-balances')
            .send({ account_kind: 'account', account_id: accountId, side: 'debit', amount: 250, balance_date: '2026-01-01', reference: 'OB-1' });
        expect(res.status).toBe(201);
        expect(res.body.data.voucher_number).toBe(5001);

        // Voucher must be opening_balance type, posted, total = amount
        const vIns = mockClientQuery.mock.calls.find(([s]) => s.includes('INSERT INTO accounting_vouchers'));
        expect(vIns[0]).toContain("'opening_balance'");
        expect(vIns[1][2]).toBe(250);

        // Two lines: target debit + contra credit
        const lines = mockClientQuery.mock.calls.filter(([s]) => s.includes('INSERT INTO accounting_voucher_lines'));
        expect(lines).toHaveLength(2);
        expect(lines[0][1][2]).toBe(250); // debit on target
        expect(lines[0][1][3]).toBe(0);
        expect(lines[1][1][2]).toBe(0);   // credit on contra
        expect(lines[1][1][3]).toBe(250);
    });

    test('POST resolves client to control account 1300 with sub-ledger', async () => {
        const res = await request(buildApp()).post('/api/opening-balances')
            .send({ account_kind: 'client', sub_account_id: clientId, side: 'debit', amount: 300, balance_date: '2026-01-01' });
        expect(res.status).toBe(201);

        // Control account lookup used code 1300
        const ctrlCall = mockClientQuery.mock.calls.find(([s]) => s.includes("FROM accounts WHERE code = $1"));
        expect(ctrlCall[1][0]).toBe('1300');

        // Target line carries client sub-ledger
        const line = mockClientQuery.mock.calls.find(([s]) => s.includes('INSERT INTO accounting_voucher_lines'));
        expect(line[1][5]).toBe('client');
        expect(line[1][6]).toBe(clientId);
    });

    test('POST returns 409 on duplicate posted balance', async () => {
        mockClientQuery.mockReset();
        setupTxMock({ dup: true });
        const res = await request(buildApp()).post('/api/opening-balances')
            .send({ account_kind: 'account', account_id: accountId, side: 'debit', amount: 100, balance_date: '2026-01-01' });
        expect(res.status).toBe(409);
    });

    test('PUT reverses the old voucher and posts a new one', async () => {
        const res = await request(buildApp()).put(`/api/opening-balances/${openingId}`)
            .send({ side: 'credit', amount: 400, balance_date: '2026-02-01' });
        expect(res.status).toBe(200);

        const reverse = mockClientQuery.mock.calls.find(([s]) =>
            s.includes("UPDATE accounting_vouchers SET status = 'reversed'"));
        expect(reverse[1][0]).toBe('v-old');

        const lines = mockClientQuery.mock.calls.filter(([s]) => s.includes('INSERT INTO accounting_voucher_lines'));
        expect(lines[0][1][2]).toBe(0);    // side=credit → target line is credit
        expect(lines[0][1][3]).toBe(400);
    });

    test('PUT rejects editing a cancelled balance', async () => {
        mockClientQuery.mockReset();
        setupTxMock({ cancelled: true });
        const res = await request(buildApp()).put(`/api/opening-balances/${openingId}`)
            .send({ side: 'debit', amount: 10, balance_date: '2026-01-01' });
        expect(res.status).toBe(409);
    });

    test('DELETE reverses voucher and cancels the row', async () => {
        const res = await request(buildApp()).delete(`/api/opening-balances/${openingId}`);
        expect(res.status).toBe(200);
        const upd = mockClientQuery.mock.calls.find(([s]) =>
            s.includes("UPDATE opening_balances SET status = 'cancelled'"));
        expect(upd).toBeTruthy();
    });
});

