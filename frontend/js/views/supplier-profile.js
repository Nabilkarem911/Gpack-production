'use strict';

// =============================================================================
// G.PACK 2.0 - Supplier Profile View Controller
// Handles /views/supplier-profile.html
// Expects window._spSupplierId to be set before navigating to this view.
// =============================================================================

(function () {

    const fmt  = (v) => parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const date = (v) => v ? new Date(v).toLocaleDateString('en-GB') : '—';
    const taxPct = (r) => { const n = parseFloat(r || 0); return (n <= 1 ? n * 100 : n).toFixed(0); };
    const esc  = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const MO_STATUS = {
        pending:    { label: 'معلق',      cls: 'bg-amber-100 text-amber-700' },
        in_progress:{ label: 'قيد التنفيذ',cls: 'bg-blue-100 text-blue-700' },
        completed:  { label: 'مكتمل',     cls: 'bg-emerald-100 text-emerald-700' },
        cancelled:  { label: 'ملغي',      cls: 'bg-red-100 text-red-700' },
        delivered:  { label: 'مُسلَّم',   cls: 'bg-teal-100 text-teal-700' },
    };

    const INV_STATUS = {
        unpaid:         { label: 'غير مدفوعة',  cls: 'bg-red-100 text-red-700' },
        partially_paid: { label: 'مدفوعة جزئياً', cls: 'bg-amber-100 text-amber-700' },
        paid:           { label: 'مدفوعة',       cls: 'bg-emerald-100 text-emerald-700' },
        cancelled:      { label: 'ملغاة',         cls: 'bg-slate-100 text-slate-500' },
        posted:         { label: 'مُرحَّلة',      cls: 'bg-emerald-100 text-emerald-700' },
        draft:          { label: 'مسودة',         cls: 'bg-slate-100 text-slate-500' },
    };

    const VOUCHER_STATUS = {
        posted:    { label: 'مرحّل',  cls: 'bg-emerald-100 text-emerald-700' },
        cancelled: { label: 'ملغي',   cls: 'bg-red-100 text-red-700' },
    };

    const PAY_METHOD = {
        cash: 'نقدي', bank_transfer: 'تحويل بنكي', cheque: 'شيك',
    };

    const TYPE_MAP = {
        manufacturer: 'مصنع',
        vendor:       'مورد',
        both:         'مصنع ومورد',
    };

    function _badge(status, map) {
        const s = map[status] || { label: status || '—', cls: 'bg-slate-100 text-slate-500' };
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${s.cls}">${s.label}</span>`;
    }

    function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
    function _setHTML(id, val) { const el = document.getElementById(id); if (el) el.innerHTML = val; }

    function _emptyRow(cols, msg) {
        return `<tr><td colspan="${cols}" class="py-10 text-center text-slate-400 text-sm">${msg}</td></tr>`;
    }

    // ── Render header ─────────────────────────────────────────────────────────
    function _renderHeader(s) {
        _setText('sp-page-title', s.name);
        _setText('sp-page-sub',   s.city || TYPE_MAP[s.type] || 'مورد');
        _setText('sp-name',       s.name);

        _setHTML('sp-type-badge', `<span class="text-xs font-bold text-slate-300 bg-white/20 px-2 py-0.5 rounded-full">${TYPE_MAP[s.type] || s.type || 'مورد'}</span>`);

        _setHTML('sp-status-badge', s.status === 'active'
            ? `<span class="flex items-center gap-1.5 text-xs font-bold text-emerald-300"><span class="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>نشط</span>`
            : `<span class="flex items-center gap-1.5 text-xs font-bold text-slate-300"><span class="w-2 h-2 rounded-full bg-slate-400 inline-block"></span>غير نشط</span>`
        );

        _setText('sp-contact', s.contact_person || '—');
        _setText('sp-phone',   s.phone          || '—');
        _setText('sp-email',   s.email          || '—');
        _setText('sp-city',    s.city           || '—');
        _setText('sp-cr',      s.commercial_register || '—');
        _setText('sp-tax',     s.tax_id         || '—');
        _setText('sp-terms',   s.payment_terms  || '—');
        _setText('sp-address', s.address        || '—');

        document.getElementById('sp-edit-btn')?.classList.remove('hidden');
    }

    // ── Render stats ──────────────────────────────────────────────────────────
    function _renderStats(s, invoices) {
        _setText('sp-stat-orders',    s.total_orders   || '0');
        _setText('sp-stat-pending',   s.pending_count  || '0');
        _setText('sp-stat-value',     fmt(s.total_value));
        _setText('sp-stat-paid',      fmt(s.total_paid));
        _setText('sp-stat-remaining', fmt(s.total_remaining));
        // Open invoices count from purchase_invoices data
        const openCount = (invoices || []).filter(i => i.status === 'unpaid' || i.status === 'partially_paid').length;
        _setText('sp-stat-open-inv', openCount);
    }

    // ── Render Orders tab ─────────────────────────────────────────────────────
    function _renderOrders(orders) {
        document.getElementById('sp-tab-orders-badge').textContent = orders.length;
        const tbody = document.getElementById('sp-orders-tbody');
        if (!tbody) return;
        if (!orders.length) { tbody.innerHTML = _emptyRow(10, 'لا توجد أوامر تصنيع لهذا المورد'); return; }

        tbody.innerHTML = orders.map(o => {
            const remaining = Math.max(0, parseFloat(o.total_amount || 0) - parseFloat(o.paid_amount || 0));
            return `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3 px-4 font-mono font-bold text-slate-700">${esc(o.mo_number)}</td>
                <td class="py-3 px-4">${_badge(o.status, MO_STATUS)}</td>
                <td class="py-3 px-4 text-slate-500 font-mono hidden sm:table-cell">${o.client_order_number ? '#' + o.client_order_number : '—'}</td>
                <td class="py-3 px-4 text-slate-500 hidden sm:table-cell">${date(o.created_at)}</td>
                <td class="py-3 px-4 text-slate-500 hidden md:table-cell">${date(o.expected_delivery_date)}</td>
                <td class="py-3 px-4 text-slate-500 hidden md:table-cell text-center">${o.item_count || 0}</td>
                <td class="py-3 px-4 font-bold text-slate-800 font-mono">${fmt(o.total_amount)}</td>
                <td class="py-3 px-4 text-emerald-600 font-semibold font-mono hidden md:table-cell">${fmt(o.paid_amount)}</td>
                <td class="py-3 px-4 font-semibold font-mono hidden md:table-cell ${remaining > 0 ? 'text-red-500' : 'text-slate-400'}">${fmt(remaining)}</td>
                <td class="py-3 px-4 text-center hidden sm:table-cell">
                    ${o.has_supplier_invoice
                        ? `<span class="text-xs font-bold text-emerald-600"><i class="fa-solid fa-circle-check"></i></span>`
                        : `<span class="text-xs text-slate-300"><i class="fa-solid fa-circle-xmark"></i></span>`
                    }
                </td>
            </tr>`;
        }).join('');
    }

    // ── Render Invoices tab ───────────────────────────────────────────────────
    function _renderInvoices(invoices) {
        document.getElementById('sp-tab-invoices-badge').textContent = invoices.length;
        const tbody = document.getElementById('sp-invoices-tbody');
        if (!tbody) return;
        if (!invoices.length) { tbody.innerHTML = _emptyRow(9, 'لا توجد فواتير شراء لهذا المورد'); return; }

        tbody.innerHTML = invoices.map(inv => {
            const paidAmt  = parseFloat(inv.paid_amount || 0);
            const total    = parseFloat(inv.grand_total || 0);
            const remaining = Math.max(0, total - paidAmt);
            return `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3 px-4 font-mono font-bold text-slate-700">#${inv.invoice_number}</td>
                <td class="py-3 px-4 text-slate-500 hidden sm:table-cell">${esc(inv.supplier_invoice_ref || '—')}</td>
                <td class="py-3 px-4 text-slate-500 font-mono">${esc(inv.mo_number || '—')}</td>
                <td class="py-3 px-4 text-slate-500 hidden sm:table-cell">${date(inv.invoice_date)}</td>
                <td class="py-3 px-4 font-bold text-slate-800 font-mono">${fmt(total)}</td>
                <td class="py-3 px-4 font-semibold text-emerald-600 font-mono hidden md:table-cell">${fmt(paidAmt)}</td>
                <td class="py-3 px-4 font-semibold font-mono hidden md:table-cell ${remaining > 0 ? 'text-red-500' : 'text-slate-400'}">${fmt(remaining)}</td>
                <td class="py-3 px-4">${_badge(inv.status, INV_STATUS)}</td>
                <td class="py-3 px-4">
                    <button onclick="window.printPurchaseInvoice('${inv.id}')"
                            class="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-lg transition-colors">
                        <i class="fa-solid fa-print"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');
    }

    // ── Render Vouchers tab ───────────────────────────────────────────────────
    function _renderVouchers(vouchers) {
        document.getElementById('sp-tab-vouchers-badge').textContent = vouchers.length;
        const tbody = document.getElementById('sp-vouchers-tbody');
        if (!tbody) return;
        if (!vouchers.length) { tbody.innerHTML = _emptyRow(6, 'لا توجد سندات صرف لهذا المورد'); return; }

        tbody.innerHTML = vouchers.map(v => `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3 px-4 font-mono font-bold text-brand-600">#${v.voucher_number}</td>
                <td class="py-3 px-4 text-slate-500 hidden sm:table-cell">${date(v.voucher_date)}</td>
                <td class="py-3 px-4 font-bold text-red-600 font-mono">${fmt(v.total_amount)}</td>
                <td class="py-3 px-4 text-slate-500 text-xs hidden md:table-cell max-w-xs truncate">${esc(v.description || '—')}</td>
                <td class="py-3 px-4">${_badge(v.status, VOUCHER_STATUS)}</td>
            </tr>`
        ).join('');
    }

    // ── Print Purchase Invoice ────────────────────────────────────────────────
    window.printPurchaseInvoice = async function(invoiceId) {
        try {
            const res  = await window.apiFetch(`/api/suppliers/purchase-invoices/${invoiceId}`);
            const data = res?.data;
            if (!data) throw new Error('لم يتم إيجاد الفاتورة.');
            const inv   = data.invoice;
            const items = data.items || [];

            const taxRate = (() => { const n = parseFloat(inv.tax_rate||0); return (n<=1?n*100:n).toFixed(0); })();

            const itemRows = items.map((item, idx) => `
                <tr style="border-bottom:1px solid #e2e8f0;${idx%2===1?'background:#f8fafc;':''}">
                    <td style="padding:10px 12px;text-align:center;color:#64748b;">${idx+1}</td>
                    <td style="padding:10px 12px;font-weight:600;color:#1e293b;">${esc(item.product_name||'—')} ${esc(item.size_name||'')}</td>
                    <td style="padding:10px 12px;text-align:center;">${parseFloat(item.quantity||0)}</td>
                    <td style="padding:10px 12px;text-align:center;font-family:monospace;">${parseFloat(item.unit_cost||0).toFixed(2)}</td>
                    <td style="padding:10px 12px;text-align:center;font-weight:700;font-family:monospace;">${parseFloat(item.total_cost||0).toFixed(2)}</td>
                </tr>`).join('');

            const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>فاتورة شراء #${inv.invoice_number}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#fff;color:#1e293b;padding:30px;font-size:13px;}
  @media print{body{padding:10px;}.no-print{display:none!important;}@page{margin:15mm;}}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e293b;padding-bottom:16px;margin-bottom:20px;}
  h1{font-size:24px;font-weight:900;color:#1e293b;}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:800;background:#e2e8f0;color:#334155;}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:20px;}
  .info-item label{font-size:10px;color:#94a3b8;font-weight:600;display:block;margin-bottom:2px;}
  .info-item span{font-size:13px;font-weight:700;color:#1e293b;}
  table{width:100%;border-collapse:collapse;margin-bottom:20px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;}
  thead{background:linear-gradient(135deg,#1e293b,#334155);}
  thead th{padding:10px 12px;color:#fff;font-size:11px;font-weight:700;text-align:right;}
  .totals{display:flex;justify-content:flex-end;margin-bottom:20px;}
  .totals-box{width:280px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;}
  .tr{display:flex;justify-content:space-between;padding:9px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;}
  .tr:last-child{border-bottom:none;}
  .grand{background:#1e293b;color:#fff;font-weight:900;font-size:14px;}
  .footer{text-align:center;color:#94a3b8;font-size:11px;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px;}
  .print-btn{position:fixed;bottom:20px;left:20px;padding:10px 22px;background:#1e293b;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;}
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>G.PACK</h1>
    <p style="font-size:12px;color:#64748b;margin-top:2px;">إدارة الإنتاج والمبيعات</p>
  </div>
  <div style="text-align:left;">
    <div style="font-size:20px;font-weight:900;color:#1e293b;">فاتورة شراء #${inv.invoice_number}</div>
    <div style="font-size:12px;color:#64748b;margin-top:4px;">${date(inv.invoice_date)}</div>
    <div style="margin-top:6px;"><span class="badge">فاتورة مشتريات</span></div>
  </div>
</div>

<div class="info-grid">
  <div class="info-item"><label>المورد</label><span>${esc(inv.supplier_name||'—')}</span></div>
  <div class="info-item"><label>أمر التصنيع</label><span>${esc(inv.mo_number||'—')}</span></div>
  ${inv.supplier_invoice_ref ? `<div class="info-item"><label>مرجع فاتورة المورد</label><span>${esc(inv.supplier_invoice_ref)}</span></div>` : ''}
  ${inv.commercial_register  ? `<div class="info-item"><label>السجل التجاري</label><span>${esc(inv.commercial_register)}</span></div>` : ''}
  ${inv.supplier_tax_id      ? `<div class="info-item"><label>الرقم الضريبي</label><span>${esc(inv.supplier_tax_id)}</span></div>` : ''}
  ${inv.supplier_city        ? `<div class="info-item"><label>المدينة</label><span>${esc(inv.supplier_city)}</span></div>` : ''}
</div>

<table>
  <thead><tr>
    <th style="width:40px;">#</th>
    <th style="text-align:right;">المنتج</th>
    <th>الكمية</th>
    <th>سعر الوحدة</th>
    <th>الإجمالي</th>
  </tr></thead>
  <tbody>${itemRows || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#94a3b8;">لا توجد أصناف</td></tr>'}</tbody>
</table>

<div class="totals"><div class="totals-box">
  <div class="tr"><span>المجموع قبل الضريبة</span><span style="font-family:monospace;font-weight:700;">${parseFloat(inv.subtotal||0).toFixed(2)}</span></div>
  ${parseFloat(inv.tax_amount||0)>0 ? `<div class="tr"><span>ضريبة القيمة المضافة (${taxRate}%)</span><span style="font-family:monospace;">${parseFloat(inv.tax_amount||0).toFixed(2)}</span></div>` : ''}
  <div class="tr grand"><span>الإجمالي الكلي</span><span style="font-family:monospace;">${parseFloat(inv.grand_total||0).toFixed(2)}</span></div>
</div></div>

${inv.notes ? `<p style="font-size:12px;color:#64748b;margin-bottom:16px;"><strong>ملاحظات:</strong> ${esc(inv.notes)}</p>` : ''}

<div class="footer">شكراً للتعامل معنا — G.PACK</div>
<button class="no-print print-btn" onclick="window.print()"><i class="fa-solid fa-print"></i> طباعة</button>
</body>
</html>`;

            const w = window.open('', '_blank', 'width=900,height=700');
            if (!w) { alert('يرجى السماح بالنوافذ المنبثقة.'); return; }
            w.document.write(html);
            w.document.close();
            setTimeout(() => w.print(), 600);

        } catch (err) {
            alert('خطأ أثناء تحميل الفاتورة: ' + err.message);
        }
    };

    // ── Tab switcher ──────────────────────────────────────────────────────────
    window.spTab = function(name) {
        ['orders','invoices','vouchers'].forEach(t => {
            document.getElementById(`sp-panel-${t}`)?.classList.toggle('hidden', t !== name);
            document.getElementById(`sp-tab-${t}`)?.classList.toggle('active-sp-tab', t === name);
        });
    };

    // ── Open profile ──────────────────────────────────────────────────────────
    window.openSupplierProfile = function(supplierId) {
        window._spSupplierId = supplierId;
        window.navigateTo('supplier-profile');
    };

    // ── Print Supplier Statement ──────────────────────────────────────────────
    window.printSupplierStatement = function(fromDate, toDate) {
        const data = window._spProfileData;
        if (!data) return;
        const s = data.supplier;

        const from = fromDate ? new Date(fromDate) : null;
        const to   = toDate   ? new Date(toDate + 'T23:59:59') : null;
        const inRange = (d) => {
            if (!d) return true;
            const dt = new Date(d);
            if (from && dt < from) return false;
            if (to   && dt > to)   return false;
            return true;
        };

        const orders   = (data.orders   || []).filter(o => inRange(o.created_at));
        const invoices = (data.invoices || []).filter(i => inRange(i.invoice_date || i.created_at));
        const periodLabel = (from || to)
            ? `من ${from ? from.toLocaleDateString('en-GB') : '—'} إلى ${to ? to.toLocaleDateString('en-GB') : '—'}`
            : 'كامل الفترة';

        const MO_LBL = { pending: 'معلق', in_progress: 'قيد التنفيذ', completed: 'مكتمل', cancelled: 'ملغي', delivered: 'مُسلَّم' };

        const ordersRows = orders.map((o, i) => {
            const rem = Math.max(0, parseFloat(o.total_amount || 0) - parseFloat(o.paid_amount || 0));
            return `<tr style="border-bottom:1px solid #e2e8f0;${i%2===1?'background:#f8fafc;':''}">
                <td style="padding:9px 12px;font-weight:700;font-family:monospace;color:#1e293b;">${esc(o.mo_number)}</td>
                <td style="padding:9px 12px;color:#64748b;">${date(o.created_at)}</td>
                <td style="padding:9px 12px;">${MO_LBL[o.status] || o.status}</td>
                <td style="padding:9px 12px;font-family:monospace;font-weight:700;">${parseFloat(o.total_amount||0).toFixed(2)}</td>
                <td style="padding:9px 12px;color:#059669;font-family:monospace;">${parseFloat(o.paid_amount||0).toFixed(2)}</td>
                <td style="padding:9px 12px;color:${rem>0?'#dc2626':'#94a3b8'};font-weight:${rem>0?'700':'400'};font-family:monospace;">${rem.toFixed(2)}</td>
            </tr>`;
        }).join('');

        const invoicesRows = invoices.map((inv, i) => `
            <tr style="border-bottom:1px solid #e2e8f0;${i%2===1?'background:#f8fafc;':''}">
                <td style="padding:9px 12px;font-weight:700;font-family:monospace;color:#1e293b;">#${inv.invoice_number}</td>
                <td style="padding:9px 12px;font-family:monospace;color:#64748b;">${esc(inv.mo_number||'—')}</td>
                <td style="padding:9px 12px;color:#64748b;">${date(inv.invoice_date)}</td>
                <td style="padding:9px 12px;font-weight:700;font-family:monospace;">${parseFloat(inv.grand_total||0).toFixed(2)}</td>
            </tr>`
        ).join('');

        const totalOrders   = orders.reduce((s,o)=>s+parseFloat(o.total_amount||0),0);
        const totalPaid     = orders.reduce((s,o)=>s+parseFloat(o.paid_amount||0),0);
        const totalRemaining= Math.max(0, totalOrders - totalPaid);

        const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>كشف حساب مورد — ${esc(s.name)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#fff;color:#1e293b;padding:30px;font-size:13px;}
  @media print{body{padding:10px;}.no-print{display:none!important;}@page{margin:15mm;}}
  h1{font-size:22px;font-weight:900;color:#1e293b;}
  .sub{font-size:12px;color:#64748b;margin-top:2px;}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e293b;padding-bottom:16px;margin-bottom:20px;}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px;}
  .stat-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;text-align:center;}
  .stat-box .val{font-size:18px;font-weight:900;}
  .stat-box .lbl{font-size:11px;color:#94a3b8;margin-top:2px;}
  table{width:100%;border-collapse:collapse;margin-bottom:24px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;}
  thead{background:linear-gradient(135deg,#1e293b,#334155);}
  thead th{padding:10px 12px;color:#fff;font-size:11px;font-weight:700;text-align:right;}
  .section-title{font-size:14px;font-weight:800;color:#1e293b;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;}
  .print-btn{position:fixed;bottom:20px;left:20px;padding:10px 22px;background:#1e293b;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;}
</style>
</head>
<body>
<div class="header">
  <div><h1>G.PACK</h1><p class="sub">كشف حساب مورد — ${periodLabel}</p></div>
  <div style="text-align:left;">
    <div style="font-size:20px;font-weight:900;color:#1e293b;">${esc(s.name)}</div>
    ${s.phone   ? `<div class="sub">${esc(s.phone)}</div>`   : ''}
    ${s.city    ? `<div class="sub">${esc(s.city)}</div>`    : ''}
    ${s.payment_terms ? `<div class="sub">شروط الدفع: ${esc(s.payment_terms)}</div>` : ''}
    <div class="sub" style="margin-top:6px;">تاريخ الطباعة: ${new Date().toLocaleDateString('en-GB')}</div>
  </div>
</div>

<div class="stats">
  <div class="stat-box"><div class="val" style="color:#1e293b;">${orders.length}</div><div class="lbl">عدد الطلبات</div></div>
  <div class="stat-box"><div class="val" style="color:#059669;">${totalOrders.toFixed(2)}</div><div class="lbl">إجمالي القيمة</div></div>
  <div class="stat-box"><div class="val" style="color:#2563eb;">${totalPaid.toFixed(2)}</div><div class="lbl">إجمالي المدفوع</div></div>
  <div class="stat-box"><div class="val" style="color:#dc2626;">${totalRemaining.toFixed(2)}</div><div class="lbl">المتبقي المستحق</div></div>
</div>

<p class="section-title">سجل أوامر التصنيع</p>
<table>
  <thead><tr>
    <th>رقم الأمر</th><th>التاريخ</th><th>الحالة</th>
    <th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th>
  </tr></thead>
  <tbody>${ordersRows || '<tr><td colspan="6" style="padding:12px;text-align:center;color:#94a3b8;">لا توجد طلبات</td></tr>'}</tbody>
</table>

<p class="section-title">سجل فواتير الشراء</p>
<table>
  <thead><tr>
    <th>رقم الفاتورة</th><th>أمر التصنيع</th><th>التاريخ</th><th>الإجمالي</th>
  </tr></thead>
  <tbody>${invoicesRows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#94a3b8;">لا توجد فواتير</td></tr>'}</tbody>
</table>

<button class="no-print print-btn" onclick="window.print()"><i class="fa-solid fa-print"></i> طباعة</button>
</body>
</html>`;

        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) { alert('يرجى السماح بالنوافذ المنبثقة.'); return; }
        w.document.write(html);
        w.document.close();
        setTimeout(() => w.print(), 600);
    };

    // ── Main init ─────────────────────────────────────────────────────────────
    async function _init() {
        const supplierId = window._spSupplierId;
        if (!supplierId) {
            document.getElementById('sp-loading')?.classList.add('hidden');
            const errEl = document.getElementById('sp-error');
            const msgEl = document.getElementById('sp-error-msg');
            if (msgEl) msgEl.textContent = 'لم يتم تحديد المورد. يرجى الانتقال من صفحة الموردين.';
            if (errEl) errEl.classList.remove('hidden');
            return;
        }

        try {
            const res  = await window.apiFetch(`/api/suppliers/${supplierId}/profile`);
            const data = res?.data;
            if (!data) throw new Error('لم يتم إيجاد بيانات المورد.');

            document.getElementById('sp-loading')?.classList.add('hidden');
            document.getElementById('sp-content')?.classList.remove('hidden');

            _renderHeader(data.supplier);
            _renderStats(data.stats || {}, data.invoices || []);
            _renderOrders(data.orders   || []);
            _renderInvoices(data.invoices || []);

            // Load payment vouchers for this supplier
            try {
                const pvRes = await window.apiFetch(`/api/payment-vouchers?search=${encodeURIComponent(data.supplier.name)}&limit=100&_t=${Date.now()}`);
                _renderVouchers((pvRes.data || []).filter(v => v.reference_type === 'supplier' && String(v.reference_id) === String(window._spSupplierId)));
            } catch (_) {
                _renderVouchers([]);
            }

            window._spProfileData = data;
            document.getElementById('sp-print-btn')?.classList.remove('hidden');

        } catch (err) {
            document.getElementById('sp-loading')?.classList.add('hidden');
            const errEl = document.getElementById('sp-error');
            const msgEl = document.getElementById('sp-error-msg');
            if (msgEl) msgEl.textContent = err.message || 'حدث خطأ أثناء التحميل.';
            if (errEl) errEl.classList.remove('hidden');
        }
    }

    _init();

})();
