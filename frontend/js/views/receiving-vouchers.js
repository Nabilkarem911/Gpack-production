// =============================================================================
// G.PACK 2.0 — Receiving Vouchers (استلام البضاعة)
// Purpose: عرض أوامر التشغيل الفعّالة، استلام البضاعة، أرشيف الجلسات، التراجع
// =============================================================================
(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────
    let _pendingMOs     = [];   // أوامر التشغيل status=ordered|partial
    let _warehouses     = [];
    let _currentGrouped = null; // الأمر المختار في modal الاستلام
    let _historyMO      = null; // الأمر المختار في modal الأرشيف
    let _activeSearchQuery = '';
    let _archiveSessionsCache = [];

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────
    const _el  = id => document.getElementById(id);
    const esc  = t  => String(t ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const fmtD = d  => d ? new Date(d).toLocaleDateString('ar-SA-u-nu-latn') : '—';
    const _norm = v => String(v ?? '').toLowerCase();

    function showEl(id)  { const e = _el(id); if(e) { e.style.display=''; e.classList.remove('hidden'); } }
    function hideEl(id)  { const e = _el(id); if(e) { e.classList.add('hidden'); } }

    function openModal(id) {
        const m = _el(id);
        if (!m) return;
        m.style.display = 'flex';
        requestAnimationFrame(() => { m.style.opacity = '1'; });
    }
    function closeModal(id) {
        const m = _el(id);
        if (!m) return;
        m.style.opacity = '0';
        setTimeout(() => { m.style.display = 'none'; }, 200);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tab Switching
    // ─────────────────────────────────────────────────────────────────────────
    window.rvSwitchTab = function (tab) {
        const isActive  = tab === 'active';
        const tabActive  = _el('rv-tab-active');
        const tabArchive = _el('rv-tab-archive');
        const secActive  = _el('rv-section-active');
        const secArchive = _el('rv-section-archive');

        const activeClass   = ['border-brand-600', 'text-brand-600'];
        const inactiveClass = ['border-transparent', 'text-slate-400', 'hover:text-slate-600'];

        if (isActive) {
            tabActive.classList.add(...activeClass);
            tabActive.classList.remove(...inactiveClass);
            tabArchive.classList.remove(...activeClass);
            tabArchive.classList.add(...inactiveClass);
            secActive.classList.remove('hidden');
            secArchive.classList.add('hidden');
        } else {
            tabArchive.classList.add(...activeClass);
            tabArchive.classList.remove(...inactiveClass);
            tabActive.classList.remove(...activeClass);
            tabActive.classList.add(...inactiveClass);
            secArchive.classList.remove('hidden');
            secActive.classList.add('hidden');
            window.rvLoadArchive();
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Init
    // ─────────────────────────────────────────────────────────────────────────
    window.rvInit = async function () {
        var _myToken = window.getCurrentNavToken ? window.getCurrentNavToken() : 0;
        hideEl('rv-mo-grid');
        hideEl('rv-empty');
        showEl('rv-loading');

        try {
            const [mosRes, whRes] = await Promise.all([
                window.apiFetch('/api/manufacturer-orders?status=ordered,sent,partially_received&limit=500'),
                window.apiFetch('/api/inventory/warehouses?limit=200')
            ]);
            if (window.isViewActive && !window.isViewActive(_myToken)) return;
            _pendingMOs = mosRes.data || [];
            _warehouses = whRes.data || [];
        } catch (e) {
            if (window.isViewActive && !window.isViewActive(_myToken)) return;
            window.showToast('فشل تحميل البيانات', 'error');
            hideEl('rv-loading');
            return;
        }

        hideEl('rv-loading');
        rvRenderStats();
        rvRenderGrid();
        // Update badge
        const badge = _el('rv-tab-active-badge');
        if (badge) {
            const count = _pendingMOs.length;
            badge.textContent = count;
            count > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
        }

        // ── Deep link: open the requested receipt or receipt session ─────────
        // ?mo=<manufacturer_order_id>&session=<receipt_session_id> is used by
        // receipt notifications. Completed MOs are not in _pendingMOs, so a
        // completed receipt is resolved through the archive endpoint instead.
        try {
            const hash = window.location.hash || '';
            const params = new URLSearchParams(hash.split('?')[1] || '');
            const moId = params.get('mo');
            const sessionId = params.get('session');
            if (moId) {
                const activeGrouped = rvGroupByOrder();
                const activeMatch = activeGrouped.find(g =>
                    g.order_id === moId || g.mos.some(m => m.id === moId)
                );

                if (sessionId) {
                    const moRes = await window.apiFetch('/api/manufacturer-orders/' + encodeURIComponent(moId) + '/receipts');
                    if (window.isViewActive && !window.isViewActive(_myToken)) return;
                    const session = (moRes.data || []).find(s => s.id === sessionId);
                    if (session) {
                        window.rvOpenSessionModal(moId, sessionId);
                    }
                } else if (activeMatch) {
                    window.rvOpenReceiveModal(activeMatch.order_id);
                }
            }
        } catch (e) {
            // Deep link is best-effort; never break the page if it fails.
            console.warn('[ReceivingVouchers] Deep link error:', e.message);
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Stats
    // ─────────────────────────────────────────────────────────────────────────
    function rvRenderStats() {
        const ordered  = _pendingMOs.filter(m => ['ordered','sent'].includes(m.status)).length;
        const partial  = _pendingMOs.filter(m => m.status === 'partially_received').length;
        const items    = _pendingMOs.reduce((s, m) => s + (m.items || []).length, 0);
        _el('rv-stat-active').textContent    = ordered;
        _el('rv-stat-partial').textContent   = partial;
        _el('rv-stat-items').textContent     = items;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Grid
    // ─────────────────────────────────────────────────────────────────────────
    function rvGroupByOrder() {
        const byOrder = {};
        for (const mo of _pendingMOs) {
            const key = mo.order_id || mo.id;
            if (!byOrder[key]) {
                byOrder[key] = {
                    order_id:     mo.order_id || mo.id,
                    order_number: mo.order_number || '—',
                    client_name:  mo.client_name || '—',
                    mos:          [],
                    allItems:     []
                };
            }
            byOrder[key].mos.push(mo);
            byOrder[key].allItems.push(...(mo.items || []));
        }
        return Object.values(byOrder);
    }

    function rvRenderGrid() {
        let grouped = rvGroupByOrder();
        const grid    = _el('rv-mo-grid');

        if (_activeSearchQuery) {
            const q = _activeSearchQuery;
            grouped = grouped.filter(order => {
                const clientMatch  = _norm(order.client_name).includes(q);
                const orderMatch   = _norm(order.order_number).includes(q);
                const moMatch      = order.mos.some(mo =>
                    _norm(mo.mo_number).includes(q) ||
                    _norm(mo.supplier_name).includes(q)
                );
                const productMatch = order.allItems.some(i =>
                    _norm(i.product_name).includes(q) ||
                    _norm(i.size_name).includes(q)
                );
                return clientMatch || orderMatch || moMatch || productMatch;
            });
        }

        if (!grouped.length) {
            hideEl('rv-mo-grid');
            showEl('rv-empty');
            return;
        }

        hideEl('rv-empty');

        grid.innerHTML = grouped.map(order => {
            const preview   = order.allItems.slice(0, 3).map(i => esc(i.product_name || '—')).join('، ');
            const more      = order.allItems.length > 3 ? ` (+${order.allItems.length - 3})` : '';
            const hasPartial = order.mos.some(m => m.status === 'partially_received');
            const statusBadge = hasPartial
                ? '<span class="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-lg font-bold">جزئي الاستلام</span>'
                : '<span class="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-lg font-bold">مرسل للمورد</span>';

            return `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-3">
                <div class="flex justify-between items-start">
                    ${statusBadge}
                    <span class="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-1 rounded">
                        أمر تشغيل #${esc(String(order.order_number))}
                    </span>
                </div>
                <div>
                    <p class="font-bold text-slate-800">${esc(order.client_name)}</p>
                    <p class="text-xs text-slate-500 mt-0.5 font-mono">طلب رقم ${esc(String(order.order_number))}</p>
                    <p class="text-xs text-slate-400 mt-0.5">${order.mos.length} أمر تشغيل للموردين</p>
                </div>
                <div class="bg-slate-50 rounded-xl p-3">
                    <p class="text-xs text-slate-400 mb-1">
                        <i class="fa-solid fa-box ml-1"></i>${order.allItems.length} أصناف
                    </p>
                    <p class="text-xs text-slate-700 font-medium truncate">${preview}${more}</p>
                </div>
                <div class="flex gap-2 mt-auto">
                    <button onclick="window.rvOpenReceiveModal('${order.order_id}')"
                            class="flex-1 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-bold transition-colors">
                        <i class="fa-solid fa-check ml-1"></i>استلام
                    </button>
                </div>
            </div>`;
        }).join('');

        showEl('rv-mo-grid');
    }

    window.rvSearchActive = function () {
        const input = _el('rv-active-search');
        _activeSearchQuery = (input?.value || '').trim().toLowerCase();
        rvRenderGrid();
    };

    window.rvClearActiveSearch = function () {
        const input = _el('rv-active-search');
        if (input) input.value = '';
        _activeSearchQuery = '';
        rvRenderGrid();
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Modal: اعتماد الاستلام
    // ─────────────────────────────────────────────────────────────────────────
    window.rvOpenReceiveModal = function (orderId) {
        const grouped = rvGroupByOrder();
        _currentGrouped = grouped.find(o => o.order_id === orderId);
        if (!_currentGrouped) return;

        _el('rv-receive-subtitle').textContent =
            'تشغيل #' + _currentGrouped.order_number + ' — ' + _currentGrouped.client_name;
        _el('rv-receive-notes').value = '';

        // Populate warehouse dropdown
        const whSel = _el('rv-receive-warehouse');
        whSel.innerHTML = '<option value="">— اختر المستودع —</option>' +
            _warehouses.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
        if (window.makeSelectSearchable && !whSel.dataset.searchable) {
            window.makeSelectSearchable(whSel, '🔍 ابحث عن مستودع...');
        }

        // Build items table
        let html = '';
        let idx  = 0;
        for (const mo of _currentGrouped.mos) {
            for (const item of (mo.items || [])) {
                const moQty  = parseFloat(item.mo_quantity || item.po_quantity || 0);
                const recQty = parseFloat(item.received_qty || 0);
                const remQty = Math.max(0, moQty - recQty);
                const rowCls = remQty === 0 ? 'opacity-40' : '';
                html += `
                <tr class="border-b border-slate-100 hover:bg-slate-50 ${rowCls}">
                    <td class="py-2.5 px-3">
                        <div class="font-medium text-slate-800 text-xs">
                            ${esc(item.product_name || '—')} ${esc(item.size_name || '')}
                        </div>
                    </td>
                    <td class="py-2.5 px-3 text-center font-bold text-xs">${moQty}</td>
                    <td class="py-2.5 px-3 text-center text-emerald-600 text-xs">${recQty}</td>
                    <td class="py-2.5 px-3 text-center text-amber-600 font-bold text-xs">${remQty}</td>
                    <td class="py-2.5 px-3 text-center">
                        <input type="number"
                               data-mo-id="${mo.id}"
                               data-item-id="${item.id}"
                               data-order-item-id="${item.order_item_id || ''}"
                               data-variant-id="${item.variant_id || ''}"
                               data-rem-qty="${remQty}"
                               data-row-idx="${idx}"
                               value="" min="1" max="${remQty}"
                               placeholder="—"
                               ${remQty === 0 ? 'disabled' : ''}
                               oninput="window.rvUpdateRowState(this)"
                               class="w-20 px-2 py-1 border border-slate-200 rounded-lg text-center text-xs focus:border-brand-500 outline-none">
                    </td>
                    <td class="py-2.5 px-3 text-center">
                        <input type="file" accept="image/*" multiple
                               id="rv-receive-photo-${idx}"
                               data-rv-photo
                               data-row-idx="${idx}"
                               ${remQty === 0 ? 'disabled' : ''}
                               onchange="window.rvOnPhotoChange(this)"
                               class="hidden">
                        <button type="button" onclick="document.getElementById('rv-receive-photo-${idx}').click()"
                                class="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:text-brand-600 hover:border-brand-300 transition-all"
                                title="إرفاق صور للصنف">
                            <i class="fa-solid fa-camera text-xs"></i>
                        </button>
                        <span id="rv-receive-photo-count-${idx}" class="block text-[10px] text-slate-400 mt-0.5 hidden">0</span>
                    </td>
                    <td class="py-2.5 px-3 text-center">
                        <input type="checkbox" ${remQty === 0 ? 'disabled' : ''}
                               class="w-4 h-4 text-emerald-500 rounded"
                               title="استلام كلي / إغلاق الأمر"
                               onchange="window.rvToggleFull(this)">
                    </td>
                    <td class="py-2.5 px-3 text-center">
                        <input type="checkbox" data-rv-invoice ${remQty === 0 ? 'disabled' : ''}
                               class="w-4 h-4 text-amber-500 rounded" title="جاية بفاتورة">
                    </td>
                </tr>`;
                idx++;
            }
        }

        _el('rv-receive-items').innerHTML = html ||
            '<tr><td colspan="8" class="py-8 text-center text-slate-400 text-xs">لا توجد أصناف</td></tr>';

        rvUpdateSummary();
        openModal('rv-receive-modal');
    };

    window.rvCloseReceiveModal = function () {
        closeModal('rv-receive-modal');
        _currentGrouped = null;
    };

    // ── استلام كلي / جزئي ──
    window.rvReceiveAll = function () {
        const rows = _el('rv-receive-items').querySelectorAll('tr');
        rows.forEach(row => {
            const qtyInput = row.querySelector('input[type="number"]');
            const fullChk  = row.querySelectorAll('input[type="checkbox"]')[0];
            if (!qtyInput || qtyInput.disabled) return;
            const rem = parseFloat(qtyInput.dataset.remQty || 0);
            qtyInput.value = rem;
            if (fullChk) fullChk.checked = true;
            rvUpdateRowState(qtyInput);
        });
    };

    window.rvReceiveNone = function () {
        const rows = _el('rv-receive-items').querySelectorAll('tr');
        rows.forEach(row => {
            const qtyInput = row.querySelector('input[type="number"]');
            const fullChk  = row.querySelectorAll('input[type="checkbox"]')[0];
            if (!qtyInput || qtyInput.disabled) return;
            qtyInput.value = '';
            if (fullChk) fullChk.checked = false;
            rvUpdateRowState(qtyInput);
        });
    };

    // Full checkbox: means "close this item (accept actual qty as final)"
    // It does NOT change the quantity; it only marks the row for closure.
    window.rvToggleFull = function (chk) {
        const row   = chk.closest('tr');
        const input = row.querySelector('input[type="number"]');
        if (!input || input.disabled) return;
        rvUpdateRowState(input);
    };

    // Update row style based on actual value and full/close checkbox.
    // The checkbox is user-controlled; this function never toggles it.
    window.rvUpdateRowState = function (input) {
        const row   = input.closest('tr');
        const rem   = parseFloat(input.dataset.remQty || 0);
        const val   = parseFloat(input.value || 0);
        const fullChk = row.querySelectorAll('input[type="checkbox"]')[0];
        const isFull = (fullChk && (fullChk.checked || fullChk.disabled)) ||
                       (val >= rem && rem > 0);

        if (isFull) {
            row.classList.remove('bg-amber-50');
            row.classList.add('bg-emerald-50');
        } else if (val > 0) {
            row.classList.remove('bg-emerald-50');
            row.classList.add('bg-amber-50');
        } else {
            row.classList.remove('bg-emerald-50', 'bg-amber-50');
        }
        rvUpdateSummary();
    };

    window.rvOnPhotoChange = function (input) {
        const idx  = input.dataset.rowIdx;
        const cnt  = input.files ? input.files.length : 0;
        const span = _el(`rv-receive-photo-count-${idx}`);
        if (span) {
            span.textContent = cnt;
            span.classList.toggle('hidden', cnt === 0);
        }
    };

    function rvUpdateSummary() {
        const rows = _el('rv-receive-items').querySelectorAll('tr');
        let full = 0, partial = 0, none = 0;
        rows.forEach(row => {
            const input = row.querySelector('input[type="number"]');
            if (!input) return;
            if (input.disabled) { full++; return; }
            const fullChk = row.querySelectorAll('input[type="checkbox"]')[0];
            const rem = parseFloat(input.dataset.remQty || 0);
            const val = parseFloat(input.value || 0);
            const isFull = (fullChk && (fullChk.checked || fullChk.disabled)) ||
                           (val >= rem && rem > 0);
            if (isFull) full++;
            else if (val > 0) partial++;
            else none++;
        });
        const elFull    = _el('rv-sum-full');
        const elPartial = _el('rv-sum-partial');
        const elNone    = _el('rv-sum-none');
        if (elFull)    elFull.textContent    = full;
        if (elPartial) elPartial.textContent = partial;
        if (elNone)    elNone.textContent    = none;
    }

    window.rvConfirmReceiving = async function () {
        const warehouseId = _el('rv-receive-warehouse')?.value;
        if (!warehouseId) { window.showToast('اختر المستودع أولاً', 'error'); return; }

        const notes  = _el('rv-receive-notes')?.value || '';
        const btn    = _el('rv-receive-save-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1.5"></i> جاري...';

        // Collect items grouped by MO
        const rows       = _el('rv-receive-items').querySelectorAll('tr');
        const itemsByMO  = {};
        const moInvoice  = {};
        const moClose    = {}; // close_order per MO

        // First pass: decide close_order per MO (all rows closed/full)
        rows.forEach(row => {
            const qtyInput = row.querySelector('input[type="number"]');
            if (!qtyInput) return;
            const moId = qtyInput.dataset.moId;
            if (!moId) return;
            if (moClose[moId] === undefined) moClose[moId] = true;
            const fullChk = row.querySelectorAll('input[type="checkbox"]')[0];
            const isClosed = fullChk && (fullChk.checked || fullChk.disabled);
            if (!isClosed) moClose[moId] = false;
        });

        rows.forEach(row => {
            const qtyInput = row.querySelector('input[type="number"]');
            const invCheck = row.querySelector('[data-rv-invoice]');
            const photoInput = row.querySelector('[data-rv-photo]');
            if (!qtyInput || qtyInput.disabled) return;

            const qty        = parseFloat(qtyInput.value) || 0;
            const moItemId   = qtyInput.dataset.itemId;
            const oItemId    = qtyInput.dataset.orderItemId;
            const variantId  = qtyInput.dataset.variantId;
            const moId       = qtyInput.dataset.moId;
            const hasInvoice = invCheck?.checked || false;
            const fullChk    = row.querySelectorAll('input[type="checkbox"]')[0];
            const isFinal     = fullChk?.checked || false;
            const files      = photoInput ? Array.from(photoInput.files) : [];

            if (qty > 0 && moItemId && variantId && variantId !== 'undefined' && moId) {
                if (!itemsByMO[moId]) { itemsByMO[moId] = []; moInvoice[moId] = false; }
                const idx = itemsByMO[moId].length;
                itemsByMO[moId].push({
                    manufacturer_order_item_id: moItemId,
                    order_item_id: oItemId || null,
                    variant_id:    variantId,
                    quantity:      qty,
                    is_final:      isFinal,
                    has_supplier_invoice: hasInvoice,
                    _idx:          idx,
                    _files:        files
                });
                if (hasInvoice) moInvoice[moId] = true;
            }
        });

        if (!Object.keys(itemsByMO).length) {
            window.showToast('أدخل كمية واحدة على الأقل', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check ml-1.5"></i> اعتماد الاستلام';
            return;
        }

        try {
            for (const [moId, moItems] of Object.entries(itemsByMO)) {
                const formData = new FormData();
                formData.append('warehouse_id', warehouseId);
                formData.append('has_supplier_invoice', String(moInvoice[moId]));
                formData.append('close_order', String(moClose[moId] === true));
                formData.append('notes', notes);
                formData.append('items', JSON.stringify(moItems.map(({ _idx, _files, ...rest }) => rest)));

                moItems.forEach((it, idx) => {
                    (it._files || []).forEach((f, i) => {
                        formData.append('item_photos', f, `item-${idx}-${i}-${f.name}`);
                    });
                });

                const res = await fetch('/api/manufacturer-orders/' + moId + '/receive', {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || `خطأ في اعتماد الاستلام (${res.status})`);
                }
            }
            window.showToast('تم اعتماد الاستلام بنجاح ✓', 'success');
            window.rvCloseReceiveModal();
            window.rvInit();
        } catch (e) {
            window.showToast(e.message || 'خطأ في الاستلام', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check ml-1.5"></i> اعتماد الاستلام';
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Archive Tab — تحميل وعرض كل جلسات الاستلام
    // ─────────────────────────────────────────────────────────────────────────
    window.rvLoadArchive = async function () {
        const listEl  = _el('rv-archive-list');
        const loadEl  = _el('rv-archive-loading');
        const emptyEl = _el('rv-archive-empty');

        listEl.innerHTML = '';
        showEl('rv-archive-loading');
        hideEl('rv-archive-empty');

        const filterMO      = _el('rv-archive-mo-filter')?.value || '';
        const filterStatus  = _el('rv-archive-status-filter')?.value || '';
        const filterInvoice = _el('rv-archive-invoice-filter')?.value || '';

        try {
            // جيب كل الـ MOs (مش بس active — بما فيها received)
            const allMOsRes = await window.apiFetch('/api/manufacturer-orders?limit=500');
            const allMOs    = allMOsRes.data || [];

            // Populate MO filter (rebuild each time to stay fresh)
            const moSel = _el('rv-archive-mo-filter');
            if (moSel) {
                moSel.innerHTML = '<option value="">كل أوامر التشغيل</option>';
                allMOs.forEach(mo => {
                    const opt = document.createElement('option');
                    opt.value = mo.id;
                    const num = mo.po_number || mo.mo_number || mo.id.slice(0,8);
                    const client = mo.client_name || '—';
                    opt.textContent = num + ' — ' + client;
                    moSel.appendChild(opt);
                });
                if (window.makeSelectSearchable && !moSel.dataset.searchable) {
                    window.makeSelectSearchable(moSel, '🔍 ابحث عن أمر تشغيل...');
                }
            }

            const targetMOs = filterMO ? allMOs.filter(m => m.id === filterMO) : allMOs;

            const allSessions = [];
            for (const mo of targetMOs) {
                const res = await window.apiFetch('/api/manufacturer-orders/' + mo.id + '/receipts');
                (res.data || []).forEach(s => {
                    const lockedStatuses = ['completed', 'archived', 'cancelled'];
                    allSessions.push({
                        ...s,
                        mo_number:     mo.po_number || mo.mo_number || mo.id.slice(0,8),
                        order_number:  mo.order_number || '—',
                        client_name:   mo.client_name || '—',
                        mo_status:     mo.status,
                        order_status:  mo.order_status || '',
                        order_locked:  lockedStatuses.includes(mo.order_status),
                        _moId:         mo.id
                    });
                });
            }

            hideEl('rv-archive-loading');
            _archiveSessionsCache = allSessions;
            rvFilterArchive();
        } catch (e) {
            hideEl('rv-archive-loading');
            listEl.innerHTML = `<p class="text-center text-red-500 text-sm py-8">فشل تحميل الأرشيف: ${esc(e.message)}</p>`;
        }
    };

    function rvFilterArchive() {
        const listEl  = _el('rv-archive-list');
        const emptyEl = _el('rv-archive-empty');
        const filterStatus  = _el('rv-archive-status-filter')?.value || '';
        const filterInvoice = _el('rv-archive-invoice-filter')?.value || '';
        const searchQuery   = (_el('rv-archive-search')?.value || '').trim().toLowerCase();

        let filtered = _archiveSessionsCache;
        if (filterStatus) {
            filtered = filtered.filter(s => s.status === filterStatus);
        }
        if (filterInvoice === 'with') {
            filtered = filtered.filter(s => s.has_supplier_invoice === true);
        } else if (filterInvoice === 'without') {
            filtered = filtered.filter(s => !s.has_supplier_invoice);
        }
        if (searchQuery) {
            filtered = filtered.filter(s =>
                _norm(s.client_name).includes(searchQuery) ||
                _norm(s.order_number).includes(searchQuery) ||
                _norm(s.mo_number).includes(searchQuery) ||
                _norm(s.warehouse_name).includes(searchQuery) ||
                _norm(s.supplier_invoice_ref).includes(searchQuery) ||
                (s.items || []).some(i =>
                    _norm(i.product_name).includes(searchQuery) ||
                    _norm(i.size_name).includes(searchQuery)
                )
            );
        }

        filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        if (!filtered.length) {
            showEl('rv-archive-empty');
            if (listEl) listEl.innerHTML = '';
            return;
        }

        hideEl('rv-archive-empty');

        if (!listEl) return;
        listEl.innerHTML = filtered.map(s => {
            const isReversed = s.status === 'reversed';
            const isLocked   = s.order_locked === true;
            const canReverse = !isReversed && !isLocked;

            const statusBadge = isReversed
                ? '<span class="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-lg font-bold">تم التراجع</span>'
                : isLocked
                    ? '<span class="text-xs px-2 py-0.5 bg-slate-200 text-slate-600 rounded-lg font-bold">طلب مُقفل</span>'
                    : '<span class="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-lg font-bold">فعّال — يمكن التراجع</span>';

            const invoiceBadge = s.has_supplier_invoice
                ? `<span class="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-lg font-bold"><i class="fa-solid fa-file-invoice ml-1"></i>بفاتورة</span>${s.supplier_invoice_ref ? `<span class="text-xs text-slate-500 font-mono">(${esc(s.supplier_invoice_ref)})</span>` : ''}`
                : '<span class="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-lg font-bold"><i class="fa-solid fa-file-circle-xmark ml-1"></i>بدون فاتورة</span>';

            const itemsHtml = (s.items || []).map(i => {
                const photoCount = (i.images || []).length;
                const photoBadge = photoCount > 0
                    ? `<span class="text-brand-600 text-[10px] font-bold" title="${photoCount} صورة"><i class="fa-solid fa-camera ml-0.5"></i>${photoCount}</span>`
                    : '';
                return `<div class="flex justify-between items-center text-xs py-1.5 border-b border-slate-100 last:border-0">
                    <span class="text-slate-700">${esc(i.product_name || '—')} ${esc(i.size_name || '')}</span>
                    <span class="font-bold text-slate-800 flex items-center gap-2">${i.quantity} قطعة ${photoBadge}</span>
                </div>`;
            }).join('');

            return `
            <div class="bg-white border border-slate-200 rounded-2xl p-5 ${isReversed ? 'opacity-60' : ''} shadow-sm">
                <div class="flex flex-wrap justify-between items-start gap-2 mb-3">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap mb-2">
                            ${statusBadge}
                            <span class="text-sm font-black text-slate-800">جلسة #${s.session_number}</span>
                            ${invoiceBadge}
                        </div>
                        <div class="flex items-center gap-2 mb-1">
                            <div class="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center flex-shrink-0">
                                <i class="fa-solid fa-user text-brand-600 text-xs"></i>
                            </div>
                            <p class="text-sm font-bold text-slate-800 truncate">${esc(s.client_name)}</p>
                        </div>
                        <p class="text-xs text-slate-500 mt-1">
                            <i class="fa-solid fa-hashtag ml-0.5"></i> طلب #${esc(String(s.order_number))} • ${esc(s.mo_number)}
                        </p>
                        <p class="text-xs text-slate-400">
                            <i class="fa-solid fa-calendar-day ml-0.5"></i> ${fmtD(s.received_date)} • 
                            <i class="fa-solid fa-warehouse ml-0.5"></i> ${esc(s.warehouse_name || '—')}
                            ${s.created_by_name ? ' • <i class="fa-solid fa-user-pen ml-0.5"></i> ' + esc(s.created_by_name) : ''}
                        </p>
                    </div>
                    <div class="flex flex-col gap-2 flex-shrink-0">
                        <button onclick="window.rvOpenSessionModal('${s._moId}','${s.id}')"
                                class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-brand-600 border border-brand-200 rounded-xl hover:bg-brand-50 transition-colors">
                            <i class="fa-solid fa-eye"></i>عرض
                        </button>
                        ${canReverse
                            ? `<button onclick="window.rvReverseSession('${s._moId}','${s.id}','${s.session_number}')"
                                       class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition-colors">
                               <i class="fa-solid fa-rotate-left"></i>تراجع
                           </button>`
                            : isLocked
                                ? `<span class="text-xs text-slate-500 text-center">ممنوع — <strong>${esc(s.order_status)}</strong></span>`
                                : ''}
                    </div>
                </div>
                ${itemsHtml
                    ? `<div class="bg-slate-50 rounded-xl px-3 py-1">${itemsHtml}</div>`
                    : ''}
                ${isReversed && s.reversed_at
                    ? `<p class="text-xs text-red-400 mt-2"><i class="fa-solid fa-rotate-left ml-1"></i>تم التراجع: ${fmtD(s.reversed_at)}${s.reversed_by_name ? ' — ' + esc(s.reversed_by_name) : ''}</p>`
                    : ''}
            </div>`;
        }).join('');
    }

    window.rvSearchArchive = function () {
        if (!_archiveSessionsCache.length) {
            window.rvLoadArchive();
        } else {
            rvFilterArchive();
        }
    };

    let _currentSession = null;

    window.rvOpenSessionModal = async function (moId, sessionId) {
        const modal = _el('rv-session-modal');
        const body  = _el('rv-session-body');
        const sub   = _el('rv-session-subtitle');
        if (!modal || !body) return;

        body.innerHTML = '<div class="py-12 text-center"><i class="fa-solid fa-circle-notch fa-spin text-brand-500 text-xl mb-2"></i><p class="text-slate-400 text-sm">جاري التحميل...</p></div>';
        openModal('rv-session-modal');

        try {
            const res = await window.apiFetch('/api/manufacturer-orders/' + moId + '/receipts');
            const session = (res.data || []).find(s => s.id === sessionId);
            if (!session) {
                body.innerHTML = '<p class="text-center text-red-500 text-sm py-8">لم يتم العثور على الجلسة</p>';
                return;
            }
            _currentSession = { ...session, _moId: moId };

            sub.textContent = 'جلسة #' + (session.session_number || '—') + ' — ' + (session.warehouse_name || '—');

            const isReversed = session.status === 'reversed';
            const completionStatus = session.receipt_completion_status || (session.mo_status === 'received' ? 'full' : 'partial');
            const completionBadge = completionStatus === 'full'
                ? '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-600">استلام كلي</span>'
                : '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-600">استلام جزئي</span>';
            const itemsHtml = (session.items || []).map(i => {
                const images = (i.images || []).map(img =>
                    `<a href="${esc(img.image_path)}" target="_blank" class="inline-block w-9 h-9 rounded-lg border border-slate-200 overflow-hidden hover:opacity-90" title="عرض الصورة">
                        <img src="${esc(img.image_path)}" class="w-full h-full object-cover" alt="" />
                    </a>`
                ).join('');
                const itemStatus = i.item_completion_status === 'full'
                    ? '<span class="inline-flex px-2 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-600">كلي</span>'
                    : '<span class="inline-flex px-2 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-600">جزئي</span>';
                return `<tr class="border-b border-slate-100">
                    <td class="py-2.5 px-3 text-xs font-medium text-slate-700">${esc(i.product_name || '—')} ${esc(i.size_name || '')}</td>
                    <td class="py-2.5 px-3 text-center text-xs font-bold text-slate-800">${i.quantity}</td>
                    <td class="py-2.5 px-3 text-center">${itemStatus}</td>
                    <td class="py-2.5 px-3 text-center text-xs ${i.has_supplier_invoice ? 'text-blue-600 font-bold' : 'text-slate-400'}">
                        ${i.has_supplier_invoice ? '<i class="fa-solid fa-file-invoice"></i> نعم' : '—'}
                    </td>
                    <td class="py-2.5 px-3 text-center">
                        ${images ? `<div class="flex items-center justify-center gap-1 flex-wrap">${images}</div>` : '—'}
                    </td>
                </tr>`;
            }).join('');

            body.innerHTML = `
                <div class="grid grid-cols-2 gap-3 bg-slate-50 rounded-xl p-4">
                    <div>
                        <span class="text-xs text-slate-400 block mb-0.5"><i class="fa-solid fa-user ml-1"></i>العميل</span>
                        <p class="text-sm font-bold text-slate-800">${esc(session.client_name || '—')}</p>
                    </div>
                    <div>
                        <span class="text-xs text-slate-400 block mb-0.5"><i class="fa-solid fa-warehouse ml-1"></i>المستودع</span>
                        <p class="text-sm font-bold text-slate-800">${esc(session.warehouse_name || '—')}</p>
                    </div>
                    <div>
                        <span class="text-xs text-slate-400 block mb-0.5"><i class="fa-solid fa-calendar-day ml-1"></i>تاريخ الاستلام</span>
                        <p class="text-sm font-bold text-slate-800">${fmtD(session.received_date)}</p>
                    </div>
                    <div>
                        <span class="text-xs text-slate-400 block mb-0.5"><i class="fa-solid fa-circle-info ml-1"></i>الحالة</span>
                        ${isReversed
                            ? '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-600">تم التراجع</span>'
                            : completionBadge}
                    </div>
                    <div>
                        <span class="text-xs text-slate-400 block mb-0.5"><i class="fa-solid fa-hashtag ml-1"></i>أمر التشغيل</span>
                        <p class="text-sm font-bold text-slate-800 font-mono">${esc(session.mo_number || '—')}</p>
                        <p class="text-xs text-slate-500 mt-0.5">رقم الطلب: ${esc(session.order_number || '—')}</p>
                    </div>
                    <div>
                        <span class="text-xs text-slate-400 block mb-0.5"><i class="fa-solid fa-file-invoice ml-1"></i>فاتورة المورد</span>
                        <p class="text-sm font-bold text-slate-800">${session.has_supplier_invoice ? (esc(session.supplier_invoice_ref) || 'نعم') : 'بدون'}</p>
                    </div>
                    ${session.notes ? `<div class="col-span-2"><span class="text-xs text-slate-400 block mb-0.5"><i class="fa-solid fa-sticky-note ml-1"></i>ملاحظات</span><p class="text-sm text-slate-700">${esc(session.notes)}</p></div>` : ''}
                    ${session.created_by_name ? `<div><span class="text-xs text-slate-400 block mb-0.5"><i class="fa-solid fa-user-pen ml-1"></i>استلم بواسطة</span><p class="text-sm font-bold text-slate-800">${esc(session.created_by_name)}</p></div>` : ''}
                </div>

                <div>
                    <h4 class="text-sm font-bold text-slate-700 mb-2"><i class="fa-solid fa-boxes-stacked ml-1"></i>الأصناف المستلمة</h4>
                    <div class="border border-slate-200 rounded-xl overflow-hidden">
                        <table class="w-full text-sm">
                            <thead class="bg-slate-50 text-xs text-slate-500">
                                <tr>
                                    <th class="py-2 px-3 text-right">المنتج</th>
                                    <th class="py-2 px-3 text-center">الكمية</th>
                                    <th class="py-2 px-3 text-center">الحالة</th>
                                    <th class="py-2 px-3 text-center">فاتورة</th>
                                    <th class="py-2 px-3 text-center">صور</th>
                                </tr>
                            </thead>
                            <tbody>${itemsHtml || '<tr><td colspan="5" class="py-6 text-center text-slate-400 text-xs">لا توجد أصناف</td></tr>'}</tbody>
                        </table>
                    </div>
                </div>

                ${isReversed && session.reversed_at ? `
                    <div class="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2">
                        <i class="fa-solid fa-rotate-left text-red-500"></i>
                        <div>
                            <p class="text-xs font-bold text-red-600">تم التراجع عن هذه الجلسة</p>
                            <p class="text-xs text-red-400">${fmtD(session.reversed_at)}${session.reversed_by_name ? ' — ' + esc(session.reversed_by_name) : ''}</p>
                        </div>
                    </div>
                ` : ''}
            `;
        } catch (e) {
            body.innerHTML = '<p class="text-center text-red-500 text-sm py-8">فشل تحميل التفاصيل: ' + esc(e.message) + '</p>';
        }
    };

    window.rvCloseSessionModal = function () {
        closeModal('rv-session-modal');
        _currentSession = null;
    };

    window.rvPrintSession = function () {
        if (!_currentSession) return;
        const s = _currentSession;
        const items = (s.items || []).map(i => {
            const photoCount = (i.images || []).length;
            return `<tr>
                <td style="padding:8px;border:1px solid #ddd;font-size:12px;">${esc(i.product_name || '—')} ${esc(i.size_name || '')}</td>
                <td style="padding:8px;border:1px solid #ddd;text-align:center;font-size:12px;font-weight:bold;">${i.quantity}</td>
                <td style="padding:8px;border:1px solid #ddd;text-align:center;font-size:12px;">${i.has_supplier_invoice ? 'نعم' : '—'}</td>
                <td style="padding:8px;border:1px solid #ddd;text-align:center;font-size:12px;">${photoCount > 0 ? photoCount + ' صورة' : '—'}</td>
            </tr>`;
        }).join('');

        const w = window.open('', '_blank', 'width=800,height=600');
        w.document.write(`
            <html dir="rtl"><head><title>سند استلام #${s.session_number || ''}</title>
            <style>body{font-family:Arial,sans-serif;padding:30px;color:#1e293b;}h1{font-size:20px;margin:0 0 5px;}table{width:100%;border-collapse:collapse;margin-top:15px;}.info{display:flex;gap:30px;margin:15px 0;flex-wrap:wrap;}.info div{font-size:13px;}.info b{display:block;color:#64748b;font-size:11px;margin-bottom:2px;}</style>
            </head><body>
                <h1>سند استلام #${s.session_number || ''}</h1>
                <p style="color:#64748b;font-size:13px;">G.PACK 2.0 — سند استلام بضاعة</p>
                <hr style="margin:15px 0;">
                <div class="info">
                    <div><b>العميل</b>${esc(s.client_name || '—')}</div>
                    <div><b>المستودع</b>${esc(s.warehouse_name || '—')}</div>
                    <div><b>التاريخ</b>${fmtD(s.received_date)}</div>
                    <div><b>أمر التشغيل</b>${esc(s.mo_number || '—')}</div>
                    <div><b>فاتورة المورد</b>${s.has_supplier_invoice ? (esc(s.supplier_invoice_ref) || 'نعم') : 'بدون'}</div>
                    <div><b>استلم بواسطة</b>${esc(s.created_by_name || '—')}</div>
                </div>
                ${s.notes ? `<p style="font-size:13px;margin:10px 0;"><b>ملاحظات:</b> ${esc(s.notes)}</p>` : ''}
                <table>
                    <thead><tr style="background:#f1f5f9;">
                        <th style="padding:8px;border:1px solid #ddd;font-size:12px;text-align:right;">المنتج</th>
                        <th style="padding:8px;border:1px solid #ddd;font-size:12px;text-align:center;">الكمية</th>
                        <th style="padding:8px;border:1px solid #ddd;font-size:12px;text-align:center;">فاتورة</th>
                        <th style="padding:8px;border:1px solid #ddd;font-size:12px;text-align:center;">صور</th>
                    </tr></thead>
                    <tbody>${items || '<tr><td colspan=\"4\" style=\"padding:15px;text-align:center;color:#999;\">لا توجد أصناف</td></tr>'}</tbody>
                </table>
                <p style="margin-top:30px;font-size:11px;color:#94a3b8;text-align:center;">تم إنشاء هذا السند بواسطة نظام G.PACK 2.0</p>
            </body></html>`
        );
        w.document.close();
        w.print();
    };

    window.rvReverseSession = async function (moId, sessionId, sessionNum) {
        if (!confirm(`تأكيد التراجع عن الجلسة #${sessionNum}؟\nسيتم عكس حركات المخزون والقيود المحاسبية.`)) return;

        try {
            await window.apiFetch('/api/manufacturer-orders/' + moId + '/receipts/' + sessionId, {
                method: 'DELETE'
            });
            window.showToast('تم التراجع عن الجلسة بنجاح ✓', 'success');
            window.rvLoadArchive();
            window.rvInit();
        } catch (e) {
            window.showToast(e.message || 'فشل التراجع', 'error');
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Bootstrap
    // ─────────────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window.rvInit);
    } else {
        window.rvInit();
    }
})();

// ── EOF ──────────────────────────────────────────────────────────────────────
// NOTE: old code below intentionally commented out
/*        const filters = rvBuildFilters();
        try {
            const res = await window.apiFetch(`/api/receiving-vouchers?limit=${_limit}&offset=${_page * _limit}&${filters}`);
            _data = res.data || [];
            rvRenderList(res.total || 0);
        } catch (e) {
            window.showToast('فشل تحميل البيانات', 'error');
        } finally {
            _el('rv-loading').style.display = 'none';
        }
    };

    function rvBuildFilters() {
        const q = [];
        const s = _el('rv-search')?.value?.trim();
        const sup = _el('rv-supplier-filter')?.value;
        const df = _el('rv-date-from')?.value;
        const dt = _el('rv-date-to')?.value;
        if (s) q.push(`search=${encodeURIComponent(s)}`);
        if (sup) q.push(`supplier_id=${encodeURIComponent(sup)}`);
        if (df) q.push(`date_from=${encodeURIComponent(df)}`);
        if (dt) q.push(`date_to=${encodeURIComponent(dt)}`);
        return q.join('&');
    }

    function rvRenderList(total) {
        // Stats
        const totalAmount = _data.reduce((s, r) => s + (parseFloat(r.total_amount) || 0), 0);
        _el('rv-stat-count').textContent = total;
        _el('rv-stat-amount').textContent = fmt(totalAmount);
        _el('rv-stat-avg').textContent = fmt(total ? totalAmount / total : 0);

        if (!_data.length) {
            _el('rv-empty').classList.remove('hidden');
            return;
        }

        const tbody = _el('rv-tbody');
        tbody.innerHTML = _data.map(r => `
            <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td class="py-3 px-4">
                    <div class="flex items-center gap-2">
                        <span class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-xs">RV</span>
                        <span class="font-mono font-bold text-slate-700">#${r.voucher_number}</span>
                    </div>
                </td>
                <td class="py-3 px-4 text-xs text-slate-600">${new Date(r.receiving_date).toLocaleDateString('ar-SA-u-nu-latn')}</td>
                <td class="py-3 px-4">
                    <span class="text-xs font-medium text-slate-700">${esc(r.supplier_name || '—')}</span>
                </td>
                <td class="py-3 px-4 hidden sm:table-cell text-xs text-slate-500 font-mono">${r.purchase_invoice_number ? '#' + r.purchase_invoice_number : '—'}</td>
                <td class="py-3 px-4 hidden sm:table-cell text-xs text-slate-500">${r.mo_number ? '#' + r.mo_number : '—'}</td>
                <td class="py-3 px-4">
                    <span class="text-sm font-bold font-mono text-emerald-600">${fmt(r.total_amount)}</span>
                </td>
                <td class="py-3 px-4">
                    ${r.status === 'voided'
                        ? '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-600">ملغي</span>'
                        : '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-600">مكتمل</span>'}
                </td>
                <td class="py-3 px-4 text-center">
                    <button onclick="window.rvOpenDetail('${r.id}')"
                            class="w-8 h-8 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors mx-auto">
                        <i class="fa-solid fa-eye text-sm"></i>
                    </button>
                </td>
            </tr>
        `).join('');

        _el('rv-table-wrap').classList.remove('hidden');

        // Pagination
        const start = _page * _limit + 1;
        const end   = Math.min(start + _limit - 1, total);
        _el('rv-page-info').textContent = `عرض ${start}-${end} من ${total}`;
        _el('rv-prev-btn').disabled = _page === 0;
        _el('rv-next-btn').disabled = end >= total;
        _el('rv-pagination').classList.remove('hidden');
    }

    window.rvSearch = function () { _page = 0; rvRefresh(); };
    window.rvPrevPage = function () { if (_page > 0) { _page--; rvRefresh(); } };
    window.rvNextPage = function () { _page++; rvRefresh(); };

    // ─────────────────────────────────────────────────────────────────────────
    // Tabs System
    // ─────────────────────────────────────────────────────────────────────────
    let _activeTab = 'vouchers';

    window.rvSwitchTab = function (tab) {
        _activeTab = tab;

        const tabVouchers = _el('rv-tab-vouchers');
        const tabMOs      = _el('rv-tab-mos');
        const secVouchers = _el('rv-section-vouchers');
        const secMOs      = _el('rv-section-mos');
        const newBtn      = _el('rv-new-btn');

        if (tab === 'vouchers') {
            tabVouchers.className = 'flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition-all bg-white text-brand-700 shadow-sm';
            tabMOs.className      = 'flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition-all text-slate-500 hover:text-slate-700';
            secVouchers.classList.remove('hidden');
            secMOs.classList.add('hidden');
            if (newBtn) { newBtn.style.display = 'flex'; }
        } else {
            tabMOs.className      = 'flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition-all bg-white text-amber-700 shadow-sm';
            tabVouchers.className = 'flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition-all text-slate-500 hover:text-slate-700';
            secMOs.classList.remove('hidden');
            secVouchers.classList.add('hidden');
            if (newBtn) { newBtn.style.display = 'none'; }
            rvLoadMOsTab();
        }
    };

    window.rvRefreshCurrent = function () {
        if (_activeTab === 'vouchers') rvRefresh();
        else rvLoadMOsTab();
    };

    // ─────────────────────────────────────────────────────────────────────────
    // TAB 2: أوامر التشغيل
    // ─────────────────────────────────────────────────────────────────────────
    let _pendingMOs     = [];
    let _currentGrouped = null;

    async function rvLoadMOsTab() {
        _el('rv-mo-loading').style.display = 'block';
        _el('rv-mo-grid').classList.add('hidden');
        _el('rv-mo-empty').classList.add('hidden');

        try {
            const res = await window.apiFetch('/api/manufacturer-orders?status=ordered,partial&limit=500');
            _pendingMOs = res.data || [];
            rvRenderMOs();
        } catch (e) {
            window.showToast('فشل تحميل أوامر التشغيل', 'error');
        } finally {
            _el('rv-mo-loading').style.display = 'none';
        }
    }

    function rvGroupMOsByOrder() {
        const byOrder = {};
        for (const mo of _pendingMOs) {
            const key = mo.order_id || mo.id;
            if (!byOrder[key]) {
                byOrder[key] = {
                    order_id:    mo.order_id || mo.id,
                    order_number: mo.order_number || mo.po_number,
                    client_name: mo.client_name || '—',
                    mos:         [],
                    allItems:    []
                };
            }
            byOrder[key].mos.push(mo);
            byOrder[key].allItems.push(...(mo.items || []));
        }
        return Object.values(byOrder);
    }

    function rvRenderMOs() {
        const grouped = rvGroupMOsByOrder();

        // Stats
        const totalItems     = grouped.reduce((s, g) => s + g.allItems.length, 0);
        const uniqueSuppliers = new Set(_pendingMOs.map(m => m.supplier_id).filter(Boolean)).size;
        _el('rv-mo-stat-count').textContent     = grouped.length;
        _el('rv-mo-stat-items').textContent     = totalItems;
        _el('rv-mo-stat-suppliers').textContent = uniqueSuppliers;

        // Badge on tab
        const badge = _el('rv-mo-badge');
        badge.textContent = grouped.length;
        badge.classList.toggle('hidden', !grouped.length);

        if (!grouped.length) {
            _el('rv-mo-empty').classList.remove('hidden');
            return;
        }

        const grid = _el('rv-mo-grid');
        grid.innerHTML = grouped.map(order => {
            const preview  = order.allItems.slice(0, 3).map(i => esc(i.product_name || '—')).join('، ');
            const more     = order.allItems.length > 3 ? ` (+${order.allItems.length - 3})` : '';
            const suppliers = [...new Set(order.mos.map(m => m.supplier_name).filter(Boolean))];
            return `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow p-5">
                <div class="flex justify-between items-start mb-3">
                    <span class="text-xs px-2.5 py-1 bg-amber-100 text-amber-700 rounded-lg font-bold">مرسل للمورد</span>
                    <span class="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-1 rounded">أمر تشغيل #${esc(String(order.order_number || '—'))}</span>
                </div>
                <div class="mb-3">
                    <p class="font-bold text-slate-800 text-base">${esc(order.client_name)}</p>
                    <p class="text-xs text-slate-400 mt-0.5">${order.mos.length} طلبات للموردين</p>
                </div>
                <div class="bg-slate-50 rounded-xl p-3 mb-4">
                    <p class="text-xs text-slate-400 mb-1"><i class="fa-solid fa-box ml-1"></i>${order.allItems.length} أصناف:</p>
                    <p class="text-xs text-slate-700 font-medium truncate">${preview}${more}</p>
                    ${suppliers.length ? `<p class="text-xs text-amber-600 mt-1 font-medium">مورد: ${suppliers.map(s => esc(s)).join(' • ')}</p>` : ''}
                </div>
                <button onclick="window.rvOpenMOModal('${order.order_id}')"
                        class="w-full py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl text-sm font-bold transition-colors">
                    <i class="fa-solid fa-check ml-1"></i>اعتماد الاستلام
                </button>
            </div>`;
        }).join('');

        grid.classList.remove('hidden');
    }

    window.rvOpenMOModal = function (orderId) {
        const grouped = rvGroupMOsByOrder();
        _currentGrouped = grouped.find(o => o.order_id === orderId);
        if (!_currentGrouped) return;

        _el('rv-mo-modal-subtitle').textContent =
            'تشغيل #' + (_currentGrouped.order_number || '—') + ' — ' + _currentGrouped.client_name;

        // Populate warehouse dropdown
        const whSel = _el('rv-mo-modal-warehouse');
        whSel.innerHTML = '<option value="">— اختر المستودع —</option>' +
            _warehouses.map(w => `<option value="${w.id}">${esc(w.name)} ${w.is_main ? '(رئيسي)' : ''}</option>`).join('');

        // Build items table
        let html = '';
        let idx  = 0;
        for (const mo of _currentGrouped.mos) {
            for (const item of (mo.items || [])) {
                const moQty  = parseFloat(item.mo_quantity || item.po_quantity || 0);
                const recQty = parseFloat(item.received_qty || 0);
                const remQty = Math.max(0, moQty - recQty);
                html += `
                <tr class="border-b border-slate-100 hover:bg-slate-50">
                    <td class="py-2.5 px-3">
                        <div class="font-medium text-slate-800 text-xs">${esc(item.product_name || '—')} ${esc(item.size_name || '')}</div>
                        <div class="text-xs text-amber-600 font-medium mt-0.5">${esc(mo.supplier_name || '—')}</div>
                    </td>
                    <td class="py-2.5 px-3 text-center font-bold text-xs">${moQty}</td>
                    <td class="py-2.5 px-3 text-center text-emerald-600 text-xs">${recQty}</td>
                    <td class="py-2.5 px-3 text-center text-amber-600 font-bold text-xs">${remQty}</td>
                    <td class="py-2.5 px-3 text-center">
                        <input type="number"
                               id="rv-mo-qty-${idx}"
                               data-mo-id="${mo.id}"
                               data-item-id="${item.id}"
                               data-order-item-id="${item.order_item_id || ''}"
                               data-variant-id="${item.variant_id || ''}"
                               data-row-idx="${idx}"
                               value="" min="1" max="${remQty}"
                               placeholder="—"
                               class="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-center text-xs focus:border-brand-500 outline-none">
                    </td>
                    <td class="py-2.5 px-3 text-center">
                        <input type="file" accept="image/*" multiple
                               id="rv-mo-photo-${idx}"
                               data-rv-photo
                               data-row-idx="${idx}"
                               onchange="window.rvOnPhotoChange(this)"
                               class="hidden">
                        <button type="button" onclick="document.getElementById('rv-mo-photo-${idx}').click()"
                                class="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:text-brand-600 hover:border-brand-300 transition-all"
                                title="إرفاق صور للصنف">
                            <i class="fa-solid fa-camera text-xs"></i>
                        </button>
                        <span id="rv-receive-photo-count-${idx}" class="block text-[10px] text-slate-400 mt-0.5 hidden">0</span>
                    </td>
                    <td class="py-2.5 px-3 text-center">
                        <input type="checkbox" id="rv-mo-inv-${idx}" data-rv-invoice class="w-4 h-4 text-amber-500 rounded" title="جاية بفاتورة">
                    </td>
                </tr>`;
                idx++;
            }
        }
        _el('rv-mo-modal-items').innerHTML = html ||
            '<tr><td colspan="7" class="py-8 text-center text-slate-400 text-xs">لا توجد أصناف</td></tr>';

        const m = _el('rv-mo-modal');
        m.style.display = 'flex';
        requestAnimationFrame(() => { m.style.opacity = '1'; });
    };

    window.rvCloseMOModal = function () {
        const m = _el('rv-mo-modal');
        m.style.opacity = '0';
        setTimeout(() => { m.style.display = 'none'; _currentGrouped = null; }, 200);
    };

    window.rvConfirmMOReceiving = async function () {
        const warehouseId = _el('rv-mo-modal-warehouse')?.value;
        if (!warehouseId) { window.showToast('اختر المستودع', 'error'); return; }

        const btn = _el('rv-mo-save-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1.5"></i> جاري...';

        // Gather all qty inputs
        const rows = _el('rv-mo-modal-items').querySelectorAll('tr');
        const itemsByMO = {};
        const moHasInvoice = {};

        rows.forEach((row) => {
            const qtyInput = row.querySelector('input[type="number"]');
            const invCheck = row.querySelector('[data-rv-invoice]');
            const photoInput = row.querySelector('[data-rv-photo]');
            if (!qtyInput) return;

            const qty          = parseFloat(qtyInput.value) || 0;
            const moItemId     = qtyInput.dataset.itemId;
            const orderItemId  = qtyInput.dataset.orderItemId;
            const variantId    = qtyInput.dataset.variantId;
            const moId         = qtyInput.dataset.moId;
            const hasInvoice   = invCheck?.checked || false;
            const files        = photoInput ? Array.from(photoInput.files) : [];

            if (qty > 0 && moItemId && moItemId !== 'undefined' && variantId && variantId !== 'undefined' && moId) {
                if (!itemsByMO[moId]) { itemsByMO[moId] = []; moHasInvoice[moId] = false; }
                const idx = itemsByMO[moId].length;
                itemsByMO[moId].push({
                    manufacturer_order_item_id: moItemId,
                    order_item_id: orderItemId || null,
                    variant_id:    variantId,
                    quantity:      qty,
                    has_supplier_invoice: hasInvoice,
                    _idx:          idx,
                    _files:        files
                });
                if (hasInvoice) moHasInvoice[moId] = true;
            }
        });

        if (!Object.keys(itemsByMO).length) {
            window.showToast('أدخل كمية واحدة على الأقل', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check ml-1.5"></i> اعتماد الاستلام';
            return;
        }

        try {
            for (const [moId, moItems] of Object.entries(itemsByMO)) {
                const formData = new FormData();
                formData.append('warehouse_id', warehouseId);
                formData.append('has_supplier_invoice', String(moHasInvoice[moId]));
                formData.append('items', JSON.stringify(moItems.map(({ _idx, _files, ...rest }) => rest)));

                moItems.forEach((it, idx) => {
                    (it._files || []).forEach((f, i) => {
                        formData.append('item_photos', f, `item-${idx}-${i}-${f.name}`);
                    });
                });

                const res = await fetch('/api/manufacturer-orders/' + moId + '/receive', {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || `خطأ في اعتماد الاستلام (${res.status})`);
                }
            }
            window.showToast('تم اعتماد الاستلام بنجاح', 'success');
            rvCloseMOModal();
            rvLoadMOsTab();
        } catch (e) {
            window.showToast(e.message || 'خطأ في الاستلام', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check ml-1.5"></i> اعتماد الاستلام';
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Modal: New Voucher
    // ─────────────────────────────────────────────────────────────────────────
    window.rvOpenNew = function () {
        _itemCount = 0;
        _el('rv-items-tbody').innerHTML = '';
        _currentMO = null;

        // Populate dropdowns
        const supSel = _el('rv-modal-supplier');
        supSel.innerHTML = '<option value="">— اختر المورد —</option>' +
            _suppliers.map(s => `<option value="${s.id}">${esc(s.company_name)}</option>`).join('');

        // Populate warehouses
        const whSel = _el('rv-modal-warehouse');
        whSel.innerHTML = '<option value="">— اختر المستودع —</option>' +
            _warehouses.map(w => `<option value="${w.id}">${esc(w.name)} ${w.is_main ? '(رئيسي)' : ''}</option>`).join('');

        // Reset MO dropdown (will be populated when supplier selected)
        _el('rv-modal-mo').innerHTML = '<option value="">— اختر أمر التشغيل —</option>';

        // Reset fields
        _el('rv-modal-date').value = new Date().toISOString().split('T')[0];
        _el('rv-modal-supplier').value = '';
        _el('rv-modal-warehouse').value = '';
        _el('rv-modal-mo').value = '';
        _el('rv-modal-notes').value = '';
        _el('rv-total-amount').textContent = '0.00';

        // Add first empty item
        rvAddItem();

        const m = _el('rv-modal');
        m.style.display = 'flex';
        requestAnimationFrame(() => {
            m.style.opacity = '1';
        });
    };

    window.rvCloseModal = function () {
        const m = _el('rv-modal');
        m.style.opacity = '0';
        setTimeout(() => { m.style.display = 'none'; }, 200);
    };

    window.rvSupplierChanged = function () {
        const supplierId = _el('rv-modal-supplier')?.value;
        const moSel = _el('rv-modal-mo');

        // Filter manufacturer orders by supplier (manufacturer_id = supplier_id)
        const filtered = supplierId
            ? _moList.filter(mo => mo.manufacturer_id === supplierId || mo.supplier_id === supplierId)
            : _moList;

        moSel.innerHTML = '<option value="">— اختر أمر التشغيل —</option>' +
            filtered.map(mo => `<option value="${mo.id}">#${mo.mo_number} — ${fmt(mo.total_amount)} ${mo.status === 'partial' ? '(جزئي)' : ''}</option>`).join('');
    };

    window.rvMOChanged = async function () {
        const moId = _el('rv-modal-mo')?.value;
        if (!moId) {
            // Clear items and reset to empty editable row
            _el('rv-items-tbody').innerHTML = '';
            _itemCount = 0;
            _currentMO = null;
            rvAddItem();
            return;
        }

        // Load MO details
        try {
            const res = await window.apiFetch(`/api/manufacturer-orders/${moId}`);
            const mo = res.data;
            _currentMO = mo;

            // Set supplier automatically
            if (mo.manufacturer_id) {
                _el('rv-modal-supplier').value = mo.manufacturer_id;
            }

            // Load items with remaining quantities
            _el('rv-items-tbody').innerHTML = '';
            _itemCount = 0;

            const items = mo.items || [];
            for (const it of items) {
                const moQty = parseFloat(it.mo_quantity || it.po_quantity || 0);
                const recQty = parseFloat(it.received_qty || 0);
                const remQty = moQty - recQty;

                if (remQty <= 0) continue; // Skip fully received items

                rvAddItem();
                const idx = _itemCount;

                // Find product for this variant
                const prod = _products.find(p => p.variants?.some(v => v.id === it.variant_id));
                const prodSel = _el(`rv-item-prod-${idx}`);

                if (prod && prodSel) {
                    prodSel.value = prod.id;
                    await window.rvProdChanged(idx);
                    const varSel = _el(`rv-item-variant-${idx}`);
                    if (varSel) varSel.value = it.variant_id;
                } else {
                    // Fallback: create option for this specific item
                    const opt = document.createElement('option');
                    opt.value = `mo-item-${idx}`;
                    opt.textContent = `📦 ${it.product_name || 'منتج'}`;
                    prodSel.appendChild(opt);
                    prodSel.value = `mo-item-${idx}`;
                    prodSel.dataset.variantId = it.variant_id;
                    _el(`rv-item-variant-wrap-${idx}`)?.classList.add('hidden');
                }

                // Set remaining quantity and unit cost
                const qtyInput = _el(`rv-item-qty-${idx}`);
                const costInput = _el(`rv-item-cost-${idx}`);
                if (qtyInput) qtyInput.value = remQty;
                if (costInput) costInput.value = it.unit_cost || 0;

                // Size label
                const sizeLabel = _el(`rv-item-size-label-${idx}`);
                if (sizeLabel) {
                    sizeLabel.textContent = it.size_name || 'قياسي';
                    sizeLabel.classList.add('font-medium', 'text-slate-700');
                }

                // Add remaining info display
                const remInfo = document.createElement('div');
                remInfo.className = 'text-xs text-slate-400 mt-1';
                remInfo.innerHTML = `المطلوب: <b class="text-blue-600">${moQty}</b> — مستلم: <b class="text-emerald-600">${recQty}</b>`;
                prodSel?.parentElement?.appendChild(remInfo);

                // Lock product/variant selects
                if (prodSel) {
                    prodSel.disabled = true;
                    prodSel.classList.add('bg-slate-100', 'text-slate-500');
                }
                const varSel = _el(`rv-item-variant-${idx}`);
                if (varSel) {
                    varSel.disabled = true;
                    varSel.classList.add('bg-slate-100', 'text-slate-500');
                }

                // Hide delete button for MO-linked items
                const delBtn = _el(`rv-item-${idx}`)?.querySelector('button[onclick^="window.rvRemoveItem"]');
                if (delBtn) delBtn.style.display = 'none';
            }

            rvRecalc();
        } catch (e) {
            window.showToast('فشل تحميل بيانات أمر التشغيل', 'error');
            console.error(e);
        }
    };

    window.rvInvoiceChanged = async function () {
        const invoiceId = _el('rv-modal-invoice')?.value;
        if (!invoiceId) {
            _el('rv-items-tbody').innerHTML = '';
            _itemCount = 0;
            rvAddItem();
            return;
        }

        try {
            const res = await window.apiFetch(`/api/purchase-invoices/${invoiceId}`);
            const invoice = res.data?.invoice;
            const items = res.data?.items || [];

            // Load invoice items
            _el('rv-items-tbody').innerHTML = '';
            _itemCount = 0;

            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                rvAddItem();
                const idx = _itemCount;

                // Find product
                const prod = _products.find(p => p.variants?.some(v => v.id === it.variant_id));
                const prodSel = _el(`rv-item-prod-${idx}`);

                if (prod && prodSel) {
                    prodSel.value = prod.id;
                    await window.rvProdChanged(idx);
                    const varSel = _el(`rv-item-variant-${idx}`);
                    if (varSel) varSel.value = it.variant_id;
                } else if (prodSel && it.product_name) {
                    const optValue = `invoice-item-${idx}`;
                    const opt = document.createElement('option');
                    opt.value = optValue;
                    opt.textContent = `📦 ${it.product_name}`;
                    prodSel.appendChild(opt);
                    prodSel.value = optValue;
                    prodSel.dataset.variantId = it.variant_id;
                    prodSel.dataset.productName = it.product_name;
                    _el(`rv-item-variant-wrap-${idx}`)?.classList.add('hidden');
                }

                const qtyInput = _el(`rv-item-qty-${idx}`);
                const costInput = _el(`rv-item-cost-${idx}`);
                if (qtyInput) qtyInput.value = it.quantity || 1;
                if (costInput) costInput.value = it.unit_price || 0;

                // Size label
                const sizeLabel = _el(`rv-item-size-label-${idx}`);
                if (sizeLabel) {
                    sizeLabel.textContent = it.size_name || 'قياسي';
                    sizeLabel.classList.add('font-medium', 'text-slate-700');
                }

                // Lock fields
                if (prodSel) {
                    prodSel.disabled = true;
                    prodSel.classList.add('bg-slate-100', 'text-slate-500');
                }
                const varSel = _el(`rv-item-variant-${idx}`);
                if (varSel) {
                    varSel.disabled = true;
                    varSel.classList.add('bg-slate-100', 'text-slate-500');
                }

                const delBtn = _el(`rv-item-${idx}`)?.querySelector('button[onclick^="window.rvRemoveItem"]');
                if (delBtn) delBtn.style.display = 'none';
            }

            rvRecalc();
        } catch (e) {
            window.showToast('فشل تحميل أصناف الفاتورة', 'error');
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Items handling
    // ─────────────────────────────────────────────────────────────────────────
    window.rvAddItem = function () {
        _itemCount++;
        const idx = _itemCount;
        const tr = document.createElement('tr');
        tr.id = `rv-item-${idx}`;
        tr.className = 'border-b border-slate-100';
        tr.innerHTML = `
            <td class="py-2 px-3" style="min-width:160px;max-width:240px;">
                <div class="max-w-full">
                    <select id="rv-item-prod-${idx}" onchange="window.rvProdChanged(${idx})"
                            class="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs focus:border-brand-500 outline-none bg-white truncate">
                        <option value="">— اختر المنتج —</option>
                        ${_products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
                    </select>
                </div>
                <div id="rv-item-variant-wrap-${idx}" class="hidden mt-1">
                    <select id="rv-item-variant-${idx}" onchange="window.rvRecalc(); window.rvUpdateSizeLabel(${idx})"
                            class="w-full px-2 py-2 border border-brand-200 bg-brand-50 rounded-lg text-xs focus:border-brand-500 outline-none">
                        <option value="">— اختر المقاس —</option>
                    </select>
                </div>
            </td>
            <td class="py-2 px-3 text-center" style="min-width:80px;">
                <span id="rv-item-size-label-${idx}" class="text-xs text-slate-600 font-medium">—</span>
            </td>
            <td class="py-2 px-3" style="min-width:70px;">
                <input id="rv-item-qty-${idx}" type="number" min="1" value="1"
                       oninput="window.rvRecalc()"
                       class="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs text-center focus:border-brand-500 outline-none" />
            </td>
            <td class="py-2 px-3" style="min-width:90px;">
                <input id="rv-item-cost-${idx}" type="number" min="0" step="0.01" placeholder="0.00"
                       oninput="window.rvRecalc()"
                       class="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:border-brand-500 outline-none text-right" />
            </td>
            <td class="py-2 px-3 text-left" style="min-width:70px;">
                <span id="rv-item-total-${idx}" class="font-mono text-slate-700 text-xs">0.00</span>
            </td>
            <td class="py-2 px-3 text-center" style="width:40px;">
                <button onclick="window.rvRemoveItem(${idx})"
                        class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors mx-auto">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </td>`;
        _el('rv-items-tbody').appendChild(tr);
        rvRecalc();
    };

    window.rvRemoveItem = function (idx) {
        const tr = _el(`rv-item-${idx}`);
        if (tr) tr.remove();
        rvRecalc();
    };

    window.rvProdChanged = async function (idx) {
        const prodId = _el(`rv-item-prod-${idx}`)?.value;
        const varWrap = _el(`rv-item-variant-wrap-${idx}`);
        const varSel = _el(`rv-item-variant-${idx}`);
        const sizeLabel = _el(`rv-item-size-label-${idx}`);

        if (!prodId) {
            varWrap?.classList.add('hidden');
            if (sizeLabel) sizeLabel.textContent = '—';
            return;
        }

        try {
            const res = await window.apiFetch(`/api/products/${prodId}`);
            const variants = res.data?.variants || [];

            if (variants.length === 0) {
                varWrap?.classList.add('hidden');
                if (sizeLabel) sizeLabel.textContent = 'قياسي';
            } else {
                varSel.innerHTML = '<option value="">— اختر المقاس —</option>' +
                    variants.map(v => `<option value="${v.id}">${esc(v.size_name)}</option>`).join('');
                varWrap?.classList.remove('hidden');
                if (sizeLabel) sizeLabel.textContent = '—';
            }
        } catch (_) {
            varWrap?.classList.add('hidden');
            if (sizeLabel) sizeLabel.textContent = '—';
        }
    };

    window.rvUpdateSizeLabel = function (idx) {
        const varSel = _el(`rv-item-variant-${idx}`);
        const sizeLabel = _el(`rv-item-size-label-${idx}`);
        if (!varSel || !sizeLabel) return;
        const selected = varSel.options[varSel.selectedIndex];
        sizeLabel.textContent = selected?.textContent || '—';
    };

    window.rvRecalc = function () {
        let total = 0;
        for (let i = 1; i <= _itemCount; i++) {
            if (!_el(`rv-item-${i}`)) continue;
            const qty = parseFloat(_el(`rv-item-qty-${i}`)?.value || 0);
            const cost = parseFloat(_el(`rv-item-cost-${i}`)?.value || 0);
            const line = qty * cost;
            total += line;
            const totalEl = _el(`rv-item-total-${i}`);
            if (totalEl) totalEl.textContent = fmt(line);
        }
        _el('rv-total-amount').textContent = fmt(total);
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Save
    // ─────────────────────────────────────────────────────────────────────────
    window.rvSave = async function () {
        const btn = _el('rv-save-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1.5"></i> جاري الحفظ...';

        const receiving_date = _el('rv-modal-date')?.value;
        const supplier_id = _el('rv-modal-supplier')?.value;
        const manufacturer_order_id = _el('rv-modal-mo')?.value || null;
        const warehouse_id = _el('rv-modal-warehouse')?.value;
        const notes = _el('rv-modal-notes')?.value?.trim() || null;

        if (!receiving_date) { window.showToast('تاريخ الاستلام مطلوب', 'error'); btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk ml-1.5"></i> حفظ سند الاستلام'; return; }
        if (!supplier_id) { window.showToast('المورد مطلوب', 'error'); btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk ml-1.5"></i> حفظ سند الاستلام'; return; }
        if (!warehouse_id) { window.showToast('المستودع مطلوب', 'error'); btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk ml-1.5"></i> حفظ سند الاستلام'; return; }

        const items = [];
        for (let i = 1; i <= _itemCount; i++) {
            const row = _el(`rv-item-${i}`);
            if (!row) continue;

            const prodSel = _el(`rv-item-prod-${i}`);
            const varSel = _el(`rv-item-variant-${i}`);

            let variant_id;
            if (prodSel?.value?.startsWith('mo-item-')) {
                variant_id = prodSel.dataset.variantId;
                if (!variant_id) continue;
            } else {
                variant_id = varSel?.value;
                if (!variant_id && prodSel?.value) {
                    const prod = _products.find(p => p.id === prodSel.value);
                    if (prod?.variants?.length === 1) variant_id = prod.variants[0].id;
                }
                if (!variant_id) continue;
            }

            const qty = parseFloat(_el(`rv-item-qty-${i}`)?.value || 0);
            const cost = parseFloat(_el(`rv-item-cost-${i}`)?.value || 0);
            if (qty <= 0) { window.showToast(`الصنف ${items.length + 1}: الكمية غير صحيحة`, 'error'); btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk ml-1.5"></i> حفظ سند الاستلام'; return; }

            items.push({ variant_id, quantity: qty, unit_cost: cost });
        }

        if (!items.length) { window.showToast('يجب إدخال صنف واحد على الأقل', 'error'); btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk ml-1.5"></i> حفظ سند الاستلام'; return; }

        try {
            await window.apiFetch('/api/receiving-vouchers', {
                method: 'POST',
                body: JSON.stringify({ receiving_date, supplier_id, manufacturer_order_id, warehouse_id, notes, items })
            });
            window.showToast('تم إنشاء سند الاستلام بنجاح', 'success');
            rvCloseModal();
            rvRefresh();
        } catch (e) {
            window.showToast(e.message || 'فشل حفظ سند الاستلام', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk ml-1.5"></i> حفظ سند الاستلام';
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Detail & Void
    // ─────────────────────────────────────────────────────────────────────────
    window.rvOpenDetail = async function (id) {
        _currentDetailId = id;
        const m = _el('rv-detail-modal');
        m.style.display = 'flex';
        requestAnimationFrame(() => m.style.opacity = '1');

        const content = _el('rv-detail-content');
        content.innerHTML = '<div class="py-12 text-center"><i class="fa-solid fa-circle-notch fa-spin text-brand-500 text-xl mb-2"></i><p class="text-slate-400 text-sm">جاري التحميل...</p></div>';

        try {
            const res = await window.apiFetch(`/api/receiving-vouchers/${id}`);
            const v = res.data?.voucher;
            const items = res.data?.items || [];

            _el('rv-detail-title').textContent = `سند استلام #${v.voucher_number}`;
            _el('rv-detail-sub').textContent = `${new Date(v.receiving_date).toLocaleDateString('ar-SA-u-nu-latn')} — ${v.supplier_name || '—'}`;

            const voidBtn = _el('rv-detail-void-btn');
            if (v.status === 'voided') {
                voidBtn.style.display = 'none';
            } else {
                voidBtn.style.display = 'inline-flex';
            }

            content.innerHTML = `
                <div class="space-y-4">
                    <div class="grid grid-cols-2 gap-4 bg-slate-50 rounded-xl p-4">
                        <div><span class="text-xs text-slate-400">المورد:</span><p class="text-sm font-bold text-slate-700">${esc(v.supplier_name || '—')}</p></div>
                        <div><span class="text-xs text-slate-400">التاريخ:</span><p class="text-sm font-bold text-slate-700">${new Date(v.receiving_date).toLocaleDateString('ar-SA-u-nu-latn')}</p></div>
                        ${v.purchase_invoice_number ? `<div><span class="text-xs text-slate-400">فاتورة الشراء:</span><p class="text-sm font-bold text-slate-700">#${v.purchase_invoice_number}</p></div>` : ''}
                        ${v.mo_number ? `<div><span class="text-xs text-slate-400">أمر التشغيل:</span><p class="text-sm font-bold text-slate-700">#${v.mo_number}</p></div>` : ''}
                        <div><span class="text-xs text-slate-400">الحالة:</span>
                            ${v.status === 'voided'
                                ? '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-600">ملغي</span>'
                                : '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-600">مكتمل</span>'}
                        </div>
                        ${v.notes ? `<div class="col-span-2"><span class="text-xs text-slate-400">ملاحظات:</span><p class="text-sm text-slate-700">${esc(v.notes)}</p></div>` : ''}
                    </div>

                    <div>
                        <h4 class="text-sm font-bold text-slate-700 mb-3">الأصناف المستلمة</h4>
                        <div class="border border-slate-200 rounded-xl overflow-hidden">
                            <table class="w-full text-sm">
                                <thead class="bg-slate-50 text-xs text-slate-500">
                                    <tr>
                                        <th class="py-2 px-3 text-right">المنتج</th>
                                        <th class="py-2 px-3 text-center">المقاس</th>
                                        <th class="py-2 px-3 text-right">الكمية</th>
                                        <th class="py-2 px-3 text-right">التكلفة</th>
                                        <th class="py-2 px-3 text-left">الإجمالي</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${items.map(it => `
                                        <tr class="border-b border-slate-100">
                                            <td class="py-2 px-3 text-xs">${esc(it.product_name || '—')}</td>
                                            <td class="py-2 px-3 text-xs text-center">${esc(it.size_name || 'قياسي')}</td>
                                            <td class="py-2 px-3 text-xs text-right">${it.quantity}</td>
                                            <td class="py-2 px-3 text-xs text-right font-mono">${fmt(it.unit_cost)}</td>
                                            <td class="py-2 px-3 text-xs text-left font-mono font-bold">${fmt(it.line_total)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                                <tfoot>
                                    <tr class="bg-slate-50 border-t border-slate-200">
                                        <td colspan="4" class="py-2 px-3 text-xs font-bold text-slate-500 text-left">الإجمالي</td>
                                        <td class="py-2 px-3 font-mono font-black text-emerald-600 text-sm">${fmt(v.total_amount)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </div>
            `;
        } catch (e) {
            content.innerHTML = '<div class="py-8 text-center text-red-500 text-sm">فشل تحميل التفاصيل</div>';
        }
    };

    window.rvCloseDetail = function () {
        const m = _el('rv-detail-modal');
        m.style.opacity = '0';
        setTimeout(() => { m.style.display = 'none'; _currentDetailId = null; }, 200);
    };

    window.rvVoid = async function () {
        if (!_currentDetailId) return;
        if (!confirm('هل أنت متأكد من إلغاء هذا السند؟ سيتم خصم الكميات من المخزون.')) return;

        try {
            await window.apiFetch(`/api/receiving-vouchers/${_currentDetailId}`, { method: 'DELETE' });
*/
