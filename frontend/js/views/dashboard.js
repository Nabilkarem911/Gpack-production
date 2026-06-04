'use strict';

// =============================================================================
// G.PACK 2.0 — Dashboard View
// Loads real-time statistics and displays them on the dashboard
// =============================================================================

const dashboardView = {
    tasks: [],
    users: [],
    
    // ─────────────────────────────────────────────────────────────────────────
    // Initialize Dashboard
    // ─────────────────────────────────────────────────────────────────────────
    async _init() {
        console.log('[Dashboard] Initializing view...');
        await Promise.all([
            this._loadDashboardStats(),
            this._loadTasks(),
            this._loadAlerts(),
            this._loadRecentOrders(),
            this._loadActivities()
        ]);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Load Dashboard Statistics from API
    // ─────────────────────────────────────────────────────────────────────────
    async _loadDashboardStats() {
        try {
            const response = await apiFetch('/api/dashboard/stats');
            const data = response.data || {};
            
            // Update KPI Cards
            this._updateStat('stat-quotations', data.quotations_count || 0);
            this._updateStat('stat-orders', data.orders_count || 0);
            this._updateStat('stat-revenue', this._formatCurrency(data.total_revenue || 0));
            this._updateStat('stat-receivables', this._formatCurrency(data.outstanding_receivables || 0));
            
            console.log('[Dashboard] Stats loaded successfully');
        } catch (error) {
            console.error('[Dashboard] Failed to load stats:', error);
            // Try to load basic counts from other endpoints
            await this._loadFallbackStats();
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Fallback Stats (when dashboard API fails)
    // ─────────────────────────────────────────────────────────────────────────
    async _loadFallbackStats() {
        try {
            // Load counts from individual endpoints
            const [quotations, orders] = await Promise.all([
                apiFetch('/api/orders?status=quote&limit=1').catch(() => ({ total: 0 })),
                apiFetch('/api/orders?limit=1').catch(() => ({ total: 0 }))
            ]);
            
            this._updateStat('stat-quotations', quotations.total || 0);
            this._updateStat('stat-orders', orders.total || 0);
        } catch (e) {
            console.log('[Dashboard] Fallback stats also failed');
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Load Tasks for Dashboard Widget
    // ─────────────────────────────────────────────────────────────────────────
    async _loadTasks() {
        try {
            // Load real tasks from API
            const response = await apiFetch('/api/tasks?limit=5&status=pending');
            this.tasks = response.tasks || response.data || [];
            
            // Render tasks and alert banner
            this._renderDashboardTasks();
            this._updateTaskStats();
            this._renderTaskAlertBanner();
        } catch (error) {
            console.error('[Dashboard] Failed to load tasks:', error);
            this.tasks = [];
            this._renderDashboardTasks();
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Task Alert Banner (prominent notification)
    // ─────────────────────────────────────────────────────────────────────────
    _renderTaskAlertBanner() {
        const container = document.getElementById('task-alert-banner');
        if (!container) return;
        
        const pendingTasks = this.tasks.filter(t => t.status === 'pending');
        const overdueTasks = pendingTasks.filter(t => this._isOverdue(t));
        
        if (pendingTasks.length === 0) {
            container.innerHTML = ''; // Hide if no tasks
            return;
        }
        
        const urgentClass = overdueTasks.length > 0 ? 'bg-red-500' : 'bg-brand-500';
        const icon = overdueTasks.length > 0 ? 'fa-exclamation-circle' : 'fa-tasks';
        const message = overdueTasks.length > 0 
            ? `لديك ${overdueTasks.length} مهمة متأخرة!`
            : `لديك ${pendingTasks.length} مهمة قيد التنفيذ`;
        
        container.innerHTML = `
            <div class="${urgentClass} text-white rounded-xl p-4 mb-4 shadow-lg animate-pulse">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                            <i class="fa-solid ${icon} text-xl"></i>
                        </div>
                        <div>
                            <h4 class="font-bold text-lg">${message}</h4>
                            <p class="text-white/80 text-sm">اضغط على المهمة للتفاصيل والإنجاز</p>
                        </div>
                    </div>
                    <button onclick="window.navigateTo('tasks')" 
                            class="px-4 py-2 bg-white text-slate-800 rounded-lg font-medium hover:bg-slate-100 transition-colors">
                        عرض المهام
                    </button>
                </div>
            </div>
        `;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Load Users
    // ─────────────────────────────────────────────────────────────────────────
    async _loadUsers() {
        try {
            const response = await apiFetch('/api/users');
            this.users = response.users || [];
        } catch (error) {
            console.log('[Dashboard] Could not load users');
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Check if Task is Overdue
    // ─────────────────────────────────────────────────────────────────────────
    _isOverdue(task) {
        if (task.status === 'completed') return false;
        const due = new Date(task.due_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return due < today;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Dashboard Tasks Widget
    // ─────────────────────────────────────────────────────────────────────────
    _renderDashboardTasks() {
        const container = document.getElementById('dashboard-tasks-list');
        if (!container) return;

        if (this.tasks.length === 0) {
            container.innerHTML = `
                <div class="text-center py-6 text-slate-400">
                    <i class="fa-solid fa-clipboard-check text-3xl mb-2 text-emerald-400"></i>
                    <p class="text-sm">لا توجد مهام حالياً</p>
                    <p class="text-xs text-slate-300 mt-1">سيتم إشعارك عند وجود مهام جديدة</p>
                </div>
            `;
            return;
        }

        // Sort: overdue first, then pending, then by due date
        const sortedTasks = [...this.tasks].sort((a, b) => {
            const aOverdue = this._isOverdue(a);
            const bOverdue = this._isOverdue(b);
            if (aOverdue && !bOverdue) return -1;
            if (!aOverdue && bOverdue) return 1;
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (a.status !== 'pending' && b.status === 'pending') return 1;
            return new Date(a.due_date) - new Date(b.due_date);
        });

        container.innerHTML = sortedTasks.slice(0, 5).map(task => {
            const isOverdue = this._isOverdue(task);
            const isPending = task.status === 'pending';
            const progress = task.total_subtasks ? Math.round((task.completed_subtasks || 0) / task.total_subtasks * 100) : 0;
            
            const bgClass = isOverdue ? 'bg-red-50 border-red-200' : 
                           isPending ? 'bg-white border-slate-200 hover:border-brand-300' : 
                           'bg-slate-50 border-slate-100';
            
            return `
                <div class="p-3 rounded-xl border ${bgClass} transition-all cursor-pointer group hover:shadow-md"
                     onclick="dashboardView._openTaskDirect('${task.id}')">
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                                <p class="text-sm font-semibold text-slate-700 truncate group-hover:text-brand-600">${task.title}</p>
                                ${isOverdue ? '<span class="px-1.5 py-0.5 bg-red-100 text-red-600 text-xs rounded font-medium">متأخر</span>' : ''}
                                ${task.priority === 'high' && !isOverdue ? '<span class="px-1.5 py-0.5 bg-orange-100 text-orange-600 text-xs rounded">عاجل</span>' : ''}
                            </div>
                            <p class="text-xs text-slate-500 mt-1 flex items-center gap-2">
                                <span><i class="fa-regular fa-calendar mr-1"></i>${task.due_date}</span>
                                ${task.total_subtasks ? `<span class="text-brand-600">${task.completed_subtasks || 0}/${task.total_subtasks} تم</span>` : ''}
                            </p>
                            ${task.total_subtasks ? `
                                <div class="mt-2 w-full bg-slate-100 rounded-full h-1.5">
                                    <div class="bg-brand-500 h-1.5 rounded-full transition-all" style="width: ${progress}%"></div>
                                </div>
                            ` : ''}
                        </div>
                        <div class="flex flex-col items-center">
                            ${isPending && task.priority === 'high' ? 
                                `<span class="w-2 h-2 rounded-full bg-red-500 animate-pulse mb-1"></span>` : ''}
                            <i class="fa-solid ${isPending ? 'fa-circle text-slate-300' : 'fa-check-circle text-emerald-500'}"></i>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Open Task Directly (from dashboard click)
    // ─────────────────────────────────────────────────────────────────────────
    _openTaskDirect(taskId) {
        // Store selected task ID
        sessionStorage.setItem('selectedTaskId', taskId);
        // Navigate to tasks page
        window.navigateTo('tasks');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Load Alerts from API
    // ─────────────────────────────────────────────────────────────────────────
    async _loadAlerts() {
        try {
            const response = await apiFetch('/api/dashboard/alerts');
            const alerts = response.data || [];
            this._renderAlerts(alerts);
        } catch (error) {
            console.error('[Dashboard] Failed to load alerts:', error);
            this._renderAlerts([]);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Alerts Widget
    // ─────────────────────────────────────────────────────────────────────────
    _renderAlerts(alerts) {
        const container = document.getElementById('dashboard-alerts-list');
        const countBadge = document.getElementById('alerts-count');
        if (!container) return;

        if (countBadge) countBadge.textContent = alerts.length;

        if (alerts.length === 0) {
            container.innerHTML = `
                <div class="text-center py-6 text-slate-400">
                    <i class="fa-solid fa-check-circle text-3xl mb-2 text-emerald-400"></i>
                    <p class="text-sm">لا توجد تنبيهات</p>
                    <p class="text-xs text-slate-300 mt-1">كل شيء على ما يرام</p>
                </div>
            `;
            return;
        }

        container.innerHTML = alerts.slice(0, 5).map(alert => {
            const severityClass = alert.severity === 'critical' ? 'bg-red-50 border-red-100 text-red-700' :
                                   alert.severity === 'warning' ? 'bg-amber-50 border-amber-100 text-amber-700' :
                                   'bg-blue-50 border-blue-100 text-blue-700';
            const icon = alert.severity === 'critical' ? 'fa-circle-exclamation' :
                          alert.severity === 'warning' ? 'fa-triangle-exclamation' : 'fa-info-circle';

            return `
                <div class="p-3 rounded-xl border ${severityClass} flex items-start gap-3">
                    <i class="fa-solid ${icon} mt-0.5 flex-shrink-0"></i>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-semibold truncate">${alert.title}</p>
                        <p class="text-xs opacity-80">${alert.message}</p>
                    </div>
                </div>
            `;
        }).join('');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Load Recent Orders from API
    // ─────────────────────────────────────────────────────────────────────────
    async _loadRecentOrders() {
        try {
            const response = await apiFetch('/api/dashboard/recent-orders?limit=5');
            const orders = response.data || [];
            this._renderRecentOrders(orders);
        } catch (error) {
            console.error('[Dashboard] Failed to load recent orders:', error);
            this._renderRecentOrders([]);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Recent Orders Table
    // ─────────────────────────────────────────────────────────────────────────
    _renderRecentOrders(orders) {
        const container = document.getElementById('recent-orders-table');
        if (!container) return;

        if (orders.length === 0) {
            container.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-slate-400 text-xs">لا توجد طلبات</td></tr>';
            return;
        }

        const statusMap = {
            'pending': { label: 'معلق', class: 'bg-amber-100 text-amber-700' },
            'confirmed': { label: 'مؤكد', class: 'bg-blue-100 text-blue-700' },
            'processing': { label: 'قيد التصنيع', class: 'bg-purple-100 text-purple-700' },
            'ready': { label: 'جاهز', class: 'bg-cyan-100 text-cyan-700' },
            'delivered': { label: 'تم التسليم', class: 'bg-emerald-100 text-emerald-700' },
            'completed': { label: 'مكتمل', class: 'bg-emerald-100 text-emerald-700' },
            'cancelled': { label: 'ملغي', class: 'bg-red-100 text-red-700' },
            'quote': { label: 'عرض سعر', class: 'bg-slate-100 text-slate-600' }
        };

        container.innerHTML = orders.map(order => {
            const status = statusMap[order.status] || { label: order.status, class: 'bg-slate-100 text-slate-600' };
            return `
                <tr class="hover:bg-slate-50 transition-colors cursor-pointer" onclick="window.navigateTo('orders')">
                    <td class="py-3 font-mono font-bold text-brand-600">#${order.order_number || order.id?.slice(-4) || '---'}</td>
                    <td class="py-3 text-slate-700 font-medium">${order.client_name || 'غير محدد'}</td>
                    <td class="py-3">
                        <span class="px-2.5 py-1 rounded-full text-xs font-semibold ${status.class}">${status.label}</span>
                    </td>
                    <td class="py-3 font-semibold text-slate-800">${order.total_amount ? parseFloat(order.total_amount).toLocaleString('en-US') + ' ر.س' : '—'}</td>
                    <td class="py-3 text-slate-500 text-xs">${order.created_at ? new Date(order.created_at).toLocaleDateString('ar-SA') : '—'}</td>
                </tr>
            `;
        }).join('');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Load Activities from API
    // ─────────────────────────────────────────────────────────────────────────
    async _loadActivities() {
        try {
            const response = await apiFetch('/api/dashboard/activities?limit=5');
            const activities = response.data || [];
            this._renderActivities(activities);
        } catch (error) {
            console.error('[Dashboard] Failed to load activities:', error);
            this._renderActivities([]);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Activity Feed
    // ─────────────────────────────────────────────────────────────────────────
    _renderActivities(activities) {
        const container = document.getElementById('dashboard-activity-list');
        if (!container) return;

        if (activities.length === 0) {
            container.innerHTML = `
                <div class="text-center py-4 text-slate-400 text-xs">
                    لا توجد نشاطات حديثة
                </div>
            `;
            return;
        }

        const actionLabels = {
            'in': 'إضافة مخزون',
            'out': 'صرف مخزون',
            'transfer': 'تحويل مخزون',
            'adjustment': 'تسوية مخزون'
        };

        container.innerHTML = activities.map(activity => {
            const actionLabel = actionLabels[activity.action] || activity.action;
            const timeAgo = activity.created_at ? this._timeAgo(new Date(activity.created_at)) : '';
            return `
                <div class="flex items-start gap-3 p-2 hover:bg-slate-50 rounded-lg transition-colors">
                    <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                        <i class="fa-solid fa-box text-slate-500 text-xs"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm text-slate-700 font-medium">${actionLabel}</p>
                        <p class="text-xs text-slate-500 truncate">${activity.description || ''} ${activity.warehouse ? '(' + activity.warehouse + ')' : ''}</p>
                        <p class="text-xs text-slate-400 mt-0.5">${timeAgo}</p>
                    </div>
                </div>
            `;
        }).join('');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Time Ago Helper
    // ─────────────────────────────────────────────────────────────────────────
    _timeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        if (seconds < 60) return 'منذ لحظات';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `منذ ${minutes} دقيقة`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `منذ ${hours} ساعة`;
        const days = Math.floor(hours / 24);
        return `منذ ${days} يوم`;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Update Task Stats in Dashboard
    // ─────────────────────────────────────────────────────────────────────────
    _updateTaskStats() {
        const pending = this.tasks.filter(t => t.status === 'pending' && !this._isOverdue(t)).length;
        const completed = this.tasks.filter(t => t.status === 'completed').length;
        const overdue = this.tasks.filter(t => this._isOverdue(t)).length;

        const pendingEl = document.getElementById('dash-tasks-pending');
        const completedEl = document.getElementById('dash-tasks-completed');
        const overdueEl = document.getElementById('dash-tasks-overdue');

        if (pendingEl) pendingEl.textContent = pending;
        if (completedEl) completedEl.textContent = completed;
        if (overdueEl) overdueEl.textContent = overdue;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Update a Stat Element
    // ─────────────────────────────────────────────────────────────────────────
    _updateStat(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = value;
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Format Currency (Arabic locale)
    // ─────────────────────────────────────────────────────────────────────────
    _formatCurrency(amount) {
        const num = parseFloat(amount || 0);
        
        // Format large numbers
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'م'; // Million
        } else if (num >= 1000) {
            return (num / 1000).toFixed(0) + 'K'; // Thousand
        }

        return num.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        });
    }
};

// Export for use in app.js routing
window.dashboardView = dashboardView;
