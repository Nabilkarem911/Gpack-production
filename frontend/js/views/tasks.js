'use strict';

// =============================================================================
// G.PACK 2.0 — Tasks Management View
// Handles CRUD operations for employee tasks with subtasks
// =============================================================================

var tasksView = {
    tasks: [],
    users: [],
    currentSubtasks: [],
    currentTask: null,
    filters: { status: '', priority: '', search: '' },

    // ─────────────────────────────────────────────────────────────────────────
    // Initialize
    // ─────────────────────────────────────────────────────────────────────────
    async _init() {
        console.log('[Tasks] Initializing view...');
        await this._loadUsers();
        await this._loadTasks();
        this._setupEventListeners();
        this._updateStats();
        
        // Check if coming from dashboard with selected task
        const selectedTaskId = sessionStorage.getItem('selectedTaskId');
        if (selectedTaskId) {
            sessionStorage.removeItem('selectedTaskId');
            setTimeout(() => {
                this._openTaskDetails(selectedTaskId);
            }, 300);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Load Users for Dropdown
    // ─────────────────────────────────────────────────────────────────────────
    async _loadUsers() {
        try {
            const response = await apiFetch('/api/users/list');
            this.users = response.data || response.users || [];
            this._populateUserDropdown();
        } catch (error) {
            console.error('[Tasks] Failed to load users:', error);
            showToast('فشل تحميل قائمة الموظفين', 'error');
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Load Tasks from API
    // ─────────────────────────────────────────────────────────────────────────
    async _loadTasks() {
        try {
            const grid = document.getElementById('tasks-grid');
            grid.innerHTML = `
                <div class="col-span-full text-center p-12 text-slate-400">
                    <i class="fa-solid fa-circle-notch fa-spin text-4xl mb-3 text-brand-400"></i>
                    <p>جارٍ تحميل المهام...</p>
                </div>`;

            // Build query params based on current filters
            const params = new URLSearchParams();
            if (this.filters.status && this.filters.status !== 'overdue') {
                params.append('status', this.filters.status);
            }
            if (this.filters.status === 'overdue') {
                params.append('overdue', 'true');
            }
            if (this.filters.priority) {
                params.append('priority', this.filters.priority);
            }
            params.append('limit', '100');

            const response = await apiFetch(`/api/tasks?${params.toString()}`);
            this.tasks = response.tasks || [];
            
            this._renderTasks();
            this._updateStats();
        } catch (error) {
            console.error('[Tasks] Failed to load tasks:', error);
            document.getElementById('tasks-grid').innerHTML = `
                <div class="col-span-full text-center p-12 text-slate-400">
                    <i class="fa-solid fa-circle-exclamation text-4xl mb-3 text-red-400"></i>
                    <p>فشل تحميل المهام. تأكد من اتصالك بالخادم.</p>
                    <button onclick="tasksView._loadTasks()" class="mt-4 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">
                        إعادة المحاولة
                    </button>
                </div>`;
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Get User Name (from API data or users list)
    // ─────────────────────────────────────────────────────────────────────────
    _getUserName(id, assignedToName) {
        if (assignedToName) return assignedToName;
        const user = this.users.find(u => u.id === id);
        return user ? user.name : 'غير محدد';
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Populate User Dropdown
    // ─────────────────────────────────────────────────────────────────────────
    _populateUserDropdown() {
        const select = document.getElementById('task-assignee');
        if (!select) return;
        
        select.innerHTML = '<option value="">اختر الموظف</option>';
        this.users.forEach(user => {
            select.innerHTML += `<option value="${user.id}">${user.name}</option>`;
        });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Update Statistics
    // ─────────────────────────────────────────────────────────────────────────
    _updateStats() {
        const total = this.tasks.length;
        const completed = this.tasks.filter(t => t.status === 'completed').length;
        const pending = this.tasks.filter(t => t.status === 'pending').length;
        const overdue = this.tasks.filter(t => this._isOverdue(t)).length;

        document.getElementById('stat-total-tasks').textContent = total;
        document.getElementById('stat-completed-tasks').textContent = completed;
        document.getElementById('stat-pending-tasks').textContent = pending;
        document.getElementById('stat-overdue-tasks').textContent = overdue;
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
    // Render Tasks Grid
    // ─────────────────────────────────────────────────────────────────────────
    _renderTasks() {
        const grid = document.getElementById('tasks-grid');
        
        // Apply search filter only (status/priority handled by API)
        let filtered = this.tasks;
        if (this.filters.search) {
            const search = this.filters.search.toLowerCase();
            filtered = filtered.filter(t => 
                t.title.toLowerCase().includes(search) ||
                (t.description && t.description.toLowerCase().includes(search)) ||
                (t.assigned_to_name && t.assigned_to_name.toLowerCase().includes(search))
            );
        }

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="col-span-full text-center p-12 text-slate-400">
                    <i class="fa-solid fa-clipboard-check text-5xl mb-3"></i>
                    <p class="text-lg">لا توجد مهام</p>
                    <p class="text-sm mt-2">أضف مهمة جديدة للبدء</p>
                </div>`;
            return;
        }

        grid.innerHTML = filtered.map(task => {
            const isOverdue = this._isOverdue(task);
            const isCompleted = task.status === 'completed';
            // Use API-provided counts
            const completedSubtasks = task.completed_subtasks || 0;
            const totalSubtasks = task.total_subtasks || 0;
            const progress = task.progress_percentage || 0;

            let cardClass = 'bg-white border-slate-200';
            let statusBadge = `<span class="bg-orange-100 text-orange-700 text-xs px-2 py-1 rounded-full font-bold">قيد التنفيذ</span>`;
            let priorityIcon = this._getPriorityIcon(task.priority);

            if (isCompleted) {
                cardClass = 'bg-emerald-50/50 border-emerald-200';
                statusBadge = `<span class="bg-emerald-100 text-emerald-700 text-xs px-2 py-1 rounded-full font-bold">مكتملة</span>`;
            } else if (isOverdue) {
                cardClass = 'bg-red-50/50 border-red-200';
                statusBadge = `<span class="bg-red-100 text-red-700 text-xs px-2 py-1 rounded-full font-bold animate-pulse">متأخرة</span>`;
            }

            return `
                <div class="${cardClass} border rounded-2xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer"
                     onclick="window.openTaskDetails('${task.id}')">
                    <div class="flex justify-between items-start mb-3">
                        <div class="flex items-center gap-2">
                            ${priorityIcon}
                            <h3 class="font-bold text-slate-800 line-clamp-1">${task.title}</h3>
                        </div>
                        ${statusBadge}
                    </div>
                    <p class="text-sm text-slate-600 mb-4 line-clamp-2">${task.description || 'لا يوجد وصف'}</p>
                    
                    <div class="flex items-center justify-between text-xs text-slate-500 mb-3 bg-slate-50 p-2 rounded-lg">
                        <div class="flex items-center gap-1.5">
                            <i class="fa-solid fa-user text-brand-500"></i>
                            <span class="font-medium">${task.assigned_to_name || this._getUserName(task.assigned_to, task.assigned_to_name)}</span>
                        </div>
                        <div class="flex items-center gap-1.5 ${isOverdue ? 'text-red-600 font-bold' : ''}">
                            <i class="fa-solid fa-calendar"></i>
                            <span>${task.due_date}</span>
                        </div>
                    </div>

                    ${totalSubtasks > 0 ? `
                        <div class="mb-3">
                            <div class="flex justify-between text-xs text-slate-500 mb-1">
                                <span>التقدم: ${completedSubtasks}/${totalSubtasks}</span>
                                <span>${progress}%</span>
                            </div>
                            <div class="w-full bg-slate-200 rounded-full h-1.5">
                                <div class="bg-brand-500 h-1.5 rounded-full transition-all" style="width: ${progress}%"></div>
                            </div>
                        </div>
                    ` : ''}

                    <div class="flex justify-between items-center pt-3 border-t border-slate-100">
                        <div class="flex items-center gap-1">
                            <button onclick="event.stopPropagation(); window.editTask('${task.id}')" 
                                    class="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors">
                                <i class="fa-solid fa-edit"></i>
                            </button>
                            <button onclick="event.stopPropagation(); window.deleteTask('${task.id}')" 
                                    class="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                        <button onclick="event.stopPropagation(); window.toggleTaskStatus('${task.id}')" 
                                class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${isCompleted ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-emerald-500 text-white hover:bg-emerald-600'}">
                            ${isCompleted ? '<i class="fa-solid fa-undo mr-1"></i>تراجع' : '<i class="fa-solid fa-check mr-1"></i>إنجاز'}
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Get Priority Icon
    // ─────────────────────────────────────────────────────────────────────────
    _getPriorityIcon(priority) {
        const icons = {
            high: '<i class="fa-solid fa-flag text-red-500"></i>',
            medium: '<i class="fa-solid fa-flag text-orange-500"></i>',
            low: '<i class="fa-solid fa-flag text-slate-400"></i>'
        };
        return icons[priority] || icons.medium;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Apply Filters
    // ─────────────────────────────────────────────────────────────────────────
    _applyFilters() {
        let filtered = [...this.tasks];

        // Status filter
        if (this.filters.status) {
            if (this.filters.status === 'overdue') {
                filtered = filtered.filter(t => this._isOverdue(t));
            } else {
                filtered = filtered.filter(t => t.status === this.filters.status);
            }
        }

        // Priority filter
        if (this.filters.priority) {
            filtered = filtered.filter(t => t.priority === this.filters.priority);
        }

        // Search filter
        if (this.filters.search) {
            const search = this.filters.search.toLowerCase();
            filtered = filtered.filter(t => 
                t.title.toLowerCase().includes(search) ||
                (t.description && t.description.toLowerCase().includes(search)) ||
                this._getUserName(t.assigned_to).toLowerCase().includes(search)
            );
        }

        return filtered;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Setup Event Listeners
    // ─────────────────────────────────────────────────────────────────────────
    _setupEventListeners() {
        // Add task button
        document.getElementById('add-task-btn')?.addEventListener('click', () => {
            window.openNewTaskModal();
        });

        // Filters - reload from API when status/priority changes
        document.getElementById('filter-status')?.addEventListener('change', (e) => {
            this.filters.status = e.target.value;
            this._loadTasks(); // Reload from API with new filter
        });

        document.getElementById('filter-priority')?.addEventListener('change', (e) => {
            this.filters.priority = e.target.value;
            this._loadTasks(); // Reload from API with new filter
        });

        // Search filter - client side only
        document.getElementById('tasks-search')?.addEventListener('input', (e) => {
            this.filters.search = e.target.value;
            this._renderTasks(); // Just re-render, no API call needed
        });

        // Form submit
        document.getElementById('task-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this._saveTask();
        });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Save Task (Create/Update)
    // ─────────────────────────────────────────────────────────────────────────
    async _saveTask() {
        const btn = document.getElementById('save-task-btn');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        btn.disabled = true;

        try {
            const taskId = document.getElementById('task-id').value;
            const payload = {
                title: document.getElementById('task-title').value.trim(),
                description: document.getElementById('task-description').value.trim(),
                assigned_to: document.getElementById('task-assignee').value,
                due_date: document.getElementById('task-due-date').value,
                priority: document.getElementById('task-priority').value,
                status: document.getElementById('task-status').value,
                subtasks: this.currentSubtasks
            };

            if (taskId) {
                // Update existing task via API
                await apiFetch(`/api/tasks/${taskId}`, { 
                    method: 'PUT', 
                    body: JSON.stringify(payload) 
                });
                showToast('تم تحديث المهمة بنجاح', 'success');
            } else {
                // Create new task via API
                await apiFetch('/api/tasks', { 
                    method: 'POST', 
                    body: JSON.stringify(payload) 
                });
                showToast('تم إنشاء المهمة بنجاح', 'success');
            }

            window.closeTaskModal();
            await this._loadTasks(); // Reload from API
        } catch (error) {
            console.error('[Tasks] Save error:', error);
            showToast('فشل حفظ المهمة', 'error');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Open New Task Modal
    // ─────────────────────────────────────────────────────────────────────────
    _openNewTaskModal() {
        this.currentSubtasks = [];
        this.currentTask = null;
        
        document.getElementById('task-id').value = '';
        document.getElementById('task-form').reset();
        document.getElementById('task-modal-title').textContent = 'مهمة جديدة';
        document.getElementById('subtasks-container').innerHTML = '';
        
        // Set default date to tomorrow
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        document.getElementById('task-due-date').value = tomorrow.toISOString().split('T')[0];
        
        this._openModal('task-modal');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Edit Task
    // ─────────────────────────────────────────────────────────────────────────
    _editTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        this.currentTask = task;
        this.currentSubtasks = [...(task.subtasks || [])];

        document.getElementById('task-id').value = task.id;
        document.getElementById('task-title').value = task.title;
        document.getElementById('task-description').value = task.description || '';
        document.getElementById('task-assignee').value = task.assigned_to;
        document.getElementById('task-due-date').value = task.due_date;
        document.getElementById('task-priority').value = task.priority || 'medium';
        document.getElementById('task-status').value = task.status;
        document.getElementById('task-modal-title').textContent = 'تعديل المهمة';

        this._renderSubtasksInput();
        this._openModal('task-modal');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Delete Task
    // ─────────────────────────────────────────────────────────────────────────
    async _deleteTask(taskId) {
        if (!confirm('هل أنت متأكد من حذف هذه المهمة؟')) return;

        try {
            await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
            showToast('تم حذف المهمة', 'success');
            await this._loadTasks(); // Reload from API
        } catch (error) {
            console.error('[Tasks] Delete error:', error);
            showToast('فشل حذف المهمة', 'error');
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Toggle Task Status
    // ─────────────────────────────────────────────────────────────────────────
    async _toggleTaskStatus(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        const newStatus = task.status === 'completed' ? 'pending' : 'completed';
        
        try {
            await apiFetch(`/api/tasks/${taskId}`, { 
                method: 'PUT', 
                body: JSON.stringify({ status: newStatus }) 
            });
            showToast(newStatus === 'completed' ? 'تم إنجاز المهمة' : 'تم إرجاع المهمة للتنفيذ', 'success');
            await this._loadTasks(); // Reload from API
        } catch (error) {
            console.error('[Tasks] Toggle status error:', error);
            showToast('فشل تحديث حالة المهمة', 'error');
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Open Task Details
    // ─────────────────────────────────────────────────────────────────────────
    async _openTaskDetails(taskId) {
        // Show loading
        this._openModal('task-details-modal');
        document.getElementById('details-title').textContent = 'جارٍ التحميل...';
        
        try {
            // Fetch full task details with subtasks from API
            const response = await apiFetch(`/api/tasks/${taskId}`);
            const task = response.task;
            
            if (!task) {
                showToast('المهمة غير موجودة', 'error');
                window.closeTaskDetailsModal();
                return;
            }
            
            this.currentTask = task;
            
            document.getElementById('details-title').textContent = task.title;
            document.getElementById('details-description').textContent = task.description || 'لا يوجد وصف';
            document.getElementById('details-assignee').textContent = task.assigned_to_name || this._getUserName(task.assigned_to, task.assigned_to_name);
            document.getElementById('details-due-date').textContent = task.due_date;
            document.getElementById('details-priority').textContent = this._getPriorityLabel(task.priority);
            document.getElementById('details-created').textContent = new Date(task.created_at).toLocaleDateString('ar-SA-u-nu-latn');

            // Priority color
            const priorityEl = document.getElementById('details-priority');
            priorityEl.className = `font-medium ${task.priority === 'high' ? 'text-red-600' : task.priority === 'medium' ? 'text-orange-600' : 'text-slate-500'}`;

            // Status badge
            const isOverdue = this._isOverdue(task);
            const isCompleted = task.status === 'completed';
            const statusBadge = document.getElementById('details-status-badge');
            
            if (isCompleted) {
                statusBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700';
                statusBadge.textContent = 'مكتملة';
            } else if (isOverdue) {
                statusBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700';
                statusBadge.textContent = 'متأخرة';
            } else {
                statusBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700';
                statusBadge.textContent = 'قيد التنفيذ';
            }

            // Toggle status button
            const toggleBtn = document.getElementById('details-toggle-status');
            if (isCompleted) {
                toggleBtn.className = 'px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors';
                toggleBtn.innerHTML = '<i class="fa-solid fa-undo mr-1"></i> تراجع عن الإنجاز';
                toggleBtn.onclick = () => { window.toggleTaskStatus(taskId); window.closeTaskDetailsModal(); };
            } else {
                toggleBtn.className = 'px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors';
                toggleBtn.innerHTML = '<i class="fa-solid fa-check mr-1"></i> تحديد كمكتملة';
                toggleBtn.onclick = () => { window.toggleTaskStatus(taskId); window.closeTaskDetailsModal(); };
            }

            // Render subtasks from API response
            this._renderDetailsSubtasks(task.subtasks || []);
            
            // Render comments
            this._renderComments(task.comments || []);
            
        } catch (error) {
            console.error('[Tasks] Failed to load task details:', error);
            showToast('فشل تحميل تفاصيل المهمة', 'error');
            window.closeTaskDetailsModal();
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Get Priority Label
    // ─────────────────────────────────────────────────────────────────────────
    _getPriorityLabel(priority) {
        const labels = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };
        return labels[priority] || 'متوسطة';
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Details Subtasks
    // ─────────────────────────────────────────────────────────────────────────
    _renderDetailsSubtasks(subtasks) {
        const container = document.getElementById('details-subtasks');
        if (subtasks.length === 0) {
            container.innerHTML = '<p class="text-sm text-slate-400 text-center py-4">لا توجد مهام فرعية</p>';
            return;
        }

        container.innerHTML = subtasks.map((st, idx) => `
            <div class="flex items-center gap-3 p-2 rounded-lg ${st.completed ? 'bg-slate-50' : 'bg-white border border-slate-100'}">
                <input type="checkbox" ${st.completed ? 'checked' : ''} 
                       onchange="window.toggleSubtaskInDetails(${idx})"
                       class="w-4 h-4 text-brand-600 rounded cursor-pointer">
                <span class="text-sm ${st.completed ? 'line-through text-slate-400' : 'text-slate-700'}">${st.title}</span>
            </div>
        `).join('');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Toggle Subtask in Details (local only, save later)
    // ─────────────────────────────────────────────────────────────────────────
    _toggleSubtaskInDetails(idx) {
        if (!this.currentTask) return;
        const subtask = this.currentTask.subtasks[idx];
        subtask.completed = !subtask.completed;
        subtask._changed = true; // mark as changed
        
        // Update UI only
        this._renderDetailsSubtasks(this.currentTask.subtasks);
        
        // Show save button if there are changes
        this._showSaveSubtasksButton();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Show Save Subtasks Button
    // ─────────────────────────────────────────────────────────────────────────
    _showSaveSubtasksButton() {
        const container = document.getElementById('subtasks-save-btn');
        if (container) {
            container.style.display = 'block';
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Save Subtasks Changes to Database
    // ─────────────────────────────────────────────────────────────────────────
    async _saveSubtasksChanges() {
        if (!this.currentTask) return;
        
        const changedSubtasks = this.currentTask.subtasks.filter(st => st._changed);
        if (changedSubtasks.length === 0) return;
        
        const btn = document.getElementById('save-subtasks-btn');
        const originalText = btn?.innerHTML || 'حفظ التغييرات';
        if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        
        try {
            // Save each changed subtask
            for (const subtask of changedSubtasks) {
                await apiFetch(`/api/tasks/${this.currentTask.id}/subtasks/${subtask.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ is_completed: subtask.completed })
                });
                delete subtask._changed; // clear changed flag
            }
            
            showToast('تم حفظ التغييرات بنجاح', 'success');
            
            // Check if all subtasks are completed
            const allCompleted = this.currentTask.subtasks.every(st => st.completed);
            if (allCompleted && this.currentTask.status !== 'completed') {
                // Show complete task button
                this._showCompleteTaskButton();
            }
            
            // Refresh data
            await this._loadTasks();
            
            // Hide save button
            const saveBtnContainer = document.getElementById('subtasks-save-btn');
            if (saveBtnContainer) saveBtnContainer.style.display = 'none';
            
        } catch (error) {
            console.error('[Tasks] Failed to save subtasks:', error);
            showToast('فشل حفظ التغييرات', 'error');
        } finally {
            if (btn) btn.innerHTML = originalText;
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Show Complete Task Button
    // ─────────────────────────────────────────────────────────────────────────
    _showCompleteTaskButton() {
        const container = document.getElementById('complete-task-btn-container');
        if (container) {
            container.classList.remove('hidden');
            container.classList.add('block');
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Complete Task (mark as done)
    // ─────────────────────────────────────────────────────────────────────────
    async _completeTask() {
        if (!this.currentTask) return;
        
        try {
            await apiFetch(`/api/tasks/${this.currentTask.id}`, {
                method: 'PUT',
                body: JSON.stringify({ status: 'completed' })
            });
            
            showToast('تم إنجاز المهمة بنجاح', 'success');
            await this._loadTasks();
            window.closeTaskDetailsModal();
        } catch (error) {
            console.error('[Tasks] Failed to complete task:', error);
            showToast('فشل إنجاز المهمة', 'error');
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Comments (Chat)
    // ─────────────────────────────────────────────────────────────────────────
    _renderComments(comments) {
        const container = document.getElementById('details-comments');
        if (!container) return;
        
        if (comments.length === 0) {
            container.innerHTML = '<p class="text-sm text-slate-400 text-center py-4">لا توجد تعليقات. ابدأ المحادثة...</p>';
            return;
        }
        
        container.innerHTML = comments.map(c => `
            <div class="flex gap-3 mb-4 ${c.user_id === window.GpackUser?.id ? 'flex-row-reverse' : ''}">
                <div class="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-xs font-bold flex-shrink-0">
                    ${c.user_name?.charAt(0).toUpperCase() || '?'}
                </div>
                <div class="${c.user_id === window.GpackUser?.id ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-700'} rounded-2xl px-4 py-2 max-w-[80%]">
                    <p class="text-xs font-medium mb-1 ${c.user_id === window.GpackUser?.id ? 'text-brand-100' : 'text-slate-500'}">${c.user_name || 'غير معروف'}</p>
                    <p class="text-sm">${c.comment}</p>
                    <p class="text-xs mt-1 opacity-70">${new Date(c.created_at).toLocaleString('ar-SA-u-nu-latn')}</p>
                </div>
            </div>
        `).join('');
        
        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Add Comment
    // ─────────────────────────────────────────────────────────────────────────
    async _addComment() {
        const input = document.getElementById('new-comment');
        const comment = input?.value?.trim();
        if (!comment || !this.currentTask) return;
        
        try {
            await apiFetch(`/api/tasks/${this.currentTask.id}/comments`, {
                method: 'POST',
                body: JSON.stringify({ comment })
            });
            
            input.value = '';
            // Refresh task details
            await this._openTaskDetails(this.currentTask.id);
            showToast('تم إرسال التعليق', 'success');
        } catch (error) {
            console.error('[Tasks] Failed to add comment:', error);
            showToast('فشل إرسال التعليق', 'error');
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Add Subtask Input
    // ─────────────────────────────────────────────────────────────────────────
    _addSubtaskInput() {
        const input = document.getElementById('new-subtask');
        const title = input.value.trim();
        if (!title) return;

        this.currentSubtasks.push({ id: Date.now().toString(), title, completed: false });
        input.value = '';
        this._renderSubtasksInput();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Remove Subtask Input
    // ─────────────────────────────────────────────────────────────────────────
    _removeSubtaskInput(idx) {
        this.currentSubtasks.splice(idx, 1);
        this._renderSubtasksInput();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Render Subtasks Input
    // ─────────────────────────────────────────────────────────────────────────
    _renderSubtasksInput() {
        const container = document.getElementById('subtasks-container');
        if (this.currentSubtasks.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = this.currentSubtasks.map((st, idx) => `
            <div class="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                <span class="text-sm text-slate-700">${st.title}</span>
                <button type="button" onclick="window.removeSubtaskInput(${idx})" 
                        class="text-red-500 hover:text-red-700 p-1">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
        `).join('');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Open Modal Helper
    // ─────────────────────────────────────────────────────────────────────────
    _openModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.remove('hidden', 'opacity-0', 'pointer-events-none');
        modal.querySelector('.transform').classList.remove('scale-95');
        modal.querySelector('.transform').classList.add('scale-100');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Close Modal Helper
    // ─────────────────────────────────────────────────────────────────────────
    _closeModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.querySelector('.transform').classList.remove('scale-100');
        modal.querySelector('.transform').classList.add('scale-95');
        setTimeout(() => {
            modal.classList.add('hidden', 'opacity-0', 'pointer-events-none');
        }, 150);
    }
};

// =============================================================================
// Global Functions (exposed to window for HTML onclick handlers)
// =============================================================================

window.openNewTaskModal = function() {
    tasksView._openNewTaskModal();
};

window.closeTaskModal = function() {
    tasksView._closeModal('task-modal');
};

window.editTask = function(taskId) {
    tasksView._editTask(taskId);
};

window.deleteTask = function(taskId) {
    tasksView._deleteTask(taskId);
};

window.toggleTaskStatus = function(taskId) {
    tasksView._toggleTaskStatus(taskId);
};

window.openTaskDetails = function(taskId) {
    tasksView._openTaskDetails(taskId);
};

window.closeTaskDetailsModal = function() {
    tasksView._closeModal('task-details-modal');
};

window.editCurrentTask = function() {
    if (tasksView.currentTask) {
        window.closeTaskDetailsModal();
        setTimeout(() => window.editTask(tasksView.currentTask.id), 200);
    }
};

window.deleteCurrentTask = function() {
    if (tasksView.currentTask) {
        window.closeTaskDetailsModal();
        setTimeout(() => window.deleteTask(tasksView.currentTask.id), 200);
    }
};

window.addSubtaskInput = function() {
    tasksView._addSubtaskInput();
};

window.removeSubtaskInput = function(idx) {
    tasksView._removeSubtaskInput(idx);
};

window.toggleSubtaskInDetails = function(idx) {
    tasksView._toggleSubtaskInDetails(idx);
};

// Export for app.js routing
window.tasksView = tasksView;

// Auto-initialize when script loads (for SPA navigation)
if (document.getElementById('tasks-grid')) {
    tasksView._init();
}
