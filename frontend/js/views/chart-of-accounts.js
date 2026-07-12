'use strict';

// =============================================================================
// G.PACK 2.0 - Chart of Accounts View Controller
// =============================================================================

(function () {

    const fmt = (v) => parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _el = (id) => document.getElementById(id);

    const TYPE_LABEL = {
        asset:     { label: 'أصول',          cls: 'bg-blue-100 text-blue-700' },
        liability: { label: 'خصوم',          cls: 'bg-red-100 text-red-700' },
        equity:    { label: 'حقوق الملكية',  cls: 'bg-purple-100 text-purple-700' },
        revenue:   { label: 'إيرادات',       cls: 'bg-emerald-100 text-emerald-700' },
        expense:   { label: 'مصاريف',        cls: 'bg-amber-100 text-amber-700' },
    };

    const VOUCHER_TYPE_LABEL = {
        payment:  'سند صرف',
        receipt:  'سند قبض',
        journal:  'قيد يومية',
        purchase: 'فاتورة شراء',
        sale:     'فاتورة مبيعات',
    };

    let _allAccounts = [];

    // ─────────────────────────────────────────────────────────────────────────
    // Load all accounts
    // ─────────────────────────────────────────────────────────────────────────
    async function _load() {
        _el('coa-loading')?.classList.remove('hidden');
        _el('coa-table-wrap')?.classList.add('hidden');
        _el('coa-empty')?.classList.add('hidden');

        try {
            const res = await window.apiFetch('/api/accounts');
            _allAccounts = res.data || [];
            _renderStats(_allAccounts);
            _applyFilter();
            _populateParentSelect(_allAccounts);
        } catch (err) {
            window.showToast('خطأ في تحميل الدليل المحاسبي: ' + err.message, 'error');
        } finally {
            _el('coa-loading')?.classList.add('hidden');
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Stats
    // ─────────────────────────────────────────────────────────────────────────
    function _renderStats(accounts) {
        const sum = (type) => accounts
            .filter(a => a.account_type === type)
            .reduce((s, a) => s + parseFloat(a.balance || 0), 0);

        _el('coa-stat-asset')    && (_el('coa-stat-asset').textContent    = fmt(sum('asset')));
        _el('coa-stat-liability')&& (_el('coa-stat-liability').textContent= fmt(sum('liability')));
        _el('coa-stat-equity')   && (_el('coa-stat-equity').textContent   = fmt(sum('equity')));
        _el('coa-stat-revenue')  && (_el('coa-stat-revenue').textContent  = fmt(sum('revenue')));
        _el('coa-stat-expense')  && (_el('coa-stat-expense').textContent  = fmt(sum('expense')));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Filter & Render Table
    // ─────────────────────────────────────────────────────────────────────────
    function _applyFilter() {
        const search = (_el('coa-search')?.value || '').toLowerCase().trim();
        const type   = _el('coa-type-filter')?.value || '';
        const active = _el('coa-active-filter')?.value;

        let filtered = _allAccounts;

        if (search) {
            filtered = filtered.filter(a =>
                a.name.toLowerCase().includes(search) ||
                a.code.toLowerCase().includes(search)
            );
        }
        if (type)   filtered = filtered.filter(a => a.account_type === type);
        if (active !== undefined && active !== '')
            filtered = filtered.filter(a => String(a.is_active) === active);

        _renderTable(filtered);
    }

    function _renderTable(accounts) {
        const tbody = _el('coa-tbody');
        if (!tbody) return;

        if (!accounts.length) {
            _el('coa-table-wrap')?.classList.add('hidden');
            _el('coa-empty')?.classList.remove('hidden');
            return;
        }

        _el('coa-table-wrap')?.classList.remove('hidden');
        _el('coa-empty')?.classList.add('hidden');

        tbody.innerHTML = accounts.map(a => {
            const t     = TYPE_LABEL[a.account_type] || { label: a.account_type, cls: 'bg-slate-100 text-slate-500' };
            const bal   = parseFloat(a.balance || 0);
            const balCls = bal > 0 ? 'text-emerald-600' : bal < 0 ? 'text-red-500' : 'text-slate-400';

            return `<tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer" onclick="window.coaOpenDetail('${a.id}')">
                <td class="py-3 px-4 font-mono font-bold text-slate-600">${esc(a.code)}</td>
                <td class="py-3 px-4 font-semibold text-slate-800">${esc(a.name)}</td>
                <td class="py-3 px-4 hidden sm:table-cell">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${t.cls}">${t.label}</span>
                </td>
                <td class="py-3 px-4 text-slate-400 text-xs hidden md:table-cell">${a.parent_code ? `${a.parent_code} — ${esc(a.parent_name)}` : '—'}</td>
                <td class="py-3 px-4 font-mono text-red-500 font-semibold">${fmt(a.total_debit)}</td>
                <td class="py-3 px-4 font-mono text-emerald-600 font-semibold">${fmt(a.total_credit)}</td>
                <td class="py-3 px-4 font-mono font-black ${balCls}">${fmt(bal)}</td>
                <td class="py-3 px-4 hidden sm:table-cell">
                    ${a.is_active
                        ? `<span class="inline-flex items-center gap-1 text-xs font-bold text-emerald-600"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>نشط</span>`
                        : `<span class="inline-flex items-center gap-1 text-xs font-bold text-slate-400"><span class="w-1.5 h-1.5 rounded-full bg-slate-300 inline-block"></span>موقوف</span>`
                    }
                </td>
                <td class="py-3 px-4 text-center" onclick="event.stopPropagation()">
                    <button onclick="window.coaOpenEdit('${a.id}')"
                            class="px-2.5 py-1.5 bg-slate-50 hover:bg-brand-50 hover:text-brand-600 text-slate-600 text-xs font-bold rounded-lg transition-colors">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Populate parent select
    // ─────────────────────────────────────────────────────────────────────────
    function _populateParentSelect(accounts, excludeId) {
        const sel = _el('coa-modal-parent');
        if (!sel) return;
        const opts = accounts
            .filter(a => !excludeId || a.id !== excludeId)
            .map(a => `<option value="${a.id}">${a.code} — ${esc(a.name)}</option>`)
            .join('');
        sel.innerHTML = '<option value="">— بدون حساب أب —</option>' + opts;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Modal helpers
    // ─────────────────────────────────────────────────────────────────────────
    function _openModal() {
        const m = _el('coa-modal');
        m.style.display = 'flex';
        requestAnimationFrame(() => m.classList.add('opacity-100'));
    }

    window.coaCloseModal = function () {
        const m = _el('coa-modal');
        m.classList.remove('opacity-100');
        setTimeout(() => { m.style.display = 'none'; }, 200);
    };

    window.coaOpenAdd = function () {
        _el('coa-modal-title').textContent = 'إضافة حساب جديد';
        _el('coa-modal-id').value   = '';
        _el('coa-modal-code').value = '';
        _el('coa-modal-name').value = '';
        _el('coa-modal-type').value = '';
        _el('coa-modal-parent').value = '';
        _el('coa-modal-code').disabled = false;
        _el('coa-modal-type').disabled = false;
        _el('coa-modal-active-row')?.classList.add('hidden');
        _populateParentSelect(_allAccounts);
        _openModal();
    };

    window.coaOpenEdit = function (id) {
        const a = _allAccounts.find(x => x.id === id);
        if (!a) return;

        _el('coa-modal-title').textContent = 'تعديل حساب';
        _el('coa-modal-id').value   = a.id;
        _el('coa-modal-code').value = a.code;
        _el('coa-modal-name').value = a.name;
        _el('coa-modal-type').value = a.account_type;
        _el('coa-modal-code').disabled = true;
        _el('coa-modal-type').disabled = true;
        _el('coa-modal-active-row')?.classList.remove('hidden');
        _el('coa-modal-active-row')?.classList.add('flex');
        _el('coa-modal-active').checked = !!a.is_active;
        _populateParentSelect(_allAccounts, a.id);
        _el('coa-modal-parent').value = a.parent_id || '';
        _openModal();
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Save (add or edit)
    // ─────────────────────────────────────────────────────────────────────────
    window.coaSave = async function () {
        const id       = _el('coa-modal-id').value.trim();
        const code     = _el('coa-modal-code').value.trim();
        const name     = _el('coa-modal-name').value.trim();
        const type     = _el('coa-modal-type').value;
        const parent   = _el('coa-modal-parent').value || null;
        const isActive = _el('coa-modal-active').checked;

        if (!name) { window.showToast('اسم الحساب مطلوب', 'error'); return; }
        if (!id && (!code || !type)) { window.showToast('الكود والنوع مطلوبان', 'error'); return; }

        const btn = _el('coa-modal-save-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1.5"></i> جاري الحفظ...';

        try {
            if (id) {
                await window.apiFetch(`/api/accounts/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ name, parent_id: parent, is_active: isActive }),
                });
                window.showToast('تم تحديث الحساب بنجاح', 'success');
            } else {
                await window.apiFetch('/api/accounts', {
                    method: 'POST',
                    body: JSON.stringify({ code, name, account_type: type, parent_id: parent }),
                });
                window.showToast('تمت إضافة الحساب بنجاح', 'success');
            }
            window.coaCloseModal();
            await _load();
        } catch (err) {
            window.showToast(err.message || 'حدث خطأ', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk ml-1.5"></i> حفظ';
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Account Detail / Ledger
    // ─────────────────────────────────────────────────────────────────────────
    window.coaOpenDetail = async function (id) {
        const m = _el('coa-detail-modal');
        m.style.display = 'flex';
        requestAnimationFrame(() => m.classList.add('opacity-100'));

        _el('coa-detail-title').textContent = 'جاري التحميل...';
        _el('coa-detail-sub').textContent   = '';
        _el('coa-detail-tbody').innerHTML   = '<tr><td colspan="6" class="py-10 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin"></i></td></tr>';
        _el('coa-detail-debit').textContent   = '—';
        _el('coa-detail-credit').textContent  = '—';
        _el('coa-detail-balance').textContent = '—';

        try {
            const res  = await window.apiFetch(`/api/accounts/${id}`);
            const acc  = res.data.account;
            const lines = res.data.lines || [];

            _el('coa-detail-title').textContent = `${acc.code} — ${acc.name}`;
            _el('coa-detail-sub').textContent   = TYPE_LABEL[acc.account_type]?.label || acc.account_type;
            _el('coa-detail-debit').textContent   = fmt(acc.total_debit);
            _el('coa-detail-credit').textContent  = fmt(acc.total_credit);
            _el('coa-detail-balance').textContent = fmt(acc.balance);

            const bal = parseFloat(acc.balance || 0);
            _el('coa-detail-balance').className = `text-lg font-black font-mono ${bal > 0 ? 'text-emerald-600' : bal < 0 ? 'text-red-500' : 'text-slate-500'}`;

            if (!lines.length) {
                _el('coa-detail-tbody').innerHTML = '<tr><td colspan="6" class="py-10 text-center text-slate-400 text-sm">لا توجد قيود على هذا الحساب</td></tr>';
                return;
            }

            _el('coa-detail-tbody').innerHTML = lines.map(l => `
                <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                    <td class="py-2.5 px-4 font-mono font-bold text-brand-600">#${l.voucher_number}</td>
                    <td class="py-2.5 px-4 text-slate-500">${new Date(l.voucher_date).toLocaleDateString('en-GB')}</td>
                    <td class="py-2.5 px-4">
                        <span class="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">${VOUCHER_TYPE_LABEL[l.voucher_type] || l.voucher_type}</span>
                    </td>
                    <td class="py-2.5 px-4 text-slate-500 text-xs max-w-xs truncate">${esc(l.description || '—')}</td>
                    <td class="py-2.5 px-4 font-mono font-semibold ${parseFloat(l.debit_amount||0) > 0 ? 'text-red-500' : 'text-slate-300'}">${parseFloat(l.debit_amount||0) > 0 ? fmt(l.debit_amount) : '—'}</td>
                    <td class="py-2.5 px-4 font-mono font-semibold ${parseFloat(l.credit_amount||0) > 0 ? 'text-emerald-600' : 'text-slate-300'}">${parseFloat(l.credit_amount||0) > 0 ? fmt(l.credit_amount) : '—'}</td>
                </tr>`
            ).join('');

        } catch (err) {
            _el('coa-detail-tbody').innerHTML = `<tr><td colspan="6" class="py-10 text-center text-red-400 text-sm">${err.message}</td></tr>`;
        }
    };

    window.coaCloseDetail = function () {
        const m = _el('coa-detail-modal');
        m.classList.remove('opacity-100');
        setTimeout(() => { m.style.display = 'none'; }, 200);
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────
    window.coaRefresh = function () { _load(); };
    window.coaFilter  = function () { _applyFilter(); };

    // ─────────────────────────────────────────────────────────────────────────
    // Init
    // ─────────────────────────────────────────────────────────────────────────
    _load();

})();
