'use strict';

// =============================================================================
// G.PACK 2.0 — Inventory Analytics 360° View
// أرصدة · معدلات استهلاك · حركات · تحليلات شاملة
// =============================================================================

window.inventoryView = {

    // ── State ─────────────────────────────────────────────────────────────────
    currentStock:   [],
    warehouses:     [],
    categories:     [],
    transactions:   [],
    selectedItem:   null,
    _activeTab:     'stock',
    _searchTimeout: null,

    // ── Init ──────────────────────────────────────────────────────────────────
    async _init() {
        console.log('[Inventory] Initializing view...');
        await Promise.all([
            this._loadWarehouses(),
            this._loadCategories()
        ]);
        await this._loadInventory();
        this._attachEventListeners();
        this._switchTab('stock');
    },

    // ── Load Warehouses ───────────────────────────────────────────────────────
    async _loadWarehouses() {
        try {
            const res = await apiFetch('/api/inventory/warehouses');
            this.warehouses = res.data || [];
            ['filter-warehouse', 'adj-warehouse', 'tx-filter-warehouse'].forEach(id => {
                const sel = document.getElementById(id);
                if (!sel) return;
                const placeholder = sel.options[0]?.text || '';
                sel.innerHTML = `<option value="">${placeholder}</option>`;
                this.warehouses.forEach(w => {
                    sel.innerHTML += `<option value="${w.id}">${w.name}</option>`;
                });
            });
        } catch (e) {
            console.error('[Inventory] Failed to load warehouses:', e);
        }
    },

    // ── Load Categories ───────────────────────────────────────────────────────
    async _loadCategories() {
        try {
            const res = await apiFetch('/api/categories');
            this.categories = res.data || [];
            const sel = document.getElementById('filter-category');
            if (sel) {
                sel.innerHTML = '<option value="">جميع الفئات</option>';
                this.categories.forEach(c => {
                    sel.innerHTML += `<option value="${c.id}">${c.name}</option>`;
                });
            }
        } catch (e) {
            console.error('[Inventory] Failed to load categories:', e);
        }
    },

    // ── Load Stock ────────────────────────────────────────────────────────────
    async _loadInventory() {
        const warehouseId  = document.getElementById('filter-warehouse')?.value  || '';
        const categoryId   = document.getElementById('filter-category')?.value   || '';
        const search       = document.getElementById('search-product')?.value    || '';
        const stockStatus  = document.getElementById('filter-stock-status')?.value || '';

        let url = '/api/inventory/stock?limit=500&';
        if (warehouseId) url += `warehouse_id=${warehouseId}&`;
        if (categoryId)  url += `category_id=${categoryId}&`;
        if (search)      url += `search=${encodeURIComponent(search)}&`;
        if (stockStatus === 'low')  url += 'low_stock=true&';
        if (stockStatus === 'out')  url += 'out_of_stock=true&';

        try {
            const res = await apiFetch(url);
            this.currentStock = res.data || [];

            // Client-side filter for 'out' and 'normal'
            if (stockStatus === 'out') {
                this.currentStock = this.currentStock.filter(i => parseFloat(i.available_qty||0) <= 0);
            } else if (stockStatus === 'normal') {
                this.currentStock = this.currentStock.filter(i => {
                    const a = parseFloat(i.available_qty||0);
                    const r = parseFloat(i.reorder_point||0);
                    return a > 0 && (r === 0 || a > r);
                });
            }

            this._renderStockTable();
            this._updateStats();
            this._checkLowStock();
            this._renderSmartAlerts(this.currentStock);
            if (this._activeTab === 'analytics') this._renderAnalytics();
        } catch (e) {
            console.error('[Inventory] Failed to load stock:', e);
            this._showToast('فشل تحميل بيانات المخزون', 'error');
        }
    },

    // ── Load Transactions ─────────────────────────────────────────────────────
    async _loadTransactions() {
        const warehouseId = document.getElementById('tx-filter-warehouse')?.value || '';
        const txType      = document.getElementById('tx-filter-type')?.value      || '';
        const fromDate    = document.getElementById('tx-from')?.value             || '';
        const toDate      = document.getElementById('tx-to')?.value               || '';

        let url = '/api/inventory/transactions?limit=200&';
        if (warehouseId) url += `warehouse_id=${warehouseId}&`;
        if (txType)      url += `type=${txType}&`;
        if (fromDate)    url += `from=${fromDate}&`;
        if (toDate)      url += `to=${toDate}&`;

        try {
            const res = await apiFetch(url);
            this.transactions = res.data || [];
            this._renderTransactions();
        } catch (e) {
            console.error('[Inventory] Failed to load transactions:', e);
        }
    },

    // ── Tab Switching ─────────────────────────────────────────────────────────
    _switchTab(tab) {
        this._activeTab = tab;
        const tabs = ['stock', 'transactions', 'analytics', 'clients'];
        const activeBtn   = 'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-white text-emerald-700 shadow-sm transition-all';
        const inactiveBtn = 'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:text-slate-700 transition-all';

        tabs.forEach(t => {
            const btn = document.getElementById(`inv-tab-${t}`);
            const sec = document.getElementById(`inv-section-${t}`);
            if (btn) btn.className = (t === tab) ? activeBtn : inactiveBtn;
            if (sec) sec.classList.toggle('hidden', t !== tab);
        });

        if (tab === 'transactions' && !this.transactions.length) {
            this._loadTransactions();
        }
        if (tab === 'analytics') {
            this._renderAnalytics();
        }
        if (tab === 'clients') {
            this._caInit();
        }
    },

    // ── Client Analytics — State ──────────────────────────────────────────────
    _caData:       null,
    _caAllItems:   [],
    _caSearchTerm: '',

    // ── Client Analytics — Init ───────────────────────────────────────────────
    async _caInit() {
        // تحميل قائمة العملاء مرة واحدة فقط
        const sel = document.getElementById('ca-client');
        if (!sel || sel.options.length > 1) return;
        try {
            let res = await apiFetch('/api/clients?status=active&limit=500');
            let clients = res.data || [];
            if (!clients.length) {
                res = await apiFetch('/api/clients?limit=500');
                clients = res.data || [];
            }
            clients.forEach(c => {
                sel.innerHTML += `<option value="${c.id}">${c.name}</option>`;
            });
        } catch(e) {
            console.error('[CA] Failed to load clients:', e);
        }

        // ضبط التواريخ الافتراضية: آخر 90 يوم
        this._caSetRange(90);

        // بحث فوري في الجدول
        const searchEl = document.getElementById('ca-search');
        if (searchEl) {
            searchEl.addEventListener('input', () => {
                this._caSearchTerm = searchEl.value.toLowerCase();
                this._caRenderTable(this._caAllItems);
            });
        }
    },

    // ── Quick Date Range ──────────────────────────────────────────────────────
    _caSetRange(days) {
        const to   = new Date();
        const from = new Date(Date.now() - days * 24 * 3600 * 1000);
        const fmt  = d => d.toISOString().split('T')[0];
        const fromEl = document.getElementById('ca-from');
        const toEl   = document.getElementById('ca-to');
        if (fromEl) fromEl.value = fmt(from);
        if (toEl)   toEl.value   = fmt(to);
    },

    // ── Load Client Analytics ─────────────────────────────────────────────────
    async _loadClientAnalytics() {
        const clientId = document.getElementById('ca-client')?.value;
        const from     = document.getElementById('ca-from')?.value;
        const to       = document.getElementById('ca-to')?.value;

        if (!clientId) { this._showToast('اختر عميلاً أولاً', 'error'); return; }

        // Loading state
        const placeholder = document.getElementById('ca-placeholder');
        if (placeholder) {
            placeholder.classList.remove('hidden');
            placeholder.innerHTML = `
                <i class="fa-solid fa-circle-notch fa-spin text-4xl mb-4 block text-emerald-400"></i>
                <p class="font-bold text-slate-400">جاري تحليل بيانات العميل...</p>`;
        }
        ['ca-kpis','ca-table-wrap','ca-monthly-wrap'].forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });

        try {
            let url = `/api/inventory/client-analytics?client_id=${clientId}`;
            if (from) url += `&from=${from}`;
            if (to)   url += `&to=${to}`;

            const res = await apiFetch(url);
            this._caData    = res.data;
            this._caAllItems = res.data.items || [];

            if (placeholder) placeholder.classList.add('hidden');

            this._caRenderKPIs();
            this._caRenderTable(this._caAllItems);
            this._caRenderMonthly();

        } catch(e) {
            console.error('[CA] Failed:', e);
            if (placeholder) {
                placeholder.classList.remove('hidden');
                placeholder.innerHTML = `
                    <i class="fa-solid fa-circle-exclamation text-4xl mb-3 block text-red-400"></i>
                    <p class="font-bold text-red-500">فشل في تحميل البيانات</p>
                    <p class="text-sm text-slate-400 mt-1">${e.message || ''}</p>`;
            }
        }
    },

    // ── KPI Cards ─────────────────────────────────────────────────────────────
    _caRenderKPIs() {
        const container = document.getElementById('ca-kpis');
        if (!container || !this._caData) return;

        const items      = this._caAllItems;
        const totalQty   = items.reduce((s, i) => s + i.total_dispensed, 0);
        const avgDaily   = items.reduce((s, i) => s + i.daily_rate, 0);
        const critical   = items.filter(i => i.coverage_days !== null && i.coverage_days <= 14).length;
        const uniqueSkus = items.length;

        const kpis = [
            { label: 'إجمالي المصروف', value: this._fmtN(totalQty), sub: `خلال ${this._caData.period_days} يوم`, icon: 'fa-box-open', color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'معدل يومي إجمالي', value: this._fmtN(avgDaily), sub: 'قطعة/يوم متوسط', icon: 'fa-gauge-high', color: 'text-emerald-600', bg: 'bg-emerald-50' },
            { label: 'أصناف نشطة', value: uniqueSkus, sub: 'صنف له حركة صرف', icon: 'fa-layer-group', color: 'text-purple-600', bg: 'bg-purple-50' },
            { label: 'تحت الخطر', value: critical, sub: 'تغطية أقل من 14 يوم', icon: 'fa-triangle-exclamation', color: critical > 0 ? 'text-red-600' : 'text-slate-400', bg: critical > 0 ? 'bg-red-50' : 'bg-slate-50' }
        ];

        container.innerHTML = kpis.map(k => `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                <div class="w-11 h-11 rounded-xl ${k.bg} ${k.color} flex items-center justify-center flex-shrink-0">
                    <i class="fa-solid ${k.icon} text-lg"></i>
                </div>
                <div>
                    <p class="text-2xl font-black ${k.color}">${k.value}</p>
                    <p class="text-xs font-bold text-slate-700">${k.label}</p>
                    <p class="text-[10px] text-slate-400">${k.sub}</p>
                </div>
            </div>`).join('');

        container.classList.remove('hidden');

        // update period label
        const clientName = document.getElementById('ca-client')?.selectedOptions[0]?.text || '';
        this._set('ca-table-title',  `معدل دوران الأصناف — ${clientName}`);
        this._set('ca-period-label', `من ${this._caData.from?.split('T')[0] || ''} إلى ${this._caData.to?.split('T')[0] || ''} (${this._caData.period_days} يوم)`);
    },

    // ── Main Table ────────────────────────────────────────────────────────────
    _caRenderTable(items) {
        const tbody = document.getElementById('ca-table-body');
        const wrap  = document.getElementById('ca-table-wrap');
        if (!tbody || !wrap) return;

        const filtered = this._caSearchTerm
            ? items.filter(i => (i.product_name + ' ' + i.variant_name).toLowerCase().includes(this._caSearchTerm))
            : items;

        if (!filtered.length) {
            tbody.innerHTML = `<tr><td colspan="8" class="py-10 text-center text-slate-300">
                <i class="fa-solid fa-inbox text-3xl mb-2 block"></i>لا توجد بيانات صرف في هذه الفترة</td></tr>`;
            wrap.classList.remove('hidden');
            return;
        }

        const maxDispensed = Math.max(...filtered.map(i => i.total_dispensed), 1);

        tbody.innerHTML = filtered.map(item => {
            const pct   = Math.round((item.total_dispensed / maxDispensed) * 100);
            const monthly = (item.daily_rate * 30).toFixed(1);

            // أيام التغطية — تصنيف الخطر
            let coverageBadge, coverageClass;
            if (item.coverage_days === null) {
                coverageBadge = '<span class="text-slate-300">—</span>';
                coverageClass = '';
            } else if (item.coverage_days <= 7) {
                coverageBadge = `<span class="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold">${item.coverage_days} يوم</span>`;
                coverageClass = 'bg-red-50/40';
            } else if (item.coverage_days <= 14) {
                coverageBadge = `<span class="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">${item.coverage_days} يوم</span>`;
                coverageClass = 'bg-amber-50/40';
            } else if (item.coverage_days <= 30) {
                coverageBadge = `<span class="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">${item.coverage_days} يوم</span>`;
                coverageClass = '';
            } else {
                coverageBadge = `<span class="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">${item.coverage_days} يوم</span>`;
                coverageClass = '';
            }

            // مستوى الخطر badge
            let riskBadge;
            if (!item.coverage_days)                      riskBadge = '<span class="text-xs text-slate-300">بلا رصيد</span>';
            else if (item.coverage_days <= 7)             riskBadge = '<span class="px-2 py-1 bg-red-100 text-red-700 rounded-lg text-xs font-bold">⚠ خطر</span>';
            else if (item.coverage_days <= 14)            riskBadge = '<span class="px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold">تنبيه</span>';
            else if (item.coverage_days <= 30)            riskBadge = '<span class="px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold">متابعة</span>';
            else                                          riskBadge = '<span class="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold">مستقر</span>';

            const lastDate = item.last_dispense_date
                ? new Date(item.last_dispense_date).toLocaleDateString('ar-EG', {day:'2-digit', month:'short'})
                : '—';

            return `
            <tr class="${coverageClass} hover:bg-slate-50 border-b border-slate-100 transition-colors">
                <td class="px-4 py-3">
                    <div class="font-semibold text-slate-800">${item.product_name}</div>
                    <div class="text-xs text-slate-400">${item.variant_name || ''} · ${item.warehouse_name || ''}</div>
                    <div class="mt-1.5 flex items-center gap-2">
                        <div class="flex-1 bg-slate-100 rounded-full h-1.5 max-w-[120px]">
                            <div class="h-1.5 rounded-full bg-emerald-400" style="width:${pct}%"></div>
                        </div>
                        <span class="text-[10px] text-slate-400">${pct}%</span>
                    </div>
                </td>
                <td class="px-4 py-3 text-center font-black text-slate-800 text-base">${this._fmtN(item.total_dispensed)}</td>
                <td class="px-4 py-3 text-center">
                    <span class="font-bold text-emerald-600">${item.daily_rate}</span>
                    <span class="text-xs text-slate-400"> /يوم</span>
                </td>
                <td class="px-4 py-3 text-center">
                    <span class="font-bold text-blue-600">${monthly}</span>
                    <span class="text-xs text-slate-400"> /شهر</span>
                </td>
                <td class="px-4 py-3 text-center font-semibold text-slate-700">${this._fmtN(item.current_qty)}</td>
                <td class="px-4 py-3 text-center">${coverageBadge}</td>
                <td class="px-4 py-3 text-center">${riskBadge}</td>
                <td class="px-4 py-3 text-center text-xs text-slate-500">${lastDate}</td>
            </tr>`;
        }).join('');

        wrap.classList.remove('hidden');
    },

    // ── Monthly Trend ─────────────────────────────────────────────────────────
    _caRenderMonthly() {
        const container = document.getElementById('ca-monthly-body');
        const wrap      = document.getElementById('ca-monthly-wrap');
        if (!container || !wrap || !this._caData) return;

        const { monthly, months } = this._caData;
        const keys = Object.keys(monthly || {});

        if (!keys.length || !months.length) {
            wrap.classList.add('hidden');
            return;
        }

        // اسم الشهر بالعربية
        const monthLabel = m => {
            const [y, mo] = m.split('-');
            return new Date(parseInt(y), parseInt(mo) - 1, 1)
                .toLocaleDateString('ar-EG', { month: 'short', year: '2-digit' });
        };

        // أعلى قيمة لحساب النسبة
        const allVals = keys.flatMap(k => months.map(m => monthly[k]?.[m] || 0));
        const maxVal  = Math.max(...allVals, 1);

        const COLORS = ['bg-emerald-400','bg-blue-400','bg-purple-400','bg-amber-400','bg-red-400','bg-pink-400','bg-indigo-400','bg-teal-400'];

        container.innerHTML = keys.slice(0, 10).map((key, ki) => {
            const [prod, variant] = key.split('||');
            const color = COLORS[ki % COLORS.length];
            const bars  = months.map(m => {
                const val = monthly[key]?.[m] || 0;
                const pct = Math.round((val / maxVal) * 100);
                return `
                <div class="flex flex-col items-center gap-1 min-w-[48px]">
                    <span class="text-xs font-bold text-slate-700">${val > 0 ? this._fmtN(val) : ''}</span>
                    <div class="w-8 bg-slate-100 rounded-t-lg overflow-hidden" style="height:80px">
                        <div class="w-full ${color} rounded-t-lg transition-all" style="height:${pct}%;margin-top:${100-pct}%"></div>
                    </div>
                    <span class="text-[10px] text-slate-400 text-center leading-tight">${monthLabel(m)}</span>
                </div>`;
            }).join('');

            return `
            <div class="mb-6 last:mb-0">
                <div class="flex items-center gap-2 mb-3">
                    <div class="w-3 h-3 rounded-full ${color}"></div>
                    <span class="font-bold text-slate-800 text-sm">${prod}</span>
                    <span class="text-xs text-slate-400">${variant || ''}</span>
                </div>
                <div class="flex items-end gap-3 overflow-x-auto pb-1">${bars}</div>
            </div>`;
        }).join('');

        wrap.classList.remove('hidden');
    },

    // ── Export Client Analytics CSV ───────────────────────────────────────────
    _caExport() {
        if (!this._caAllItems.length) {
            this._showToast('لا توجد بيانات للتصدير', 'error');
            return;
        }
        const clientName = document.getElementById('ca-client')?.selectedOptions[0]?.text || 'عميل';
        const headers = ['الصنف','المقاس','المستودع','إجمالي الصرف','معدل يومي','معدل شهري','الرصيد الحالي','أيام التغطية','آخر صرف'];
        const rows    = this._caAllItems.map(i => [
            i.product_name, i.variant_name, i.warehouse_name,
            i.total_dispensed, i.daily_rate, (i.daily_rate * 30).toFixed(1),
            i.current_qty, i.coverage_days ?? '—',
            i.last_dispense_date ? new Date(i.last_dispense_date).toLocaleDateString('ar-EG') : '—'
        ]);
        let csv = headers.join(',') + '\n';
        rows.forEach(r => { csv += r.map(v => `"${v ?? ''}"`).join(',') + '\n'; });
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `client_analytics_${clientName}_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    },

    // ── Render Stock Table ────────────────────────────────────────────────────
    _renderStockTable() {
        const tbody      = document.getElementById('inventory-table-body');
        const emptyState = document.getElementById('empty-state');
        if (!tbody) return;

        if (!this.currentStock.length) {
            tbody.innerHTML = '';
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }
        if (emptyState) emptyState.classList.add('hidden');

        tbody.innerHTML = this.currentStock.map(item => {
            const available    = parseFloat(item.available_qty  || 0);
            const reserved     = parseFloat(item.reserved_qty   || 0);
            const net          = available - reserved;
            const reorder      = parseFloat(item.reorder_point  || 0);

            let badge, rowCls;
            if (available <= 0) {
                badge  = '<span class="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold">نفذ</span>';
                rowCls = 'bg-red-50/50';
            } else if (reorder > 0 && available <= reorder) {
                badge  = '<span class="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">منخفض</span>';
                rowCls = 'bg-amber-50/50';
            } else {
                badge  = '<span class="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">طبيعي</span>';
                rowCls = '';
            }

            const clientBadge = item.client_name
                ? `<span class="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">${item.client_name}</span>`
                : '';

            const fillPct = reorder > 0 ? Math.min(100, Math.round((available / (reorder * 3)) * 100)) : 100;
            const fillColor = available <= 0 ? 'bg-red-400' : reorder > 0 && available <= reorder ? 'bg-amber-400' : 'bg-emerald-400';

            return `
            <tr class="${rowCls} hover:bg-slate-50 transition-colors border-b border-slate-100">
                <td class="px-4 py-3">
                    <div class="font-semibold text-slate-800">${item.product_name || '—'}</div>
                    <div class="flex items-center gap-1 mt-0.5">
                        <span class="text-xs text-slate-400">${item.size_name || '—'}</span>
                        ${clientBadge}
                    </div>
                </td>
                <td class="px-4 py-3 text-sm text-slate-600 hidden md:table-cell">${item.warehouse_name || '—'}</td>
                <td class="px-4 py-3 text-center">
                    <span class="text-lg font-black text-slate-800">${this._fmtN(available)}</span>
                </td>
                <td class="px-4 py-3 text-center hidden sm:table-cell">
                    <span class="text-slate-500">${this._fmtN(reserved)}</span>
                </td>
                <td class="px-4 py-3 text-center hidden sm:table-cell">
                    <span class="font-semibold ${net <= 0 ? 'text-red-600' : 'text-emerald-600'}">${this._fmtN(net)}</span>
                </td>
                <td class="px-4 py-3 hidden lg:table-cell">
                    <div class="flex items-center gap-2">
                        <div class="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div class="h-1.5 rounded-full ${fillColor} transition-all" style="width:${fillPct}%"></div>
                        </div>
                        <span class="text-xs text-slate-400 w-8 text-left">${fillPct}%</span>
                    </div>
                </td>
                <td class="px-4 py-3 text-center hidden xl:table-cell">
                    ${(() => {
                        const days = this._calcForecastDays(item);
                        if (days === null) return '<span class="text-slate-300 text-xs">—</span>';
                        if (days <= 7)  return `<span class="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold">~${days} يوم ⚠</span>`;
                        if (days <= 14) return `<span class="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">~${days} يوم</span>`;
                        if (days <= 30) return `<span class="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">~${days} يوم</span>`;
                        return `<span class="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">~${days} يوم</span>`;
                    })()}
                </td>
                <td class="px-4 py-3 text-center">${badge}</td>
                <td class="px-4 py-3 text-center">
                    <button onclick="window.inventoryView._openAdjustmentModal('${item.stock_id}')"
                            class="px-3 py-1.5 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-colors font-bold">
                        <i class="fa-solid fa-sliders ml-1"></i>تسوية
                    </button>
                </td>
            </tr>`;
        }).join('');
    },

    // ── Render Transactions ───────────────────────────────────────────────────
    _renderTransactions() {
        const tbody = document.getElementById('tx-table-body');
        const empty = document.getElementById('tx-empty');
        if (!tbody) return;

        if (!this.transactions.length) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        const typeMap = {
            receipt:  { label: 'توريد',   icon: 'fa-inbox',                   bg: 'bg-emerald-50 text-emerald-700' },
            dispense: { label: 'صرف',     icon: 'fa-arrow-up',                bg: 'bg-amber-50 text-amber-700'   },
            transfer: { label: 'نقل',     icon: 'fa-arrow-right-arrow-left',  bg: 'bg-blue-50 text-blue-700'     },
            adjust:   { label: 'تسوية',   icon: 'fa-sliders',                 bg: 'bg-purple-50 text-purple-700' }
        };

        tbody.innerHTML = this.transactions.map(tx => {
            const ti   = typeMap[tx.transaction_type] || typeMap.adjust;
            const date = new Date(tx.created_at).toLocaleDateString('ar-EG', { day:'2-digit', month:'short', year:'numeric' });
            const time = new Date(tx.created_at).toLocaleTimeString('ar-EG', { hour:'2-digit', minute:'2-digit' });
            const qtySign = tx.transaction_type === 'dispense' ? '-' : '+';
            const qtyColor = tx.transaction_type === 'dispense' ? 'text-red-600' : 'text-emerald-600';

            return `
            <tr class="hover:bg-slate-50 border-b border-slate-100">
                <td class="px-4 py-3">
                    <div class="text-sm font-medium text-slate-800">${date}</div>
                    <div class="text-xs text-slate-400">${time}</div>
                </td>
                <td class="px-4 py-3">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${ti.bg}">
                        <i class="fa-solid ${ti.icon}"></i>${ti.label}
                    </span>
                </td>
                <td class="px-4 py-3">
                    <div class="font-medium text-slate-800 text-sm">${tx.product_name || '—'}</div>
                    <div class="text-xs text-slate-400">${tx.variant_name || ''}</div>
                </td>
                <td class="px-4 py-3 text-sm text-slate-500 hidden md:table-cell">${tx.warehouse_name || '—'}</td>
                <td class="px-4 py-3 text-sm text-slate-500 hidden lg:table-cell">${tx.client_name || '—'}</td>
                <td class="px-4 py-3 text-center font-black text-lg ${qtyColor}">${qtySign}${Math.abs(tx.quantity || 0)}</td>
                <td class="px-4 py-3 text-xs text-slate-400 hidden xl:table-cell max-w-[160px] truncate">${tx.notes || '—'}</td>
            </tr>`;
        }).join('');
    },

    // ── Render Analytics ──────────────────────────────────────────────────────
    _renderAnalytics() {
        this._renderConsumptionRates();
        this._renderTopProducts();
        this._renderWarehouseBreakdown();
    },

    _renderConsumptionRates() {
        const container = document.getElementById('consumption-list');
        if (!container) return;

        // Estimate consumption rate: dispense transactions per product in last 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const recent = this.transactions.filter(tx =>
            tx.transaction_type === 'dispense' &&
            new Date(tx.created_at) >= thirtyDaysAgo
        );

        // Group by product
        const byProduct = {};
        recent.forEach(tx => {
            const key = tx.product_name || '—';
            if (!byProduct[key]) byProduct[key] = { name: key, qty: 0, txCount: 0 };
            byProduct[key].qty     += parseFloat(tx.quantity || 0);
            byProduct[key].txCount += 1;
        });

        const sorted = Object.values(byProduct).sort((a, b) => b.qty - a.qty).slice(0, 10);

        if (!sorted.length) {
            container.innerHTML = '<p class="text-slate-400 text-sm text-center py-6">لا توجد حركات صرف في آخر 30 يوم</p>';
            return;
        }

        const maxQty = sorted[0].qty;
        container.innerHTML = sorted.map((p, i) => {
            const pct = Math.round((p.qty / maxQty) * 100);
            const barColor = i < 3 ? 'bg-red-400' : i < 6 ? 'bg-amber-400' : 'bg-emerald-400';
            const dailyRate = (p.qty / 30).toFixed(1);

            return `
            <div class="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
                <span class="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center flex-shrink-0">${i+1}</span>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-sm font-semibold text-slate-800 truncate">${p.name}</span>
                        <span class="text-sm font-black text-slate-700 ml-2">${this._fmtN(p.qty)}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="flex-1 bg-slate-100 rounded-full h-1.5">
                            <div class="h-1.5 rounded-full ${barColor}" style="width:${pct}%"></div>
                        </div>
                        <span class="text-[10px] text-slate-400 whitespace-nowrap">${dailyRate}/يوم</span>
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    _renderTopProducts() {
        const container = document.getElementById('top-stock-list');
        if (!container) return;

        const sorted = [...this.currentStock]
            .sort((a, b) => parseFloat(b.available_qty||0) - parseFloat(a.available_qty||0))
            .slice(0, 8);

        if (!sorted.length) {
            container.innerHTML = '<p class="text-slate-400 text-sm text-center py-6">لا توجد بيانات</p>';
            return;
        }

        const maxQty = parseFloat(sorted[0].available_qty || 1);
        container.innerHTML = sorted.map(item => {
            const qty  = parseFloat(item.available_qty || 0);
            const pct  = Math.round((qty / maxQty) * 100);
            const reorder = parseFloat(item.reorder_point || 0);
            const isLow   = reorder > 0 && qty <= reorder;
            const barColor = qty <= 0 ? 'bg-red-400' : isLow ? 'bg-amber-400' : 'bg-blue-400';

            return `
            <div class="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
                <div class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <i class="fa-solid fa-box text-slate-400 text-xs"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-sm font-semibold text-slate-800 truncate">${item.product_name || '—'} <span class="text-slate-400 font-normal text-xs">${item.size_name || ''}</span></span>
                        <span class="text-sm font-black ${qty <= 0 ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-slate-700'} ml-2">${this._fmtN(qty)}</span>
                    </div>
                    <div class="flex-1 bg-slate-100 rounded-full h-1.5">
                        <div class="h-1.5 rounded-full ${barColor}" style="width:${pct}%"></div>
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    _renderWarehouseBreakdown() {
        const container = document.getElementById('warehouse-breakdown');
        if (!container) return;

        const byWh = {};
        this.currentStock.forEach(s => {
            const key = s.warehouse_name || '—';
            if (!byWh[key]) byWh[key] = { name: key, qty: 0, items: 0, low: 0 };
            byWh[key].qty   += parseFloat(s.available_qty || 0);
            byWh[key].items += 1;
            if (parseFloat(s.reorder_point||0) > 0 && parseFloat(s.available_qty||0) <= parseFloat(s.reorder_point||0)) {
                byWh[key].low += 1;
            }
        });

        const sorted = Object.values(byWh).sort((a, b) => b.qty - a.qty);
        if (!sorted.length) {
            container.innerHTML = '<p class="text-slate-400 text-sm text-center py-6">لا توجد بيانات</p>';
            return;
        }

        const totalQty = sorted.reduce((s, w) => s + w.qty, 0) || 1;
        container.innerHTML = sorted.map(w => {
            const pct = Math.round((w.qty / totalQty) * 100);
            return `
            <div class="bg-white rounded-xl border border-slate-100 p-4">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                            <i class="fa-solid fa-warehouse text-sm"></i>
                        </div>
                        <span class="font-bold text-slate-800 text-sm">${w.name}</span>
                    </div>
                    <span class="text-xs text-slate-400">${pct}% من الإجمالي</span>
                </div>
                <div class="grid grid-cols-3 gap-2 text-center mb-3">
                    <div class="bg-slate-50 rounded-lg py-1.5">
                        <p class="text-base font-black text-slate-800">${this._fmtN(w.qty)}</p>
                        <p class="text-[10px] text-slate-400">قطعة</p>
                    </div>
                    <div class="bg-slate-50 rounded-lg py-1.5">
                        <p class="text-base font-black text-emerald-600">${w.items}</p>
                        <p class="text-[10px] text-slate-400">صنف</p>
                    </div>
                    <div class="bg-slate-50 rounded-lg py-1.5">
                        <p class="text-base font-black ${w.low > 0 ? 'text-red-500' : 'text-slate-300'}">${w.low}</p>
                        <p class="text-[10px] text-slate-400">منخفض</p>
                    </div>
                </div>
                <div class="bg-slate-100 rounded-full h-2">
                    <div class="h-2 rounded-full bg-blue-400" style="width:${pct}%"></div>
                </div>
            </div>`;
        }).join('');
    },

    // ── Update Stats ──────────────────────────────────────────────────────────
    _updateStats() {
        const total     = this.currentStock.length;
        const lowItems  = this.currentStock.filter(i => {
            const a = parseFloat(i.available_qty||0);
            const r = parseFloat(i.reorder_point||0);
            return r > 0 && a > 0 && a <= r;
        }).length;
        const outItems  = this.currentStock.filter(i => parseFloat(i.available_qty||0) <= 0).length;
        const totalQty  = this.currentStock.reduce((s, i) => s + parseFloat(i.available_qty||0), 0);
        const whCount   = [...new Set(this.currentStock.map(i => i.warehouse_id).filter(Boolean))].length;

        this._set('stat-total-items',  total);
        this._set('stat-low-stock',    lowItems);
        this._set('stat-out-stock',    outItems);
        this._set('stat-total-qty',    this._fmtN(totalQty));
        this._set('stat-warehouses',   whCount);
    },

    // ── Low Stock Alert ───────────────────────────────────────────────────────
    _checkLowStock() {
        const low = this.currentStock.filter(i => {
            const a = parseFloat(i.available_qty||0);
            const r = parseFloat(i.reorder_point||0);
            return r > 0 && a > 0 && a <= r;
        });
        const alertDiv = document.getElementById('low-stock-alerts');
        const msgEl    = document.getElementById('low-stock-message');
        if (low.length > 0) {
            if (alertDiv) alertDiv.classList.remove('hidden');
            if (msgEl)    msgEl.textContent = `يوجد ${low.length} صنف يحتاج إلى إعادة طلب`;
        } else {
            if (alertDiv) alertDiv.classList.add('hidden');
        }
    },

    // ── Adjustment Modal ──────────────────────────────────────────────────────
    _openAdjustmentModal(stockId) {
        this.selectedItem = this.currentStock.find(i => (i.stock_id || i.id) === stockId);
        if (!this.selectedItem) return;

        const _curQty = parseFloat(this.selectedItem.available_qty ?? this.selectedItem.qty_on_hand ?? 0);
        this._set('adj-product-name',   `${this.selectedItem.product_name} — ${this.selectedItem.size_name || this.selectedItem.variant_size || ''}`);
        this._set('adj-current-qty',    this._fmtN(_curQty));
        this._set('adj-warehouse-name', this.selectedItem.warehouse_name);

        const typeEl = document.getElementById('adj-type');
        const qtyEl  = document.getElementById('adj-quantity');
        const newEl  = document.getElementById('adj-new-qty');
        const reasonEl = document.getElementById('adj-reason');
        if (typeEl)   typeEl.value   = 'increase';
        if (qtyEl)    qtyEl.value    = '';
        if (reasonEl) reasonEl.value = '';
        if (newEl)    newEl.textContent = this._fmtN(_curQty);

        // Pre-select warehouse
        const whSel = document.getElementById('adj-warehouse');
        if (whSel && this.selectedItem.warehouse_id) whSel.value = this.selectedItem.warehouse_id;

        const updatePreview = () => {
            const cur  = parseFloat(this.selectedItem.available_qty ?? this.selectedItem.qty_on_hand ?? 0);
            const adj  = parseFloat(qtyEl?.value || 0);
            const type = typeEl?.value;
            let newQty = cur;
            if (type === 'increase') newQty = cur + adj;
            else if (type === 'decrease') newQty = Math.max(0, cur - adj);
            else if (type === 'set') newQty = adj;
            if (newEl) newEl.textContent = this._fmtN(Math.max(0, newQty));
        };

        if (qtyEl)  { qtyEl.removeEventListener('input', qtyEl._preview); qtyEl._preview = updatePreview; qtyEl.addEventListener('input', updatePreview); }
        if (typeEl) { typeEl.removeEventListener('change', typeEl._preview); typeEl._preview = updatePreview; typeEl.addEventListener('change', updatePreview); }

        document.getElementById('adjustment-modal')?.classList.remove('hidden');
    },

    _closeAdjustmentModal() {
        document.getElementById('adjustment-modal')?.classList.add('hidden');
        this.selectedItem = null;
    },

    async _submitAdjustment() {
        if (!this.selectedItem) return;

        const type      = document.getElementById('adj-type')?.value;
        const quantity  = parseFloat(document.getElementById('adj-quantity')?.value || 0);
        const reason    = document.getElementById('adj-reason')?.value?.trim() || '';

        if (quantity <= 0) { this._showToast('أدخل كمية أكبر من صفر', 'error'); return; }
        if (!reason)       { this._showToast('أدخل سبب التسوية', 'error'); return; }

        // Calculate signed adjustment for the single-mode endpoint
        const currentQty = parseFloat(this.selectedItem.available_qty || this.selectedItem.qty_on_hand || 0);
        let signedAdj;
        if (type === 'increase')  signedAdj = quantity;
        else if (type === 'decrease') signedAdj = -Math.min(quantity, currentQty);
        else signedAdj = quantity - currentQty; // 'set'

        try {
            await apiFetch('/api/inventory/stock/adjust', {
                method: 'POST',
                body: {
                    stock_id:   this.selectedItem.stock_id || this.selectedItem.id,
                    adjustment: signedAdj,
                    reason:     reason
                }
            });
            this._showToast('تمت التسوية بنجاح');
            this._closeAdjustmentModal();
            await this._loadInventory();
            if (this._activeTab === 'transactions') this._loadTransactions();
        } catch (e) {
            console.error('[Inventory] Adjustment failed:', e);
            this._showToast(e.message || 'فشل في تنفيذ التسوية', 'error');
        }
    },

    // ── Export CSV ────────────────────────────────────────────────────────────
    _exportToExcel() {
        const headers = ['المنتج','المقاس','المستودع','العميل','المتاح','محجوز','صافي المتاح'];
        const rows    = this.currentStock.map(i => [
            i.product_name, i.size_name, i.warehouse_name, i.client_name || '',
            i.available_qty, i.reserved_qty,
            parseFloat(i.available_qty||0) - parseFloat(i.reserved_qty||0)
        ]);
        let csv = headers.join(',') + '\n';
        rows.forEach(r => { csv += r.map(v => `"${v ?? ''}"`).join(',') + '\n'; });
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `inventory_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    },

    // ══════════════════════════════════════════════════════════════════════════
    // SMART ALERTS — تنبيهات ذكية بناءً على أيام التغطية
    // ══════════════════════════════════════════════════════════════════════════
    _renderSmartAlerts(stockItems) {
        const panel = document.getElementById('smart-alerts-panel');
        if (!panel) return;

        // نحتاج إلى بيانات client-analytics لمعرفة معدل الاستهلاك
        // نحسب تقديري من الـ stock فقط: نقطة إعادة الطلب vs الكمية الحالية
        const critical = [];  // أقل من 7 أيام أو نفذ
        const warning  = [];  // بين 7 و 14 يوم

        stockItems.forEach(item => {
            const qty     = parseFloat(item.available_qty ?? item.qty_on_hand ?? 0);
            const reorder = parseFloat(item.reorder_point || item.min_stock_level || 0);
            const label   = `${item.product_name} — ${item.size_name || item.variant_size || ''} (${item.client_name || ''} · ${item.warehouse_name || ''})`;

            if (qty <= 0) {
                critical.push({ label, qty: 0, type: 'out' });
            } else if (reorder > 0 && qty <= reorder * 0.5) {
                critical.push({ label, qty, type: 'critical' });
            } else if (reorder > 0 && qty <= reorder) {
                warning.push({ label, qty, type: 'warning' });
            }
        });

        if (!critical.length && !warning.length) {
            panel.classList.add('hidden');
            return;
        }

        let html = '';

        if (critical.length) {
            html += `<div class="bg-red-50 border border-red-200 rounded-2xl p-4 mb-3">
                <div class="flex items-start gap-3">
                    <div class="w-8 h-8 rounded-xl bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0">
                        <i class="fa-solid fa-circle-xmark"></i>
                    </div>
                    <div class="flex-1">
                        <p class="font-black text-red-800 text-sm mb-2">⚠ ${critical.length} صنف في مرحلة الخطر الحرج</p>
                        <div class="flex flex-wrap gap-2">
                            ${critical.map(a => `
                                <span class="px-2 py-1 bg-red-100 text-red-700 rounded-lg text-xs font-bold">
                                    ${a.type === 'out' ? '🔴 نفذ:' : '🚨'} ${a.label}
                                    ${a.qty > 0 ? `<span class="opacity-70">(${a.qty})</span>` : ''}
                                </span>`).join('')}
                        </div>
                    </div>
                </div>
            </div>`;
        }

        if (warning.length) {
            html += `<div class="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <div class="flex items-start gap-3">
                    <div class="w-8 h-8 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                    </div>
                    <div class="flex-1">
                        <p class="font-black text-amber-800 text-sm mb-2">⚡ ${warning.length} صنف يقترب من نقطة إعادة الطلب</p>
                        <div class="flex flex-wrap gap-2">
                            ${warning.map(a => `
                                <span class="px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold">
                                    🟡 ${a.label} <span class="opacity-70">(${a.qty})</span>
                                </span>`).join('')}
                        </div>
                    </div>
                </div>
            </div>`;
        }

        panel.innerHTML = html;
        panel.classList.remove('hidden');
    },

    // ══════════════════════════════════════════════════════════════════════════
    // CLIENT SUB-TABS — تحليل فردي / مقارنة
    // ══════════════════════════════════════════════════════════════════════════
    _caSubtab(mode) {
        const activeBtn   = 'px-4 py-2 rounded-lg text-xs font-bold bg-white text-emerald-700 shadow-sm transition-all';
        const inactiveBtn = 'px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-700 transition-all';
        document.getElementById('ca-subtab-single') .className = mode === 'single'  ? activeBtn : inactiveBtn;
        document.getElementById('ca-subtab-compare').className = mode === 'compare' ? activeBtn : inactiveBtn;
        document.getElementById('ca-panel-single') .classList.toggle('hidden', mode !== 'single');
        document.getElementById('ca-panel-compare').classList.toggle('hidden', mode !== 'compare');

        if (mode === 'compare') this._cmpInit();
    },

    // ══════════════════════════════════════════════════════════════════════════
    // COMPARE TWO CLIENTS
    // ══════════════════════════════════════════════════════════════════════════
    _cmpInit() {
        const selA = document.getElementById('cmp-client-a');
        const selB = document.getElementById('cmp-client-b');
        if (!selA || selA.options.length > 1) return;

        // نسخ قائمة العملاء من ca-client
        const srcSel = document.getElementById('ca-client');
        if (srcSel) {
            const opts = Array.from(srcSel.options).slice(1); // تخطي الـ placeholder
            opts.forEach(o => {
                selA.innerHTML += `<option value="${o.value}">${o.text}</option>`;
                selB.innerHTML += `<option value="${o.value}">${o.text}</option>`;
            });
        }
        this._caSetRangeCmp(90);
    },

    _caSetRangeCmp(days) {
        const to   = new Date();
        const from = new Date(Date.now() - days * 24 * 3600 * 1000);
        const fmt  = d => d.toISOString().split('T')[0];
        const fe   = document.getElementById('cmp-from');
        const te   = document.getElementById('cmp-to');
        if (fe) fe.value = fmt(from);
        if (te) te.value = fmt(to);
    },

    async _loadCompare() {
        const idA  = document.getElementById('cmp-client-a')?.value;
        const idB  = document.getElementById('cmp-client-b')?.value;
        const from = document.getElementById('cmp-from')?.value;
        const to   = document.getElementById('cmp-to')?.value;

        if (!idA || !idB) { this._showToast('اختر عميلين', 'error'); return; }
        if (idA === idB)  { this._showToast('اختر عميلين مختلفين', 'error'); return; }

        const nameA = document.getElementById('cmp-client-a')?.selectedOptions[0]?.text || 'أ';
        const nameB = document.getElementById('cmp-client-b')?.selectedOptions[0]?.text || 'ب';

        // Loading
        const ph = document.getElementById('cmp-placeholder');
        if (ph) { ph.classList.remove('hidden'); ph.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3 block text-blue-400"></i><p class="font-bold text-slate-400">جاري المقارنة...</p>`; }
        document.getElementById('cmp-kpis')?.classList.add('hidden');
        document.getElementById('cmp-table-wrap')?.classList.add('hidden');

        try {
            let urlA = `/api/inventory/client-analytics?client_id=${idA}`;
            let urlB = `/api/inventory/client-analytics?client_id=${idB}`;
            if (from) { urlA += `&from=${from}`; urlB += `&from=${from}`; }
            if (to)   { urlA += `&to=${to}`;     urlB += `&to=${to}`;     }

            const [resA, resB] = await Promise.all([apiFetch(urlA), apiFetch(urlB)]);
            if (ph) ph.classList.add('hidden');

            this._renderCmpKPIs(resA.data, resB.data, nameA, nameB);
            this._renderCmpTable(resA.data.items, resB.data.items, nameA, nameB);

        } catch(e) {
            console.error('[CMP] Failed:', e);
            if (ph) { ph.classList.remove('hidden'); ph.innerHTML = `<i class="fa-solid fa-circle-exclamation text-3xl mb-2 block text-red-400"></i><p class="text-red-500 font-bold">${e.message}</p>`; }
        }
    },

    _renderCmpKPIs(dataA, dataB, nameA, nameB) {
        const container = document.getElementById('cmp-kpis');
        if (!container) return;

        const totalA = dataA.items.reduce((s, i) => s + i.total_dispensed, 0);
        const totalB = dataB.items.reduce((s, i) => s + i.total_dispensed, 0);
        const diff   = totalA - totalB;
        const winner = diff > 0 ? nameA : nameB;
        const ratio  = totalB > 0 ? ((totalA / totalB) * 100).toFixed(0) : '—';

        this._set('cmp-head-a', nameA);
        this._set('cmp-head-b', nameB);

        container.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-2xl p-4 text-center shadow-sm">
                <div class="flex items-center justify-center gap-1 mb-1">
                    <span class="w-3 h-3 rounded-full bg-emerald-400 inline-block"></span>
                    <span class="text-xs font-bold text-slate-500">${nameA}</span>
                </div>
                <p class="text-3xl font-black text-emerald-600">${this._fmtN(totalA)}</p>
                <p class="text-xs text-slate-400 mt-1">إجمالي المصروف</p>
            </div>
            <div class="bg-white border border-slate-200 rounded-2xl p-4 text-center shadow-sm">
                <p class="text-xs font-bold text-slate-500 mb-1">الأكثر استهلاكاً</p>
                <p class="text-xl font-black ${diff > 0 ? 'text-emerald-600' : 'text-blue-600'}">${winner}</p>
                <p class="text-xs text-slate-400 mt-1">نسبة أ/ب = ${ratio}%</p>
                <p class="text-sm font-bold mt-2 ${diff >= 0 ? 'text-emerald-700' : 'text-red-600'}">
                    ${diff >= 0 ? '+' : ''}${this._fmtN(diff)} فارق
                </p>
            </div>
            <div class="bg-white border border-slate-200 rounded-2xl p-4 text-center shadow-sm">
                <div class="flex items-center justify-center gap-1 mb-1">
                    <span class="w-3 h-3 rounded-full bg-blue-400 inline-block"></span>
                    <span class="text-xs font-bold text-slate-500">${nameB}</span>
                </div>
                <p class="text-3xl font-black text-blue-600">${this._fmtN(totalB)}</p>
                <p class="text-xs text-slate-400 mt-1">إجمالي المصروف</p>
            </div>`;

        container.classList.remove('hidden');
    },

    _renderCmpTable(itemsA, itemsB, nameA, nameB) {
        const tbody = document.getElementById('cmp-table-body');
        const wrap  = document.getElementById('cmp-table-wrap');
        if (!tbody || !wrap) return;

        // بناء Map لكل عميل key = product + variant
        const mapA = {};
        itemsA.forEach(i => { mapA[`${i.product_name}||${i.variant_name}`] = i.total_dispensed; });
        const mapB = {};
        itemsB.forEach(i => { mapB[`${i.product_name}||${i.variant_name}`] = i.total_dispensed; });

        // Union من كل الأصناف
        const allKeys = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])];
        allKeys.sort((x, y) => ((mapA[y] || 0) + (mapB[y] || 0)) - ((mapA[x] || 0) + (mapB[x] || 0)));

        const maxVal = Math.max(...allKeys.map(k => Math.max(mapA[k] || 0, mapB[k] || 0)), 1);

        tbody.innerHTML = allKeys.map(key => {
            const [prod, variant] = key.split('||');
            const valA  = mapA[key] || 0;
            const valB  = mapB[key] || 0;
            const diff  = valA - valB;
            const pctA  = Math.round((valA / maxVal) * 100);
            const pctB  = Math.round((valB / maxVal) * 100);
            const diffCls = diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-slate-400';

            return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="px-4 py-3">
                    <div class="font-semibold text-slate-800 text-sm">${prod}</div>
                    <div class="text-xs text-slate-400">${variant || ''}</div>
                </td>
                <td class="px-4 py-3 text-center font-bold text-emerald-600">${this._fmtN(valA)}</td>
                <td class="px-4 py-3 text-center font-bold text-blue-600">${this._fmtN(valB)}</td>
                <td class="px-4 py-3 text-center font-black ${diffCls}">
                    ${diff >= 0 ? '+' : ''}${this._fmtN(diff)}
                </td>
                <td class="px-4 py-3">
                    <div class="space-y-1">
                        <div class="flex items-center gap-2">
                            <div class="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0"></div>
                            <div class="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                                <div class="h-2 bg-emerald-400 rounded-full" style="width:${pctA}%"></div>
                            </div>
                            <span class="text-xs text-slate-400 w-8 text-left">${pctA}%</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <div class="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0"></div>
                            <div class="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                                <div class="h-2 bg-blue-400 rounded-full" style="width:${pctB}%"></div>
                            </div>
                            <span class="text-xs text-slate-400 w-8 text-left">${pctB}%</span>
                        </div>
                    </div>
                </td>
            </tr>`;
        }).join('');

        wrap.classList.remove('hidden');
    },

    // ══════════════════════════════════════════════════════════════════════════
    // FORECAST — توقع الطلب في جدول الأرصدة (عمود إضافي)
    // يُحسب من: معدل_يومي = صرف_30_يوم / 30 ← متوسط آخر 30 يوم من الـ transactions
    // لكن حتى لا نثقّل الـ API في كل load، نحسبه تقديرياً من reorder vs qty فقط
    // ══════════════════════════════════════════════════════════════════════════
    _calcForecastDays(item) {
        const qty    = parseFloat(item.available_qty ?? item.qty_on_hand ?? 0);
        const reorder= parseFloat(item.reorder_point || item.min_stock_level || 0);
        if (!reorder || reorder <= 0) return null;
        // تقدير بسيط: نفترض أن نقطة إعادة الطلب = احتياج أسبوع واحد
        const dailyEst = reorder / 7;
        return dailyEst > 0 ? Math.round(qty / dailyEst) : null;
    },

    // ── Event Listeners ───────────────────────────────────────────────────────
    _attachEventListeners() {
        const onLoad = id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => this._loadInventory());
        };
        ['filter-warehouse','filter-category','filter-stock-status'].forEach(onLoad);

        const searchEl = document.getElementById('search-product');
        if (searchEl) {
            searchEl.addEventListener('input', () => {
                clearTimeout(this._searchTimeout);
                this._searchTimeout = setTimeout(() => this._loadInventory(), 400);
            });
        }

        // Transactions filters
        ['tx-filter-warehouse','tx-filter-type','tx-from','tx-to'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => this._loadTransactions());
        });
    },

    // ── Helpers ───────────────────────────────────────────────────────────────
    _fmtN(n) {
        return parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    },
    _set(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    },
    _showToast(msg, type) {
        const c = document.getElementById('toast-container');
        if (c) {
            const t = document.createElement('div');
            t.className = `px-4 py-3 rounded-xl shadow-lg text-sm font-bold text-white ${type === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`;
            t.textContent = msg;
            c.appendChild(t);
            setTimeout(() => t.remove(), 3500);
        } else { alert(msg); }
    }
};
