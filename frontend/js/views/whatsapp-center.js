'use strict';

(function () {

    let _pollTimer = null;
    let _currentFilter = 'all';

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

            const startBtn = document.getElementById('wa-start-session-btn');
            if (startBtn && !isConnected) {
                startBtn.classList.remove('hidden');
            } else if (startBtn) {
                startBtn.classList.add('hidden');
            }

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
        const body = document.getElementById('wa-queue-body');
        if (!body) return;

        try {
            const res = await window.apiFetch(`/api/notifications/queue?status=${_currentFilter}&limit=100`);
            if (!res || !res.success) return;

            const stats = res.stats || {};
            const statsEl = document.getElementById('wa-queue-stats');
            if (statsEl) {
                statsEl.innerHTML = `
                    <span class="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">منتظر: ${stats.pending || 0}</span>
                    <span class="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">قيد المعالجة: ${stats.processing || 0}</span>
                    <span class="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">مرسلة: ${stats.sent || 0}</span>
                    <span class="px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">فاشلة: ${stats.failed || 0}</span>
                    <span class="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">ملغية: ${stats.cancelled || 0}</span>
                    ${stats.high_pending > 0 ? `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-red-200 text-red-800">عاجلة: ${stats.high_pending}</span>` : ''}
                `;
            }

            if (!res.queue || res.queue.length === 0) {
                body.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-slate-400">لا توجد عناصر</td></tr>';
                return;
            }

            const STATUS_BADGES = {
                pending:    '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">منتظر</span>',
                processing: '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">قيد المعالجة</span>',
                sent:       '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">مرسلة</span>',
                failed:     '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">فاشلة</span>',
                cancelled:  '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-600">ملغية</span>',
            };

            const PRIORITY_BADGES = {
                high:   '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">HIGH</span>',
                normal: '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">NORMAL</span>',
                low:    '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500">LOW</span>',
            };

            const TYPE_LABELS = {
                design_approved_client: 'اعتماد — عميل',
                design_approved_admin: 'اعتماد — إدارة',
                design_approved_designer: 'اعتماد — مصمم',
                design_sent_to_client: 'إرسال تصميم',
                whatsapp_failed: 'فشل إرسال',
            };

            body.innerHTML = res.queue.map(item => {
                const status = STATUS_BADGES[item.status] || item.status;
                const priority = PRIORITY_BADGES[item.priority] || PRIORITY_BADGES.normal;
                const typeLabel = TYPE_LABELS[item.message_type] || item.message_type;
                const time = new Date(item.created_at).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
                const errorCell = item.last_error ? `<span class="text-xs text-red-500 cursor-help" title="${_esc(item.last_error)}">${_esc(item.last_error.substring(0, 40))}...</span>` : '—';

                let actions = '';
                if (item.status === 'failed') {
                    actions += `<button onclick="window.waRetry('${item.id}')" class="text-xs text-emerald-600 hover:text-emerald-700 font-medium ml-2"><i class="fa-solid fa-rotate-right"></i> إعادة</button>`;
                }
                if (item.status === 'pending' || item.status === 'processing') {
                    actions += `<button onclick="window.waCancel('${item.id}')" class="text-xs text-red-500 hover:text-red-600 font-medium ml-2"><i class="fa-solid fa-ban"></i> إلغاء</button>`;
                }
                actions += `<button onclick="window.waDetails('${item.id}')" class="text-xs text-brand-600 hover:text-brand-700 font-medium"><i class="fa-solid fa-eye"></i> تفاصيل</button>`;

                return `<tr class="hover:bg-slate-50">
                    <td class="px-4 py-3 text-xs text-slate-600">${_esc(typeLabel)}</td>
                    <td class="px-4 py-3 text-xs text-slate-600">${_esc(item.recipient_name || item.recipient || '—')}</td>
                    <td class="px-4 py-3">${status}</td>
                    <td class="px-4 py-3">${priority}</td>
                    <td class="px-4 py-3 text-xs text-slate-500">${item.attempts}/${item.max_attempts}</td>
                    <td class="px-4 py-3 text-xs text-slate-400">${time}</td>
                    <td class="px-4 py-3">${errorCell}</td>
                    <td class="px-4 py-3 whitespace-nowrap">${actions}</td>
                </tr>`;
            }).join('');
        } catch (err) {
            console.error('[WhatsAppCenter] Queue error:', err);
            body.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-red-400">فشل في التحميل</td></tr>';
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

    window.waCancel = async function(id) {
        if (!confirm('هل تريد إلغاء هذا الإشعار؟')) return;
        try {
            await window.apiFetch(`/api/notifications/queue/${id}/cancel`, { method: 'PUT' });
            window.showToast?.('تم إلغاء الإشعار', 'success');
            _loadQueue();
        } catch (err) {
            window.showToast?.(err.message || 'فشل في الإلغاء', 'error');
        }
    };

    window.waDetails = async function(id) {
        try {
            const res = await window.apiFetch(`/api/notifications/queue/${id}`);
            if (!res || !res.success || !res.item) return;

            const item = res.item;
            let retryHtml = '';
            if (item.retry_history) {
                let history = item.retry_history;
                if (typeof history === 'string') { try { history = JSON.parse(history); } catch { history = []; } }
                if (Array.isArray(history) && history.length > 0) {
                    retryHtml = history.map(h => `
                        <div class="text-xs text-slate-500 border-r-2 border-amber-300 pr-2 mb-1">
                            <span class="font-medium">محاولة ${h.attempt}</span> — ${new Date(h.timestamp).toLocaleString('ar-SA')}
                            <br><span class="text-red-400">${_esc(h.error)}</span>
                        </div>
                    `).join('');
                }
            }

            let attachmentsHtml = '';
            if (item.attachments) {
                let atts = item.attachments;
                if (typeof atts === 'string') { try { atts = JSON.parse(atts); } catch { atts = []; } }
                if (Array.isArray(atts) && atts.length > 0) {
                    attachmentsHtml = atts.map(a => `<div class="text-xs"><i class="fa-solid fa-paperclip ml-1"></i>${_esc(a.type)}: ${_esc(a.path || '')}</div>`).join('');
                }
            }

            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4';
            modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
            modal.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
                    <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
                        <h3 class="font-bold text-slate-800">تفاصيل الإشعار #${item.id}</h3>
                        <button onclick="this.closest('.fixed').remove()" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark text-lg"></i></button>
                    </div>
                    <div class="p-5 space-y-4">
                        <div class="grid grid-cols-2 gap-3 text-sm">
                            <div><span class="text-slate-400 text-xs">النوع:</span><br><span class="font-medium">${_esc(item.message_type)}</span></div>
                            <div><span class="text-slate-400 text-xs">القناة:</span><br><span class="font-medium">${_esc(item.channel)}</span></div>
                            <div><span class="text-slate-400 text-xs">المستلم:</span><br><span class="font-medium">${_esc(item.recipient_name || item.recipient)}</span></div>
                            <div><span class="text-slate-400 text-xs">الأولوية:</span><br><span class="font-medium">${_esc(item.priority)}</span></div>
                            <div><span class="text-slate-400 text-xs">الحالة:</span><br><span class="font-medium">${_esc(item.status)}</span></div>
                            <div><span class="text-slate-400 text-xs">المحاولات:</span><br><span class="font-medium">${item.attempts}/${item.max_attempts}</span></div>
                            <div><span class="text-slate-400 text-xs">WAHA Message ID:</span><br><span class="font-medium text-xs">${_esc(item.waha_message_id || '—')}</span></div>
                            <div><span class="text-slate-400 text-xs">WAHA Status:</span><br><span class="font-medium">${_esc(item.waha_status || '—')}</span></div>
                        </div>
                        <div>
                            <span class="text-slate-400 text-xs">النص:</span>
                            <div class="mt-1 p-3 bg-slate-50 rounded-lg text-sm text-slate-700 whitespace-pre-wrap">${_esc(item.body || '')}</div>
                        </div>
                        ${attachmentsHtml ? `<div><span class="text-slate-400 text-xs">المرفقات:</span><div class="mt-1 space-y-1">${attachmentsHtml}</div></div>` : ''}
                        ${item.last_error ? `<div><span class="text-slate-400 text-xs">آخر خطأ:</span><div class="mt-1 p-3 bg-red-50 rounded-lg text-sm text-red-600">${_esc(item.last_error)}</div></div>` : ''}
                        ${retryHtml ? `<div><span class="text-slate-400 text-xs">سجل المحاولات:</span><div class="mt-2 space-y-1">${retryHtml}</div></div>` : ''}
                        <div>
                            <span class="text-slate-400 text-xs">Idempotency Key:</span>
                            <div class="mt-1 text-xs text-slate-400 font-mono break-all">${_esc(item.idempotency_key || '—')}</div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        } catch (err) {
            window.showToast?.(err.message || 'فشل في جلب التفاصيل', 'error');
        }
    };

    function _init() {
        _loadStatus();
        _loadQueue();

        document.getElementById('wa-refresh-btn')?.addEventListener('click', () => {
            _loadStatus();
            _loadQueue();
        });

        document.getElementById('wa-queue-filter')?.addEventListener('change', (e) => {
            _currentFilter = e.target.value;
            _loadQueue();
        });

        document.getElementById('wa-start-session-btn')?.addEventListener('click', async () => {
            try {
                await window.apiFetch('/api/notifications/whatsapp/start-session', { method: 'POST' });
                window.showToast?.('تم إرسال طلب بدء الجلسة', 'success');
                setTimeout(_loadStatus, 2000);
            } catch (err) {
                window.showToast?.(err.message || 'فشل في بدء الجلسة', 'error');
            }
        });

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
