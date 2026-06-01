'use strict';

// =============================================================================
// G.PACK 2.0 — Tasks Management View
// Handles CRUD operations for employee tasks with subtasks
// =============================================================================

const tasksView = {
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
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Load Users for Dropdown
    // ─────────────────────────────────────────────────────────────────────────
    async _loadUsers() {
        try {
            const response = await apiFetch('/api/users');
            this.users = response.users || [];
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

            // TODO: Replace with actual API endpoint when backend is ready
            // const response = await apiFetch('/api/tasks');
            // this.tasks = response.tasks || [];
            
            // For now, use sample data
            this.tasks = this._getSampleTasks();
            
            this._renderTasks();
            this._updateStats();
        } catch (error) {
            console.error('[Tasks] Failed to load tasks:', error);
            document.getElementById('tasks-grid').innerHTML = `
                <div class="col-span-full text-center p-12 text-slate-400">
                    <i class="fa-solid fa-circle-exclamation text-4xl mb-3 text-red-400"></i>
                    <p>فشل تحميل المهام</p>
                </div>`;
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Sample Data (Temporary until backend API is ready)
    // ─────────────────────────────────────────────────────────────────────────
    _getSampleTasks() {
        const today = new Date();
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        
        return [
            {
                id: '1',
                title: 'تجهيز طلب شركة النور',
                description: 'تجهيز 500 كيس تغليف للعميل مع الطباعة الخاصة',
                assigned_to: this.users[0]?.id || '1',
                due_date: tomorrow.toISOString().split('T')[0],
                status: 'pending',
                priority: 'high',
                created_at: today.toISOString(),
                subtasks: [
                    { id: 's1', title: 'استلام خامات من المخزن', completed: true },
                    { id: 's2', title: 'بدء الطباعة', completed: false },
                    { id: 's3', title: 'التسليم للتعبئة', completed: false }
                ]
            },
            {
                id: '2',
                title: 'صيانة الطابعة الرئيسية',
                description: 'الفحوصات الدورية للطابعة الكبيرة',
                assigned_to: this.users[1]?.id || '2',
                due_date: today.toISOString().split('T')[0],
                status: 'pending',
                priority: 'medium',
                created_at: yesterday.toISOString(),
                subtasks: [
                    { id: 's4', title: 'تنظيف الرؤوس', completed: true },
                    { id: 's5', title: 'معايرة الألوان', completed: true }
                ]
            },
            {
                id: '3',
                title: 'تحديث بيانات العملاء',
                description: 'مراجعة وتحديث أرقام التواصل لـ 15 عميل',
                assigned_to: this.users[0]?.id || '1',
                due_date: yesterday.toISOString().split('T')[0],
                status: 'completed',
                priority: 'low',
                created_at: yesterday.toISOString(),
                subtasks: []
            },
            {
                id: '4',
                title: 'جرد المخزن الشهري',
                description: 'الجرد الكامل لجميع الأصناف في المستودع الرئيسي',
                assigned_to: this.users[2]?.id || '3',
                due_date: yesterday.toISOString().split('T')[0],
                status: 'pending',
                priority: 'high',
                created_at: yesterday.toISOString(),
                subtasks: [
                    { id: 's6', title: 'جرد الورق', completed: false },
                    { id: 's7', title: 'جرد الأحبار', completed: false }
                ]
            }
        ];
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
    // Get User Name by ID
    // ─────────────────────────────────────────────────────────────────────────
    _getUserName(id) {
        const user = this.users.find(u => u.id === id);
        return user ? user.name : 'غير محدد';
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
        let filtered = this._applyFilters();

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
            const completedSubtasks = task.subtasks?.filter(s => s.completed).length || 0;
            const totalSubtasks = task.subtasks?.length || 0;
            const progress = totalSubtasks > 0 ? Math.round((completedSubtasks / totalSubtasks) * 100) : 0;

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
                            <span class="font-medium">${this._getUserName(task.assigned_to)}</span>
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

        // Filters
        document.getElementById('filter-status')?.addEventListener('change', (e) => {
            this.filters.status = e.target.value;
            this._renderTasks();
        });

        document.getElementById('filter-priority')?.addEventListener('change', (e) => {
            this.filters.priority = e.target.value;
            this._renderTasks();
        });

        document.getElementById('tasks-search')?.addEventListener('input', (e) => {
            this.filters.search = e.target.value;
            this._renderTasks();
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
                // Update existing task
                const index = this.tasks.findIndex(t => t.id === taskId);
                if (index !== -1) {
                    this.tasks[index] = { ...this.tasks[index], ...payload };
                }
                showToast('تم تحديث المهمة بنجاح', 'success');
            } else {
                // Create new task
                const newTask = {
                    id: Date.now().toString(),
                    ...payload,
                    created_at: new Date().toISOString()
                };
                this.tasks.unshift(newTask);
                showToast('تم إنشاء المهمة بنجاح', 'success');
            }

            window.closeTaskModal();
            this._renderTasks();
            this._updateStats();
            
            // TODO: Send to API when ready
            // await apiFetch('/api/tasks', { method: taskId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
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
            this.tasks = this.tasks.filter(t => t.id !== taskId);
            this._renderTasks();
            this._updateStats();
            showToast('تم حذف المهمة', 'success');
            
            // TODO: Call API
            // await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
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
        task.status = newStatus;
        
        this._renderTasks();
        this._updateStats();
        showToast(newStatus === 'completed' ? 'تم إنجاز المهمة' : 'تم إرجاع المهمة للتنفيذ', 'success');
        
        // TODO: Call API
        // await apiFetch(`/api/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Open Task Details
    // ─────────────────────────────────────────────────────────────────────────
    _openTaskDetails(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        this.currentTask = task;
        
        document.getElementById('details-title').textContent = task.title;
        document.getElementById('details-description').textContent = task.description || 'لا يوجد وصف';
        document.getElementById('details-assignee').textContent = this._getUserName(task.assigned_to);
        document.getElementById('details-due-date').textContent = task.due_date;
        document.getElementById('details-priority').textContent = this._getPriorityLabel(task.priority);
        document.getElementById('details-created').textContent = new Date(task.created_at).toLocaleDateString('ar-SA');

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

        // Render subtasks
        this._renderDetailsSubtasks(task.subtasks || []);
        
        this._openModal('task-details-modal');
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
    // Toggle Subtask in Details
    // ─────────────────────────────────────────────────────────────────────────
    _toggleSubtaskInDetails(idx) {
        if (!this.currentTask) return;
        this.currentTask.subtasks[idx].completed = !this.currentTask.subtasks[idx].completed;
        this._renderDetailsSubtasks(this.currentTask.subtasks);
        this._renderTasks();
        this._updateStats();
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
