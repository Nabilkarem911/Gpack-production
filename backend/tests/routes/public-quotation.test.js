'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
const mockClient = {
    query: (...args) => mockClientQuery(...args),
    release: mockRelease,
};

jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
    getClient: jest.fn(() => Promise.resolve(mockClient)),
}));

const publicQuotationRoutes = require('../../routes/public_quotation');

const order = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    status: 'quote',
    client_response: null,
    token_expires_at: new Date(Date.now() + 86400000).toISOString(),
    quotation_revision: 1,
    client_id: '660e8400-e29b-41d4-a716-446655440000',
    order_number: 123,
    client_name: 'Test Client',
};

function buildApp() {
    const app = express();
    app.use('/api/public', publicQuotationRoutes);
    return app;
}

describe('Public quotation approval signature', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockClientQuery.mockReset();
        mockRelease.mockReset();
    });

    test('requires a signature only for approval', async () => {
        const response = await request(buildApp())
            .post('/api/public/quotation/test-token/respond')
            .field('response', 'approved');

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/التوقيع مطلوب/);
        expect(mockClientQuery).not.toHaveBeenCalled();
    });

    test('stores approval and signature atomically', async () => {
        mockClientQuery
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [order], rowCount: 1 })
            .mockResolvedValueOnce({ rowCount: 1 })
            .mockResolvedValueOnce({ rowCount: 1 })
            .mockResolvedValueOnce({});

        const response = await request(buildApp())
            .post('/api/public/quotation/test-token/respond')
            .field('response', 'approved')
            .field('signature', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
            .field('device_info', 'test-device');

        expect(response.status).toBe(200);
        expect(response.body.data.message).toMatch(/توقيعك/);
        expect(mockClientQuery.mock.calls.map(call => call[0])).toEqual([
            'BEGIN',
            expect.stringContaining('FOR UPDATE OF o'),
            expect.stringContaining('UPDATE orders'),
            expect.stringContaining('INSERT INTO quotation_approvals'),
            'COMMIT',
        ]);
        expect(mockRelease).toHaveBeenCalledTimes(1);

        const approvalCall = mockClientQuery.mock.calls[3];
        expect(approvalCall[1][5]).toBe('Test Client');
        expect(approvalCall[1][7]).toMatch(/^[a-f0-9]{64}$/);

        const approvalPath = approvalCall[1][6];
        const savedFile = path.join(__dirname, '..', '..', '..', 'backend', approvalPath.replace(/^\//, ''));
        if (fs.existsSync(savedFile)) fs.unlinkSync(savedFile);
    });

    test('removes the signature file when the transaction rolls back', async () => {
        const approvalDir = path.join(__dirname, '..', '..', 'uploads', 'quotation-approvals');
        const receiptsDir = path.join(__dirname, '..', '..', 'uploads', 'receipts');
        const before = fs.existsSync(approvalDir) ? fs.readdirSync(approvalDir) : [];
        const receiptsBefore = fs.existsSync(receiptsDir) ? fs.readdirSync(receiptsDir) : [];
        mockClientQuery
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [order], rowCount: 1 })
            .mockResolvedValueOnce({ rowCount: 1 })
            .mockRejectedValueOnce(Object.assign(new Error('insert failed'), { code: '23514' }))
            .mockResolvedValueOnce({});

        const response = await request(buildApp())
            .post('/api/public/quotation/test-token/respond')
            .field('response', 'approved')
            .field('signature', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
            .attach('receipt', Buffer.from('receipt-test'), 'receipt.png');

        expect(response.status).toBe(500);
        expect(fs.readdirSync(approvalDir)).toEqual(before);
        expect(fs.readdirSync(receiptsDir)).toEqual(receiptsBefore);
        expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    test('rejects a second response after completion', async () => {
        mockClientQuery
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [{ ...order, client_response: 'approved' }], rowCount: 1 })
            .mockResolvedValueOnce({});

        const response = await request(buildApp())
            .post('/api/public/quotation/test-token/respond')
            .field('response', 'approved')
            .field('signature', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');

        expect(response.status).toBe(409);
        expect(response.body.error).toMatch(/مسبقاً/);
        expect(mockClientQuery.mock.calls.map(call => call[0])).toEqual(['BEGIN', expect.stringContaining('FOR UPDATE OF o'), 'ROLLBACK']);
    });
});
