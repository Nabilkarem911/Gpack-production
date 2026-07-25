'use strict';

// =============================================================================
// G.PACK 2.0 — Designer Page Logic (designer.js)
// Shows design tasks, task detail with per-item design files & notes.
// =============================================================================

(function () {

    // ── State ────────────────────────────────────────────────────────────────
    let _currentTab = 'pending';
    let _allTasks = [];
    let _completedTasks = [];
    let _reviewTasks = [];
    let _currentTask = null;
    let _pollingInterval = null;
    let _navToken = 0;

    // ── Init ──────────────────────────────────────────────────────────────────
    async function init() {
        console.log('[Designer] init() called');
        _navToken = Date.now();
        const reviewTab = document.getElementById('designer-tab-review');
        if (reviewTab && _isManager()) {
            reviewTab.style.display = '';
        }
        await _loadTasks();
        _bindEvents();
        _startPolling();
    }

    // ── Load tasks ────────────────────────────────────────────────────────────
    async function _loadTasks() {
        try {
            const res = await window.apiFetch('/api/designer/my-tasks');
            _allTasks = res.tasks || [];
            console.log('[Designer] my-tasks response:', res);
            console.log('[Designer] _allTasks count:', _allTasks.length, _allTasks);

            const completedRes = await window.apiFetch('/api/designer/my-completed');
            _completedTasks = completedRes.tasks || [];
            console.log('[Designer] _completedTasks count:', _completedTasks.length);

            if (_isManager()) {
                try {
                    const reviewRes = await window.apiFetch('/api/designer/pending-review');
                    _reviewTasks = reviewRes.orders || [];
                    console.log('[Designer] _reviewTasks count:', _reviewTasks.length);
                } catch (e) {
                    console.error('[Designer] Review tasks error:', e.message);
                    _reviewTasks = [];
                }
            }

            _renderTasks();
        } catch (err) {
            console.error('[Designer] Load error:', err.message);
            window.showToast?.('فشل في تحميل المهام', 'error');
        }
    }

    // ── Render task cards ─────────────────────────────────────────────────────
    function _renderTasks() {
        const grid = document.getElementById('designer-tasks-grid');
        const emptyState = document.getElementById('designer-empty-state');
        console.log('[Designer] _renderTasks called. grid found:', !!grid, 'emptyState found:', !!emptyState);
        if (!grid) return;

        let tasks;
        if (_currentTab === 'completed') {
            tasks = _completedTasks;
        } else if (_currentTab === 'review') {
            tasks = _reviewTasks;
        } else {
            tasks = _allTasks.filter(t => t.design_status === _currentTab);
        }
        console.log('[Designer] current tab:', _currentTab, 'filtered tasks:', tasks.length, tasks);

        // Update tab counts
        _updateTabCounts();

        if (tasks.length === 0) {
            grid.innerHTML = '';
            grid.classList.add('hidden');
            if (emptyState) {
                emptyState.classList.remove('hidden');
                emptyState.classList.add('flex');
            }
            return;
        }

        grid.classList.remove('hidden');
        if (emptyState) {
            emptyState.classList.add('hidden');
            emptyState.classList.remove('flex');
        }

        const cardsHtml = tasks.map(task => _renderTaskCard(task)).join('');
        grid.innerHTML = cardsHtml;
        console.log('[Designer] grid.innerHTML set, length:', cardsHtml.length, 'grid.children:', grid.children.length);

        // Bind card clicks
        grid.querySelectorAll('[data-task-id]').forEach(card => {
            card.addEventListener('click', () => {
                const taskId = card.getAttribute('data-task-id');
                _openTaskDetail(taskId);
            });
        });
    }

    // ── Render single task card ───────────────────────────────────────────────
    function _renderTaskCard(task) {
        const statusLabels = {
            pending: { label: 'بانتظار التصميم', color: 'bg-slate-100 text-slate-600' },
            in_progress: { label: 'قيد التنفيذ', color: 'bg-blue-100 text-blue-700' },
            revision: { label: 'مطلوب تعديل', color: 'bg-orange-100 text-orange-700' },
            in_review: { label: 'بانتظار مراجعة المدير', color: 'bg-purple-100 text-purple-700' },
            completed: { label: 'مكتمل', color: 'bg-green-100 text-green-700' },
        };
        const st = statusLabels[task.design_status] || statusLabels.pending;
        const completedCount = task.completed_count !== undefined ? task.completed_count : (task.approved_count || 0);
        const progressLabel = task.approved_count !== undefined ? 'المعتمد' : 'المكتمل';
        const progress = task.item_count > 0 ? Math.round((completedCount / task.item_count) * 100) : 0;

        return `
            <div data-task-id="${task.id}"
                 class="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md hover:border-brand-300 transition-all cursor-pointer">
                <div class="flex items-start justify-between mb-3">
                    <div>
                        <p class="font-bold text-slate-800 text-sm">#${task.order_number}</p>
                        <p class="text-xs text-slate-500 mt-0.5">${_esc(task.client_name)}</p>
                        ${task.designer_name ? `<p class="text-xs text-brand-600 mt-0.5"><i class="fa-solid fa-user-pen ml-1"></i>${_esc(task.designer_name)}</p>` : ''}
                    </div>
                    <span class="text-xs px-2 py-1 rounded-full ${st.color}">${st.label}</span>
                </div>
                <div class="space-y-2">
                    <div class="flex items-center justify-between text-xs text-slate-500">
                        <span>عدد الأصناف: ${task.item_count}</span>
                        <span>${progressLabel}: ${completedCount || 0}/${task.item_count}</span>
                    </div>
                    <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div class="h-full bg-brand-600 rounded-full transition-all" style="width: ${progress}%"></div>
                    </div>
                </div>
                ${task.design_brief ? `<p class="text-xs text-slate-400 mt-3 line-clamp-2">${_esc(task.design_brief)}</p>` : ''}
            </div>
        `;
    }

    // ── Update tab counts ─────────────────────────────────────────────────────
    function _updateTabCounts() {
        const pending = _allTasks.filter(t => t.design_status === 'pending').length;
        const progress = _allTasks.filter(t => t.design_status === 'in_progress').length;
        const revision = _allTasks.filter(t => t.design_status === 'revision').length;
        const completed = _completedTasks.length;
        const review = _reviewTasks.length;

        const el1 = document.getElementById('designer-tab-pending-count');
        const el2 = document.getElementById('designer-tab-progress-count');
        const el3 = document.getElementById('designer-tab-revision-count');
        const el4 = document.getElementById('designer-tab-completed-count');
        const el5 = document.getElementById('designer-tab-review-count');
        if (el1) el1.textContent = pending;
        if (el2) el2.textContent = progress;
        if (el3) el3.textContent = revision;
        if (el4) el4.textContent = completed;
        if (el5) el5.textContent = review;
    }

    // ── Open task detail ──────────────────────────────────────────────────────
    async function _openTaskDetail(taskId) {
        try {
            const res = await window.apiFetch(`/api/designer/task/${taskId}`);
            _currentTask = res;

            const isManagerRole = _isManager();
            const isManagerView = isManagerRole && _currentTab === 'review';

            const modal = document.getElementById('designer-task-modal');
            const title = document.getElementById('designer-modal-title');
            const client = document.getElementById('designer-modal-client');
            const body = document.getElementById('designer-modal-body');
            const status = document.getElementById('designer-modal-status');
            const sendClientBtn = document.getElementById('designer-send-client-btn');

            if (title) title.textContent = `عرض سعر #${res.order.order_number}`;
            if (client) client.textContent = res.order.client_name;
            if (status) status.textContent = `الحالة: ${_statusLabel(res.order.design_status)}`;

            if (sendClientBtn) {
                if (isManagerView && ['in_review', 'revision', 'client_review'].includes(res.order.design_status)) {
                    sendClientBtn.classList.remove('hidden');
                } else {
                    sendClientBtn.classList.add('hidden');
                }
            }

            // Build body
            let html = '';

            // Design brief
            if (res.order.design_brief) {
                html += `
                    <div class="bg-brand-50 border border-brand-200 rounded-xl p-4">
                        <p class="text-xs font-semibold text-brand-700 mb-1"><i class="fa-solid fa-clipboard ml-1"></i>تعليمات المدير</p>
                        <p class="text-sm text-slate-700">${_esc(res.order.design_brief)}</p>
                    </div>
                `;
            }

            // Brief files
            if (res.order.design_brief_files && res.order.design_brief_files.length > 0) {
                html += `
                    <div class="bg-slate-50 rounded-xl p-4">
                        <p class="text-xs font-semibold text-slate-600 mb-2"><i class="fa-solid fa-paperclip ml-1"></i>ملفات مرجعية من المدير</p>
                        <div class="flex flex-wrap gap-2">
                            ${res.order.design_brief_files.map(f => `
                                <a href="${f.path}" target="_blank" class="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg hover:border-brand-300 transition-colors text-xs">
                                    <i class="fa-solid fa-file text-slate-400"></i>
                                    <span class="text-slate-700">${_esc(f.original_name || f.filename)}</span>
                                    <i class="fa-solid fa-download text-slate-300"></i>
                                </a>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            // Pantone colors
            if (res.pantone_colors && res.pantone_colors.length > 0) {
                html += `
                    <div class="bg-slate-50 rounded-xl p-4">
                        <p class="text-xs font-semibold text-slate-600 mb-2"><i class="fa-solid fa-palette ml-1"></i>ألوان البانتون للعميل</p>
                        <div class="flex flex-wrap gap-2">
                            ${res.pantone_colors.map(c => `
                                <div class="flex items-center gap-2 px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs">
                                    <span class="w-4 h-4 rounded-full border border-slate-300" style="background:${c.hex_code || '#ccc'}"></span>
                                    <span class="text-slate-700">${_esc(c.color_name || '')} (${_esc(c.color_code || '')})</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            // Client designs
            if (res.client_designs && res.client_designs.length > 0) {
                html += `
                    <div class="bg-slate-50 rounded-xl p-4">
                        <p class="text-xs font-semibold text-slate-600 mb-2"><i class="fa-solid fa-images ml-1"></i>تصاميم العميل السابقة</p>
                        <div class="flex flex-wrap gap-2">
                            ${res.client_designs.map(d => `
                                <a href="${d.file_path}" target="_blank" class="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg hover:border-brand-300 transition-colors text-xs">
                                    <i class="fa-solid fa-file-image text-slate-400"></i>
                                    <span class="text-slate-700">${_esc(d.title || 'تصميم')}</span>
                                </a>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            // Client response banner
            if (res.order.design_client_status === 'approved') {
                html += `
                    <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
                        <i class="fa-solid fa-circle-check text-emerald-500 text-xl"></i>
                        <div>
                            <p class="text-sm font-bold text-emerald-700">تمت موافقة العميل على التصاميم</p>
                            <p class="text-xs text-emerald-600">تم تحويل الطلب إلى أمر تشغيل تلقائياً</p>
                        </div>
                    </div>
                `;
            } else if (res.order.design_client_status === 'revision_requested') {
                html += `
                    <div class="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
                        <i class="fa-solid fa-user-pen text-red-500 text-xl"></i>
                        <div>
                            <p class="text-sm font-bold text-red-700">العميل طلب تعديلات على التصاميم</p>
                            <p class="text-xs text-red-600">راجع ملاحظات العميل لكل صنف بالأسفل</p>
                        </div>
                    </div>
                `;
            } else if (res.order.design_client_status === 'sent' && res.order.design_status === 'client_review') {
                html += `
                    <div class="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
                        <i class="fa-solid fa-paper-plane text-blue-500 text-xl"></i>
                        <div>
                            <p class="text-sm font-bold text-blue-700">تم إرسال التصاميم للعميل</p>
                            <p class="text-xs text-blue-600">بانتظار رد العميل على رابط المراجعة</p>
                        </div>
                    </div>
                `;
            }

            // Items
            html += `<div class="space-y-3">`;
            res.items.forEach(item => {
                html += _renderItemCard(item, res.order.id, isManagerView);
            });
            html += `</div>`;

            if (body) body.innerHTML = html;

            // Show modal
            if (modal) modal.classList.remove('hidden');

            // Bind item events
            _bindItemEvents(res.order.id, res.items);

            // Bind manager events only when in manager review view
            if (isManagerView) {
                _bindManagerEvents(res.order.id, res.items);
            }

        } catch (err) {
            console.error('[Designer] Task detail error:', err.message);
            window.showToast?.('فشل في تحميل تفاصيل العرض', 'error');
        }
    }

    // ── Render item card ──────────────────────────────────────────────────────
    function _renderItemCard(item, orderId, isManagerView) {
        const stLabels = {
            pending: { label: 'بانتظار التصميم', color: 'bg-slate-100 text-slate-600' },
            in_progress: { label: 'قيد التنفيذ', color: 'bg-blue-100 text-blue-700' },
            completed: { label: 'تم التسليم', color: 'bg-purple-100 text-purple-700' },
            approved: { label: 'معتمد', color: 'bg-green-100 text-green-700' },
            revision: { label: 'مطلوب تعديل', color: 'bg-orange-100 text-orange-700' },
        };
        const st = stLabels[item.design_status] || stLabels.pending;

        let filesHtml = '';
        if (item.design_files && item.design_files.length > 0) {
            filesHtml = `
                <div class="flex flex-wrap gap-2 mt-2">
                    ${item.design_files.map(f => `
                        <a href="${f.path}" target="_blank" class="flex items-center gap-1 px-2 py-1 bg-slate-100 border border-slate-200 rounded-lg text-xs hover:border-brand-300 transition-colors">
                            <i class="fa-solid fa-file text-slate-400"></i>
                            <span class="text-slate-600">${_esc(f.original_name || f.filename)}</span>
                        </a>
                    `).join('')}
                </div>
            `;
        }

        let revisionHtml = '';
        if (item.design_status === 'revision' && item.revision_notes) {
            revisionHtml = `
                <div class="mt-2 bg-orange-50 border border-orange-200 rounded-lg p-2">
                    <p class="text-xs font-semibold text-orange-700 mb-1">ملاحظات المدير للتعديل:</p>
                    <p class="text-xs text-orange-600">${_esc(item.revision_notes)}</p>
                </div>
            `;
        }

        let clientRevisionHtml = '';
        if (item.client_design_status === 'revision_requested' && item.client_revision_notes) {
            let clientFilesHtml = '';
            if (item.client_revision_files && item.client_revision_files.length > 0) {
                clientFilesHtml = `
                    <div class="flex flex-wrap gap-2 mt-2">
                        ${item.client_revision_files.map(f => `
                            <a href="${f.path}" target="_blank" class="flex items-center gap-1 px-2 py-1 bg-white border border-red-200 rounded-lg text-xs hover:border-red-400 transition-colors">
                                <i class="fa-solid fa-file text-red-400"></i>
                                <span class="text-slate-600">${_esc(f.original_name || f.filename)}</span>
                                <i class="fa-solid fa-download text-slate-300"></i>
                            </a>
                        `).join('')}
                    </div>
                `;
            }
            clientRevisionHtml = `
                <div class="mt-2 bg-red-50 border border-red-200 rounded-lg p-2">
                    <p class="text-xs font-semibold text-red-700 mb-1"><i class="fa-solid fa-user-tag ml-1"></i>ملاحظات العميل للتعديل:</p>
                    <p class="text-xs text-red-600">${_esc(item.client_revision_notes)}</p>
                    ${clientFilesHtml}
                </div>
            `;
        }

        let clientApprovedHtml = '';
        if (item.client_design_status === 'approved') {
            clientApprovedHtml = `
                <div class="mt-2 bg-emerald-50 border border-emerald-200 rounded-lg p-2 flex items-center gap-2">
                    <i class="fa-solid fa-circle-check text-emerald-500"></i>
                    <span class="text-xs font-semibold text-emerald-700">تمت موافقة العميل على هذا التصميم</span>
                </div>
            `;
        }

        const canSubmit = !isManagerView && (item.design_status === 'pending' || item.design_status === 'in_progress' || item.design_status === 'revision');
        const canReview = isManagerView && item.design_status === 'completed';

        return `
            <div class="bg-white border border-slate-200 rounded-xl p-4" data-item-id="${item.id}">
                <div class="flex items-start justify-between mb-2">
                    <div>
                        <p class="font-semibold text-slate-800 text-sm">${_esc(item.product_name || 'صنف')} — ${_esc(item.size || '')}</p>
                        <p class="text-xs text-slate-500 mt-0.5">الكمية: ${item.quantity}</p>
                    </div>
                    <span class="text-xs px-2 py-1 rounded-full ${st.color}">${st.label}</span>
                </div>

                ${item.design_notes ? `<p class="text-xs text-slate-600 bg-slate-50 rounded-lg p-2 mt-2"><i class="fa-solid fa-comment-dots ml-1 text-slate-400"></i>${_esc(item.design_notes)}</p>` : ''}

                ${revisionHtml}
                ${clientRevisionHtml}
                ${clientApprovedHtml}
                ${filesHtml}

                ${item.designer_notes ? `<p class="text-xs text-slate-500 mt-2">${isManagerView ? 'ملاحظات المصمم' : 'ملاحظاتك'}: ${_esc(item.designer_notes)}</p>` : ''}

                ${canReview ? `
                    <div class="mt-3 space-y-2 border-t border-slate-100 pt-3">
                        <div class="flex gap-2">
                            <button class="manager-approve-btn px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs transition-colors" data-item-id="${item.id}" data-order-id="${orderId}">
                                <i class="fa-solid fa-check ml-1"></i>اعتماد
                            </button>
                            <button class="manager-revision-btn px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs transition-colors" data-item-id="${item.id}" data-order-id="${orderId}">
                                <i class="fa-solid fa-rotate-left ml-1"></i>طلب تعديل
                            </button>
                        </div>
                        <div class="manager-revision-box hidden" data-item-id="${item.id}">
                            <textarea class="manager-revision-notes w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="ملاحظات التعديل للمصمم..." data-item-id="${item.id}"></textarea>
                            <div class="flex gap-2 mt-1">
                                <button class="manager-revision-confirm px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs transition-colors" data-item-id="${item.id}" data-order-id="${orderId}">
                                    تأكيد طلب التعديل
                                </button>
                                <button class="manager-revision-cancel px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs transition-colors" data-item-id="${item.id}">
                                    إلغاء
                                </button>
                            </div>
                        </div>
                    </div>
                ` : ''}

                ${canSubmit ? `
                    <div class="mt-3 space-y-2 border-t border-slate-100 pt-3">
                        <textarea class="designer-item-notes w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
                            placeholder="ملاحظاتك للمدير..." data-item-id="${item.id}">${_esc(item.designer_notes || '')}</textarea>

                        <div class="flex items-center gap-2">
                            <label class="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer text-xs transition-colors">
                                <i class="fa-solid fa-upload text-slate-500"></i>
                                <span>رفع ملفات التصميم</span>
                                <input type="file" multiple class="designer-item-files hidden" accept=".jpg,.jpeg,.png,.gif,.pdf,.ai,.psd,.eps,.svg,.webp,.tiff,.tif,.bmp,.raw,.heic" data-item-id="${item.id}" />
                            </label>
                            <span class="designer-files-count text-xs text-slate-400" data-item-id="${item.id}"></span>
                        </div>

                        <div class="flex gap-2">
                            ${item.design_status === 'pending' ? `
                                <button class="designer-start-btn px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs transition-colors" data-item-id="${item.id}" data-order-id="${orderId}">
                                    <i class="fa-solid fa-play ml-1"></i>بدء التصميم
                                </button>
                            ` : ''}
                            <button class="designer-submit-btn px-3 py-2 bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-xs transition-colors" data-item-id="${item.id}" data-order-id="${orderId}">
                                <i class="fa-solid fa-paper-plane ml-1"></i>تسليم التصميم
                            </button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    // ── Bind events ───────────────────────────────────────────────────────────
    function _bindEvents() {
        // Tabs
        document.querySelectorAll('.designer-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.designer-tab').forEach(t => {
                    t.classList.remove('border-brand-700', 'text-brand-700');
                    t.classList.add('border-transparent', 'text-slate-500');
                });
                tab.classList.remove('border-transparent', 'text-slate-500');
                tab.classList.add('border-brand-700', 'text-brand-700');
                _currentTab = tab.getAttribute('data-tab');
                _renderTasks();
            });
        });

        // Refresh
        const refreshBtn = document.getElementById('designer-refresh-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', _loadTasks);

        // Modal close
        const modalClose = document.getElementById('designer-modal-close');
        const modalCloseBtn = document.getElementById('designer-modal-close-btn');
        const modal = document.getElementById('designer-task-modal');
        if (modalClose) modalClose.addEventListener('click', _closeModal);
        if (modalCloseBtn) modalCloseBtn.addEventListener('click', _closeModal);
        if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) _closeModal(); });
    }

    // ── Bind item events (inside modal) ───────────────────────────────────────
    function _bindItemEvents(orderId, items) {
        // Start buttons
        document.querySelectorAll('.designer-start-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const itemId = btn.getAttribute('data-item-id');
                const oid = btn.getAttribute('data-order-id');
                try {
                    await window.apiFetch(`/api/designer/item/${oid}/${itemId}/start`, { method: 'PUT' });
                    window.showToast?.('تم بدء التصميم', 'success');
                    await _openTaskDetail(orderId);
                    await _loadTasks();
                } catch (err) {
                    window.showToast?.('فشل في بدء التصميم', 'error');
                }
            });
        });

        // Submit buttons
        document.querySelectorAll('.designer-submit-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const itemId = btn.getAttribute('data-item-id');
                const oid = btn.getAttribute('data-order-id');
                const notesEl = document.querySelector(`textarea.designer-item-notes[data-item-id="${itemId}"]`);
                const filesEl = document.querySelector(`input.designer-item-files[data-item-id="${itemId}"]`);

                const notes = notesEl ? notesEl.value.trim() : '';
                const files = filesEl ? Array.from(filesEl.files) : [];

                if (files.length === 0 && !notes) {
                    window.showToast?.('يرجى رفع ملف أو كتابة ملاحظات على الأقل', 'warning');
                    return;
                }

                const formData = new FormData();
                formData.append('designer_notes', notes);
                files.forEach(f => formData.append('design_files', f));

                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin ml-1"></i>جاري التسليم...';

                try {
                    const url = `/api/designer/item/${oid}/${itemId}/submit`;
                    const fullUrl = url.startsWith('/api') ? url : `/api${url}`;
                    const response = await fetch(fullUrl, {
                        method: 'PUT',
                        credentials: 'include',
                        body: formData,
                    });
                    if (!response.ok) {
                        const data = await response.json().catch(() => ({}));
                        throw new Error(data.error || 'فشل في التسليم');
                    }

                    window.showToast?.('تم تسليم التصميم بنجاح', 'success');
                    await _openTaskDetail(orderId);
                    await _loadTasks();
                } catch (err) {
                    window.showToast?.(err.message || 'فشل في تسليم التصميم', 'error');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-paper-plane ml-1"></i>تسليم التصميم';
                }
            });
        });

        // File count display
        document.querySelectorAll('.designer-item-files').forEach(input => {
            input.addEventListener('change', () => {
                const itemId = input.getAttribute('data-item-id');
                const countEl = document.querySelector(`span.designer-files-count[data-item-id="${itemId}"]`);
                if (countEl) countEl.textContent = input.files.length > 0 ? `${input.files.length} ملف محدد` : '';
            });
        });
    }

    // ── Close modal ───────────────────────────────────────────────────────────
    function _closeModal() {
        const modal = document.getElementById('designer-task-modal');
        if (modal) modal.classList.add('hidden');
        const sendBtn = document.getElementById('designer-send-client-btn');
        if (sendBtn) sendBtn.classList.add('hidden');
        _currentTask = null;
    }

    // ── Polling ───────────────────────────────────────────────────────────────
    function _startPolling() {
        const token = _navToken;
        if (_pollingInterval) clearInterval(_pollingInterval);
        _pollingInterval = setInterval(async () => {
            if (token !== _navToken) {
                clearInterval(_pollingInterval);
                return;
            }
            try {
                await _loadTasks();
            } catch { /* silent */ }
        }, 30000);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function _statusLabel(status) {
        const labels = {
            pending: 'بانتظار التصميم',
            in_progress: 'قيد التنفيذ',
            in_review: 'بانتظار مراجعة المدير',
            revision: 'مطلوب تعديل',
            completed: 'مكتمل',
            client_review: 'بانتظار مراجعة العميل',
        };
        return labels[status] || status;
    }

    function _esc(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function _isManager() {
        const role = (window.GpackUser?.role || '').toLowerCase();
        return ['admin', 'super_admin', 'manager'].includes(role);
    }

    // ── Bind manager events (inside modal) ────────────────────────────────────
    function _bindManagerEvents(orderId, items) {
        // Approve buttons
        document.querySelectorAll('.manager-approve-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const itemId = btn.getAttribute('data-item-id');
                const oid = btn.getAttribute('data-order-id');
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin ml-1"></i>جاري الاعتماد...';
                try {
                    const res = await window.apiFetch(`/api/designer/review/${oid}/item/${itemId}`, {
                        method: 'PUT',
                        body: JSON.stringify({ action: 'approve' }),
                    });
                    window.showToast?.(res.message || 'تم اعتماد التصميم', 'success');
                    if (res.auto_converted) {
                        window.showToast?.('تم تحويل العرض إلى أمر تشغيل تلقائياً', 'success');
                    }
                    await _openTaskDetail(orderId);
                    await _loadTasks();
                } catch (err) {
                    window.showToast?.(err.message || 'فشل في اعتماد التصميم', 'error');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-check ml-1"></i>اعتماد';
                }
            });
        });

        // Revision buttons — show revision box
        document.querySelectorAll('.manager-revision-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const itemId = btn.getAttribute('data-item-id');
                const box = document.querySelector(`.manager-revision-box[data-item-id="${itemId}"]`);
                if (box) box.classList.remove('hidden');
            });
        });

        // Revision confirm
        document.querySelectorAll('.manager-revision-confirm').forEach(btn => {
            btn.addEventListener('click', async () => {
                const itemId = btn.getAttribute('data-item-id');
                const oid = btn.getAttribute('data-order-id');
                const notesEl = document.querySelector(`textarea.manager-revision-notes[data-item-id="${itemId}"]`);
                const revisionNotes = notesEl ? notesEl.value.trim() : '';

                if (!revisionNotes) {
                    window.showToast?.('يرجى كتابة ملاحظات التعديل', 'warning');
                    return;
                }

                btn.disabled = true;
                btn.textContent = 'جاري الإرسال...';
                try {
                    const res = await window.apiFetch(`/api/designer/review/${oid}/item/${itemId}`, {
                        method: 'PUT',
                        body: JSON.stringify({ action: 'revision', revision_notes: revisionNotes }),
                    });
                    window.showToast?.(res.message || 'تم طلب التعديل', 'success');
                    await _openTaskDetail(orderId);
                    await _loadTasks();
                } catch (err) {
                    window.showToast?.(err.message || 'فشل في طلب التعديل', 'error');
                } finally {
                    btn.disabled = false;
                    btn.textContent = 'تأكيد طلب التعديل';
                }
            });
        });

        // Revision cancel
        document.querySelectorAll('.manager-revision-cancel').forEach(btn => {
            btn.addEventListener('click', () => {
                const itemId = btn.getAttribute('data-item-id');
                const box = document.querySelector(`.manager-revision-box[data-item-id="${itemId}"]`);
                if (box) box.classList.add('hidden');
            });
        });

        // Send to client button
        const sendBtn = document.getElementById('designer-send-client-btn');
        if (sendBtn) {
            sendBtn.onclick = async () => {
                if (!confirm('هل تريد إرسال التصاميم للعميل للمراجعة؟')) return;
                sendBtn.disabled = true;
                sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin ml-1"></i>جاري الإرسال...';
                try {
                    const res = await window.apiFetch(`/api/designer/send-to-client/${orderId}`, {
                        method: 'POST',
                    });
                    window.showToast?.(res.message || 'تم إنشاء رابط المراجعة', 'success');
                    if (res.share_url) {
                        try {
                            await navigator.clipboard.writeText(res.share_url);
                            window.showToast?.('تم نسخ الرابط للحافظة', 'success');
                        } catch {
                            window.showToast?.(`رابط المراجعة: ${res.share_url}`, 'info');
                        }
                    }
                    await _loadTasks();
                } catch (err) {
                    window.showToast?.(err.message || 'فشل في إرسال التصاميم', 'error');
                } finally {
                    sendBtn.disabled = false;
                    sendBtn.innerHTML = '<i class="fa-solid fa-share ml-1"></i>إرسال للعميل';
                }
            };
        }
    }

    // ── Export init for SPA router ─────────────────────────────────────────────
    window.designerInit = init;
    window.designerCleanup = () => {
        if (_pollingInterval) clearInterval(_pollingInterval);
        _navToken = 0;
    };

    // ── Auto-execute ──────────────────────────────────────────────────────────
    requestAnimationFrame(() => {
        init();
    });

})();
