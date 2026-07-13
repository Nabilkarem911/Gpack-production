'use strict';

// =============================================================================
// G.PACK 2.0 — أوامر الفسح (Delivery Vouchers)
// تسليم البضاعة للعملاء ضد أوامر الفسح المفتوحة
// =============================================================================

(function () {

    // ── State ─────────────────────────────────────────────────────────────────
    let _pendingNotes = [];       // delivery notes pending/partial
    let _currentDN    = null;     // selected delivery note for dispatch modal

    // ── Helpers ───────────────────────────────────────────────────────────────
    const esc  = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const fmtD = (d) => d ? new Date(d).toLocaleDateString('ar-SA-u-nu-latn') : '—';
    const _el  = (id) => document.getElementById(id);

    function showEl(id) { const e = _el(id); if (e) { e.classList.remove('hidden'); e.style.display = ''; } }
    function hideEl(id) { const e = _el(id); if (e) e.classList.add('hidden'); }

    function openModal(id) {
        const m = _el(id);
        if (!m) return;
        m.style.display = 'flex';
        requestAnimationFrame(() => { m.style.opacity = '1'; });
    }
    function closeModalEl(id) {
        const m = _el(id);
        if (!m) return;
        m.style.opacity = '0';
        setTimeout(() => { m.style.display = 'none'; }, 200);
    }

    // ── Tab switching ─────────────────────────────────────────────────────────
    window.dvSwitchTab = function(tab) {
        const isPending = tab === 'pending';
        const activeClass   = 'flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition-all bg-white text-brand-700 shadow-sm';
        const inactiveClass = 'flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition-all text-slate-500 hover:text-slate-700';
        const tp = _el('dv-tab-pending'), ta = _el('dv-tab-archive');
        if (tp) tp.className = isPending  ? activeClass : inactiveClass;
        if (ta) ta.className = !isPending ? activeClass : inactiveClass;
        if (isPending) { showEl('dv-section-pending'); hideEl('dv-section-archive'); }
        else           { hideEl('dv-section-pending'); showEl('dv-section-archive'); window.dvLoadArchive(); }
    };

    // ── Init: load pending delivery notes ─────────────────────────────────────
    window.dvInit = async function() {
        hideEl('dv-notes-grid'); hideEl('dv-empty'); showEl('dv-loading');
        try {
            const res = await window.apiFetch('/api/delivery-notes');
            _pendingNotes = (res.data || []).filter(dn => dn.status === 'pending' || dn.status === 'partial');
            _renderGrid();
        } catch (e) {
            window.showToast('فشل تحميل أوامر الفسح', 'error');
        } finally { hideEl('dv-loading'); }
        const badge = _el('dv-tab-pending-badge');
        if (badge) { badge.textContent = _pendingNotes.length; _pendingNotes.length > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden'); }
    };

    // ── Render pending grid ───────────────────────────────────────────────────
    function _renderGrid() {
        const grid = _el('dv-notes-grid');
        if (!grid) return;
        if (!_pendingNotes.length) { showEl('dv-empty'); return; }
        hideEl('dv-empty');
        grid.innerHTML = _pendingNotes.map(dn => {
            const badge = dn.status === 'partial'
                ? '<span class="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-lg font-bold">جزئي التسليم</span>'
                : '<span class="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-lg font-bold">معلق</span>';
            return `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-3">
                <div class="flex justify-between items-start">
                    ${badge}
                    <span class="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-1 rounded">سند #${esc(String(dn.note_number || '—'))}</span>
                </div>
                <div>
                    <p class="font-bold text-slate-800">${esc(dn.client_name || '—')}</p>
                    <p class="text-xs text-slate-400 mt-0.5">${dn.item_count || 0} أصناف — طلب #${esc(String(dn.order_number || '—'))}</p>
                    <p class="text-xs text-slate-400">${fmtD(dn.created_at)}</p>
                </div>
                <div class="flex gap-2 mt-auto pt-2 border-t border-slate-100">
                    <button onclick="window.dvOpenDispatchModal('${esc(dn.id)}')"
                            class="flex-1 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm font-bold rounded-xl transition-colors">
                        <i class="fa-solid fa-truck ml-1 text-xs"></i>تسليم جديد
                    </button>
                    ${dn.status === 'pending'
                        ? `<button onclick="window.dvOpenEditModal('${esc(dn.id)}')"
                                class="w-10 flex items-center justify-center bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl transition-colors">
                            <i class="fa-solid fa-pen text-sm"></i>
                        </button>` : ''}
                    <button onclick="window.dvPrintNote('${esc(dn.id)}')"
                            class="w-10 flex items-center justify-center bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl transition-colors">
                        <i class="fa-solid fa-print text-sm"></i>
                    </button>
                </div>
            </div>`;
        }).join('');
        showEl('dv-notes-grid');
    }

    // ── Open dispatch modal ───────────────────────────────────────────────────
    window.dvOpenDispatchModal = async function(dnId) {
        try {
            const res = await window.apiFetch('/api/delivery-notes/' + dnId);
            _currentDN = res.data;
            if (!_currentDN) { window.showToast('فشل تحميل السند', 'error'); return; }
            const dn  = _currentDN;
            const sub = _el('dv-modal-subtitle');
            if (sub) sub.textContent = `سند #${dn.note_number || '—'} — ${dn.client_name || '—'} — طلب #${dn.order_number || '—'}`;
            const container = _el('dv-modal-items');
            if (container) {
                container.innerHTML = (dn.items || []).map(item => {
                    const remaining = Math.max(0, (item.requested_qty || item.quantity || 0) - (item.delivered_qty || 0));
                    return `
                    <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
                        <div class="flex justify-between items-start mb-2">
                            <div>
                                <p class="text-sm font-bold text-slate-800">${esc(item.product_name || '—')}</p>
                                ${item.variant_name ? `<p class="text-xs text-slate-500">${esc(item.variant_name)}</p>` : ''}
                            </div>
                            <span class="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">متبقي: ${remaining}</span>
                        </div>
                        <div class="flex items-center gap-3">
                            <div class="flex-1">
                                <label class="text-xs text-slate-500 block mb-1">الكمية المُسلَّمة</label>
                                <input type="number" min="0" max="${remaining}" value="${remaining}"
                                       data-item-id="${esc(item.id)}"
                                       class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-center outline-none focus:border-brand-400" />
                            </div>
                            <div class="text-xs text-slate-400 text-center">
                                <div>مطلوب</div><div class="font-bold text-slate-700">${item.requested_qty || item.quantity || 0}</div>
                            </div>
                            <div class="text-xs text-slate-400 text-center">
                                <div>سُلِّم</div><div class="font-bold text-emerald-600">${item.delivered_qty || 0}</div>
                            </div>
                        </div>
                    </div>`;
                }).join('') || '<p class="text-sm text-slate-400 text-center py-4">لا توجد أصناف</p>';
            }
            const notesEl = _el('dv-modal-notes');
            if (notesEl) notesEl.value = '';
            openModal('dv-dispatch-modal');
        } catch (e) { window.showToast('خطأ في تحميل البيانات', 'error'); }
    };

    window.dvCloseModal = function() { closeModalEl('dv-dispatch-modal'); _currentDN = null; };

    // ── Edit delivery note ────────────────────────────────────────────────────
    let _editDN = null;

    window.dvOpenEditModal = async function(dnId) {
        try {
            const res = await window.apiFetch('/api/delivery-notes/' + dnId);
            _editDN = res.data;
            if (!_editDN) { window.showToast('فشل تحميل أمر الفسح', 'error'); return; }
            if (_editDN.status !== 'pending') {
                window.showToast('يمكن تعديل أوامر الفسح في حالة "معلق" فقط', 'error');
                return;
            }
            const dn = _editDN;
            const sub = _el('dv-edit-modal-subtitle');
            if (sub) sub.textContent = `أمر فسح #${dn.note_number || '—'} — ${dn.client_name || '—'} — طلب #${dn.order_number || '—'}`;
            const container = _el('dv-edit-modal-items');
            if (container) {
                container.innerHTML = (dn.items || []).map(item => {
                    return `
                    <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
                        <div class="flex justify-between items-start mb-2">
                            <div>
                                <p class="text-sm font-bold text-slate-800">${esc(item.product_name || '—')}</p>
                                ${item.variant_name ? `<p class="text-xs text-slate-500">${esc(item.variant_name)}</p>` : ''}
                            </div>
                        </div>
                        <div class="flex items-center gap-3">
                            <div class="flex-1">
                                <label class="text-xs text-slate-500 block mb-1">الكمية المطلوبة</label>
                                <input type="number" min="1" step="1" value="${item.requested_qty || item.quantity || 0}"
                                       data-edit-item-id="${esc(item.id)}"
                                       class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-center outline-none focus:border-blue-400" />
                            </div>
                        </div>
                    </div>`;
                }).join('') || '<p class="text-sm text-slate-400 text-center py-4">لا توجد أصناف</p>';
            }
            const notesEl = _el('dv-edit-modal-notes');
            if (notesEl) notesEl.value = dn.notes || '';
            openModal('dv-edit-modal');
        } catch (e) { window.showToast('خطأ في تحميل البيانات', 'error'); }
    };

    window.dvCloseEditModal = function() { closeModalEl('dv-edit-modal'); _editDN = null; };

    // ── Reverse dispatch ─────────────────────────────────────────────────────
    window.dvReverseDispatch = async function(dnId) {
        if (!confirm('هل أنت متأكد من التراجع عن التسليم؟ سيتم إرجاع جميع الكميات المسلّمة إلى المخزون وإعادة أمر الفسح إلى حالة "معلق".')) return;
        try {
            await window.apiFetch('/api/delivery-notes/' + dnId + '/reverse', { method: 'POST' });
            window.showToast('تم التراجع عن التسليم بنجاح ✅');
            await window.dvInit();
            await window.dvLoadArchive();
        } catch (e) {
            window.showToast(e.message || 'فشل التراجع عن التسليم', 'error');
        }
    };

    // ── Create standalone delivery note ───────────────────────────────────────
    let _createStock = [];
    let _createSelected = {};

    window.dvOpenCreateModal = async function() {
        const clientSel = _el('dv-create-client');
        const whSel     = _el('dv-create-warehouse');
        const searchInp = _el('dv-create-item-search');
        const selDiv    = _el('dv-create-selected');
        if (clientSel) clientSel.innerHTML = '<option value="">— اختر العميل —</option>';
        if (whSel)     whSel.innerHTML     = '<option value="">— اختر المستودع —</option>';
        if (searchInp) searchInp.disabled  = true;
        if (selDiv)    selDiv.innerHTML    = '<p class="text-sm text-slate-400 text-center py-3">لم يتم اختيار أصناف بعد</p>';
        const dEl = _el('dv-create-driver');   if (dEl) dEl.value = '';
        const vEl = _el('dv-create-vehicle');  if (vEl) vEl.value = '';
        const nEl = _el('dv-create-notes');    if (nEl) nEl.value = '';
        _createStock = [];
        _createSelected = {};

        try {
            const res = await window.apiFetch('/api/clients');
            const clients = res.data || [];
            if (clientSel) {
                clients.forEach(c => {
                    clientSel.innerHTML += `<option value="${esc(c.id)}">${esc(c.name)}</option>`;
                });
            }
        } catch (e) { window.showToast('فشل تحميل العملاء', 'error'); }

        openModal('dv-create-modal');
    };

    window.dvCloseCreateModal = function() { closeModalEl('dv-create-modal'); };

    window.dvOnClientChange = async function() {
        const clientId = _el('dv-create-client')?.value;
        const whSel    = _el('dv-create-warehouse');
        const searchInp = _el('dv-create-item-search');
        const selDiv    = _el('dv-create-selected');
        if (whSel)     whSel.innerHTML = '<option value="">— اختر المستودع —</option>';
        if (searchInp) searchInp.disabled = true;
        if (selDiv)    selDiv.innerHTML = '<p class="text-sm text-slate-400 text-center py-3">لم يتم اختيار أصناف بعد</p>';
        _createStock = [];
        _createSelected = {};
        if (!clientId) return;
        try {
            const res = await window.apiFetch('/api/inventory/warehouses?client_id=' + clientId);
            const warehouses = res.data || [];
            if (whSel) {
                warehouses.forEach(w => {
                    whSel.innerHTML += `<option value="${esc(w.id)}">${esc(w.name)}</option>`;
                });
            }
        } catch (_) {}
    };

    window.dvOnWarehouseChange = async function() {
        const clientId = _el('dv-create-client')?.value;
        const whId     = _el('dv-create-warehouse')?.value;
        const searchInp = _el('dv-create-item-search');
        const selDiv    = _el('dv-create-selected');
        if (searchInp) { searchInp.disabled = true; searchInp.value = ''; }
        const resultsDiv = _el('dv-create-search-results');
        if (resultsDiv) resultsDiv.classList.add('hidden');
        if (selDiv)    selDiv.innerHTML = '<p class="text-sm text-slate-400 text-center py-3">لم يتم اختيار أصناف بعد</p>';
        _createSelected = {};
        if (!clientId || !whId) return;

        try {
            const res = await window.apiFetch('/api/inventory/stock?client_id=' + clientId + '&warehouse_id=' + whId);
            _createStock = (res.data || []).filter(s => parseFloat(s.quantity || s.available_qty || 0) > 0);
            if (searchInp) searchInp.disabled = false;
        } catch (e) {
            _createStock = [];
            window.showToast('فشل تحميل المخزون', 'error');
        }
    };

    window.dvSearchItems = function() {
        const query = (_el('dv-create-item-search')?.value || '').trim().toLowerCase();
        const resultsDiv = _el('dv-create-search-results');
        if (!resultsDiv) return;
        if (!query || query.length < 1) { resultsDiv.classList.add('hidden'); return; }

        const matches = _createStock.filter(s => {
            const name = (s.product_name || '').toLowerCase();
            const variant = (s.variant_name || s.size_name || '').toLowerCase();
            return name.includes(query) || variant.includes(query);
        }).slice(0, 10);

        if (!matches.length) {
            resultsDiv.innerHTML = '<p class="px-3 py-2 text-sm text-slate-400">لا توجد نتائج</p>';
            resultsDiv.classList.remove('hidden');
            return;
        }

        resultsDiv.innerHTML = matches.map(s => {
            const avail = parseFloat(s.available_qty || s.quantity || 0);
            const alreadySelected = _createSelected[s.variant_id] ? 'opacity-50 pointer-events-none' : '';
            return `
            <div onclick="window.dvAddItem('${esc(s.variant_id)}')"
                 class="px-3 py-2 cursor-pointer hover:bg-brand-50 border-b border-slate-100 ${alreadySelected}">
                <span class="text-sm font-bold text-slate-800">${esc(s.product_name || '—')}</span>
                <span class="text-xs text-slate-500"> ${esc(s.variant_name || s.size_name || '')}</span>
                <span class="text-xs text-emerald-600 font-bold"> (متاح: ${avail})</span>
            </div>`;
        }).join('');
        resultsDiv.classList.remove('hidden');
    };

    window.dvAddItem = function(variantId) {
        const s = _createStock.find(x => x.variant_id === variantId);
        if (!s || _createSelected[variantId]) return;
        const avail = parseFloat(s.available_qty || s.quantity || 0);
        _createSelected[variantId] = { variant_id: variantId, qty: 1, max: avail, name: s.product_name, variant: s.variant_name || s.size_name || '' };
        _el('dv-create-item-search').value = '';
        _el('dv-create-search-results').classList.add('hidden');
        _renderSelectedItems();
    };

    window.dvRemoveItem = function(variantId) {
        delete _createSelected[variantId];
        _renderSelectedItems();
    };

    window.dvUpdateItemQty = function(variantId, val) {
        if (!_createSelected[variantId]) return;
        const q = parseFloat(val) || 0;
        const max = _createSelected[variantId].max;
        if (q > max) { window.showToast(`الكمية تتجاوز المتاح (${max})`, 'error'); return; }
        _createSelected[variantId].qty = q;
    };

    function _renderSelectedItems() {
        const selDiv = _el('dv-create-selected');
        if (!selDiv) return;
        const keys = Object.keys(_createSelected);
        if (!keys.length) {
            selDiv.innerHTML = '<p class="text-sm text-slate-400 text-center py-3">لم يتم اختيار أصناف بعد</p>';
            return;
        }
        selDiv.innerHTML = keys.map(k => {
            const item = _createSelected[k];
            return `
            <div class="flex items-center gap-3 bg-white rounded-xl p-3 border border-slate-200">
                <div class="flex-1">
                    <p class="text-sm font-bold text-slate-800">${esc(item.name || '—')}</p>
                    <p class="text-xs text-slate-500">${esc(item.variant || '')} — متاح: ${item.max}</p>
                </div>
                <div class="w-24">
                    <input type="number" min="1" max="${item.max}" step="1" value="${item.qty}"
                           onchange="window.dvUpdateItemQty('${esc(item.variant_id)}', this.value)"
                           class="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center outline-none focus:border-brand-400" />
                </div>
                <button onclick="window.dvRemoveItem('${esc(item.variant_id)}')"
                        class="w-8 h-8 flex items-center justify-center text-red-400 hover:bg-red-50 rounded-lg transition-colors">
                    <i class="fa-solid fa-xmark text-sm"></i>
                </button>
            </div>`;
        }).join('');
    }

    window.dvConfirmCreate = async function() {
        const clientId  = _el('dv-create-client')?.value;
        const whId      = _el('dv-create-warehouse')?.value;
        const driver    = _el('dv-create-driver')?.value || null;
        const vehicle   = _el('dv-create-vehicle')?.value || null;
        const notes     = _el('dv-create-notes')?.value || null;

        if (!clientId) { window.showToast('اختر العميل', 'error'); return; }
        if (!whId)     { window.showToast('اختر المستودع', 'error'); return; }

        const items = Object.values(_createSelected).map(v => ({ variant_id: v.variant_id, requested_qty: parseFloat(v.qty) || 0 }));
        if (!items.length) { window.showToast('أضف صنفاً واحداً على الأقل', 'error'); return; }
        let valErr = null;
        items.forEach(i => { if (i.requested_qty <= 0) valErr = 'الكمية يجب أن تكون أكبر من صفر'; });
        if (valErr) { window.showToast(valErr, 'error'); return; }

        const btn = _el('dv-create-confirm-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-2"></i> جاري الإصدار...'; }

        try {
            const body = { client_id: clientId, warehouse_id: whId, items, notes, driver_name: driver, vehicle_number: vehicle };
            await window.apiFetch('/api/delivery-notes', { method: 'POST', body });
            window.dvCloseCreateModal();
            window.showToast('تم إصدار أمر الفسح بنجاح ✅');
            await window.dvInit();
        } catch (e) {
            window.showToast(e.message || 'فشل إصدار أمر الفسح', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check ml-1.5"></i> إصدار أمر الفسح'; }
        }
    };

    window.dvConfirmEdit = async function() {
        if (!_editDN) return;
        const inputs = document.querySelectorAll('#dv-edit-modal-items input[data-edit-item-id]');
        const items  = [];
        let valErr   = null;
        inputs.forEach(inp => {
            const q = parseFloat(inp.value) || 0;
            if (q <= 0) valErr = 'الكمية يجب أن تكون أكبر من صفر';
            if (q > 0)  items.push({ item_id: inp.dataset.editItemId, quantity: q });
        });
        if (valErr)        { window.showToast(valErr, 'error'); return; }
        if (!items.length) { window.showToast('أدخل كمية واحدة على الأقل', 'error'); return; }
        const notes = _el('dv-edit-modal-notes')?.value || '';
        const btn   = _el('dv-edit-modal-confirm-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-2"></i> جاري الحفظ...'; }
        try {
            await window.apiFetch('/api/delivery-notes/' + _editDN.id, { method: 'PUT', body: { items, notes } });
            window.dvCloseEditModal();
            window.showToast('تم تعديل أمر الفسح بنجاح ✅');
            await window.dvInit();
        } catch (e) {
            window.showToast(e.message || 'فشل تعديل أمر الفسح', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check ml-1.5"></i> حفظ التعديلات'; }
        }
    };

    // ── Confirm dispatch ──────────────────────────────────────────────────────
    window.dvConfirmDispatch = async function() {
        if (!_currentDN) return;
        const inputs = document.querySelectorAll('#dv-modal-items input[data-item-id]');
        const items  = [];
        let valErr   = null;
        inputs.forEach(inp => {
            const q = parseFloat(inp.value) || 0, max = parseFloat(inp.max) || Infinity;
            if (q > max) valErr = `الكمية (${q}) تتجاوز المتبقي (${max})`;
            if (q > 0)  items.push({ item_id: inp.dataset.itemId, quantity: q, notes: '' });
        });
        if (valErr)        { window.showToast(valErr, 'error'); return; }
        if (!items.length) { window.showToast('أدخل كمية واحدة على الأقل', 'error'); return; }
        const notes = _el('dv-modal-notes')?.value || '';
        const btn   = _el('dv-modal-confirm-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-2"></i> جاري الحفظ...'; }
        try {
            await window.apiFetch('/api/delivery-notes/' + _currentDN.id + '/dispatch', { method: 'POST', body: { items, notes } });
            window.dvCloseModal();
            window.showToast('تم تسجيل التسليم بنجاح ✅');
            await window.dvInit();
        } catch (e) {
            window.showToast(e.message || 'فشل تسجيل التسليم', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-truck ml-1.5"></i> تأكيد التسليم'; }
        }
    };

    // ── Archive ───────────────────────────────────────────────────────────────
    window.dvLoadArchive = async function() {
        const listEl  = _el('dv-archive-list');
        const statusF = _el('dv-archive-status-filter')?.value || '';
        const searchF = (_el('dv-archive-search')?.value || '').trim().toLowerCase();
        if (listEl) listEl.innerHTML = '';
        hideEl('dv-archive-empty'); showEl('dv-archive-loading');
        try {
            const res = await window.apiFetch('/api/delivery-notes');
            let notes = res.data || [];
            if (statusF) notes = notes.filter(dn => dn.status === statusF);
            if (searchF)  notes = notes.filter(dn =>
                (dn.client_name || '').toLowerCase().includes(searchF) ||
                String(dn.note_number || '').includes(searchF) ||
                String(dn.order_number || '').includes(searchF));
            hideEl('dv-archive-loading');
            if (!notes.length) { showEl('dv-archive-empty'); return; }

            const itemMap = {};
            await Promise.all(notes.map(async dn => {
                try { const r = await window.apiFetch('/api/delivery-notes/' + dn.id); itemMap[dn.id] = r.data?.items || []; }
                catch (_) { itemMap[dn.id] = []; }
            }));

            listEl.innerHTML = notes.map(dn => {
                const stBadge = dn.status === 'completed'
                    ? '<span class="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-lg font-bold">مكتمل</span>'
                    : dn.status === 'partial'
                        ? '<span class="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-lg font-bold">جزئي</span>'
                        : '<span class="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-lg font-bold">معلق</span>';
                const dnItems = itemMap[dn.id] || [];
                const itemRows = dnItems.map(i => {
                    const req = parseFloat(i.requested_qty || i.quantity || 0);
                    const del = parseFloat(i.delivered_qty || 0);
                    return `
                    <div class="flex items-center justify-between text-xs py-1.5 px-2 bg-slate-50 rounded-lg">
                        <div class="flex items-center gap-2">
                            <span class="text-slate-600">${esc(i.product_name || '—')} ${i.variant_name ? esc(i.variant_name) : ''}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-slate-400">مطلوب: ${req}</span>
                            <span class="font-bold text-emerald-600">سلّم: ${del}</span>
                        </div>
                    </div>`;
                }).join('');
                return `
                <div class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <div class="flex flex-wrap justify-between items-start gap-2 mb-3">
                        <div>
                            <div class="flex items-center gap-2 flex-wrap">${stBadge}
                                <span class="text-sm font-black text-slate-800">أمر فسح #${esc(String(dn.note_number || '—'))}</span>
                            </div>
                            <p class="text-xs text-slate-500 mt-1 font-bold">${esc(dn.client_name || '—')}</p>
                            <p class="text-xs text-slate-400">${dn.item_count || 0} أصناف — طلب #${esc(String(dn.order_number || '—'))} — ${fmtD(dn.created_at)}</p>
                        </div>
                        <div class="flex gap-2 flex-shrink-0">
                            ${dn.status === 'pending'
                                ? `<button onclick="window.dvOpenEditModal('${esc(dn.id)}')"
                                          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-700 border border-blue-200 rounded-xl hover:bg-blue-50 transition-colors">
                                       <i class="fa-solid fa-pen"></i>تعديل
                                   </button>` : ''}
                            ${dn.status !== 'pending'
                                ? `<button onclick="window.dvReverseDispatch('${esc(dn.id)}')"
                                          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-700 border border-red-200 rounded-xl hover:bg-red-50 transition-colors">
                                       <i class="fa-solid fa-rotate-left"></i>تراجع عن التسليم
                                   </button>` : ''}
                            ${dn.status !== 'completed'
                                ? `<button onclick="window.dvOpenDispatchModal('${esc(dn.id)}')"
                                          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-700 border border-amber-200 rounded-xl hover:bg-amber-50 transition-colors">
                                       <i class="fa-solid fa-truck"></i>تسليم جديد
                                   </button>` : ''}
                            <button onclick="window.dvPrintNote('${esc(dn.id)}')"
                                    class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
                                <i class="fa-solid fa-print"></i>طباعة
                            </button>
                        </div>
                    </div>
                    ${dnItems.length
                        ? `<div class="border-t border-slate-100 pt-3 space-y-1.5">
                               <p class="text-[10px] text-slate-400 font-bold mb-1">الأصناف (${dnItems.length})</p>
                               ${itemRows}</div>`
                        : '<p class="text-xs text-slate-300 border-t border-slate-100 pt-2 mt-1">لا توجد أصناف</p>'}
                </div>`;
            }).join('');
        } catch (e) { hideEl('dv-archive-loading'); window.showToast('فشل تحميل الأرشيف', 'error'); }
    };

    // ── Print delivery note ───────────────────────────────────────────────────
    window.dvPrintNote = async function(dnId) {
        try {
            const res = await window.apiFetch('/api/delivery-notes/' + dnId);
            const dn  = res?.data;
            if (!dn) { window.showToast('فشل تحميل السند', 'error'); return; }
            const itemsHTML = (dn.items || []).map((item, i) =>
                `<tr>
                <td style="padding:8px;border:1px solid #ddd;text-align:right">${i + 1}</td>
                <td style="padding:8px;border:1px solid #ddd;text-align:right">${item.product_name || '—'}${item.variant_name ? ' — ' + item.variant_name : ''}</td>
                <td style="padding:8px;border:1px solid #ddd;text-align:center">${item.requested_qty || item.quantity || 0}</td>
                <td style="padding:8px;border:1px solid #ddd;text-align:center">${item.delivered_qty || 0}</td>
                <td style="padding:8px;border:1px solid #ddd">${item.notes || ''}</td>
                </tr>`).join('');
            const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>أمر فسح #${dn.note_number}</title>
<style>body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;margin:0;padding:20px;color:#1e293b;direction:rtl}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #2563eb;padding-bottom:16px;margin-bottom:20px}
.company{font-size:22px;font-weight:bold;color:#2563eb}.doc-number{font-size:24px;font-weight:bold}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;background:#f8fafc;padding:16px;border-radius:8px}
.info-item label{font-size:11px;color:#64748b;display:block;margin-bottom:2px}.info-item span{font-weight:bold;font-size:14px}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
th{background:#1e40af;color:white;padding:10px 8px;text-align:right;font-size:13px;border:1px solid #1e40af}
td{font-size:13px}tr:nth-child(even) td{background:#f8fafc}
.footer{margin-top:40px;display:flex;justify-content:space-between;padding-top:20px;border-top:1px solid #e2e8f0}
.sig-box{text-align:center;width:160px}.sig-line{border-top:1px solid #333;margin-top:40px;padding-top:6px;font-size:12px;color:#64748b}
@media print{body{padding:10px}}</style></head><body>
<div class="header"><div><div class="company">G.PACK</div><div style="font-size:13px;color:#64748b">أمر فسح بضاعة</div></div>
<div style="text-align:left"><div style="font-size:12px;color:#64748b">رقم السند</div><div class="doc-number">#${dn.note_number}</div></div></div>
<div class="info-grid">
<div class="info-item"><label>العميل</label><span>${dn.client_name || '—'}</span></div>
<div class="info-item"><label>رقم الطلب</label><span>#${dn.order_number || '—'}</span></div>
<div class="info-item"><label>التاريخ</label><span>${new Date(dn.created_at).toLocaleDateString('en-GB')}</span></div>
<div class="info-item"><label>الحالة</label><span>${dn.status === 'completed' ? 'مكتمل' : dn.status === 'partial' ? 'جزئي' : 'معلق'}</span></div>
</div>
<table><thead><tr><th style="width:40px">#</th><th>الصنف / المقاس</th><th style="width:80px;text-align:center">المطلوب</th><th style="width:80px;text-align:center">المُسلَّم</th><th>ملاحظات</th></tr></thead>
<tbody>${itemsHTML || '<tr><td colspan="5" style="text-align:center;padding:16px;color:#94a3b8">لا توجد أصناف</td></tr>'}</tbody></table>
<div class="footer"><div class="sig-box"><div class="sig-line">توقيع المستلم</div></div><div class="sig-box"><div class="sig-line">توقيع المسلِّم</div></div><div class="sig-box"><div class="sig-line">الختم</div></div></div>
</body></html>`;
            const w = window.open('', '_blank', 'width=800,height=700');
            w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500);
        } catch (e) { window.showToast('فشل التحميل', 'error'); }
    };

    // ── Bootstrap ─────────────────────────────────────────────────────────────
    window.dvInit();

})();
