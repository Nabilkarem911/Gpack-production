'use strict';

// =============================================================================
// G.PACK 2.0 — Payment Vouchers View Controller (سندات الصرف)
// =============================================================================

(function () {

    const _el  = (id) => document.getElementById(id);
    const fmt  = (n)  => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc  = (s)  => { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };

    // ── State ─────────────────────────────────────────────────────────────────
    let _state = {
        page: 0,
        limit: 20,
        total: 0,
        rows: [],
        search: '',
        status: '',
        from: '',
        to: '',
        selectedVoucherId: null,
        payeeType: 'supplier',
    };

    let _accountsTree = { parents: [], children: [] };
    let _selectedParent = null;
    let _selectedChild = null;

    const _typeLabels = {
        'asset': 'أصول',
        'liability': 'خصوم',
        'equity': 'حقوق ملكية',
        'revenue': 'إيرادات',
        'expense': 'مصاريف'
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    async function _init() {
        _bindEvents();
        _loadAccounts();
        _loadVouchers();
        _el('pv-date').value = new Date().toISOString().split('T')[0];

        // Load accounts tree for dropdowns
        try {
            const data = await window.apiFetch('/api/account-statement/accounts-tree');
            _accountsTree = data;
            _renderParentList(data.parents);
        } catch (err) {
            console.error('[PaymentVoucher] Failed to load accounts tree:', err);
        }

        // Click outside to close dropdowns
        document.addEventListener('click', (e) => {
            const parentWrap = _el('pv-parent-btn')?.closest('.flex-1');
            if (parentWrap && !parentWrap.contains(e.target)) {
                _el('pv-parent-dropdown').classList.add('hidden');
            }
            const childWrap = _el('pv-child-btn')?.closest('.flex-1');
            if (childWrap && !childWrap.contains(e.target)) {
                _el('pv-child-dropdown').classList.add('hidden');
            }
        });
    }

    // ── Bind Events ───────────────────────────────────────────────────────────
    function _bindEvents() {
        _el('pv-btn-new').addEventListener('click', _openNewModal);
        _el('pv-btn-filter').addEventListener('click', () => {
            _state.page    = 0;
            _state.search  = _el('pv-search').value.trim();
            _state.status  = _el('pv-filter-status').value;
            _state.from    = _el('pv-filter-from').value;
            _state.to      = _el('pv-filter-to').value;
            _loadVouchers();
        });
        _el('pv-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') _el('pv-btn-filter').click(); });

        _el('pv-btn-prev').addEventListener('click', () => { if (_state.page > 0) { _state.page--; _loadVouchers(); } });
        _el('pv-btn-next').addEventListener('click', () => {
            if ((_state.page + 1) * _state.limit < _state.total) { _state.page++; _loadVouchers(); }
        });

        _el('pv-modal-close').addEventListener('click', _closeNewModal);
        _el('pv-modal-cancel').addEventListener('click', _closeNewModal);
        _el('pv-modal-submit').addEventListener('click', _submitVoucher);
        _el('pv-amount').addEventListener('input', _updatePreview);

        // Payment method change → filter accounts
        _el('pv-payment-method').addEventListener('change', (e) => {
            _filterAccountsByMethod(e.target.value);
        });

        _el('pv-detail-close').addEventListener('click', _closeDetailModal);
        _el('pv-detail-close-btn').addEventListener('click', _closeDetailModal);
        _el('pv-detail-cancel-btn').addEventListener('click', _cancelVoucher);
        _el('pv-detail-print-btn').addEventListener('click', _printVoucher);
    }

    // ── Load Accounts ─────────────────────────────────────────────────────────
    let _allCashAccounts = [];

    async function _loadAccounts() {
        try {
            const res = await window.apiFetch('/api/payment-vouchers/meta/accounts');
            _allCashAccounts = res.data || [];
            _filterAccountsByMethod('cash');
        } catch (err) {
            console.error('[PaymentVoucher] Failed to load accounts:', err);
        }
    }

    function _filterAccountsByMethod(method) {
        const select = _el('pv-cash-account');
        const parentCode = method === 'bank_transfer' ? '1200' : '1100';
        const filtered = _allCashAccounts.filter(a => a.parent_code === parentCode);
        if (filtered.length === 0) {
            select.innerHTML = '<option value="">لا توجد حسابات متاحة</option>';
        } else {
            select.innerHTML = filtered.map(a =>
                `<option value="${a.id}">${a.code} — ${a.name}</option>`
            ).join('');
        }
    }

    // ── Load Vouchers ─────────────────────────────────────────────────────────
    async function _loadVouchers() {
        _el('pv-tbody').innerHTML = `
            <tr><td colspan="7" class="py-16 text-center text-slate-400">
                <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3 block text-brand-400"></i>
                جارٍ التحميل...
            </td></tr>`;

        try {
            const params = new URLSearchParams({ limit: _state.limit, offset: _state.page * _state.limit });
            if (_state.search) params.set('search', _state.search);
            if (_state.status) params.set('status', _state.status);
            if (_state.from)   params.set('from', _state.from);
            if (_state.to)     params.set('to', _state.to);

            const res = await window.apiFetch(`/api/payment-vouchers?${params}`);
            _state.rows  = res.data || [];
            _state.total = res.total || 0;

            _renderTable();
            _renderStats();
            _renderPagination();
        } catch (err) {
            console.error('[PaymentVoucher] Load error:', err);
            _el('pv-tbody').innerHTML = `
                <tr><td colspan="7" class="py-12 text-center text-red-400">
                    <i class="fa-solid fa-circle-exclamation text-3xl mb-3 block"></i>
                    فشل تحميل البيانات
                </td></tr>`;
        }
    }

    // ── Render Table ──────────────────────────────────────────────────────────
    function _renderTable() {
        if (!_state.rows.length) {
            _el('pv-tbody').innerHTML = `
                <tr><td colspan="7" class="py-16 text-center text-slate-400">
                    <i class="fa-solid fa-money-bill-transfer text-4xl mb-3 block text-slate-300"></i>
                    لا توجد سندات صرف
                </td></tr>`;
            return;
        }

        _el('pv-tbody').innerHTML = _state.rows.map(v => {
            const statusBadge = v.status === 'posted'
                ? '<span class="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold">مرحّل</span>'
                : '<span class="px-2.5 py-1 bg-red-100 text-red-600 rounded-lg text-xs font-bold">ملغي</span>';

            return `<tr class="hover:bg-slate-50/60 transition-colors cursor-pointer" data-id="${v.id}">
                <td class="py-3.5 px-4 font-mono font-bold text-brand-600">#${v.voucher_number}</td>
                <td class="py-3.5 px-4 text-slate-600 text-xs">${new Date(v.voucher_date).toLocaleDateString('ar-SA-u-nu-latn')}</td>
                <td class="py-3.5 px-4">
                    <div class="font-semibold text-slate-800">${esc(v.supplier_name || '---')}</div>
                    <div class="text-xs text-slate-400">${esc(v.supplier_phone || '')}</div>
                </td>
                <td class="py-3.5 px-4 text-slate-500 text-xs max-w-xs truncate">${esc(v.description || '---')}</td>
                <td class="py-3.5 px-4 text-left font-mono font-bold text-red-600 text-base">${fmt(v.total_amount)}</td>
                <td class="py-3.5 px-4 text-center">${statusBadge}</td>
                <td class="py-3.5 px-4 text-center">
                    <button class="pv-view-btn p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors" data-id="${v.id}" title="عرض التفاصيل">
                        <i class="fa-solid fa-eye text-sm"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');

        _el('pv-tbody').querySelectorAll('.pv-view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); _openDetailModal(btn.dataset.id); });
        });
    }

    // ── Render Stats ──────────────────────────────────────────────────────────
    function _renderStats() {
        const posted    = _state.rows.filter(v => v.status === 'posted');
        const cancelled = _state.rows.filter(v => v.status === 'cancelled');
        const total     = posted.reduce((s, v) => s + parseFloat(v.total_amount || 0), 0);
        _el('pv-stat-total').textContent     = fmt(total);
        _el('pv-stat-count').textContent     = _state.total;
        _el('pv-stat-cancelled').textContent = cancelled.length;
    }

    // ── Render Pagination ─────────────────────────────────────────────────────
    function _renderPagination() {
        const pagination = _el('pv-pagination');
        if (_state.total <= _state.limit) { pagination.classList.add('hidden'); return; }
        pagination.classList.remove('hidden');
        const start = _state.page * _state.limit + 1;
        const end   = Math.min(start + _state.limit - 1, _state.total);
        _el('pv-page-info').textContent = `${start}–${end} من ${_state.total}`;
        _el('pv-btn-prev').disabled = _state.page === 0;
        _el('pv-btn-next').disabled = end >= _state.total;
    }

    // ── Parent Account Dropdown ────────────────────────────────────────────────
    window.pvToggleParentDropdown = function() {
        const dd = _el('pv-parent-dropdown');
        dd.classList.toggle('hidden');
        if (!dd.classList.contains('hidden')) {
            _el('pv-parent-search').value = '';
            _renderParentList(_accountsTree.parents);
            _el('pv-parent-search').focus();
            _el('pv-child-dropdown').classList.add('hidden');
        }
    };

    window.pvFilterParent = function(query) {
        const q = (query || '').toLowerCase();
        const filtered = _accountsTree.parents.filter(a =>
            a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)
        );
        _renderParentList(filtered);
    };

    function _renderParentList(accounts) {
        const container = _el('pv-parent-list');
        if (accounts.length === 0) {
            container.innerHTML = '<div class="px-4 py-3 text-sm text-slate-400 text-center">لا توجد نتائج</div>';
            return;
        }
        container.innerHTML = accounts.map(a => `
            <div onclick="window.pvSelectParent('${esc(a.id)}', '${esc(a.code)}', '${esc(a.name)}', '${esc(a.account_type)}')"
                 class="px-4 py-2.5 hover:bg-brand-50 cursor-pointer border-b border-slate-50 last:border-0 flex items-center gap-3">
                <span class="font-mono text-xs text-slate-400 w-12">${esc(a.code)}</span>
                <span class="text-sm text-slate-700 flex-1">${esc(a.name)}</span>
                <span class="text-xs text-slate-400">${_typeLabels[a.account_type] || a.account_type}</span>
            </div>
        `).join('');
    }

    window.pvSelectParent = function(id, code, name, type) {
        _selectedParent = { id, code, name, type };
        _selectedChild = null;

        _el('pv-parent-label').textContent = `${code} — ${name}`;
        _el('pv-parent-label').classList.remove('text-slate-400');
        _el('pv-parent-label').classList.add('text-slate-700');
        _el('pv-parent-dropdown').classList.add('hidden');

        _el('pv-child-btn').disabled = false;
        _el('pv-child-label').textContent = 'اختر الحساب الفرعي...';
        _el('pv-child-label').classList.remove('text-slate-400');
        _el('pv-child-label').classList.add('text-slate-700');

        const children = _accountsTree.children.filter(c => c.parent_id === id);
        _renderChildList(children);
    };

    // ── Child Account Dropdown ─────────────────────────────────────────────────
    window.pvToggleChildDropdown = function() {
        if (!_selectedParent) return;
        const dd = _el('pv-child-dropdown');
        dd.classList.toggle('hidden');
        if (!dd.classList.contains('hidden')) {
            _el('pv-child-search').value = '';
            const children = _accountsTree.children.filter(c => c.parent_id === _selectedParent.id);
            _renderChildList(children);
            _el('pv-child-search').focus();
        }
    };

    window.pvFilterChild = function(query) {
        if (!_selectedParent) return;
        const q = (query || '').toLowerCase();
        const children = _accountsTree.children
            .filter(c => c.parent_id === _selectedParent.id)
            .filter(a => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q));
        _renderChildList(children);
    };

    function _renderChildList(accounts) {
        const container = _el('pv-child-list');
        let html = '';
        if (accounts.length === 0) {
            html = '<div class="px-4 py-3 text-sm text-slate-400 text-center">لا توجد حسابات فرعية</div>';
        } else {
            html = accounts.map(a => {
                const isVirtual = a.sub_account_type === 'client' || a.sub_account_type === 'supplier';
                const icon = a.sub_account_type === 'client' ? 'fa-user' : a.sub_account_type === 'supplier' ? 'fa-truck' : '';
                const subDetail = a.phone || a.city ? `<span class="text-xs text-slate-400 block mt-0.5">${esc(a.phone || '')} ${a.city ? '• ' + esc(a.city) : ''}</span>` : '';
                return `
                <div onclick="window.pvSelectChild('${esc(a.id)}', '${esc(a.code)}', '${esc(a.name)}', ${isVirtual ? `'${esc(a.sub_account_id)}'` : 'null'}, ${isVirtual ? `'${esc(a.sub_account_type)}'` : 'null'})"
                     class="px-4 py-2.5 hover:bg-brand-50 cursor-pointer border-b border-slate-50 last:border-0 flex items-center gap-3">
                    ${icon ? `<i class="fa-solid ${icon} text-slate-400 text-xs w-12 text-center"></i>` : `<span class="font-mono text-xs text-slate-400 w-12">${esc(a.code)}</span>`}
                    <div class="flex-1">
                        <span class="text-sm text-slate-700">${esc(a.name)}</span>
                        ${subDetail}
                    </div>
                </div>`;
            }).join('');
        }
        container.innerHTML = html;
    }

    window.pvSelectChild = function(id, code, name, subAccountId, subAccountType) {
        _selectedChild = { id, code, name, subAccountId: subAccountId || null, subAccountType: subAccountType || null };
        _el('pv-child-label').textContent = `${code} — ${name}`;
        _el('pv-child-label').classList.remove('text-slate-400');
        _el('pv-child-label').classList.add('text-slate-700');
        _el('pv-child-dropdown').classList.add('hidden');

        // Set hidden fields for submission
        _el('pv-supplier-id').value = subAccountId || id;
        _el('pv-payee-type').value = subAccountType || 'account';

        // Update preview DR label based on payee type
        if (subAccountType === 'client') {
            _el('pv-preview-dr-label').innerHTML = '<i class="fa-solid fa-arrow-up text-emerald-500 text-xs"></i> مدين — ذمم العملاء (1300)';
        } else if (subAccountType === 'supplier') {
            _el('pv-preview-dr-label').innerHTML = '<i class="fa-solid fa-arrow-up text-emerald-500 text-xs"></i> مدين — ذمم الموردين (2100)';
        }

        // Load unpaid invoices for suppliers
        if (subAccountType === 'supplier') {
            _loadSupplierInvoices(subAccountId);
        } else {
            _el('pv-invoices-section').classList.add('hidden');
            _el('pv-purchase-invoice-id').value = '';
            _el('pv-invoice-selected-info').classList.add('hidden');
        }
    };

    // ── Load Supplier Invoices ─────────────────────────────────────────────────
    async function _loadSupplierInvoices(supplierId) {
        const section = _el('pv-invoices-section');
        const list    = _el('pv-invoices-list');
        section.classList.remove('hidden');
        list.innerHTML = '<div class="text-center text-slate-400 text-xs py-3"><i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جارٍ التحميل...</div>';
        _el('pv-purchase-invoice-id').value = '';
        _el('pv-invoice-selected-info').classList.add('hidden');

        try {
            const res = await window.apiFetch(`/api/purchase-invoices?supplier_id=${supplierId}&status=unpaid&limit=50&_t=${Date.now()}`);
            const invoices = (res.data || []).filter(i => i.status === 'unpaid' || i.status === 'partially_paid');

            if (!invoices.length) {
                list.innerHTML = '<div class="text-center text-emerald-600 text-xs py-3 font-semibold"><i class="fa-solid fa-circle-check ml-1"></i> لا توجد فواتير متأخرة — المورد مسدد بالكامل</div>';
                return;
            }

            list.innerHTML = invoices.map(inv => {
                const remaining = parseFloat(inv.grand_total) - parseFloat(inv.paid_amount || 0);
                const statusLabel = inv.status === 'partially_paid' ? 'جزئي' : 'غير مدفوعة';
                const statusColor = inv.status === 'partially_paid' ? 'text-amber-600' : 'text-red-600';
                const clientInfo = inv.client_name ? `<span class="text-xs text-blue-600 font-semibold">${esc(inv.client_name)}</span>` : '';
                const moInfo    = inv.mo_number    ? `<span class="text-xs text-slate-400">أمر #${inv.mo_number}</span>` : '';
                return `<label class="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white cursor-pointer border border-transparent hover:border-purple-200 transition-all">
                    <input type="radio" name="pv-inv" value="${inv.id}"
                           data-amount="${remaining}"
                           data-label="#${inv.invoice_number} — ${esc(inv.supplier_name)}${inv.client_name ? ' / ' + esc(inv.client_name) : ''} — متبقي ${fmt(remaining)} ريال"
                           class="accent-purple-600" />
                    <div class="flex-1">
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-slate-800 font-mono text-sm">#${inv.invoice_number}</span>
                            <span class="text-xs font-bold ${statusColor}">${statusLabel}</span>
                        </div>
                        <div class="flex items-center justify-between mt-0.5">
                            <div class="flex items-center gap-2">
                                <span class="text-xs text-slate-400">${new Date(inv.invoice_date).toLocaleDateString('ar-SA-u-nu-latn')}</span>
                                ${clientInfo}
                                ${moInfo}
                            </div>
                            <span class="text-sm font-black text-purple-600 font-mono">${fmt(remaining)} <span class="text-xs font-normal">متبقي</span></span>
                        </div>
                    </div>
                </label>`;
            }).join('');

            list.querySelectorAll('input[name="pv-inv"]').forEach(radio => {
                radio.addEventListener('change', () => {
                    _el('pv-purchase-invoice-id').value = radio.value;
                    _el('pv-amount').value = parseFloat(radio.dataset.amount).toFixed(2);
                    _el('pv-invoice-selected-info').textContent = '✓ ' + radio.dataset.label;
                    _el('pv-invoice-selected-info').classList.remove('hidden');
                    _updatePreview();
                });
            });
        } catch (err) {
            list.innerHTML = `<div class="text-center text-red-400 text-xs py-3">فشل تحميل الفواتير: ${esc(err.message)}</div>`;
        }
    }

    // ── Preview Update ────────────────────────────────────────────────────────
    function _updatePreview() {
        const v = parseFloat(_el('pv-amount').value) || 0;
        _el('pv-preview-amount').textContent  = fmt(v);
        _el('pv-preview-amount2').textContent = fmt(v);
    }

    // ── New Voucher Modal ─────────────────────────────────────────────────────
    function _openNewModal() { _clearNewForm(); _el('pv-modal').classList.remove('hidden'); }
    function _closeNewModal() { _el('pv-modal').classList.add('hidden'); }

    function _clearNewForm() {
        _selectedParent = null;
        _selectedChild = null;
        _state.payeeType = 'supplier';
        _el('pv-parent-label').textContent = 'اختر الحساب الرئيسي...';
        _el('pv-parent-label').classList.add('text-slate-400');
        _el('pv-parent-label').classList.remove('text-slate-700');
        _el('pv-parent-dropdown').classList.add('hidden');
        _el('pv-child-btn').disabled = true;
        _el('pv-child-label').textContent = 'اختر الحساب الرئيسي أولاً...';
        _el('pv-child-label').classList.add('text-slate-400');
        _el('pv-child-label').classList.remove('text-slate-700');
        _el('pv-child-dropdown').classList.add('hidden');
        _el('pv-supplier-id').value = '';
        _el('pv-payee-type').value = '';
        _el('pv-invoices-section').classList.add('hidden');
        _el('pv-purchase-invoice-id').value = '';
        _el('pv-invoice-selected-info').classList.add('hidden');
        _el('pv-amount').value      = '';
        _el('pv-description').value = '';
        _el('pv-date').value        = new Date().toISOString().split('T')[0];
        _el('pv-payment-method').value = 'cash';
        _el('pv-preview-dr-label').innerHTML = '<i class="fa-solid fa-arrow-up text-emerald-500 text-xs"></i> مدين — ذمم الموردين (2100)';
        _updatePreview();
    }

    // ── Submit Voucher ────────────────────────────────────────────────────────
    async function _submitVoucher() {
        const supplierId    = _el('pv-supplier-id').value;
        const payeeType     = _el('pv-payee-type').value || 'supplier';
        const amount        = parseFloat(_el('pv-amount').value);
        const cashAccId     = _el('pv-cash-account').value;
        const voucherDate   = _el('pv-date').value;
        const description   = _el('pv-description').value.trim();
        const paymentMethod = _el('pv-payment-method').value;

        if (!supplierId)         return window.showToast('يجب اختيار الحساب الفرعي', 'warning');
        if (!amount || amount <= 0) return window.showToast('يجب إدخال مبلغ صحيح أكبر من صفر', 'warning');
        if (!cashAccId)          return window.showToast('يجب اختيار حساب الدفع', 'warning');
        if (!voucherDate)        return window.showToast('يجب إدخال التاريخ', 'warning');

        const btn = _el('pv-modal-submit');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-2"></i> جارٍ الحفظ...';

        try {
            const purchaseInvoiceId = _el('pv-purchase-invoice-id')?.value || null;
            await window.apiFetch('/api/payment-vouchers', {
                method: 'POST',
                body: { payee_type: payeeType, payee_id: supplierId, amount, cash_account_id: cashAccId, voucher_date: voucherDate, description, payment_method: paymentMethod, purchase_invoice_id: purchaseInvoiceId || undefined }
            });
            window.showToast('تم حفظ سند الصرف بنجاح', 'success');
            _closeNewModal();
            _state.page = 0;
            _loadVouchers();
        } catch (err) {
            window.showToast(err.message || 'فشل حفظ السند', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> حفظ السند';
        }
    }

    // ── Detail Modal ──────────────────────────────────────────────────────────
    async function _openDetailModal(id) {
        _state.selectedVoucherId = id;
        _el('pv-detail-modal').classList.remove('hidden');
        _el('pv-detail-cancel-btn').classList.add('hidden');
        _el('pv-detail-body').innerHTML = `
            <div class="text-center py-8 text-slate-400">
                <i class="fa-solid fa-circle-notch fa-spin text-2xl block mb-2"></i>
                جارٍ التحميل...
            </div>`;
        try {
            const res = await window.apiFetch(`/api/payment-vouchers/${id}`);
            const v = res.data;
            _renderDetail(v);
            if (v.status === 'posted') _el('pv-detail-cancel-btn').classList.remove('hidden');
        } catch (err) {
            _el('pv-detail-body').innerHTML = `<div class="text-center py-8 text-red-400">فشل تحميل التفاصيل</div>`;
        }
    }

    function _renderDetail(v) {
        _state._currentVoucher = v;
        const statusBadge = v.status === 'posted'
            ? '<span class="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold">مرحّل</span>'
            : '<span class="px-3 py-1 bg-red-100 text-red-600 rounded-lg text-xs font-bold">ملغي</span>';

        _el('pv-detail-body').innerHTML = `
            <div class="flex items-start justify-between">
                <div>
                    <div class="flex items-center gap-2 mb-1">
                        <span class="text-xl font-black text-brand-600 font-mono">#${v.voucher_number}</span>
                        ${statusBadge}
                    </div>
                    <p class="text-sm text-slate-500">${new Date(v.voucher_date).toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' })}</p>
                </div>
                <div class="text-left">
                    <p class="text-xs text-slate-400 mb-0.5">المبلغ الإجمالي</p>
                    <p class="text-2xl font-black text-red-600 font-mono">${fmt(v.total_amount)}</p>
                </div>
            </div>

            <div class="bg-slate-50 rounded-lg p-3 border border-slate-200">
                <p class="text-xs text-slate-500 mb-1">المورد</p>
                <p class="font-bold text-slate-800">${esc(v.supplier_name || '---')}</p>
                ${v.supplier_phone ? `<p class="text-sm text-slate-500 mt-0.5">${esc(v.supplier_phone)}</p>` : ''}
            </div>

            ${v.description ? `<div class="text-sm text-slate-600 bg-amber-50 border border-amber-100 rounded-lg p-3">${esc(v.description)}</div>` : ''}

            <div>
                <p class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <i class="fa-solid fa-scale-balanced text-brand-400"></i>
                    القيد المحاسبي
                </p>
                <div class="rounded-lg border border-slate-200 overflow-hidden text-sm">
                    <table class="w-full">
                        <thead class="bg-slate-50 text-slate-600">
                            <tr>
                                <th class="py-2 px-3 text-right font-semibold">الحساب</th>
                                <th class="py-2 px-3 text-left font-semibold text-emerald-700">مدين</th>
                                <th class="py-2 px-3 text-left font-semibold text-red-600">دائن</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${(v.lines || []).map(l => `
                                <tr>
                                    <td class="py-2.5 px-3">
                                        <span class="font-mono text-xs text-slate-400 ml-1">${esc(l.account_code)}</span>
                                        <span class="text-slate-700">${esc(l.account_name)}</span>
                                    </td>
                                    <td class="py-2.5 px-3 text-left font-mono font-semibold ${parseFloat(l.debit) > 0 ? 'text-emerald-600' : 'text-slate-300'}">${parseFloat(l.debit) > 0 ? fmt(l.debit) : '-'}</td>
                                    <td class="py-2.5 px-3 text-left font-mono font-semibold ${parseFloat(l.credit) > 0 ? 'text-red-500' : 'text-slate-300'}">${parseFloat(l.credit) > 0 ? fmt(l.credit) : '-'}</td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <p class="text-xs text-slate-400 text-left">بواسطة: ${esc(v.created_by_name || 'النظام')} • ${new Date(v.created_at).toLocaleDateString('ar-SA-u-nu-latn')}</p>
        `;
    }

    // ── Print Voucher ─────────────────────────────────────────────────────────
    function _printVoucher() {
        if (!_state.selectedVoucherId) return;
        const v = _state._currentVoucher;
        if (!v) return;

        const isClient    = v.reference_type === 'client';
        const payeeLabel  = isClient ? 'العميل' : 'المورد';
        const statusText  = v.status === 'posted' ? 'مرحّل' : 'ملغي';
        const statusColor = v.status === 'posted' ? '#15803d' : '#dc2626';
        const statusBg    = v.status === 'posted' ? '#dcfce7' : '#fee2e2';

        const lines = (v.lines || []).map(l => `
            <tr>
                <td style="padding:8px 12px;border:1px solid #e2e8f0">
                    ${esc(l.account_name)}
                    <span style="color:#94a3b8;font-size:11px;margin-right:4px">(${esc(l.account_code)})</span>
                </td>
                <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left;font-family:monospace;color:${parseFloat(l.debit)>0?'#16a34a':'#94a3b8'}">
                    ${parseFloat(l.debit) > 0 ? fmt(l.debit) : '-'}
                </td>
                <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left;font-family:monospace;color:${parseFloat(l.credit)>0?'#dc2626':'#94a3b8'}">
                    ${parseFloat(l.credit) > 0 ? fmt(l.credit) : '-'}
                </td>
            </tr>`).join('');

        const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>سند صرف #${v.voucher_number}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  * { font-family: 'Cairo', sans-serif; margin: 0; padding: 0; box-sizing: border-box; }
  body { padding: 36px 48px; color: #1e293b; font-size: 13px; direction: rtl; }
  @media print { body { padding: 24px 32px; } }
</style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
    <div>
      <div style="font-size:26px;font-weight:900;color:#dc2626">G.PACK</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px">سند صرف</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">Payment Voucher</div>
    </div>
    <div style="text-align:left">
      <div style="font-size:32px;font-weight:900;color:#dc2626;font-family:monospace">#${v.voucher_number}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px">${new Date(v.voucher_date).toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'})}</div>
      <div style="margin-top:6px;display:inline-block;background:${statusBg};color:${statusColor};padding:3px 10px;border-radius:4px;font-size:12px;font-weight:700">${statusText}</div>
    </div>
  </div>
  <hr style="border:none;border-top:2px solid #e2e8f0;margin-bottom:20px">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px">
    <div>
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${payeeLabel}</div>
      <div style="font-weight:700;font-size:16px">${esc(v.supplier_name || '---')}</div>
      ${v.supplier_phone ? `<div style="color:#64748b;font-size:12px;margin-top:2px">${esc(v.supplier_phone)}</div>` : ''}
    </div>
    <div>
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">المبلغ المدفوع</div>
      <div style="font-size:26px;font-weight:900;color:#dc2626;font-family:monospace">${fmt(v.total_amount)} <span style="font-size:14px;font-weight:600">ريال</span></div>
    </div>
  </div>
  ${v.description ? `<div style="margin-bottom:16px;background:#fefce8;border:1px solid #fde68a;padding:10px 14px;border-radius:6px;font-size:12px">بيان: ${esc(v.description)}</div>` : ''}
  <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">القيد المحاسبي المزدوج</div>
  <table style="width:100%;border-collapse:collapse">
    <thead>
      <tr style="background:#f8fafc">
        <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;font-size:12px">الحساب</th>
        <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left;font-size:12px;color:#16a34a">مدين</th>
        <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left;font-size:12px;color:#dc2626">دائن</th>
      </tr>
    </thead>
    <tbody>${lines}</tbody>
  </table>
  <div style="margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:48px;text-align:center">
    <div style="border-top:1px solid #cbd5e1;padding-top:8px;font-size:11px;color:#64748b">توقيع المستلم</div>
    <div style="border-top:1px solid #cbd5e1;padding-top:8px;font-size:11px;color:#64748b">توقيع المحاسب</div>
  </div>
  <div style="margin-top:24px;text-align:center;font-size:10px;color:#94a3b8;border-top:1px dashed #cbd5e1;padding-top:12px">
    بواسطة: ${esc(v.created_by_name || 'النظام')} &nbsp;|&nbsp; تاريخ الطباعة: ${new Date().toLocaleDateString('ar-SA-u-nu-latn')} &nbsp;|&nbsp; G.PACK ERP 2.0
  </div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>
</body></html>`;

        const w = window.open('', '_blank', 'width=800,height=600');
        w.document.write(html);
        w.document.close();
    }

    function _closeDetailModal() {
        _el('pv-detail-modal').classList.add('hidden');
        _state.selectedVoucherId = null;
        _state._currentVoucher = null;
    }

    // ── Cancel Voucher ────────────────────────────────────────────────────────
    async function _cancelVoucher() {
        if (!_state.selectedVoucherId) return;
        if (!confirm('هل أنت متأكد من إلغاء هذا السند؟ لا يمكن التراجع عن هذا الإجراء.')) return;

        const btn = _el('pv-detail-cancel-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-2"></i> جارٍ الإلغاء...';

        try {
            await window.apiFetch(`/api/payment-vouchers/${_state.selectedVoucherId}/cancel`, {
                method: 'POST',
                body: { reason: '' }
            });
            window.showToast('تم إلغاء السند بنجاح', 'success');
            _closeDetailModal();
            _loadVouchers();
        } catch (err) {
            window.showToast(err.message || 'فشل إلغاء السند', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-ban"></i> إلغاء السند';
        }
    }

    // ── Start ─────────────────────────────────────────────────────────────────
    _init();

})();
