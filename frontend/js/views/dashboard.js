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
            this._loadActivities(),
            this._loadChartData(),
            this._loadPendingPricing()
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
                    <button onclick="dashboardView._openTasksListModal()" 
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
                     onclick="dashboardView._openTaskModal('${task.id}')">
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
    // Open Tasks List Modal (shows all tasks in popup)
    // ─────────────────────────────────────────────────────────────────────────
    _openTasksListModal() {
        const modal = document.getElementById('dash-tasks-list-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        this._renderTasksListModal();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Close Tasks List Modal
    // ─────────────────────────────────────────────────────────────────────────
    _closeTasksListModal() {
        const modal = document.getElementById('dash-tasks-list-modal');
        if (modal) modal.classList.add('hidden');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Tasks List Modal
    // ─────────────────────────────────────────────────────────────────────────
    _renderTasksListModal() {
        const container = document.getElementById('dash-tasks-list-container');
        if (!container) return;

        if (this.tasks.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 text-slate-400">
                    <i class="fa-solid fa-clipboard-check text-3xl mb-2 text-emerald-400"></i>
                    <p class="text-sm">لا توجد مهام حالياً</p>
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

        container.innerHTML = sortedTasks.map(task => {
            const isOverdue = this._isOverdue(task);
            const isPending = task.status === 'pending';
            const progress = task.total_subtasks ? Math.round((task.completed_subtasks || 0) / task.total_subtasks * 100) : 0;
            const isCompleted = task.status === 'completed';

            const bgClass = isOverdue ? 'bg-red-50 border-red-200' :
                           isCompleted ? 'bg-emerald-50 border-emerald-200' :
                           'bg-white border-slate-200 hover:border-brand-300';

            const statusBadge = isCompleted ?
                '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-600 text-xs rounded font-medium">مكتملة</span>' :
                isOverdue ?
                '<span class="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded font-medium">متأخرة</span>' :
                '<span class="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs rounded font-medium">قيد التنفيذ</span>';

            return `
                <div class="p-4 rounded-xl border ${bgClass} transition-all cursor-pointer hover:shadow-md group"
                     onclick="dashboardView._openTaskModal('${task.id}'); dashboardView._closeTasksListModal();">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 mb-1 flex-wrap">
                                <p class="text-sm font-bold text-slate-800 group-hover:text-brand-600">${task.title}</p>
                                ${statusBadge}
                                ${task.priority === 'high' ? '<span class="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs rounded">عاجل</span>' : ''}
                            </div>
                            <p class="text-xs text-slate-500 mb-2 line-clamp-2">${task.description || 'لا يوجد وصف'}</p>
                            <div class="flex items-center gap-4 text-xs text-slate-500">
                                <span><i class="fa-regular fa-calendar mr-1"></i>${task.due_date || '—'}</span>
                                <span><i class="fa-solid fa-user mr-1"></i>${task.assigned_to_name || 'غير محدد'}</span>
                                ${task.total_subtasks ? `<span class="text-brand-600 font-medium">${task.completed_subtasks || 0}/${task.total_subtasks} تم</span>` : ''}
                            </div>
                            ${task.total_subtasks ? `
                                <div class="mt-2 w-full bg-slate-100 rounded-full h-2">
                                    <div class="${isCompleted ? 'bg-emerald-500' : 'bg-brand-500'} h-2 rounded-full transition-all" style="width: ${progress}%"></div>
                                </div>
                            ` : ''}
                        </div>
                        <div class="flex-shrink-0 pt-1">
                            <i class="fa-solid fa-chevron-left text-slate-300 group-hover:text-brand-500 transition-colors"></i>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Open Task Modal (on dashboard)
    // ─────────────────────────────────────────────────────────────────────────
    async _openTaskModal(taskId) {
        const modal = document.getElementById('dash-task-modal');
        if (!modal) return;
        
        // Show modal with loading state
        modal.classList.remove('hidden');
        document.getElementById('dash-modal-title').textContent = 'جارٍ التحميل...';
        
        try {
            const response = await apiFetch(`/api/tasks/${taskId}`);
            const task = response.task;
            if (!task) {
                showToast('المهمة غير موجودة', 'error');
                this._closeTaskModal();
                return;
            }
            
            this.currentModalTask = task;
            
            // Fill in details
            document.getElementById('dash-modal-title').textContent = task.title;
            document.getElementById('dash-modal-desc').textContent = task.description || 'لا يوجد وصف';
            document.getElementById('dash-modal-assignee').textContent = task.assigned_to_name || 'غير محدد';
            document.getElementById('dash-modal-due').textContent = task.due_date || '—';
            document.getElementById('dash-modal-created').textContent = new Date(task.created_at).toLocaleDateString('ar-SA');
            
            // Priority
            const priorityLabels = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };
            const priorityEl = document.getElementById('dash-modal-priority');
            priorityEl.textContent = priorityLabels[task.priority] || 'متوسطة';
            priorityEl.className = `font-medium ${task.priority === 'high' ? 'text-red-600' : task.priority === 'medium' ? 'text-orange-600' : 'text-slate-500'}`;
            
            // Status badge
            const statusEl = document.getElementById('dash-modal-status');
            if (task.status === 'completed') {
                statusEl.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700';
                statusEl.textContent = 'مكتملة';
            } else if (this._isOverdue(task)) {
                statusEl.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700';
                statusEl.textContent = 'متأخرة';
            } else {
                statusEl.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700';
                statusEl.textContent = 'قيد التنفيذ';
            }
            
            // Subtasks
            this._renderModalSubtasks(task.subtasks || []);
            
            // Comments
            this._renderModalComments(task.comments || []);
            
        } catch (error) {
            console.error('[Dashboard] Failed to load task details:', error);
            showToast('فشل تحميل تفاصيل المهمة', 'error');
            this._closeTaskModal();
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Close Task Modal
    // ─────────────────────────────────────────────────────────────────────────
    _closeTaskModal() {
        const modal = document.getElementById('dash-task-modal');
        if (modal) modal.classList.add('hidden');
        this.currentModalTask = null;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Modal Subtasks
    // ─────────────────────────────────────────────────────────────────────────
    _renderModalSubtasks(subtasks) {
        const container = document.getElementById('dash-modal-subtasks');
        const saveBtn = document.getElementById('dash-modal-save-btn');
        const completeBtn = document.getElementById('dash-modal-complete-btn');
        
        if (!container) return;
        
        if (saveBtn) saveBtn.classList.add('hidden');
        if (completeBtn) completeBtn.classList.add('hidden');
        
        if (subtasks.length === 0) {
            container.innerHTML = '<p class="text-sm text-slate-400 text-center py-4">لا توجد مهام فرعية</p>';
            return;
        }
        
        container.innerHTML = subtasks.map((st, idx) => `
            <div class="flex items-center gap-3 p-2 rounded-lg ${st.is_completed ? 'bg-slate-50' : 'bg-white border border-slate-100'}">
                <input type="checkbox" ${st.is_completed ? 'checked' : ''} 
                       onchange="dashboardView._toggleModalSubtask(${idx})"
                       class="w-4 h-4 text-brand-600 rounded cursor-pointer">
                <span class="text-sm ${st.is_completed ? 'line-through text-slate-400' : 'text-slate-700'}">${st.title}</span>
            </div>
        `).join('');
        
        // Show complete button if all done
        const allDone = subtasks.every(st => st.is_completed);
        if (allDone && this.currentModalTask && this.currentModalTask.status !== 'completed') {
            if (completeBtn) completeBtn.classList.remove('hidden');
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Toggle Modal Subtask
    // ─────────────────────────────────────────────────────────────────────────
    _toggleModalSubtask(idx) {
        if (!this.currentModalTask) return;
        const st = this.currentModalTask.subtasks[idx];
        st.is_completed = !st.is_completed;
        st._changed = true;
        this._renderModalSubtasks(this.currentModalTask.subtasks);
        
        const saveBtn = document.getElementById('dash-modal-save-btn');
        if (saveBtn) saveBtn.classList.remove('hidden');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Save Modal Subtasks
    // ─────────────────────────────────────────────────────────────────────────
    async _saveModalSubtasks() {
        if (!this.currentModalTask) return;
        
        const changed = this.currentModalTask.subtasks.filter(st => st._changed);
        if (changed.length === 0) return;
        
        const btn = document.getElementById('dash-modal-save-btn-el');
        const original = btn?.innerHTML || 'حفظ';
        if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        
        try {
            for (const st of changed) {
                await apiFetch(`/api/tasks/${this.currentModalTask.id}/subtasks/${st.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ is_completed: st.is_completed })
                });
                delete st._changed;
            }
            showToast('تم الحفظ', 'success');
            
            // Check if all completed
            const allDone = this.currentModalTask.subtasks.every(st => st.is_completed);
            const completeBtn = document.getElementById('dash-modal-complete-btn');
            if (allDone && this.currentModalTask.status !== 'completed') {
                if (completeBtn) completeBtn.classList.remove('hidden');
            }
            
            // Refresh dashboard tasks
            await this._loadTasks();
            
            const saveBtn = document.getElementById('dash-modal-save-btn');
            if (saveBtn) saveBtn.classList.add('hidden');
            
        } catch (error) {
            console.error('[Dashboard] Save subtasks error:', error);
            showToast('فشل الحفظ', 'error');
        } finally {
            if (btn) btn.innerHTML = original;
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Complete Modal Task
    // ─────────────────────────────────────────────────────────────────────────
    async _completeModalTask() {
        if (!this.currentModalTask) return;
        
        try {
            await apiFetch(`/api/tasks/${this.currentModalTask.id}`, {
                method: 'PUT',
                body: JSON.stringify({ status: 'completed' })
            });
            showToast('تم إنجاز المهمة', 'success');
            await this._loadTasks();
            this._closeTaskModal();
        } catch (error) {
            console.error('[Dashboard] Complete task error:', error);
            showToast('فشل الإنجاز', 'error');
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Modal Comments
    // ─────────────────────────────────────────────────────────────────────────
    _renderModalComments(comments) {
        const container = document.getElementById('dash-modal-comments');
        if (!container) return;
        
        if (comments.length === 0) {
            container.innerHTML = '<p class="text-sm text-slate-400 text-center py-4">لا توجد رسائل. ابدأ المحادثة...</p>';
            return;
        }
        
        container.innerHTML = comments.map(c => `
            <div class="flex gap-3 ${c.user_id === window.GpackUser?.id ? 'flex-row-reverse' : ''}">
                <div class="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-xs font-bold flex-shrink-0">
                    ${c.user_name?.charAt(0).toUpperCase() || '?'}
                </div>
                <div class="${c.user_id === window.GpackUser?.id ? 'bg-brand-500 text-white' : 'bg-white border border-slate-100 text-slate-700'} rounded-2xl px-4 py-2 max-w-[80%]">
                    <p class="text-xs font-medium mb-1 ${c.user_id === window.GpackUser?.id ? 'text-brand-100' : 'text-slate-500'}">${c.user_name || 'غير معروف'}</p>
                    <p class="text-sm">${c.comment}</p>
                    <p class="text-xs mt-1 opacity-70">${new Date(c.created_at).toLocaleString('ar-SA')}</p>
                </div>
            </div>
        `).join('');
        
        container.scrollTop = container.scrollHeight;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Add Modal Comment
    // ─────────────────────────────────────────────────────────────────────────
    async _addModalComment() {
        const input = document.getElementById('dash-modal-comment-input');
        const comment = input?.value?.trim();
        if (!comment || !this.currentModalTask) return;
        
        try {
            await apiFetch(`/api/tasks/${this.currentModalTask.id}/comments`, {
                method: 'POST',
                body: JSON.stringify({ comment })
            });
            input.value = '';
            // Refresh task details
            await this._openTaskModal(this.currentModalTask.id);
            showToast('تم إرسال الرسالة', 'success');
        } catch (error) {
            console.error('[Dashboard] Add comment error:', error);
            showToast('فشل الإرسال', 'error');
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Load Pending Pricing (quotations with zero prices)
    // ─────────────────────────────────────────────────────────────────────────
    async _loadPendingPricing() {
        try {
            // Only load for admin/manager/super_admin
            const user = window.GpackUser;
            const allowedRoles = ['admin', 'manager', 'super_admin'];
            if (!user || !allowedRoles.includes(user.role)) {
                return;
            }
            const response = await apiFetch('/api/dashboard/pending-pricing');
            this.pendingPricing = response.data || [];
            this._renderPricingAlertBanner();
        } catch (error) {
            console.error('[Dashboard] Failed to load pending pricing:', error);
            this.pendingPricing = [];
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Pricing Alert Banner
    // ─────────────────────────────────────────────────────────────────────────
    _renderPricingAlertBanner() {
        const container = document.getElementById('pricing-alert-banner');
        if (!container) return;

        const count = this.pendingPricing.length;
        if (count === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <div class="bg-red-500 rounded-2xl p-4 mb-6 text-white shadow-lg shadow-red-200">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                            <i class="fa-solid fa-tags text-xl"></i>
                        </div>
                        <div>
                            <h4 class="font-bold text-lg">${count} عرض سعر بحاجة تسعير</h4>
                            <p class="text-white/80 text-sm">أصناف بسعر غير محدد تحتاج مراجعة المدير</p>
                        </div>
                    </div>
                    <button onclick="dashboardView._openPricingListModal()" 
                            class="px-4 py-2 bg-white text-slate-800 rounded-lg font-medium hover:bg-slate-100 transition-colors">
                        تسعير الآن
                    </button>
                </div>
            </div>
        `;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Open Pricing List Modal
    // ─────────────────────────────────────────────────────────────────────────
    _openPricingListModal() {
        const modal = document.getElementById('dash-pricing-list-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        this._renderPricingListModal();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Close Pricing List Modal
    // ─────────────────────────────────────────────────────────────────────────
    _closePricingListModal() {
        const modal = document.getElementById('dash-pricing-list-modal');
        if (modal) modal.classList.add('hidden');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Pricing List Modal
    // ─────────────────────────────────────────────────────────────────────────
    _renderPricingListModal() {
        const container = document.getElementById('dash-pricing-list-container');
        if (!container) return;

        if (this.pendingPricing.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 text-slate-400">
                    <i class="fa-solid fa-check-circle text-3xl mb-2 text-emerald-400"></i>
                    <p class="text-sm">لا توجد عروض أسعار بحاجة تسعير</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.pendingPricing.map(quote => {
            const hasUnpriced = quote.unpriced_items > 0;
            return `
                <div class="p-4 rounded-xl border ${hasUnpriced ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'} transition-all cursor-pointer hover:shadow-md group"
                     onclick="dashboardView._openPricingDetailModal('${quote.id}')">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 mb-1 flex-wrap">
                                <p class="text-sm font-bold text-slate-800 group-hover:text-brand-600">
                                    عرض سعر #${quote.order_number}
                                </p>
                                <span class="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs rounded">في انتظار التسعير</span>
                                ${hasUnpriced ? `<span class="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded font-bold">${quote.unpriced_items} صنف بدون سعر</span>` : ''}
                            </div>
                            <p class="text-xs text-slate-500 mb-1">
                                <span class="ml-3"><i class="fa-solid fa-user mr-1"></i>${quote.client_name || 'غير محدد'}</span>
                                <span class="ml-3"><i class="fa-solid fa-calendar mr-1"></i>${quote.order_date || '—'}</span>
                                <span><i class="fa-solid fa-box mr-1"></i>${quote.total_items} صنف</span>
                            </p>
                            ${quote.internal_notes ? `<p class="text-xs text-slate-400 truncate mt-1">${quote.internal_notes}</p>` : ''}
                        </div>
                        <div class="flex-shrink-0 pt-1">
                            <i class="fa-solid fa-chevron-left text-slate-300 group-hover:text-brand-500 transition-colors"></i>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Open Pricing Detail Modal
    // ─────────────────────────────────────────────────────────────────────────
    async _openPricingDetailModal(quoteId) {
        const modal = document.getElementById('dash-pricing-detail-modal');
        if (!modal) return;
        modal.classList.remove('hidden');

        // Clear previous
        document.getElementById('pricing-detail-items').innerHTML = '<tr><td colspan="5" class="py-4 text-center text-slate-400 text-xs">جارٍ التحميل...</td></tr>';
        document.getElementById('pricing-detail-notes').value = '';

        try {
            const response = await apiFetch(`/api/dashboard/pending-pricing/${quoteId}`);
            this.currentPricingQuote = response.data;
            this._renderPricingDetail();
        } catch (error) {
            console.error('[Dashboard] Failed to load pricing detail:', error);
            showToast('فشل تحميل تفاصيل عرض السعر', 'error');
            this._closePricingDetailModal();
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Close Pricing Detail Modal
    // ─────────────────────────────────────────────────────────────────────────
    _closePricingDetailModal() {
        const modal = document.getElementById('dash-pricing-detail-modal');
        if (modal) modal.classList.add('hidden');
        this.currentPricingQuote = null;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Pricing Detail
    // ─────────────────────────────────────────────────────────────────────────
    _renderPricingDetail() {
        const quote = this.currentPricingQuote;
        if (!quote) return;

        document.getElementById('pricing-detail-number').textContent = '#' + quote.order_number;
        document.getElementById('pricing-detail-client').textContent = quote.client_name || 'غير محدد';
        document.getElementById('pricing-detail-date').textContent = quote.order_date ? new Date(quote.order_date).toLocaleDateString('ar-SA') : '—';
        document.getElementById('pricing-detail-rep').textContent = quote.created_by_name || 'غير محدد';
        document.getElementById('pricing-detail-notes').value = quote.pricing_notes || quote.internal_notes || '';

        const tbody = document.getElementById('pricing-detail-items');
        tbody.innerHTML = quote.items.map(item => {
            const isUnpriced = !item.unit_price || item.unit_price === 0;
            const lineTotal = parseFloat(item.quantity || 0) * parseFloat(item.unit_price || 0) * (1 - (parseFloat(item.discount_percent || 0) / 100));

            return `
                <tr class="${isUnpriced ? 'bg-red-50' : ''}" data-item-id="${item.id}">
                    <td class="py-2 px-3 text-slate-700">
                        <div class="font-medium text-sm">${item.product_name}</div>
                        <div class="text-xs text-slate-400">${item.variant_size || ''} ${item.sku ? '• ' + item.sku : ''}</div>
                        <button onclick="dashboardView._showPriceHistory('${item.variant_id}', '${item.product_name.replace(/'/g, "\\'")}')"
                                class="mt-1 text-[10px] text-brand-500 hover:text-brand-700 flex items-center gap-1 font-medium"
                                title="عرض تاريخ أسعار العميل لهذا المنتج">
                            <i class="fa-solid fa-clock-rotate-left"></i> تاريخ الأسعار
                        </button>
                    </td>
                    <td class="py-2 px-3 text-slate-700 text-center">${item.quantity}</td>
                    <td class="py-2 px-3">
                        <input type="number" step="0.01" min="0"
                               value="${item.unit_price || ''}"
                               onchange="dashboardView._updatePricingLineTotal(this, '${item.id}')"
                               class="w-24 px-2 py-1 border border-slate-200 rounded-lg text-sm text-center focus:outline-none focus:border-brand-500 ${isUnpriced ? 'border-red-300 bg-red-50' : ''}"
                               placeholder="0.00">
                    </td>
                    <td class="py-2 px-3 text-center text-slate-500">${item.discount_percent || 0}%</td>
                    <td class="py-2 px-3 text-slate-700 font-medium text-right pricing-line-total" data-qty="${item.quantity}" data-discount="${item.discount_percent || 0}">
                        ${lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                </tr>
            `;
        }).join('');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Update Pricing Line Total (when price input changes)
    // ─────────────────────────────────────────────────────────────────────────
    _updatePricingLineTotal(input, itemId) {
        const row = input.closest('tr');
        const qty = parseFloat(row.querySelector('.pricing-line-total').dataset.qty) || 0;
        const discount = parseFloat(row.querySelector('.pricing-line-total').dataset.discount) || 0;
        const price = parseFloat(input.value) || 0;
        const total = qty * price * (1 - discount / 100);

        row.querySelector('.pricing-line-total').textContent = total.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        // Remove red styling if price is set
        if (price > 0) {
            row.classList.remove('bg-red-50');
            input.classList.remove('border-red-300', 'bg-red-50');
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Save Pricing (manager submits prices)
    // ─────────────────────────────────────────────────────────────────────────
    async _savePricing() {
        if (!this.currentPricingQuote) return;

        const rows = document.querySelectorAll('#pricing-detail-items tr');
        const items = [];
        let hasEmptyPrice = false;

        rows.forEach(row => {
            const itemId = row.dataset.itemId;
            const input = row.querySelector('input[type="number"]');
            const price = parseFloat(input?.value) || 0;
            if (price <= 0) hasEmptyPrice = true;
            items.push({ id: itemId, unit_price: price });
        });

        if (hasEmptyPrice) {
            if (!confirm('هناك أصناف بدون سعر. هل تريد المتابعة؟')) return;
        }

        const notes = document.getElementById('pricing-detail-notes')?.value?.trim();

        const btn = document.querySelector('#dash-pricing-detail-modal button[onclick="dashboardView._savePricing()"]');
        const originalText = btn?.innerHTML || 'حفظ الأسعار';
        if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> جاري الحفظ...';

        try {
            await apiFetch(`/api/dashboard/pending-pricing/${this.currentPricingQuote.id}`, {
                method: 'PUT',
                body: JSON.stringify({ items, pricing_notes: notes })
            });

            showToast('تم حفظ الأسعار بنجاح', 'success');

            // Refresh
            await this._loadPendingPricing();
            this._closePricingDetailModal();
            this._closePricingListModal();

        } catch (error) {
            console.error('[Dashboard] Save pricing error:', error);
            showToast('فشل حفظ الأسعار', 'error');
        } finally {
            if (btn) btn.innerHTML = originalText;
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Price History Popup
    // ─────────────────────────────────────────────────────────────────────────
    async _showPriceHistory(variantId, productName) {
        const popup = document.getElementById('dash-price-history-popup');
        const content = document.getElementById('price-history-content');
        const title = document.getElementById('price-history-title');
        if (!popup || !content) return;

        title.textContent = `تاريخ أسعار: ${productName}`;
        popup.classList.remove('hidden');
        content.innerHTML = '<div class="text-center py-8 text-slate-400 text-sm"><i class="fa-solid fa-circle-notch fa-spin mr-1"></i> جارٍ التحميل...</div>';

        try {
            const clientId = this.currentPricingQuote?.client_id;
            if (!clientId) {
                content.innerHTML = '<div class="text-center py-8 text-red-400 text-sm">معرف العميل غير متوفر</div>';
                return;
            }
            const response = await apiFetch(`/api/orders/price-history?client_id=${clientId}&variant_id=${variantId}`);
            const history = response.history || [];
            this._renderPriceHistory(history, productName);
        } catch (error) {
            console.error('[Dashboard] Price history error:', error);
            content.innerHTML = '<div class="text-center py-8 text-red-400 text-sm">فشل تحميل تاريخ الأسعار</div>';
        }
    },

    _closePriceHistoryPopup() {
        const popup = document.getElementById('dash-price-history-popup');
        if (popup) popup.classList.add('hidden');
    },

    _renderPriceHistory(history, productName) {
        const content = document.getElementById('price-history-content');
        if (!content) return;

        if (history.length === 0) {
            content.innerHTML = '<div class="text-center py-8 text-slate-400 text-sm">لا يوجد سجل أسعار سابق لهذا المنتج</div>';
            return;
        }

        const statusBadge = (status) => {
            const colors = {
                quote: 'bg-slate-100 text-slate-600',
                pending: 'bg-amber-100 text-amber-700',
                confirmed: 'bg-emerald-100 text-emerald-700',
                production: 'bg-blue-100 text-blue-700',
                completed: 'bg-purple-100 text-purple-700',
                cancelled: 'bg-red-100 text-red-600'
            };
            const labels = {
                quote: 'عرض سعر', pending: 'معلق', confirmed: 'مؤكد',
                production: 'إنتاج', completed: 'منتهي', cancelled: 'ملغي'
            };
            return `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${colors[status] || colors.quote}">${labels[status] || status}</span>`;
        };

        content.innerHTML = `
            <table class="w-full text-sm">
                <thead>
                    <tr class="border-b border-slate-200 bg-slate-50">
                        <th class="text-right py-2 px-2 font-semibold text-slate-600 text-xs">رقم الطلب</th>
                        <th class="text-right py-2 px-2 font-semibold text-slate-600 text-xs">التاريخ</th>
                        <th class="text-right py-2 px-2 font-semibold text-slate-600 text-xs">السعر</th>
                        <th class="text-right py-2 px-2 font-semibold text-slate-600 text-xs">الكمية</th>
                        <th class="text-right py-2 px-2 font-semibold text-slate-600 text-xs">الحالة</th>
                        <th class="text-center py-2 px-2 font-semibold text-slate-600 text-xs"></th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    ${history.map(row => `
                        <tr class="hover:bg-slate-50 cursor-pointer group" onclick="dashboardView._viewOrderDetail('${row.id}')">
                            <td class="py-2 px-2 text-slate-700 font-medium">
                                #${row.order_number}
                                ${row.pricing_notes ? `<i class="fa-solid fa-note-sticky text-amber-400 text-[10px] ml-1" title="${row.pricing_notes.replace(/"/g, '&quot;')}"></i>` : ''}
                            </td>
                            <td class="py-2 px-2 text-slate-500 text-xs">${row.order_date ? new Date(row.order_date).toLocaleDateString('ar-SA') : '—'}</td>
                            <td class="py-2 px-2 text-brand-600 font-bold">${parseFloat(row.unit_price || 0).toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                            <td class="py-2 px-2 text-slate-600 text-center">${row.quantity}</td>
                            <td class="py-2 px-2">${statusBadge(row.status)}</td>
                            <td class="py-2 px-2 text-center">
                                <i class="fa-solid fa-chevron-left text-slate-300 text-xs group-hover:text-brand-500 transition-colors"></i>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <p class="text-[10px] text-slate-400 mt-3 text-center">اضغط على أي صف لفتح تفاصيل الطلب</p>
        `;
    },

    _viewOrderDetail(orderId) {
        // Open a small summary popup instead of navigating away
        this._openOrderDetailPopup(orderId);
    },

    async _openOrderDetailPopup(orderId) {
        const popup = document.getElementById('dash-order-detail-popup');
        const content = document.getElementById('order-detail-content');
        if (!popup || !content) return;

        popup.classList.remove('hidden');
        content.innerHTML = '<div class="text-center py-8 text-slate-400 text-sm"><i class="fa-solid fa-circle-notch fa-spin mr-1"></i> جارٍ التحميل...</div>';

        try {
            const response = await apiFetch(`/api/orders/${orderId}/details`);
            const order = response.order;
            const items = response.items || [];
            this._renderOrderDetail(order, items);
        } catch (error) {
            console.error('[Dashboard] Order detail error:', error);
            content.innerHTML = '<div class="text-center py-8 text-red-400 text-sm">فشل تحميل تفاصيل الطلب</div>';
        }
    },

    _closeOrderDetailPopup() {
        const popup = document.getElementById('dash-order-detail-popup');
        if (popup) popup.classList.add('hidden');
    },

    _renderOrderDetail(order, items) {
        const content = document.getElementById('order-detail-content');
        if (!content) return;

        const statusColors = {
            quote: 'bg-slate-100 text-slate-600',
            pending: 'bg-amber-100 text-amber-700',
            confirmed: 'bg-emerald-100 text-emerald-700',
            production: 'bg-blue-100 text-blue-700',
            processing: 'bg-blue-100 text-blue-700',
            completed: 'bg-purple-100 text-purple-700',
            cancelled: 'bg-red-100 text-red-600'
        };
        const statusLabels = {
            quote: 'عرض سعر', pending: 'معلق', confirmed: 'مؤكد',
            production: 'إنتاج', processing: 'إنتاج', completed: 'منتهي', cancelled: 'ملغي'
        };

        const statusClass = statusColors[order.status] || statusColors.quote;
        const statusLabel = statusLabels[order.status] || order.status;

        content.innerHTML = `
            <div class="bg-slate-50 rounded-xl p-3 text-sm space-y-1">
                <div class="flex justify-between items-center">
                    <span class="text-slate-500">رقم الطلب:</span>
                    <span class="font-bold text-slate-800">#${order.order_number}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-slate-500">العميل:</span>
                    <span class="font-medium text-slate-700">${order.client_name || '—'}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-slate-500">التاريخ:</span>
                    <span class="text-slate-600">${order.order_date ? new Date(order.order_date).toLocaleDateString('ar-SA') : '—'}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-slate-500">الحالة:</span>
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${statusClass}">${statusLabel}</span>
                </div>
            </div>

            <div>
                <p class="text-xs font-semibold text-slate-500 mb-2">الأصناف (${items.length}):</p>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr class="border-b border-slate-200 bg-slate-50">
                                <th class="text-right py-1.5 px-2 font-semibold text-slate-600 text-[10px]">الصنف</th>
                                <th class="text-center py-1.5 px-2 font-semibold text-slate-600 text-[10px]">الكمية</th>
                                <th class="text-center py-1.5 px-2 font-semibold text-slate-600 text-[10px]">السعر</th>
                                <th class="text-center py-1.5 px-2 font-semibold text-slate-600 text-[10px]">الخصم</th>
                                <th class="text-right py-1.5 px-2 font-semibold text-slate-600 text-[10px]">الإجمالي</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${items.map(item => `
                                <tr>
                                    <td class="py-1.5 px-2 text-slate-700 text-xs">
                                        <div class="font-medium">${item.product_name}</div>
                                        <div class="text-[10px] text-slate-400">${item.size_name || ''}</div>
                                    </td>
                                    <td class="py-1.5 px-2 text-center text-slate-600 text-xs">${item.quantity}</td>
                                    <td class="py-1.5 px-2 text-center text-brand-600 font-bold text-xs">${parseFloat(item.unit_price || 0).toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                                    <td class="py-1.5 px-2 text-center text-slate-500 text-xs">${item.discount_percent || 0}%</td>
                                    <td class="py-1.5 px-2 text-right text-slate-700 font-medium text-xs">${parseFloat(item.line_total || 0).toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="flex justify-between items-center border-t border-slate-100 pt-3">
                <span class="text-sm font-bold text-slate-700">إجمالي الطلب:</span>
                <span class="text-lg font-bold text-brand-600">${parseFloat(order.grand_total || 0).toLocaleString('en-US', {minimumFractionDigits:2})}</span>
            </div>
        `;
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
    // Load Chart Data from API
    // ─────────────────────────────────────────────────────────────────────────
    async _loadChartData() {
        try {
            const response = await apiFetch('/api/dashboard/chart-data');
            const data = response.data || {};
            this._renderTopProducts(data.top_products || []);
            this._renderRevenueChart(data.monthly_sales || []);
        } catch (error) {
            console.error('[Dashboard] Failed to load chart data:', error);
            this._renderTopProducts([]);
            this._renderRevenueChart([]);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Top Products Widget
    // ─────────────────────────────────────────────────────────────────────────
    _renderTopProducts(products) {
        const container = document.getElementById('top-products-list');
        if (!container) return;

        if (products.length === 0) {
            container.innerHTML = `
                <div class="text-center py-6 text-slate-400 text-xs">
                    لا توجد بيانات مبيعات
                </div>
            `;
            return;
        }

        const maxQty = Math.max(...products.map(p => p.total_quantity));

        container.innerHTML = products.map((product, index) => {
            const percentage = maxQty > 0 ? (product.total_quantity / maxQty) * 100 : 0;
            const rankColors = ['text-amber-500', 'text-slate-400', 'text-orange-400'];
            const rankIcon = index < 3 ? `<i class="fa-solid fa-crown ${rankColors[index]}"></i>` : `<span class="text-slate-300 text-xs w-4 text-center">${index + 1}</span>`;

            return `
                <div class="flex items-center gap-3">
                    <div class="w-6 flex-shrink-0 text-center">${rankIcon}</div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between mb-1">
                            <p class="text-sm font-medium text-slate-700 truncate">${product.product_name}</p>
                            <p class="text-xs font-bold text-slate-600">${product.total_quantity} <span class="text-slate-400 font-normal">قطعة</span></p>
                        </div>
                        <div class="w-full bg-slate-100 rounded-full h-2">
                            <div class="bg-brand-500 h-2 rounded-full transition-all duration-500" style="width: ${percentage}%"></div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Revenue Bar Chart (CSS-only)
    // ─────────────────────────────────────────────────────────────────────────
    _renderRevenueChart(monthlySales) {
        const container = document.getElementById('revenue-chart-container');
        const labelsContainer = document.getElementById('revenue-chart-labels');
        if (!container || !labelsContainer) return;

        if (monthlySales.length === 0) {
            container.innerHTML = '<div class="text-center w-full text-slate-400 text-xs py-6">لا توجد بيانات</div>';
            labelsContainer.innerHTML = '';
            return;
        }

        const maxSales = Math.max(...monthlySales.map(m => m.total_sales));
        const barColors = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#c084fc', '#d8b4fe'];

        container.innerHTML = monthlySales.map((month, index) => {
            const height = maxSales > 0 ? (month.total_sales / maxSales) * 100 : 0;
            const color = barColors[index % barColors.length];
            const revenue = parseFloat(month.total_sales).toLocaleString('en-US');

            return `
                <div class="flex-1 flex flex-col items-center justify-end group relative" style="height: 100%">
                    <div class="absolute -top-8 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
                        ${revenue} ر.س
                    </div>
                    <div class="w-full max-w-[40px] rounded-t-lg transition-all duration-700 hover:brightness-110" style="height: ${Math.max(height, 5)}%; background-color: ${color};"></div>
                </div>
            `;
        }).join('');

        labelsContainer.innerHTML = monthlySales.map(m => `
            <span class="flex-1 text-center">${m.month || ''}</span>
        `).join('');
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
