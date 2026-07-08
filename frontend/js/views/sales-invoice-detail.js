'use strict';

// =============================================================================
// G.PACK 2.0 — Sales Invoice Detail Controller
// عرض تفاصيل فاتورة مبيعات
// =============================================================================

(function() {
    const _el = (id) => document.getElementById(id);
    const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

    let _invoiceId = null;
    let _invoiceData = null;
    let _orderId = null;

    function _buildExpenseLineItems(inv) {
        const unitLabel = 'حبة';
        return (inv?.expenses || []).map(exp => ({
            product_name: exp.description || 'مصاريف إضافية',
            size_name: unitLabel,
            quantity: 1,
            unit_price: parseFloat(exp.amount || 0),
            line_total: parseFloat(exp.amount || 0),
            discount_percent: 0,
            isExpense: true,
            unit_label: unitLabel,
        }));
    }

    // ── Init ───────────────────────────────────────────────────────────────────
    function _init() {
        // Get invoice ID from URL hash query
        const hash = window.location.hash || '';
        const match = hash.match(/[?&]id=([^&]+)/);
        _invoiceId = match ? match[1] : null;

        if (!_invoiceId) {
            _el('sid-invoice-card').innerHTML = `
                <div class="flex flex-col items-center justify-center py-16 text-slate-400">
                    <i class="fa-solid fa-circle-exclamation text-5xl mb-4 text-red-300"></i>
                    <p class="text-lg font-semibold text-slate-500">لم يتم تحديد فاتورة</p>
                    <button onclick="window.navigateTo('sales-invoices')"
                        class="mt-5 px-5 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 transition-colors">
                        العودة للفواتير
                    </button>
                </div>`;
            return;
        }

        _loadInvoice();
    }

    // ── Load Invoice ───────────────────────────────────────────────────────────
    async function _loadInvoice() {
        try {
            const res = await window.apiFetch(`/api/invoices/${_invoiceId}`);
            _invoiceData = res.data;
            _orderId = _invoiceData.order_id;

            _renderInvoice();
        } catch (err) {
            _el('sid-invoice-card').innerHTML = `
                <div class="flex flex-col items-center justify-center py-16 text-slate-400">
                    <i class="fa-solid fa-circle-exclamation text-5xl mb-4 text-red-300"></i>
                    <p class="text-lg font-semibold text-slate-500">خطأ في تحميل الفاتورة</p>
                    <p class="text-sm text-slate-400 mt-1">${esc(err.message)}</p>
                    <button onclick="window.navigateTo('sales-invoices')"
                        class="mt-5 px-5 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 transition-colors">
                        العودة للفواتير
                    </button>
                </div>`;
        }
    }

    // ── Render Invoice ─────────────────────────────────────────────────────────
    function _renderInvoice() {
        const inv = _invoiceData;

        // Header info
        _el('sid-header-info').textContent = `فاتورة #${inv.invoice_number} - ${inv.client_name}`;

        // Actions based on status
        const actionsEl = _el('sid-actions');
        const statusColors = {
            draft: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'مسودة' },
            proforma: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'صورية' },
            final: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'نهائية' },
            cancelled: { bg: 'bg-red-100', text: 'text-red-700', label: 'ملغية' },
        };
        const st = statusColors[inv.status] || statusColors.draft;

        actionsEl.innerHTML = `
            <span class="px-3 py-1.5 rounded-lg text-xs font-bold ${st.bg} ${st.text}">${st.label}</span>
            <button onclick="window.sidPrint()" class="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 hover:bg-brand-100 hover:text-brand-600 transition-all" title="طباعة">
                <i class="fa-solid fa-print"></i>
            </button>
        `;

        // Invoice number & status
        _el('sid-invoice-number').textContent = `#${inv.invoice_number}`;
        _el('sid-status-badge').className = `px-3 py-1 rounded-lg text-xs font-bold ${st.bg} ${st.text}`;
        _el('sid-status-badge').textContent = st.label;

        // Dates
        _el('sid-invoice-date').textContent = new Date(inv.invoice_date).toLocaleDateString('ar-SA-u-nu-latn');
        _el('sid-due-date').textContent = inv.due_date 
            ? new Date(inv.due_date).toLocaleDateString('ar-SA-u-nu-latn') 
            : 'غير محدد';

        // Client info
        _el('sid-client-name').textContent = esc(inv.client_name || '---');
        _el('sid-client-phone').textContent = esc(inv.client_phone || '---');
        _el('sid-client-city').textContent = esc(inv.client_city || '---');

        // Items
        const itemsTbody = _el('sid-items-tbody');
        const combinedItems = [...(inv.items || []), ..._buildExpenseLineItems(inv)];

        if (combinedItems.length > 0) {
            itemsTbody.innerHTML = combinedItems.map((item, idx) => `
                <tr class="border-b border-slate-100">
                    <td class="py-3 px-4 text-slate-500">${idx + 1}</td>
                    <td class="py-3 px-4 font-semibold text-slate-800">
                        ${esc(item.product_name)}
                        ${item.isExpense ? '<span class="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">مصاريف</span>' : ''}
                    </td>
                    <td class="py-3 px-4 text-slate-600">${item.isExpense ? item.unit_label : esc(item.size_name || '-')}</td>
                    <td class="py-3 px-4 text-center font-mono text-slate-700">${item.isExpense ? 1 : item.quantity}</td>
                    <td class="py-3 px-4 font-mono text-slate-700">${fmt(item.unit_price)}</td>
                    <td class="py-3 px-4 font-mono text-red-600">${item.discount_percent > 0 ? item.discount_percent + '%' : '-'}</td>
                    <td class="py-3 px-4 font-bold font-mono text-emerald-600">${fmt(item.line_total || (item.quantity * item.unit_price))}</td>
                </tr>
            `).join('');
        } else {
            itemsTbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400">لا توجد أصناف</td></tr>`;
        }

        // Expenses
        if (inv.expenses && inv.expenses.length > 0) {
            _el('sid-expenses-section').classList.remove('hidden');
            _el('sid-expenses-tbody').innerHTML = inv.expenses.map(exp => `
                <tr class="border-b border-slate-100">
                    <td class="py-2 px-4 text-slate-700">${esc(exp.description)}</td>
                    <td class="py-2 px-4 font-mono text-slate-700">${fmt(exp.amount)}</td>
                </tr>
            `).join('');
        }

        // Totals
        _el('sid-subtotal').textContent = fmt(inv.subtotal);
        _el('sid-tax-rate').textContent = Math.round((inv.tax_rate || 0) * 100);
        _el('sid-tax-amount').textContent = fmt(inv.tax_amount);
        _el('sid-grand-total').textContent = fmt(inv.grand_total);
        _el('sid-paid-amount').textContent = fmt(inv.paid_amount);
        
        const remaining = parseFloat(inv.grand_total || 0) - parseFloat(inv.paid_amount || 0);
        _el('sid-remaining').textContent = fmt(remaining);
        
        if (remaining <= 0) {
            _el('sid-remaining-row').classList.add('hidden');
        }

        // Order link
        if (inv.order_id && inv.order_number) {
            _el('sid-order-section').classList.remove('hidden');
            _el('sid-order-number').textContent = `#${inv.order_number}`;
        }

        // Notes
        if (inv.notes) {
            _el('sid-notes-section').classList.remove('hidden');
            _el('sid-notes').textContent = esc(inv.notes);
        }

        // Footer
        _el('sid-created-by').textContent = esc(inv.created_by_name || '---');
        _el('sid-created-at').textContent = new Date(inv.created_at).toLocaleString('en-GB');
    }

    // ── View Order ──────────────────────────────────────────────────────────────
    window.sidViewOrder = function() {
        if (_orderId) {
            window.navigateTo(`production_orders?id=${_orderId}`);
        }
    };

    // ── Print ────────────────────────────────────────────────────────────────────
    window.sidPrint = function() {
        const inv = _invoiceData;
        if (!inv) return;

        const statusLabels = { draft: 'مسودة', proforma: 'صورية', final: 'نهائية', cancelled: 'ملغية' };
        const statusColors = { draft: '#64748b', proforma: '#d97706', final: '#15803d', cancelled: '#dc2626' };
        const statusBgs    = { draft: '#f1f5f9', proforma: '#fef3c7', final: '#dcfce7', cancelled: '#fee2e2' };
        const statusText  = statusLabels[inv.status] || inv.status;
        const statusColor = statusColors[inv.status] || '#64748b';
        const statusBg    = statusBgs[inv.status] || '#f1f5f9';

        const itemsRows = [...(inv.items || []), ..._buildExpenseLineItems(inv)].map((item, idx) => `
            <tr>
                <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;color:#94a3b8">${idx + 1}</td>
                <td style="padding:8px 10px;border:1px solid #e2e8f0;font-weight:600">${esc(item.product_name)}${item.isExpense ? ' <span style="font-size:10px;background:#fef9c3;color:#92400e;padding:1px 6px;border-radius:6px;margin-right:6px">مصاريف</span>' : ''}</td>
                <td style="padding:8px 10px;border:1px solid #e2e8f0;color:#64748b">${item.isExpense ? (item.unit_label || 'حبة') : esc(item.size_name || '-')}</td>
                <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;font-family:monospace">${item.isExpense ? 1 : item.quantity}</td>
                <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:left;font-family:monospace">${fmt(item.unit_price)}</td>
                <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;color:#dc2626;font-family:monospace">${item.discount_percent > 0 ? item.discount_percent + '%' : '-'}</td>
                <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:left;font-family:monospace;font-weight:700;color:#15803d">${fmt(item.line_total || (item.quantity * item.unit_price))}</td>
            </tr>`).join('');

        const expensesSection = (inv.expenses && inv.expenses.length > 0) ? `
            <div style="margin-top:20px">
                <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">مصاريف إضافية</div>
                <table style="width:100%;border-collapse:collapse">
                    <thead><tr style="background:#fefce8">
                        <th style="padding:7px 10px;border:1px solid #fde68a;text-align:right;font-size:12px">البيان</th>
                        <th style="padding:7px 10px;border:1px solid #fde68a;text-align:left;font-size:12px">المبلغ</th>
                    </tr></thead>
                    <tbody>${inv.expenses.map(e => `
                        <tr>
                            <td style="padding:7px 10px;border:1px solid #e2e8f0">${esc(e.description)}</td>
                            <td style="padding:7px 10px;border:1px solid #e2e8f0;font-family:monospace;text-align:left">${fmt(e.amount)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>` : '';

        const remaining = parseFloat(inv.grand_total || 0) - parseFloat(inv.paid_amount || 0);

        const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>فاتورة مبيعات #${inv.invoice_number}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  * { font-family: 'Cairo', sans-serif; margin: 0; padding: 0; box-sizing: border-box; }
  body { padding: 36px 48px; color: #1e293b; font-size: 13px; direction: rtl; }
  @media print { body { padding: 24px 32px; } }
</style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
    <div>
      <div style="font-size:26px;font-weight:900;color:#2563eb">G.PACK</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px">فاتورة مبيعات</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">Sales Invoice</div>
    </div>
    <div style="text-align:left">
      <div style="font-size:32px;font-weight:900;color:#2563eb;font-family:monospace">#${inv.invoice_number}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px">${new Date(inv.invoice_date).toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'})}</div>
      <div style="margin-top:6px;display:inline-block;background:${statusBg};color:${statusColor};padding:3px 10px;border-radius:4px;font-size:12px;font-weight:700">${statusText}</div>
    </div>
  </div>
  <hr style="border:none;border-top:2px solid #e2e8f0;margin-bottom:20px">

  <!-- Client + Invoice Info -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px">
    <div>
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">بيانات العميل</div>
      <div style="font-weight:700;font-size:16px">${esc(inv.client_name || '---')}</div>
      ${inv.client_phone ? `<div style="color:#64748b;font-size:12px;margin-top:3px">${esc(inv.client_phone)}</div>` : ''}
      ${inv.client_city  ? `<div style="color:#94a3b8;font-size:11px;margin-top:2px">${esc(inv.client_city)}</div>` : ''}
    </div>
    <div style="text-align:left">
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">تفاصيل الفاتورة</div>
      <div style="font-size:12px;color:#475569;margin-bottom:2px">تاريخ الاستحقاق: <strong>${inv.due_date ? new Date(inv.due_date).toLocaleDateString('ar-SA-u-nu-latn') : 'غير محدد'}</strong></div>
      ${inv.order_number ? `<div style="font-size:12px;color:#475569">أمر التشغيل: <strong>#${inv.order_number}</strong></div>` : ''}
    </div>
  </div>

  <!-- Items -->
  <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">الأصناف</div>
  <table style="width:100%;border-collapse:collapse">
    <thead>
      <tr style="background:#f8fafc">
        <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;font-size:11px">#</th>
        <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;font-size:11px">المنتج</th>
        <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;font-size:11px">المقاس</th>
        <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;font-size:11px">الكمية</th>
        <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:left;font-size:11px">السعر</th>
        <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;font-size:11px">الخصم</th>
        <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:left;font-size:11px">الإجمالي</th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
  </table>

  ${expensesSection}

  <!-- Totals -->
  <div style="display:flex;justify-content:flex-end;margin-top:20px">
    <div style="width:260px">
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
        <span style="color:#64748b">المجموع الفرعي</span>
        <span style="font-family:monospace;font-weight:600">${fmt(inv.subtotal)} ريال</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
        <span style="color:#64748b">الضريبة (${Math.round((inv.tax_rate || 0) * 100)}%)</span>
        <span style="font-family:monospace;font-weight:600">${fmt(inv.tax_amount)} ريال</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:16px;font-weight:900;border-top:2px solid #e2e8f0;margin-top:4px">
        <span>الإجمالي</span>
        <span style="color:#15803d;font-family:monospace">${fmt(inv.grand_total)} ريال</span>
      </div>
      ${parseFloat(inv.paid_amount) > 0 ? `
      <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:13px">
        <span style="color:#2563eb">المدفوع</span>
        <span style="font-family:monospace;color:#2563eb;font-weight:600">${fmt(inv.paid_amount)} ريال</span>
      </div>` : ''}
      ${remaining > 0 ? `
      <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:13px;font-weight:700">
        <span style="color:#dc2626">المتبقي</span>
        <span style="font-family:monospace;color:#dc2626">${fmt(remaining)} ريال</span>
      </div>` : ''}
    </div>
  </div>

  ${inv.notes ? `<div style="margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;padding:10px 14px;border-radius:6px;font-size:12px;color:#475569">ملاحظات: ${esc(inv.notes)}</div>` : ''}

  <!-- Signatures -->
  <div style="margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:48px;text-align:center">
    <div style="border-top:1px solid #cbd5e1;padding-top:8px;font-size:11px;color:#64748b">توقيع العميل</div>
    <div style="border-top:1px solid #cbd5e1;padding-top:8px;font-size:11px;color:#64748b">توقيع المحاسب</div>
  </div>
  <div style="margin-top:20px;text-align:center;font-size:10px;color:#94a3b8;border-top:1px dashed #cbd5e1;padding-top:12px">
    بواسطة: ${esc(inv.created_by_name || 'النظام')} &nbsp;|&nbsp; تاريخ الطباعة: ${new Date().toLocaleDateString('ar-SA-u-nu-latn')} &nbsp;|&nbsp; G.PACK ERP 2.0
  </div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>
</body></html>`;

        const w = window.open('', '_blank', 'width=900,height=700');
        w.document.write(html);
        w.document.close();
    };

    // ── Start ───────────────────────────────────────────────────────────────────
    _init();
})();
