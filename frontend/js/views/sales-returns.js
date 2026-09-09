'use strict';

(function () {
    let _invoices = [];
    let _currentInvoice = null;
    let _searchTimer = null;
    const el = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const money = value => parseFloat(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    async function srLoadReturns() {
        const body = el('sr-list');
        if (!body) return;
        try {
            const res = await window.apiFetch('/api/sales-returns');
            const rows = res.data || [];
            body.innerHTML = rows.length ? rows.map(row => `<tr class="border-b border-slate-100">
                <td class="p-3 font-bold">#${esc(row.return_number)}</td><td class="p-3">#${esc(row.invoice_number)}</td>
                <td class="p-3">${esc(row.client_name)}</td><td class="p-3">${esc(row.return_date)}</td>
                <td class="p-3 font-bold text-emerald-700">${money(row.total_amount)}</td>
                <td class="p-3 text-xs">${row.return_action === 'cash_refund' ? 'رد نقدي' : 'إشعار دائن'}</td>
                <td class="p-3"><span class="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-bold">${row.status === 'completed' ? 'معتمد' : 'ملغى'}</span></td>
            </tr>`).join('') : '<tr><td colspan="7" class="p-8 text-center text-slate-400">لا توجد مرتجعات</td></tr>';
        } catch (err) {
            body.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-red-500">${esc(err.message)}</td></tr>`;
        }
    }

    async function srSearchInvoices() {
        const query = el('sr-invoice-search')?.value || '';
        const hint = el('sr-search-hint');
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(async () => {
            try {
                const res = await window.apiFetch(`/api/sales-returns/eligible-invoices?search=${encodeURIComponent(query)}`);
                _invoices = res.data || [];
                const select = el('sr-invoice');
                select.innerHTML = '<option value="">— اختر فاتورة —</option>' + _invoices.map(i => `<option value="${esc(i.id)}">#${esc(i.invoice_number)} — ${esc(i.client_name)} — ${money(i.grand_total)}</option>`).join('');
                if (hint) {
                    if (_invoices.length) {
                        hint.textContent = `${_invoices.length} فاتورة متاحة — اختر من القائمة`;
                        hint.className = 'text-xs text-emerald-600 mt-1.5 min-h-[18px]';
                    } else {
                        hint.textContent = query ? 'لا توجد فواتير مطابقة — تأكد من رقم الفاتورة أو الاسم أو حالة التسليم' : 'لا توجد فواتير مُسلّمة متاحة للمرتجع';
                        hint.className = 'text-xs text-amber-600 mt-1.5 min-h-[18px]';
                    }
                }
                // Auto-open the select to make results visible when there are matches
                if (_invoices.length) {
                    const sel = el('sr-invoice');
                    sel.size = Math.min(6, _invoices.length + 1);
                } else {
                    const sel = el('sr-invoice');
                    sel.size = 1;
                }
            } catch (err) { 
                window.showToast?.(err.message || 'فشل البحث', 'error');
                if (hint) { hint.textContent = 'خطأ في البحث'; hint.className = 'text-xs text-red-500 mt-1.5'; }
            }
        }, 250);
    }

    async function srOpenForm() {
        _currentInvoice = null;
        el('sr-modal').classList.remove('hidden');
        el('sr-modal').classList.add('flex');
        el('sr-invoice-search').value = '';
        el('sr-items').innerHTML = '<tr><td colspan="5" class="p-7 text-center text-slate-400">اختر الفاتورة أولاً</td></tr>';
        el('sr-invoice-meta').classList.add('hidden');
        el('sr-total').textContent = '0.00';
        await srSearchInvoices();
    }

    function srCloseForm() {
        el('sr-modal')?.classList.add('hidden');
        el('sr-modal')?.classList.remove('flex');
    }

    async function srInvoiceChanged(invoiceId) {
        if (!invoiceId) return;
        el('sr-invoice').size = 1;
        try {
            const res = await window.apiFetch(`/api/sales-returns/by-invoice/${invoiceId}`);
            _currentInvoice = res.data;
            const meta = el('sr-invoice-meta');
            meta.classList.remove('hidden');
            meta.innerHTML = `<div class="bg-slate-50 rounded-lg p-2"><span class="text-slate-400 block text-xs">العميل</span><b>${esc(_currentInvoice.invoice.client_name)}</b></div><div class="bg-slate-50 rounded-lg p-2"><span class="text-slate-400 block text-xs">الفاتورة</span><b>#${esc(_currentInvoice.invoice.invoice_number)}</b></div><div class="bg-slate-50 rounded-lg p-2"><span class="text-slate-400 block text-xs">الإجمالي</span><b>${money(_currentInvoice.invoice.grand_total)}</b></div>`;
            const warehouses = await window.apiFetch(`/api/sales-returns/warehouses?client_id=${encodeURIComponent(_currentInvoice.invoice.client_id)}`);
            el('sr-warehouse').innerHTML = '<option value="">— اختر المستودع —</option>' + (warehouses.data || []).map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('');
            el('sr-items').innerHTML = _currentInvoice.items.map((item, index) => `<tr class="border-b border-slate-100" data-index="${index}">
                <td class="p-3 font-semibold">${esc(item.product_name)}</td><td class="p-3 text-slate-500">${esc(item.size_name || '—')}</td>
                <td class="p-3 text-center text-emerald-700 font-bold">${money(item.remaining_qty)}</td>
                <td class="p-3 text-center"><input type="number" min="0" max="${item.remaining_qty}" step="0.001" value="0" data-return-qty class="w-24 border border-slate-200 rounded-lg p-2 text-center" oninput="window.srCalc()"></td>
                <td class="p-3 text-center font-mono" data-return-total>0.00</td>
            </tr>`).join('') || '<tr><td colspan="5" class="p-7 text-center text-slate-400">لا توجد كميات متاحة للمرتجع</td></tr>';
            srCalc();
        } catch (err) { window.showToast?.(err.message || 'فشل تحميل الفاتورة', 'error'); }
    }

    function srCalc() {
        if (!_currentInvoice) return;
        let total = 0;
        document.querySelectorAll('#sr-items tr[data-index]').forEach(row => {
            const index = Number(row.dataset.index);
            const item = _currentInvoice.items[index];
            const quantity = parseFloat(row.querySelector('[data-return-qty]')?.value || 0);
            const line = quantity * parseFloat(item.unit_price || 0);
            total += line;
            row.querySelector('[data-return-total]').textContent = money(line);
        });
        el('sr-total').textContent = money(total * (1 + parseFloat(_currentInvoice.invoice.tax_rate || 0)));
    }

    async function srSave() {
        if (!_currentInvoice) return window.showToast?.('اختر الفاتورة أولاً', 'error');
        const warehouseId = el('sr-warehouse').value;
        if (!warehouseId) return window.showToast?.('اختر مستودع الإرجاع', 'error');
        const items = [...document.querySelectorAll('#sr-items tr[data-index]')].map(row => {
            const item = _currentInvoice.items[Number(row.dataset.index)];
            return { invoice_item_id: item.invoice_item_id, quantity: parseFloat(row.querySelector('[data-return-qty]')?.value || 0) };
        }).filter(item => item.quantity > 0);
        if (!items.length) return window.showToast?.('أدخل كمية مرتجعة واحدة على الأقل', 'error');
        const button = el('sr-save');
        button.disabled = true;
        try {
            await window.apiFetch('/api/sales-returns', { method: 'POST', body: {
                invoice_id: _currentInvoice.invoice.id,
                destination_warehouse_id: warehouseId,
                return_action: el('sr-action').value,
                return_date: new Date().toISOString().slice(0, 10),
                notes: el('sr-notes').value || null,
                items,
            }});
            window.showToast?.('تم اعتماد المرتجع وإضافة البضاعة للمخزون', 'success');
            srCloseForm();
            await srLoadReturns();
        } catch (err) { window.showToast?.(err.message || 'فشل اعتماد المرتجع', 'error'); }
        finally { button.disabled = false; }
    }

    window.srLoadReturns = srLoadReturns;
    window.srOpenForm = srOpenForm;
    window.srCloseForm = srCloseForm;
    window.srSearchInvoices = srSearchInvoices;
    window.srInvoiceChanged = srInvoiceChanged;
    window.srCalc = srCalc;
    window.srSave = srSave;
    srLoadReturns();
})();
