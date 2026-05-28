'use strict';

// =============================================================================
// G.PACK 2.0 - Settings View Controller (settings.js)
// Handles: Master Data management — Categories, Units & Standard Terms.
// Tabs, CRUD operations, permission gating.
// =============================================================================

(function () {

    // ── Private State ─────────────────────────────────────────────────────────
    let _categories     = [];
    let _units          = [];
    let _terms          = [];
    let _editingCatId   = null; // null = add mode, UUID = edit mode
    let _editingUnitId  = null;
    let _editingTermId  = null;
    let _activeTab      = 'categories';

    // ==========================================================================
    // _applyPermissions()
    // Gates Add buttons. Only admins (all_access) can manage master data.
    // ==========================================================================
    function _applyPermissions() {
        const perms    = window.GpackPerms || {};
        const isAdmin  = perms.all_access === true;
        const addCatBtn  = document.getElementById('add-category-btn');
        const addUnitBtn = document.getElementById('add-unit-btn');
        const addTermBtn = document.getElementById('add-term-btn');
        if (addCatBtn  && !isAdmin) addCatBtn.classList.add('hidden');
        if (addUnitBtn && !isAdmin) addUnitBtn.classList.add('hidden');
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

        const catPanel   = document.getElementById('tab-categories');
        const unitPanel  = document.getElementById('tab-units');
        const termPanel  = document.getElementById('tab-terms');
        const catBtn     = document.getElementById('tab-categories-btn');
        const unitBtn    = document.getElementById('tab-units-btn');
        const termBtn    = document.getElementById('tab-terms-btn');

        // Hide all panels
        if (catPanel)  catPanel.classList.add('hidden');
        if (unitPanel) unitPanel.classList.add('hidden');
        if (termPanel) termPanel.classList.add('hidden');

        // Reset all buttons
        [catBtn, unitBtn, termBtn].forEach(btn => {
            if (!btn) return;
            btn.classList.remove('border-brand-600', 'text-brand-600',
                                'border-emerald-600', 'text-emerald-600',
                                'border-violet-600', 'text-violet-600');
            btn.classList.add('border-transparent', 'text-slate-500');
        });

        if (tab === 'categories') {
            if (catPanel) catPanel.classList.remove('hidden');
            if (catBtn) {
                catBtn.classList.add('border-brand-600', 'text-brand-600');
                catBtn.classList.remove('border-transparent', 'text-slate-500');
            }
        } else if (tab === 'units') {
            if (unitPanel) unitPanel.classList.remove('hidden');
            if (unitBtn) {
                unitBtn.classList.add('border-emerald-600', 'text-emerald-600');
                unitBtn.classList.remove('border-transparent', 'text-slate-500');
            }
        } else if (tab === 'terms') {
            if (termPanel) termPanel.classList.remove('hidden');
            if (termBtn) {
                termBtn.classList.add('border-violet-600', 'text-violet-600');
                termBtn.classList.remove('border-transparent', 'text-slate-500');
            }
        }
    };

    // ==========================================================================
    // _renderCategoriesTable(categories)
    // ==========================================================================
    function _renderCategoriesTable(categories) {
        const tbody = document.getElementById('categories-tbody');
        const empty = document.getElementById('categories-empty');
        if (!tbody) return;

        if (!categories || categories.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        const perms   = window.GpackPerms || {};
        const isAdmin = perms.all_access === true;

        tbody.innerHTML = categories.map(c => `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3.5 px-4">
                    <span class="font-semibold text-slate-800 text-sm">${c.name}</span>
                </td>
                <td class="py-3.5 px-4 hidden sm:table-cell text-sm text-slate-500">
                    ${c.description || '<span class="text-slate-300">—</span>'}
                </td>
                <td class="py-3.5 px-4">
                    <div class="flex items-center justify-end gap-1">
                        ${isAdmin ? `
                        <button onclick="window.openSettingsCategoryModal('${c.id}')"
                                title="تعديل"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-brand-600 hover:bg-brand-50 transition-colors">
                            <i class="fa-solid fa-pen-to-square text-sm"></i>
                        </button>
                        <button onclick="window.deleteSettingsCategory('${c.id}', '${c.name.replace(/'/g, "\\'")}')"
                                title="حذف"
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
    // _renderUnitsTable(units)
    // ==========================================================================
    function _renderUnitsTable(units) {
        const tbody = document.getElementById('units-tbody');
        const empty = document.getElementById('units-empty');
        if (!tbody) return;

        if (!units || units.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        const perms   = window.GpackPerms || {};
        const isAdmin = perms.all_access === true;

        tbody.innerHTML = units.map(u => `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3.5 px-4">
                    <span class="font-semibold text-slate-800 text-sm">${u.name}</span>
                </td>
                <td class="py-3.5 px-4 hidden sm:table-cell text-sm text-slate-500">
                    ${u.abbreviation
                        ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs
                                        font-semibold bg-slate-100 text-slate-600">${u.abbreviation}</span>`
                        : '<span class="text-slate-300">—</span>'}
                </td>
                <td class="py-3.5 px-4">
                    <div class="flex items-center justify-end gap-1">
                        ${isAdmin ? `
                        <button onclick="window.openSettingsUnitModal('${u.id}')"
                                title="تعديل"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                            <i class="fa-solid fa-pen-to-square text-sm"></i>
                        </button>
                        <button onclick="window.deleteSettingsUnit('${u.id}', '${u.name.replace(/'/g, "\\'")}')"
                                title="حذف"
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
    // _loadCategories() / _loadUnits()
    // ==========================================================================
    async function _loadCategories() {
        const tbody = document.getElementById('categories-tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="3" class="py-10 text-center text-slate-400">
                <i class="fa-solid fa-circle-notch fa-spin text-xl"></i></td></tr>`;
        }
        try {
            const res  = await window.apiFetch('/api/categories');
            _categories = (res && res.data) ? res.data : [];
            _renderCategoriesTable(_categories);
        } catch (err) {
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="3" class="py-8 text-center text-red-400 text-sm">
                    <i class="fa-solid fa-circle-exclamation ml-1"></i>
                    فشل تحميل التصنيفات: ${err.message}</td></tr>`;
            }
        }
    }

    async function _loadUnits() {
        const tbody = document.getElementById('units-tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="3" class="py-10 text-center text-slate-400">
                <i class="fa-solid fa-circle-notch fa-spin text-xl"></i></td></tr>`;
        }
        try {
            const res = await window.apiFetch('/api/units');
            _units    = (res && res.data) ? res.data : [];
            _renderUnitsTable(_units);
        } catch (err) {
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="3" class="py-8 text-center text-red-400 text-sm">
                    <i class="fa-solid fa-circle-exclamation ml-1"></i>
                    فشل تحميل الوحدات: ${err.message}</td></tr>`;
            }
        }
    }

    // ==========================================================================
    // CATEGORY MODAL — Open / Close / Submit
    // ==========================================================================
    window.openSettingsCategoryModal = function (id = null) {
        _editingCatId = id;
        _clearError('settings-category-error');

        const nameEl  = document.getElementById('settings-category-name');
        const descEl  = document.getElementById('settings-category-description');
        const title   = document.getElementById('category-modal-title');
        const submitBtn = document.getElementById('settings-category-submit-btn');

        if (id) {
            const cat = _categories.find(c => c.id === id);
            if (!cat) return;
            if (title)   title.textContent       = 'تعديل التصنيف';
            if (submitBtn) submitBtn.textContent  = 'حفظ التعديلات';
            if (nameEl)  nameEl.value  = cat.name        || '';
            if (descEl)  descEl.value  = cat.description || '';
        } else {
            if (title)   title.textContent       = 'إضافة تصنيف جديد';
            if (submitBtn) submitBtn.textContent  = 'إضافة';
            if (nameEl)  nameEl.value  = '';
            if (descEl)  descEl.value  = '';
        }

        _openModal('settings-category-modal');
        setTimeout(() => { if (nameEl) nameEl.focus(); }, 250);
    };

    window.closeSettingsCategoryModal = function () {
        _closeModal('settings-category-modal');
        _editingCatId = null;
    };

    window.submitSettingsCategoryForm = async function () {
        _clearError('settings-category-error');
        const submitBtn = document.getElementById('settings-category-submit-btn');
        const name = (document.getElementById('settings-category-name')?.value || '').trim();

        if (!name) {
            _showError('settings-category-error', 'اسم التصنيف مطلوب.');
            return;
        }

        if (submitBtn) {
            submitBtn.disabled  = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جارٍ الحفظ...';
        }

        const payload = {
            name,
            description: (document.getElementById('settings-category-description')?.value || '').trim() || null,
        };

        try {
            let res;
            if (_editingCatId) {
                res = await window.apiFetch(`/api/categories/${_editingCatId}`, {
                    method: 'PUT',
                    body:   payload,
                });
            } else {
                res = await window.apiFetch('/api/categories', {
                    method: 'POST',
                    body:   payload,
                });
            }

            if (res && (res.data || res.message)) {
                window.showToast(
                    _editingCatId ? 'تم تحديث التصنيف بنجاح.' : 'تمت إضافة التصنيف بنجاح.',
                    'success'
                );
                window.closeSettingsCategoryModal();
                await _loadCategories();
            }
        } catch (err) {
            _showError('settings-category-error', err.message || 'حدث خطأ غير متوقع.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled    = false;
                submitBtn.textContent = _editingCatId ? 'حفظ التعديلات' : 'إضافة';
            }
        }
    };

    // ==========================================================================
    // CATEGORY DELETE
    // ==========================================================================
    window.deleteSettingsCategory = async function (id, name) {
        if (!confirm(`هل أنت متأكد من حذف التصنيف "${name}"؟\nلا يمكن التراجع عن هذا الإجراء.`)) return;

        try {
            await window.apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
            window.showToast(`تم حذف التصنيف "${name}" بنجاح.`, 'success');
            await _loadCategories();
        } catch (err) {
            window.showToast(err.message || 'فشل حذف التصنيف.', 'error');
        }
    };

    // ==========================================================================
    // UNIT MODAL — Open / Close / Submit
    // ==========================================================================
    window.openSettingsUnitModal = function (id = null) {
        _editingUnitId = id;
        _clearError('settings-unit-error');

        const nameEl  = document.getElementById('settings-unit-name');
        const abbrEl  = document.getElementById('settings-unit-abbreviation');
        const title   = document.getElementById('unit-modal-title');
        const submitBtn = document.getElementById('settings-unit-submit-btn');

        if (id) {
            const unit = _units.find(u => u.id === id);
            if (!unit) return;
            if (title)   title.textContent       = 'تعديل وحدة القياس';
            if (submitBtn) submitBtn.textContent  = 'حفظ التعديلات';
            if (nameEl)  nameEl.value  = unit.name         || '';
            if (abbrEl)  abbrEl.value  = unit.abbreviation || '';
        } else {
            if (title)   title.textContent       = 'إضافة وحدة قياس جديدة';
            if (submitBtn) submitBtn.textContent  = 'إضافة';
            if (nameEl)  nameEl.value  = '';
            if (abbrEl)  abbrEl.value  = '';
        }

        _openModal('settings-unit-modal');
        setTimeout(() => { if (nameEl) nameEl.focus(); }, 250);
    };

    window.closeSettingsUnitModal = function () {
        _closeModal('settings-unit-modal');
        _editingUnitId = null;
    };

    window.submitSettingsUnitForm = async function () {
        _clearError('settings-unit-error');
        const submitBtn = document.getElementById('settings-unit-submit-btn');
        const name = (document.getElementById('settings-unit-name')?.value || '').trim();

        if (!name) {
            _showError('settings-unit-error', 'اسم الوحدة مطلوب.');
            return;
        }

        if (submitBtn) {
            submitBtn.disabled  = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جارٍ الحفظ...';
        }

        const payload = {
            name,
            abbreviation: (document.getElementById('settings-unit-abbreviation')?.value || '').trim() || null,
        };

        try {
            let res;
            if (_editingUnitId) {
                res = await window.apiFetch(`/api/units/${_editingUnitId}`, {
                    method: 'PUT',
                    body:   payload,
                });
            } else {
                res = await window.apiFetch('/api/units', {
                    method: 'POST',
                    body:   payload,
                });
            }

            if (res && (res.data || res.message)) {
                window.showToast(
                    _editingUnitId ? 'تم تحديث الوحدة بنجاح.' : 'تمت إضافة الوحدة بنجاح.',
                    'success'
                );
                window.closeSettingsUnitModal();
                await _loadUnits();
            }
        } catch (err) {
            _showError('settings-unit-error', err.message || 'حدث خطأ غير متوقع.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled    = false;
                submitBtn.textContent = _editingUnitId ? 'حفظ التعديلات' : 'إضافة';
            }
        }
    };

    // ==========================================================================
    // UNIT DELETE
    // ==========================================================================
    window.deleteSettingsUnit = async function (id, name) {
        if (!confirm(`هل أنت متأكد من حذف الوحدة "${name}"؟\nلا يمكن التراجع عن هذا الإجراء.`)) return;

        try {
            await window.apiFetch(`/api/units/${id}`, { method: 'DELETE' });
            window.showToast(`تم حذف الوحدة "${name}" بنجاح.`, 'success');
            await _loadUnits();
        } catch (err) {
            window.showToast(err.message || 'فشل حذف الوحدة.', 'error');
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
        // Category modal
        const catClose  = document.getElementById('settings-category-close-btn');
        const catCancel = document.getElementById('settings-category-cancel-btn');
        const catModal  = document.getElementById('settings-category-modal');
        if (catClose)  catClose.addEventListener('click',  window.closeSettingsCategoryModal);
        if (catCancel) catCancel.addEventListener('click', window.closeSettingsCategoryModal);
        if (catModal)  catModal.addEventListener('click', (e) => {
            if (e.target === catModal) window.closeSettingsCategoryModal();
        });

        // Unit modal
        const unitClose  = document.getElementById('settings-unit-close-btn');
        const unitCancel = document.getElementById('settings-unit-cancel-btn');
        const unitModal  = document.getElementById('settings-unit-modal');
        if (unitClose)  unitClose.addEventListener('click',  window.closeSettingsUnitModal);
        if (unitCancel) unitCancel.addEventListener('click', window.closeSettingsUnitModal);
        if (unitModal)  unitModal.addEventListener('click', (e) => {
            if (e.target === unitModal) window.closeSettingsUnitModal();
        });

        // Term modal
        const termClose  = document.getElementById('settings-term-close-btn');
        const termCancel = document.getElementById('settings-term-cancel-btn');
        const termModal  = document.getElementById('settings-term-modal');
        if (termClose)  termClose.addEventListener('click',  window.closeSettingsTermModal);
        if (termCancel) termCancel.addEventListener('click', window.closeSettingsTermModal);
        if (termModal)  termModal.addEventListener('click', (e) => {
            if (e.target === termModal) window.closeSettingsTermModal();
        });
    }

    // ==========================================================================
    // initSettingsView()
    // Entry point — called at bottom of IIFE.
    // ==========================================================================
    async function initSettingsView() {
        _applyPermissions();
        _wireModalEvents();

        // Add buttons
        const addCatBtn  = document.getElementById('add-category-btn');
        const addUnitBtn = document.getElementById('add-unit-btn');
        const addTermBtn = document.getElementById('add-term-btn');
        if (addCatBtn)  addCatBtn.addEventListener('click',  () => window.openSettingsCategoryModal());
        if (addUnitBtn) addUnitBtn.addEventListener('click', () => window.openSettingsUnitModal());
        if (addTermBtn) addTermBtn.addEventListener('click', () => window.openSettingsTermModal());

        // Load all datasets in parallel
        await Promise.all([_loadCategories(), _loadUnits(), _loadTerms()]);
    }

    // ── Auto-execute ──────────────────────────────────────────────────────────
    initSettingsView();

})();
