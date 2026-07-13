'use strict';

(function () {

    let _alerts = [];
    let _isOpen = false;
    let _pollTimer = null;

    const TYPE_ICONS = {
        pending_order:    { icon: 'fa-clock',           color: 'text-amber-500' },
        pending_receiving:{ icon: 'fa-truck-ramp-box',  color: 'text-blue-500' },
        low_stock:        { icon: 'fa-triangle-exclamation', color: 'text-orange-500' },
        out_of_stock:     { icon: 'fa-box-open',        color: 'text-red-500' },
        churn:            { icon: 'fa-user-slash',      color: 'text-rose-500' }
    };

    const TYPE_ROUTES = {
        pending_order:     'production-orders',
        pending_receiving: 'receiving-vouchers',
        low_stock:         'inventory',
        out_of_stock:      'inventory',
        churn:             'forecast'
    };

    const TYPE_LABELS = {
        pending_order:     'طلب معلق',
        pending_receiving: 'بانتظار الاستلام',
        low_stock:         'مخزون منخفض',
        out_of_stock:      'نفاد المخزون',
        churn:             'عميل متقاعس'
    };

    function _el(id) { return document.getElementById(id); }

    async function loadAlerts() {
        try {
            const res = await window.apiFetch('/api/dashboard/alerts');
            _alerts = Array.isArray(res) ? res : (res.data || []);
            _render();
        } catch (e) {
            console.error('[Notifications] Failed to load alerts:', e);
            _alerts = [];
            _render();
        }
    }

    function _render() {
        const body = _el('notif-body');
        const badge = _el('notif-badge');
        if (!body) return;

        if (!_alerts.length) {
            body.innerHTML = '<div class="notif-empty"><i class="fa-solid fa-check-circle text-emerald-400 text-2xl mb-2 block"></i>لا توجد إشعارات حالياً</div>';
            if (badge) { badge.classList.add('hidden'); badge.textContent = '0'; }
            return;
        }

        if (badge) {
            badge.textContent = _alerts.length > 99 ? '99+' : String(_alerts.length);
            badge.classList.remove('hidden');
        }

        body.innerHTML = _alerts.map(a => {
            const cfg = TYPE_ICONS[a.type] || { icon: 'fa-bell', color: 'text-slate-400' };
            const route = TYPE_ROUTES[a.type] || '';
            const label = TYPE_LABELS[a.type] || 'تنبيه';
            const onClickAttr = route ? `onclick="window.notifNavigate('${route}')"` : '';

            return `
                <div class="notif-item" ${onClickAttr}>
                    <div class="notif-dot ${a.severity || 'info'}"></div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-1.5 mb-0.5">
                            <i class="fa-solid ${cfg.icon} ${cfg.color} text-xs"></i>
                            <span class="text-[10px] font-bold text-slate-400 uppercase">${label}</span>
                        </div>
                        <p class="text-sm font-bold text-slate-800 truncate">${_esc(a.title || '')}</p>
                        <p class="text-xs text-slate-500 mt-0.5 line-clamp-2">${_esc(a.message || '')}</p>
                    </div>
                </div>
            `;
        }).join('');
    }

    function _esc(str) {
        return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    window.notifToggle = function (e) {
        if (e) e.stopPropagation();
        const panel = _el('notif-panel');
        if (!panel) return;
        _isOpen = !_isOpen;
        if (_isOpen) {
            panel.classList.add('open');
            loadAlerts();
        } else {
            panel.classList.remove('open');
        }
    };

    window.notifNavigate = function (route) {
        _closePanel();
        if (window.navigateTo) window.navigateTo(route);
    };

    window.notifMarkAllRead = function () {
        _alerts = [];
        _render();
    };

    function _closePanel() {
        _isOpen = false;
        const panel = _el('notif-panel');
        if (panel) panel.classList.remove('open');
    }

    document.addEventListener('click', function (e) {
        if (!_isOpen) return;
        const panel = _el('notif-panel');
        const bell = _el('notif-bell');
        if (panel && !panel.contains(e.target) && bell && !bell.contains(e.target)) {
            _closePanel();
        }
    });

    function _startPolling() {
        _pollTimer = setInterval(() => {
            if (!_isOpen) loadAlerts();
        }, 60000);
    }

    function init() {
        loadAlerts();
        _startPolling();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
