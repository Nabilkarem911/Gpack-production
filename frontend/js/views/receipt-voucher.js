'use strict';

// =============================================================================
// G.PACK 2.0 — Receipt Vouchers View Controller (سندات القبض)
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
        // Set default date to today
        const today = new Date().toISOString().split('T')[0];
        _el('rv-date').value = today;

        // Load accounts tree for dropdowns
        try {
            const data = await window.apiFetch('/api/account-statement/accounts-tree');
            _accountsTree = data;
            _renderParentList(data.parents);
        } catch (err) {
            console.error('[ReceiptVoucher] Failed to load accounts tree:', err);
        }

        // Click outside to close dropdowns
        document.addEventListener('click', (e) => {
            const parentWrap = _el('rv-parent-btn')?.closest('.flex-1');
            if (parentWrap && !parentWrap.contains(e.target)) {
                _el('rv-parent-dropdown').classList.add('hidden');
            }
            const childWrap = _el('rv-child-btn')?.closest('.flex-1');
            if (childWrap && !childWrap.contains(e.target)) {
                _el('rv-child-dropdown').classList.add('hidden');
            }
        });
    }

    // ── Bind Events ───────────────────────────────────────────────────────────
    function _bindEvents() {
        // Toolbar
        _el('rv-btn-new').addEventListener('click', _openNewModal);
        _el('rv-btn-filter').addEventListener('click', () => {
            _state.page = 0;
            _state.search = _el('rv-search').value.trim();
            _state.status = _el('rv-filter-status').value;
            _state.from   = _el('rv-filter-from').value;
            _state.to     = _el('rv-filter-to').value;
            _loadVouchers();
        });
        _el('rv-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') _el('rv-btn-filter').click(); });

        // Pagination
        _el('rv-btn-prev').addEventListener('click', () => { if (_state.page > 0) { _state.page--; _loadVouchers(); } });
        _el('rv-btn-next').addEventListener('click', () => {
            if ((_state.page + 1) * _state.limit < _state.total) { _state.page++; _loadVouchers(); }
        });

        // New voucher modal
        _el('rv-modal-close').addEventListener('click', _closeNewModal);
        _el('rv-modal-cancel').addEventListener('click', _closeNewModal);
        _el('rv-modal-backdrop').addEventListener('click', _closeNewModal);
        _el('rv-modal-submit').addEventListener('click', _submitVoucher);

        // Amount preview update
        _el('rv-amount').addEventListener('input', _updatePreview);

        // Detail modal
        _el('rv-detail-close').addEventListener('click', _closeDetailModal);
        _el('rv-detail-close-btn').addEventListener('click', _closeDetailModal);
        _el('rv-detail-backdrop').addEventListener('click', _closeDetailModal);
        _el('rv-detail-cancel-btn').addEventListener('click', _cancelVoucher);
        _el('rv-detail-print-btn').addEventListener('click', _printVoucher);
    }

    // ── Load Accounts (Cash / Bank) ───────────────────────────────────────────
    async function _loadAccounts() {
        try {
            const res = await window.apiFetch('/api/receipt-vouchers/meta/accounts');
            const select = _el('rv-cash-account');
            select.innerHTML = res.data.map(a =>
                `<option value="${a.id}">${a.code} — ${a.name}</option>`
            ).join('');
        } catch (err) {
            console.error('[ReceiptVoucher] Failed to load accounts:', err);
        }
    }

    // ── Load Vouchers List ────────────────────────────────────────────────────
    async function _loadVouchers() {
        _el('rv-tbody').innerHTML = `
            <tr><td colspan="7" class="py-16 text-center text-slate-400">
                <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3 block text-brand-400"></i>
                جارٍ التحميل...
            </td></tr>`;

        try {
            const params = new URLSearchParams({
                limit:  _state.limit,
                offset: _state.page * _state.limit,
            });
            if (_state.search) params.set('search', _state.search);
            if (_state.status) params.set('status', _state.status);
            if (_state.from)   params.set('from', _state.from);
            if (_state.to)     params.set('to', _state.to);

            const res = await window.apiFetch(`/api/receipt-vouchers?${params}`);
            _state.rows  = res.data || [];
            _state.total = res.total || 0;

            _renderTable();
            _renderStats();
            _renderPagination();
        } catch (err) {
            console.error('[ReceiptVoucher] Load error:', err);
            _el('rv-tbody').innerHTML = `
                <tr><td colspan="7" class="py-12 text-center text-red-400">
                    <i class="fa-solid fa-circle-exclamation text-3xl mb-3 block"></i>
                    فشل تحميل البيانات
                </td></tr>`;
        }
    }

    // ── Render Table ──────────────────────────────────────────────────────────
    function _renderTable() {
        if (!_state.rows.length) {
            _el('rv-tbody').innerHTML = `
                <tr><td colspan="7" class="py-16 text-center text-slate-400">
                    <i class="fa-solid fa-hand-holding-dollar text-4xl mb-3 block text-slate-300"></i>
                    لا توجد سندات قبض
                </td></tr>`;
            return;
        }

        _el('rv-tbody').innerHTML = _state.rows.map(v => {
            const statusBadge = v.status === 'posted'
                ? '<span class="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold">مرحّل</span>'
                : '<span class="px-2.5 py-1 bg-red-100 text-red-600 rounded-lg text-xs font-bold">ملغي</span>';

            return `<tr class="hover:bg-slate-50/60 transition-colors cursor-pointer" data-id="${v.id}">
                <td class="py-3.5 px-4 font-mono font-bold text-brand-600">#${v.voucher_number}</td>
                <td class="py-3.5 px-4 text-slate-600 text-xs">${new Date(v.voucher_date).toLocaleDateString('ar-SA-u-nu-latn')}</td>
                <td class="py-3.5 px-4">
                    <div class="font-semibold text-slate-800">${esc(v.client_name || '---')}</div>
                    <div class="text-xs text-slate-400">${esc(v.client_phone || '')}</div>
                </td>
                <td class="py-3.5 px-4 text-slate-500 text-xs max-w-xs truncate">${esc(v.description || '---')}</td>
                <td class="py-3.5 px-4 text-left font-mono font-bold text-emerald-600 text-base">${fmt(v.total_amount)}</td>
                <td class="py-3.5 px-4 text-center">${statusBadge}</td>
                <td class="py-3.5 px-4 text-center">
                    <button class="rv-view-btn p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors" data-id="${v.id}" title="عرض التفاصيل">
                        <i class="fa-solid fa-eye text-sm"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');

        // Row click → open detail
        _el('rv-tbody').querySelectorAll('tr[data-id]').forEach(row => {
            row.addEventListener('click', (e) => {
                if (!e.target.closest('.rv-view-btn')) return;
                _openDetailModal(row.dataset.id);
            });
        });
        _el('rv-tbody').querySelectorAll('.rv-view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); _openDetailModal(btn.dataset.id); });
        });
    }

    // ── Render Stats ──────────────────────────────────────────────────────────
    function _renderStats() {
        const posted    = _state.rows.filter(v => v.status === 'posted');
        const cancelled = _state.rows.filter(v => v.status === 'cancelled');
        const total     = posted.reduce((s, v) => s + parseFloat(v.total_amount || 0), 0);
        _el('rv-stat-total').textContent     = fmt(total);
        _el('rv-stat-count').textContent     = _state.total;
        _el('rv-stat-cancelled').textContent = cancelled.length;
    }

    // ── Render Pagination ─────────────────────────────────────────────────────
    function _renderPagination() {
        const pagination = _el('rv-pagination');
        if (_state.total <= _state.limit) {
            pagination.classList.add('hidden');
            return;
        }
        pagination.classList.remove('hidden');
        const start = _state.page * _state.limit + 1;
        const end   = Math.min(start + _state.limit - 1, _state.total);
        _el('rv-page-info').textContent = `${start}–${end} من ${_state.total}`;
        _el('rv-btn-prev').disabled = _state.page === 0;
        _el('rv-btn-next').disabled = end >= _state.total;
    }

    // ── Parent Account Dropdown ────────────────────────────────────────────────
    window.rvToggleParentDropdown = function() {
        const dd = _el('rv-parent-dropdown');
        dd.classList.toggle('hidden');
        if (!dd.classList.contains('hidden')) {
            _el('rv-parent-search').value = '';
            _renderParentList(_accountsTree.parents);
            _el('rv-parent-search').focus();
            _el('rv-child-dropdown').classList.add('hidden');
        }
    };

    window.rvFilterParent = function(query) {
        const q = (query || '').toLowerCase();
        const filtered = _accountsTree.parents.filter(a =>
            a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)
        );
        _renderParentList(filtered);
    };

    function _renderParentList(accounts) {
        const container = _el('rv-parent-list');
        if (accounts.length === 0) {
            container.innerHTML = '<div class="px-4 py-3 text-sm text-slate-400 text-center">لا توجد نتائج</div>';
            return;
        }
        container.innerHTML = accounts.map(a => `
            <div onclick="window.rvSelectParent('${esc(a.id)}', '${esc(a.code)}', '${esc(a.name)}', '${esc(a.account_type)}')"
                 class="px-4 py-2.5 hover:bg-brand-50 cursor-pointer border-b border-slate-50 last:border-0 flex items-center gap-3">
                <span class="font-mono text-xs text-slate-400 w-12">${esc(a.code)}</span>
                <span class="text-sm text-slate-700 flex-1">${esc(a.name)}</span>
                <span class="text-xs text-slate-400">${_typeLabels[a.account_type] || a.account_type}</span>
            </div>
        `).join('');
    }

    window.rvSelectParent = function(id, code, name, type) {
        _selectedParent = { id, code, name, type };
        _selectedChild = null;

        _el('rv-parent-label').textContent = `${code} — ${name}`;
        _el('rv-parent-label').classList.remove('text-slate-400');
        _el('rv-parent-label').classList.add('text-slate-700');
        _el('rv-parent-dropdown').classList.add('hidden');

        _el('rv-child-btn').disabled = false;
        _el('rv-child-label').textContent = 'اختر الحساب الفرعي...';
        _el('rv-child-label').classList.remove('text-slate-400');
        _el('rv-child-label').classList.add('text-slate-700');

        const children = _accountsTree.children.filter(c => c.parent_id === id);
        _renderChildList(children);
    };

    // ── Child Account Dropdown ─────────────────────────────────────────────────
    window.rvToggleChildDropdown = function() {
        if (!_selectedParent) return;
        const dd = _el('rv-child-dropdown');
        dd.classList.toggle('hidden');
        if (!dd.classList.contains('hidden')) {
            _el('rv-child-search').value = '';
            const children = _accountsTree.children.filter(c => c.parent_id === _selectedParent.id);
            _renderChildList(children);
            _el('rv-child-search').focus();
        }
    };

    window.rvFilterChild = function(query) {
        if (!_selectedParent) return;
        const q = (query || '').toLowerCase();
        const children = _accountsTree.children
            .filter(c => c.parent_id === _selectedParent.id)
            .filter(a => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q));
        _renderChildList(children);
    };

    function _renderChildList(accounts) {
        const container = _el('rv-child-list');
        let html = '';
        if (accounts.length === 0) {
            html = '<div class="px-4 py-3 text-sm text-slate-400 text-center">لا توجد حسابات فرعية</div>';
        } else {
            html = accounts.map(a => {
                const isVirtual = a.sub_account_type === 'client' || a.sub_account_type === 'supplier';
                const icon = a.sub_account_type === 'client' ? 'fa-user' : a.sub_account_type === 'supplier' ? 'fa-truck' : '';
                const subDetail = a.phone || a.city ? `<span class="text-xs text-slate-400 block mt-0.5">${esc(a.phone || '')} ${a.city ? '• ' + esc(a.city) : ''}</span>` : '';
                return `
                <div onclick="window.rvSelectChild('${esc(a.id)}', '${esc(a.code)}', '${esc(a.name)}', ${isVirtual ? `'${esc(a.sub_account_id)}'` : 'null'}, ${isVirtual ? `'${esc(a.sub_account_type)}'` : 'null'})"
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

    window.rvSelectChild = function(id, code, name, subAccountId, subAccountType) {
        _selectedChild = { id, code, name, subAccountId: subAccountId || null, subAccountType: subAccountType || null };
        _el('rv-child-label').textContent = `${code} — ${name}`;
        _el('rv-child-label').classList.remove('text-slate-400');
        _el('rv-child-label').classList.add('text-slate-700');
        _el('rv-child-dropdown').classList.add('hidden');

        // Set hidden fields for submission
        _el('rv-client-id').value = subAccountId || id;
        _el('rv-client-type').value = subAccountType || 'account';
    };

    // ── Preview Update ────────────────────────────────────────────────────────
    function _updatePreview() {
        const v = parseFloat(_el('rv-amount').value) || 0;
        _el('rv-preview-amount').textContent  = fmt(v);
        _el('rv-preview-amount2').textContent = fmt(v);
    }

    // ── New Voucher Modal ─────────────────────────────────────────────────────
    function _openNewModal() {
        _clearNewForm();
        _el('rv-modal').classList.remove('hidden');
    }

    function _closeNewModal() {
        _el('rv-modal').classList.add('hidden');
    }

    function _clearNewForm() {
        _selectedParent = null;
        _selectedChild = null;
        _el('rv-parent-label').textContent = 'اختر الحساب الرئيسي...';
        _el('rv-parent-label').classList.add('text-slate-400');
        _el('rv-parent-label').classList.remove('text-slate-700');
        _el('rv-parent-dropdown').classList.add('hidden');
        _el('rv-child-btn').disabled = true;
        _el('rv-child-label').textContent = 'اختر الحساب الرئيسي أولاً...';
        _el('rv-child-label').classList.add('text-slate-400');
        _el('rv-child-label').classList.remove('text-slate-700');
        _el('rv-child-dropdown').classList.add('hidden');
        _el('rv-client-id').value = '';
        _el('rv-client-type').value = '';
        _el('rv-amount').value      = '';
        _el('rv-description').value = '';
        _el('rv-date').value        = new Date().toISOString().split('T')[0];
        _el('rv-payment-method').value = 'cash';
        _updatePreview();
    }

    // ── Submit Voucher ────────────────────────────────────────────────────────
    async function _submitVoucher() {
        const clientId     = _el('rv-client-id').value;
        const clientType   = _el('rv-client-type').value;
        const amount       = parseFloat(_el('rv-amount').value);
        const cashAccId    = _el('rv-cash-account').value;
        const voucherDate  = _el('rv-date').value;
        const description  = _el('rv-description').value.trim();
        const paymentMethod = _el('rv-payment-method').value;

        if (!clientId)           return window.showToast('يجب اختيار الحساب الفرعي', 'warning');
        if (!amount || amount <= 0) return window.showToast('يجب إدخال مبلغ صحيح أكبر من صفر', 'warning');
        if (!cashAccId)          return window.showToast('يجب اختيار حساب الاستلام', 'warning');
        if (!voucherDate)        return window.showToast('يجب إدخال التاريخ', 'warning');

        const btn = _el('rv-modal-submit');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-2"></i> جارٍ الحفظ...';

        try {
            await window.apiFetch('/api/receipt-vouchers', {
                method: 'POST',
                body: { client_id: clientId, client_type: clientType, amount, cash_account_id: cashAccId, voucher_date: voucherDate, description, payment_method: paymentMethod }
            });
            window.showToast('تم حفظ سند القبض بنجاح', 'success');
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
        _el('rv-detail-modal').classList.remove('hidden');
        _el('rv-detail-cancel-btn').classList.add('hidden');
        _el('rv-detail-body').innerHTML = `
            <div class="text-center py-8 text-slate-400">
                <i class="fa-solid fa-circle-notch fa-spin text-2xl block mb-2"></i>
                جارٍ التحميل...
            </div>`;

        try {
            const res = await window.apiFetch(`/api/receipt-vouchers/${id}`);
            const v   = res.data;
            _renderDetail(v);
            if (v.status === 'posted') {
                _el('rv-detail-cancel-btn').classList.remove('hidden');
            }
        } catch (err) {
            _el('rv-detail-body').innerHTML = `<div class="text-center py-8 text-red-400">فشل تحميل التفاصيل</div>`;
        }
    }

    function _renderDetail(v) {
        _state._currentVoucher = v;
        const statusBadge = v.status === 'posted'
            ? '<span class="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold">مرحّل</span>'
            : '<span class="px-3 py-1 bg-red-100 text-red-600 rounded-lg text-xs font-bold">ملغي</span>';

        _el('rv-detail-body').innerHTML = `
            <!-- Header Info -->
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
                    <p class="text-2xl font-black text-emerald-600 font-mono">${fmt(v.total_amount)}</p>
                </div>
            </div>

            <!-- Client -->
            <div class="bg-slate-50 rounded-lg p-3 border border-slate-200">
                <p class="text-xs text-slate-500 mb-1">العميل</p>
                <p class="font-bold text-slate-800">${esc(v.client_name || '---')}</p>
                ${v.client_phone ? `<p class="text-sm text-slate-500 mt-0.5">${esc(v.client_phone)}</p>` : ''}
            </div>

            <!-- Description -->
            ${v.description ? `<div class="text-sm text-slate-600 bg-amber-50 border border-amber-100 rounded-lg p-3">${esc(v.description)}</div>` : ''}

            <!-- Double-entry Lines -->
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

        const statusText = v.status === 'posted' ? 'مرحّل' : 'ملغي';
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
<title>سند قبض #${v.voucher_number}</title>
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
      <div style="font-size:26px;font-weight:900;color:#2563eb">G.PACK</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px">سند قبض</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">Receipt Voucher</div>
    </div>
    <div style="text-align:left">
      <div style="font-size:32px;font-weight:900;color:#2563eb;font-family:monospace">#${v.voucher_number}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px">${new Date(v.voucher_date).toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'})}</div>
      <div style="margin-top:6px;display:inline-block;background:${statusBg};color:${statusColor};padding:3px 10px;border-radius:4px;font-size:12px;font-weight:700">${statusText}</div>
    </div>
  </div>
  <hr style="border:none;border-top:2px solid #e2e8f0;margin-bottom:20px">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px">
    <div>
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">العميل</div>
      <div style="font-weight:700;font-size:16px">${esc(v.client_name || '---')}</div>
      ${v.client_phone ? `<div style="color:#64748b;font-size:12px;margin-top:2px">${esc(v.client_phone)}</div>` : ''}
    </div>
    <div>
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">المبلغ المقبوض</div>
      <div style="font-size:26px;font-weight:900;color:#16a34a;font-family:monospace">${fmt(v.total_amount)} <span style="font-size:14px;font-weight:600">ريال</span></div>
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
    <div style="border-top:1px solid #cbd5e1;padding-top:8px;font-size:11px;color:#64748b">توقيع العميل</div>
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
        _el('rv-detail-modal').classList.add('hidden');
        _state.selectedVoucherId = null;
        _state._currentVoucher = null;
    }

    // ── Cancel Voucher ────────────────────────────────────────────────────────
    async function _cancelVoucher() {
        if (!_state.selectedVoucherId) return;
        if (!confirm('هل أنت متأكد من إلغاء هذا السند؟ لا يمكن التراجع عن هذا الإجراء.')) return;

        const btn = _el('rv-detail-cancel-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-2"></i> جارٍ الإلغاء...';

        try {
            await window.apiFetch(`/api/receipt-vouchers/${_state.selectedVoucherId}/cancel`, {
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
