'use strict';

// =============================================================================
// G.PACK 2.0 - Client Profile View Controller
// Handles /views/client-profile.html
// Expects window._cpClientId to be set before navigating to this view.
// =============================================================================

(function () {

    const fmt  = (v) => parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sar  = (v) => fmt(v);
    const date = (v) => v ? new Date(v).toLocaleDateString('en-GB') : '—';
    const taxPct = (r) => { const n = parseFloat(r || 0); return (n <= 1 ? n * 100 : n).toFixed(0); };
    const esc  = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const STATUS_MAP = {
        quote:       { label: 'عرض سعر',   cls: 'bg-amber-100 text-amber-700' },
        confirmed:   { label: 'مؤكد',       cls: 'bg-blue-100 text-blue-700' },
        production:  { label: 'إنتاج',      cls: 'bg-purple-100 text-purple-700' },
        processing:  { label: 'معالجة',     cls: 'bg-indigo-100 text-indigo-700' },
        completed:   { label: 'مكتمل',      cls: 'bg-emerald-100 text-emerald-700' },
        delivered:   { label: 'مُسلَّم',    cls: 'bg-teal-100 text-teal-700' },
        cancelled:   { label: 'ملغي',       cls: 'bg-red-100 text-red-700' },
        archived:    { label: 'مؤرشف',      cls: 'bg-slate-100 text-slate-500' },
        issued:      { label: 'مُصدَرة',    cls: 'bg-emerald-100 text-emerald-700' },
        draft:       { label: 'مسودة',      cls: 'bg-slate-100 text-slate-500' },
    };

    function _badge(status) {
        const s = STATUS_MAP[status] || { label: status || '—', cls: 'bg-slate-100 text-slate-500' };
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${s.cls}">${s.label}</span>`;
    }

    function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
    function _setHTML(id, val) { const el = document.getElementById(id); if (el) el.innerHTML = val; }

    // ── Empty row helper ─────────────────────────────────────────────────────
    function _emptyRow(cols, msg) {
        return `<tr><td colspan="${cols}" class="py-10 text-center text-slate-400 text-sm">${msg}</td></tr>`;
    }

    // ── Render client header ─────────────────────────────────────────────────
    function _renderHeader(client) {
        _setText('cp-page-title', client.name);
        _setText('cp-page-sub',   client.city || (client.parent_id ? 'فرع' : 'عميل رئيسي'));
        _setText('cp-name',       client.name);
        _setHTML('cp-type-badge', client.parent_id
            ? `<span class="text-xs font-bold text-purple-200 bg-white/20 px-2 py-0.5 rounded-full">فرع — ${esc(client.parent_name || '')}</span>`
            : `<span class="text-xs font-bold text-brand-200 bg-white/20 px-2 py-0.5 rounded-full">عميل رئيسي</span>`
        );
        _setHTML('cp-status-badge', client.status === 'active'
            ? `<span class="flex items-center gap-1.5 text-xs font-bold text-emerald-300"><span class="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>نشط</span>`
            : `<span class="flex items-center gap-1.5 text-xs font-bold text-slate-300"><span class="w-2 h-2 rounded-full bg-slate-400 inline-block"></span>غير نشط</span>`
        );

        _setText('cp-contact', client.contact_person || '—');
        _setText('cp-phone',   client.phone          || '—');
        _setText('cp-email',   client.email          || '—');
        _setText('cp-city',    client.city           || '—');
        _setText('cp-cr',      client.commercial_register || '—');
        _setText('cp-tax',     client.tax_id         || '—');
        _setText('cp-credit',  client.credit_limit ? sar(client.credit_limit) : '—');

        if (client.parent_id) {
            const wrap = document.getElementById('cp-parent-wrap');
            if (wrap) wrap.classList.remove('hidden');
            _setText('cp-parent', client.parent_name || '—');
        }

        const editBtn = document.getElementById('cp-edit-btn');
        if (editBtn) editBtn.classList.remove('hidden');
    }

    // ── Render stats ─────────────────────────────────────────────────────────
    function _renderStats(s) {
        _setText('stat-orders',    s.total_orders || '0');
        _setText('stat-quotes',    s.quote_count  || '0');
        _setText('stat-value',     fmt(s.total_value));
        _setText('stat-paid',      fmt(s.total_paid));
        _setText('stat-remaining', fmt(s.total_remaining));
    }

    // ── Render Orders tab ─────────────────────────────────────────────────────
    function _renderOrders(orders) {
        const el = document.getElementById('tab-orders-badge');
        if (el) el.textContent = orders.length;

        const tbody = document.getElementById('cp-orders-tbody');
        if (!tbody) return;

        if (!orders.length) { tbody.innerHTML = _emptyRow(8, 'لا توجد طلبات لهذا العميل'); return; }

        tbody.innerHTML = orders.map(o => {
            const remaining = Math.max(0, parseFloat(o.grand_total || 0) - parseFloat(o.paid_amount || 0));
            return `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3 px-4 font-mono font-bold text-slate-700">#${o.order_number}</td>
                <td class="py-3 px-4">${_badge(o.status)}</td>
                <td class="py-3 px-4 text-slate-500 hidden sm:table-cell">${date(o.order_date)}</td>
                <td class="py-3 px-4 text-slate-500 hidden md:table-cell">${o.item_count || 0} صنف</td>
                <td class="py-3 px-4 font-bold text-slate-800 font-mono">${sar(o.grand_total)}</td>
                <td class="py-3 px-4 text-emerald-600 font-semibold font-mono hidden md:table-cell">${sar(o.paid_amount)}</td>
                <td class="py-3 px-4 font-semibold font-mono hidden md:table-cell ${remaining > 0 ? 'text-red-500' : 'text-slate-400'}">${sar(remaining)}</td>
                <td class="py-3 px-4">
                    ${o.status === 'quote' || o.status === 'archived'
                        ? `<button onclick="window._cpOpenQuote('${o.id}')"
                                   class="inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:text-brand-800 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg transition-colors">
                               <i class="fa-solid fa-folder-open"></i>عرض العرض
                           </button>`
                        : `<button onclick="window._cpOpenOrder('${o.id}')"
                                   class="inline-flex items-center gap-1 text-xs font-bold text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 px-2.5 py-1.5 rounded-lg transition-colors">
                               <i class="fa-solid fa-industry"></i>فتح الأمر
                           </button>`
                    }
                </td>
            </tr>`;
        }).join('');
    }

    // ── Render Invoices tab ───────────────────────────────────────────────────
    function _renderInvoices(invoices) {
        const issued = (invoices || []).filter(i => i.status === 'issued');

        const el = document.getElementById('tab-invoices-badge');
        if (el) el.textContent = issued.length;

        const tbody = document.getElementById('cp-invoices-tbody');
        if (!tbody) return;

        if (!issued.length) { tbody.innerHTML = _emptyRow(6, 'لا توجد فواتير مُصدَرة لهذا العميل'); return; }

        tbody.innerHTML = issued.map(inv => `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3 px-4 font-mono font-bold text-slate-700">#${inv.invoice_number || '—'}</td>
                <td class="py-3 px-4 text-slate-500 font-mono">#${inv.order_number || '—'}</td>
                <td class="py-3 px-4 text-slate-500 hidden sm:table-cell">${date(inv.created_at)}</td>
                <td class="py-3 px-4 font-bold text-slate-800 font-mono">${sar(inv.grand_total)}</td>
                <td class="py-3 px-4">${_badge(inv.status)}</td>
                <td class="py-3 px-4">
                    <div class="flex items-center gap-1">
                        <button onclick="window._cpOpenInvoiceModal('${inv.id}')"
                                title="عرض الفاتورة"
                                class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors">
                            <i class="fa-solid fa-eye text-xs"></i>عرض
                        </button>
                        <button onclick="window.printInvoiceFromProfile('${inv.id}')"
                                title="طباعة الفاتورة"
                                class="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                            <i class="fa-solid fa-print text-sm"></i>
                        </button>
                    </div>
                </td>
            </tr>`
        ).join('');
    }

    // ── Render Payments tab ───────────────────────────────────────────────────
    function _renderPayments(payments) {
        const el = document.getElementById('tab-payments-badge');
        if (el) el.textContent = payments.length;

        const tbody = document.getElementById('cp-payments-tbody');
        if (!tbody) return;

        if (!payments.length) { tbody.innerHTML = _emptyRow(6, 'لا توجد دفعات مسجلة لهذا العميل'); return; }

        const pmMap = {
            cash:         'نقداً',
            bank_transfer:'تحويل بنكي',
            check:        'شيك',
            card:         'بطاقة',
        };

        tbody.innerHTML = payments.map(p => `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3 px-4 text-slate-500">${date(p.created_at)}</td>
                <td class="py-3 px-4 text-slate-500 font-mono">#${p.order_number || '—'}</td>
                <td class="py-3 px-4 font-bold text-emerald-600 font-mono">${sar(p.amount)}</td>
                <td class="py-3 px-4 text-slate-600 hidden sm:table-cell">${pmMap[p.payment_method] || p.payment_method || '—'}</td>
                <td class="py-3 px-4 text-slate-500 hidden md:table-cell">${esc(p.document_number || '—')}</td>
                <td class="py-3 px-4 text-slate-500 hidden md:table-cell">${esc(p.description || '—')}</td>
                <td class="py-3 px-4">
                    <button onclick="window._cpPrintPayment('${p.id}')"
                            title="طباعة سند القبض"
                            class="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                        <i class="fa-solid fa-print text-sm"></i>
                    </button>
                </td>
            </tr>`
        ).join('');
    }

    // ── Print Payment Receipt ──────────────────────────────────────────────────
    window._cpPrintPayment = function(paymentId) {
        const data = window._cpProfileData;
        if (!data) return;

        const p = (data.payments || []).find(x => String(x.id) === String(paymentId));
        if (!p) return;

        const c = data.client || {};
        const pmMap = { cash: 'نقداً', bank_transfer: 'تحويل بنكي', check: 'شيك', card: 'بطاقة' };
        const payDate = new Date(p.created_at).toLocaleDateString('ar-SA', { year:'numeric', month:'long', day:'numeric' });
        const printDate = new Date().toLocaleDateString('ar-SA', { year:'numeric', month:'long', day:'numeric' });
        const amountNum = parseFloat(p.amount || 0);
        const amountFmt = amountNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>سند قبض — ${esc(c.name || '')}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background:#f8fafc; color:#1e293b; padding:20px; }
  .page { max-width:680px; margin:0 auto; background:#fff; border-radius:12px; overflow:hidden;
          box-shadow:0 4px 24px rgba(0,0,0,0.10); }
  .header { background:linear-gradient(135deg,#1e293b 0%,#334155 100%); color:#fff; padding:28px 32px; display:flex; justify-content:space-between; align-items:center; }
  .brand { font-size:28px; font-weight:900; letter-spacing:2px; color:#f8fafc; }
  .brand-sub { font-size:11px; color:#94a3b8; margin-top:3px; }
  .receipt-badge { background:#10b981; color:#fff; border-radius:8px; padding:8px 18px; font-size:13px; font-weight:800; letter-spacing:1px; }
  .body { padding:28px 32px; }
  .meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
  .meta-box { background:#f8fafc; border-radius:10px; padding:14px 16px; border:1px solid #e2e8f0; }
  .meta-label { font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase; margin-bottom:6px; }
  .meta-value { font-size:14px; font-weight:700; color:#1e293b; }
  .meta-sub { font-size:12px; color:#64748b; margin-top:3px; }
  .amount-box { background:linear-gradient(135deg,#ecfdf5,#d1fae5); border:2px solid #10b981; border-radius:12px;
                padding:22px 28px; text-align:center; margin-bottom:24px; }
  .amount-label { font-size:12px; font-weight:700; color:#059669; margin-bottom:8px; }
  .amount-value { font-size:36px; font-weight:900; color:#065f46; font-family:monospace; letter-spacing:1px; }
  .amount-currency { font-size:16px; font-weight:700; color:#059669; margin-right:6px; }
  .details-table { width:100%; border-collapse:collapse; margin-bottom:24px; }
  .details-table td { padding:10px 14px; font-size:13px; border-bottom:1px solid #f1f5f9; }
  .details-table td:first-child { color:#64748b; font-weight:600; width:40%; }
  .details-table td:last-child { color:#1e293b; font-weight:700; }
  .footer { background:#f8fafc; border-top:1px solid #e2e8f0; padding:16px 32px; display:flex; justify-content:space-between; align-items:center; }
  .footer-note { font-size:11px; color:#94a3b8; }
  .sig-box { text-align:center; }
  .sig-line { width:140px; border-bottom:1px solid #cbd5e1; margin:0 auto 4px; padding-top:40px; }
  .sig-label { font-size:11px; color:#64748b; }
  @media print { body{padding:0;background:#fff;} .page{box-shadow:none;border-radius:0;} .no-print{display:none!important;} }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div><div class="brand">G.PACK</div><div class="brand-sub">نظام إدارة الإنتاج</div></div>
    <div class="receipt-badge">سند قبض</div>
  </div>
  <div class="body">
    <div class="meta-grid">
      <div class="meta-box">
        <div class="meta-label">العميل</div>
        <div class="meta-value">${esc(c.name || '—')}</div>
        ${c.phone ? `<div class="meta-sub">${esc(c.phone)}</div>` : ''}
        ${c.city  ? `<div class="meta-sub">${esc(c.city)}</div>`  : ''}
      </div>
      <div class="meta-box">
        <div class="meta-label">بيانات السند</div>
        <div class="meta-value">طلب #${esc(String(p.order_number || '—'))}</div>
        <div class="meta-sub">تاريخ الدفع: ${payDate}</div>
        <div class="meta-sub">تاريخ الطباعة: ${printDate}</div>
      </div>
    </div>
    <div class="amount-box">
      <div class="amount-label">المبلغ المستلم</div>
      <div class="amount-value"><span class="amount-currency">﷼</span>${amountFmt}</div>
    </div>
    <table class="details-table">
      <tr><td>طريقة الدفع</td><td>${pmMap[p.payment_method] || esc(p.payment_method || '—')}</td></tr>
      ${p.document_number ? `<tr><td>رقم المستند / الشيك</td><td>${esc(p.document_number)}</td></tr>` : ''}
      ${p.description     ? `<tr><td>البيان / الملاحظات</td><td>${esc(p.description)}</td></tr>`     : ''}
    </table>
    <div style="display:flex; justify-content:space-between; margin-top:16px;">
      <div class="sig-box"><div class="sig-line"></div><div class="sig-label">توقيع المحاسب</div></div>
      <div class="sig-box"><div class="sig-line"></div><div class="sig-label">توقيع العميل</div></div>
    </div>
  </div>
  <div class="footer">
    <div class="footer-note">G.PACK — نظام إدارة الإنتاج © ${new Date().getFullYear()}</div>
    <button onclick="window.print()" class="no-print"
            style="background:#1e293b;color:#fff;border:none;border-radius:8px;padding:8px 20px;font-size:13px;font-weight:700;cursor:pointer;">
      طباعة
    </button>
  </div>
</div>
</body></html>`;

        const w = window.open('', '_blank', 'width=750,height=620');
        if (!w) { alert('يرجى السماح بالنوافذ المنبثقة لطباعة السند.'); return; }
        w.document.write(html);
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 600);
    };

    // ── Render Designs tab ────────────────────────────────────────────────────
    function _renderDesigns(designs) {
        const el = document.getElementById('tab-designs-badge');
        if (el) el.textContent = designs.length;

        const grid  = document.getElementById('cp-designs-grid');
        const empty = document.getElementById('cp-designs-empty');
        if (!grid) return;

        if (!designs.length) {
            grid.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        grid.innerHTML = designs.map(d => {
            const ext   = (d.file_path || '').split('.').pop().toLowerCase();
            const isPdf = ext === 'pdf';
            const hasFile = !!d.file_path;

            const preview = !hasFile
                ? `<div class="w-full aspect-square bg-slate-100 flex flex-col items-center justify-center">
                       <i class="fa-solid fa-image text-3xl text-slate-300 mb-1"></i>
                       <span class="text-xs text-slate-400">لا يوجد ملف</span>
                   </div>`
                : isPdf
                ? `<div class="w-full aspect-square bg-red-50 flex flex-col items-center justify-center">
                       <i class="fa-solid fa-file-pdf text-3xl text-red-400 mb-1"></i>
                       <span class="text-xs text-slate-500">PDF</span>
                   </div>`
                : `<img src="${d.file_path}" alt="${esc(d.design_name || '')}"
                        class="w-full aspect-square object-cover bg-slate-100"
                        onerror="this.parentElement.innerHTML='<div class=\\'w-full aspect-square bg-slate-100 flex items-center justify-center\\'><i class=\\'fa-solid fa-image text-2xl text-slate-300\\'></i></div>'" />`;

            const statusHtml = d.is_active
                ? `<span class="text-xs font-bold text-emerald-600"><i class="fa-solid fa-circle-check ml-1"></i>نشط</span>`
                : `<span class="text-xs font-bold text-slate-400"><i class="fa-solid fa-circle-xmark ml-1"></i>غير نشط</span>`;

            const fileLink = hasFile
                ? `<a href="${d.file_path}" target="_blank" class="block overflow-hidden">${preview}</a>`
                : `<div>${preview}</div>`;

            return `
            <div class="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
                ${fileLink}
                <div class="p-2.5">
                    <p class="text-xs font-bold text-slate-700 truncate">${esc(d.design_name || 'تصميم #' + d.design_number)}</p>
                    <p class="text-xs text-slate-400 truncate">${esc(d.product_name)} — ${esc(d.size_name || '')}</p>
                    <div class="mt-1">${statusHtml}</div>
                </div>
            </div>`;
        }).join('');
    }

    // ── Render Branches tab ───────────────────────────────────────────────────
    function _renderBranches(branches) {
        const el = document.getElementById('tab-branches-badge');
        if (el) el.textContent = branches.length;

        const tbody = document.getElementById('cp-branches-tbody');
        const empty = document.getElementById('cp-branches-empty');
        if (!tbody) return;

        if (!branches.length) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        tbody.innerHTML = branches.map(b => `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3 px-4 font-semibold text-slate-800">${esc(b.name)}</td>
                <td class="py-3 px-4 text-slate-500 hidden sm:table-cell">${esc(b.phone || '—')}</td>
                <td class="py-3 px-4 text-slate-500 hidden md:table-cell">${esc(b.city || '—')}</td>
                <td class="py-3 px-4">${b.status === 'active'
                    ? '<span class="text-xs font-bold text-emerald-600"><i class="fa-solid fa-circle-check ml-1"></i>نشط</span>'
                    : '<span class="text-xs font-bold text-slate-400"><i class="fa-solid fa-circle-xmark ml-1"></i>غير نشط</span>'
                }</td>
                <td class="py-3 px-4 text-left">
                    <button onclick="window.openClientProfile('${b.id}')"
                            class="text-xs font-bold text-brand-600 hover:text-brand-800">
                        <i class="fa-solid fa-arrow-up-right-from-square ml-1"></i>ملف الفرع
                    </button>
                </td>
            </tr>`
        ).join('');
    }

    // ── Tab switcher ──────────────────────────────────────────────────────────
    window.cpTab = function(name) {
        ['orders','invoices','payments','designs','branches','items'].forEach(t => {
            document.getElementById(`panel-${t}`)?.classList.toggle('hidden', t !== name);
            document.getElementById(`tab-${t}`)?.classList.toggle('active-tab', t === name);
        });
        if (name === 'items') _loadClientItems();
    };

    // ── Open profile (can be called from branches row) ────────────────────────
    window.openClientProfile = function(clientId) {
        window._cpClientId = clientId;
        window.navigateTo('client-profile');
    };

    // ── Open Quote directly from profile ─────────────────────────────────────
    // ينتقل لصفحة عروض الأسعار ثم يفتح الـ modal للعرض المحدد فوراً
    window._cpOpenQuote = function(orderId) {
        window.navigateTo('quotations');
        // ننتظر تحميل الصفحة ثم نفتح الـ modal في وضع العرض
        const _attempt = (tries) => {
            if (tries <= 0) return;
            if (typeof window.openQuoteModal === 'function') {
                window.openQuoteModal(orderId, true); // true = viewOnly
            } else {
                setTimeout(() => _attempt(tries - 1), 300);
            }
        };
        setTimeout(() => _attempt(10), 400);
    };

    // ── Open Production Order Hub directly from profile ───────────────────────
    // ينتقل لصفحة أوامر التشغيل ثم يفتح الـ Hub للأمر المحدد فوراً
    window._cpOpenOrder = function(orderId) {
        window.navigateTo('production_orders');
        // ننتظر: 1) window.poView يُعرَّف  2) الجدول يُملأ (po-tbody موجود وغير loading)
        const _attempt = (tries) => {
            if (tries <= 0) return;
            const ready = window.poView && typeof window.poView.openHub === 'function';
            const tableReady = document.getElementById('po-tbody') &&
                               !document.querySelector('#po-tbody .fa-spin');
            if (ready && tableReady) {
                window.poView.openHub(orderId);
            } else {
                setTimeout(() => _attempt(tries - 1), 350);
            }
        };
        setTimeout(() => _attempt(20), 500);
    };

    // ── Invoice Viewer Modal ──────────────────────────────────────────────────
    let _civCurrentInvData = null; // الفاتورة المفتوحة حالياً للطباعة

    function _civEl(id) { return document.getElementById(id); }

    window._cpOpenInvoiceModal = async function(invoiceId) {
        const modal = _civEl('cp-invoice-modal');
        if (!modal) return;

        // حفظ الـ ID للطباعة لاحقاً
        window._civOpenedInvoiceId = invoiceId;

        // إعادة ضبط الحالة
        _civCurrentInvData = null;
        _civEl('civ-loading')?.classList.remove('hidden');
        _civEl('civ-body')?.classList.add('hidden');
        _civEl('civ-error')?.classList.add('hidden');

        // فتح الـ modal
        modal.style.display = 'flex';
        requestAnimationFrame(() => modal.classList.add('opacity-100'));

        try {
            const data    = window._cpProfileData;
            if (!data) throw new Error('بيانات الملف غير محملة.');

            const inv_meta = (data.invoices || []).find(i => i.id === invoiceId);
            if (!inv_meta) throw new Error('لم يتم إيجاد الفاتورة.');

            const order = (data.orders || []).find(o =>
                String(o.order_number) === String(inv_meta.order_number)
            );
            if (!order) throw new Error('تعذّر تحديد الطلب المرتبط بهذه الفاتورة.');

            const res = await window.apiFetch(`/api/orders/${order.id}/invoice/${invoiceId}`);
            const inv = res?.data;
            if (!inv) throw new Error('لم يتم إيجاد بيانات الفاتورة.');

            _civCurrentInvData = inv;

            // ── تعبئة الـ modal ──
            const isProforma = inv.status !== 'issued';
            const items      = inv.items    || [];
            const payments   = inv.payments || [];
            const totalPaid  = payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
            const remaining  = Math.max(0, parseFloat(inv.grand_total || 0) - totalPaid);
            const taxPctVal  = (n) => { const v = parseFloat(n || 0); return (v <= 1 ? v * 100 : v).toFixed(0); };
            const PAY_M      = { cash: 'نقداً', bank_transfer: 'تحويل بنكي', check: 'شيك', card: 'بطاقة' };

            // Header
            const titleEl = _civEl('civ-title');
            if (titleEl) titleEl.textContent = `فاتورة #${inv.invoice_number || '—'} — ${isProforma ? 'أولية' : 'نهائية'}`;
            const subEl = _civEl('civ-subtitle');
            if (subEl) subEl.textContent = isProforma ? 'فاتورة أولية (غير مُصدَرة)' : 'فاتورة نهائية مُصدَرة';

            // Client card
            const clientEl = _civEl('civ-client');
            if (clientEl) clientEl.textContent = inv.client_name || '—';
            const phoneEl = _civEl('civ-client-phone');
            if (phoneEl) phoneEl.textContent = inv.client_phone || '';

            // Invoice meta card
            const orderNumEl = _civEl('civ-order-num');
            if (orderNumEl) orderNumEl.textContent = `#${inv.order_number || '—'}`;
            const dateEl = _civEl('civ-date');
            if (dateEl) dateEl.textContent = `التاريخ: ${new Date(inv.created_at || Date.now()).toLocaleDateString('en-GB')}`;

            // Items
            const itemsTbody = _civEl('civ-items-tbody');
            if (itemsTbody) {
                itemsTbody.innerHTML = items.length
                    ? items.map((item, idx) => `
                        <tr class="hover:bg-slate-50 transition-colors">
                            <td class="py-2.5 px-3 text-center text-slate-400 text-xs">${idx + 1}</td>
                            <td class="py-2.5 px-3 font-semibold text-slate-700">${esc(item.product_name || '—')} <span class="text-slate-400 font-normal">${esc(item.size_name || '')}</span></td>
                            <td class="py-2.5 px-3 text-center text-slate-600">${parseFloat(item.quantity || 0)}</td>
                            <td class="py-2.5 px-3 text-center font-mono text-slate-600">${parseFloat(item.unit_price || 0).toFixed(2)}</td>
                            <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-800">${parseFloat(item.line_total || parseFloat(item.quantity) * parseFloat(item.unit_price)).toFixed(2)}</td>
                        </tr>`).join('')
                    : `<tr><td colspan="5" class="py-8 text-center text-slate-400 text-xs">لا توجد أصناف</td></tr>`;
            }

            // Totals
            const taxPct = taxPctVal(inv.tax_rate);
            const taxLabelEl = _civEl('civ-tax-label');
            if (taxLabelEl) taxLabelEl.textContent = `ضريبة (${taxPct}%)`;
            const _s = (id, val) => { const el = _civEl(id); if (el) el.textContent = val; };
            _s('civ-subtotal', parseFloat(inv.subtotal   || 0).toFixed(2));
            _s('civ-tax',      parseFloat(inv.tax_amount || 0).toFixed(2));
            _s('civ-grand',    parseFloat(inv.grand_total|| 0).toFixed(2));
            _s('civ-paid',     totalPaid.toFixed(2));
            _s('civ-remaining', remaining.toFixed(2));
            const remLabel = _civEl('civ-remaining-label');
            const remVal   = _civEl('civ-remaining');
            if (remLabel) remLabel.className = remaining > 0 ? 'text-red-600' : 'text-emerald-600';
            if (remVal)   remVal.className   = `font-mono ${remaining > 0 ? 'text-red-600' : 'text-emerald-600'}`;

            // Payments
            const paymentsWrap  = _civEl('civ-payments-wrap');
            const paymentsTbody = _civEl('civ-payments-tbody');
            if (payments.length && paymentsWrap && paymentsTbody) {
                paymentsTbody.innerHTML = payments.map(p => `
                    <tr class="hover:bg-amber-50/50 transition-colors">
                        <td class="py-2 px-3 text-slate-500">${new Date(p.created_at).toLocaleDateString('en-GB')}</td>
                        <td class="py-2 px-3 text-slate-600">${PAY_M[p.payment_method] || p.payment_method || '—'}</td>
                        <td class="py-2 px-3 font-mono font-bold text-emerald-700">${parseFloat(p.amount || 0).toFixed(2)}</td>
                        <td class="py-2 px-3 text-slate-400 hidden sm:table-cell">${esc(p.description || '—')}</td>
                    </tr>`).join('');
                paymentsWrap.classList.remove('hidden');
            } else if (paymentsWrap) {
                paymentsWrap.classList.add('hidden');
            }

            // إظهار المحتوى
            _civEl('civ-loading')?.classList.add('hidden');
            _civEl('civ-body')?.classList.remove('hidden');

        } catch (err) {
            _civEl('civ-loading')?.classList.add('hidden');
            const errEl  = _civEl('civ-error');
            const errMsg = _civEl('civ-error-msg');
            if (errMsg) errMsg.textContent = err.message || 'تعذّر تحميل الفاتورة.';
            if (errEl)  errEl.classList.remove('hidden');
        }
    };

    window._cpCloseInvoiceModal = function() {
        const modal = _civEl('cp-invoice-modal');
        if (!modal) return;
        modal.classList.remove('opacity-100');
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    };

    // طباعة الفاتورة المفتوحة حالياً في الـ modal
    window._cpPrintCurrentInvoice = function() {
        if (!_civCurrentInvData) return;
        // printInvoiceFromProfile تبحث في data.invoices بـ id
        // نستخدم _civInvoiceId المخزن عند الفتح مباشرةً
        window.printInvoiceFromProfile(window._civOpenedInvoiceId);
    };

    // ── Pantone Colors ────────────────────────────────────────────────────────
    let _colorsData = [];

    async function _loadColors(clientId) {
        try {
            const res = await window.apiFetch(`/api/client-pantone-colors?client_id=${clientId}`);
            _colorsData = (res && res.data) ? res.data : [];
        } catch (_) { _colorsData = []; }
        _renderColors();
    }

    function _renderColors() {
        const grid  = document.getElementById('cp-colors-grid');
        const empty = document.getElementById('cp-colors-empty');
        const badge = document.getElementById('cp-colors-badge');

        if (badge) badge.textContent = _colorsData.length;
        if (!grid) return;

        if (!_colorsData.length) {
            grid.innerHTML = '';
            empty?.classList.remove('hidden');
            return;
        }
        empty?.classList.add('hidden');

        grid.innerHTML = _colorsData.map(c => {
            const hex    = c.hex_value || '#cccccc';
            const isLight = _isLightColor(hex);
            const txtCls  = isLight ? 'text-slate-800' : 'text-white';
            return `
            <div class="group relative rounded-xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                <div class="h-16 w-full" style="background:${esc(hex)}"></div>
                <div class="p-2.5 bg-white">
                    <p class="text-xs font-black text-slate-700 truncate">${esc(c.color_code)}</p>
                    ${c.color_name ? `<p class="text-xs text-slate-500 truncate mt-0.5">${esc(c.color_name)}</p>` : ''}
                    ${c.hex_value  ? `<p class="text-xs font-mono text-slate-400 mt-0.5">${esc(c.hex_value)}</p>` : ''}
                    ${c.notes      ? `<p class="text-xs text-slate-400 mt-0.5 truncate" title="${esc(c.notes)}">${esc(c.notes)}</p>` : ''}
                </div>
                <button onclick="window._cpDeleteColor('${c.id}')"
                        title="حذف اللون"
                        class="absolute top-1.5 left-1.5 w-6 h-6 flex items-center justify-center rounded-full
                               bg-black/30 hover:bg-red-500 text-white text-xs opacity-0 group-hover:opacity-100 transition-all">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>`;
        }).join('');
    }

    function _isLightColor(hex) {
        const c = hex.replace('#', '');
        if (c.length !== 6) return true;
        const r = parseInt(c.substring(0,2), 16);
        const g = parseInt(c.substring(2,4), 16);
        const b = parseInt(c.substring(4,6), 16);
        return (r * 0.299 + g * 0.587 + b * 0.114) > 186;
    }

    // selected pantone from library
    let _cpSelectedPantone = null;

    window._cpSearchPantone = function(query) {
        const resultsEl = document.getElementById('cp-pantone-results');
        if (!resultsEl) return;
        const q = (query || '').trim().toLowerCase();
        if (!q || q.length < 2) { resultsEl.classList.add('hidden'); return; }

        const db = window.PANTONE_COLORS || [];
        const matches = db.filter(c =>
            c.code.toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q)
        ).slice(0, 20);

        if (!matches.length) {
            resultsEl.innerHTML = `<div class="px-4 py-3 text-xs text-slate-400 text-center">لا نتائج — يمكنك الإدخال اليدوي أدناه</div>`;
        } else {
            resultsEl.innerHTML = matches.map(c => `
                <div onclick="window._cpSelectPantone('${c.code.replace(/'/g,'\\&apos;')}')"
                     class="flex items-center gap-3 px-3 py-2.5 hover:bg-purple-50 cursor-pointer border-b border-slate-50 last:border-0 transition-colors">
                    <div class="w-8 h-8 rounded-lg shrink-0 border border-slate-200"
                         style="background:${c.hex}"></div>
                    <div class="min-w-0">
                        <p class="text-xs font-bold text-slate-800 truncate">${c.code}</p>
                        <p class="text-xs text-slate-500 truncate">${c.name} &nbsp;<span class="font-mono text-slate-400">${c.hex}</span></p>
                    </div>
                </div>`).join('');
        }
        resultsEl.classList.remove('hidden');
    };

    window._cpSelectPantone = function(code) {
        const db = window.PANTONE_COLORS || [];
        const c = db.find(x => x.code === code);
        if (!c) return;
        _cpSelectedPantone = c;

        // Update preview card
        const preview = document.getElementById('cp-color-preview');
        const selCode = document.getElementById('cp-color-selected-code');
        const selName = document.getElementById('cp-color-selected-name');
        const selHex  = document.getElementById('cp-color-selected-hex');
        if (preview) preview.style.background = c.hex;
        if (selCode) selCode.textContent = c.code;
        if (selName) selName.textContent = c.name;
        if (selHex)  selHex.textContent  = c.hex;

        // Pre-fill manual fields too
        const codeEl = document.getElementById('cp-color-code');
        const nameEl = document.getElementById('cp-color-name');
        const hexEl  = document.getElementById('cp-color-hex');
        const hexTxt = document.getElementById('cp-color-hex-text');
        if (codeEl) codeEl.value = c.code;
        if (nameEl) nameEl.value = c.name;
        if (hexEl)  hexEl.value  = c.hex;
        if (hexTxt) hexTxt.value = c.hex;

        // Close dropdown, update search field
        const search = document.getElementById('cp-pantone-search');
        if (search) search.value = c.code;
        document.getElementById('cp-pantone-results')?.classList.add('hidden');
    };

    window._cpOpenAddColor = function() {
        const modal = document.getElementById('cp-color-modal');
        if (!modal) return;
        _cpSelectedPantone = null;

        // Reset all fields
        ['cp-color-code','cp-color-name','cp-color-notes','cp-pantone-search'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const hexEl = document.getElementById('cp-color-hex');
        const hexTxt = document.getElementById('cp-color-hex-text');
        const preview = document.getElementById('cp-color-preview');
        if (hexEl)   hexEl.value = '#cccccc';
        if (hexTxt)  hexTxt.value = '';
        if (preview) preview.style.background = '#cccccc';

        // Reset selection card
        const selCode = document.getElementById('cp-color-selected-code');
        const selName = document.getElementById('cp-color-selected-name');
        const selHex  = document.getElementById('cp-color-selected-hex');
        if (selCode) selCode.textContent = 'لم يتم اختيار لون';
        if (selName) selName.textContent = 'ابحث واختر من القائمة أو أدخل يدوياً';
        if (selHex)  selHex.textContent  = '';

        document.getElementById('cp-pantone-results')?.classList.add('hidden');

        modal.style.display = 'flex';
        requestAnimationFrame(() => modal.classList.add('opacity-100'));
        setTimeout(() => document.getElementById('cp-pantone-search')?.focus(), 250);
    };

    window._cpCloseColorModal = function() {
        const modal = document.getElementById('cp-color-modal');
        if (!modal) return;
        modal.classList.remove('opacity-100');
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    };

    window._cpPreviewColor = function() {
        const hexEl  = document.getElementById('cp-color-hex');
        const hexTxt = document.getElementById('cp-color-hex-text');
        const preview = document.getElementById('cp-color-preview');
        const hex = (hexEl && hexEl.value) ? hexEl.value : '#cccccc';
        if (hexTxt && !hexTxt.matches(':focus')) hexTxt.value = hex;
        if (preview) preview.style.background = hex;
    };

    window._cpSyncHexText = function() {
        const hexTxt = document.getElementById('cp-color-hex-text');
        const hexEl  = document.getElementById('cp-color-hex');
        const preview = document.getElementById('cp-color-preview');
        let val = (hexTxt && hexTxt.value) ? hexTxt.value.trim() : '';
        if (val && !val.startsWith('#')) val = '#' + val;
        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
            if (hexEl)   hexEl.value = val;
            if (preview) preview.style.background = val;
        }
    };

    window._cpSaveColor = async function() {
        const clientId = window._cpClientId;
        if (!clientId) return;

        // Priority: selected pantone → manual fields
        let code, name, hex;
        if (_cpSelectedPantone) {
            code = _cpSelectedPantone.code;
            name = _cpSelectedPantone.name;
            hex  = _cpSelectedPantone.hex;
            // allow override from manual fields
            const manCode = (document.getElementById('cp-color-code')?.value || '').trim();
            const manName = (document.getElementById('cp-color-name')?.value || '').trim();
            if (manCode) code = manCode;
            if (manName) name = manName;
        } else {
            code = (document.getElementById('cp-color-code')?.value || '').trim();
            name = (document.getElementById('cp-color-name')?.value || '').trim();
            const hexTxt    = (document.getElementById('cp-color-hex-text')?.value || '').trim();
            const hexPicker = document.getElementById('cp-color-hex')?.value || '';
            hex = hexTxt && /^#[0-9A-Fa-f]{6}$/.test(hexTxt.startsWith('#') ? hexTxt : '#'+hexTxt)
                ? (hexTxt.startsWith('#') ? hexTxt : '#'+hexTxt)
                : (hexPicker !== '#cccccc' ? hexPicker : null);
        }

        if (!code) {
            if (window.showToast) window.showToast('كود اللون مطلوب — ابحث واختر أو أدخل يدوياً', 'error');
            document.getElementById('cp-pantone-search')?.focus();
            return;
        }

        const notes = (document.getElementById('cp-color-notes')?.value || '').trim();
        const normalizedCode = code.trim().toLowerCase();
        const duplicateColor = _colorsData.find(c => String(c.color_code || '').trim().toLowerCase() === normalizedCode);
        if (duplicateColor) {
            if (window.showToast) window.showToast('هذا اللون موجود بالفعل في ألوان هذا العميل', 'error');
            document.getElementById('cp-pantone-search')?.focus();
            return;
        }

        try {
            const btn = document.getElementById('cp-color-save-btn');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جاري الحفظ...'; }

            await window.apiFetch('/api/client-pantone-colors', {
                method: 'POST',
                body: { client_id: clientId, color_code: code, color_name: name || null, hex_value: hex || null, notes: notes || null }
            });

            if (window.showToast) window.showToast('تم إضافة اللون بنجاح', 'success');
            window._cpCloseColorModal();
            await _loadColors(clientId);
        } catch (err) {
            if (window.showToast) window.showToast(err.message || 'فشل الحفظ', 'error');
        } finally {
            const btn = document.getElementById('cp-color-save-btn');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check ml-1"></i> حفظ'; }
        }
    };

    window._cpDeleteColor = async function(colorId) {
        if (!confirm('هل تريد حذف هذا اللون؟')) return;
        try {
            await window.apiFetch(`/api/client-pantone-colors/${colorId}`, { method: 'DELETE' });
            if (window.showToast) window.showToast('تم حذف اللون', 'success');
            _colorsData = _colorsData.filter(c => c.id !== colorId);
            _renderColors();
        } catch (err) {
            if (window.showToast) window.showToast(err.message || 'فشل الحذف', 'error');
        }
    };

    // ── Client Items Tab ──────────────────────────────────────────────────────
    let _itemsData    = [];
    let _itemsLoaded  = false;
    let _itemsMonths  = 12;

    window._cpSetItemsPeriod = function(months) {
        if (_itemsMonths === months && _itemsLoaded) return;
        _itemsMonths = months;
        _itemsLoaded = false;

        // Update active button
        [1, 3, 6, 12, 24].forEach(m => {
            const btn = document.getElementById(`cp-period-${m}`);
            if (btn) btn.classList.toggle('active-period', m === months);
        });

        // Clear search
        const searchEl = document.getElementById('cp-items-search');
        if (searchEl) searchEl.value = '';

        _loadClientItems();
    };

    async function _loadClientItems() {
        if (_itemsLoaded) return;
        const clientId = window._cpClientId;
        if (!clientId) return;

        const tbody = document.getElementById('cp-items-tbody');
        const stats = document.getElementById('cp-items-stats');
        const badge = document.getElementById('tab-items-badge');

        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i></td></tr>`;
        if (stats) stats.innerHTML = '';

        try {
            const res = await window.apiFetch(`/api/client-items?client_id=${clientId}&months=${_itemsMonths}`);
            _itemsData = res.data || [];
            const summary = res.summary || {};
            _itemsLoaded = true;

            if (badge) badge.textContent = _itemsData.length;

            const periodLabel = _itemsMonths === 1 ? 'شهر واحد'
                : _itemsMonths < 12 ? `${_itemsMonths} أشهر`
                : _itemsMonths === 12 ? 'سنة'
                : `${_itemsMonths / 12} سنوات`;

            // Summary cards
            if (stats) {
                stats.innerHTML = [
                    { val: _itemsData.length,                                                               lbl: 'إجمالي الأصناف',             cls: 'text-teal-600' },
                    { val: Math.round(summary.total_stock_units || 0).toLocaleString('en-US'),              lbl: 'إجمالي المخزون',             cls: 'text-blue-600' },
                    { val: Math.round(summary.total_withdrawn_qty || 0).toLocaleString('en-US'),            lbl: `إجمالي السحب (${periodLabel})`, cls: 'text-purple-600' },
                    { val: (_itemsData.reduce((s,i) => s + (i.avg_monthly_withdrawal||0), 0) / (_itemsData.filter(i=>i.avg_monthly_withdrawal>0).length||1)).toFixed(1) + ' وحدة/شهر', lbl: 'متوسط السحب الشهري', cls: 'text-amber-600' },
                ].map(s => `
                    <div class="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center">
                        <p class="text-lg font-black ${s.cls}">${s.val}</p>
                        <p class="text-xs text-slate-400 mt-0.5">${s.lbl}</p>
                    </div>`).join('');
            }

            _renderItemsTable(_itemsData);
        } catch (err) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-red-400 text-sm"><i class="fa-solid fa-triangle-exclamation ml-1"></i>${err.message}</td></tr>`;
        }
    }

    function _renderItemsTable(items) {
        const tbody = document.getElementById('cp-items-tbody');
        const empty = document.getElementById('cp-items-empty');
        if (!tbody) return;

        if (!items.length) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        const smartStatus = (item) => {
            const withdrawn = parseFloat(item.total_withdrawn_qty || 0);
            const coverage = item.turnover_months;
            if (withdrawn <= 0) {
                return {
                    label: 'لا يوجد سحب',
                    action: 'راقب فقط',
                    cls: 'bg-slate-100 text-slate-500',
                    icon: 'fa-minus-circle',
                };
            }
            if (coverage !== null && coverage < 1) {
                return {
                    label: 'اطلب فوراً',
                    action: 'المخزون قرب يخلص',
                    cls: 'bg-red-100 text-red-700',
                    icon: 'fa-triangle-exclamation',
                };
            }
            if (coverage !== null && coverage < 2) {
                return {
                    label: 'تابع قريب',
                    action: 'جهز إعادة طلب',
                    cls: 'bg-amber-100 text-amber-700',
                    icon: 'fa-clock',
                };
            }
            return {
                label: 'آمن',
                action: 'لا يحتاج إجراء',
                cls: 'bg-emerald-100 text-emerald-700',
                icon: 'fa-circle-check',
            };
        };

        tbody.innerHTML = items.map(item => {
            const stockCoverage = item.turnover_months !== null
                ? `<span class="font-bold ${
                    item.turnover_months < 1  ? 'text-red-500' :
                    item.turnover_months < 2  ? 'text-amber-500' :
                    'text-emerald-600'
                  }">${item.turnover_months} شهر</span>`
                : `<span class="text-slate-300">—</span>`;

            const stockBadge = item.current_stock > 0
                ? `<span class="font-black text-blue-700">${Math.round(item.current_stock).toLocaleString('en-US')}</span>`
                : `<span class="text-slate-300">0</span>`;
            const status = smartStatus(item);

            return `
                <tr onclick="window._cpSelectItemAnalysis('${item.variant_id}')"
                    class="border-b border-slate-100 hover:bg-teal-50/60 transition-colors cursor-pointer">
                    <td class="py-3 px-4">
                        <p class="text-sm font-bold text-slate-800">${esc(item.product_name)}</p>
                        <p class="text-xs text-slate-400 mt-0.5">${esc(item.size_name)} ${item.category_name !== '—' ? '· ' + esc(item.category_name) : ''}</p>
                    </td>
                    <td class="py-3 px-4 text-xs font-mono text-slate-500 hidden sm:table-cell">${esc(item.product_code)}</td>
                    <td class="py-3 px-4 text-sm font-bold text-purple-700">${Math.round(item.total_withdrawn_qty || 0).toLocaleString('en-US')}</td>
                    <td class="py-3 px-4">${stockBadge}</td>
                    <td class="py-3 px-4 hidden md:table-cell">${stockCoverage}</td>
                    <td class="py-3 px-4 hidden md:table-cell">
                        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black ${status.cls}">
                            <i class="fa-solid ${status.icon}"></i>${status.label}
                        </span>
                        <p class="text-[11px] text-slate-400 mt-1">${status.action}</p>
                    </td>
                    <td class="py-3 px-4 text-xs text-slate-400 hidden lg:table-cell">${item.last_withdrawal_date ? date(item.last_withdrawal_date) : '—'}</td>
                </tr>`;
        }).join('');
    }

    window._cpSelectItemAnalysis = function(variantId) {
        const item = _itemsData.find(i => String(i.variant_id) === String(variantId));
        const box = document.getElementById('cp-item-analysis');
        if (!item || !box) return;

        const withdrawals = Array.isArray(item.withdrawals) ? item.withdrawals : [];
        const avg = parseFloat(item.avg_monthly_withdrawal || 0);
        const total = parseFloat(item.total_withdrawn_qty || 0);
        const stock = parseFloat(item.current_stock || 0);
        const coverage = item.turnover_months !== null ? `${item.turnover_months} شهر` : 'لا يوجد سحب كافٍ للحساب';
        const decision = total <= 0
            ? { title: 'لا توجد سحبيات على هذا الصنف في الفترة المختارة', text: 'لا يوجد قرار شراء حالياً. راقب الصنف فقط.', cls: 'bg-slate-100 text-slate-600' }
            : item.turnover_months !== null && item.turnover_months < 1
                ? { title: 'محتاج إعادة طلب فوراً', text: 'معدل السحب أعلى من المخزون المتاح، الأفضل تجهيز طلب جديد.', cls: 'bg-red-100 text-red-700' }
                : item.turnover_months !== null && item.turnover_months < 2
                    ? { title: 'تابعه قريباً', text: 'المخزون يكفي فترة قصيرة. جهز إعادة طلب قبل النفاد.', cls: 'bg-amber-100 text-amber-700' }
                    : { title: 'الوضع آمن', text: 'المخزون الحالي مناسب لمعدل السحب الحالي.', cls: 'bg-emerald-100 text-emerald-700' };
        const riskCls = item.turnover_months !== null && item.turnover_months < 1
            ? 'text-red-600 bg-red-50'
            : item.turnover_months !== null && item.turnover_months < 2
                ? 'text-amber-600 bg-amber-50'
                : 'text-emerald-600 bg-emerald-50';

        box.classList.remove('hidden');
        box.innerHTML = `
            <div class="flex flex-col lg:flex-row lg:items-start gap-4">
                <div class="flex-1 min-w-0">
                    <div class="flex items-start justify-between gap-3 mb-3">
                        <div>
                            <p class="text-xs font-bold text-teal-600 mb-1">تحليل سحبيات الصنف المحدد</p>
                            <h4 class="text-base font-black text-slate-800">${esc(item.product_name)}</h4>
                            <p class="text-xs text-slate-500 mt-0.5">${esc(item.size_name)} · ${esc(item.product_code)}</p>
                        </div>
                        <button onclick="event.stopPropagation(); document.getElementById('cp-item-analysis')?.classList.add('hidden')"
                                class="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-red-500">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="${decision.cls} rounded-xl px-4 py-3 mb-4">
                        <p class="text-sm font-black">${decision.title}</p>
                        <p class="text-xs opacity-80 mt-1">${decision.text}</p>
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                        <div class="bg-white rounded-xl border border-slate-100 p-3">
                            <p class="text-lg font-black text-purple-700">${Math.round(total).toLocaleString('en-US')}</p>
                            <p class="text-xs text-slate-400">إجمالي السحب</p>
                        </div>
                        <div class="bg-white rounded-xl border border-slate-100 p-3">
                            <p class="text-lg font-black text-amber-600">${avg.toFixed(1)}</p>
                            <p class="text-xs text-slate-400">متوسط السحب / شهر</p>
                        </div>
                        <div class="bg-white rounded-xl border border-slate-100 p-3">
                            <p class="text-lg font-black text-blue-700">${Math.round(stock).toLocaleString('en-US')}</p>
                            <p class="text-xs text-slate-400">المخزون الحالي</p>
                        </div>
                        <div class="${riskCls} rounded-xl border border-white/70 p-3">
                            <p class="text-lg font-black">${coverage}</p>
                            <p class="text-xs opacity-70">كفاية المخزون</p>
                        </div>
                    </div>
                </div>
                <div class="lg:w-80 bg-white rounded-xl border border-slate-100 overflow-hidden">
                    <div class="px-3 py-2 bg-slate-50 border-b border-slate-100 text-xs font-black text-slate-600">
                        سجل السحبيات داخل الفترة
                    </div>
                    <div class="max-h-56 overflow-y-auto">
                        ${withdrawals.length ? withdrawals.map(w => `
                            <div class="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-50 last:border-0">
                                <div>
                                    <p class="text-xs font-bold text-slate-700">${date(w.date)}</p>
                                    <p class="text-[11px] text-slate-400">${w.source_type === 'dispatch' ? 'صرف جزئي' : w.source_type === 'delivery_note' ? 'إذن تسليم' : 'حركة مخزون'}${w.reference_number ? ' #' + esc(w.reference_number) : ''}</p>
                                </div>
                                <span class="text-sm font-black text-purple-700">${Math.round(parseFloat(w.quantity || 0)).toLocaleString('en-US')}</span>
                            </div>
                        `).join('') : `
                            <div class="px-3 py-8 text-center text-xs text-slate-400">لا توجد سحبيات مسجلة لهذا الصنف في الفترة المختارة</div>
                        `}
                    </div>
                </div>
            </div>
        `;
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    window._cpFilterItems = function(q) {
        const filtered = (q || '').trim().toLowerCase()
            ? _itemsData.filter(i =>
                i.product_name.toLowerCase().includes(q.trim().toLowerCase()) ||
                i.product_code.toLowerCase().includes(q.trim().toLowerCase()) ||
                i.size_name.toLowerCase().includes(q.trim().toLowerCase())
              )
            : _itemsData;
        _renderItemsTable(filtered);
    };

    // ── Open Print Modal with default dates (Jan 1 → today) ──────────────────
    window._cpOpenPrintModal = function() {
        const today   = new Date();
        const yyyy    = today.getFullYear();
        const pad     = n => String(n).padStart(2, '0');
        const todayStr  = `${yyyy}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
        const startStr  = `${yyyy}-01-01`;

        const fromEl = document.getElementById('cp-print-from');
        const toEl   = document.getElementById('cp-print-to');
        if (fromEl) fromEl.value = startStr;
        if (toEl)   toEl.value   = todayStr;

        const modal = document.getElementById('cp-print-modal');
        if (modal) {
            modal.style.display = 'flex';
            requestAnimationFrame(() => modal.classList.add('opacity-100'));
        }
    };

    // ── Main init ─────────────────────────────────────────────────────────────
    async function _init() {
        _itemsLoaded = false;
        _itemsData   = [];
        _itemsMonths = 12;
        const clientId = window._cpClientId;
        if (!clientId) {
            document.getElementById('cp-loading')?.classList.add('hidden');
            const errEl = document.getElementById('cp-error');
            const msgEl = document.getElementById('cp-error-msg');
            if (msgEl) msgEl.textContent = 'لم يتم تحديد العميل. يرجى الانتقال من صفحة العملاء.';
            if (errEl) errEl.classList.remove('hidden');
            return;
        }

        try {
            const res  = await window.apiFetch(`/api/clients/${clientId}/profile`);
            const data = res?.data;
            if (!data) throw new Error('لم يتم إيجاد بيانات العميل.');

            document.getElementById('cp-loading')?.classList.add('hidden');
            document.getElementById('cp-content')?.classList.remove('hidden');

            _renderHeader(data.client);
            _renderStats(data.stats || {});
            _renderOrders(data.orders   || []);
            _renderInvoices(data.invoices || []);
            _renderPayments(data.payments || []);
            _renderDesigns(data.designs   || []);
            _renderBranches(data.branches || []);

            // Store profile data for printing
            window._cpProfileData = data;

            // Load pantone colors (separate API call)
            _loadColors(clientId);

            // Show print button
            const printBtn = document.getElementById('cp-print-btn');
            if (printBtn) printBtn.classList.remove('hidden');

        } catch (err) {
            document.getElementById('cp-loading')?.classList.add('hidden');
            const errEl = document.getElementById('cp-error');
            const msgEl = document.getElementById('cp-error-msg');
            if (msgEl) msgEl.textContent = err.message || 'حدث خطأ أثناء التحميل.';
            if (errEl) errEl.classList.remove('hidden');
        }
    }

    // ── Print Client Statement ────────────────────────────────────────────────
    window.printClientStatement = function(fromDate, toDate) {
        const data = window._cpProfileData;
        if (!data) return;
        const c = data.client;
        const stats = data.stats || {};

        const from = fromDate ? new Date(fromDate) : null;
        const to   = toDate   ? new Date(toDate + 'T23:59:59') : null;
        const inRange = (d) => {
            if (!d) return true;
            const dt = new Date(d);
            if (from && dt < from) return false;
            if (to   && dt > to)   return false;
            return true;
        };

        const orders   = (data.orders   || []).filter(o => inRange(o.order_date || o.created_at));
        const payments = (data.payments || []).filter(p => inRange(p.created_at));
        const invoices = (data.invoices || []).filter(i => inRange(i.created_at));
        const periodLabel = (from || to)
            ? `من ${from ? from.toLocaleDateString('en-GB') : '—'} إلى ${to ? to.toLocaleDateString('en-GB') : '—'}`
            : 'كامل الفترة';
        const PAY_M = { cash: 'نقداً', bank_transfer: 'تحويل بنكي', check: 'شيك', card: 'بطاقة' };

        const ordersRows = orders.map((o, i) => {
            const rem = Math.max(0, parseFloat(o.grand_total || 0) - parseFloat(o.paid_amount || 0));
            const statusLbl = { quote: 'عرض سعر', confirmed: 'مؤكد', production: 'إنتاج', processing: 'معالجة', completed: 'مكتمل', delivered: 'مُسلَّم', cancelled: 'ملغي' };
            return `<tr style="border-bottom:1px solid #e2e8f0; ${i % 2 === 1 ? 'background:#f8fafc;' : ''}}">
                <td style="padding:9px 12px; font-weight:700; color:#1e293b; font-family:monospace;">#${o.order_number}</td>
                <td style="padding:9px 12px; color:#64748b;">${date(o.order_date)}</td>
                <td style="padding:9px 12px;">${statusLbl[o.status] || o.status}</td>
                <td style="padding:9px 12px; text-align:center; color:#64748b;">${o.item_count || 0}</td>
                <td style="padding:9px 12px; font-weight:700; font-family:monospace;">${parseFloat(o.grand_total || 0).toFixed(2)}</td>
                <td style="padding:9px 12px; color:#059669; font-family:monospace;">${parseFloat(o.paid_amount || 0).toFixed(2)}</td>
                <td style="padding:9px 12px; color:${rem > 0 ? '#dc2626' : '#94a3b8'}; font-weight:${rem > 0 ? '700' : '400'}; font-family:monospace;">${rem.toFixed(2)}</td>
            </tr>`;
        }).join('');

        const paymentsRows = payments.map((p, i) => `
            <tr style="border-bottom:1px solid #e2e8f0; ${i % 2 === 1 ? 'background:#f8fafc;' : ''}">
                <td style="padding:8px 12px; color:#64748b;">${date(p.created_at)}</td>
                <td style="padding:8px 12px; font-family:monospace; color:#334155;">#${p.order_number}</td>
                <td style="padding:8px 12px; font-weight:700; color:#059669; font-family:monospace;">${parseFloat(p.amount || 0).toFixed(2)}</td>
                <td style="padding:8px 12px; color:#64748b;">${PAY_M[p.payment_method] || p.payment_method || '—'}</td>
                <td style="padding:8px 12px; color:#94a3b8;">${p.document_number || '—'}</td>
            </tr>`
        ).join('');

        const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>كشف حساب — ${esc(c.name)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',Tahoma,Arial,sans-serif; background:#fff; color:#1e293b; padding:30px; font-size:13px; }
  @media print { body{padding:10px;} .no-print{display:none!important;} @page{margin:15mm;} }
  h1 { font-size:22px; font-weight:900; color:#4b0082; }
  .sub { font-size:12px; color:#64748b; margin-top:2px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #4b0082; padding-bottom:16px; margin-bottom:20px; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:22px; }
  .stat-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 16px; text-align:center; }
  .stat-box .val { font-size:18px; font-weight:900; }
  .stat-box .lbl { font-size:11px; color:#94a3b8; margin-top:2px; }
  table { width:100%; border-collapse:collapse; margin-bottom:24px; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; }
  thead { background:linear-gradient(135deg,#4b0082,#6e329b); }
  thead th { padding:10px 12px; color:#fff; font-size:11px; font-weight:700; text-align:right; }
  .section-title { font-size:14px; font-weight:800; color:#4b0082; margin-bottom:10px; padding-bottom:6px; border-bottom:2px solid #e2e8f0; }
  .print-btn { position:fixed; bottom:20px; left:20px; padding:10px 22px; background:#4b0082; color:#ffd700; border:none; border-radius:10px; font-size:13px; font-weight:700; cursor:pointer; }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>G.PACK</h1>
    <p class="sub">كشف حساب عميل — ${periodLabel}</p>
  </div>
  <div style="text-align:left;">
    <div style="font-size:20px; font-weight:900; color:#1e293b;">${esc(c.name)}</div>
    ${c.phone ? `<div class="sub">${esc(c.phone)}</div>` : ''}
    ${c.city  ? `<div class="sub">${esc(c.city)}</div>` : ''}
    <div class="sub" style="margin-top:6px;">تاريخ الطباعة: ${new Date().toLocaleDateString('en-GB')}</div>
  </div>
</div>

<div class="stats">
  <div class="stat-box"><div class="val" style="color:#4b0082;">${stats.total_orders || 0}</div><div class="lbl">إجمالي الطلبات</div></div>
  <div class="stat-box"><div class="val" style="color:#059669;">${orders.reduce((s,o)=>s+parseFloat(o.grand_total||0),0).toFixed(2)}</div><div class="lbl">إجمالي القيمة</div></div>
  <div class="stat-box"><div class="val" style="color:#2563eb;">${payments.reduce((s,p)=>s+parseFloat(p.amount||0),0).toFixed(2)}</div><div class="lbl">إجمالي المدفوع</div></div>
  <div class="stat-box"><div class="val" style="color:#dc2626;">${Math.max(0,orders.reduce((s,o)=>s+parseFloat(o.grand_total||0),0)-payments.reduce((s,p)=>s+parseFloat(p.amount||0),0)).toFixed(2)}</div><div class="lbl">المتبقي المستحق</div></div>
</div>

<p class="section-title">سجل الطلبات</p>
<table>
  <thead><tr>
    <th>رقم الطلب</th><th>التاريخ</th><th>الحالة</th><th style="text-align:center;">الأصناف</th>
    <th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th>
  </tr></thead>
  <tbody>${ordersRows || '<tr><td colspan="7" style="padding:12px;text-align:center;color:#94a3b8;">لا توجد طلبات</td></tr>'}</tbody>
</table>

<p class="section-title">سجل الدفعات</p>
<table>
  <thead><tr>
    <th>التاريخ</th><th>رقم الطلب</th><th>المبلغ</th><th>طريقة الدفع</th><th>رقم المستند</th>
  </tr></thead>
  <tbody>${paymentsRows || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#94a3b8;">لا توجد دفعات</td></tr>'}</tbody>
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

    // ── Print Invoice from profile page ──────────────────────────────────────
    window.printInvoiceFromProfile = async function(invoiceId) {
        try {
            const data = window._cpProfileData;
            if (!data) return;
            const inv_meta = (data.invoices || []).find(i => i.id === invoiceId);
            if (!inv_meta) return;

            // Need full invoice data including items — fetch via orders/:orderId/invoice/:invoiceId
            // Find order_id from orders list that matches order_number
            const order = (data.orders || []).find(o => String(o.order_number) === String(inv_meta.order_number));
            if (!order) { alert('تعذر تحديد الطلب لهذه الفاتورة.'); return; }

            const res = await window.apiFetch(`/api/orders/${order.id}/invoice/${invoiceId}`);
            const inv = res?.data;
            if (!inv) { alert('تعذر تحميل بيانات الفاتورة.'); return; }

            const items = inv.items || [];
            const paymentsInv = inv.payments || [];
            const totalPaid = paymentsInv.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
            const remaining = Math.max(0, parseFloat(inv.grand_total || 0) - totalPaid);
            const isProforma = inv.status !== 'issued';
            const PAY_M = { cash: 'نقدي', bank_transfer: 'تحويل بنكي', check: 'شيك', card: 'بطاقة' };

            const itemRows = items.map((item, idx) => `
                <tr>
                    <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;color:#64748b;">${idx+1}</td>
                    <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#1e293b;">${item.product_name || '—'} ${item.size_name || ''}</td>
                    <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${parseFloat(item.quantity || 0)}</td>
                    <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-family:monospace;">${parseFloat(item.unit_price || 0).toFixed(2)}</td>
                    <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;font-family:monospace;">${parseFloat(item.line_total || parseFloat(item.quantity)*parseFloat(item.unit_price)).toFixed(2)}</td>
                </tr>`).join('');

            const payRows = paymentsInv.map(p => `
                <tr>
                    <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;">${new Date(p.created_at).toLocaleDateString('en-GB')}</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;">${PAY_M[p.payment_method] || p.payment_method || '—'}</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#059669;font-family:monospace;">${parseFloat(p.amount||0).toFixed(2)}</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#94a3b8;">${p.description || '—'}</td>
                </tr>`).join('');

            const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>${isProforma ? 'فاتورة أولية' : 'فاتورة نهائية'} #${inv.invoice_number}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#fff;color:#1e293b;padding:30px;}
  @media print{body{padding:15px;}.no-print{display:none!important;}@page{margin:15mm;}}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:18px;border-bottom:3px solid #4b0082;}
  .logo h1{font-size:24px;font-weight:900;color:#4b0082;}
  .logo p{font-size:12px;color:#64748b;margin-top:3px;}
  .inv-meta{text-align:left;}
  .inv-meta .num{font-size:22px;font-weight:900;}
  .inv-meta .dt{font-size:12px;color:#64748b;margin-top:4px;}
  .badge{display:inline-block;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;margin-top:8px;}
  .badge-final{background:#ffd700;color:#4b0082;}
  .badge-proforma{background:#fff7cc;color:#5d198e;}
  .client-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:22px;background:#f8fafc;border-radius:12px;padding:18px;border:1px solid #e2e8f0;}
  .client-grid h4{font-size:11px;color:#94a3b8;font-weight:700;margin-bottom:5px;text-transform:uppercase;}
  .client-grid p{font-size:14px;font-weight:600;}
  .client-grid .sub{font-size:12px;color:#64748b;margin-top:2px;}
  table{width:100%;border-collapse:collapse;margin-bottom:20px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;}
  thead{background:linear-gradient(135deg,#4b0082,#6e329b);}
  thead th{padding:11px 12px;color:#fff;font-size:12px;font-weight:700;text-align:center;}
  thead th:nth-child(2){text-align:right;}
  .totals{display:flex;justify-content:flex-end;margin-bottom:20px;}
  .totals-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;min-width:280px;}
  .tr{display:flex;justify-content:space-between;padding:7px 0;font-size:13px;border-bottom:1px solid #f1f5f9;}
  .tr:last-child{border-bottom:none;}
  .tr.grand{font-size:17px;font-weight:900;color:#4b0082;padding-top:10px;border-top:2px solid #4b0082;}
  .tr.paid{color:#059669;font-weight:700;}
  .tr.rem{color:#dc2626;font-weight:800;font-size:15px;padding-top:9px;border-top:2px dashed #fca5a5;}
  .footer{text-align:center;padding-top:16px;border-top:2px solid #ffd700;margin-top:24px;}
  .footer p{font-size:11px;color:#94a3b8;}
  .print-btn{position:fixed;bottom:20px;left:20px;padding:10px 22px;background:#4b0082;color:#ffd700;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;}
</style>
</head>
<body>
<div class="header">
  <div class="logo"><h1>G.PACK</h1><p>إدارة الإنتاج والمبيعات</p></div>
  <div class="inv-meta">
    <div class="num">#${inv.invoice_number || '—'}</div>
    <div class="dt">${new Date(inv.created_at || Date.now()).toLocaleDateString('en-GB')}</div>
    <span class="badge ${isProforma ? 'badge-proforma' : 'badge-final'}">${isProforma ? 'فاتورة أولية' : 'فاتورة نهائية'}</span>
  </div>
</div>

<div class="client-grid">
  <div><h4>العميل</h4><p>${inv.client_name || '—'}</p>${inv.client_phone ? `<p class="sub">${inv.client_phone}</p>` : ''}</div>
  <div><h4>رقم الطلب</h4><p>#${inv.order_number || '—'}</p></div>
</div>

<table>
  <thead><tr>
    <th style="width:40px;">#</th><th style="text-align:right;">المنتج</th>
    <th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>

<div class="totals"><div class="totals-box">
  <div class="tr"><span>المجموع قبل الضريبة</span><span style="font-family:monospace;font-weight:700;">${parseFloat(inv.subtotal||0).toFixed(2)}</span></div>
  <div class="tr"><span>ضريبة القيمة المضافة (${taxPct(inv.tax_rate)}%)</span><span style="font-family:monospace;">${parseFloat(inv.tax_amount||0).toFixed(2)}</span></div>
  <div class="tr grand"><span>الإجمالي الكلي</span><span style="font-family:monospace;">${parseFloat(inv.grand_total||0).toFixed(2)}</span></div>
  <div class="tr paid"><span>إجمالي المدفوع</span><span style="font-family:monospace;">${totalPaid.toFixed(2)}</span></div>
  <div class="tr rem"><span>المتبقي</span><span style="font-family:monospace;">${remaining.toFixed(2)}</span></div>
</div></div>

${paymentsInv.length ? `
<p style="font-size:14px;font-weight:800;color:#4b0082;margin-bottom:10px;">سجل الدفعات</p>
<table style="border-color:#ffd700;">
  <thead style="background:linear-gradient(135deg,#ffd700,#ffeb7f);"><tr>
    <th style="color:#4b0082;">التاريخ</th><th style="color:#4b0082;">طريقة الدفع</th>
    <th style="color:#4b0082;">المبلغ</th><th style="color:#4b0082;">الوصف</th>
  </tr></thead>
  <tbody>${payRows}</tbody>
</table>` : ''}

<div class="footer"><p>شكراً لتعاملكم معنا — G.PACK</p></div>
<button class="no-print print-btn" onclick="window.print()">طباعة</button>
</body></html>`;

            const w = window.open('', '_blank', 'width=900,height=700');
            if (!w) { alert('يرجى السماح بالنوافذ المنبثقة.'); return; }
            w.document.write(html);
            w.document.close();
            setTimeout(() => w.print(), 600);
        } catch(err) {
            alert('حدث خطأ أثناء تحميل الفاتورة: ' + err.message);
        }
    };

    _init();

})();
