'use strict';

// =============================================================================
// G.PACK 2.0 - Clients View Controller (clients.js)
// Handles all logic for frontend/views/clients.html.
// Called by the SPA router: window.initClientsView()
// Depends on: api.js (apiFetch, GpackPerms, showToast)
// =============================================================================

(function () {

    // Internal state
    let _allClients   = [];
    let _mainClients  = [];
    let _editingId    = null;

    // ==========================================================================
    // loadClients()
    // Fetches clients from the API and renders the table.
    // ==========================================================================
    async function loadClients() {
        const tbody = document.getElementById('clients-tbody');
        const empty = document.getElementById('clients-empty');
        if (!tbody) return;

        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="py-10 text-center text-slate-400">
                    <i class="fa-solid fa-circle-notch fa-spin text-2xl"></i>
                </td>
            </tr>`;

        try {
            const res = await window.apiFetch('/api/clients');
            _allClients  = res.data || [];
            _mainClients = _allClients.filter(c => c.parent_id === null);

            _populateParentDropdown(_mainClients);
            _renderTable(_allClients);
        } catch (err) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="py-10 text-center text-red-400 text-sm">
                        <i class="fa-solid fa-triangle-exclamation ml-2"></i>
                        ${err.message}
                    </td>
                </tr>`;
        }
    }

    // ==========================================================================
    // _renderTable(clients)
    // Renders main clients with collapsible branch rows underneath.
    // ==========================================================================

    // Track which parent IDs have their branches expanded
    const _expandedParents = new Set();

    function _renderTable(clients) {
        const tbody = document.getElementById('clients-tbody');
        const empty = document.getElementById('clients-empty');
        if (!tbody) return;

        if (clients.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        const canEdit = window.GpackPerms && (
            window.GpackPerms.all_access ||
            (window.GpackPerms.clients && window.GpackPerms.clients.update)
        );

        // Build branch map: parent_id -> [branches]
        const branchMap = {};
        clients.forEach(c => {
            if (c.parent_id) {
                if (!branchMap[c.parent_id]) branchMap[c.parent_id] = [];
                branchMap[c.parent_id].push(c);
            }
        });

        const mainClients = clients.filter(c => !c.parent_id);

        const rows = [];

        mainClients.forEach(c => {
            const branches   = branchMap[c.id] || [];
            const hasBranches = branches.length > 0;
            const isExpanded  = _expandedParents.has(c.id);

            const statusDot = c.status === 'active'
                ? `<span class="w-2 h-2 rounded-full bg-emerald-500 inline-block ml-1 shrink-0"></span>`
                : `<span class="w-2 h-2 rounded-full bg-slate-300 inline-block ml-1 shrink-0"></span>`;

            const editBtn = canEdit
                ? `<button onclick="window.openClientModal('${c.id}')"
                        class="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                        title="تعديل"><i class="fa-solid fa-pen-to-square text-sm"></i></button>`
                : '';

            // Toggle button for branches
            const toggleBtn = hasBranches
                ? `<button onclick="window._toggleBranches('${c.id}')"
                        class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold
                               bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors shrink-0"
                        title="${isExpanded ? 'إخفاء الفروع' : 'عرض الفروع'}">
                        <i class="fa-solid fa-code-branch text-xs"></i>
                        <span>${branches.length}</span>
                        <i class="fa-solid fa-chevron-${isExpanded ? 'up' : 'down'} text-xs transition-transform"></i>
                   </button>`
                : `<span class="px-2.5 py-1 bg-brand-50 text-brand-600 rounded-lg text-xs font-bold">رئيسي</span>`;

            // Main client row
            rows.push(`
                <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100">
                    <td class="py-3.5 px-4">
                        <div class="flex items-center gap-2">
                            ${statusDot}
                            <button onclick="window.openClientProfile('${c.id}')"
                                    class="font-semibold text-slate-800 text-sm hover:text-brand-600 transition-colors text-right">
                                ${_esc(c.name)}
                            </button>
                        </div>
                        ${c.contact_person ? `<p class="text-xs text-slate-400 mt-0.5 mr-3">${_esc(c.contact_person)}</p>` : ''}
                    </td>
                    <td class="py-3.5 px-4">${toggleBtn}</td>
                    <td class="py-3.5 px-4 text-slate-300 text-xs">—</td>
                    <td class="py-3.5 px-4 text-slate-600 text-sm">${_esc(c.phone || '—')}</td>
                    <td class="py-3.5 px-4 text-slate-500 text-sm">${_esc(c.city || '—')}</td>
                    <td class="py-3.5 px-4 text-left">
                        <div class="flex items-center justify-end gap-1">
                            <button onclick="window.openClientProfile('${c.id}')"
                                    class="p-2 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                                    title="ملف العميل"><i class="fa-solid fa-id-card text-sm"></i></button>
                            ${editBtn}
                        </div>
                    </td>
                </tr>`);

            // Branch rows (hidden or visible)
            if (hasBranches) {
                branches.forEach((b, idx) => {
                    const isLast = idx === branches.length - 1;
                    const branchEditBtn = canEdit
                        ? `<button onclick="window.openClientModal('${b.id}')"
                                class="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                                title="تعديل"><i class="fa-solid fa-pen-to-square text-sm"></i></button>`
                        : '';
                    const branchStatusDot = b.status === 'active'
                        ? `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block ml-1 shrink-0"></span>`
                        : `<span class="w-1.5 h-1.5 rounded-full bg-slate-300 inline-block ml-1 shrink-0"></span>`;

                    rows.push(`
                        <tr data-branch-of="${c.id}"
                            class="${isExpanded ? '' : 'hidden'} bg-purple-50/40 border-b border-purple-100/60 transition-all">
                            <td class="py-2.5 px-4">
                                <div class="flex items-center gap-2 pr-4">
                                    <span class="text-purple-300 text-sm">${isLast ? '└' : '├'}</span>
                                    ${branchStatusDot}
                                    <button onclick="window.openClientProfile('${b.id}')"
                                            class="text-sm text-slate-700 hover:text-purple-600 transition-colors font-medium text-right">
                                        ${_esc(b.name)}
                                    </button>
                                </div>
                                ${b.contact_person ? `<p class="text-xs text-slate-400 mt-0.5 pr-10">${_esc(b.contact_person)}</p>` : ''}
                            </td>
                            <td class="py-2.5 px-4">
                                <span class="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold">فرع</span>
                            </td>
                            <td class="py-2.5 px-4 text-slate-500 text-xs">${_esc(c.name)}</td>
                            <td class="py-2.5 px-4 text-slate-500 text-sm">${_esc(b.phone || '—')}</td>
                            <td class="py-2.5 px-4 text-slate-400 text-sm">${_esc(b.city || '—')}</td>
                            <td class="py-2.5 px-4 text-left">
                                <div class="flex items-center justify-end gap-1">
                                    <button onclick="window.openClientProfile('${b.id}')"
                                            class="p-2 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                                            title="ملف الفرع"><i class="fa-solid fa-id-card text-sm"></i></button>
                                    ${branchEditBtn}
                                </div>
                            </td>
                        </tr>`);
                });
            }
        });

        tbody.innerHTML = rows.join('');
    }

    // Toggle branch rows visibility
    window._toggleBranches = function(parentId) {
        if (_expandedParents.has(parentId)) {
            _expandedParents.delete(parentId);
        } else {
            _expandedParents.add(parentId);
        }
        // Re-render preserving current search
        const searchInput = document.getElementById('clients-search');
        const q = searchInput ? searchInput.value.trim().toLowerCase() : '';
        if (q) {
            const filtered = _allClients.filter(c =>
                c.name.toLowerCase().includes(q) ||
                (c.phone && c.phone.includes(q)) ||
                (c.city && c.city.toLowerCase().includes(q)) ||
                (c.parent_name && c.parent_name.toLowerCase().includes(q))
            );
            _renderTable(filtered);
        } else {
            _renderTable(_allClients);
        }
    };

    // ==========================================================================
    // Searchable Parent Dropdown (Add/Edit modal)
    // ==========================================================================
    function _populateParentDropdown() { /* no-op: data comes from _mainClients */ }

    function _renderParentDropdownItems(list, inputId, hiddenId, dropdownId) {
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown) return;

        // "رئيسي" option always first
        const items = [{ id: '', name: '— عميل مستقل (رئيسي) —', _main: true }, ...list];
        dropdown.innerHTML = items.map(c => `
            <div onclick="window._cpSelectParent('${c.id}','${_esc(c.name)}','${inputId}','${hiddenId}','${dropdownId}')"
                 class="px-4 py-2.5 text-sm cursor-pointer hover:bg-brand-50 hover:text-brand-700
                        transition-colors border-b border-slate-50 last:border-0
                        ${c._main ? 'text-slate-400 italic' : 'text-slate-800 font-medium'}">
                ${c._main ? c.name : '<i class="fa-solid fa-building text-xs text-slate-300 ml-1"></i>' + _esc(c.name)}
            </div>`).join('');
        dropdown.classList.remove('hidden');
    }

    window._cpSelectParent = function(id, name, inputId, hiddenId, dropdownId) {
        const hidden = document.getElementById(hiddenId);
        const input  = document.getElementById(inputId);
        const dropdown = document.getElementById(dropdownId);
        if (hidden) hidden.value = id;
        if (input)  input.value  = id ? name : '';
        if (input)  input.placeholder = id ? '' : '— عميل مستقل (رئيسي) —';
        if (dropdown) dropdown.classList.add('hidden');
    };

    window._cpShowParentDropdown = function() {
        _renderParentDropdownItems(_mainClients, 'parent-search-input', 'client-parent-id', 'parent-dropdown-list');
    };

    window._cpFilterParents = function(q) {
        const filtered = q.trim()
            ? _mainClients.filter(c => c.name.toLowerCase().includes(q.trim().toLowerCase()))
            : _mainClients;
        _renderParentDropdownItems(filtered, 'parent-search-input', 'client-parent-id', 'parent-dropdown-list');
    };

    // Close dropdown on outside click
    document.addEventListener('click', function(e) {
        const wrap = document.getElementById('parent-dropdown-wrap');
        if (wrap && !wrap.contains(e.target)) {
            const dd = document.getElementById('parent-dropdown-list');
            if (dd) dd.classList.add('hidden');
        }
    }, true);

    // ==========================================================================
    // openClientModal(id?)
    // Opens the modal. If id is provided, pre-fills with existing client data.
    // ==========================================================================
    window.openClientModal = function (id = null) {
        _editingId = id;

        const modal      = document.getElementById('client-modal');
        const title      = document.getElementById('modal-title');
        const submitBtn  = document.getElementById('modal-submit-btn');
        const form       = document.getElementById('client-form');

        if (!modal || !form) return;

        // #client-form is a <div>, not a <form> — reset fields manually
        ['client-name','client-contact-person','client-phone','client-email',
         'client-city','client-address','client-tax-id','client-commercial-register'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const creditEl = document.getElementById('client-credit-limit');
        if (creditEl) creditEl.value = 0;
        const statusEl = document.getElementById('client-status');
        if (statusEl) statusEl.value = 'active';
        // Reset searchable parent dropdown
        const parentHidden = document.getElementById('client-parent-id');
        if (parentHidden) parentHidden.value = '';
        const parentInput = document.getElementById('parent-search-input');
        if (parentInput) { parentInput.value = ''; parentInput.placeholder = '— عميل مستقل (رئيسي) —'; }
        const parentDd = document.getElementById('parent-dropdown-list');
        if (parentDd) parentDd.classList.add('hidden');
        _clearFormError();

        if (id) {
            const client = _allClients.find(c => c.id === id);
            if (!client) return;

            title.textContent     = 'تعديل بيانات العميل';
            submitBtn.textContent = 'حفظ التعديلات';

            document.getElementById('client-name').value                = client.name || '';
            document.getElementById('client-contact-person').value     = client.contact_person || '';
            document.getElementById('client-phone').value              = client.phone || '';
            document.getElementById('client-email').value              = client.email || '';
            document.getElementById('client-city').value               = client.city || '';
            document.getElementById('client-address').value            = client.address || '';
            document.getElementById('client-commercial-register').value = client.commercial_register || '';
            document.getElementById('client-tax-id').value             = client.tax_id || '';
            document.getElementById('client-credit-limit').value       = client.credit_limit || 0;
            document.getElementById('client-status').value             = client.status || 'active';
            // Set searchable parent dropdown
            if (parentHidden) parentHidden.value = client.parent_id || '';
            if (parentInput && client.parent_id) {
                const parentClient = _mainClients.find(mc => mc.id === client.parent_id);
                parentInput.value = parentClient ? parentClient.name : '';
            }
        } else {
            title.textContent     = 'إضافة عميل جديد';
            submitBtn.textContent = 'إضافة العميل';
        }

        // Show modal with transition
        // Use style.display directly — classList 'flex' conflicts with 'hidden' in Tailwind CDN
        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('opacity-100');
            modal.querySelector('.modal-panel').classList.add('scale-100');
        });
    };

    // ==========================================================================
    // closeClientModal()
    // Closes the modal with transition.
    // ==========================================================================
    window.closeClientModal = function () {
        const modal = document.getElementById('client-modal');
        if (!modal) return;

        modal.classList.remove('opacity-100');
        modal.querySelector('.modal-panel').classList.remove('scale-100');

        setTimeout(() => {
            modal.style.display = 'none';
            _editingId = null;
        }, 200);
    };

    // ==========================================================================
    // _handleFormSubmit(event)
    // Handles Add and Edit form submissions.
    // ==========================================================================
    async function _handleFormSubmit(event) {
        event.preventDefault();
        _clearFormError();

        const submitBtn = document.getElementById('modal-submit-btn');
        const name      = document.getElementById('client-name').value.trim();

        if (!name) {
            _showFormError('اسم العميل مطلوب.');
            return;
        }

        const payload = {
            name,
            parent_id:           document.getElementById('client-parent-id').value || null, // reads from hidden input
            contact_person:      document.getElementById('client-contact-person').value.trim() || null,
            phone:               document.getElementById('client-phone').value.trim() || null,
            email:               document.getElementById('client-email').value.trim() || null,
            city:                document.getElementById('client-city').value.trim() || null,
            address:             document.getElementById('client-address').value.trim() || null,
            commercial_register: document.getElementById('client-commercial-register').value.trim() || null,
            tax_id:              document.getElementById('client-tax-id').value.trim() || null,
            credit_limit:        parseFloat(document.getElementById('client-credit-limit').value) || 0,
            status:              document.getElementById('client-status').value || 'active',
        };

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جارٍ الحفظ...';
        }

        try {
            if (_editingId) {
                await window.apiFetch(`/api/clients/${_editingId}`, { method: 'PUT', body: payload });
                window.showToast('تم تحديث بيانات العميل بنجاح.', 'success');
            } else {
                await window.apiFetch('/api/clients', { method: 'POST', body: payload });
                window.showToast('تمت إضافة العميل بنجاح.', 'success');
            }

            window.closeClientModal();
            await loadClients();
        } catch (err) {
            _showFormError(err.message);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = _editingId ? 'حفظ التعديلات' : 'إضافة العميل';
            }
        }
    }

    // ==========================================================================
    // Search filter
    // ==========================================================================
    function _initSearch() {
        const input = document.getElementById('clients-search');
        if (!input) return;
        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            if (!q) {
                _renderTable(_allClients);
                return;
            }
            const filtered = _allClients.filter(c =>
                c.name.toLowerCase().includes(q) ||
                (c.phone && c.phone.includes(q)) ||
                (c.city && c.city.toLowerCase().includes(q)) ||
                (c.parent_name && c.parent_name.toLowerCase().includes(q))
            );
            _renderTable(filtered);
        });
    }

    // ==========================================================================
    // Permission gate for "Add Client" button
    // ==========================================================================
    function _applyPermissions() {
        const addBtn = document.getElementById('add-client-btn');
        if (!addBtn) return;

        const canCreate = window.GpackPerms && (
            window.GpackPerms.all_access ||
            (window.GpackPerms.clients && window.GpackPerms.clients.create)
        );

        if (!canCreate) {
            addBtn.classList.add('hidden');
        }
    }

    // ==========================================================================
    // Helpers
    // ==========================================================================
    function _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function _showFormError(msg) {
        const box  = document.getElementById('client-form-error');
        const span = box ? box.querySelector('span') : null;
        if (box) {
            if (span) span.textContent = msg;
            else box.textContent = msg;
            box.classList.remove('hidden');
        }
    }

    function _clearFormError() {
        const box  = document.getElementById('client-form-error');
        const span = box ? box.querySelector('span') : null;
        if (box) {
            if (span) span.textContent = '';
            box.classList.add('hidden');
        }
    }

    // ==========================================================================
    // initClientsView()
    // Wires up all DOM event listeners and fetches the client list.
    // Called automatically at the bottom of this IIFE the moment the script
    // finishes parsing — this is the fix for the async SPA router race condition.
    // ==========================================================================
    async function initClientsView() {
        var _myToken = window.getCurrentNavToken ? window.getCurrentNavToken() : 0;
        // Bind Add Client button FIRST — before any permission check hides it,
        // so the click handler is always registered on the DOM element.
        const addBtn = document.getElementById('add-client-btn');
        if (addBtn) addBtn.addEventListener('click', () => window.openClientModal());

        _applyPermissions();
        _initSearch();

        // submitClientForm is called via onclick on the button in clients.html.
        // No form submit listener needed — the modal body is a <div>, not a <form>.

        const closeBtn = document.getElementById('modal-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', window.closeClientModal);

        const cancelBtn = document.getElementById('modal-cancel-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', window.closeClientModal);

        await loadClients();
        if (window.isViewActive && !window.isViewActive(_myToken)) return;
    }

    // ==========================================================================
    // window.submitClientForm()
    // Called via onclick="window.submitClientForm()" on #modal-submit-btn.
    // Directly invokes _handleFormSubmit with a dummy event object.
    // This is the SPA-safe approach: no form submit events, no DOM position issues.
    // ==========================================================================
    window.submitClientForm = function () {
        _handleFormSubmit({ preventDefault: () => {} });
    };

    // ==========================================================================
    // Bulk Branches Modal
    // ==========================================================================
    let _bulkBranchRowCount = 0;

    window.openBulkBranchModal = function() {
        const modal = document.getElementById('bulk-branch-modal');
        if (!modal) return;
        // Reset
        const hiddenEl = document.getElementById('bulk-parent-id');
        const searchEl = document.getElementById('bulk-parent-search');
        const ddEl     = document.getElementById('bulk-parent-dropdown');
        const errEl    = document.getElementById('bulk-branch-error');
        if (hiddenEl) hiddenEl.value = '';
        if (searchEl) { searchEl.value = ''; }
        if (ddEl)     ddEl.classList.add('hidden');
        if (errEl)    errEl.classList.add('hidden');
        _bulkBranchRowCount = 0;
        const list = document.getElementById('bulk-branches-list');
        if (list) list.innerHTML = '';
        window._addBranchRow();
        window._addBranchRow();
        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('opacity-100');
            modal.querySelector('.modal-panel').classList.add('scale-100');
        });
    };

    window.closeBulkBranchModal = function() {
        const modal = document.getElementById('bulk-branch-modal');
        if (!modal) return;
        modal.classList.remove('opacity-100');
        modal.querySelector('.modal-panel').classList.remove('scale-100');
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    };

    window._bulkShowParents = function() {
        _renderParentDropdownItems(_mainClients, 'bulk-parent-search', 'bulk-parent-id', 'bulk-parent-dropdown');
    };

    window._bulkFilterParents = function(q) {
        const filtered = q.trim()
            ? _mainClients.filter(c => c.name.toLowerCase().includes(q.trim().toLowerCase()))
            : _mainClients;
        _renderParentDropdownItems(filtered, 'bulk-parent-search', 'bulk-parent-id', 'bulk-parent-dropdown');
    };

    // Close bulk dropdown on outside click
    document.addEventListener('click', function(e) {
        const wrap = document.getElementById('bulk-parent-search');
        const dd   = document.getElementById('bulk-parent-dropdown');
        if (wrap && dd && !wrap.contains(e.target) && !dd.contains(e.target)) {
            dd.classList.add('hidden');
        }
    }, true);

    window._addBranchRow = function() {
        const list = document.getElementById('bulk-branches-list');
        if (!list) return;
        const idx = ++_bulkBranchRowCount;
        const row = document.createElement('div');
        row.id = `bulk-row-${idx}`;
        row.className = 'flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2';
        row.innerHTML = `
            <span class="text-purple-400 text-sm font-bold w-5 text-center shrink-0">${idx}</span>
            <input type="text" placeholder="اسم الفرع *"
                   id="bulk-name-${idx}"
                   class="flex-1 min-w-0 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm
                          text-slate-800 placeholder-slate-400 outline-none focus:border-purple-400
                          focus:ring-2 focus:ring-purple-400/20 transition-all" />
            <input type="text" placeholder="هاتف"
                   id="bulk-phone-${idx}"
                   class="w-32 shrink-0 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm
                          text-slate-800 placeholder-slate-400 outline-none focus:border-purple-400
                          focus:ring-2 focus:ring-purple-400/20 transition-all" />
            <input type="text" placeholder="مدينة"
                   id="bulk-city-${idx}"
                   class="w-28 shrink-0 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm
                          text-slate-800 placeholder-slate-400 outline-none focus:border-purple-400
                          focus:ring-2 focus:ring-purple-400/20 transition-all" />
            <button onclick="document.getElementById('bulk-row-${idx}').remove()"
                    class="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                    title="حذف">
                <i class="fa-solid fa-xmark text-sm"></i>
            </button>`;
        list.appendChild(row);
        row.querySelector('input').focus();
    };

    window.saveBulkBranches = async function() {
        const parentId = (document.getElementById('bulk-parent-id')?.value || '').trim();
        if (!parentId) {
            const errEl = document.getElementById('bulk-branch-error');
            const span  = errEl?.querySelector('span');
            if (span) span.textContent = 'يجب اختيار العميل الرئيسي أولاً';
            if (errEl) errEl.classList.remove('hidden');
            return;
        }

        // Collect all rows
        const list  = document.getElementById('bulk-branches-list');
        const rows  = list ? list.querySelectorAll('[id^="bulk-row-"]') : [];
        const items = [];
        rows.forEach(row => {
            const idx  = row.id.replace('bulk-row-', '');
            const name = (document.getElementById(`bulk-name-${idx}`)?.value || '').trim();
            if (!name) return;
            items.push({
                name,
                parent_id: parentId,
                phone:  (document.getElementById(`bulk-phone-${idx}`)?.value || '').trim() || null,
                city:   (document.getElementById(`bulk-city-${idx}`)?.value  || '').trim() || null,
                status: 'active'
            });
        });

        if (!items.length) {
            const errEl = document.getElementById('bulk-branch-error');
            const span  = errEl?.querySelector('span');
            if (span) span.textContent = 'أدخل اسم فرع واحد على الأقل';
            if (errEl) errEl.classList.remove('hidden');
            return;
        }

        const btn = document.getElementById('bulk-branch-save-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جاري الحفظ...'; }

        let saved = 0, failed = 0;
        for (const item of items) {
            try {
                await window.apiFetch('/api/clients', { method: 'POST', body: item });
                saved++;
            } catch (e) {
                failed++;
            }
        }

        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check ml-1"></i> حفظ الكل'; }

        if (saved > 0) {
            if (window.showToast) window.showToast(`تم حفظ ${saved} فرع${failed ? ` وفشل ${failed}` : ''} بنجاح`, 'success');
            window.closeBulkBranchModal();
            await loadClients();
        } else {
            const errEl = document.getElementById('bulk-branch-error');
            const span  = errEl?.querySelector('span');
            if (span) span.textContent = 'فشل حفظ جميع الفروع — تحقق من البيانات';
            if (errEl) errEl.classList.remove('hidden');
        }
    };

    window.openClientProfile = function(clientId) {
        window._cpClientId = clientId;
        window.navigateTo('client-profile');
    };

    // Auto-execute immediately when script is fully parsed.
    initClientsView();

})();
