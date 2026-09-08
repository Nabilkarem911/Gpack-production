'use strict';

const request = require('supertest');
const express = require('express');

const mockPoolQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...a) => mockPoolQuery(...a) }));
jest.mock('../../middleware/authorize', () => () => (_req, _res, next) => next());

const router = require('../../routes/supplier-accounts');

function buildApp(user = { id: 'u1', role: 'admin' }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api/supplier-accounts', router);
    return app;
}

const ROWS = [
    { id: 's1', name: 'مورد الورق',   phone: '020', contact_person: 'أحمد',
      invoiced: '5000', paid: '2000', journal_debit: '0',  journal_credit: '0' },  // -3000 دائن (مستحق)
    { id: 's2', name: 'مورد الكرتون', phone: '021', contact_person: null,
      invoiced: '1000', paid: '4000', journal_debit: '0',  journal_credit: '0' },  // +3000 مدين (لنا عنده)
    { id: 's3', name: 'مورد افتتاحي', phone: '022', contact_person: null,
      invoiced: '0',    paid: '0',    journal_debit: '100', journal_credit: '800' }, // -700 دائن
    { id: 's4', name: 'مورد صفري',   phone: '023', contact_person: null,
      invoiced: '500',  paid: '500',  journal_debit: '0',  journal_credit: '0' },  // 0
];

describe('Supplier Accounts', () => {
    beforeEach(() => {
        mockPoolQuery.mockReset();
        mockPoolQuery.mockResolvedValue({ rows: ROWS });
    });

    test('GET / computes balances and totals, excluding zero rows by default', async () => {
        const res = await request(buildApp()).get('/api/supplier-accounts');
        expect(res.status).toBe(200);

        const byId = Object.fromEntries(res.body.data.map(r => [r.id, r.balance]));
        expect(res.body.data).toHaveLength(3);            // s4 excluded (zero)
        expect(byId.s1).toBe(-3000);                      // paid 2000 - invoiced 5000
        expect(byId.s2).toBe(3000);                       // paid 4000 - invoiced 1000
        expect(byId.s3).toBe(-700);                       // jl debit 100 - jl credit 800
        expect(res.body.totals).toEqual({ debit: 3000, credit: 3700, net: -700 });
    });

    test('GET / include_zero=1 keeps zero-balance suppliers', async () => {
        const res = await request(buildApp()).get('/api/supplier-accounts?include_zero=1');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(4);
    });

    test('GET / search pushes an ILIKE filter param', async () => {
        const res = await request(buildApp()).get('/api/supplier-accounts?search=' + encodeURIComponent('كرتون'));
        expect(res.status).toBe(200);
        const [sql, params] = mockPoolQuery.mock.calls[0];
        expect(sql).toContain('ILIKE');
        expect(params[0]).toBe('%كرتون%');
    });

    test('GET / handles empty result set', async () => {
        mockPoolQuery.mockResolvedValueOnce({ rows: [] });
        const res = await request(buildApp()).get('/api/supplier-accounts');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
        expect(res.body.totals).toEqual({ debit: 0, credit: 0, net: 0 });
    });
});
