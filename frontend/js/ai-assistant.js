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
    let _aiEnabled = null;

    // ── Suggested questions ───────────────────────────────────────────────────
    const SUGGESTIONS = [
        { text: 'إيه إجمالي مبيعات اليوم؟', icon: 'fa-chart-line' },
        { text: 'أكثر 5 منتجات مبيعاً هذا الشهر', icon: 'fa-trophy' },
        { text: 'حالة المخزون — إيه اللي قارب على النفاد؟', icon: 'fa-boxes-stacked' },
        { text: 'مين أرخص مورد للأكواب؟', icon: 'fa-tags' },
        { text: 'إيه المستحقات المعلقة على العملاء؟', icon: 'fa-hand-holding-dollar' },
        { text: 'كم عرض سعر معلق حالياً؟', icon: 'fa-file-lines' },
    ];

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

            <!-- Suggestions (shown only when no messages) -->
            ${_messages.length === 0 ? `
                <div id="ai-chat-suggestions" class="px-4 py-2 border-t border-slate-200 bg-white">
                    <p class="text-xs text-slate-400 mb-2">أسئلة مقترحة:</p>
                    <div class="flex flex-wrap gap-2">
                        ${SUGGESTIONS.map(s => `
                            <button class="ai-suggestion-chip text-xs px-3 py-1.5 rounded-full bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors border border-brand-200" data-question="${s.text}">
                                <i class="fa-solid ${s.icon} ml-1 text-[10px]"></i>${s.text}
                            </button>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            <!-- Input area -->
            <div class="px-4 py-3 border-t border-slate-200 bg-white rounded-b-2xl">
                <div class="flex items-center gap-2">
                    <input id="ai-chat-input" type="text"
                        class="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                        placeholder="اكتب سؤالك..." autocomplete="off" />
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

        // Suggestion chips
        document.querySelectorAll('.ai-suggestion-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const q = chip.getAttribute('data-question');
                if (input) input.value = q;
                _sendMessage();
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
        return `
            <div class="flex justify-start">
                <div class="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-3 py-2 max-w-[80%] text-sm text-slate-700 shadow-sm">
                    ${_esc(msg.content).replace(/\n/g, '<br>')}
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
            const res = await window.apiFetch('/api/ai-assistant/chat', {
                method: 'POST',
                body: { message: text },
            });

            _messages.push({ role: 'assistant', content: res.reply || 'عذراً، لم أتمكن من الرد.' });
        } catch (err) {
            _messages.push({ role: 'assistant', content: 'حدث خطأ: ' + (err.message || 'تعذّر الاتصال بالمساعد') });
        } finally {
            _isLoading = false;
            _renderPanel();
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
