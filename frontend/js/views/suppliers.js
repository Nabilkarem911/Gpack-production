'use strict';

// =============================================================================
// G.PACK 2.0 - Suppliers View Controller (suppliers.js)
// Handles all logic for frontend/views/suppliers.html.
// Called by the SPA router: window.initSuppliersView()
// Depends on: api.js (apiFetch, GpackPerms, showToast)
// =============================================================================

(function () {

    // Internal state
    let _allSuppliers = [];
    let _editingId = null;

    // ==========================================================================
    // loadSuppliers()
    // Fetches suppliers from the API and renders the table.
    // ==========================================================================
    async function loadSuppliers() {
        const tbody = document.getElementById('suppliers-tbody');
        const empty = document.getElementById('suppliers-empty');
        if (!tbody) return;

        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="py-10 text-center text-slate-400">
                    <i class="fa-solid fa-circle-notch fa-spin text-2xl"></i>
                </td>
            </tr>`;

        try {
            const res = await window.apiFetch('/api/suppliers');
            _allSuppliers = res.data || [];
            _renderTable(_allSuppliers);
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
    // _renderTable(suppliers)
    // Injects supplier rows into the table body.
    // ==========================================================================
    function _renderTable(suppliers) {
        const tbody = document.getElementById('suppliers-tbody');
        const empty = document.getElementById('suppliers-empty');
        if (!tbody) return;

        if (suppliers.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        const canEdit = window.GpackPerms && (
            window.GpackPerms.all_access ||
            (window.GpackPerms.suppliers && window.GpackPerms.suppliers.update)
        );

        const canDelete = window.GpackPerms && (
            window.GpackPerms.all_access ||
            (window.GpackPerms.suppliers && window.GpackPerms.suppliers.delete)
        );

        tbody.innerHTML = suppliers.map(s => {
            const statusBadge = s.status === 'active'
                ? `<span class="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">نشط</span>`
                : `<span class="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-semibold">غير نشط</span>`;

            const editBtn = canEdit
                ? `<button onclick="window.openSupplierModal('${s.id}')"
                        class="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                        title="تعديل">
                        <i class="fa-solid fa-pen-to-square text-sm"></i>
                   </button>`
                : '';

            const deleteBtn = canDelete
                ? `<button onclick="window.deleteSupplier('${s.id}')"
                        class="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="حذف">
                        <i class="fa-solid fa-trash text-sm"></i>
                   </button>`
                : '';

            return `
                <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
                    <td class="py-3.5 px-4">
                        <div class="flex items-center gap-2">
                            <button onclick="window.openSupplierProfile('${s.id}')"
                                    class="font-semibold text-slate-800 text-sm hover:text-brand-600 transition-colors text-right">
                                ${_esc(s.name)}
                            </button>
                        </div>
                    </td>
                    <td class="py-3.5 px-4 text-sm text-slate-600">${_esc(s.contact_person || '—')}</td>
                    <td class="py-3.5 px-4 text-sm text-slate-600 font-mono dir-ltr">${_esc(s.phone || '—')}</td>
                    <td class="py-3.5 px-4 text-sm text-slate-600">${_esc(s.email || '—')}</td>
                    <td class="py-3.5 px-4">${statusBadge}</td>
                    <td class="py-3.5 px-4">
                        <div class="flex items-center gap-1">
                            <button onclick="window.openSupplierProfile('${s.id}')"
                                    class="p-2 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                                    title="ملف المورد">
                                <i class="fa-solid fa-id-card text-sm"></i>
                            </button>
                            ${editBtn}
                            ${deleteBtn}
                        </div>
                    </td>
                </tr>`;
        }).join('');
    }

    // ==========================================================================
    // _filterSuppliers()
    // Filters suppliers based on search and status.
    // ==========================================================================
    function _filterSuppliers() {
        const search = document.getElementById('suppliers-search')?.value.trim().toLowerCase() || '';
        const status = document.getElementById('suppliers-status-filter')?.value || '';

        let filtered = _allSuppliers;

        if (search) {
            filtered = filtered.filter(s =>
                (s.name && s.name.toLowerCase().includes(search)) ||
                (s.contact_person && s.contact_person.toLowerCase().includes(search)) ||
                (s.phone && s.phone.includes(search))
            );
        }

        if (status) {
            filtered = filtered.filter(s => s.status === status);
        }

        _renderTable(filtered);
    }

    // ==========================================================================
    // Modal Functions
    // ==========================================================================

    function _openModal(id = null) {
        const modal = document.getElementById('supplier-modal');
        const title = document.getElementById('modal-title');
        const errorDiv = document.getElementById('supplier-form-error');

        if (!modal) return;

        _editingId = id;
        errorDiv?.classList.add('hidden');

        // Clear form
        document.getElementById('supplier-company-name').value = '';
        document.getElementById('supplier-contact-person').value = '';
        document.getElementById('supplier-phone').value = '';
        document.getElementById('supplier-email').value = '';
        document.getElementById('supplier-address').value = '';
        document.getElementById('supplier-status').value = 'active';

        if (id) {
            // Edit mode - populate form
            const supplier = _allSuppliers.find(s => s.id === id);
            if (supplier) {
                title.textContent = 'تعديل مورد';
                document.getElementById('supplier-company-name').value = supplier.name || '';
                document.getElementById('supplier-contact-person').value = supplier.contact_person || '';
                document.getElementById('supplier-phone').value = supplier.phone || '';
                document.getElementById('supplier-email').value = supplier.email || '';
                document.getElementById('supplier-address').value = supplier.address || '';
                document.getElementById('supplier-status').value = supplier.status || 'active';
            }
        } else {
            title.textContent = 'إضافة مورد جديد';
        }

        // Show modal with animation
        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.remove('opacity-0');
            modal.querySelector('.modal-panel').classList.remove('scale-95');
            modal.querySelector('.modal-panel').classList.add('scale-100');
        });

        // Focus first input
        document.getElementById('supplier-company-name').focus();
    }

    function _closeModal() {
        const modal = document.getElementById('supplier-modal');
        if (!modal) return;

        modal.classList.add('opacity-0');
        modal.querySelector('.modal-panel').classList.remove('scale-100');
        modal.querySelector('.modal-panel').classList.add('scale-95');

        setTimeout(() => {
            modal.style.display = 'none';
            _editingId = null;
        }, 200);
    }

    // ==========================================================================
    // _saveSupplier()
    // Saves supplier data (create or update).
    // ==========================================================================
    async function _saveSupplier() {
        const errorDiv = document.getElementById('supplier-form-error');
        const errorSpan = errorDiv?.querySelector('span');

        const data = {
            company_name: document.getElementById('supplier-company-name').value.trim(),
            contact_person: document.getElementById('supplier-contact-person').value.trim() || null,
            phone: document.getElementById('supplier-phone').value.trim() || null,
            email: document.getElementById('supplier-email').value.trim() || null,
            address: document.getElementById('supplier-address').value.trim() || null,
            status: document.getElementById('supplier-status').value
        };

        // Validation
        if (!data.company_name) {
            if (errorDiv && errorSpan) {
                errorSpan.textContent = 'اسم الشركة مطلوب.';
                errorDiv.classList.remove('hidden');
            }
            return;
        }

        try {
            if (_editingId) {
                // Update existing
                await window.apiFetch(`/api/suppliers/${_editingId}`, {
                    method: 'PATCH',
                    body: data
                });
                window.showToast('تم تحديث المورد بنجاح.', 'success');
            } else {
                // Create new
                await window.apiFetch('/api/suppliers', {
                    method: 'POST',
                    body: data
                });
                window.showToast('تم إضافة المورد بنجاح.', 'success');
            }

            _closeModal();
            await loadSuppliers();
        } catch (err) {
            if (errorDiv && errorSpan) {
                errorSpan.textContent = err.message || 'حدث خطأ أثناء الحفظ.';
                errorDiv.classList.remove('hidden');
            }
        }
    }

    // ==========================================================================
    // deleteSupplier(id)
    // Deletes a supplier with confirmation.
    // ==========================================================================
    async function _deleteSupplier(id) {
        const supplier = _allSuppliers.find(s => s.id === id);
        const name = supplier ? supplier.name : 'هذا المورد';

        if (!confirm(`هل أنت متأكد من حذف "${name}"؟\n\nلا يمكن حذف المورد إذا كان مرتبط بطلبات تشغيل.`)) {
            return;
        }

        try {
            await window.apiFetch(`/api/suppliers/${id}`, {
                method: 'DELETE'
            });
            window.showToast('تم حذف المورد بنجاح.', 'success');
            await loadSuppliers();
        } catch (err) {
            // Check for foreign key constraint error
            if (err.message && err.message.includes('foreign key') || err.message.includes('مرتبط')) {
                window.showToast('لا يمكن حذف هذا المورد لأنه مرتبط بطلبات تشغيل.', 'error');
            } else {
                window.showToast(err.message || 'حدث خطأ أثناء الحذف.', 'error');
            }
        }
    }

    // ==========================================================================
    // _esc(str)
    // Escape HTML to prevent XSS.
    // ==========================================================================
    function _esc(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ==========================================================================
    // Event Listeners
    // ==========================================================================

    function _attachListeners() {
        // Add supplier button
        const addBtn = document.getElementById('add-supplier-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => _openModal());
        }

        // Modal close buttons
        const closeBtn = document.getElementById('modal-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', _closeModal);
        }

        const cancelBtn = document.getElementById('modal-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', _closeModal);
        }

        // Modal save button
        const saveBtn = document.getElementById('modal-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', _saveSupplier);
        }

        // Enter key in form inputs
        const formInputs = document.querySelectorAll('#supplier-form input, #supplier-form select, #supplier-form textarea');
        formInputs.forEach(input => {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    _saveSupplier();
                }
            });
        });

        // Search and filter
        const searchInput = document.getElementById('suppliers-search');
        if (searchInput) {
            searchInput.addEventListener('input', _filterSuppliers);
        }

        const statusFilter = document.getElementById('suppliers-status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', _filterSuppliers);
        }
    }

    // ==========================================================================
    // initSuppliersView()
    // Entry point called by the SPA router when the view is loaded.
    // ==========================================================================
    window.initSuppliersView = function () {
        loadSuppliers();
        _attachListeners();
    };

    // Expose functions for inline onclick handlers
    window.openSupplierModal = _openModal;
    window.deleteSupplier = _deleteSupplier;
    window.openSupplierProfile = function(supplierId) {
        window._spSupplierId = supplierId;
        window.navigateTo('supplier-profile');
    };

    // Auto-execute immediately when script is fully parsed.
    // This ensures the view initializes correctly when loaded by the SPA router.
    // Use requestAnimationFrame to ensure the HTML fragment is injected into DOM first.
    requestAnimationFrame(() => {
        initSuppliersView();
    });

})();
