'use strict';

// =============================================================================
// G.PACK 2.0 — Sales Invoices View Controller (2 tabs)
// Tabs: الفواتير (draft) | الأرشيف (issued)
// =============================================================================

(function () {

    const PAGE_SIZE = 20;
    let _currentPage = 0;
    let _totalRows = 0;
    let _currentTab = 'invoices'; // invoices | archive
    let _invoices = [];
    let _clients = [];
    let _readyOrders = [];
    let _orderItems = [];
    let _warehouseStock = [];
    let _warehouseClientSearchable = null;
    let _warehouseSearchable = null;

    const fmt  = (v) => parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const qty  = (v) => parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
    const esc  = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _el  = (id) => document.getElementById(id);

    const _date = (d) => d ? new Date(d).toLocaleDateString('ar-SA-u-nu-latn') : '—';

    function _statusBadge(status) {
        const map = {
            draft: { label: 'مسودة', class: 'bg-slate-100 text-slate-600' },
            issued: { label: 'معتمدة', class: 'bg-emerald-100 text-emerald-700' },
            paid: { label: 'مدفوعة', class: 'bg-blue-100 text-blue-700' },
            cancelled: { label: 'ملغية', class: 'bg-red-100 text-red-700' },
            archived: { label: 'مؤرشفة', class: 'bg-slate-100 text-slate-600' },
            overdue: { label: 'متأخرة', class: 'bg-amber-100 text-amber-700' },
            final: { label: 'نهائية', class: 'bg-emerald-100 text-emerald-700' },
        };
        const s = map[status] || { label: status || '—', class: 'bg-slate-100 text-slate-600' };
        return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold ${s.class}">${s.label}</span>`;
    }

    // ── Load clients for filter ────────────────────────────────────────────────
    async function _loadData() {
        try {
            const clientsRes = await window.apiFetch('/api/clients');
            _clients = clientsRes.data || [];

            const sel = _el('si-client');
            if (sel) {
                _clients.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.parent_name ? (c.name + ' — ' + c.parent_name) : c.name;
                    sel.appendChild(opt);
                });
                if (window.makeSelectSearchable) {
                    window.makeSelectSearchable(sel, '🔍 ابحث عن العميل...');
                }
            }
        } catch (_) {}
    }

    // ── Tab switching ──────────────────────────────────────────────────────────
    window.siSwitchTab = function(tab) {
        _currentTab = tab;
        _currentPage = 0;
        _setActiveTab(tab);
        _loadInvoices(0);
    };

    function _setActiveTab(tab) {
        const tabs = ['invoices','archive'];
        tabs.forEach(t => {
            const btn = _el('si-tab-' + t);
            if (btn) {
                const active = t === tab;
                btn.classList.toggle('border-brand-600', active);
                btn.classList.toggle('text-brand-700', active);
                btn.classList.toggle('bg-white', active);
                btn.classList.toggle('border-transparent', !active);
                btn.classList.toggle('text-slate-500', !active);
                btn.classList.toggle('hover:text-brand-600', !active);
            }
        });
    }

    // ── Fetch invoices for active tab ───────────────────────────────────────────
    async function _loadInvoices(page = 0) {
        _currentPage = page;
        const status = _currentTab === 'archive' ? 'archive' : 'active';
        const tbody = _el('si-tbody');
        const empty = _el('si-empty');

        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i></td></tr>`;
        if (empty) empty.classList.add('hidden');

        const params = new URLSearchParams({
            source: 'sales_invoices',
            status: status,
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
        });

        const search = _el('si-search')?.value?.trim();
        const client = _el('si-client')?.value;

        if (search) params.set('search', search);
        if (client) params.set('client_id', client);

        try {
            const res = await window.apiFetch(`/api/invoices?${params}`);
            _invoices = res.data || [];
            _totalRows = res.total || 0;

            _renderInvoices();
            _renderStats();
            _updatePagination();

        } catch (err) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-red-400 text-sm"><i class="fa-solid fa-triangle-exclamation ml-2"></i>${esc(err.message)}</td></tr>`;
        }
    }

    // ── Render invoices table ─────────────────────────────────────────────────
    function _renderInvoices() {
        const tbody = _el('si-tbody');
        const empty = _el('si-empty');
        const thead = _el('si-thead');
        if (!tbody) return;

        if (thead) {
            thead.innerHTML = `
                <tr class="bg-slate-50 text-xs text-slate-500 border-b border-slate-100">
                    <th class="py-3 px-4 text-right font-semibold">رقم الفاتورة</th>
                    <th class="py-3 px-4 text-right font-semibold">التاريخ</th>
                    <th class="py-3 px-4 text-right font-semibold">العميل</th>
                    <th class="py-3 px-4 text-center font-semibold">الحالة</th>
                    <th class="py-3 px-4 text-right font-semibold">المبلغ</th>
                    <th class="py-3 px-4 text-center font-semibold w-32">إجراء</th>
                </tr>
            `;
        }

        if (!_invoices.length) {
            tbody.innerHTML = '';
            if (empty) {
                empty.classList.remove('hidden');
                const t = _el('si-empty-title');
                const s = _el('si-empty-sub');
                const label = _currentTab === 'archive' ? 'لا توجد فواتير معتمدة في الأرشيف' : 'لا توجد فواتير غير معتمدة';
                const sub = _currentTab === 'archive' ? 'ستظهر هنا الفواتير التي تم اعتمادها' : 'اضغط (إنشاء فاتورة جديدة) لإضافة فاتورة';
                if (t) t.textContent = label;
                if (s) s.textContent = sub;
            }
            return;
        }

        if (empty) empty.classList.add('hidden');

        tbody.innerHTML = _invoices.map(i => {
            const clientName = esc(i.client_name || '—');
            const invoiceDate = _date(i.invoice_date);
            const isArchive = _currentTab === 'archive';

            const action = isArchive
                ? `<button onclick="window.siViewInvoice('${esc(i.id)}')" class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-600 text-white text-xs font-bold hover:bg-slate-700 transition-all"><i class="fa-solid fa-eye"></i> عرض</button>`
                : `<button onclick="window.siViewInvoice('${esc(i.id)}')" class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 transition-all"><i class="fa-solid fa-eye"></i> عرض / اعتماد</button>`;

            return `<tr class="border-b border-slate-100 hover:bg-blue-50/30 transition-colors">
                <td class="py-3 px-4 font-bold font-mono text-slate-700">#${i.invoice_number}</td>
                <td class="py-3 px-4 text-slate-600 text-xs">${invoiceDate}</td>
                <td class="py-3 px-4 font-semibold text-slate-800">${clientName}</td>
                <td class="py-3 px-4 text-center">${_statusBadge(i.status)}</td>
                <td class="py-3 px-4 font-bold font-mono text-emerald-600">${fmt(i.grand_total)}</td>
                <td class="py-3 px-4 text-center">${action}</td>
            </tr>`;
        }).join('');
    }

    // ── Stats ─────────────────────────────────────────────────────────────────
    function _renderStats() {
        const _s = (id, v) => { const el = _el(id); if (el) el.textContent = v; };
        const totalAmount = _invoices.reduce((sum, i) => sum + parseFloat(i.grand_total || 0), 0);
        const avg = _invoices.length ? (totalAmount / _invoices.length) : 0;

        _s('si-stat-label-1', 'عدد الفواتير');
        _s('si-stat-total',   _totalRows);
        _s('si-stat-label-2', 'إجمالي القيمة');
        _s('si-stat-amount',  fmt(totalAmount));
        _s('si-stat-label-3', 'متوسط القيمة');
        _s('si-stat-items',   fmt(avg));

        _s('si-showing', _invoices.length);
        _s('si-total',   _totalRows);
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
        _loadInvoices(_currentPage + dir);
    };

    window.siOnFilterChange = function() {
        clearTimeout(window._siDebounce);
        window._siDebounce = setTimeout(() => _loadInvoices(0), 300);
    };

    // ── Create Invoice Modal ─────────────────────────────────────────────────
    window.siCreateInvoice = async function() {
        _resetModal();
        _el('si-modal-overlay')?.classList.remove('hidden');
        _el('si-modal')?.classList.remove('hidden');

        try {
            const res = await window.apiFetch('/api/orders/ready-for-invoice?limit=1000');
            _readyOrders = res.data || [];

            const sel = _el('si-m-order-select');
            if (!sel) return;

            sel.innerHTML = '<option value="">— اختر أمر التشغيل —</option>' +
                _readyOrders.map(o => `<option value="${esc(o.id)}">#${esc(o.order_number)} - ${esc(o.client_name)}</option>`).join('');

            if (window.makeSelectSearchable) {
                window.makeSelectSearchable(sel, '🔍 ابحث عن الأمر...');
            }
        } catch (err) {
            alert('❌ خطأ في تحميل أوامر التشغيل: ' + err.message);
        }
    };

    window.siOnOrderSelected = async function(orderId) {
        _resetItems();
        const order = _readyOrders.find(o => o.id === orderId);
        if (!orderId || !order) return;

        try {
            const res = await window.apiFetch(`/api/orders/${orderId}`);
            const orderData = res.data || {};

            _orderItems = (orderData.items || []).filter(i => i.wh_received_qty > 0).map(i => ({
                variant_id: i.variant_id,
                order_item_id: i.id,
                product_name: i.product_name,
                size_name: i.size_name,
                quantity: i.wh_received_qty,
                unit_price: i.unit_price || 0,
                line_total: i.wh_received_qty * (i.unit_price || 0),
            }));

            if (!_orderItems.length) {
                alert('لا توجد أصناف مستلمة في هذا الأمر');
                return;
            }

            _el('si-m-order-id').value = orderId;
            _el('si-m-client-id').value = order.client_id;
            _el('si-m-order-num').textContent = `#${order.order_number}`;
            _el('si-m-client').value = order.client_name || '';
            _el('si-m-date').value = new Date().toISOString().split('T')[0];
            _el('si-m-due').value = '';
            _el('si-m-tax').value = '15';
            _el('si-m-discount').value = '0';
            _el('si-m-notes').value = '';

            _renderModalItems();
            _calcModalTotals();

        } catch (err) {
            alert('❌ خطأ في تحميل بيانات الأمر: ' + err.message);
        }
    };

    window.siCloseModal = function() {
        _el('si-modal-overlay')?.classList.add('hidden');
        _el('si-modal')?.classList.add('hidden');
        _resetModal();
    };

    function _resetModal() {
        _readyOrders = [];
        _orderItems = [];
        const sel = _el('si-m-order-select');
        if (sel) sel.innerHTML = '<option value="">— اختر أمر التشغيل —</option>';
        _el('si-m-order-id').value = '';
        _el('si-m-client-id').value = '';
        _el('si-m-order-num').textContent = '';
        _el('si-m-client').value = '';
        _el('si-m-date').value = '';
        _el('si-m-due').value = '';
        _el('si-m-tax').value = '15';
        _el('si-m-discount').value = '0';
        _el('si-m-notes').value = '';
        const items = _el('si-m-items');
        if (items) items.innerHTML = '';
        _calcModalTotals();
    }

    function _resetItems() {
        _orderItems = [];
        const items = _el('si-m-items');
        if (items) items.innerHTML = '';
        _el('si-m-order-id').value = '';
        _el('si-m-client-id').value = '';
        _el('si-m-order-num').textContent = '';
        _el('si-m-client').value = '';
        _calcModalTotals();
    }

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

        const taxAmount = subtotal * taxRate;
        const grand = Math.max(0, subtotal + taxAmount - discount);

        const _s = (id, v) => { const el = _el(id); if (el) el.textContent = v; };
        _s('si-m-subtotal', fmt(subtotal));
        _s('si-m-tax-display', (taxRate * 100).toFixed(2));
        _s('si-m-tax-amount', fmt(taxAmount));
        _s('si-m-grand', fmt(grand));
    }

    window.siUpdateDiscount = function(value) {
        _calcModalTotals();
    };

    _el('si-m-tax')?.addEventListener('input', _calcModalTotals);

    window.siCreateWarehouseInvoice = async function() {
        const modal = _el('si-warehouse-modal');
        if (!modal) return;
        _warehouseStock = [];
        modal.classList.remove('hidden');
        const stockSearch = _el('si-w-stock-search');
        if (stockSearch) { stockSearch.value = ''; stockSearch.disabled = true; }
        _el('si-w-date').value = new Date().toISOString().split('T')[0];
        _el('si-w-stock-items').innerHTML = '<tr><td colspan="6" class="py-8 text-center text-slate-400">اختر العميل والمستودع أولاً</td></tr>';
        const clientSel = _el('si-w-client');
        clientSel.innerHTML = '<option value="">— اختر العميل —</option>' + _clients.map(c => `<option value="${esc(c.id)}">${esc(c.parent_name ? `${c.name} — ${c.parent_name}` : c.name)}</option>`).join('');
        if (!_warehouseClientSearchable && window.makeSelectSearchable) {
            _warehouseClientSearchable = window.makeSelectSearchable(clientSel, '🔍 ابحث عن العميل...');
        }
        if (_warehouseClientSearchable) _warehouseClientSearchable.refresh();
    };

    window.siCloseWarehouseInvoice = function() {
        _el('si-warehouse-modal')?.classList.add('hidden');
        _warehouseStock = [];
    };

    window.siWarehouseClientChanged = async function() {
        const clientId = _el('si-w-client')?.value;
        const warehouseSel = _el('si-w-warehouse');
        _warehouseStock = [];
        if (!warehouseSel) return;
        warehouseSel.innerHTML = '<option value="">— اختر المستودع —</option>';
        warehouseSel.disabled = !clientId;
        const stockSearch = _el('si-w-stock-search');
        if (stockSearch) { stockSearch.value = ''; stockSearch.disabled = true; }
        _el('si-w-stock-items').innerHTML = '<tr><td colspan="6" class="py-8 text-center text-slate-400">اختر المستودع</td></tr>';
        if (!clientId) return;
        try {
            const res = await window.apiFetch(`/api/inventory/warehouses?client_id=${encodeURIComponent(clientId)}&status=active`);
            const selectedClient = _clients.find(c => c.id === clientId);
            const allowedClientIds = new Set([
                clientId,
                selectedClient?.parent_id,
                ..._clients.filter(c => c.parent_id === clientId).map(c => c.id),
            ].filter(Boolean));
            const visibleWarehouses = (res.data || []).filter(w => allowedClientIds.has(w.client_id));
            warehouseSel.innerHTML += visibleWarehouses.map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('');
            if (!_warehouseSearchable && window.makeSelectSearchable) {
                _warehouseSearchable = window.makeSelectSearchable(warehouseSel, '🔍 ابحث عن المستودع...');
            }
            if (_warehouseSearchable) _warehouseSearchable.refresh();
        } catch (err) {
            alert(`❌ تعذر تحميل مستودعات العميل: ${err.message}`);
        }
    };

    function _renderWarehouseStock() {
        const body = _el('si-w-stock-items');
        const search = (_el('si-w-stock-search')?.value || '').trim().toLowerCase();
        if (!body) return;
        if (!search) {
            body.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-slate-400">اكتب اسم الصنف أو رقمه لعرض النتائج</td></tr>';
            return;
        }
        const matches = _warehouseStock.filter(s => [s.product_name, s.product_sku, s.variant_sku, s.variant_size].some(v => String(v || '').toLowerCase().includes(search)));
        body.innerHTML = matches.length ? matches.map(s => {
            const i = _warehouseStock.indexOf(s);
            return `<tr class="border-b border-slate-100" data-index="${i}"><td class="py-2 px-3 font-semibold">${esc(s.product_name || '—')}</td><td class="py-2 px-3 text-slate-500">${esc(s.variant_size || '—')}</td><td class="py-2 px-3 text-center font-bold text-emerald-600">${qty(s.available_qty)}</td><td class="py-2 px-3 text-center"><input class="si-w-qty w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-center" type="number" min="0" max="${s.available_qty}" step="0.001" value="${s.selectedQty || 0}" data-index="${i}" oninput="window.siWarehouseCalc()"></td><td class="py-2 px-3 text-center"><input class="si-w-price w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-center" type="number" min="0" step="0.01" value="${s.selectedPrice ?? Number(s.selling_price || 0).toFixed(2)}" data-index="${i}" oninput="window.siWarehouseCalc()"></td><td class="py-2 px-3 text-center font-mono" data-line-total="${i}">${fmt((s.selectedQty || 0) * (s.selectedPrice ?? s.selling_price ?? 0))}</td></tr>`;
        }).join('') : '<tr><td colspan="6" class="py-8 text-center text-slate-400">لا توجد نتائج مطابقة</td></tr>';
        window.siWarehouseCalc();
    }

    window.siWarehouseStockSearch = function() { _renderWarehouseStock(); };

    window.siWarehouseChanged = async function() {
        const clientId = _el('si-w-client')?.value;
        const warehouseId = _el('si-w-warehouse')?.value;
        const body = _el('si-w-stock-items');
        const stockSearch = _el('si-w-stock-search');
        _warehouseStock = [];
        if (stockSearch) { stockSearch.value = ''; stockSearch.disabled = !warehouseId; }
        if (!clientId || !warehouseId) {
            body.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-slate-400">اختر العميل والمستودع أولاً</td></tr>';
            return;
        }
        body.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin"></i> جاري تحميل المخزون...</td></tr>';
        try {
            const res = await window.apiFetch(`/api/inventory/stock?client_id=${encodeURIComponent(clientId)}&warehouse_id=${encodeURIComponent(warehouseId)}&limit=1000`);
            _warehouseStock = (res.data || []).filter(s => s.client_id === clientId && parseFloat(s.available_qty || 0) > 0);
            _el('si-w-stock-count').textContent = `${_warehouseStock.length} صنف متاح`;
            _renderWarehouseStock();
        } catch (err) {
            body.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-red-400">${esc(err.message)}</td></tr>`;
        }
    };

    window.siWarehouseCalc = function() {
        let subtotal = 0;
        document.querySelectorAll('#si-w-stock-items tr[data-index]').forEach(row => {
            const i = Number(row.dataset.index);
            const quantity = parseFloat(row.querySelector('.si-w-qty')?.value || 0);
            const price = parseFloat(row.querySelector('.si-w-price')?.value || 0);
            const stock = _warehouseStock[i];
            if (stock) { stock.selectedQty = quantity; stock.selectedPrice = price; }
            const total = quantity * price;
            subtotal += total;
            const line = row.querySelector('[data-line-total]');
            if (line) line.textContent = fmt(total);
        });
        const tax = subtotal * (parseFloat(_el('si-w-tax')?.value || 15) / 100);
        _el('si-w-subtotal').textContent = fmt(subtotal);
        _el('si-w-tax-amount').textContent = fmt(tax);
        _el('si-w-grand').textContent = fmt(subtotal + tax);
    };

    window.siSaveWarehouseInvoice = async function() {
        const clientId = _el('si-w-client')?.value;
        const warehouseId = _el('si-w-warehouse')?.value;
        const items = _warehouseStock
            .filter(stock => parseFloat(stock.selectedQty || 0) > 0)
            .map(stock => ({
                stock_id: stock.stock_id,
                variant_id: stock.variant_id,
                quantity: parseFloat(stock.selectedQty),
                unit_price: parseFloat(stock.selectedPrice ?? stock.selling_price ?? 0),
            }));
        if (!clientId || !warehouseId) return alert('اختر العميل والمستودع أولاً');
        if (!items.length) return alert('أدخل كمية لصنف واحد على الأقل');
        const btn = _el('si-w-save');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري الإصدار...'; }
        try {
            const res = await window.apiFetch('/api/invoices', { method: 'POST', body: {
                client_id: clientId, warehouse_id: warehouseId, source: 'warehouse',
                invoice_date: _el('si-w-date')?.value, due_date: _el('si-w-due')?.value || null,
                tax_rate: parseFloat(_el('si-w-tax')?.value || 15) / 100,
                notes: _el('si-w-notes')?.value || '', items,
            }});
            const invoice = res.data || res;
            alert(`✅ تم إصدار الفاتورة #${invoice.invoice_number} وإنشاء أمر الفسح`);
            window.siCloseWarehouseInvoice();
            window.navigateTo(`sales-invoice-detail?id=${invoice.id}`);
        } catch (err) {
            alert(`❌ خطأ: ${err.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-invoice ml-1"></i> إصدار الفاتورة وإنشاء أمر الفسح'; }
        }
    };

    // ── Save Invoice ─────────────────────────────────────────────────────────
    window.siSaveInvoice = async function() {
        const orderId = _el('si-m-order-id')?.value;
        const clientId = _el('si-m-client-id')?.value;

        if (!orderId || !clientId) {
            alert('اختر أمر التشغيل أولاً');
            return;
        }

        const btn = _el('si-m-save-btn');
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

            const invoiceData = res?.data || res || {};
            const invoiceId = invoiceData?.id;
            alert(`✅ تم إنشاء الفاتورة رقم #${invoiceData?.invoice_number}`);
            window.siCloseModal();

            if (invoiceId) {
                window.navigateTo(`sales-invoice-detail?id=${invoiceId}`);
            } else {
                _loadInvoices(0);
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

    // ── Init ────────────────────────────────────────────────────────────────────
    async function _init() {
        await _loadData();

        // If redirected here after marking issued, open archive tab
        if (sessionStorage.getItem('si_after_issued') === '1') {
            sessionStorage.removeItem('si_after_issued');
            _currentTab = 'archive';
        }

        _setActiveTab(_currentTab);
        await _loadInvoices(0);
    }

    _init();
})();
