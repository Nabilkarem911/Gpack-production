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
    contact_person: z.string().max(255).optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
    email: z.string().email().max(255).optional().nullable(),
    city: z.string().max(100).optional().nullable(),
    address: z.string().max(500).optional().nullable(),
    commercial_register: z.string().max(100).optional().nullable(),
    tax_id: z.string().max(50).optional().nullable(),
    tax_number: z.string().max(50).optional().nullable(),
    status: z.enum(['active', 'inactive']).optional().default('active'),
    parent_id: z.string().uuid().optional().nullable(),
    credit_limit: z.coerce.number().min(0).optional().default(0),
}).passthrough();

const orderCreate = z.object({
    client_id: z.string().uuid(),
    status: z.string().max(50).optional(),
    order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    client_notes: z.string().max(2000).optional().nullable(),
    internal_notes: z.string().max(2000).optional().nullable(),
    terms_conditions: z.any().optional().nullable(),
    custom_terms: z.any().optional().nullable(),
    down_payment_required: z.any().optional(),
    pricing_status: z.string().optional().nullable(),
    items: z.array(z.object({
        variant_id: z.string().uuid().optional(),
        product_variant_id: z.string().uuid().optional(),
        quantity: z.coerce.number().int().positive(),
        unit_price: z.coerce.number().min(0).optional(),
        discount_percent: z.coerce.number().min(0).max(100).optional().default(0),
        notes: z.string().max(500).optional().nullable(),
    }).passthrough()).min(1, 'At least one item is required'),
}).passthrough();

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
        order_item_id: z.string().uuid().optional().nullable(),
    }).passthrough()).min(1, 'At least one item is required'),
}).passthrough();

const receiptVoucherCreate = z.object({
    client_id: z.string().uuid('Valid client_id is required'),
    client_type: z.enum(['client', 'franchise']).optional().default('client'),
    amount: z.coerce.number().positive('Amount must be positive'),
    payment_method: z.enum(['cash', 'bank_transfer', 'check', 'credit_card']).optional().default('cash'),
    voucher_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    description: z.string().max(500).optional().nullable(),
    reference_number: z.string().max(100).optional().nullable(),
    cash_account_id: z.string().uuid().optional().nullable(),
}).passthrough();

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

// =============================================================================
// Product Schemas
// =============================================================================

const productCreate = z.object({
    name: z.string().min(1, 'Product name is required').max(255),
    description: z.string().max(2000).optional().nullable(),
    category_id: z.string().uuid().optional().nullable(),
    sku: z.string().max(100).optional().nullable(),
    barcode: z.string().max(100).optional().nullable(),
    status: z.enum(['active', 'inactive']).optional().default('active'),
    variants: z.array(z.object({
        size_name: z.string().min(1).max(100),
        sku: z.string().max(100).optional().nullable(),
        barcode: z.string().max(100).optional().nullable(),
        unit_id: z.string().uuid().optional().nullable(),
        selling_price: z.coerce.number().min(0).optional().default(0),
        cost_price: z.coerce.number().min(0).optional().default(0),
        min_stock_level: z.coerce.number().min(0).optional().default(0),
        max_stock_level: z.coerce.number().min(0).optional().nullable(),
        weight: z.coerce.number().min(0).optional().nullable(),
        dimensions: z.string().max(100).optional().nullable(),
        status: z.enum(['active', 'inactive']).optional().default('active'),
    })).optional().default([]),
});

const productUpdate = z.object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional().nullable(),
    category_id: z.string().uuid().optional().nullable(),
    sku: z.string().max(100).optional().nullable(),
    barcode: z.string().max(100).optional().nullable(),
    status: z.enum(['active', 'inactive']).optional(),
});

const variantCreate = z.object({
    size_name: z.string().min(1, 'Variant size name is required').max(100),
    sku: z.string().max(100).optional().nullable(),
    barcode: z.string().max(100).optional().nullable(),
    unit_id: z.string().uuid().optional().nullable(),
    selling_price: z.coerce.number().min(0).optional().default(0),
    cost_price: z.coerce.number().min(0).optional().default(0),
    min_stock_level: z.coerce.number().min(0).optional().default(0),
    max_stock_level: z.coerce.number().min(0).optional().nullable(),
    weight: z.coerce.number().min(0).optional().nullable(),
    dimensions: z.string().max(100).optional().nullable(),
    status: z.enum(['active', 'inactive']).optional().default('active'),
});

const variantUpdate = variantCreate.partial();

// =============================================================================
// Category & Unit Schemas
// =============================================================================

const categoryCreate = z.object({
    name: z.string().min(1, 'Category name is required').max(255),
    parent_id: z.string().uuid().optional().nullable(),
    description: z.string().max(1000).optional().nullable(),
});

const categoryUpdate = z.object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(1000).optional().nullable(),
});

const unitCreate = z.object({
    name: z.string().min(1, 'Unit name is required').max(100),
    abbreviation: z.string().max(20).optional().nullable(),
    base_unit_id: z.string().uuid().optional().nullable(),
    conversion_factor: z.coerce.number().positive().optional().nullable(),
});

const unitUpdate = z.object({
    name: z.string().min(1).max(100).optional(),
    abbreviation: z.string().max(20).optional().nullable(),
});

// =============================================================================
// Delivery Note Schemas
// =============================================================================

const deliveryNoteCreate = z.object({
    order_id: z.string().uuid('Valid order_id is required'),
    client_id: z.string().uuid('Valid client_id is required'),
    items: z.array(z.object({
        variant_id: z.string().uuid().optional().nullable(),
        order_item_id: z.string().uuid().optional().nullable(),
        quantity: z.coerce.number().positive(),
    }).passthrough()).min(1, 'At least one item is required'),
    notes: z.string().max(2000).optional().nullable(),
}).passthrough();

const deliveryNoteDispatch = z.object({
    items: z.array(z.object({
        variant_id: z.string().uuid().optional().nullable(),
        order_item_id: z.string().uuid().optional().nullable(),
        item_id: z.string().uuid().optional().nullable(),
        quantity: z.coerce.number().positive(),
    }).passthrough()).min(1, 'At least one item is required'),
    notes: z.string().max(2000).optional().nullable(),
}).passthrough();

// =============================================================================
// Manufacturer Order Schemas
// =============================================================================

const manufacturerOrderCreate = z.object({
    order_id: z.string().uuid('Valid order_id is required'),
    supplier_id: z.string().uuid('Valid supplier_id is required'),
    expected_delivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    items: z.array(z.object({
        order_item_id: z.string().uuid(),
        quantity: z.coerce.number().positive(),
    }).passthrough()).min(1, 'At least one item is required'),
}).passthrough();

const manufacturerOrderStatusUpdate = z.object({
    status: z.enum(['pending', 'sent', 'partially_received', 'received', 'cancelled']),
    actual_delivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const manufacturerOrderUpdate = z.object({
    supplier_id: z.string().uuid().optional(),
    expected_delivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
});

const manufacturerOrderReceive = z.object({
    warehouse_id: z.string().uuid('Valid warehouse_id is required'),
    items: z.array(z.object({
        variant_id: z.string().uuid(),
        quantity: z.coerce.number().positive(),
    }).passthrough()).min(1, 'At least one item is required'),
    has_supplier_invoice: z.boolean().optional().default(false),
    tax_rate: z.coerce.number().min(0).optional().default(0),
    supplier_invoice_ref: z.string().max(200).optional().default(''),
    notes: z.string().max(2000).optional().default(''),
    pay_now: z.boolean().optional().default(false),
    pay_amount: z.coerce.number().min(0).optional().default(0),
    pay_notes: z.string().max(500).optional().default(''),
}).passthrough();

const manufacturerOrderPricing = z.object({
    items: z.array(z.object({
        manufacturer_order_item_id: z.string().uuid(),
        unit_cost: z.coerce.number().min(0),
    })).min(1, 'At least one item is required'),
});

// =============================================================================
// Payment Voucher Schemas
// =============================================================================

const paymentVoucherCreate = z.object({
    payee_type: z.enum(['supplier', 'client', 'account', 'other']).optional().default('supplier'),
    payee_id: z.string().uuid().optional().nullable(),
    supplier_id: z.string().uuid().optional().nullable(),
    client_id: z.string().uuid().optional().nullable(),
    amount: z.coerce.number().positive('Amount must be positive'),
    payment_method: z.enum(['cash', 'bank_transfer', 'check', 'credit_card']).optional().default('cash'),
    voucher_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    description: z.string().max(500).optional().nullable(),
    reference_number: z.string().max(100).optional().nullable(),
    cash_account_id: z.string().uuid().optional().nullable(),
    purchase_invoice_id: z.string().uuid().optional().nullable(),
}).passthrough();

const voucherCancel = z.object({
    reason: z.string().min(1, 'Cancel reason is required').max(500),
});

// =============================================================================
// Journal Entry Schemas
// =============================================================================

const journalEntryCreate = z.object({
    voucher_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    description: z.string().min(1, 'Description is required').max(500),
    lines: z.array(z.object({
        account_id: z.string().uuid('Valid account_id is required'),
        debit: z.coerce.number().min(0).optional().default(0),
        credit: z.coerce.number().min(0).optional().default(0),
        description: z.string().max(500).optional().nullable(),
    })).min(2, 'At least two lines are required for double-entry'),
});

// =============================================================================
// Task Schemas
// =============================================================================

const taskCreate = z.object({
    title: z.string().min(1, 'Task title is required').max(255),
    description: z.string().max(2000).optional().nullable(),
    assigned_to: z.string().uuid('Valid assigned_to user ID is required'),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid due_date is required (YYYY-MM-DD)'),
    priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
    subtasks: z.array(z.object({
        title: z.string().min(1).max(255),
        description: z.string().max(1000).optional().nullable(),
        sort_order: z.coerce.number().int().min(0).optional().default(0),
    })).optional().default([]),
});

const taskUpdate = z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional().nullable(),
    assigned_to: z.string().uuid().optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    status: z.enum(['pending', 'completed', 'cancelled']).optional(),
    order_id: z.string().uuid().optional().nullable(),
    client_id: z.string().uuid().optional().nullable(),
});

const subtaskCreate = z.object({
    title: z.string().min(1, 'Subtask title is required').max(255),
    description: z.string().max(1000).optional().nullable(),
    sort_order: z.coerce.number().int().min(0).optional().default(0),
});

const subtaskUpdate = z.object({
    is_completed: z.boolean().optional(),
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(1000).optional().nullable(),
});

const taskCommentCreate = z.object({
    comment: z.string().min(1, 'Comment is required').max(2000),
    subtask_id: z.string().uuid().optional().nullable(),
    attachments: z.array(z.object({
        filename: z.string().max(255),
        url: z.string().max(2000),
    })).optional().default([]),
});

// =============================================================================
// User Schemas
// =============================================================================

const userCreate = z.object({
    email: z.string().email('Valid email is required').max(255),
    name: z.string().min(1, 'Name is required').max(255),
    password: z.string().min(6, 'Password must be at least 6 characters').max(255),
    role_id: z.string().uuid('Valid role_id is required'),
    status: z.enum(['active', 'inactive']).optional().default('active'),
});

const userUpdate = z.object({
    name: z.string().min(1).max(255).optional(),
    email: z.string().email().max(255).optional(),
    role_id: z.string().uuid().optional(),
    status: z.enum(['active', 'inactive']).optional(),
    password: z.string().min(6).max(255).optional(),
});

const roleCreate = z.object({
    role_name: z.string().min(1, 'Role name is required').max(100),
    description: z.string().max(500).optional().nullable(),
    permissions: z.record(z.any()).optional().default({}),
});

const roleUpdate = z.object({
    role_name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional().nullable(),
    permissions: z.record(z.any()).optional(),
});

// =============================================================================
// Supplier Schemas
// =============================================================================

const supplierCreate = z.object({
    company_name: z.string().min(1, 'Company name is required').max(255),
    contact_person: z.string().max(255).optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
    email: z.string().email().max(255).optional().nullable(),
    address: z.string().max(500).optional().nullable(),
    tax_number: z.string().max(50).optional().nullable(),
    payment_terms: z.string().max(500).optional().nullable(),
    status: z.enum(['active', 'inactive']).optional().default('active'),
}).passthrough();

const supplierUpdate = supplierCreate.partial();

// =============================================================================
// Receiving Voucher Schemas
// =============================================================================

const receivingVoucherCreate = z.object({
    receiving_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    supplier_id: z.string().uuid().optional().nullable(),
    purchase_invoice_id: z.string().uuid().optional().nullable(),
    manufacturer_order_id: z.string().uuid().optional().nullable(),
    warehouse_id: z.string().uuid('Valid warehouse_id is required'),
    notes: z.string().max(2000).optional().nullable(),
    items: z.array(z.object({
        variant_id: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        unit_cost: z.coerce.number().min(0).optional().default(0),
    }).passthrough()).min(1, 'At least one item is required'),
}).passthrough();

// =============================================================================
// Purchase Invoice Schemas
// =============================================================================

const purchaseInvoiceCreate = z.object({
    supplier_id: z.string().uuid('Valid supplier_id is required'),
    invoice_number: z.string().min(1).max(100).optional(),
    invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    tax_rate: z.coerce.number().min(0).max(1).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    items: z.array(z.object({
        variant_id: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        unit_cost: z.coerce.number().min(0),
    }).passthrough()).min(1, 'At least one item is required'),
}).passthrough();

// =============================================================================
// Purchase Return Schemas
// =============================================================================

const purchaseReturnCreate = z.object({
    return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    supplier_id: z.string().uuid('Valid supplier_id is required'),
    purchase_invoice_id: z.string().uuid().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    items: z.array(z.object({
        variant_id: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        unit_cost: z.coerce.number().min(0).optional().default(0),
    }).passthrough()).min(1, 'At least one item is required'),
}).passthrough();

// =============================================================================
// Terms Schemas
// =============================================================================

const termsCreate = z.object({
    title: z.string().min(1, 'Title is required').max(255),
    content: z.string().max(10000).optional().nullable(),
    is_default: z.boolean().optional().default(false),
});

const termsUpdate = z.object({
    title: z.string().min(1).max(255).optional(),
    content: z.string().max(10000).optional().nullable(),
    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
});

// =============================================================================
// Orders — additional schemas
// =============================================================================

const orderUpdate = z.object({
    client_id: z.string().uuid().optional(),
    status: z.string().max(50).optional(),
    order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    client_notes: z.string().max(2000).optional().nullable(),
    internal_notes: z.string().max(2000).optional().nullable(),
    terms_conditions: z.any().optional().nullable(),
    custom_terms: z.any().optional().nullable(),
    down_payment_required: z.any().optional(),
    pricing_status: z.string().optional().nullable(),
    items: z.array(z.object({
        variant_id: z.string().uuid().optional(),
        product_variant_id: z.string().uuid().optional(),
        quantity: z.coerce.number().int().positive(),
        unit_price: z.coerce.number().min(0).optional(),
        discount_percent: z.coerce.number().min(0).max(100).optional().default(0),
        notes: z.string().max(500).optional().nullable(),
    }).passthrough()).min(1, 'At least one item is required').optional(),
}).passthrough();

const orderStatusUpdate = z.object({
    status: z.enum(['quote', 'confirmed', 'production', 'processing', 'completed', 'delivered', 'cancelled', 'archived']),
});

const orderConvertToProduction = z.object({
    down_payment_amount: z.coerce.number().min(0).optional().default(0),
    payment_method: z.string().max(50).optional().nullable(),
    cash_box: z.string().max(100).optional().nullable(),
    bank_account: z.string().max(100).optional().nullable(),
    bank_ref: z.string().max(100).optional().nullable(),
    pos_terminal: z.string().max(100).optional().nullable(),
    pos_ref: z.string().max(100).optional().nullable(),
}).passthrough();

const orderInvoice = z.object({
    type: z.enum(['proforma', 'final']).optional().default('proforma'),
    items: z.array(z.object({
        order_item_id: z.string().uuid().optional().nullable(),
        variant_id: z.string().uuid().optional().nullable(),
        quantity: z.coerce.number().positive().optional(),
        unit_price: z.coerce.number().min(0).optional(),
    }).passthrough()).optional(),
    additional_expenses: z.coerce.number().min(0).optional().default(0),
    notes: z.string().max(2000).optional().default(''),
}).passthrough();

const orderPayment = z.object({
    amount: z.coerce.number().positive('Amount must be positive'),
    payment_method: z.string().max(50).optional().default('cash'),
    notes: z.string().max(2000).optional().default(''),
    cash_box: z.string().max(100).optional().nullable(),
    bank_account: z.string().max(100).optional().nullable(),
    bank_ref: z.string().max(100).optional().nullable(),
    pos_terminal: z.string().max(100).optional().nullable(),
    pos_ref: z.string().max(100).optional().nullable(),
}).passthrough();

// =============================================================================
// Client Update
// =============================================================================

const clientUpdate = z.object({
    name: z.string().min(1).max(255).optional(),
    parent_id: z.string().uuid().optional().nullable(),
    contact_person: z.string().max(255).optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
    email: z.string().email().max(255).optional().nullable(),
    address: z.string().max(500).optional().nullable(),
    city: z.string().max(100).optional().nullable(),
    commercial_register: z.string().max(100).optional().nullable(),
    tax_id: z.string().max(50).optional().nullable(),
    credit_limit: z.coerce.number().min(0).optional(),
    status: z.enum(['active', 'inactive']).optional(),
}).passthrough();

// =============================================================================
// Warehouse schemas
// =============================================================================

const warehouseCreate = z.object({
    name: z.string().min(1, 'Warehouse name is required').max(255),
    location: z.string().max(500).optional().nullable(),
    address: z.string().max(500).optional().nullable(),
    client_id: z.string().uuid().optional().nullable(),
    status: z.enum(['active', 'inactive']).optional().default('active'),
}).passthrough();

const warehouseUpdate = z.object({
    name: z.string().min(1).max(255).optional(),
    location: z.string().max(500).optional().nullable(),
    address: z.string().max(500).optional().nullable(),
    client_id: z.string().uuid().optional().nullable(),
    status: z.enum(['active', 'inactive']).optional(),
}).passthrough();

// =============================================================================
// Stock Adjust
// =============================================================================

const stockAdjust = z.object({
    stock_id: z.string().uuid().optional().nullable(),
    adjustment: z.coerce.number().optional(),
    reason: z.string().max(500).optional().nullable(),
    items: z.array(z.object({
        warehouse_id: z.string().uuid().optional(),
        variant_id: z.string().uuid().optional(),
        quantity: z.coerce.number().optional(),
        adjustment_type: z.string().max(50).optional(),
        client_id: z.string().uuid().optional().nullable(),
    }).passthrough()).optional(),
}).passthrough();

// =============================================================================
// VMI Dispatch
// =============================================================================

const vmiDispatch = z.object({
    stock_client_id: z.string().uuid(),
    recipient_id: z.string().uuid(),
    warehouse_id: z.string().uuid(),
    items: z.array(z.object({
        variant_id: z.string().uuid(),
        quantity: z.coerce.number().int().positive(),
    }).passthrough()).min(1, 'At least one item is required'),
    with_invoice: z.boolean().optional().default(false),
    notes: z.string().max(2000).optional().default(''),
    delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
}).passthrough();

// =============================================================================
// Account schemas
// =============================================================================

const accountCreate = z.object({
    code: z.string().min(1).max(50),
    name: z.string().min(1).max(255),
    account_type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
    parent_id: z.string().uuid().optional().nullable(),
}).passthrough();

const accountUpdate = z.object({
    name: z.string().min(1).max(255).optional(),
    parent_id: z.string().uuid().optional().nullable(),
    is_active: z.boolean().optional(),
}).passthrough();

// =============================================================================
// User Permissions Update
// =============================================================================

const userPermissionsUpdate = z.object({
    permissions: z.record(z.any()),
}).passthrough();

// =============================================================================
// Order Notes & Release
// =============================================================================

const orderNote = z.object({
    message: z.string().min(1, 'Message is required').max(2000),
}).passthrough();

const orderRelease = z.object({
    warehouse_id: z.string().uuid().optional().nullable(),
}).passthrough();

// =============================================================================
// Invoice Share & Status
// =============================================================================

const invoiceShare = z.object({
    expires_days: z.coerce.number().int().min(1).max(365).optional().default(30),
}).passthrough();

const invoiceStatusUpdate = z.object({
    status: z.enum(['issued', 'paid', 'overdue', 'cancelled', 'archived']),
}).passthrough();

// =============================================================================
// Forecast
// =============================================================================

const forecastQuery = z.object({
    periods: z.coerce.number().int().min(1).max(365).optional().default(30),
}).passthrough();

// =============================================================================
// Pantone Colors
// =============================================================================

const pantoneColorCreate = z.object({
    client_id: z.string().uuid(),
    color_code: z.string().min(1).max(50),
    color_name: z.string().max(100).optional().nullable(),
    hex_value: z.string().max(20).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    sort_order: z.coerce.number().int().optional().default(0),
}).passthrough();

const pantoneColorUpdate = z.object({
    color_code: z.string().min(1).max(50).optional(),
    color_name: z.string().max(100).optional().nullable(),
    hex_value: z.string().max(20).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    sort_order: z.coerce.number().int().optional(),
}).passthrough();

// =============================================================================
// Dashboard Pending Pricing
// =============================================================================

const pendingPricingUpdate = z.object({
    items: z.array(z.object({
        id: z.string().uuid(),
        unit_price: z.coerce.number().min(0),
    }).passthrough()).min(1, 'At least one item is required'),
    pricing_notes: z.string().max(2000).optional().nullable(),
}).passthrough();

// =============================================================================
// Manufacturer Order Finalize
// =============================================================================

const moFinalize = z.object({
    tax_rate: z.coerce.number().min(0).max(1).optional().nullable(),
}).passthrough();

module.exports = {
    idParam,
    loginBody,
    paginationQuery,
    clientCreate,
    orderCreate,
    invoiceCreate,
    receiptVoucherCreate,
    productCreate,
    productUpdate,
    variantCreate,
    variantUpdate,
    categoryCreate,
    categoryUpdate,
    unitCreate,
    unitUpdate,
    deliveryNoteCreate,
    deliveryNoteDispatch,
    manufacturerOrderCreate,
    manufacturerOrderStatusUpdate,
    manufacturerOrderUpdate,
    manufacturerOrderReceive,
    manufacturerOrderPricing,
    paymentVoucherCreate,
    voucherCancel,
    journalEntryCreate,
    taskCreate,
    taskUpdate,
    subtaskCreate,
    subtaskUpdate,
    taskCommentCreate,
    userCreate,
    userUpdate,
    roleCreate,
    roleUpdate,
    supplierCreate,
    supplierUpdate,
    receivingVoucherCreate,
    purchaseInvoiceCreate,
    purchaseReturnCreate,
    termsCreate,
    termsUpdate,
    orderUpdate,
    orderStatusUpdate,
    orderConvertToProduction,
    orderInvoice,
    orderPayment,
    clientUpdate,
    warehouseCreate,
    warehouseUpdate,
    stockAdjust,
    vmiDispatch,
    accountCreate,
    accountUpdate,
    userPermissionsUpdate,
    orderNote,
    orderRelease,
    invoiceShare,
    invoiceStatusUpdate,
    forecastQuery,
    pantoneColorCreate,
    pantoneColorUpdate,
    pendingPricingUpdate,
    moFinalize,
    validateBody,
    validateQuery,
};
