// =============================================================================
// G.PACK 2.0 - AI Demand Forecasting View
// =============================================================================

var forecastView = {
    chart: null,
    currentData: null,

    init() {
        this.loadClients();
        this.bindEvents();
    },

    bindEvents() {
        document.getElementById('forecast-btn').addEventListener('click', () => this.runForecast());
        document.getElementById('forecast-export').addEventListener('click', () => this.exportCSV());
    },

    async loadClients() {
        const select = document.getElementById('forecast-client');
        select.innerHTML = '<option value="">جارٍ التحميل...</option>';

        if (typeof api === 'undefined' || !api.get) {
            select.innerHTML = '<option value="">API غير متاح</option>';
            return;
        }

        try {
            const res = await api.get('/clients');
            const clients = res.data || res;
            if (!clients || !clients.length) {
                select.innerHTML = '<option value="">مفيش عملاء</option>';
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
            const data = await api.post(`/forecast/client/${clientId}`, { periods });
            this.currentData = data;

            if (!data.ready) {
                this.showStatus(data.message || 'مفيش بيانات كافية للتوقع', 'warning');
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
        const ctx = document.getElementById('forecast-chart').getContext('2d');

        if (this.chart) {
            this.chart.destroy();
        }

        const labels = forecast.map(f => {
            const d = new Date(f.date);
            return d.toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' });
        });
        const values = forecast.map(f => f.qty);

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'الكمية المتوقعة',
                    data: values,
                    borderColor: '#7c3aed',
                    backgroundColor: 'rgba(124, 58, 237, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: '#f1f5f9' },
                        ticks: { font: { size: 10 } }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 10 }, maxTicksLimit: 10 }
                    }
                }
            }
        });
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

    showStatus(msg, type) {
        const el = document.getElementById('forecast-status');
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
