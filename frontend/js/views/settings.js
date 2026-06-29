'use strict';

// =============================================================================
// G.PACK 2.0 - Settings View Controller (settings.js)
// Handles: Master Data management — Standard Terms.
// Tabs, CRUD operations, permission gating.
// =============================================================================

(function () {

    // ── Private State ─────────────────────────────────────────────────────────
    let _terms          = [];
    let _editingTermId  = null;
    let _activeTab      = 'terms';

    // ==========================================================================
    // _applyPermissions()
    // Gates Add buttons. Only admins (all_access) can manage master data.
    // ==========================================================================
    function _applyPermissions() {
        const perms    = window.GpackPerms || {};
        const isAdmin  = perms.all_access === true;
        const addTermBtn = document.getElementById('add-term-btn');
        if (addTermBtn && !isAdmin) addTermBtn.classList.add('hidden');
    }

    // ==========================================================================
    // _showError(errorDivId, msg) / _clearError(errorDivId)
    // ==========================================================================
    function _showError(errorDivId, msg) {
        const box  = document.getElementById(errorDivId);
        const span = box ? box.querySelector('span') : null;
        if (!box) return;
        if (span) span.textContent = msg;
        else      box.textContent  = msg;
        box.classList.remove('hidden');
    }

    function _clearError(errorDivId) {
        const box  = document.getElementById(errorDivId);
        const span = box ? box.querySelector('span') : null;
        if (!box) return;
        if (span) span.textContent = '';
        box.classList.add('hidden');
    }

    // ==========================================================================
    // _openModal(modalId) / _closeModal(modalId)
    // CSS opacity/scale transition — same pattern used across all views.
    // ==========================================================================
    function _openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('opacity-100');
            modal.querySelector('.modal-panel').classList.add('scale-100');
        });
    }

    function _closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.classList.remove('opacity-100');
        modal.querySelector('.modal-panel').classList.remove('scale-100');
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    }

    // ==========================================================================
    // window.switchSettingsTab(tab)
    // Switches between 'categories' and 'units' tabs.
    // ==========================================================================
    window.switchSettingsTab = function (tab) {
        _activeTab = tab;

        const termPanel  = document.getElementById('tab-terms');
        const termBtn    = document.getElementById('tab-terms-btn');

        if (termPanel) termPanel.classList.add('hidden');
        if (termBtn) {
            termBtn.classList.remove('border-violet-600', 'text-violet-600');
            termBtn.classList.add('border-transparent', 'text-slate-500');
        }

        if (tab === 'terms') {
            if (termPanel) termPanel.classList.remove('hidden');
            if (termBtn) {
                termBtn.classList.add('border-violet-600', 'text-violet-600');
                termBtn.classList.remove('border-transparent', 'text-slate-500');
            }
        }
    };

    // ==========================================================================
    // _renderTermsTable(terms)
    // ==========================================================================
    function _renderTermsTable(terms) {
        const tbody = document.getElementById('terms-tbody');
        const empty = document.getElementById('terms-empty');
        if (!tbody) return;

        if (!terms || terms.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        const perms   = window.GpackPerms || {};
        const isAdmin = perms.all_access === true;

        tbody.innerHTML = terms.map(t => `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3.5 px-4">
                    <span class="font-semibold text-slate-800 text-sm">${t.title}</span>
                </td>
                <td class="py-3.5 px-4 hidden sm:table-cell text-sm text-slate-500">
                    <span class="line-clamp-2">${t.content || '<span class="text-slate-300">\u2014</span>'}</span>
                </td>
                <td class="py-3.5 px-4 text-center">
                    ${t.is_default
                        ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">\u0627\u0641\u062a\u0631\u0627\u0636\u064a</span>'
                        : '<span class="text-slate-300">\u2014</span>'}
                </td>
                <td class="py-3.5 px-4">
                    <div class="flex items-center justify-end gap-1">
                        ${isAdmin ? `
                        <button onclick="window.openSettingsTermModal('${t.id}')"
                                title="\u062a\u0639\u062f\u064a\u0644"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-violet-600 hover:bg-violet-50 transition-colors">
                            <i class="fa-solid fa-pen-to-square text-sm"></i>
                        </button>
                        <button onclick="window.deleteSettingsTerm('${t.id}', '${t.title.replace(/'/g, "\\'")}')"
                                title="\u062d\u0630\u0641"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-red-600 hover:bg-red-50 transition-colors">
                            <i class="fa-solid fa-trash text-sm"></i>
                        </button>` : ''}
                    </div>
                </td>
            </tr>
        `).join('');
    }

    // ==========================================================================
    // _loadTerms()
    // ==========================================================================
    async function _loadTerms() {
        const tbody = document.getElementById('terms-tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="4" class="py-10 text-center text-slate-400">
                <i class="fa-solid fa-circle-notch fa-spin text-xl"></i></td></tr>`;
        }
        try {
            const res = await window.apiFetch('/api/terms');
            _terms    = (res && res.data) ? res.data : [];
            _renderTermsTable(_terms);
        } catch (err) {
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-red-400 text-sm">
                    <i class="fa-solid fa-circle-exclamation ml-1"></i>
                    \u0641\u0634\u0644 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0628\u0646\u0648\u062f: ${err.message}</td></tr>`;
            }
        }
    }

    // ==========================================================================
    // TERM MODAL — Open / Close / Submit
    // ==========================================================================
    window.openSettingsTermModal = function (id = null) {
        _editingTermId = id;
        _clearError('settings-term-error');

        const titleEl    = document.getElementById('settings-term-title');
        const contentEl  = document.getElementById('settings-term-content');
        const defaultEl  = document.getElementById('settings-term-default');
        const modalTitle = document.getElementById('term-modal-title');
        const submitBtn  = document.getElementById('settings-term-submit-btn');

        if (id) {
            const term = _terms.find(t => t.id === id);
            if (!term) return;
            if (modalTitle) modalTitle.textContent   = '\u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0628\u0646\u062f';
            if (submitBtn)  submitBtn.textContent     = '\u062d\u0641\u0638 \u0627\u0644\u062a\u0639\u062f\u064a\u0644\u0627\u062a';
            if (titleEl)    titleEl.value   = term.title   || '';
            if (contentEl)  contentEl.value = term.content || '';
            if (defaultEl)  defaultEl.checked = !!term.is_default;
        } else {
            if (modalTitle) modalTitle.textContent   = '\u0625\u0636\u0627\u0641\u0629 \u0628\u0646\u062f \u062c\u062f\u064a\u062f';
            if (submitBtn)  submitBtn.textContent     = '\u0625\u0636\u0627\u0641\u0629';
            if (titleEl)    titleEl.value   = '';
            if (contentEl)  contentEl.value = '';
            if (defaultEl)  defaultEl.checked = false;
        }

        _openModal('settings-term-modal');
        setTimeout(() => { if (titleEl) titleEl.focus(); }, 250);
    };

    window.closeSettingsTermModal = function () {
        _closeModal('settings-term-modal');
        _editingTermId = null;
    };

    window.submitSettingsTermForm = async function () {
        _clearError('settings-term-error');
        const submitBtn = document.getElementById('settings-term-submit-btn');
        const title     = (document.getElementById('settings-term-title')?.value || '').trim();
        const content   = (document.getElementById('settings-term-content')?.value || '').trim();
        const isDefault = document.getElementById('settings-term-default')?.checked || false;

        if (!title) {
            _showError('settings-term-error', '\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0628\u0646\u062f \u0645\u0637\u0644\u0648\u0628.');
            return;
        }
        if (!content) {
            _showError('settings-term-error', '\u0645\u062d\u062a\u0648\u0649 \u0627\u0644\u0628\u0646\u062f \u0645\u0637\u0644\u0648\u0628.');
            return;
        }

        if (submitBtn) {
            submitBtn.disabled  = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> \u062c\u0627\u0631\u064d \u0627\u0644\u062d\u0641\u0638...';
        }

        const payload = {
            title,
            content,
            is_default: isDefault,
        };

        try {
            let res;
            if (_editingTermId) {
                res = await window.apiFetch(`/api/terms/${_editingTermId}`, {
                    method: 'PUT',
                    body:   payload,
                });
            } else {
                res = await window.apiFetch('/api/terms', {
                    method: 'POST',
                    body:   payload,
                });
            }

            if (res && (res.data || res.message)) {
                window.showToast(
                    _editingTermId ? '\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0628\u0646\u062f \u0628\u0646\u062c\u0627\u062d.' : '\u062a\u0645\u062a \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0628\u0646\u062f \u0628\u0646\u062c\u0627\u062d.',
                    'success'
                );
                window.closeSettingsTermModal();
                await _loadTerms();
            }
        } catch (err) {
            _showError('settings-term-error', err.message || '\u062d\u062f\u062b \u062e\u0637\u0623 \u063a\u064a\u0631 \u0645\u062a\u0648\u0642\u0639.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled    = false;
                submitBtn.textContent = _editingTermId ? '\u062d\u0641\u0638 \u0627\u0644\u062a\u0639\u062f\u064a\u0644\u0627\u062a' : '\u0625\u0636\u0627\u0641\u0629';
            }
        }
    };

    // ==========================================================================
    // TERM DELETE
    // ==========================================================================
    window.deleteSettingsTerm = async function (id, title) {
        if (!confirm(`\u0647\u0644 \u0623\u0646\u062a \u0645\u062a\u0623\u0643\u062f \u0645\u0646 \u062d\u0630\u0641 \u0627\u0644\u0628\u0646\u062f "${title}"\u061f\n\u0644\u0627 \u064a\u0645\u0643\u0646 \u0627\u0644\u062a\u0631\u0627\u062c\u0639 \u0639\u0646 \u0647\u0630\u0627 \u0627\u0644\u0625\u062c\u0631\u0627\u0621.`)) return;

        try {
            await window.apiFetch(`/api/terms/${id}`, { method: 'DELETE' });
            window.showToast(`\u062a\u0645 \u062d\u0630\u0641 \u0627\u0644\u0628\u0646\u062f "${title}" \u0628\u0646\u062c\u0627\u062d.`, 'success');
            await _loadTerms();
        } catch (err) {
            window.showToast(err.message || '\u0641\u0634\u0644 \u062d\u0630\u0641 \u0627\u0644\u0628\u0646\u062f.', 'error');
        }
    };

    // ==========================================================================
    // _wireModalEvents()
    // Wires close buttons and backdrop clicks for both modals.
    // ==========================================================================
    function _wireModalEvents() {
        // Term modal
        const termClose  = document.getElementById('settings-term-close-btn');
        const termCancel = document.getElementById('settings-term-cancel-btn');
        const termModal  = document.getElementById('settings-term-modal');
        if (termClose)  termClose.addEventListener('click',  window.closeSettingsTermModal);
        if (termCancel) termCancel.addEventListener('click', window.closeSettingsTermModal);
    }

    // ==========================================================================
    // initSettingsView()
    // Entry point — called at bottom of IIFE.
    // ==========================================================================
    async function initSettingsView() {
        _applyPermissions();
        _wireModalEvents();

        // Add button
        const addTermBtn = document.getElementById('add-term-btn');
        if (addTermBtn) addTermBtn.addEventListener('click', () => window.openSettingsTermModal());

        // Load terms
        await _loadTerms();
    }

    // ── Auto-execute ──────────────────────────────────────────────────────────
    initSettingsView();

})();
