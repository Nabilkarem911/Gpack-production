'use strict';

// =============================================================================
// Tests: GET /api/designer/item/:orderId/:itemId/review-link
//
// Covers the "copy link without rotating" behavior:
//   - returns share_url when a valid recoverable token exists
//   - share_url is null for legacy hash-only tokens
//   - share_url is null (and is_expired=true) for expired tokens
//   - 404 for a missing item
// =============================================================================

const request = require('supertest');
const express = require('express');
const crypto  = require('crypto');
const { encryptToken, hashToken } = require('../../utils/crypto');

const mockQuery = jest.fn();
const mockClient = { query: jest.fn(), release: jest.fn() };

jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
    getClient: jest.fn(() => Promise.resolve(mockClient)),
    pool: { connect: jest.fn(() => Promise.resolve(mockClient)) },
}));
jest.mock('../../middleware/authorize', () => () => (req, _res, next) => {
    req.user = req.user || { id: 'u1', role: 'admin' };
    next();
});

const designerRoutes = require('../../routes/designer');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: 'u1', role: 'admin' };
        next();
    });
    app.use('/api/designer', designerRoutes);
    return app;
}

const FUTURE = () => new Date(Date.now() + 90 * 86400000);
const PAST   = () => new Date(Date.now() - 86400000);

describe('GET /api/designer/item/:orderId/:itemId/review-link', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockClient.query.mockReset();
    });

    test('returns share_url with the original token when a valid token exists', async () => {
        const plain = crypto.randomBytes(32).toString('hex');
        mockQuery.mockResolvedValue({
            rowCount: 1,
            rows: [{
                design_status: 'client_review',
                review_token_hash: hashToken(plain),
                review_token_encrypted: encryptToken(plain),
                review_token_expires_at: FUTURE(),
                review_sent_at: new Date(),
            }],
        });

        const res = await request(buildApp()).get('/api/designer/item/order-1/item-1/review-link');

        expect(res.status).toBe(200);
        expect(res.body.has_token).toBe(true);
        expect(res.body.is_expired).toBe(false);
        expect(res.body.share_url).toContain(`/design-review/${plain}`);
    });

    test('share_url is null for legacy hash-only tokens (no encrypted copy)', async () => {
        const plain = crypto.randomBytes(32).toString('hex');
        mockQuery.mockResolvedValue({
            rowCount: 1,
            rows: [{
                design_status: 'client_review',
                review_token_hash: hashToken(plain),
                review_token_encrypted: null,
                review_token_expires_at: FUTURE(),
                review_sent_at: new Date(),
            }],
        });

        const res = await request(buildApp()).get('/api/designer/item/order-1/item-1/review-link');

        expect(res.status).toBe(200);
        expect(res.body.has_token).toBe(true);
        expect(res.body.share_url).toBeNull();
    });

    test('share_url is null and is_expired=true for expired tokens', async () => {
        const plain = crypto.randomBytes(32).toString('hex');
        mockQuery.mockResolvedValue({
            rowCount: 1,
            rows: [{
                design_status: 'client_review',
                review_token_hash: hashToken(plain),
                review_token_encrypted: encryptToken(plain),
                review_token_expires_at: PAST(),
                review_sent_at: new Date(),
            }],
        });

        const res = await request(buildApp()).get('/api/designer/item/order-1/item-1/review-link');

        expect(res.status).toBe(200);
        expect(res.body.has_token).toBe(true);
        expect(res.body.is_expired).toBe(true);
        expect(res.body.share_url).toBeNull();
    });

    test('returns 404 for a missing item', async () => {
        mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
        const res = await request(buildApp()).get('/api/designer/item/order-1/item-x/review-link');
        expect(res.status).toBe(404);
    });

    test('falls back when review_token_encrypted column is missing (42703)', async () => {
        const plain = crypto.randomBytes(32).toString('hex');
        const missingCol = Object.assign(new Error('column does not exist'), { code: '42703' });
        mockQuery
            .mockRejectedValueOnce(missingCol)
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [{
                    design_status: 'client_review',
                    review_token_hash: hashToken(plain),
                    review_token_expires_at: FUTURE(),
                    review_sent_at: new Date(),
                }],
            });

        const res = await request(buildApp()).get('/api/designer/item/order-1/item-1/review-link');

        expect(res.status).toBe(200);
        expect(res.body.has_token).toBe(true);
        expect(res.body.share_url).toBeNull();
    });
});
