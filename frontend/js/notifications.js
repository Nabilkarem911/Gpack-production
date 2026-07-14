'use strict';

(function () {

    let _alerts = [];
    let _readAlerts = [];
    let _isOpen = false;
    let _pollTimer = null;
    const STORAGE_KEY = 'gpack_notif_read';

    const TYPE_ICONS = {
        pending_order:    { icon: 'fa-clock',           color: 'text-amber-500' },
        pending_receiving:{ icon: 'fa-truck-ramp-box',  color: 'text-blue-500' },
        low_stock:        { icon: 'fa-triangle-exclamation', color: 'text-orange-500' },
        out_of_stock:     { icon: 'fa-box-open',        color: 'text-red-500' },
        churn:            { icon: 'fa-user-slash',      color: 'text-rose-500' },
        task:             { icon: 'fa-list-check',      color: 'text-purple-500' }
    };

    const TYPE_ROUTES = {
        pending_order:     'production_orders',
        pending_receiving: 'receiving-vouchers',
        low_stock:         'inventory',
        out_of_stock:      'inventory',
        churn:             'forecast',
        task:              'tasks'
    };

    const TYPE_LABELS = {
        pending_order:     'طلب معلق',
        pending_receiving: 'بانتظار الاستلام',
        low_stock:         'مخزون منخفض',
        out_of_stock:      'نفاد المخزون',
        churn:             'عميل متقاعس',
        task:              'مهمة'
    };

    function _el(id) { return document.getElementById(id); }

    function _alertKey(a) {
        return a.type + ':' + (a.order_id || a.mo_id || a.stock_id || a.task_id || a.title || '');
    }

    function _loadReadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            _readAlerts = raw ? JSON.parse(raw) : [];
        } catch (e) { _readAlerts = []; }
    }

    function _saveReadState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_readAlerts.slice(0, 50)));
        } catch (e) {}
    }

    function _isRead(a) {
        return _readAlerts.some(r => r.key === _alertKey(a));
    }

    function _markRead(a) {
        const key = _alertKey(a);
        if (_readAlerts.some(r => r.key === key)) return;
        _readAlerts.unshift({ key, title: a.title, message: a.message, type: a.type, severity: a.severity, readAt: new Date().toISOString() });
        _readAlerts = _readAlerts.slice(0, 50);
        _saveReadState();
    }

    function _clearAllRead() {
        _readAlerts = [];
        _saveReadState();
    }

    async function loadAlerts() {
        try {
            const res = await window.apiFetch('/api/dashboard/alerts');
            const all = Array.isArray(res) ? res : (res.data || []);
            _alerts = all.filter(a => !_isRead(a));
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

        const unreadCount = _alerts.length;

        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }

        let html = '';

        if (unreadCount > 0) {
            html += _alerts.map(a => _renderItem(a, false)).join('');
        } else {
            html += '<div class="notif-empty"><i class="fa-solid fa-check-circle text-emerald-400 text-2xl mb-2 block"></i>لا توجد إشعارات جديدة</div>';
        }

        if (_readAlerts.length > 0) {
            html += '<div class="px-4 py-2 border-t border-slate-100 bg-slate-50/50"><span class="text-xs font-bold text-slate-400">الإشعارات السابقة</span></div>';
            html += _readAlerts.slice(0, 15).map(r => _renderItem(r, true)).join('');
        }

        body.innerHTML = html;
    }

    function _renderItem(a, isRead) {
        const cfg = TYPE_ICONS[a.type] || { icon: 'fa-bell', color: 'text-slate-400' };
        const route = TYPE_ROUTES[a.type] || '';
        const label = TYPE_LABELS[a.type] || 'تنبيه';
        const opacity = isRead ? 'opacity-50' : '';
        const onClickAttr = !isRead && route ? `onclick="window.notifClick('${route}', '${_alertKey(a)}')"` : '';

        return `
            <div class="notif-item ${opacity}" ${onClickAttr}>
                <div class="notif-dot ${a.severity || 'info'}"></div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 mb-0.5">
                        <i class="fa-solid ${cfg.icon} ${cfg.color} text-xs"></i>
                        <span class="text-[10px] font-bold text-slate-400 uppercase">${label}</span>
                        ${isRead ? '<i class="fa-solid fa-check text-[9px] text-emerald-400 mr-auto"></i>' : ''}
                    </div>
                    <p class="text-sm font-bold text-slate-800 truncate">${_esc(a.title || '')}</p>
                    <p class="text-xs text-slate-500 mt-0.5 line-clamp-2">${_esc(a.message || '')}</p>
                </div>
            </div>
        `;
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

    window.notifClick = function (route, key) {
        const alert = _alerts.find(a => _alertKey(a) === key);
        if (alert) {
            _markRead(alert);
            _alerts = _alerts.filter(a => _alertKey(a) !== key);
            _render();
        }
        _closePanel();
        if (window.navigateTo) window.navigateTo(route);
    };

    window.notifMarkAllRead = function () {
        _alerts.forEach(a => _markRead(a));
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
        _loadReadState();
        loadAlerts();
        _startPolling();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
