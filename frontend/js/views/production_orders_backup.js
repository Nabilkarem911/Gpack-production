'use strict';

// =============================================================================
// G.PACK 2.0 - Production Orders View Controller (production_orders.js)
// Handles: list, view, update status of production orders (status = 'production', 'processing', 'completed').
// Manages manufacturer orders (supplier assignments) for production items.
// =============================================================================

(function () {

    // ── Private State ─────────────────────────────────────────────────────────
    let _allOrders = [];           // All production orders
    let _suppliers = [];             // Loaded suppliers for assignment
    let _currentOrderId = null;      // Currently viewed order
    let _currentOrderItems = [];     // Items of currently viewed order
    let _currentManufacturerOrders = []; // Manufacturer orders for current order

    // ── Status Configuration ───────────────────────────────────────────────────
    const STATUS_CONFIG = {
        production:  { label: 'في الانتظار',  cls: 'bg-amber-100 text-amber-700',     icon: 'fa-clock' },
        processing:  { label: 'قيد التنفيذ',  cls: 'bg-blue-100 text-blue-700',      icon: 'fa-spinner fa-spin-pulse' },
        completed:   { label: 'مكتمل',        cls: 'bg-emerald-100 text-emerald-700', icon: 'fa-check-circle' },
        delivered:   { label: 'مُسلَّم',      cls: 'bg-slate-100 text-slate-600',     icon: 'fa-truck' },
        cancelled:   { label: 'ملغي',         cls: 'bg-red-100 text-red-600',         icon: 'fa-ban' }
    };

    const STATUS_FLOW = {
        production:  ['processing', 'cancelled'],
        processing:  ['completed', 'cancelled'],
        completed:   ['delivered']
    };

    // ==========================================================================
    // _fmtNum(n) — Format number without currency
    // ==========================================================================
    function _fmtNum(n) {
        if (n === null || n === undefined || isNaN(n)) return '—';
        const num = Number(n);
        return Number.isInteger(num) ? num.toString() : num.toFixed(2);
    }

    // ==========================================================================
    // _statusBadge(status)
    // ==========================================================================
    function _statusBadge(status) {
        const cfg = STATUS_CONFIG[status] || { label: status, cls: 'bg-slate-100 text-slate-500', icon: 'fa-circle' };
        return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${cfg.cls}">
            <i class="fa-solid ${cfg.icon}"></i>
            ${cfg.label}
        </span>`;
    }

    // ==========================================================================
    // _renderTable(orders)
    // ==========================================================================
    function _renderTable(orders) {
        const tbody = document.getElementById('production-tbody');
        const empty = document.getElementById('production-empty');
        if (!tbody) return;

        if (!orders || orders.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        tbody.innerHTML = orders.map(o => {
            const dateStr = o.order_date ? new Date(o.order_date).toLocaleDateString('ar-SA') : '—';
            const total = o.grand_total ? _fmtNum(o.grand_total) : '—';
            const moCount = o.manufacturer_orders_count || 0;

            return `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3.5 px-4">
                    <span class="font-mono font-bold text-slate-700 text-sm">#${o.order_number || '—'}</span>
                </td>
                <td class="py-3.5 px-4 text-sm font-semibold text-slate-800">${o.client_name || '—'}</td>
                <td class="py-3.5 px-4 text-sm text-slate-500 hidden sm:table-cell">${dateStr}</td>
                <td class="py-3.5 px-4 hidden md:table-cell">
                    <span class="font-bold text-slate-700 font-mono text-sm">${total}</span>
                </td>
                <td class="py-3.5 px-4">${_statusBadge(o.status)}</td>
                <td class="py-3.5 px-4 hidden lg:table-cell">
                    <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold bg-purple-50 text-purple-700">
                        <i class="fa-solid fa-truck-fast"></i>
                        ${moCount}
                    </span>
                </td>
                <td class="py-3.5 px-4">
                    <div class="flex items-center justify-end gap-1">
                        <button onclick="window.viewProductionOrder('${o.id}')" title="عرض التفاصيل"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-brand-600 hover:bg-brand-50 transition-colors">
                            <i class="fa-solid fa-eye text-sm"></i>
                        </button>
                        <button onclick="window.updateOrderStatus('${o.id}', '${o.status}')" title="تحديث الحالة"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-blue-600 hover:bg-blue-50 transition-colors">
                            <i class="fa-solid fa-rotate text-xs"></i>
                        </button>
                        ${o.status === 'production' ? `
                        <button onclick="window.startProcessing('${o.id}')" title="بدء التنفيذ"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-amber-600 hover:bg-amber-50 transition-colors">
                            <i class="fa-solid fa-play text-xs"></i>
                        </button>` : ''}
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    // ==========================================================================
    // _getFilteredOrders()
    // ==========================================================================
    function _getFilteredOrders() {
        let list = [..._allOrders];

        const searchInput = document.getElementById('production-search');
        const searchQ = searchInput ? searchInput.value.toLowerCase() : '';
        if (searchQ) {
            list = list.filter(o =>
                (o.client_name && o.client_name.toLowerCase().includes(searchQ)) ||
                (o.order_number && String(o.order_number).includes(searchQ))
            );
        }

        const statusFilter = document.getElementById('production-status-filter');
        if (statusFilter && statusFilter.value) {
            list = list.filter(o => o.status === statusFilter.value);
        }

        const dateFrom = document.getElementById('production-date-from');
        if (dateFrom && dateFrom.value) {
            list = list.filter(o => o.order_date && o.order_date.slice(0, 10) >= dateFrom.value);
        }

        const dateTo = document.getElementById('production-date-to');
        if (dateTo && dateTo.value) {
            list = list.filter(o => o.order_date && o.order_date.slice(0, 10) <= dateTo.value);
        }

        return list;
    }

    function _renderFilteredTable() {
        _renderTable(_getFilteredOrders());
    }

    // ==========================================================================
    // _updateStats()
    // ==========================================================================
    function _updateStats() {
        const production = _allOrders.filter(o => o.status === 'production').length;
        const processing = _allOrders.filter(o => o.status === 'processing').length;
        const completed = _allOrders.filter(o => o.status === 'completed').length;

        const statProduction = document.getElementById('stat-production');
        const statProcessing = document.getElementById('stat-processing');
        const statCompleted = document.getElementById('stat-completed');
        const statManufacturerOrders = document.getElementById('stat-manufacturer-orders');

        if (statProduction) statProduction.textContent = production;
        if (statProcessing) statProcessing.textContent = processing;
        if (statCompleted) statCompleted.textContent = completed;

        if (statManufacturerOrders) {
            const totalMO = _allOrders.reduce((sum, o) => sum + (o.manufacturer_orders_count || 0), 0);
            statManufacturerOrders.textContent = totalMO;
        }
    }

    // ==========================================================================
    // loadProductionOrders()
    // ==========================================================================
    async function loadProductionOrders() {
        const tbody = document.getElementById('production-tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-slate-400">
                <i class="fa-solid fa-circle-notch fa-spin text-2xl"></i></td></tr>`;
        }

        try {
            const [ordersRes, moRes] = await Promise.all([
                window.apiFetch('/api/orders?statuses=production,processing,completed'),
                window.apiFetch('/api/manufacturer-orders')
            ]);

            const orders = (ordersRes && ordersRes.data) ? ordersRes.data : [];
            const moList = (moRes && moRes.data) ? moRes.data : [];

            // Count manufacturer orders per parent order
            const moCountMap = {};
            moList.forEach(mo => {
                moCountMap[mo.order_id] = (moCountMap[mo.order_id] || 0) + 1;
            });

            orders.forEach(o => {
                o.manufacturer_orders_count = moCountMap[o.id] || 0;
            });

            _allOrders = orders;
            _updateStats();
            _renderFilteredTable();
        } catch (err) {
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-red-400 text-sm">
                    <i class="fa-solid fa-circle-exclamation ml-1"></i>
                    فشل تحميل أوامر الإنتاج: ${err.message}</td></tr>`;
            }
        }
    }

    // ==========================================================================
    // loadSuppliers()
    // ==========================================================================
    async function loadSuppliers() {
        try {
            const res = await window.apiFetch('/api/suppliers');
            _suppliers = (res && res.data) ? res.data.filter(s => s.status === 'active') : [];
        } catch (_) {
            _suppliers = [];
        }
    }

    // ==========================================================================
    // viewProductionOrder(id) — Opens modal with order details
    // ==========================================================================
    window.viewProductionOrder = async function (id) {
        _currentOrderId = id;

        try {
            const [orderRes, moRes] = await Promise.all([
                window.apiFetch(`/api/orders/${id}`),
                window.apiFetch(`/api/manufacturer-orders/by-order/${id}`)
            ]);

            const order = orderRes && orderRes.data;
            if (!order) throw new Error('لم يتم العثور على الأمر.');

            _currentOrderItems = order.items || [];
            _currentManufacturerOrders = (moRes && moRes.data) ? moRes.data : [];

            // Populate modal header
            const titleEl = document.getElementById('production-modal-title');
            const numberEl = document.getElementById('production-modal-number');
            const clientEl = document.getElementById('production-modal-client');
            const dateEl = document.getElementById('production-modal-date');
            const totalEl = document.getElementById('production-modal-total');

            if (titleEl) titleEl.textContent = `أمر تشغيل #${order.order_number || '—'}`;
            if (numberEl) numberEl.textContent = `الحالة: ${_statusBadge(order.status)}`;
            if (clientEl) clientEl.textContent = order.client_name || '—';
            if (dateEl) dateEl.textContent = order.order_date ? new Date(order.order_date).toLocaleDateString('ar-SA') : '—';
            if (totalEl) totalEl.textContent = order.grand_total ? _fmtNum(order.grand_total) : '—';

            // Render status actions
            _renderStatusActions(order.status, id);

            // Render items with manufacturer assignment info
            _renderModalItems(order.items, _currentManufacturerOrders);

            // Render manufacturer orders list
            _renderManufacturerOrders(_currentManufacturerOrders);

            // Show modal
            const modal = document.getElementById('production-modal');
            if (modal) modal.classList.remove('hidden');

        } catch (err) {
            alert('فشل تحميل تفاصيل الأمر: ' + err.message);
        }
    };

    // ==========================================================================
    // _renderStatusActions(currentStatus, orderId)
    // ==========================================================================
    function _renderStatusActions(currentStatus, orderId) {
        const container = document.getElementById('production-status-actions');
        if (!container) return;

        const nextStatuses = STATUS_FLOW[currentStatus] || [];

        if (nextStatuses.length === 0) {
            container.innerHTML = `<span class="text-sm text-slate-500">لا يوجد تحديثات متاحة</span>`;
            return;
        }

        container.innerHTML = nextStatuses.map(nextStatus => {
            const cfg = STATUS_CONFIG[nextStatus];
            const btnColor = nextStatus === 'cancelled' ? 'bg-red-100 hover:bg-red-200 text-red-700' :
                            nextStatus === 'completed' ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700' :
                            'bg-blue-100 hover:bg-blue-200 text-blue-700';

            return `
                <button onclick="window.updateOrderStatus('${orderId}', '${nextStatus}')"
                        class="flex items-center gap-2 px-4 py-2 ${btnColor} text-sm font-bold rounded-lg transition-colors">
                    <i class="fa-solid ${cfg.icon}"></i>
                    ${cfg.label}
                </button>
            `;
        }).join('');
    }

    // ==========================================================================
    // _renderModalItems(items, manufacturerOrders)
    // ==========================================================================
    function _renderModalItems(items, manufacturerOrders) {
        const tbody = document.getElementById('production-modal-items');
        if (!tbody) return;

        if (!items || items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400">لا توجد بنود</td></tr>`;
            return;
        }

        // Calculate assigned and received quantities per item
        const itemStats = {};
        items.forEach(item => {
            itemStats[item.id] = { assigned: 0, received: item.wh_received_qty || 0 };
        });

        manufacturerOrders.forEach(mo => {
            mo.items && mo.items.forEach(moi => {
                if (itemStats[moi.order_item_id]) {
                    itemStats[moi.order_item_id].assigned += moi.quantity;
                }
            });
        });

        tbody.innerHTML = items.map(item => {
            const stats = itemStats[item.id] || { assigned: 0, received: 0 };
            const remaining = Math.max(0, item.quantity - stats.assigned);
            const isFullyAssigned = stats.assigned >= item.quantity;
            const isFullyReceived = stats.received >= item.quantity;

            return `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors ${isFullyReceived ? 'bg-emerald-50/40' : ''}">
                <td class="py-3 px-4">
                    <div class="flex items-center gap-2">
                        <span class="font-semibold text-slate-800 text-sm">${item.product_name || '—'}</span>
                        ${isFullyReceived ? '<i class="fa-solid fa-check-circle text-emerald-500" title="تم الاستلام الكامل"></i>' : ''}
                    </div>
                </td>
                <td class="py-3 px-4 text-center text-sm text-slate-600">${item.variant_name || '—'}</td>
                <td class="py-3 px-4 text-center">
                    <span class="font-mono font-bold text-slate-700">${item.quantity}</span>
                </td>
                <td class="py-3 px-4 text-center">
                    <span class="font-mono ${stats.assigned > 0 ? 'text-purple-600 font-bold' : 'text-slate-400'}">${stats.assigned}</span>
                </td>
                <td class="py-3 px-4 text-center">
                    <span class="font-mono ${stats.received > 0 ? 'text-emerald-600 font-bold' : 'text-slate-400'}">${stats.received}</span>
                </td>
                <td class="py-3 px-4 text-center">
                    ${remaining > 0 ? `
                    <button onclick="window.openSupplierAssignment('${item.id}', '${item.product_name || ''}', '${item.variant_name || ''}', ${item.quantity}, ${stats.assigned})"
                            class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 text-xs font-bold rounded-lg transition-colors">
                        <i class="fa-solid fa-user-tie"></i>
                        إسناد (${remaining})
                    </button>` : `
                    <span class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-500 text-xs font-bold rounded-lg">
                        <i class="fa-solid fa-check"></i>
                        تم الإسناد
                    </span>`}
                </td>
            </tr>`;
        }).join('');
    }

    // ==========================================================================
    // _renderManufacturerOrders(manufacturerOrders)
    // ==========================================================================
    function _renderManufacturerOrders(manufacturerOrders) {
        const listEl = document.getElementById('manufacturer-orders-list');
        const emptyEl = document.getElementById('manufacturer-orders-empty');

        if (!listEl || !emptyEl) return;

        if (!manufacturerOrders || manufacturerOrders.length === 0) {
            listEl.innerHTML = '';
            emptyEl.classList.remove('hidden');
            return;
        }

        emptyEl.classList.add('hidden');

        const moStatuses = {
            pending:   { label: 'معلق',    cls: 'bg-slate-100 text-slate-600' },
            ordered:   { label: 'مرسل',    cls: 'bg-blue-100 text-blue-700' },
            received:  { label: 'مستلم',   cls: 'bg-emerald-100 text-emerald-700' },
            cancelled: { label: 'ملغي',    cls: 'bg-red-100 text-red-600' }
        };

        listEl.innerHTML = manufacturerOrders.map(mo => {
            const st = moStatuses[mo.status] || moStatuses.pending;
            const items = mo.items || [];

            return `
            <div class="bg-white border border-slate-200 rounded-xl p-4">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                            <i class="fa-solid fa-truck-fast text-purple-600"></i>
                        </div>
                        <div>
                            <p class="font-bold text-slate-800 text-sm">${mo.supplier_name || '—'}</p>
                            <p class="text-xs text-slate-500 font-mono">PO: ${mo.po_number || '—'}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${st.cls}">
                            ${st.label}
                        </span>
                        ${mo.status === 'pending' ? `
                        <button onclick="window.updateManufacturerOrderStatus('${mo.id}', 'ordered')"
                                class="w-7 h-7 flex items-center justify-center rounded-lg text-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                title="تحديث إلى مرسل">
                            <i class="fa-solid fa-paper-plane text-xs"></i>
                        </button>` : ''}
                        ${mo.status === 'ordered' ? `
                        <button onclick="window.updateManufacturerOrderStatus('${mo.id}', 'received')"
                                class="w-7 h-7 flex items-center justify-center rounded-lg text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                                title="تحديث إلى مستلم">
                            <i class="fa-solid fa-check text-xs"></i>
                        </button>` : ''}
                        ${mo.status === 'pending' ? `
                        <button onclick="window.deleteManufacturerOrder('${mo.id}')"
                                class="w-7 h-7 flex items-center justify-center rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                title="حذف">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>` : ''}
                    </div>
                </div>
                <div class="text-xs text-slate-500 flex flex-wrap gap-4">
                    <span><i class="fa-regular fa-calendar ml-1"></i> ${mo.order_date ? new Date(mo.order_date).toLocaleDateString('ar-SA') : '—'}</span>
                    <span><i class="fa-regular fa-clock ml-1"></i> تسليم: ${mo.expected_delivery ? new Date(mo.expected_delivery).toLocaleDateString('ar-SA') : '—'}</span>
                    <span><i class="fa-solid fa-box ml-1"></i> ${items.length} بند</span>
                    <span><i class="fa-solid fa-coins ml-1"></i> ${_fmtNum(mo.total_cost)}</span>
                </div>
                ${items.length > 0 ? `
                <div class="mt-3 pt-3 border-t border-slate-100">
                    <div class="space-y-1">
                        ${items.map(it => `
                            <div class="flex justify-between text-xs">
                                <span class="text-slate-600">${it.product_name || '—'} (${it.variant_name || '—'})</span>
                                <span class="font-mono font-bold text-slate-700">${it.quantity} × ${_fmtNum(it.unit_cost)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>` : ''}
            </div>`;
        }).join('');
    }

    // ==========================================================================
    // updateOrderStatus(id, newStatus)
    // ==========================================================================
    window.updateOrderStatus = async function (id, newStatus) {
        const currentOrder = _allOrders.find(o => o.id === id);
        const currentStatus = currentOrder ? currentOrder.status : null;

        // If newStatus is the same as current, prompt user for actual new status
        if (newStatus === currentStatus) {
            const nextStatuses = STATUS_FLOW[currentStatus] || [];
            if (nextStatuses.length === 0) {
                alert('لا يوجد تحديثات متاحة لهذا الأمر.');
                return;
            }

            const options = nextStatuses.map(s => STATUS_CONFIG[s].label).join('، ');
            const choice = prompt(`اختر الحالة الجديدة (${options}):`);
            if (!choice) return;

            const selectedStatus = nextStatuses.find(s => STATUS_CONFIG[s].label.includes(choice));
            if (!selectedStatus) {
                alert('الحالة المختارة غير صالحة.');
                return;
            }
            newStatus = selectedStatus;
        }

        if (!confirm(`هل تريد تحديث حالة الأمر إلى "${STATUS_CONFIG[newStatus].label}"؟`)) return;

        try {
            await window.apiFetch(`/api/orders/${id}/status`, {
                method: 'PATCH',
                body: { status: newStatus }
            });

            // Refresh list and modal if open
            await loadProductionOrders();

            if (_currentOrderId === id) {
                await window.viewProductionOrder(id);
            }

            if (window.showToast) {
                window.showToast(`تم تحديث الحالة إلى "${STATUS_CONFIG[newStatus].label}" بنجاح.`, 'success');
            }
        } catch (err) {
            alert('فشل تحديث الحالة: ' + err.message);
        }
    };

    // ==========================================================================
    // startProcessing(id) — Quick action to move from production to processing
    // ==========================================================================
    window.startProcessing = async function (id) {
        if (!confirm('هل تريد بدء تنفيذ هذا الأمر؟')) return;

        try {
            await window.apiFetch(`/api/orders/${id}/status`, {
                method: 'PATCH',
                body: { status: 'processing' }
            });

            await loadProductionOrders();

            if (window.showToast) {
                window.showToast('تم بدء التنفيذ بنجاح.', 'success');
            }
        } catch (err) {
            alert('فشل بدء التنفيذ: ' + err.message);
        }
    };

    // ==========================================================================
    // openSupplierAssignment(itemId, ...) — Opens supplier assignment modal
    // ==========================================================================
    window.openSupplierAssignment = async function (itemId, productName, variantName, totalQty, assignedQty) {
        const remaining = totalQty - assignedQty;

        // Populate item info
        const infoEl = document.getElementById('supplier-item-info');
        const qtyEl = document.getElementById('supplier-item-qty');
        const assignedEl = document.getElementById('supplier-item-assigned');
        const remainingEl = document.getElementById('supplier-item-remaining');
        const orderItemIdEl = document.getElementById('supplier-order-item-id');
        const orderIdEl = document.getElementById('supplier-order-id');
        const qtyInput = document.getElementById('supplier-qty');

        if (infoEl) infoEl.textContent = `${productName} (${variantName})`;
        if (qtyEl) qtyEl.textContent = totalQty;
        if (assignedEl) assignedEl.textContent = assignedQty;
        if (remainingEl) remainingEl.textContent = remaining;
        if (orderItemIdEl) orderItemIdEl.value = itemId;
        if (orderIdEl) orderIdEl.value = _currentOrderId;
        if (qtyInput) {
            qtyInput.value = remaining;
            qtyInput.max = remaining;
        }

        // Populate suppliers dropdown
        const supplierSelect = document.getElementById('supplier-select');
        if (supplierSelect) {
            supplierSelect.innerHTML = '<option value="">— اختر المورد —</option>';
            _suppliers.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.name;
                supplierSelect.appendChild(opt);
            });
        }

        // Clear other fields
        const unitCostInput = document.getElementById('supplier-unit-cost');
        const deliveryInput = document.getElementById('supplier-expected-delivery');
        const notesInput = document.getElementById('supplier-notes');

        if (unitCostInput) unitCostInput.value = '';
        if (deliveryInput) deliveryInput.value = '';
        if (notesInput) notesInput.value = '';

        // Show modal
        const modal = document.getElementById('supplier-assignment-modal');
        if (modal) modal.classList.remove('hidden');
    };

    // ==========================================================================
    // saveSupplierAssignment() — Saves new manufacturer order
    // ==========================================================================
    window.saveSupplierAssignment = async function () {
        const orderItemId = document.getElementById('supplier-order-item-id')?.value;
        const orderId = document.getElementById('supplier-order-id')?.value;
        const supplierId = document.getElementById('supplier-select')?.value;
        const qty = parseInt(document.getElementById('supplier-qty')?.value) || 0;
        const unitCost = parseFloat(document.getElementById('supplier-unit-cost')?.value) || 0;
        const expectedDelivery = document.getElementById('supplier-expected-delivery')?.value;
        const notes = document.getElementById('supplier-notes')?.value;

        if (!supplierId) {
            alert('يرجى اختيار المورد.');
            return;
        }
        if (qty <= 0) {
            alert('الكمية يجب أن تكون أكبر من صفر.');
            return;
        }

        try {
            await window.apiFetch('/api/manufacturer-orders', {
                method: 'POST',
                body: {
                    order_id: orderId,
                    supplier_id: supplierId,
                    expected_delivery: expectedDelivery || null,
                    notes: notes || null,
                    items: [{
                        order_item_id: orderItemId,
                        quantity: qty,
                        unit_cost: unitCost,
                        notes: notes || null
                    }]
                }
            });

            window.closeSupplierAssignmentModal();

            // Refresh modal content
            if (_currentOrderId) {
                await window.viewProductionOrder(_currentOrderId);
            }

            // Refresh main list
            await loadProductionOrders();

            if (window.showToast) {
                window.showToast('تم إنشاء أمر التشغيل بنجاح.', 'success');
            }
        } catch (err) {
            alert('فشل إنشاء أمر التشغيل: ' + err.message);
        }
    };

    // ==========================================================================
    // updateManufacturerOrderStatus(id, newStatus)
    // ==========================================================================
    window.updateManufacturerOrderStatus = async function (id, newStatus) {
        if (!confirm(`هل تريد تحديث حالة أمر المورد إلى "${newStatus === 'ordered' ? 'مرسل' : 'مستلم'}"؟`)) return;

        try {
            await window.apiFetch(`/api/manufacturer-orders/${id}/status`, {
                method: 'PATCH',
                body: { status: newStatus }
            });

            // Refresh modal content
            if (_currentOrderId) {
                await window.viewProductionOrder(_currentOrderId);
            }

            // Refresh main list
            await loadProductionOrders();

            if (window.showToast) {
                window.showToast('تم تحديث الحالة بنجاح.', 'success');
            }
        } catch (err) {
            alert('فشل تحديث الحالة: ' + err.message);
        }
    };

    // ==========================================================================
    // deleteManufacturerOrder(id)
    // ==========================================================================
    window.deleteManufacturerOrder = async function (id) {
        if (!confirm('هل تريد حذف أمر التشغيل هذا؟')) return;

        try {
            await window.apiFetch(`/api/manufacturer-orders/${id}`, {
                method: 'DELETE'
            });

            // Refresh modal content
            if (_currentOrderId) {
                await window.viewProductionOrder(_currentOrderId);
            }

            // Refresh main list
            await loadProductionOrders();

            if (window.showToast) {
                window.showToast('تم حذف أمر التشغيل بنجاح.', 'success');
            }
        } catch (err) {
            alert('فشل حذف أمر التشغيل: ' + err.message);
        }
    };

    // ==========================================================================
    // Modal Control Functions
    // ==========================================================================
    window.closeProductionModal = function () {
        const modal = document.getElementById('production-modal');
        if (modal) modal.classList.add('hidden');
        _currentOrderId = null;
        _currentOrderItems = [];
        _currentManufacturerOrders = [];
    };

    window.closeSupplierAssignmentModal = function () {
        const modal = document.getElementById('supplier-assignment-modal');
        if (modal) modal.classList.add('hidden');
    };

    window.applyProductionFilters = function () {
        _renderFilteredTable();
    };

    window.printProductionOrder = function () {
        window.print();
    };

    // ==========================================================================
    // _initSearch() — Search input handler
    // ==========================================================================
    function _initSearch() {
        const input = document.getElementById('production-search');
        if (input) {
            input.addEventListener('input', () => {
                _renderFilteredTable();
            });
        }
    }

    // ==========================================================================
    // initProductionOrdersView() — Main initialization
    // ==========================================================================
    function initProductionOrdersView() {
        loadProductionOrders();
        loadSuppliers();
        _initSearch();

        // Refresh button
        const refreshBtn = document.getElementById('refresh-production-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                loadProductionOrders();
                if (window.showToast) window.showToast('تم تحديث البيانات.', 'info');
            });
        }
    }

    // ── Bootstrap ─────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initProductionOrdersView);
    } else {
        initProductionOrdersView();
    }

})();
