'use strict';

// =============================================================================
// G.PACK 2.0 — Designer Page Logic (designer.js)
// Item-level design state machine with context-aware modal + smart cards.
//
// State Machine:
//   waiting_design → in_progress → manager_review → client_review → approved
//                                         ↓                ↓
//                                   client_revision   client_revision
//                                         ↓
//                                    in_progress (rework)
// =============================================================================

(function () {

    // ── State ────────────────────────────────────────────────────────────────
    let _currentTab = 'waiting_design';
    let _allTasks = [];
    let _completedTasks = [];
    let _reviewTasks = [];
    let _currentTask = null;
    let _pollingInterval = null;
    let _navToken = 0;

    // ── Status definitions ────────────────────────────────────────────────────
    const STATUS_DEFS = {
        waiting_design:    { label: 'بانتظار التصميم',   color: 'bg-slate-100 text-slate-600',   dot: '🟡' },
        in_progress:       { label: 'قيد التنفيذ',       color: 'bg-blue-100 text-blue-700',     dot: '🔵' },
        manager_review:    { label: 'مراجعة المدير',     color: 'bg-purple-100 text-purple-700', dot: '🟣' },
        client_review:     { label: 'بانتظار العميل',     color: 'bg-cyan-100 text-cyan-700',     dot: '🔷' },
        client_revision:   { label: 'مطلوب تعديل',       color: 'bg-orange-100 text-orange-700', dot: '🟠' },
        approved:          { label: 'معتمد',             color: 'bg-green-100 text-green-700',   dot: '🟢' },
        completed:         { label: 'مكتمل',             color: 'bg-emerald-100 text-emerald-700', dot: '✅' },
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    async function init() {
        console.log('[Designer] init() called');
        _navToken = Date.now();
        const reviewTab = document.getElementById('designer-tab-review');
        if (reviewTab && _isManager()) {
            reviewTab.style.display = '';
        }
        const clientReviewTab = document.getElementById('designer-tab-client-review');
        if (clientReviewTab && _isManager()) {
            clientReviewTab.style.display = '';
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

            const completedRes = await window.apiFetch('/api/designer/my-completed');
            _completedTasks = completedRes.tasks || [];

            if (_isManager()) {
                try {
                    const reviewRes = await window.apiFetch('/api/designer/pending-review');
                    _reviewTasks = reviewRes.orders || [];
                } catch (e) {
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
        if (!grid) return;

        let tasks;
        if (_currentTab === 'completed') {
            tasks = _completedTasks;
        } else if (_currentTab === 'review') {
            tasks = _reviewTasks;
        } else if (_currentTab === 'client_review') {
            tasks = _allTasks.filter(t => (parseInt(t.client_review_count) || 0) > 0);
        } else if (_currentTab === 'waiting_design') {
            tasks = _allTasks.filter(t => (parseInt(t.waiting_count) || 0) > 0);
        } else if (_currentTab === 'in_progress') {
            tasks = _allTasks.filter(t => (parseInt(t.in_progress_count) || 0) > 0);
        } else if (_currentTab === 'manager_review') {
            tasks = _allTasks.filter(t => (parseInt(t.manager_review_count) || 0) > 0);
        } else if (_currentTab === 'client_revision') {
            tasks = _allTasks.filter(t => (parseInt(t.client_revision_count) || 0) > 0);
        } else {
            tasks = _allTasks;
        }

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

        grid.querySelectorAll('[data-task-id]').forEach(card => {
            card.addEventListener('click', () => {
                const taskId = card.getAttribute('data-task-id');
                _openTaskDetail(taskId);
            });
        });
    }

    // ── Render single task card (smart card with all status badges) ──────────
    function _renderTaskCard(task) {
        const waiting = parseInt(task.waiting_count) || 0;
        const inProgress = parseInt(task.in_progress_count) || 0;
        const mgrReview = parseInt(task.manager_review_count) || 0;
        const clientReview = parseInt(task.client_review_count) || 0;
        const approved = parseInt(task.approved_count) || 0;
        const clientRevision = parseInt(task.client_revision_count) || 0;
        const itemCount = parseInt(task.item_count) || 0;
        const designedCount = parseInt(task.designed_count) || 0;
        const progress = itemCount > 0 ? Math.round((designedCount / itemCount) * 100) : 0;

        // Smart badges — show all non-zero counts
        const badges = [];
        if (waiting > 0)        badges.push(`<span class="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">🟡 بانتظار: ${waiting}</span>`);
        if (inProgress > 0)     badges.push(`<span class="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700">🔵 قيد التنفيذ: ${inProgress}</span>`);
        if (mgrReview > 0)      badges.push(`<span class="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700">🟣 مراجعة: ${mgrReview}</span>`);
        if (clientReview > 0)   badges.push(`<span class="text-xs px-2 py-1 rounded-full bg-cyan-100 text-cyan-700">🔷 للعميل: ${clientReview}</span>`);
        if (clientRevision > 0) badges.push(`<span class="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700">🟠 تعديل: ${clientRevision}</span>`);
        if (approved > 0)       badges.push(`<span class="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">🟢 معتمد: ${approved}</span>`);

        return `
            <div data-task-id="${task.id}"
                 class="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md hover:border-brand-300 transition-all cursor-pointer">
                <div class="flex items-start justify-between mb-3">
                    <div>
                        <p class="font-bold text-slate-800 text-sm">#${task.order_number}</p>
                        <p class="text-xs text-slate-500 mt-0.5">${_esc(task.client_name)}</p>
                        ${task.designer_name ? `<p class="text-xs text-brand-600 mt-0.5"><i class="fa-solid fa-user-pen ml-1"></i>${_esc(task.designer_name)}</p>` : ''}
                    </div>
                    <div class="flex flex-col gap-1 items-end">
                        ${badges.length > 0 ? badges.join('') : `<span class="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">${_statusLabel(task.design_status)}</span>`}
                    </div>
                </div>
                <div class="space-y-2">
                    <div class="flex items-center justify-between text-xs text-slate-500">
                        <span>عدد الأصناف: ${itemCount}</span>
                        <span>المصمم: ${designedCount}/${itemCount}</span>
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
        const waiting = _allTasks.filter(t => (parseInt(t.waiting_count) || 0) > 0).length;
        const inProgress = _allTasks.filter(t => (parseInt(t.in_progress_count) || 0) > 0).length;
        const mgrReview = _allTasks.filter(t => (parseInt(t.manager_review_count) || 0) > 0).length;
        const clientReview = _allTasks.filter(t => (parseInt(t.client_review_count) || 0) > 0).length;
        const clientRevision = _allTasks.filter(t => (parseInt(t.client_revision_count) || 0) > 0).length;
        const completed = _completedTasks.length;
        const review = _reviewTasks.length;

        const els = {
            'designer-tab-pending-count': waiting,
            'designer-tab-progress-count': inProgress,
            'designer-tab-revision-count': clientRevision,
            'designer-tab-completed-count': completed,
            'designer-tab-review-count': review,
            'designer-tab-client-review-count': clientReview,
        };

        for (const [id, count] of Object.entries(els)) {
            const el = document.getElementById(id);
            if (el) el.textContent = count;
        }
    }

    // ── Open task detail (context-aware: pass current tab status to API) ──────
    async function _openTaskDetail(taskId) {
        try {
            // Map current tab to status filter for context-aware modal
            const statusMap = {
                'waiting_design': 'waiting_design',
                'in_progress': 'in_progress',
                'manager_review': 'manager_review',
                'client_review': 'client_review',
                'client_revision': 'client_revision',
                'review': 'manager_review',  // manager review tab
                'completed': null,           // no filter for completed
            };
            const statusFilter = statusMap[_currentTab] || null;
            const url = statusFilter
                ? `/api/designer/task/${taskId}?status=${statusFilter}`
                : `/api/designer/task/${taskId}`;

            const res = await window.apiFetch(url);
            _currentTask = res;

            const isManagerRole = _isManager();
            const isManagerView = isManagerRole && (_currentTab === 'review' || _currentTab === 'manager_review' || _currentTab === 'client_review' || _currentTab === 'client_revision');

            const modal = document.getElementById('designer-task-modal');
            const title = document.getElementById('designer-modal-title');
            const client = document.getElementById('designer-modal-client');
            const body = document.getElementById('designer-modal-body');
            const status = document.getElementById('designer-modal-status');
            const sendClientBtn = document.getElementById('designer-send-client-btn');

            // Modal title includes context
            const tabLabel = _currentTab !== 'completed' ? STATUS_DEFS[_currentTab]?.label || '' : '';
            if (title) title.textContent = `عرض سعر #${res.order.order_number}${tabLabel ? ' — ' + tabLabel : ''}`;
            if (client) client.textContent = res.order.client_name;
            if (status) status.textContent = `الحالة: ${_statusLabel(res.order.design_status)}`;

            // Hide the order-level send-to-client button (we use per-item now)
            if (sendClientBtn) sendClientBtn.classList.add('hidden');

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

            // Client response banner
            if (res.order.design_client_status === 'approved') {
                html += `
                    <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
                        <i class="fa-solid fa-circle-check text-emerald-500 text-xl"></i>
                        <div>
                            <p class="text-sm font-bold text-emerald-700">تمت موافقة العميل على جميع التصاميم</p>
                            <p class="text-xs text-emerald-600">الطلب بانتظار تحويله للإنتاج</p>
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
            } else if (res.order.design_client_status === 'sent') {
                html += `
                    <div class="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
                        <i class="fa-solid fa-paper-plane text-blue-500 text-xl"></i>
                        <div>
                            <p class="text-sm font-bold text-blue-700">تم إرسال التصاميم للعميل</p>
                            <p class="text-xs text-blue-600">بانتظار رد العميل</p>
                        </div>
                    </div>
                `;
            }

            // Items
            html += `<div class="space-y-3">`;
            if (res.items && res.items.length > 0) {
                res.items.forEach(item => {
                    html += _renderItemCard(item, res.order.id, isManagerView);
                });
            } else {
                html += `<p class="text-sm text-slate-400 text-center py-4">لا توجد أصناف في هذه الحالة</p>`;
            }
            html += `</div>`;

            // Workflow history (if available)
            if (res.workflow_history && res.workflow_history.length > 0 && isManagerRole) {
                html += `
                    <div class="bg-slate-50 rounded-xl p-4 mt-4">
                        <p class="text-xs font-semibold text-slate-600 mb-2"><i class="fa-solid fa-clock-rotate-left ml-1"></i>سجل الحالات</p>
                        <div class="space-y-1">
                            ${res.workflow_history.map(h => `
                                <div class="flex items-center gap-2 text-xs text-slate-500">
                                    <span class="text-slate-400">${h.changed_at ? new Date(h.changed_at).toLocaleString('ar-SA') : ''}</span>
                                    <span class="font-semibold text-slate-600">${_statusLabel(h.from_state)}</span>
                                    <i class="fa-solid fa-arrow-left text-slate-300"></i>
                                    <span class="font-semibold text-slate-700">${_statusLabel(h.to_state)}</span>
                                    ${h.actor_name ? `<span class="text-slate-400">— ${_esc(h.actor_name)}</span>` : ''}
                                    ${h.transition_reason ? `<span class="text-[10px] px-1 py-0.5 rounded bg-slate-200 text-slate-600">${_esc(h.transition_reason)}</span>` : ''}
                                    ${h.notes ? `<span class="text-slate-400">(${_esc(h.notes)})</span>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            if (body) body.innerHTML = html;
            if (modal) modal.classList.remove('hidden');

            _bindItemEvents(res.order.id, res.items);

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
        const st = STATUS_DEFS[item.design_status] || STATUS_DEFS.waiting_design;

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

        let briefFilesHtml = '';
        if (item.design_brief_files && item.design_brief_files.length > 0) {
            briefFilesHtml = `
                <div class="mt-2 bg-brand-50 border border-brand-200 rounded-lg p-2">
                    <p class="text-xs font-semibold text-brand-700 mb-1"><i class="fa-solid fa-paperclip ml-1"></i>ملفات مرجعية من المدير:</p>
                    <div class="flex flex-wrap gap-2">
                        ${item.design_brief_files.map(f => `
                            <a href="${f.path}" target="_blank" class="flex items-center gap-1 px-2 py-1 bg-white border border-brand-200 rounded-lg text-xs hover:border-brand-400 transition-colors">
                                <i class="fa-solid fa-file text-brand-400"></i>
                                <span class="text-slate-600">${_esc(f.original_name || f.filename)}</span>
                            </a>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        let revisionHtml = '';
        if (item.design_status === 'client_revision' && item.revision_notes) {
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

        const canStart = !isManagerView && item.design_status === 'waiting_design';
        const canSubmit = !isManagerView && (item.design_status === 'in_progress' || item.design_status === 'client_revision');
        const canReview = isManagerView && item.design_status === 'manager_review';
        const canSendToClient = isManagerView && item.design_status === 'manager_review' && item.design_files && item.design_files.length > 0;
        const isInClientReview = isManagerView && item.design_status === 'client_review';

        return `
            <div class="bg-white border border-slate-200 rounded-xl p-4" data-item-id="${item.id}">
                <div class="flex items-start justify-between mb-2">
                    <div>
                        <p class="font-semibold text-slate-800 text-sm">${_esc(item.product_name || 'صنف')} — ${_esc(item.size || '')}</p>
                    </div>
                    <div class="flex flex-col gap-1 items-end">
                        <span class="text-xs px-2 py-1 rounded-full ${st.color}">${st.label}</span>
                        ${(parseInt(item.design_version) || 0) > 0 ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">v${item.design_version}</span>` : ''}
                    </div>
                </div>

                ${item.design_notes ? `<p class="text-xs text-slate-600 bg-slate-50 rounded-lg p-2 mt-2"><i class="fa-solid fa-comment-dots ml-1 text-slate-400"></i>${_esc(item.design_notes)}</p>` : ''}

                ${briefFilesHtml}
                ${revisionHtml}
                ${clientRevisionHtml}
                ${clientApprovedHtml}
                ${filesHtml}

                ${item.designer_notes ? `<p class="text-xs text-slate-500 mt-2">${isManagerView ? 'ملاحظات المصمم' : 'ملاحظاتك'}: ${_esc(item.designer_notes)}</p>` : ''}

                ${canReview ? `
                    <div class="mt-3 space-y-2 border-t border-slate-100 pt-3">
                        <div class="flex gap-2">
                            <button class="manager-approve-btn px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs transition-colors" data-item-id="${item.id}" data-order-id="${orderId}">
                                <i class="fa-solid fa-check ml-1"></i>اعتماد وإرسال للعميل
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

                ${canSendToClient ? `
                    <div class="mt-2 border-t border-slate-100 pt-2">
                        <button class="item-send-client-btn px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-xs transition-colors" data-item-id="${item.id}" data-order-id="${orderId}">
                            <i class="fa-solid fa-share ml-1"></i>إرسال للعميل (رابط مستقل)
                        </button>
                    </div>
                ` : ''}

                ${isInClientReview ? `
                    <div class="mt-2 border-t border-slate-100 pt-2">
                        ${item.review_sent_at ? `<p class="text-[10px] text-slate-400 mb-2"><i class="fa-solid fa-clock ml-1"></i>آخر إرسال: ${new Date(item.review_sent_at).toLocaleString('ar-SA')}</p>` : ''}
                        <div class="flex flex-wrap gap-2">
                            <button class="item-copy-link-btn px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition-colors" data-item-id="${item.id}" data-order-id="${orderId}">
                                <i class="fa-solid fa-copy ml-1"></i>نسخ الرابط
                            </button>
                            <button class="item-resend-btn px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-xs transition-colors" data-item-id="${item.id}" data-order-id="${orderId}">
                                <i class="fa-solid fa-paper-plane ml-1"></i>إعادة إرسال
                            </button>
                        </div>
                    </div>
                ` : ''}

                ${canStart || canSubmit ? `
                    <div class="mt-3 space-y-2 border-t border-slate-100 pt-3">
                        ${canSubmit ? `
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
                        ` : ''}

                        <div class="flex gap-2">
                            ${canStart ? `
                                <button class="designer-start-btn px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs transition-colors" data-item-id="${item.id}" data-order-id="${orderId}">
                                    <i class="fa-solid fa-play ml-1"></i>بدء التصميم
                                </button>
                            ` : ''}
                            ${canSubmit ? `
                                <button class="designer-submit-btn px-3 py-2 bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-xs transition-colors" data-item-id="${item.id}" data-order-id="${orderId}">
                                    <i class="fa-solid fa-paper-plane ml-1"></i>تسليم التصميم
                                </button>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}
            </div>

            <!-- Timeline section -->
            <div class="mt-3 border-t border-slate-100 pt-3">
                <button class="item-timeline-btn text-xs text-slate-500 hover:text-brand-700 transition-colors" data-item-id="${item.id}" data-order-id="${orderId}">
                    <i class="fa-solid fa-clock-rotate-left ml-1"></i>الجدول الزمني
                </button>
                <div class="item-timeline-container hidden mt-3" data-item-id="${item.id}"></div>
            </div>
        `;
    }

    // ── Render timeline ──────────────────────────────────────────────────────
    const TIMELINE_EVENTS = {
        'link_opened':              { icon: 'fa-link', label: 'فتح العميل الرابط', color: 'text-sky-500' },
        'design_viewed':            { icon: 'fa-eye', label: 'تم عرض التصميم', color: 'text-slate-500' },
        'image_zoomed':             { icon: 'fa-magnifying-glass-plus', label: 'تكبير صورة', color: 'text-slate-500' },
        'file_downloaded':          { icon: 'fa-download', label: 'تحميل ملف', color: 'text-slate-500' },
        'approve_form_opened':      { icon: 'fa-form', label: 'فتح نموذج الاعتماد', color: 'text-emerald-500' },
        'signature_captured':       { icon: 'fa-signature', label: 'تم التقاط التوقيع', color: 'text-emerald-500' },
        'item_approved':            { icon: 'fa-circle-check', label: 'تم الاعتماد', color: 'text-emerald-600' },
        'item_revision_requested':  { icon: 'fa-rotate-left', label: 'طلب تعديل', color: 'text-orange-500' },
        'item_sent_to_client':      { icon: 'fa-paper-plane', label: 'إرسال للعميل', color: 'text-cyan-500' },
        'sent_to_client':           { icon: 'fa-paper-plane', label: 'إرسال للعميل', color: 'text-cyan-500' },
        'approval_package_generated': { icon: 'fa-box-archive', label: 'توليد حزمة الاعتماد', color: 'text-purple-500' },
        'state_transition':         { icon: 'fa-arrow-left', label: 'تغيير الحالة', color: 'text-brand-600' },
    };

    function _renderTimeline(timeline) {
        if (!timeline || timeline.length === 0) return '<p class="text-xs text-slate-400">لا توجد أحداث</p>';

        return `<div class="relative pr-4">
            ${timeline.map((entry, idx) => {
                const ev = TIMELINE_EVENTS[entry.event] || { icon: 'fa-circle', label: entry.event, color: 'text-slate-400' };
                const time = new Date(entry.timestamp).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
                const isLast = idx === timeline.length - 1;

                let extra = '';
                if (entry.type === 'workflow') {
                    extra = `<span class="text-[10px] text-slate-400">${entry.from_state} ← ${entry.to_state}</span>`;
                    if (entry.reason) extra += ` <span class="text-[10px] text-slate-400">(${entry.reason})</span>`;
                }
                if (entry.ip) {
                    extra += ` <span class="text-[10px] text-slate-300">IP: ${entry.ip}</span>`;
                }

                return `
                    <div class="flex gap-2 ${isLast ? '' : 'pb-3'}">
                        <div class="flex flex-col items-center">
                            <div class="w-6 h-6 rounded-full bg-slate-50 flex items-center justify-center flex-shrink-0">
                                <i class="fa-solid ${ev.icon} text-[10px] ${ev.color}"></i>
                            </div>
                            ${!isLast ? '<div class="w-px flex-1 bg-slate-200 mt-1"></div>' : ''}
                        </div>
                        <div class="flex-1 pb-1">
                            <p class="text-xs font-semibold text-slate-700">${ev.label}</p>
                            <p class="text-[10px] text-slate-400">${time} ${extra}</p>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>`;
    }

    // ── Bind events ───────────────────────────────────────────────────────────
    function _bindEvents() {
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

        const refreshBtn = document.getElementById('designer-refresh-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', _loadTasks);

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
                    window.showToast?.(err.message || 'فشل في بدء التصميم', 'error');
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
                    const response = await fetch(url, {
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
        return STATUS_DEFS[status]?.label || status || '—';
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
                    await _openTaskDetail(orderId);
                    await _loadTasks();
                } catch (err) {
                    window.showToast?.(err.message || 'فشل في اعتماد التصميم', 'error');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-check ml-1"></i>اعتماد وإرسال للعميل';
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

        // Per-item send to client buttons
        document.querySelectorAll('.item-send-client-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const itemId = btn.getAttribute('data-item-id');
                const oid = btn.getAttribute('data-order-id');
                if (!confirm('هل تريد إرسال تصميم هذا الصنف للعميل؟')) return;
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin ml-1"></i>جاري الإرسال...';
                try {
                    const res = await window.apiFetch(`/api/designer/item/${oid}/${itemId}/send-to-client`, {
                        method: 'POST',
                    });
                    window.showToast?.(res.message || 'تم إنشاء رابط المراجعة', 'success');
                    if (res.share_url) {
                        try {
                            await navigator.clipboard.writeText(res.share_url);
                            window.showToast?.('تم نسخ رابط المراجعة للحافظة', 'success');
                        } catch {
                            window.showToast?.(`رابط المراجعة: ${res.share_url}`, 'info');
                        }
                    }
                    await _openTaskDetail(orderId);
                    await _loadTasks();
                } catch (err) {
                    window.showToast?.(err.message || 'فشل في إرسال التصميم', 'error');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-share ml-1"></i>إرسال للعميل (رابط مستقل)';
                }
            });
        });

        // Copy review link buttons
        document.querySelectorAll('.item-copy-link-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const itemId = btn.getAttribute('data-item-id');
                const oid = btn.getAttribute('data-order-id');
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin ml-1"></i>جاري...';
                try {
                    const res = await window.apiFetch(`/api/designer/item/${oid}/${itemId}/resend-review`, {
                        method: 'POST',
                    });
                    if (res.share_url) {
                        try {
                            await navigator.clipboard.writeText(res.share_url);
                            window.showToast?.('تم نسخ رابط المراجعة للحافظة', 'success');
                        } catch {
                            window.showToast?.(`رابط المراجعة: ${res.share_url}`, 'info');
                        }
                    }
                } catch (err) {
                    window.showToast?.(err.message || 'فشل في جلب الرابط', 'error');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-copy ml-1"></i>نسخ الرابط';
                }
            });
        });

        // Resend review link buttons
        document.querySelectorAll('.item-resend-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const itemId = btn.getAttribute('data-item-id');
                const oid = btn.getAttribute('data-order-id');
                if (!confirm('سيتم إنشاء رابط جديد وإلغاء الرابط القديم. متابعة؟')) return;
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin ml-1"></i>جاري الإرسال...';
                try {
                    const res = await window.apiFetch(`/api/designer/item/${oid}/${itemId}/resend-review`, {
                        method: 'POST',
                    });
                    window.showToast?.(res.message || 'تم إعادة إرسال الرابط', 'success');
                    if (res.share_url) {
                        try {
                            await navigator.clipboard.writeText(res.share_url);
                            window.showToast?.('تم نسخ الرابط الجديد للحافظة', 'success');
                        } catch {
                            window.showToast?.(`الرابط الجديد: ${res.share_url}`, 'info');
                        }
                    }
                    await _openTaskDetail(orderId);
                    await _loadTasks();
                } catch (err) {
                    window.showToast?.(err.message || 'فشل في إعادة الإرسال', 'error');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-paper-plane ml-1"></i>إعادة إرسال';
                }
            });
        });

        // Legacy order-level send to client button
        const sendBtn = document.getElementById('designer-send-client-btn');
        if (sendBtn) {
            sendBtn.onclick = async () => {
                if (!confirm('هل تريد إرسال جميع التصاميم للعميل للمراجعة؟')) return;
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

        // Timeline buttons
        document.querySelectorAll('.item-timeline-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const itemId = btn.getAttribute('data-item-id');
                const oid = btn.getAttribute('data-order-id');
                const container = document.querySelector(`.item-timeline-container[data-item-id="${itemId}"]`);

                if (!container) return;

                // Toggle visibility
                if (!container.classList.contains('hidden')) {
                    container.classList.add('hidden');
                    return;
                }

                container.classList.remove('hidden');
                container.innerHTML = '<div class="text-xs text-slate-400"><i class="fa-solid fa-spinner fa-spin ml-1"></i>جاري التحميل...</div>';

                try {
                    const res = await window.apiFetch(`/api/designer/item/${oid}/${itemId}/timeline`);
                    if (res.timeline && res.timeline.length > 0) {
                        container.innerHTML = _renderTimeline(res.timeline);
                    } else {
                        container.innerHTML = '<p class="text-xs text-slate-400">لا توجد أحداث مسجلة</p>';
                    }
                } catch (err) {
                    container.innerHTML = `<p class="text-xs text-red-400">${err.message || 'فشل في تحميل الجدول الزمني'}</p>`;
                }
            });
        });
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
