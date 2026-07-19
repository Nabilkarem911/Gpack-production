'use strict';

// =============================================================================
// G.PACK 2.0 - Quotations View Controller (quotations.js)
// Handles: list, create, edit quote orders (status = 'quote').
// Financial rule: VAT = 15%. Totals calculated client-side for display only.
// Server always recalculates totals — never trust client totals.
// =============================================================================

(function () {

    // ── Private State ─────────────────────────────────────────────────────────
    const VAT_RATE     = 0.15;
    let _allQuotes     = [];    // master list (all statuses)
    let _activeTab     = 'active'; // 'active' or 'archived'
    let _clients       = [];    // loaded once from /api/clients
    let _products      = [];    // loaded once from /api/products?include_variants=true
    let _categories    = [];    // loaded once from /api/categories
    let _units         = [];    // loaded once from /api/units
    let _editingId     = null;  // null = add mode, UUID = edit mode
    let _convertingId  = null;  // order id currently in convert modal
    let _rowCounter    = 0;     // unique key for each dynamic item row
    let _standardTerms = [];    // loaded once from /api/terms
    let _viewingOrderId = null;  // tracks order ID when in view-only mode (for clone/back)

    const DESIGN_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'bmp', 'tif', 'tiff']);
    const DESIGN_PDF_EXTENSIONS   = new Set(['pdf']);
    const DESIGN_VECTOR_EXTENSIONS = new Set(['ai', 'eps', 'ps', 'psd']);
    const DESIGN_PREVIEW_VARIANTS = {
        card: {
            imageClass: 'w-full h-full object-cover transition-transform duration-300 group-hover:scale-105',
            pdfClass: 'w-full h-full border-0 pointer-events-none rounded-lg bg-white',
            fallbackClass: 'w-full h-full flex flex-col items-center justify-center bg-slate-100 text-slate-500 text-xs font-bold gap-0.5 text-center px-2'
        },
        chip: {
            imageClass: 'w-8 h-8 rounded border border-slate-200 object-cover',
            pdfClass: 'w-8 h-8 border border-slate-200 rounded bg-white pointer-events-none',
            fallbackClass: 'w-8 h-8 rounded border border-slate-200 flex flex-col items-center justify-center bg-white text-[9px] font-bold text-slate-500 leading-tight text-center px-1'
        },
        modal: {
            imageClass: 'max-w-full max-h-[85vh] object-contain',
            pdfClass: 'w-full h-[85vh] border-0 bg-white',
            fallbackClass: 'w-full h-[85vh] flex flex-col items-center justify-center bg-slate-900 text-white text-lg font-bold gap-2 text-center px-6'
        }
    };
    const DESIGN_PLACEHOLDER_SVG = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"%3E%3Crect fill="%23e2e8f0" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%2394a3b8" font-size="14" font-family="sans-serif"%3Eلا يوجد تصميم%3C/text%3E%3C/svg%3E';

    function _getFileExtension(url) {
        if (!url) return '';
        const clean = url.split('?')[0].split('#')[0];
        const idx = clean.lastIndexOf('.');
        return idx === -1 ? '' : clean.substring(idx + 1).toLowerCase();
    }

    function _escapeHtml(str) {
        return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _escapeAttr(str) {
        return _escapeHtml(str);
    }

    function _buildDesignPreviewHTML(url, name, options = {}) {
        const variant = DESIGN_PREVIEW_VARIANTS[options.variant || 'card'] || DESIGN_PREVIEW_VARIANTS.card;
        const safeName = _escapeHtml(name || 'تصميم');
        const ext = (options.extensionOverride || _getFileExtension(url) || '').toLowerCase();
        if (!url) {
            return `<div class="${variant.fallbackClass}"><span>لا يوجد تصميم</span></div>`;
        }

        const safeUrl = _escapeAttr(url);
        if (DESIGN_IMAGE_EXTENSIONS.has(ext)) {
            return `<img src="${safeUrl}" alt="${safeName}" class="${variant.imageClass}" onerror="this.onerror=null; this.src='${DESIGN_PLACEHOLDER_SVG}'">`;
        }

        if (DESIGN_PDF_EXTENSIONS.has(ext)) {
            return `<object data="${safeUrl}#toolbar=0&navpanes=0" type="application/pdf" class="${variant.pdfClass}" aria-label="${safeName}">`
                + `<div class="${variant.fallbackClass}"><span>${ext.toUpperCase()}</span><span class="text-[9px] font-normal">${safeName}</span></div>`
                + `</object>`;
        }

        const label = ext ? ext.toUpperCase() : 'FILE';
        return `<div class="${variant.fallbackClass}"><span>${label}</span><span class="text-[9px] font-normal">${safeName}</span></div>`;
    }

    // ==========================================================================
    // _makeSearchable(selectEl, placeholder)
    // Wraps a native <select> with a filterable text-input + dropdown list.
    // Returns a refresh() function to call when options change.
    // ==========================================================================
    function _makeSearchable(selectEl, placeholder) {
        if (!selectEl || selectEl.dataset.searchable) return null;
        selectEl.dataset.searchable = '1';

        const parent = selectEl.parentElement;
        const wrap = document.createElement('div');
        wrap.className = 'searchable-wrap relative w-full';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder || '— بحث —';
        input.autocomplete = 'off';
        input.className = selectEl.className
            .replace('appearance-none', '')
            .replace(/\brow-product\b/g, '')
            .replace(/\brow-variant\b/g, '')
            .trim() + ' cursor-text';

        const dd = document.createElement('div');
        dd.className = 'searchable-dd absolute z-[100] left-0 right-0 top-full mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg hidden';
        dd.style.direction = 'rtl';

        selectEl.style.display = 'none';
        parent.insertBefore(wrap, selectEl);
        wrap.appendChild(input);
        wrap.appendChild(dd);
        wrap.appendChild(selectEl);

        let _picking = false; // prevents blur from closing dropdown during selection

        function _selectOption(value, label) {
            _picking = true;
            selectEl.value = value;
            input.value = label;
            dd.classList.add('hidden');
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            setTimeout(() => { _picking = false; }, 0);
        }

        function buildList(filter) {
            dd.innerHTML = '';
            const q = (filter || '').trim().toLowerCase();
            const opts = Array.from(selectEl.options);
            let hasMatch = false;
            opts.forEach(opt => {
                if (!opt.value && !q) {
                    const div = document.createElement('div');
                    div.textContent = opt.textContent;
                    div.className = 'px-3 py-2 text-sm text-slate-400 cursor-pointer hover:bg-slate-50';
                    div.addEventListener('mousedown', (e) => { e.preventDefault(); });
                    div.addEventListener('click', () => _selectOption('', ''));
                    dd.appendChild(div);
                    hasMatch = true;
                    return;
                }
                if (!opt.value) return;
                const text = opt.textContent;
                if (q && !text.toLowerCase().includes(q)) return;
                hasMatch = true;
                const div = document.createElement('div');
                div.textContent = text;
                div.className = 'px-3 py-2 text-sm text-slate-800 cursor-pointer hover:bg-brand-50 hover:text-brand-700 transition-colors';
                if (opt.value === selectEl.value) {
                    div.classList.add('bg-brand-50', 'font-bold', 'text-brand-700');
                }
                div.addEventListener('mousedown', (e) => { e.preventDefault(); });
                div.addEventListener('click', () => _selectOption(opt.value, text));
                dd.appendChild(div);
            });
            if (!hasMatch) {
                const div = document.createElement('div');
                div.textContent = 'لا توجد نتائج';
                div.className = 'px-3 py-2 text-sm text-slate-400 text-center';
                dd.appendChild(div);
            }
        }

        function syncDisplay() {
            const opt = selectEl.options[selectEl.selectedIndex];
            input.value = (opt && opt.value) ? opt.textContent : '';
        }

        input.addEventListener('focus', () => {
            input.select();
            buildList('');
            dd.classList.remove('hidden');
        });
        input.addEventListener('input', () => {
            buildList(input.value);
            dd.classList.remove('hidden');
        });
        input.addEventListener('blur', () => {
            setTimeout(() => {
                if (!_picking) {
                    dd.classList.add('hidden');
                    syncDisplay();
                }
            }, 200);
        });

        syncDisplay();

        const obs = new MutationObserver(() => {
            setTimeout(syncDisplay, 0);
        });
        obs.observe(selectEl, { childList: true, subtree: true });

        return {
            refresh: () => syncDisplay(),
            input: input,
        };
    }

    // ==========================================================================
    // _fmt(n) — format number to 2 decimal places with Arabic SAR suffix
    // ==========================================================================
    function _fmt(n) {
        return _fmtNum(n);
    }

    function _fmtNum(n) {
        const v = Number(n || 0);
        return v % 1 === 0 ? v.toFixed(0) : v.toFixed(2);
    }

    // ==========================================================================
    // _today() / _futureDate(days)
    // ==========================================================================
    function _today() {
        return new Date().toISOString().split('T')[0];
    }

    function _futureDate(days) {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return d.toISOString().split('T')[0];
    }

    // ==========================================================================
    // _showFormError / _clearFormError
    // ==========================================================================
    function _showFormError(msg) {
        const box  = document.getElementById('quote-form-error');
        const span = box ? box.querySelector('span') : null;
        if (!box) return;
        if (span) span.textContent = msg;
        else      box.textContent  = msg;
        box.classList.remove('hidden');
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function _clearFormError() {
        const box  = document.getElementById('quote-form-error');
        const span = box ? box.querySelector('span') : null;
        if (!box) return;
        if (span) span.textContent = '';
        box.classList.add('hidden');
    }

    // ==========================================================================
    // _openModal / _closeModal — CSS opacity+scale transitions
    // ==========================================================================
    function _openModal() {
        const modal = document.getElementById('quote-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('opacity-100');
            modal.querySelector('.modal-panel').classList.add('scale-100');
        });
    }

    function _closeModal() {
        const modal = document.getElementById('quote-modal');
        if (!modal) return;
        modal.classList.remove('opacity-100');
        modal.querySelector('.modal-panel').classList.remove('scale-100');
        setTimeout(() => {
            modal.style.display = 'none';
            _editingId = null;
        }, 200);
    }

    // ==========================================================================
    // _statusBadge(status)
    // ==========================================================================
    function _statusBadge(status) {
        const map = {
            quote:      { label: 'عرض سعر',  cls: 'bg-blue-100 text-blue-700'     },
            confirmed:  { label: 'مؤكد',      cls: 'bg-emerald-100 text-emerald-700' },
            production: { label: 'إنتاج',     cls: 'bg-amber-100 text-amber-700'   },
            delivered:  { label: 'مُسلَّم',   cls: 'bg-slate-100 text-slate-600'   },
            cancelled:  { label: 'ملغي',      cls: 'bg-red-100 text-red-600'       },
            archived:   { label: 'مؤرشف',    cls: 'bg-gray-100 text-gray-500'     },
        };
        const s = map[status] || { label: status, cls: 'bg-slate-100 text-slate-500' };
        return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${s.cls}">${s.label}</span>`;
    }

    // ==========================================================================
    // _renderTable(quotes)
    // ==========================================================================
    function _renderTable(quotes) {
        const tbody = document.getElementById('quotes-tbody');
        const empty = document.getElementById('quotes-empty');
        if (!tbody) return;

        if (!quotes || quotes.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        const today = new Date().toISOString().slice(0, 10);

        tbody.innerHTML = quotes.map(q => {
            const dateStr  = q.order_date  ? new Date(q.order_date).toLocaleDateString('en-GB')  : '—';
            const validStr = q.valid_until ? new Date(q.valid_until).toLocaleDateString('en-GB') : '—';
            const total    = q.grand_total ? _fmtNum(q.grand_total) : '—';
            const isExpired = q.valid_until && q.valid_until.slice(0, 10) < today && q.status === 'quote';
            const expiredBadge = isExpired
                ? ' <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-600 mr-1">منتهي</span>'
                : '';

            return `
            <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors ${isExpired ? 'bg-red-50/40' : ''}">
                <td class="py-3.5 px-4">
                    <span class="font-mono font-bold text-slate-700 text-sm">#${q.order_number || '—'}</span>
                </td>
                <td class="py-3.5 px-4 text-sm font-semibold text-slate-800">${q.client_name || '—'}</td>
                <td class="py-3.5 px-4 text-sm text-slate-500 hidden sm:table-cell">${dateStr}</td>
                <td class="py-3.5 px-4 text-sm hidden md:table-cell">
                    <span class="${isExpired ? 'text-red-500 font-semibold' : 'text-slate-500'}">${validStr}</span>${expiredBadge}
                </td>
                <td class="py-3.5 px-4 hidden md:table-cell">
                    <span class="font-bold text-slate-700 font-mono text-sm">${total}</span>
                </td>
                <td class="py-3.5 px-4">
                    ${_statusBadge(q.status)}
                    ${q.pricing_status === 'pending' ? '<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-600 mr-1"><i class="fa-solid fa-circle-exclamation"></i> في انتظار التسعير</span>' : ''}
                    ${q.pricing_status === 'priced' ? '<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 mr-1"><i class="fa-solid fa-check"></i> تم التسعير</span>' : ''}
                    ${q.client_response === 'approved' ? '<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 mr-1"><i class="fa-solid fa-circle-check"></i> وافق</span>' : ''}
                    ${q.client_response === 'rejected' ? '<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-600 mr-1"><i class="fa-solid fa-circle-xmark"></i> رفض</span>' : ''}
                    ${q.share_token && !q.client_response ? '<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-600 mr-1"><i class="fa-solid fa-share-nodes"></i> مُرسَل</span>' : ''}
                </td>
                <td class="py-3.5 px-4">
                    <div class="flex items-center justify-end gap-1">
                        ${q.status === 'quote' ? `
                        <button onclick="window.openConvertModal('${q.id}')" title="تحويل لإنتاج"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-amber-600 hover:bg-amber-50 transition-colors">
                            <i class="fa-solid fa-industry text-xs"></i>
                        </button>
                        <button onclick="window.openQuoteModal('${q.id}')" title="تعديل"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-brand-600 hover:bg-brand-50 transition-colors">
                            <i class="fa-solid fa-pen-to-square text-sm"></i>
                        </button>
                        <button onclick="window.cloneOrderToQuote('${q.id}')" title="نسخ العرض"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-cyan-600 hover:bg-cyan-50 transition-colors">
                            <i class="fa-solid fa-copy text-xs"></i>
                        </button>
                        <button onclick="window.shareQuote('${q.id}')" title="مشاركة مع العميل"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                            <i class="fa-solid fa-share-nodes text-xs"></i>
                        </button>
                        <button onclick="window.archiveQuote('${q.id}')" title="أرشفة"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-gray-600 hover:bg-gray-100 transition-colors">
                            <i class="fa-solid fa-box-archive text-xs"></i>
                        </button>` : ''}
                        ${q.status === 'archived' ? `
                        <button onclick="window.restoreQuote('${q.id}')" title="استرجاع"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                            <i class="fa-solid fa-rotate-left text-xs"></i>
                        </button>
                        <button onclick="window.deleteQuote('${q.id}')" title="حذف نهائي"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-red-600 hover:bg-red-50 transition-colors">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>` : ''}
                        <button onclick="window.printQuote('${q.id}')" title="طباعة"
                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                                       hover:text-slate-700 hover:bg-slate-100 transition-colors">
                            <i class="fa-solid fa-print text-sm"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    // ==========================================================================
    // _loadClients() — populates #quote-client select
    // ==========================================================================
    async function _loadClients() {
        try {
            const res = await window.apiFetch('/api/clients');
            _clients  = (res && res.data) ? res.data.filter(c => c.status === 'active') : [];
        } catch (_) {
            _clients = [];
        }
        _populateClientSelect();
    }

    let _clientSearchable = null;
    function _populateClientSelect(selectedId = null) {
        const sel = document.getElementById('quote-client');
        if (!sel) return;
        sel.innerHTML = '<option value="">— اختر العميل —</option>';
        _clients.forEach(c => {
            const opt       = document.createElement('option');
            opt.value       = c.id;
            opt.textContent = c.name;
            sel.appendChild(opt);
        });
        if (selectedId) sel.value = selectedId;
        if (!_clientSearchable) {
            _clientSearchable = _makeSearchable(sel, '🔍 ابحث عن العميل...');
        }
        if (_clientSearchable) _clientSearchable.refresh();
    }

    // ==========================================================================
    // _loadProducts() — loads products with variants for item rows
    // ==========================================================================
    async function _loadProducts() {
        try {
            const res = await window.apiFetch('/api/products?include_variants=true&status=active');
            _products = (res && res.data) ? res.data : [];
        } catch (_) {
            _products = [];
        }
    }

    // ==========================================================================
    // _loadCategories() — loads categories for item row filter
    // ==========================================================================
    async function _loadCategories() {
        try {
            const res = await window.apiFetch('/api/categories');
            _categories = (res && res.data) ? res.data : [];
        } catch (_) {
            _categories = [];
        }
    }

    // ==========================================================================
    // _loadUnits() — loads measurement units for quick size modal
    // ==========================================================================
    async function _loadUnits() {
        try {
            const res = await window.apiFetch('/api/units');
            _units = (res && res.data) ? res.data : [];
        } catch (_) {
            _units = [];
        }
    }

    // ==========================================================================
    // _buildUnitOptions() — Returns <option> HTML for unit dropdown
    // ==========================================================================
    function _buildUnitOptions() {
        return '<option value="">— بدون وحدة —</option>' +
            _units.map(u =>
                `<option value="${u.id}">${u.name}${u.abbreviation ? ' (' + u.abbreviation + ')' : ''}</option>`
            ).join('');
    }

    // ==========================================================================
    // _populateQuickModalDropdowns() — fills category & unit selects in modals
    // ==========================================================================
    function _populateQuickModalDropdowns() {
        const catSelect = document.getElementById('qp-category');
        if (catSelect) {
            catSelect.innerHTML = '<option value="">— بدون تصنيف —</option>' +
                _categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }
        const qpUnitSelect = document.getElementById('qp-unit');
        if (qpUnitSelect) {
            qpUnitSelect.innerHTML = _buildUnitOptions();
        }
    }

    // ==========================================================================
    // ── INLINE QUICK ADD: Category ───────────────────────────────────────────
    // ==========================================================================
    window._quickAddCategoryInline = function () {
        const inline = document.getElementById('qp-category-inline');
        if (inline) {
            inline.classList.remove('hidden');
            const nameInput = document.getElementById('qp-category-name');
            if (nameInput) nameInput.focus();
        }
    };

    window._cancelQuickCategoryInline = function () {
        const inline = document.getElementById('qp-category-inline');
        if (inline) inline.classList.add('hidden');
        const nameInput = document.getElementById('qp-category-name');
        if (nameInput) nameInput.value = '';
    };

    window._saveQuickCategoryInline = async function () {
        const nameInput = document.getElementById('qp-category-name');
        const nameVal = (nameInput?.value || '').trim();
        if (!nameVal) {
            window.showToast('اسم التصنيف مطلوب.', 'warning');
            return;
        }
        try {
            const res = await window.apiFetch('/api/categories', {
                method: 'POST',
                body: { name: nameVal },
            });
            if (res && res.data) {
                await _loadCategories();
                _populateQuickModalDropdowns();
                const catSelect = document.getElementById('qp-category');
                if (catSelect) catSelect.value = res.data.id;
                window._cancelQuickCategoryInline();
                window.showToast(`تم إضافة التصنيف "${res.data.name}" بنجاح.`, 'success');
            }
        } catch (err) {
            window.showToast(err.message || 'فشل إضافة التصنيف.', 'error');
        }
    };

    // ==========================================================================
    // ── INLINE QUICK ADD: Unit (in Product Modal) ────────────────────────────
    // ==========================================================================
    window._quickAddProductUnitInline = function () {
        const inline = document.getElementById('qp-unit-inline');
        if (inline) {
            inline.classList.remove('hidden');
            const nameInput = document.getElementById('qp-unit-name');
            if (nameInput) nameInput.focus();
        }
    };

    window._cancelQuickProductUnitInline = function () {
        const inline = document.getElementById('qp-unit-inline');
        if (inline) inline.classList.add('hidden');
        const nameInput = document.getElementById('qp-unit-name');
        const abbrInput = document.getElementById('qp-unit-abbr');
        if (nameInput) nameInput.value = '';
        if (abbrInput) abbrInput.value = '';
    };

    window._saveQuickProductUnitInline = async function () {
        const nameInput = document.getElementById('qp-unit-name');
        const abbrInput = document.getElementById('qp-unit-abbr');
        const nameVal = (nameInput?.value || '').trim();
        const abbrVal = (abbrInput?.value || '').trim();
        if (!nameVal) {
            window.showToast('اسم الوحدة مطلوب.', 'warning');
            return;
        }
        try {
            const res = await window.apiFetch('/api/units', {
                method: 'POST',
                body: { name: nameVal, abbreviation: abbrVal || null },
            });
            if (res && res.data) {
                await _loadUnits();
                _populateQuickModalDropdowns();
                const unitSelect = document.getElementById('qp-unit');
                if (unitSelect) unitSelect.value = res.data.id;
                window._cancelQuickProductUnitInline();
                window.showToast(`تم إضافة الوحدة "${res.data.name}" بنجاح.`, 'success');
            }
        } catch (err) {
            window.showToast(err.message || 'فشل إضافة الوحدة.', 'error');
        }
    };

    // ==========================================================================
    // _buildCategoryOptions() — Returns <option> HTML for category dropdown
    // ==========================================================================
    function _buildCategoryOptions() {
        return '<option value="">— كل التصنيفات —</option>' +
            _categories.map(c =>
                `<option value="${c.id}">${c.name}</option>`
            ).join('');
    }

    // ==========================================================================
    // loadQuotes() — fetches quote + archived orders, filters by active tab
    // ==========================================================================
    async function loadQuotes() {
        const tbody = document.getElementById('quotes-tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-slate-400">
                <i class="fa-solid fa-circle-notch fa-spin text-2xl"></i></td></tr>`;
        }
        try {
            const [resQuote, resArchived] = await Promise.all([
                window.apiFetch('/api/orders?status=quote'),
                window.apiFetch('/api/orders?status=archived'),
            ]);
            const activeList   = (resQuote && resQuote.data) ? resQuote.data : [];
            const archivedList = (resArchived && resArchived.data) ? resArchived.data : [];
            _allQuotes = [...activeList, ...archivedList];
            _populateClientFilter();
            _updateTabCounts();
            _renderFilteredTable();
        } catch (err) {
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-red-400 text-sm">
                    <i class="fa-solid fa-circle-exclamation ml-1"></i>
                    فشل تحميل عروض الأسعار: ${err.message}</td></tr>`;
            }
        }
    }

    // ==========================================================================
    // _getFilteredByTab() — returns quotes filtered by current tab + all filters
    // ==========================================================================
    function _getFilteredByTab() {
        const isArchived = _activeTab === 'archived';
        let list = _allQuotes.filter(q => isArchived ? q.status === 'archived' : q.status !== 'archived');

        const searchInput = document.getElementById('quotes-search');
        const searchQ = searchInput ? searchInput.value.toLowerCase() : '';
        if (searchQ) {
            list = list.filter(r =>
                (r.client_name && r.client_name.toLowerCase().includes(searchQ)) ||
                (r.order_number && String(r.order_number).includes(searchQ))
            );
        }

        const clientFilter = document.getElementById('quotes-client-filter');
        if (clientFilter && clientFilter.value) {
            list = list.filter(r => r.client_id === clientFilter.value);
        }

        const dateFrom = document.getElementById('quotes-date-from');
        if (dateFrom && dateFrom.value) {
            list = list.filter(r => r.order_date && r.order_date.slice(0, 10) >= dateFrom.value);
        }

        const dateTo = document.getElementById('quotes-date-to');
        if (dateTo && dateTo.value) {
            list = list.filter(r => r.order_date && r.order_date.slice(0, 10) <= dateTo.value);
        }

        return list;
    }

    function _renderFilteredTable() {
        _renderTable(_getFilteredByTab());
    }

    window.applyQuoteFilters = function () {
        _renderFilteredTable();
    };

    // ==========================================================================
    // _updateTabCounts() — update badge counts on tabs + stats cards
    // ==========================================================================
    function _updateTabCounts() {
        const activeList    = _allQuotes.filter(q => q.status !== 'archived');
        const archivedList  = _allQuotes.filter(q => q.status === 'archived');
        const today         = new Date().toISOString().slice(0, 10);
        const expiredList   = activeList.filter(q => q.valid_until && q.valid_until.slice(0, 10) < today);

        const elActive   = document.getElementById('tab-active-count');
        const elArchived = document.getElementById('tab-archived-count');
        if (elActive)   elActive.textContent   = activeList.length;
        if (elArchived) elArchived.textContent = archivedList.length;

        const statActive   = document.getElementById('stat-active');
        const statTotal    = document.getElementById('stat-total');
        const statExpired  = document.getElementById('stat-expired');
        const statArchived = document.getElementById('stat-archived');

        if (statActive)   statActive.textContent   = activeList.length;
        if (statArchived) statArchived.textContent = archivedList.length;
        if (statExpired)  statExpired.textContent  = expiredList.length;
        if (statTotal) {
            const sum = activeList.reduce((s, q) => s + Number(q.grand_total || 0), 0);
            statTotal.textContent = _fmtNum(sum);
        }
    }

    // ==========================================================================
    // _populateClientFilter() — fills client filter dropdown from loaded quotes
    // ==========================================================================
    function _populateClientFilter() {
        const sel = document.getElementById('quotes-client-filter');
        if (!sel) return;
        const currentVal = sel.value;
        sel.innerHTML = '<option value="">كل العملاء</option>';
        const seen = new Set();
        _allQuotes.forEach(q => {
            if (q.client_id && !seen.has(q.client_id)) {
                seen.add(q.client_id);
                const opt = document.createElement('option');
                opt.value = q.client_id;
                opt.textContent = q.client_name || q.client_id;
                sel.appendChild(opt);
            }
        });
        if (currentVal) sel.value = currentVal;
    }

    // ==========================================================================
    // switchQuoteTab(tab) — switches between active/archived view
    // ==========================================================================
    function switchQuoteTab(tab) {
        _activeTab = tab;
        const btnActive   = document.getElementById('tab-active');
        const btnArchived = document.getElementById('tab-archived');
        if (tab === 'active') {
            if (btnActive)   { btnActive.className   = 'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all bg-brand-600 text-white shadow-sm'; }
            if (btnArchived) { btnArchived.className = 'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all bg-slate-100 text-slate-500 hover:bg-slate-200'; }
        } else {
            if (btnActive)   { btnActive.className   = 'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all bg-slate-100 text-slate-500 hover:bg-slate-200'; }
            if (btnArchived) { btnArchived.className = 'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all bg-brand-600 text-white shadow-sm'; }
        }
        _renderFilteredTable();
    }
    window.switchQuoteTab = switchQuoteTab;

    // ==========================================================================
    // archiveQuote(id) / restoreQuote(id)
    // ==========================================================================
    async function archiveQuote(id) {
        if (!confirm('هل تريد أرشفة هذا العرض؟')) return;
        try {
            await window.apiFetch(`/api/orders/${id}/status`, {
                method: 'PATCH',
                body: { status: 'archived' },
            });
            await loadQuotes();
        } catch (err) {
            alert('فشل الأرشفة: ' + err.message);
        }
    }
    window.archiveQuote = archiveQuote;

    async function restoreQuote(id) {
        if (!confirm('هل تريد استرجاع هذا العرض؟')) return;
        try {
            await window.apiFetch(`/api/orders/${id}/status`, {
                method: 'PATCH',
                body: { status: 'quote' },
            });
            await loadQuotes();
        } catch (err) {
            alert('فشل الاسترجاع: ' + err.message);
        }
    }
    window.restoreQuote = restoreQuote;

    async function deleteQuote(id) {
        if (!confirm('هل تريد حذف هذا العرض نهائياً؟ لا يمكن التراجع عن هذا الإجراء.')) return;
        if (!confirm('تأكيد الحذف النهائي — هل أنت متأكد؟')) return;
        try {
            await window.apiFetch(`/api/orders/${id}`, { method: 'DELETE' });
            await loadQuotes();
            if (window.showToast) window.showToast('تم حذف العرض نهائياً.', 'success');
        } catch (err) {
            alert('فشل الحذف: ' + err.message);
        }
    }
    window.deleteQuote = deleteQuote;

    // ==========================================================================
    // _initSearch()
    // ==========================================================================
    function _initSearch() {
        const input = document.getElementById('quotes-search');
        if (!input) return;
        input.addEventListener('input', () => {
            _renderFilteredTable();
        });
    }

    // ==========================================================================
    // _loadTerms() — loads standard terms for checkbox rendering
    // ==========================================================================
    async function _loadTerms() {
        try {
            const res = await window.apiFetch('/api/terms?active=true');
            _standardTerms = (res && res.data) ? res.data : [];
        } catch (_) {
            _standardTerms = [];
        }
    }

    // ==========================================================================
    // _renderTermsCheckboxes(checkedIds, isEditable)
    // Renders checkboxes inside #terms-container from _standardTerms.
    // checkedIds: array of term IDs that should be pre-checked (edit mode).
    // isEditable: if true, shows input fields to edit term text
    // ==========================================================================
    let _termsEditable = false;

    function _renderTermsCheckboxes(checkedIds = [], isEditable = false) {
        const container = document.getElementById('terms-container');
        if (!container) return;

        _termsEditable = isEditable;

        if (_standardTerms.length === 0) {
            container.innerHTML = '<p class="text-xs text-slate-400">\u0644\u0627 \u062a\u0648\u062c\u062f \u0634\u0631\u0648\u0637 \u0645\u0639\u0631\u0641\u0629 \u062d\u0627\u0644\u064a\u0627\u064b.</p>';
            return;
        }

        const checkedSet = new Set(checkedIds);

        if (isEditable) {
            // Edit mode: show inputs for title and content
            container.innerHTML = _standardTerms.map((term, idx) => {
                const isChecked = term.is_default || checkedSet.has(term.id) ? 'checked' : '';
                return `
                <div class="term-edit-item p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div class="flex items-start gap-2.5 mb-2">
                        <input type="checkbox" class="term-checkbox mt-1 w-4 h-4 rounded border-slate-300
                               text-brand-600 focus:ring-brand-500/30 transition-colors"
                               value="${term.id}" data-title="${term.title}" ${isChecked} />
                        <input type="text" class="term-edit-title flex-1 px-2 py-1 text-sm font-semibold text-slate-700
                               bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-500"
                               value="${term.title}" data-idx="${idx}" placeholder="عنوان الشرط" />
                    </div>
                    <textarea class="term-edit-content w-full px-2 py-1 text-xs text-slate-600
                           bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                           rows="2" data-idx="${idx}" placeholder="نص الشرط">${term.content}</textarea>
                </div>`;
            }).join('');
        } else {
            // View mode: normal checkboxes
            container.innerHTML = _standardTerms.map(term => {
                const isChecked = term.is_default || checkedSet.has(term.id) ? 'checked' : '';
                return `
                <label class="flex items-start gap-2.5 cursor-pointer group">
                    <input type="checkbox" class="term-checkbox mt-0.5 w-4 h-4 rounded border-slate-300
                           text-brand-600 focus:ring-brand-500/30 transition-colors"
                           value="${term.id}" data-title="${term.title}" ${isChecked} />
                    <div class="min-w-0">
                        <span class="text-sm font-semibold text-slate-700 group-hover:text-brand-600 transition-colors">${term.title}</span>
                        <p class="text-xs text-slate-400 mt-0.5 leading-relaxed">${term.content}</p>
                    </div>
                </label>`;
            }).join('');
        }
    }

    // ==========================================================================
    // window.toggleTermsEdit()
    // Toggle between view and edit mode for terms
    // ==========================================================================
    window.toggleTermsEdit = function() {
        const container = document.getElementById('terms-container');
        if (!container) return;

        const isCurrentlyEditable = _termsEditable;

        // Get current checked state before re-rendering
        const checkedIds = [];
        container.querySelectorAll('.term-checkbox:checked').forEach(cb => {
            checkedIds.push(cb.value);
        });

        if (isCurrentlyEditable) {
            // Save edits to _standardTerms (for this session only)
            container.querySelectorAll('.term-edit-title').forEach(input => {
                const idx = parseInt(input.dataset.idx);
                if (_standardTerms[idx]) {
                    _standardTerms[idx].title = input.value;
                }
            });
            container.querySelectorAll('.term-edit-content').forEach(textarea => {
                const idx = parseInt(textarea.dataset.idx);
                if (_standardTerms[idx]) {
                    _standardTerms[idx].content = textarea.value;
                }
            });

            // Switch back to view mode
            _renderTermsCheckboxes(checkedIds, false);

            // Update button text
            const btn = document.getElementById('terms-edit-btn');
            if (btn) btn.innerHTML = '<i class="fa-solid fa-pen mr-1"></i>تعديل الشروط';
        } else {
            // Switch to edit mode
            _renderTermsCheckboxes(checkedIds, true);

            // Update button text
            const btn = document.getElementById('terms-edit-btn');
            if (btn) btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i>حفظ التعديلات';
        }
    };

    // ==========================================================================
    // window.addNewTerm()
    // Add a new custom term to the list
    // ==========================================================================
    window.addNewTerm = function() {
        const container = document.getElementById('terms-container');
        if (!container) return;

        // Ensure we're in edit mode first
        if (!_termsEditable) {
            window.toggleTermsEdit();
        }

        // Get current checked state
        const checkedIds = [];
        container.querySelectorAll('.term-checkbox:checked').forEach(cb => {
            checkedIds.push(cb.value);
        });

        // Save current edits
        container.querySelectorAll('.term-edit-title').forEach(input => {
            const idx = parseInt(input.dataset.idx);
            if (_standardTerms[idx]) {
                _standardTerms[idx].title = input.value;
            }
        });
        container.querySelectorAll('.term-edit-content').forEach(textarea => {
            const idx = parseInt(textarea.dataset.idx);
            if (_standardTerms[idx]) {
                _standardTerms[idx].content = textarea.value;
            }
        });

        // Add new term
        const newId = 'custom_' + Date.now();
        _standardTerms.push({
            id: newId,
            title: 'شرط جديد',
            content: 'اكتب نص الشرط هنا...',
            is_default: true  // Auto-checked
        });

        // Re-render with new term in edit mode and the new term checked
        _renderTermsCheckboxes([...checkedIds, newId], true);
    };

    // ==========================================================================
    // _resetForm()
    // ==========================================================================
    function _resetForm() {
        _clearFormError();
        _rowCounter = 0;

        const clientSel = document.getElementById('quote-client');
        if (clientSel) clientSel.value = '';

        const orderDate = document.getElementById('quote-order-date');
        if (orderDate) orderDate.value = _today();

        const validUntil = document.getElementById('quote-valid-until');
        if (validUntil) validUntil.value = _futureDate(30);

        const notes = document.getElementById('quote-notes');
        if (notes) notes.value = '';

        const internalNotes = document.getElementById('quote-internal-notes');
        if (internalNotes) internalNotes.value = '';

        const downPaymentEl = document.getElementById('quote-down-payment');
        if (downPaymentEl) downPaymentEl.value = '';

        // Clear items container
        const container = document.getElementById('quote-items-container');
        if (container) container.innerHTML = '';

        // Reset terms checkboxes (defaults only)
        _renderTermsCheckboxes([]);

        _updateItemsEmptyState();
        window.calculateOrderTotals();
    }

    // ==========================================================================
    // _updateItemsEmptyState()
    // Shows/hides the empty placeholder based on row count.
    // ==========================================================================
    function _updateItemsEmptyState() {
        const container   = document.getElementById('quote-items-container');
        const emptyEl     = document.getElementById('quote-items-empty');
        const countBadge  = document.getElementById('quote-items-count');
        const rowCount    = container ? container.querySelectorAll('.quote-item-row').length : 0;

        if (emptyEl)    emptyEl.style.display    = rowCount > 0 ? 'none' : '';
        if (countBadge) countBadge.textContent    = `${rowCount} أصناف`;
    }

    // ==========================================================================
    // calculateOrderTotals()
    // Reads all rows and updates the footer subtotal / tax / grand total.
    // Exposed on window so inline oninput handlers can call it.
    // ==========================================================================
    window.calculateOrderTotals = function () {
        const rows     = document.querySelectorAll('.quote-item-row');
        let subtotal   = 0;

        rows.forEach(row => {
            const qtyEl   = row.querySelector('.row-qty');
            const priceEl = row.querySelector('.row-price');
            const totalEl = row.querySelector('.row-total');

            const qty   = parseFloat(qtyEl?.value)   || 0;
            const price = parseFloat(priceEl?.value) || 0;
            const line  = Math.round(qty * price * 100) / 100;

            if (totalEl) totalEl.value = line > 0 ? line.toFixed(2) : '';
            subtotal += line;
        });

        subtotal         = Math.round(subtotal * 100) / 100;
        const tax        = Math.round(subtotal * VAT_RATE * 100) / 100;
        const grandTotal = Math.round((subtotal + tax) * 100) / 100;

        const subEl   = document.getElementById('quote-subtotal');
        const taxEl   = document.getElementById('quote-tax');
        const gtEl    = document.getElementById('quote-grand-total');

        if (subEl)  subEl.textContent  = _fmt(subtotal);
        if (taxEl)  taxEl.textContent  = _fmt(tax);
        if (gtEl)   gtEl.textContent   = _fmt(grandTotal);
    };

    // ==========================================================================
    // _buildProductOptions()
    // Returns <option> HTML for all active products.
    // ==========================================================================
    function _buildProductOptions(categoryId) {
        const filtered = categoryId
            ? _products.filter(p => p.category_id === categoryId)
            : _products;
        return '<option value="">— اختر المنتج —</option>' +
            filtered.map(p =>
                `<option value="${p.id}">${p.name}</option>`
            ).join('');
    }

    // ==========================================================================
    // window.addQuoteItemRow(prefill?)
    // Creates and appends a dynamic item row to #quote-items-container.
    // prefill: { product_id, product_variant_id, quantity, unit_price }
    // ==========================================================================
    window.addQuoteItemRow = function (prefill = {}) {
        const container = document.getElementById('quote-items-container');
        if (!container) return;

        const rowId = ++_rowCounter;

        // Build variant options if product is pre-selected
        let variantOptions = '<option value="">— اختر المقاس —</option>';
        if (prefill.product_id) {
            const prod = _products.find(p => p.id === prefill.product_id);
            if (prod && Array.isArray(prod.variants)) {
                variantOptions += prod.variants
                    .filter(v => v.status === 'active')
                    .map(v => {
                        const label = v.unit_abbreviation
                            ? `${v.size_name} (${v.unit_abbreviation})`
                            : v.size_name;
                        const sel = prefill.product_variant_id === v.id ? 'selected' : '';
                        return `<option value="${v.id}" data-price="${v.selling_price || 0}" ${sel}>${label}</option>`;
                    }).join('');
            }
        }

        const designVal = prefill.design_id || prefill.design_status || 'new';

        const row = document.createElement('div');
        row.className = 'quote-item-row grid grid-cols-[1.4fr_2fr_2fr_1fr_1.2fr_1.2fr_1.2fr_auto] gap-2 items-start bg-white border border-slate-200 rounded-xl px-3 py-2.5';
        row.dataset.rowId = rowId;
        row.dataset.clientId = document.getElementById('quote-client')?.value || '';
        row.dataset.variantId = prefill.product_variant_id || '';
        row.dataset.designId = prefill.design_id || '';

        row.innerHTML = `
            <!-- Category Select -->
            <div class="min-w-0">
                <select class="row-category w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg
                               text-sm text-slate-800 outline-none focus:border-brand-500
                               focus:ring-2 focus:ring-brand-500/20 transition-all appearance-none">
                    ${_buildCategoryOptions()}
                </select>
            </div>

            <!-- Product Select -->
            <div class="min-w-0">
                <select class="row-product w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg
                               text-sm text-slate-800 outline-none focus:border-brand-500
                               focus:ring-2 focus:ring-brand-500/20 transition-all appearance-none">
                    ${_buildProductOptions()}
                </select>
                <div class="quick-add-btn flex items-center gap-1 mt-1">
                    <button type="button" onclick="window.openQuickProductModal(this)" title="إضافة منتج"
                            class="w-5 h-5 flex items-center justify-center rounded bg-brand-50 border border-brand-200
                                   text-brand-600 hover:bg-brand-100 transition-colors text-[10px] font-bold">+</button>
                    <button type="button" onclick="window.openQuickProductEdit(this)" title="تعديل المنتج"
                            class="w-5 h-5 flex items-center justify-center rounded bg-amber-50 border border-amber-200
                                   text-amber-600 hover:bg-amber-100 transition-colors text-[10px]">
                        <i class="fa-solid fa-pen" style="font-size:8px"></i></button>
                </div>
            </div>

            <!-- Variant (Size) Select -->
            <div class="min-w-0">
                <select class="row-variant w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg
                               text-sm text-slate-800 outline-none focus:border-brand-500
                               focus:ring-2 focus:ring-brand-500/20 transition-all appearance-none">
                    ${variantOptions}
                </select>
                <div class="quick-add-btn flex items-center gap-1 mt-1">
                    <button type="button" onclick="window.openQuickSizeModal(this)" title="إضافة مقاس"
                            class="w-5 h-5 flex items-center justify-center rounded bg-emerald-50 border border-emerald-200
                                   text-emerald-600 hover:bg-emerald-100 transition-colors text-[10px] font-bold">+</button>
                    <button type="button" onclick="window.openQuickSizeEdit(this)" title="تعديل المقاس"
                            class="w-5 h-5 flex items-center justify-center rounded bg-amber-50 border border-amber-200
                                   text-amber-600 hover:bg-amber-100 transition-colors text-[10px]">
                        <i class="fa-solid fa-pen" style="font-size:8px"></i></button>
                </div>
            </div>

            <!-- Quantity -->
            <div>
                <input type="number"
                       class="row-qty w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg
                              text-sm text-slate-800 text-center outline-none focus:border-brand-500
                              focus:ring-2 focus:ring-brand-500/20 transition-all"
                       placeholder="1" min="0.001" step="any"
                       value="${prefill.quantity || ''}"
                       oninput="window.calculateOrderTotals()" />
            </div>

            <!-- Unit Price -->
            <div class="relative">
                <input type="number"
                       class="row-price w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg
                              text-sm text-slate-800 text-center outline-none focus:border-brand-500
                              focus:ring-2 focus:ring-brand-500/20 transition-all"
                       placeholder="0.00" min="0" step="0.01"
                       value="${prefill.unit_price || ''}"
                       oninput="window.calculateOrderTotals()" />
                <div class="last-price-hint absolute -bottom-3.5 right-0 left-0 text-center"></div>
            </div>

            <!-- Line Total (readonly) -->
            <div class="relative">
                <input type="number"
                       class="row-total w-full px-2.5 py-2 bg-slate-100 border border-slate-200 rounded-lg
                              text-sm font-bold text-slate-700 text-center outline-none cursor-default"
                       placeholder="0.00" readonly tabindex="-1"
                       value="" />
                <div class="purchase-price-hint absolute -bottom-3.5 right-0 left-0 text-center"></div>
            </div>

            <!-- Design Section -->
            <div class="design-section flex flex-col gap-1.5">
                <!-- Design Selector -->
                <div class="flex gap-1.5">
                    <select class="row-design-select w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg
                                   text-xs text-slate-800 outline-none focus:border-brand-500
                                   focus:ring-2 focus:ring-brand-500/20 transition-all appearance-none">
                        <option value="new">+ تصميم جديد</option>
                        <option value="reprint" ${designVal === 'reprint' ? 'selected' : ''}>↻ إعادة طباعة</option>
                    </select>
                </div>
                <!-- Design Action Buttons -->
                <div class="flex gap-1">
                    <button type="button" onclick="window.openDesignGallery(this)"
                            class="row-design-gallery flex-1 px-2 py-1.5 bg-purple-50 hover:bg-purple-100 
                                   border border-purple-200 rounded-lg text-xs font-bold text-purple-700
                                   flex items-center justify-center gap-1 transition-colors"
                            title="عرض التصاميم">
                        <i class="fa-solid fa-images"></i>
                        التصاميم
                    </button>
                    <button type="button" onclick="window.openDesignUploadModal(this)"
                            class="row-design-upload px-2 py-1.5 bg-emerald-50 hover:bg-emerald-100 
                                   border border-emerald-200 rounded-lg text-xs font-bold text-emerald-700
                                   flex items-center justify-center gap-1 transition-colors"
                            title="رفع تصميم جديد">
                        <i class="fa-solid fa-cloud-arrow-up"></i>
                    </button>
                </div>
                <!-- Selected Design Info (small bar) -->
                <div class="row-design-preview hidden flex items-center gap-2 bg-slate-100 rounded-lg p-1.5 cursor-pointer"
                     onclick="window.openDesignGallery(this)">
                    <div class="design-preview-media w-8 h-8 rounded border border-slate-200 overflow-hidden bg-white flex items-center justify-center text-[9px] font-bold text-slate-500 pointer-events-none"></div>
                    <span class="text-[10px] text-slate-600 truncate flex-1"></span>
                </div>
            </div>

            <!-- Delete Row Button -->
            <div>
                <button type="button"
                        onclick="window._removeQuoteRow(this)"
                        class="row-delete-btn w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                               hover:text-red-600 hover:bg-red-50 transition-colors flex-shrink-0">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </div>`;

        // If product is prefilled, set the select value
        if (prefill.product_id) {
            const productSel = row.querySelector('select.row-product');
            if (productSel) productSel.value = prefill.product_id;
        }

        container.appendChild(row);

        // Wire change handlers via addEventListener (more reliable with searchable dropdown)
        const cSel = row.querySelector('select.row-category');
        const pSel = row.querySelector('select.row-product');
        const vSel = row.querySelector('select.row-variant');
        if (cSel) {
            cSel.addEventListener('change', () => window._onRowCategoryChange(cSel));
            const cs = _makeSearchable(cSel, '🔍 التصنيف...');
            if (cs) cs.refresh();
        }
        if (pSel) {
            pSel.addEventListener('change', () => window._onRowProductChange(pSel, rowId));
            const ps = _makeSearchable(pSel, '🔍 ابحث عن المنتج...');
            if (ps) ps.refresh();
        }
        if (vSel) {
            vSel.addEventListener('change', () => window._onRowVariantChange(vSel));
            const vs = _makeSearchable(vSel, '🔍 ابحث عن المقاس...');
            if (vs) vs.refresh();
        }
        
        // Design select change handler
        const dSel = row.querySelector('.row-design-select');
        if (dSel) {
            dSel.addEventListener('change', () => window.updateDesignPreview(row));
        }

        _updateItemsEmptyState();
        window.calculateOrderTotals();

        // Focus quantity field of the new row
        setTimeout(() => {
            const qtyEl = row.querySelector('.row-qty');
            if (qtyEl) qtyEl.focus();
        }, 50);
    };

    // ==========================================================================
    // window._onRowCategoryChange(selectEl)
    // When category dropdown changes: repopulate product dropdown filtered by category.
    // ==========================================================================
    window._onRowCategoryChange = function (selectEl) {
        const categoryId = selectEl.value;
        const row        = selectEl.closest('.quote-item-row');
        if (!row) return;

        const productSel = row.querySelector('select.row-product');
        const variantSel = row.querySelector('select.row-variant');
        if (!productSel) return;

        // Rebuild product options filtered by category
        productSel.innerHTML = _buildProductOptions(categoryId);

        // Reset variant dropdown
        if (variantSel) {
            variantSel.innerHTML = '<option value="">— اختر المقاس —</option>';
        }

        // Clear price
        const priceInput = row.querySelector('.row-price');
        if (priceInput) priceInput.value = '';
        window.calculateOrderTotals();

        // Refresh searchable dropdown if applicable
        if (productSel.dataset.searchable) {
            const wrap = productSel.closest('.searchable-wrap');
            if (wrap) {
                const input = wrap.querySelector('input[type="text"]');
                const dd    = wrap.querySelector('.searchable-dd');
                if (dd) {
                    const opts = productSel.querySelectorAll('option');
                    dd.innerHTML = '';
                    opts.forEach(opt => {
                        const div = document.createElement('div');
                        div.className = 'searchable-item px-3 py-1.5 text-sm text-slate-700 hover:bg-brand-50 cursor-pointer';
                        div.textContent = opt.textContent;
                        div.dataset.value = opt.value;
                        div.addEventListener('click', () => {
                            productSel.value = opt.value;
                            productSel.dispatchEvent(new Event('change'));
                            if (input) input.value = opt.textContent;
                            dd.classList.add('hidden');
                        });
                        dd.appendChild(div);
                    });
                }
            }
        }
    };

    // ==========================================================================
    // window._onRowProductChange(selectEl, rowId)
    // When product dropdown changes: repopulate variant dropdown, clear price.
    // ==========================================================================
    window._onRowProductChange = function (selectEl, rowId) {
        const productId = selectEl.value;
        const row       = selectEl.closest('.quote-item-row');
        if (!row) return;

        const variantSel = row.querySelector('select.row-variant');
        const priceInput = row.querySelector('.row-price');

        if (!variantSel) return;

        // Clear price and total
        if (priceInput) priceInput.value = '';
        window.calculateOrderTotals();

        if (!productId) {
            variantSel.innerHTML = '<option value="">— اختر المقاس —</option>';
            return;
        }

        const prod = _products.find(p => p.id === productId);
        if (!prod || !Array.isArray(prod.variants)) {
            variantSel.innerHTML = '<option value="">— لا توجد مقاسات —</option>';
            return;
        }

        const activeVariants = prod.variants.filter(v => v.status === 'active');

        variantSel.innerHTML = '<option value="">— اختر المقاس —</option>' +
            activeVariants.map(v => {
                const label = v.unit_abbreviation
                    ? `${v.size_name} (${v.unit_abbreviation})`
                    : v.size_name;
                return `<option value="${v.id}" data-price="${v.selling_price || 0}">${label}</option>`;
            }).join('');

        // Auto-select if only one variant
        if (activeVariants.length === 1) {
            variantSel.value = activeVariants[0].id;
            window._onRowVariantChange(variantSel);
        }
    };

    // ==========================================================================
    // window._onRowVariantChange(selectEl)
    // When variant changes: auto-fill unit price and load designs.
    // ==========================================================================
    window._onRowVariantChange = function (selectEl) {
        const row      = selectEl.closest('.quote-item-row');
        if (!row) return;
        const priceInput = row.querySelector('.row-price');
        if (!priceInput) return;

        const selectedOpt = selectEl.options[selectEl.selectedIndex];
        const price       = selectedOpt ? parseFloat(selectedOpt.dataset.price) || 0 : 0;

        priceInput.value = price > 0 ? price.toFixed(2) : '';
        window.calculateOrderTotals();

        const variantId = selectEl.value;
        const clientId  = document.getElementById('quote-client')?.value || '';
        
        // Load designs for this client + variant
        console.log('[_onRowVariantChange] variantId:', variantId, 'clientId:', clientId);
        if (variantId && clientId) {
            console.log('[_onRowVariantChange] Calling loadDesignsForRow');
            window.loadDesignsForRow(row);
        } else {
            console.log('[_onRowVariantChange] NOT calling loadDesignsForRow - missing IDs');
        }

        // Async: fetch last sell price + last purchase price separately
        const hintEl  = row.querySelector('.last-price-hint');
        const buyHint = row.querySelector('.purchase-price-hint');
        if (variantId && clientId && hintEl) {
            window.apiFetch(`/api/orders/last-price?client_id=${clientId}&variant_id=${variantId}`)
                .then(res => {
                    if (res && res.last_price !== null && res.last_price !== undefined) {
                        hintEl.innerHTML = `<span class="text-green-600 font-bold text-[10px] whitespace-nowrap cursor-pointer hover:underline" onclick="window.openPriceHistoryModal('${clientId}', '${variantId}', this.closest('.quote-item-row').querySelector('.row-product')?.selectedOptions?.[0]?.textContent || '')"><i class="fa-solid fa-clock-rotate-left ml-1"></i>السابق: ${Number(res.last_price).toFixed(2)}</span>`;
                    } else {
                        hintEl.innerHTML = '';
                    }
                })
                .catch(() => { hintEl.innerHTML = ''; });
        } else if (hintEl) {
            hintEl.innerHTML = '';
        }

        if (variantId && buyHint) {
            window.apiFetch(`/api/orders/last-purchase-price?variant_id=${variantId}`)
                .then(res => {
                    if (res && res.last_price !== null && res.last_price !== undefined) {
                        buyHint.innerHTML = `<span class="text-blue-600 font-bold text-[10px] whitespace-nowrap cursor-pointer hover:underline" onclick="window.openPurchasePriceHistoryModal('${variantId}', this.closest('.quote-item-row').querySelector('.row-product')?.selectedOptions?.[0]?.textContent || '')"><i class="fa-solid fa-truck ml-1"></i>شراء: ${Number(res.last_price).toFixed(2)}</span>`;
                    } else {
                        buyHint.innerHTML = '';
                    }
                })
                .catch(() => { buyHint.innerHTML = ''; });
        } else if (buyHint) {
            buyHint.innerHTML = '';
        }
    };

    // ==========================================================================
    // window._removeQuoteRow(btn)
    // Removes a row and recalculates totals.
    // ==========================================================================
    window._removeQuoteRow = function (btn) {
        const row = btn.closest('.quote-item-row');
        if (row) row.remove();
        _updateItemsEmptyState();
        window.calculateOrderTotals();
    };

    // ==========================================================================
    // window.openQuoteModal(id?)
    // Opens modal. id = null → Add mode, id = UUID → Edit mode (loads order).
    // ==========================================================================
    window.openQuoteModal = async function (id = null, isViewOnly = false) {
        _editingId = id;
        _resetForm();
        _populateClientSelect();

        const title       = document.getElementById('quote-modal-title');
        const numLabel    = document.getElementById('quote-modal-number');
        const submitBtn   = document.getElementById('quote-modal-submit-btn');
        const cancelBtn   = document.getElementById('quote-modal-cancel-btn');
        const addItemBtn  = document.getElementById('add-item-row-btn');
        const backBtn     = document.getElementById('view-mode-back-btn');
        const cloneBtn    = document.getElementById('view-mode-clone-btn');
        const printBtn    = document.getElementById('view-mode-print-btn');
        const shareBtn    = document.getElementById('view-mode-share-btn');

        // ── Helper: apply or remove view-only state ──
        function _applyViewOnly(enable) {
            const form = document.getElementById('quote-form') || document.getElementById('quote-modal');
            if (form) {
                form.querySelectorAll('input, select, textarea').forEach(el => {
                    el.disabled = enable;
                });
            }
            // Hide / show submit, cancel & add-item buttons
            if (submitBtn)  submitBtn.style.display  = enable ? 'none' : '';
            if (cancelBtn)  cancelBtn.style.display  = enable ? 'none' : '';
            if (addItemBtn) addItemBtn.style.display  = enable ? 'none' : '';

            // Show / hide view-mode buttons
            if (backBtn)  backBtn.classList.toggle('hidden', !enable);
            if (cloneBtn) cloneBtn.classList.toggle('hidden', !enable);
            if (shareBtn) shareBtn.classList.toggle('hidden', !enable);
            if (printBtn) printBtn.classList.toggle('hidden', !enable);

            // Hide delete buttons on rows
            const deleteButtons = document.querySelectorAll('#quote-items-container .row-delete-btn');
            deleteButtons.forEach(btn => { btn.style.display = enable ? 'none' : ''; });

            // Hide quick-add (+) and edit buttons on rows
            const quickAddBtns = document.querySelectorAll('#quote-items-container .quick-add-btn');
            quickAddBtns.forEach(btn => { btn.style.display = enable ? 'none' : ''; });

            // Disable/enable searchable combo inputs
            const modal = document.getElementById('quote-modal');
            if (modal) {
                modal.querySelectorAll('.searchable-wrap input[type="text"]').forEach(inp => {
                    inp.disabled = enable;
                });
            }
        }

        if (!id) {
            _viewingOrderId = null;
            if (title)     title.textContent     = '\u0625\u0646\u0634\u0627\u0621 \u0639\u0631\u0636 \u0633\u0639\u0631 \u062c\u062f\u064a\u062f';
            if (numLabel)  numLabel.classList.add('hidden');
            if (submitBtn) submitBtn.querySelector('span').textContent = '\u062d\u0641\u0638 \u0639\u0631\u0636 \u0627\u0644\u0633\u0639\u0631';
            _openModal();
            _applyViewOnly(false);
            window.addQuoteItemRow();
            return;
        }

        // Store for clone/back
        _viewingOrderId = isViewOnly ? id : null;

        // Edit or View mode — fetch order detail
        if (isViewOnly) {
            if (title) title.textContent = '\u0639\u0631\u0636 \u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0637\u0644\u0628';
        } else {
            if (title) title.textContent = '\u062a\u0639\u062f\u064a\u0644 \u0639\u0631\u0636 \u0627\u0644\u0633\u0639\u0631';
        }
        if (numLabel) numLabel.classList.add('hidden');
        if (submitBtn && !isViewOnly) submitBtn.querySelector('span').textContent = '\u062d\u0641\u0638 \u0627\u0644\u062a\u0639\u062f\u064a\u0644\u0627\u062a';
        _openModal();

        try {
            const res   = await window.apiFetch(`/api/orders/${id}`);
            const order = res && res.data;
            if (!order) throw new Error('\u0644\u0645 \u064a\u062a\u0645 \u0625\u064a\u062c\u0627\u062f \u0627\u0644\u0639\u0631\u0636.');

            // Fill header fields
            _populateClientSelect(order.client_id);

            const orderDateEl = document.getElementById('quote-order-date');
            if (orderDateEl && order.order_date) {
                orderDateEl.value = order.order_date.split('T')[0];
            }

            const validUntilEl = document.getElementById('quote-valid-until');
            if (validUntilEl && order.valid_until) {
                validUntilEl.value = order.valid_until.split('T')[0];
            }

            const notesEl = document.getElementById('quote-notes');
            if (notesEl) notesEl.value = order.client_notes || '';

            const intNotesEl = document.getElementById('quote-internal-notes');
            if (intNotesEl) intNotesEl.value = order.internal_notes || '';

            const downPaymentEl = document.getElementById('quote-down-payment');
            if (downPaymentEl) downPaymentEl.value = order.down_payment_required || '';

            if (numLabel) {
                numLabel.textContent = `#${order.order_number}`;
                numLabel.classList.remove('hidden');
            }

            // Fill items
            if (Array.isArray(order.items) && order.items.length > 0) {
                order.items.forEach(item => {
                    window.addQuoteItemRow({
                        product_id:          item.product_id,
                        product_variant_id:  item.product_variant_id,
                        quantity:            item.quantity,
                        unit_price:          item.unit_price,
                        design_status:       item.design_status || 'new',
                        design_id:           item.design_id || null,
                    });
                });
            } else {
                window.addQuoteItemRow();
            }

            // Populate terms checkboxes with saved selections
            // If custom_terms exist, use them instead of standard terms
            const savedTermIds = Array.isArray(order.terms_conditions)
                ? order.terms_conditions.map(t => t.id || t)
                : [];

            if (order.custom_terms && Array.isArray(order.custom_terms) && order.custom_terms.length > 0) {
                // Use custom terms from order (merged with existing terms)
                _standardTerms = order.custom_terms.map(t => ({
                    id: t.id,
                    title: t.title,
                    content: t.content,
                    is_default: t.is_checked || false
                }));
            }
            _renderTermsCheckboxes(savedTermIds);

            // Apply view-only AFTER all data is loaded
            _applyViewOnly(isViewOnly);

        } catch (err) {
            _showFormError(err.message || '\u0641\u0634\u0644 \u062a\u062d\u0645\u064a\u0644 \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0639\u0631\u0636.');
        }
    };

    // ==========================================================================
    // window.closeQuoteModal()
    // ==========================================================================
    window.closeQuoteModal = function () {
        _closeModal();
    };

    // ==========================================================================
    // ── CONVERT TO PRODUCTION ────────────────────────────────────────────────
    // ==========================================================================

    function _openConvertModalUI() {
        const modal = document.getElementById('convert-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('opacity-100');
            modal.querySelector('.convert-modal-panel').classList.add('scale-100');
        });
    }

    function _closeConvertModalUI() {
        const modal = document.getElementById('convert-modal');
        if (!modal) return;
        modal.classList.remove('opacity-100');
        modal.querySelector('.convert-modal-panel').classList.remove('scale-100');
        setTimeout(() => {
            modal.style.display = 'none';
            _convertingId = null;
        }, 200);
    }

    function _showConvertError(msg) {
        const box  = document.getElementById('convert-form-error');
        const span = box ? box.querySelector('span') : null;
        if (!box) return;
        if (span) span.textContent = msg;
        else      box.textContent  = msg;
        box.classList.remove('hidden');
    }

    function _clearConvertError() {
        const box  = document.getElementById('convert-form-error');
        const span = box ? box.querySelector('span') : null;
        if (!box) return;
        if (span) span.textContent = '';
        box.classList.add('hidden');
    }

    window._onConvertPaymentMethodChange = function (method) {
        const cashFields = document.getElementById('convert-cash-fields');
        const bankFields = document.getElementById('convert-bank-fields');
        const posFields  = document.getElementById('convert-pos-fields');
        if (cashFields) cashFields.style.display = 'none';
        if (bankFields) bankFields.style.display = 'none';
        if (posFields)  posFields.style.display  = 'none';
        if (method === 'cash') {
            if (cashFields) cashFields.style.display = 'block';
        } else if (method === 'bank_transfer') {
            if (bankFields) bankFields.style.display = 'block';
        } else if (method === 'pos') {
            if (posFields) posFields.style.display = 'block';
        }
    }

    // Load payment method lookup data
    let _cashBoxes = [];
    let _bankAccounts = [];
    let _posTerminals = [];

    async function _loadPaymentLookups() {
        try {
            const [cashRes, bankRes, posRes] = await Promise.all([
                window.apiFetch('/api/orders/lookup/cash-accounts'),
                window.apiFetch('/api/orders/lookup/bank-accounts'),
                window.apiFetch('/api/orders/lookup/pos-terminals'),
            ]);
            _cashBoxes = (cashRes && cashRes.data) || [];
            _bankAccounts = (bankRes && bankRes.data) || [];
            _posTerminals = (posRes && posRes.data) || [];
        } catch (e) {
            console.error('Failed to load payment lookups:', e);
        }
    }

    function _populateConvertSelects() {
        const cashSelect = document.getElementById('convert-cash-box');
        const bankSelect = document.getElementById('convert-bank-account');
        const posSelect  = document.getElementById('convert-pos-terminal');

        if (cashSelect) {
            cashSelect.innerHTML = _cashBoxes.map(b =>
                `<option value="${b.code}">${b.name}${b.location ? ' — ' + b.location : ''}</option>`
            ).join('') || '<option value="">— لا يوجد صناديق —</option>';
        }
        if (bankSelect) {
            bankSelect.innerHTML = _bankAccounts.map(b =>
                `<option value="${b.code}">${b.code} — ${b.name}</option>`
            ).join('') || '<option value="">— لا يوجد حسابات بنكية —</option>';
        }
        if (posSelect) {
            posSelect.innerHTML = _posTerminals.map(t =>
                `<option value="${t.code}">${t.name}${t.location ? ' — ' + t.location : ''}</option>`
            ).join('') || '<option value="">— لا يوجد أجهزة —</option>';
        }
    }

    window.openConvertModal = async function (orderId) {
        _convertingId = orderId;
        _clearConvertError();

        // Reset form fields
        const dpInput = document.getElementById('convert-down-payment');
        const pmSelect = document.getElementById('convert-payment-method');
        if (dpInput)  dpInput.value  = '';
        if (pmSelect) pmSelect.value = 'cash';
        _onConvertPaymentMethodChange('cash');

        // Reset extra fields
        const bankRef = document.getElementById('convert-bank-ref');
        const posRef = document.getElementById('convert-pos-ref');
        if (bankRef) bankRef.value = '';
        if (posRef) posRef.value = '';

        // Find order data from cached list
        const order = _allQuotes.find(q => q.id === orderId);
        const clientNameEl  = document.getElementById('convert-client-name');
        const grandTotalEl  = document.getElementById('convert-grand-total');
        const orderNumEl    = document.getElementById('convert-modal-order-num');

        if (clientNameEl) clientNameEl.textContent = order ? (order.client_name || '—') : '—';
        if (grandTotalEl) grandTotalEl.textContent = order ? _fmt(order.grand_total) : '—';
        if (orderNumEl)   orderNumEl.textContent   = order ? `#${order.order_number}` : '';

        // Load lookup data
        // Load dynamic lookup data from Chart of Accounts
        await _loadPaymentLookups();
        _populateConvertSelects();

        _openConvertModalUI();
    };

    window.closeConvertModal = function () {
        _closeConvertModalUI();
    };

    window.submitConvertForm = async function () {
        _clearConvertError();

        const submitBtn = document.getElementById('convert-modal-submit-btn');
        const dpAmount  = parseFloat(document.getElementById('convert-down-payment')?.value) || 0;
        const pmMethod  = document.getElementById('convert-payment-method')?.value || '';

        if (dpAmount > 0 && !pmMethod) {
            _showConvertError('يرجى اختيار طريقة الدفع عند تسجيل دفعة مقدمة.');
            return;
        }

        // Validate required extra fields based on payment method
        if (dpAmount > 0 && pmMethod === 'cash') {
            const cashBox = document.getElementById('convert-cash-box')?.value || '';
            if (!cashBox) {
                _showConvertError('يرجى اختيار الصندوق عند الدفع النقدي.');
                return;
            }
        } else if (dpAmount > 0 && pmMethod === 'bank_transfer') {
            const bankAccount = document.getElementById('convert-bank-account')?.value || '';
            if (!bankAccount) {
                _showConvertError('يرجى اختيار الحساب البنكي.');
                return;
            }
        } else if (dpAmount > 0 && pmMethod === 'pos') {
            const posTerminal = document.getElementById('convert-pos-terminal')?.value || '';
            if (!posTerminal) {
                _showConvertError('يرجى اختيار جهاز نقاط البيع.');
                return;
            }
        }

        const payload = {
            down_payment_amount:  dpAmount,
            payment_method:       pmMethod || null,
        };

        // Add payment method details to payload
        if (pmMethod === 'cash') {
            payload.cash_box = document.getElementById('convert-cash-box')?.value || null;
        } else if (pmMethod === 'bank_transfer') {
            payload.bank_account = document.getElementById('convert-bank-account')?.value || null;
            payload.bank_ref = document.getElementById('convert-bank-ref')?.value || null;
        } else if (pmMethod === 'pos') {
            payload.pos_terminal = document.getElementById('convert-pos-terminal')?.value || null;
            payload.pos_ref = document.getElementById('convert-pos-ref')?.value || null;
        }

        if (submitBtn) {
            submitBtn.disabled  = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جارٍ التحويل...';
        }

        try {
            const res = await window.apiFetch(`/api/orders/${_convertingId}/convert-to-production`, {
                method: 'POST',
                body:   payload,
            });

            if (res && res.data) {
                window.showToast(
                    `تم تحويل الطلب #${res.data.order_number} لأمر إنتاج بنجاح.` +
                    (dpAmount > 0 ? ` (دفعة مقدمة: ${_fmt(dpAmount)})` : ''),
                    'success'
                );
                window.closeConvertModal();
                await loadQuotes();
            }
        } catch (err) {
            _showConvertError(err.message || 'حدث خطأ غير متوقع.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled  = false;
                submitBtn.innerHTML = '<i class="fa-solid fa-industry"></i><span>تحويل لإنتاج</span>';
            }
        }
    };

    // ==========================================================================
    // ── PRINT QUOTE ──────────────────────────────────────────────────────────
    // ==========================================================================

    window.printQuote = async function (orderId) {
        try {
            const res   = await window.apiFetch(`/api/orders/${orderId}`);
            const order = res && res.data;
            if (!order) throw new Error('\u0644\u0645 \u064a\u062a\u0645 \u0625\u064a\u062c\u0627\u062f \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0639\u0631\u0636.');

            // Header info
            const pNum    = document.getElementById('print-order-number');
            const pClient = document.getElementById('print-client-name');
            const pDate   = document.getElementById('print-order-date');
            const pValid  = document.getElementById('print-valid-until');

            if (pNum)    pNum.textContent    = `#${order.order_number}`;
            if (pClient) pClient.textContent = order.client_name || '\u2014';
            if (pDate)   pDate.textContent   = order.order_date ? new Date(order.order_date).toLocaleDateString('en-GB') : '\u2014';
            if (pValid)  pValid.textContent  = order.valid_until ? new Date(order.valid_until).toLocaleDateString('en-GB') : '\u2014';

            // Notes
            const notesSection = document.getElementById('print-notes-section');
            const notesEl      = document.getElementById('print-notes');
            if (order.client_notes && notesSection && notesEl) {
                notesEl.textContent        = order.client_notes;
                notesSection.style.display = 'block';
            } else if (notesSection) {
                notesSection.style.display = 'none';
            }

            // Items table
            const itemsTbody = document.getElementById('print-items-tbody');
            if (itemsTbody && Array.isArray(order.items)) {
                itemsTbody.innerHTML = order.items.map((item, i) => {
                    const bgColor = i % 2 === 1 ? '#f8f5ff' : '#ffffff';
                    return `<tr style="background:${bgColor};">
                        <td style="padding:5px 4px; border:1px solid #e8e0f5; text-align:center; color:#64748b; width:24px; font-size:8.5pt;">${i + 1}</td>
                        <td style="padding:5px 8px; border:1px solid #e8e0f5; font-weight:600; font-size:8.5pt;">${item.product_name || '\u2014'}</td>
                        <td style="padding:5px 8px; border:1px solid #e8e0f5; font-size:8.5pt;">${item.variant_name || '\u2014'}</td>
                        <td style="padding:5px 4px; border:1px solid #e8e0f5; text-align:center; width:40px; font-size:8.5pt;">${item.unit_abbreviation || item.unit_name || '\u2014'}</td>
                        <td style="padding:5px 4px; border:1px solid #e8e0f5; text-align:center; width:46px; font-size:8.5pt;">${_fmtNum(item.quantity)}</td>
                        <td style="padding:5px 4px; border:1px solid #e8e0f5; text-align:center; font-family:monospace; white-space:nowrap; width:60px; font-size:8.5pt;">${_fmtNum(item.unit_price)}</td>
                        <td style="padding:5px 4px; border:1px solid #e8e0f5; text-align:center; font-family:monospace; font-weight:700; white-space:nowrap; width:68px; font-size:8.5pt;">${_fmtNum(item.line_total)}</td>
                    </tr>`;
                }).join('');
            }

            // Totals
            const pSub = document.getElementById('print-subtotal');
            const pTax = document.getElementById('print-tax');
            const pGT  = document.getElementById('print-grand-total');
            if (pSub) pSub.textContent = _fmt(order.subtotal);
            if (pTax) pTax.textContent = _fmt(order.tax_amount);
            if (pGT)  pGT.textContent  = _fmt(order.grand_total);

            // Down Payment
            const pDown = document.getElementById('print-down-payment');
            if (pDown) {
                if (order.down_payment_required && parseFloat(order.down_payment_required) > 0) {
                    pDown.textContent = _fmt(order.down_payment_required);
                    document.getElementById('print-down-payment-section').style.display = 'flex';
                } else {
                    document.getElementById('print-down-payment-section').style.display = 'none';
                }
            }

            // Terms & Conditions - use custom_terms if available, otherwise use terms_conditions
            const termsList = document.getElementById('print-terms-list');
            if (termsList) {
                // Priority: custom_terms (edited) > terms_conditions (original)
                const termsSource = Array.isArray(order.custom_terms) && order.custom_terms.length > 0
                    ? order.custom_terms.filter(t => t.is_checked)
                    : (Array.isArray(order.terms_conditions) ? order.terms_conditions : []);

                if (termsSource.length > 0) {
                    termsList.innerHTML = termsSource.map(t => {
                        // Use content directly from custom_terms or look up in standard terms
                        const content = t.content || t.title || '';
                        return content ? `<li>${content}</li>` : '';
                    }).filter(Boolean).join('');
                } else {
                    termsList.innerHTML = '<li style="color:#94a3b8;">\u0644\u0627 \u062a\u0648\u062c\u062f \u0634\u0631\u0648\u0637 \u0645\u062d\u062f\u062f\u0629.</li>';
                }
            }

            // Trigger print
            setTimeout(() => window.print(), 200);

        } catch (err) {
            window.showToast(err.message || '\u0641\u0634\u0644 \u062a\u062d\u0645\u064a\u0644 \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0637\u0628\u0627\u0639\u0629.', 'error');
        }
    };

    // ==========================================================================
    // window.viewQuoteDetail(id)
    // Uses printQuote as a simple detail viewer for now.
    // ==========================================================================
    window.viewQuoteDetail = function (id) {
        window.printQuote(id);
    };

    // ==========================================================================
    // window.submitQuoteForm()
    // Collects payload and sends POST (add) or PUT (edit) to /api/orders.
    // ==========================================================================
    window.submitQuoteForm = async function () {
        _clearFormError();

        const submitBtn  = document.getElementById('quote-modal-submit-btn');
        const clientId   = document.getElementById('quote-client')?.value || '';
        const orderDate  = document.getElementById('quote-order-date')?.value || '';
        const validUntil = document.getElementById('quote-valid-until')?.value || '';
        const notes      = (document.getElementById('quote-notes')?.value || '').trim();
        const intNotes   = (document.getElementById('quote-internal-notes')?.value || '').trim();

        if (!clientId) {
            _showFormError('يرجى اختيار العميل.');
            return;
        }

        // Collect items from DOM rows
        const rows  = document.querySelectorAll('.quote-item-row');
        const items = [];

        let rowError = null;
        rows.forEach((row, i) => {
            if (rowError) return;
            const variantId = row.querySelector('select.row-variant')?.value || '';
            const qty       = parseFloat(row.querySelector('.row-qty')?.value)   || 0;
            const price     = parseFloat(row.querySelector('.row-price')?.value) || 0;

            if (!variantId) {
                rowError = `الصف ${i + 1}: يجب اختيار مقاس المنتج.`;
                return;
            }
            if (qty <= 0) {
                rowError = `الصف ${i + 1}: الكمية يجب أن تكون أكبر من صفر.`;
                return;
            }

            const designSelectVal = row.querySelector('.row-design-select')?.value || 'new';
            let designStatus = 'new';
            let designId = null;
            if (designSelectVal === 'new') {
                designStatus = 'new';
            } else if (designSelectVal === 'reprint') {
                designStatus = 'reprint';
            } else {
                designStatus = 'reprint';
                designId = designSelectVal;
            }

            items.push({
                product_variant_id: variantId,
                quantity:           qty,
                unit_price:         price,
                design_status:      designStatus,
                design_id:          designId,
            });
        });

        if (rowError) {
            _showFormError(rowError);
            return;
        }

        if (items.length === 0) {
            _showFormError('يجب إضافة صنف واحد على الأقل.');
            return;
        }

        // Gather checked terms from checkboxes
        const checkedIds = [];
        document.querySelectorAll('#terms-container .term-checkbox:checked').forEach(cb => {
            checkedIds.push(cb.value);
        });

        // Build full edited terms list with checked status
        const editedTermsList = _standardTerms.map(term => ({
            id:         term.id,
            title:      term.title,
            content:    term.content,
            is_checked: checkedIds.includes(term.id)
        }));

        // Separate: selected terms for order (existing behavior)
        const termsConditions = editedTermsList
            .filter(t => t.is_checked)
            .map(t => ({ id: t.id, title: t.title }));

        // Full edited terms list for this quote only
        const customTerms = editedTermsList.length > 0 ? editedTermsList : null;

        const downPayment = document.getElementById('quote-down-payment')?.value || null;

        // Check if any item has zero price (needs manager pricing approval)
        const hasZeroPrice = items.some(item => !item.unit_price || item.unit_price === 0);

        const payload = {
            client_id:             clientId,
            status:                'quote',
            pricing_status:        hasZeroPrice ? 'pending' : 'priced',
            order_date:            orderDate || _today(),
            valid_until:           validUntil || null,
            client_notes:          notes    || null,
            internal_notes:        intNotes || null,
            down_payment_required: downPayment,
            terms_conditions:      termsConditions,
            custom_terms:          customTerms,
            items,
        };

        if (submitBtn) {
            submitBtn.disabled   = true;
            submitBtn.innerHTML  = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جارٍ الحفظ...';
        }

        try {
            let res;
            if (_editingId) {
                res = await window.apiFetch(`/api/orders/${_editingId}`, {
                    method: 'PUT',
                    body:   payload,
                });
            } else {
                res = await window.apiFetch('/api/orders', {
                    method: 'POST',
                    body:   payload,
                });
            }

            if (res && res.data) {
                const savedId = res.data.id || _editingId;
                const savedNumber = res.data.order_number;
                if (savedNumber) {
                    const numLabel = document.getElementById('quote-modal-number');
                    if (numLabel) {
                        numLabel.textContent = `#${savedNumber}`;
                        numLabel.classList.remove('hidden');
                    }
                }
                await loadQuotes();
                window.openQuoteModal(savedId, true);
                window.showToast(savedNumber
                    ? `تم الحفظ بنجاح — رقم العرض: #${savedNumber}`
                    : 'تم الحفظ بنجاح، يمكنك الآن طباعة العرض.', 'success');
            }
        } catch (err) {
            _showFormError(err.message || 'حدث خطأ غير متوقع. حاول مرة أخرى.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled   = false;
                submitBtn.innerHTML  = `<i class="fa-solid fa-paper-plane"></i><span class="mr-1">${_editingId ? 'حفظ التعديلات' : 'حفظ عرض السعر'}</span>`;
            }
        }
    };

    // ==========================================================================
    // ── QUICK ADD CLIENT ────────────────────────────────────────────────────
    // ==========================================================================

    function _openQuickClientModal() {
        const modal = document.getElementById('quick-client-modal');
        if (!modal) return;

        // Reset fields
        const nameInput  = document.getElementById('qc-name');
        const phoneInput = document.getElementById('qc-phone');
        const parentSel  = document.getElementById('qc-parent');
        const errBox     = document.getElementById('quick-client-error');

        if (nameInput)  nameInput.value  = '';
        if (phoneInput) phoneInput.value = '';
        if (errBox)     errBox.classList.add('hidden');

        // Populate parent select from cached clients
        if (parentSel) {
            parentSel.innerHTML = '<option value="">\u2014 \u0628\u062f\u0648\u0646 (\u0639\u0645\u064a\u0644 \u0631\u0626\u064a\u0633\u064a) \u2014</option>';
            _clients.filter(c => !c.parent_id).forEach(c => {
                const opt       = document.createElement('option');
                opt.value       = c.id;
                opt.textContent = c.name;
                parentSel.appendChild(opt);
            });
        }

        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('opacity-100');
            modal.querySelector('.quick-client-panel').classList.add('scale-100');
        });

        setTimeout(() => { if (nameInput) nameInput.focus(); }, 100);
    }

    function _closeQuickClientModal() {
        const modal = document.getElementById('quick-client-modal');
        if (!modal) return;
        modal.classList.remove('opacity-100');
        modal.querySelector('.quick-client-panel').classList.remove('scale-100');
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    }

    window.openQuickClientModal  = _openQuickClientModal;
    window.closeQuickClientModal = _closeQuickClientModal;

    // ==========================================================================
    // ── CLIENT HISTORY MODAL ─────────────────────────────────────────────────
    // ==========================================================================

    function _openClientHistoryModal() {
        const clientId = document.getElementById('quote-client')?.value || '';
        if (!clientId) {
            window.showToast('\u064a\u0631\u062c\u0649 \u0627\u062e\u062a\u064a\u0627\u0631 \u0627\u0644\u0639\u0645\u064a\u0644 \u0623\u0648\u0644\u0627\u064b.', 'warning');
            return;
        }

        const clientObj = _clients.find(c => c.id === clientId);
        const nameEl    = document.getElementById('ch-client-name');
        if (nameEl) nameEl.textContent = clientObj ? clientObj.name : '';

        const tbody = document.getElementById('ch-history-tbody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i></td></tr>';
        }

        const modal = document.getElementById('client-history-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('opacity-100');
            modal.querySelector('.client-history-panel').classList.add('scale-100');
        });

        // Fetch history
        window.apiFetch(`/api/orders/client-history/${clientId}`)
            .then(res => {
                const orders = (res && res.data) ? res.data : [];
                if (!tbody) return;

                if (orders.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-slate-400 text-sm">\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0633\u0627\u0628\u0642\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u0639\u0645\u064a\u0644.</td></tr>';
                    return;
                }

                tbody.innerHTML = orders.map(o => {
                    const dateStr = o.order_date ? new Date(o.order_date).toLocaleDateString('en-GB') : '\u2014';
                    const total   = o.grand_total ? Number(o.grand_total).toFixed(2) + ' \u0631.\u0633' : '\u2014';
                    return `<tr class="border-b border-slate-100 hover:bg-slate-50/60">
                        <td class="py-2.5 px-3 font-mono font-bold text-slate-700">#${o.order_number || '\u2014'}</td>
                        <td class="py-2.5 px-3">${_statusBadge(o.status)}</td>
                        <td class="py-2.5 px-3 text-slate-500">${dateStr}</td>
                        <td class="py-2.5 px-3 font-bold text-slate-700 font-mono">${total}</td>
                        <td class="py-2.5 px-3 text-center">
                            <button onclick="window.closeClientHistoryModal(); window.openQuoteModal('${o.id}', true);" title="\u0639\u0631\u0636"
                                    class="inline-flex items-center gap-1 text-xs font-semibold text-brand-600
                                           hover:text-brand-800 transition-colors">
                                <i class="fa-solid fa-folder-open"></i>
                                \u0639\u0631\u0636
                            </button>
                        </td>
                    </tr>`;
                }).join('');
            })
            .catch(() => {
                if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-red-400 text-sm">\u0641\u0634\u0644 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0633\u062c\u0644.</td></tr>';
            });
    }

    function _closeClientHistoryModal() {
        const modal = document.getElementById('client-history-modal');
        if (!modal) return;
        modal.classList.remove('opacity-100');
        modal.querySelector('.client-history-panel').classList.remove('scale-100');
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    }

    window.openClientHistoryModal  = _openClientHistoryModal;
    window.closeClientHistoryModal = _closeClientHistoryModal;

    window.submitQuickClientForm = async function () {
        const errBox     = document.getElementById('quick-client-error');
        const errSpan    = errBox ? errBox.querySelector('span') : null;
        const submitBtn  = document.getElementById('quick-client-submit-btn');
        const nameVal    = (document.getElementById('qc-name')?.value || '').trim();
        const phoneVal   = (document.getElementById('qc-phone')?.value || '').trim();
        const parentVal  = document.getElementById('qc-parent')?.value || '';

        // Clear error
        if (errBox) errBox.classList.add('hidden');

        if (!nameVal) {
            if (errSpan) errSpan.textContent = '\u0627\u0633\u0645 \u0627\u0644\u0639\u0645\u064a\u0644 \u0645\u0637\u0644\u0648\u0628.';
            if (errBox) errBox.classList.remove('hidden');
            return;
        }

        if (submitBtn) {
            submitBtn.disabled  = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> \u062c\u0627\u0631\u064d \u0627\u0644\u0625\u0636\u0627\u0641\u0629...';
        }

        try {
            const res = await window.apiFetch('/api/clients', {
                method: 'POST',
                body: {
                    name:      nameVal,
                    phone:     phoneVal || null,
                    parent_id: parentVal || null,
                },
            });

            if (res && res.data) {
                // Refresh clients list
                await _loadClients();
                // Auto-select new client
                _populateClientSelect(res.data.id);

                window.showToast(`\u062a\u0645 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0639\u0645\u064a\u0644 "${res.data.name}" \u0628\u0646\u062c\u0627\u062d.`, 'success');
                _closeQuickClientModal();
            }
        } catch (err) {
            if (errSpan) errSpan.textContent = err.message || '\u062d\u062f\u062b \u062e\u0637\u0623 \u063a\u064a\u0631 \u0645\u062a\u0648\u0642\u0639.';
            if (errBox)  errBox.classList.remove('hidden');
        } finally {
            if (submitBtn) {
                submitBtn.disabled  = false;
                submitBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i><span>\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0639\u0645\u064a\u0644</span>';
            }
        }
    };

    // ==========================================================================
    // _wireModalEvents()
    // ==========================================================================
    function _wireModalEvents() {
        // Quote modal
        const closeBtn  = document.getElementById('quote-modal-close-btn');
        const cancelBtn = document.getElementById('quote-modal-cancel-btn');

        if (closeBtn)  closeBtn.addEventListener('click',  window.closeQuoteModal);
        if (cancelBtn) cancelBtn.addEventListener('click', window.closeQuoteModal);

        // View-mode buttons
        const vmBackBtn  = document.getElementById('view-mode-back-btn');
        const vmCloneBtn = document.getElementById('view-mode-clone-btn');

        if (vmBackBtn) {
            vmBackBtn.addEventListener('click', () => {
                _closeModal();
            });
        }

        if (vmCloneBtn) {
            vmCloneBtn.addEventListener('click', () => {
                if (_viewingOrderId) {
                    window.cloneOrderToQuote(_viewingOrderId);
                }
            });
        }

        const vmPrintBtn = document.getElementById('view-mode-print-btn');
        if (vmPrintBtn) {
            vmPrintBtn.addEventListener('click', () => {
                if (_viewingOrderId) {
                    window.printQuote(_viewingOrderId);
                }
            });
        }

        const vmShareBtn = document.getElementById('view-mode-share-btn');
        if (vmShareBtn) {
            vmShareBtn.addEventListener('click', () => {
                if (_viewingOrderId) window.shareQuote(_viewingOrderId);
            });
        }

        // Convert modal
        const cvCloseBtn  = document.getElementById('convert-modal-close-btn');
        const cvCancelBtn = document.getElementById('convert-modal-cancel-btn');
        const cvModal     = document.getElementById('convert-modal');

        if (cvCloseBtn)  cvCloseBtn.addEventListener('click',  window.closeConvertModal);
        if (cvCancelBtn) cvCancelBtn.addEventListener('click', window.closeConvertModal);

        // Quick-client modal
        const qcCloseBtn  = document.getElementById('quick-client-close-btn');
        const qcCancelBtn = document.getElementById('quick-client-cancel-btn');
        const qcModal     = document.getElementById('quick-client-modal');

        if (qcCloseBtn)  qcCloseBtn.addEventListener('click',  _closeQuickClientModal);
        if (qcCancelBtn) qcCancelBtn.addEventListener('click', _closeQuickClientModal);

        // Client history modal
        const chCloseBtn  = document.getElementById('client-history-close-btn');
        const chCancelBtn = document.getElementById('client-history-cancel-btn');
        const chModal     = document.getElementById('client-history-modal');

        if (chCloseBtn)  chCloseBtn.addEventListener('click',  _closeClientHistoryModal);
        if (chCancelBtn) chCancelBtn.addEventListener('click', _closeClientHistoryModal);

        // Quick product modal
        const qpCloseBtn  = document.getElementById('quick-product-close-btn');
        const qpCancelBtn = document.getElementById('quick-product-cancel-btn');
        const qpModal     = document.getElementById('quick-product-modal');

        if (qpCloseBtn)  qpCloseBtn.addEventListener('click',  _closeQuickProductModal);
        if (qpCancelBtn) qpCancelBtn.addEventListener('click', _closeQuickProductModal);

        // Quick size modal
        const qsCloseBtn  = document.getElementById('quick-size-close-btn');
        const qsCancelBtn = document.getElementById('quick-size-cancel-btn');
        const qsModal     = document.getElementById('quick-size-modal');

        if (qsCloseBtn)  qsCloseBtn.addEventListener('click',  _closeQuickSizeModal);
        if (qsCancelBtn) qsCancelBtn.addEventListener('click', _closeQuickSizeModal);
    }

    // ==========================================================================
    // ── CLONE ORDER TO NEW QUOTE ─────────────────────────────────────────────
    // ==========================================================================

    window.cloneOrderToQuote = async function (orderId) {
        try {
            _closeClientHistoryModal();

            const res   = await window.apiFetch(`/api/orders/${orderId}`);
            const order = res && res.data;
            if (!order) throw new Error('\u0644\u0645 \u064a\u062a\u0645 \u0625\u064a\u062c\u0627\u062f \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0637\u0644\u0628.');

            // Switch to ADD mode (no editing ID)
            _editingId      = null;
            _viewingOrderId = null;
            _resetForm();
            _populateClientSelect(order.client_id);

            const title     = document.getElementById('quote-modal-title');
            const numLabel  = document.getElementById('quote-modal-number');
            const submitBtn = document.getElementById('quote-modal-submit-btn');
            const cancelBtn = document.getElementById('quote-modal-cancel-btn');
            const backBtn    = document.getElementById('view-mode-back-btn');
            const cloneBtn   = document.getElementById('view-mode-clone-btn');
            const printBtn   = document.getElementById('view-mode-print-btn');
            const addItemBtn = document.getElementById('add-item-row-btn');

            if (title)     title.textContent = '\u0625\u0646\u0634\u0627\u0621 \u0639\u0631\u0636 \u0633\u0639\u0631 \u062c\u062f\u064a\u062f (\u0646\u0633\u062e\u0629)';
            if (numLabel)  numLabel.classList.add('hidden');
            if (submitBtn) {
                submitBtn.querySelector('span').textContent = '\u062d\u0641\u0638 \u0639\u0631\u0636 \u0627\u0644\u0633\u0639\u0631';
                submitBtn.style.display = '';
            }

            // Switch back to edit mode: show save/cancel, hide back/clone/print
            if (cancelBtn)  cancelBtn.style.display = '';
            if (backBtn)    backBtn.classList.add('hidden');
            if (cloneBtn)   cloneBtn.classList.add('hidden');
            if (printBtn)   printBtn.classList.add('hidden');
            if (addItemBtn) addItemBtn.style.display = '';

            _openModal();

            // Enable all inputs
            const form = document.getElementById('quote-form') || document.getElementById('quote-modal');
            if (form) {
                form.querySelectorAll('input, select, textarea').forEach(el => {
                    el.disabled = false;
                });
            }

            // Clear items and rebuild from cloned order
            const container = document.getElementById('quote-items-container');
            if (container) container.innerHTML = '';

            if (Array.isArray(order.items) && order.items.length > 0) {
                order.items.forEach(item => {
                    window.addQuoteItemRow({
                        product_id:         item.product_id,
                        product_variant_id: item.product_variant_id,
                        quantity:           item.quantity,
                        unit_price:         item.unit_price,
                        design_status:      item.design_status || 'new',
                        design_id:          item.design_id || null,
                    });
                });
            } else {
                window.addQuoteItemRow();
            }

            // Populate terms checkboxes with cloned selections
            const savedTermIds = Array.isArray(order.terms_conditions)
                ? order.terms_conditions.map(t => t.id || t)
                : [];
            _renderTermsCheckboxes(savedTermIds);

            window.showToast('\u062a\u0645 \u0646\u0633\u062e \u0627\u0644\u0637\u0644\u0628. \u0639\u062f\u0644 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u062b\u0645 \u0627\u062d\u0641\u0638.', 'info');

        } catch (err) {
            window.showToast(err.message || '\u0641\u0634\u0644 \u0646\u0633\u062e \u0627\u0644\u0637\u0644\u0628.', 'error');
        }
    };

    // ==========================================================================
    // ── QUICK ADD PRODUCT MODAL ──────────────────────────────────────────────
    // ==========================================================================

    let _activeQuickRow = null; // the item row that triggered the quick-add

    function _openQuickProductModal(isEdit = false) {
        const modal    = document.getElementById('quick-product-modal');
        if (!modal) return;
        const nameEl   = document.getElementById('qp-name');
        const skuEl    = document.getElementById('qp-sku');
        const errBox   = document.getElementById('quick-product-error');
        const editIdEl = document.getElementById('quick-product-id');
        const titleEl  = modal.querySelector('h2');
        const submitBtn = document.getElementById('quick-product-submit-btn');

        if (!isEdit) {
            if (nameEl)   nameEl.value = '';
            if (skuEl)    skuEl.value  = '';
            if (editIdEl) editIdEl.value = '';
            if (titleEl)  titleEl.textContent = '\u0625\u0636\u0627\u0641\u0629 \u0645\u0646\u062a\u062c \u0633\u0631\u064a\u0639';
            if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i><span>\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u0646\u062a\u062c</span>';
        }
        if (errBox) errBox.classList.add('hidden');

        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('opacity-100');
            modal.querySelector('.quick-product-panel').classList.add('scale-100');
        });
        setTimeout(() => { if (nameEl) nameEl.focus(); }, 100);
    }

    function _closeQuickProductModal() {
        const modal = document.getElementById('quick-product-modal');
        if (!modal) return;
        modal.classList.remove('opacity-100');
        modal.querySelector('.quick-product-panel').classList.remove('scale-100');
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    }

    window.openQuickProductModal = function (btnEl) {
        _activeQuickRow = btnEl ? btnEl.closest('.quote-item-row') : null;
        _openQuickProductModal(false);
    };
    window.closeQuickProductModal = _closeQuickProductModal;

    window.openQuickProductEdit = function (btnEl) {
        const row = btnEl ? btnEl.closest('.quote-item-row') : null;
        _activeQuickRow = row;
        if (!row) return;

        const prodSel  = row.querySelector('select.row-product');
        const productId = prodSel ? prodSel.value : '';
        if (!productId) {
            window.showToast('\u064a\u0631\u062c\u0649 \u0627\u062e\u062a\u064a\u0627\u0631 \u0627\u0644\u0645\u0646\u062a\u062c \u0623\u0648\u0644\u0627\u064b.', 'warning');
            return;
        }

        const prod = _products.find(p => p.id === productId);
        if (!prod) {
            window.showToast('\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u0645\u0646\u062a\u062c.', 'error');
            return;
        }

        const nameEl    = document.getElementById('qp-name');
        const skuEl     = document.getElementById('qp-sku');
        const catEl     = document.getElementById('qp-category');
        const editIdEl  = document.getElementById('quick-product-id');
        const titleEl   = document.querySelector('#quick-product-modal h2');
        const submitBtn = document.getElementById('quick-product-submit-btn');

        const unitEl   = document.getElementById('qp-unit');

        if (nameEl)    nameEl.value   = prod.name || '';
        if (skuEl)     skuEl.value    = prod.sku || '';
        if (catEl)     catEl.value    = prod.category_id || '';
        if (editIdEl)  editIdEl.value = productId;
        if (titleEl)   titleEl.textContent = '\u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0645\u0646\u062a\u062c';
        if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i><span>\u062d\u0641\u0638 \u0627\u0644\u062a\u0639\u062f\u064a\u0644\u0627\u062a</span>';

        // Inherit unit_id from the product's first variant
        if (unitEl && Array.isArray(prod.variants) && prod.variants.length > 0) {
            unitEl.value = prod.variants[0].unit_id || '';
        }

        _openQuickProductModal(true);
    };

    window.submitQuickProductForm = async function () {
        const errBox    = document.getElementById('quick-product-error');
        const errSpan   = errBox ? errBox.querySelector('span') : null;
        const submitBtn = document.getElementById('quick-product-submit-btn');
        const nameVal   = (document.getElementById('qp-name')?.value || '').trim();
        const skuVal    = (document.getElementById('qp-sku')?.value || '').trim();
        const editId    = (document.getElementById('quick-product-id')?.value || '').trim();
        const isEdit    = !!editId;

        if (errBox) errBox.classList.add('hidden');

        if (!nameVal) {
            if (errSpan) errSpan.textContent = '\u0627\u0633\u0645 \u0627\u0644\u0645\u0646\u062a\u062c \u0645\u0637\u0644\u0648\u0628.';
            if (errBox) errBox.classList.remove('hidden');
            return;
        }

        if (submitBtn) {
            submitBtn.disabled  = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> \u062c\u0627\u0631\u064d \u0627\u0644\u062d\u0641\u0638...';
        }

        try {
            let res;
            const categoryVal = (document.getElementById('qp-category')?.value || '').trim();
            if (isEdit) {
                res = await window.apiFetch(`/api/products/${editId}`, {
                    method: 'PUT',
                    body: { name: nameVal, sku: skuVal || null, category_id: categoryVal || null },
                });
            } else {
                const unitVal = (document.getElementById('qp-unit')?.value || '').trim();
                res = await window.apiFetch('/api/products', {
                    method: 'POST',
                    body: {
                        name:        nameVal,
                        sku:         skuVal || null,
                        category_id: categoryVal || null,
                        status:      'active',
                        variants: [{
                            size_name:     '\u0627\u0641\u062a\u0631\u0627\u0636\u064a',
                            selling_price: 0,
                            unit_id:       unitVal || null,
                        }],
                    },
                });
            }

            if (res && res.data) {
                await _loadProducts();

                const newOptions = _buildProductOptions();
                document.querySelectorAll('select.row-product').forEach(sel => {
                    const currentVal = sel.value;
                    sel.innerHTML = newOptions;
                    if (currentVal) sel.value = currentVal;
                });

                if (_activeQuickRow && !isEdit) {
                    const prodSel = _activeQuickRow.querySelector('select.row-product');
                    if (prodSel) {
                        prodSel.value = res.data.id;
                        window._onRowProductChange(prodSel, _activeQuickRow.dataset.rowId);
                    }
                }

                window.showToast(
                    isEdit
                        ? `\u062a\u0645 \u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0645\u0646\u062a\u062c "${res.data.name}" \u0628\u0646\u062c\u0627\u062d.`
                        : `\u062a\u0645 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u0646\u062a\u062c "${res.data.name}" \u0628\u0646\u062c\u0627\u062d.`,
                    'success'
                );
                _closeQuickProductModal();
            }
        } catch (err) {
            if (errSpan) errSpan.textContent = err.message || '\u062d\u062f\u062b \u062e\u0637\u0623 \u063a\u064a\u0631 \u0645\u062a\u0648\u0642\u0639.';
            if (errBox)  errBox.classList.remove('hidden');
        } finally {
            if (submitBtn) {
                submitBtn.disabled  = false;
                submitBtn.innerHTML = isEdit
                    ? '<i class="fa-solid fa-floppy-disk"></i><span>\u062d\u0641\u0638 \u0627\u0644\u062a\u0639\u062f\u064a\u0644\u0627\u062a</span>'
                    : '<i class="fa-solid fa-plus"></i><span>\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u0646\u062a\u062c</span>';
            }
        }
    };

    // ==========================================================================
    // ── QUICK ADD SIZE (VARIANT) MODAL ───────────────────────────────────────
    // ==========================================================================

    function _openQuickSizeModal(isEdit = false) {
        const modal      = document.getElementById('quick-size-modal');
        if (!modal) return;
        const sizeNameEl = document.getElementById('qs-size-name');
        const sellingEl  = document.getElementById('qs-selling-price');
        const prodNameEl = document.getElementById('qs-product-name');
        const prodIdEl   = document.getElementById('qs-product-id');
        const editIdEl   = document.getElementById('quick-size-id');
        const errBox     = document.getElementById('quick-size-error');
        const titleEl    = modal.querySelector('h2');
        const submitBtn  = document.getElementById('quick-size-submit-btn');

        if (!isEdit) {
            if (sizeNameEl) sizeNameEl.value = '';
            if (sellingEl)  sellingEl.value  = '';
            if (editIdEl)   editIdEl.value   = '';
            if (titleEl)    titleEl.textContent = '\u0625\u0636\u0627\u0641\u0629 \u0645\u0642\u0627\u0633 \u0633\u0631\u064a\u0639';
            if (submitBtn)  submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i><span>\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u0642\u0627\u0633</span>';
        }
        if (errBox) errBox.classList.add('hidden');

        // Get selected product from the active row (for both add/edit)
        if (!isEdit) {
            let productId   = '';
            let productName = '\u2014';
            if (_activeQuickRow) {
                const prodSel = _activeQuickRow.querySelector('select.row-product');
                if (prodSel && prodSel.value) {
                    productId   = prodSel.value;
                    productName = prodSel.options[prodSel.selectedIndex]?.textContent || '\u2014';
                }
            }

            if (!productId) {
                window.showToast('\u064a\u0631\u062c\u0649 \u0627\u062e\u062a\u064a\u0627\u0631 \u0627\u0644\u0645\u0646\u062a\u062c \u0623\u0648\u0644\u0627\u064b \u0641\u064a \u0627\u0644\u0635\u0641.', 'warning');
                return;
            }

            if (prodNameEl) prodNameEl.textContent = productName;
            if (prodIdEl)   prodIdEl.value         = productId;
        }

        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('opacity-100');
            modal.querySelector('.quick-size-panel').classList.add('scale-100');
        });
        setTimeout(() => { if (sizeNameEl) sizeNameEl.focus(); }, 100);
    }

    function _closeQuickSizeModal() {
        const modal = document.getElementById('quick-size-modal');
        if (!modal) return;
        modal.classList.remove('opacity-100');
        modal.querySelector('.quick-size-panel').classList.remove('scale-100');
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    }

    window.openQuickSizeModal = function (btnEl) {
        _activeQuickRow = btnEl ? btnEl.closest('.quote-item-row') : null;
        _openQuickSizeModal(false);
    };
    window.closeQuickSizeModal = _closeQuickSizeModal;

    window.openQuickSizeEdit = function (btnEl) {
        const row = btnEl ? btnEl.closest('.quote-item-row') : null;
        _activeQuickRow = row;
        if (!row) return;

        const prodSel   = row.querySelector('select.row-product');
        const varSel    = row.querySelector('select.row-variant');
        const productId = prodSel ? prodSel.value : '';
        const variantId = varSel  ? varSel.value  : '';

        if (!productId) {
            window.showToast('\u064a\u0631\u062c\u0649 \u0627\u062e\u062a\u064a\u0627\u0631 \u0627\u0644\u0645\u0646\u062a\u062c \u0623\u0648\u0644\u0627\u064b.', 'warning');
            return;
        }
        if (!variantId) {
            window.showToast('\u064a\u0631\u062c\u0649 \u0627\u062e\u062a\u064a\u0627\u0631 \u0627\u0644\u0645\u0642\u0627\u0633 \u0623\u0648\u0644\u0627\u064b.', 'warning');
            return;
        }

        const prod = _products.find(p => p.id === productId);
        if (!prod) return;
        const variant = (prod.variants || []).find(v => v.id === variantId);
        if (!variant) {
            window.showToast('\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u0645\u0642\u0627\u0633.', 'error');
            return;
        }

        const sizeNameEl = document.getElementById('qs-size-name');
        const sellingEl  = document.getElementById('qs-selling-price');
        const prodNameEl = document.getElementById('qs-product-name');
        const prodIdEl   = document.getElementById('qs-product-id');
        const editIdEl   = document.getElementById('quick-size-id');
        const titleEl    = document.querySelector('#quick-size-modal h2');
        const submitBtn  = document.getElementById('quick-size-submit-btn');

        if (sizeNameEl) sizeNameEl.value   = variant.size_name || '';
        if (sellingEl)  sellingEl.value    = variant.selling_price || '';
        if (prodNameEl) prodNameEl.textContent = prod.name || '\u2014';
        if (prodIdEl)   prodIdEl.value     = productId;
        if (editIdEl)   editIdEl.value     = variantId;
        if (titleEl)    titleEl.textContent = '\u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0645\u0642\u0627\u0633';
        if (submitBtn)  submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i><span>\u062d\u0641\u0638 \u0627\u0644\u062a\u0639\u062f\u064a\u0644\u0627\u062a</span>';

        _openQuickSizeModal(true);
    };

    window.submitQuickSizeForm = async function () {
        const errBox      = document.getElementById('quick-size-error');
        const errSpan     = errBox ? errBox.querySelector('span') : null;
        const submitBtn   = document.getElementById('quick-size-submit-btn');
        const productId   = document.getElementById('qs-product-id')?.value || '';
        const sizeNameVal = (document.getElementById('qs-size-name')?.value || '').trim();
        const sellingVal  = parseFloat(document.getElementById('qs-selling-price')?.value) || 0;
        const editId      = (document.getElementById('quick-size-id')?.value || '').trim();

        // Inherit unit_id from the product's first variant (unit is product-level, not size-level)
        const prod = _products.find(p => p.id === productId);
        let inheritedUnitId = null;
        if (prod && Array.isArray(prod.variants) && prod.variants.length > 0) {
            inheritedUnitId = prod.variants[0].unit_id || null;
        }
        const isEdit      = !!editId;

        if (errBox) errBox.classList.add('hidden');

        if (!sizeNameVal) {
            if (errSpan) errSpan.textContent = '\u0627\u0633\u0645 \u0627\u0644\u0645\u0642\u0627\u0633 \u0645\u0637\u0644\u0648\u0628.';
            if (errBox) errBox.classList.remove('hidden');
            return;
        }

        if (!productId) {
            if (errSpan) errSpan.textContent = '\u0644\u0645 \u064a\u062a\u0645 \u062a\u062d\u062f\u064a\u062f \u0627\u0644\u0645\u0646\u062a\u062c.';
            if (errBox) errBox.classList.remove('hidden');
            return;
        }

        if (submitBtn) {
            submitBtn.disabled  = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> \u062c\u0627\u0631\u064d \u0627\u0644\u062d\u0641\u0638...';
        }

        try {
            let res;
            if (isEdit) {
                res = await window.apiFetch(`/api/products/${productId}/variants/${editId}`, {
                    method: 'PUT',
                    body: {
                        size_name:     sizeNameVal,
                        selling_price: sellingVal,
                        unit_id:       inheritedUnitId,
                    },
                });
            } else {
                res = await window.apiFetch(`/api/products/${productId}/variants`, {
                    method: 'POST',
                    body: {
                        size_name:     sizeNameVal,
                        selling_price: sellingVal,
                        unit_id:       inheritedUnitId,
                    },
                });
            }

            if (res && res.data) {
                await _loadProducts();

                // Re-trigger product change in active row to refresh variant dropdown
                if (_activeQuickRow) {
                    const prodSel = _activeQuickRow.querySelector('select.row-product');
                    if (prodSel) {
                        window._onRowProductChange(prodSel, _activeQuickRow.dataset.rowId);
                        // Auto-select the variant
                        const targetId = isEdit ? editId : res.data.id;
                        setTimeout(() => {
                            const varSel = _activeQuickRow.querySelector('select.row-variant');
                            if (varSel && targetId) {
                                varSel.value = targetId;
                                window._onRowVariantChange(varSel);
                            }
                        }, 100);
                    }
                }

                window.showToast(
                    isEdit
                        ? `\u062a\u0645 \u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0645\u0642\u0627\u0633 "${sizeNameVal}" \u0628\u0646\u062c\u0627\u062d.`
                        : `\u062a\u0645 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u0642\u0627\u0633 "${sizeNameVal}" \u0628\u0646\u062c\u0627\u062d.`,
                    'success'
                );
                _closeQuickSizeModal();
            }
        } catch (err) {
            if (errSpan) errSpan.textContent = err.message || '\u062d\u062f\u062b \u062e\u0637\u0623 \u063a\u064a\u0631 \u0645\u062a\u0648\u0642\u0639.';
            if (errBox)  errBox.classList.remove('hidden');
        } finally {
            if (submitBtn) {
                submitBtn.disabled  = false;
                submitBtn.innerHTML = isEdit
                    ? '<i class="fa-solid fa-floppy-disk"></i><span>\u062d\u0641\u0638 \u0627\u0644\u062a\u0639\u062f\u064a\u0644\u0627\u062a</span>'
                    : '<i class="fa-solid fa-plus"></i><span>\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u0642\u0627\u0633</span>';
            }
        }
    };

    // ==========================================================================
    // Client Designs Functions
    // ==========================================================================
    
    // Load designs for a specific variant when client is selected
    window.loadDesignsForRow = async function(row) {
        const clientSelect = document.getElementById('quote-client');
        const variantSelect = row.querySelector('.row-variant');
        const designSelect = row.querySelector('.row-design-select');
        
        if (!clientSelect || !variantSelect || !designSelect) {
            console.log('[loadDesignsForRow] Missing elements:', { clientSelect: !!clientSelect, variantSelect: !!variantSelect, designSelect: !!designSelect });
            return;
        }
        
        const clientId = clientSelect.value;
        const variantId = variantSelect.value;
        
        console.log('[loadDesignsForRow] Loading for client:', clientId, 'variant:', variantId);
        
        if (!clientId || !variantId) {
            console.log('[loadDesignsForRow] Missing clientId or variantId');
            return;
        }
        
        try {
            const res = await window.apiFetch(`/api/client-designs/${clientId}/${variantId}`);
            console.log('[loadDesignsForRow] API response:', res);
            const designs = res?.data || [];
            console.log('[loadDesignsForRow] Designs loaded:', designs.length, designs);
            
            // Save current selection (prefer saved design_id from dataset)
            const currentVal = row.dataset.designId || designSelect.value;
            
            // Clear and rebuild options
            designSelect.innerHTML = '<option value="new">+ تصميم جديد</option>';
            
            // Add existing designs
            designs.forEach((d, index) => {
                console.log(`[loadDesignsForRow] Adding design ${index}:`, d.id, d.design_name, 'thumbnail:', d.thumbnail_url);
                const option = document.createElement('option');
                option.value = d.id;
                option.textContent = `#${d.design_number} ${d.design_name || ''}`;
                option.dataset.thumbnail = d.thumbnail_url || '';
                option.dataset.name = d.design_name || `تصميم ${d.design_number}`;
                option.dataset.extension = _getFileExtension(d.thumbnail_url || '');
                designSelect.appendChild(option);
            });
            
            // Add reprint option at end
            const reprintOption = document.createElement('option');
            reprintOption.value = 'reprint';
            reprintOption.textContent = '↻ إعادة طباعة';
            designSelect.appendChild(reprintOption);
            
            // Restore previous selection if still valid, else select first design
            const validValues = ['new', 'reprint', ...designs.map(d => String(d.id))];
            if (validValues.includes(currentVal)) {
                designSelect.value = currentVal;
            } else if (designs.length > 0) {
                designSelect.value = designs[0].id;
            }
            
            // Attach change listener (idempotent)
            if (!designSelect._hasChangeListener) {
                designSelect.addEventListener('change', function() {
                    window.updateDesignPreview(row);
                });
                designSelect._hasChangeListener = true;
            }
            
            // Update preview based on current selection
            window.updateDesignPreview(row);
        } catch (err) {
            console.error('[loadDesignsForRow] Error:', err);
        }
    };

    // ==========================================================================
    // Update Design Preview
    // ==========================================================================
    window.updateDesignPreview = function(row) {
        const designSelect = row.querySelector('.row-design-select');
        const previewDiv = row.querySelector('.row-design-preview');
        const previewMedia = previewDiv?.querySelector('.design-preview-media');
        const previewText = previewDiv?.querySelector('span');
        const uploadBtn = row.querySelector('.row-design-upload');
        
        console.log('[updateDesignPreview] Running for row:', row?.dataset?.rowId);
        console.log('[updateDesignPreview] designSelect found:', !!designSelect);
        console.log('[updateDesignPreview] previewDiv found:', !!previewDiv);
        console.log('[updateDesignPreview] uploadBtn found:', !!uploadBtn);
        
        if (!designSelect) {
            console.log('[updateDesignPreview] No designSelect, returning');
            return;
        }
        
        const selectedIndex = designSelect.selectedIndex;
        const selectedOption = selectedIndex >= 0 ? designSelect.options[selectedIndex] : null;
        const isNew = designSelect.value === 'new';
        const isReprint = designSelect.value === 'reprint';
        
        console.log('[updateDesignPreview] Selected index:', selectedIndex, 'value:', designSelect.value);
        console.log('[updateDesignPreview] isNew:', isNew, 'isReprint:', isReprint);
        console.log('[updateDesignPreview] selectedOption:', selectedOption?.text);
        
        // ALWAYS hide preview div first
        previewDiv?.classList.add('hidden');
        
        if (isNew) {
            // Show upload button, hide preview
            if (uploadBtn) {
                uploadBtn.classList.remove('hidden');
                uploadBtn.style.display = 'flex';
            }
            return;
        }
        
        // For reprint or existing design - hide upload button, show preview
        if (uploadBtn) {
            uploadBtn.classList.add('hidden');
            uploadBtn.style.display = 'none';
        }
        
        // Show preview div
        previewDiv?.classList.remove('hidden');
        
        // Get thumbnail - for reprint or existing design
        let thumbnailUrl = null;
        let previewExt = selectedOption?.dataset?.extension || '';
        
        if (!isReprint && selectedOption?.dataset?.thumbnail) {
            // Regular design with thumbnail
            thumbnailUrl = selectedOption.dataset.thumbnail;
            previewExt = selectedOption.dataset.extension || previewExt;
            console.log('[updateDesignPreview] Got thumbnail from selected:', thumbnailUrl);
        } else if (isReprint) {
            // For reprint, find first design with thumbnail
            console.log('[updateDesignPreview] Looking for thumbnail in all options...');
            for (let i = 0; i < designSelect.options.length; i++) {
                const opt = designSelect.options[i];
                console.log(`[updateDesignPreview] Option ${i}: value=${opt.value}, thumbnail=${opt.dataset?.thumbnail}`);
                if (opt.dataset?.thumbnail && opt.value !== 'new' && opt.value !== 'reprint') {
                    thumbnailUrl = opt.dataset.thumbnail;
                    previewExt = opt.dataset.extension || previewExt;
                    console.log('[updateDesignPreview] Found thumbnail:', thumbnailUrl);
                    break;
                }
            }
        }
        
        console.log('[updateDesignPreview] Final thumbnailUrl:', thumbnailUrl);
        if (previewMedia) {
            previewMedia.innerHTML = _buildDesignPreviewHTML(
                thumbnailUrl,
                selectedOption?.dataset?.name || 'تصميم',
                {
                    variant: 'chip',
                    extensionOverride: previewExt || _getFileExtension(thumbnailUrl)
                }
            );
        }
        if (previewText) {
            previewText.textContent = isReprint ? 'آخر تصميم' : (selectedOption?.dataset?.name || '');
        }
    };
    
    // ==========================================================================
    // Design Gallery Modal
    // ==========================================================================
    
    window._galleryCurrentRow = null;

    window.openDesignGallery = async function(btn) {
        const row = btn.closest('.quote-item-row');
        if (!row) return;
        window._galleryCurrentRow = row;

        const clientId = document.getElementById('quote-client')?.value || '';
        const variantId = row.querySelector('.row-variant')?.value || '';
        const currentDesignId = row.querySelector('.row-design-select')?.value || '';

        const modal = document.getElementById('design-gallery-modal');
        const loading = document.getElementById('gallery-loading');
        const empty = document.getElementById('gallery-empty');
        const grid = document.getElementById('gallery-grid');
        const subtitle = document.getElementById('gallery-subtitle');

        if (!modal) return;

        // Reset states
        loading.classList.remove('hidden');
        empty.classList.add('hidden');
        grid.classList.add('hidden');
        grid.innerHTML = '';

        // Show modal
        modal.style.display = 'flex';
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            modal.querySelector('.modal-panel')?.classList.remove('scale-95');
        }, 10);

        if (!clientId || !variantId) {
            loading.classList.add('hidden');
            empty.classList.remove('hidden');
            subtitle.textContent = 'اختر العميل والمقاس أولاً';
            return;
        }

        try {
            const res = await window.apiFetch(`/api/client-designs/${clientId}/${variantId}`);
            const designs = res?.data || [];
            loading.classList.add('hidden');

            if (designs.length === 0) {
                empty.classList.remove('hidden');
                subtitle.textContent = 'لا توجد تصاميم - ارفع تصميم جديد';
                return;
            }

            subtitle.textContent = `${designs.length} تصميم متاح`;
            grid.classList.remove('hidden');

            // Sort: latest first
            designs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            designs.forEach((d, idx) => {
                const isSelected = String(d.id) === String(currentDesignId);
                const isLatest = idx === 0;
                const thumbUrl = d.thumbnail_url || '';
                const designName = d.design_name || `تصميم ${d.design_number || (idx + 1)}`;
                const dateStr = d.created_at ? new Date(d.created_at).toLocaleDateString('en-GB') : '';
                const fileExt = _getFileExtension(thumbUrl);
                const previewMarkup = _buildDesignPreviewHTML(thumbUrl, designName, { variant: 'card', extensionOverride: fileExt });

                const card = document.createElement('div');
                card.className = `design-gallery-card relative group rounded-xl border-2 overflow-hidden cursor-pointer
                    transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5
                    ${isSelected ? 'border-brand-500 ring-2 ring-brand-500/20 bg-brand-50' : 'border-slate-200 hover:border-purple-300 bg-white'}`;
                card.dataset.designId = d.id;

                const dataUrlAttr = _escapeAttr(thumbUrl || '');
                const dataNameAttr = _escapeAttr(designName);
                const dataDateAttr = _escapeAttr(dateStr);
                const dataExtAttr = _escapeAttr(fileExt);

                card.innerHTML = `
                    <!-- Preview -->
                    <div class="relative w-full h-32 bg-slate-100 overflow-hidden">
                        <div class="absolute inset-0 pointer-events-none">
                            ${previewMarkup}
                        </div>
                        ${isLatest ? '<span class="absolute top-2 left-2 px-2 py-0.5 bg-amber-500 text-white text-[9px] font-bold rounded-full shadow">الأحدث</span>' : ''}
                        ${isSelected ? '<span class="absolute top-2 right-2 w-6 h-6 bg-brand-500 text-white rounded-full flex items-center justify-center shadow"><i class="fa-solid fa-check text-xs"></i></span>' : ''}
                        <!-- Zoom overlay -->
                        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                            <button type="button"
                                    data-url="${dataUrlAttr}"
                                    data-name="${dataNameAttr}"
                                    data-date="${dataDateAttr}"
                                    data-ext="${dataExtAttr}"
                                    onclick="event.stopPropagation(); window.openDesignViewer(this)"
                                    class="opacity-0 group-hover:opacity-100 w-10 h-10 bg-white/90 backdrop-blur-sm rounded-full
                                           flex items-center justify-center shadow-lg transition-all hover:bg-white">
                                <i class="fa-solid fa-expand text-slate-700"></i>
                            </button>
                        </div>
                    </div>
                    <!-- Info -->
                    <div class="p-2.5">
                        <p class="text-xs font-bold text-slate-700 truncate">${designName}</p>
                        <p class="text-[10px] text-slate-400 mt-0.5">${dateStr}</p>
                    </div>
                `;

                // Click to select design
                card.addEventListener('click', () => {
                    window._selectDesignFromGallery(d.id, row);
                });

                grid.appendChild(card);
            });
        } catch (err) {
            console.error('[openDesignGallery] Error:', err);
            loading.classList.add('hidden');
            empty.classList.remove('hidden');
            subtitle.textContent = 'خطأ في تحميل التصاميم';
        }
    };

    window._selectDesignFromGallery = function(designId, row) {
        const designSelect = row.querySelector('.row-design-select');
        if (!designSelect) return;

        // Set dropdown value
        const option = designSelect.querySelector(`option[value="${designId}"]`);
        if (option) {
            designSelect.value = designId;
        }

        // Update preview
        window.updateDesignPreview(row);

        // Close gallery
        window.closeDesignGallery();

        // Show success toast
        if (window.showToast) {
            window.showToast('تم اختيار التصميم', 'success');
        }
    };

    window.closeDesignGallery = function() {
        const modal = document.getElementById('design-gallery-modal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        modal.querySelector('.modal-panel')?.classList.add('scale-95');
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    };

    // ==========================================================================
    // Design Viewer (Full-size)
    // ==========================================================================

    window.openDesignViewer = function(trigger, fallbackName, fallbackDate, fallbackExt) {
        let fileUrl = '';
        let designName = fallbackName || '';
        let designDate = fallbackDate || '';
        let designExt = fallbackExt || '';

        if (trigger && trigger.dataset) {
            fileUrl = trigger.dataset.url || '';
            designName = trigger.dataset.name || designName;
            designDate = trigger.dataset.date || designDate;
            designExt = trigger.dataset.ext || designExt;
        } else {
            fileUrl = trigger || '';
        }

        const modal = document.getElementById('design-viewer-modal');
        const content = document.getElementById('design-viewer-content');
        const nameEl = document.getElementById('design-viewer-name');
        const dateEl = document.getElementById('design-viewer-date');
        if (!modal || !content) return;

        content.innerHTML = _buildDesignPreviewHTML(fileUrl, designName, { variant: 'modal', extensionOverride: designExt });
        if (nameEl) nameEl.textContent = designName || '';
        if (dateEl) dateEl.textContent = designDate || '';

        modal.style.display = 'flex';
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            modal.querySelector('.modal-panel')?.classList.remove('scale-95');
        }, 10);
    };

    window.closeDesignViewer = function(event) {
        if (event && event.target !== event.currentTarget && !event.target.closest('button')) return;
        const modal = document.getElementById('design-viewer-modal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        modal.querySelector('.modal-panel')?.classList.add('scale-95');
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    };

    // Open upload from gallery context
    window.openDesignUploadFromGallery = function() {
        window.closeDesignGallery();
        const row = window._galleryCurrentRow;
        if (row) {
            const uploadBtn = row.querySelector('.row-design-upload');
            if (uploadBtn) {
                window.openDesignUploadModal(uploadBtn);
            }
        }
    };

    // Open design upload modal
    window.openDesignUploadModal = function(btn) {
        const row = btn.closest('.quote-item-row');
        const rowId = row?.dataset?.rowId;
        
        // Store current row for callback
        window._currentDesignUploadRow = row;
        
        // Reset form
        const form = document.getElementById('design-upload-form');
        if (form) form.reset();
        
        const preview = document.getElementById('design-upload-preview');
        if (preview) {
            preview.src = '';
            preview.classList.add('hidden');
        }
        
        // Show modal
        const modal = document.getElementById('design-upload-modal');
        if (modal) {
            modal.style.display = 'flex';
            setTimeout(() => {
                modal.classList.remove('opacity-0');
                modal.querySelector('.modal-panel')?.classList.remove('scale-95');
            }, 10);
        }
    };
    
    // Close design upload modal
    window.closeDesignUploadModal = function() {
        const modal = document.getElementById('design-upload-modal');
        if (modal) {
            modal.classList.add('opacity-0');
            modal.querySelector('.modal-panel')?.classList.add('scale-95');
            setTimeout(() => {
                modal.style.display = 'none';
                window._currentDesignUploadRow = null;
            }, 200);
        }
    };
    
    // Preview selected file in modal
    window.previewDesignFile = function(input) {
        if (input.files && input.files[0]) {
            const file = input.files[0];
            const reader = new FileReader();
            
            reader.onload = function(e) {
                const previewImg = document.getElementById('design-modal-preview-img');
                const previewDiv = document.getElementById('design-modal-preview');
                const fileLabel = document.getElementById('design-file-label');
                
                if (previewImg && previewDiv) {
                    previewImg.src = e.target.result;
                    previewDiv.classList.remove('hidden');
                    
                    // Hide file label
                    if (fileLabel) {
                        fileLabel.classList.add('hidden');
                    }
                }
            };
            
            reader.readAsDataURL(file);
        }
    };
    
    // Clear selected file
    window.clearDesignFile = function() {
        const fileInput = document.getElementById('design-file-input');
        const previewImg = document.getElementById('design-modal-preview-img');
        const previewDiv = document.getElementById('design-modal-preview');
        const fileLabel = document.getElementById('design-file-label');
        
        if (fileInput) fileInput.value = '';
        if (previewImg) previewImg.src = '';
        if (previewDiv) previewDiv.classList.add('hidden');
        if (fileLabel) fileLabel.classList.remove('hidden');
    };
    
    // Handle design file upload
    window.uploadDesign = async function() {
        const row = window._currentDesignUploadRow;
        
        // Get client_id and variant_id from row dataset or from select elements
        const clientId = row?.dataset?.clientId || document.getElementById('quote-client')?.value;
        const variantId = row?.dataset?.variantId || row?.querySelector('.row-variant')?.value;
        
        if (!row || !clientId || !variantId) {
            alert('خطأ: لم يتم العثور على بيانات الصنف');
            return;
        }
        const fileInput = document.getElementById('design-file-input');
        const nameInput = document.getElementById('design-name-input');
        const uploadBtn = document.getElementById('design-upload-btn');
        
        if (!fileInput?.files?.[0]) {
            alert('اختر ملف التصميم أولاً');
            return;
        }
        
        // Show loading state
        if (uploadBtn) {
            uploadBtn.disabled = true;
            uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الرفع...';
        }
        
        const formData = new FormData();
        formData.append('client_id', clientId);
        formData.append('variant_id', variantId);
        formData.append('thumbnail', fileInput.files[0]);
        formData.append('design_name', nameInput?.value || '');
        
        try {
            const res = await fetch('/api/client-designs', {
                method: 'POST',
                credentials: 'include',
                body: formData
            });
            
            const data = await res.json();
            
            if (data.success) {
                // Get the new design data
                const newDesign = data.data;
                console.log('[Upload] New design:', newDesign);
                
                // Add the new design to the dropdown immediately
                const designSelect = row.querySelector('.row-design-select');
                console.log('[Upload] Design select found:', !!designSelect, 'ID:', newDesign?.id);
                
                if (designSelect && newDesign?.id) {
                    // Check if option already exists
                    let option = designSelect.querySelector(`option[value="${newDesign.id}"]`);
                    if (!option) {
                        // Create new option
                        option = document.createElement('option');
                        option.value = newDesign.id;
                        option.textContent = newDesign.design_name || 'تصميم جديد';
                        option.dataset.thumbnail = newDesign.thumbnail_url || '';
                        option.dataset.name = newDesign.design_name || 'تصميم جديد';
                        option.dataset.extension = _getFileExtension(newDesign.thumbnail_url || '');
                        console.log('[Upload] Created option:', option.dataset);
                        
                        // Add before the 'new' option (which should be last)
                        const newOption = designSelect.querySelector('option[value="new"]');
                        if (newOption) {
                            designSelect.insertBefore(option, newOption);
                        } else {
                            designSelect.appendChild(option);
                        }
                    }
                    
                    // Select the new design
                    designSelect.value = newDesign.id;
                    console.log('[Upload] Selected value:', designSelect.value);
                    
                    // Update preview immediately
                    window.updateDesignPreview(row);
                    console.log('[Upload] Preview updated');
                    
                    // Don't refresh immediately - it will reset the selection
                    // Just update the row dataset for future reference
                    row.dataset.variantId = newDesign.variant_id;
                }
                
                window.closeDesignUploadModal();
                
                // Show success toast
                if (window._toast) {
                    window._toast('تم رفع التصميم بنجاح', 'success');
                } else {
                    alert('تم رفع التصميم بنجاح');
                }
            } else {
                alert(data.error || 'فشل رفع التصميم');
            }
        } catch (err) {
            console.error('[Quotations] Upload error:', err);
            alert('فشل رفع التصميم');
        } finally {
            // Reset button
            if (uploadBtn) {
                uploadBtn.disabled = false;
                uploadBtn.innerHTML = '<i class="fa-solid fa-check"></i> رفع التصميم';
            }
        }
    };

    // ==========================================================================
    // initQuotationsView()
    // Entry point — wires listeners then loads data.
    // ==========================================================================
    async function initQuotationsView() {
        var _myToken = window.getCurrentNavToken ? window.getCurrentNavToken() : 0;
        _wireModalEvents();
        _initSearch();

        const addBtn = document.getElementById('add-quote-btn');
        if (addBtn) addBtn.addEventListener('click', () => window.openQuoteModal());

        const addItemBtn = document.getElementById('add-item-row-btn');
        if (addItemBtn) addItemBtn.addEventListener('click', () => window.addQuoteItemRow());

        const quickClientBtn = document.getElementById('quick-add-client-btn');
        if (quickClientBtn) quickClientBtn.addEventListener('click', _openQuickClientModal);

        const historyBtn = document.getElementById('client-history-btn');
        if (historyBtn) historyBtn.addEventListener('click', _openClientHistoryModal);

        // Load reference data, terms, and quotes in parallel
        await Promise.all([
            _loadClients(),
            _loadProducts(),
            _loadCategories(),
            _loadUnits(),
            _loadTerms(),
            loadQuotes(),
        ]);
        _populateQuickModalDropdowns();
        if (window.isViewActive && !window.isViewActive(_myToken)) return;
    }

    // ==========================================================================
    // window.shareQuote(orderId) — shows share modal with link + client response
    // ==========================================================================
    window.shareQuote = async function(orderId) {
        const modal         = document.getElementById('share-quote-modal');
        const linkEl        = document.getElementById('share-quote-link');
        const linkRow       = document.getElementById('share-link-row');
        const statusEl      = document.getElementById('share-quote-status');
        const receiptSection = document.getElementById('share-receipt-section');
        const copyBtn       = document.getElementById('copy-link-btn');
        if (!modal) return;

        // Show modal and reset
        if (linkEl)          linkEl.value = 'جاري التحميل...';
        if (statusEl)        statusEl.innerHTML = '';
        if (receiptSection)  receiptSection.innerHTML = '';
        if (receiptSection)  receiptSection.classList.add('hidden');
        if (linkRow)         linkRow.classList.remove('hidden');
        if (copyBtn)         copyBtn.classList.remove('hidden');
        modal.style.display = 'flex';
        setTimeout(() => { modal.style.opacity = '1'; }, 10);

        try {
            // Step 1: Load order data first
            const orderRes = await window.apiFetch(`/api/orders/${orderId}`);
            const order = orderRes?.data;
            if (!order) throw new Error('لم يتم إيجاد العرض.');

            // Step 2: Determine token — reuse if still valid, otherwise generate new
            let token = order.share_token;
            let expires = order.token_expires_at;
            const tokenStillValid = token && expires && new Date(expires) > new Date();

            if (!tokenStillValid) {
                const shareRes = await window.apiFetch(`/api/public/quotations/${orderId}/share`, {
                    method: 'POST',
                    body: { expires_days: 7 },
                });
                token   = shareRes?.data?.token;
                expires = shareRes?.data?.expires_at;
                if (!token) throw new Error('فشل إنشاء الرابط.');
            }

            const url = `${window.location.origin}/public-quotation.html?token=${token}`;
            if (linkEl) linkEl.value = url;

            if (statusEl && expires) {
                const d = new Date(expires).toLocaleDateString('en-GB');
                statusEl.innerHTML = `<span class="text-xs text-slate-400"><i class="fa-regular fa-clock ml-1"></i>صالح حتى: ${d}</span>`;
            }

            // Step 3: Show client response state
            if (order.client_response === 'approved') {
                if (receiptSection) {
                    const receiptDate = order.responded_at ? new Date(order.responded_at).toLocaleDateString('en-GB') : '';
                    receiptSection.innerHTML = `
                        <div class="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
                            <div class="flex items-center gap-2">
                                <i class="fa-solid fa-circle-check text-emerald-500"></i>
                                <p class="text-xs font-bold text-emerald-700">وافق العميل على العرض${receiptDate ? ' — ' + receiptDate : ''}</p>
                            </div>
                            ${order.deposit_receipt
                                ? `<a href="${order.deposit_receipt}" target="_blank"
                                      class="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700">
                                       <i class="fa-solid fa-file-arrow-down"></i> عرض الإيصال المرفوع
                                   </a>`
                                : `<p class="text-xs text-slate-400"><i class="fa-solid fa-circle-info ml-1"></i>وافق بدون رفع إيصال</p>`
                            }
                        </div>`;
                    receiptSection.classList.remove('hidden');
                }
            } else if (order.client_response === 'rejected') {
                if (receiptSection) {
                    const rejectDate = order.responded_at ? new Date(order.responded_at).toLocaleDateString('en-GB') : '';
                    receiptSection.innerHTML = `
                        <div class="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl space-y-1">
                            <div class="flex items-center gap-2">
                                <i class="fa-solid fa-circle-xmark text-red-500"></i>
                                <p class="text-xs font-bold text-red-700">رفض العميل العرض${rejectDate ? ' — ' + rejectDate : ''}</p>
                            </div>
                            ${order.rejection_reason
                                ? `<p class="text-xs text-slate-600 bg-white border border-red-100 rounded-lg px-3 py-2 mt-1">
                                       <span class="font-bold text-slate-500">السبب:</span> ${order.rejection_reason}
                                   </p>`
                                : ''
                            }
                            <p class="text-xs text-slate-400 mt-1">يمكنك تعديل العرض وإرسال رابط جديد للعميل.</p>
                        </div>`;
                    receiptSection.classList.remove('hidden');
                }
            }

            await loadQuotes();
        } catch (err) {
            if (linkEl) linkEl.value = 'حدث خطأ: ' + (err.message || 'غير معروف');
        }
    };

    window.copyShareLink = function() {
        const linkEl = document.getElementById('share-quote-link');
        if (!linkEl || !linkEl.value || linkEl.value.startsWith('جاري') || linkEl.value.startsWith('حدث')) return;
        navigator.clipboard.writeText(linkEl.value).then(() => {
            const btn = document.getElementById('copy-link-btn');
            if (btn) {
                btn.innerHTML = '<i class="fa-solid fa-check"></i> تم النسخ!';
                btn.classList.add('bg-emerald-600');
                btn.classList.remove('bg-brand-600');
                setTimeout(() => {
                    btn.innerHTML = '<i class="fa-solid fa-copy"></i> نسخ الرابط';
                    btn.classList.remove('bg-emerald-600');
                    btn.classList.add('bg-brand-600');
                }, 2000);
            }
        });
    };

    window.closeShareModal = function() {
        const modal = document.getElementById('share-quote-modal');
        if (modal) { modal.style.opacity = '0'; setTimeout(() => { modal.style.display = 'none'; }, 200); }
    };

    // ==========================================================================
    // Price History Modal Functions
    // ==========================================================================

    const _priceHistoryStatusMap = {
        quote:      { label: 'عرض سعر',  cls: 'bg-blue-100 text-blue-700'     },
        confirmed:  { label: 'مؤكد',      cls: 'bg-emerald-100 text-emerald-700' },
        production: { label: 'إنتاج',     cls: 'bg-amber-100 text-amber-700'   },
        delivered:  { label: 'مُسلَّم',   cls: 'bg-slate-100 text-slate-600'   },
        archived:   { label: 'مؤرشف',    cls: 'bg-gray-100 text-gray-500'     },
    };

    window.openPriceHistoryModal = async function(clientId, variantId, productName = '') {
        const modal = document.getElementById('price-history-modal');
        const body  = document.getElementById('price-history-body');
        const subtitle = document.getElementById('price-history-subtitle');
        if (!modal || !body) return;

        // Update subtitle with product name if available
        if (subtitle && productName) {
            subtitle.textContent = `للصنف: ${productName}`;
        }

        // Show loading
        body.innerHTML = `
            <div class="text-center py-8">
                <i class="fa-solid fa-circle-notch fa-spin text-2xl text-slate-300"></i>
                <p class="text-xs text-slate-400 mt-2">جاري تحميل تاريخ الأسعار...</p>
            </div>
        `;
        modal.style.display = 'flex';
        requestAnimationFrame(() => { modal.classList.add('opacity-100'); modal.querySelector('div').classList.add('scale-100'); });

        try {
            const res = await window.apiFetch(`/api/orders/price-history?client_id=${clientId}&variant_id=${variantId}`);
            const history = (res && res.history) ? res.history : [];

            if (!history.length) {
                body.innerHTML = `
                    <div class="text-center py-8">
                        <i class="fa-solid fa-inbox text-3xl text-slate-200 mb-3"></i>
                        <p class="text-sm text-slate-500">لا توجد طلبات سابقة لهذا الصنف مع العميل</p>
                    </div>
                `;
                return;
            }

            body.innerHTML = history.map((h, idx) => {
                const status = _priceHistoryStatusMap[h.status] || { label: h.status, cls: 'bg-slate-100 text-slate-500' };
                const dateStr = h.order_date ? new Date(h.order_date).toLocaleDateString('en-GB') : '—';
                const price = Number(h.unit_price || 0).toFixed(2);
                const qty   = Math.round(Number(h.quantity || 0));
                const total = Number(h.line_total || 0).toFixed(2);
                const grandTotal = Number(h.grand_total || 0).toFixed(2);
                const itemCount = h.item_count || 1;
                const totalQty = Math.round(Number(h.total_qty || h.quantity || 0));

                return `
                    <div class="mb-3 rounded-xl border border-slate-100 bg-slate-50/50 overflow-hidden ${idx === 0 ? 'ring-1 ring-emerald-200 bg-emerald-50/30' : ''}">
                        <!-- Header: Order Info -->
                        <div class="px-4 py-3 flex items-center justify-between border-b border-slate-100 bg-white">
                            <div class="flex items-center gap-2">
                                <button onclick="window.openOrderDetailsModal('${h.id}')"
                                        class="font-mono font-bold text-brand-600 text-sm hover:underline cursor-pointer bg-transparent border-0 p-0">
                                    #${h.order_number || '—'}
                                </button>
                                <span class="text-xs text-slate-400">|</span>
                                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${status.cls}">${status.label}</span>
                            </div>
                            <span class="text-xs text-slate-500 font-medium">${dateStr}</span>
                        </div>

                        <!-- Order Summary -->
                        <div class="px-4 py-2 bg-slate-50 border-b border-slate-100">
                            <div class="flex items-center justify-between text-xs">
                                <span class="text-slate-500">العرض يحتوي على <strong class="text-slate-700">${itemCount}</strong> أصناف</span>
                                <span class="text-slate-500">إجمالي كميات العرض: <strong class="text-slate-700">${totalQty}</strong></span>
                            </div>
                        </div>

                        <!-- This Item Details -->
                        <div class="px-4 py-3">
                            <p class="text-[10px] text-slate-400 mb-2 uppercase tracking-wide">تفاصيل هذا الصنف في العرض</p>
                            <div class="grid grid-cols-3 gap-3 text-center">
                                <div class="bg-white rounded-lg border border-slate-100 p-2">
                                    <p class="text-xs text-slate-400 mb-1">الكمية</p>
                                    <p class="text-sm font-bold text-slate-700">${qty}</p>
                                </div>
                                <div class="bg-white rounded-lg border border-slate-100 p-2">
                                    <p class="text-xs text-slate-400 mb-1">سعر الوحدة</p>
                                    <p class="text-sm font-bold text-emerald-600">${price}</p>
                                </div>
                                <div class="bg-white rounded-lg border border-slate-100 p-2">
                                    <p class="text-xs text-slate-400 mb-1">إجمالي الصنف</p>
                                    <p class="text-sm font-bold text-brand-600">${total}</p>
                                </div>
                            </div>
                        </div>

                        <!-- Order Grand Total -->
                        <div class="px-4 py-2 bg-gradient-to-l from-brand-50 to-white border-t border-slate-100">
                            <div class="flex items-center justify-between">
                                <span class="text-xs text-slate-500">إجمالي العرض كامل (مع الضريبة)</span>
                                <span class="text-sm font-black text-brand-700">${grandTotal} ر.س</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            body.innerHTML = `
                <div class="text-center py-8">
                    <i class="fa-solid fa-circle-exclamation text-2xl text-red-300 mb-2"></i>
                    <p class="text-sm text-red-500">فشل تحميل تاريخ الأسعار</p>
                    <p class="text-xs text-slate-400 mt-1">${err.message || ''}</p>
                </div>
            `;
        }
    };

    window.closePriceHistoryModal = function() {
        const modal = document.getElementById('price-history-modal');
        if (modal) {
            modal.classList.remove('opacity-100');
            modal.querySelector('div').classList.remove('scale-100');
            setTimeout(() => { modal.style.display = 'none'; }, 200);
        }
    };

    // ==========================================================================
    // Purchase Price History Modal
    // ==========================================================================

    window.openPurchasePriceHistoryModal = async function(variantId, productName = '') {
        const modal = document.getElementById('price-history-modal');
        const body  = document.getElementById('price-history-body');
        const subtitle = document.getElementById('price-history-subtitle');
        if (!modal || !body) return;

        if (subtitle) {
            subtitle.textContent = `أسعار شراء: ${productName}`;
        }

        body.innerHTML = `
            <div class="text-center py-8">
                <i class="fa-solid fa-circle-notch fa-spin text-2xl text-slate-300"></i>
                <p class="text-xs text-slate-400 mt-2">جاري تحميل أسعار الشراء...</p>
            </div>
        `;
        modal.style.display = 'flex';
        requestAnimationFrame(() => { modal.classList.add('opacity-100'); modal.querySelector('div').classList.add('scale-100'); });

        try {
            const res = await window.apiFetch(`/api/orders/purchase-price-history?variant_id=${variantId}`);
            const history = (res && res.history) ? res.history : [];

            if (!history.length) {
                body.innerHTML = `
                    <div class="text-center py-8">
                        <i class="fa-solid fa-inbox text-3xl text-slate-200 mb-3"></i>
                        <p class="text-sm text-slate-500">لا توجد فواتير شراء سابقة لهذا الصنف</p>
                    </div>
                `;
                return;
            }

            body.innerHTML = history.map((h, idx) => {
                const dateStr = h.invoice_date ? new Date(h.invoice_date).toLocaleDateString('en-GB') : '—';
                const price = Number(h.unit_cost || 0).toFixed(2);
                const qty   = Math.round(Number(h.quantity || 0));
                const total = Number(h.total_cost || 0).toFixed(2);
                const supplier = h.supplier_name || '—';

                return `
                    <div class="mb-3 rounded-xl border border-slate-100 bg-slate-50/50 overflow-hidden ${idx === 0 ? 'ring-1 ring-blue-200 bg-blue-50/30' : ''}">
                        <!-- Header: Invoice Info -->
                        <div class="px-4 py-3 flex items-center justify-between border-b border-slate-100 bg-white">
                            <div class="flex items-center gap-2">
                                <span class="font-mono font-bold text-blue-600 text-sm">#${h.invoice_number || '—'}</span>
                                <span class="text-xs text-slate-400">|</span>
                                <span class="text-xs font-semibold text-slate-600"><i class="fa-solid fa-industry ml-1 text-slate-400"></i>${supplier}</span>
                            </div>
                            <span class="text-xs text-slate-500 font-medium">${dateStr}</span>
                        </div>

                        <!-- Item Details -->
                        <div class="px-4 py-3">
                            <div class="grid grid-cols-3 gap-3 text-center">
                                <div class="bg-white rounded-lg border border-slate-100 p-2">
                                    <p class="text-xs text-slate-400 mb-1">الكمية</p>
                                    <p class="text-sm font-bold text-slate-700">${qty}</p>
                                </div>
                                <div class="bg-white rounded-lg border border-slate-100 p-2">
                                    <p class="text-xs text-slate-400 mb-1">سعر الشراء</p>
                                    <p class="text-sm font-bold text-blue-600">${price}</p>
                                </div>
                                <div class="bg-white rounded-lg border border-slate-100 p-2">
                                    <p class="text-xs text-slate-400 mb-1">إجمالي الصنف</p>
                                    <p class="text-sm font-bold text-slate-700">${total}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            body.innerHTML = `
                <div class="text-center py-8">
                    <i class="fa-solid fa-circle-exclamation text-2xl text-red-300 mb-2"></i>
                    <p class="text-sm text-red-500">فشل تحميل أسعار الشراء</p>
                    <p class="text-xs text-slate-400 mt-1">${err.message || ''}</p>
                </div>
            `;
        }
    };

    // ==========================================================================
    // Order Details Modal Functions
    // ==========================================================================

    window.openOrderDetailsModal = async function(orderId) {
        const modal = document.getElementById('order-details-modal');
        const body  = document.getElementById('order-details-body');
        const subtitle = document.getElementById('order-details-subtitle');
        if (!modal || !body) return;

        // Show loading
        body.innerHTML = `
            <div class="text-center py-8">
                <i class="fa-solid fa-circle-notch fa-spin text-2xl text-slate-300"></i>
                <p class="text-xs text-slate-400 mt-2">جاري تحميل تفاصيل العرض...</p>
            </div>
        `;
        modal.style.display = 'flex';
        requestAnimationFrame(() => { modal.classList.add('opacity-100'); modal.querySelector('div').classList.add('scale-100'); });

        try {
            const res = await window.apiFetch(`/api/orders/${orderId}/details`);
            if (!res || !res.order) {
                body.innerHTML = `
                    <div class="text-center py-8">
                        <i class="fa-solid fa-circle-exclamation text-2xl text-red-300 mb-2"></i>
                        <p class="text-sm text-red-500">لم يتم العثور على العرض</p>
                    </div>
                `;
                return;
            }

            const order = res.order;
            const items = res.items || [];
            const status = _priceHistoryStatusMap[order.status] || { label: order.status, cls: 'bg-slate-100 text-slate-500' };
            const dateStr = order.order_date ? new Date(order.order_date).toLocaleDateString('en-GB') : '—';

            if (subtitle) {
                subtitle.textContent = `#${order.order_number || '—'} | ${order.client_name || '—'}`;
            }

            // Calculate totals
            const subtotal = items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
            const vat = subtotal * 0.15;

            body.innerHTML = `
                <!-- Order Header -->
                <div class="mb-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div class="flex items-center justify-between mb-2">
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${status.cls}">${status.label}</span>
                        <span class="text-xs text-slate-500">${dateStr}</span>
                    </div>
                    <div class="text-sm font-bold text-slate-700">${order.client_name || '—'}</div>
                </div>

                <!-- Items Table -->
                <div class="mb-4">
                    <p class="text-[10px] text-slate-400 mb-2 uppercase tracking-wide">الأصناف (${items.length})</p>
                    <div class="space-y-2">
                        ${items.map(item => `
                            <div class="p-3 bg-white rounded-lg border border-slate-100">
                                <div class="flex items-start justify-between gap-2">
                                    <div class="min-w-0">
                                        <p class="text-sm font-bold text-slate-700 truncate">${item.product_name || '—'}</p>
                                        <p class="text-xs text-slate-400">${item.size_name || ''} ${item.product_code ? '| ' + item.product_code : ''}</p>
                                    </div>
                                    <div class="text-left shrink-0">
                                        <p class="text-sm font-bold text-brand-600">${Number(item.line_total || 0).toFixed(2)}</p>
                                    </div>
                                </div>
                                <div class="mt-2 flex items-center gap-3 text-xs text-slate-500">
                                    <span>الكمية: <strong>${Math.round(Number(item.quantity || 0))}</strong></span>
                                    <span>|</span>
                                    <span>السعر: <strong>${Number(item.unit_price || 0).toFixed(2)}</strong></span>
                                    ${item.discount_percent > 0 ? `<span>|</span><span class="text-red-600">خصم: ${item.discount_percent}%</span>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Totals -->
                <div class="p-3 bg-brand-50 rounded-xl border border-brand-100">
                    <div class="space-y-1 text-sm">
                        <div class="flex justify-between">
                            <span class="text-slate-600">الإجمالي</span>
                            <span class="font-bold text-slate-700">${subtotal.toFixed(2)} ر.س</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-slate-600">الضريبة (15%)</span>
                            <span class="font-bold text-slate-700">${vat.toFixed(2)} ر.س</span>
                        </div>
                        <div class="flex justify-between pt-2 border-t border-brand-200">
                            <span class="font-bold text-slate-700">الإجمالي الكلي</span>
                            <span class="font-black text-brand-700">${Number(order.grand_total || 0).toFixed(2)} ر.س</span>
                        </div>
                    </div>
                </div>
            `;
        } catch (err) {
            body.innerHTML = `
                <div class="text-center py-8">
                    <i class="fa-solid fa-circle-exclamation text-2xl text-red-300 mb-2"></i>
                    <p class="text-sm text-red-500">فشل تحميل تفاصيل العرض</p>
                    <p class="text-xs text-slate-400 mt-1">${err.message || ''}</p>
                </div>
            `;
        }
    };

    window.closeOrderDetailsModal = function() {
        const modal = document.getElementById('order-details-modal');
        if (modal) {
            modal.classList.remove('opacity-100');
            modal.querySelector('div').classList.remove('scale-100');
            setTimeout(() => { modal.style.display = 'none'; }, 200);
        }
    };

    // ── Auto-execute ──────────────────────────────────────────────────────────
    initQuotationsView();

})();
