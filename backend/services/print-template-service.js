'use strict';

async function ensurePrintTemplate(client, variantId) {
    if (!variantId) return null;

    const inserted = await client.query(
        `INSERT INTO print_templates (variant_id)
         VALUES ($1)
         ON CONFLICT (variant_id) DO NOTHING
         RETURNING id, variant_id, template_code`,
        [variantId]
    );

    if (inserted.rows.length > 0) return inserted.rows[0];

    const existing = await client.query(
        `SELECT id, variant_id, template_code
         FROM print_templates
         WHERE variant_id = $1`,
        [variantId]
    );
    return existing.rows[0] || null;
}

async function ensurePrintTemplateForOrderItem(client, orderItemId) {
    const result = await client.query(
        'SELECT variant_id FROM order_items WHERE id = $1',
        [orderItemId]
    );
    return ensurePrintTemplate(client, result.rows[0]?.variant_id);
}

module.exports = { ensurePrintTemplate, ensurePrintTemplateForOrderItem };
