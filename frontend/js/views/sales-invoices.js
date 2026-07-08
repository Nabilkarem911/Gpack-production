'use strict';

// =============================================================================
// G.PACK 2.0 — Sales Invoices View Controller (Order-Based)
// Shows orders ready for invoicing (received items) and creates invoices from them
// =============================================================================

(function () {

    const PAGE_SIZE = 20;
    let _currentPage = 0;
    let _totalRows = 0;
    let _orders = [];    // Orders ready for invoicing
    let _clients = [];
    let _orderItems = []; // Items of selected order

    const fmt  = (v) => parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const qty  = (v) => parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
    const esc  = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _el  = (id) => document.getElementById(id);

    // ── Load data ────────────────────────────────────────────────────────────
    async function _loadData() {
        try {
            const clientsRes = await window.apiFetch('/api/clients');
            _clients = clientsRes.data || [];

            // Fill client filter
            const sel = _el('si-client');
            if (sel) {
                _clients.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.name;
                    sel.appendChild(opt);
                });
            }
        } catch (_) {}
    }

    // ── Fetch orders ready for invoice ────────────────────────────────────────
    async function _loadOrders(page = 0) {
        _currentPage = page;
        const tbody = _el('si-tbody');
        const empty = _el('si-empty');
        
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i></td></tr>`;
        }
        if (empty) empty.classList.add('hidden');

        const params = new URLSearchParams({
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
        });

        const search = _el('si-search')?.value?.trim();
        const client = _el('si-client')?.value;

        if (search) params.set('search', search);
        if (client) params.set('client_id', client);

        try {
            const res = await window.apiFetch(`/api/orders/ready-for-invoice?${params}`);
            _orders = res.data || [];
            _totalRows = res.total || 0;

            _renderTable();
            _renderStats();
            _updatePagination();

        } catch (err) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-red-400 text-sm"><i class="fa-solid fa-triangle-exclamation ml-2"></i>${esc(err.message)}</td></tr>`;
        }
    }

    // ── Render table ───────────────────────────────────────────────────────────
    function _renderTable() {
        const tbody = _el('si-tbody');
        const empty = _el('si-empty');
        if (!tbody) return;

        if (!_orders.length) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }

        if (empty) empty.classList.add('hidden');

        tbody.innerHTML = _orders.map(o => {
            const clientName = esc(o.client_name || '—');
            const orderDate = new Date(o.order_date).toLocaleDateString('ar-SA-u-nu-latn');

            return `<tr class="border-b border-slate-100 hover:bg-blue-50/30 transition-colors">
                <td class="py-3 px-4 font-bold font-mono text-slate-700">#${o.order_number}</td>
                <td class="py-3 px-4 text-slate-600 text-xs">${orderDate}</td>
                <td class="py-3 px-4 font-semibold text-slate-800">${clientName}</td>
                <td class="py-3 px-4 text-center">
                    <span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-blue-100 text-blue-700">
                        <i class="fa-solid fa-box-open"></i> ${o.items_count}
                    </span>
                </td>
                <td class="py-3 px-4 font-bold font-mono text-emerald-600">${fmt(o.estimated_total)}</td>
                <td class="py-3 px-4 text-center">
                    <button onclick="window.siOpenCreateModal('${esc(o.id)}')" 
                            class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 transition-all">
                        <i class="fa-solid fa-file-invoice"></i> إنشاء فاتورة
                    </button>
                </td>
            </tr>`;
        }).join('');
    }

    // ── Stats ─────────────────────────────────────────────────────────────────
    function _renderStats() {
        const totalAmount = _orders.reduce((sum, o) => sum + parseFloat(o.estimated_total || 0), 0);
        const totalItems = _orders.reduce((sum, o) => sum + parseInt(o.items_count || 0), 0);

        const _s = (id, v) => { const el = _el(id); if (el) el.textContent = v; };
        _s('si-stat-total',   _totalRows);
        _s('si-stat-amount',  fmt(totalAmount));
        _s('si-stat-items',   totalItems);
        _s('si-showing',      _orders.length);
        _s('si-total',        _totalRows);
    }

    // ── Pagination ─────────────────────────────────────────────────────────────
    function _updatePagination() {
        const pageEl   = _el('si-page');
        const prevBtn  = _el('si-prev');
        const nextBtn  = _el('si-next');

        if (pageEl)  pageEl.textContent = _currentPage + 1;
        if (prevBtn) prevBtn.disabled = _currentPage === 0;
        if (nextBtn) nextBtn.disabled = (_currentPage + 1) * PAGE_SIZE >= _totalRows;
    }

    window.siChangePage = function(dir) {
        _loadOrders(_currentPage + dir);
    };

    window.siOnFilterChange = function() {
        clearTimeout(window._siDebounce);
        window._siDebounce = setTimeout(() => _loadOrders(0), 300);
    };

    // ── Modal: Create Invoice from Order ─────────────────────────────────────
    window.siOpenCreateModal = async function(orderId) {
        const order = _orders.find(o => o.id === orderId);
        if (!order) return;

        // Load order items with received quantities
        try {
            const res = await window.apiFetch(`/api/orders/${orderId}`);
            const orderData = res.data || {};
            
            // Filter items that have received quantity
            _orderItems = (orderData.items || []).filter(i => i.wh_received_qty > 0).map(i => ({
                variant_id: i.variant_id,
                order_item_id: i.id,
                product_name: i.product_name,
                size_name: i.size_name,
                quantity: i.wh_received_qty,  // Use received quantity
                unit_price: i.unit_price || 0,
                line_total: i.wh_received_qty * (i.unit_price || 0),
            }));

            if (!_orderItems.length) {
                alert('لا توجد أصناف مستلمة في هذا الأمر');
                return;
            }

            // Populate modal
            _el('si-m-order-id').value = orderId;
            _el('si-m-client-id').value = order.client_id;
            _el('si-m-order-num').textContent = `#${order.order_number}`;
            _el('si-m-client').value = order.client_name || '';
            _el('si-m-date').value = new Date().toISOString().split('T')[0];
            _el('si-m-due').value = '';
            _el('si-m-tax').value = '15';
            _el('si-m-notes').value = '';

            _renderModalItems();
            _calcModalTotals();

            _el('si-modal-overlay')?.classList.remove('hidden');
            _el('si-modal')?.classList.remove('hidden');

        } catch (err) {
            alert('❌ خطأ في تحميل بيانات الأمر: ' + err.message);
        }
    };

    window.siCloseModal = function() {
        _el('si-modal-overlay')?.classList.add('hidden');
        _el('si-modal')?.classList.add('hidden');
        _orderItems = [];
    };

    function _renderModalItems() {
        const tbody = _el('si-m-items');
        if (!tbody) return;

        tbody.innerHTML = _orderItems.map((item, i) => {
            const productLabel = `${esc(item.product_name)} — ${esc(item.size_name || 'بدون مقاس')}`;
            
            return `<tr class="border-b border-slate-100">
                <td class="py-3 px-3">
                    <div class="text-sm font-semibold text-slate-800">${productLabel}</div>
                    <input type="hidden" value="${esc(item.variant_id)}" id="si-m-item-${i}-variant" />
                    <input type="hidden" value="${esc(item.order_item_id)}" id="si-m-item-${i}-order-item" />
                </td>
                <td class="py-3 px-3 text-center">
                    <span class="text-sm font-bold text-slate-700">${qty(item.quantity)}</span>
                </td>
                <td class="py-3 px-3 text-center">
                    <input type="number" min="0" step="0.01" value="${item.unit_price}"
                           oninput="window.siUpdatePrice(${i}, this.value)"
                           class="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center font-mono focus:border-brand-400 outline-none" />
                </td>
                <td class="py-3 px-3 text-center font-mono text-sm font-bold text-emerald-600" id="si-m-item-${i}-total">
                    ${fmt(item.line_total)}
                </td>
            </tr>`;
        }).join('');
    }

    window.siUpdatePrice = function(idx, value) {
        const price = parseFloat(value) || 0;
        _orderItems[idx].unit_price = price;
        _orderItems[idx].line_total = _orderItems[idx].quantity * price;
        
        const totalEl = _el(`si-m-item-${idx}-total`);
        if (totalEl) totalEl.textContent = fmt(_orderItems[idx].line_total);
        
        _calcModalTotals();
    };

    function _calcModalTotals() {
        const taxRate = parseFloat(_el('si-m-tax')?.value || 15) / 100;
        const discount = parseFloat(_el('si-m-discount')?.value || 0);

        let subtotal = 0;
        for (const item of _orderItems) {
            subtotal += item.line_total;
        }

        const afterDiscount = Math.max(0, subtotal - discount);
        const taxAmount = afterDiscount * taxRate;
        const grand = afterDiscount + taxAmount;

        const _s = (id, v) => { const el = _el(id); if (el) el.textContent = v; };
        _s('si-m-subtotal', fmt(subtotal));
        _s('si-m-tax-display', (taxRate * 100).toFixed(2));
        _s('si-m-tax-amount', fmt(taxAmount));
        _s('si-m-grand', fmt(grand));
    }

    window.siUpdateDiscount = function(value) {
        _calcModalTotals();
    };

    // Recalc on tax change
    _el('si-m-tax')?.addEventListener('input', _calcModalTotals);

    // ── Save Invoice ─────────────────────────────────────────────────────────
    window.siSaveInvoice = async function() {
        const orderId = _el('si-m-order-id')?.value;
        const clientId = _el('si-m-client-id')?.value;
        
        if (!orderId || !clientId) {
            alert('بيانات الأمر غير مكتملة');
            return;
        }

        const btn = document.querySelector('#si-modal button[onclick="window.siSaveInvoice()"]');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جاري الحفظ...'; }

        try {
            const items = _orderItems.map(i => ({
                variant_id: i.variant_id,
                order_item_id: i.order_item_id,
                quantity: i.quantity,
                unit_price: i.unit_price,
                discount_percent: 0,
            }));

            const payload = {
                client_id: clientId,
                order_id: orderId,
                invoice_date: _el('si-m-date')?.value,
                due_date: _el('si-m-due')?.value || null,
                tax_rate: parseFloat(_el('si-m-tax')?.value || 15) / 100,
                discount_amount: parseFloat(_el('si-m-discount')?.value || 0),
                notes: _el('si-m-notes')?.value || '',
                items: items,
            };

            const res = await window.apiFetch('/api/invoices', {
                method: 'POST',
                body: payload,
            });

            const invoiceId = res.invoice?.id;
            alert(`✅ تم إنشاء الفاتورة رقم #${res.invoice?.invoice_number}`);
            window.siCloseModal();
            // Navigate to invoice detail
            if (invoiceId) {
                window.navigateTo(`sales-invoice-detail?id=${invoiceId}`);
            } else {
                _loadOrders(0); // Refresh list if no id
            }

        } catch (err) {
            alert(`❌ خطأ: ${err.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-invoice ml-1"></i> إنشاء الفاتورة'; }
        }
    };

// ── View Invoice ─────────────────────────────────────────────────────────
window.siViewInvoice = function(id) {
window.navigateTo(`sales-invoice-detail?id=${id}`);
};

// ── Init ─────────────────────────────────────────────────────────────────────
async function _init() {
await _loadData();
await _loadOrders(0);
}

_init();
})();
