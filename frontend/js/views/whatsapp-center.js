'use strict';

(function () {

    let _pollTimer = null;

    async function _loadStatus() {
        try {
            const res = await window.apiFetch('/api/notifications/whatsapp/status');
            if (!res || !res.success) return;

            const s = res.session;
            const statusEl = document.getElementById('wa-status-badge');
            if (statusEl) {
                const isConnected = s.connected;
                statusEl.innerHTML = isConnected
                    ? '<span class="inline-flex items-center gap-1.5 text-emerald-600"><span class="w-2 h-2 bg-emerald-500 rounded-full"></span>متصل</span>'
                    : '<span class="inline-flex items-center gap-1.5 text-red-500"><span class="w-2 h-2 bg-red-500 rounded-full"></span>غير متصل</span>';
            }
            document.getElementById('wa-provider').textContent = s.provider || '—';
            document.getElementById('wa-session-name').textContent = s.session || '—';
            document.getElementById('wa-url').textContent = s.url || '—';

            const errBox = document.getElementById('wa-error-msg');
            const errText = document.getElementById('wa-error-text');
            if (s.error && errBox) {
                errBox.classList.remove('hidden');
                errText.textContent = s.error;
            } else if (errBox) {
                errBox.classList.add('hidden');
            }

            // Show start session button if not connected
            const startBtn = document.getElementById('wa-start-session-btn');
            if (startBtn && !isConnected) {
                startBtn.classList.remove('hidden');
            } else if (startBtn) {
                startBtn.classList.add('hidden');
            }

            // Stats
            const q = res.queue || {};
            document.getElementById('wa-queue-pending').textContent = q.pending || 0;
            document.getElementById('wa-queue-total').textContent = q.total || 0;

            const t = res.today || {};
            document.getElementById('wa-queue-sent-today').textContent = t.sent_today || 0;
            document.getElementById('wa-queue-failed-today').textContent = t.failed_today || 0;
        } catch (err) {
            console.error('[WhatsAppCenter] Status error:', err);
        }
    }

    async function _loadQueue() {
        const filter = document.getElementById('wa-queue-filter')?.value || 'all';
        const body = document.getElementById('wa-queue-body');
        if (!body) return;

        try {
            const res = await window.apiFetch(`/api/notifications/whatsapp/queue?status=${filter}&limit=50`);
            if (!res || !res.success) return;

            if (!res.queue || res.queue.length === 0) {
                body.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-400">لا توجد عناصر</td></tr>';
                return;
            }

            const STATUS_BADGES = {
                pending:    '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">في الانتظار</span>',
                processing: '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">قيد المعالجة</span>',
                sent:       '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">مرسلة</span>',
                failed:     '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">فاشلة</span>',
            };

            const TYPE_LABELS = {
                design_approved_client: 'اعتماد — عميل',
                design_approved_admin: 'اعتماد — إدارة',
                design_approved_designer: 'اعتماد — مصمم',
                design_sent_to_client: 'إرسال تصميم',
            };

            body.innerHTML = res.queue.map(item => {
                const status = STATUS_BADGES[item.status] || item.status;
                const typeLabel = TYPE_LABELS[item.message_type] || item.message_type;
                const time = new Date(item.created_at).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
                const errorCell = item.last_error ? `<span class="text-xs text-red-500" title="${_esc(item.last_error)}">${_esc(item.last_error.substring(0, 50))}...</span>` : '—';
                const retryBtn = item.status === 'failed'
                    ? `<button onclick="window.waRetry('${item.id}')" class="text-xs text-emerald-600 hover:text-emerald-700 font-medium"><i class="fa-solid fa-rotate-right ml-1"></i>إعادة</button>`
                    : '';

                return `<tr class="hover:bg-slate-50">
                    <td class="px-4 py-3 text-xs text-slate-600">${_esc(typeLabel)}</td>
                    <td class="px-4 py-3 text-xs text-slate-600">${_esc(item.recipient_name || item.recipient || '—')}</td>
                    <td class="px-4 py-3">${status}</td>
                    <td class="px-4 py-3 text-xs text-slate-500">${item.attempts}/${item.max_attempts}</td>
                    <td class="px-4 py-3 text-xs text-slate-400">${time}</td>
                    <td class="px-4 py-3">${errorCell}</td>
                    <td class="px-4 py-3">${retryBtn}</td>
                </tr>`;
            }).join('');
        } catch (err) {
            console.error('[WhatsAppCenter] Queue error:', err);
            body.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-red-400">فشل في التحميل</td></tr>';
        }
    }

    function _esc(str) {
        return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    window.waRetry = async function(id) {
        try {
            await window.apiFetch(`/api/notifications/whatsapp/retry/${id}`, { method: 'POST' });
            window.showToast?.('تم إعادة جدولة الإشعار', 'success');
            _loadQueue();
            _loadStatus();
        } catch (err) {
            window.showToast?.(err.message || 'فشل في إعادة الجدولة', 'error');
        }
    };

    function _init() {
        _loadStatus();
        _loadQueue();

        document.getElementById('wa-refresh-btn')?.addEventListener('click', () => {
            _loadStatus();
            _loadQueue();
        });

        document.getElementById('wa-queue-filter')?.addEventListener('change', _loadQueue);

        document.getElementById('wa-start-session-btn')?.addEventListener('click', async () => {
            try {
                await window.apiFetch('/api/notifications/whatsapp/start-session', { method: 'POST' });
                window.showToast?.('تم إرسال طلب بدء الجلسة', 'success');
                setTimeout(_loadStatus, 2000);
            } catch (err) {
                window.showToast?.(err.message || 'فشل في بدء الجلسة', 'error');
            }
        });

        // Poll every 30s
        _pollTimer = setInterval(() => {
            _loadStatus();
            _loadQueue();
        }, 30000);
    }

    function _cleanup() {
        if (_pollTimer) clearInterval(_pollTimer);
    }

    window.whatsappCenterInit = _init;
    window.whatsappCenterCleanup = _cleanup;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }
})();
