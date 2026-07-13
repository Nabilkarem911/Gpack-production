'use strict';

// =============================================================================
// G.PACK 2.0 — Purchase Invoices View Controller (Archive-Only)
// فواتير المشتريات تُنشأ تلقائياً عند استلام البضاعة من المورد
// =============================================================================

(function () {

    const PAGE_SIZE = 20;
    const fmt  = (v) => parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc  = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _el  = (id) => document.getElementById(id);

    // ── Tab Switching ─────────────────────────────────────────────────────────
    let _activeTab = 'invoices';

    window.piSwitchTab = function(tab) {
        _activeTab = tab;
        const tabInv  = _el('pi-tab-invoices');
        const tabArc  = _el('pi-tab-archive');
        const pnlInv  = _el('pi-panel-invoices');
        const pnlArc  = _el('pi-panel-archive');

        if (tab === 'invoices') {
            tabInv.className = 'px-5 py-2.5 text-sm font-bold border-b-2 border-blue-500 text-blue-600 transition-all';
            tabArc.className = 'px-5 py-2.5 text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600 transition-all';
            pnlInv?.classList.remove('hidden');
            pnlArc?.classList.add('hidden');
            _loadInvoices(0);
        } else {
            tabArc.className = 'px-5 py-2.5 text-sm font-bold border-b-2 border-blue-500 text-blue-600 transition-all';
            tabInv.className = 'px-5 py-2.5 text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600 transition-all';
            pnlArc?.classList.remove('hidden');
            pnlInv?.classList.add('hidden');
            _loadArchive(0);
        }
    };

    // ── Invoices Tab (Drafts) ─────────────────────────────────────────────────
    let _invPage    = 0;
    let _invTotal   = 0;
    let _invList    = [];

    async function _loadInvoices(page = 0) {
        _invPage   = page;
        const tbody = _el('pi-inv-tbody');
        const empty = _el('pi-inv-empty');

        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i></td></tr>`;
        if (empty) empty.classList.add('hidden');

        const params = new URLSearchParams({
            limit:  PAGE_SIZE,
            offset: page * PAGE_SIZE,
            status: 'draft',
            _t:     Date.now(),
        });
        const search      = _el('pi-inv-search')?.value?.trim();
        const hasInvoice  = _el('pi-inv-has-invoice')?.value;
        if (search)      params.set('search', search);
        if (hasInvoice)  params.set('has_invoice', hasInvoice);

        try {
            const res = await window.apiFetch(`/api/purchase-invoices?${params}`);
            _invList  = res.data  || [];
            _invTotal = res.total || _invList.length;
            _renderInvoices();
            _updateInvPagination();
            _updateInvBadge();
        } catch (err) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-red-400 text-sm"><i class="fa-solid fa-triangle-exclamation ml-2"></i>${esc(err.message)}</td></tr>`;
        }
    }

    function _renderInvoices() {
        const tbody = _el('pi-inv-tbody');
        const empty = _el('pi-inv-empty');
        if (!tbody) return;

        if (!_invList.length) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        const _s = (id, v) => { const el = _el(id); if (el) el.textContent = v; };
        _s('pi-inv-showing', _invList.length);
        _s('pi-inv-total',   _invTotal);

        tbody.innerHTML = _invList.map(inv => {
            const date = new Date(inv.invoice_date).toLocaleDateString('ar-SA-u-nu-latn');
            const hasInv = inv.has_supplier_invoice !== false;
            const invBadge = hasInv
                ? '<span class="px-2 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-700"><i class="fa-solid fa-file-invoice ml-1"></i>بفاتورة</span>'
                : '<span class="px-2 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-700"><i class="fa-solid fa-triangle-exclamation ml-1"></i>بدون فاتورة</span>';
            return `<tr class="border-b border-slate-100 hover:bg-blue-50/30 transition-colors bg-blue-50/20">
                <td class="py-3 px-4 font-bold font-mono text-slate-700">#${inv.invoice_number}</td>
                <td class="py-3 px-4 text-slate-500 text-xs">${date}</td>
                <td class="py-3 px-4 font-semibold text-slate-800">${esc(inv.supplier_name || '—')}</td>
                <td class="py-3 px-4 text-slate-500 text-xs hidden sm:table-cell">${esc(inv.supplier_invoice_ref || '—')}</td>
                <td class="py-3 px-4 text-center">${invBadge}</td>
                <td class="py-3 px-4 text-center">
                    <span class="px-2 py-1 rounded-lg text-xs font-bold bg-blue-100 text-blue-700"><i class="fa-solid fa-clock ml-1"></i> بانتظار الاعتماد</span>
                </td>
                <td class="py-3 px-4 text-center">
                    <button onclick="window.piOpenApproveModal('${esc(inv.id)}')"
                        class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-all">
                        <i class="fa-solid fa-check-double ml-1"></i> اعتماد
                    </button>
                </td>
            </tr>`;
        }).join('');
    }

    function _updateInvPagination() {
        const pageEl  = _el('pi-inv-page');
        const prevBtn = _el('pi-inv-prev');
        const nextBtn = _el('pi-inv-next');
        if (pageEl)  pageEl.textContent = _invPage + 1;
        if (prevBtn) prevBtn.disabled = _invPage === 0;
        if (nextBtn) nextBtn.disabled = (_invPage + 1) * PAGE_SIZE >= _invTotal;
    }

    function _updateInvBadge() {
        const badge = _el('pi-tab-invoices-badge');
        if (!badge) return;
        if (_invTotal > 0) {
            badge.textContent = _invTotal;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    window.piInvChangePage = function(dir) { _loadInvoices(_invPage + dir); };

    window.piInvFilterChange = function() {
        clearTimeout(window._piInvDebounce);
        window._piInvDebounce = setTimeout(() => _loadInvoices(0), 300);
    };

    // ── Archive Tab (Approved/Posted) ─────────────────────────────────────────
    let _arcPage    = 0;
    let _arcTotal   = 0;
    let _arcList    = [];

    async function _loadArchive(page = 0) {
        _arcPage   = page;
        const tbody = _el('pi-arc-tbody');
        const empty = _el('pi-arc-empty');

        if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="py-12 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i></td></tr>`;
        if (empty) empty.classList.add('hidden');

        const params = new URLSearchParams({
            limit:  PAGE_SIZE,
            offset: page * PAGE_SIZE,
            _t:     Date.now(),
        });
        const search      = _el('pi-arc-search')?.value?.trim();
        const status      = _el('pi-arc-status')?.value;
        const hasInvoice  = _el('pi-arc-has-invoice')?.value;
        if (search)      params.set('search', search);
        if (status)      params.set('status', status);
        if (hasInvoice)  params.set('has_invoice', hasInvoice);
        // Exclude drafts from archive — they show in the Invoices tab
        params.set('exclude_status', 'draft');

        try {
            const res = await window.apiFetch(`/api/purchase-invoices?${params}`);
            _arcList  = res.data  || [];
            _arcTotal = res.total || _arcList.length;
            _renderArchive();
            _updateArcPagination();
        } catch (err) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-red-400 text-sm"><i class="fa-solid fa-triangle-exclamation ml-2"></i>${esc(err.message)}</td></tr>`;
        }
    }

    function _renderArchive() {
        const tbody = _el('pi-arc-tbody');
        const empty = _el('pi-arc-empty');
        if (!tbody) return;

        if (!_arcList.length) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        const statusMap = {
            draft:          { bg: 'bg-blue-100',     text: 'text-blue-700',     label: 'مسودة' },
            unpaid:         { bg: 'bg-red-100',     text: 'text-red-700',     label: 'غير مدفوعة' },
            partially_paid: { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'جزئي' },
            paid:           { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'مدفوعة' },
            cancelled:      { bg: 'bg-slate-100',   text: 'text-slate-500',   label: 'ملغية' },
        };

        const _s = (id, v) => { const el = _el(id); if (el) el.textContent = v; };
        _s('pi-arc-showing', _arcList.length);
        _s('pi-arc-total',   _arcTotal);

        tbody.innerHTML = _arcList.map(inv => {
            const st   = statusMap[inv.status] || statusMap.unpaid;
            const date = new Date(inv.invoice_date).toLocaleDateString('ar-SA-u-nu-latn');
            const hasInv = inv.has_supplier_invoice !== false;
            const invBadge = hasInv
                ? '<span class="px-2 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-700"><i class="fa-solid fa-file-invoice ml-1"></i>بفاتورة</span>'
                : '<span class="px-2 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-700"><i class="fa-solid fa-triangle-exclamation ml-1"></i>بدون فاتورة</span>';
            const isDraft = inv.status === 'draft';
            const isPosted = !isDraft && inv.status !== 'cancelled';
            const actions = isDraft
                ? `<button onclick="window.piOpenApproveModal('${esc(inv.id)}')"
                        class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-all">
                        <i class="fa-solid fa-check-double ml-1"></i> اعتماد
                    </button>`
                : `<div class="flex items-center justify-center gap-1">
                    ${isPosted ? `<button onclick="window.piOpenEditModal('${esc(inv.id)}')"
                        class="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-all" title="تعديل">
                        <i class="fa-solid fa-pen-to-square text-xs"></i>
                    </button>` : ''}
                    <button onclick="window.piViewInvoice('${esc(inv.id)}')"
                        class="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-all" title="طباعة">
                        <i class="fa-solid fa-print text-xs"></i>
                    </button>
                </div>`;
            return `<tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors ${isDraft ? 'bg-blue-50/30' : ''}">
                <td class="py-3 px-4 font-bold font-mono text-slate-700">#${inv.invoice_number}</td>
                <td class="py-3 px-4 text-slate-500 text-xs">${date}</td>
                <td class="py-3 px-4 font-semibold text-slate-800">${esc(inv.supplier_name || '—')}</td>
                <td class="py-3 px-4 text-slate-500 text-xs hidden sm:table-cell">${esc(inv.supplier_invoice_ref || '—')}</td>
                <td class="py-3 px-4 font-bold font-mono ${isDraft ? 'text-slate-400' : 'text-purple-600'}">${isDraft ? '—' : fmt(inv.grand_total)}</td>
                <td class="py-3 px-4 text-center">${invBadge}</td>
                <td class="py-3 px-4 text-center">
                    <span class="px-2 py-1 rounded-lg text-xs font-bold ${st.bg} ${st.text}">${st.label}</span>
                </td>
                <td class="py-3 px-4 text-center">${actions}</td>
            </tr>`;
        }).join('');
    }

    function _updateArcPagination() {
        const pageEl  = _el('pi-arc-page');
        const prevBtn = _el('pi-arc-prev');
        const nextBtn = _el('pi-arc-next');
        if (pageEl)  pageEl.textContent = _arcPage + 1;
        if (prevBtn) prevBtn.disabled = _arcPage === 0;
        if (nextBtn) nextBtn.disabled = (_arcPage + 1) * PAGE_SIZE >= _arcTotal;
    }

    window.piArcChangePage = function(dir) { _loadArchive(_arcPage + dir); };

    window.piArcFilterChange = function() {
        clearTimeout(window._piArcDebounce);
        window._piArcDebounce = setTimeout(() => _loadArchive(0), 300);
    };

    // ── Approve Modal ─────────────────────────────────────────────────────────
    let _aprItems = [];

    window.piOpenApproveModal = async function(invId) {
        try {
            const res   = await window.apiFetch(`/api/purchase-invoices/${invId}`);
            const inv   = res.data?.invoice || res.invoice;
            const items = res.data?.items || res.items || [];

            if (!inv || inv.status !== 'draft') {
                alert('الفاتورة ليست مسودة');
                return;
            }

            _aprItems = items.map(i => ({
                id:           i.id,
                product_name: i.product_name,
                size_name:    i.size_name || '',
                quantity:     parseFloat(i.quantity || 0),
                unit_cost:    parseFloat(i.unit_cost || i.unit_price || 0),
                line_total:   0,
            }));

            _el('pi-apr-id').value       = invId;
            _el('pi-apr-num').textContent = `#${inv.invoice_number}`;
            _el('pi-apr-supplier').textContent = inv.supplier_name || '—';

            _el('pi-apr-tax-toggle').checked = false;
            _el('pi-apr-pay-toggle').checked = false;
            _el('pi-apr-pay-section').classList.add('hidden');
            _el('pi-apr-pay-amount').value = '';
            _el('pi-apr-pay-notes').value = '';

            _renderAprItems();
            _piAprUpdateTotals();

            _el('pi-approve-overlay')?.classList.remove('hidden');
            _el('pi-approve-modal')?.classList.remove('hidden');
        } catch (err) {
            alert('خطأ في تحميل الفاتورة: ' + err.message);
        }
    };

    window.piCloseApproveModal = function() {
        _el('pi-approve-overlay')?.classList.add('hidden');
        _el('pi-approve-modal')?.classList.add('hidden');
        _aprItems = [];
    };

    function _renderAprItems() {
        const tbody = _el('pi-apr-items');
        if (!tbody) return;
        tbody.innerHTML = _aprItems.map((item, i) => {
            const label = `${esc(item.product_name)} — ${esc(item.size_name || 'بدون مقاس')}`;
            return `<tr class="border-b border-slate-100">
                <td class="py-3 px-3"><div class="text-sm font-semibold text-slate-800">${label}</div></td>
                <td class="py-3 px-3 text-center"><span class="text-sm font-bold text-slate-700">${item.quantity}</span></td>
                <td class="py-3 px-3 text-center">
                    <input type="number" min="0" step="0.01" value="${item.unit_cost > 0 ? item.unit_cost.toFixed(2) : ''}"
                           id="pi-apr-price-${i}"
                           oninput="window.piAprUpdatePrice(${i}, this.value)"
                           class="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center font-mono focus:border-emerald-400 outline-none"
                           placeholder="0.00" />
                </td>
                <td class="py-3 px-3 text-center font-mono text-sm font-bold text-emerald-600" id="pi-apr-line-${i}">0.00</td>
            </tr>`;
        }).join('');
    }

    window.piAprUpdatePrice = function(idx, value) {
        _aprItems[idx].unit_cost = parseFloat(value) || 0;
        _aprItems[idx].line_total = _aprItems[idx].quantity * _aprItems[idx].unit_cost;
        const el = _el(`pi-apr-line-${idx}`);
        if (el) el.textContent = fmt(_aprItems[idx].line_total);
        _piAprUpdateTotals();
    };

    function _piAprUpdateTotals() {
        let subtotal = 0;
        for (const item of _aprItems) subtotal += item.line_total;
        const hasTax = _el('pi-apr-tax-toggle')?.checked || false;
        const taxRate = hasTax ? 0.15 : 0;
        const taxAmt = subtotal * taxRate;
        const grand = subtotal + taxAmt;
        const _s = (id, v) => { const el = _el(id); if (el) el.textContent = v; };
        _s('pi-apr-subtotal', fmt(subtotal));
        _s('pi-apr-tax-amount', hasTax ? fmt(taxAmt) : '0.00');
        _s('pi-apr-grand', fmt(grand));
    }

    window.piAprUpdateTotals = _piAprUpdateTotals;

    window.piAprTogglePay = function(show) {
        const section = _el('pi-apr-pay-section');
        if (section) section.classList.toggle('hidden', !show);
    };

    window.piApproveInvoice = async function() {
        const invId = _el('pi-apr-id')?.value;
        if (!invId) return;

        const unpriced = _aprItems.filter(i => i.unit_cost <= 0);
        if (unpriced.length) {
            alert(`يوجد ${unpriced.length} صنف بدون سعر! أدخل جميع الأسعار أولاً.`);
            return;
        }

        const hasTax = _el('pi-apr-tax-toggle')?.checked || false;
        const payNow = _el('pi-apr-pay-toggle')?.checked || false;
        const payAmount = parseFloat(_el('pi-apr-pay-amount')?.value || 0);
        const payNotes = _el('pi-apr-pay-notes')?.value || '';

        if (payNow && (!payAmount || payAmount <= 0)) {
            alert('أدخل مبلغ الدفع');
            return;
        }

        const btn = document.querySelector('#pi-approve-modal button[onclick="window.piApproveInvoice()"]');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جاري الاعتماد...'; }

        try {
            const res = await window.apiFetch(`/api/purchase-invoices/${invId}/approve`, {
                method: 'POST',
                body: {
                    items: _aprItems.map(i => ({ id: i.id, unit_cost: i.unit_cost })),
                    tax_rate: hasTax ? 0.15 : 0,
                    pay_now: payNow,
                    pay_amount: payNow ? payAmount : 0,
                    pay_notes: payNotes,
                },
            });

            alert(`✅ ${res.message || 'تم اعتماد الفاتورة بنجاح'}`);
            window.piCloseApproveModal();
            await _loadInvoices(0);
            if (_activeTab === 'archive') await _loadArchive(0);
        } catch (err) {
            alert(`❌ خطأ: ${err.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check-double ml-1"></i> اعتماد الفاتورة'; }
        }
    };

    // ── Edit Modal ───────────────────────────────────────────────────────────
    let _edtItems = [];

    window.piOpenEditModal = async function(invId) {
        try {
            const res   = await window.apiFetch(`/api/purchase-invoices/${invId}`);
            const inv   = res.data?.invoice || res.invoice;
            const items = res.data?.items || res.items || [];

            if (!inv) {
                alert('الفاتورة غير موجودة');
                return;
            }
            if (inv.status === 'draft') {
                alert('الفاتورة مسودة — استخدم الاعتماد');
                return;
            }
            if (inv.status === 'cancelled') {
                alert('الفاتورة ملغية — لا يمكن تعديلها');
                return;
            }

            _edtItems = items.map(i => ({
                id:           i.id,
                product_name: i.product_name,
                size_name:    i.size_name || '',
                quantity:     parseFloat(i.quantity || 0),
                unit_cost:    parseFloat(i.unit_cost || i.unit_price || 0),
                line_total:   parseFloat(i.quantity || 0) * parseFloat(i.unit_cost || i.unit_price || 0),
            }));

            _el('pi-edt-id').value       = invId;
            _el('pi-edt-num').textContent = `#${inv.invoice_number}`;
            _el('pi-edt-supplier').textContent = inv.supplier_name || '—';

            const hasTax = parseFloat(inv.tax_rate || 0) > 0;
            _el('pi-edt-tax-toggle').checked = hasTax;
            _el('pi-edt-pay-toggle').checked = false;
            _el('pi-edt-pay-section').classList.add('hidden');
            _el('pi-edt-pay-amount').value = '';
            _el('pi-edt-pay-notes').value = '';

            _renderEdtItems();
            _piEdtUpdateTotals();

            _el('pi-edit-overlay')?.classList.remove('hidden');
            _el('pi-edit-modal')?.classList.remove('hidden');
        } catch (err) {
            alert('خطأ في تحميل الفاتورة: ' + err.message);
        }
    };

    window.piCloseEditModal = function() {
        _el('pi-edit-overlay')?.classList.add('hidden');
        _el('pi-edit-modal')?.classList.add('hidden');
        _edtItems = [];
    };

    function _renderEdtItems() {
        const tbody = _el('pi-edt-items');
        if (!tbody) return;
        tbody.innerHTML = _edtItems.map((item, i) => {
            const label = `${esc(item.product_name)} — ${esc(item.size_name || 'بدون مقاس')}`;
            return `<tr class="border-b border-slate-100">
                <td class="py-3 px-3"><div class="text-sm font-semibold text-slate-800">${label}</div></td>
                <td class="py-3 px-3 text-center"><span class="text-sm font-bold text-slate-700">${item.quantity}</span></td>
                <td class="py-3 px-3 text-center">
                    <input type="number" min="0" step="0.01" value="${item.unit_cost.toFixed(2)}"
                           id="pi-edt-price-${i}"
                           oninput="window.piEdtUpdatePrice(${i}, this.value)"
                           class="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center font-mono focus:border-amber-400 outline-none"
                           placeholder="0.00" />
                </td>
                <td class="py-3 px-3 text-center font-mono text-sm font-bold text-amber-600" id="pi-edt-line-${i}">${fmt(item.line_total)}</td>
            </tr>`;
        }).join('');
    }

    window.piEdtUpdatePrice = function(idx, value) {
        _edtItems[idx].unit_cost = parseFloat(value) || 0;
        _edtItems[idx].line_total = _edtItems[idx].quantity * _edtItems[idx].unit_cost;
        const el = _el(`pi-edt-line-${idx}`);
        if (el) el.textContent = fmt(_edtItems[idx].line_total);
        _piEdtUpdateTotals();
    };

    function _piEdtUpdateTotals() {
        let subtotal = 0;
        for (const item of _edtItems) subtotal += item.line_total;
        const hasTax = _el('pi-edt-tax-toggle')?.checked || false;
        const taxRate = hasTax ? 0.15 : 0;
        const taxAmt = subtotal * taxRate;
        const grand = subtotal + taxAmt;
        const _s = (id, v) => { const el = _el(id); if (el) el.textContent = v; };
        _s('pi-edt-subtotal', fmt(subtotal));
        _s('pi-edt-tax-amount', hasTax ? fmt(taxAmt) : '0.00');
        _s('pi-edt-grand', fmt(grand));
    }

    window.piEdtUpdateTotals = _piEdtUpdateTotals;

    window.piEdtTogglePay = function(show) {
        const section = _el('pi-edt-pay-section');
        if (section) section.classList.toggle('hidden', !show);
    };

    window.piEditInvoice = async function() {
        const invId = _el('pi-edt-id')?.value;
        if (!invId) return;

        const unpriced = _edtItems.filter(i => i.unit_cost <= 0);
        if (unpriced.length) {
            alert(`يوجد ${unpriced.length} صنف بدون سعر! أدخل جميع الأسعار أولاً.`);
            return;
        }

        const hasTax = _el('pi-edt-tax-toggle')?.checked || false;
        const payNow = _el('pi-edt-pay-toggle')?.checked || false;
        const payAmount = parseFloat(_el('pi-edt-pay-amount')?.value || 0);
        const payNotes = _el('pi-edt-pay-notes')?.value || '';

        if (payNow && (!payAmount || payAmount <= 0)) {
            alert('أدخل مبلغ الدفع');
            return;
        }

        if (!confirm('تأكيد تعديل الفاتورة؟ سيتم حذف القيود المحاسبية الحالية وإعادة إنشائها.')) return;

        const btn = document.querySelector('#pi-edit-modal button[onclick="window.piEditInvoice()"]');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جاري الحفظ...'; }

        try {
            const res = await window.apiFetch(`/api/purchase-invoices/${invId}/edit`, {
                method: 'POST',
                body: {
                    items: _edtItems.map(i => ({ id: i.id, unit_cost: i.unit_cost })),
                    tax_rate: hasTax ? 0.15 : 0,
                    pay_now: payNow,
                    pay_amount: payNow ? payAmount : 0,
                    pay_notes: payNotes,
                },
            });

            alert(`✅ ${res.message || 'تم تعديل الفاتورة بنجاح'}`);
            window.piCloseEditModal();
            if (_activeTab === 'archive') await _loadArchive(0);
            else await _loadInvoices(0);
        } catch (err) {
            alert(`❌ خطأ: ${err.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-pen-to-square ml-1"></i> حفظ التعديلات'; }
        }
    };

    // ── View / Print Invoice ──────────────────────────────────────────────────
    window.piViewInvoice = async function(id) {
        try {
            const res   = await window.apiFetch(`/api/purchase-invoices/${id}`);
            const inv   = res.data?.invoice || res.invoice;
            const items = res.data?.items || res.items || [];

            const statusLabels = { draft: 'مسودة', unpaid: 'غير مدفوعة', partially_paid: 'مدفوعة جزئياً', paid: 'مدفوعة', cancelled: 'ملغية' };
            const statusColors = { draft: '#2563eb', unpaid: '#dc2626', partially_paid: '#d97706', paid: '#15803d', cancelled: '#64748b' };
            const statusBgs    = { draft: '#dbeafe', unpaid: '#fee2e2', partially_paid: '#fef3c7', paid: '#dcfce7', cancelled: '#f1f5f9' };
            const statusText  = statusLabels[inv.status] || inv.status;
            const statusColor = statusColors[inv.status] || '#64748b';
            const statusBg    = statusBgs[inv.status]    || '#f1f5f9';

            const itemsRows = items.map((item, idx) => `
                <tr>
                    <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;color:#94a3b8">${idx + 1}</td>
                    <td style="padding:8px 10px;border:1px solid #e2e8f0;font-weight:600">${esc(item.product_name)}</td>
                    <td style="padding:8px 10px;border:1px solid #e2e8f0;color:#64748b">${esc(item.size_name || '-')}</td>
                    <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;font-family:monospace">${item.quantity}</td>
                    <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:left;font-family:monospace">${fmt(item.unit_cost || item.unit_price)}</td>
                    <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:left;font-family:monospace;font-weight:700;color:#15803d">${fmt(item.total_cost || item.line_total)}</td>
                </tr>`).join('');

            const remaining = parseFloat(inv.grand_total || 0) - parseFloat(inv.paid_amount || 0);

            const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>فاتورة مشتريات #${inv.invoice_number}</title>
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
      <div style="font-size:26px;font-weight:900;color:#7c3aed">G.PACK</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px">فاتورة مشتريات</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">Purchase Invoice</div>
    </div>
    <div style="text-align:left">
      <div style="font-size:32px;font-weight:900;color:#7c3aed;font-family:monospace">#${inv.invoice_number}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px">${new Date(inv.invoice_date).toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'})}</div>
      <div style="margin-top:6px;display:inline-block;background:${statusBg};color:${statusColor};padding:3px 10px;border-radius:4px;font-size:12px;font-weight:700">${statusText}</div>
      <div style="margin-top:4px;display:inline-block;background:${inv.has_supplier_invoice !== false ? '#dcfce7' : '#fef3c7'};color:${inv.has_supplier_invoice !== false ? '#15803d' : '#d97706'};padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;margin-right:4px">${inv.has_supplier_invoice !== false ? '✓ بفاتورة مورد' : '⚠ بدون فاتورة'}</div>
    </div>
  </div>
  <hr style="border:none;border-top:2px solid #e2e8f0;margin-bottom:20px">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px">
    <div>
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">بيانات المورد</div>
      <div style="font-weight:700;font-size:16px">${esc(inv.supplier_name || '---')}</div>
      ${inv.supplier_phone ? `<div style="color:#64748b;font-size:12px;margin-top:3px">${esc(inv.supplier_phone)}</div>` : ''}
      ${inv.supplier_city  ? `<div style="color:#94a3b8;font-size:11px;margin-top:2px">${esc(inv.supplier_city)}</div>` : ''}
    </div>
    <div style="text-align:left">
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">تفاصيل الفاتورة</div>
      ${inv.due_date             ? `<div style="font-size:12px;color:#475569;margin-bottom:2px">تاريخ الاستحقاق: <strong>${new Date(inv.due_date).toLocaleDateString('ar-SA-u-nu-latn')}</strong></div>` : ''}
      ${inv.supplier_invoice_ref ? `<div style="font-size:12px;color:#475569;margin-bottom:2px">مرجع المورد: <strong>${esc(inv.supplier_invoice_ref)}</strong></div>` : ''}
      ${inv.mo_number            ? `<div style="font-size:12px;color:#475569">أمر تصنيع: <strong>#${inv.mo_number}</strong></div>` : ''}
    </div>
  </div>
  <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">الأصناف</div>
  <table style="width:100%;border-collapse:collapse">
    <thead>
      <tr style="background:#f8fafc">
        <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;font-size:11px">#</th>
        <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;font-size:11px">المنتج</th>
        <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;font-size:11px">المقاس</th>
        <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;font-size:11px">الكمية</th>
        <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:left;font-size:11px">سعر الوحدة</th>
        <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:left;font-size:11px">الإجمالي</th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
  </table>
  <div style="display:flex;justify-content:flex-end;margin-top:20px">
    <div style="width:280px">
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
        <span style="color:#64748b">المجموع الفرعي</span>
        <span style="font-family:monospace;font-weight:600">${fmt(inv.subtotal)} ريال</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
        <span style="color:#64748b">الضريبة (${Math.round((parseFloat(inv.tax_rate)||0)*100)}%)</span>
        <span style="font-family:monospace;font-weight:600">${fmt(inv.tax_amount)} ريال</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:16px;font-weight:900;border-top:2px solid #e2e8f0;margin-top:4px">
        <span>الإجمالي النهائي</span>
        <span style="color:#7c3aed;font-family:monospace">${fmt(inv.grand_total)} ريال</span>
      </div>
      ${parseFloat(inv.paid_amount) > 0 ? `
      <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:13px">
        <span style="color:#2563eb">المدفوع</span>
        <span style="font-family:monospace;color:#2563eb;font-weight:600">${fmt(inv.paid_amount)} ريال</span>
      </div>` : ''}
      ${remaining > 0.01 ? `
      <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:13px;font-weight:700">
        <span style="color:#dc2626">المتبقي</span>
        <span style="font-family:monospace;color:#dc2626">${fmt(remaining)} ريال</span>
      </div>` : ''}
    </div>
  </div>
  ${inv.notes ? `<div style="margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;padding:10px 14px;border-radius:6px;font-size:12px;color:#475569">ملاحظات: ${esc(inv.notes)}</div>` : ''}
  <div style="margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:48px;text-align:center">
    <div style="border-top:1px solid #cbd5e1;padding-top:8px;font-size:11px;color:#64748b">توقيع المورد</div>
    <div style="border-top:1px solid #cbd5e1;padding-top:8px;font-size:11px;color:#64748b">توقيع المحاسب</div>
  </div>
  <div style="margin-top:20px;text-align:center;font-size:10px;color:#94a3b8;border-top:1px dashed #cbd5e1;padding-top:12px">
    بواسطة: ${esc(inv.created_by_name || 'النظام')} &nbsp;|&nbsp; تاريخ الطباعة: ${new Date().toLocaleDateString('ar-SA-u-nu-latn')} &nbsp;|&nbsp; G.PACK ERP 2.0
  </div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>
</body></html>`;

            const w = window.open('', '_blank', 'width=900,height=700');
            w.document.write(html);
            w.document.close();

        } catch (err) {
            alert('فشل تحميل الفاتورة: ' + err.message);
        }
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    async function _init() {
        await _loadInvoices(0);
    }

    _init();

})();
