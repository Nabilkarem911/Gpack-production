// =============================================================================
// Tests: utils/validators.js  (D-001, AP-003)
// =============================================================================

const {
    clientCreate,
    orderCreate,
    invoiceCreate,
    receiptVoucherCreate,
    paymentVoucherCreate,
    journalEntryCreate,
    validateBody,
} = require('../../utils/validators');

describe('validators', () => {
    describe('clientCreate schema', () => {
        test('valid client passes', () => {
            const data = { name: 'Acme Corp', phone: '0123456789', status: 'active' };
            const result = clientCreate.safeParse(data);
            expect(result.success).toBe(true);
        });

        test('missing name fails', () => {
            const result = clientCreate.safeParse({ phone: '0123456789' });
            expect(result.success).toBe(false);
        });

        test('invalid email fails', () => {
            const result = clientCreate.safeParse({ name: 'Acme', email: 'not-an-email' });
            expect(result.success).toBe(false);
        });

        test('invalid UUID parent_id fails', () => {
            const result = clientCreate.safeParse({ name: 'Acme', parent_id: 'not-a-uuid' });
            expect(result.success).toBe(false);
        });
    });

    describe('orderCreate schema', () => {
        test('valid order passes', () => {
            const data = {
                client_id: '550e8400-e29b-41d4-a716-446655440000',
                items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440001', quantity: 10 }],
            };
            const result = orderCreate.safeParse(data);
            expect(result.success).toBe(true);
        });

        test('empty items fails', () => {
            const result = orderCreate.safeParse({
                client_id: '550e8400-e29b-41d4-a716-446655440000',
                items: [],
            });
            expect(result.success).toBe(false);
        });

        test('negative quantity fails', () => {
            const result = orderCreate.safeParse({
                client_id: '550e8400-e29b-41d4-a716-446655440000',
                items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440001', quantity: -1 }],
            });
            expect(result.success).toBe(false);
        });
    });

    describe('invoiceCreate schema', () => {
        test('valid invoice passes', () => {
            const data = {
                client_id: '550e8400-e29b-41d4-a716-446655440000',
                items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440001', quantity: 5, unit_price: 100 }],
            };
            const result = invoiceCreate.safeParse(data);
            expect(result.success).toBe(true);
        });

        test('tax_rate above 1 fails', () => {
            const result = invoiceCreate.safeParse({
                client_id: '550e8400-e29b-41d4-a716-446655440000',
                tax_rate: 15,
                items: [{ variant_id: '550e8400-e29b-41d4-a716-446655440001', quantity: 1, unit_price: 1 }],
            });
            expect(result.success).toBe(false);
        });
    });

    describe('accounting party linkage schemas', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';

        test('receipt accepts supplier as the selected third-level party', () => {
            expect(receiptVoucherCreate.safeParse({
                client_id: uuid,
                client_type: 'supplier',
                amount: 100,
                voucher_date: '2026-09-07',
                cash_account_id: uuid,
            }).success).toBe(true);
        });

        test('payment accepts client and supplier payees', () => {
            for (const payee_type of ['client', 'supplier']) {
                expect(paymentVoucherCreate.safeParse({
                    payee_type,
                    payee_id: uuid,
                    amount: 100,
                    voucher_date: '2026-09-07',
                    cash_account_id: uuid,
                }).success).toBe(true);
            }
        });

        test('journal keeps the client/supplier sub-ledger fields', () => {
            const result = journalEntryCreate.safeParse({
                voucher_date: '2026-09-07',
                description: 'اختبار ربط حساب تفصيلي',
                lines: [
                    { account_id: uuid, debit: 100, sub_account_type: 'client', sub_account_id: uuid },
                    { account_id: uuid, credit: 100 },
                ],
            });
            expect(result.success).toBe(true);
            expect(result.data.lines[0].sub_account_type).toBe('client');
            expect(result.data.lines[0].sub_account_id).toBe(uuid);
        });
    });

    describe('validateBody middleware', () => {
        test('calls next() on valid body', () => {
            const req = { body: { name: 'Valid', status: 'active' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            const next = jest.fn();
            validateBody(clientCreate)(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(req.validatedBody).toBeDefined();
            expect(req.validatedBody.name).toBe('Valid');
        });

        test('returns 400 on invalid body', () => {
            const req = { body: {} };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            const next = jest.fn();
            validateBody(clientCreate)(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: 'Validation failed',
                field: 'name',
            }));
            expect(next).not.toHaveBeenCalled();
        });
    });
});
