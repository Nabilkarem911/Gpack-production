'use strict';

// =============================================================================
// Manufacturer Print PDF Route
// Generates a PDF file for sending to manufacturer/supplier with:
//   - Order details
//   - Item list with quantities
//   - Design images for each item
// =============================================================================

const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authenticate } = require('../middleware/authMiddleware');

const UPLOADS_DIR = path.join(__dirname, '../uploads');

// =============================================================================
// GET /api/manufacturer-orders/:id/print-pdf
// Generates and streams a PDF for the manufacturer order
// =============================================================================
router.get('/:id/print-pdf', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        // ── Fetch manufacturer order with related data ────────────────────────
        const moResult = await db.query(
            `SELECT 
                mo.id,
                mo.mo_number,
                mo.status,
                mo.expected_delivery_date,
                mo.total_amount,
                mo.notes,
                mo.created_at,
                s.name AS supplier_name,
                s.phone AS supplier_phone,
                s.email AS supplier_email,
                o.order_number,
                o.client_id,
                c.name AS client_name
             FROM manufacturer_orders mo
             LEFT JOIN suppliers s ON s.id = mo.manufacturer_id
             LEFT JOIN orders o ON o.id = mo.order_id
             LEFT JOIN clients c ON c.id = o.client_id
             WHERE mo.id = $1`,
            [id]
        );

        if (moResult.rowCount === 0) {
            return res.status(404).json({ error: 'أمر المورد غير موجود' });
        }

        const mo = moResult.rows[0];

        // ── Fetch items with design info ──────────────────────────────────────
        const itemsResult = await db.query(
            `SELECT 
                moi.id,
                moi.mo_quantity,
                moi.unit_cost,
                moi.total_cost,
                moi.production_status,
                oi.design_id,
                oi.design_status,
                pv.size_name,
                pv.sku,
                p.name AS product_name,
                u.abbreviation AS unit_abbr,
                cd.design_name,
                cd.design_number,
                cdf.file_path AS design_thumbnail
             FROM manufacturer_order_items moi
             LEFT JOIN order_items oi ON oi.id = moi.order_item_id
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id
             LEFT JOIN products p ON p.id = pv.product_id
             LEFT JOIN units u ON u.id = pv.unit_id
             LEFT JOIN client_designs cd ON cd.id = oi.design_id
             LEFT JOIN client_design_files cdf ON cdf.design_id = cd.id AND cdf.file_type = 'thumbnail'
             WHERE moi.manufacturer_order_id = $1
             ORDER BY moi.id ASC`,
            [id]
        );

        const items = itemsResult.rows;

        // ── Generate PDF ──────────────────────────────────────────────────────
        const doc = new PDFDocument({
            size: 'A4',
            margin: 40,
            info: {
                Title: `أمر تشغيل #${mo.mo_number}`,
                Author: 'G.PACK System',
            }
        });

        // Set response headers
        const filename = `MO-${mo.mo_number}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        doc.pipe(res);

        // ── Header Section ────────────────────────────────────────────────────
        doc.fontSize(20).font('Helvetica-Bold')
           .text('G.PACK', 40, 40, { align: 'left' });

        doc.fontSize(10).font('Helvetica')
           .text('Production Order / Manufacturer Print', 40, 65);

        doc.moveDown(2);

        // ── Order Info Box ────────────────────────────────────────────────────
        const infoY = doc.y;
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text(`MO #: ${mo.mo_number}`, 40, infoY);
        doc.text(`Order #: ${mo.order_number || '-'}`, 300, infoY);

        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica');
        doc.text(`Supplier: ${mo.supplier_name || '-'}`, 40);
        if (mo.supplier_phone) doc.text(`Phone: ${mo.supplier_phone}`, 40);
        doc.text(`Client: ${mo.client_name || '-'}`, 300, infoY + 18);
        doc.text(`Date: ${mo.created_at ? new Date(mo.created_at).toLocaleDateString('en-GB') : '-'}`, 300);
        if (mo.expected_delivery_date) {
            doc.text(`Expected Delivery: ${new Date(mo.expected_delivery_date).toLocaleDateString('en-GB')}`, 300);
        }

        doc.moveDown(1.5);

        // ── Divider ───────────────────────────────────────────────────────────
        doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke('#e2e8f0');
        doc.moveDown(1);

        // ── Items Table Header ────────────────────────────────────────────────
        const tableTop = doc.y;
        const colDesign = 40;
        const colProduct = 130;
        const colSize = 280;
        const colQty = 370;
        const colCost = 430;
        const colTotal = 490;

        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('Design', colDesign, tableTop);
        doc.text('Product', colProduct, tableTop);
        doc.text('Size', colSize, tableTop);
        doc.text('Qty', colQty, tableTop);
        doc.text('Cost', colCost, tableTop);
        doc.text('Total', colTotal, tableTop);

        doc.moveTo(40, tableTop + 15).lineTo(555, tableTop + 15).stroke('#e2e8f0');

        let rowY = tableTop + 22;

        // ── Items Rows ────────────────────────────────────────────────────────
        for (const item of items) {
            // Check if we need a new page
            if (rowY > 700) {
                doc.addPage();
                rowY = 40;
            }

            const rowHeight = 60; // Height for design thumbnail

            // Design Thumbnail
            if (item.design_thumbnail) {
                const imgPath = path.join(UPLOADS_DIR, item.design_thumbnail.replace('/uploads/', ''));
                if (fs.existsSync(imgPath)) {
                    try {
                        doc.image(imgPath, colDesign, rowY, { width: 50, height: 50, fit: [50, 50] });
                    } catch (imgErr) {
                        console.error('[Print] Image error:', imgErr.message);
                        doc.fontSize(7).font('Helvetica')
                           .text('No image', colDesign, rowY + 20);
                    }
                } else {
                    doc.fontSize(7).font('Helvetica')
                       .text('No file', colDesign, rowY + 20);
                }
            } else {
                doc.fontSize(7).font('Helvetica')
                   .text(item.design_status === 'new' ? 'New Design' : 'Reprint', colDesign, rowY + 20);
            }

            // Product & Size info
            const textY = rowY + 15;
            doc.fontSize(9).font('Helvetica');
            doc.text(item.product_name || '-', colProduct, textY, { width: 140 });
            doc.text(item.size_name || '-', colSize, textY);
            doc.text(String(item.mo_quantity || 0), colQty, textY);
            doc.text(item.unit_cost ? Number(item.unit_cost).toFixed(2) : '-', colCost, textY);
            doc.text(item.total_cost ? Number(item.total_cost).toFixed(2) : '-', colTotal, textY);

            // Design name below product
            if (item.design_name) {
                doc.fontSize(7).font('Helvetica')
                   .fillColor('#6b7280')
                   .text(`Design: ${item.design_name}`, colProduct, textY + 14)
                   .fillColor('#000000');
            }

            rowY += rowHeight + 5;
            doc.moveTo(40, rowY - 5).lineTo(555, rowY - 5).stroke('#f1f5f9');
        }

        // ── Footer / Notes ────────────────────────────────────────────────────
        if (mo.notes) {
            doc.moveDown(2);
            doc.fontSize(9).font('Helvetica-Bold').text('Notes:', 40);
            doc.fontSize(9).font('Helvetica').text(mo.notes, 40);
        }

        // ── Total ─────────────────────────────────────────────────────────────
        doc.moveDown(2);
        doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke('#e2e8f0');
        doc.moveDown(0.5);
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text(`Total: ${mo.total_amount ? Number(mo.total_amount).toFixed(2) : '0.00'} SAR`, 40, doc.y, { align: 'right' });

        // ── System footer ─────────────────────────────────────────────────────
        doc.moveDown(3);
        doc.fontSize(7).font('Helvetica').fillColor('#94a3b8');
        doc.text(`Generated by G.PACK System on ${new Date().toLocaleString('en-GB')}`, 40, doc.y, { align: 'center' });

        doc.end();

    } catch (err) {
        console.error('[ManufacturerPrint] PDF error:', err);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
