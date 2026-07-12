'use strict';

// =============================================================================
// G.PACK 2.0 — Account Statement Controller
// كشف حساب من الدليل المحاسبي
// =============================================================================

(function() {
    const _el = (id) => document.getElementById(id);
    const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

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

    // ── Init ───────────────────────────────────────────────────────────────────
    async function _init() {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        _el('as-to-date').value = today.toISOString().split('T')[0];
        _el('as-from-date').value = firstDay.toISOString().split('T')[0];

        try {
            const data = await window.apiFetch('/api/account-statement/accounts-tree');
            _accountsTree = data;
            _renderParentList(data.parents);
        } catch (err) {
            console.error('Failed to load accounts tree:', err);
        }
    }

    // ── Parent Dropdown ────────────────────────────────────────────────────────
    window.asToggleParentDropdown = function() {
        const dd = _el('as-parent-dropdown');
        dd.classList.toggle('hidden');
        if (!dd.classList.contains('hidden')) {
            _el('as-parent-search').value = '';
            _renderParentList(_accountsTree.parents);
            _el('as-parent-search').focus();
            _el('as-child-dropdown').classList.add('hidden');
        }
    };

    window.asFilterParent = function(query) {
        const q = (query || '').toLowerCase();
        const filtered = _accountsTree.parents.filter(a =>
            a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)
        );
        _renderParentList(filtered);
    };

    function _renderParentList(accounts) {
        const container = _el('as-parent-list');
        if (accounts.length === 0) {
            container.innerHTML = '<div class="px-4 py-3 text-sm text-slate-400 text-center">لا توجد نتائج</div>';
            return;
        }
        container.innerHTML = accounts.map(a => `
            <div onclick="window.asSelectParent('${esc(a.id)}', '${esc(a.code)}', '${esc(a.name)}', '${esc(a.account_type)}')"
                 class="px-4 py-2.5 hover:bg-brand-50 cursor-pointer border-b border-slate-50 last:border-0 flex items-center gap-3">
                <span class="font-mono text-xs text-slate-400 w-12">${esc(a.code)}</span>
                <span class="text-sm text-slate-700 flex-1">${esc(a.name)}</span>
                <span class="text-xs text-slate-400">${_typeLabels[a.account_type] || a.account_type}</span>
            </div>
        `).join('');
    }

    window.asSelectParent = function(id, code, name, type) {
        _selectedParent = { id, code, name, type };
        _selectedChild = null;

        _el('as-parent-label').textContent = `${code} — ${name}`;
        _el('as-parent-label').classList.remove('text-slate-400');
        _el('as-parent-label').classList.add('text-slate-700');
        _el('as-parent-dropdown').classList.add('hidden');

        // Enable child dropdown
        _el('as-child-btn').disabled = false;
        _el('as-child-label').textContent = 'كل الحسابات الفرعية';
        _el('as-child-label').classList.remove('text-slate-400');
        _el('as-child-label').classList.add('text-slate-700');

        // Filter children for this parent
        const children = _accountsTree.children.filter(c => c.parent_id === id);
        _renderChildList(children);
    };

    // ── Child Dropdown ─────────────────────────────────────────────────────────
    window.asToggleChildDropdown = function() {
        if (!_selectedParent) return;
        const dd = _el('as-child-dropdown');
        dd.classList.toggle('hidden');
        if (!dd.classList.contains('hidden')) {
            _el('as-child-search').value = '';
            const children = _accountsTree.children.filter(c => c.parent_id === _selectedParent.id);
            _renderChildList(children);
            _el('as-child-search').focus();
        }
    };

    window.asFilterChild = function(query) {
        if (!_selectedParent) return;
        const q = (query || '').toLowerCase();
        const children = _accountsTree.children
            .filter(c => c.parent_id === _selectedParent.id)
            .filter(a => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q));
        _renderChildList(children);
    };

    function _renderChildList(accounts) {
        const container = _el('as-child-list');
        // Add "all" option to query the parent account directly
        let html = `
            <div onclick="window.asSelectChild('all')"
                 class="px-4 py-2.5 hover:bg-brand-50 cursor-pointer border-b border-slate-50 flex items-center gap-3">
                <i class="fa-solid fa-layer-group text-slate-400 text-xs w-12 text-center"></i>
                <span class="text-sm font-semibold text-slate-700 flex-1">كل الحسابات الفرعية (الحساب الرئيسي)</span>
            </div>
        `;
        if (accounts.length === 0) {
            html += '<div class="px-4 py-3 text-sm text-slate-400 text-center">لا توجد حسابات فرعية</div>';
        } else {
            html += accounts.map(a => {
                const isVirtual = a.sub_account_type === 'client' || a.sub_account_type === 'supplier';
                const icon = a.sub_account_type === 'client' ? 'fa-user' : a.sub_account_type === 'supplier' ? 'fa-truck' : '';
                const subInfo = isVirtual ? ` data-sub-id="${esc(a.sub_account_id)}" data-sub-type="${esc(a.sub_account_type)}"` : '';
                const subDetail = a.phone || a.city ? `<span class="text-xs text-slate-400 block mt-0.5">${esc(a.phone || '')} ${a.city ? '• ' + esc(a.city) : ''}</span>` : '';
                return `
                <div onclick="window.asSelectChild('${esc(a.id)}', '${esc(a.code)}', '${esc(a.name)}', ${isVirtual ? `'${esc(a.sub_account_id)}'` : 'null'}, ${isVirtual ? `'${esc(a.sub_account_type)}'` : 'null'})"
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

    window.asSelectChild = function(id, code, name, subAccountId, subAccountType) {
        if (id === 'all') {
            _selectedChild = { id: _selectedParent.id, code: _selectedParent.code, name: _selectedParent.name, isParent: true, subAccountId: null, subAccountType: null };
            _el('as-child-label').textContent = 'كل الحسابات الفرعية';
        } else {
            _selectedChild = { id, code, name, isParent: false, subAccountId: subAccountId || null, subAccountType: subAccountType || null };
            _el('as-child-label').textContent = `${code} — ${name}`;
        }
        _el('as-child-label').classList.remove('text-slate-400');
        _el('as-child-label').classList.add('text-slate-700');
        _el('as-child-dropdown').classList.add('hidden');
    };

    // ── Load Statement ──────────────────────────────────────────────────────────
    window.asLoadStatement = async function() {
        if (!_selectedChild) {
            alert('الرجاء اختيار الحساب الفرعي أولاً');
            return;
        }

        const fromDate = _el('as-from-date').value;
        const toDate = _el('as-to-date').value;

        try {
            const params = [];
            if (fromDate) params.push(`from=${fromDate}`);
            if (toDate) params.push(`to=${toDate}`);
            if (_selectedChild.subAccountId) {
                params.push(`subAccountId=${_selectedChild.subAccountId}`);
                params.push(`subAccountType=${_selectedChild.subAccountType}`);
            }
            const url = `/api/account-statement/account/${_selectedChild.id}` + (params.length > 0 ? '?' + params.join('&') : '');

            const res = await window.apiFetch(url);
            _renderAccountInfo(res.account);
            _renderStatement(res);
        } catch (err) {
            alert('خطأ في تحميل كشف الحساب: ' + err.message);
        }
    };

    function _renderAccountInfo(account) {
        _el('as-party-type').textContent = _typeLabels[account.account_type] || account.account_type;
        _el('as-party-name').textContent = account.name;
        _el('as-party-details').textContent = `كود: ${account.code}`;
        _el('as-initial').classList.add('hidden');
        _el('as-party-info').classList.remove('hidden');
        _el('as-statement-section').classList.add('hidden');
        _el('as-summary-section').classList.add('hidden');
    }

    function _renderStatement(data) {
        const summary = data.summary || {};
        const transactions = data.transactions || [];

        _el('as-total-debit').textContent = fmt(summary.total_debit);
        _el('as-total-credit').textContent = fmt(summary.total_credit);
        _el('as-final-balance').textContent = fmt(summary.balance);
        _el('as-party-balance').textContent = fmt(summary.balance);

        const balanceEl = _el('as-party-balance');
        if (summary.balance > 0) {
            balanceEl.className = 'text-3xl font-black text-red-600';
        } else if (summary.balance < 0) {
            balanceEl.className = 'text-3xl font-black text-emerald-600';
        } else {
            balanceEl.className = 'text-3xl font-black text-slate-600';
        }

        _el('as-summary-section').classList.remove('hidden');

        if (transactions.length === 0) {
            _el('as-tbody').innerHTML = '';
            _el('as-empty').classList.remove('hidden');
        } else {
            _el('as-empty').classList.add('hidden');
            _el('as-tbody').innerHTML = transactions.map((t, idx) => {
                const isEven = idx % 2 === 0;
                const rowClass = isEven ? 'bg-white' : 'bg-slate-50/50';
                const debit = parseFloat(t.debit || 0);
                const credit = parseFloat(t.credit || 0);
                const balance = parseFloat(t.running_balance || 0);

                return `<tr class="${rowClass} border-b border-slate-100 hover:bg-blue-50/30 transition-colors">
                    <td class="py-3 px-4 text-slate-600 text-xs">${new Date(t.trans_date).toLocaleDateString('ar-SA-u-nu-latn')}</td>
                    <td class="py-3 px-4">
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${_getDocTypeClass(t.document_type)}">
                            ${_getDocTypeIcon(t.document_type)}
                            ${esc(t.document_type)}
                        </span>
                    </td>
                    <td class="py-3 px-4 font-mono text-slate-700 font-bold">#${esc(t.document_number)}</td>
                    <td class="py-3 px-4 font-mono font-bold ${debit > 0 ? 'text-red-600' : 'text-slate-300'}">${debit > 0 ? fmt(debit) : '-'}</td>
                    <td class="py-3 px-4 font-mono font-bold ${credit > 0 ? 'text-emerald-600' : 'text-slate-300'}">${credit > 0 ? fmt(credit) : '-'}</td>
                    <td class="py-3 px-4 font-mono font-bold ${_getBalanceColor(balance)}">${fmt(balance)}</td>
                    <td class="py-3 px-4 text-slate-500 text-xs">${esc(t.notes || '')}</td>
                </tr>`;
            }).join('');
        }

        _el('as-statement-section').classList.remove('hidden');
    }

    function _getDocTypeClass(type) {
        if (type.includes('قبض')) return 'bg-emerald-100 text-emerald-700';
        if (type.includes('صرف')) return 'bg-red-100 text-red-700';
        if (type.includes('مبيعات')) return 'bg-blue-100 text-blue-700';
        if (type.includes('مشتريات')) return 'bg-amber-100 text-amber-700';
        if (type.includes('يومية')) return 'bg-purple-100 text-purple-700';
        return 'bg-slate-100 text-slate-700';
    }

    function _getDocTypeIcon(type) {
        if (type.includes('قبض')) return '<i class="fa-solid fa-hand-holding-dollar"></i>';
        if (type.includes('صرف')) return '<i class="fa-solid fa-money-bill-transfer"></i>';
        if (type.includes('مبيعات')) return '<i class="fa-solid fa-file-invoice"></i>';
        if (type.includes('مشتريات')) return '<i class="fa-solid fa-cart-shopping"></i>';
        if (type.includes('يومية')) return '<i class="fa-solid fa-book-journal-whills"></i>';
        return '<i class="fa-solid fa-file"></i>';
    }

    function _getBalanceColor(balance) {
        if (balance > 0) return 'text-red-600';
        if (balance < 0) return 'text-emerald-600';
        return 'text-slate-600';
    }

    // ── Click outside to close dropdowns ───────────────────────────────────────
    document.addEventListener('click', (e) => {
        const parentWrap = _el('as-parent-btn')?.closest('.flex-1');
        if (parentWrap && !parentWrap.contains(e.target)) {
            _el('as-parent-dropdown').classList.add('hidden');
        }
        const childWrap = _el('as-child-btn')?.closest('.flex-1');
        if (childWrap && !childWrap.contains(e.target)) {
            _el('as-child-dropdown').classList.add('hidden');
        }
    });

    // ── Start ───────────────────────────────────────────────────────────────────
    _init();
})();
