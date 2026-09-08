'use strict';

// =============================================================================
// G.PACK 2.0 - Opening Balances View Controller (الأرصدة الافتتاحية)
// =============================================================================

(function () {

    const _el   = (id) => document.getElementById(id);
    const _esc  = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const _fmt  = (v) => v === null || v === undefined || v === ''
        ? '—' : parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const _date = (v) => v ? new Date(v).toLocaleDateString('en-GB') : '—';

    let _rows      = [];
    let _meta      = null;          // { accounts, clients, suppliers, existing }
    let _editingId = null;
    let _kind      = 'client';      // 'client' | 'supplier' | 'account'
    let _side      = 'debit';

    const _can = (action) => {
        if (window.hasPermission) return !!window.hasPermission('opening_balance', action);
        const perms = window.GpackPerms || {};
        return perms.all_access === true || !!perms.opening_balance?.[action];
    };

    // ── Data loading ──────────────────────────────────────────────────────────
    async function _load() {
        _el('ob-loading')?.classList.remove('hidden');
        _el('ob-table-wrap')?.classList.add('hidden');
        _el('ob-empty')?.classList.add('hidden');
        try {
            const res = await window.apiFetch('/api/opening-balances');
            _rows = res.data || [];
            _renderTable(_rows);
        } catch (err) {
            window.showToast('خطأ في تحميل الأرصدة: ' + err.message, 'error');
        } finally {
            _el('ob-loading')?.classList.add('hidden');
        }
    }

    async function _loadMeta() {
        try {
            const res = await window.apiFetch('/api/opening-balances/meta');
            _meta = res.data;
        } catch (err) {
            _meta = { accounts: [], clients: [], suppliers: [], existing: [] };
        }
    }

    window.obRefresh = _load;
    window.obSearch  = function () {
        const q      = (_el('ob-search')?.value || '').toLowerCase().trim();
        const status = _el('ob-status-filter')?.value || '';
        const filtered = _rows.filter(r => {
            if (status && r.status !== status) return false;
            if (!q) return true;
            return [r.account_name, r.account_code, r.sub_account_name, r.reference, r.description,
                    r.voucher_number && String(r.voucher_number)]
                .some(x => x && String(x).toLowerCase().includes(q));
        });
        _renderTable(filtered);
    };

    // ── Table ─────────────────────────────────────────────────────────────────
    const KIND_LABEL = { client: 'عميل', supplier: 'مورد', account: 'حساب' };

    function _renderTable(rows) {
        const tbody = _el('ob-tbody');
        const wrap  = _el('ob-table-wrap');
        const empty = _el('ob-empty');
        if (!tbody) return;

        if (!rows.length) {
            wrap.classList.add('hidden');
            empty.classList.remove('hidden');
            return;
        }
        wrap.classList.remove('hidden');
        empty.classList.add('hidden');

        const canEdit   = _can('edit');
        const canDelete = _can('delete');

        tbody.innerHTML = rows.map(r => {
            const posted = r.status === 'posted';
            const name   = r.sub_account_name
                ? `${_esc(r.sub_account_name)} <span class="text-[10px] text-slate-400">(${_esc(r.account_code)} ${_esc(r.account_name)})</span>`
                : `<span class="font-mono text-xs text-slate-400 ml-1">${_esc(r.account_code)}</span> ${_esc(r.account_name)}`;
            const kind   = KIND_LABEL[r.sub_account_type] || 'حساب';
            const sideBadge = r.side === 'debit'
                ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600">مدين</span>'
                : '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">دائن</span>';
            const statusBadge = posted
                ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">مرحّل</span>'
                : '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-500">ملغى</span>';

            return `<tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors ${posted ? '' : 'opacity-60'}">
                <td class="py-3 px-4 font-semibold text-slate-800 text-sm">${name}</td>
                <td class="py-3 px-4 hidden sm:table-cell text-xs text-slate-500">${kind}</td>
                <td class="py-3 px-4">${sideBadge}</td>
                <td class="py-3 px-4 font-mono font-bold text-slate-700">${_fmt(r.amount)}</td>
                <td class="py-3 px-4 hidden md:table-cell text-xs text-slate-500">${_date(r.balance_date)}</td>
                <td class="py-3 px-4 hidden lg:table-cell text-xs text-slate-500">${_esc(r.reference) || '—'}</td>
                <td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-brand-600">${r.voucher_number ? '#' + r.voucher_number : '—'}</td>
                <td class="py-3 px-4">${statusBadge}</td>
                <td class="py-3 px-4">
                    <div class="flex items-center justify-center gap-2">
                        ${posted && canEdit ? `
                        <button onclick="window.obOpenEdit('${r.id}')" title="تعديل الرصيد (عكس القيد وإنشاء جديد)"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors">
                            <i class="fa-solid fa-pen-to-square text-sm"></i>
                        </button>` : ''}
                        ${posted && canDelete ? `
                        <button onclick="window.obCancel('${r.id}')" title="إلغاء الرصيد (عكس القيد)"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <i class="fa-solid fa-ban text-sm"></i>
                        </button>` : ''}
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    // ── Pickers ───────────────────────────────────────────────────────────────
    function _fillSelect(sel, items, label) {
        if (!sel) return;
        sel.innerHTML = `<option value="">— اختر ${label} —</option>` +
            items.map(x => `<option value="${_esc(x.id)}">${_esc(x.code ? x.code + ' — ' + x.name : x.name)}</option>`).join('');
        if (window.makeSelectSearchable && !sel.dataset.searchable) {
            window.makeSelectSearchable(sel, `🔍 ابحث عن ${label}...`);
        }
    }

    function _syncPicker() {
        _el('ob-picker-client')?.classList.toggle('hidden',   _kind !== 'client');
        _el('ob-picker-supplier')?.classList.toggle('hidden', _kind !== 'supplier');
        _el('ob-picker-account')?.classList.toggle('hidden',  _kind !== 'account');
        document.querySelectorAll('.ob-kind-btn').forEach(b => {
            const active = b.dataset.kind === _kind;
            b.classList.toggle('bg-brand-50',        active);
            b.classList.toggle('border-brand-500',   active);
            b.classList.toggle('text-brand-700',     active);
            b.classList.toggle('text-slate-600',     !active);
        });
        _checkDuplicate();
    }

    window.obSetKind = (k) => { _kind = k; _syncPicker(); };

    window.obSetSide = (s) => {
        _side = s;
        const d = _el('ob-side-debit'), c = _el('ob-side-credit');
        if (d) {
            const on = s === 'debit';
            d.className = `px-3 py-2.5 border rounded-xl text-sm font-bold transition-colors ${on ? 'bg-red-50 border-red-400 text-red-600' : 'border-slate-200 text-slate-600'}`;
        }
        if (c) {
            const on = s === 'credit';
            c.className = `px-3 py-2.5 border rounded-xl text-sm font-bold transition-colors ${on ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'border-slate-200 text-slate-600'}`;
        }
    };

    function _selectedTarget() {
        if (_kind === 'client')   return { account_id: null, sub: _el('ob-client')?.value   || '' };
        if (_kind === 'supplier') return { account_id: null, sub: _el('ob-supplier')?.value || '' };
        return { account_id: _el('ob-account')?.value || '', sub: null };
    }

    function _checkDuplicate() {
        // Warn when the picked target already has a POSTED opening balance
        const warn = _el('ob-dup-warning');
        if (!warn || !_meta || _editingId) { warn?.classList.add('hidden'); return; }
        const t = _selectedTarget();
        let dup = false;
        if (_kind === 'account' && t.account_id) {
            dup = _meta.existing.some(e => e.account_id === t.account_id && !e.sub_account_id);
        } else if ((_kind === 'client' || _kind === 'supplier') && t.sub) {
            dup = _meta.existing.some(e => e.sub_account_id === t.sub);
        }
        warn.classList.toggle('hidden', !dup);
    }

    // ── Modal ─────────────────────────────────────────────────────────────────
    function _openModal() {
        const m = _el('ob-modal');
        m.style.display = 'flex';
        requestAnimationFrame(() => m.classList.add('opacity-100'));
    }

    window.obCloseModal = function () {
        const m = _el('ob-modal');
        m.classList.remove('opacity-100');
        setTimeout(() => { m.style.display = 'none'; _editingId = null; }, 200);
    };

    window.obOpenNew = async function () {
        if (!_can('create')) { window.showToast('ليس لديك صلاحية إضافة أرصدة افتتاحية.', 'error'); return; }
        if (!_meta) await _loadMeta();
        _editingId = null;
        _fillSelect(_el('ob-client'),   _meta.clients,   'العميل');
        _fillSelect(_el('ob-supplier'), _meta.suppliers, 'المورد');
        _fillSelect(_el('ob-account'),  _meta.accounts,  'الحساب');

        _el('ob-modal-title').textContent = 'رصيد افتتاحي جديد';
        _el('ob-kind-group').classList.remove('opacity-50', 'pointer-events-none');
        ['ob-client', 'ob-supplier', 'ob-account'].forEach(id => { const s = _el(id); if (s) s.disabled = false; });
        _el('ob-amount').value      = '';
        _el('ob-date').value        = new Date().toISOString().slice(0, 10);
        _el('ob-reference').value   = '';
        _el('ob-description').value = '';
        _el('ob-form-error').classList.add('hidden');
        _el('ob-dup-warning').classList.add('hidden');
        window.obSetKind('client');
        window.obSetSide('debit');
        _openModal();
    };

    window.obOpenEdit = async function (id) {
        if (!_meta) await _loadMeta();
        const r = _rows.find(x => x.id === id);
        if (!r || r.status !== 'posted') return;
        _editingId = id;

        _fillSelect(_el('ob-client'),   _meta.clients,   'العميل');
        _fillSelect(_el('ob-supplier'), _meta.suppliers, 'المورد');
        _fillSelect(_el('ob-account'),  _meta.accounts,  'الحساب');

        _el('ob-modal-title').textContent = 'تعديل رصيد افتتاحي';
        _el('ob-modal-sub').textContent   = 'سيُعكس القيد القديم ويُنشأ قيد جديد بالقيم المعدلة';
        // Lock the target — account/party identity is immutable per registry row
        _kind = r.sub_account_type || 'account';
        _syncPicker();
        _el('ob-kind-group').classList.add('opacity-50', 'pointer-events-none');
        if (_kind === 'client')        { _el('ob-client').value = r.sub_account_id;   _el('ob-client').disabled = true; }
        else if (_kind === 'supplier') { _el('ob-supplier').value = r.sub_account_id; _el('ob-supplier').disabled = true; }
        else                           { _el('ob-account').value = r.account_id;      _el('ob-account').disabled = true; }
        ['ob-client', 'ob-supplier', 'ob-account'].forEach(sid => {
            const inp = _el(sid + '_search');
            if (inp) { inp.disabled = true; const opt = _el(sid).options[_el(sid).selectedIndex]; inp.value = opt && opt.value ? opt.textContent : ''; }
        });

        _el('ob-amount').value      = r.amount;
        _el('ob-date').value        = r.balance_date ? String(r.balance_date).slice(0, 10) : '';
        _el('ob-reference').value   = r.reference   || '';
        _el('ob-description').value = r.description || '';
        _el('ob-form-error').classList.add('hidden');
        _el('ob-dup-warning').classList.add('hidden');
        window.obSetSide(r.side);
        _openModal();
    };

    // ── Save ──────────────────────────────────────────────────────────────────
    window.obSave = async function () {
        const err = _el('ob-form-error');
        err.classList.add('hidden');

        const t = _selectedTarget();
        const body = {
            account_kind:    _kind,
            account_id:      t.account_id || undefined,
            sub_account_id:  t.sub || undefined,
            side:            _side,
            amount:          _el('ob-amount').value,
            balance_date:    _el('ob-date').value,
            description:     _el('ob-description').value.trim() || null,
            reference:       _el('ob-reference').value.trim() || null,
        };

        if (_kind === 'client'   && !body.sub_account_id) { err.textContent = 'اختر العميل.';   err.classList.remove('hidden'); return; }
        if (_kind === 'supplier' && !body.sub_account_id) { err.textContent = 'اختر المورد.';   err.classList.remove('hidden'); return; }
        if (_kind === 'account'  && !body.account_id)     { err.textContent = 'اختر الحساب.';   err.classList.remove('hidden'); return; }
        if (!parseFloat(body.amount) || parseFloat(body.amount) <= 0) {
            err.textContent = 'أدخل مبلغًا صحيحًا أكبر من صفر.'; err.classList.remove('hidden'); return;
        }
        if (!body.balance_date) { err.textContent = 'أدخل تاريخ الرصيد.'; err.classList.remove('hidden'); return; }

        const btn = _el('ob-save-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1.5"></i> جاري الحفظ...';

        try {
            if (_editingId) {
                await window.apiFetch(`/api/opening-balances/${_editingId}`, {
                    method: 'PUT', body: JSON.stringify(body),
                });
                window.showToast('تم تعديل الرصيد الافتتاحي (عُكس القيد القديم وأُنشئ قيد جديد)', 'success');
            } else {
                await window.apiFetch('/api/opening-balances', {
                    method: 'POST', body: JSON.stringify(body),
                });
                window.showToast('تم تسجيل الرصيد الافتتاحي بنجاح', 'success');
            }
            window.obCloseModal();
            _meta = null; // existing list changed
            await _load();
        } catch (e2) {
            err.textContent = e2.message || 'حدث خطأ';
            err.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk ml-1.5"></i> حفظ الرصيد';
        }
    };

    // ── Cancel ────────────────────────────────────────────────────────────────
    window.obCancel = async function (id) {
        const r = _rows.find(x => x.id === id);
        const label = r ? (r.sub_account_name || r.account_name) : '';
        if (!confirm(`إلغاء الرصيد الافتتاحي لـ «${label}»؟\nسيُعكس القيد وتُزال قيمته من كشوف الحسابات.`)) return;
        try {
            await window.apiFetch(`/api/opening-balances/${id}`, { method: 'DELETE' });
            window.showToast('تم إلغاء الرصيد الافتتاحي', 'success');
            _meta = null;
            await _load();
        } catch (err) {
            window.showToast(err.message || 'حدث خطأ', 'error');
        }
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    if (_can('view')) {
        const addBtn = _el('ob-add-btn');
        if (addBtn && !_can('create')) addBtn.classList.add('hidden');
        _load();
        _loadMeta();
    }

    // Live duplicate check on picker changes
    ['ob-client', 'ob-supplier', 'ob-account'].forEach(id => {
        const s = _el(id);
        if (s) s.addEventListener('change', _checkDuplicate);
    });

})();
