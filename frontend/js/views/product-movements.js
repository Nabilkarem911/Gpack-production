'use strict';

// =============================================================================
// G.PACK 2.0 — Product Movements View Controller
// =============================================================================

(function () {

    const PAGE_SIZE = 50;
    let _currentPage = 0;
    let _totalRows    = 0;
    let _lastRows     = [];
    let _activeType   = '';

    // Data caches for searchable dropdowns
    let _allClients   = [];
    let _allSuppliers = [];

    const fmt  = (v) => parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const qty  = (v) => parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
    const date = (v) => v ? new Date(v).toLocaleDateString('en-GB') : '—';
    const esc  = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _el  = (id) => document.getElementById(id);

    // ── Load all reference data ───────────────────────────────────────────────
    async function _loadDropdowns() {
        try {
            const [catsRes, clientsRes, suppliersRes] = await Promise.all([
                window.apiFetch('/api/categories'),
                window.apiFetch('/api/clients'),
                window.apiFetch('/api/suppliers?status=active'),
            ]);

            // Categories (normal select)
            const catSel = _el('pm-category');
            (catsRes.data || catsRes || []).forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id; opt.textContent = c.name;
                catSel?.appendChild(opt);
            });

            // Cache for searchable dropdowns
            _allClients   = (clientsRes.data || []).map(c => ({ id: c.id, label: c.name }));
            _allSuppliers = (suppliersRes.data || []).map(s => ({ id: s.id, label: s.company_name || s.name }));

        } catch (_) {}
    }

    // ── Searchable dropdown factory ───────────────────────────────────────────
    function _initSearchDropdown(inputId, hiddenId, dropdownId, items) {
        const input    = _el(inputId);
        const hidden   = _el(hiddenId);
        const dropdown = _el(dropdownId);
        if (!input || !hidden || !dropdown) return;

        function _render(filter) {
            const term = (filter || '').trim().toLowerCase();
            const list = term ? items.filter(i => i.label.toLowerCase().includes(term)) : items;
            if (!list.length) {
                dropdown.innerHTML = `<div class="px-3 py-2 text-xs text-slate-400">لا توجد نتائج</div>`;
            } else {
                dropdown.innerHTML = list.slice(0, 40).map(i =>
                    `<div class="px-3 py-2 text-sm text-slate-700 hover:bg-brand-50 cursor-pointer rounded-lg transition-colors"
                          data-id="${esc(i.id)}" data-label="${esc(i.label)}">${esc(i.label)}</div>`
                ).join('');
            }
            dropdown.classList.remove('hidden');
        }

        input.addEventListener('focus', () => _render(input.value));
        input.addEventListener('input', () => {
            hidden.value = '';
            _render(input.value);
            _onFilterChange();
        });

        dropdown.addEventListener('mousedown', (e) => {
            const item = e.target.closest('[data-id]');
            if (!item) return;
            input.value  = item.dataset.label;
            hidden.value = item.dataset.id;
            dropdown.classList.add('hidden');
            _onFilterChange();
        });

        document.addEventListener('click', (e) => {
            if (!input.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.add('hidden');
                // If user typed but didn't pick, clear hidden value
                if (!hidden.value && input.value) {
                    // keep text for display but no ID = no filter
                }
            }
        });
    }

    // ── Type chip toggling ────────────────────────────────────────────────────
    window.pmSetType = function(type) {
        _activeType = type;
        ['all','receipt','dispense'].forEach(t => {
            const btn = _el(`pm-chip-${t || 'all'}`);
            const chipType = t === 'all' ? '' : t;
            if (btn) {
                btn.classList.toggle('pm-chip-active', chipType === _activeType);
                btn.classList.toggle('pm-chip', true);
            }
        });
        _el('pm-chip-all').classList.toggle('pm-chip-active', _activeType === '');
        _load(0);
    };

    // ── Build query params ────────────────────────────────────────────────────
    function _buildParams(page) {
        const search    = _el('pm-search')?.value.trim() || '';
        const category  = _el('pm-category')?.value      || '';
        const client    = _el('pm-client')?.value        || '';
        const supplier  = _el('pm-supplier')?.value      || '';
        const from      = _el('pm-from')?.value          || '';
        const to        = _el('pm-to')?.value            || '';

        const params = new URLSearchParams({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
        if (search)      params.set('search',      search);
        if (category)    params.set('category_id', category);
        if (_activeType) params.set('type',         _activeType);
        if (client)      params.set('client_id',    client);
        if (supplier)    params.set('supplier_id',  supplier);
        if (from)        params.set('from',         from);
        if (to)          params.set('to',           to);
        return params;
    }

    // ── Active filter tags ────────────────────────────────────────────────────
    function _renderActiveTags() {
        const wrap = _el('pm-active-tags');
        if (!wrap) return;
        const tags = [];

        const clientName   = _el('pm-client-search')?.value.trim();
        const clientId     = _el('pm-client')?.value;
        const supplierName = _el('pm-supplier-search')?.value.trim();
        const supplierId   = _el('pm-supplier')?.value;
        const catSel       = _el('pm-category');
        const catName      = catSel?.options[catSel.selectedIndex]?.text;
        const from         = _el('pm-from')?.value;
        const to           = _el('pm-to')?.value;

        if (clientId && clientName)   tags.push({ label: `عميل: ${clientName}`,   clear: () => { _el('pm-client-search').value = ''; _el('pm-client').value = ''; } });
        if (supplierId && supplierName) tags.push({ label: `مورد: ${supplierName}`, clear: () => { _el('pm-supplier-search').value = ''; _el('pm-supplier').value = ''; } });
        if (catSel?.value)             tags.push({ label: `تصنيف: ${catName}`,      clear: () => { catSel.value = ''; } });
        if (from)                      tags.push({ label: `من: ${from}`,            clear: () => { _el('pm-from').value = ''; } });
        if (to)                        tags.push({ label: `إلى: ${to}`,             clear: () => { _el('pm-to').value = ''; } });
        if (_activeType)               tags.push({ label: _activeType === 'receipt' ? 'استلام فقط' : 'تسليم فقط', clear: () => window.pmSetType('') });

        if (!tags.length) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
        wrap.classList.remove('hidden');
        wrap.innerHTML = tags.map((t, i) =>
            `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand-50 text-brand-700 text-xs font-bold rounded-lg border border-brand-200 cursor-pointer hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all" data-tag="${i}">
                ${esc(t.label)} <i class="fa-solid fa-xmark text-[10px]"></i>
            </span>`
        ).join('');

        wrap.querySelectorAll('[data-tag]').forEach(el => {
            el.addEventListener('click', () => {
                tags[parseInt(el.dataset.tag)].clear();
                _load(0);
            });
        });
    }

    // ── Fetch & render ────────────────────────────────────────────────────────
    async function _load(page = 0) {
        _currentPage = page;
        const tbody = _el('pm-tbody');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="11" class="py-16 text-center text-slate-400">
            <i class="fa-solid fa-circle-notch fa-spin text-2xl"></i></td></tr>`;

        try {
            const params = _buildParams(page);
            const res    = await window.apiFetch(`/api/products/movements?${params}`);
            const rows   = res.data  || [];
            _totalRows   = res.total || 0;
            _lastRows    = rows;

            _renderTable(rows);
            _renderStats(rows);
            _renderProductCard(rows);
            _renderPagination();
            _updateTotalBadge();
            _renderActiveTags();

        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="11" class="py-12 text-center text-red-400 text-sm">
                <i class="fa-solid fa-triangle-exclamation ml-2"></i>${esc(err.message)}</td></tr>`;
        }
    }

    // ── Product summary card ──────────────────────────────────────────────────
    function _renderProductCard(rows) {
        const card = _el('pm-product-card');
        if (!card) return;

        const search = _el('pm-search')?.value.trim() || '';
        // Show card only when search is active and rows exist
        if (!search || !rows.length) { card.classList.add('hidden'); return; }

        // Check if all rows are about the same product
        const productIds = [...new Set(rows.map(r => r.product_id))];

        let totalIn = 0, totalOut = 0;
        const clientTotals   = {};
        const supplierTotals = {};

        rows.forEach(r => {
            const q = parseFloat(r.quantity || 0);
            if (r.transaction_type === 'receipt') {
                totalIn += q;
                const sname = r.supplier_name || '—';
                supplierTotals[sname] = (supplierTotals[sname] || 0) + q;
            } else {
                totalOut += q;
                const cname = r.dn_client_name || r.client_name || '—';
                clientTotals[cname] = (clientTotals[cname] || 0) + q;
            }
        });

        const topClient   = Object.entries(clientTotals).sort((a,b)=>b[1]-a[1])[0]?.[0] || '—';
        const topSupplier = Object.entries(supplierTotals).sort((a,b)=>b[1]-a[1])[0]?.[0] || '—';
        const balance     = totalIn - totalOut;

        const first = rows[0];
        const _s = (id, v) => { const el = _el(id); if (el) el.textContent = v; };

        _s('pmc-name',         productIds.length === 1 ? (first.product_name || search) : `${productIds.length} أصناف`);
        _s('pmc-size',         productIds.length === 1 && first.size_name ? `المقاس: ${first.size_name}` : '');
        _s('pmc-category',     first.category_name || '');
        _s('pmc-in',           qty(totalIn));
        _s('pmc-out',          qty(totalOut));
        _s('pmc-balance',      qty(balance));
        _s('pmc-top-client',   topClient);
        _s('pmc-top-supplier', topSupplier);

        // Client breakdown bars
        const listEl = _el('pmc-clients-list');
        if (listEl) {
            const maxQ = Math.max(...Object.values(clientTotals), 1);
            listEl.innerHTML = Object.entries(clientTotals)
                .sort((a,b) => b[1] - a[1])
                .map(([name, q]) => {
                    const pct = Math.round((q / maxQ) * 100);
                    return `<div class="flex items-center gap-2 w-full sm:w-auto min-w-[180px] flex-1">
                        <span class="text-xs text-slate-600 font-semibold whitespace-nowrap min-w-[80px] truncate" title="${esc(name)}">${esc(name)}</span>
                        <div class="flex-1 bg-slate-100 rounded-full h-2">
                            <div class="bg-amber-400 h-2 rounded-full" style="width:${pct}%"></div>
                        </div>
                        <span class="text-xs font-bold text-amber-600 whitespace-nowrap">${qty(q)}</span>
                    </div>`;
                }).join('') || '<span class="text-xs text-slate-400">لا يوجد تسليم</span>';
        }

        card.classList.remove('hidden');
    }

    // ── Render table ──────────────────────────────────────────────────────────
    function _renderTable(rows) {
        const tbody = _el('pm-tbody');
        if (!tbody) return;

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="11" class="py-16 text-center text-slate-400 text-sm">
                <i class="fa-solid fa-inbox text-2xl mb-2 block"></i>لا توجد حركات تطابق الفلتر</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map((r, i) => {
            const isReceipt  = r.transaction_type === 'receipt';
            const typeCell   = isReceipt
                ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700"><i class="fa-solid fa-arrow-down text-[10px]"></i> استلام</span>`
                : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700"><i class="fa-solid fa-arrow-up text-[10px]"></i> تسليم</span>`;

            const unitPrice  = isReceipt
                ? parseFloat(r.mo_unit_cost  || r.cost_price    || 0)
                : parseFloat(r.sale_unit_price || r.selling_price || 0);
            const total      = unitPrice * parseFloat(r.quantity || 0);
            const counterpart = isReceipt ? (r.supplier_name || '—') : (r.dn_client_name || r.client_name || '—');
            const ref         = isReceipt
                ? (r.mo_number ? `<span class="font-mono text-xs text-slate-500">${esc(r.mo_number)}</span>` : '—')
                : (r.delivery_note_number ? `<span class="font-mono text-xs text-slate-500">DN-${r.delivery_note_number}</span>` : '—');
            const rowBg = i % 2 === 1 ? 'bg-slate-50/40' : '';

            return `<tr class="border-b border-slate-100 hover:bg-blue-50/30 transition-colors ${rowBg}">
                <td class="py-3 px-4 text-slate-500 whitespace-nowrap">${date(r.created_at)}</td>
                <td class="py-3 px-4">${typeCell}</td>
                <td class="py-3 px-4 font-semibold text-slate-800">${esc(r.product_name)}</td>
                <td class="py-3 px-4 text-slate-600">${esc(r.size_name || '—')}</td>
                <td class="py-3 px-4 text-slate-500 hidden sm:table-cell text-xs">${esc(r.category_name || '—')}</td>
                <td class="py-3 px-4 font-bold font-mono ${isReceipt ? 'text-emerald-600' : 'text-amber-600'}">
                    ${isReceipt ? '+' : '-'}${qty(r.quantity)}</td>
                <td class="py-3 px-4 font-mono text-slate-700">${unitPrice > 0 ? fmt(unitPrice) : '—'}</td>
                <td class="py-3 px-4 font-bold font-mono ${isReceipt ? 'text-emerald-700' : 'text-amber-700'}">
                    ${total > 0 ? fmt(total) : '—'}</td>
                <td class="py-3 px-4 text-slate-700 font-semibold">${esc(counterpart)}</td>
                <td class="py-3 px-4 hidden md:table-cell">${ref}</td>
                <td class="py-3 px-4 text-slate-400 text-xs hidden lg:table-cell max-w-[180px] truncate"
                    title="${esc(r.notes)}">${esc(r.notes || '—')}</td>
            </tr>`;
        }).join('');
    }

    // ── Summary stats ─────────────────────────────────────────────────────────
    function _renderStats(rows) {
        const statsRow = _el('pm-stats-row');
        if (!statsRow || !rows.length) { statsRow?.classList.add('hidden'); return; }

        let rQty = 0, rVal = 0, dQty = 0, dVal = 0;
        rows.forEach(r => {
            const q = parseFloat(r.quantity || 0);
            if (r.transaction_type === 'receipt') {
                rQty += q;
                rVal += parseFloat(r.mo_unit_cost || r.cost_price || 0) * q;
            } else {
                dQty += q;
                dVal += parseFloat(r.sale_unit_price || r.selling_price || 0) * q;
            }
        });

        const _s = (id, v) => { const el = _el(id); if (el) el.textContent = v; };
        _s('pm-stat-receipt-qty',  qty(rQty));
        _s('pm-stat-receipt-val',  fmt(rVal));
        _s('pm-stat-dispense-qty', qty(dQty));
        _s('pm-stat-dispense-val', fmt(dVal));
        statsRow.classList.remove('hidden');
    }

    // ── Pagination ────────────────────────────────────────────────────────────
    function _renderPagination() {
        const pag     = _el('pm-pagination');
        const info    = _el('pm-page-info');
        const prevBtn = _el('pm-prev-btn');
        const nextBtn = _el('pm-next-btn');
        if (!pag) return;
        if (_totalRows <= PAGE_SIZE) { pag.classList.add('hidden'); return; }
        pag.classList.remove('hidden');
        const from = _currentPage * PAGE_SIZE + 1;
        const to   = Math.min((_currentPage + 1) * PAGE_SIZE, _totalRows);
        if (info)    info.textContent = `عرض ${from}–${to} من ${_totalRows}`;
        if (prevBtn) prevBtn.disabled = _currentPage === 0;
        if (nextBtn) nextBtn.disabled = to >= _totalRows;
    }

    function _updateTotalBadge() {
        const badge = _el('pm-total-badge');
        if (!badge) return;
        badge.textContent = `${_totalRows} حركة`;
        badge.classList.remove('hidden');
    }

    // ── Page change ───────────────────────────────────────────────────────────
    window.pmChangePage = function(dir) {
        const newPage = _currentPage + dir;
        if (newPage < 0 || newPage * PAGE_SIZE >= _totalRows) return;
        _load(newPage);
    };

    // ── Reset filters ─────────────────────────────────────────────────────────
    window.pmResetFilters = function() {
        ['pm-search','pm-from','pm-to','pm-client-search','pm-supplier-search'].forEach(id => { const el = _el(id); if (el) el.value = ''; });
        ['pm-category','pm-client','pm-supplier'].forEach(id => { const el = _el(id); if (el) el.value = ''; });
        _activeType = '';
        _el('pm-chip-all')?.classList.add('pm-chip-active');
        _el('pm-chip-receipt')?.classList.remove('pm-chip-active');
        _el('pm-chip-dispense')?.classList.remove('pm-chip-active');
        _load(0);
    };

    // ── CSV export ────────────────────────────────────────────────────────────
    window.pmExportCSV = function() {
        if (!_lastRows.length) { alert('لا توجد بيانات للتصدير.'); return; }
        const headers = ['التاريخ','النوع','المنتج','المقاس','التصنيف','الكمية','سعر الوحدة','الإجمالي','الطرف الآخر','المرجع','الملاحظات'];
        const csvRows = [headers.join(',')];
        _lastRows.forEach(r => {
            const isReceipt = r.transaction_type === 'receipt';
            const up  = isReceipt ? parseFloat(r.mo_unit_cost || r.cost_price || 0) : parseFloat(r.sale_unit_price || r.selling_price || 0);
            const tot = up * parseFloat(r.quantity || 0);
            const counterpart = isReceipt ? (r.supplier_name || '') : (r.dn_client_name || r.client_name || '');
            const ref = isReceipt ? (r.mo_number || '') : (r.delivery_note_number ? `DN-${r.delivery_note_number}` : '');
            csvRows.push([
                date(r.created_at), isReceipt ? 'استلام' : 'تسليم',
                r.product_name || '', r.size_name || '', r.category_name || '',
                parseFloat(r.quantity || 0), up.toFixed(2), tot.toFixed(2),
                counterpart, ref, (r.notes || '').replace(/,/g,'؛'),
            ].map(c => `"${c}"`).join(','));
        });
        const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob),
            download: `حركات_الاصناف_${new Date().toLocaleDateString('en-GB').replace(/\//g,'-')}.csv`,
        });
        a.click(); URL.revokeObjectURL(a.href);
    };

    // ── Debounced filter ──────────────────────────────────────────────────────
    let _debounceTimer;

    function _onFilterChange() {
        clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => _load(0), 400);
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    async function _init() {
        await _loadDropdowns();

        // Init searchable dropdowns (after data is loaded)
        if (window._pmInitSearch) {
            const el = _el('pm-search');
            if (el) el.value = window._pmInitSearch;
            window._pmInitSearch = '';
        }

        ['pm-search','pm-category','pm-from','pm-to'].forEach(id => {
            const el = _el(id);
            if (el) { el.addEventListener('input', _onFilterChange); el.addEventListener('change', _onFilterChange); }
        });

        _load(0);
    }

    _init();

})();
