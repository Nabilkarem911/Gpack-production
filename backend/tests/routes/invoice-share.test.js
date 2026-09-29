'use strict';

// =============================================================================
// Tests: POST /api/invoices/:id/share — stable, idempotent share links
//
// Covers:
//   - first share creates a token + URL
//   - repeated shares (copy) return the SAME token/url, no DB write
//   - legacy plaintext tokens are reused as-is
//   - expired tokens rotate automatically
//   - regenerate=true force-rotates a still-valid token (old link dies)
//   - 404 for missing invoice, 400 for cancelled invoice
// =============================================================================

const request  = require('supertest');
const express  = require('express');
const crypto   = require('crypto');
const { encryptToken, hashToken } = require('../../utils/crypto');

const mockQuery = jest.fn();
const mockClient = { query: jest.fn(), release: jest.fn() };

jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
    pool: { connect: jest.fn(() => Promise.resolve(mockClient)) },
    getClient: jest.fn(() => Promise.resolve(mockClient)),
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
    app.use('/api/invoices', invoiceRoutes);
    return app;
}

const FUTURE = () => new Date(Date.now() + 90 * 86400000);
const PAST   = () => new Date(Date.now() - 86400000);

// Mock: first query is the invoice SELECT (returns `invoice`), anything else is UPDATE
function mockInvoiceRow(invoice) {
    mockQuery.mockImplementation(async (sql) => {
        if (sql.includes('FROM invoices WHERE id')) return { rowCount: invoice ? 1 : 0, rows: invoice ? [invoice] : [] };
        return { rowCount: 1, rows: [] };
    });
}

const didUpdate = () => mockQuery.mock.calls.some(([sql]) => sql.includes('UPDATE invoices'));
const updateCall = () => mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE invoices'));

describe('POST /api/invoices/:id/share', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockClient.query.mockReset();
    });

    test('creates a token on first share and stores it encrypted with hash + expiry', async () => {
        mockInvoiceRow({ id: 'inv-1', status: 'draft', share_token: null, token_expires_at: null });

        const res = await request(buildApp()).post('/api/invoices/inv-1/share').send({ expires_days: 90 });

        expect(res.status).toBe(200);
        expect(res.body.url).toMatch(/\/public-invoice\.html\?token=[0-9a-f]{64}$/);
        expect(res.body.expires_at).toBeTruthy();

        const upd = updateCall();
        expect(upd).toBeDefined();
        // params: [storedToken, tokenHash, expiresAt, id]
        // stored token is encrypted (not plaintext), hash matches returned token
        expect(upd[1][0]).not.toBe(res.body.token);
        expect(upd[1][0]).toContain(':'); // iv:authTag:ciphertext format
        expect(upd[1][1]).toBe(hashToken(res.body.token));
    });

    test('repeated shares return the SAME link without writing to the DB', async () => {
        const plain = crypto.randomBytes(32).toString('hex');
        mockInvoiceRow({
            id: 'inv-1', status: 'draft',
            share_token: encryptToken(plain), token_expires_at: FUTURE(),
        });

        const app = buildApp();
        const r1 = await request(app).post('/api/invoices/inv-1/share').send({ expires_days: 90 });
        const r2 = await request(app).post('/api/invoices/inv-1/share').send({ expires_days: 90 });
        const r3 = await request(app).post('/api/invoices/inv-1/share').send({ expires_days: 90 });

        // NOTE: supertest uses a different ephemeral port per request — compare
        // the token (and URL shape), not the full URL.
        expect(r1.body.token).toBe(plain);
        expect(r2.body.token).toBe(plain);
        expect(r3.body.token).toBe(plain);
        expect(r2.body.url).toMatch(/\/public-invoice\.html\?token=/);
        expect(r2.body.url.split('?token=')[1]).toBe(plain);
        expect(didUpdate()).toBe(false);
    });

    test('legacy plaintext share_token is reused as-is', async () => {
        const plain = crypto.randomBytes(32).toString('hex');
        mockInvoiceRow({
            id: 'inv-1', status: 'issued',
            share_token: plain, token_expires_at: FUTURE(),
        });

        const res = await request(buildApp()).post('/api/invoices/inv-1/share').send({});

        expect(res.status).toBe(200);
        expect(res.body.token).toBe(plain);
        expect(didUpdate()).toBe(false);
    });

    test('expired token rotates automatically', async () => {
        const oldPlain = crypto.randomBytes(32).toString('hex');
        mockInvoiceRow({
            id: 'inv-1', status: 'draft',
            share_token: encryptToken(oldPlain), token_expires_at: PAST(),
        });

        const res = await request(buildApp()).post('/api/invoices/inv-1/share').send({});

        expect(res.status).toBe(200);
        expect(res.body.token).not.toBe(oldPlain);
        expect(didUpdate()).toBe(true);
    });

    test('regenerate=true rotates a still-valid token — old hash is replaced', async () => {
        const oldPlain = crypto.randomBytes(32).toString('hex');
        mockInvoiceRow({
            id: 'inv-1', status: 'draft',
            share_token: encryptToken(oldPlain), token_expires_at: FUTURE(),
        });

        const res = await request(buildApp())
            .post('/api/invoices/inv-1/share')
            .send({ expires_days: 90, regenerate: true });

        expect(res.status).toBe(200);
        expect(res.body.token).not.toBe(oldPlain);

        const upd = updateCall();
        expect(upd).toBeDefined();
        // params: [storedToken, tokenHash, expiresAt, id]
        // stored hash belongs to the NEW token — the old token hash no longer resolves
        expect(upd[1][1]).toBe(hashToken(res.body.token));
        expect(upd[1][1]).not.toBe(hashToken(oldPlain));
    });

    test('returns 404 for a missing invoice', async () => {
        mockInvoiceRow(null);
        const res = await request(buildApp()).post('/api/invoices/nope/share').send({});
        expect(res.status).toBe(404);
        expect(didUpdate()).toBe(false);
    });

    test('returns 400 for a cancelled invoice', async () => {
        mockInvoiceRow({ id: 'inv-1', status: 'cancelled', share_token: null, token_expires_at: null });
        const res = await request(buildApp()).post('/api/invoices/inv-1/share').send({});
        expect(res.status).toBe(400);
        expect(didUpdate()).toBe(false);
    });
});
