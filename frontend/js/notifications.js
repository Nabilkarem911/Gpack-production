'use strict';

(function () {

    let _alerts = [];
    let _readAlerts = [];
    let _dbNotifications = [];
    let _isOpen = false;
    let _pollTimer = null;
    const STORAGE_KEY = 'gpack_notif_read';

    const TYPE_ICONS = {
        pending_order:    { icon: 'fa-clock',           color: 'text-amber-500' },
        pending_receiving:{ icon: 'fa-truck-ramp-box',  color: 'text-blue-500' },
        low_stock:        { icon: 'fa-triangle-exclamation', color: 'text-orange-500' },
        out_of_stock:     { icon: 'fa-box-open',        color: 'text-red-500' },
        churn:            { icon: 'fa-user-slash',      color: 'text-rose-500' },
        task:             { icon: 'fa-list-check',      color: 'text-purple-500' },
        quote_approved:   { icon: 'fa-circle-check',    color: 'text-emerald-500' },
        quote_rejected:   { icon: 'fa-circle-xmark',    color: 'text-red-500' },
        design_assigned:  { icon: 'fa-pen-ruler',        color: 'text-blue-500' },
        design_completed: { icon: 'fa-check-circle',     color: 'text-green-500' },
        design_approved:  { icon: 'fa-check-double',     color: 'text-emerald-500' },
        design_revision:  { icon: 'fa-rotate-left',      color: 'text-orange-500' }
    };

    const TYPE_ROUTES = {
        pending_order:     'production_orders',
        pending_receiving: 'receiving-vouchers',
        low_stock:         'inventory',
        out_of_stock:      'inventory',
        churn:             'forecast',
        task:              'tasks',
        quote_approved:    'quotations',
        quote_rejected:    'quotations',
        design_assigned:   'designer',
        design_completed:  'quotations',
        design_approved:   'designer',
        design_revision:   'designer'
    };

    const TYPE_LABELS = {
        pending_order:     'طلب معلق',
        pending_receiving: 'بانتظار الاستلام',
        low_stock:         'مخزون منخفض',
        out_of_stock:      'نفاد المخزون',
        churn:             'عميل متقاعس',
        task:              'مهمة',
        quote_approved:    'موافقة على عرض',
        quote_rejected:    'رفض عرض سعر',
        design_assigned:   'طلب تصميم جديد',
        design_completed:  'تصميم مكتمل',
        design_approved:   'تصميم معتمد',
        design_revision:   'مطلوب تعديل تصميم'
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
            // Fetch dashboard alerts (legacy)
            const res = await window.apiFetch('/api/dashboard/alerts');
            const all = Array.isArray(res) ? res : (res.data || []);
            _alerts = all.filter(a => !_isRead(a));

            // Fetch DB-backed notifications (new system)
            try {
                const notifRes = await window.apiFetch('/api/notifications?limit=20');
                if (notifRes && notifRes.notifications) {
                    _dbNotifications = notifRes.notifications;
                }
            } catch (e2) {
                // Notifications endpoint may not be available yet
            }

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

        // Count unread from both systems
        const dbUnread = _dbNotifications.filter(n => !n.is_read).length;
        const unreadCount = _alerts.length + dbUnread;

        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }

        let html = '';

        // Render DB-backed notifications first (newest first)
        if (_dbNotifications.length > 0) {
            html += _dbNotifications.slice(0, 15).map(n => _renderDbNotification(n)).join('');
        }

        // Then legacy alerts
        if (_alerts.length > 0) {
            if (_dbNotifications.length > 0) {
                html += '<div class="px-4 py-2 border-t border-slate-100 bg-slate-50/50"><span class="text-xs font-bold text-slate-400">تنبيهات النظام</span></div>';
            }
            html += _alerts.map(a => _renderItem(a, false)).join('');
        }

        if (unreadCount === 0 && _readAlerts.length === 0) {
            html = '<div class="notif-empty"><i class="fa-solid fa-check-circle text-emerald-400 text-2xl mb-2 block"></i>لا توجد إشعارات جديدة</div>';
        }

        if (_readAlerts.length > 0) {
            html += '<div class="px-4 py-2 border-t border-slate-100 bg-slate-50/50"><span class="text-xs font-bold text-slate-400">الإشعارات السابقة</span></div>';
            html += _readAlerts.slice(0, 10).map(r => _renderItem(r, true)).join('');
        }

        body.innerHTML = html;
    }

    function _renderDbNotification(n) {
        const icon = n.icon || 'fa-bell';
        const priorityColor = n.priority === 'high' ? 'border-r-amber-400' : n.priority === 'urgent' ? 'border-r-red-500' : 'border-r-brand-400';
        const opacity = n.is_read ? 'opacity-50' : '';
        const onClickAttr = !n.is_read && n.link ? `onclick="window.notifDbClick('${n.id}', '${n.link}')"` : (n.link ? `onclick="window.navigateTo('${n.link.replace(/^\//, '')}')"` : '');
        const time = new Date(n.created_at).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

        return `
            <div class="notif-item ${opacity} ${priorityColor}" ${onClickAttr}>
                <div class="notif-dot ${n.priority === 'high' ? 'warning' : 'info'}"></div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 mb-0.5">
                        <i class="fa-solid ${icon} text-xs text-slate-500"></i>
                        <span class="text-[10px] font-bold text-slate-400 uppercase">${_esc(n.category || '')}</span>
                        <span class="text-[10px] text-slate-300 mr-auto">${time}</span>
                    </div>
                    <p class="text-sm font-bold text-slate-800 truncate">${_esc(n.title || '')}</p>
                    ${n.body ? `<p class="text-xs text-slate-500 mt-0.5 line-clamp-2">${_esc(n.body)}</p>` : ''}
                </div>
            </div>
        `;
    }

    window.notifDbClick = async function(id, link) {
        try {
            await window.apiFetch(`/api/notifications/${id}/read`, { method: 'PUT' });
            _dbNotifications = _dbNotifications.map(n => n.id === id ? { ...n, is_read: true } : n);
            _render();
        } catch (e) { /* ignore */ }
        _closePanel();
        if (link && window.navigateTo) window.navigateTo(link.replace(/^\//, ''));
    };

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

    window.notifMarkAllRead = async function () {
        _alerts.forEach(a => _markRead(a));
        _alerts = [];
        // Mark DB notifications as read too
        try {
            await window.apiFetch('/api/notifications/read-all', { method: 'PUT' });
            _dbNotifications = _dbNotifications.map(n => ({ ...n, is_read: true }));
        } catch (e) { /* ignore */ }
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
