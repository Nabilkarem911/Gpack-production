'use strict';

// =============================================================================
// G.PACK 2.0 — Reports Page Controller
// Manages tab switching, data loading, chart rendering, and exports
// =============================================================================

(function () {

    // ── State ──────────────────────────────────────────────────────────────
    var _activeTab    = 'kpis';
    var _dateRange    = { from: null, to: null };
    var _charts       = {}; // Store chart instances for cleanup
    var _currentData  = {}; // Store current tab data for export

    // ── Helpers ────────────────────────────────────────────────────────────

    function _formatCurrency(val) {
        var num = parseFloat(val) || 0;
        return num.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س';
    }

    function _formatNumber(val) {
        var num = parseFloat(val) || 0;
        return num.toLocaleString('ar-SA', { maximumFractionDigits: 1 });
    }

    function _formatDate(dateStr) {
        if (!dateStr) return '—';
        var d = new Date(dateStr);
        return d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function _getDateRange() {
        var preset = document.getElementById('report-date-preset').value;
        if (preset === 'custom') {
            var from = document.getElementById('report-from').value;
            var to   = document.getElementById('report-to').value;
            if (!from || !to) {
                var now = new Date();
                var firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
                from = firstDay.toISOString().split('T')[0];
                to   = now.toISOString().split('T')[0];
            }
            return { from: from, to: to };
        }

        var now = new Date();
        var from, to;

        switch (preset) {
            case 'today':
                from = now.toISOString().split('T')[0];
                to   = from;
                break;
            case 'week':
                var day = now.getDay();
                var weekStart = new Date(now);
                weekStart.setDate(now.getDate() - day);
                from = weekStart.toISOString().split('T')[0];
                to   = now.toISOString().split('T')[0];
                break;
            case 'month':
                from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
                to   = now.toISOString().split('T')[0];
                break;
            case 'quarter':
                var q = Math.floor(now.getMonth() / 3);
                from = new Date(now.getFullYear(), q * 3, 1).toISOString().split('T')[0];
                to   = now.toISOString().split('T')[0];
                break;
            case 'year':
                from = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
                to   = now.toISOString().split('T')[0];
                break;
            default:
                from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
                to   = now.toISOString().split('T')[0];
        }

        return { from: from, to: to };
    }

    function _destroyChart(canvasId) {
        if (_charts[canvasId]) {
            _charts[canvasId].destroy();
            delete _charts[canvasId];
        }
    }

    function _destroyAllCharts() {
        Object.keys(_charts).forEach(function (id) {
            _charts[id].destroy();
        });
        _charts = {};
    }

    function _showLoading(panelId, loadingId) {
        var panel = document.getElementById(panelId);
        var loading = document.getElementById(loadingId);
        if (panel) panel.classList.add('hidden');
        if (loading) loading.classList.remove('hidden');
    }

    function _showContent(panelId, loadingId) {
        var panel = document.getElementById(panelId);
        var loading = document.getElementById(loadingId);
        if (loading) loading.classList.add('hidden');
        if (panel) panel.classList.remove('hidden');
    }

    function _trendBadge(trendPct) {
        if (trendPct > 0) {
            return '<span class="text-emerald-600 text-xs font-bold"><i class="fa-solid fa-arrow-up"></i> ' + _formatNumber(trendPct) + '%</span>';
        } else if (trendPct < 0) {
            return '<span class="text-red-600 text-xs font-bold"><i class="fa-solid fa-arrow-down"></i> ' + _formatNumber(Math.abs(trendPct)) + '%</span>';
        }
        return '<span class="text-slate-400 text-xs font-bold">—</span>';
    }

    function _kpiCard(icon, color, label, value, trend) {
        var trendHtml = trend !== undefined ? _trendBadge(trend) : '';
        return '<div class="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">' +
            '<div class="flex items-center justify-between mb-3">' +
                '<div class="w-10 h-10 rounded-xl flex items-center justify-center ' + color + '">' +
                    '<i class="fa-solid ' + icon + ' text-white text-lg"></i>' +
                '</div>' +
                trendHtml +
            '</div>' +
            '<p class="text-2xl font-extrabold text-slate-800 mb-1">' + value + '</p>' +
            '<p class="text-xs text-slate-500 font-medium">' + label + '</p>' +
        '</div>';
    }

    function _tableHeader(columns) {
        var html = '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
        columns.forEach(function (col) {
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600 whitespace-nowrap">' + col + '</th>';
        });
        html += '</tr></thead>';
        return html;
    }

    function _tableBody(rows, columns) {
        var html = '<tbody class="divide-y divide-slate-100">';
        if (rows.length === 0) {
            html += '<tr><td colspan="' + columns.length + '" class="px-4 py-8 text-center text-slate-400 text-sm">لا توجد بيانات للفترة المحددة</td></tr>';
        } else {
            rows.forEach(function (row) {
                html += '<tr class="hover:bg-slate-50 transition-colors">';
                columns.forEach(function (col) {
                    var val = row[col.key];
                    var display = col.format ? col.format(val, row) : (val !== null && val !== undefined ? val : '—');
                    var cls = col.className || 'px-4 py-3 text-sm text-slate-700';
                    if (col.negative && parseFloat(val) < 0) cls += ' text-red-600 font-bold';
                    html += '<td class="' + cls + '">' + display + '</td>';
                });
                html += '</tr>';
            });
        }
        html += '</tbody>';
        return html;
    }

    function _renderTable(tableId, columns, rows) {
        var table = document.getElementById(tableId);
        if (!table) return;
        table.innerHTML = _tableHeader(columns.map(function (c) { return c.label; })) + _tableBody(rows, columns);
    }

    // ── Data Loaders ───────────────────────────────────────────────────────

    async function _loadKPIs() {
        _showLoading('kpi-content', 'kpi-loading');
        try {
            var range = _getDateRange();
            var data = await window.apiFetch('/reports/kpis?from=' + range.from + '&to=' + range.to);
            data = data.data || data;
            _currentData.kpis = data;

            var cards = document.getElementById('kpi-cards');
            cards.innerHTML =
                _kpiCard('fa-sack-dollar', 'bg-brand-600', 'إجمالي المبيعات', _formatCurrency(data.total_sales), data.sales_trend_pct) +
                _kpiCard('fa-industry', 'bg-blue-600', 'أوامر التشغيل النشطة', data.active_orders_count + ' (' + _formatCurrency(data.active_orders_value) + ')') +
                _kpiCard('fa-hand-holding-dollar', 'bg-amber-500', 'مستحقات العملاء', _formatCurrency(data.outstanding_receivables)) +
                _kpiCard('fa-truck-fast', 'bg-emerald-600', 'متوسط زمن التسليم', data.avg_delivery_days + ' يوم') +
                _kpiCard('fa-check-double', 'bg-purple-600', 'معدل اكتمال الإنتاج', data.production_completion_pct + '%') +
                _kpiCard('fa-warehouse', 'bg-cyan-600', 'قيمة المخزون', _formatCurrency(data.stock_value)) +
                _kpiCard('fa-file-circle-check', 'bg-pink-600', 'معدل تحويل العروض', data.quote_conversion_rate + '%') +
                _kpiCard('fa-money-bill-transfer', 'bg-teal-600', 'صافي التحصيلات', _formatCurrency(data.total_collected - data.total_paid_to_suppliers));

            // Production status doughnut chart
            _destroyChart('kpi-production-chart');
            var ctx = document.getElementById('kpi-production-chart');
            if (ctx) {
                _charts['kpi-production-chart'] = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: ['مكتمل', 'جاري الإنتاج'],
                        datasets: [{
                            data: [data.production_completion_pct, 100 - data.production_completion_pct],
                            backgroundColor: ['#10b981', '#f59e0b'],
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { font: { size: 12 } } }
                        }
                    }
                });
            }

            _showContent('kpi-content', 'kpi-loading');
        } catch (err) {
            console.error('[Reports] KPIs load error:', err);
            window.showToast('فشل تحميل المؤشرات: ' + err.message, 'error');
        }
    }

    async function _loadProfitLoss() {
        _showLoading('pnl-content', 'pnl-loading');
        try {
            var range = _getDateRange();
            var data = await window.apiFetch('/reports/profit-loss?from=' + range.from + '&to=' + range.to);
            data = data.data || data;
            _currentData.pnl = data;

            var html = '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">';
            // P&L Table
            html += '<div class="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">';
            html += '<h3 class="text-sm font-bold text-slate-700 mb-4">قائمة الدخل</h3>';
            html += '<table class="w-full text-sm">';
            html += '<tbody class="divide-y divide-slate-100">';
            html += '<tr><td class="py-3 text-slate-600 font-medium">الإيرادات (قبل الضريبة)</td><td class="py-3 text-left font-bold text-slate-800">' + _formatCurrency(data.revenue) + '</td></tr>';
            html += '<tr><td class="py-3 text-slate-600 font-medium">تكلفة البضاعة المباعة (COGS)</td><td class="py-3 text-left font-bold text-red-600">(' + _formatCurrency(data.cogs) + ')</td></tr>';
            html += '<tr class="bg-emerald-50"><td class="py-3 font-bold text-emerald-800">إجمالي الربح</td><td class="py-3 text-left font-extrabold text-emerald-700">' + _formatCurrency(data.gross_profit) + '</td></tr>';
            html += '<tr><td class="py-3 text-slate-600 font-medium">هامش إجمالي الربح</td><td class="py-3 text-left font-bold text-slate-700">' + data.gross_margin_pct + '%</td></tr>';
            html += '<tr><td class="py-3 text-slate-600 font-medium">مصاريف إضافية</td><td class="py-3 text-left font-bold text-red-600">(' + _formatCurrency(data.additional_expenses) + ')</td></tr>';
            html += '<tr class="bg-brand-50"><td class="py-3 font-bold text-brand-800">صافي الربح</td><td class="py-3 text-left font-extrabold text-brand-700">' + _formatCurrency(data.net_profit) + '</td></tr>';
            html += '<tr><td class="py-3 text-slate-600 font-medium">صافي الهامش</td><td class="py-3 text-left font-bold text-slate-700">' + data.net_margin_pct + '%</td></tr>';
            html += '</tbody></table>';
            html += '</div>';

            // VAT Summary
            html += '<div class="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">';
            html += '<h3 class="text-sm font-bold text-slate-700 mb-4">ملخص ضريبة القيمة المضافة</h3>';
            html += '<table class="w-full text-sm">';
            html += '<tbody class="divide-y divide-slate-100">';
            html += '<tr><td class="py-3 text-slate-600 font-medium">ضريبة محصلة</td><td class="py-3 text-left font-bold text-emerald-600">' + _formatCurrency(data.vat_collected) + '</td></tr>';
            html += '<tr><td class="py-3 text-slate-600 font-medium">ضريبة مدفوعة</td><td class="py-3 text-left font-bold text-red-600">' + _formatCurrency(data.vat_paid) + '</td></tr>';
            html += '<tr class="bg-amber-50"><td class="py-3 font-bold text-amber-800">صافي المستحق للهيئة</td><td class="py-3 text-left font-extrabold text-amber-700">' + _formatCurrency(data.vat_net) + '</td></tr>';
            html += '</tbody></table>';
            html += '</div>';
            html += '</div>';

            // Chart
            html += '<div class="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">';
            html += '<div class="relative h-64"><canvas id="pnl-chart"></canvas></div>';
            html += '</div>';

            document.getElementById('pnl-content').innerHTML = html;

            _destroyChart('pnl-chart');
            var ctx = document.getElementById('pnl-chart');
            if (ctx) {
                _charts['pnl-chart'] = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: ['الإيرادات', 'COGS', 'إجمالي الربح', 'مصاريف', 'صافي الربح'],
                        datasets: [{
                            label: 'القيمة (ر.س)',
                            data: [data.revenue, data.cogs, data.gross_profit, data.additional_expenses, data.net_profit],
                            backgroundColor: ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#059669'],
                            borderRadius: 8
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { y: { beginAtZero: true } }
                    }
                });
            }

            _showContent('pnl-content', 'pnl-loading');
        } catch (err) {
            console.error('[Reports] P&L load error:', err);
            window.showToast('فشل تحميل قائمة الدخل: ' + err.message, 'error');
        }
    }

    async function _loadProfitability() {
        _showLoading('profitability-content', 'profitability-loading');
        try {
            var range = _getDateRange();
            var groupBy = document.getElementById('profitability-groupby').value;
            var data = await window.apiFetch('/reports/profitability?from=' + range.from + '&to=' + range.to + '&group_by=' + groupBy);
            data = data.data || data;
            _currentData.profitability = data;

            var labelKey, labelTitle, columns;
            if (groupBy === 'order') {
                labelKey = 'order_number'; labelTitle = 'رقم الأمر';
                columns = [
                    { key: 'order_number', label: 'رقم الأمر' },
                    { key: 'client_name', label: 'العميل' },
                    { key: 'revenue', label: 'الإيرادات', format: _formatCurrency },
                    { key: 'cogs', label: 'التكلفة', format: _formatCurrency },
                    { key: 'gross_profit', label: 'إجمالي الربح', format: _formatCurrency, negative: true },
                    { key: 'margin_pct', label: 'الهامش %', format: function(v) { return v + '%'; } }
                ];
            } else if (groupBy === 'client') {
                labelKey = 'client_name'; labelTitle = 'العميل';
                columns = [
                    { key: 'client_name', label: 'العميل' },
                    { key: 'order_count', label: 'عدد الأوامر' },
                    { key: 'revenue', label: 'الإيرادات', format: _formatCurrency },
                    { key: 'cogs', label: 'التكلفة', format: _formatCurrency },
                    { key: 'gross_profit', label: 'إجمالي الربح', format: _formatCurrency, negative: true },
                    { key: 'margin_pct', label: 'الهامش %', format: function(v) { return v + '%'; } }
                ];
            } else if (groupBy === 'product') {
                labelKey = 'product_name'; labelTitle = 'المنتج';
                columns = [
                    { key: 'product_name', label: 'المنتج' },
                    { key: 'variant', label: 'المقاس' },
                    { key: 'qty_sold', label: 'الكمية', format: _formatNumber },
                    { key: 'revenue', label: 'الإيرادات', format: _formatCurrency },
                    { key: 'cogs', label: 'التكلفة', format: _formatCurrency },
                    { key: 'gross_profit', label: 'إجمالي الربح', format: _formatCurrency, negative: true },
                    { key: 'margin_pct', label: 'الهامش %', format: function(v) { return v + '%'; } }
                ];
            } else {
                labelKey = 'supplier_name'; labelTitle = 'المورد';
                columns = [
                    { key: 'supplier_name', label: 'المورد' },
                    { key: 'mo_count', label: 'عدد الأوامر' },
                    { key: 'revenue', label: 'الإيرادات', format: _formatCurrency },
                    { key: 'cogs', label: 'التكلفة', format: _formatCurrency },
                    { key: 'gross_profit', label: 'إجمالي الربح', format: _formatCurrency, negative: true },
                    { key: 'margin_pct', label: 'الهامش %', format: function(v) { return v + '%'; } }
                ];
            }

            _renderTable('profitability-table', columns, data);

            // Top 10 bar chart
            _destroyChart('profitability-chart');
            var top10 = data.slice(0, 10);
            var ctx = document.getElementById('profitability-chart');
            if (ctx) {
                _charts['profitability-chart'] = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: top10.map(function (r) { return r[labelKey] || '—'; }),
                        datasets: [{
                            label: 'إجمالي الربح',
                            data: top10.map(function (r) { return parseFloat(r.gross_profit) || 0; }),
                            backgroundColor: '#6366f1',
                            borderRadius: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { y: { beginAtZero: true } }
                    }
                });
            }

            _showContent('profitability-content', 'profitability-loading');
        } catch (err) {
            console.error('[Reports] Profitability load error:', err);
            window.showToast('فشل تحليل الربحية: ' + err.message, 'error');
        }
    }

    async function _loadCashFlow() {
        _showLoading('cashflow-content', 'cashflow-loading');
        try {
            var range = _getDateRange();
            var data = await window.apiFetch('/reports/cash-flow?from=' + range.from + '&to=' + range.to);
            data = data.data || data;
            _currentData.cashflow = data;

            var html = '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">';
            html += '<div class="bg-emerald-50 rounded-2xl border border-emerald-100 p-5"><p class="text-xs text-emerald-600 font-bold mb-1">إجمالي الوارد</p><p class="text-xl font-extrabold text-emerald-700">' + _formatCurrency(data.total_inflow) + '</p></div>';
            html += '<div class="bg-red-50 rounded-2xl border border-red-100 p-5"><p class="text-xs text-red-600 font-bold mb-1">إجمالي الصادر</p><p class="text-xl font-extrabold text-red-700">' + _formatCurrency(data.total_outflow) + '</p></div>';
            html += '<div class="bg-brand-50 rounded-2xl border border-brand-100 p-5"><p class="text-xs text-brand-600 font-bold mb-1">صافي التدفق</p><p class="text-xl font-extrabold text-brand-700">' + _formatCurrency(data.net_flow) + '</p></div>';
            html += '</div>';

            html += '<div class="overflow-x-auto bg-white rounded-2xl border border-slate-100 shadow-sm">';
            html += '<table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">رقم السند</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">التاريخ</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">النوع</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">الطرف</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">الوصف</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">المبلغ</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';

            if (data.transactions.length === 0) {
                html += '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">لا توجد حركات للفترة المحددة</td></tr>';
            } else {
                data.transactions.forEach(function (t) {
                    var isInflow = t.direction === 'inflow';
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 text-slate-700 font-mono">' + t.voucher_number + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + _formatDate(t.voucher_date) + '</td>';
                    html += '<td class="px-4 py-3"><span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ' + (isInflow ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700') + '">' + (isInflow ? 'وارد' : 'صادر') + '</span></td>';
                    html += '<td class="px-4 py-3 text-slate-700">' + (t.party_name || '—') + '</td>';
                    html += '<td class="px-4 py-3 text-slate-500 text-xs">' + (t.description || '—') + '</td>';
                    html += '<td class="px-4 py-3 text-left font-bold ' + (isInflow ? 'text-emerald-600' : 'text-red-600') + '">' + (isInflow ? '+' : '-') + _formatCurrency(t.amount) + '</td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div>';

            document.getElementById('cashflow-content').innerHTML = html;
            _showContent('cashflow-content', 'cashflow-loading');
        } catch (err) {
            console.error('[Reports] Cash flow load error:', err);
            window.showToast('فشل تحميل التدفقات النقدية: ' + err.message, 'error');
        }
    }

    async function _loadVAT() {
        _showLoading('vat-content', 'vat-loading');
        try {
            var range = _getDateRange();
            var data = await window.apiFetch('/reports/vat?from=' + range.from + '&to=' + range.to);
            data = data.data || data;
            _currentData.vat = data;

            var html = '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">';
            html += '<div class="bg-emerald-50 rounded-2xl border border-emerald-100 p-5"><p class="text-xs text-emerald-600 font-bold mb-1">ضريبة محصلة</p><p class="text-xl font-extrabold text-emerald-700">' + _formatCurrency(data.sales_vat_total) + '</p></div>';
            html += '<div class="bg-red-50 rounded-2xl border border-red-100 p-5"><p class="text-xs text-red-600 font-bold mb-1">ضريبة مدفوعة</p><p class="text-xl font-extrabold text-red-700">' + _formatCurrency(data.purchase_vat_total) + '</p></div>';
            html += '<div class="bg-amber-50 rounded-2xl border border-amber-100 p-5"><p class="text-xs text-amber-600 font-bold mb-1">صافي المستحق</p><p class="text-xl font-extrabold text-amber-700">' + _formatCurrency(data.net_vat) + '</p></div>';
            html += '</div>';

            // Sales VAT table
            html += '<div class="bg-white rounded-2xl border border-slate-100 shadow-sm mb-4 overflow-hidden">';
            html += '<div class="px-5 py-3 bg-emerald-50 border-b border-emerald-100"><h3 class="text-sm font-bold text-emerald-800">ضريبة القيمة المضافة المحصلة (المبيعات)</h3></div>';
            html += '<div class="overflow-x-auto"><table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">رقم المستند</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">التاريخ</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">العميل</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">قبل الضريبة</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">الضريبة</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">الإجمالي</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';
            if (data.sales_entries.length === 0) {
                html += '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">لا توجد بيانات</td></tr>';
            } else {
                data.sales_entries.forEach(function (e) {
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 font-mono text-slate-700">' + e.doc_number + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + _formatDate(e.doc_date) + '</td>';
                    html += '<td class="px-4 py-3 text-slate-700">' + (e.party_name || '—') + '</td>';
                    html += '<td class="px-4 py-3 text-left text-slate-600">' + _formatCurrency(e.subtotal) + '</td>';
                    html += '<td class="px-4 py-3 text-left font-bold text-emerald-600">' + _formatCurrency(e.tax_amount) + '</td>';
                    html += '<td class="px-4 py-3 text-left font-bold text-slate-800">' + _formatCurrency(e.grand_total) + '</td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div></div>';

            // Purchase VAT table
            html += '<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">';
            html += '<div class="px-5 py-3 bg-red-50 border-b border-red-100"><h3 class="text-sm font-bold text-red-800">ضريبة القيمة المضافة المدفوعة (المشتريات)</h3></div>';
            html += '<div class="overflow-x-auto"><table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">رقم المستند</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">التاريخ</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">المورد</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">قبل الضريبة</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">الضريبة</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">الإجمالي</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';
            if (data.purchase_entries.length === 0) {
                html += '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">لا توجد بيانات</td></tr>';
            } else {
                data.purchase_entries.forEach(function (e) {
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 font-mono text-slate-700">' + e.doc_number + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + _formatDate(e.doc_date) + '</td>';
                    html += '<td class="px-4 py-3 text-slate-700">' + (e.party_name || '—') + '</td>';
                    html += '<td class="px-4 py-3 text-left text-slate-600">' + _formatCurrency(e.subtotal) + '</td>';
                    html += '<td class="px-4 py-3 text-left font-bold text-red-600">' + _formatCurrency(e.tax_amount) + '</td>';
                    html += '<td class="px-4 py-3 text-left font-bold text-slate-800">' + _formatCurrency(e.grand_total) + '</td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div></div>';

            document.getElementById('vat-content').innerHTML = html;
            _showContent('vat-content', 'vat-loading');
        } catch (err) {
            console.error('[Reports] VAT load error:', err);
            window.showToast('فشل تحميل تقرير الضريبة: ' + err.message, 'error');
        }
    }

    async function _loadSales() {
        _showLoading('sales-content', 'sales-loading');
        try {
            var range = _getDateRange();
            var groupBy = document.getElementById('sales-groupby').value;
            var data = await window.apiFetch('/reports/sales?from=' + range.from + '&to=' + range.to + '&group_by=' + groupBy);
            data = data.data || data;
            _currentData.sales = data;

            var labelKey, columns;
            if (groupBy === 'client') {
                labelKey = 'client_name';
                columns = [
                    { key: 'client_name', label: 'العميل' },
                    { key: 'order_count', label: 'عدد الأوامر' },
                    { key: 'total_sales', label: 'إجمالي المبيعات', format: _formatCurrency },
                    { key: 'total_paid', label: 'المدفوع', format: _formatCurrency },
                    { key: 'outstanding', label: 'المستحق', format: _formatCurrency, negative: true }
                ];
            } else if (groupBy === 'product') {
                labelKey = 'product_name';
                columns = [
                    { key: 'product_name', label: 'المنتج' },
                    { key: 'variant', label: 'المقاس' },
                    { key: 'qty_sold', label: 'الكمية', format: _formatNumber },
                    { key: 'revenue', label: 'الإيرادات', format: _formatCurrency }
                ];
            } else {
                labelKey = 'period';
                columns = [
                    { key: 'period', label: 'الفترة' },
                    { key: 'order_count', label: 'عدد الأوامر' },
                    { key: 'subtotal', label: 'قبل الضريبة', format: _formatCurrency },
                    { key: 'tax', label: 'الضريبة', format: _formatCurrency },
                    { key: 'total', label: 'الإجمالي', format: _formatCurrency }
                ];
            }

            _renderTable('sales-table', columns, data);

            // Chart
            _destroyChart('sales-chart');
            var top10 = data.slice(0, 10);
            var ctx = document.getElementById('sales-chart');
            if (ctx) {
                var chartType = (groupBy === 'day' || groupBy === 'week' || groupBy === 'month') ? 'line' : 'bar';
                var valueKey = (groupBy === 'client') ? 'total_sales' : (groupBy === 'product' ? 'revenue' : 'total');
                _charts['sales-chart'] = new Chart(ctx, {
                    type: chartType,
                    data: {
                        labels: top10.map(function (r) { return r[labelKey] || '—'; }),
                        datasets: [{
                            label: 'المبيعات (ر.س)',
                            data: top10.map(function (r) { return parseFloat(r[valueKey]) || 0; }),
                            backgroundColor: chartType === 'bar' ? '#6366f1' : 'rgba(99,102,241,0.2)',
                            borderColor: '#6366f1',
                            borderWidth: 2,
                            fill: chartType === 'line',
                            tension: 0.3,
                            borderRadius: chartType === 'bar' ? 6 : 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { y: { beginAtZero: true } }
                    }
                });
            }

            _showContent('sales-content', 'sales-loading');
        } catch (err) {
            console.error('[Reports] Sales load error:', err);
            window.showToast('فشل تحميل تقرير المبيعات: ' + err.message, 'error');
        }
    }

    async function _loadQuotations() {
        _showLoading('quotations-content', 'quotations-loading');
        try {
            var range = _getDateRange();
            var data = await window.apiFetch('/reports/quotations?from=' + range.from + '&to=' + range.to);
            data = data.data || data;
            _currentData.quotations = data;

            var html = '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">';
            var cards = [
                { label: 'إجمالي العروض', value: data.total_quotes, color: 'bg-slate-600' },
                { label: 'معلقة', value: data.pending, color: 'bg-amber-500' },
                { label: 'منتهية', value: data.expired, color: 'bg-red-500' },
                { label: 'موافق عليها', value: data.approved, color: 'bg-emerald-600' },
                { label: 'مرفوضة', value: data.rejected, color: 'bg-red-600' },
                { label: 'محولة', value: data.converted, color: 'bg-brand-600' }
            ];
            cards.forEach(function (c) {
                html += '<div class="bg-white rounded-xl border border-slate-100 p-4 shadow-sm text-center">';
                html += '<div class="w-8 h-8 rounded-lg ' + c.color + ' flex items-center justify-center mx-auto mb-2"><span class="text-white text-xs font-bold">' + c.value + '</span></div>';
                html += '<p class="text-xs text-slate-500 font-medium">' + c.label + '</p>';
                html += '</div>';
            });
            html += '</div>';

            html += '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">';
            html += '<div class="bg-brand-50 rounded-2xl border border-brand-100 p-5"><p class="text-xs text-brand-600 font-bold mb-1">معدل التحويل</p><p class="text-2xl font-extrabold text-brand-700">' + data.conversion_rate + '%</p></div>';
            html += '<div class="bg-slate-50 rounded-2xl border border-slate-100 p-5"><p class="text-xs text-slate-600 font-bold mb-1">متوسط قيمة العرض</p><p class="text-xl font-extrabold text-slate-700">' + _formatCurrency(data.avg_quote_value) + '</p></div>';
            html += '<div class="bg-slate-50 rounded-2xl border border-slate-100 p-5"><p class="text-xs text-slate-600 font-bold mb-1">متوسط زمن القرار</p><p class="text-xl font-extrabold text-slate-700">' + data.avg_decision_days + ' يوم</p></div>';
            html += '</div>';

            // Expired quotes table
            html += '<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">';
            html += '<div class="px-5 py-3 bg-amber-50 border-b border-amber-100"><h3 class="text-sm font-bold text-amber-800">عروض منتهية بدون رد</h3></div>';
            html += '<div class="overflow-x-auto"><table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">رقم العرض</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">العميل</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">تاريخ العرض</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">تنتهي في</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">القيمة</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';
            if (data.expired_quotes.length === 0) {
                html += '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-400">لا توجد عروض منتهية</td></tr>';
            } else {
                data.expired_quotes.forEach(function (q) {
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 font-mono text-slate-700">' + q.order_number + '</td>';
                    html += '<td class="px-4 py-3 text-slate-700">' + (q.client_name || '—') + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + _formatDate(q.order_date) + '</td>';
                    html += '<td class="px-4 py-3 text-red-600">' + _formatDate(q.valid_until) + '</td>';
                    html += '<td class="px-4 py-3 text-left font-bold text-slate-800">' + _formatCurrency(q.grand_total) + '</td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div></div>';

            document.getElementById('quotations-content').innerHTML = html;
            _showContent('quotations-content', 'quotations-loading');
        } catch (err) {
            console.error('[Reports] Quotations load error:', err);
            window.showToast('فشل تحميل تحليل العروض: ' + err.message, 'error');
        }
    }

    async function _loadClientBehavior() {
        _showLoading('clients-content', 'clients-loading');
        try {
            var range = _getDateRange();
            var data = await window.apiFetch('/reports/client-behavior?from=' + range.from + '&to=' + range.to);
            data = data.data || data;
            _currentData.clients = data;

            var html = '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">';

            // Top clients
            html += '<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">';
            html += '<div class="px-5 py-3 bg-brand-50 border-b border-brand-100"><h3 class="text-sm font-bold text-brand-800">أفضل 20 عميل</h3></div>';
            html += '<div class="overflow-x-auto"><table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">العميل</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">الأوامر</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">إجمالي الإنفاق</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">متوسط الأمر</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';
            if (data.top_clients.length === 0) {
                html += '<tr><td colspan="4" class="px-4 py-8 text-center text-slate-400">لا توجد بيانات</td></tr>';
            } else {
                data.top_clients.forEach(function (c) {
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 text-slate-700 font-medium">' + c.name + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + c.order_count + '</td>';
                    html += '<td class="px-4 py-3 text-left font-bold text-slate-800">' + _formatCurrency(c.total_spent) + '</td>';
                    html += '<td class="px-4 py-3 text-left text-slate-600">' + _formatCurrency(c.avg_order_value) + '</td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div></div>';

            // Inactive clients
            html += '<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">';
            html += '<div class="px-5 py-3 bg-red-50 border-b border-red-100"><h3 class="text-sm font-bold text-red-800">عملاء غير نشطين (90+ يوم)</h3></div>';
            html += '<div class="overflow-x-auto"><table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">العميل</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">الهاتف</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">آخر أمر</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">أيام الخمول</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';
            if (data.inactive_clients.length === 0) {
                html += '<tr><td colspan="4" class="px-4 py-8 text-center text-slate-400">لا يوجد عملاء غير نشطين</td></tr>';
            } else {
                data.inactive_clients.forEach(function (c) {
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 text-slate-700 font-medium">' + c.name + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600 font-mono">' + (c.phone || '—') + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + (c.last_order_date ? _formatDate(c.last_order_date) : 'لا يوجد') + '</td>';
                    html += '<td class="px-4 py-3 text-left"><span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">' + c.days_inactive + ' يوم</span></td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div></div>';

            html += '</div>';
            document.getElementById('clients-content').innerHTML = html;
            _showContent('clients-content', 'clients-loading');
        } catch (err) {
            console.error('[Reports] Client behavior load error:', err);
            window.showToast('فشل تحميل سلوك العملاء: ' + err.message, 'error');
        }
    }

    async function _loadSupplierPerformance() {
        _showLoading('suppliers-content', 'suppliers-loading');
        try {
            var range = _getDateRange();
            var data = await window.apiFetch('/reports/supplier-performance?from=' + range.from + '&to=' + range.to);
            data = data.data || data;
            _currentData.suppliers = data;

            var html = '<div class="overflow-x-auto bg-white rounded-2xl border border-slate-100 shadow-sm">';
            html += '<table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">المورد</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">إجمالي الأوامر</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">مكتمل</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">جاري</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">جزئي</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">إجمالي التكلفة</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">متوسط زمن التسليم</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';
            if (data.length === 0) {
                html += '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-400">لا توجد بيانات</td></tr>';
            } else {
                data.forEach(function (s) {
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 text-slate-700 font-medium">' + s.company_name + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + s.total_orders + '</td>';
                    html += '<td class="px-4 py-3"><span class="text-emerald-600 font-bold">' + s.completed + '</span></td>';
                    html += '<td class="px-4 py-3"><span class="text-amber-600 font-bold">' + s.in_production + '</span></td>';
                    html += '<td class="px-4 py-3"><span class="text-blue-600 font-bold">' + s.partial + '</span></td>';
                    html += '<td class="px-4 py-3 text-left font-bold text-slate-800">' + _formatCurrency(s.total_cost) + '</td>';
                    html += '<td class="px-4 py-3 text-left text-slate-600">' + (parseFloat(s.avg_lead_time_days) || 0).toFixed(1) + ' يوم</td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div>';

            document.getElementById('suppliers-content').innerHTML = html;
            _showContent('suppliers-content', 'suppliers-loading');
        } catch (err) {
            console.error('[Reports] Supplier performance load error:', err);
            window.showToast('فشل تحميل أداء الموردين: ' + err.message, 'error');
        }
    }

    async function _loadProductionStatus() {
        _showLoading('prodstatus-content', 'prodstatus-loading');
        try {
            var range = _getDateRange();
            var data = await window.apiFetch('/reports/production-status?from=' + range.from + '&to=' + range.to);
            data = data.data || data;
            _currentData.prodstatus = data;

            var statusLabels = {
                'confirmed': 'مؤكد',
                'production': 'قيد الإنتاج',
                'processing': 'قيد المعالجة',
                'completed': 'مكتمل',
                'delivered': 'تم التسليم',
                'pending': 'معلق'
            };

            var html = '<div class="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm mb-4">';
            html += '<div class="relative h-64"><canvas id="prodstatus-chart"></canvas></div>';
            html += '</div>';

            html += '<div class="overflow-x-auto bg-white rounded-2xl border border-slate-100 shadow-sm">';
            html += '<table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">الحالة</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">العدد</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">القيمة</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';
            if (data.length === 0) {
                html += '<tr><td colspan="3" class="px-4 py-8 text-center text-slate-400">لا توجد بيانات</td></tr>';
            } else {
                data.forEach(function (s) {
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 text-slate-700 font-medium">' + (statusLabels[s.status] || s.status) + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + s.count + '</td>';
                    html += '<td class="px-4 py-3 text-left font-bold text-slate-800">' + _formatCurrency(s.value) + '</td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div>';

            document.getElementById('prodstatus-content').innerHTML = html;

            _destroyChart('prodstatus-chart');
            var ctx = document.getElementById('prodstatus-chart');
            if (ctx && data.length > 0) {
                _charts['prodstatus-chart'] = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: data.map(function (s) { return statusLabels[s.status] || s.status; }),
                        datasets: [{
                            data: data.map(function (s) { return parseInt(s.count); }),
                            backgroundColor: ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#8b5cf6'],
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { position: 'bottom', labels: { font: { size: 12 } } } }
                    }
                });
            }

            _showContent('prodstatus-content', 'prodstatus-loading');
        } catch (err) {
            console.error('[Reports] Production status load error:', err);
            window.showToast('فشل تحميل حالة الإنتاج: ' + err.message, 'error');
        }
    }

    async function _loadProductionCycle() {
        _showLoading('prodcycle-content', 'prodcycle-loading');
        try {
            var range = _getDateRange();
            var data = await window.apiFetch('/reports/production-cycle?from=' + range.from + '&to=' + range.to);
            data = data.data || data;
            _currentData.prodcycle = data;

            var html = '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">';
            html += '<div class="bg-brand-50 rounded-2xl border border-brand-100 p-5"><p class="text-xs text-brand-600 font-bold mb-1">متوسط زمن الدورة</p><p class="text-2xl font-extrabold text-brand-700">' + data.avg_cycle_days + ' يوم</p></div>';
            html += '<div class="bg-red-50 rounded-2xl border border-red-100 p-5"><p class="text-xs text-red-600 font-bold mb-1">أطول زمن</p><p class="text-2xl font-extrabold text-red-700">' + data.max_cycle_days + ' يوم</p></div>';
            html += '<div class="bg-emerald-50 rounded-2xl border border-emerald-100 p-5"><p class="text-xs text-emerald-600 font-bold mb-1">أقصر زمن</p><p class="text-2xl font-extrabold text-emerald-700">' + data.min_cycle_days + ' يوم</p></div>';
            html += '</div>';

            html += '<div class="overflow-x-auto bg-white rounded-2xl border border-slate-100 shadow-sm">';
            html += '<table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">رقم الأمر</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">تاريخ الأمر</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">أول تسليم</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">آخر تسليم</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">زمن الدورة (يوم)</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';
            if (data.orders.length === 0) {
                html += '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-400">لا توجد بيانات</td></tr>';
            } else {
                data.orders.forEach(function (o) {
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 font-mono text-slate-700">' + o.order_number + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + _formatDate(o.order_date) + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + _formatDate(o.first_delivery) + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + _formatDate(o.last_delivery) + '</td>';
                    html += '<td class="px-4 py-3 text-left font-bold ' + (parseFloat(o.total_cycle_days) > data.avg_cycle_days ? 'text-red-600' : 'text-emerald-600') + '">' + o.total_cycle_days + '</td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div>';

            document.getElementById('prodcycle-content').innerHTML = html;
            _showContent('prodcycle-content', 'prodcycle-loading');
        } catch (err) {
            console.error('[Reports] Production cycle load error:', err);
            window.showToast('فشل تحميل زمن دورة الإنتاج: ' + err.message, 'error');
        }
    }

    async function _loadStockValue() {
        _showLoading('stockvalue-content', 'stockvalue-loading');
        try {
            var data = await window.apiFetch('/reports/stock-value');
            data = data.data || data;
            _currentData.stockvalue = data;

            var totalCost = 0, totalRetail = 0;
            data.forEach(function (r) {
                totalCost += parseFloat(r.cost_value) || 0;
                totalRetail += parseFloat(r.retail_value) || 0;
            });

            var html = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">';
            html += '<div class="bg-blue-50 rounded-2xl border border-blue-100 p-5"><p class="text-xs text-blue-600 font-bold mb-1">إجمالي تكلفة المخزون</p><p class="text-2xl font-extrabold text-blue-700">' + _formatCurrency(totalCost) + '</p></div>';
            html += '<div class="bg-emerald-50 rounded-2xl border border-emerald-100 p-5"><p class="text-xs text-emerald-600 font-bold mb-1">إجمالي قيمة البيع</p><p class="text-2xl font-extrabold text-emerald-700">' + _formatCurrency(totalRetail) + '</p></div>';
            html += '</div>';

            html += '<div class="overflow-x-auto bg-white rounded-2xl border border-slate-100 shadow-sm">';
            html += '<table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">المستودع</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">العميل</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">عدد الأصناف</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">الكمية</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">تكلفة المخزون</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">قيمة البيع</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';
            if (data.length === 0) {
                html += '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">لا توجد بيانات</td></tr>';
            } else {
                data.forEach(function (r) {
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 text-slate-700 font-medium">' + r.warehouse_name + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + (r.client_name || 'عام') + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + r.sku_count + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + _formatNumber(r.total_qty) + '</td>';
                    html += '<td class="px-4 py-3 text-left font-bold text-blue-600">' + _formatCurrency(r.cost_value) + '</td>';
                    html += '<td class="px-4 py-3 text-left font-bold text-emerald-600">' + _formatCurrency(r.retail_value) + '</td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div>';

            document.getElementById('stockvalue-content').innerHTML = html;
            _showContent('stockvalue-content', 'stockvalue-loading');
        } catch (err) {
            console.error('[Reports] Stock value load error:', err);
            window.showToast('فشل تحميل قيمة المخزون: ' + err.message, 'error');
        }
    }

    async function _loadStockMovement() {
        _showLoading('stockmovement-content', 'stockmovement-loading');
        try {
            var range = _getDateRange();
            var data = await window.apiFetch('/reports/stock-movement?from=' + range.from + '&to=' + range.to);
            data = data.data || data;
            _currentData.stockmovement = data;

            var typeLabels = {
                'receive': 'استلام',
                'release': 'صرف',
                'transfer': 'تحويل',
                'adjustment': 'تسوية',
                'delivery': 'تسليم',
                'return': 'مرتجع',
                'production_receive': 'استلام إنتاج',
                'initial': 'رصيد افتتاحي'
            };

            var html = '<div class="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm mb-4">';
            html += '<div class="relative h-64"><canvas id="stockmovement-chart"></canvas></div>';
            html += '</div>';

            html += '<div class="overflow-x-auto bg-white rounded-2xl border border-slate-100 shadow-sm">';
            html += '<table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">نوع الحركة</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">العدد</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">إجمالي الكمية</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';
            if (data.length === 0) {
                html += '<tr><td colspan="3" class="px-4 py-8 text-center text-slate-400">لا توجد حركات</td></tr>';
            } else {
                data.forEach(function (r) {
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 text-slate-700 font-medium">' + (typeLabels[r.transaction_type] || r.transaction_type) + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + r.count + '</td>';
                    html += '<td class="px-4 py-3 text-left font-bold text-slate-800">' + _formatNumber(r.total_qty) + '</td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div>';

            document.getElementById('stockmovement-content').innerHTML = html;

            _destroyChart('stockmovement-chart');
            var ctx = document.getElementById('stockmovement-chart');
            if (ctx && data.length > 0) {
                _charts['stockmovement-chart'] = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: data.map(function (r) { return typeLabels[r.transaction_type] || r.transaction_type; }),
                        datasets: [{
                            label: 'الكمية',
                            data: data.map(function (r) { return parseFloat(r.total_qty) || 0; }),
                            backgroundColor: '#6366f1',
                            borderRadius: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { y: { beginAtZero: true } }
                    }
                });
            }

            _showContent('stockmovement-content', 'stockmovement-loading');
        } catch (err) {
            console.error('[Reports] Stock movement load error:', err);
            window.showToast('فشل تحميل حركة المخزون: ' + err.message, 'error');
        }
    }

    async function _loadStockAlerts() {
        _showLoading('stockalerts-content', 'stockalerts-loading');
        try {
            var data = await window.apiFetch('/reports/stock-alerts');
            data = data.data || data;
            _currentData.stockalerts = data;

            var html = '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">';

            // Low stock
            html += '<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">';
            html += '<div class="px-5 py-3 bg-red-50 border-b border-red-100"><h3 class="text-sm font-bold text-red-800">مخزون منخفض / نفد</h3></div>';
            html += '<div class="overflow-x-auto"><table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">المنتج</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">المقاس</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">المستودع</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">الكمية</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">الحد الأدنى</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">الحالة</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';
            if (data.low_stock.length === 0) {
                html += '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">لا توجد تنبيهات</td></tr>';
            } else {
                data.low_stock.forEach(function (r) {
                    var isOut = r.alert_type === 'out';
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 text-slate-700 font-medium">' + r.name + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + r.size_name + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + r.warehouse_name + '</td>';
                    html += '<td class="px-4 py-3 font-bold ' + (isOut ? 'text-red-600' : 'text-amber-600') + '">' + _formatNumber(r.quantity) + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + r.min_stock_level + '</td>';
                    html += '<td class="px-4 py-3"><span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ' + (isOut ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700') + '">' + (isOut ? 'نفد' : 'منخفض') + '</span></td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div></div>';

            // Idle stock
            html += '<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">';
            html += '<div class="px-5 py-3 bg-amber-50 border-b border-amber-100"><h3 class="text-sm font-bold text-amber-800">مخزون راكد (90+ يوم)</h3></div>';
            html += '<div class="overflow-x-auto"><table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">المنتج</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">المقاس</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">المستودع</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">الكمية</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">آخر تحديث</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">أيام الركود</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';
            if (data.idle_stock.length === 0) {
                html += '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">لا يوجد مخزون راكد</td></tr>';
            } else {
                data.idle_stock.forEach(function (r) {
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 text-slate-700 font-medium">' + r.name + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + r.size_name + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + r.warehouse_name + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + _formatNumber(r.quantity) + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + _formatDate(r.last_updated) + '</td>';
                    html += '<td class="px-4 py-3 text-left"><span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">' + r.days_idle + ' يوم</span></td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div></div>';

            html += '</div>';
            document.getElementById('stockalerts-content').innerHTML = html;
            _showContent('stockalerts-content', 'stockalerts-loading');
        } catch (err) {
            console.error('[Reports] Stock alerts load error:', err);
            window.showToast('فشل تحميل تنبيهات المخزون: ' + err.message, 'error');
        }
    }

    async function _loadDesignerProductivity() {
        _showLoading('designer-content', 'designer-loading');
        try {
            var range = _getDateRange();
            var data = await window.apiFetch('/reports/designer-productivity?from=' + range.from + '&to=' + range.to);
            data = data.data || data;
            _currentData.designer = data;

            var html = '<div class="overflow-x-auto bg-white rounded-2xl border border-slate-100 shadow-sm">';
            html += '<table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">المصمم</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">إجمالي التصاميم</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">تصاميم نشطة</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">متوسط زمن الإنجاز (يوم)</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';
            if (data.length === 0) {
                html += '<tr><td colspan="4" class="px-4 py-8 text-center text-slate-400">لا توجد بيانات</td></tr>';
            } else {
                data.forEach(function (d) {
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 text-slate-700 font-medium">' + d.designer_name + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + d.total_designs + '</td>';
                    html += '<td class="px-4 py-3"><span class="text-emerald-600 font-bold">' + d.active_designs + '</span></td>';
                    html += '<td class="px-4 py-3 text-left text-slate-600">' + (parseFloat(d.avg_completion_days) || 0).toFixed(1) + '</td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div>';

            document.getElementById('designer-content').innerHTML = html;
            _showContent('designer-content', 'designer-loading');
        } catch (err) {
            console.error('[Reports] Designer productivity load error:', err);
            window.showToast('فشل تحميل إنتاجية المصممين: ' + err.message, 'error');
        }
    }

    async function _loadDesignApproval() {
        _showLoading('approval-content', 'approval-loading');
        try {
            var range = _getDateRange();
            var data = await window.apiFetch('/reports/design-approval?from=' + range.from + '&to=' + range.to);
            data = data.data || data;
            _currentData.approval = data;

            var statusLabels = {
                'completed': 'مكتمل',
                'in_progress': 'قيد التنفيذ',
                'client_revision': 'تعديل العميل',
                'manager_review': 'مراجعة المدير',
                'waiting_design': 'بانتظار التصميم',
                'approved': 'معتمد',
                'rejected': 'مرفوض'
            };

            var html = '<div class="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm mb-4">';
            html += '<div class="relative h-64"><canvas id="approval-chart"></canvas></div>';
            html += '</div>';

            html += '<div class="overflow-x-auto bg-white rounded-2xl border border-slate-100 shadow-sm">';
            html += '<table class="w-full text-sm">';
            html += '<thead class="bg-slate-50 border-b border-slate-200"><tr>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">الحالة</th>';
            html += '<th class="px-4 py-3 text-right text-xs font-bold text-slate-600">العدد</th>';
            html += '<th class="px-4 py-3 text-left text-xs font-bold text-slate-600">النسبة</th>';
            html += '</tr></thead><tbody class="divide-y divide-slate-100">';
            if (data.statuses.length === 0) {
                html += '<tr><td colspan="3" class="px-4 py-8 text-center text-slate-400">لا توجد بيانات</td></tr>';
            } else {
                data.statuses.forEach(function (s) {
                    var pct = data.total > 0 ? ((parseInt(s.count) / data.total) * 100).toFixed(1) : 0;
                    html += '<tr class="hover:bg-slate-50">';
                    html += '<td class="px-4 py-3 text-slate-700 font-medium">' + (statusLabels[s.design_status] || s.design_status) + '</td>';
                    html += '<td class="px-4 py-3 text-slate-600">' + s.count + '</td>';
                    html += '<td class="px-4 py-3 text-left font-bold text-slate-800">' + pct + '%</td>';
                    html += '</tr>';
                });
            }
            html += '</tbody></table></div>';

            document.getElementById('approval-content').innerHTML = html;

            _destroyChart('approval-chart');
            var ctx = document.getElementById('approval-chart');
            if (ctx && data.statuses.length > 0) {
                _charts['approval-chart'] = new Chart(ctx, {
                    type: 'pie',
                    data: {
                        labels: data.statuses.map(function (s) { return statusLabels[s.design_status] || s.design_status; }),
                        datasets: [{
                            data: data.statuses.map(function (s) { return parseInt(s.count); }),
                            backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#6366f1', '#06b6d4', '#8b5cf6', '#ec4899'],
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { position: 'bottom', labels: { font: { size: 12 } } } }
                    }
                });
            }

            _showContent('approval-content', 'approval-loading');
        } catch (err) {
            console.error('[Reports] Design approval load error:', err);
            window.showToast('فشل تحميل معدل الاعتماد: ' + err.message, 'error');
        }
    }

    // ── Tab Switching ──────────────────────────────────────────────────────

    function _switchTab(tabName) {
        _destroyAllCharts();
        _activeTab = tabName;

        // Update tab buttons
        document.querySelectorAll('.report-tab-btn').forEach(function (btn) {
            if (btn.dataset.tab === tabName) {
                btn.classList.add('active', 'text-brand-700', 'border-brand-700');
                btn.classList.remove('text-slate-500', 'border-transparent');
            } else {
                btn.classList.remove('active', 'text-brand-700', 'border-brand-700');
                btn.classList.add('text-slate-500', 'border-transparent');
            }
        });

        // Show/hide panels
        document.querySelectorAll('.report-tab-panel').forEach(function (panel) {
            panel.classList.add('hidden');
        });
        var activePanel = document.getElementById('tab-' + tabName);
        if (activePanel) activePanel.classList.remove('hidden');

        // Load data for the active tab
        _loadTabData(tabName);
    }

    function _loadTabData(tabName) {
        switch (tabName) {
            case 'kpis':       _loadKPIs(); break;
            case 'finance':
                _loadProfitLoss();
                break;
            case 'sales':
                _loadSales();
                break;
            case 'production':
                _loadSupplierPerformance();
                break;
            case 'inventory':
                _loadStockValue();
                break;
            case 'design':
                _loadDesignerProductivity();
                break;
        }
    }

    // ── Sub-tab Switching ──────────────────────────────────────────────────

    function _switchSubTab(prefix, subtabName, loaderMap) {
        // Update sub-tab buttons
        document.querySelectorAll('.' + prefix + '-subtab').forEach(function (btn) {
            if (btn.dataset.subtab === subtabName) {
                btn.classList.add('active', 'bg-white', 'text-brand-700', 'shadow-sm');
                btn.classList.remove('text-slate-500');
            } else {
                btn.classList.remove('active', 'bg-white', 'text-brand-700', 'shadow-sm');
                btn.classList.add('text-slate-500');
            }
        });

        // Show/hide panels
        document.querySelectorAll('.' + prefix + '-subtab-panel').forEach(function (panel) {
            panel.classList.add('hidden');
        });
        var activePanel = document.getElementById(prefix + '-' + subtabName);
        if (activePanel) activePanel.classList.remove('hidden');

        // Load data
        if (loaderMap[subtabName]) loaderMap[subtabName]();
    }

    // ── Export Functions ───────────────────────────────────────────────────

    function _exportExcel() {
        window.showToast('تصدير Excel سيتم تفعيله في المرحلة الثانية', 'info');
    }

    function _exportPDF() {
        window.showToast('تصدير PDF سيتم تفعيله في المرحلة الثانية', 'info');
    }

    function _printReport() {
        window.print();
    }

    // ── Initialization ─────────────────────────────────────────────────────

    function _init() {
        // Tab buttons
        document.querySelectorAll('.report-tab-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                _switchTab(btn.dataset.tab);
            });
        });

        // Date preset
        var datePreset = document.getElementById('report-date-preset');
        if (datePreset) {
            datePreset.addEventListener('change', function () {
                var customRange = document.getElementById('report-custom-range');
                if (this.value === 'custom') {
                    customRange.classList.remove('hidden');
                    customRange.classList.add('flex');
                } else {
                    customRange.classList.add('hidden');
                    customRange.classList.remove('flex');
                }
            });
        }

        // Refresh button
        var refreshBtn = document.getElementById('report-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function () {
                _destroyAllCharts();
                _loadTabData(_activeTab);
            });
        }

        // Export buttons
        var excelBtn = document.getElementById('report-export-excel');
        if (excelBtn) excelBtn.addEventListener('click', _exportExcel);
        var pdfBtn = document.getElementById('report-export-pdf');
        if (pdfBtn) pdfBtn.addEventListener('click', _exportPDF);
        var printBtn = document.getElementById('report-print');
        if (printBtn) printBtn.addEventListener('click', _printReport);

        // Finance sub-tabs
        document.querySelectorAll('.finance-subtab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                _switchSubTab('finance', btn.dataset.subtab, {
                    pnl: _loadProfitLoss,
                    profitability: _loadProfitability,
                    cashflow: _loadCashFlow,
                    vat: _loadVAT
                });
            });
        });

        // Sales sub-tabs
        document.querySelectorAll('.sales-subtab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                _switchSubTab('sales', btn.dataset.subtab, {
                    sales: _loadSales,
                    quotations: _loadQuotations,
                    clients: _loadClientBehavior
                });
            });
        });

        // Production sub-tabs
        document.querySelectorAll('.prod-subtab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                _switchSubTab('prod', btn.dataset.subtab, {
                    suppliers: _loadSupplierPerformance,
                    status: _loadProductionStatus,
                    cycle: _loadProductionCycle
                });
            });
        });

        // Inventory sub-tabs
        document.querySelectorAll('.inv-subtab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                _switchSubTab('inv', btn.dataset.subtab, {
                    value: _loadStockValue,
                    movement: _loadStockMovement,
                    alerts: _loadStockAlerts
                });
            });
        });

        // Design sub-tabs
        document.querySelectorAll('.design-subtab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                _switchSubTab('design', btn.dataset.subtab, {
                    designer: _loadDesignerProductivity,
                    approval: _loadDesignApproval
                });
            });
        });

        // Profitability group_by change
        var profGroupBy = document.getElementById('profitability-groupby');
        if (profGroupBy) profGroupBy.addEventListener('change', _loadProfitability);

        // Sales group_by change
        var salesGroupBy = document.getElementById('sales-groupby');
        if (salesGroupBy) salesGroupBy.addEventListener('change', _loadSales);

        // Load initial tab
        _loadKPIs();
    }

    // Expose init for SPA router
    window.initReports = _init;

    // Auto-init if DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

})();
