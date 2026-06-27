'use strict';

// =============================================================================
// G.PACK 2.0 - Journal Entry View Controller
// =============================================================================

(function () {

    const fmt  = (v) => parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc  = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _el  = (id) => document.getElementById(id);
    const date = (d)  => d ? new Date(d).toLocaleDateString('en-GB') : '—';

    const STATUS = {
        posted:   { label: 'مرحّل',    cls: 'bg-emerald-100 text-emerald-700' },
        reversed: { label: 'معكوس',   cls: 'bg-red-100 text-red-600' },
        draft:    { label: 'مسودة',   cls: 'bg-slate-100 text-slate-500' },
    };

    const LIMIT = 20;
    let _page   = 0;
    let _total  = 0;
    let _treeParents   = [];
    let _treeChildren  = [];
    let _activeDetailId = null;

    // ─────────────────────────────────────────────────────────────────────────
    // Load accounts tree (parents + children including virtual clients/suppliers)
    // ─────────────────────────────────────────────────────────────────────────
    async function _loadAccounts() {
        try {
            const res = await window.apiFetch('/api/account-statement/accounts-tree');
            _treeParents  = res.parents || [];
            _treeChildren = res.children || [];
        } catch (_) {}
    }

    function _parentOptions() {
        return _treeParents.map(a =>
            `<option value="${a.id}">${a.code} — ${esc(a.name)}</option>`
        ).join('');
    }

    function _childrenOf(parentId) {
        return _treeChildren.filter(c => c.parent_id === parentId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Load journal entries list
    // ─────────────────────────────────────────────────────────────────────────
    async function _load() {
        _el('je-loading')?.classList.remove('hidden');
        _el('je-table-wrap')?.classList.add('hidden');
        _el('je-empty')?.classList.add('hidden');
        _el('je-pagination')?.classList.add('hidden');

        const search    = _el('je-search')?.value.trim() || '';
        const dateFrom  = _el('je-date-from')?.value || '';
        const dateTo    = _el('je-date-to')?.value   || '';

        const params = new URLSearchParams({
            limit:  LIMIT,
            offset: _page * LIMIT,
            ...(search   && { search }),
            ...(dateFrom && { date_from: dateFrom }),
            ...(dateTo   && { date_to: dateTo }),
        });

        try {
            const res = await window.apiFetch(`/api/journal-entries?${params}`);
            const rows = res.data || [];
            _total = res.total || 0;

            _el('je-loading')?.classList.add('hidden');

            if (!rows.length) {
                _el('je-empty')?.classList.remove('hidden');
                return;
            }

            _renderTable(rows);
            _renderPagination();
        } catch (err) {
            _el('je-loading')?.classList.add('hidden');
            window.showToast('خطأ في تحميل القيود: ' + err.message, 'error');
        }
    }

    function _renderTable(rows) {
        const tbody = _el('je-tbody');
        if (!tbody) return;

        _el('je-table-wrap')?.classList.remove('hidden');

        tbody.innerHTML = rows.map(r => {
            const st = STATUS[r.status] || { label: r.status, cls: 'bg-slate-100 text-slate-500' };
            return `<tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer" onclick="window.jeOpenDetail('${r.id}')">
                <td class="py-3 px-4 font-mono font-bold text-brand-600">#${r.voucher_number}</td>
                <td class="py-3 px-4 text-slate-500 hidden sm:table-cell">${date(r.voucher_date)}</td>
                <td class="py-3 px-4 text-slate-600 max-w-xs truncate">${esc(r.description || '—')}</td>
                <td class="py-3 px-4 font-mono font-bold text-slate-800">${fmt(r.total_amount)}</td>
                <td class="py-3 px-4 text-slate-400 text-xs hidden md:table-cell">${esc(r.created_by_name || '—')}</td>
                <td class="py-3 px-4">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${st.cls}">${st.label}</span>
                </td>
                <td class="py-3 px-4 text-center" onclick="event.stopPropagation()">
                    ${r.status === 'posted' ? `
                    <button onclick="window.jeOpenDetail('${r.id}')"
                            class="px-2.5 py-1.5 bg-slate-50 hover:bg-brand-50 hover:text-brand-600 text-slate-500 text-xs font-bold rounded-lg transition-colors">
                        <i class="fa-solid fa-eye"></i>
                    </button>` : '—'}
                </td>
            </tr>`;
        }).join('');
    }

    function _renderPagination() {
        const totalPages = Math.ceil(_total / LIMIT);
        if (totalPages <= 1) return;

        _el('je-pagination')?.classList.remove('hidden');
        const start = _page * LIMIT + 1;
        const end   = Math.min((_page + 1) * LIMIT, _total);
        if (_el('je-page-info')) _el('je-page-info').textContent = `${start}–${end} من ${_total}`;

        const prevBtn = _el('je-prev-btn');
        const nextBtn = _el('je-next-btn');
        if (prevBtn) prevBtn.disabled = _page === 0;
        if (nextBtn) nextBtn.disabled = _page >= totalPages - 1;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // New Entry Modal
    // ─────────────────────────────────────────────────────────────────────────
    let _lineCount = 0;

    window.jeOpenNew = function () {
        _lineCount = 0;
        _el('je-modal-date').value = new Date().toISOString().slice(0, 10);
        _el('je-modal-desc').value = '';
        _el('je-lines-tbody').innerHTML = '';
        _el('je-total-debit').textContent  = '0.00';
        _el('je-total-credit').textContent = '0.00';
        _updateBalanceIndicator(0, 0);

        window.jeAddLine();
        window.jeAddLine();

        const m = _el('je-modal');
        m.style.display = 'flex';
        requestAnimationFrame(() => m.classList.add('opacity-100'));
    };

    window.jeCloseModal = function () {
        const m = _el('je-modal');
        m.classList.remove('opacity-100');
        setTimeout(() => { m.style.display = 'none'; }, 200);
    };

    window.jeAddLine = function () {
        _lineCount++;
        const idx = _lineCount;
        const tr  = document.createElement('tr');
        tr.id     = `je-line-${idx}`;
        tr.className = 'border-b border-slate-100';
        tr.innerHTML = `
            <td class="py-2 px-3">
                <select id="je-line-parent-${idx}" onchange="window.jeParentChanged(${idx})"
                        class="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs focus:border-brand-500 outline-none bg-white">
                    <option value="">— الحساب الرئيسي —</option>
                    ${_parentOptions()}
                </select>
                <div id="je-line-child-wrap-${idx}" class="hidden mt-1">
                    <select id="je-line-child-${idx}" onchange="window.jeChildChanged(${idx})"
                            class="w-full px-2 py-2 border border-brand-200 bg-brand-50 rounded-lg text-xs focus:border-brand-500 outline-none">
                        <option value="">— الحساب الفرعي —</option>
                    </select>
                </div>
            </td>
            <td class="py-2 px-3 hidden sm:table-cell">
                <input id="je-line-desc-${idx}" type="text" placeholder="بيان السطر..."
                       class="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs focus:border-brand-500 outline-none" />
            </td>
            <td class="py-2 px-3">
                <input id="je-line-debit-${idx}" type="number" min="0" step="0.01" placeholder="0.00"
                       oninput="window.jeLineDebitInput(${idx})"
                       class="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:border-brand-500 outline-none text-right" />
            </td>
            <td class="py-2 px-3">
                <input id="je-line-credit-${idx}" type="number" min="0" step="0.01" placeholder="0.00"
                       oninput="window.jeLineCreditInput(${idx})"
                       class="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:border-brand-500 outline-none text-right" />
            </td>
            <td class="py-2 px-3 text-center">
                <button onclick="window.jeRemoveLine(${idx})"
                        class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors mx-auto">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </td>`;
        _el('je-lines-tbody').appendChild(tr);
    };

    // Called when parent account changes — populate child dropdown
    window.jeParentChanged = function (idx) {
        const parentSel = _el(`je-line-parent-${idx}`);
        const childWrap = _el(`je-line-child-wrap-${idx}`);
        const childSel  = _el(`je-line-child-${idx}`);
        if (!parentSel || !childWrap || !childSel) return;

        const parentId = parentSel.value;
        if (!parentId) {
            childWrap.classList.add('hidden');
            childSel.innerHTML = '<option value="">— الحساب الفرعي —</option>';
            delete childSel.dataset.accountId;
            delete childSel.dataset.subAccountType;
            delete childSel.dataset.subAccountId;
            window.jeRecalc();
            return;
        }

        const children = _childrenOf(parentId);
        if (children.length === 0) {
            childWrap.classList.add('hidden');
            childSel.innerHTML = '<option value="">— الحساب الفرعي —</option>';
            delete childSel.dataset.accountId;
            delete childSel.dataset.subAccountType;
            delete childSel.dataset.subAccountId;
        } else {
            childSel.innerHTML = '<option value="">— الحساب الفرعي —</option>' +
                children.map(c => {
                    const icon = c.sub_account_type === 'client' ? '👤' : c.sub_account_type === 'supplier' ? '🏢' : '';
                    return `<option value="${c.id}" data-sub-type="${c.sub_account_type || ''}" data-sub-id="${c.sub_account_id || ''}">${icon} ${c.code} — ${esc(c.name)}</option>`;
                }).join('');
            childWrap.classList.remove('hidden');
        }
        window.jeRecalc();
    };

    // Called when child account changes — store account/sub-account info
    window.jeChildChanged = function (idx) {
        const childSel = _el(`je-line-child-${idx}`);
        if (!childSel) return;
        const opt = childSel.options[childSel.selectedIndex];
        if (opt && opt.value) {
            childSel.dataset.accountId = opt.value;
            childSel.dataset.subAccountType = opt.dataset.subType || '';
            childSel.dataset.subAccountId = opt.dataset.subId || '';
        } else {
            delete childSel.dataset.accountId;
            delete childSel.dataset.subAccountType;
            delete childSel.dataset.subAccountId;
        }
        window.jeRecalc();
    };

    window.jeRemoveLine = function (idx) {
        const tr = _el(`je-line-${idx}`);
        if (tr) tr.remove();
        window.jeRecalc();
    };

    // When debit is typed, clear credit
    window.jeLineDebitInput = function (idx) {
        const d = parseFloat(_el(`je-line-debit-${idx}`)?.value || 0);
        if (d > 0) { const c = _el(`je-line-credit-${idx}`); if (c) c.value = ''; }
        window.jeRecalc();
    };

    // When credit is typed, clear debit
    window.jeLineCreditInput = function (idx) {
        const c = parseFloat(_el(`je-line-credit-${idx}`)?.value || 0);
        if (c > 0) { const d = _el(`je-line-debit-${idx}`); if (d) d.value = ''; }
        window.jeRecalc();
    };

    window.jeRecalc = function () {
        let totalD = 0, totalC = 0;
        for (let i = 1; i <= _lineCount; i++) {
            if (!_el(`je-line-${i}`)) continue;
            totalD += parseFloat(_el(`je-line-debit-${i}`)?.value  || 0);
            totalC += parseFloat(_el(`je-line-credit-${i}`)?.value || 0);
        }
        totalD = Math.round(totalD * 100) / 100;
        totalC = Math.round(totalC * 100) / 100;

        if (_el('je-total-debit'))  _el('je-total-debit').textContent  = fmt(totalD);
        if (_el('je-total-credit')) _el('je-total-credit').textContent = fmt(totalC);
        _updateBalanceIndicator(totalD, totalC);
    };

    function _updateBalanceIndicator(d, c) {
        const el = _el('je-balance-indicator');
        if (!el) return;
        if (d === 0 && c === 0) {
            el.className = 'mt-2 text-xs font-bold text-center py-1.5 rounded-lg bg-slate-100 text-slate-400';
            el.textContent = 'أدخل القيود لتتحقق من التوازن';
        } else if (d === c) {
            el.className = 'mt-2 text-xs font-bold text-center py-1.5 rounded-lg bg-emerald-50 text-emerald-600';
            el.innerHTML = `<i class="fa-solid fa-circle-check ml-1"></i> القيد متوازن — ${fmt(d)}`;
        } else {
            el.className = 'mt-2 text-xs font-bold text-center py-1.5 rounded-lg bg-red-50 text-red-500';
            el.innerHTML = `<i class="fa-solid fa-triangle-exclamation ml-1"></i> غير متوازن — الفرق: ${fmt(Math.abs(d - c))}`;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Save
    // ─────────────────────────────────────────────────────────────────────────
    window.jeSave = async function () {
        const voucher_date = _el('je-modal-date')?.value;
        const description  = _el('je-modal-desc')?.value.trim() || '';

        if (!voucher_date) { window.showToast('تاريخ القيد مطلوب', 'error'); return; }

        const lines = [];
        for (let i = 1; i <= _lineCount; i++) {
            if (!_el(`je-line-${i}`)) continue;
            const parentSel  = _el(`je-line-parent-${i}`);
            const childSel   = _el(`je-line-child-${i}`);
            const childWrap  = _el(`je-line-child-wrap-${i}`);
            const debit      = parseFloat(_el(`je-line-debit-${i}`)?.value  || 0);
            const credit     = parseFloat(_el(`je-line-credit-${i}`)?.value || 0);
            const desc       = _el(`je-line-desc-${i}`)?.value.trim() || '';

            let account_id       = null;
            let sub_account_type = null;
            let sub_account_id   = null;

            if (childSel && childWrap && !childWrap.classList.contains('hidden') && childSel.value) {
                // Child selected — use child account as the line account
                account_id       = childSel.value;
                sub_account_type = childSel.dataset.subAccountType || null;
                sub_account_id   = childSel.dataset.subAccountId || null;
            } else if (parentSel && parentSel.value) {
                // No child selected (or no children) — use parent account directly
                account_id = parentSel.value;
            }

            if (!account_id && debit === 0 && credit === 0) continue;
            if (!account_id) continue;
            lines.push({ account_id, debit, credit, description: desc, sub_account_type, sub_account_id });
        }

        if (lines.length < 2) { window.showToast('يجب إدخال سطرين على الأقل', 'error'); return; }

        const btn = _el('je-save-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1.5"></i> جاري الحفظ...';

        try {
            await window.apiFetch('/api/journal-entries', {
                method: 'POST',
                body: JSON.stringify({ voucher_date, description, lines }),
            });
            window.showToast('تم حفظ القيد بنجاح', 'success');
            window.jeCloseModal();
            _page = 0;
            await _load();
        } catch (err) {
            window.showToast(err.message || 'حدث خطأ', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk ml-1.5"></i> حفظ القيد';
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Detail Modal
    // ─────────────────────────────────────────────────────────────────────────
    window.jeOpenDetail = async function (id) {
        _activeDetailId = id;
        const m = _el('je-detail-modal');
        m.style.display = 'flex';
        requestAnimationFrame(() => m.classList.add('opacity-100'));

        _el('je-detail-title').textContent = 'جاري التحميل...';
        _el('je-detail-sub').textContent   = '';
        _el('je-detail-tbody').innerHTML   = '<tr><td colspan="4" class="py-10 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin"></i></td></tr>';

        try {
            const res     = await window.apiFetch(`/api/journal-entries/${id}`);
            const voucher = res.data.voucher;
            const lines   = res.data.lines || [];

            _el('je-detail-title').textContent = `قيد رقم #${voucher.voucher_number}`;
            _el('je-detail-sub').textContent   = `${date(voucher.voucher_date)}${voucher.description ? ' — ' + voucher.description : ''}`;

            const reverseBtn = _el('je-detail-reverse-btn');
            if (reverseBtn) reverseBtn.style.display = voucher.status === 'posted' ? '' : 'none';

            let totalD = 0, totalC = 0;
            _el('je-detail-tbody').innerHTML = lines.map(l => {
                totalD += parseFloat(l.debit  || 0);
                totalC += parseFloat(l.credit || 0);
                const subLabel = l.sub_account_name
                    ? `<span class="block text-xs text-brand-500 mt-0.5">${esc(l.sub_account_name)}</span>` : '';
                return `<tr class="border-b border-slate-100">
                    <td class="py-2.5 px-4">
                        <span class="font-mono text-xs text-slate-400 ml-1">${esc(l.account_code)}</span>
                        <span class="font-semibold text-slate-700">${esc(l.account_name)}</span>
                        ${subLabel}
                    </td>
                    <td class="py-2.5 px-4 text-slate-400 text-xs hidden sm:table-cell">${esc(l.description || '—')}</td>
                    <td class="py-2.5 px-4 font-mono font-semibold ${parseFloat(l.debit||0) > 0 ? 'text-red-500' : 'text-slate-300'}">${parseFloat(l.debit||0) > 0 ? fmt(l.debit) : '—'}</td>
                    <td class="py-2.5 px-4 font-mono font-semibold ${parseFloat(l.credit||0) > 0 ? 'text-emerald-600' : 'text-slate-300'}">${parseFloat(l.credit||0) > 0 ? fmt(l.credit) : '—'}</td>
                </tr>`;
            }).join('');

            if (_el('je-detail-total-debit'))  _el('je-detail-total-debit').textContent  = fmt(totalD);
            if (_el('je-detail-total-credit')) _el('je-detail-total-credit').textContent = fmt(totalC);

        } catch (err) {
            _el('je-detail-tbody').innerHTML = `<tr><td colspan="4" class="py-10 text-center text-red-400 text-sm">${err.message}</td></tr>`;
        }
    };

    window.jeCloseDetail = function () {
        const m = _el('je-detail-modal');
        m.classList.remove('opacity-100');
        setTimeout(() => { m.style.display = 'none'; _activeDetailId = null; }, 200);
    };

    window.jeReverse = async function () {
        if (!_activeDetailId) return;
        if (!confirm('هل تريد عكس هذا القيد؟ لا يمكن التراجع.')) return;
        try {
            await window.apiFetch(`/api/journal-entries/${_activeDetailId}`, { method: 'DELETE' });
            window.showToast('تم عكس القيد', 'success');
            window.jeCloseDetail();
            await _load();
        } catch (err) {
            window.showToast(err.message || 'حدث خطأ', 'error');
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Pagination & Search
    // ─────────────────────────────────────────────────────────────────────────
    window.jeSearch   = function () { _page = 0; _load(); };
    window.jePrevPage = function () { if (_page > 0) { _page--; _load(); } };
    window.jeNextPage = function () { if ((_page + 1) * LIMIT < _total) { _page++; _load(); } };
    window.jeRefresh  = function () { _load(); };

    // ─────────────────────────────────────────────────────────────────────────
    // Init
    // ─────────────────────────────────────────────────────────────────────────
    (async function _init() {
        await _loadAccounts();
        await _load();
    })();

})();
