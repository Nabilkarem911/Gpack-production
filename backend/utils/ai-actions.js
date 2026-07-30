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

    // ── 5. bulkUpdatePrices ─────────────────────────────────────────────────
    {
        type: 'bulk_update_prices',
        description: 'تطبيق نسبة زيادة/نقص على أسعار فئة منتجات كاملة',
        async propose(args, user) {
            const { category, percentage, direction } = args;

            if (!category) {
                return { valid: false, error: 'اسم الفئة مطلوب' };
            }
            const pct = parseFloat(percentage);
            if (!pct || pct <= 0 || pct > 100) {
                return { valid: false, error: 'النسبة يجب أن تكون بين 1 و 100' };
            }
            const dir = direction || 'increase';

            const variantsRes = await db.query(
                `SELECT pv.id, pv.sku, pv.selling_price, pv.cost_price, p.name, cat.name as category
                 FROM product_variants pv
                 JOIN products p ON p.id = pv.product_id
                 LEFT JOIN categories cat ON cat.id = p.category_id
                 WHERE cat.name ILIKE $1 AND pv.status = 'active'
                 ORDER BY p.name
                 LIMIT 50`,
                [`%${category}%`]
            );

            if (variantsRes.rows.length === 0) {
                return { valid: false, error: `لم يتم العثور على منتجات في فئة "${category}"` };
            }

            const affected = variantsRes.rows.map(v => {
                const oldPrice = parseFloat(v.selling_price || 0);
                const multiplier = dir === 'increase' ? (1 + pct / 100) : (1 - pct / 100);
                const newPrice = Math.round(oldPrice * multiplier * 100) / 100;
                return {
                    variant_id: v.id,
                    sku: v.sku,
                    product_name: v.name,
                    old_price: oldPrice,
                    new_price: newPrice,
                };
            });

            return {
                valid: true,
                summary: {
                    action_type: 'bulk_update_prices',
                    category,
                    percentage: pct,
                    direction: dir,
                    affected_count: affected.length,
                    affected_items: affected,
                },
            };
        },

        async execute(proposal, user) {
            const { affected_items, percentage, direction } = proposal;
            const multiplier = direction === 'increase' ? (1 + percentage / 100) : (1 - percentage / 100);

            const result = await db.withTransaction(async (client) => {
                let updated = 0;
                for (const item of affected_items) {
                    const newPrice = Math.round(parseFloat(item.old_price) * multiplier * 100) / 100;
                    await client.query(
                        `UPDATE product_variants SET selling_price = $1, updated_at = NOW() WHERE id = $2`,
                        [newPrice, item.variant_id]
                    );
                    updated++;
                }
                return { updated_count: updated, category: proposal.category, percentage, direction };
            });

            return result;
        },
    },

    // ── 6. bulkCreateReorders ───────────────────────────────────────────────
    {
        type: 'bulk_create_reorders',
        description: 'إنشاء أوامر شراء للأصناف منخفضة المخزون',
        async propose(args, user) {
            const { supplier_name, max_items } = args;

            // Find supplier
            let supplier = null;
            if (supplier_name) {
                const supplierRes = await db.query(
                    `SELECT id, company_name FROM suppliers WHERE company_name ILIKE $1 LIMIT 1`,
                    [`%${supplier_name}%`]
                );
                if (supplierRes.rows.length === 0) {
                    return { valid: false, error: `لم يتم العثور على مورد باسم "${supplier_name}"` };
                }
                supplier = supplierRes.rows[0];
            }

            // Find low-stock items
            const lowStockRes = await db.query(
                `SELECT pv.id, pv.sku, pv.selling_price, pv.cost_price,
                        p.name, pv.size_name,
                        COALESCE(SUM(ws.quantity), 0) as current_stock,
                        COALESCE(pv.min_stock_level, 0) as reorder_point,
                        COALESCE(pv.max_stock_level, 500) as max_stock
                 FROM product_variants pv
                 JOIN products p ON p.id = pv.product_id
                 LEFT JOIN warehouse_stock ws ON ws.variant_id = pv.id
                 WHERE pv.status = 'active'
                 GROUP BY pv.id, p.name
                 HAVING COALESCE(SUM(ws.quantity), 0) < COALESCE(pv.min_stock_level, 0)
                 ORDER BY COALESCE(SUM(ws.quantity), 0) ASC
                 LIMIT $1`,
                [parseInt(max_items) || 20]
            );

            if (lowStockRes.rows.length === 0) {
                return { valid: false, error: 'لا توجد أصناف منخفضة المخزون حالياً' };
            }

            const items = lowStockRes.rows.map(r => ({
                variant_id: r.id,
                product_name: r.name,
                size_name: r.size_name,
                sku: r.sku,
                current_stock: parseInt(r.current_stock),
                reorder_qty: parseInt(r.max_stock) - parseInt(r.current_stock),
                unit_cost: parseFloat(r.cost_price || 0),
                line_total: Math.round((parseInt(r.max_stock) - parseInt(r.current_stock)) * parseFloat(r.cost_price || 0) * 100) / 100,
            }));

            const grandTotal = items.reduce((sum, i) => sum + i.line_total, 0);

            return {
                valid: true,
                summary: {
                    action_type: 'bulk_create_reorders',
                    supplier_id: supplier ? supplier.id : null,
                    supplier_name: supplier ? supplier.company_name : 'غير محدد',
                    items,
                    item_count: items.length,
                    grand_total: Math.round(grandTotal * 100) / 100,
                },
            };
        },

        async execute(proposal, user) {
            const { supplier_id, items } = proposal;

            const result = await db.withTransaction(async (client) => {
                // Create a purchase invoice as draft
                const piRes = await client.query(
                    `INSERT INTO purchase_invoices
                        (supplier_id, status, created_by)
                     VALUES ($1, 'unpaid', $2)
                     RETURNING id, invoice_number`,
                    [supplier_id, user.id]
                );
                const pi = piRes.rows[0];

                // Add items to purchase invoice
                for (const item of items) {
                    await client.query(
                        `INSERT INTO purchase_invoice_items
                            (purchase_invoice_id, variant_id, quantity, unit_cost, total_cost, product_name)
                         VALUES ($1, $2, $3, $4, $5, $6)`,
                        [pi.id, item.variant_id, item.reorder_qty, item.unit_cost,
                         Math.round(item.reorder_qty * item.unit_cost * 100) / 100, item.product_name]
                    );
                }

                return {
                    purchase_invoice_id: pi.id,
                    invoice_number: pi.invoice_number,
                    item_count: items.length,
                    status: 'unpaid',
                };
            });

            return result;
        },
    },

    // ── 7. createClient ──────────────────────────────────────────────────────
    {
        type: 'create_client',
        description: 'إنشاء عميل جديد في النظام',
        async propose(args, user) {
            const { name, phone, email, address, tax_id, contact_person, city, commercial_register, credit_limit, parent_client_name } = args;

            if (!name) {
                return { valid: false, error: 'اسم العميل مطلوب' };
            }

            // Check if client already exists
            const existingRes = await db.query(
                `SELECT id, name FROM clients WHERE name ILIKE $1 AND status = 'active' LIMIT 1`,
                [`%${name}%`]
            );
            if (existingRes.rows.length > 0) {
                return { valid: false, error: `يوجد عميل بالاسم "${existingRes.rows[0].name}" بالفعل` };
            }

            // If parent_client_name provided, find parent (for franchise branch)
            let parentId = null;
            let parentName = null;
            if (parent_client_name) {
                const parentRes = await db.query(
                    `SELECT id, name FROM clients WHERE name ILIKE $1 AND status = 'active' LIMIT 1`,
                    [`%${parent_client_name}%`]
                );
                if (parentRes.rows.length === 0) {
                    return { valid: false, error: `لم يتم العثور على العميل الأصلي "${parent_client_name}"` };
                }
                parentId = parentRes.rows[0].id;
                parentName = parentRes.rows[0].name;
            }

            return {
                valid: true,
                summary: {
                    action_type: 'create_client',
                    name,
                    phone: phone || null,
                    email: email || null,
                    address: address || null,
                    tax_id: tax_id || null,
                    contact_person: contact_person || null,
                    city: city || null,
                    commercial_register: commercial_register || null,
                    credit_limit: parseFloat(credit_limit) || 0,
                    parent_id: parentId,
                    parent_name: parentName,
                    is_branch: !!parentId,
                },
            };
        },

        async execute(proposal, user) {
            const { name, phone, email, address, tax_id, contact_person, city, commercial_register, credit_limit, parent_id } = proposal;

            const result = await db.withTransaction(async (client) => {
                const clientRes = await client.query(
                    `INSERT INTO clients
                        (name, phone, email, address, tax_id, contact_person, city, commercial_register, credit_limit, parent_id, status, created_by)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11)
                     RETURNING id, name`,
                    [name, phone, email, address, tax_id, contact_person, city, commercial_register, credit_limit, parent_id, user.id]
                );
                return {
                    client_id: clientRes.rows[0].id,
                    client_name: clientRes.rows[0].name,
                    is_branch: !!parent_id,
                };
            });
            return result;
        },
    },

    // ── 8. updateOrderStatus ─────────────────────────────────────────────────
    {
        type: 'update_order_status',
        description: 'تحديث حالة طلب موجود (تأكيد، تحويل للإنتاج، تسليم، إلخ)',
        async propose(args, user) {
            const { order_number, new_status } = args;

            if (!order_number) {
                return { valid: false, error: 'رقم الطلب مطلوب' };
            }
            const validStatuses = ['quote', 'confirmed', 'production', 'processing', 'completed', 'delivered', 'cancelled'];
            if (!validStatuses.includes(new_status)) {
                return { valid: false, error: `الحالة "${new_status}" غير صحيحة. الحالات المتاحة: ${validStatuses.join(', ')}` };
            }

            const orderRes = await db.query(
                `SELECT o.id, o.order_number, o.status, c.name as client_name
                 FROM orders o
                 LEFT JOIN clients c ON c.id = o.client_id
                 WHERE o.order_number = $1`,
                [parseInt(order_number)]
            );
            if (orderRes.rows.length === 0) {
                return { valid: false, error: `لم يتم العثور على طلب رقم ${order_number}` };
            }

            const order = orderRes.rows[0];
            if (order.status === new_status) {
                return { valid: false, error: `الطلب رقم ${order_number} بالفعل في الحالة "${new_status}"` };
            }

            return {
                valid: true,
                summary: {
                    action_type: 'update_order_status',
                    order_id: order.id,
                    order_number: order.order_number,
                    client_name: order.client_name,
                    current_status: order.status,
                    new_status: new_status,
                },
            };
        },

        async execute(proposal, user) {
            const { order_id, new_status } = proposal;
            const result = await db.withTransaction(async (client) => {
                await client.query(
                    `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
                    [new_status, order_id]
                );
                return { order_id, new_status };
            });
            return result;
        },
    },

    // ── 9. createTask ────────────────────────────────────────────────────────
    {
        type: 'create_task',
        description: 'إنشاء مهمة جديدة وتعيينها لمستخدم',
        async propose(args, user) {
            const { title, description, assigned_to_name, priority, due_date } = args;

            if (!title) {
                return { valid: false, error: 'عنوان المهمة مطلوب' };
            }

            let assignedTo = null;
            let assignedToName = null;
            if (assigned_to_name) {
                const userRes = await db.query(
                    `SELECT id, name FROM users WHERE name ILIKE $1 AND status = 'active' LIMIT 1`,
                    [`%${assigned_to_name}%`]
                );
                if (userRes.rows.length === 0) {
                    return { valid: false, error: `لم يتم العثور على مستخدم بالاسم "${assigned_to_name}"` };
                }
                assignedTo = userRes.rows[0].id;
                assignedToName = userRes.rows[0].name;
            }

            const validPriorities = ['low', 'medium', 'high', 'urgent'];
            const taskPriority = validPriorities.includes(priority) ? priority : 'medium';

            return {
                valid: true,
                summary: {
                    action_type: 'create_task',
                    title,
                    description: description || null,
                    assigned_to: assignedTo,
                    assigned_to_name: assignedToName || 'غير معين',
                    priority: taskPriority,
                    due_date: due_date || null,
                },
            };
        },

        async execute(proposal, user) {
            const { title, description, assigned_to, priority, due_date } = proposal;
            const result = await db.withTransaction(async (client) => {
                const taskRes = await client.query(
                    `INSERT INTO tasks
                        (title, description, assigned_to, priority, due_date, status, created_by)
                     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
                     RETURNING id, title`,
                    [title, description, assigned_to, priority, due_date, user.id]
                );
                return { task_id: taskRes.rows[0].id, title: taskRes.rows[0].title };
            });
            return result;
        },
    },

];
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
