// =============================================================================
// G.PACK 2.0 - AI Intelligence Center View
// RFM Segmentation + Churn Alerts + Demand Forecasting
// =============================================================================

var forecastView = {
    chart: null,
    currentData: null,
    rfmData: null,
    churnData: null,

    init() {
        this.loadClients();
        this.loadRFM();
        this.loadChurn();
        this.bindEvents();
    },

    bindEvents() {
        document.getElementById('forecast-btn').addEventListener('click', () => this.runForecast());
        document.getElementById('forecast-export').addEventListener('click', () => this.exportCSV());
        const rfmRefresh = document.getElementById('rfm-refresh');
        if (rfmRefresh) rfmRefresh.addEventListener('click', () => this.loadRFM());
        const churnRefresh = document.getElementById('churn-refresh');
        if (churnRefresh) churnRefresh.addEventListener('click', () => this.loadChurn());
    },

    async loadClients() {
        const select = document.getElementById('forecast-client');
        select.innerHTML = '<option value="">جارٍ التحميل...</option>';

        if (typeof window.apiFetch !== 'function') {
            console.error('[Forecast] window.apiFetch not available');
            select.innerHTML = '<option value="">API غير متاح</option>';
            return;
        }

        try {
            console.log('[Forecast] Loading clients...');
            const res = await window.apiFetch('/api/clients');
            console.log('[Forecast] Clients response:', res);
            const clients = res.data || res || [];
            console.log('[Forecast] Clients count:', clients.length);
            if (!clients.length) {
                select.innerHTML = '<option value="">لا يوجد عملاء</option>';
                return;
            }
            select.innerHTML = '<option value="">اختر عميل...</option>' +
                clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        } catch (err) {
            console.error('[Forecast] loadClients error:', err);
            select.innerHTML = '<option value="">خطأ في تحميل العملاء</option>';
        }
    },

    async runForecast() {
        const clientId = document.getElementById('forecast-client').value;
        const periods = parseInt(document.getElementById('forecast-periods').value);

        if (!clientId) {
            this.showStatus('اختر عميل أولاً', 'warning');
            return;
        }

        this.showStatus('جارٍ التحليل...', 'loading');
        document.getElementById('forecast-results').classList.add('hidden');

        try {
            const data = await window.apiFetch(`/api/forecast/client/${clientId}`, { method: 'POST', body: { periods } });
            this.currentData = data;

            if (!data.ready) {
                this.showStatus(data.message || 'لا توجد بيانات كافية للتوقعات', 'warning');
                return;
            }

            this.render(data);
            this.showStatus('تم التحليل بنجاح!', 'success');
            document.getElementById('forecast-results').classList.remove('hidden');
        } catch (err) {
            this.showStatus('خطأ: ' + (err.message || 'فشل الاتصال بالخدمة'), 'error');
        }
    },

    render(data) {
        const forecast = data.forecast || [];
        const total = forecast.reduce((sum, f) => sum + f.qty, 0);
        const avg = forecast.length ? total / forecast.length : 0;

        document.getElementById('forecast-total').textContent = Math.round(total).toLocaleString();
        document.getElementById('forecast-avg').textContent = Math.round(avg).toLocaleString();
        document.getElementById('forecast-history').textContent = data.total_orders || 0;

        this.renderChart(forecast);
        this.renderTable(forecast);
    },

    renderChart(forecast) {
        const container = document.getElementById('forecast-chart');
        if (!container) return;

        const maxQty = Math.max(...forecast.map(f => f.qty), 1);
        const step = Math.ceil(forecast.length / 20);
        const displayPoints = forecast.filter((_, i) => i % step === 0 || i === forecast.length - 1);

        container.innerHTML = displayPoints.map(f => {
            const height = Math.round((f.qty / maxQty) * 100);
            const d = new Date(f.date);
            const label = d.getDate();
            return `
                <div class="flex flex-col items-center flex-shrink-0" style="width: 24px;" title="${f.date}: ${Math.round(f.qty).toLocaleString()}">
                    <div class="w-3 rounded-t bg-purple-500 hover:bg-purple-600 transition-colors" style="height: ${height}px; min-height: 2px;"></div>
                    <span class="text-[9px] text-slate-400 mt-1">${label}</span>
                </div>
            `;
        }).join('');
    },

    renderTable(forecast) {
        const tbody = document.getElementById('forecast-table-body');
        let cumulative = 0;

        tbody.innerHTML = forecast.map((f, i) => {
            cumulative += f.qty;
            const d = new Date(f.date);
            const dateStr = d.toLocaleDateString('ar-SA', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
            const isHigh = f.qty > (cumulative / (i + 1)) * 1.5;

            return `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="px-4 py-3 text-slate-700 font-medium">${dateStr}</td>
                    <td class="px-4 py-3 text-slate-800 font-bold">${Math.round(f.qty).toLocaleString()}</td>
                    <td class="px-4 py-3 text-slate-600">${Math.round(cumulative).toLocaleString()}</td>
                    <td class="px-4 py-3">
                        ${isHigh
                            ? '<span class="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-bold">ذروة</span>'
                            : '<span class="px-2 py-1 bg-slate-100 text-slate-600 rounded-full text-xs">طبيعي</span>'
                        }
                    </td>
                </tr>
            `;
        }).join('');
    },

    exportCSV() {
        if (!this.currentData || !this.currentData.forecast) return;

        const rows = this.currentData.forecast.map(f => `${f.date},${f.qty}`);
        const csv = 'date,quantity\n' + rows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `forecast_${this.currentData.client_id}_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
    },

    // ── RFM Segmentation ─────────────────────────────────────────────────────
    async loadRFM() {
        const loading = document.getElementById('rfm-loading');
        const content = document.getElementById('rfm-content');
        if (loading) loading.classList.remove('hidden');
        if (content) content.classList.add('hidden');

        try {
            const data = await window.apiFetch('/api/forecast/insights/rfm');
            this.rfmData = data;
            this.renderRFM(data);
        } catch (err) {
            console.error('[AI] RFM error:', err);
        } finally {
            if (loading) loading.classList.add('hidden');
            if (content) content.classList.remove('hidden');
        }
    },

    renderRFM(data) {
        const counts = data.counts || {};
        const elVip = document.getElementById('rfm-vip-count');
        const elActive = document.getElementById('rfm-active-count');
        const elRisk = document.getElementById('rfm-at_risk-count');
        const elDormant = document.getElementById('rfm-dormant-count');
        if (elVip) elVip.textContent = counts.vip || 0;
        if (elActive) elActive.textContent = counts.active || 0;
        if (elRisk) elRisk.textContent = counts.at_risk || 0;
        if (elDormant) elDormant.textContent = counts.dormant || 0;
    },

    toggleRfmSegment(segment) {
        if (!this.rfmData || !this.rfmData.segments) return;
        const panel = document.getElementById('rfm-detail-panel');
        const title = document.getElementById('rfm-detail-title');
        const tbody = document.getElementById('rfm-detail-body');
        if (!panel || !title || !tbody) return;

        const clients = this.rfmData.segments[segment] || [];
        const labels = { vip: 'العملاء VIP', active: 'العملاء النشطين', at_risk: 'العملاء المُهددين', dormant: 'العملاء النائمين' };
        title.textContent = labels[segment] || 'التفاصيل';

        if (!clients.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-4 text-center text-slate-400 text-sm">لا يوجد عملاء في هذه الفئة</td></tr>';
        } else {
            tbody.innerHTML = clients.map(c => `
                <tr class="hover:bg-slate-50 transition-colors cursor-pointer" onclick="window.navigateTo('client-profile?id=${c.id}')">
                    <td class="px-4 py-2 text-slate-800 font-medium">${c.name}</td>
                    <td class="px-4 py-2 text-slate-600">${c.last_order || '—'}</td>
                    <td class="px-4 py-2 text-slate-600">${c.frequency}</td>
                    <td class="px-4 py-2 text-slate-800 font-bold">${Number(c.monetary).toLocaleString()} ر.س</td>
                </tr>
            `).join('');
        }
        panel.classList.remove('hidden');
    },

    // ── Churn Alerts ─────────────────────────────────────────────────────────
    async loadChurn() {
        const loading = document.getElementById('churn-loading');
        const content = document.getElementById('churn-content');
        const empty = document.getElementById('churn-empty');
        if (loading) loading.classList.remove('hidden');
        if (content) content.classList.add('hidden');
        if (empty) empty.classList.add('hidden');

        try {
            const data = await window.apiFetch('/api/forecast/insights/churn?days=30');
            this.churnData = data;
            this.renderChurn(data);
        } catch (err) {
            console.error('[AI] Churn error:', err);
        } finally {
            if (loading) loading.classList.add('hidden');
            if (content) content.classList.remove('hidden');
        }
    },

    renderChurn(data) {
        const tbody = document.getElementById('churn-table-body');
        const empty = document.getElementById('churn-empty');
        const clients = data.clients || [];
        if (!tbody) return;

        if (!clients.length) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        tbody.innerHTML = clients.map(c => {
            const daysClass = c.inactive_days > 60 ? 'text-red-600 font-bold' : (c.inactive_days > 45 ? 'text-orange-600 font-bold' : 'text-slate-700');
            return `
                <tr class="hover:bg-slate-50 transition-colors cursor-pointer" onclick="window.navigateTo('client-profile?id=${c.id}')">
                    <td class="px-4 py-3 text-slate-800 font-medium">${c.name}</td>
                    <td class="px-4 py-3 text-slate-600">${c.last_order || '—'}</td>
                    <td class="px-4 py-3 ${daysClass}">${c.inactive_days === 999 ? 'لم يسبق له الطلب' : c.inactive_days + ' يوم'}</td>
                    <td class="px-4 py-3 text-slate-600">${c.total_orders}</td>
                    <td class="px-4 py-3 text-slate-800 font-bold">${Number(c.total_value).toLocaleString()} ر.س</td>
                </tr>
            `;
        }).join('');
    },

    showStatus(msg, type) {
        const el = document.getElementById('forecast-status');
        if (!el) return;
        el.classList.remove('hidden', 'bg-amber-50', 'text-amber-700', 'bg-red-50', 'text-red-700', 'bg-emerald-50', 'text-emerald-700', 'bg-purple-50', 'text-purple-700');
        el.classList.remove('border', 'border-amber-200', 'border-red-200', 'border-emerald-200', 'border-purple-200');

        const styles = {
            warning: ['bg-amber-50', 'text-amber-700', 'border', 'border-amber-200'],
            error:   ['bg-red-50', 'text-red-700', 'border', 'border-red-200'],
            success: ['bg-emerald-50', 'text-emerald-700', 'border', 'border-emerald-200'],
            loading: ['bg-purple-50', 'text-purple-700', 'border', 'border-purple-200'],
        };

        (styles[type] || styles.warning).forEach(c => el.classList.add(c));
        el.innerHTML = type === 'loading'
            ? `<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> ${msg}`
            : msg;
        el.classList.remove('hidden');
    }
};

// Auto-init when script loads
if (document.getElementById('forecast-client')) {
    forecastView.init();
}

window.forecastView = forecastView;
