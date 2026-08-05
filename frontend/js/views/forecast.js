// =============================================================================
// G.PACK 2.0 - AI Intelligence Center View
// RFM Segmentation + Churn Alerts + Demand Forecasting
// =============================================================================

var forecastView = {
    chart: null,
    currentData: null,
    rfmData: null,
    churnData: null,
    activeTab: 'briefing',
    chatMessages: [],
    chatSessionId: null,
    chatLoading: false,
    chatAiEnabled: null,
    briefingLoaded: false,
    chatInitialized: false,
    goalsLoaded: false,
    pricingBound: false,
    actionsLoaded: false,

    init() {
        this.bindTabEvents();
        this.bindEvents();
        this.bindBriefingEvents();
        // Load briefing immediately (active tab on page open)
        this.loadBriefing();
    },

    bindBriefingEvents() {
        const refreshBtn = document.getElementById('briefing-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', () => {
            this.briefingLoaded = false;
            this.loadBriefing();
        });
        const retryBtn = document.getElementById('briefing-retry');
        if (retryBtn) retryBtn.addEventListener('click', () => this.loadBriefing());
    },

    // ── Tab Switching ────────────────────────────────────────────────────────
    bindTabEvents() {
        document.querySelectorAll('.ai-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-tab');
                this.switchTab(tab);
            });
        });
    },

    switchTab(tab) {
        this.activeTab = tab;

        // Update button styles
        document.querySelectorAll('.ai-tab-btn').forEach(btn => {
            const isActive = btn.getAttribute('data-tab') === tab;
            btn.classList.toggle('active', isActive);
            btn.classList.toggle('text-brand-700', isActive);
            btn.classList.toggle('border-brand-700', isActive);
            btn.classList.toggle('text-slate-500', !isActive);
            btn.classList.toggle('border-transparent', !isActive);
        });

        // Show/hide panels
        document.querySelectorAll('.ai-tab-panel').forEach(panel => {
            panel.classList.toggle('hidden', panel.id !== 'tab-' + tab);
        });

        // Lazy-load tab content
        if (tab === 'briefing' && !this.briefingLoaded) {
            this.loadBriefing();
        } else if (tab === 'chat' && !this.chatInitialized) {
            this.initChat();
        } else if (tab === 'rfm') {
            if (!this.rfmData) this.loadRFM();
        } else if (tab === 'churn') {
            if (!this.churnData) this.loadChurn();
        } else if (tab === 'forecast') {
            if (!document.getElementById('forecast-client').dataset.loaded) {
                this.loadClients();
            }
        } else if (tab === 'goals') {
            if (!this.goalsLoaded) this.loadGoals();
        } else if (tab === 'pricing') {
            if (!this.pricingBound) this.bindPricingEvents();
        } else if (tab === 'actions') {
            if (!this.actionsLoaded) this.loadActions();
        }
    },

    // ── Daily Briefing ──────────────────────────────────────────────────────
    async loadBriefing() {
        const loading = document.getElementById('briefing-loading');
        const content = document.getElementById('briefing-content');
        const errorEl = document.getElementById('briefing-error');
        if (loading) loading.classList.remove('hidden');
        if (content) content.classList.add('hidden');
        if (errorEl) errorEl.classList.add('hidden');

        try {
            const data = await window.apiFetch('/api/ai-assistant/briefing', { method: 'GET' });
            this.briefingLoaded = true;
            this.renderBriefing(data);
            if (loading) loading.classList.add('hidden');
            if (content) content.classList.remove('hidden');
        } catch (err) {
            console.error('[AI Briefing] Error:', err);
            if (loading) loading.classList.add('hidden');
            if (errorEl) errorEl.classList.remove('hidden');
        }
    },

    renderBriefing(data) {
        if (!data) return;

        // Date
        const dateEl = document.getElementById('briefing-date');
        if (dateEl) dateEl.textContent = data.date || new Date().toISOString().split('T')[0];

        // Summary — build from available data since backend doesn't provide a text summary
        const summaryEl = document.getElementById('briefing-summary');
        if (summaryEl) {
            var parts = [];
            if (data.today_invoice_count > 0) parts.push('عدد فواتير اليوم: ' + data.today_invoice_count + ' بإجمالي ' + Number(data.today_sales).toLocaleString() + ' ر.س');
            if (data.pending_quotes > 0) parts.push('لديك ' + data.pending_quotes + ' عرض سعر معلق');
            if (data.low_stock_count > 0) parts.push(data.low_stock_count + ' صنف قارب على النفاد');
            if (data.outstanding_count > 0) parts.push('مستحقات معلقة على ' + data.outstanding_count + ' فاتورة بقيمة ' + Number(data.total_outstanding).toLocaleString() + ' ر.س');
            if (data.overdue_tasks > 0) parts.push(data.overdue_tasks + ' مهمة متأخرة');
            if (data.active_production > 0) parts.push(data.active_production + ' أمر تشغيل جاري');
            if (data.pending_deliveries > 0) parts.push(data.pending_deliveries + ' سند تسليم معلق');
            summaryEl.textContent = parts.length > 0 ? parts.join('، ') + '.' : 'لا توجد بيانات بارزة اليوم.';
        }

        // Stats cards — match backend response field names
        const statsEl = document.getElementById('briefing-stats');
        if (statsEl) {
            const cards = [];

            cards.push(this._statCard('مبيعات اليوم', data.today_invoice_count + ' فاتورة', Number(data.today_sales).toLocaleString() + ' ر.س', 'emerald', 'fa-chart-line'));
            cards.push(this._statCard('عروض معلقة', data.pending_quotes, 'في انتظار الرد', 'amber', 'fa-file-lines'));
            cards.push(this._statCard('أصناف قاربت النفاد', data.low_stock_count, 'تحتاج إعادة طلب', 'orange', 'fa-boxes-stacked'));
            cards.push(this._statCard('مستحقات معلقة', Number(data.total_outstanding).toLocaleString() + ' ر.س', data.outstanding_count + ' فاتورة', 'rose', 'fa-hand-holding-dollar'));
            cards.push(this._statCard('مهام متأخرة', data.overdue_tasks, 'تحتاج متابعة', 'red', 'fa-clock'));
            cards.push(this._statCard('أوامر تشغيل جارية', data.active_production, 'في الإنتاج', 'violet', 'fa-industry'));
            cards.push(this._statCard('سندات تسليم معلقة', data.pending_deliveries, 'للتسليم', 'cyan', 'fa-truck'));

            statsEl.innerHTML = cards.join('');
        }

        // Alerts — build from data since backend returns alert_count, not alerts array
        const alertsEl = document.getElementById('briefing-alerts');
        if (alertsEl) {
            const alerts = [];
            if (data.low_stock_count > 0) alerts.push({ severity: 'critical', message: data.low_stock_count + ' صنف قارب على النفاد ويحتاج إعادة طلب' });
            if (data.overdue_tasks > 0) alerts.push({ severity: 'warning', message: data.overdue_tasks + ' مهمة متأخرة تحتاج متابعة' });
            if (data.pending_quotes > 5) alerts.push({ severity: 'warning', message: data.pending_quotes + ' عرض سعر معلق — أكثر من 5 عروض تحتاج متابعة' });
            if (data.outstanding_count > 10) alerts.push({ severity: 'warning', message: data.outstanding_count + ' فاتورة بمستحقات معلقة — أكثر من 10 فواتير' });

            if (alerts.length === 0) {
                alertsEl.innerHTML = '<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center text-sm text-emerald-600"><i class="fa-solid fa-shield-halved ml-1"></i> لا توجد تنبيهات حرجة اليوم</div>';
            } else {
                alertsEl.innerHTML = alerts.map(a => {
                    const color = a.severity === 'critical' ? 'border-red-300 bg-red-50 text-red-700'
                        : a.severity === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600';
                    return '<div class="px-4 py-3 rounded-xl border ' + color + ' text-sm flex items-center gap-2"><i class="fa-solid fa-circle-exclamation flex-shrink-0"></i><span>' + this._esc(a.message) + '</span></div>';
                }).join('');
            }
        }
    },

    _statCard(label, value, sub, color, icon) {
        const colors = {
            emerald: { grad: 'from-emerald-50 to-teal-50', border: 'border-emerald-200', value: 'text-emerald-900', label: 'text-emerald-600', icon: 'text-emerald-500' },
            blue:    { grad: 'from-blue-50 to-cyan-50',    border: 'border-blue-200',    value: 'text-blue-900',    label: 'text-blue-600',    icon: 'text-blue-500' },
            amber:   { grad: 'from-amber-50 to-yellow-50', border: 'border-amber-200',   value: 'text-amber-900',   label: 'text-amber-600',   icon: 'text-amber-500' },
            orange:  { grad: 'from-orange-50 to-amber-50', border: 'border-orange-200',  value: 'text-orange-900',  label: 'text-orange-600',  icon: 'text-orange-500' },
            rose:    { grad: 'from-rose-50 to-red-50',     border: 'border-rose-200',    value: 'text-rose-900',    label: 'text-rose-600',    icon: 'text-rose-500' },
            red:     { grad: 'from-red-50 to-rose-50',     border: 'border-red-200',     value: 'text-red-900',     label: 'text-red-600',     icon: 'text-red-500' },
            violet:  { grad: 'from-violet-50 to-purple-50', border: 'border-violet-200', value: 'text-violet-900',  label: 'text-violet-600',  icon: 'text-violet-500' },
            cyan:    { grad: 'from-cyan-50 to-blue-50',    border: 'border-cyan-200',    value: 'text-cyan-900',    label: 'text-cyan-600',    icon: 'text-cyan-500' },
        };
        const c = colors[color] || colors.blue;
        return '<div class="bg-gradient-to-br ' + c.grad + ' rounded-xl p-4 border ' + c.border + '">' +
            '<div class="flex items-center justify-between mb-1"><span class="text-xs font-medium ' + c.label + '">' + label + '</span>' +
            '<i class="fa-solid ' + icon + ' ' + c.icon + '"></i></div>' +
            '<p class="text-xl font-bold ' + c.value + '">' + value + '</p>' +
            (sub ? '<p class="text-xs ' + c.label + ' mt-0.5">' + sub + '</p>' : '') +
            '</div>';
    },

    // ── AI Chat (Page-level) ────────────────────────────────────────────────
    initChat() {
        this.chatInitialized = true;
        this.checkChatHealth();
        this.renderChatSuggestions();
        this.bindChatEvents();
        this.renderChatMessages();
    },

    async checkChatHealth() {
        const statusEl = document.getElementById('ai-chat-status');
        if (!statusEl) return;
        try {
            const res = await window.apiFetch('/api/ai-assistant/health');
            this.chatAiEnabled = res.enabled;
            statusEl.textContent = res.enabled ? 'متصل' : 'غير متصل';
            statusEl.className = 'text-xs ' + (res.enabled ? 'text-emerald-600' : 'text-slate-400');
        } catch {
            this.chatAiEnabled = false;
            statusEl.textContent = 'غير متصل';
            statusEl.className = 'text-xs text-slate-400';
        }
    },

    renderChatSuggestions() {
        const container = document.getElementById('ai-page-chat-suggestions');
        if (!container) return;

        var role = (window.GpackUser && window.GpackUser.role || '').toLowerCase();
        var suggestions = role === 'sales_rep' ? [
            { text: 'إيه عروضي المعلقة؟', icon: 'fa-file-lines' },
            { text: 'إيه آخر طلباتي؟', icon: 'fa-clipboard-list' },
            { text: 'أكثر منتجاتي مبيعاً', icon: 'fa-trophy' },
            { text: 'إيه مستحقات عملائي؟', icon: 'fa-hand-holding-dollar' },
        ] : [
            { text: 'إيه إجمالي مبيعات اليوم؟', icon: 'fa-chart-line' },
            { text: 'أكثر 5 منتجات مبيعاً هذا الشهر', icon: 'fa-trophy' },
            { text: 'حالة المخزون — إيه اللي قارب على النفاد؟', icon: 'fa-boxes-stacked' },
            { text: 'إيه المستحقات المعلقة على العملاء؟', icon: 'fa-hand-holding-dollar' },
            { text: 'كم عرض سعر معلق حالياً؟', icon: 'fa-file-lines' },
        ];

        container.innerHTML = suggestions.map(s =>
            '<button class="ai-page-chip text-xs px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 hover:bg-brand-100 hover:text-brand-700 transition-colors whitespace-nowrap" data-question="' + this._esc(s.text) + '">' +
            '<i class="fa-solid ' + s.icon + ' ml-1 text-[10px]"></i>' + s.text + '</button>'
        ).join('');

        container.querySelectorAll('.ai-page-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const q = chip.getAttribute('data-question');
                const input = document.getElementById('ai-page-chat-input');
                if (input) { input.value = q; this.sendChatMessage(); }
            });
        });
    },

    bindChatEvents() {
        const sendBtn = document.getElementById('ai-page-chat-send');
        if (sendBtn) sendBtn.addEventListener('click', () => this.sendChatMessage());

        const input = document.getElementById('ai-page-chat-input');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendChatMessage();
                }
            });
        }

        const clearBtn = document.getElementById('ai-chat-clear');
        if (clearBtn) clearBtn.addEventListener('click', () => {
            this.chatMessages = [];
            this.chatSessionId = null;
            this.renderChatMessages();
        });

        // Voice input
        const micBtn = document.getElementById('ai-page-chat-mic');
        if (micBtn && input) {
            this._bindVoiceInput(micBtn, input);
        }
    },

    _bindVoiceInput(micBtn, input) {
        var isRecording = false;
        var mediaRecorder = null;
        var audioChunks = [];

        micBtn.addEventListener('click', function() {
            if (isRecording) {
                if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
                return;
            }

            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(function(stream) {
                    isRecording = true;
                    micBtn.classList.remove('bg-slate-100', 'text-slate-500', 'hover:bg-slate-200');
                    micBtn.classList.add('bg-rose-500', 'text-white', 'animate-pulse');
                    micBtn.querySelector('i').className = 'fa-solid fa-stop text-sm';

                    audioChunks = [];
                    var mimeType = 'audio/webm';
                    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/ogg';
                    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';

                    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);

                    mediaRecorder.ondataavailable = function(e) {
                        if (e.data.size > 0) audioChunks.push(e.data);
                    };

                    mediaRecorder.onstop = function() {
                        isRecording = false;
                        micBtn.classList.add('bg-slate-100', 'text-slate-500', 'hover:bg-slate-200');
                        micBtn.classList.remove('bg-rose-500', 'text-white', 'animate-pulse');
                        micBtn.querySelector('i').className = 'fa-solid fa-microphone text-sm';
                        stream.getTracks().forEach(function(t) { t.stop(); });

                        if (audioChunks.length === 0) return;
                        var audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
                        var formData = new FormData();
                        formData.append('audio', audioBlob, 'voice.webm');

                        micBtn.disabled = true;
                        micBtn.querySelector('i').className = 'fa-solid fa-spinner fa-spin text-sm';

                        var token = localStorage.getItem('token') || (window.GpackUser && window.GpackUser.token) || '';
                        fetch('/api/ai-assistant/transcribe', {
                            method: 'POST',
                            credentials: 'include',
                            headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                            body: formData,
                        })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            micBtn.disabled = false;
                            micBtn.querySelector('i').className = 'fa-solid fa-microphone text-sm';
                            if (data.success && data.text) {
                                var baseText = input.value || '';
                                input.value = baseText + (baseText && !baseText.endsWith(' ') ? ' ' : '') + data.text;
                                input.focus();
                            } else if (data.error) {
                                if (window.showToast) window.showToast('فشل التعرف الصوتي: ' + data.error, 'warning');
                            } else {
                                if (window.showToast) window.showToast('لم يتم التعرف على الكلام', 'warning');
                            }
                        })
                        .catch(function() {
                            micBtn.disabled = false;
                            micBtn.querySelector('i').className = 'fa-solid fa-microphone text-sm';
                            if (window.showToast) window.showToast('خطأ في الاتصال بخدمة التعرف الصوتي', 'warning');
                        });
                    };

                    mediaRecorder.start();
                })
                .catch(function(err) {
                    isRecording = false;
                    if (window.showToast) {
                        var msg = 'تعذر الوصول للميكروفون';
                        if (err.name === 'NotAllowedError') msg = 'تم رفض إذن الميكروفون';
                        else if (err.name === 'NotFoundError') msg = 'لا يوجد ميكروفون في هذا الجهاز';
                        window.showToast(msg, 'warning');
                    }
                });
        });
    },

    async sendChatMessage() {
        const input = document.getElementById('ai-page-chat-input');
        if (!input) return;
        const text = input.value.trim();
        if (!text || this.chatLoading) return;

        this.chatMessages.push({ role: 'user', content: text });
        input.value = '';
        this.chatLoading = true;
        this.renderChatMessages();
        this._showChatLoading();

        try {
            const ctx = this._getChatContext();
            const res = await window.apiFetch('/api/ai-assistant/chat', {
                method: 'POST',
                body: { message: text, context: ctx, session_id: this.chatSessionId },
            });

            if (res.session_id) this.chatSessionId = res.session_id;

            this.chatMessages.push({
                role: 'assistant',
                content: res.reply || 'عذراً، لم أتمكن من الرد.',
                actions: res.actions,
                proposed_actions: res.proposed_actions,
                messageId: res.message_id,
            });
        } catch (err) {
            let msg = 'حدث خطأ: ' + (err.message || 'تعذّر الاتصال بالمساعد');
            if (err.message && (err.message.includes('504') || err.message.includes('مهلة') || err.message.includes('timeout'))) {
                msg = 'انتهت مهلة الاتصال. حاول تبسيط السؤال.';
            }
            this.chatMessages.push({ role: 'assistant', content: msg });
        } finally {
            this.chatLoading = false;
            this.renderChatMessages();
        }
    },

    _getChatContext() {
        return {
            page: 'مركز الذكاء الاصطناعي',
            page_key: 'forecast',
        };
    },

    _showChatLoading() {
        const msgArea = document.getElementById('ai-page-chat-messages');
        if (!msgArea) return;
        const loadingEl = document.createElement('div');
        loadingEl.id = 'ai-page-chat-loading';
        loadingEl.className = 'flex justify-start';
        loadingEl.innerHTML =
            '<div class="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">' +
            '<div class="flex gap-1"><span class="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style="animation-delay:0ms"></span>' +
            '<span class="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style="animation-delay:150ms"></span>' +
            '<span class="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style="animation-delay:300ms"></span></div></div>';
        msgArea.appendChild(loadingEl);
        this._scrollChatToBottom();
    },

    renderChatMessages() {
        const msgArea = document.getElementById('ai-page-chat-messages');
        if (!msgArea) return;

        // Remove loading indicator if present
        const loadingEl = document.getElementById('ai-page-chat-loading');
        if (loadingEl) loadingEl.remove();

        if (this.chatMessages.length === 0) {
            msgArea.innerHTML =
                '<div class="flex flex-col items-center justify-center h-full text-center py-12">' +
                '<div class="w-16 h-16 rounded-full bg-brand-100 flex items-center justify-center mb-3"><i class="fa-solid fa-robot text-2xl text-brand-700"></i></div>' +
                '<p class="text-sm font-semibold text-slate-700 mb-1">أهلاً بك في المساعد الذكي</p>' +
                '<p class="text-xs text-slate-400 mb-4">اسألني عن مبيعاتك، عملائك، مخزونك، مورديك والمزيد</p>' +
                '<button id="ai-chat-load-history" class="text-xs bg-white border border-slate-300 rounded-lg px-4 py-2 hover:bg-slate-50 transition-colors text-slate-600"><i class="fa-solid fa-clock-rotate-left ml-1"></i> تحميل المحادثات السابقة</button>' +
                '</div>';
            var histBtn = document.getElementById('ai-chat-load-history');
            if (histBtn) histBtn.addEventListener('click', () => this.loadChatHistory());
            return;
        }

        msgArea.innerHTML = this.chatMessages.map(m => this._renderChatMessage(m)).join('');

        // Bind action buttons
        msgArea.querySelectorAll('.ai-page-action-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                var msgEl = this.closest('[data-msg-actions]');
                if (!msgEl) return;
                try {
                    var actions = JSON.parse(msgEl.getAttribute('data-msg-actions') || '[]');
                    var idx = parseInt(this.getAttribute('data-action-idx') || '0');
                    var action = actions[idx];
                    if (action && action.type === 'navigate' && window.navigateTo) {
                        window.navigateTo(action.params);
                    }
                } catch(e) {}
            });
        });

        // Bind feedback buttons
        msgArea.querySelectorAll('.ai-feedback-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                var msgId = btn.getAttribute('data-msg-id');
                var rating = btn.getAttribute('data-rating');
                this.sendFeedback(msgId, rating, btn);
            });
        });

        this._scrollChatToBottom();
    },

    _renderChatMessage(msg) {
        if (msg.role === 'user') {
            return '<div class="flex justify-end"><div class="bg-brand-700 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[75%] text-sm">' + this._esc(msg.content) + '</div></div>';
        }

        var actionsHtml = '';
        if (msg.actions && msg.actions.length > 0) {
            actionsHtml = '<div class="flex flex-wrap gap-1.5 mt-2">' +
                msg.actions.map((a, i) => '<button class="ai-page-action-btn text-[11px] px-2.5 py-1 rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors border border-brand-200 font-medium" data-action-idx="' + i + '"><i class="fa-solid fa-arrow-left ml-1 text-[9px]"></i>' + this._esc(a.label) + '</button>').join('') +
                '</div>';
        }

        var proposeHtml = '';
        if (msg.proposed_actions && msg.proposed_actions.length > 0) {
            proposeHtml = msg.proposed_actions.map((pa, i) =>
                '<div class="mt-2 p-3 bg-amber-50 border border-amber-300 rounded-xl">' +
                '<div class="flex items-center gap-1.5 mb-1.5"><i class="fa-solid fa-wand-magic-sparkles text-amber-600 text-xs"></i>' +
                '<span class="text-xs font-bold text-amber-800">' + this._esc(pa.label) + '</span></div>' +
                '<div class="text-[11px] text-slate-600">راجع الإجراء المقترح في نافذة المساعد العائمة للتأكيد والتنفيذ.</div></div>'
            ).join('');
        }

        var feedbackHtml = '';
        if (msg.messageId) {
            feedbackHtml = '<div class="flex items-center gap-1 mt-2 pt-1 border-t border-slate-100">' +
                '<button class="ai-feedback-btn text-slate-300 hover:text-emerald-600 transition-colors text-xs px-1.5 py-0.5 rounded" data-msg-id="' + msg.messageId + '" data-rating="positive"><i class="fa-solid fa-thumbs-up"></i></button>' +
                '<button class="ai-feedback-btn text-slate-300 hover:text-red-500 transition-colors text-xs px-1.5 py-0.5 rounded" data-msg-id="' + msg.messageId + '" data-rating="negative"><i class="fa-solid fa-thumbs-down"></i></button>' +
                '</div>';
        }

        return '<div class="flex justify-start" data-msg-actions=\'' + (msg.actions ? this._esc(JSON.stringify(msg.actions)) : '') + '\'>' +
            '<div class="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[75%] text-sm text-slate-700 shadow-sm">' +
            this._esc(msg.content).replace(/\n/g, '<br>') +
            actionsHtml + proposeHtml + feedbackHtml +
            '</div></div>';
    },

    _scrollChatToBottom() {
        const el = document.getElementById('ai-page-chat-messages');
        if (el) el.scrollTop = el.scrollHeight;
    },

    _esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    // ── AI Goals ────────────────────────────────────────────────────────────
    async loadGoals() {
        const loading = document.getElementById('goals-loading');
        const content = document.getElementById('goals-content');
        if (loading) loading.classList.remove('hidden');
        if (content) content.innerHTML = '';

        try {
            const goals = await window.apiFetch('/api/ai-assistant/goals', { method: 'GET' });
            this.goalsLoaded = true;
            this.renderGoals(goals);
            this.bindGoalEvents();
        } catch (err) {
            console.error('[AI Goals] Error:', err);
            if (content) content.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm"><i class="fa-solid fa-circle-exclamation text-2xl mb-2 block"></i>تعذّر تحميل الأهداف</div>';
        } finally {
            if (loading) loading.classList.add('hidden');
        }
    },

    renderGoals(goals) {
        const content = document.getElementById('goals-content');
        if (!content) return;

        // Show create form for managers/admins
        var role = (window.GpackUser && window.GpackUser.role || '').toLowerCase();
        var canManage = role === 'admin' || role === 'manager';
        var createPanel = document.getElementById('goals-create-panel');
        if (createPanel) createPanel.classList.toggle('hidden', !canManage);

        if (!goals || goals.length === 0) {
            content.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm"><i class="fa-solid fa-bullseye text-3xl mb-2 block text-slate-300"></i>لا توجد أهداف نشطة حالياً' + (canManage ? ' — أنشئ هدفاً جديداً من النموذج بالأسفل' : '') + '</div>';
            return;
        }

        var typeLabels = { sales: 'مبيعات', production: 'إنتاج', quotes: 'عروض أسعار', new_clients: 'عملاء جدد' };
        var typeIcons  = { sales: 'fa-chart-line', production: 'fa-industry', quotes: 'fa-file-lines', new_clients: 'fa-user-plus' };
        var typeColors = { sales: 'emerald', production: 'violet', quotes: 'amber', new_clients: 'blue' };

        content.innerHTML = goals.map(g => {
            var pct = g.target_value > 0 ? Math.min(100, Math.round((g.current_value || 0) / g.target_value * 100)) : 0;
            var daysLeft = Math.ceil((new Date(g.end_date) - new Date()) / (1000 * 60 * 60 * 24));
            var daysClass = daysLeft < 0 ? 'text-red-600' : daysLeft <= 7 ? 'text-orange-600' : 'text-slate-500';
            var daysText = daysLeft < 0 ? 'انتهى ' + Math.abs(daysLeft) + ' يوم' : daysLeft + ' يوم متبقي';
            var tc = typeColors[g.goal_type] || 'blue';
            var gradMap = { emerald: 'from-emerald-50 to-teal-50', violet: 'from-violet-50 to-purple-50', amber: 'from-amber-50 to-yellow-50', blue: 'from-blue-50 to-cyan-50' };
            var barMap  = { emerald: 'bg-emerald-500', violet: 'bg-violet-500', amber: 'bg-amber-500', blue: 'bg-blue-500' };
            var textMap = { emerald: 'text-emerald-700', violet: 'text-violet-700', amber: 'text-amber-700', blue: 'text-blue-700' };

            return '<div class="bg-gradient-to-br ' + (gradMap[tc] || gradMap.blue) + ' rounded-xl p-4 border border-slate-200">' +
                '<div class="flex items-center justify-between mb-3">' +
                '<div class="flex items-center gap-2"><i class="fa-solid ' + (typeIcons[g.goal_type] || 'fa-bullseye') + ' ' + (textMap[tc] || '') + '"></i>' +
                '<span class="font-bold text-sm text-slate-800">' + this._esc(g.title) + '</span></div>' +
                '<span class="text-xs ' + daysClass + ' font-medium">' + daysText + '</span></div>' +
                (g.description ? '<p class="text-xs text-slate-500 mb-3">' + this._esc(g.description) + '</p>' : '') +
                '<div class="flex items-center justify-between mb-2">' +
                '<span class="text-xs ' + (textMap[tc] || '') + ' font-medium">' + (typeLabels[g.goal_type] || g.goal_type) + '</span>' +
                '<span class="text-sm font-bold text-slate-800">' + Number(g.current_value || 0).toLocaleString() + ' / ' + Number(g.target_value).toLocaleString() + ' ' + this._esc(g.unit || '') + '</span></div>' +
                '<div class="w-full bg-white/60 rounded-full h-2.5 overflow-hidden">' +
                '<div class="' + (barMap[tc] || barMap.blue) + ' h-full rounded-full transition-all" style="width:' + pct + '%"></div></div>' +
                '<div class="flex items-center justify-between mt-2">' +
                '<span class="text-xs font-bold ' + (textMap[tc] || '') + '">' + pct + '%</span>' +
                (canManage ? '<button class="text-[11px] text-slate-400 hover:text-red-500 transition-colors" onclick="forecastView.completeGoal(' + g.id + ')"><i class="fa-solid fa-check ml-1"></i>إنهاء</button>' : '') +
                '</div></div>';
        }).join('');
    },

    bindGoalEvents() {
        var createBtn = document.getElementById('goal-create-btn');
        if (createBtn) createBtn.addEventListener('click', () => this.createGoal());
        var refreshBtn = document.getElementById('goals-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', () => { this.goalsLoaded = false; this.loadGoals(); });
    },

    async createGoal() {
        var type = document.getElementById('goal-type').value;
        var title = document.getElementById('goal-title').value.trim();
        var target = parseFloat(document.getElementById('goal-target').value) || 0;
        var unit = document.getElementById('goal-unit').value.trim() || 'ر.س';
        var endDate = document.getElementById('goal-end-date').value;
        var desc = document.getElementById('goal-description').value.trim();

        if (!title || !target || !endDate) {
            if (window.showToast) window.showToast('يرجى ملء الحقول المطلوبة', 'warning');
            return;
        }

        try {
            await window.apiFetch('/api/ai-assistant/goals', {
                method: 'POST',
                body: { goal_type: type, title: title, description: desc, target_value: target, unit: unit, period: 'month', end_date: endDate },
            });
            if (window.showToast) window.showToast('تم إنشاء الهدف بنجاح', 'success');
            document.getElementById('goal-title').value = '';
            document.getElementById('goal-target').value = '';
            document.getElementById('goal-description').value = '';
            this.goalsLoaded = false;
            this.loadGoals();
        } catch (err) {
            if (window.showToast) window.showToast('فشل إنشاء الهدف: ' + (err.message || ''), 'error');
        }
    },

    async completeGoal(id) {
        try {
            await window.apiFetch('/api/ai-assistant/goals/' + id, {
                method: 'PUT',
                body: { status: 'completed' },
            });
            if (window.showToast) window.showToast('تم إنهاء الهدف', 'success');
            this.goalsLoaded = false;
            this.loadGoals();
        } catch (err) {
            if (window.showToast) window.showToast('فشل إنهاء الهدف', 'error');
        }
    },

    // ── Price Advisor ───────────────────────────────────────────────────────
    bindPricingEvents() {
        this.pricingBound = true;
        var searchBtn = document.getElementById('price-search-btn');
        if (searchBtn) searchBtn.addEventListener('click', () => this.searchPrice());
        var input = document.getElementById('price-product-name');
        if (input) input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.searchPrice();
        });
    },

    async searchPrice() {
        var name = document.getElementById('price-product-name').value.trim();
        var margin = parseFloat(document.getElementById('price-target-margin').value) || 20;
        var statusEl = document.getElementById('price-status');
        var resultsEl = document.getElementById('price-results');
        var tbody = document.getElementById('price-table-body');

        if (!name) {
            if (statusEl) { statusEl.textContent = 'اكتب اسم المنتج أولاً'; statusEl.className = 'mb-4 rounded-lg p-4 text-sm bg-amber-50 text-amber-700 border border-amber-200'; statusEl.classList.remove('hidden'); }
            return;
        }

        if (statusEl) { statusEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جارٍ البحث...'; statusEl.className = 'mb-4 rounded-lg p-4 text-sm bg-purple-50 text-purple-700 border border-purple-200'; statusEl.classList.remove('hidden'); }
        if (resultsEl) resultsEl.classList.add('hidden');

        try {
            var data = await window.apiFetch('/api/ai-assistant/suggest-price?product_name=' + encodeURIComponent(name) + '&target_margin=' + margin, { method: 'GET' });
            var suggestions = data.suggestions || [];

            if (suggestions.length === 0) {
                if (statusEl) { statusEl.textContent = data.message || 'لم يتم العثور على منتجات مطابقة'; statusEl.className = 'mb-4 rounded-lg p-4 text-sm bg-slate-50 text-slate-600 border border-slate-200'; }
                return;
            }

            if (statusEl) statusEl.classList.add('hidden');
            if (tbody) {
                tbody.innerHTML = suggestions.map(s => {
                    var marginCls = s.current_margin_percent >= margin ? 'text-emerald-600 font-bold' : 'text-orange-600 font-bold';
                    var suggestedCls = s.suggested_price > s.current_selling_price ? 'text-orange-600 font-bold' : 'text-emerald-600 font-bold';
                    return '<tr class="hover:bg-slate-50 transition-colors">' +
                        '<td class="px-4 py-3 text-slate-800 font-medium">' + this._esc(s.product_name) + '</td>' +
                        '<td class="px-4 py-3 text-slate-600">' + this._esc(s.size_name || '—') + '</td>' +
                        '<td class="px-4 py-3 text-slate-600">' + Number(s.cost_price).toLocaleString() + '</td>' +
                        '<td class="px-4 py-3 text-slate-800">' + Number(s.current_selling_price).toLocaleString() + '</td>' +
                        '<td class="px-4 py-3 ' + marginCls + '">' + s.current_margin_percent + '%</td>' +
                        '<td class="px-4 py-3 text-slate-600">' + (s.avg_historical_price > 0 ? Number(s.avg_historical_price).toLocaleString() : '—') + '</td>' +
                        '<td class="px-4 py-3 ' + suggestedCls + '">' + Number(s.suggested_price).toLocaleString() + '</td>' +
                        '<td class="px-4 py-3 text-slate-500">' + s.times_sold + '</td>' +
                        '</tr>';
                }).join('');
            }
            if (resultsEl) resultsEl.classList.remove('hidden');
        } catch (err) {
            if (statusEl) { statusEl.textContent = 'خطأ: ' + (err.message || ''); statusEl.className = 'mb-4 rounded-lg p-4 text-sm bg-red-50 text-red-700 border border-red-200'; }
        }
    },

    // ── Action Proposals ────────────────────────────────────────────────────
    async loadActions() {
        var loading = document.getElementById('actions-loading');
        var content = document.getElementById('actions-content');
        if (loading) loading.classList.remove('hidden');
        if (content) content.innerHTML = '';

        try {
            var data = await window.apiFetch('/api/ai-assistant/ai_action_log?status=proposed', { method: 'GET' });
            this.actionsLoaded = true;
            var actions = Array.isArray(data) ? data : (data.actions || data.rows || []);
            this.renderActions(actions);
            this.bindActionEvents();
        } catch (err) {
            // Endpoint might not exist — show empty state
            this.actionsLoaded = true;
            if (content) content.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm"><i class="fa-solid fa-wand-magic-sparkles text-3xl mb-2 block text-slate-300"></i>لا توجد إجراءات مقترحة حالياً. الإجراءات تظهر عندما يقترح المساعد الذكي إجراءً في المحادثة.</div>';
        } finally {
            if (loading) loading.classList.add('hidden');
        }
    },

    renderActions(actions) {
        var content = document.getElementById('actions-content');
        if (!content) return;

        if (!actions || actions.length === 0) {
            content.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm"><i class="fa-solid fa-wand-magic-sparkles text-3xl mb-2 block text-slate-300"></i>لا توجد إجراءات مقترحة حالياً. الإجراءات تظهر عندما يقترح المساعد الذكي إجراءً في المحادثة.</div>';
            return;
        }

        content.innerHTML = actions.map(a => {
            var summary = a.proposal || a.summary || {};
            var summaryText = typeof summary === 'string' ? summary : JSON.stringify(summary, null, 2);
            var statusCls = a.status === 'proposed' ? 'bg-violet-100 text-violet-700' : a.status === 'executed' ? 'bg-emerald-100 text-emerald-700' : a.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600';
            return '<div class="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md transition-shadow" data-action-id="' + a.id + '">' +
                '<div class="flex items-center justify-between mb-2">' +
                '<span class="text-xs font-bold text-slate-700"><i class="fa-solid fa-wand-magic-sparkles ml-1 text-violet-500"></i> ' + this._esc(a.action_type || 'إجراء') + '</span>' +
                '<span class="text-[10px] px-2 py-0.5 rounded-full ' + statusCls + '">' + this._esc(a.status) + '</span></div>' +
                '<pre class="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">' + this._esc(summaryText) + '</pre>' +
                (a.status === 'proposed' ?
                    '<div class="flex gap-2 mt-3">' +
                    '<button class="ai-action-execute text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors" data-id="' + a.id + '"><i class="fa-solid fa-check ml-1"></i> تنفيذ</button>' +
                    '<button class="ai-action-reject text-xs px-3 py-1.5 rounded-lg bg-white border border-red-300 text-red-600 hover:bg-red-50 transition-colors" data-id="' + a.id + '"><i class="fa-solid fa-xmark ml-1"></i> رفض</button>' +
                    '</div>' : '') +
                '</div>';
        }).join('');
    },

    bindActionEvents() {
        var refreshBtn = document.getElementById('actions-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', () => { this.actionsLoaded = false; this.loadActions(); });

        document.querySelectorAll('.ai-action-execute').forEach(btn => {
            btn.addEventListener('click', async () => {
                var id = btn.getAttribute('data-id');
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جارٍ...';
                try {
                    await window.apiFetch('/api/ai-assistant/execute-action', { method: 'POST', body: { action_id: id } });
                    if (window.showToast) window.showToast('تم تنفيذ الإجراء بنجاح', 'success');
                    this.actionsLoaded = false;
                    this.loadActions();
                } catch (err) {
                    if (window.showToast) window.showToast('فشل التنفيذ: ' + (err.message || ''), 'error');
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-check ml-1"></i> تنفيذ';
                }
            });
        });

        document.querySelectorAll('.ai-action-reject').forEach(btn => {
            btn.addEventListener('click', async () => {
                var id = btn.getAttribute('data-id');
                btn.disabled = true;
                try {
                    await window.apiFetch('/api/ai-assistant/reject-action', { method: 'POST', body: { action_id: id } });
                    if (window.showToast) window.showToast('تم رفض الإجراء', 'success');
                    this.actionsLoaded = false;
                    this.loadActions();
                } catch (err) {
                    if (window.showToast) window.showToast('فشل الرفض: ' + (err.message || ''), 'error');
                    btn.disabled = false;
                }
            });
        });
    },

    // ── Chat Feedback (👍/👎) ───────────────────────────────────────────────
    async sendFeedback(messageId, rating, btnEl) {
        try {
            await window.apiFetch('/api/ai-assistant/feedback', {
                method: 'POST',
                body: { message_id: messageId, rating: rating },
            });
            // Update UI
            var container = btnEl.parentElement;
            container.querySelectorAll('button').forEach(b => {
                b.classList.remove('text-brand-700', 'bg-brand-100');
                b.classList.add('text-slate-400');
            });
            btnEl.classList.remove('text-slate-400');
            btnEl.classList.add(rating === 'positive' ? 'text-emerald-600' : 'text-red-500');
            if (window.showToast) window.showToast('شكراً على تقييمك', 'success');
        } catch (err) {
            // Silent fail — feedback is optional
            console.error('[AI Feedback] Error:', err);
        }
    },

    // ── Chat History ────────────────────────────────────────────────────────
    async loadChatHistory() {
        try {
            var data = await window.apiFetch('/api/ai-assistant/history', { method: 'GET' });
            var messages = data.messages || [];
            if (messages.length === 0) return;
            this.chatMessages = messages.map(m => ({
                role: m.role,
                content: m.content,
                messageId: m.id,
            }));
            this.renderChatMessages();
        } catch (err) {
            console.error('[AI Chat History] Error:', err);
        }
    },

    bindEvents() {
        const forecastBtn = document.getElementById('forecast-btn');
        if (forecastBtn) forecastBtn.addEventListener('click', () => this.runForecast());
        const exportBtn = document.getElementById('forecast-export');
        if (exportBtn) exportBtn.addEventListener('click', () => this.exportCSV());
        const rfmRefresh = document.getElementById('rfm-refresh');
        if (rfmRefresh) rfmRefresh.addEventListener('click', () => this.loadRFM());
        const churnRefresh = document.getElementById('churn-refresh');
        if (churnRefresh) churnRefresh.addEventListener('click', () => this.loadChurn());
    },

    async loadClients() {
        const select = document.getElementById('forecast-client');
        if (!select) return;
        select.dataset.loaded = '1';
        select.innerHTML = '<option value="">جارٍ التحميل...</option>';

        if (typeof window.apiFetch !== 'function') {
            console.error('[Forecast] window.apiFetch not available');
            select.innerHTML = '<option value="">API غير متاح</option>';
            return;
        }

        try {
            console.log('[Forecast] Loading clients...');
            const res = await window.apiFetch('/api/clients');
            console.log('[Forecast] Clients response:', res);
            const clients = res.data || res || [];
            console.log('[Forecast] Clients count:', clients.length);
            if (!clients.length) {
                select.innerHTML = '<option value="">لا يوجد عملاء</option>';
                return;
            }
            select.innerHTML = '<option value="">اختر عميل...</option>' +
                clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
            if (window.makeSelectSearchable && !select.dataset.searchable) {
                window.makeSelectSearchable(select, '🔍 ابحث عن عميل...');
            }
        } catch (err) {
            console.error('[Forecast] loadClients error:', err);
            select.innerHTML = '<option value="">خطأ في تحميل العملاء</option>';
        }
    },

    async runForecast() {
        const clientId = document.getElementById('forecast-client').value;
        const periods = parseInt(document.getElementById('forecast-periods').value);

        if (!clientId) {
            this.showStatus('اختر عميل أولاً', 'warning');
            return;
        }

        this.showStatus('جارٍ التحليل...', 'loading');
        document.getElementById('forecast-results').classList.add('hidden');

        try {
            const data = await window.apiFetch(`/api/forecast/client/${clientId}`, { method: 'POST', body: { periods } });
            this.currentData = data;

            if (!data.ready) {
                this.showStatus(data.message || 'لا توجد بيانات كافية للتوقعات', 'warning');
                return;
            }

            this.render(data);
            this.showStatus('تم التحليل بنجاح!', 'success');
            document.getElementById('forecast-results').classList.remove('hidden');
        } catch (err) {
            this.showStatus('خطأ: ' + (err.message || 'فشل الاتصال بالخدمة'), 'error');
        }
    },

    render(data) {
        const forecast = data.forecast || [];
        const total = forecast.reduce((sum, f) => sum + f.qty, 0);
        const avg = forecast.length ? total / forecast.length : 0;

        document.getElementById('forecast-total').textContent = Math.round(total).toLocaleString();
        document.getElementById('forecast-avg').textContent = Math.round(avg).toLocaleString();
        document.getElementById('forecast-history').textContent = data.total_orders || 0;

        this.renderChart(forecast);
        this.renderTable(forecast);
    },

    renderChart(forecast) {
        const container = document.getElementById('forecast-chart');
        if (!container) return;

        const maxQty = Math.max(...forecast.map(f => f.qty), 1);
        const step = Math.ceil(forecast.length / 20);
        const displayPoints = forecast.filter((_, i) => i % step === 0 || i === forecast.length - 1);

        container.innerHTML = displayPoints.map(f => {
            const height = Math.round((f.qty / maxQty) * 100);
            const d = new Date(f.date);
            const label = d.getDate();
            return `
                <div class="flex flex-col items-center flex-shrink-0" style="width: 24px;" title="${f.date}: ${Math.round(f.qty).toLocaleString()}">
                    <div class="w-3 rounded-t bg-purple-500 hover:bg-purple-600 transition-colors" style="height: ${height}px; min-height: 2px;"></div>
                    <span class="text-[9px] text-slate-400 mt-1">${label}</span>
                </div>
            `;
        }).join('');
    },

    renderTable(forecast) {
        const tbody = document.getElementById('forecast-table-body');
        let cumulative = 0;

        tbody.innerHTML = forecast.map((f, i) => {
            cumulative += f.qty;
            const d = new Date(f.date);
            const dateStr = d.toLocaleDateString('ar-SA', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
            const isHigh = f.qty > (cumulative / (i + 1)) * 1.5;

            return `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="px-4 py-3 text-slate-700 font-medium">${dateStr}</td>
                    <td class="px-4 py-3 text-slate-800 font-bold">${Math.round(f.qty).toLocaleString()}</td>
                    <td class="px-4 py-3 text-slate-600">${Math.round(cumulative).toLocaleString()}</td>
                    <td class="px-4 py-3">
                        ${isHigh
                            ? '<span class="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-bold">ذروة</span>'
                            : '<span class="px-2 py-1 bg-slate-100 text-slate-600 rounded-full text-xs">طبيعي</span>'
                        }
                    </td>
                </tr>
            `;
        }).join('');
    },

    exportCSV() {
        if (!this.currentData || !this.currentData.forecast) return;

        const rows = this.currentData.forecast.map(f => `${f.date},${f.qty}`);
        const csv = 'date,quantity\n' + rows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `forecast_${this.currentData.client_id}_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
    },

    // ── RFM Segmentation ─────────────────────────────────────────────────────
    async loadRFM() {
        const loading = document.getElementById('rfm-loading');
        const content = document.getElementById('rfm-content');
        if (loading) loading.classList.remove('hidden');
        if (content) content.classList.add('hidden');

        try {
            const data = await window.apiFetch('/api/forecast/insights/rfm');
            this.rfmData = data;
            this.renderRFM(data);
        } catch (err) {
            console.error('[AI] RFM error:', err);
        } finally {
            if (loading) loading.classList.add('hidden');
            if (content) content.classList.remove('hidden');
        }
    },

    renderRFM(data) {
        const counts = data.counts || {};
        const elVip = document.getElementById('rfm-vip-count');
        const elActive = document.getElementById('rfm-active-count');
        const elRisk = document.getElementById('rfm-at_risk-count');
        const elDormant = document.getElementById('rfm-dormant-count');
        if (elVip) elVip.textContent = counts.vip || 0;
        if (elActive) elActive.textContent = counts.active || 0;
        if (elRisk) elRisk.textContent = counts.at_risk || 0;
        if (elDormant) elDormant.textContent = counts.dormant || 0;
    },

    toggleRfmSegment(segment) {
        if (!this.rfmData || !this.rfmData.segments) return;
        const panel = document.getElementById('rfm-detail-panel');
        const title = document.getElementById('rfm-detail-title');
        const tbody = document.getElementById('rfm-detail-body');
        if (!panel || !title || !tbody) return;

        const clients = this.rfmData.segments[segment] || [];
        const labels = { vip: 'العملاء VIP', active: 'العملاء النشطين', at_risk: 'العملاء المُهددين', dormant: 'العملاء النائمين' };
        title.textContent = labels[segment] || 'التفاصيل';

        if (!clients.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-4 text-center text-slate-400 text-sm">لا يوجد عملاء في هذه الفئة</td></tr>';
        } else {
            tbody.innerHTML = clients.map(c => `
                <tr class="hover:bg-slate-50 transition-colors cursor-pointer" onclick="window._cpClientId=${c.id};window.navigateTo('client-profile')">
                    <td class="px-4 py-2 text-slate-800 font-medium">${c.name}</td>
                    <td class="px-4 py-2 text-slate-600">${c.last_order || '—'}</td>
                    <td class="px-4 py-2 text-slate-600">${c.frequency}</td>
                    <td class="px-4 py-2 text-slate-800 font-bold">${Number(c.monetary).toLocaleString()} ر.س</td>
                </tr>
            `).join('');
        }
        panel.classList.remove('hidden');
    },

    // ── Churn Alerts ─────────────────────────────────────────────────────────
    async loadChurn() {
        const loading = document.getElementById('churn-loading');
        const content = document.getElementById('churn-content');
        const empty = document.getElementById('churn-empty');
        if (loading) loading.classList.remove('hidden');
        if (content) content.classList.add('hidden');
        if (empty) empty.classList.add('hidden');

        try {
            const data = await window.apiFetch('/api/forecast/insights/churn?days=30');
            this.churnData = data;
            this.renderChurn(data);
        } catch (err) {
            console.error('[AI] Churn error:', err);
        } finally {
            if (loading) loading.classList.add('hidden');
            if (content) content.classList.remove('hidden');
        }
    },

    renderChurn(data) {
        const tbody = document.getElementById('churn-table-body');
        const empty = document.getElementById('churn-empty');
        const clients = data.clients || [];
        if (!tbody) return;

        if (!clients.length) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        tbody.innerHTML = clients.map(c => {
            const daysClass = c.inactive_days > 60 ? 'text-red-600 font-bold' : (c.inactive_days > 45 ? 'text-orange-600 font-bold' : 'text-slate-700');
            return `
                <tr class="hover:bg-slate-50 transition-colors cursor-pointer" onclick="window._cpClientId=${c.id};window.navigateTo('client-profile')">
                    <td class="px-4 py-3 text-slate-800 font-medium">${c.name}</td>
                    <td class="px-4 py-3 text-slate-600">${c.last_order || '—'}</td>
                    <td class="px-4 py-3 ${daysClass}">${c.inactive_days === 999 ? 'لم يسبق له الطلب' : c.inactive_days + ' يوم'}</td>
                    <td class="px-4 py-3 text-slate-600">${c.total_orders}</td>
                    <td class="px-4 py-3 text-slate-800 font-bold">${Number(c.total_value).toLocaleString()} ر.س</td>
                </tr>
            `;
        }).join('');
    },

    showStatus(msg, type) {
        const el = document.getElementById('forecast-status');
        if (!el) return;
        el.classList.remove('hidden', 'bg-amber-50', 'text-amber-700', 'bg-red-50', 'text-red-700', 'bg-emerald-50', 'text-emerald-700', 'bg-purple-50', 'text-purple-700');
        el.classList.remove('border', 'border-amber-200', 'border-red-200', 'border-emerald-200', 'border-purple-200');

        const styles = {
            warning: ['bg-amber-50', 'text-amber-700', 'border', 'border-amber-200'],
            error:   ['bg-red-50', 'text-red-700', 'border', 'border-red-200'],
            success: ['bg-emerald-50', 'text-emerald-700', 'border', 'border-emerald-200'],
            loading: ['bg-purple-50', 'text-purple-700', 'border', 'border-purple-200'],
        };

        (styles[type] || styles.warning).forEach(c => el.classList.add(c));
        el.innerHTML = type === 'loading'
            ? `<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> ${msg}`
            : msg;
        el.classList.remove('hidden');
    }
};

// Auto-init when script loads
if (document.querySelector('.ai-tab-btn')) {
    forecastView.init();
}

window.forecastView = forecastView;
