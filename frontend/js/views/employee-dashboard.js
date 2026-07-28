'use strict';

// =============================================================================
// G.PACK 2.0 — Employee Dashboard View Controller
// Simple dashboard for employees without dashboard permission.
// Shows: personal tasks, notifications, quick shortcuts.
// =============================================================================

var edView = {
    _allTasks: [],
    _taskFilter: 'all',
    _currentModalTask: null,

    // ─────────────────────────────────────────────────────────────────────────
    // Shortcut map: permission → { view, label, icon, color }
    // ─────────────────────────────────────────────────────────────────────────
    _SHORTCUTS: [
        { perm: 'designer',           view: 'designer',           label: 'المصمم',            icon: 'fa-pen-ruler',         color: 'bg-purple-50 text-purple-600' },
        { perm: 'quotations',         view: 'quotations',         label: 'عروض الأسعار',     icon: 'fa-file-lines',        color: 'bg-blue-50 text-blue-600' },
        { perm: 'production_orders',  view: 'production_orders',  label: 'أوامر التشغيل',    icon: 'fa-industry',          color: 'bg-amber-50 text-amber-600' },
        { perm: 'clients',            view: 'clients',            label: 'العملاء',          icon: 'fa-users',             color: 'bg-emerald-50 text-emerald-600' },
        { perm: 'sales',              view: 'sales-invoices',     label: 'فواتير المبيعات',  icon: 'fa-file-invoice-dollar', color: 'bg-teal-50 text-teal-600' },
        { perm: 'inventory',          view: 'inventory',          label: 'إدارة المخزون',    icon: 'fa-boxes-stacked',     color: 'bg-indigo-50 text-indigo-600' },
        { perm: 'warehouses',         view: 'warehouses',         label: 'المخازن',          icon: 'fa-warehouse',         color: 'bg-slate-50 text-slate-600' },
        { perm: 'receiving',          view: 'receiving-vouchers', label: 'سندات الاستلام',   icon: 'fa-clipboard-check',   color: 'bg-cyan-50 text-cyan-600' },
        { perm: 'vmi_dispatch',       view: 'vmi-dispatch',       label: 'سندات التسليم',    icon: 'fa-truck-fast',        color: 'bg-orange-50 text-orange-600' },
        { perm: 'suppliers',          view: 'suppliers',          label: 'الموردين',         icon: 'fa-truck',             color: 'bg-rose-50 text-rose-600' },
        { perm: 'purchasing',         view: 'purchase-invoices',  label: 'فواتير المشتريات', icon: 'fa-file-invoice',      color: 'bg-lime-50 text-lime-600' },
        { perm: 'tasks',              view: 'tasks',              label: 'المهام',           icon: 'fa-list-check',        color: 'bg-violet-50 text-violet-600' },
    ],

    // ─────────────────────────────────────────────────────────────────────────
    // Init
    // ─────────────────────────────────────────────────────────────────────────
    async _init() {
        console.log('[EmployeeDashboard] Initializing...');
        var _myToken = window.getCurrentNavToken ? window.getCurrentNavToken() : 0;

        // Greeting
        const userName = window.GpackUser?.name || 'موظف';
        const hour = new Date().getHours();
        let greeting = 'مرحباً';
        if (hour < 12) greeting = 'صباح الخير';
        else if (hour < 18) greeting = 'مساء الخير';
        else greeting = 'مساء الخير';

        const greetingEl = document.getElementById('ed-greeting');
        if (greetingEl) greetingEl.textContent = `${greeting}، ${userName} 👋`;

        const subtitleEl = document.getElementById('ed-subtitle');
        if (subtitleEl) {
            const role = window.GpackUser?.role || '';
            const roleMap = {
                'sales_rep': 'مندوب مبيعات',
                'warehouse': 'أمين مستودع',
                'warehouse_keeper': 'أمين مستودع',
                'designer': 'مصمم',
                'accountant': 'محاسب',
            };
            const roleLabel = roleMap[role] || role;
            if (roleLabel) subtitleEl.textContent = `${roleLabel} — هذه لوحة التحكم الخاصة بك`;
        }

        // Render shortcuts
        this._renderShortcuts();

        // Load data in parallel
        await Promise.all([
            this._loadTasks(),
            this._loadNotifications()
        ]);

        if (window.isViewActive && !window.isViewActive(_myToken)) return;
        console.log('[EmployeeDashboard] Loaded successfully');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Shortcuts
    // ─────────────────────────────────────────────────────────────────────────
    _renderShortcuts() {
        const container = document.getElementById('ed-shortcuts');
        if (!container) return;

        const html = this._SHORTCUTS
            .filter(s => window.hasPermission && window.hasPermission(s.perm))
            .map(s => `
                <button onclick="window.navigateTo('${s.view}')"
                    class="flex flex-col items-center gap-2 p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-md transition-all group cursor-pointer">
                    <div class="w-12 h-12 rounded-xl ${s.color} flex items-center justify-center group-hover:scale-110 transition-transform">
                        <i class="fa-solid ${s.icon} text-xl"></i>
                    </div>
                    <span class="text-xs font-bold text-slate-600 text-center">${s.label}</span>
                </button>
            `).join('');

        container.innerHTML = html || '<p class="text-sm text-slate-400 col-span-full text-center py-4">لا توجد صفحات متاحة لك</p>';
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Tasks
    // ─────────────────────────────────────────────────────────────────────────
    async _loadTasks() {
        try {
            const res = await window.apiFetch('/api/tasks?limit=50');
            this._allTasks = (res && res.tasks) ? res.tasks : (res && res.data) ? res.data : [];

            // Count summary
            const pending = this._allTasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
            const overdue = this._allTasks.filter(t => t.due_date && new Date(t.due_date) < new Date(new Date().toDateString()) && t.status !== 'completed');
            const today = this._allTasks.filter(t => t.due_date && new Date(t.due_date).toDateString() === new Date().toDateString());

            const elPending = document.getElementById('ed-tasks-pending');
            const elOverdue = document.getElementById('ed-tasks-overdue');
            const elToday = document.getElementById('ed-tasks-today');
            if (elPending) elPending.textContent = pending.length;
            if (elOverdue) elOverdue.textContent = overdue.length;
            if (elToday) elToday.textContent = today.length;

            this._renderTasks();
        } catch (err) {
            console.error('[EmployeeDashboard] Load tasks error:', err);
            const listEl = document.getElementById('ed-tasks-list');
            if (listEl) listEl.innerHTML = '<p class="py-8 text-center text-sm text-slate-400">تعذّر تحميل المهام</p>';
        }
    },

    _renderTasks() {
        const listEl = document.getElementById('ed-tasks-list');
        if (!listEl) return;

        let tasks = this._allTasks;
        if (this._taskFilter === 'pending') {
            tasks = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
        } else if (this._taskFilter === 'overdue') {
            tasks = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date(new Date().toDateString()) && t.status !== 'completed');
        }

        if (!tasks.length) {
            listEl.innerHTML = `
                <div class="py-12 text-center">
                    <i class="fa-solid fa-circle-check text-3xl text-emerald-300 mb-2"></i>
                    <p class="text-sm text-slate-400">لا توجد مهام ${this._taskFilter === 'overdue' ? 'متأخرة' : 'حالية'}</p>
                </div>`;
            return;
        }

        listEl.innerHTML = tasks.map(t => {
            const isOverdue = t.due_date && new Date(t.due_date) < new Date(new Date().toDateString()) && t.status !== 'completed';
            const isToday = t.due_date && new Date(t.due_date).toDateString() === new Date().toDateString();
            const priorityColors = { high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-slate-100 text-slate-600' };
            const priorityLabels = { high: 'عاجلة', medium: 'متوسطة', low: 'عادية' };
            const statusColors = { pending: 'bg-slate-100 text-slate-600', in_progress: 'bg-blue-100 text-blue-700', completed: 'bg-emerald-100 text-emerald-700' };
            const statusLabels = { pending: 'في الانتظار', in_progress: 'قيد التنفيذ', completed: 'مكتملة' };

            return `
                <div class="px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors" onclick="window.edView._openTaskModal(${t.id})">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex-1 min-w-0">
                            <p class="text-sm font-bold text-slate-700 truncate">${this._esc(t.title)}</p>
                            ${t.description ? `<p class="text-xs text-slate-400 mt-0.5 line-clamp-1">${this._esc(t.description)}</p>` : ''}
                            <div class="flex items-center gap-2 mt-2 flex-wrap">
                                <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${priorityColors[t.priority] || priorityColors.low}">${priorityLabels[t.priority] || 'عادية'}</span>
                                <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${statusColors[t.status] || statusColors.pending}">${statusLabels[t.status] || t.status}</span>
                                ${t.due_date ? `<span class="text-[10px] font-bold ${isOverdue ? 'text-red-600' : isToday ? 'text-amber-600' : 'text-slate-400'}"><i class="fa-solid fa-calendar-day ml-1"></i>${this._formatDate(t.due_date)}${isOverdue ? ' (متأخرة)' : isToday ? ' (اليوم)' : ''}</span>` : ''}
                            </div>
                        </div>
                        <i class="fa-solid fa-chevron-left text-slate-300 text-xs mt-1"></i>
                    </div>
                </div>`;
        }).join('');
    },

    _filterTasks(filter) {
        this._taskFilter = filter;
        this._renderTasks();

        // Update button styles
        const filters = ['all', 'pending', 'overdue'];
        filters.forEach(f => {
            const btn = document.getElementById('ed-filter-' + f);
            if (!btn) return;
            if (f === filter) {
                btn.className = 'px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 text-white';
            } else {
                btn.className = 'px-3 py-1 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200';
            }
        });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Task Modal
    // ─────────────────────────────────────────────────────────────────────────
    async _openTaskModal(taskId) {
        const modal = document.getElementById('ed-task-modal');
        const titleEl = document.getElementById('ed-modal-title');
        const bodyEl = document.getElementById('ed-modal-body');
        if (!modal || !bodyEl) return;

        modal.classList.remove('hidden');
        titleEl.textContent = 'جارٍ التحميل...';
        bodyEl.innerHTML = '<div class="py-8 text-center"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-slate-300"></i></div>';

        try {
            const res = await window.apiFetch(`/api/tasks/${taskId}`);
            const task = res.task;
            if (!task) {
                bodyEl.innerHTML = '<p class="text-center text-sm text-slate-400">المهمة غير موجودة</p>';
                return;
            }
            this._currentModalTask = task;
            titleEl.textContent = task.title;

            const subtasks = task.subtasks || [];
            const subtasksHtml = subtasks.length ? `
                <div>
                    <p class="text-xs font-bold text-slate-500 mb-2">المهام الفرعية</p>
                    <div class="space-y-1.5">
                        ${subtasks.map(st => `
                            <label class="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                                <input type="checkbox" ${st.is_completed ? 'checked' : ''} onchange="window.edView._toggleSubtask(${st.id}, this.checked)"
                                    class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" />
                                <span class="text-sm ${st.is_completed ? 'line-through text-slate-400' : 'text-slate-700'}">${this._esc(st.title)}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            ` : '';

            const priorityLabels = { high: 'عاجلة', medium: 'متوسطة', low: 'عادية' };
            const statusLabels = { pending: 'في الانتظار', in_progress: 'قيد التنفيذ', completed: 'مكتملة' };

            bodyEl.innerHTML = `
                ${task.description ? `<p class="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">${this._esc(task.description)}</p>` : ''}
                <div class="grid grid-cols-2 gap-3 text-sm">
                    <div><span class="text-slate-400">الأولوية:</span> <span class="font-bold text-slate-700">${priorityLabels[task.priority] || 'عادية'}</span></div>
                    <div><span class="text-slate-400">الحالة:</span> <span class="font-bold text-slate-700">${statusLabels[task.status] || task.status}</span></div>
                    ${task.due_date ? `<div><span class="text-slate-400">تاريخ الاستحقاق:</span> <span class="font-bold text-slate-700">${this._formatDate(task.due_date)}</span></div>` : ''}
                    ${task.assigned_to_name ? `<div><span class="text-slate-400">مسندة إلى:</span> <span class="font-bold text-slate-700">${this._esc(task.assigned_to_name)}</span></div>` : ''}
                </div>
                ${subtasksHtml}
                ${task.status !== 'completed' ? `
                    <button onclick="window.edView._completeTask()" class="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold transition-colors">
                        <i class="fa-solid fa-check ml-1"></i> إنجاز المهمة
                    </button>
                ` : ''}
            `;
        } catch (err) {
            bodyEl.innerHTML = '<p class="text-center text-sm text-red-400">تعذّر تحميل تفاصيل المهمة</p>';
        }
    },

    _closeTaskModal() {
        const modal = document.getElementById('ed-task-modal');
        if (modal) modal.classList.add('hidden');
        this._currentModalTask = null;
    },

    async _toggleSubtask(subtaskId, isCompleted) {
        if (!this._currentModalTask) return;
        try {
            await window.apiFetch(`/api/tasks/${this._currentModalTask.id}/subtasks/${subtaskId}`, {
                method: 'PUT',
                body: { is_completed: isCompleted }
            });
            // Update local state
            const st = (this._currentModalTask.subtasks || []).find(s => s.id === subtaskId);
            if (st) st.is_completed = isCompleted;
        } catch (err) {
            window.showToast('فشل تحديث المهمة الفرعية', 'error');
        }
    },

    async _completeTask() {
        if (!this._currentModalTask) return;
        try {
            await window.apiFetch(`/api/tasks/${this._currentModalTask.id}`, {
                method: 'PUT',
                body: { status: 'completed' }
            });
            window.showToast('تم إنجاز المهمة', 'success');
            this._closeTaskModal();
            await this._loadTasks();
        } catch (err) {
            window.showToast(err.message || 'فشل إنجاز المهمة', 'error');
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Notifications
    // ─────────────────────────────────────────────────────────────────────────
    async _loadNotifications() {
        try {
            const res = await window.apiFetch('/api/notifications?limit=20');
            const notifications = (res && res.data) ? res.data : (res && res.notifications) ? res.notifications : [];

            const listEl = document.getElementById('ed-notifications-list');
            const badgeEl = document.getElementById('ed-notif-badge');
            if (!listEl) return;

            const unread = notifications.filter(n => !n.is_read);
            if (badgeEl) {
                if (unread.length > 0) {
                    badgeEl.textContent = unread.length;
                    badgeEl.classList.remove('hidden');
                } else {
                    badgeEl.classList.add('hidden');
                }
            }

            if (!notifications.length) {
                listEl.innerHTML = `
                    <div class="py-12 text-center">
                        <i class="fa-solid fa-bell-slash text-3xl text-slate-300 mb-2"></i>
                        <p class="text-sm text-slate-400">لا توجد إشعارات</p>
                    </div>`;
                return;
            }

            const typeIcons = {
                info: 'fa-circle-info text-blue-500',
                warning: 'fa-triangle-exclamation text-amber-500',
                error: 'fa-circle-xmark text-red-500',
                success: 'fa-circle-check text-emerald-500',
            };

            listEl.innerHTML = notifications.map(n => {
                const icon = typeIcons[n.type] || typeIcons.info;
                return `
                    <div class="px-4 py-3 hover:bg-slate-50 transition-colors ${!n.is_read ? 'bg-blue-50/30' : ''}">
                        <div class="flex items-start gap-2">
                            <i class="fa-solid ${icon} text-sm mt-0.5"></i>
                            <div class="flex-1 min-w-0">
                                <p class="text-sm font-bold text-slate-700 truncate">${this._esc(n.title || '')}</p>
                                ${n.message ? `<p class="text-xs text-slate-400 mt-0.5 line-clamp-2">${this._esc(n.message)}</p>` : ''}
                                <p class="text-[10px] text-slate-300 mt-1">${this._timeAgo(n.created_at)}</p>
                            </div>
                        </div>
                    </div>`;
            }).join('');
        } catch (err) {
            console.error('[EmployeeDashboard] Load notifications error:', err);
            const listEl = document.getElementById('ed-notifications-list');
            if (listEl) listEl.innerHTML = '<p class="py-8 text-center text-sm text-slate-400">تعذّر تحميل الإشعارات</p>';
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────
    _esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    _formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
    },

    _timeAgo(dateStr) {
        if (!dateStr) return '';
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'الآن';
        if (mins < 60) return `منذ ${mins} دقيقة`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `منذ ${hours} ساعة`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `منذ ${days} يوم`;
        return this._formatDate(dateStr);
    },
};

window.edView = edView;
