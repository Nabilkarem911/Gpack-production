'use strict';

// =============================================================================
// G.PACK 2.0 — AI Actions (ai-actions.js)
// WRITE functions that the AI can propose. Each function has two phases:
//   1. propose() — validates inputs, returns a human-readable summary (no DB writes)
//   2. execute() — runs the action in a transaction (only after user confirmation)
// All actions are logged in ai_action_log for audit.
// Role-based: only managers/admins can execute write actions.
// =============================================================================

const db = require('../db');
const { getVatRate } = require('./settings');

// =============================================================================
// Action Definitions
// Each action has: type, propose(args, user), execute(args, user)
// =============================================================================

const AI_ACTIONS = [

    // ── 1. createQuote ──────────────────────────────────────────────────────
    {
        type: 'create_quote',
        description: 'إنشاء عرض سعر جديد لعميل بأصناف محددة',
        async propose(args, user) {
            const { client_name, items } = args;

            if (!client_name) {
                return { valid: false, error: 'اسم العميل مطلوب' };
            }
            if (!items || !Array.isArray(items) || items.length === 0) {
                return { valid: false, error: 'يجب إضافة صنف واحد على الأقل' };
            }

            // Find client by name (fuzzy)
            const clientRes = await db.query(
                `SELECT id, name FROM clients
                 WHERE name ILIKE $1 AND status = 'active'
                 LIMIT 5`,
                [`%${client_name}%`]
            );

            if (clientRes.rows.length === 0) {
                return { valid: false, error: `لم يتم العثور على عميل بالاسم "${client_name}"` };
            }

            const client = clientRes.rows[0];
            const matchedItems = [];

            for (const item of items) {
                const { product_name, quantity } = item;
                if (!product_name || !quantity) {
                    return { valid: false, error: 'كل صنف يحتاج اسم منتج وكمية' };
                }

                const variantRes = await db.query(
                    `SELECT pv.id, pv.sku, pv.selling_price, pv.cost_price,
                            p.name, pv.size_name
                     FROM product_variants pv
                     JOIN products p ON p.id = pv.product_id
                     WHERE p.name ILIKE $1 AND pv.status = 'active'
                     LIMIT 5`,
                    [`%${product_name}%`]
                );

                if (variantRes.rows.length === 0) {
                    matchedItems.push({
                        product_name,
                        quantity,
                        found: false,
                        error: `لم يتم العثور على المنتج "${product_name}"`,
                    });
                } else {
                    const v = variantRes.rows[0];
                    matchedItems.push({
                        variant_id: v.id,
                        product_name: v.name,
                        size_name: v.size_name,
                        sku: v.sku,
                        quantity: parseFloat(quantity),
                        unit_price: parseFloat(v.selling_price || 0),
                        line_total: Math.round(parseFloat(quantity) * parseFloat(v.selling_price || 0) * 100) / 100,
                        found: true,
                    });
                }
            }

            const validItems = matchedItems.filter(i => i.found);
            if (validItems.length === 0) {
                return { valid: false, error: 'لم يتم العثور على أي من المنتجات المطلوبة' };
            }

            const subtotal = validItems.reduce((sum, i) => sum + i.line_total, 0);
            const vatRate = await getVatRate();
            const taxAmount = Math.round(subtotal * vatRate * 100) / 100;
            const grandTotal = Math.round((subtotal + taxAmount) * 100) / 100;

            return {
                valid: true,
                summary: {
                    action_type: 'create_quote',
                    client_id: client.id,
                    client_name: client.name,
                    items: validItems,
                    subtotal: Math.round(subtotal * 100) / 100,
                    tax_amount: taxAmount,
                    grand_total: grandTotal,
                    notes: items.find(i => i.notes)?.notes || null,
                },
            };
        },

        async execute(proposal, user) {
            const { client_id, items, notes } = proposal;

            const vatRate = await getVatRate();
            let subtotal = 0;
            const processedItems = items.map(item => {
                const qty = parseFloat(item.quantity);
                const price = parseFloat(item.unit_price) || 0;
                const lineTotal = Math.round(qty * price * 100) / 100;
                subtotal += lineTotal;
                return { ...item, qty, price, lineTotal };
            });
            subtotal = Math.round(subtotal * 100) / 100;
            const taxAmount = Math.round(subtotal * vatRate * 100) / 100;
            const grandTotal = Math.round((subtotal + taxAmount) * 100) / 100;

            const result = await db.withTransaction(async (client) => {
                const orderRes = await client.query(
                    `INSERT INTO orders
                        (client_id, status, pricing_status, subtotal, tax_amount, grand_total,
                         client_notes, created_by)
                     VALUES ($1, 'quote', 'priced', $2, $3, $4, $5, $6)
                     RETURNING id, order_number`,
                    [client_id, subtotal, taxAmount, grandTotal, notes || null, user.id]
                );
                const order = orderRes.rows[0];

                for (const item of processedItems) {
                    await client.query(
                        `INSERT INTO order_items
                            (order_id, variant_id, quantity, unit_price, design_status)
                         VALUES ($1, $2, $3, $4, 'new')`,
                        [order.id, item.variant_id, item.qty, item.price]
                    );
                }

                return {
                    order_id: order.id,
                    order_number: order.order_number,
                    status: 'quote',
                    subtotal,
                    tax_amount: taxAmount,
                    grand_total: grandTotal,
                };
            });

            return result;
        },
    },

    // ── 2. convertQuoteToInvoice ────────────────────────────────────────────
    {
        type: 'convert_quote_to_invoice',
        description: 'تحويل عرض سعر إلى فاتورة',
        async propose(args, user) {
            const { order_number } = args;

            if (!order_number) {
                return { valid: false, error: 'رقم الطلب مطلوب' };
            }

            const orderRes = await db.query(
                `SELECT o.id, o.order_number, o.status, o.grand_total,
                        c.name as client_name
                 FROM orders o
                 LEFT JOIN clients c ON c.id = o.client_id
                 WHERE o.order_number = $1`,
                [parseInt(order_number)]
            );

            if (orderRes.rows.length === 0) {
                return { valid: false, error: `لم يتم العثور على طلب رقم ${order_number}` };
            }

            const order = orderRes.rows[0];
            if (order.status !== 'quote') {
                return { valid: false, error: `الطلب رقم ${order_number} ليس عرض سعر (حالته: ${order.status})` };
            }

            return {
                valid: true,
                summary: {
                    action_type: 'convert_quote_to_invoice',
                    order_id: order.id,
                    order_number: order.order_number,
                    client_name: order.client_name,
                    grand_total: parseFloat(order.grand_total || 0),
                },
            };
        },

        async execute(proposal, user) {
            const { order_id } = proposal;

            const result = await db.withTransaction(async (client) => {
                // Update order status to 'confirmed'
                await client.query(
                    `UPDATE orders SET status = 'confirmed', updated_at = NOW()
                     WHERE id = $1`,
                    [order_id]
                );

                // Get order items for invoice
                const itemsRes = await client.query(
                    `SELECT oi.variant_id, oi.quantity, oi.unit_price
                     FROM order_items oi
                     WHERE oi.order_id = $1`,
                    [order_id]
                );

                const orderRes = await client.query(
                    `SELECT client_id, subtotal, tax_rate, tax_amount, grand_total
                     FROM orders WHERE id = $1`,
                    [order_id]
                );
                const order = orderRes.rows[0];

                // Create invoice
                const invRes = await client.query(
                    `INSERT INTO invoices
                        (order_id, client_id, subtotal, tax_rate, tax_amount, grand_total, status)
                     VALUES ($1, $2, $3, $4, $5, $6, 'issued')
                     RETURNING id, invoice_number`,
                    [order_id, order.client_id, order.subtotal, order.tax_rate,
                     order.tax_amount, order.grand_total]
                );
                const invoice = invRes.rows[0];

                // Create invoice items
                for (const item of itemsRes.rows) {
                    await client.query(
                        `INSERT INTO invoice_items (invoice_id, variant_id, quantity, unit_price)
                         VALUES ($1, $2, $3, $4)`,
                        [invoice.id, item.variant_id, item.quantity, item.unit_price]
                    );
                }

                return {
                    invoice_id: invoice.id,
                    invoice_number: invoice.invoice_number,
                    order_id,
                    status: 'confirmed',
                };
            });

            return result;
        },
    },

    // ── 3. addPayment ───────────────────────────────────────────────────────
    {
        type: 'add_payment',
        description: 'تسجيل دفعة لطلب موجود',
        async propose(args, user) {
            const { order_number, amount, payment_method } = args;

            if (!order_number) {
                return { valid: false, error: 'رقم الطلب مطلوب' };
            }
            const payAmt = parseFloat(amount);
            if (!payAmt || payAmt <= 0) {
                return { valid: false, error: 'المبلغ يجب أن يكون أكبر من صفر' };
            }

            const orderRes = await db.query(
                `SELECT o.id, o.order_number, o.status, o.grand_total, o.paid_amount,
                        c.name as client_name
                 FROM orders o
                 LEFT JOIN clients c ON c.id = o.client_id
                 WHERE o.order_number = $1`,
                [parseInt(order_number)]
            );

            if (orderRes.rows.length === 0) {
                return { valid: false, error: `لم يتم العثور على طلب رقم ${order_number}` };
            }

            const order = orderRes.rows[0];
            if (!['production', 'processing', 'completed'].includes(order.status)) {
                return { valid: false, error: `لا يمكن تسجيل دفعة لطلب بحالة "${order.status}"` };
            }

            const remaining = parseFloat(order.grand_total || 0) - parseFloat(order.paid_amount || 0);
            if (payAmt > remaining) {
                return { valid: false, error: `المبلغ (${payAmt}) أكبر من المتبقي (${remaining})` };
            }

            return {
                valid: true,
                summary: {
                    action_type: 'add_payment',
                    order_id: order.id,
                    order_number: order.order_number,
                    client_name: order.client_name,
                    amount: payAmt,
                    payment_method: payment_method || 'cash',
                    remaining_before: remaining,
                    remaining_after: Math.round((remaining - payAmt) * 100) / 100,
                },
            };
        },

        async execute(proposal, user) {
            const { order_id, amount, payment_method } = proposal;
            const payAmt = parseFloat(amount);

            const result = await db.withTransaction(async (client) => {
                const orderRes = await client.query(
                    `SELECT id, order_number, client_id, grand_total, paid_amount, status
                     FROM orders WHERE id = $1 FOR UPDATE`,
                    [order_id]
                );
                if (orderRes.rows.length === 0) throw new Error('الطلب غير موجود');
                const order = orderRes.rows[0];

                const newPaid = Math.round((parseFloat(order.paid_amount || 0) + payAmt) * 100) / 100;

                await client.query(
                    `UPDATE orders SET paid_amount = $1, updated_at = NOW() WHERE id = $2`,
                    [newPaid, order_id]
                );

                const txRes = await client.query(
                    `INSERT INTO client_transactions
                        (client_id, order_id, type, amount, payment_method, description)
                     VALUES ($1, $2, 'payment', $3, $4, $5)
                     RETURNING id, document_number`,
                    [order.client_id, order_id, payAmt, payment_method || 'cash',
                     'دفعة مسجلة بواسطة المساعد الذكي']
                );

                return {
                    transaction_id: txRes.rows[0].id,
                    document_number: txRes.rows[0].document_number,
                    paid_amount: newPaid,
                    remaining: Math.round((parseFloat(order.grand_total || 0) - newPaid) * 100) / 100,
                };
            });

            return result;
        },
    },

    // ── 4. createProductionOrder ────────────────────────────────────────────
    {
        type: 'create_production_order',
        description: 'إنشاء أمر تشغيل (VMI) لعميل بأصناف محددة',
        async propose(args, user) {
            const { client_name, items, internal_notes } = args;

            if (!client_name) {
                return { valid: false, error: 'اسم العميل مطلوب' };
            }
            if (!items || !Array.isArray(items) || items.length === 0) {
                return { valid: false, error: 'يجب إضافة صنف واحد على الأقل' };
            }

            const clientRes = await db.query(
                `SELECT id, name FROM clients
                 WHERE name ILIKE $1 AND status = 'active'
                 LIMIT 5`,
                [`%${client_name}%`]
            );

            if (clientRes.rows.length === 0) {
                return { valid: false, error: `لم يتم العثور على عميل بالاسم "${client_name}"` };
            }

            const client = clientRes.rows[0];
            const matchedItems = [];

            for (const item of items) {
                const { product_name, quantity } = item;
                if (!product_name || !quantity) {
                    return { valid: false, error: 'كل صنف يحتاج اسم منتج وكمية' };
                }

                const variantRes = await db.query(
                    `SELECT pv.id, pv.sku, p.name, pv.size_name
                     FROM product_variants pv
                     JOIN products p ON p.id = pv.product_id
                     WHERE p.name ILIKE $1 AND pv.status = 'active'
                     LIMIT 5`,
                    [`%${product_name}%`]
                );

                if (variantRes.rows.length === 0) {
                    matchedItems.push({
                        product_name,
                        quantity: parseFloat(quantity),
                        found: false,
                        error: `لم يتم العثور على المنتج "${product_name}"`,
                    });
                } else {
                    const v = variantRes.rows[0];
                    matchedItems.push({
                        variant_id: v.id,
                        product_name: v.name,
                        size_name: v.size_name,
                        sku: v.sku,
                        quantity: parseFloat(quantity),
                        found: true,
                    });
                }
            }

            const validItems = matchedItems.filter(i => i.found);
            if (validItems.length === 0) {
                return { valid: false, error: 'لم يتم العثور على أي من المنتجات المطلوبة' };
            }

            return {
                valid: true,
                summary: {
                    action_type: 'create_production_order',
                    client_id: client.id,
                    client_name: client.name,
                    items: validItems,
                    internal_notes: internal_notes || 'أمر تشغيل بواسطة المساعد الذكي',
                },
            };
        },

        async execute(proposal, user) {
            const { client_id, items, internal_notes } = proposal;

            // VMI RULE: Only insert client_id, status='production', internal_notes.
            // NO financial fields.
            const result = await db.withTransaction(async (client) => {
                const orderRes = await client.query(
                    `INSERT INTO orders
                        (client_id, status, internal_notes, created_by)
                     VALUES ($1, 'production', $2, $3)
                     RETURNING id, order_number`,
                    [client_id, internal_notes || null, user.id]
                );
                const order = orderRes.rows[0];

                for (const item of items) {
                    await client.query(
                        `INSERT INTO order_items
                            (order_id, variant_id, quantity, unit_price, design_status)
                         VALUES ($1, $2, $3, 0, 'new')`,
                        [order.id, item.variant_id, item.quantity]
                    );
                }

                return {
                    order_id: order.id,
                    order_number: order.order_number,
                    status: 'production',
                };
            });

            return result;
        },
    },

];

// =============================================================================
// Map for quick lookup by type
// =============================================================================
const ACTION_MAP = AI_ACTIONS.reduce((map, action) => {
    map[action.type] = action;
    return map;
}, {});

// =============================================================================
// Export
// =============================================================================
module.exports = {
    AI_ACTIONS,
    ACTION_MAP,
};
