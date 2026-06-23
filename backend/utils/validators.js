// =============================================================================
// G.PACK 2.0 — Zod Validation Schemas (AP-003)
// Shared input validation schemas to replace manual checks across routes.
// =============================================================================

const { z } = require('zod');

const idParam = z.string().uuid('Invalid UUID format');

const loginBody = z.object({
    email: z.string().email('Valid email is required').max(255),
    password: z.string().min(1, 'Password is required').max(255),
});

const paginationQuery = z.object({
    limit: z.coerce.number().int().min(1).max(500).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
    page: z.coerce.number().int().min(1).optional().default(1),
});

const clientCreate = z.object({
    name: z.string().min(1).max(255),
    phone: z.string().max(50).optional().nullable(),
    email: z.string().email().max(255).optional().nullable(),
    city: z.string().max(100).optional().nullable(),
    address: z.string().max(500).optional().nullable(),
    tax_number: z.string().max(50).optional().nullable(),
    status: z.enum(['active', 'inactive']).optional().default('active'),
    parent_id: z.string().uuid().optional().nullable(),
    credit_limit: z.coerce.number().min(0).optional().default(0),
});

const orderCreate = z.object({
    client_id: z.string().uuid(),
    order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    client_notes: z.string().max(2000).optional().nullable(),
    internal_notes: z.string().max(2000).optional().nullable(),
    terms_conditions: z.string().max(5000).optional().nullable(),
    items: z.array(z.object({
        variant_id: z.string().uuid(),
        quantity: z.coerce.number().int().positive(),
        unit_price: z.coerce.number().min(0).optional(),
        discount_percent: z.coerce.number().min(0).max(100).optional().default(0),
        notes: z.string().max(500).optional().nullable(),
    })).min(1, 'At least one item is required'),
});

const invoiceCreate = z.object({
    client_id: z.string().uuid(),
    order_id: z.string().uuid().optional().nullable(),
    invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    tax_rate: z.coerce.number().min(0).max(1).optional().nullable(),
    additional_expenses: z.coerce.number().min(0).optional().default(0),
    notes: z.string().max(2000).optional().nullable(),
    items: z.array(z.object({
        variant_id: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        unit_price: z.coerce.number().min(0),
        discount_percent: z.coerce.number().min(0).max(100).optional().default(0),
    })).min(1, 'At least one item is required'),
});

const receiptVoucherCreate = z.object({
    client_id: z.string().uuid(),
    voucher_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    total_amount: z.coerce.number().positive(),
    payment_method: z.enum(['cash', 'bank_transfer', 'check', 'credit_card']),
    description: z.string().max(500).optional().nullable(),
    reference_number: z.string().max(100).optional().nullable(),
});

/**
 * Express middleware wrapper that validates req.body against a Zod schema.
 * On failure returns 400 with the first validation error message.
 */
function validateBody(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            const issues = result.error.errors || result.error.issues || [];
            const firstError = issues[0];
            return res.status(400).json({
                error: 'Validation failed',
                field: firstError?.path?.join('.') || 'unknown',
                message: firstError?.message || 'Invalid input',
            });
        }
        req.validatedBody = result.data;
        next();
    };
}

/**
 * Express middleware wrapper that validates req.query against a Zod schema.
 */
function validateQuery(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.query);
        if (!result.success) {
            const issues = result.error.errors || result.error.issues || [];
            const firstError = issues[0];
            return res.status(400).json({
                error: 'Validation failed',
                field: firstError?.path?.join('.') || 'unknown',
                message: firstError?.message || 'Invalid input',
            });
        }
        req.validatedQuery = result.data;
        next();
    };
}

module.exports = {
    idParam,
    loginBody,
    paginationQuery,
    clientCreate,
    orderCreate,
    invoiceCreate,
    receiptVoucherCreate,
    validateBody,
    validateQuery,
};
