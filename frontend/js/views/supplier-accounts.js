'use strict';

// =============================================================================
// G.PACK 2.0 - Supplier Accounts View Controller (حسابات الموردين)
// Tabs: مدين (لنا عند المورد) / دائن (مستحق للمورد) / الكل (split + totals)
// =============================================================================

(function () {

    const _el  = (id) => document.getElementById(id);
    const _esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const _fmt = (v) => (v === null || v === undefined || v === '')
        ? '—' : parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let _rows   = [];
    let _totals = { debit: 0, credit: 0, net: 0 };
    let _tab    = 'all'; // 'debit' | 'credit' | 'all'

    const _can = (action) => {
        if (window.hasPermission) return !!window.hasPermission('supplier_accounts', action);
        const perms = window.GpackPerms || {};
        return perms.all_access === true || !!perms.supplier_accounts?.[action];
    };

    // ── Load ──────────────────────────────────────────────────────────────────
    window.saLoad = async function () {
        _el('sa-loading')?.classList.remove('hidden');
        _el('sa-single')?.classList.add('hidden');
        _el('sa-split')?.classList.add('hidden');
        try {
            const incZero = _el('sa-include-zero')?.checked ? '?include_zero=1' : '';
            const res = await window.apiFetch('/api/supplier-accounts' + incZero);
            _rows   = res.data || [];
            _totals = res.totals || { debit: 0, credit: 0, net: 0 };
            window.saRender();
        } catch (err) {
            window.showToast('خطأ في تحميل أرصدة الموردين: ' + err.message, 'error');
        } finally {
            _el('sa-loading')?.classList.add('hidden');
        }
    };

    // ── Tabs ──────────────────────────────────────────────────────────────────
    window.saSetTab = function (tab) { _tab = tab; window.saRender(); };

    function _syncTabButtons() {
        document.querySelectorAll('.sa-tab').forEach(b => {
            const active = b.dataset.tab === _tab;
            b.classList.toggle('bg-white',        active);
            b.classList.toggle('shadow-sm',       active);
            b.classList.toggle('text-slate-800',  active);
            b.classList.toggle('text-slate-500',  !active);
        });
    }

    function _filtered() {
        const q = (_el('sa-search')?.value || '').toLowerCase().trim();
        return _rows.filter(r => !q
            || (r.name           && r.name.toLowerCase().includes(q))
            || (r.phone          && r.phone.toLowerCase().includes(q))
            || (r.contact_person && r.contact_person.toLowerCase().includes(q)));
    }

    // ── Render ────────────────────────────────────────────────────────────────
    window.saRender = function () {
        _syncTabButtons();

        _el('sa-total-debit').textContent  = _fmt(_totals.debit);
        _el('sa-total-credit').textContent = _fmt(_totals.credit);
        const net = _el('sa-total-net');
        net.textContent = _fmt(Math.abs(_totals.net));
        net.className = 'text-xl font-black font-mono ' + (_totals.net >= 0 ? 'text-brand-700' : 'text-orange-600');

        const rows   = _filtered();
        const debit  = rows.filter(r => r.balance > 0);
        const credit = rows.filter(r => r.balance < 0);

        const single = _el('sa-single');
        const split  = _el('sa-split');

        if (_tab === 'all') {
            single.classList.add('hidden');
            split.classList.remove('hidden');
            _renderSplit(debit, credit);
        } else {
            split.classList.add('hidden');
            single.classList.remove('hidden');
            _renderSingle(_tab === 'debit' ? debit : credit, _tab);
        }
    };

    function _supplierCell(r) {
        const contact = r.contact_person
            ? ` <span class="text-xs text-slate-400">(${_esc(r.contact_person)})</span>` : '';
        return `<span class="font-bold text-slate-800 text-base">${_esc(r.name)}</span>${contact}`;
    }

    function _stmtBtn(r) {
        return `<button onclick="window.saOpenProfile('${r.id}')" title="فتح ملف المورد / كشف الحساب"
                        class="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors">
                    <i class="fa-solid fa-file-invoice-dollar"></i>
                </button>`;
    }

    function _renderSingle(list, tab) {
        const tbody = _el('sa-tbody');
        const empty = _el('sa-single-empty');
        _el('sa-single-empty-text').textContent =
            tab === 'debit' ? 'لا يوجد موردون مدينون (لنا عندهم أرصدة)'
                            : 'لا يوجد موردون دائنون (مستحقات لهم)';
        empty.classList.toggle('hidden', list.length > 0);

        const journal = (r) => {
            const d = r.journal_debit, c = r.journal_credit;
            if (!d && !c) return '—';
            return `<span class="font-mono text-sm">${_fmt(d)} / ${_fmt(c)}</span>`;
        };

        tbody.innerHTML = list.map(r => `<tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
            <td class="py-3.5 px-4">${_supplierCell(r)}</td>
            <td class="py-3.5 px-4 hidden sm:table-cell text-sm text-slate-500 font-mono">${_esc(r.phone) || '—'}</td>
            <td class="py-3.5 px-4 hidden md:table-cell font-mono text-sm text-slate-600">${_fmt(r.invoiced)}</td>
            <td class="py-3.5 px-4 hidden md:table-cell font-mono text-sm text-slate-600">${_fmt(r.paid)}</td>
            <td class="py-3.5 px-4 hidden md:table-cell text-sm text-slate-500">${journal(r)}</td>
            <td class="py-3.5 px-4 font-mono font-black text-lg ${tab === 'debit' ? 'text-red-600' : 'text-emerald-700'}">${_fmt(Math.abs(r.balance))}</td>
            <td class="py-3.5 px-4 text-center">${_stmtBtn(r)}</td>
        </tr>`).join('');
    }

    function _renderSplit(debit, credit) {
        // DOM order: credit column first → renders RIGHT in RTL; debit → LEFT
        _el('sa-split-credit-count').textContent = credit.length;
        _el('sa-split-debit-count').textContent  = debit.length;

        _el('sa-debit-empty').classList.toggle('hidden',  debit.length  > 0);
        _el('sa-credit-empty').classList.toggle('hidden', credit.length > 0);

        const mini = (r, cls) => `<tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
            <td class="py-3 px-4 text-sm">${_supplierCell(r)}</td>
            <td class="py-3 px-4 font-mono font-black text-base ${cls}">${_fmt(Math.abs(r.balance))}</td>
            <td class="py-3 px-4 text-center">${_stmtBtn(r)}</td>
        </tr>`;

        _el('sa-debit-tbody').innerHTML  = debit.map(r  => mini(r, 'text-red-600')).join('');
        _el('sa-credit-tbody').innerHTML = credit.map(r => mini(r, 'text-emerald-700')).join('');
    }

    // ── Row action: open the supplier profile (which hosts the account statement) ──
    window.saOpenProfile = function (id) {
        window._spSupplierId = id;
        if (window.navigateTo) window.navigateTo('supplier-profile');
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    if (_can('view')) {
        window.saSetTab('all');
        window.saLoad();
    }

})();
