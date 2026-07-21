// =============================================================================
// G.PACK 2.0 — Direct Receipts View Controller
// =============================================================================
(function () {
    'use strict';

    let _data = [];
    let _total = 0;
    let _tab = 'pending';
    let _search = '';
    let _suppliers = [];
    let _warehouses = [];
    let _units = [];
    let _currentReceipt = null;
    let _itemRowCounter = 0;

    const _el = (id) => document.getElementById(id);
    const _esc = (s) => (s || '').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    // ── Init ──────────────────────────────────────────────────────────────────
    async function _init() {
        var token = window.getCurrentNavToken ? window.getCurrentNavToken() : 0;
        await Promise.all([_loadList(), _loadSuppliers(), _loadWarehouses(), _loadUnits()]);
        if (window.isViewActive && !window.isViewActive(token)) return;
    }

    async function _loadList() {
        const status = _tab === 'pending' ? 'pending_review' : '';
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        if (_search) params.set('search', _search);
        params.set('limit', '50');

        try {
            const res = await window.apiFetch(`/api/direct-receipts?${params}`);
            _data = res.data || [];
            _total = res.total || 0;
            _renderList();
        } catch (err) {
            window.showToast(err.message || 'فشل تحميل الاستلامات', 'error');
        }
    }

    async function _loadSuppliers() {
        try {
            const res = await window.apiFetch('/api/suppliers?limit=100');
            _suppliers = res.data || [];
        } catch (_e) {}
    }

    async function _loadWarehouses() {
        try {
            const res = await window.apiFetch('/api/inventory/warehouses');
            _warehouses = res.data || res || [];
        } catch (_e) {}
    }

    async function _loadUnits() {
        try {
            const res = await window.apiFetch('/api/units?limit=100');
            _units = res.data || res || [];
        } catch (_e) {}
    }

    // ── Render List ───────────────────────────────────────────────────────────
    function _renderList() {
        const container = _el('dr-list-container');
        const empty = _el('dr-empty');
        const badge = _el('dr-tab-pending-badge');

        if (badge) {
            if (_tab === 'pending' && _total > 0) {
                badge.textContent = _total;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }

        if (!_data.length) {
            container.innerHTML = '';
            empty.classList.remove('hidden');
            empty.classList.add('flex');
            return;
        }
        empty.classList.add('hidden');
        empty.classList.remove('flex');

        container.innerHTML = _data.map(r => {
            const statusBadge = r.status === 'pending_review'
                ? '<span class="px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">بانتظار المراجعة</span>'
                : r.status === 'converted'
                    ? '<span class="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">تم التحويل</span>'
                    : '<span class="px-2.5 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold">ملغي</span>';

            const date = new Date(r.received_at).toLocaleDateString('ar-SA-u-nu-latn');
            const invoiceIcon = r.has_invoice
                ? '<i class="fa-solid fa-file-invoice text-emerald-500" title="بفاتورة"></i>'
                : '<i class="fa-solid fa-file-circle-xmark text-slate-300" title="بدون فاتورة"></i>';

            const clickHandler = r.status === 'pending_review'
                ? `window.drOpenReview('${r.id}')`
                : `window.drOpenDetail('${r.id}')`;

            return `<div onclick="${clickHandler}"
                        class="bg-white border border-slate-200 rounded-xl p-4 hover:border-brand-300 hover:shadow-md transition-all cursor-pointer">
                <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
                            <i class="fa-solid fa-truck-ramp-box text-brand-500"></i>
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-slate-800 text-sm">#${r.receipt_number}</span>
                                ${invoiceIcon}
                                ${statusBadge}
                            </div>
                            <div class="text-xs text-slate-500 mt-0.5">
                                ${date} • ${r.item_count || 0} صنف
                                ${r.supplier_name ? ' • ' + _esc(r.supplier_name) : ''}
                                ${r.warehouse_name ? ' • ' + _esc(r.warehouse_name) : ''}
                            </div>
                        </div>
                    </div>
                    <i class="fa-solid fa-chevron-left text-slate-300 text-sm shrink-0"></i>
                </div>
            </div>`;
        }).join('');
    }

    // ── Tabs ──────────────────────────────────────────────────────────────────
    function _switchTab(tab) {
        _tab = tab;
        const btnP = _el('dr-tab-pending');
        const btnA = _el('dr-tab-archive');
        if (btnP) {
            btnP.className = tab === 'pending'
                ? 'px-5 py-2.5 text-sm font-bold border-b-2 border-brand-600 text-brand-600 transition-all whitespace-nowrap'
                : 'px-5 py-2.5 text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600 transition-all whitespace-nowrap';
        }
        if (btnA) {
            btnA.className = tab === 'archive'
                ? 'px-5 py-2.5 text-sm font-bold border-b-2 border-brand-600 text-brand-600 transition-all whitespace-nowrap'
                : 'px-5 py-2.5 text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600 transition-all whitespace-nowrap';
        }
        _loadList();
    }

    // ── Search ────────────────────────────────────────────────────────────────
    function _onSearch() {
        const el = _el('dr-search');
        _search = el ? el.value.trim() : '';
        _loadList();
    }

    function _refresh() {
        _loadList();
    }

    // ── Create Modal ──────────────────────────────────────────────────────────
    function _openCreateModal() {
        _itemRowCounter = 0;
        const cb = _el('dr-has-invoice');
        if (cb) cb.checked = false;
        _toggleInvoice();
        const notes = _el('dr-notes');
        if (notes) notes.value = '';
        const tbody = _el('dr-items-tbody');
        if (tbody) tbody.innerHTML = '';
        _addItemRow();
        _showModal('dr-create-modal');
    }

    function _closeCreateModal() {
        _hideModal('dr-create-modal');
    }

    function _toggleInvoice() {
        const cb = _el('dr-has-invoice');
        const hasInvoice = cb ? cb.checked : false;
        document.querySelectorAll('.dr-invoice-cell').forEach(el => {
            el.style.display = hasInvoice ? '' : 'none';
        });
    }

    function _addItemRow() {
        const tbody = _el('dr-items-tbody');
        if (!tbody) return;
        const idx = _itemRowCounter++;
        const hasInvoice = (_el('dr-has-invoice') || {}).checked;

        const tr = document.createElement('tr');
        tr.className = 'dr-item-row';
        tr.dataset.row = idx;
        tr.innerHTML = `
            <td class="py-2 px-3">
                <input type="text" class="dr-item-name w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-brand-500" placeholder="اسم الصنف">
            </td>
            <td class="py-2 px-3">
                <input type="text" class="dr-item-unit w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-brand-500" placeholder="وحدة">
            </td>
            <td class="py-2 px-3">
                <input type="number" class="dr-item-qty w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-brand-500" placeholder="0" min="0" step="any">
            </td>
            <td class="py-2 px-3 text-center dr-product-cell">
                <input type="file" accept="image/*" class="dr-item-photo hidden" onchange="window.drOnPhotoSelect(this, 'product')">
                <button onclick="this.previousElementSibling.click()" class="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:text-brand-600 hover:border-brand-300 transition-all">
                    <i class="fa-solid fa-camera text-xs"></i>
                </button>
                <span class="dr-photo-name text-xs text-slate-400 block mt-0.5"></span>
            </td>
            <td class="py-2 px-3 text-center dr-invoice-cell" style="display:${hasInvoice ? '' : 'none'}">
                <input type="file" accept="image/*" class="dr-item-invoice-photo hidden" onchange="window.drOnPhotoSelect(this, 'invoice')">
                <button onclick="this.previousElementSibling.click()" class="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:text-emerald-600 hover:border-emerald-300 transition-all">
                    <i class="fa-solid fa-file-invoice text-xs"></i>
                </button>
                <span class="dr-invoice-photo-name text-xs text-slate-400 block mt-0.5"></span>
            </td>
            <td class="py-2 px-3 text-center">
                <button onclick="this.closest('tr').remove()" class="w-7 h-7 inline-flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 transition-all">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    }

    function _onPhotoSelect(input, type) {
        const file = input.files[0];
        if (!file) return;
        const nameSpan = input.parentElement.querySelector(type === 'product' ? '.dr-photo-name' : '.dr-invoice-photo-name');
        if (nameSpan) nameSpan.textContent = file.name.substring(0, 15) + '...';
    }

    async function _save() {
        const hasInvoice = (_el('dr-has-invoice') || {}).checked;
        const notes = (_el('dr-notes') || {}).value?.trim() || null;
        const rows = document.querySelectorAll('.dr-item-row');

        if (!rows.length) { window.showToast('أضف صنفاً واحداً على الأقل', 'error'); return; }

        const items = [];
        rows.forEach(row => {
            const name = row.querySelector('.dr-item-name')?.value?.trim();
            const unit = row.querySelector('.dr-item-unit')?.value?.trim();
            const qty = parseFloat(row.querySelector('.dr-item-qty')?.value) || 0;
            if (!name || !qty) return;
            items.push({ product_name: name, unit_name: unit || '', quantity: qty });
        });

        if (!items.length) { window.showToast('أدخل بيانات صحيحة لكل صنف', 'error'); return; }

        const btn = _el('dr-save-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جاري الحفظ...'; }

        try {
            const formData = new FormData();
            formData.append('has_invoice', String(hasInvoice));
            formData.append('notes', notes || '');
            formData.append('items', JSON.stringify(items));

            rows.forEach(row => {
                const pFile = row.querySelector('.dr-item-photo')?.files[0];
                const iFile = row.querySelector('.dr-item-invoice-photo')?.files[0];
                if (pFile) formData.append('product_photos', pFile);
                if (iFile) formData.append('invoice_photos', iFile);
            });

            const res = await fetch('/api/direct-receipts', {
                method: 'POST',
                body: formData,
                credentials: 'include',
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }

            window.showToast(`تم إنشاء استلام مؤقت #${(await res.json()).data.receipt_number}`, 'success');
            _closeCreateModal();
            await _loadList();
        } catch (err) {
            window.showToast(err.message || 'فشل الحفظ', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk ml-1"></i> حفظ الاستلام'; }
        }
    }

    // ── Review Modal ──────────────────────────────────────────────────────────
    async function _openReview(id) {
        try {
            const res = await window.apiFetch(`/api/direct-receipts/${id}`);
            _currentReceipt = res.data;
            if (!_currentReceipt) return;

            _el('dr-review-number').textContent = _currentReceipt.receipt_number;

            const info = _el('dr-review-info');
            if (info) {
                const date = new Date(_currentReceipt.received_at).toLocaleString('ar-SA-u-nu-latn');
                info.innerHTML = `
                    <div class="grid grid-cols-2 gap-2">
                        <div><span class="text-slate-400">رقم الاستلام:</span> <b>#${_currentReceipt.receipt_number}</b></div>
                        <div><span class="text-slate-400">التاريخ:</span> ${date}</div>
                        <div><span class="text-slate-400">بفاتورة:</span> ${_currentReceipt.has_invoice ? 'نعم' : 'لا'}</div>
                        <div><span class="text-slate-400">بواسطة:</span> ${_esc(_currentReceipt.received_by_name || '—')}</div>
                        ${_currentReceipt.notes ? `<div class="col-span-2"><span class="text-slate-400">ملاحظات:</span> ${_esc(_currentReceipt.notes)}</div>` : ''}
                    </div>
                `;
            }

            // Populate suppliers
            const sel = _el('dr-review-supplier');
            if (sel) {
                sel.innerHTML = '<option value="">— اختر —</option>' +
                    _suppliers.map(s => `<option value="${s.id}" ${_currentReceipt.supplier_id === s.id ? 'selected' : ''}>${_esc(s.company_name || s.name)}</option>`).join('');
            }

            // Populate warehouses
            const whSel = _el('dr-review-warehouse');
            if (whSel) {
                whSel.innerHTML = '<option value="">— اختر —</option>' +
                    _warehouses.map(w => `<option value="${w.id}" ${_currentReceipt.warehouse_id === w.id ? 'selected' : ''}>${_esc(w.name)}</option>`).join('');
            }

            const invRef = _el('dr-review-invoice-ref');
            if (invRef) invRef.value = _currentReceipt.supplier_invoice_ref || '';

            // Render items
            const tbody = _el('dr-review-items-tbody');
            if (tbody) {
                tbody.innerHTML = _currentReceipt.items.map(item => {
                    const photoHtml = item.product_photo_url
                        ? `<a href="${item.product_photo_url}" target="_blank" class="text-brand-600 text-xs hover:underline"><i class="fa-solid fa-image"></i> صورة</a>`
                        : '';
                    const invPhotoHtml = item.invoice_photo_url
                        ? `<a href="${item.invoice_photo_url}" target="_blank" class="text-emerald-600 text-xs hover:underline"><i class="fa-solid fa-file-invoice"></i> فاتورة</a>`
                        : '';
                    return `<tr data-item-id="${item.id}">
                        <td class="py-2 px-3">
                            <div class="text-sm font-semibold text-slate-800">${_esc(item.product_name)}</div>
                            <div class="text-xs text-slate-400">${_esc(item.unit_name)} • ${item.quantity} ${_esc(item.unit_name)}</div>
                            <div class="flex gap-2 mt-1">${photoHtml} ${invPhotoHtml}</div>
                        </td>
                        <td class="py-2 px-3">
                            <input type="text" class="dr-review-variant-search w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-brand-500"
                                   placeholder="ابحث عن منتج..."
                                   value="${item.matched_product_name ? _esc(item.matched_product_name + ' ' + (item.size_name || '')) : ''}"
                                   oninput="window.drOnVariantSearch(this, '${item.id}')"
                                   data-variant-id="${item.variant_id || ''}">
                            <div class="dr-variant-suggestions hidden mt-1 bg-white border border-slate-200 rounded-lg max-h-32 overflow-y-auto text-xs"></div>
                        </td>
                        <td class="py-2 px-3">
                            <select class="dr-review-unit w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none">
                                <option value="">—</option>
                                ${_units.map(u => `<option value="${u.id}" ${item.unit_id === u.id ? 'selected' : ''}>${_esc(u.name)}</option>`).join('')}
                            </select>
                        </td>
                        <td class="py-2 px-3">
                            <input type="number" class="dr-review-qty w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none text-center"
                                   value="${item.confirmed_quantity || item.quantity}" min="0" step="any">
                        </td>
                        <td class="py-2 px-3">
                            <input type="number" class="dr-review-cost w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none text-center"
                                   value="${item.unit_cost || ''}" min="0" step="0.01" placeholder="0.00">
                        </td>
                    </tr>`;
                }).join('');
            }

            _showModal('dr-review-modal');
        } catch (err) {
            window.showToast(err.message || 'فشل تحميل الاستلام', 'error');
        }
    }

    function _closeReviewModal() {
        _hideModal('dr-review-modal');
        _currentReceipt = null;
    }

    // Variant search (debounced)
    let _variantSearchTimer = null;
    async function _onVariantSearch(input, itemId) {
        clearTimeout(_variantSearchTimer);
        const query = input.value.trim();
        const sugBox = input.parentElement.querySelector('.dr-variant-suggestions');
        if (!query || query.length < 2) {
            if (sugBox) sugBox.classList.add('hidden');
            return;
        }
        _variantSearchTimer = setTimeout(async () => {
            try {
                const res = await window.apiFetch(`/api/products?search=${encodeURIComponent(query)}&include_variants=true&limit=10`);
                const products = res.data || [];
                if (!products.length || !sugBox) {
                    if (sugBox) sugBox.classList.add('hidden');
                    return;
                }
                sugBox.innerHTML = products.map(p => {
                    const variants = (p.variants || []).map(v => 
                        `<div onclick="window.drSelectVariant(this, '${itemId}', '${v.id}', '${_esc((p.name || '') + ' ' + (v.size_name || '')).replace(/'/g, "\\'")}')"
                              class="px-2 py-1.5 hover:bg-brand-50 cursor-pointer text-xs">${_esc(p.name)} ${v.size_name ? '<span class=\"text-slate-400\">' + _esc(v.size_name) + '</span>' : ''}</div>`
                    ).join('');
                    return variants;
                }).join('');
                sugBox.classList.remove('hidden');
            } catch (_e) {
                if (sugBox) sugBox.classList.add('hidden');
            }
        }, 300);
    }

    function _selectVariant(el, itemId, variantId, displayName) {
        const tr = el.closest('tr');
        const input = tr.querySelector('.dr-review-variant-search');
        if (input) {
            input.value = displayName;
            input.dataset.variantId = variantId;
        }
        const sugBox = tr.querySelector('.dr-variant-suggestions');
        if (sugBox) sugBox.classList.add('hidden');
    }

    async function _saveReview() {
        if (!_currentReceipt) return;
        const supplierId = (_el('dr-review-supplier') || {}).value;
        const warehouseId = (_el('dr-review-warehouse') || {}).value;
        const invoiceRef = (_el('dr-review-invoice-ref') || {}).value;
        const invoiceDate = _currentReceipt.supplier_invoice_date || null;

        if (!supplierId || !warehouseId) { window.showToast('اختر المورد والمستودع', 'error'); return; }

        const rows = document.querySelectorAll('#dr-review-items-tbody tr');
        const items = [];
        rows.forEach(row => {
            const itemId = row.dataset.itemId;
            const variantInput = row.querySelector('.dr-review-variant-search');
            const variantId = variantInput?.dataset.variantId || '';
            const unitId = row.querySelector('.dr-review-unit')?.value || null;
            const qty = parseFloat(row.querySelector('.dr-review-qty')?.value) || 0;
            const cost = parseFloat(row.querySelector('.dr-review-cost')?.value) || 0;

            if (!variantId) { window.showToast('كل صنف يجب ربطه بمنتج', 'error'); return; }
            items.push({ id: itemId, variant_id: variantId, unit_id: unitId, confirmed_quantity: qty, unit_cost: cost });
        });

        if (!items.length) return;

        const btn = _el('dr-save-review-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i>...'; }

        try {
            await window.apiFetch(`/api/direct-receipts/${_currentReceipt.id}/review`, {
                method: 'PUT',
                body: JSON.stringify({
                    supplier_id: supplierId,
                    supplier_invoice_ref: invoiceRef || null,
                    supplier_invoice_date: invoiceDate,
                    warehouse_id: warehouseId,
                    items,
                }),
            });
            window.showToast('تم حفظ المراجعة', 'success');
            _currentReceipt.supplier_id = supplierId;
            _currentReceipt.warehouse_id = warehouseId;
            _currentReceipt.supplier_invoice_ref = invoiceRef;
            _currentReceipt.items = _currentReceipt.items.map((it, i) => ({ ...it, ...items[i] }));
        } catch (err) {
            window.showToast(err.message || 'فشل حفظ المراجعة', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk ml-1"></i> حفظ المراجعة'; }
        }
    }

    async function _convert() {
        if (!_currentReceipt) return;
        if (!confirm('هل تريد تحويل هذا الاستلام لفاتورة مشتريات؟')) return;

        // Save review first
        const btn = _el('dr-convert-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i>...'; }

        try {
            // Save review first
            await _saveReview();

            const res = await window.apiFetch(`/api/direct-receipts/${_currentReceipt.id}/convert`, { method: 'POST' });
            window.showToast(`تم التحويل لفاتورة مشتريات #${res.data.invoice_number}`, 'success');
            _closeReviewModal();
            await _loadList();
        } catch (err) {
            window.showToast(err.message || 'فشل التحويل', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-invoice ml-1"></i> تحويل لفاتورة مشتريات'; }
        }
    }

    async function _cancelReceipt() {
        if (!_currentReceipt) return;
        if (!confirm('هل تريد إلغاء هذا الاستلام؟')) return;
        try {
            await window.apiFetch(`/api/direct-receipts/${_currentReceipt.id}/cancel`, { method: 'PUT' });
            window.showToast('تم إلغاء الاستلام', 'success');
            _closeReviewModal();
            await _loadList();
        } catch (err) {
            window.showToast(err.message || 'فشل الإلغاء', 'error');
        }
    }

    // ── Detail Modal (archive) ────────────────────────────────────────────────
    async function _openDetail(id) {
        try {
            const res = await window.apiFetch(`/api/direct-receipts/${id}`);
            const r = res.data;
            if (!r) return;

            _el('dr-detail-number').textContent = r.receipt_number;
            const content = _el('dr-detail-content');

            const statusBadge = r.status === 'converted'
                ? '<span class="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">تم التحويل</span>'
                : '<span class="px-2.5 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold">ملغي</span>';

            const date = new Date(r.received_at).toLocaleString('ar-SA-u-nu-latn');

            content.innerHTML = `
                <div class="grid grid-cols-2 gap-3 text-sm">
                    <div><span class="text-slate-400">رقم الاستلام:</span> <b>#${r.receipt_number}</b></div>
                    <div><span class="text-slate-400">التاريخ:</span> ${date}</div>
                    <div><span class="text-slate-400">الحالة:</span> ${statusBadge}</div>
                    <div><span class="text-slate-400">بفاتورة:</span> ${r.has_invoice ? 'نعم' : 'لا'}</div>
                    <div><span class="text-slate-400">المورد:</span> ${_esc(r.supplier_name || '—')}</div>
                    <div><span class="text-slate-400">المستودع:</span> ${_esc(r.warehouse_name || '—')}</div>
                    ${r.purchase_invoice_number ? `<div><span class="text-slate-400">فاتورة المشتريات:</span> <b>#${r.purchase_invoice_number}</b></div>` : ''}
                    ${r.notes ? `<div class="col-span-2"><span class="text-slate-400">ملاحظات:</span> ${_esc(r.notes)}</div>` : ''}
                </div>
                <div>
                    <p class="text-xs font-bold text-slate-500 uppercase mb-2">الأصناف</p>
                    <div class="border border-slate-200 rounded-xl overflow-hidden">
                        <table class="w-full text-sm">
                            <thead class="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    <th class="py-2 px-3 text-right text-xs font-bold text-slate-500">الصنف</th>
                                    <th class="py-2 px-3 text-right text-xs font-bold text-slate-500">الوحدة</th>
                                    <th class="py-2 px-3 text-center text-xs font-bold text-slate-500">الكمية</th>
                                    <th class="py-2 px-3 text-center text-xs font-bold text-slate-500">التكلفة</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100">
                                ${r.items.map(it => `<tr>
                                    <td class="py-2 px-3">
                                        <div class="font-semibold text-slate-800">${_esc(it.product_name)}</div>
                                        ${it.matched_product_name ? `<div class="text-xs text-slate-400">${_esc(it.matched_product_name)} ${it.size_name ? _esc(it.size_name) : ''}</div>` : ''}
                                        ${it.product_photo_url ? `<a href="${it.product_photo_url}" target="_blank" class="text-brand-600 text-xs hover:underline"><i class="fa-solid fa-image"></i></a>` : ''}
                                    </td>
                                    <td class="py-2 px-3 text-slate-600">${_esc(it.unit_name)}${it.matched_unit_name ? ' / ' + _esc(it.matched_unit_name) : ''}</td>
                                    <td class="py-2 px-3 text-center font-bold">${it.confirmed_quantity || it.quantity}</td>
                                    <td class="py-2 px-3 text-center">${it.unit_cost ? parseFloat(it.unit_cost).toFixed(2) : '—'}</td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            _showModal('dr-detail-modal');
        } catch (err) {
            window.showToast(err.message || 'فشل تحميل التفاصيل', 'error');
        }
    }

    function _closeDetailModal() {
        _hideModal('dr-detail-modal');
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function _showModal(id) { const e = _el(id); if (e) e.classList.remove('hidden'); }
    function _hideModal(id) { const e = _el(id); if (e) e.classList.add('hidden'); }

    // ── Exports ───────────────────────────────────────────────────────────────
    window.drInit = _init;
    window.drRefresh = _refresh;
    window.drSwitchTab = _switchTab;
    window.drOnSearch = _onSearch;
    window.drOpenCreateModal = _openCreateModal;
    window.drCloseCreateModal = _closeCreateModal;
    window.drToggleInvoice = _toggleInvoice;
    window.drAddItemRow = _addItemRow;
    window.drOnPhotoSelect = _onPhotoSelect;
    window.drSave = _save;
    window.drOpenReview = _openReview;
    window.drCloseReviewModal = _closeReviewModal;
    window.drOnVariantSearch = _onVariantSearch;
    window.drSelectVariant = _selectVariant;
    window.drSaveReview = _saveReview;
    window.drConvert = _convert;
    window.drCancelReceipt = _cancelReceipt;
    window.drOpenDetail = _openDetail;
    window.drCloseDetailModal = _closeDetailModal;

    // Auto-init
    _init();
})();
