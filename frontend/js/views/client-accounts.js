'use strict';

// =============================================================================
// G.PACK 2.0 - Client Accounts View Controller (حسابات العملاء)
// Tabs: مدين (owe us) / دائن (we owe) / الكل (split view + totals)
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
        if (window.hasPermission) return !!window.hasPermission('client_accounts', action);
        const perms = window.GpackPerms || {};
        return perms.all_access === true || !!perms.client_accounts?.[action];
    };

    // ── Load ──────────────────────────────────────────────────────────────────
    window.caLoad = async function () {
        _el('ca-loading')?.classList.remove('hidden');
        _el('ca-single')?.classList.add('hidden');
        _el('ca-split')?.classList.add('hidden');
        try {
            const incZero = _el('ca-include-zero')?.checked ? '?include_zero=1' : '';
            const res = await window.apiFetch('/api/client-accounts' + incZero);
            _rows   = res.data || [];
            _totals = res.totals || { debit: 0, credit: 0, net: 0 };
            window.caRender();
        } catch (err) {
            window.showToast('خطأ في تحميل الأرصدة: ' + err.message, 'error');
        } finally {
            _el('ca-loading')?.classList.add('hidden');
        }
    };

    // ── Tabs ──────────────────────────────────────────────────────────────────
    window.caSetTab = function (tab) { _tab = tab; window.caRender(); };

    function _syncTabButtons() {
        document.querySelectorAll('.ca-tab').forEach(b => {
            const active = b.dataset.tab === _tab;
            b.classList.toggle('bg-white',        active);
            b.classList.toggle('shadow-sm',       active);
            b.classList.toggle('text-slate-800',  active);
            b.classList.toggle('text-slate-500',  !active);
        });
    }

    function _filtered() {
        const q = (_el('ca-search')?.value || '').toLowerCase().trim();
        return _rows.filter(r => !q
            || (r.name  && r.name.toLowerCase().includes(q))
            || (r.phone && r.phone.toLowerCase().includes(q)));
    }

    // ── Render ────────────────────────────────────────────────────────────────
    window.caRender = function () {
        _syncTabButtons();

        // Totals (computed on the unfiltered set so the strip stays truthful)
        _el('ca-total-debit').textContent  = _fmt(_totals.debit);
        _el('ca-total-credit').textContent = _fmt(_totals.credit);
        const net = _el('ca-total-net');
        net.textContent = _fmt(Math.abs(_totals.net));
        net.className = 'text-xl font-black font-mono ' + (_totals.net >= 0 ? 'text-brand-700' : 'text-orange-600');

        const rows   = _filtered();
        const debit  = rows.filter(r => r.balance > 0);
        const credit = rows.filter(r => r.balance < 0);

        const single = _el('ca-single');
        const split  = _el('ca-split');

        if (_tab === 'all') {
            single.classList.add('hidden');
            split.classList.remove('hidden');
            _renderSplit(debit, credit);
        } else {
            split.classList.add('hidden');
            single.classList.remove('hidden');
            const list = _tab === 'debit' ? debit : credit;
            _renderSingle(list, _tab);
        }
    };

    function _clientCell(r) {
        const parent = r.parent_name
            ? ` <span class="text-[10px] text-slate-400">(${_esc(r.parent_name)})</span>` : '';
        return `<span class="font-semibold text-slate-800">${_esc(r.name)}</span>${parent}`;
    }

    function _stmtBtn(r) {
        return `<button onclick="window.caOpenProfile('${r.id}')" title="فتح ملف العميل / كشف الحساب"
                        class="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors">
                    <i class="fa-solid fa-file-invoice-dollar text-sm"></i>
                </button>`;
    }

    function _renderSingle(list, tab) {
        const tbody = _el('ca-tbody');
        const empty = _el('ca-single-empty');
        _el('ca-single-empty-text').textContent =
            tab === 'debit' ? 'لا يوجد عملاء مدينون (لنا عندهم أرصدة)'
                            : 'لا يوجد عملاء دائنون (لهم عندنا أرصدة)';
        empty.classList.toggle('hidden', list.length > 0);

        const journal = (r) => {
            const d = r.journal_debit, c = r.journal_credit;
            if (!d && !c) return '—';
            return `<span class="font-mono text-xs">${_fmt(d)} / ${_fmt(c)}</span>`;
        };

        tbody.innerHTML = list.map(r => `<tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
            <td class="py-3 px-4">${_clientCell(r)}</td>
            <td class="py-3 px-4 hidden sm:table-cell text-xs text-slate-500 font-mono">${_esc(r.phone) || '—'}</td>
            <td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-slate-600">${_fmt(r.invoiced)}</td>
            <td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-slate-600">${_fmt(r.received)}</td>
            <td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-slate-600">${_fmt(r.returned)}</td>
            <td class="py-3 px-4 hidden md:table-cell text-xs text-slate-500">${journal(r)}</td>
            <td class="py-3 px-4 font-mono font-black ${tab === 'debit' ? 'text-red-600' : 'text-emerald-700'}">${_fmt(Math.abs(r.balance))}</td>
            <td class="py-3 px-4 text-center">${_stmtBtn(r)}</td>
        </tr>`).join('');
    }

    function _renderSplit(debit, credit) {
        // DOM order: credit column first → renders RIGHT in RTL; debit → LEFT
        _el('ca-split-credit-count').textContent = credit.length;
        _el('ca-split-debit-count').textContent  = debit.length;

        _el('ca-debit-empty').classList.toggle('hidden',  debit.length  > 0);
        _el('ca-credit-empty').classList.toggle('hidden', credit.length > 0);

        const mini = (r, cls) => `<tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
            <td class="py-2.5 px-4 text-xs">${_clientCell(r)}</td>
            <td class="py-2.5 px-4 font-mono font-black text-sm ${cls}">${_fmt(Math.abs(r.balance))}</td>
            <td class="py-2.5 px-4 text-center">${_stmtBtn(r)}</td>
        </tr>`;

        _el('ca-debit-tbody').innerHTML  = debit.map(r  => mini(r, 'text-red-600')).join('');
        _el('ca-credit-tbody').innerHTML = credit.map(r => mini(r, 'text-emerald-700')).join('');
    }

    // ── Row action: open the client profile (which hosts the account statement) ──
    window.caOpenProfile = function (id) {
        window._cpClientId = id;
        if (window.navigateTo) window.navigateTo('client-profile');
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    if (_can('view')) {
        window.caSetTab('all');
        window.caLoad();
    }

})();
