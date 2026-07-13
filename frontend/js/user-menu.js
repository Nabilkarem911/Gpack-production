'use strict';

(function () {

    let _isOpen = false;

    const ROLE_LABELS = {
        super_admin:       'مدير النظام',
        sales_manager:     'مدير المبيعات',
        sales_rep:         'مندوب مبيعات',
        inventory_manager: 'مدير المستودع',
        accountant:        'محاسب',
    };

    const SHORTCUTS = [
        { label: 'عروض الأسعار',  route: 'quotations',    icon: 'fa-file-invoice' },
        { label: 'أوامر التشغيل',  route: 'production-orders', icon: 'fa-gears' },
        { label: 'المخزون',        route: 'inventory',     icon: 'fa-boxes-stacked' },
        { label: 'العملاء',        route: 'clients',       icon: 'fa-users' },
        { label: 'الفواتير',       route: 'sales-invoices', icon: 'fa-receipt' },
        { label: 'الذكاء الاصطناعي', route: 'forecast',    icon: 'fa-brain' },
    ];

    function _el(id) { return document.getElementById(id); }

    function _init() {
        const user = window.GpackUser;
        if (!user) return;

        const nameEl = _el('user-panel-name');
        const roleEl = _el('user-panel-role');
        const emailEl = _el('user-panel-email');

        if (nameEl) nameEl.textContent = user.name || '—';
        if (roleEl) roleEl.textContent = ROLE_LABELS[user.role] || user.role || '—';
        if (emailEl) emailEl.textContent = user.email || '';

        _renderShortcuts();
    }

    function _renderShortcuts() {
        const container = _el('user-shortcuts');
        if (!container) return;
        container.innerHTML = SHORTCUTS.map(s =>
            `<span class="user-shortcut" onclick="window.userMenuNavigate('${s.route}')">
                <i class="fa-solid ${s.icon} text-[10px] ml-1"></i>${s.label}
            </span>`
        ).join('');
    }

    window.userMenuToggle = function (e) {
        if (e) e.stopPropagation();
        const panel = _el('user-panel');
        if (!panel) return;
        _isOpen = !_isOpen;
        if (_isOpen) {
            _init();
            panel.classList.add('open');
        } else {
            panel.classList.remove('open');
        }
    };

    window.userMenuNavigate = function (route) {
        _closePanel();
        if (window.navigateTo) window.navigateTo(route);
    };

    window.userMenuSettings = function () {
        _closePanel();
        if (window.navigateTo) window.navigateTo('settings');
    };

    window.userMenuChangePassword = function () {
        _closePanel();
        _showChangePasswordModal();
    };

    function _closePanel() {
        _isOpen = false;
        const panel = _el('user-panel');
        if (panel) panel.classList.remove('open');
    }

    function _showChangePasswordModal() {
        const existing = document.getElementById('change-pwd-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'change-pwd-modal';
        modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/40';
        modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
                <div class="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                    <h3 class="font-bold text-slate-800 text-lg">
                        <i class="fa-solid fa-key text-brand-600 ml-2"></i>
                        تغيير كلمة المرور
                    </h3>
                    <button onclick="document.getElementById('change-pwd-modal').remove()"
                            class="text-slate-400 hover:text-slate-600 transition-colors">
                        <i class="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>
                <div class="p-6 space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1.5">كلمة المرور الحالية</label>
                        <div class="relative">
                            <input type="password" id="pwd-current" autocomplete="current-password"
                                   class="w-full pr-4 pl-10 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all" />
                            <i class="fa-solid fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-sm"></i>
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1.5">كلمة المرور الجديدة</label>
                        <div class="relative">
                            <input type="password" id="pwd-new" autocomplete="new-password"
                                   class="w-full pr-4 pl-10 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all" />
                            <i class="fa-solid fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-sm"></i>
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1.5">تأكيد كلمة المرور</label>
                        <div class="relative">
                            <input type="password" id="pwd-confirm" autocomplete="new-password"
                                   class="w-full pr-4 pl-10 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all" />
                            <i class="fa-solid fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-sm"></i>
                        </div>
                    </div>
                    <div id="pwd-error" class="hidden text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2"></div>
                </div>
                <div class="px-6 py-4 border-t border-slate-100 flex gap-3">
                    <button onclick="window._submitChangePassword()"
                            class="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl transition-colors">
                        <i class="fa-solid fa-check ml-1"></i> حفظ
                    </button>
                    <button onclick="document.getElementById('change-pwd-modal').remove()"
                            class="flex-1 py-2.5 border border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-50 transition-colors">
                        إلغاء
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', function (e) {
            if (e.target === modal) modal.remove();
        });
    }

    window._submitChangePassword = async function () {
        const current = document.getElementById('pwd-current').value;
        const newPwd = document.getElementById('pwd-new').value;
        const confirm = document.getElementById('pwd-confirm').value;
        const errEl = document.getElementById('pwd-error');

        errEl.classList.add('hidden');

        if (!current || !newPwd || !confirm) {
            errEl.textContent = 'جميع الحقول مطلوبة';
            errEl.classList.remove('hidden');
            return;
        }
        if (newPwd.length < 6) {
            errEl.textContent = 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل';
            errEl.classList.remove('hidden');
            return;
        }
        if (newPwd !== confirm) {
            errEl.textContent = 'كلمة المرور الجديدة وتأكيدها غير متطابقين';
            errEl.classList.remove('hidden');
            return;
        }

        try {
            const res = await window.apiFetch('/api/auth/change-password', {
                method: 'POST',
                body: { current_password: current, new_password: newPwd }
            });
            window.showToast('تم تغيير كلمة المرور بنجاح', 'success');
            document.getElementById('change-pwd-modal').remove();
        } catch (err) {
            errEl.textContent = err.message || 'فشل في تغيير كلمة المرور';
            errEl.classList.remove('hidden');
        }
    };

    document.addEventListener('click', function (e) {
        if (!_isOpen) return;
        const panel = _el('user-panel');
        const header = _el('header-user');
        if (panel && !panel.contains(e.target) && header && !header.contains(e.target)) {
            _closePanel();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

})();
