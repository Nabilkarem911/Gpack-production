'use strict';

// =============================================================================
// G.PACK 2.0 - Chart of Accounts View Controller (Tree)
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
    const _expandedIds = new Set();

    // ─────────────────────────────────────────────────────────────────────────
    // Load all accounts
    // ─────────────────────────────────────────────────────────────────────────
    async function _load() {
        _el('coa-loading')?.classList.remove('hidden');
        _el('coa-tree-wrap')?.classList.add('hidden');
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
    // Filter & Build Tree
    // ─────────────────────────────────────────────────────────────────────────
    function _applyFilter() {
        const search = (_el('coa-search')?.value || '').toLowerCase().trim();
        const type   = _el('coa-type-filter')?.value || '';
        const active = _el('coa-active-filter')?.value;

        let filtered = _allAccounts;

        if (type)   filtered = filtered.filter(a => a.account_type === type);
        if (active !== undefined && active !== '')
            filtered = filtered.filter(a => String(a.is_active) === active);

        if (search) {
            const matches = filtered.filter(a =>
                a.name.toLowerCase().includes(search) ||
                a.code.toLowerCase().includes(search)
            );

            // Keep the matching accounts and all their ancestors.
            const allMap = Object.fromEntries(_allAccounts.map(a => [a.id, a]));
            const visibleIds = new Set();
            const searchExpandedIds = new Set();

            for (const a of matches) {
                let cur = a;
                while (cur && !visibleIds.has(cur.id)) {
                    visibleIds.add(cur.id);
                    if (cur.parent_id && allMap[cur.parent_id]) {
                        searchExpandedIds.add(cur.parent_id);
                        cur = allMap[cur.parent_id];
                    } else {
                        cur = null;
                    }
                }
            }

            filtered = _allAccounts.filter(a => visibleIds.has(a.id));
            const roots = _buildTree(filtered);
            _renderTree(roots, new Set([..._expandedIds, ...searchExpandedIds]));
            return;
        }

        const roots = _buildTree(filtered);
        _renderTree(roots, _expandedIds);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Find parent using explicit parent_id only
    // ─────────────────────────────────────────────────────────────────────────
    function _findParent(a, map) {
        if (!a || !a.parent_id) return null;
        return map[a.parent_id] || null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Build account hierarchy from a flat list
    // ─────────────────────────────────────────────────────────────────────────
    function _buildTree(accounts) {
        const map = Object.fromEntries(accounts.map(a => [a.id, { ...a, children: [] }]));
        const roots = [];

        for (const a of accounts) {
            const node = map[a.id];
            const p = _findParent(a, map);
            if (p) p.children.push(node);
            else roots.push(node);
        }

        const sortChildren = (nodes) => {
            nodes.sort((a, b) => String(a.code).localeCompare(String(b.code)));
            for (const n of nodes) sortChildren(n.children);
        };
        sortChildren(roots);

        return roots;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Render expandable tree
    // ─────────────────────────────────────────────────────────────────────────
    function _renderTree(roots, expandedIds = _expandedIds) {
        const wrap = _el('coa-tree-wrap');
        const tree = _el('coa-tree');
        const empty = _el('coa-empty');

        if (!wrap || !tree) return;

        if (!roots.length) {
            wrap.classList.add('hidden');
            empty?.classList.remove('hidden');
            return;
        }

        wrap.classList.remove('hidden');
        empty?.classList.add('hidden');
        tree.innerHTML = '';

        const _row = (node, level) => {
            const hasChildren = node.children && node.children.length;
            const expanded = hasChildren ? expandedIds.has(node.id) : false;

            const el = document.createElement('div');
            el.className = 'coa-tree-row flex items-center gap-2 py-3 pr-4 pl-4 border-b border-slate-100 hover:bg-slate-50/60 transition-colors';
            el.style.paddingRight = (12 + level * 40) + 'px';
            el.style.cursor = 'pointer';

            const chevron = hasChildren
                ? (expanded ? '<i class="fa-solid fa-chevron-down text-slate-600"></i>' : '<i class="fa-solid fa-chevron-left text-slate-600"></i>')
                : '<i class="fa-solid fa-chevron-down text-transparent"></i>';

            const t = TYPE_LABEL[node.account_type] || { label: node.account_type, cls: 'bg-slate-100 text-slate-500' };
            const bal = parseFloat(node.balance || 0);
            const balCls = bal > 0 ? 'text-emerald-600' : bal < 0 ? 'text-red-500' : 'text-slate-400';

            el.innerHTML = `
                <div class="coa-tree-toggle w-6 h-6 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-500 text-xs" ${hasChildren ? '' : 'style=\'pointer-events:none\''}>
                    ${chevron}
                </div>
                <div class="w-20 font-mono font-bold text-slate-600 text-xs text-right">${esc(node.code)}</div>
                <div class="flex-1 font-semibold text-slate-800 text-sm">${esc(node.name)}</div>
                <div class="hidden sm:block">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${t.cls}">${t.label}</span>
                </div>
                <div class="w-28 font-mono font-black ${balCls} text-sm text-left">${fmt(bal)}</div>
                <div class="w-8 text-center">
                    <button class="coa-edit-btn px-2.5 py-1.5 bg-slate-50 hover:bg-brand-50 hover:text-brand-600 text-slate-600 text-xs font-bold rounded-lg transition-colors">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                </div>
            `;

            // Open ledger on row click, but not on toggle or edit button
            el.addEventListener('click', (e) => {
                if (e.target.closest('.coa-tree-toggle') || e.target.closest('.coa-edit-btn')) return;
                window.coaOpenDetail(node.id);
            });

            // Toggle expand/collapse
            const toggle = el.querySelector('.coa-tree-toggle');
            if (hasChildren && toggle) {
                toggle.addEventListener('click', () => _toggleExpand(node.id));
            }

            // Edit button
            const editBtn = el.querySelector('.coa-edit-btn');
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.coaOpenEdit(node.id);
                });
            }

            tree.appendChild(el);

            if (hasChildren && expanded) {
                for (const child of node.children) _row(child, level + 1);
            }
        };

        for (const r of roots) _row(r, 0);
    }

    function _toggleExpand(id) {
        if (_expandedIds.has(id)) _expandedIds.delete(id);
        else _expandedIds.add(id);
        _applyFilter();
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
        if (window.makeSelectSearchable && !sel.dataset.searchable) {
            window.makeSelectSearchable(sel, '🔍 ابحث عن حساب...');
        }
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
