'use strict';

// =============================================================================
// G.PACK 2.0 — Direct Receipt / VMI Production Order Service
// Transaction-aware helpers. The caller owns BEGIN/COMMIT/ROLLBACK.
// =============================================================================

const ORDER_STATUS = 'production';

function serviceError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function getSingleClientId(items) {
    const clientIds = [...new Set(items.map(item => item.client_id).filter(Boolean))];
    if (clientIds.length !== 1) {
        throw serviceError('يجب تحديد نفس العميل لكل أصناف الاستلام قبل إنشاء أمر التشغيل.');
    }
    return clientIds[0];
}

async function createProductionOrderFromReceipt(client, { receiptId, receiptNumber, items, userId }) {
    if (!receiptId || !Array.isArray(items) || items.length === 0) {
        throw serviceError('بيانات الاستلام غير مكتملة لإنشاء أمر التشغيل.');
    }

    const existing = await client.query(
        `SELECT production_order_id
         FROM direct_receipts
         WHERE id = $1
         FOR UPDATE`,
        [receiptId]
    );
    if (existing.rowCount === 0) {
        throw serviceError('الاستلام المؤقت غير موجود.', 404);
    }
    if (existing.rows[0].production_order_id) {
        const orderRes = await client.query(
            `SELECT id, order_number, status
             FROM orders
             WHERE id = $1`,
            [existing.rows[0].production_order_id]
        );
        if (orderRes.rowCount > 0) return orderRes.rows[0];
        throw serviceError('يوجد ربط بأمر تشغيل غير موجود.', 409);
    }

    const clientId = getSingleClientId(items);
    const orderRes = await client.query(
        `INSERT INTO orders (client_id, status, order_number, internal_notes)
         VALUES ($1, $2, nextval('order_number_seq'), $3)
         RETURNING id, order_number, client_id, status`,
        [clientId, ORDER_STATUS, `منشأ من الاستلام المؤقت #${receiptNumber || receiptId}`]
    );
    const order = orderRes.rows[0];
    order.items = [];

    for (const item of items) {
        const quantity = Number(item.confirmed_quantity);
        if (!item.variant_id || !Number.isFinite(quantity) || quantity <= 0) {
            throw serviceError(`بيانات صنف غير صالحة في الاستلام المؤقت #${receiptNumber || receiptId}.`);
        }
        const itemRes = await client.query(
            `INSERT INTO order_items
                (order_id, variant_id, quantity, unit_price, design_status, notes)
             VALUES ($1, $2, $3, 0, 'new', $4)
             RETURNING id, variant_id, quantity, unit_price`,
            [order.id, item.variant_id, quantity, item.notes || null]
        );
        order.items.push(itemRes.rows[0]);
    }

    await client.query(
        `UPDATE direct_receipts
         SET production_order_id = $1, converted_by = COALESCE(converted_by, $2), updated_at = NOW()
         WHERE id = $3 AND production_order_id IS NULL`,
        [order.id, userId || null, receiptId]
    );

    return order;
}

async function assertNoDownstreamActivity(client, orderId) {
    const payments = await client.query(
        `SELECT 1 FROM client_transactions WHERE order_id = $1 LIMIT 1`,
        [orderId]
    );
    if (payments.rowCount > 0) throw serviceError('لا يمكن التراجع: توجد دفعة أو حركة مالية على العميل.');

    const invoices = await client.query(
        `SELECT 1 FROM invoices WHERE order_id = $1 LIMIT 1`,
        [orderId]
    );
    if (invoices.rowCount > 0) throw serviceError('لا يمكن التراجع: توجد فاتورة مبيعات مرتبطة بالأمر.');

    const deliveries = await client.query(
        `SELECT 1 FROM delivery_notes WHERE order_id = $1 LIMIT 1`,
        [orderId]
    );
    if (deliveries.rowCount > 0) throw serviceError('لا يمكن التراجع: يوجد سند تسليم مرتبط بالأمر.');

    const released = await client.query(
        `SELECT 1 FROM order_items
         WHERE order_id = $1
           AND (COALESCE(released_qty, 0) > 0 OR COALESCE(delivered_qty, 0) > 0)
         LIMIT 1`,
        [orderId]
    );
    if (released.rowCount > 0) throw serviceError('لا يمكن التراجع: تم صرف أو تسليم جزء من أصناف الأمر.');
}

async function revertDirectReceiptToReview(client, { receiptId, userId }) {
    const receiptRes = await client.query(
        `SELECT dr.id, dr.receipt_number, dr.status, dr.warehouse_id,
                dr.purchase_invoice_id, dr.production_order_id
         FROM direct_receipts dr
         WHERE dr.id = $1
         FOR UPDATE`,
        [receiptId]
    );
    if (receiptRes.rowCount === 0) throw serviceError('الاستلام المؤقت غير موجود.', 404);

    const receipt = receiptRes.rows[0];
    if (receipt.status !== 'converted') {
        throw serviceError('لا يمكن التراجع إلا عن استلام تم اعتماده.');
    }
    if (!receipt.production_order_id || !receipt.purchase_invoice_id) {
        throw serviceError('الاستلام لا يحتوي على أمر تشغيل وفاتورة مشتريات مرتبطين.', 409);
    }

    const orderRes = await client.query(
        `SELECT id, status FROM orders WHERE id = $1 FOR UPDATE`,
        [receipt.production_order_id]
    );
    if (orderRes.rowCount === 0) throw serviceError('أمر التشغيل المرتبط غير موجود.', 409);
    await assertNoDownstreamActivity(client, receipt.production_order_id);

    const purchaseRes = await client.query(
        `SELECT id, status, paid_amount
         FROM purchase_invoices
         WHERE id = $1
         FOR UPDATE`,
        [receipt.purchase_invoice_id]
    );
    if (purchaseRes.rowCount === 0) throw serviceError('فاتورة المشتريات المرتبطة غير موجودة.', 409);
    if (purchaseRes.rows[0].status !== 'draft' || Number(purchaseRes.rows[0].paid_amount || 0) !== 0) {
        throw serviceError('لا يمكن التراجع: فاتورة المشتريات ليست مسودة أو تم دفعها.');
    }

    const movements = await client.query(
        `SELECT id, stock_id, variant_id, quantity, warehouse_to, client_id, created_at
         FROM inventory_transactions
         WHERE reference_type = 'direct_receipt'
           AND reference_id = $1
           AND transaction_type = 'receipt'
         FOR UPDATE`,
        [receiptId]
    );
    if (movements.rowCount === 0) throw serviceError('لم يتم العثور على حركة مخزون للاستلام.', 409);

    for (const movement of movements.rows) {
        const quantity = Number(movement.quantity);
        const warehouseId = movement.warehouse_to || receipt.warehouse_id;
        const stockRes = await client.query(
            `SELECT id, quantity, reserved_qty
             FROM warehouse_stock
             WHERE warehouse_id = $1
               AND variant_id = $2
               AND client_id IS NOT DISTINCT FROM $3
             FOR UPDATE`,
            [warehouseId, movement.variant_id, movement.client_id]
        );
        if (stockRes.rowCount === 0 || Number(stockRes.rows[0].quantity) < quantity) {
            throw serviceError('لا يمكن التراجع: كمية المخزون الحالية أقل من الكمية المطلوب عكسها.');
        }
        if (Number(stockRes.rows[0].reserved_qty || 0) > 0) {
            throw serviceError('لا يمكن التراجع: توجد كمية محجوزة من المخزون.');
        }

        const consumptionRes = await client.query(
            `SELECT 1 FROM inventory_transactions
             WHERE stock_id = $1
               AND transaction_type IN ('dispense', 'issue', 'consume')
               AND created_at >= $2
             LIMIT 1`,
            [stockRes.rows[0].id, movement.created_at]
        );
        if (consumptionRes.rowCount > 0) {
            throw serviceError('لا يمكن التراجع: تم صرف أو استهلاك جزء من المخزون.');
        }

        await client.query(
            `UPDATE warehouse_stock
             SET quantity = quantity - $1, last_updated = NOW()
             WHERE id = $2`,
            [quantity, stockRes.rows[0].id]
        );
        await client.query(
            `INSERT INTO inventory_transactions
                (stock_id, variant_id, transaction_type, quantity,
                 warehouse_from, client_id, reference_type, reference_id, notes, created_by)
             VALUES ($1, $2, 'reversal', $3, $4, $5, 'direct_receipt', $6, $7, $8)`,
            [stockRes.rows[0].id, movement.variant_id, quantity, warehouseId, movement.client_id,
             receiptId, `عكس استلام مؤقت #${receipt.receipt_number}`, userId || null]
        );
    }

    await client.query(
        `UPDATE purchase_invoices
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND status = 'draft'`,
        [receipt.purchase_invoice_id]
    );
    await client.query(
        `UPDATE orders
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND status NOT IN ('cancelled', 'archived')`,
        [receipt.production_order_id]
    );
    await client.query(
        `UPDATE direct_receipts
         SET status = 'pending_review', production_order_id = NULL,
             purchase_invoice_id = NULL, converted_at = NULL,
             converted_by = NULL, reverted_at = NOW(), reverted_by = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [userId || null, receiptId]
    );

    return {
        receipt_id: receiptId,
        order_id: receipt.production_order_id,
        purchase_invoice_id: receipt.purchase_invoice_id,
    };
}

module.exports = {
    createProductionOrderFromReceipt,
    revertDirectReceiptToReview,
};
