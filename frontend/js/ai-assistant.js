'use strict';

// =============================================================================
// G.PACK 2.0 — AI Assistant Chat Widget (ai-assistant.js)
// Self-contained module: injects a floating chat bubble + slide-in panel.
// Depends on: api.js (window.apiFetch), layout.js (window.showToast)
// =============================================================================

(function () {

    // ── State ────────────────────────────────────────────────────────────────
    let _isOpen = false;
    let _isLoading = false;
    let _messages = [];
    let _sessionId = null;
    let _aiEnabled = null;
    let _briefingShown = false;

    // ── Page name mapping (hash → human-readable Arabic) ─────────────────────
    const PAGE_NAMES = {
        'dashboard': 'لوحة التحكم',
        'warehouses': 'المخازن',
        'inventory': 'المخزون',
        'products': 'المنتجات',
        'clients': 'العملاء',
        'client-profile': 'ملف العميل',
        'suppliers': 'الموردون',
        'sales-invoices': 'فواتير المبيعات',
        'purchase-invoices': 'فواتير المشتريات',
        'quotations': 'عروض الأسعار',
        'production_orders': 'أوامر التشغيل',
        'receiving-vouchers': 'سندات الاستلام',
        'direct-receipts': 'الاستلام المباشر',
        'vmi-dispatch': 'سندات التسليم',
        'purchase-returns': 'مرتجعات المشتريات',
        'payment-voucher': 'سندات الصرف',
        'receipt-voucher': 'سندات القبض',
        'chart-of-accounts': 'دليل الحسابات',
        'accounting': 'القيد المحاسبي',
        'forecast': 'التوقعات',
        'whatsapp-center': 'مركز الواتساب',
        'designer': 'مصمم المنتجات',
        'users': 'المستخدمون',
        'settings': 'الإعدادات',
    };

    // ── Extract current page context from SPA hash ──────────────────────────
    function _getCurrentContext() {
        try {
            const hash = window.location.hash || '';
            const raw = hash.replace('#/', '').split('?')[0];
            const params = new URLSearchParams(hash.split('?')[1] || '');

            const ctx = {
                page: PAGE_NAMES[raw] || raw || 'غير محدد',
                page_key: raw || '',
            };

            // Extract entity IDs from query params
            const clientId = params.get('client_id') || params.get('id');
            if (clientId && (raw === 'client-profile' || raw === 'clients')) {
                ctx.entity_type = 'عميل';
                ctx.entity_id = clientId;
            }

            const orderId = params.get('order_id') || params.get('id');
            if (orderId && raw === 'quotations') {
                ctx.entity_type = 'عرض سعر / طلب';
                ctx.entity_id = orderId;
            }

            return ctx;
        } catch {
            return null;
        }
    }

    // ── Suggested questions (role-dependent — Phase 8) ────────────────────────
    const MANAGER_SUGGESTIONS = [
        { text: 'إيه إجمالي مبيعات اليوم؟', icon: 'fa-chart-line' },
        { text: 'أكثر 5 منتجات مبيعاً هذا الشهر', icon: 'fa-trophy' },
        { text: 'حالة المخزون — إيه اللي قارب على النفاد؟', icon: 'fa-boxes-stacked' },
        { text: 'مين أرخص مورد للأكواب؟', icon: 'fa-tags' },
        { text: 'إيه المستحقات المعلقة على العملاء؟', icon: 'fa-hand-holding-dollar' },
        { text: 'كم عرض سعر معلق حالياً؟', icon: 'fa-file-lines' },
        { text: 'إمتى هينفد مخزون الأصناف؟', icon: 'fa-hourglass-half' },
        { text: 'كم نتوقع نبيع الشهر الجاي؟', icon: 'fa-lightbulb' },
        { text: 'أي عملاء ممكن يسيبونا؟', icon: 'fa-user-slash' },
        { text: 'إيه الأصناف اللي محتاجة إعادة طلب؟', icon: 'fa-truck-ramp-box' },
        { text: 'دورلي على عميل اسمه أحمد', icon: 'fa-magnifying-glass' },
    ];

    const SALES_REP_SUGGESTIONS = [
        { text: 'إيه عروضي المعلقة؟', icon: 'fa-file-lines' },
        { text: 'إيه آخر طلباتي؟', icon: 'fa-clipboard-list' },
        { text: 'أكثر منتجاتي مبيعاً', icon: 'fa-trophy' },
        { text: 'إيه مستحقات عملائي؟', icon: 'fa-hand-holding-dollar' },
        { text: 'حالة المخزون — إيه اللي قارب على النفاد؟', icon: 'fa-boxes-stacked' },
        { text: 'دورلي على عميل اسمه أحمد', icon: 'fa-magnifying-glass' },
    ];

    function _getRoleSuggestions() {
        var role = (window.GpackUser && window.GpackUser.role || '').toLowerCase();
        if (role === 'sales_rep') return SALES_REP_SUGGESTIONS;
        return MANAGER_SUGGESTIONS;
    }

    // =============================================================================
    // Initialize — inject button + panel into the header
    // =============================================================================
    function init() {
        if (document.getElementById('ai-chat-btn')) return; // already initialized

        // Create floating button
        const btn = document.createElement('button');
        btn.id = 'ai-chat-btn';
        btn.className = 'fixed bottom-6 left-6 z-50 w-14 h-14 rounded-full bg-brand-700 text-white shadow-lg hover:bg-brand-800 transition-all duration-200 flex items-center justify-center group';
        btn.innerHTML = '<i class="fa-solid fa-robot text-xl"></i>';
        btn.title = 'المساعد الذكي';
        btn.addEventListener('click', togglePanel);
        document.body.appendChild(btn);

        // Create chat panel (hidden by default)
        const panel = document.createElement('div');
        panel.id = 'ai-chat-panel';
        panel.className = 'fixed bottom-24 left-6 z-50 w-96 max-w-[calc(100vw-3rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col transition-all duration-300 origin-bottom-left';
        panel.style.display = 'none';
        panel.style.height = '32rem';
        panel.style.maxHeight = 'calc(100vh - 8rem)';
        document.body.appendChild(panel);

        // Render initial content
        _renderPanel();

        // Check if AI is enabled
        _checkHealth();
    }

    // =============================================================================
    // Toggle panel open/close
    // =============================================================================
    function togglePanel() {
        const panel = document.getElementById('ai-chat-panel');
        if (!panel) return;
        _isOpen = !_isOpen;
        if (_isOpen) {
            panel.style.display = 'flex';
            // Focus input
            setTimeout(() => {
                const input = document.getElementById('ai-chat-input');
                if (input) input.focus();
            }, 100);
        } else {
            panel.style.display = 'none';
        }
    }

    // =============================================================================
    // Daily Briefing — auto-fetch on first open each day
    // =============================================================================
    let _briefingData = null;

    async function _maybeFetchBriefing() {
        try {
            // Check if already shown today (localStorage)
            const today = new Date().toISOString().split('T')[0];
            const lastShown = localStorage.getItem('ai_briefing_date');
            const dismissed = localStorage.getItem('ai_briefing_dismissed') === today;

            if (dismissed) return;
            if (lastShown === today && _briefingData) {
                _updateBadge();
                return;
            }

            const res = await window.apiFetch('/api/ai-assistant/briefing');
            _briefingData = res;
            localStorage.setItem('ai_briefing_date', today);
            _updateBadge();
        } catch {
            // Silently fail — briefing is optional
        }
    }

    function _updateBadge() {
        if (!_briefingData || !_briefingData.alert_count) return;
        const btn = document.getElementById('ai-chat-btn');
        if (!btn) return;

        // Add orange alert dot if not already present
        if (!btn.querySelector('.ai-briefing-dot')) {
            const dot = document.createElement('span');
            dot.className = 'ai-briefing-dot absolute -top-1 -right-1 w-4 h-4 bg-amber-500 rounded-full border-2 border-white flex items-center justify-center';
            dot.innerHTML = '<span class="text-[8px] text-white font-bold">!</span>';
            btn.appendChild(dot);
        }
    }

    function _removeBadge() {
        const btn = document.getElementById('ai-chat-btn');
        if (btn) {
            const dot = btn.querySelector('.ai-briefing-dot');
            if (dot) dot.remove();
        }
    }

    function _renderBriefingCard() {
        if (!_briefingData) return '';
        const b = _briefingData;
        const fmt = (n) => parseFloat(n).toLocaleString('ar-SA', { maximumFractionDigits: 2 });

        const items = [];

        if (b.today_invoice_count > 0) {
            items.push(`<div class="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg bg-emerald-50">
                <span class="text-slate-600"><i class="fa-solid fa-chart-line ml-1 text-emerald-600"></i> مبيعات اليوم</span>
                <span class="font-bold text-emerald-700">${fmt(b.today_sales)} ر.س</span>
            </div>`);
        }

        if (b.pending_quotes > 0) {
            items.push(`<div class="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg bg-blue-50">
                <span class="text-slate-600"><i class="fa-solid fa-file-lines ml-1 text-blue-600"></i> عروض أسعار معلقة</span>
                <span class="font-bold text-blue-700">${b.pending_quotes}</span>
            </div>`);
        }

        if (b.low_stock_count > 0) {
            items.push(`<div class="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg bg-amber-50">
                <span class="text-slate-600"><i class="fa-solid fa-boxes-stacked ml-1 text-amber-600"></i> أصناف قاربت على النفاد</span>
                <span class="font-bold text-amber-700">${b.low_stock_count}</span>
            </div>`);
        }

        if (b.outstanding_count > 0) {
            items.push(`<div class="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg bg-rose-50">
                <span class="text-slate-600"><i class="fa-solid fa-hand-holding-dollar ml-1 text-rose-600"></i> مستحقات معلقة</span>
                <span class="font-bold text-rose-700">${fmt(b.total_outstanding)} ر.س</span>
            </div>`);
        }

        if (b.overdue_tasks > 0) {
            items.push(`<div class="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg bg-red-50">
                <span class="text-slate-600"><i class="fa-solid fa-clock ml-1 text-red-600"></i> مهام متأخرة</span>
                <span class="font-bold text-red-700">${b.overdue_tasks}</span>
            </div>`);
        }

        if (b.active_production > 0) {
            items.push(`<div class="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg bg-violet-50">
                <span class="text-slate-600"><i class="fa-solid fa-industry ml-1 text-violet-600"></i> أوامر تشغيل جارية</span>
                <span class="font-bold text-violet-700">${b.active_production}</span>
            </div>`);
        }

        if (b.pending_deliveries > 0) {
            items.push(`<div class="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg bg-cyan-50">
                <span class="text-slate-600"><i class="fa-solid fa-truck ml-1 text-cyan-600"></i> سندات تسليم معلقة</span>
                <span class="font-bold text-cyan-700">${b.pending_deliveries}</span>
            </div>`);
        }

        if (items.length === 0) {
            items.push(`<div class="text-xs text-center py-3 text-slate-400">لا توجد تنبيهات اليوم. كل شيء على ما يرام! ✅</div>`);
        }

        return `
            <div class="bg-gradient-to-br from-brand-50 to-slate-50 border border-brand-200 rounded-xl p-3 mb-2">
                <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-1.5">
                        <i class="fa-solid fa-sun text-amber-500 text-sm"></i>
                        <span class="text-xs font-bold text-slate-700">ملخص اليوم</span>
                        <span class="text-[10px] text-slate-400">${b.date}</span>
                    </div>
                    <button id="ai-briefing-dismiss" class="text-[10px] text-slate-400 hover:text-slate-600 transition-colors">لا تظهر اليوم</button>
                </div>
                <div class="space-y-1.5">
                    ${items.join('')}
                </div>
            </div>
        `;
    }

    function _dismissBriefing() {
        const today = new Date().toISOString().split('T')[0];
        localStorage.setItem('ai_briefing_dismissed', today);
        _briefingData = null;
        _removeBadge();
        _renderPanel();
    }

    // =============================================================================
    // Check if AI is enabled
    // =============================================================================
    async function _checkHealth() {
        try {
            const res = await window.apiFetch('/api/ai-assistant/health');
            _aiEnabled = res.enabled;
        } catch {
            _aiEnabled = false;
        }
    }

    // =============================================================================
    // Render panel content
    // =============================================================================
    function _renderPanel() {
        const panel = document.getElementById('ai-chat-panel');
        if (!panel) return;

        panel.innerHTML = `
            <!-- Header -->
            <div class="flex items-center justify-between px-4 py-3 bg-brand-700 text-white rounded-t-2xl">
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-robot text-lg"></i>
                    <span class="font-semibold text-sm">المساعد الذكي</span>
                </div>
                <button id="ai-chat-close" class="text-white/80 hover:text-white transition-colors">
                    <i class="fa-solid fa-xmark text-lg"></i>
                </button>
            </div>

            <!-- Messages area -->
            <div id="ai-chat-messages" class="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-slate-50">
                ${_messages.length === 0 ? _renderWelcome() : _messages.map(m => _renderMessage(m)).join('')}
            </div>

            <!-- Input area -->
            <div class="px-4 py-3 border-t border-slate-200 bg-white rounded-b-2xl">
                <div class="flex items-center gap-2">
                    <input id="ai-chat-input" type="text"
                        class="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                        placeholder="اكتب سؤالك..." autocomplete="off" />
                    <button id="ai-chat-mic"
                        class="w-10 h-10 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors flex items-center justify-center flex-shrink-0 hidden">
                        <i class="fa-solid fa-microphone text-sm"></i>
                    </button>
                    <button id="ai-chat-send"
                        class="w-10 h-10 rounded-lg bg-brand-700 text-white hover:bg-brand-800 transition-colors flex items-center justify-center flex-shrink-0">
                        <i class="fa-solid fa-paper-plane text-sm"></i>
                    </button>
                </div>
            </div>
        `;

        // Bind events
        const closeBtn = document.getElementById('ai-chat-close');
        if (closeBtn) closeBtn.addEventListener('click', togglePanel);

        const sendBtn = document.getElementById('ai-chat-send');
        if (sendBtn) sendBtn.addEventListener('click', _sendMessage);

        const input = document.getElementById('ai-chat-input');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    _sendMessage();
                }
            });
        }

        // Phase 9: Voice input (webkitSpeechRecognition)
        const micBtn = document.getElementById('ai-chat-mic');
        if (micBtn) {
            var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition && input) {
                micBtn.classList.remove('hidden');
                var isRecording = false;
                var recognition = null;

                micBtn.addEventListener('click', function() {
                    if (isRecording) {
                        if (recognition) recognition.stop();
                        return;
                    }

                    recognition = new SpeechRecognition();
                    recognition.lang = 'ar-SA';
                    recognition.interimResults = true;
                    recognition.continuous = false;

                    var baseText = '';
                    recognition.onstart = function() {
                        isRecording = true;
                        micBtn.classList.remove('bg-slate-100', 'text-slate-500', 'hover:bg-slate-200');
                        micBtn.classList.add('bg-rose-500', 'text-white', 'animate-pulse');
                        micBtn.querySelector('i').className = 'fa-solid fa-stop text-sm';
                        baseText = input.value || '';
                    };

                    recognition.onresult = function(event) {
                        var transcript = '';
                        for (var i = 0; i < event.results.length; i++) {
                            transcript += event.results[i][0].transcript;
                        }
                        input.value = baseText + transcript;
                    };

                    recognition.onerror = function(event) {
                        if (window.showToast && event.error !== 'aborted') {
                            window.showToast('خطأ في الإدخال الصوتي: ' + event.error, 'warning');
                        }
                    };

                    recognition.onend = function() {
                        isRecording = false;
                        micBtn.classList.add('bg-slate-100', 'text-slate-500', 'hover:bg-slate-200');
                        micBtn.classList.remove('bg-rose-500', 'text-white', 'animate-pulse');
                        micBtn.querySelector('i').className = 'fa-solid fa-microphone text-sm';
                    };

                    recognition.start();
                });
            }
        }

        // Suggestion chips
        document.querySelectorAll('.ai-suggestion-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const q = chip.getAttribute('data-question');
                if (input) input.value = q;
                _sendMessage();
            });
        });

        // Briefing dismiss button
        const dismissBtn = document.getElementById('ai-briefing-dismiss');
        if (dismissBtn) dismissBtn.addEventListener('click', _dismissBriefing);

        // Action buttons
        document.querySelectorAll('.ai-action-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                var msgEl = this.closest('[data-msg-actions]');
                if (!msgEl) return;
                try {
                    var actions = JSON.parse(msgEl.getAttribute('data-msg-actions') || '[]');
                    var idx = parseInt(this.getAttribute('data-action-idx') || '0');
                    var action = actions[idx];
                    if (action) _handleAction(action);
                } catch(e) { /* ignore */ }
            });
        });

        // Proposed action confirm/reject buttons (Phase 6)
        document.querySelectorAll('.ai-propose-confirm').forEach(btn => {
            var handler = function() {
                var msgEl = btn.closest('[data-msg-proposed]');
                if (!msgEl) return;
                try {
                    var proposed = JSON.parse(msgEl.getAttribute('data-msg-proposed') || '[]');
                    var idx = parseInt(btn.getAttribute('data-propose-idx') || '0');
                    var pa = proposed[idx];
                    if (pa) _handleProposeAction(pa, btn);
                } catch(e) { /* ignore */ }
            };
            btn._proposeHandler = handler;
            btn.addEventListener('click', handler);
        });
        document.querySelectorAll('.ai-propose-reject').forEach(btn => {
            btn.addEventListener('click', function() {
                var card = this.closest('.ai-propose-card');
                if (card) card.remove();
            });
        });

        // Scroll to bottom
        _scrollToBottom();
    }

    // =============================================================================
    // Render welcome message
    // =============================================================================
    function _renderWelcome() {
        return `
            <div class="flex flex-col items-center justify-center h-full text-center py-8">
                <div class="w-16 h-16 rounded-full bg-brand-100 flex items-center justify-center mb-3">
                    <i class="fa-solid fa-robot text-2xl text-brand-700"></i>
                </div>
                <p class="text-sm font-semibold text-slate-700 mb-1">أهلاً بك في المساعد الذكي</p>
                <p class="text-xs text-slate-400">اسألني عن مبيعاتك، عملائك، مخزونك، مورديك والمزيد</p>
            </div>
        `;
    }

    // =============================================================================
    // Render explanation metadata (Phase 22: Explainability)
    // =============================================================================
    function _renderExplanation(expl) {
        if (!expl) return 'الشرح غير متاح.';
        let html = '';
        if (expl.why) {
            html += `<div class="mb-1"><i class="fa-solid fa-lightbulb text-amber-400 ml-0.5"></i> ${_esc(expl.why)}</div>`;
        }
        if (typeof expl.confidence === 'number') {
            const barColor = expl.confidence >= 70 ? 'bg-green-400' : expl.confidence >= 50 ? 'bg-amber-400' : 'bg-red-400';
            html += `<div class="mb-1">الثقة: <span class="inline-block w-16 h-1.5 bg-slate-200 rounded-full align-middle mr-1"><span class="${barColor} h-full rounded-full inline-block" style="width:${expl.confidence}%"></span></span> ${expl.confidence}%</div>`;
        }
        if (Array.isArray(expl.factors) && expl.factors.length > 0) {
            html += '<div class="mt-1">العوامل:</div><ul class="list-disc pr-4 mt-0.5 space-y-0.5">';
            for (const f of expl.factors) {
                const weightColor = f.weight === 'high' ? 'text-red-400' : f.weight === 'medium' ? 'text-amber-400' : 'text-slate-300';
                html += `<li><span class="${weightColor}">●</span> ${_esc(f.factor)}: ${f.value !== null && f.value !== undefined ? _esc(String(f.value)) : 'غير متوفر'} <span class="text-slate-300">(${f.weight})</span></li>`;
            }
            html += '</ul>';
        }
        return html;
    }

    // =============================================================================
    // Render a single message
    // =============================================================================
    function _renderMessage(msg) {
        if (msg.role === 'user') {
            return `
                <div class="flex justify-end">
                    <div class="bg-brand-700 text-white rounded-2xl rounded-tr-sm px-3 py-2 max-w-[80%] text-sm">
                        ${_esc(msg.content)}
                    </div>
                </div>
            `;
        }
        // Assistant
        let actionsHtml = '';
        if (msg.actions && msg.actions.length > 0) {
            actionsHtml = '<div class="flex flex-wrap gap-1.5 mt-2">' +
                msg.actions.map((a, i) => {
                    return `<button class="ai-action-btn text-[11px] px-2.5 py-1 rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors border border-brand-200 font-medium" data-action-idx="${i}"><i class="fa-solid fa-arrow-left ml-1 text-[9px]"></i>${_esc(a.label)}</button>`;
                }).join('') +
                '</div>';
        }
        // Proposed write actions (Phase 6)
        let proposeHtml = '';
        if (msg.proposed_actions && msg.proposed_actions.length > 0) {
            proposeHtml = msg.proposed_actions.map((pa, i) => {
                return `<div class="ai-propose-card mt-2 p-3 bg-amber-50 border border-amber-300 rounded-xl" data-propose-idx="${i}">
                    <div class="flex items-center gap-1.5 mb-1.5">
                        <i class="fa-solid fa-wand-magic-sparkles text-amber-600 text-xs"></i>
                        <span class="text-xs font-bold text-amber-800">${_esc(pa.label)}</span>
                    </div>
                    <div class="ai-propose-details text-[11px] text-slate-600 mb-2"></div>
                    <div class="flex gap-2">
                        <button class="ai-propose-confirm flex-1 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 transition-colors" data-propose-idx="${i}">
                            <i class="fa-solid fa-check ml-1 text-[10px]"></i>تأكيد وتنفيذ
                        </button>
                        <button class="ai-propose-reject px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs hover:bg-slate-200 transition-colors" data-propose-idx="${i}">
                            <i class="fa-solid fa-xmark ml-1 text-[10px]"></i>إلغاء
                        </button>
                    </div>
                </div>`;
            }).join('');
        }
        return `
            <div class="flex justify-start" data-msg-actions='${msg.actions ? _esc(JSON.stringify(msg.actions)) : ""}' data-msg-proposed='${msg.proposed_actions ? _esc(JSON.stringify(msg.proposed_actions)) : ""}'>
                <div class="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-3 py-2 max-w-[80%] text-sm text-slate-700 shadow-sm">
                    ${_esc(msg.content).replace(/\n/g, '<br>')}
                    ${actionsHtml}
                    ${proposeHtml}
                    <div class="ai-explain-toggle mt-1.5 text-[10px] text-slate-400 hover:text-brand-600 cursor-pointer select-none" onclick="this.nextElementSibling.classList.toggle('hidden')">
                        <i class="fa-solid fa-circle-question ml-0.5"></i> ليه؟
                    </div>
                    <div class="ai-explain-box hidden mt-1.5 p-2 bg-slate-50 border border-slate-100 rounded-lg text-[10px] text-slate-500">
                        ${msg._explanation ? _renderExplanation(msg._explanation) : 'الشرح غير متاح لهذه الإجابة. الشرح متاح لاقتراحات الأسعار والتفاوض والتدقيق.'}
                    </div>
                </div>
            </div>
        `;
    }

    // =============================================================================
    // Send message
    // =============================================================================
    async function _sendMessage() {
        const input = document.getElementById('ai-chat-input');
        if (!input) return;
        const text = input.value.trim();
        if (!text || _isLoading) return;

        // Add user message
        _messages.push({ role: 'user', content: text });
        input.value = '';
        _isLoading = true;

        // Re-render with loading indicator
        _renderPanelWithLoading();

        try {
            const ctx = _getCurrentContext();
            const res = await window.apiFetch('/api/ai-assistant/chat', {
                method: 'POST',
                body: { message: text, context: ctx, session_id: _sessionId },
            });

            if (res.session_id) _sessionId = res.session_id;

            _messages.push({ role: 'assistant', content: res.reply || 'عذراً، لم أتمكن من الرد.', actions: res.actions, proposed_actions: res.proposed_actions });
        } catch (err) {
            let msg = 'حدث خطأ: ' + (err.message || 'تعذّر الاتصال بالمساعد');
            if (err.message && (err.message.includes('504') || err.message.includes('مهلة') || err.message.includes('timeout'))) {
                msg = 'انتهت مهلة الاتصال بالمساعد الذكي. قد يكون السؤال معقداً جداً. حاول تبسيط السؤال وإعادة المحاولة.';
            }
            _messages.push({ role: 'assistant', content: msg });
        } finally {
            _isLoading = false;
            _renderPanel();
        }
    }

    // =============================================================================
    // Handle proposed action (Phase 6: two-step propose → confirm → execute)
    // =============================================================================
    async function _handleProposeAction(pa, btnEl) {
        var card = btnEl.closest('.ai-propose-card');
        var detailsEl = card ? card.querySelector('.ai-propose-details') : null;

        // Remove original click handler so it doesn't fire again
        btnEl.onclick = null;
        btnEl.removeEventListener('click', btnEl._proposeHandler);

        // Step 1: Show loading
        if (detailsEl) {
            detailsEl.innerHTML = '<div class="flex items-center gap-1.5 text-amber-600"><i class="fa-solid fa-spinner fa-spin text-[10px]"></i> جاري التحقق...</div>';
        }
        if (btnEl) btnEl.disabled = true;

        try {
            // Step 2: Call propose-action API
            var proposeRes = await window.apiFetch('/api/ai-assistant/propose-action', {
                method: 'POST',
                body: { action_type: pa.action_type, args: pa.args },
            });

            if (!proposeRes.valid) {
                if (detailsEl) detailsEl.innerHTML = '<div class="text-rose-600"><i class="fa-solid fa-circle-exclamation ml-1"></i>' + _esc(proposeRes.error || 'فشل في التحقق') + '</div>';
                if (btnEl) btnEl.disabled = false;
                return;
            }

            // Step 3: Show summary for confirmation
            var s = proposeRes.summary;
            var summaryHtml = '';

            if (s.action_type === 'create_quote' || s.action_type === 'create_production_order') {
                summaryHtml = '<div class="space-y-1">';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">العميل:</span><span class="font-semibold text-slate-700">' + _esc(s.client_name) + '</span></div>';
                s.items.forEach(function(item, idx) {
                    summaryHtml += '<div class="border border-amber-200 rounded-lg p-1.5 bg-amber-50/50">';
                    summaryHtml += '<div class="text-slate-600 text-[11px] mb-1">' + _esc(item.product_name) + (item.size_name ? ' (' + _esc(item.size_name) + ')' : '') + '</div>';
                    summaryHtml += '<div class="flex gap-1 items-center">';
                    summaryHtml += '<input type="number" min="1" value="' + item.quantity + '" data-edit="item_qty_' + idx + '" class="w-12 text-[11px] text-center border border-slate-200 rounded px-1 py-0.5 focus:border-brand-400 focus:outline-none" title="الكمية">';
                    summaryHtml += '<span class="text-[10px] text-slate-400">×</span>';
                    summaryHtml += '<input type="number" min="0" step="0.01" value="' + parseFloat(item.unit_price || 0).toFixed(2) + '" data-edit="item_price_' + idx + '" class="w-16 text-[11px] text-center border border-slate-200 rounded px-1 py-0.5 focus:border-brand-400 focus:outline-none" title="السعر">';
                    summaryHtml += '<span class="text-[10px] text-slate-500 flex-1 text-left" data-edit="item_total_' + idx + '">' + parseFloat(item.line_total || 0).toFixed(2) + '</span>';
                    summaryHtml += '</div></div>';
                });
                if (s.subtotal !== undefined) {
                    summaryHtml += '<div class="flex justify-between pt-1 border-t border-amber-200"><span class="text-slate-500">الإجمالي:</span><span class="font-bold text-amber-700" data-edit="grand_total">' + parseFloat(s.grand_total).toLocaleString('ar-SA', {maximumFractionDigits: 2}) + ' ر.س</span></div>';
                }
                summaryHtml += '</div>';
            } else if (s.action_type === 'add_payment') {
                summaryHtml = '<div class="space-y-1">';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">طلب رقم:</span><span class="font-semibold text-slate-700">' + s.order_number + '</span></div>';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">العميل:</span><span class="text-slate-600">' + _esc(s.client_name) + '</span></div>';
                summaryHtml += '<div class="flex justify-between items-center"><span class="text-slate-500">المبلغ:</span><input type="number" min="0" step="0.01" value="' + parseFloat(s.amount).toFixed(2) + '" data-edit="payment_amount" class="w-24 text-[11px] text-center font-bold text-amber-700 border border-slate-200 rounded px-1 py-0.5 focus:border-brand-400 focus:outline-none"></div>';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-400">المتبقي بعد الدفعة:</span><span class="text-slate-600" data-edit="remaining_after">' + parseFloat(s.remaining_after).toLocaleString('ar-SA', {maximumFractionDigits: 2}) + ' ر.س</span></div>';
                summaryHtml += '</div>';
            } else if (s.action_type === 'convert_quote_to_invoice') {
                summaryHtml = '<div class="space-y-1">';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">طلب رقم:</span><span class="font-semibold text-slate-700">' + s.order_number + '</span></div>';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">العميل:</span><span class="text-slate-600">' + _esc(s.client_name) + '</span></div>';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">الإجمالي:</span><span class="font-bold text-amber-700">' + parseFloat(s.grand_total).toLocaleString('ar-SA', {maximumFractionDigits: 2}) + ' ر.س</span></div>';
                summaryHtml += '</div>';
            } else if (s.action_type === 'bulk_update_prices') {
                summaryHtml = '<div class="space-y-1">';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">الفئة:</span><span class="font-semibold text-slate-700">' + _esc(s.category) + '</span></div>';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">النسبة:</span><span class="font-bold text-amber-700">' + s.percentage + '% ' + (s.direction === 'increase' ? 'زيادة' : 'خصم') + '</span></div>';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">عدد الأصناف:</span><span class="text-slate-600">' + s.affected_count + ' صنف</span></div>';
                summaryHtml += '<div class="text-[10px] text-slate-400 mt-1 max-h-20 overflow-y-auto">';
                s.affected_items.slice(0, 5).forEach(function(item) {
                    summaryHtml += '<div class="flex justify-between"><span>' + _esc(item.product_name) + '</span><span>' + parseFloat(item.old_price).toFixed(2) + ' ← <b class="text-amber-600">' + parseFloat(item.new_price).toFixed(2) + '</b></span></div>';
                });
                if (s.affected_items.length > 5) summaryHtml += '<div class="text-slate-400 text-center">+' + (s.affected_items.length - 5) + ' صنف آخر...</div>';
                summaryHtml += '</div>';
                summaryHtml += '</div>';
            } else if (s.action_type === 'bulk_create_reorders') {
                summaryHtml = '<div class="space-y-1">';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">المورد:</span><span class="font-semibold text-slate-700">' + _esc(s.supplier_name) + '</span></div>';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">عدد الأصناف:</span><span class="text-slate-600">' + s.item_count + ' صنف</span></div>';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">الإجمالي:</span><span class="font-bold text-amber-700">' + parseFloat(s.grand_total).toLocaleString('ar-SA', {maximumFractionDigits: 2}) + ' ر.س</span></div>';
                summaryHtml += '<div class="text-[10px] text-slate-400 mt-1 max-h-20 overflow-y-auto">';
                s.items.slice(0, 5).forEach(function(item) {
                    summaryHtml += '<div class="flex justify-between"><span>' + _esc(item.product_name) + '</span><span>متبقي: ' + item.current_stock + ' → طلب: ' + item.reorder_qty + '</span></div>';
                });
                if (s.items.length > 5) summaryHtml += '<div class="text-slate-400 text-center">+' + (s.items.length - 5) + ' صنف آخر...</div>';
                summaryHtml += '</div>';
                summaryHtml += '</div>';
            } else if (s.action_type === 'create_client') {
                summaryHtml = '<div class="space-y-1">';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">الاسم:</span><span class="font-semibold text-slate-700">' + _esc(s.name) + '</span></div>';
                if (s.is_branch && s.parent_name) {
                    summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">النوع:</span><span class="font-semibold text-purple-600">فرع تابع لـ ' + _esc(s.parent_name) + '</span></div>';
                } else {
                    summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">النوع:</span><span class="font-semibold text-slate-600">عميل أساسي</span></div>';
                }
                summaryHtml += '<div class="flex justify-between items-center"><span class="text-slate-500">مسؤول التواصل:</span><input type="text" value="' + _esc(s.contact_person || '') + '" data-edit="contact_person" class="w-28 text-[11px] text-center border border-slate-200 rounded px-1 py-0.5 focus:border-brand-400 focus:outline-none"></div>';
                summaryHtml += '<div class="flex justify-between items-center"><span class="text-slate-500">الهاتف:</span><input type="text" value="' + _esc(s.phone || '') + '" data-edit="phone" class="w-28 text-[11px] text-center border border-slate-200 rounded px-1 py-0.5 focus:border-brand-400 focus:outline-none"></div>';
                summaryHtml += '<div class="flex justify-between items-center"><span class="text-slate-500">المدينة:</span><input type="text" value="' + _esc(s.city || '') + '" data-edit="city" class="w-28 text-[11px] text-center border border-slate-200 rounded px-1 py-0.5 focus:border-brand-400 focus:outline-none"></div>';
                summaryHtml += '<div class="flex justify-between items-center"><span class="text-slate-500">البريد:</span><input type="email" value="' + _esc(s.email || '') + '" data-edit="email" class="w-28 text-[11px] text-center border border-slate-200 rounded px-1 py-0.5 focus:border-brand-400 focus:outline-none"></div>';
                summaryHtml += '<div class="flex justify-between items-center"><span class="text-slate-500">العنوان:</span><input type="text" value="' + _esc(s.address || '') + '" data-edit="address" class="w-28 text-[11px] text-center border border-slate-200 rounded px-1 py-0.5 focus:border-brand-400 focus:outline-none"></div>';
                summaryHtml += '<div class="flex justify-between items-center"><span class="text-slate-500">حد الائتمان:</span><input type="number" min="0" step="0.01" value="' + parseFloat(s.credit_limit || 0).toFixed(2) + '" data-edit="credit_limit" class="w-24 text-[11px] text-center border border-slate-200 rounded px-1 py-0.5 focus:border-brand-400 focus:outline-none"></div>';
                summaryHtml += '</div>';
            } else if (s.action_type === 'update_order_status') {
                summaryHtml = '<div class="space-y-1">';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">طلب رقم:</span><span class="font-semibold text-slate-700">' + s.order_number + '</span></div>';
                if (s.client_name) summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">العميل:</span><span class="text-slate-600">' + _esc(s.client_name) + '</span></div>';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">الحالة الحالية:</span><span class="text-slate-600">' + _esc(s.current_status) + '</span></div>';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">الحالة الجديدة:</span><span class="font-bold text-amber-700">' + _esc(s.new_status) + '</span></div>';
                summaryHtml += '</div>';
            } else if (s.action_type === 'create_task') {
                summaryHtml = '<div class="space-y-1">';
                summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">العنوان:</span><span class="font-semibold text-slate-700">' + _esc(s.title) + '</span></div>';
                if (s.description) summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">الوصف:</span><span class="text-slate-600">' + _esc(s.description) + '</span></div>';
                if (s.assigned_to_name) summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">المسؤول:</span><span class="text-slate-600">' + _esc(s.assigned_to_name) + '</span></div>';
                if (s.priority) summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">الأولوية:</span><span class="text-slate-600">' + _esc(s.priority) + '</span></div>';
                if (s.due_date) summaryHtml += '<div class="flex justify-between"><span class="text-slate-500">تاريخ الاستحقاق:</span><span class="text-slate-600">' + _esc(s.due_date) + '</span></div>';
                summaryHtml += '</div>';
            }

            if (detailsEl) detailsEl.innerHTML = summaryHtml;

            // ── Live update: recalculate item totals on input change ──────────
            if (card) {
                var inputs = card.querySelectorAll('input[data-edit^="item_qty_"], input[data-edit^="item_price_"]');
                inputs.forEach(function(inp) {
                    inp.addEventListener('input', function() {
                        var editKey = inp.getAttribute('data-edit');
                        var match = editKey.match(/item_(qty|price)_(\d+)/);
                        if (!match) return;
                        var idx = parseInt(match[2]);
                        var qtyEl = card.querySelector('[data-edit="item_qty_' + idx + '"]');
                        var priceEl = card.querySelector('[data-edit="item_price_' + idx + '"]');
                        var totalEl = card.querySelector('[data-edit="item_total_' + idx + '"]');
                        var grandEl = card.querySelector('[data-edit="grand_total"]');
                        if (qtyEl && priceEl && totalEl) {
                            var lineTotal = (parseFloat(qtyEl.value) || 0) * (parseFloat(priceEl.value) || 0);
                            totalEl.textContent = lineTotal.toFixed(2);
                            // Recalculate grand total
                            if (grandEl) {
                                var grand = 0;
                                card.querySelectorAll('[data-edit^="item_total_"]').forEach(function(tEl) {
                                    grand += parseFloat(tEl.textContent) || 0;
                                });
                                grandEl.textContent = grand.toLocaleString('ar-SA', {maximumFractionDigits: 2}) + ' ر.س';
                            }
                        }
                    });
                });
            }

            // Step 4: Change button to "confirm execute"
            if (btnEl) {
                btnEl.innerHTML = '<i class="fa-solid fa-check ml-1 text-[10px]"></i>تأكيد التنفيذ';
                btnEl.disabled = false;
                btnEl.classList.remove('bg-amber-600', 'hover:bg-amber-700');
                btnEl.classList.add('bg-emerald-600', 'hover:bg-emerald-700');

                // Replace click handler — now executes
                btnEl.removeEventListener('click', btnEl._proposeHandler);
                btnEl.onclick = async function() {
                    btnEl.disabled = true;
                    btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin ml-1 text-[10px]"></i>جاري التنفيذ...';
                    try {
                        // ── Collect edited fields and send update-proposal first ──
                        var updatedProposal = {};
                        if (card) {
                            // Item quantities and prices (create_quote / create_production_order)
                            if (s.items && Array.isArray(s.items)) {
                                var updatedItems = s.items.map(function(item, idx) {
                                    var qtyEl = card.querySelector('[data-edit="item_qty_' + idx + '"]');
                                    var priceEl = card.querySelector('[data-edit="item_price_' + idx + '"]');
                                    return {
                                        variant_id: item.variant_id,
                                        product_name: item.product_name,
                                        size_name: item.size_name,
                                        sku: item.sku,
                                        quantity: qtyEl ? parseFloat(qtyEl.value) || 0 : item.quantity,
                                        unit_price: priceEl ? parseFloat(priceEl.value) || 0 : item.unit_price,
                                    };
                                });
                                updatedProposal.items = updatedItems;
                            }
                            // Payment amount (add_payment)
                            var payAmtEl = card.querySelector('[data-edit="payment_amount"]');
                            if (payAmtEl) updatedProposal.amount = parseFloat(payAmtEl.value) || 0;
                            // Client fields (create_client)
                            var clientFields = ['contact_person', 'phone', 'city', 'email', 'address', 'credit_limit'];
                            clientFields.forEach(function(field) {
                                var el = card.querySelector('[data-edit="' + field + '"]');
                                if (el) updatedProposal[field] = el.value;
                            });
                        }

                        // Send update if there are changes
                        if (Object.keys(updatedProposal).length > 0) {
                            await window.apiFetch('/api/ai-assistant/update-proposal', {
                                method: 'POST',
                                body: { action_id: proposeRes.action_id, updated_proposal: updatedProposal },
                            });
                        }

                        var execRes = await window.apiFetch('/api/ai-assistant/execute-action', {
                            method: 'POST',
                            body: { action_id: proposeRes.action_id },
                        });
                        if (execRes.success) {
                            // Build detailed success message from result
                            var resultHtml = '<div class="text-emerald-600 font-semibold"><i class="fa-solid fa-circle-check ml-1"></i>تم التنفيذ بنجاح!</div>';
                            if (execRes.result) {
                                var r = execRes.result;
                                var parts = [];
                                if (r.client_name) parts.push('العميل: ' + _esc(r.client_name));
                                if (r.is_branch) parts.push('(فرع تابع)');
                                if (r.order_number) parts.push('طلب #' + r.order_number);
                                if (r.order_id) parts.push('رقم الطلب: ' + _esc(String(r.order_id).substring(0, 8)));
                                if (r.invoice_number) parts.push('فاتورة #' + r.invoice_number);
                                if (r.task_id) parts.push('مهمة جديدة');
                                if (r.subtotal !== undefined) parts.push('الإجمالي: ' + r.grand_total + ' ريال');
                                if (parts.length > 0) {
                                    resultHtml += '<div class="text-xs text-slate-600 mt-1">' + parts.join(' • ') + '</div>';
                                }
                            }
                            if (detailsEl) detailsEl.innerHTML = resultHtml;
                            btnEl.remove();
                            var rejectBtn = card ? card.querySelector('.ai-propose-reject') : null;
                            if (rejectBtn) rejectBtn.remove();
                            if (window.showToast) window.showToast('تم تنفيذ الإجراء بنجاح', 'success');
                        } else {
                            throw new Error(execRes.error || 'فشل غير معروف');
                        }
                    } catch (execErr) {
                        if (detailsEl) detailsEl.innerHTML = '<div class="text-rose-600"><i class="fa-solid fa-circle-exclamation ml-1"></i>' + _esc(execErr.message || 'فشل في التنفيذ') + '</div>';
                        btnEl.disabled = false;
                        btnEl.innerHTML = '<i class="fa-solid fa-check ml-1 text-[10px]"></i>إعادة المحاولة';
                    }
                };
            }
        } catch (err) {
            if (detailsEl) detailsEl.innerHTML = '<div class="text-rose-600"><i class="fa-solid fa-circle-exclamation ml-1"></i>' + _esc(err.message || 'فشل في التحقق') + '</div>';
            if (btnEl) btnEl.disabled = false;
        }
    }

    // =============================================================================
    // Handle action button click (navigate / filter)
    // =============================================================================
    function _handleAction(action) {
        try {
            if (action.type === 'navigate') {
                // action.params = page_key (e.g. "warehouses")
                if (window.navigateTo) {
                    window.navigateTo(action.params);
                    // Close chat panel
                    _isOpen = false;
                    const panel = document.getElementById('ai-chat-panel');
                    if (panel) panel.style.display = 'none';
                }
            } else if (action.type === 'filter') {
                // action.params = "page_key:filter_key=filter_value"
                var parts = action.params.split(':');
                var pageKey = parts[0];
                var filterStr = parts[1] || '';
                if (window.navigateTo) {
                    window.navigateTo(pageKey);
                    // Close chat panel
                    _isOpen = false;
                    var panel = document.getElementById('ai-chat-panel');
                    if (panel) panel.style.display = 'none';
                    // Apply filter after page loads
                    if (filterStr) {
                        setTimeout(function() {
                            var kv = filterStr.split('=');
                            var filterEl = document.getElementById(kv[0]);
                            if (filterEl) {
                                filterEl.value = kv[1] || '';
                                if (filterEl.onchange) filterEl.onchange();
                                else filterEl.dispatchEvent(new Event('change'));
                            }
                        }, 800);
                    }
                }
            }
        } catch(e) {
            // Silently fail — don't break chat
            if (window.showToast) window.showToast('تعذّر تنفيذ الإجراء', 'error');
        }
    }

    // =============================================================================
    // Render panel with loading indicator
    // =============================================================================
    function _renderPanelWithLoading() {
        _renderPanel();
        const messagesEl = document.getElementById('ai-chat-messages');
        if (messagesEl) {
            const loadingEl = document.createElement('div');
            loadingEl.id = 'ai-chat-loading';
            loadingEl.className = 'flex justify-start';
            loadingEl.innerHTML = `
                <div class="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-3 py-3 shadow-sm">
                    <div class="flex gap-1">
                        <span class="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
                        <span class="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
                        <span class="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
                    </div>
                </div>
            `;
            messagesEl.appendChild(loadingEl);
            _scrollToBottom();
        }
    }

    // =============================================================================
    // Helpers
    // =============================================================================
    function _scrollToBottom() {
        const el = document.getElementById('ai-chat-messages');
        if (el) el.scrollTop = el.scrollHeight;
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

    // =============================================================================
    // Auto-init when DOM is ready (after login)
    // =============================================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // DOM already loaded — init after a short delay to let layout settle
        setTimeout(init, 500);
    }

    // Re-init on SPA navigation (in case panel was removed)
    window.addEventListener('hashchange', () => {
        if (!document.getElementById('ai-chat-btn')) {
            setTimeout(init, 300);
        }
    });

})();
