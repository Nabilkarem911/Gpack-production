'use strict';
// =============================================================================
// G.PACK 2.0 — Production Orders View Controller
// Namespace: window.poView
// =============================================================================

(function () {

    // ── State ──────────────────────────────────────────────────────────────────
    let _allOrders   = [];
    let _suppliers   = [];
    let _activeTab   = 'active';   // 'active' | 'completed' | 'archived'
    let _hubOrderId  = null;
    let _hubOrder    = null;
    let _hubItems    = [];
    let _hubMOs      = [];
    let _activeHubTab = 'items';
    let _bulkSelected = {}; // { [itemId]: { id, name, qty, assigned } }

    // ── Helpers ────────────────────────────────────────────────────────────────
    const _fmt = (n) => {
        if (n === null || n === undefined || isNaN(n)) return '—';
        return Number(n).toFixed(2);
    };

    const _fmtDate = (d) => {
        if (!d) return '—';
        return new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const STATUS_CFG = {
        production: { label: 'في الانتظار', cls: 'bg-amber-100 text-amber-700',   icon: 'fa-clock' },
        processing: { label: 'قيد التنفيذ', cls: 'bg-blue-100 text-blue-700',     icon: 'fa-gears' },
        completed:  { label: 'مكتمل',       cls: 'bg-emerald-100 text-emerald-700', icon: 'fa-circle-check' },
        delivered:  { label: 'مُسلَّم',     cls: 'bg-slate-100 text-slate-600',   icon: 'fa-truck' },
        cancelled:  { label: 'ملغي',        cls: 'bg-red-100 text-red-600',        icon: 'fa-ban' },
        archived:   { label: 'مؤرشف',       cls: 'bg-gray-100 text-gray-500',      icon: 'fa-box-archive' },
    };

    const STATUS_FLOW = {
        production: [{ s: 'processing', label: 'بدء التنفيذ',  cls: 'bg-blue-600 hover:bg-blue-700 text-white' }],
        processing: [{ s: 'completed',  label: 'تم الإكمال',   cls: 'bg-emerald-600 hover:bg-emerald-700 text-white' }],
        completed:  [{ s: 'delivered',  label: 'تم التسليم',   cls: 'bg-purple-600 hover:bg-purple-700 text-white' }],
    };

    const MO_STATUS_CFG = {
        pending:   { label: 'معلق',        cls: 'bg-amber-100 text-amber-700' },
        sent:      { label: 'مُرسل',       cls: 'bg-blue-100 text-blue-700' },
        received:  { label: 'مُستلم',      cls: 'bg-emerald-100 text-emerald-700' },
        cancelled: { label: 'ملغي',        cls: 'bg-red-100 text-red-600' },
    };

    function _badge(status, cfg) {
        const c = cfg[status] || { label: status, cls: 'bg-slate-100 text-slate-500' };
        return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${c.cls}">${c.label}</span>`;
    }

    function _toast(msg, type = 'success') {
        if (window.showToast) window.showToast(msg, type);
    }

    // ── Load orders list ───────────────────────────────────────────────────────
    async function _loadOrders() {
        try {
            const [activeRes, completedRes, archivedRes] = await Promise.all([
                window.apiFetch('/api/orders?statuses=production,processing'),
                window.apiFetch('/api/orders?status=completed'),
                window.apiFetch('/api/orders?status=delivered'),
            ]);
            const active   = (activeRes   && activeRes.data)   ? activeRes.data   : [];
            const completed= (completedRes&& completedRes.data) ? completedRes.data: [];
            const archived = (archivedRes && archivedRes.data)  ? archivedRes.data : [];
            _allOrders = { active, completed, archived };

            _updateStats(active, completed);
            _renderTable();
        } catch (err) {
            console.error('[poView] loadOrders:', err);
            _toast('فشل تحميل الأوامر', 'error');
        }
    }

    function _updateStats(active, completed) {
        const pending    = active.filter(o => o.status === 'production').length;
        const processing = active.filter(o => o.status === 'processing').length;
        const comp       = completed.length;
        const unpaid     = [...active, ...completed].filter(o => {
            const rem = parseFloat(o.grand_total || 0) - parseFloat(o.paid_amount || 0);
            return rem > 0.01;
        }).length;

        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('po-stat-pending',    pending);
        set('po-stat-processing', processing);
        set('po-stat-completed',  comp);
        set('po-stat-unpaid',     unpaid);
    }

    // ── Render table ───────────────────────────────────────────────────────────
    function _renderTable() {
        const tbody = document.getElementById('po-tbody');
        const empty = document.getElementById('po-empty');
        if (!tbody) return;

        let list = (_allOrders[_activeTab] || []);

        // Apply search filter
        const q = (document.getElementById('po-search') || {}).value || '';
        if (q.trim()) {
            const lq = q.toLowerCase();
            list = list.filter(o =>
                String(o.order_number).includes(lq) ||
                (o.client_name || '').toLowerCase().includes(lq)
            );
        }

        if (!list.length) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        tbody.innerHTML = list.map(o => {
            const remaining = parseFloat(o.grand_total || 0) - parseFloat(o.paid_amount || 0);
            const hasDebt   = remaining > 0.01;
            return `<tr class="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                <td class="py-3 px-4">
                    <span class="font-mono text-sm font-bold text-brand-600">#${o.order_number}</span>
                </td>
                <td class="py-3 px-4">
                    <span class="text-sm font-semibold text-slate-800">${o.client_name || '—'}</span>
                </td>
                <td class="py-3 px-4 hidden sm:table-cell text-xs text-slate-500">${_fmtDate(o.order_date)}</td>
                <td class="py-3 px-4 hidden md:table-cell text-sm font-semibold text-slate-700">${_fmt(o.grand_total)} ر.س</td>
                <td class="py-3 px-4 hidden md:table-cell">
                    ${hasDebt
                        ? `<span class="text-xs font-bold text-red-600">${_fmt(remaining)} ر.س</span>`
                        : `<span class="text-xs font-bold text-emerald-600">مسدد ✓</span>`
                    }
                </td>
                <td class="py-3 px-4">${_badge(o.status, STATUS_CFG)}</td>
                <td class="py-3 px-4 text-center">
                    <button onclick="window.poView.openHub('${o.id}')"
                            class="inline-flex items-center gap-1.5 px-3 py-2 bg-brand-600 hover:bg-brand-700
                                   text-white text-xs font-bold rounded-lg transition-all active:scale-[0.97]">
                        <i class="fa-solid fa-pen-to-square"></i> إدارة
                    </button>
                </td>
            </tr>`;
        }).join('');
    }

    // ── Load suppliers ─────────────────────────────────────────────────────────
    async function _loadSuppliers() {
        try {
            const res = await window.apiFetch('/api/suppliers?status=active');
            _suppliers = (res && res.data) ? res.data : [];
        } catch (_) { _suppliers = []; }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ORDER HUB
    // ══════════════════════════════════════════════════════════════════════════

    async function _openHub(orderId) {
        _hubOrderId = orderId;
        _activeHubTab = 'items';
        _showModal('po-hub-modal');

        // Show loading state
        const area = document.getElementById('hub-content-area');
        if (area) area.innerHTML = '<div class="flex items-center justify-center py-20 text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-3xl"></i></div>';

        try {
            const [orderRes, moRes] = await Promise.all([
                window.apiFetch(`/api/orders/${orderId}`),
                window.apiFetch(`/api/manufacturer-orders/by-order/${orderId}`),
            ]);
            _hubOrder = orderRes && orderRes.data;
            _hubItems = (_hubOrder && _hubOrder.items) ? _hubOrder.items : [];
            _hubMOs   = (moRes && moRes.data) ? moRes.data : [];

            if (!_hubOrder) throw new Error('لم يتم إيجاد الأمر');

            _renderHubHeader();
            _restoreHubContent();
            _switchHubTab('items');
        } catch (err) {
            console.error('[poView] openHub:', err);
            _toast('فشل تحميل بيانات الأمر', 'error');
        }
    }

    function _renderHubHeader() {
        if (!_hubOrder) return;
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        const setHTML = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };

        set('hub-title',      `إدارة أمر #${_hubOrder.order_number}`);
        set('hub-client',     _hubOrder.client_name || '—');
        set('hub-order-num',  `#${_hubOrder.order_number}`);
        setHTML('hub-status-badge', _badge(_hubOrder.status, STATUS_CFG));

        const gt  = parseFloat(_hubOrder.grand_total  || 0);
        const pd  = parseFloat(_hubOrder.paid_amount  || 0);
        const rem = Math.max(0, gt - pd);

        const fmtSAR = (v) => `${_fmt(v)} ر.س`;
        set('hub-grand-total',        fmtSAR(gt));
        set('hub-paid',               fmtSAR(pd));
        set('hub-remaining',          fmtSAR(rem));
        set('hub-grand-total-mobile', fmtSAR(gt));
        set('hub-paid-mobile',        fmtSAR(pd));
        set('hub-remaining-mobile',   fmtSAR(rem));
    }

    function _restoreHubContent() {
        // Restore original tab content structure
        const area = document.getElementById('hub-content-area');
        if (!area) return;
        area.innerHTML = `
            <div id="hub-tab-items-content"></div>
            <div id="hub-tab-financial-content" class="hidden"></div>
            <div id="hub-tab-delivery-content" class="hidden"></div>
            <div id="hub-tab-notes-content" class="hidden"></div>
        `;
        _renderHubItems();
        _renderHubFinancial();
        _renderHubDelivery();
        _renderHubNotes();
    }

    // ── Hub: Items tab ─────────────────────────────────────────────────────────
    function _renderHubItems() {
        const el = document.getElementById('hub-tab-items-content');
        if (!el) return;

        // Reset bulk selection
        _bulkSelected = {};
        _updateBulkBtn();

        // Status actions
        const nextSteps = (STATUS_FLOW[_hubOrder.status] || []);
        const statusActionsHTML = nextSteps.map(s =>
            `<button onclick="window.poView.updateStatus('${s.s}')"
                     class="flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-xl shadow transition-all active:scale-[0.98] ${s.cls}">
                <i class="fa-solid fa-arrow-right"></i> ${s.label}
             </button>`
        ).join('');

        // Items rows
        const itemsHTML = _hubItems.map(item => {
            const assigned  = parseFloat(item.manufacturer_po_qty || 0);
            const received  = parseFloat(item.wh_received_qty    || 0);
            const qty       = parseFloat(item.quantity           || 0);
            const canAssign = qty - assigned > 0;
            const safeId    = item.id.replace(/'/g, "\\'");
            const safeName  = ((item.product_name || '') + ' ' + (item.size_name || '')).trim().replace(/'/g, "\\'");
            return `<tr class="border-b border-slate-50 hover:bg-slate-50/30" id="item-row-${item.id}">
                <td class="py-2.5 px-3">
                    ${canAssign
                        ? `<input type="checkbox" data-item-id="${item.id}" data-item-name="${safeName}" data-item-qty="${qty}" data-item-assigned="${assigned}"
                                  onchange="window.poView.toggleItemCheck(this)"
                                  class="w-4 h-4 rounded accent-purple-600 cursor-pointer">`
                        : `<span class="block w-4 h-4"></span>`
                    }
                </td>
                <td class="py-2.5 px-4 text-sm">
                    <span class="font-semibold text-slate-800">${item.product_name || '—'}</span>
                    ${item.size_name ? `<span class="text-xs text-slate-400 mr-1">${item.size_name}</span>` : ''}
                </td>
                <td class="py-2.5 px-4 text-center text-sm font-bold text-slate-700">${qty}</td>
                <td class="py-2.5 px-4 text-center text-sm hidden sm:table-cell">
                    <span class="${assigned > 0 ? 'text-blue-600 font-bold' : 'text-slate-400'}">${assigned}</span>
                </td>
                <td class="py-2.5 px-4 text-center text-sm hidden sm:table-cell">
                    <span class="${received > 0 ? 'text-emerald-600 font-bold' : 'text-slate-400'}">${received}</span>
                </td>
                <td class="py-2.5 px-4 text-center">
                    ${canAssign
                        ? `<button onclick="window.poView.openAssignModal('${safeId}', '${safeName}', ${qty}, ${assigned})"
                                   class="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 text-xs font-bold rounded-lg transition-all">
                               <i class="fa-solid fa-plus"></i> إسناد
                           </button>`
                        : `<span class="text-xs text-slate-400">مكتمل</span>`
                    }
                </td>
            </tr>`;
        }).join('');

        // MO list
        const moListHTML = _hubMOs.map(mo => {
            const canReceive = mo.status === 'sent';
            const canMarkOrdered = mo.status === 'pending';
            return `<div class="bg-white border border-slate-200 rounded-xl p-4">
                <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-truck-ramp-box text-purple-400"></i>
                        <span class="text-sm font-bold text-slate-800">${mo.supplier_name || '—'}</span>
                        ${_badge(mo.status, MO_STATUS_CFG)}
                    </div>
                    <div class="flex gap-2">
                        <button onclick="window.poView.downloadMOPrint('${mo.id}')"
                                class="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 text-xs font-bold rounded-lg transition-all"
                                title="تحميل ملف الطباعة">
                                <i class="fa-solid fa-file-pdf"></i> ملف الطباعة
                        </button>
                        ${canMarkOrdered ? `<button onclick="window.poView.updateMOStatus('${mo.id}','sent')"
                                class="px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-bold rounded-lg transition-all">
                                <i class="fa-solid fa-paper-plane"></i> تم الإرسال
                            </button>` : ''}
                        ${canReceive ? `<button onclick="window.poView.openReceiveModal('${mo.id}')"
                                class="px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-xs font-bold rounded-lg transition-all">
                                <i class="fa-solid fa-box-open"></i> استلام بضاعة
                            </button>` : ''}
                    </div>
                </div>
                <div class="text-xs text-slate-500">
                    ${mo.expected_delivery ? `تسليم متوقع: <b class="text-slate-700">${_fmtDate(mo.expected_delivery)}</b>` : ''}
                    ${mo.notes ? ` | ملاحظات: ${mo.notes}` : ''}
                </div>
                ${mo.items && mo.items.length ? `
                    <div class="mt-2 space-y-1">
                        ${mo.items.map(i => `
                            <div class="flex justify-between text-xs bg-slate-50 rounded-lg px-3 py-1.5">
                                <span class="text-slate-600">${i.product_name || ''} ${i.size_name || ''}</span>
                                <span class="font-bold text-slate-700">
                                    ${i.po_quantity} مطلوب
                                    ${i.wh_received_qty > 0 ? `/ <span class="text-emerald-600">${i.wh_received_qty} مستلم</span>` : ''}
                                </span>
                            </div>`).join('')}
                    </div>` : ''}
            </div>`;
        }).join('');

        el.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-xl p-4 mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <p class="text-sm font-bold text-slate-700">حالة الأمر</p>
                    <p class="text-xs text-slate-400 mt-0.5">تحديث مرحلة الإنتاج</p>
                </div>
                <div class="flex flex-wrap gap-2">${statusActionsHTML || '<span class="text-xs text-slate-400">لا يوجد إجراء متاح</span>'}</div>
            </div>
            <h3 class="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <i class="fa-solid fa-box text-brand-400"></i> بنود الطلب
            </h3>
            <div class="bg-white border border-slate-200 rounded-xl overflow-hidden mb-5">
                <table class="w-full text-sm">
                    <thead class="bg-slate-50 border-b border-slate-100">
                        <tr>
                            <th class="text-right py-2.5 px-4 text-xs font-bold text-slate-500">المنتج / المقاس</th>
                            <th class="text-center py-2.5 px-4 text-xs font-bold text-slate-500">الكمية</th>
                            <th class="text-center py-2.5 px-4 text-xs font-bold text-slate-500 hidden sm:table-cell">مُسندة</th>
                            <th class="text-center py-2.5 px-4 text-xs font-bold text-slate-500 hidden sm:table-cell">مستلمة</th>
                            <th class="text-center py-2.5 px-4 text-xs font-bold text-slate-500">إسناد</th>
                        </tr>
                    </thead>
                    <tbody>${itemsHTML || '<tr><td colspan="5" class="py-6 text-center text-slate-400 text-xs">لا توجد بنود</td></tr>'}</tbody>
                </table>
            </div>
            <h3 class="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <i class="fa-solid fa-truck-ramp-box text-purple-400"></i> أوامر الموردين
            </h3>
            ${moListHTML
                ? `<div class="space-y-3">${moListHTML}</div>`
                : `<div class="bg-slate-50 rounded-xl py-8 text-center text-slate-400 text-sm">
                       لا توجد أوامر موردين — استخدم زرار "إسناد" في الجدول أعلاه
                   </div>`
            }`;
    }

    // ── Hub: Financial tab ────────────────────────────────────────────────────
    async function _renderHubFinancial() {
        const el = document.getElementById('hub-tab-financial-content');
        if (!el) return;

        const gt  = parseFloat(_hubOrder.grand_total  || 0);
        const pd  = parseFloat(_hubOrder.paid_amount  || 0);
        const rem = Math.max(0, gt - pd);

        el.innerHTML = `
            <div class="grid grid-cols-3 gap-3 mb-5 md:hidden">
                <div class="bg-slate-50 rounded-xl p-3 text-center">
                    <p class="text-xs text-slate-400 mb-1">الإجمالي</p>
                    <p class="text-sm font-bold text-slate-800">${_fmt(gt)} ر.س</p>
                </div>
                <div class="bg-emerald-50 rounded-xl p-3 text-center">
                    <p class="text-xs text-emerald-500 mb-1">المدفوع</p>
                    <p class="text-sm font-bold text-emerald-700">${_fmt(pd)} ر.س</p>
                </div>
                <div class="bg-red-50 rounded-xl p-3 text-center">
                    <p class="text-xs text-red-400 mb-1">المتبقي</p>
                    <p class="text-sm font-bold text-red-600">${_fmt(rem)} ر.س</p>
                </div>
            </div>
            <div class="flex flex-wrap gap-2 mb-5">
                <button onclick="window.poView.openInvoiceModal()"
                        class="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl shadow transition-all active:scale-[0.98]">
                    <i class="fa-solid fa-file-invoice"></i> إصدار فاتورة
                </button>
                <button onclick="window.poView.openPaymentModal()"
                        class="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow transition-all active:scale-[0.98]">
                    <i class="fa-solid fa-money-bill-wave"></i> تسجيل دفعة
                </button>
            </div>
            <div id="hub-invoices-section"></div>
            <div id="hub-payments-section" class="mt-5"></div>`;

        // Load financial data
        try {
            const res = await window.apiFetch(`/api/orders/${_hubOrderId}/financial`);
            const fin = res && res.data;
            if (!fin) return;

            // Invoices
            const invEl = document.getElementById('hub-invoices-section');
            if (invEl) {
                const invRows = (fin.invoices || []).map(inv =>
                    `<tr class="border-b border-slate-50 hover:bg-slate-50/50">
                        <td class="py-2.5 px-4 text-sm font-mono font-bold text-slate-700">#${inv.invoice_number}</td>
                        <td class="py-2.5 px-4 text-xs text-slate-500 hidden sm:table-cell">${_fmtDate(inv.invoice_date)}</td>
                        <td class="py-2.5 px-4">
                            <span class="text-xs px-2 py-1 rounded-lg font-bold ${inv.status === 'issued' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
                                ${inv.status === 'issued' ? 'نهائية' : 'أولية'}
                            </span>
                        </td>
                        <td class="py-2.5 px-4 text-sm font-bold text-slate-800">${_fmt(inv.grand_total)} ر.س</td>
                    </tr>`
                ).join('');
                invEl.innerHTML = `
                    <h3 class="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                        <i class="fa-solid fa-file-invoice text-blue-400"></i> الفواتير الصادرة
                    </h3>
                    <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <table class="w-full text-sm">
                            <thead class="bg-slate-50 border-b border-slate-100">
                                <tr>
                                    <th class="text-right py-2.5 px-4 text-xs font-bold text-slate-500">رقم الفاتورة</th>
                                    <th class="text-right py-2.5 px-4 text-xs font-bold text-slate-500 hidden sm:table-cell">التاريخ</th>
                                    <th class="text-right py-2.5 px-4 text-xs font-bold text-slate-500">النوع</th>
                                    <th class="text-right py-2.5 px-4 text-xs font-bold text-slate-500">الإجمالي</th>
                                </tr>
                            </thead>
                            <tbody>${invRows || '<tr><td colspan="4" class="py-6 text-center text-slate-400 text-xs">لا توجد فواتير</td></tr>'}</tbody>
                        </table>
                    </div>`;
            }

            // Payments
            const payEl = document.getElementById('hub-payments-section');
            if (payEl) {
                const PAY_METHODS = { cash: 'نقدي', bank_transfer: 'تحويل بنكي', pos: 'نقاط البيع' };
                const payRows = (fin.payments || []).map(p =>
                    `<tr class="border-b border-slate-50 hover:bg-slate-50/50">
                        <td class="py-2.5 px-4 text-xs text-slate-500">${_fmtDate(p.created_at)}</td>
                        <td class="py-2.5 px-4 text-xs text-slate-600">${PAY_METHODS[p.payment_method] || p.payment_method}</td>
                        <td class="py-2.5 px-4 text-sm font-bold text-emerald-700">${_fmt(p.amount)} ر.س</td>
                        <td class="py-2.5 px-4 text-xs text-slate-400 hidden sm:table-cell">${p.description || '—'}</td>
                    </tr>`
                ).join('');
                payEl.innerHTML = `
                    <h3 class="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                        <i class="fa-solid fa-money-check-dollar text-emerald-500"></i> سجل الدفعات
                    </h3>
                    <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <table class="w-full text-sm">
                            <thead class="bg-slate-50 border-b border-slate-100">
                                <tr>
                                    <th class="text-right py-2.5 px-4 text-xs font-bold text-slate-500">التاريخ</th>
                                    <th class="text-right py-2.5 px-4 text-xs font-bold text-slate-500">طريقة الدفع</th>
                                    <th class="text-right py-2.5 px-4 text-xs font-bold text-slate-500">المبلغ</th>
                                    <th class="text-right py-2.5 px-4 text-xs font-bold text-slate-500 hidden sm:table-cell">ملاحظات</th>
                                </tr>
                            </thead>
                            <tbody>${payRows || '<tr><td colspan="4" class="py-6 text-center text-slate-400 text-xs">لا توجد دفعات</td></tr>'}</tbody>
                        </table>
                    </div>`;
            }
        } catch (err) {
            console.error('[poView] financial:', err);
        }
    }

    // ── Hub: Delivery tab ──────────────────────────────────────────────────────
    async function _renderHubDelivery() {
        const el = document.getElementById('hub-tab-delivery-content');
        if (!el) return;

        el.innerHTML = `
            <div class="flex justify-end mb-4">
                <button onclick="window.poView.openDeliveryModal()"
                        class="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold rounded-xl shadow transition-all active:scale-[0.98]">
                    <i class="fa-solid fa-truck-fast"></i> إصدار سند تسليم
                </button>
            </div>
            <div id="hub-delivery-list"><div class="py-8 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div>`;

        try {
            const res = await window.apiFetch(`/api/delivery-notes?order_id=${_hubOrderId}`);
            const notes = (res && res.data) ? res.data : [];
            const listEl = document.getElementById('hub-delivery-list');
            if (!listEl) return;

            if (!notes.length) {
                listEl.innerHTML = '<div class="bg-slate-50 rounded-xl py-8 text-center text-slate-400 text-sm">لا توجد سندات تسليم</div>';
                return;
            }

            const DN_STATUS = {
                pending:   { label: 'معلق',    cls: 'bg-amber-100 text-amber-700' },
                delivered: { label: 'مُسلَّم', cls: 'bg-emerald-100 text-emerald-700' },
            };

            listEl.innerHTML = `
                <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <table class="w-full text-sm">
                        <thead class="bg-slate-50 border-b border-slate-100">
                            <tr>
                                <th class="text-right py-2.5 px-4 text-xs font-bold text-slate-500">رقم السند</th>
                                <th class="text-right py-2.5 px-4 text-xs font-bold text-slate-500 hidden sm:table-cell">التاريخ</th>
                                <th class="text-right py-2.5 px-4 text-xs font-bold text-slate-500">الحالة</th>
                                <th class="text-right py-2.5 px-4 text-xs font-bold text-slate-500">ملاحظات</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${notes.map(dn => `
                                <tr class="border-b border-slate-50 hover:bg-slate-50/50">
                                    <td class="py-2.5 px-4 font-mono font-bold text-slate-700">#${dn.note_number}</td>
                                    <td class="py-2.5 px-4 text-xs text-slate-500 hidden sm:table-cell">${_fmtDate(dn.created_at)}</td>
                                    <td class="py-2.5 px-4">${_badge(dn.status, DN_STATUS)}</td>
                                    <td class="py-2.5 px-4 text-xs text-slate-400">${dn.notes || '—'}</td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>`;
        } catch (err) {
            console.error('[poView] delivery:', err);
        }
    }

    // ── Hub: Notes tab ─────────────────────────────────────────────────────────
    function _renderHubNotes() {
        const el = document.getElementById('hub-tab-notes-content');
        if (!el) return;
        el.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-xl p-4">
                <h3 class="text-sm font-bold text-slate-700 mb-3">ملاحظات داخلية</h3>
                <textarea id="hub-notes-input" rows="5"
                          class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800
                                 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all resize-none"
                          placeholder="أضف ملاحظات داخلية...">${_hubOrder.internal_notes || ''}</textarea>
                <div class="flex justify-end mt-3">
                    <button onclick="window.poView.saveNotes()"
                            class="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl transition-all active:scale-[0.98]">
                        <i class="fa-solid fa-floppy-disk"></i> حفظ الملاحظات
                    </button>
                </div>
            </div>`;
    }

    // ── Switch Hub Tab ─────────────────────────────────────────────────────────
    function _switchHubTab(tab) {
        _activeHubTab = tab;
        ['items','financial','delivery','notes'].forEach(t => {
            const btn = document.getElementById(`hub-tab-${t}`);
            const content = document.getElementById(`hub-tab-${t}-content`);
            if (btn) {
                if (t === tab) {
                    btn.className = btn.className
                        .replace('text-slate-500', 'text-brand-600')
                        .replace('border-transparent', 'border-brand-600');
                } else {
                    btn.className = btn.className
                        .replace('text-brand-600', 'text-slate-500')
                        .replace('border-brand-600', 'border-transparent');
                }
            }
            if (content) content.classList.toggle('hidden', t !== tab);
        });
    }

    // ── Update order status ────────────────────────────────────────────────────
    async function _updateStatus(newStatus) {
        if (!confirm(`تأكيد تغيير الحالة إلى "${STATUS_CFG[newStatus]?.label}"؟`)) return;
        try {
            await window.apiFetch(`/api/orders/${_hubOrderId}/status`, {
                method: 'PATCH',
                body: { status: newStatus },
            });
            _toast('تم تحديث الحالة بنجاح');
            await _loadOrders();
            await _openHub(_hubOrderId);
        } catch (err) {
            _toast(err.message || 'فشل تحديث الحالة', 'error');
        }
    }

    // ── Assign supplier modal ──────────────────────────────────────────────────
    function _openAssignModal(orderItemId, itemName, qty, assigned) {
        const available = qty - assigned;
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

        setVal('assign-order-item-id', orderItemId);
        setVal('assign-order-id', _hubOrderId);
        set('assign-item-name',      itemName);
        set('assign-item-qty',       qty);
        set('assign-item-assigned',  assigned);
        set('assign-item-available', available);
        setVal('assign-qty', available > 0 ? available : '');
        setVal('assign-unit-cost', '');
        setVal('assign-expected-delivery', '');
        setVal('assign-notes', '');

        const sel = document.getElementById('assign-supplier-select');
        if (sel) {
            sel.innerHTML = '<option value="">— اختر المورد —</option>' +
                _suppliers.map(s => `<option value="${s.id}">${s.company_name || s.name}</option>`).join('');
        }
        _showModal('po-assign-modal');
    }

    async function _saveAssignment() {
        const orderItemId = (document.getElementById('assign-order-item-id') || {}).value;
        const orderId     = (document.getElementById('assign-order-id')      || {}).value;
        const supplierId  = (document.getElementById('assign-supplier-select')|| {}).value;
        const qty         = parseFloat((document.getElementById('assign-qty') || {}).value);
        const unitCost    = parseFloat((document.getElementById('assign-unit-cost') || {}).value) || 0;
        const expDelivery = (document.getElementById('assign-expected-delivery') || {}).value;
        const notes       = (document.getElementById('assign-notes') || {}).value;

        if (!supplierId) { _toast('اختر المورد', 'error'); return; }
        if (!qty || qty <= 0) { _toast('أدخل كمية صحيحة', 'error'); return; }

        try {
            await window.apiFetch('/api/manufacturer-orders', {
                method: 'POST',
                body: {
                    order_id: orderId,
                    supplier_id: supplierId,
                    items: [{ order_item_id: orderItemId, quantity: qty, unit_cost: unitCost }],
                    expected_delivery: expDelivery || null,
                    notes: notes || null,
                },
            });
            _toast('تم إنشاء أمر التشغيل للمورد');
            _hideModal('po-assign-modal');
            await _openHub(_hubOrderId);
        } catch (err) {
            _toast(err.message || 'فشل إنشاء أمر التشغيل', 'error');
        }
    }

    // ── Bulk Selection Helpers ────────────────────────────────────────────────
    function _updateBulkBtn() {
        const count = Object.keys(_bulkSelected).length;
        const btn   = document.getElementById('hub-bulk-assign-btn');
        const badge = document.getElementById('hub-bulk-count');
        if (!btn) return;
        if (count > 0) {
            btn.classList.remove('hidden');
            btn.classList.add('flex');
            if (badge) badge.textContent = count;
        } else {
            btn.classList.add('hidden');
            btn.classList.remove('flex');
        }
    }

    function _toggleItemCheck(cb) {
        const id       = cb.dataset.itemId;
        const name     = cb.dataset.itemName;
        const qty      = parseFloat(cb.dataset.itemQty);
        const assigned = parseFloat(cb.dataset.itemAssigned);
        if (cb.checked) {
            _bulkSelected[id] = { id, name, qty, assigned };
        } else {
            delete _bulkSelected[id];
        }
        _updateBulkBtn();

        // Sync check-all checkbox
        const checkAll = document.getElementById('hub-items-check-all');
        if (checkAll) {
            const allCbs = document.querySelectorAll('#hub-items-tbody input[type="checkbox"]');
            checkAll.checked = allCbs.length > 0 && [...allCbs].every(c => c.checked);
        }
    }

    function _toggleAllItems(checked) {
        _bulkSelected = {};
        const allCbs = document.querySelectorAll('#hub-items-tbody input[type="checkbox"]');
        allCbs.forEach(cb => {
            cb.checked = checked;
            if (checked) {
                _bulkSelected[cb.dataset.itemId] = {
                    id:       cb.dataset.itemId,
                    name:     cb.dataset.itemName,
                    qty:      parseFloat(cb.dataset.itemQty),
                    assigned: parseFloat(cb.dataset.itemAssigned),
                };
            }
        });
        _updateBulkBtn();
    }

    function _openBulkAssignModal() {
        const items = Object.values(_bulkSelected);
        if (!items.length) { _toast('اختر صنفاً واحداً على الأقل', 'error'); return; }

        // Populate items summary
        const summaryEl = document.getElementById('bulk-items-summary');
        if (summaryEl) {
            summaryEl.innerHTML = items.map(i => {
                const available = i.qty - i.assigned;
                return `<div class="flex items-center justify-between px-3 py-2.5 text-sm">
                    <span class="font-semibold text-slate-800">${i.name}</span>
                    <span class="text-xs text-purple-600 font-bold bg-purple-50 px-2 py-0.5 rounded-full">${available} وحدة</span>
                </div>`;
            }).join('');
        }

        // Populate supplier dropdown
        const sel = document.getElementById('bulk-supplier-select');
        if (sel) {
            sel.innerHTML = '<option value="">— اختر المورد —</option>' +
                _suppliers.map(s => `<option value="${s.id}">${s.company_name || s.name}</option>`).join('');
        }

        // Reset fields
        const deliveryEl = document.getElementById('bulk-expected-delivery');
        const notesEl    = document.getElementById('bulk-notes');
        if (deliveryEl) deliveryEl.value = '';
        if (notesEl)    notesEl.value    = '';
        const defaultRadio = document.querySelector('input[name="bulk-design-status"][value="new"]');
        if (defaultRadio) defaultRadio.checked = true;

        _showModal('po-bulk-assign-modal');
    }

    async function _saveBulkAssignment() {
        const supplierId   = (document.getElementById('bulk-supplier-select')    || {}).value;
        const expDelivery  = (document.getElementById('bulk-expected-delivery')  || {}).value;
        const notes        = (document.getElementById('bulk-notes')              || {}).value;
        const designStatus = (document.querySelector('input[name="bulk-design-status"]:checked') || {}).value || 'new';

        if (!supplierId) { _toast('اختر المورد', 'error'); return; }

        const items = Object.values(_bulkSelected).map(i => ({
            order_item_id: i.id,
            quantity:      i.qty - i.assigned,
            design_status: designStatus,
        }));

        if (!items.length) { _toast('لا توجد أصناف محددة', 'error'); return; }

        const btn = document.getElementById('bulk-save-btn');
        try {
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جاري الإنشاء...'; }

            await window.apiFetch('/api/manufacturer-orders', {
                method: 'POST',
                body: {
                    order_id:          _hubOrderId,
                    supplier_id:       supplierId,
                    items,
                    expected_delivery: expDelivery || null,
                    notes:             notes       || null,
                },
            });

            _toast(`تم إنشاء أمر التشغيل المجمع بـ ${items.length} أصناف`);
            _hideModal('po-bulk-assign-modal');
            await _openHub(_hubOrderId);
        } catch (err) {
            _toast(err.message || 'فشل إنشاء أمر التشغيل المجمع', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-layer-group ml-1"></i> إنشاء أمر التشغيل المجمع'; }
        }
    }

    // ── Update MO status ───────────────────────────────────────────────────────
    async function _updateMOStatus(moId, newStatus) {
        try {
            await window.apiFetch(`/api/manufacturer-orders/${moId}/status`, {
                method: 'PATCH',
                body: { status: newStatus },
            });
            _toast('تم تحديث حالة أمر المورد');
            await _openHub(_hubOrderId);
        } catch (err) {
            _toast(err.message || 'فشل تحديث الحالة', 'error');
        }
    }

    // ── Invoice modal ──────────────────────────────────────────────────────────
    function _openInvoiceModal() {
        // Build items from order items
        const container = document.getElementById('invoice-items-container');
        if (container) {
            container.innerHTML = _hubItems.map(item =>
                `<div class="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0">
                    <div class="flex-1 text-sm text-slate-700 font-semibold">
                        ${item.product_name || '—'} ${item.size_name || ''}
                    </div>
                    <input type="hidden" data-variant-id="${item.variant_id}">
                    <div class="flex items-center gap-2">
                        <input type="number" min="0" max="${item.quantity}" step="1" value="${item.quantity}"
                               data-item-qty
                               class="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center outline-none focus:border-brand-500"
                               placeholder="الكمية" oninput="window.poView.calcInvoiceTotal()">
                        <input type="number" min="0" step="0.01" value="${parseFloat(item.unit_price||0).toFixed(2)}"
                               data-item-price
                               class="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center outline-none focus:border-brand-500"
                               placeholder="السعر" oninput="window.poView.calcInvoiceTotal()">
                    </div>
                 </div>`
            ).join('') || '<p class="text-sm text-slate-400 text-center py-3">لا توجد بنود</p>';
        }

        const notesEl = document.getElementById('invoice-notes');
        if (notesEl) notesEl.value = '';
        const expEl = document.getElementById('invoice-extra-expenses');
        if (expEl) expEl.value = '';
        const expDescEl = document.getElementById('invoice-extra-desc');
        if (expDescEl) expDescEl.value = '';
        const discEl = document.getElementById('invoice-discount');
        if (discEl) discEl.value = '';
        _calcInvoiceTotal();
        _showModal('po-invoice-modal');
    }

    function _calcInvoiceTotal() {
        const container = document.getElementById('invoice-items-container');
        if (!container) return;
        let subtotal = 0;
        container.querySelectorAll('[data-item-qty]').forEach((qtyEl, i) => {
            const priceEl = container.querySelectorAll('[data-item-price]')[i];
            if (priceEl) subtotal += parseFloat(qtyEl.value||0) * parseFloat(priceEl.value||0);
        });
        const discount = parseFloat((document.getElementById('invoice-discount')||{}).value||0);
        const extra = parseFloat((document.getElementById('invoice-extra-expenses')||{}).value||0);
        const afterDiscount = Math.max(0, subtotal - discount);
        const tax   = afterDiscount * 0.15;
        const total = afterDiscount + tax + extra;
        const el = document.getElementById('invoice-total-display');
        if (el) el.textContent = `${_fmt(total)} ر.س`;
    }

    async function _saveInvoice() {
        const type     = (document.getElementById('invoice-type')             ||{}).value || 'proforma';
        const extra    = parseFloat((document.getElementById('invoice-extra-expenses')||{}).value)||0;
        const extraDesc= ((document.getElementById('invoice-extra-desc')||{}).value || '').trim();
        const discount = parseFloat((document.getElementById('invoice-discount')||{}).value)||0;
        const notes    = (document.getElementById('invoice-notes')             ||{}).value || '';
        const container= document.getElementById('invoice-items-container');
        if (!container) return;

        const items = [];
        const qtyEls   = container.querySelectorAll('[data-item-qty]');
        const priceEls = container.querySelectorAll('[data-item-price]');
        const variantEls = container.querySelectorAll('[data-variant-id]');

        for (let i = 0; i < qtyEls.length; i++) {
            const qty   = parseFloat(qtyEls[i].value);
            const price = parseFloat(priceEls[i].value);
            const vid   = variantEls[i]?.getAttribute('data-variant-id');
            if (qty > 0 && price > 0 && vid) {
                items.push({ variant_id: vid, qty, unit_price: price });
            }
        }

        if (!items.length) { _toast('أضف بنداً واحداً على الأقل', 'error'); return; }

        try {
            await window.apiFetch(`/api/orders/${_hubOrderId}/invoice`, {
                method: 'POST',
                body: { type, items, additional_expenses: extra, additional_expense_label: extraDesc, discount_amount: discount, notes },
            });
            _toast('تم إصدار الفاتورة بنجاح');
            _hideModal('po-invoice-modal');
            const expInput = document.getElementById('invoice-extra-expenses');
            if (expInput) expInput.value = '';
            const expDescInput = document.getElementById('invoice-extra-desc');
            if (expDescInput) expDescInput.value = '';
            const discInput = document.getElementById('invoice-discount');
            if (discInput) discInput.value = '';
            await _renderHubFinancial();
        } catch (err) {
            _toast(err.message || 'فشل إصدار الفاتورة', 'error');
        }
    }

    // ── Payment modal ──────────────────────────────────────────────────────────
    let _poCashBoxes = [];
    let _poBankAccounts = [];
    let _poPosTerminals = [];

    async function _loadPaymentLookups() {
        try {
            const [cashRes, bankRes, posRes] = await Promise.all([
                window.apiFetch('/api/orders/lookup/cash-accounts'),
                window.apiFetch('/api/orders/lookup/bank-accounts'),
                window.apiFetch('/api/orders/lookup/pos-terminals'),
            ]);
            _poCashBoxes = (cashRes && cashRes.data) || [];
            _poBankAccounts = (bankRes && bankRes.data) || [];
            _poPosTerminals = (posRes && posRes.data) || [];
        } catch (e) {
            console.error('Failed to load payment lookups:', e);
        }
    }

    function _populatePaymentSelects() {
        const cashSelect = document.getElementById('payment-cash-box');
        const bankSelect = document.getElementById('payment-bank-account');
        const posSelect  = document.getElementById('payment-pos-terminal');

        if (cashSelect) {
            cashSelect.innerHTML = _poCashBoxes.map(b =>
                `<option value="${b.code}">${b.name}${b.location ? ' — ' + b.location : ''}</option>`
            ).join('') || '<option value="">— لا يوجد صناديق —</option>';
        }
        if (bankSelect) {
            bankSelect.innerHTML = _poBankAccounts.map(b =>
                `<option value="${b.code}">${b.code} — ${b.name}</option>`
            ).join('') || '<option value="">— لا يوجد حسابات بنكية —</option>';
        }
        if (posSelect) {
            posSelect.innerHTML = _poPosTerminals.map(t =>
                `<option value="${t.code}">${t.name}${t.location ? ' — ' + t.location : ''}</option>`
            ).join('') || '<option value="">— لا يوجد أجهزة —</option>';
        }
    }

    async function _openPaymentModal() {
        const remaining = Math.max(0,
            parseFloat(_hubOrder.grand_total  || 0) - parseFloat(_hubOrder.paid_amount || 0)
        );
        const el = document.getElementById('payment-remaining-display');
        if (el) el.textContent = `${_fmt(remaining)} ر.س`;
        const amtEl = document.getElementById('payment-amount');
        if (amtEl) { amtEl.value = ''; amtEl.focus(); }
        const methodEl = document.getElementById('payment-method');
        if (methodEl) methodEl.value = 'cash';
        _onPaymentMethodChange('cash');
        const notesEl = document.getElementById('payment-notes');
        if (notesEl) notesEl.value = '';

        await _loadPaymentLookups();
        _populatePaymentSelects();

        _showModal('po-payment-modal');
    }

    function _onPaymentMethodChange(method) {
        const cashFields = document.getElementById('payment-cash-fields');
        const bankFields = document.getElementById('payment-bank-fields');
        const posFields  = document.getElementById('payment-pos-fields');
        if (cashFields) cashFields.classList.add('hidden');
        if (bankFields) bankFields.classList.add('hidden');
        if (posFields)  posFields.classList.add('hidden');
        if (method === 'cash') {
            if (cashFields) cashFields.classList.remove('hidden');
        } else if (method === 'bank_transfer') {
            if (bankFields) bankFields.classList.remove('hidden');
        } else if (method === 'pos') {
            if (posFields) posFields.classList.remove('hidden');
        }
    }

    async function _savePayment() {
        const amount  = parseFloat((document.getElementById('payment-amount') ||{}).value);
        const method  = (document.getElementById('payment-method')            ||{}).value || 'cash';
        const notes   = (document.getElementById('payment-notes')             ||{}).value || '';

        if (!amount || amount <= 0) { _toast('أدخل مبلغاً صحيحاً', 'error'); return; }

        let extra = {};
        if (method === 'cash') {
            extra.cash_box = (document.getElementById('payment-cash-box') || {}).value || 'main';
        } else if (method === 'bank_transfer') {
            extra.bank_account = (document.getElementById('payment-bank-account') || {}).value || '';
            extra.bank_ref = (document.getElementById('payment-bank-ref') || {}).value || '';
        } else if (method === 'pos') {
            extra.pos_terminal = (document.getElementById('payment-pos-terminal') || {}).value || '';
            extra.pos_ref = (document.getElementById('payment-pos-ref') || {}).value || '';
        }

        try {
            const res = await window.apiFetch(`/api/orders/${_hubOrderId}/payment`, {
                method: 'POST',
                body: { amount, payment_method: method, notes, ...extra },
            });
            _toast('تم تسجيل الدفعة بنجاح');
            _hideModal('po-payment-modal');
            // Update local order data
            if (res && res.data) {
                _hubOrder.paid_amount = res.data.paid_amount;
                _renderHubHeader();
            }
            await _renderHubFinancial();
            await _loadOrders();
        } catch (err) {
            _toast(err.message || 'فشل تسجيل الدفعة', 'error');
        }
    }

    // ── Delivery modal ─────────────────────────────────────────────────────────
    function _openDeliveryModal() {
        const container = document.getElementById('delivery-items-container');
        if (container) {
            container.innerHTML = _hubItems.map(item =>
                `<div class="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0">
                    <div class="flex-1 text-sm text-slate-700 font-semibold">
                        ${item.product_name || '—'} ${item.size_name || ''}
                    </div>
                    <input type="hidden" data-delivery-variant="${item.variant_id}">
                    <input type="number" min="0" max="${item.quantity}" step="1" value="0"
                           data-delivery-qty
                           class="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center outline-none focus:border-brand-500"
                           placeholder="الكمية">
                 </div>`
            ).join('') || '<p class="text-sm text-slate-400 text-center py-3">لا توجد بنود</p>';
        }
        const notesEl = document.getElementById('delivery-notes');
        if (notesEl) notesEl.value = '';
        _showModal('po-delivery-modal');
    }

    async function _saveDelivery() {
        const container = document.getElementById('delivery-items-container');
        if (!container) return;
        const notes = (document.getElementById('delivery-notes')||{}).value || '';

        const items = [];
        const qtyEls     = container.querySelectorAll('[data-delivery-qty]');
        const variantEls = container.querySelectorAll('[data-delivery-variant]');

        for (let i = 0; i < qtyEls.length; i++) {
            const qty = parseFloat(qtyEls[i].value);
            const vid = variantEls[i]?.getAttribute('data-delivery-variant');
            if (qty > 0 && vid) items.push({ variant_id: vid, quantity: qty });
        }

        if (!items.length) { _toast('أدخل كمية واحدة على الأقل', 'error'); return; }

        try {
            await window.apiFetch('/api/delivery-notes', {
                method: 'POST',
                body: {
                    order_id:  _hubOrderId,
                    client_id: _hubOrder.client_id,
                    items,
                    notes,
                },
            });
            _toast('تم إصدار سند التسليم بنجاح');
            _hideModal('po-delivery-modal');
            await _renderHubDelivery();
        } catch (err) {
            _toast(err.message || 'فشل إصدار سند التسليم', 'error');
        }
    }

    // ── Notes save ─────────────────────────────────────────────────────────────
    async function _saveNotes() {
        const notes = (document.getElementById('hub-notes-input')||{}).value || '';
        try {
            await window.apiFetch(`/api/orders/${_hubOrderId}`, {
                method: 'PUT',
                body: { internal_notes: notes },
            });
            _toast('تم حفظ الملاحظات');
            if (_hubOrder) _hubOrder.internal_notes = notes;
        } catch (err) {
            _toast(err.message || 'فشل الحفظ', 'error');
        }
    }

    // ── Modal helpers ──────────────────────────────────────────────────────────
    function _showModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
    function _hideModal(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }

    // ── Tab switching (page list) ──────────────────────────────────────────────
    function _switchTab(tab) {
        _activeTab = tab;
        ['active','completed','archived'].forEach(t => {
            const btn = document.getElementById(`po-tab-${t}`);
            if (!btn) return;
            if (t === tab) {
                btn.className = btn.className
                    .replace('text-slate-500', 'text-brand-600')
                    .replace('border-transparent', 'border-brand-600');
            } else {
                btn.className = btn.className
                    .replace('text-brand-600', 'text-slate-500')
                    .replace('border-brand-600', 'border-transparent');
            }
        });
        _renderTable();
    }

    // ── Init ───────────────────────────────────────────────────────────────────
    async function _init() {
        await Promise.all([_loadOrders(), _loadSuppliers()]);

        // Search listener
        const searchEl = document.getElementById('po-search');
        if (searchEl) searchEl.addEventListener('input', _renderTable);
    }

    // ── Download MO Print PDF ────────────────────────────────────────────────────
    async function _downloadMOPrint(moId) {
        try {
            const response = await fetch(`/api/manufacturer-orders/${moId}/print-pdf`, {
                credentials: 'include'
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || 'فشل تحميل الملف');
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `MO-${moId.substring(0, 8)}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            _toast('تم تحميل ملف الطباعة', 'success');
        } catch (err) {
            console.error('[poView] downloadMOPrint:', err);
            _toast(err.message || 'فشل تحميل ملف الطباعة', 'error');
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    window.poView = {
        reload:               _loadOrders,
        switchTab:            _switchTab,
        applySearch:          _renderTable,
        openHub:              _openHub,
        closeHub:             () => _hideModal('po-hub-modal'),
        switchHubTab:         _switchHubTab,
        updateStatus:         _updateStatus,
        openAssignModal:      _openAssignModal,
        closeAssignModal:     () => _hideModal('po-assign-modal'),
        saveAssignment:       _saveAssignment,
        toggleItemCheck:      _toggleItemCheck,
        toggleAllItems:       _toggleAllItems,
        openBulkAssignModal:  _openBulkAssignModal,
        closeBulkAssignModal: () => _hideModal('po-bulk-assign-modal'),
        saveBulkAssignment:   _saveBulkAssignment,
        updateMOStatus:       _updateMOStatus,
        downloadMOPrint:      _downloadMOPrint,
        openInvoiceModal:     _openInvoiceModal,
        closeInvoiceModal:    () => _hideModal('po-invoice-modal'),
        calcInvoiceTotal:     _calcInvoiceTotal,
        saveInvoice:          _saveInvoice,
        openPaymentModal:     _openPaymentModal,
        closePaymentModal:    () => _hideModal('po-payment-modal'),
        savePayment:          _savePayment,
        onPaymentMethodChange: _onPaymentMethodChange,
        openDeliveryModal:    _openDeliveryModal,
        closeDeliveryModal:   () => _hideModal('po-delivery-modal'),
        saveDelivery:         _saveDelivery,
        saveNotes:            _saveNotes,
    };

    _init();

})();
