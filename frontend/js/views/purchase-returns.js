'use strict';

// =============================================================================
// G.PACK 2.0 - Purchase Returns View Controller
// =============================================================================

(function () {

    const fmt  = (v) => parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc  = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _el  = (id) => document.getElementById(id);
    const date = (d)  => d ? new Date(d).toLocaleDateString('en-GB') : '—';

    const LIMIT = 20;
    let _page   = 0;
    let _total  = 0;
    let _suppliers = [];
    let _invoices  = [];
    let _products  = [];
    let _itemCount = 0;
    let _activeDetailId = null;

    // ─────────────────────────────────────────────────────────────────────────
    // Load initial data
    // ─────────────────────────────────────────────────────────────────────────
    async function _loadData() {
        try {
            const [supRes, prodRes] = await Promise.all([
                window.apiFetch('/api/suppliers?limit=500'),
                window.apiFetch('/api/products?limit=500'),
            ]);
            _suppliers = supRes.data || [];
            _products  = prodRes.data || [];
            _renderSupplierFilters();
        } catch (_) {}
    }

    function _renderSupplierFilters() {
        const sel = _el('pr-supplier-filter');
        if (!sel) return;
        sel.innerHTML = '<option value="">كل الموردين</option>' +
            _suppliers.map(s => `<option value="${s.id}">${esc(s.name || s.company_name)}</option>`).join('');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Load returns list
    // ─────────────────────────────────────────────────────────────────────────
    async function _load() {
        _el('pr-loading')?.classList.remove('hidden');
        _el('pr-table-wrap')?.classList.add('hidden');
        _el('pr-empty')?.classList.add('hidden');
        _el('pr-pagination')?.classList.add('hidden');
        _el('pr-stat-count').textContent   = '0';
        _el('pr-stat-amount').textContent   = '0.00';
        _el('pr-stat-avg').textContent     = '0.00';

        const search    = _el('pr-search')?.value.trim() || '';
        const supplier  = _el('pr-supplier-filter')?.value || '';
        const dateFrom  = _el('pr-date-from')?.value || '';
        const dateTo    = _el('pr-date-to')?.value   || '';

        const params = new URLSearchParams({
            limit:  LIMIT,
            offset: _page * LIMIT,
            ...(search   && { search }),
            ...(supplier && { supplier_id: supplier }),
            ...(dateFrom && { date_from: dateFrom }),
            ...(dateTo   && { date_to: dateTo }),
        });

        try {
            const res = await window.apiFetch(`/api/purchase-returns?${params}`);
            const rows = res.data || [];
            _total = res.total || 0;

            // Stats
            const totalAmount = rows.reduce((a, r) => a + parseFloat(r.total_amount || 0), 0);
            _el('pr-stat-count').textContent = _total;
            _el('pr-stat-amount').textContent = fmt(totalAmount);
            _el('pr-stat-avg').textContent   = _total ? fmt(totalAmount / _total) : '0.00';

            _el('pr-loading')?.classList.add('hidden');

            if (!rows.length) {
                _el('pr-empty')?.classList.remove('hidden');
                return;
            }

            _renderTable(rows);
            _renderPagination();
        } catch (err) {
            _el('pr-loading')?.classList.add('hidden');
            window.showToast('خطأ في تحميل المرتجعات: ' + err.message, 'error');
        }
    }

    function _renderTable(rows) {
        const tbody = _el('pr-tbody');
        if (!tbody) return;

        _el('pr-table-wrap')?.classList.remove('hidden');

        tbody.innerHTML = rows.map(r => {
            const statusClass = r.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                               r.status === 'voided'   ? 'bg-red-100 text-red-600' :
                               'bg-slate-100 text-slate-500';
            const statusLabel = r.status === 'completed' ? 'مكتمل' :
                               r.status === 'voided'   ? 'ملغي' : r.status;

            return `<tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer" onclick="window.prOpenDetail('${r.id}')">
                <td class="py-3 px-4 font-mono font-bold text-brand-600">#${r.return_number}</td>
                <td class="py-3 px-4 text-slate-500">${date(r.return_date)}</td>
                <td class="py-3 px-4 text-slate-700 font-medium">${esc(r.supplier_name || '—')}</td>
                <td class="py-3 px-4 text-slate-400 text-xs hidden sm:table-cell">${r.purchase_invoice_number ? '#' + r.purchase_invoice_number : '—'}</td>
                <td class="py-3 px-4 font-mono font-bold text-slate-800">${fmt(r.total_amount)}</td>
                <td class="py-3 px-4">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${statusClass}">${statusLabel}</span>
                </td>
                <td class="py-3 px-4 text-center" onclick="event.stopPropagation()">
                    <button onclick="window.prOpenDetail('${r.id}')"
                            class="px-2.5 py-1.5 bg-slate-50 hover:bg-brand-50 hover:text-brand-600 text-slate-500 text-xs font-bold rounded-lg transition-colors">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');
    }

    function _renderPagination() {
        const totalPages = Math.ceil(_total / LIMIT);
        if (totalPages <= 1) return;

        _el('pr-pagination')?.classList.remove('hidden');
        const start = _page * LIMIT + 1;
        const end   = Math.min((_page + 1) * LIMIT, _total);
        if (_el('pr-page-info')) _el('pr-page-info').textContent = `${start}–${end} من ${_total}`;

        const prevBtn = _el('pr-prev-btn');
        const nextBtn = _el('pr-next-btn');
        if (prevBtn) prevBtn.disabled = _page === 0;
        if (nextBtn) nextBtn.disabled = _page >= totalPages - 1;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // New Return Modal
    // ─────────────────────────────────────────────────────────────────────────
    window.prOpenNew = function () {
        _itemCount = 0;
        _el('pr-modal-date').value = new Date().toISOString().slice(0, 10);
        _el('pr-modal-supplier').innerHTML = '<option value="">— اختر المورد —</option>' +
            _suppliers.map(s => `<option value="${s.id}">${esc(s.name || s.company_name)}</option>`).join('');
        _el('pr-modal-invoice').innerHTML = '<option value="">— اختر الفاتورة —</option>';
        _el('pr-modal-invoice').disabled = true;
        _el('pr-modal-notes').value = '';
        _el('pr-items-tbody').innerHTML = '';
        _el('pr-total-amount').textContent = '0.00';

        window.prAddItem();

        const m = _el('pr-modal');
        m.style.display = 'flex';
        requestAnimationFrame(() => m.classList.add('opacity-100'));
    };

    window.prCloseModal = function () {
        const m = _el('pr-modal');
        m.classList.remove('opacity-100');
        setTimeout(() => { m.style.display = 'none'; }, 200);
    };

    window.prSupplierChanged = async function () {
        const supplierId = _el('pr-modal-supplier')?.value;
        const invSel = _el('pr-modal-invoice');
        if (!supplierId) {
            invSel.disabled = true;
            invSel.innerHTML = '<option value="">— اختر الفاتورة —</option>';
            return;
        }

        invSel.innerHTML = '<option value="">جاري التحميل...</option>';
        invSel.disabled = true;

        try {
            const res = await window.apiFetch(`/api/purchase-invoices?supplier_id=${supplierId}&limit=100`);
            const invoices = res.data || [];
            _invoices = invoices;
            invSel.innerHTML = '<option value="">— اختر الفاتورة (اختياري) —</option>' +
                invoices.map(i => `<option value="${i.id}">#${i.invoice_number} — ${date(i.invoice_date)} — ${esc(i.client_name || 'غير معروف')} (${fmt(i.grand_total)})</option>`).join('');
            invSel.disabled = false;
        } catch (_) {
            invSel.innerHTML = '<option value="">— خطأ في التحميل —</option>';
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // When invoice selected — load its items automatically
    // ─────────────────────────────────────────────────────────────────────────
    window.prInvoiceChanged = async function () {
        const invoiceId = _el('pr-modal-invoice')?.value;
        if (!invoiceId) {
            // User cleared invoice — reset to empty editable row
            _el('pr-items-tbody').innerHTML = '';
            _itemCount = 0;
            window.prAddItem();
            return;
        }

        // Clear existing items
        _el('pr-items-tbody').innerHTML = '';
        _itemCount = 0;

        try {
            const res = await window.apiFetch(`/api/purchase-invoices/${invoiceId}`);
            const items = res.data?.items || [];

            if (items.length === 0) {
                // No items — add empty row
                window.prAddItem();
                window.showToast('الفاتورة لا تحتوي على أصناف', 'warning');
                return;
            }

            // Add each invoice item as a return line (locked from editing)
            for (const it of items) {
                window.prAddItem();
                const idx = _itemCount;

                // Mark row as from-invoice
                const tr = _el(`pr-item-${idx}`);
                if (tr) tr.dataset.fromInvoice = 'true';

                // Set variant/product
                const prodSel = _el(`pr-item-prod-${idx}`);
                const varSel  = _el(`pr-item-variant-${idx}`);

                if (it.variant_id) {
                    // Find product for this variant
                    const prod = _products.find(p => p.variants?.some(v => v.id === it.variant_id));
                    if (prod && prodSel) {
                        prodSel.value = prod.id;
                        await window.prProdChanged(idx);
                        if (varSel) varSel.value = it.variant_id;
                    } else if (prodSel && it.product_name) {
                        // Fallback: add option for this specific invoice item
                        const optValue = `invoice-item-${idx}`;
                        const opt = document.createElement('option');
                        opt.value = optValue;
                        opt.textContent = `📦 ${it.product_name}`;
                        prodSel.appendChild(opt);
                        prodSel.value = optValue;
                        // Store actual IDs for submission
                        prodSel.dataset.variantId = it.variant_id;
                        prodSel.dataset.productName = it.product_name;
                        // Hide variant dropdown and set label directly
                        const varWrap = _el(`pr-item-variant-wrap-${idx}`);
                        if (varWrap) varWrap.classList.add('hidden');
                    }
                }

                // Set quantity and cost
                const qtyInput  = _el(`pr-item-qty-${idx}`);
                const costInput = _el(`pr-item-cost-${idx}`);
                if (qtyInput)  qtyInput.value  = it.quantity || 1;
                if (costInput) costInput.value = it.unit_price || 0;

                // Update size label
                const sizeLabel = _el(`pr-item-size-label-${idx}`);
                if (sizeLabel) {
                    sizeLabel.textContent = it.size_name || 'قياسي';
                    sizeLabel.classList.add('font-medium', 'text-slate-700');
                }

                // Lock product/variant selects (readonly when tied to invoice)
                if (prodSel) {
                    prodSel.disabled = true;
                    prodSel.classList.add('bg-slate-100', 'text-slate-500');
                }
                if (varSel) {
                    varSel.disabled = true;
                    varSel.classList.add('bg-slate-100', 'text-slate-500');
                }

                // Hide delete button for invoice items
                const delBtn = tr?.querySelector('button[onclick^="window.prRemoveItem"]');
                if (delBtn) delBtn.style.display = 'none';
            }

            window.prRecalc();
            window.showToast(`تم تحميل ${items.length} صنف من الفاتورة`, 'success');

        } catch (err) {
            window.showToast('خطأ في تحميل أصناف الفاتورة: ' + err.message, 'error');
            window.prAddItem();
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Items handling
    // ─────────────────────────────────────────────────────────────────────────
    window.prAddItem = function () {
        _itemCount++;
        const idx = _itemCount;
        const tr  = document.createElement('tr');
        tr.id     = `pr-item-${idx}`;
        tr.className = 'border-b border-slate-100';
        tr.innerHTML = `
            <td class="py-2 px-3" style="min-width:160px;max-width:240px;">
                <div class="max-w-full">
                    <select id="pr-item-prod-${idx}" onchange="window.prProdChanged(${idx})"
                            class="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs focus:border-brand-500 outline-none bg-white truncate">
                        <option value="">— اختر المنتج —</option>
                        ${_products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
                    </select>
                </div>
                <div id="pr-item-variant-wrap-${idx}" class="hidden mt-1">
                    <select id="pr-item-variant-${idx}" onchange="window.prRecalc(); window.prUpdateSizeLabel(${idx})"
                            class="w-full px-2 py-2 border border-brand-200 bg-brand-50 rounded-lg text-xs focus:border-brand-500 outline-none">
                        <option value="">— اختر المقاس —</option>
                    </select>
                </div>
            </td>
            <td class="py-2 px-3 text-center" style="min-width:80px;">
                <span id="pr-item-size-label-${idx}" class="text-xs text-slate-600 font-medium">—</span>
            </td>
            <td class="py-2 px-3" style="min-width:70px;">
                <input id="pr-item-qty-${idx}" type="number" min="1" value="1"
                       oninput="window.prRecalc()"
                       class="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs text-center focus:border-brand-500 outline-none" />
            </td>
            <td class="py-2 px-3" style="min-width:90px;">
                <input id="pr-item-cost-${idx}" type="number" min="0" step="0.01" placeholder="0.00"
                       oninput="window.prRecalc()"
                        class="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:border-brand-500 outline-none text-right" />
            </td>
            <td class="py-2 px-3 text-left" style="min-width:70px;">
                <span id="pr-item-total-${idx}" class="font-mono text-slate-700 text-xs">0.00</span>
            </td>
            <td class="py-2 px-3 text-center" style="width:40px;">
                <button onclick="window.prRemoveItem(${idx})"
                        class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors mx-auto">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </td>`;
        _el('pr-items-tbody').appendChild(tr);
        window.prRecalc();
    };

    window.prRemoveItem = function (idx) {
        const tr = _el(`pr-item-${idx}`);
        if (tr) tr.remove();
        window.prRecalc();
    };

    window.prProdChanged = async function (idx) {
        const prodId = _el(`pr-item-prod-${idx}`)?.value;
        const varWrap = _el(`pr-item-variant-wrap-${idx}`);
        const varSel  = _el(`pr-item-variant-${idx}`);
        const sizeLabel = _el(`pr-item-size-label-${idx}`);

        if (!prodId) {
            varWrap?.classList.add('hidden');
            if (sizeLabel) sizeLabel.textContent = '—';
            return;
        }

        try {
            const res = await window.apiFetch(`/api/products/${prodId}`);
            const variants = res.data?.variants || [];

            if (variants.length === 0) {
                varWrap?.classList.add('hidden');
                if (sizeLabel) sizeLabel.textContent = 'قياسي';
            } else {
                varSel.innerHTML = '<option value="">— اختر المقاس —</option>' +
                    variants.map(v => `<option value="${v.id}">${esc(v.size_name)}</option>`).join('');
                varWrap?.classList.remove('hidden');
                if (sizeLabel) sizeLabel.textContent = '—';
            }
        } catch (_) {
            varWrap?.classList.add('hidden');
            if (sizeLabel) sizeLabel.textContent = '—';
        }
    };

    window.prUpdateSizeLabel = function (idx) {
        const varSel = _el(`pr-item-variant-${idx}`);
        const sizeLabel = _el(`pr-item-size-label-${idx}`);
        if (!varSel || !sizeLabel) return;
        const selected = varSel.options[varSel.selectedIndex];
        sizeLabel.textContent = selected?.textContent || '—';
    };

    window.prRecalc = function () {
        let total = 0;
        for (let i = 1; i <= _itemCount; i++) {
            if (!_el(`pr-item-${i}`)) continue;
            const qty  = parseFloat(_el(`pr-item-qty-${i}`)?.value  || 0);
            const cost = parseFloat(_el(`pr-item-cost-${i}`)?.value || 0);
            const line = qty * cost;
            total += line;
            const totalEl = _el(`pr-item-total-${i}`);
            if (totalEl) totalEl.textContent = fmt(line);
        }
        _el('pr-total-amount').textContent = fmt(total);
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Save
    // ─────────────────────────────────────────────────────────────────────────
    window.prSave = async function () {
        const return_date  = _el('pr-modal-date')?.value;
        const supplier_id  = _el('pr-modal-supplier')?.value;
        const purchase_invoice_id = _el('pr-modal-invoice')?.value || null;
        const notes        = _el('pr-modal-notes')?.value.trim() || '';

        if (!return_date) { window.showToast('تاريخ المرتجع مطلوب', 'error'); return; }
        if (!supplier_id) { window.showToast('المورد مطلوب', 'error'); return; }

        const items = [];
        for (let i = 1; i <= _itemCount; i++) {
            if (!_el(`pr-item-${i}`)) continue;
            const prodSel    = _el(`pr-item-prod-${i}`);
            const product_id = prodSel?.value;
            const variant_id = _el(`pr-item-variant-${i}`)?.value || null;
            const qty        = parseFloat(_el(`pr-item-qty-${i}`)?.value  || 0);
            const cost       = parseFloat(_el(`pr-item-cost-${i}`)?.value || 0);

            if (!product_id || product_id.startsWith('invoice-item-')) {
                // Use dataset if it's an invoice item
                if (prodSel?.dataset?.variantId) {
                    if (!qty || qty <= 0) { window.showToast(`الصنف ${i}: الكمية مطلوبة`, 'error'); return; }
                    items.push({ variant_id: prodSel.dataset.variantId, quantity: qty, unit_cost: cost });
                }
                continue;
            }
            if (!qty || qty <= 0) { window.showToast(`الصنف ${i}: الكمية مطلوبة`, 'error'); return; }
            if (cost < 0) { window.showToast(`الصنف ${i}: التكلفة غير صحيحة`, 'error'); return; }

            // Find variant_id if not selected but product has variants
            let finalVariantId = variant_id;
            if (!finalVariantId) {
                const prod = _products.find(p => p.id === product_id);
                if (prod && prod.variants && prod.variants.length === 1) {
                    finalVariantId = prod.variants[0].id;
                }
            }

            items.push({ variant_id: finalVariantId || product_id, quantity: qty, unit_cost: cost });
        }

        if (items.length === 0) { window.showToast('يجب إدخال صنف واحد على الأقل', 'error'); return; }

        const btn = _el('pr-save-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1.5"></i> جاري الحفظ...';

        try {
            await window.apiFetch('/api/purchase-returns', {
                method: 'POST',
                body: JSON.stringify({ return_date, supplier_id, purchase_invoice_id, notes, items }),
            });
            window.showToast('تم حفظ المرتجع بنجاح', 'success');
            window.prCloseModal();
            _page = 0;
            await _load();
        } catch (err) {
            window.showToast(err.message || 'حدث خطأ', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk ml-1.5"></i> حفظ المرتجع';
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Detail Modal
    // ─────────────────────────────────────────────────────────────────────────
    window.prOpenDetail = async function (id) {
        _activeDetailId = id;
        const m = _el('pr-detail-modal');
        m.style.display = 'flex';
        requestAnimationFrame(() => m.classList.add('opacity-100'));

        _el('pr-detail-title').textContent = 'جاري التحميل...';
        _el('pr-detail-sub').textContent   = '';
        _el('pr-detail-content').innerHTML = '<div class="text-center py-10"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-brand-400"></i></div>';

        try {
            const res = await window.apiFetch(`/api/purchase-returns/${id}`);
            const ret = res.data.return;
            const items = res.data.items || [];

            _el('pr-detail-title').textContent = `مرتجع رقم #${ret.return_number}`;
            _el('pr-detail-sub').textContent   = `${date(ret.return_date)} — ${esc(ret.supplier_name || '')}`;

            const voidBtn = _el('pr-detail-void-btn');
            if (voidBtn) voidBtn.style.display = ret.status === 'completed' ? '' : 'none';

            _el('pr-detail-content').innerHTML = `
                <div class="space-y-4">
                    <div class="grid grid-cols-2 gap-4 text-sm">
                        <div class="bg-slate-50 rounded-xl p-3">
                            <span class="text-xs text-slate-400">المورد</span>
                            <p class="font-bold text-slate-700 mt-0.5">${esc(ret.supplier_name || '—')}</p>
                        </div>
                        <div class="bg-slate-50 rounded-xl p-3">
                            <span class="text-xs text-slate-400">فاتورة الشراء</span>
                            <p class="font-bold text-slate-700 mt-0.5">${ret.purchase_invoice_number ? '#' + ret.purchase_invoice_number : '—'}</p>
                        </div>
                        <div class="bg-slate-50 rounded-xl p-3">
                            <span class="text-xs text-slate-400">الحالة</span>
                            <p class="font-bold ${ret.status === 'completed' ? 'text-emerald-600' : 'text-red-600'} mt-0.5">${ret.status === 'completed' ? 'مكتمل' : 'ملغي'}</p>
                        </div>
                        <div class="bg-slate-50 rounded-xl p-3">
                            <span class="text-xs text-slate-400">الإجمالي</span>
                            <p class="font-bold text-brand-600 mt-0.5">${fmt(ret.total_amount)}</p>
                        </div>
                    </div>
                    ${ret.notes ? `<div class="text-sm text-slate-600 bg-yellow-50 rounded-xl p-3"><i class="fa-solid fa-note-sticky text-yellow-500 ml-1"></i> ${esc(ret.notes)}</div>` : ''}
                    <div class="border border-slate-200 rounded-xl overflow-hidden">
                        <table class="w-full text-sm">
                            <thead class="bg-slate-50">
                                <tr class="text-xs text-slate-500">
                                    <th class="py-2.5 px-3 text-right font-semibold">المنتج</th>
                                    <th class="py-2.5 px-3 text-right font-semibold">الكمية</th>
                                    <th class="py-2.5 px-3 text-right font-semibold">التكلفة</th>
                                    <th class="py-2.5 px-3 text-right font-semibold">الإجمالي</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${items.map(it => `<tr class="border-b border-slate-100">
                                    <td class="py-2.5 px-3">${esc(it.product_name)} ${it.size_name ? '<span class="text-xs text-slate-400">(' + esc(it.size_name) + ')</span>' : ''}</td>
                                    <td class="py-2.5 px-3">${it.quantity}</td>
                                    <td class="py-2.5 px-3 font-mono">${fmt(it.unit_cost)}</td>
                                    <td class="py-2.5 px-3 font-mono font-bold">${fmt(it.line_total)}</td>
                                </tr>`).join('')}
                            </tbody>
                            <tfoot>
                                <tr class="bg-slate-50 border-t border-slate-200">
                                    <td colspan="3" class="py-2.5 px-3 text-xs font-bold text-slate-500">الإجمالي</td>
                                    <td class="py-2.5 px-3 font-mono font-black text-brand-600">${fmt(ret.total_amount)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            `;
        } catch (err) {
            _el('pr-detail-content').innerHTML = `<div class="text-center py-10 text-red-400">${err.message}</div>`;
        }
    };

    window.prCloseDetail = function () {
        const m = _el('pr-detail-modal');
        m.classList.remove('opacity-100');
        setTimeout(() => { m.style.display = 'none'; _activeDetailId = null; }, 200);
    };

    window.prVoid = async function () {
        if (!_activeDetailId) return;
        if (!confirm('هل تريد إلغاء هذا المرتجع؟ سيتم إعادة البضاعة للمخزون وعكس القيد المحاسبي.')) return;
        try {
            await window.apiFetch(`/api/purchase-returns/${_activeDetailId}`, { method: 'DELETE' });
            window.showToast('تم إلغاء المرتجع', 'success');
            window.prCloseDetail();
            await _load();
        } catch (err) {
            window.showToast(err.message || 'حدث خطأ', 'error');
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Pagination & Search
    // ─────────────────────────────────────────────────────────────────────────
    window.prSearch   = function () { _page = 0; _load(); };
    window.prPrevPage = function () { if (_page > 0) { _page--; _load(); } };
    window.prNextPage = function () { if ((_page + 1) * LIMIT < _total) { _page++; _load(); } };
    window.prRefresh  = function () { _load(); };

    // ─────────────────────────────────────────────────────────────────────────
    // Init
    // ─────────────────────────────────────────────────────────────────────────
    (async function _init() {
        var _myToken = window.getCurrentNavToken ? window.getCurrentNavToken() : 0;
        await _loadData();
        if (window.isViewActive && !window.isViewActive(_myToken)) return;
        await _load();
    })();

})();
