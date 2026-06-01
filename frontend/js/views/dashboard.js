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
            this._loadTasks()
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
            // First load users for name mapping
            await this._loadUsers();
            
            // TODO: Replace with actual API when ready
            // const response = await apiFetch('/api/tasks?limit=5');
            // this.tasks = response.tasks || [];
            
            // For now, use same sample data as tasks view
            this.tasks = this._getSampleTasks();
            
            this._renderDashboardTasks();
            this._updateTaskStats();
        } catch (error) {
            console.error('[Dashboard] Failed to load tasks:', error);
        }
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
    // Sample Tasks Data (Temporary)
    // ─────────────────────────────────────────────────────────────────────────
    _getSampleTasks() {
        const today = new Date();
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        
        return [
            {
                id: '1',
                title: 'تجهيز طلب شركة النور',
                description: 'تجهيز 500 كيس تغليف',
                assigned_to: this.users[0]?.id || '1',
                due_date: today.toISOString().split('T')[0],
                status: 'pending',
                priority: 'high',
                created_at: today.toISOString()
            },
            {
                id: '2',
                title: 'صيانة الطابعة الرئيسية',
                description: 'الفحوصات الدورية',
                assigned_to: this.users[1]?.id || '2',
                due_date: today.toISOString().split('T')[0],
                status: 'completed',
                priority: 'medium',
                created_at: yesterday.toISOString()
            },
            {
                id: '3',
                title: 'جرد المخزن الشهري',
                description: 'الجرد الكامل',
                assigned_to: this.users[2]?.id || '3',
                due_date: yesterday.toISOString().split('T')[0],
                status: 'pending',
                priority: 'high',
                created_at: yesterday.toISOString()
            },
            {
                id: '4',
                title: 'تحديث بيانات العملاء',
                description: '15 عميل',
                assigned_to: this.users[0]?.id || '1',
                due_date: tomorrow.toISOString().split('T')[0],
                status: 'pending',
                priority: 'low',
                created_at: today.toISOString()
            }
        ];
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Get User Name
    // ─────────────────────────────────────────────────────────────────────────
    _getUserName(id) {
        const user = this.users.find(u => u.id === id);
        return user ? user.name.split(' ')[0] : 'غير محدد';
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
            container.innerHTML = '<p class="text-center text-slate-400 text-sm py-4">لا توجد مهام</p>';
            return;
        }

        // Show today's and upcoming tasks
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const relevantTasks = this.tasks
            .filter(t => {
                const due = new Date(t.due_date);
                // Show: overdue, today, or tomorrow
                return t.status !== 'completed' || this._isOverdue(t);
            })
            .slice(0, 5); // Show max 5

        if (relevantTasks.length === 0) {
            container.innerHTML = '<p class="text-center text-slate-400 text-sm py-4">لا توجد مهام مستحقة</p>';
            return;
        }

        container.innerHTML = relevantTasks.map(task => {
            const isOverdue = this._isOverdue(task);
            const isToday = task.due_date === today.toISOString().split('T')[0];
            
            let statusClass = 'bg-slate-50 border-slate-100';
            let statusIcon = '<i class="fa-solid fa-circle text-slate-300 text-xs"></i>';
            let dateText = task.due_date;
            
            if (isOverdue) {
                statusClass = 'bg-red-50 border-red-100';
                statusIcon = '<i class="fa-solid fa-exclamation text-red-500 text-xs"></i>';
                dateText = 'متأخر';
            } else if (isToday) {
                statusClass = 'bg-orange-50 border-orange-100';
                statusIcon = '<i class="fa-solid fa-clock text-orange-500 text-xs"></i>';
                dateText = 'اليوم';
            }

            const priorityIcon = task.priority === 'high' ? '<i class="fa-solid fa-flag text-red-400 text-xs mr-1"></i>' : '';

            return `
                <div class="flex items-center gap-2 p-2 rounded-lg border ${statusClass} cursor-pointer hover:shadow-sm transition-all"
                     onclick="window.navigateTo('tasks')">
                    ${statusIcon}
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-slate-800 truncate">${priorityIcon}${task.title}</p>
                        <p class="text-xs text-slate-500">${this._getUserName(task.assigned_to)} • ${dateText}</p>
                    </div>
                </div>
            `;
        }).join('');
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
