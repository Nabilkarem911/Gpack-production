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
    let _unitSelect        = null; // SearchableSelect for #product-unit
    let _vfUnitSelect      = null; // SearchableSelect for #vf-unit

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

        const selFields = ['product-category', 'product-status'];
        selFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (id === 'product-status') el.value = 'active';
                else el.value = '';
            }
        });
        if (_unitSelect) _unitSelect.clear();
        _syncSearchableSelect('product-category');

        _clearFormError();
    }

    // ==========================================================================
    // _syncSearchableSelect(selectId)
    // makeSelectSearchable hides the <select> and shows a companion <input>.
    // Its MutationObserver only watches option nodes — programmatic .value
    // assignments do NOT update the visible text, leaving stale/empty labels.
    // This helper syncs the companion input with the selected option's text.
    // ==========================================================================
    function _syncSearchableSelect(selectId) {
        const sel   = document.getElementById(selectId);
        const input = document.getElementById(selectId + '_search');
        if (!sel || !input) return;
        const opt = sel.options[sel.selectedIndex];
        input.value = (opt && opt.value) ? opt.textContent : '';
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
                    <button type="button"
                            onclick="window.openProductLifecycle('${p.id}')"
                            title="فتح بطاقة الصنف (دورة الحياة)"
                            class="font-semibold text-slate-800 text-sm hover:text-brand-600
                                   hover:underline decoration-dotted underline-offset-4 transition-colors text-right">
                        ${p.name}
                    </button>
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
        if (!sel.dataset.searchable && window.makeSelectSearchable) {
            window.makeSelectSearchable(sel, '🔍 ابحث عن الفئة...');
        }
    }

    // selectId: optional UUID to auto-select after refresh (used by Quick Add)
    async function _loadUnits(selectId = null) {
        try {
            const res = await window.apiFetch('/api/units');
            _units = (res && res.data) ? res.data : [];
        } catch (_) {
            _units = [];
        }

        if (_unitSelect) {
            _unitSelect.setData(
                _units.map(u => ({
                    value: u.id,
                    label: u.abbreviation ? `${u.name} (${u.abbreviation})` : u.name,
                }))
            );
            if (selectId) _unitSelect.select(selectId);
        }
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
            _syncSearchableSelect('product-category');
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
        if (!_vfUnitSelect) return;
        _vfUnitSelect.setData(
            _units.map(u => ({
                value: u.id,
                label: u.abbreviation ? `${u.name} (${u.abbreviation})` : u.name,
            }))
        );
        if (selectedId) _vfUnitSelect.select(selectedId);
        else _vfUnitSelect.clear();
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
        if (_vfUnitSelect) _vfUnitSelect.clear();

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

        // Auto-inherit unit_id from the product's first existing variant
        if (product && Array.isArray(product.variants) && product.variants.length > 0) {
            const inheritedUnitId = product.variants[0].unit_id || null;
            if (inheritedUnitId && _vfUnitSelect) {
                _vfUnitSelect.select(inheritedUnitId);
            }
        }

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
            unit_id:          (_vfUnitSelect ? _vfUnitSelect.value : '')                      || null,
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
            _currentVariants = (fresh && fresh.data && fresh.data.variants)
                ? fresh.data.variants.filter(variant => variant.status === 'active')
                : [];
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
                    unit_id:         (_unitSelect ? _unitSelect.value : '')                     || null,
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
    // TAB SWITCHING — Products / Categories / Units
    // ==========================================================================
    let _activeProductsTab = 'products';
    let _editingCatTabId   = null;
    let _editingUnitTabId  = null;

    window.switchProductsTab = function (tab) {
        _activeProductsTab = tab;

        const panels = ['products', 'categories', 'units'];
        panels.forEach(p => {
            const panel = document.getElementById(`tab-${p}`);
            if (panel) panel.classList.toggle('hidden', p !== tab);

            const btn = document.getElementById(`tab-${p}-btn`);
            if (btn) {
                if (p === tab) {
                    btn.classList.add('border-brand-600', 'text-brand-600');
                    btn.classList.remove('border-transparent', 'text-slate-500');
                } else {
                    btn.classList.remove('border-brand-600', 'text-brand-600');
                    btn.classList.add('border-transparent', 'text-slate-500');
                }
            }
        });

        if (tab === 'categories') _loadCategoriesTable();
        else if (tab === 'units') _loadUnitsTable();
    };

    // ==========================================================================
    // CATEGORIES TAB — Table rendering + CRUD
    // ==========================================================================
    function _renderCategoriesTable() {
        const tbody = document.getElementById('categories-tbody');
        const empty = document.getElementById('categories-empty');
        if (!tbody) return;

        if (!_categories || _categories.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        const perms  = window.GpackPerms || {};
        const canEdit = perms.all_access || perms.products?.create || perms.products?.edit;

        tbody.innerHTML = _categories.map(c => `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3.5 px-4">
                    <span class="font-semibold text-slate-800 text-sm">${c.name}</span>
                </td>
                <td class="py-3.5 px-4 hidden sm:table-cell text-sm text-slate-500">
                    ${c.description || '<span class="text-slate-300">—</span>'}
                </td>
                <td class="py-3.5 px-4">
                    <div class="flex items-center justify-end gap-1">
                        ${canEdit ? `
                        <button onclick="window.openCategoryEditModal('${c.id}')"
                                title="تعديل"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-brand-600 hover:bg-brand-50 transition-colors">
                            <i class="fa-solid fa-pen-to-square text-sm"></i>
                        </button>
                        <button onclick="window.deleteCategoryEntry('${c.id}', '${c.name.replace(/'/g, "\\'")}')"
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

    async function _loadCategoriesTable() {
        const tbody = document.getElementById('categories-tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="3" class="py-10 text-center text-slate-400">
                <i class="fa-solid fa-circle-notch fa-spin text-xl"></i></td></tr>`;
        }
        try {
            const res = await window.apiFetch('/api/categories');
            _categories = (res && res.data) ? res.data : [];
            _renderCategoriesTable();
        } catch (err) {
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="3" class="py-8 text-center text-red-400 text-sm">
                    <i class="fa-solid fa-circle-exclamation ml-1"></i>
                    فشل تحميل التصنيفات: ${err.message}</td></tr>`;
            }
        }
    }

    window.openCategoryEditModal = function (id = null) {
        _editingCatTabId = id;
        const errBox = document.getElementById('category-edit-error');
        if (errBox) errBox.classList.add('hidden');

        const nameEl  = document.getElementById('category-edit-name');
        const descEl  = document.getElementById('category-edit-description');
        const title   = document.getElementById('category-edit-modal-title');
        const submitBtn = document.getElementById('category-edit-submit-btn');

        if (id) {
            const cat = _categories.find(c => c.id === id);
            if (!cat) return;
            if (title)      title.textContent       = 'تعديل التصنيف';
            if (submitBtn)  submitBtn.textContent   = 'حفظ التعديلات';
            if (nameEl)     nameEl.value            = cat.name || '';
            if (descEl)     descEl.value            = cat.description || '';
        } else {
            if (title)      title.textContent       = 'إضافة تصنيف جديد';
            if (submitBtn)  submitBtn.textContent   = 'إضافة';
            if (nameEl)     nameEl.value            = '';
            if (descEl)     descEl.value            = '';
        }

        _openQuickModal('category-edit-modal');
        setTimeout(() => { if (nameEl) nameEl.focus(); }, 250);
    };

    window.closeCategoryEditModal = function () {
        _closeQuickModal('category-edit-modal');
        _editingCatTabId = null;
    };

    window.submitCategoryEditForm = async function () {
        const errBox = document.getElementById('category-edit-error');
        const span   = errBox ? errBox.querySelector('span') : null;
        if (errBox) { if (span) span.textContent = ''; errBox.classList.add('hidden'); }

        const submitBtn = document.getElementById('category-edit-submit-btn');
        const name = (document.getElementById('category-edit-name')?.value || '').trim();

        if (!name) {
            if (errBox) { if (span) span.textContent = 'اسم التصنيف مطلوب.'; errBox.classList.remove('hidden'); }
            return;
        }

        if (submitBtn) {
            submitBtn.disabled  = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جارٍ الحفظ...';
        }

        const payload = {
            name,
            description: (document.getElementById('category-edit-description')?.value || '').trim() || null,
        };

        try {
            let res;
            if (_editingCatTabId) {
                res = await window.apiFetch(`/api/categories/${_editingCatTabId}`, {
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
                    _editingCatTabId ? 'تم تحديث التصنيف بنجاح.' : 'تمت إضافة التصنيف بنجاح.',
                    'success'
                );
                window.closeCategoryEditModal();
                await _loadCategoriesTable();
                await _loadCategories();
            }
        } catch (err) {
            if (errBox) { if (span) span.textContent = err.message || 'حدث خطأ غير متوقع.'; errBox.classList.remove('hidden'); }
        } finally {
            if (submitBtn) {
                submitBtn.disabled    = false;
                submitBtn.textContent = _editingCatTabId ? 'حفظ التعديلات' : 'إضافة';
            }
        }
    };

    window.deleteCategoryEntry = async function (id, name) {
        if (!confirm(`هل أنت متأكد من حذف التصنيف "${name}"؟\nلا يمكن التراجع عن هذا الإجراء.`)) return;

        try {
            await window.apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
            window.showToast(`تم حذف التصنيف "${name}" بنجاح.`, 'success');
            await _loadCategoriesTable();
            await _loadCategories();
        } catch (err) {
            window.showToast(err.message || 'فشل حذف التصنيف.', 'error');
        }
    };

    // ==========================================================================
    // UNITS TAB — Table rendering + CRUD
    // ==========================================================================
    function _renderUnitsTable() {
        const tbody = document.getElementById('units-tbody');
        const empty = document.getElementById('units-empty');
        if (!tbody) return;

        if (!_units || _units.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        const perms   = window.GpackPerms || {};
        const canEdit = perms.all_access || perms.products?.create || perms.products?.edit;

        tbody.innerHTML = _units.map(u => `
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
                        ${canEdit ? `
                        <button onclick="window.openUnitEditModal('${u.id}')"
                                title="تعديل"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                            <i class="fa-solid fa-pen-to-square text-sm"></i>
                        </button>
                        <button onclick="window.deleteUnitEntry('${u.id}', '${u.name.replace(/'/g, "\\'")}')"
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

    async function _loadUnitsTable() {
        const tbody = document.getElementById('units-tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="3" class="py-10 text-center text-slate-400">
                <i class="fa-solid fa-circle-notch fa-spin text-xl"></i></td></tr>`;
        }
        try {
            const res = await window.apiFetch('/api/units');
            _units = (res && res.data) ? res.data : [];
            _renderUnitsTable();
        } catch (err) {
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="3" class="py-8 text-center text-red-400 text-sm">
                    <i class="fa-solid fa-circle-exclamation ml-1"></i>
                    فشل تحميل الوحدات: ${err.message}</td></tr>`;
            }
        }
    }

    window.openUnitEditModal = function (id = null) {
        _editingUnitTabId = id;
        const errBox = document.getElementById('unit-edit-error');
        if (errBox) errBox.classList.add('hidden');

        const nameEl  = document.getElementById('unit-edit-name');
        const abbrEl  = document.getElementById('unit-edit-abbreviation');
        const title   = document.getElementById('unit-edit-modal-title');
        const submitBtn = document.getElementById('unit-edit-submit-btn');

        if (id) {
            const unit = _units.find(u => u.id === id);
            if (!unit) return;
            if (title)      title.textContent       = 'تعديل وحدة القياس';
            if (submitBtn)  submitBtn.textContent   = 'حفظ التعديلات';
            if (nameEl)     nameEl.value            = unit.name || '';
            if (abbrEl)     abbrEl.value            = unit.abbreviation || '';
        } else {
            if (title)      title.textContent       = 'إضافة وحدة قياس جديدة';
            if (submitBtn)  submitBtn.textContent   = 'إضافة';
            if (nameEl)     nameEl.value            = '';
            if (abbrEl)     abbrEl.value            = '';
        }

        _openQuickModal('unit-edit-modal');
        setTimeout(() => { if (nameEl) nameEl.focus(); }, 250);
    };

    window.closeUnitEditModal = function () {
        _closeQuickModal('unit-edit-modal');
        _editingUnitTabId = null;
    };

    window.submitUnitEditForm = async function () {
        const errBox = document.getElementById('unit-edit-error');
        const span   = errBox ? errBox.querySelector('span') : null;
        if (errBox) { if (span) span.textContent = ''; errBox.classList.add('hidden'); }

        const submitBtn = document.getElementById('unit-edit-submit-btn');
        const name = (document.getElementById('unit-edit-name')?.value || '').trim();

        if (!name) {
            if (errBox) { if (span) span.textContent = 'اسم الوحدة مطلوب.'; errBox.classList.remove('hidden'); }
            return;
        }

        if (submitBtn) {
            submitBtn.disabled  = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جارٍ الحفظ...';
        }

        const payload = {
            name,
            abbreviation: (document.getElementById('unit-edit-abbreviation')?.value || '').trim() || null,
        };

        try {
            let res;
            if (_editingUnitTabId) {
                res = await window.apiFetch(`/api/units/${_editingUnitTabId}`, {
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
                    _editingUnitTabId ? 'تم تحديث الوحدة بنجاح.' : 'تمت إضافة الوحدة بنجاح.',
                    'success'
                );
                window.closeUnitEditModal();
                await _loadUnitsTable();
                await _loadUnits();
            }
        } catch (err) {
            if (errBox) { if (span) span.textContent = err.message || 'حدث خطأ غير متوقع.'; errBox.classList.remove('hidden'); }
        } finally {
            if (submitBtn) {
                submitBtn.disabled    = false;
                submitBtn.textContent = _editingUnitTabId ? 'حفظ التعديلات' : 'إضافة';
            }
        }
    };

    window.deleteUnitEntry = async function (id, name) {
        if (!confirm(`هل أنت متأكد من حذف الوحدة "${name}"؟\nلا يمكن التراجع عن هذا الإجراء.`)) return;

        try {
            await window.apiFetch(`/api/units/${id}`, { method: 'DELETE' });
            window.showToast(`تم حذف الوحدة "${name}" بنجاح.`, 'success');
            await _loadUnitsTable();
            await _loadUnits();
        } catch (err) {
            window.showToast(err.message || 'فشل حذف الوحدة.', 'error');
        }
    };

    // ==========================================================================
    // initProductsView()
    // Entry point — wires all event listeners then loads data.
    // Called at the bottom of this IIFE after all functions are defined.
    // ==========================================================================
    async function initProductsView() {
        var _myToken = window.getCurrentNavToken ? window.getCurrentNavToken() : 0;
        // Add Product button
        const addBtn = document.getElementById('add-product-btn');
        if (addBtn) addBtn.addEventListener('click', () => window.openProductModal());

        // Initialise SearchableSelect instances for unit dropdowns
        const puContainer = document.getElementById('product-unit');
        if (puContainer && window.SearchableSelect) {
            _unitSelect = new window.SearchableSelect(puContainer, {
                placeholder:       '— بدون وحدة —',
                searchPlaceholder: 'بحث عن وحدة...',
                emptyText:         'لا توجد وحدات مطابقة',
                iconClass:         'fa-solid fa-ruler',
            });
        }
        const vfContainer = document.getElementById('vf-unit');
        if (vfContainer && window.SearchableSelect) {
            _vfUnitSelect = new window.SearchableSelect(vfContainer, {
                placeholder:       '— بدون وحدة —',
                searchPlaceholder: 'بحث عن وحدة...',
                emptyText:         'لا توجد وحدات مطابقة',
                iconClass:         'fa-solid fa-ruler',
            });
        }

        _applyPermissions();
        _initSearch();

        // Enter key navigation in product modal (Excel-like tab behavior)
        const _productModalFields = [
            'product-name', 'product-sku', 'variant-size-name',
            'variant-sku', 'variant-cost-price', 'variant-selling-price', 'variant-min-stock'
        ];
        _productModalFields.forEach(function(id, idx) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var nextId = _productModalFields[idx + 1];
                    if (nextId) {
                        var nextEl = document.getElementById(nextId);
                        if (nextEl) { nextEl.focus(); nextEl.select(); }
                    } else {
                        var submitBtn = document.getElementById('product-modal-submit-btn');
                        if (submitBtn) submitBtn.click();
                    }
                }
            });
        });

        // Enter key navigation in variant add form (Excel-like tab behavior)
        const _variantFormFields = [
            'vf-size-name', 'vf-sku', 'vf-cost-price', 'vf-selling-price', 'vf-min-stock'
        ];
        _variantFormFields.forEach(function(id, idx) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var nextId = _variantFormFields[idx + 1];
                    if (nextId) {
                        var nextEl = document.getElementById(nextId);
                        if (nextEl) { nextEl.focus(); nextEl.select(); }
                    } else {
                        var submitBtn = document.getElementById('variant-form-submit-btn');
                        if (submitBtn) submitBtn.click();
                    }
                }
            });
        });

        // Product modal close buttons
        const closeBtn  = document.getElementById('product-modal-close-btn');
        const cancelBtn = document.getElementById('product-modal-cancel-btn');
        if (closeBtn)  closeBtn.addEventListener('click',  window.closeProductModal);
        if (cancelBtn) cancelBtn.addEventListener('click', window.closeProductModal);

        // Category quick-add modal close buttons + backdrop
        const catCloseBtn  = document.getElementById('category-modal-close-btn');
        const catCancelBtn = document.getElementById('category-modal-cancel-btn');
        if (catCloseBtn)  catCloseBtn.addEventListener('click',  window.closeCategoryModal);
        if (catCancelBtn) catCancelBtn.addEventListener('click', window.closeCategoryModal);
        // Unit quick-add modal close buttons + backdrop
        const unitCloseBtn  = document.getElementById('unit-modal-close-btn');
        const unitCancelBtn = document.getElementById('unit-modal-cancel-btn');
        if (unitCloseBtn)  unitCloseBtn.addEventListener('click',  window.closeUnitModal);
        if (unitCancelBtn) unitCancelBtn.addEventListener('click', window.closeUnitModal);
        // Variants modal close buttons + backdrop + done button
        const variantsCloseBtn = document.getElementById('variants-modal-close-btn');
        const variantsDoneBtn  = document.getElementById('variants-modal-done-btn');
        if (variantsCloseBtn) variantsCloseBtn.addEventListener('click', window.closeVariantsModal);
        if (variantsDoneBtn)  variantsDoneBtn.addEventListener('click',  window.closeVariantsModal);

        // Product lifecycle modal close + edit buttons
        const plcCloseBtn = document.getElementById('plc-close-btn');
        const plcEditBtn  = document.getElementById('plc-edit-btn');
        if (plcCloseBtn) plcCloseBtn.addEventListener('click', window.closeProductLifecycle);
        if (plcEditBtn)  plcEditBtn.addEventListener('click',  window.plcEditProduct);
        // Category tab add button
        const addCatTabBtn = document.getElementById('add-category-tab-btn');
        if (addCatTabBtn) addCatTabBtn.addEventListener('click', () => window.openCategoryEditModal());

        // Category edit modal close buttons + backdrop
        const catEditCloseBtn  = document.getElementById('category-edit-close-btn');
        const catEditCancelBtn = document.getElementById('category-edit-cancel-btn');
        if (catEditCloseBtn)  catEditCloseBtn.addEventListener('click',  window.closeCategoryEditModal);
        if (catEditCancelBtn) catEditCancelBtn.addEventListener('click', window.closeCategoryEditModal);
        // Unit tab add button
        const addUnitTabBtn = document.getElementById('add-unit-tab-btn');
        if (addUnitTabBtn) addUnitTabBtn.addEventListener('click', () => window.openUnitEditModal());

        // Unit edit modal close buttons + backdrop
        const unitEditCloseBtn  = document.getElementById('unit-edit-close-btn');
        const unitEditCancelBtn = document.getElementById('unit-edit-cancel-btn');
        if (unitEditCloseBtn)  unitEditCloseBtn.addEventListener('click',  window.closeUnitEditModal);
        if (unitEditCancelBtn) unitEditCancelBtn.addEventListener('click', window.closeUnitEditModal);
        // Gate tab add buttons based on write permissions
        const perms   = window.GpackPerms || {};
        const canEdit = perms.all_access || perms.products?.create || perms.products?.edit;
        if (!canEdit) {
            const catTabBtn = document.getElementById('add-category-tab-btn');
            const unitTabBtn = document.getElementById('add-unit-tab-btn');
            if (catTabBtn)  catTabBtn.classList.add('hidden');
            if (unitTabBtn) unitTabBtn.classList.add('hidden');
        }

        // Load dropdowns and products in parallel
        await Promise.all([
            _loadCategories(),
            _loadUnits(),
            loadProducts(),
        ]);
        if (window.isViewActive && !window.isViewActive(_myToken)) return;
    }

    // ── Navigate to product movements ─────────────────────────────────────────
    window.openProductMovements = function(productId, productName) {
        window._pmInitSearch = productName || '';
        window.navigateTo('product-movements');
    };

    // ── Smart Pricing Suggestion (Phase 4) ─────────────────────────────────────
    function _suggestPrice() {
        var nameEl = document.getElementById('product-name');
        var priceEl = document.getElementById('variant-selling-price');
        var boxEl = document.getElementById('ai-price-suggestion-box');
        var btnEl = document.getElementById('ai-priceuggest-btn');
        if (!nameEl || !priceEl || !boxEl) return;

        var productName = nameEl.value.trim();
        if (!productName) {
            if (window.showToast) window.showToast('اكتب اسم المنتج أولاً', 'warning');
            nameEl.focus();
            return;
        }

        // Show loading state
        boxEl.classList.remove('hidden');
        boxEl.innerHTML = '<div class="flex items-center gap-2 text-violet-600"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحليل الأسعار...</div>';
        if (btnEl) btnEl.disabled = true;

        window.apiFetch('/api/ai-assistant/suggest-price?product_name=' + encodeURIComponent(productName) + '&target_margin=20')
            .then(function(res) {
                if (!res.suggestions || res.suggestions.length === 0) {
                    boxEl.innerHTML = '<div class="text-slate-500">' + (res.message || 'لا توجد بيانات كافية للاقتراح') + '</div>';
                    return;
                }

                var s = res.suggestions[0]; // Show first (most relevant) suggestion
                var html = '<div class="space-y-2">';
                html += '<div class="flex items-center justify-between"><span class="text-slate-500">السعر المقترح (هامش 20%)</span><span class="font-bold text-violet-700 text-base">' + parseFloat(s.suggested_price).toLocaleString('ar-SA', {maximumFractionDigits: 2}) + ' ر.س</span></div>';
                html += '<div class="flex items-center justify-between"><span class="text-slate-400">التكلفة</span><span class="text-slate-600">' + parseFloat(s.cost_price).toLocaleString('ar-SA', {maximumFractionDigits: 2}) + ' ر.س</span></div>';
                html += '<div class="flex items-center justify-between"><span class="text-slate-400">السعر الحالي</span><span class="text-slate-600">' + parseFloat(s.current_selling_price).toLocaleString('ar-SA', {maximumFractionDigits: 2}) + ' ر.س</span></div>';
                html += '<div class="flex items-center justify-between"><span class="text-slate-400">هامش الربح الحالي</span><span class="' + (s.current_margin_percent >= 20 ? 'text-emerald-600' : 'text-amber-600') + ' font-semibold">' + s.current_margin_percent + '%</span></div>';
                if (s.times_sold > 0) {
                    html += '<div class="flex items-center justify-between"><span class="text-slate-400">متوسط سعر البيع السابق</span><span class="text-slate-600">' + parseFloat(s.avg_historical_price).toLocaleString('ar-SA', {maximumFractionDigits: 2}) + ' ر.س (' + s.times_sold + ' مرة)</span></div>';
                }
                html += '<div class="flex gap-2 pt-1">';
                html += '<button type="button" id="ai-price-accept" class="flex-1 px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-semibold hover:bg-violet-700 transition-colors">استخدام السعر المقترح</button>';
                html += '<button type="button" id="ai-price-dismiss" class="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs hover:bg-slate-200 transition-colors">إغلاق</button>';
                html += '</div>';
                html += '</div>';
                boxEl.innerHTML = html;

                var acceptBtn = document.getElementById('ai-price-accept');
                var dismissBtn = document.getElementById('ai-price-dismiss');
                if (acceptBtn) acceptBtn.addEventListener('click', function() {
                    priceEl.value = s.suggested_price;
                    boxEl.classList.add('hidden');
                    if (window.showToast) window.showToast('تم تحديث سعر البيع', 'success');
                });
                if (dismissBtn) dismissBtn.addEventListener('click', function() {
                    boxEl.classList.add('hidden');
                });
            })
            .catch(function(err) {
                boxEl.innerHTML = '<div class="text-rose-500">تعذّر جلب الاقتراح: ' + (err.message || 'خطأ غير معروف') + '</div>';
            })
            .finally(function() {
                if (btnEl) btnEl.disabled = false;
            });
    }

    // Wire the button after DOM is ready (called from initProductsView)
    var _priceBtn = document.getElementById('ai-priceuggest-btn');
    if (_priceBtn) _priceBtn.addEventListener('click', _suggestPrice);

    // ==========================================================================
    // PRODUCT LIFECYCLE MODAL (بطاقة الصنف)
    // Sections are lazy-loaded per tab via GET /api/products/:id/lifecycle?section=
    // ==========================================================================
    let _plcProductId      = null;
    let _plcProduct        = null;
    let _plcVariants       = [];
    let _plcActiveTab      = 'overview';
    let _plcLoadedSections = {};

    const _plcEsc  = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const _plcFmt  = (v) => v === null || v === undefined || v === ''
        ? '—' : parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const _plcQty  = (v) => parseFloat(v || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
    const _plcDate = (v) => v ? new Date(v).toLocaleDateString('en-GB') : '—';
    const _plcEl   = (id) => document.getElementById(id);

    const _plcStatusBadge = (status) => status === 'active'
        ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">نشط</span>'
        : '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-500">غير نشط</span>';

    const _plcOrderStatus = {
        quote: 'عرض سعر', confirmed: 'مؤكد', production: 'إنتاج', processing: 'معالجة',
        completed: 'مكتمل', delivered: 'مُسلَّم', cancelled: 'ملغي', draft: 'مسودة',
    };
    const _plcMoStatus = {
        pending: 'قيد الانتظار', sent: 'مُرسل', in_production: 'قيد الإنتاج',
        partially_received: 'استلام جزئي', received: 'مستلم', completed: 'مكتمل', cancelled: 'ملغي',
    };

    function _plcLoading(section) {
        const panel = _plcEl(`plc-panel-${section}`);
        if (panel) {
            panel.innerHTML = '<div class="py-16 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-2xl"></i></div>';
        }
    }

    function _plcError(section, msg) {
        const panel = _plcEl(`plc-panel-${section}`);
        if (panel) {
            panel.innerHTML = `<div class="py-12 text-center text-red-400 text-sm">
                <i class="fa-solid fa-circle-exclamation ml-1"></i>${_plcEsc(msg)}</div>`;
        }
    }

    function _plcForbidden(section) {
        const panel = _plcEl(`plc-panel-${section}`);
        if (panel) {
            panel.innerHTML = `<div class="py-12 text-center text-slate-400">
                <i class="fa-solid fa-lock text-3xl mb-2 block text-slate-300"></i>
                <p class="text-sm font-semibold">غير مصرح بعرض هذا القسم</p></div>`;
        }
    }

    function _plcEmpty(section, msg) {
        const panel = _plcEl(`plc-panel-${section}`);
        if (panel) {
            panel.innerHTML = `<div class="py-12 text-center text-slate-400">
                <i class="fa-solid fa-inbox text-3xl mb-2 block text-slate-200"></i>
                <p class="text-sm font-semibold">${_plcEsc(msg)}</p></div>`;
        }
    }

    // ── Open / Close ──────────────────────────────────────────────────────────
    window.openProductLifecycle = async function (productId) {
        _plcProductId      = productId;
        _plcProduct        = null;
        _plcVariants       = [];
        _plcLoadedSections = {};
        _plcActiveTab      = 'overview';

        const modal = _plcEl('plc-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('opacity-100');
            modal.querySelector('.modal-panel').classList.add('scale-100');
        });

        _plcEl('plc-product-name').textContent     = '...';
        _plcEl('plc-product-sku').textContent      = '';
        _plcEl('plc-product-category').textContent = '';
        _plcEl('plc-status-badge').innerHTML       = '';

        const perms   = window.GpackPerms || {};
        const canEdit = perms.all_access || perms.products?.edit;
        const editBtn = _plcEl('plc-edit-btn');
        if (editBtn) {
            editBtn.classList.toggle('hidden', !canEdit);
            editBtn.classList.toggle('flex',   !!canEdit);
        }

        _plcSwitchTabUI('overview');
        _plcLoading('overview');

        try {
            const res = await window.apiFetch(`/api/products/${productId}/lifecycle?section=overview`);
            _plcProduct  = res.data.product;
            _plcVariants = res.data.variants || [];
            _plcLoadedSections.overview = true;
            _plcRenderHeader();
            _plcRenderOverview();
        } catch (err) {
            _plcError('overview', err.message || 'تعذر تحميل بيانات الصنف.');
        }
    };

    window.closeProductLifecycle = function () {
        const modal = _plcEl('plc-modal');
        if (!modal) return;
        modal.classList.remove('opacity-100');
        modal.querySelector('.modal-panel').classList.remove('scale-100');
        setTimeout(() => {
            modal.style.display = 'none';
            _plcProductId = null;
        }, 200);
    };

    function _plcRenderHeader() {
        if (!_plcProduct) return;
        _plcEl('plc-product-name').textContent     = _plcProduct.name || '—';
        _plcEl('plc-product-sku').textContent      = _plcProduct.sku ? `SKU: ${_plcProduct.sku}` : '';
        _plcEl('plc-product-category').textContent = _plcProduct.category_name ? `الفئة: ${_plcProduct.category_name}` : '';
        _plcEl('plc-status-badge').innerHTML       = _plcStatusBadge(_plcProduct.status);
    }

    // ── Tab switching ─────────────────────────────────────────────────────────
    function _plcSwitchTabUI(section) {
        _plcActiveTab = section;
        document.querySelectorAll('.plc-tab').forEach(btn => {
            btn.classList.toggle('plc-tab-active', btn.dataset.plcTab === section);
        });
        ['overview','variants','stock','movements','sales','purchases','prices'].forEach(sec => {
            const panel = _plcEl(`plc-panel-${sec}`);
            if (panel) panel.classList.toggle('hidden', sec !== section);
        });
    }

    window.plcSwitchTab = async function (section) {
        if (!_plcProductId || section === _plcActiveTab && _plcLoadedSections[section]) {
            _plcSwitchTabUI(section);
            return;
        }
        _plcSwitchTabUI(section);

        // Variants tab is rendered from already-loaded overview data
        if (section === 'variants') {
            _plcRenderVariants();
            return;
        }
        if (_plcLoadedSections[section]) return;

        _plcLoading(section);
        try {
            const res = await window.apiFetch(`/api/products/${_plcProductId}/lifecycle?section=${section}`);
            _plcLoadedSections[section] = true;
            const d = res.data;
            if      (section === 'stock')     _plcRenderStock(d);
            else if (section === 'movements') _plcRenderMovements(d);
            else if (section === 'sales')     _plcRenderSales(d);
            else if (section === 'purchases') _plcRenderPurchases(d);
            else if (section === 'prices')    _plcRenderPrices(d);
        } catch (err) {
            if (err.message && err.message.includes('غير مصرح')) _plcForbidden(section);
            else _plcError(section, err.message || 'تعذر تحميل البيانات.');
        }
    };

    // ── Section renderers ─────────────────────────────────────────────────────
    function _plcRenderOverview() {
        const panel = _plcEl('plc-panel-overview');
        if (!panel || !_plcProduct) return;
        const p = _plcProduct;
        const activeVars   = _plcVariants.filter(v => v.status === 'active').length;
        const inactiveVars = _plcVariants.length - activeVars;

        const row = (label, value) => `
            <div class="flex items-center justify-between py-2.5 border-b border-slate-100">
                <span class="text-xs font-semibold text-slate-500">${label}</span>
                <span class="text-sm font-bold text-slate-800">${value || '<span class="text-slate-300">—</span>'}</span>
            </div>`;

        panel.innerHTML = `
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <div class="plc-kpi"><div class="v text-brand-600">${_plcVariants.length}</div><div class="l">إجمالي المقاسات</div></div>
                <div class="plc-kpi"><div class="v text-emerald-600">${activeVars}</div><div class="l">مقاسات نشطة</div></div>
                <div class="plc-kpi"><div class="v text-slate-500">${inactiveVars}</div><div class="l">مقاسات غير نشطة</div></div>
                <div class="plc-kpi"><div class="v text-slate-700">${_plcQty(_plcVariants.length)}</div><div class="l">وحدات SKU</div></div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                ${row('اسم الصنف',        _plcEsc(p.name))}
                ${row('SKU',             p.sku ? `<span class="font-mono">${_plcEsc(p.sku)}</span>` : null)}
                ${row('الباركود',        p.barcode ? `<span class="font-mono">${_plcEsc(p.barcode)}</span>` : null)}
                ${row('الفئة',           _plcEsc(p.category_name))}
                ${row('الحالة',          _plcStatusBadge(p.status))}
                ${row('أنشئ بواسطة',     _plcEsc(p.created_by_name))}
                ${row('تاريخ الإنشاء',   _plcDate(p.created_at))}
                ${row('آخر تعديل',       _plcDate(p.updated_at))}
            </div>
            <div class="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <p class="text-xs font-bold text-slate-500 mb-1">الوصف</p>
                <p class="text-sm text-slate-700">${_plcEsc(p.description) || '<span class="text-slate-300">لا يوجد وصف</span>'}</p>
            </div>`;
    }

    function _plcRenderVariants() {
        const panel = _plcEl('plc-panel-variants');
        if (!panel) return;
        _plcLoadedSections.variants = true;

        const canManage = (window.GpackPerms || {}).all_access || (window.GpackPerms || {}).products?.edit;

        const rows = _plcVariants.map(v => `
            <tr>
                <td class="font-semibold text-slate-800">${_plcEsc(v.size_name)}</td>
                <td class="font-mono text-slate-500">${_plcEsc(v.sku) || '—'}</td>
                <td class="font-mono text-slate-500">${_plcEsc(v.barcode) || '—'}</td>
                <td>${_plcEsc(v.unit_name || '—')}${v.unit_abbreviation ? ` (${_plcEsc(v.unit_abbreviation)})` : ''}</td>
                <td class="font-mono">${_plcFmt(v.cost_price)}</td>
                <td class="font-mono">${_plcFmt(v.selling_price)}</td>
                <td class="font-mono">${v.min_stock_level ?? '—'}</td>
                <td>${_plcStatusBadge(v.status)}</td>
            </tr>`).join('');

        panel.innerHTML = `
            <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-bold text-slate-700">جميع المقاسات (${_plcVariants.length})</h3>
                ${canManage ? `
                <button onclick="window.viewProductVariants('${_plcProductId}')"
                        class="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600
                               hover:bg-emerald-700 rounded-xl transition-colors">
                    <i class="fa-solid fa-cubes"></i> إدارة المقاسات
                </button>` : ''}
            </div>
            <div class="overflow-x-auto rounded-xl border border-slate-200">
                <table class="w-full plc-table">
                    <thead><tr>
                        <th>المقاس</th><th>SKU</th><th>الباركود</th><th>الوحدة</th>
                        <th>التكلفة</th><th>سعر البيع</th><th>الحد الأدنى</th><th>الحالة</th>
                    </tr></thead>
                    <tbody>${rows || `<tr><td colspan="8" class="py-10 text-center text-slate-400">لا توجد مقاسات لهذا الصنف</td></tr>`}</tbody>
                </table>
            </div>`;
    }

    function _plcRenderStock(d) {
        const panel = _plcEl('plc-panel-stock');
        if (!panel) return;
        const rows = d.stock || [];

        if (!rows.length) { _plcEmpty('stock', 'لا يوجد مخزون مسجل لهذا الصنف'); return; }

        const totalQ = rows.reduce((a, r) => a + parseFloat(r.quantity || 0), 0);
        const totalR = rows.reduce((a, r) => a + parseFloat(r.reserved_qty || 0), 0);
        const totalA = rows.reduce((a, r) => a + parseFloat(r.available_qty || 0), 0);

        const perms    = window.GpackPerms || {};
        const canAdjust = perms.all_access || perms.inventory?.edit || perms.inventory?.create;

        // Cache rows keyed by stock_id so the adjust button stays quote-safe
        window._plcStockRows = {};
        rows.forEach(r => { window._plcStockRows[r.stock_id] = r; });

        const body = rows.map(r => {
            const lowStock = r.min_stock_level != null && parseFloat(r.available_qty) <= parseFloat(r.min_stock_level) && parseFloat(r.available_qty) > 0;
            const outStock = parseFloat(r.available_qty) <= 0;
            const flag = outStock
                ? '<span class="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">نفد</span>'
                : lowStock
                    ? '<span class="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">منخفض</span>'
                    : '<span class="text-xs text-slate-300">—</span>';
            const clientLabel = r.client_name
                ? `${_plcEsc(r.client_name)}${r.client_parent_name ? ` <span class="text-xs text-slate-400">(${_plcEsc(r.client_parent_name)})</span>` : ''}`
                : '<span class="text-slate-400">مخزون عام</span>';
            return `<tr>
                <td class="font-semibold">${_plcEsc(r.size_name || '—')}</td>
                <td>${_plcEsc(r.warehouse_name || '—')}</td>
                <td>${clientLabel}</td>
                <td class="font-mono font-bold">${_plcQty(r.quantity)}</td>
                <td class="font-mono text-slate-500">${_plcQty(r.reserved_qty)}</td>
                <td class="font-mono font-bold ${outStock ? 'text-red-600' : 'text-emerald-700'}">${_plcQty(r.available_qty)}</td>
                <td>${flag}</td>
                <td class="text-xs text-slate-400">${_plcDate(r.last_updated)}</td>
                <td>${canAdjust ? `
                    <button onclick="window.plcAdjustStock('${r.stock_id}')"
                            title="تسوية يدوية"
                            class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400
                                   hover:text-amber-600 hover:bg-amber-50 transition-colors">
                        <i class="fa-solid fa-sliders text-xs"></i>
                    </button>` : ''}</td>
            </tr>`;
        }).join('');

        panel.innerHTML = `
            <div class="grid grid-cols-3 gap-3 mb-4">
                <div class="plc-kpi"><div class="v text-slate-700">${_plcQty(totalQ)}</div><div class="l">إجمالي الكمية</div></div>
                <div class="plc-kpi"><div class="v text-amber-600">${_plcQty(totalR)}</div><div class="l">المحجوزة</div></div>
                <div class="plc-kpi"><div class="v text-emerald-600">${_plcQty(totalA)}</div><div class="l">المتاحة</div></div>
            </div>
            <div class="overflow-x-auto rounded-xl border border-slate-200">
                <table class="w-full plc-table">
                    <thead><tr>
                        <th>المقاس</th><th>المستودع</th><th>العميل</th>
                        <th>الكمية</th><th>المحجوزة</th><th>المتاحة</th>
                        <th>حالة المخزون</th><th>آخر تحديث</th><th></th>
                    </tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>`;
    }

    window.plcAdjustStock = async function (stockId) {
        const row = (window._plcStockRows || {})[stockId];
        if (!row) return;
        const sizeName   = row.size_name || '';
        const currentQty = _plcQty(row.quantity);
        const input = prompt(`تسوية مخزون — ${sizeName}\nالكمية الحالية: ${currentQty}\n\nأدخل قيمة التعديل (موجبة للزيادة، سالبة للنقص):`);
        if (input === null) return;
        const adjustment = parseFloat(input);
        if (isNaN(adjustment) || adjustment === 0) {
            window.showToast('قيمة التعديل غير صالحة.', 'warning');
            return;
        }
        const reason = prompt('سبب التسوية (اختياري):', 'تسوية من بطاقة الصنف');
        if (reason === null) return;

        try {
            await window.apiFetch('/api/inventory/stock/adjust', {
                method: 'POST',
                body:   { stock_id: stockId, adjustment, reason: reason || 'تسوية من بطاقة الصنف' },
            });
            window.showToast('تمت التسوية بنجاح.', 'success');
            _plcLoadedSections.stock = false;
            window.plcSwitchTab('stock');
        } catch (err) {
            window.showToast(err.message || 'فشل تنفيذ التسوية.', 'error');
        }
    };

    function _plcRenderMovements(d) {
        const panel = _plcEl('plc-panel-movements');
        if (!panel) return;
        const rows = d.movements || [];

        if (!rows.length) { _plcEmpty('movements', 'لا توجد حركات مخزنية لهذا الصنف'); return; }

        const typeMap = {
            receipt:  { label: 'استلام',  cls: 'bg-emerald-100 text-emerald-700', sign: '+' },
            dispense: { label: 'صرف',     cls: 'bg-amber-100 text-amber-700',     sign: '-' },
            return:   { label: 'مرتجع',   cls: 'bg-blue-100 text-blue-700',       sign: '+' },
            transfer: { label: 'تحويل',   cls: 'bg-slate-100 text-slate-600',     sign: '⇄' },
            adjust:   { label: 'تسوية',   cls: 'bg-purple-100 text-purple-700',   sign: '±' },
        };

        const body = rows.map(r => {
            const t = typeMap[r.transaction_type] || { label: r.transaction_type, cls: 'bg-slate-100 text-slate-600', sign: '' };
            const counterpart = r.supplier_name || r.client_name || '—';
            const ref = r.mo_number
                ? `<span class="font-mono text-xs">MO-${r.mo_number}</span>`
                : r.delivery_note_number
                    ? `<span class="font-mono text-xs">DN-${r.delivery_note_number}</span>`
                    : (r.reference_type ? `<span class="text-xs text-slate-400">${_plcEsc(r.reference_type)}</span>` : '—');
            return `<tr>
                <td class="text-slate-500 whitespace-nowrap">${_plcDate(r.created_at)}</td>
                <td><span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${t.cls}">${t.label}</span></td>
                <td>${_plcEsc(r.size_name || '—')}</td>
                <td class="font-mono font-bold">${t.sign}${_plcQty(r.quantity)}</td>
                <td class="font-mono">${_plcFmt(r.unit_cost)}</td>
                <td>${_plcEsc(counterpart)}</td>
                <td>${ref}</td>
                <td class="text-xs text-slate-400 max-w-[160px] truncate" title="${_plcEsc(r.notes)}">${_plcEsc(r.notes) || '—'}</td>
            </tr>`;
        }).join('');

        panel.innerHTML = `
            <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-bold text-slate-700">آخر ${rows.length} حركة مخزنية</h3>
                <button onclick="window.plcGoToMovements()"
                        class="text-xs font-bold text-brand-600 hover:text-brand-800 transition-colors">
                    <i class="fa-solid fa-arrow-up-left-from-box ml-1"></i> فتح صفحة حركات الأصناف الكاملة
                </button>
            </div>
            <div class="overflow-x-auto rounded-xl border border-slate-200">
                <table class="w-full plc-table">
                    <thead><tr>
                        <th>التاريخ</th><th>النوع</th><th>المقاس</th><th>الكمية</th>
                        <th>تكلفة الوحدة</th><th>الطرف الآخر</th><th>المرجع</th><th>ملاحظات</th>
                    </tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>`;
    }

    function _plcRenderSales(d) {
        const panel = _plcEl('plc-panel-sales');
        if (!panel) return;
        const byVariant  = d.by_variant   || [];
        const monthly    = d.monthly      || [];
        const topClients = d.top_clients  || [];
        const recent     = d.recent_lines || [];

        const totalQty  = byVariant.reduce((a, r) => a + parseFloat(r.qty_sold || 0), 0);
        const totalRev  = byVariant.reduce((a, r) => a + parseFloat(r.revenue  || 0), 0);
        const totalOrds = byVariant.reduce((a, r) => a + parseInt(r.order_count || 0, 10), 0);

        if (!totalQty && !recent.length) { _plcEmpty('sales', 'لا توجد مبيعات مسجلة لهذا الصنف'); return; }

        const prices = byVariant.map(r => parseFloat(r.avg_price)).filter(v => !isNaN(v) && v !== null);
        const minP   = byVariant.reduce((m, r) => r.min_price !== null && (m === null || parseFloat(r.min_price) < m) ? parseFloat(r.min_price) : m, null);
        const maxP   = byVariant.reduce((m, r) => r.max_price !== null && (m === null || parseFloat(r.max_price) > m) ? parseFloat(r.max_price) : m, null);
        const avgP   = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;

        const monthlyRows = monthly.map(m => `<tr>
            <td>${_plcEsc(m.month)}</td>
            <td class="font-mono">${_plcQty(m.qty)}</td>
            <td class="font-mono font-bold">${_plcFmt(m.revenue)}</td>
        </tr>`).join('');

        const clientsRows = topClients.map(c => `<tr>
            <td class="font-semibold">${_plcEsc(c.name)}</td>
            <td class="font-mono">${_plcQty(c.qty)}</td>
            <td class="font-mono font-bold">${_plcFmt(c.revenue)}</td>
        </tr>`).join('');

        const variantRows = byVariant.map(r => `<tr>
            <td class="font-semibold">${_plcEsc(r.size_name)}</td>
            <td class="font-mono">${_plcQty(r.qty_sold)}</td>
            <td class="font-mono font-bold">${_plcFmt(r.revenue)}</td>
            <td class="font-mono">${r.order_count || 0}</td>
            <td class="font-mono">${_plcFmt(r.avg_price)}</td>
            <td class="font-mono">${_plcFmt(r.min_price)}</td>
            <td class="font-mono">${_plcFmt(r.max_price)}</td>
        </tr>`).join('');

        const recentRows = recent.map(r => `<tr>
            <td class="text-slate-500">${_plcDate(r.order_date)}</td>
            <td class="font-mono">#${r.order_number || '—'}</td>
            <td>${_plcEsc(r.client_name || '—')}</td>
            <td>${_plcEsc(r.size_name || '—')}</td>
            <td class="font-mono">${_plcQty(r.quantity)}</td>
            <td class="font-mono">${_plcFmt(r.unit_price)}</td>
            <td class="font-mono font-bold">${_plcFmt(r.line_total)}</td>
            <td><span class="text-xs font-semibold text-slate-600">${_plcOrderStatus[r.status] || r.status}</span></td>
        </tr>`).join('');

        panel.innerHTML = `
            <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
                <div class="plc-kpi"><div class="v text-brand-600">${_plcQty(totalQty)}</div><div class="l">إجمالي المباع</div></div>
                <div class="plc-kpi"><div class="v text-emerald-600">${_plcFmt(totalRev)}</div><div class="l">إجمالي الإيراد (ر.س)</div></div>
                <div class="plc-kpi"><div class="v text-slate-700">${totalOrds}</div><div class="l">عدد الطلبات</div></div>
                <div class="plc-kpi"><div class="v text-amber-600">${avgP !== null ? _plcFmt(avgP) : '—'}</div><div class="l">متوسط سعر البيع</div></div>
                <div class="plc-kpi"><div class="v text-slate-600 text-xs font-bold leading-5">${minP !== null ? _plcFmt(minP) : '—'} / ${maxP !== null ? _plcFmt(maxP) : '—'}</div><div class="l">أدنى / أعلى سعر</div></div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
                <div>
                    <h4 class="text-xs font-bold text-slate-500 mb-2"><i class="fa-solid fa-chart-line ml-1"></i> دوران المبيعات الشهري (آخر 12 شهر)</h4>
                    <div class="overflow-x-auto rounded-xl border border-slate-200">
                        <table class="w-full plc-table">
                            <thead><tr><th>الشهر</th><th>الكمية</th><th>الإيراد (ر.س)</th></tr></thead>
                            <tbody>${monthlyRows || `<tr><td colspan="3" class="py-8 text-center text-slate-400">لا توجد مبيعات في الفترة</td></tr>`}</tbody>
                        </table>
                    </div>
                </div>
                <div>
                    <h4 class="text-xs font-bold text-slate-500 mb-2"><i class="fa-solid fa-users ml-1"></i> أفضل العملاء</h4>
                    <div class="overflow-x-auto rounded-xl border border-slate-200">
                        <table class="w-full plc-table">
                            <thead><tr><th>العميل</th><th>الكمية</th><th>الإيراد (ر.س)</th></tr></thead>
                            <tbody>${clientsRows || `<tr><td colspan="3" class="py-8 text-center text-slate-400">لا يوجد عملاء</td></tr>`}</tbody>
                        </table>
                    </div>
                </div>
            </div>

            <h4 class="text-xs font-bold text-slate-500 mb-2"><i class="fa-solid fa-cubes ml-1"></i> المبيعات حسب المقاس</h4>
            <div class="overflow-x-auto rounded-xl border border-slate-200 mb-5">
                <table class="w-full plc-table">
                    <thead><tr>
                        <th>المقاس</th><th>الكمية المباعة</th><th>الإيراد</th><th>الطلبات</th>
                        <th>متوسط السعر</th><th>أدنى سعر</th><th>أعلى سعر</th>
                    </tr></thead>
                    <tbody>${variantRows || `<tr><td colspan="7" class="py-8 text-center text-slate-400">لا توجد مبيعات</td></tr>`}</tbody>
                </table>
            </div>

            <h4 class="text-xs font-bold text-slate-500 mb-2"><i class="fa-solid fa-file-invoice ml-1"></i> آخر بنود الطلبات</h4>
            <div class="overflow-x-auto rounded-xl border border-slate-200">
                <table class="w-full plc-table">
                    <thead><tr>
                        <th>التاريخ</th><th>رقم الطلب</th><th>العميل</th><th>المقاس</th>
                        <th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>الحالة</th>
                    </tr></thead>
                    <tbody>${recentRows || `<tr><td colspan="8" class="py-8 text-center text-slate-400">لا توجد بنود</td></tr>`}</tbody>
                </table>
            </div>`;
    }

    function _plcRenderPurchases(d) {
        const panel = _plcEl('plc-panel-purchases');
        if (!panel) return;
        const suppliers = d.suppliers || [];
        const openMos   = d.open_manufacturer_orders || [];
        const lastCost  = d.last_cost;

        if (!suppliers.length && !openMos.length) { _plcEmpty('purchases', 'لا توجد مشتريات مسجلة لهذا الصنف'); return; }

        const totalOrdered  = suppliers.reduce((a, r) => a + parseFloat(r.total_ordered  || 0), 0);
        const totalReceived = suppliers.reduce((a, r) => a + parseFloat(r.total_received || 0), 0);

        const supplierRows = suppliers.map(s => `<tr>
            <td class="font-semibold">${_plcEsc(s.company_name)}</td>
            <td class="font-mono">${_plcQty(s.total_ordered)}</td>
            <td class="font-mono">${_plcQty(s.total_received)}</td>
            <td class="text-slate-500">${_plcDate(s.last_order_at)}</td>
        </tr>`).join('');

        const moRows = openMos.map(m => `<tr>
            <td class="font-mono">MO-${m.mo_number}</td>
            <td>${_plcEsc(m.company_name)}</td>
            <td class="font-mono">${_plcQty(m.qty)}</td>
            <td class="font-mono">${_plcQty(m.received)}</td>
            <td><span class="text-xs font-semibold text-slate-600">${_plcMoStatus[m.status] || m.status}</span></td>
            <td class="text-slate-500">${_plcDate(m.expected_delivery_date)}</td>
        </tr>`).join('');

        panel.innerHTML = `
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <div class="plc-kpi"><div class="v text-brand-600">${suppliers.length}</div><div class="l">عدد الموردين</div></div>
                <div class="plc-kpi"><div class="v text-slate-700">${_plcQty(totalOrdered)}</div><div class="l">إجمالي المطلوب</div></div>
                <div class="plc-kpi"><div class="v text-emerald-600">${_plcQty(totalReceived)}</div><div class="l">إجمالي المستلم</div></div>
                <div class="plc-kpi"><div class="v text-amber-600">${lastCost ? _plcFmt(lastCost.unit_cost) : '—'}</div><div class="l">آخر سعر توريد ${lastCost ? `<span class="block text-[9px] font-normal text-slate-400">${_plcDate(lastCost.created_at)}</span>` : ''}</div></div>
            </div>

            <h4 class="text-xs font-bold text-slate-500 mb-2"><i class="fa-solid fa-truck ml-1"></i> الموردون</h4>
            <div class="overflow-x-auto rounded-xl border border-slate-200 mb-5">
                <table class="w-full plc-table">
                    <thead><tr><th>المورد</th><th>إجمالي المطلوب</th><th>إجمالي المستلم</th><th>آخر طلب</th></tr></thead>
                    <tbody>${supplierRows || `<tr><td colspan="4" class="py-8 text-center text-slate-400">لا يوجد موردون</td></tr>`}</tbody>
                </table>
            </div>

            <h4 class="text-xs font-bold text-slate-500 mb-2"><i class="fa-solid fa-industry ml-1"></i> أوامر التشغيل المفتوحة</h4>
            <div class="overflow-x-auto rounded-xl border border-slate-200">
                <table class="w-full plc-table">
                    <thead><tr><th>رقم الأمر</th><th>المورد</th><th>الكمية المطلوبة</th><th>المستلم</th><th>الحالة</th><th>التسليم المتوقع</th></tr></thead>
                    <tbody>${moRows || `<tr><td colspan="6" class="py-8 text-center text-slate-400">لا توجد أوامر تشغيل مفتوحة</td></tr>`}</tbody>
                </table>
            </div>`;
    }

    function _plcRenderPrices(d) {
        const panel = _plcEl('plc-panel-prices');
        if (!panel) return;
        const rows = d.prices || [];

        if (!rows.length) { _plcEmpty('prices', 'لا توجد مقاسات/أسعار لهذا الصنف'); return; }

        const body = rows.map(r => {
            const sell     = parseFloat(r.selling_price) || 0;
            const declared = parseFloat(r.cost_price)    || 0;
            // Effective cost: declared cost_price, falling back to actual purchase
            // costs recorded on purchase invoices / manufacturer orders / vouchers.
            const effCost  = declared > 0
                ? declared
                : (parseFloat(r.last_purchase_cost) || parseFloat(r.avg_purchase_cost) || 0);
            const margin = sell > 0 && effCost > 0
                ? (((sell - effCost) / effCost) * 100).toFixed(1)
                : null;
            const marginBadge = margin === null ? '—'
                : `<span class="text-xs font-bold ${parseFloat(margin) >= 0 ? 'text-emerald-600' : 'text-red-600'}">${margin}%</span>`;
            const purchaseCost = r.last_purchase_cost || r.avg_purchase_cost;
            return `<tr>
                <td class="font-semibold">${_plcEsc(r.size_name)}</td>
                <td class="font-mono">${_plcEsc(r.sku) || '—'}</td>
                <td>${_plcEsc(r.unit_name || '—')}</td>
                <td class="font-mono">${_plcFmt(r.cost_price)}</td>
                <td class="font-mono">${_plcFmt(purchaseCost)}</td>
                <td class="font-mono font-bold">${_plcFmt(r.selling_price)}</td>
                <td>${marginBadge}</td>
                <td class="font-mono">${_plcFmt(r.avg_price)}</td>
                <td class="font-mono">${_plcFmt(r.min_price)}</td>
                <td class="font-mono">${_plcFmt(r.max_price)}</td>
                <td>${_plcStatusBadge(r.status)}</td>
            </tr>`;
        }).join('');

        panel.innerHTML = `
            <div class="overflow-x-auto rounded-xl border border-slate-200">
                <table class="w-full plc-table">
                    <thead><tr>
                        <th>المقاس</th><th>SKU</th><th>الوحدة</th>
                        <th>سعر التكلفة المسجل</th><th>تكلفة الشراء الفعلية</th>
                        <th>سعر البيع</th><th>هامش الربح</th>
                        <th>متوسط سعر البيع</th><th>أدنى سعر</th><th>أعلى سعر</th><th>الحالة</th>
                    </tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
            <p class="text-xs text-slate-400 mt-3">
                <i class="fa-solid fa-circle-info ml-1"></i>
                متوسط/أدنى/أعلى سعر البيع محسوبة من بنود الطلبات المؤكدة. «تكلفة الشراء الفعلية» محسوبة من أوامر المصنع وفواتير المشتريات وسندات الاستلام، وتُستخدم أساسًا لهامش الربح عند غياب سعر التكلفة المسجل. لتعديل الأسعار استخدم «إدارة المقاسات» من تبويب المقاسات.
            </p>`;
    }

    // ── Movements tab → jump to the full product-movements page ───────────────
    window.plcGoToMovements = function () {
        if (!_plcProductId) return;
        const name = _plcProduct ? _plcProduct.name : '';
        window.closeProductLifecycle();
        window.openProductMovements(_plcProductId, name);
    };

    // ── Edit button inside lifecycle modal → reuse existing product modal ─────
    window.plcEditProduct = function () {
        if (!_plcProductId) return;
        const id = _plcProductId;
        window.closeProductLifecycle();
        window.openProductModal(id);
    };

    // ── Auto-execute ──────────────────────────────────────────────────────────
    initProductsView();

})();
