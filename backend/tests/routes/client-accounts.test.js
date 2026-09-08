'use strict';

const request = require('supertest');
const express = require('express');

const mockPoolQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...a) => mockPoolQuery(...a) }));
jest.mock('../../middleware/authorize', () => () => (_req, _res, next) => next());

const router = require('../../routes/client-accounts');

function buildApp(user = { id: 'u1', role: 'admin' }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api/client-accounts', router);
    return app;
}

const ROWS = [
    { id: 'c1', name: 'عميل مدين',   phone: '010', parent_id: null, parent_name: null,
      invoiced: '1000', received: '200', returned: '0',   journal_debit: '0', journal_credit: '0' },   // +800
    { id: 'c2', name: 'عميل دائن',   phone: '011', parent_id: null, parent_name: null,
      invoiced: '0',    received: '500', returned: '100', journal_debit: '0', journal_credit: '0' },   // -600
    { id: 'c3', name: 'عميل افتتاحي', phone: '012', parent_id: 'c1', parent_name: 'عميل مدين',
      invoiced: '0',    received: '0',   returned: '0',   journal_debit: '300', journal_credit: '50' }, // +250
    { id: 'c4', name: 'عميل صفري',   phone: '013', parent_id: null, parent_name: null,
      invoiced: '100',  received: '100', returned: '0',   journal_debit: '0', journal_credit: '0' },   // 0
];

describe('Client Accounts', () => {
    beforeEach(() => {
        mockPoolQuery.mockReset();
        mockPoolQuery.mockResolvedValue({ rows: ROWS });
    });

    test('GET / computes balances and totals, excluding zero rows by default', async () => {
        const res = await request(buildApp()).get('/api/client-accounts');
        expect(res.status).toBe(200);

        const byId = Object.fromEntries(res.body.data.map(r => [r.id, r.balance]));
        expect(res.body.data).toHaveLength(3);            // c4 excluded (zero)
        expect(byId.c1).toBe(800);                        // 1000 - 200
        expect(byId.c2).toBe(-600);                       // 0 - 500 - 100
        expect(byId.c3).toBe(250);                        // journal 300 - 50
        expect(res.body.totals).toEqual({ debit: 1050, credit: 600, net: 450 });
    });

    test('GET / include_zero=1 keeps zero-balance clients', async () => {
        const res = await request(buildApp()).get('/api/client-accounts?include_zero=1');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(4);
    });

    test('GET / search pushes an ILIKE filter param', async () => {
        const res = await request(buildApp()).get('/api/client-accounts?search=' + encodeURIComponent('محمد'));
        expect(res.status).toBe(200);
        const [sql, params] = mockPoolQuery.mock.calls[0];
        expect(sql).toContain('ILIKE');
        expect(params[0]).toBe('%محمد%');
    });

    test('GET / handles empty result set', async () => {
        mockPoolQuery.mockResolvedValueOnce({ rows: [] });
        const res = await request(buildApp()).get('/api/client-accounts');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
        expect(res.body.totals).toEqual({ debit: 0, credit: 0, net: 0 });
    });
});
