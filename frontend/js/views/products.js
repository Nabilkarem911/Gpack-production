'use strict';

// =============================================================================
// G.PACK 2.0 - Products View Controller (products.js)
// Handles: list, add, edit (base product only), permission gating.
// SCHEMA RULE: Products & Variants are GENERAL — no client_id anywhere.
// =============================================================================

(function () {

    // ── Private State ─────────────────────────────────────────────────────────
    let _allProducts      = [];   // master list for client-side filtering
    let _editingId        = null; // null = add mode, UUID = edit mode
    let _categories       = [];   // loaded once from /api/categories
    let _units            = [];   // loaded once from /api/units

    // Variants modal state
    let _variantsProductId   = null;  // product UUID currently open in variants modal
    let _variantsProductName = '';    // product name for modal header
    let _currentVariants     = [];    // live list of variants for the open product
    let _editingVariantId    = null;  // null = add mode, UUID = edit variant mode

    // ==========================================================================
    // _applyPermissions()
    // Gates the "Add Product" button based on window.GpackPerms.
    // ==========================================================================
    function _applyPermissions() {
        const perms  = window.GpackPerms || {};
        const canAdd = perms.all_access || perms.products?.create;
        const addBtn = document.getElementById('add-product-btn');
        if (addBtn && !canAdd) addBtn.classList.add('hidden');
    }

    // ==========================================================================
    // _showFormError(msg) / _clearFormError()
    // ==========================================================================
    function _showFormError(msg) {
        const box  = document.getElementById('product-form-error');
        const span = box ? box.querySelector('span') : null;
        if (box) {
            if (span) span.textContent = msg;
            else       box.textContent  = msg;
            box.classList.remove('hidden');
        }
    }

    function _clearFormError() {
        const box  = document.getElementById('product-form-error');
        const span = box ? box.querySelector('span') : null;
        if (box) {
            if (span) span.textContent = '';
            box.classList.add('hidden');
        }
    }

    // ==========================================================================
    // _resetForm()
    // Manually clears all form fields (body is a <div>, not a <form>).
    // ==========================================================================
    function _resetForm() {
        const textFields = [
            'product-name', 'product-sku', 'product-description',
            'variant-size-name', 'variant-sku',
        ];
        textFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        const numFields = ['variant-cost-price', 'variant-selling-price', 'variant-min-stock'];
        numFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        const selFields = ['product-category', 'product-status', 'variant-unit'];
        selFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (id === 'product-status') el.value = 'active';
                else el.value = '';
            }
        });

        _clearFormError();
    }

    // ==========================================================================
    // _statusBadge(status)
    // Returns an HTML string for a colour-coded status badge.
    // ==========================================================================
    function _statusBadge(status) {
        const map = {
            active:   { label: 'نشط',      cls: 'bg-emerald-100 text-emerald-700' },
            inactive: { label: 'غير نشط',  cls: 'bg-slate-100   text-slate-500'   },
        };
        const s = map[status] || { label: status, cls: 'bg-slate-100 text-slate-500' };
        return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${s.cls}">${s.label}</span>`;
    }

    // ==========================================================================
    // _renderTable(products)
    // Renders the products list into #products-tbody.
    // ==========================================================================
    function _renderTable(products) {
        const tbody = document.getElementById('products-tbody');
        const empty = document.getElementById('products-empty');
        if (!tbody) return;

        if (!products || products.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }

        if (empty) empty.classList.add('hidden');

        tbody.innerHTML = products.map(p => {
            const variantCount = Array.isArray(p.variants) ? p.variants.length : 0;
            const skuText      = p.sku ? `<span class="text-xs text-slate-400 font-mono">${p.sku}</span>` : '—';
            const catText      = p.category_name || '<span class="text-slate-300">—</span>';
            const perms        = window.GpackPerms || {};
            const canEdit      = perms.all_access || perms.products?.edit;

            return `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3.5 px-4">
                    <div class="font-semibold text-slate-800 text-sm">${p.name}</div>
                </td>
                <td class="py-3.5 px-4 hidden sm:table-cell text-sm text-slate-600">${catText}</td>
                <td class="py-3.5 px-4 hidden md:table-cell">${skuText}</td>
                <td class="py-3.5 px-4 hidden md:table-cell">
                    <span class="inline-flex items-center gap-1 text-xs font-semibold text-slate-600
                                 bg-slate-100 px-2.5 py-1 rounded-full">
                        <i class="fa-solid fa-cubes text-slate-400"></i>
                        ${variantCount} مقاس
                    </span>
                </td>
                <td class="py-3.5 px-4">${_statusBadge(p.status)}</td>
                <td class="py-3.5 px-4">
                    <div class="flex items-center justify-end gap-2">
                        ${canEdit ? `
                        <button onclick="window.openProductModal('${p.id}')"
                                title="تعديل"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-brand-600 hover:bg-brand-50 transition-colors">
                            <i class="fa-solid fa-pen-to-square text-sm"></i>
                        </button>` : ''}
                        <button onclick="window.viewProductVariants('${p.id}')"
                                title="عرض المقاسات"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                            <i class="fa-solid fa-list-ul text-sm"></i>
                        </button>
                        <button onclick="window.openProductMovements('${p.id}', '${p.name}')"
                                title="حركات الصنف"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-purple-600 hover:bg-purple-50 transition-colors">
                            <i class="fa-solid fa-arrow-right-arrow-left text-sm"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    // ==========================================================================
    // _initSearch()
    // Client-side filtering on #products-search and #products-status-filter.
    // ==========================================================================
    function _initSearch() {
        const searchInput  = document.getElementById('products-search');
        const statusFilter = document.getElementById('products-status-filter');

        function _filter() {
            const q      = (searchInput  ? searchInput.value.toLowerCase()  : '');
            const status = (statusFilter ? statusFilter.value                : '');

            const filtered = _allProducts.filter(p => {
                const matchQ = !q ||
                    p.name.toLowerCase().includes(q) ||
                    (p.sku && p.sku.toLowerCase().includes(q));
                const matchS = !status || p.status === status;
                return matchQ && matchS;
            });

            _renderTable(filtered);
        }

        if (searchInput)  searchInput.addEventListener('input', _filter);
        if (statusFilter) statusFilter.addEventListener('change', _filter);
    }

    // ==========================================================================
    // _loadCategories() / _loadUnits()
    // Populates the category and unit <select> dropdowns in the modal.
    // ==========================================================================
    // selectId: optional UUID to auto-select after refresh (used by Quick Add)
    async function _loadCategories(selectId = null) {
        try {
            const res = await window.apiFetch('/api/categories');
            _categories = (res && res.data) ? res.data : [];
        } catch (_) {
            _categories = [];
        }

        const sel = document.getElementById('product-category');
        if (!sel) return;
        sel.innerHTML = '<option value="">— بدون فئة —</option>';
        _categories.forEach(c => {
            const opt       = document.createElement('option');
            opt.value       = c.id;
            opt.textContent = c.name;
            sel.appendChild(opt);
        });
        if (selectId) sel.value = selectId;
    }

    // selectId: optional UUID to auto-select after refresh (used by Quick Add)
    async function _loadUnits(selectId = null) {
        try {
            const res = await window.apiFetch('/api/units');
            _units = (res && res.data) ? res.data : [];
        } catch (_) {
            _units = [];
        }

        const sel = document.getElementById('variant-unit');
        if (!sel) return;
        sel.innerHTML = '<option value="">— بدون وحدة —</option>';
        _units.forEach(u => {
            const opt       = document.createElement('option');
            opt.value       = u.id;
            opt.textContent = u.abbreviation ? `${u.name} (${u.abbreviation})` : u.name;
            sel.appendChild(opt);
        });
        if (selectId) sel.value = selectId;
    }

    // ==========================================================================
    // loadProducts()
    // Fetches all products with variants and renders the table.
    // ==========================================================================
    async function loadProducts() {
        const tbody = document.getElementById('products-tbody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="py-10 text-center text-slate-400">
                        <i class="fa-solid fa-circle-notch fa-spin text-2xl"></i>
                    </td>
                </tr>`;
        }

        try {
            const res = await window.apiFetch('/api/products?include_variants=true');
            _allProducts = (res && res.data) ? res.data : [];
            _renderTable(_allProducts);
        } catch (err) {
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="py-10 text-center text-red-400 text-sm">
                            <i class="fa-solid fa-circle-exclamation ml-1"></i>
                            فشل تحميل المنتجات: ${err.message}
                        </td>
                    </tr>`;
            }
        }
    }

    // ==========================================================================
    // window.openProductModal(id?)
    // Opens the modal. id = null → Add mode, id = UUID → Edit mode.
    // ==========================================================================
    window.openProductModal = function (id = null) {
        _editingId = id;
        _resetForm();

        const modal     = document.getElementById('product-modal');
        const title     = document.getElementById('product-modal-title');
        const submitBtn = document.getElementById('product-modal-submit-btn');
        const varSec    = document.getElementById('variant-section');

        if (!modal) return;

        if (id) {
            const product = _allProducts.find(p => p.id === id);
            if (!product) return;

            if (title)     title.textContent     = 'تعديل بيانات المنتج';
            if (submitBtn) submitBtn.textContent  = 'حفظ التعديلات';
            if (varSec)    varSec.classList.add('hidden'); // variants managed separately in edit mode

            document.getElementById('product-name').value        = product.name        || '';
            document.getElementById('product-sku').value         = product.sku         || '';
            document.getElementById('product-description').value = product.description || '';
            document.getElementById('product-status').value      = product.status      || 'active';
            document.getElementById('product-category').value    = product.category_id || '';
        } else {
            if (title)     title.textContent     = 'إضافة منتج جديد';
            if (submitBtn) submitBtn.textContent  = 'إضافة المنتج';
            if (varSec)    varSec.classList.remove('hidden');
        }

        // Show modal — use style.display to avoid Tailwind flex/hidden class conflict
        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('opacity-100');
            modal.querySelector('.modal-panel').classList.add('scale-100');
        });
    };

    // ==========================================================================
    // window.closeProductModal()
    // Closes the modal with CSS transition.
    // ==========================================================================
    window.closeProductModal = function () {
        const modal = document.getElementById('product-modal');
        if (!modal) return;

        modal.classList.remove('opacity-100');
        modal.querySelector('.modal-panel').classList.remove('scale-100');

        setTimeout(() => {
            modal.style.display = 'none';
            _editingId = null;
        }, 200);
    };

    // ==========================================================================
    // _populateVfUnit(selectId)
    // Fills the #vf-unit <select> from the already-loaded _units array.
    // ==========================================================================
    function _populateVfUnit(selectedId = null) {
        const sel = document.getElementById('vf-unit');
        if (!sel) return;
        sel.innerHTML = '<option value="">— بدون وحدة —</option>';
        _units.forEach(u => {
            const opt       = document.createElement('option');
            opt.value       = u.id;
            opt.textContent = u.abbreviation ? `${u.name} (${u.abbreviation})` : u.name;
            sel.appendChild(opt);
        });
        if (selectedId) sel.value = selectedId;
    }

    // ==========================================================================
    // _resetVariantForm()
    // Clears all vf-* inputs and resets the form to "Add" mode UI.
    // ==========================================================================
    function _resetVariantForm() {
        ['vf-size-name', 'vf-sku', 'vf-barcode'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        ['vf-cost-price', 'vf-selling-price', 'vf-min-stock'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const statusEl = document.getElementById('vf-status');
        if (statusEl) statusEl.value = 'active';
        const unitEl = document.getElementById('vf-unit');
        if (unitEl) unitEl.value = '';

        _editingVariantId = null;

        const title     = document.getElementById('variant-form-title');
        const cancelBtn = document.getElementById('variant-form-cancel-edit-btn');
        const submitBtn = document.getElementById('variant-form-submit-btn');
        const errorDiv  = document.getElementById('variant-form-error');
        if (title)     title.textContent = 'إضافة مقاس جديد';
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (submitBtn) {
            submitBtn.disabled    = false;
            submitBtn.innerHTML   = '<i class="fa-solid fa-floppy-disk"></i><span class="mr-1">إضافة المقاس</span>';
        }
        if (errorDiv) {
            errorDiv.classList.add('hidden');
            const span = errorDiv.querySelector('span');
            if (span) span.textContent = '';
        }
    }

    // ==========================================================================
    // _renderVariantsTable(variants)
    // Renders variants into #variants-tbody inside the variants modal.
    // ==========================================================================
    function _renderVariantsTable(variants) {
        const tbody    = document.getElementById('variants-tbody');
        const empty    = document.getElementById('variants-empty');
        const badge    = document.getElementById('variants-count-badge');
        if (!tbody) return;

        if (badge) badge.textContent = `${variants.length} مقاس`;

        if (!variants || variants.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        const statusMap = {
            active:   '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">نشط</span>',
            inactive: '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">غير نشط</span>',
        };

        tbody.innerHTML = variants.map(v => {
            const unitLabel = v.unit_abbreviation
                ? `${v.unit_name} (${v.unit_abbreviation})`
                : (v.unit_name || '<span class="text-slate-300">—</span>');
            const costText  = v.cost_price    ? Number(v.cost_price).toFixed(2)    : '—';
            const priceText = v.selling_price ? Number(v.selling_price).toFixed(2) : '—';
            const minStock  = v.min_stock_level !== null ? v.min_stock_level : '—';
            const badge     = statusMap[v.status] || statusMap.inactive;

            return `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3 px-3">
                    <span class="font-semibold text-slate-800 text-sm">${v.size_name}</span>
                    ${v.sku ? `<div class="text-xs text-slate-400 font-mono mt-0.5">${v.sku}</div>` : ''}
                </td>
                <td class="py-3 px-3 hidden sm:table-cell text-sm text-slate-600">${unitLabel}</td>
                <td class="py-3 px-3 hidden md:table-cell text-sm text-slate-600">${costText}</td>
                <td class="py-3 px-3 hidden md:table-cell text-sm text-slate-600">${priceText}</td>
                <td class="py-3 px-3 hidden lg:table-cell text-sm text-slate-600">${minStock}</td>
                <td class="py-3 px-3">${badge}</td>
                <td class="py-3 px-3">
                    <div class="flex items-center justify-end gap-1">
                        <button onclick="window.editVariant('${v.id}')"
                                title="تعديل"
                                class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-brand-600 hover:bg-brand-50 transition-colors">
                            <i class="fa-solid fa-pen-to-square text-xs"></i>
                        </button>
                        <button onclick="window.deleteVariant('${_variantsProductId}', '${v.id}', '${v.size_name.replace(/'/g, "\\'")}')"
                                title="حذف"
                                class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-red-600 hover:bg-red-50 transition-colors">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    // ==========================================================================
    // window.viewProductVariants(productId)
    // Opens the variants management modal for a given product.
    // ==========================================================================
    window.viewProductVariants = async function (productId) {
        const product = _allProducts.find(p => p.id === productId);
        _variantsProductId   = productId;
        _variantsProductName = product ? product.name : '';

        const nameEl = document.getElementById('variants-modal-product-name');
        if (nameEl) nameEl.textContent = _variantsProductName;

        _resetVariantForm();
        _populateVfUnit();

        // Show modal immediately with spinner
        const modal = document.getElementById('variants-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('opacity-100');
            modal.querySelector('.modal-panel').classList.add('scale-100');
        });

        // Fetch fresh product with variants
        const tbody = document.getElementById('variants-tbody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin"></i></td></tr>';
        }

        try {
            const res = await window.apiFetch(`/api/products/${productId}`);
            _currentVariants = (res && res.data && res.data.variants) ? res.data.variants : [];
            _renderVariantsTable(_currentVariants);
        } catch (err) {
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-red-400 text-sm">
                    <i class="fa-solid fa-circle-exclamation ml-1"></i>
                    فشل تحميل المقاسات: ${err.message}</td></tr>`;
            }
        }
    };

    // ==========================================================================
    // window.closeVariantsModal()
    // ==========================================================================
    window.closeVariantsModal = function () {
        const modal = document.getElementById('variants-modal');
        if (!modal) return;
        modal.classList.remove('opacity-100');
        modal.querySelector('.modal-panel').classList.remove('scale-100');
        setTimeout(() => {
            modal.style.display    = 'none';
            _variantsProductId     = null;
            _variantsProductName   = '';
            _currentVariants       = [];
            _editingVariantId      = null;
        }, 200);
        // Refresh the main products table to reflect variant count changes
        loadProducts();
    };

    // ==========================================================================
    // window.editVariant(variantId)
    // Populates the variant form for editing.
    // ==========================================================================
    window.editVariant = function (variantId) {
        const v = _currentVariants.find(x => x.id === variantId);
        if (!v) return;

        _editingVariantId = variantId;

        const title     = document.getElementById('variant-form-title');
        const cancelBtn = document.getElementById('variant-form-cancel-edit-btn');
        const submitBtn = document.getElementById('variant-form-submit-btn');
        if (title)     title.textContent = 'تعديل المقاس';
        if (cancelBtn) cancelBtn.style.display = 'flex';
        if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i><span class="mr-1">حفظ التعديلات</span>';

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        set('vf-size-name',    v.size_name);
        set('vf-sku',          v.sku);
        set('vf-barcode',      v.barcode);
        set('vf-cost-price',   v.cost_price);
        set('vf-selling-price',v.selling_price);
        set('vf-min-stock',    v.min_stock_level);
        set('vf-status',       v.status || 'active');
        _populateVfUnit(v.unit_id);

        // Scroll form into view
        document.getElementById('vf-size-name')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('vf-size-name')?.focus();
    };

    // ==========================================================================
    // window.cancelVariantEdit()
    // Resets the variant form back to Add mode.
    // ==========================================================================
    window.cancelVariantEdit = function () {
        _resetVariantForm();
        _populateVfUnit();
    };

    // ==========================================================================
    // window.submitVariantForm()
    // POST (add) or PUT (edit) a variant.
    // ==========================================================================
    window.submitVariantForm = async function () {
        const errorDiv  = document.getElementById('variant-form-error');
        const submitBtn = document.getElementById('variant-form-submit-btn');

        // Clear error
        if (errorDiv) {
            errorDiv.classList.add('hidden');
            const span = errorDiv.querySelector('span');
            if (span) span.textContent = '';
        }

        const sizeName = (document.getElementById('vf-size-name')?.value || '').trim();
        if (!sizeName) {
            if (errorDiv) {
                const span = errorDiv.querySelector('span');
                if (span) span.textContent = 'الاسم / المقاس مطلوب.';
                errorDiv.classList.remove('hidden');
            }
            return;
        }

        if (submitBtn) {
            submitBtn.disabled  = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جارٍ الحفظ...';
        }

        const payload = {
            size_name:       sizeName,
            sku:             (document.getElementById('vf-sku')?.value          || '').trim() || null,
            barcode:         (document.getElementById('vf-barcode')?.value      || '').trim() || null,
            unit_id:          document.getElementById('vf-unit')?.value                       || null,
            cost_price:      parseFloat(document.getElementById('vf-cost-price')?.value)     || 0,
            selling_price:   parseFloat(document.getElementById('vf-selling-price')?.value)  || 0,
            min_stock_level: parseInt(document.getElementById('vf-min-stock')?.value, 10)    || 0,
            status:           document.getElementById('vf-status')?.value                    || 'active',
        };

        try {
            let res;
            if (_editingVariantId) {
                res = await window.apiFetch(
                    `/api/products/${_variantsProductId}/variants/${_editingVariantId}`,
                    { method: 'PUT', body: payload }
                );
            } else {
                res = await window.apiFetch(
                    `/api/products/${_variantsProductId}/variants`,
                    { method: 'POST', body: payload }
                );
            }

            if (res && res.data) {
                window.showToast(
                    _editingVariantId ? 'تم تحديث المقاس بنجاح.' : 'تمت إضافة المقاس بنجاح.',
                    'success'
                );
                _resetVariantForm();
                _populateVfUnit();

                // Refresh variants list
                const fresh = await window.apiFetch(`/api/products/${_variantsProductId}`);
                _currentVariants = (fresh && fresh.data && fresh.data.variants) ? fresh.data.variants : [];
                _renderVariantsTable(_currentVariants);
            }
        } catch (err) {
            if (errorDiv) {
                const span = errorDiv.querySelector('span');
                if (span) span.textContent = err.message || 'حدث خطأ غير متوقع.';
                errorDiv.classList.remove('hidden');
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled  = false;
                submitBtn.innerHTML = _editingVariantId
                    ? '<i class="fa-solid fa-floppy-disk"></i><span class="mr-1">حفظ التعديلات</span>'
                    : '<i class="fa-solid fa-floppy-disk"></i><span class="mr-1">إضافة المقاس</span>';
            }
        }
    };

    // ==========================================================================
    // window.deleteVariant(productId, variantId, sizeName)
    // Soft-deletes a variant after confirmation.
    // ==========================================================================
    window.deleteVariant = async function (productId, variantId, sizeName) {
        if (!confirm(`هل أنت متأكد من حذف المقاس "${sizeName}"؟\nسيتم تعطيله ولن يظهر في العمليات الجديدة.`)) return;

        try {
            await window.apiFetch(
                `/api/products/${productId}/variants/${variantId}`,
                { method: 'DELETE' }
            );
            window.showToast(`تم تعطيل المقاس "${sizeName}" بنجاح.`, 'success');

            // Refresh variants list
            const fresh = await window.apiFetch(`/api/products/${productId}`);
            _currentVariants = (fresh && fresh.data && fresh.data.variants) ? fresh.data.variants : [];
            _renderVariantsTable(_currentVariants);

            // If we were editing this variant, reset the form
            if (_editingVariantId === variantId) {
                _resetVariantForm();
                _populateVfUnit();
            }
        } catch (err) {
            window.showToast(err.message || 'فشل حذف المقاس.', 'error');
        }
    };

    // ==========================================================================
    // _openQuickModal(modalId) / _closeQuickModal(modalId)
    // Generic open/close for the quick-add overlay modals (z-60).
    // ==========================================================================
    function _openQuickModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('opacity-100');
            modal.querySelector('.modal-panel').classList.add('scale-100');
        });
    }

    function _closeQuickModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.classList.remove('opacity-100');
        modal.querySelector('.modal-panel').classList.remove('scale-100');
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    }

    function _setQuickError(errorDivId, msg) {
        const box  = document.getElementById(errorDivId);
        const span = box ? box.querySelector('span') : null;
        if (!box) return;
        if (span) span.textContent = msg;
        else      box.textContent  = msg;
        box.classList.remove('hidden');
    }

    function _clearQuickError(errorDivId) {
        const box  = document.getElementById(errorDivId);
        const span = box ? box.querySelector('span') : null;
        if (!box) return;
        if (span) span.textContent = '';
        box.classList.add('hidden');
    }

    // ==========================================================================
    // CATEGORY QUICK-ADD
    // ==========================================================================
    window.openCategoryModal = function () {
        _clearQuickError('category-form-error');
        const nameEl = document.getElementById('category-name');
        const descEl = document.getElementById('category-description');
        if (nameEl) nameEl.value = '';
        if (descEl) descEl.value = '';
        _openQuickModal('category-modal');
        setTimeout(() => { if (nameEl) nameEl.focus(); }, 250);
    };

    window.closeCategoryModal = function () {
        _closeQuickModal('category-modal');
    };

    window.submitCategoryForm = async function () {
        _clearQuickError('category-form-error');
        const submitBtn = document.getElementById('category-modal-submit-btn');
        const name = (document.getElementById('category-name')?.value || '').trim();

        if (!name) {
            _setQuickError('category-form-error', 'اسم الفئة مطلوب.');
            return;
        }

        if (submitBtn) {
            submitBtn.disabled  = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جارٍ الحفظ...';
        }

        try {
            const res = await window.apiFetch('/api/categories', {
                method: 'POST',
                body: {
                    name,
                    description: (document.getElementById('category-description')?.value || '').trim() || null,
                },
            });

            if (res && res.data) {
                window.showToast(`تمت إضافة الفئة “${res.data.name}” بنجاح.`, 'success');
                window.closeCategoryModal();
                // Refresh category dropdown and auto-select the new entry
                await _loadCategories(res.data.id);
            }
        } catch (err) {
            _setQuickError('category-form-error', err.message || 'حدث خطأ غير متوقع.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled    = false;
                submitBtn.textContent = 'إضافة الفئة';
            }
        }
    };

    // ==========================================================================
    // UNIT QUICK-ADD
    // ==========================================================================
    window.openUnitModal = function () {
        _clearQuickError('unit-form-error');
        const nameEl = document.getElementById('unit-name');
        const abbrEl = document.getElementById('unit-abbreviation');
        if (nameEl) nameEl.value = '';
        if (abbrEl) abbrEl.value = '';
        _openQuickModal('unit-modal');
        setTimeout(() => { if (nameEl) nameEl.focus(); }, 250);
    };

    window.closeUnitModal = function () {
        _closeQuickModal('unit-modal');
    };

    window.submitUnitForm = async function () {
        _clearQuickError('unit-form-error');
        const submitBtn = document.getElementById('unit-modal-submit-btn');
        const name = (document.getElementById('unit-name')?.value || '').trim();

        if (!name) {
            _setQuickError('unit-form-error', 'اسم الوحدة مطلوب.');
            return;
        }

        if (submitBtn) {
            submitBtn.disabled  = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جارٍ الحفظ...';
        }

        try {
            const res = await window.apiFetch('/api/units', {
                method: 'POST',
                body: {
                    name,
                    abbreviation: (document.getElementById('unit-abbreviation')?.value || '').trim() || null,
                },
            });

            if (res && res.data) {
                window.showToast(`تمت إضافة الوحدة “${res.data.name}” بنجاح.`, 'success');
                window.closeUnitModal();
                // Refresh unit dropdown and auto-select the new entry
                await _loadUnits(res.data.id);
            }
        } catch (err) {
            _setQuickError('unit-form-error', err.message || 'حدث خطأ غير متوقع.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled    = false;
                submitBtn.textContent = 'إضافة الوحدة';
            }
        }
    };

    // ==========================================================================
    // window.submitProductForm()
    // Called via onclick on #product-modal-submit-btn.
    // Builds payload and calls POST or PUT /api/products.
    // ==========================================================================
    window.submitProductForm = async function () {
        _clearFormError();

        const submitBtn = document.getElementById('product-modal-submit-btn');
        const name      = (document.getElementById('product-name')?.value || '').trim();

        if (!name) {
            _showFormError('اسم المنتج مطلوب.');
            return;
        }

        // ── Build payload ──────────────────────────────────────────────────────
        const payload = {
            name,
            description: (document.getElementById('product-description')?.value || '').trim() || null,
            category_id: document.getElementById('product-category')?.value  || null,
            sku:         (document.getElementById('product-sku')?.value || '').trim() || null,
            status:      document.getElementById('product-status')?.value  || 'active',
        };

        // In Add mode, always include the first variant
        if (!_editingId) {
            const sizeName = (document.getElementById('variant-size-name')?.value || '').trim();
            if (!sizeName) {
                _showFormError('اسم المقاس / الحجم للمقاس الأول مطلوب.');
                return;
            }

            payload.variants = [
                {
                    size_name:       sizeName,
                    sku:             (document.getElementById('variant-sku')?.value || '').trim() || null,
                    unit_id:         document.getElementById('variant-unit')?.value          || null,
                    cost_price:      parseFloat(document.getElementById('variant-cost-price')?.value)    || 0,
                    selling_price:   parseFloat(document.getElementById('variant-selling-price')?.value) || 0,
                    min_stock_level: parseInt(document.getElementById('variant-min-stock')?.value, 10)   || 0,
                    status:          'active',
                },
            ];
        }

        // ── Disable button during request ──────────────────────────────────────
        if (submitBtn) {
            submitBtn.disabled     = true;
            submitBtn.innerHTML    = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جارٍ الحفظ...';
        }

        try {
            let res;
            if (_editingId) {
                res = await window.apiFetch(`/api/products/${_editingId}`, {
                    method: 'PUT',
                    body:   payload,
                });
            } else {
                res = await window.apiFetch('/api/products', {
                    method: 'POST',
                    body:   payload,
                });
            }

            if (res && res.data) {
                window.showToast(_editingId ? 'تم تحديث المنتج بنجاح.' : 'تمت إضافة المنتج بنجاح.', 'success');
                window.closeProductModal();
                await loadProducts();
            }
        } catch (err) {
            _showFormError(err.message || 'حدث خطأ غير متوقع. حاول مرة أخرى.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled  = false;
                submitBtn.textContent = _editingId ? 'حفظ التعديلات' : 'إضافة المنتج';
            }
        }
    };

    // ==========================================================================
    // initProductsView()
    // Entry point — wires all event listeners then loads data.
    // Called at the bottom of this IIFE after all functions are defined.
    // ==========================================================================
    async function initProductsView() {
        // Add Product button
        const addBtn = document.getElementById('add-product-btn');
        if (addBtn) addBtn.addEventListener('click', () => window.openProductModal());

        _applyPermissions();
        _initSearch();

        // Product modal close buttons
        const closeBtn  = document.getElementById('product-modal-close-btn');
        const cancelBtn = document.getElementById('product-modal-cancel-btn');
        if (closeBtn)  closeBtn.addEventListener('click',  window.closeProductModal);
        if (cancelBtn) cancelBtn.addEventListener('click', window.closeProductModal);

        // Product modal backdrop click
        const modal = document.getElementById('product-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) window.closeProductModal();
            });
        }

        // Category quick-add modal close buttons + backdrop
        const catCloseBtn  = document.getElementById('category-modal-close-btn');
        const catCancelBtn = document.getElementById('category-modal-cancel-btn');
        if (catCloseBtn)  catCloseBtn.addEventListener('click',  window.closeCategoryModal);
        if (catCancelBtn) catCancelBtn.addEventListener('click', window.closeCategoryModal);
        const catModal = document.getElementById('category-modal');
        if (catModal) {
            catModal.addEventListener('click', (e) => {
                if (e.target === catModal) window.closeCategoryModal();
            });
        }

        // Unit quick-add modal close buttons + backdrop
        const unitCloseBtn  = document.getElementById('unit-modal-close-btn');
        const unitCancelBtn = document.getElementById('unit-modal-cancel-btn');
        if (unitCloseBtn)  unitCloseBtn.addEventListener('click',  window.closeUnitModal);
        if (unitCancelBtn) unitCancelBtn.addEventListener('click', window.closeUnitModal);
        const unitModal = document.getElementById('unit-modal');
        if (unitModal) {
            unitModal.addEventListener('click', (e) => {
                if (e.target === unitModal) window.closeUnitModal();
            });
        }

        // Variants modal close buttons + backdrop + done button
        const variantsCloseBtn = document.getElementById('variants-modal-close-btn');
        const variantsDoneBtn  = document.getElementById('variants-modal-done-btn');
        if (variantsCloseBtn) variantsCloseBtn.addEventListener('click', window.closeVariantsModal);
        if (variantsDoneBtn)  variantsDoneBtn.addEventListener('click',  window.closeVariantsModal);
        const variantsModal = document.getElementById('variants-modal');
        if (variantsModal) {
            variantsModal.addEventListener('click', (e) => {
                if (e.target === variantsModal) window.closeVariantsModal();
            });
        }

        // Load dropdowns and products in parallel
        await Promise.all([
            _loadCategories(),
            _loadUnits(),
            loadProducts(),
        ]);
    }

    // ── Navigate to product movements ─────────────────────────────────────────
    window.openProductMovements = function(productId, productName) {
        window._pmInitSearch = productName || '';
        window.navigateTo('product-movements');
    };

    // ── Auto-execute ──────────────────────────────────────────────────────────
    initProductsView();

})();
