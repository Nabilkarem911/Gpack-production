'use strict';

// =============================================================================
// G.PACK 2.0 — Purchase Invoices View Controller (Order-Based)
// يعرض أوامر التصنيع الجاهزة وينشئ فواتير مشتريات منها مباشرة
// =============================================================================

(function () {

    const PAGE_SIZE = 20;
    let _currentPage = 0;
    let _totalRows = 0;
    let _moList = [];      // Manufacturer orders ready for invoicing
    let _suppliers = [];
    let _modalItems = [];  // Items of selected MO

    const fmt  = (v) => parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const qty  = (v) => parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
    const esc  = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _el  = (id) => document.getElementById(id);

    // ── Load suppliers for filter ─────────────────────────────────────────────
    async function _loadData() {
        try {
            const res = await window.apiFetch('/api/suppliers');
            _suppliers = res.data || [];
            const sel = _el('pi-supplier');
            if (sel) {
                _suppliers.forEach(s => {
                    const o = document.createElement('option');
                    o.value = s.id;
                    o.textContent = s.name || s.company_name;
                    sel.appendChild(o);
                });
            }
        } catch (_) {}
    }

    // ── Fetch MOs ready for invoicing ─────────────────────────────────────────
    async function _loadOrders(page = 0) {
        _currentPage = page;
        const tbody = _el('pi-tbody');
        const empty = _el('pi-empty');

        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i></td></tr>`;
        if (empty) empty.classList.add('hidden');

        const params = new URLSearchParams({
            status: 'received,ordered',
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
            _t: Date.now(),
        });

        const search   = _el('pi-search')?.value?.trim();
        const supplier = _el('pi-supplier')?.value;

        if (search)   params.set('search',      search);
        if (supplier) params.set('supplier_id', supplier);

        try {
            const res = await window.apiFetch(`/api/manufacturer-orders?${params}`);
            _moList     = res.data  || [];
            _totalRows  = res.total || _moList.length;

            _renderTable();
            _renderStats();
            _updatePagination();

        } catch (err) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-red-400 text-sm"><i class="fa-solid fa-triangle-exclamation ml-2"></i>${esc(err.message)}</td></tr>`;
        }
    }

    // ── Render MO list ────────────────────────────────────────────────────────
    function _renderTable() {
        const tbody = _el('pi-tbody');
        const empty = _el('pi-empty');
        if (!tbody) return;

        if (!_moList.length) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        tbody.innerHTML = _moList.map(mo => {
            const supplierName = esc(mo.supplier_name || '—');
            const clientName   = esc(mo.client_name   || '—');
            const orderDate    = new Date(mo.created_at).toLocaleDateString('ar-SA-u-nu-latn');
            const subtotal   = parseFloat(mo.total_cost || 0);
            const grandTotal  = subtotal * 1.15; // 15% VAT

            return `<tr class="border-b border-slate-100 hover:bg-purple-50/30 transition-colors">
                <td class="py-3 px-4 font-bold font-mono text-slate-700">#${mo.po_number || mo.mo_number}</td>
                <td class="py-3 px-4 text-slate-600 text-xs">${orderDate}</td>
                <td class="py-3 px-4 font-semibold text-slate-800">${supplierName}</td>
                <td class="py-3 px-4 font-semibold text-slate-700">${clientName}</td>
                <td class="py-3 px-4 text-center">
                    <span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-blue-100 text-blue-700">
                        <i class="fa-solid fa-box"></i> ${mo.item_count || 0}
                    </span>
                </td>
                <td class="py-3 px-4 font-bold font-mono text-purple-600">
                    ${fmt(grandTotal)}
                    <div class="text-xs text-slate-400 font-normal">${fmt(subtotal)} + ضريبة</div>
                </td>
                <td class="py-3 px-4 text-center">
                    <button onclick="window.piOpenCreateModal('${esc(mo.id)}')"
                            class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 text-white text-xs font-bold hover:bg-purple-700 transition-all">
                        <i class="fa-solid fa-file-invoice"></i> إنشاء فاتورة
                    </button>
                </td>
            </tr>`;
        }).join('');
    }

    // ── Stats ─────────────────────────────────────────────────────────────────
    function _renderStats() {
        const totalSubtotal = _moList.reduce((s, m) => s + parseFloat(m.total_cost || 0), 0);
        const totalGrand    = totalSubtotal * 1.15;
        const totalItems    = _moList.reduce((s, m) => s + parseInt(m.item_count  || 0), 0);

        const _s = (id, v) => { const el = _el(id); if (el) el.textContent = v; };
        _s('pi-stat-total',  _totalRows);
        _s('pi-stat-amount', fmt(totalGrand));
        _s('pi-stat-items',  totalItems);
        _s('pi-showing',     _moList.length);
        _s('pi-total',       _totalRows);
        const badge = _el('pi-tab-badge');
        if (badge) badge.textContent = _totalRows;
    }

    // ── Pagination ─────────────────────────────────────────────────────────────
    function _updatePagination() {
        const pageEl  = _el('pi-page');
        const prevBtn = _el('pi-prev');
        const nextBtn = _el('pi-next');

        if (pageEl)  pageEl.textContent = _currentPage + 1;
        if (prevBtn) prevBtn.disabled = _currentPage === 0;
        if (nextBtn) nextBtn.disabled = (_currentPage + 1) * PAGE_SIZE >= _totalRows;
    }

    window.piChangePage = function(dir) {
        _loadOrders(_currentPage + dir);
    };

    window.piOnFilterChange = function() {
        clearTimeout(window._piDebounce);
        window._piDebounce = setTimeout(() => _loadOrders(0), 300);
    };

    // ── Modal: open from MO row ───────────────────────────────────────────────
    window.piOpenCreateModal = async function(moId) {
        const mo = _moList.find(m => m.id === moId);
        if (!mo) return;

        try {
            const res    = await window.apiFetch(`/api/manufacturer-orders/${moId}`);
            const moData = res.data || {};

            _modalItems = (moData.items || []).map(i => ({
                variant_id:   i.variant_id,
                product_name: i.product_name,
                size_name:    i.size_name || i.variant_name || '',
                quantity:     parseFloat(i.wh_received_qty || i.mo_quantity || 1),
                unit_price:   parseFloat(i.unit_cost || 0),
                line_total:   parseFloat(i.wh_received_qty || i.mo_quantity || 1) * parseFloat(i.unit_cost || 0),
            }));

            if (!_modalItems.length) {
                alert('لا توجد أصناف في هذا الأمر');
                return;
            }

            _el('pi-m-mo-id').value         = moId;
            _el('pi-m-supplier-id').value   = mo.supplier_id || moData.supplier_id || '';
            _el('pi-m-supplier-name').value = mo.supplier_name || moData.supplier_name || '—';
            _el('pi-m-order-num').textContent = `#${mo.po_number || mo.mo_number}`;
            _el('pi-m-date').value = new Date().toISOString().split('T')[0];
            _el('pi-m-due').value  = '';
            _el('pi-m-ref').value  = '';
            _el('pi-m-tax').value  = '15';
            _el('pi-m-notes').value = '';

            _renderModalItems();
            _calcModalTotals();

            _el('pi-modal-overlay')?.classList.remove('hidden');
            _el('pi-modal')?.classList.remove('hidden');

        } catch (err) {
            alert('❌ خطأ في تحميل بيانات الأمر: ' + err.message);
        }
    };

    window.piCloseModal = function() {
        _el('pi-modal-overlay')?.classList.add('hidden');
        _el('pi-modal')?.classList.add('hidden');
        _modalItems = [];
    };

    // ── Render modal items (read-only product name, editable price) ───────────
    function _renderModalItems() {
        const tbody = _el('pi-m-items');
        if (!tbody) return;

        tbody.innerHTML = _modalItems.map((item, i) => {
            const productLabel = `${esc(item.product_name)} — ${esc(item.size_name || 'بدون مقاس')}`;
            return `<tr class="border-b border-slate-100">
                <td class="py-3 px-3">
                    <div class="text-sm font-semibold text-slate-800">${productLabel}</div>
                </td>
                <td class="py-3 px-3 text-center">
                    <span class="text-sm font-bold text-slate-700">${item.quantity}</span>
                </td>
                <td class="py-3 px-3 text-center">
                    <input type="number" min="0" step="0.01" value="${item.unit_price}"
                           id="pi-price-${i}"
                           onchange="window.piUpdatePrice(${i}, this.value)"
                           class="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center font-mono focus:border-purple-400 outline-none" />
                </td>
                <td class="py-3 px-3 text-center font-mono text-sm font-bold text-purple-600" id="pi-line-${i}">
                    ${fmt(item.line_total)}
                </td>
            </tr>`;
        }).join('');
    }

    window.piUpdatePrice = function(idx, value) {
        _modalItems[idx].unit_price = parseFloat(value) || 0;
        _modalItems[idx].line_total = _modalItems[idx].quantity * _modalItems[idx].unit_price;
        const el = _el(`pi-line-${idx}`);
        if (el) el.textContent = fmt(_modalItems[idx].line_total);
        _calcModalTotals();
    };

    function _calcModalTotals() {
        const taxRate = parseFloat(_el('pi-m-tax')?.value || 15) / 100;
        let subtotal = 0;
        for (const item of _modalItems) subtotal += item.line_total;
        const taxAmount = subtotal * taxRate;
        const grand     = subtotal + taxAmount;

        const _s = (id, v) => { const el = _el(id); if (el) el.textContent = v; };
        _s('pi-m-subtotal',    fmt(subtotal));
        _s('pi-m-tax-display', (taxRate * 100).toFixed(2));
        _s('pi-m-tax-amount',  fmt(taxAmount));
        _s('pi-m-grand',       fmt(grand));
    }

    document.addEventListener('input', e => {
        if (e.target.id === 'pi-m-tax') _calcModalTotals();
    });

    // ── Save Invoice ──────────────────────────────────────────────────────────
    window.piSaveInvoice = async function() {
        const supplierId = _el('pi-m-supplier-id')?.value;
        const moId       = _el('pi-m-mo-id')?.value;

        if (!supplierId) { alert('بيانات المورد غير مكتملة'); return; }
        if (!_modalItems.length) { alert('لا توجد أصناف'); return; }

        const btn = document.querySelector('#pi-modal button[onclick="window.piSaveInvoice()"]');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جاري الحفظ...'; }

        try {
            const payload = {
                supplier_id:            supplierId,
                manufacturer_order_id:  moId || null,
                invoice_date:           _el('pi-m-date')?.value,
                due_date:               _el('pi-m-due')?.value  || null,
                supplier_invoice_ref:   _el('pi-m-ref')?.value  || null,
                tax_rate:               parseFloat(_el('pi-m-tax')?.value || 15) / 100,
                notes:                  _el('pi-m-notes')?.value || '',
                items: _modalItems.map(i => ({
                    variant_id: i.variant_id,
                    quantity:   i.quantity,
                    unit_price: i.unit_price,
                })),
            };

            const res = await window.apiFetch('/api/purchase-invoices', {
                method: 'POST',
                body: payload,
            });

            alert(`✅ تم إنشاء فاتورة المشتريات رقم #${res.invoice?.invoice_number}`);
            window.piCloseModal();
            _arcLoaded = false;          // force archive reload
            await _loadOrders(0);        // refresh orders tab (removes invoiced MO)
            window.piSwitchTab('archive'); // jump to archive to show new invoice

        } catch (err) {
            alert(`❌ خطأ: ${err.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-invoice ml-1"></i> إنشاء الفاتورة'; }
        }
    };

    // ── Tab switching ─────────────────────────────────────────────────────────
    let _activeTab = 'orders';

    window.piSwitchTab = function(tab) {
        _activeTab = tab;
        const tabOrders  = _el('pi-tab-orders');
        const tabArchive = _el('pi-tab-archive');
        const panelOrders  = _el('pi-panel-orders');
        const panelArchive = _el('pi-panel-archive');

        if (tab === 'orders') {
            tabOrders?.classList.add('bg-white', 'text-slate-800', 'shadow-sm');
            tabOrders?.classList.remove('text-slate-500');
            tabArchive?.classList.remove('bg-white', 'text-slate-800', 'shadow-sm');
            tabArchive?.classList.add('text-slate-500');
            panelOrders?.classList.remove('hidden');
            panelArchive?.classList.add('hidden');
        } else {
            tabArchive?.classList.add('bg-white', 'text-slate-800', 'shadow-sm');
            tabArchive?.classList.remove('text-slate-500');
            tabOrders?.classList.remove('bg-white', 'text-slate-800', 'shadow-sm');
            tabOrders?.classList.add('text-slate-500');
            panelArchive?.classList.remove('hidden');
            panelOrders?.classList.add('hidden');
            if (!_arcLoaded) _loadArchive(0);
        }
    };

    // ── Archive ───────────────────────────────────────────────────────────────
    let _arcPage    = 0;
    let _arcTotal   = 0;
    let _arcList    = [];
    let _arcLoaded  = false;

    async function _loadArchive(page = 0) {
        _arcPage   = page;
        _arcLoaded = true;
        const tbody = _el('pi-arc-tbody');
        const empty = _el('pi-arc-empty');

        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i></td></tr>`;
        if (empty) empty.classList.add('hidden');

        const params = new URLSearchParams({
            limit:  PAGE_SIZE,
            offset: page * PAGE_SIZE,
            _t:     Date.now(),
        });
        const search = _el('pi-arc-search')?.value?.trim();
        const status = _el('pi-arc-status')?.value;
        if (search) params.set('search', search);
        if (status) params.set('status', status);

        try {
            const res = await window.apiFetch(`/api/purchase-invoices?${params}`);
            _arcList  = res.data  || [];
            _arcTotal = res.total || _arcList.length;
            _renderArchive();
            _updateArcPagination();
        } catch (err) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-red-400 text-sm"><i class="fa-solid fa-triangle-exclamation ml-2"></i>${esc(err.message)}</td></tr>`;
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
            return `<tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td class="py-3 px-4 font-bold font-mono text-slate-700">#${inv.invoice_number}</td>
                <td class="py-3 px-4 text-slate-500 text-xs">${date}</td>
                <td class="py-3 px-4 font-semibold text-slate-800">${esc(inv.supplier_name || '—')}</td>
                <td class="py-3 px-4 text-slate-500 text-xs hidden sm:table-cell">${esc(inv.supplier_invoice_ref || '—')}</td>
                <td class="py-3 px-4 font-bold font-mono text-purple-600">${fmt(inv.grand_total)}</td>
                <td class="py-3 px-4 text-center">
                    <span class="px-2 py-1 rounded-lg text-xs font-bold ${st.bg} ${st.text}">${st.label}</span>
                </td>
                <td class="py-3 px-4 text-center">
                    <button onclick="window.piViewInvoice('${esc(inv.id)}')"
                            class="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-all" title="طباعة">
                        <i class="fa-solid fa-print text-xs"></i>
                    </button>
                </td>
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

    // ── View / Print Invoice ──────────────────────────────────────────────────
    window.piViewInvoice = async function(id) {
        try {
            const res   = await window.apiFetch(`/api/purchase-invoices/${id}`);
            const inv   = res.invoice;
            const items = res.items || [];

            const statusLabels = { unpaid: 'غير مدفوعة', partially_paid: 'مدفوعة جزئياً', paid: 'مدفوعة', cancelled: 'ملغية' };
            const statusColors = { unpaid: '#dc2626', partially_paid: '#d97706', paid: '#15803d', cancelled: '#64748b' };
            const statusBgs    = { unpaid: '#fee2e2', partially_paid: '#fef3c7', paid: '#dcfce7', cancelled: '#f1f5f9' };
            const statusText  = statusLabels[inv.status] || inv.status;
            const statusColor = statusColors[inv.status] || '#64748b';
            const statusBg    = statusBgs[inv.status]    || '#f1f5f9';

            const itemsRows = items.map((item, idx) => `
                <tr>
                    <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;color:#94a3b8">${idx + 1}</td>
                    <td style="padding:8px 10px;border:1px solid #e2e8f0;font-weight:600">${esc(item.product_name)}</td>
                    <td style="padding:8px 10px;border:1px solid #e2e8f0;color:#64748b">${esc(item.size_name || '-')}</td>
                    <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;font-family:monospace">${item.quantity}</td>
                    <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:left;font-family:monospace">${fmt(item.unit_cost)}</td>
                    <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:left;font-family:monospace;font-weight:700;color:#15803d">${fmt(item.total_cost)}</td>
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
        await _loadData();
        await _loadOrders(0);
    }

    _init();

})();
