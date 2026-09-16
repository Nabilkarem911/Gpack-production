'use strict';

const request = require('supertest');
const express = require('express');

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const BANK_ID = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';
const SUPPLIER_ID = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_ID = '55555555-5555-4555-8555-555555555555';
const VOUCHER_ID = '66666666-6666-4666-8666-666666666666';

const mockQuery = jest.fn();
const mockTxQuery = jest.fn();
const mockClient = { query: (...args) => mockTxQuery(...args) };

jest.mock('../../db', () => ({
    query: (...args) => mockQuery(...args),
    withTransaction: async callback => callback(mockClient),
}));
jest.mock('../../middleware/authorize', () => () => (_req, _res, next) => next());
jest.mock('../../utils/event-bus', () => ({ emit: jest.fn() }));

const receiptRoutes = require('../../routes/receipt-vouchers');
const paymentRoutes = require('../../routes/payment-vouchers');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'user-1', role: 'admin' }; next(); });
    app.use('/api/receipt-vouchers', receiptRoutes);
    app.use('/api/payment-vouchers', paymentRoutes);
    return app;
}

function setupMocks({ cashAllowed = true, accountMode = false } = {}) {
    mockQuery.mockImplementation(async (sql, params = []) => {
        if (sql.includes('code IN (\'1100\', \'1200\')')) {
            return cashAllowed ? { rowCount: 1, rows: [{ id: CASH_ID, name: 'الصندوق' }] } : { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, name FROM clients')) return { rowCount: 1, rows: [{ id: CLIENT_ID, name: 'عميل' }] };
        if (sql.includes('SELECT id, company_name FROM suppliers')) return { rowCount: 1, rows: [{ id: SUPPLIER_ID, company_name: 'مورد' }] };
        if (accountMode && sql.includes('SELECT id, code, name FROM accounts')) return { rowCount: 1, rows: [{ id: ACCOUNT_ID, code: '4100', name: 'إيرادات' }] };
        if (sql.includes('SELECT id FROM accounts WHERE code = $1')) {
            return { rowCount: 1, rows: [{ id: params[0] === '2100' ? 'ap-2100' : 'ar-1300' }] };
        }
        return { rowCount: 1, rows: [] };
    });
    mockTxQuery.mockImplementation(async sql => {
        if (sql.includes('INSERT INTO accounting_vouchers')) return { rowCount: 1, rows: [{ id: VOUCHER_ID, voucher_number: 7001 }] };
        return { rowCount: 1, rows: [] };
    });
}

function lineCalls() {
    return mockTxQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO accounting_voucher_lines'));
}

describe('receipt/payment voucher accounting lines', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockTxQuery.mockReset();
    });

    test('receipt from client uses cash/bank debit and 1300 credit only', async () => {
        setupMocks();
        const response = await request(buildApp()).post('/api/receipt-vouchers').send({
            client_id: CLIENT_ID, amount: 100, cash_account_id: CASH_ID, voucher_date: '2026-09-16',
        });
        expect(response.status).toBe(201);
        const lines = lineCalls();
        expect(lines).toHaveLength(2);
        expect(lines[0][1][1]).toBe(CASH_ID);
        expect(lines[1][1][1]).toBe('ar-1300');
    });

    test('receipt from supplier uses cash/bank debit and 2100 credit only', async () => {
        setupMocks();
        const response = await request(buildApp()).post('/api/receipt-vouchers').send({
            client_id: SUPPLIER_ID, client_type: 'supplier', amount: 100, cash_account_id: BANK_ID, voucher_date: '2026-09-16',
        });
        expect(response.status).toBe(201);
        const lines = lineCalls();
        expect(lines).toHaveLength(2);
        expect(lines[0][1][1]).toBe(BANK_ID);
        expect(lines[1][1][1]).toBe('ap-2100');
    });

    test('payment to supplier uses 2100 debit and cash/bank credit only', async () => {
        setupMocks();
        const response = await request(buildApp()).post('/api/payment-vouchers').send({
            payee_type: 'supplier', payee_id: SUPPLIER_ID, amount: 100, cash_account_id: CASH_ID, voucher_date: '2026-09-16',
        });
        expect(response.status).toBe(201);
        const lines = lineCalls();
        expect(lines).toHaveLength(2);
        expect(lines[0][1][1]).toBe('ap-2100');
        expect(lines[1][1][1]).toBe(CASH_ID);
    });

    test('payment to client uses 1300 debit and cash/bank credit only', async () => {
        setupMocks();
        const response = await request(buildApp()).post('/api/payment-vouchers').send({
            payee_type: 'client', payee_id: CLIENT_ID, amount: 100, cash_account_id: BANK_ID, voucher_date: '2026-09-16',
        });
        expect(response.status).toBe(201);
        const lines = lineCalls();
        expect(lines).toHaveLength(2);
        expect(lines[0][1][1]).toBe('ar-1300');
        expect(lines[1][1][1]).toBe(BANK_ID);
    });

    test('rejects active non-cash account for both voucher types', async () => {
        setupMocks({ cashAllowed: false });
        const receipt = await request(buildApp()).post('/api/receipt-vouchers').send({
            client_id: CLIENT_ID, amount: 100, cash_account_id: ACCOUNT_ID, voucher_date: '2026-09-16',
        });
        const payment = await request(buildApp()).post('/api/payment-vouchers').send({
            payee_type: 'supplier', payee_id: SUPPLIER_ID, amount: 100, cash_account_id: ACCOUNT_ID, voucher_date: '2026-09-16',
        });
        expect(receipt.status).toBe(404);
        expect(payment.status).toBe(404);
        expect(lineCalls()).toHaveLength(0);
    });

    test('account payee uses the selected account as the direct counterpart', async () => {
        setupMocks({ accountMode: true });
        const receipt = await request(buildApp()).post('/api/receipt-vouchers').send({
            client_id: ACCOUNT_ID, client_type: 'account', amount: 100, cash_account_id: CASH_ID, voucher_date: '2026-09-16',
        });
        const payment = await request(buildApp()).post('/api/payment-vouchers').send({
            payee_type: 'account', payee_id: ACCOUNT_ID, amount: 100, cash_account_id: CASH_ID, voucher_date: '2026-09-16',
        });
        expect(receipt.status).toBe(201);
        expect(payment.status).toBe(201);
        const lines = lineCalls();
        expect(lines).toHaveLength(4);
        expect(lines[0][1][1]).toBe(CASH_ID);
        expect(lines[1][1][1]).toBe(ACCOUNT_ID);
        expect(lines[2][1][1]).toBe(ACCOUNT_ID);
        expect(lines[3][1][1]).toBe(CASH_ID);
    });
});
