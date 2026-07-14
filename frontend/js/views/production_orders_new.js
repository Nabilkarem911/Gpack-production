'use strict';
// =============================================================================
// G.PACK 2.0 — Production Orders View Controller  (v2 — fully synced with HTML)
// Namespace: window.poView
// =============================================================================

(function () {

    // ── State ──────────────────────────────────────────────────────────────────
    let _allOrders    = { pending_assignment: [], active: [], completed: [], archived: [] };
    let _suppliers    = [];
    let _warehouses   = [];
    let _activeTab    = 'pending_assignment';
    let _hubOrderId   = null;
    let _hubOrder     = null;
    let _hubItems     = [];
    let _hubMOs       = [];
    let _activeHubTab = 'items';
    let _invoicePrevPaid = 0;
    let _bulkSelected = {}; // { [itemId]: { id, name, qty, assigned } }

    const DESIGN_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'bmp', 'tif', 'tiff']);
    const DESIGN_PDF_EXTENSIONS   = new Set(['pdf']);
    const DESIGN_VECTOR_EXTENSIONS = new Set(['ai', 'eps', 'ps', 'psd']);
    const DESIGN_VIEWER_VARIANTS = {
        thumb: {
            imageClass: 'w-full h-full object-cover',
            pdfClass: 'w-full h-full border-0 bg-white pointer-events-none',
            fallbackClass: 'w-full h-full flex flex-col items-center justify-center text-[10px] font-bold text-slate-500 bg-slate-100'
        },
        modal: {
            imageClass: 'max-w-full max-h-[85vh] object-contain',
            pdfClass: 'w-full h-[85vh] border-0 bg-white',
            fallbackClass: 'w-full h-[85vh] flex flex-col items-center justify-center text-white text-lg font-bold bg-slate-900'
        }
    };
    const DESIGN_PLACEHOLDER_SVG = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"%3E%3Crect fill="%23e2e8f0" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%2394a3b8" font-size="14" font-family="sans-serif"%3Eلا يوجد تصميم%3C/text%3E%3C/svg%3E';

    let _logoBase64Cache;
    async function _loadLogoBase64() {
        if (_logoBase64Cache !== undefined) return _logoBase64Cache;
        try {
            const res = await fetch('/images/logo.png');
            if (!res.ok) throw new Error('logo not found');
            const blob = await res.blob();
            _logoBase64Cache = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('logo decode failed'));
                reader.readAsDataURL(blob);
            });
        } catch (err) {
            console.warn('Logo unavailable for print views', err);
            _logoBase64Cache = null;
        }
        return _logoBase64Cache;
    }

    function _getFileExt(url) {
        if (!url) return '';
        const clean = url.split('?')[0].split('#')[0];
        const idx = clean.lastIndexOf('.');
        return idx === -1 ? '' : clean.substring(idx + 1).toLowerCase();
    }

    function _escapeHtml(str) {
        return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _buildDesignPreviewMarkup(url, name, { variant = 'thumb', extensionOverride } = {}) {
        const profile = DESIGN_VIEWER_VARIANTS[variant] || DESIGN_VIEWER_VARIANTS.thumb;
        const safeName = _escapeHtml(name || 'تصميم');
        if (!url) {
            return `<div class="${profile.fallbackClass}"><span>${safeName}</span><span class="text-[9px] font-normal">لا يوجد معاينة</span></div>`;
        }
        const ext = (extensionOverride || _getFileExt(url)).toLowerCase();
        const safeUrl = _escapeHtml(url);
        if (DESIGN_IMAGE_EXTENSIONS.has(ext)) {
            return `<img src="${safeUrl}" alt="${safeName}" class="${profile.imageClass}" onerror="this.onerror=null; this.src='${DESIGN_PLACEHOLDER_SVG}'">`;
        }
        if (DESIGN_PDF_EXTENSIONS.has(ext)) {
            return `<object data="${safeUrl}#toolbar=0&navpanes=0" type="application/pdf" class="${profile.pdfClass}" aria-label="${safeName}">`
                + `<div class="${profile.fallbackClass}"><span>${ext.toUpperCase()}</span><span class="text-[10px] font-normal">${safeName}</span></div>`
                + `</object>`;
        }
        if (DESIGN_VECTOR_EXTENSIONS.has(ext)) {
            return `<div class="${profile.fallbackClass}"><span>${ext.toUpperCase()}</span><span class="text-[10px] font-normal">${safeName}</span></div>`;
        }
        const label = ext ? ext.toUpperCase() : 'FILE';
        return `<div class="${profile.fallbackClass}"><span>${label}</span><span class="text-[10px] font-normal">${safeName}</span></div>`;
    }

    function _escapeAttrValue(str) {
        return String(str ?? '').replace(/'/g, "\\'").replace(/\n/g, ' ');
    }

    function _setAssignPreviewMedia(thumbnail, name, metaLabel, extensionOverride) {
        const thumbBtn = _el('assign-design-thumb');
        const media = thumbBtn?.querySelector('.design-preview-media');
        if (thumbBtn) {
            thumbBtn.dataset.url = thumbnail || '';
            thumbBtn.dataset.name = name || '';
            const ext = extensionOverride || _getFileExt(thumbnail || '');
            thumbBtn.dataset.ext = ext;
            thumbBtn.dataset.meta = metaLabel || '';
        }
        if (media) {
            media.innerHTML = _buildDesignPreviewMarkup(thumbnail, name || 'تصميم', { variant: 'thumb', extensionOverride });
        }
    }

    function _normalizeDesignUrl(url) {
        if (!url) return '';
        if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/')) return url;
        return '/' + url;
    }

    function _buildPrintPreviewMarkup(url, name, size = 'thumb') {
        const safeName = _escapeHtml(name || 'تصميم');
        const normalized = _normalizeDesignUrl(url);
        const isLarge = size === 'page';
        const baseStyle = isLarge
            ? 'border-radius:18px;border:2px solid #e2e8f0;background:#f8fafc;overflow:hidden;min-height:420px;padding:10px;display:flex;align-items:center;justify-content:center;'
            : 'width:72px;height:72px;border-radius:8px;border:2px solid #e2e8f0;background:#f8fafc;display:flex;align-items:center;justify-content:center;overflow:hidden;margin:0 auto;';
        const placeholder = `<div style="${baseStyle}"><span style="font-size:${isLarge ? '14px' : '10px'};color:#94a3b8;">لا يوجد</span></div>`;
        if (!normalized) return placeholder;

        const ext = _getFileExt(normalized);
        if (DESIGN_IMAGE_EXTENSIONS.has(ext)) {
            const imgStyle = isLarge ? 'width:100%;height:auto;max-height:700px;display:block;margin:0 auto;' : 'width:100%;height:100%;object-fit:cover;display:block;';
            return `<div style="${baseStyle}"><img src="${normalized}" alt="${safeName}" style="${imgStyle}" onerror="this.onerror=null;this.parentElement.innerHTML='<span style=\\'font-size:${isLarge ? '14px' : '10px'};color:#94a3b8\\'>لا يوجد</span>';"></div>`;
        }
        if (DESIGN_PDF_EXTENSIONS.has(ext)) {
            if (isLarge) {
                return `<div style="${baseStyle};flex-direction:column;">
                    <iframe src="${normalized}#toolbar=1" style="width:100%;height:600px;border:0;background:#fff;" aria-label="${safeName}"></iframe>
                    <div style="text-align:center;margin-top:12px;">
                        <a href="${normalized}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:#dc2626;color:white;text-decoration:none;border-radius:8px;font-size:12px;font-weight:700;">📄 فتح PDF في تبويب جديد</a>
                    </div>
                </div>`;
            }
            return `<div style="${baseStyle};flex-direction:column;font-weight:700;color:#dc2626;">PDF</div>`;
        }
        if (DESIGN_VECTOR_EXTENSIONS.has(ext)) {
            return `<div style="${baseStyle};flex-direction:column;font-weight:700;color:#0f172a;">${ext.toUpperCase()}</div>`;
        }
        const label = (ext || 'FILE').toUpperCase();
        return `<div style="${baseStyle};flex-direction:column;font-weight:700;color:#475569;">${label}</div>`;
    }

    function _openAssignPreview(event) {
        event?.stopPropagation?.();
        const thumbBtn = event?.currentTarget || _el('assign-design-thumb');
        if (!thumbBtn) return;
        const fileUrl = thumbBtn.dataset.url || '';
        const designName = thumbBtn.dataset.name || 'تصميم';
        const designExt = thumbBtn.dataset.ext || '';
        const meta = thumbBtn.dataset.meta || '';

        const modal = _el('po-design-viewer-modal');
        const content = _el('po-design-viewer-content');
        const nameEl = _el('po-design-viewer-name');
        const metaEl = _el('po-design-viewer-meta');
        if (!modal || !content) return;

        content.innerHTML = _buildDesignPreviewMarkup(fileUrl, designName, { variant: 'modal', extensionOverride: designExt });
        if (nameEl) nameEl.textContent = designName;
        if (metaEl) metaEl.textContent = meta;

        modal.classList.remove('hidden');
        requestAnimationFrame(() => {
            modal.classList.remove('opacity-0');
            modal.querySelector('.modal-panel')?.classList.remove('scale-95');
        });
    }

    function _closeAssignPreview(event) {
        const modal = _el('po-design-viewer-modal');
        if (!modal) return;
        if (event && event.target !== event.currentTarget && !event.target.closest('button')) return;
        modal.classList.add('opacity-0');
        modal.querySelector('.modal-panel')?.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }

    // ── Formatters ─────────────────────────────────────────────────────────────
    const _fmt = (n) => {
        if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
        return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const _fmtDate = (d) => {
        if (!d) return '—';
        const dt = new Date(d);
        const day = String(dt.getDate()).padStart(2, '0');
        const month = String(dt.getMonth() + 1).padStart(2, '0');
        const year = dt.getFullYear();
        return `${day}/${month}/${year}`;
    };

    // ── Config ─────────────────────────────────────────────────────────────────
    const STATUS_CFG = {
        production: { label: 'في الانتظار', cls: 'bg-amber-100 text-amber-700',    icon: 'fa-clock' },
        processing: { label: 'قيد التنفيذ', cls: 'bg-blue-100 text-blue-700',      icon: 'fa-gears' },
        completed:  { label: 'مكتمل',       cls: 'bg-emerald-100 text-emerald-700', icon: 'fa-circle-check' },
        delivered:  { label: 'مُسلَّم',     cls: 'bg-slate-100 text-slate-600',    icon: 'fa-truck' },
        cancelled:  { label: 'ملغي',        cls: 'bg-red-100 text-red-600',         icon: 'fa-ban' },
        archived:   { label: 'مؤرشف',       cls: 'bg-gray-100 text-gray-500',       icon: 'fa-box-archive' },
    };

    const STATUS_FLOW = {
        production: [{ s: 'processing', label: 'بدء التنفيذ',  cls: 'bg-blue-600 hover:bg-blue-700 text-white' }],
        processing: [{ s: 'completed',  label: 'تم الإكمال',   cls: 'bg-emerald-600 hover:bg-emerald-700 text-white' }],
        completed:  [{ s: 'delivered',  label: 'تم التسليم',   cls: 'bg-purple-600 hover:bg-purple-700 text-white' }],
    };

    const MO_STATUS_CFG = {
        pending:   { label: 'معلق',         cls: 'bg-amber-100 text-amber-700' },
        sent:      { label: 'مُرسل',        cls: 'bg-blue-100 text-blue-700' },
        partially_received: { label: 'استلام جزئي',  cls: 'bg-orange-100 text-orange-700' },
        received:  { label: 'مُستلم بالكامل', cls: 'bg-emerald-100 text-emerald-700' },
        cancelled: { label: 'ملغي',         cls: 'bg-red-100 text-red-600' },
    };

    const PAY_METHODS = { cash: 'نقدي', bank_transfer: 'تحويل بنكي', check: 'شيك', card: 'بطاقة' };

    function _badge(status, cfg) {
        const c = cfg[status] || { label: status, cls: 'bg-slate-100 text-slate-500' };
        return `<span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ${c.cls}">${c.label}</span>`;
    }

    function _toast(msg, type = 'success') {
        try {
            if (window.showToast && typeof window.showToast === 'function') {
                window.showToast(msg, type);
            } else {
                console.log(`[Toast ${type}]`, msg);
            }
        } catch (err) {
            console.error('[Toast Error]', err);
        }
    }

    function _el(id) { return document.getElementById(id); }
    function _setText(id, val) { const e = _el(id); if (e) e.textContent = val; }
    function _setHTML(id, val) { const e = _el(id); if (e) e.innerHTML = val; }
    function _setVal(id, val)  { const e = _el(id); if (e) e.value = val; }

    function _isFullyAssigned(order) {
        const totalOrderQty = parseFloat(order.total_order_qty || 0);
        const totalMoQty    = parseFloat(order.total_mo_qty    || 0);
        return totalOrderQty > 0 && totalMoQty >= totalOrderQty - 0.0001;
    }

    // ── Load data ──────────────────────────────────────────────────────────────
    async function _loadOrders() {
        try {
            const [activeRes, completedRes, archivedRes] = await Promise.all([
                window.apiFetch('/api/orders?statuses=production,processing'),
                window.apiFetch('/api/orders?status=completed'),
                window.apiFetch('/api/orders?status=delivered'),
            ]);
            const productionOrders = (activeRes?.data) || [];
            _allOrders.pending_assignment = productionOrders.filter(o => !_isFullyAssigned(o));
            _allOrders.active             = productionOrders.filter(o => _isFullyAssigned(o));
            _allOrders.completed = (completedRes?.data) || [];
            _allOrders.archived  = (archivedRes?.data)  || [];
            _updateStats();
            _renderTable();
        } catch (err) {
            console.error('[poView] loadOrders:', err);
            _toast('فشل تحميل الأوامر', 'error');
        }
    }

    async function _loadSuppliers() {
        try {
            const res = await window.apiFetch('/api/suppliers?status=active');
            _suppliers = (res?.data) || [];
        } catch (err) { console.error('[poView] loadSuppliers:', err); }
    }

    async function _loadWarehouses() {
        try {
            // Add cache-buster to prevent browser caching
            const res = await window.apiFetch(`/api/inventory/warehouses?_t=${Date.now()}`);
            _warehouses = (res?.data) || [];
        } catch (err) { console.error('[poView] loadWarehouses:', err); }
    }

    // ── Stats ──────────────────────────────────────────────────────────────────
    function _updateStats() {
        const active = _allOrders.active;
        const pending    = _allOrders.pending_assignment.length;
        const processing = active.filter(o => o.status === 'processing').length;
        const completed  = _allOrders.completed.length;
        const unpaid = [..._allOrders.pending_assignment, ...active, ..._allOrders.completed].filter(o =>
            parseFloat(o.grand_total || 0) - parseFloat(o.paid_amount || 0) > 0.01
        ).length;
        _setText('po-stat-pending',    pending);
        _setText('po-stat-processing', processing);
        _setText('po-stat-completed',  completed);
        _setText('po-stat-unpaid',     unpaid);
    }

    // ── Table render ───────────────────────────────────────────────────────────
    function _renderTable() {
        const search = (_el('po-search')?.value || '').toLowerCase().trim();
        let orders = (_allOrders[_activeTab] || []).filter(o => {
            if (!search) return true;
            return String(o.order_number).includes(search) ||
                   (o.client_name || '').toLowerCase().includes(search);
        });

        const tbody  = _el('po-tbody');
        const emptyEl= _el('po-empty');
        if (!tbody) return;

        if (!orders.length) {
            tbody.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }
        if (emptyEl) emptyEl.classList.add('hidden');

        // Receiving status config
        const RECV_CFG = {
            none:    { label: '—',       cls: 'text-slate-400',         icon: '' },
            sent:    { label: 'مُرسَل', cls: 'bg-amber-100 text-amber-700', icon: 'fa-paper-plane' },
            partially_received: { label: 'جزئي',  cls: 'bg-blue-100 text-blue-700',   icon: 'fa-truck-ramp-box' },
            full:    { label: 'كامل',  cls: 'bg-emerald-100 text-emerald-700', icon: 'fa-check-circle' }
        };

        tbody.innerHTML = orders.map((o, idx) => {
            const cfg = STATUS_CFG[o.status] || STATUS_CFG.production;
            const gt  = parseFloat(o.grand_total  || 0);
            const pd  = parseFloat(o.paid_amount  || 0);
            const rem = Math.max(0, gt - pd);
            const recv = RECV_CFG[o.receive_status] || RECV_CFG.none;
            const recvPct = o.total_mo_qty > 0 ? Math.round((o.total_received / o.total_mo_qty) * 100) : 0;
            const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-slate-100';

            return `<tr class="border-b border-slate-50 ${rowBg} hover:bg-brand-50/30 transition-colors cursor-pointer"
                        onclick="window.poView.openHub('${o.id}')">
                <td class="py-3 px-4">
                    <span class="font-mono font-bold text-slate-800">#${o.order_number}</span>
                </td>
                <td class="py-3 px-4 text-sm text-slate-700 font-semibold">${o.client_name || '—'}</td>
                <td class="py-3 px-4 text-xs text-slate-400 hidden sm:table-cell">${_fmtDate(o.order_date)}</td>
                <td class="py-3 px-4 text-sm font-bold text-slate-800 hidden md:table-cell">${_fmt(gt)} ر.س</td>
                <td class="py-3 px-4 text-sm hidden md:table-cell">
                    ${pd > 0
                        ? `<span class="text-emerald-600 font-bold">${_fmt(pd)} ر.س</span>`
                        : `<span class="text-slate-400 font-bold text-xs">لم يُدفع</span>`}
                </td>
                <td class="py-3 px-4 text-sm hidden md:table-cell">
                    ${rem > 0
                        ? `<span class="text-red-600 font-bold">${_fmt(rem)} ر.س</span>`
                        : `<span class="text-emerald-600 font-bold text-xs">مسدَّد</span>`}
                </td>
                <td class="py-3 px-4">
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${cfg.cls}">
                        <i class="fa-solid ${cfg.icon} text-[10px]"></i> ${cfg.label}
                    </span>
                </td>
                <td class="py-3 px-4 text-center">
                    ${o.receive_status !== 'none'
                        ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold ${recv.cls}" title="${o.total_received || 0} / ${o.total_mo_qty || 0}">
                            ${recv.icon ? `<i class="fa-solid ${recv.icon} text-[10px]"></i>` : ''} ${recv.label}
                           </span>
                           ${recvPct > 0 && recvPct < 100 ? `<span class="text-xs text-slate-400">${recvPct}%</span>` : ''}`
                        : `<span class="text-xs text-slate-400">—</span>`
                    }
                </td>
                <td class="py-3 px-4 text-center">
                    <button onclick="event.stopPropagation(); window.poView.openHub('${o.id}')"
                            class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-lg transition-all active:scale-[0.98]">
                        <i class="fa-solid fa-gears"></i> إدارة
                    </button>
                </td>
            </tr>`;
        }).join('');
    }

    // ── Open Order Hub ─────────────────────────────────────────────────────────
    async function _openHub(orderId) {
        _hubOrderId   = orderId;
        _activeHubTab = 'items';
        _showModal('po-hub-modal');

        // Show loader
        _setHTML('hub-items-tbody', '<tr><td colspan="5" class="py-8 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i></td></tr>');
        _setHTML('hub-mo-list', '');
        _el('hub-mo-empty')?.classList.add('hidden');

        try {
            const [orderRes, moRes] = await Promise.all([
                window.apiFetch(`/api/orders/${orderId}`),
                window.apiFetch(`/api/manufacturer-orders/by-order/${orderId}`),
            ]);

            _hubOrder = orderRes?.data || null;
            _hubItems = (_hubOrder?.items) || [];
            _hubMOs   = (moRes?.data) || [];

            if (!_hubOrder) { _toast('تعذر تحميل بيانات الأمر', 'error'); return; }

            _renderHubHeader();
            _switchHubTab('items');
        } catch (err) {
            console.error('[poView] openHub:', err);
            _toast('فشل تحميل بيانات الأمر', 'error');
        }
    }

    // ── Hub Header ─────────────────────────────────────────────────────────────
    function _renderHubHeader() {
        const o   = _hubOrder;
        console.log('[poView] _renderHubHeader order:', o?.order_number, 'paid_amount:', o?.paid_amount);
        const gt  = parseFloat(o.grand_total  || 0);
        const pd  = parseFloat(o.paid_amount  || 0);
        const rem = Math.max(0, gt - pd);
        const sar = (v) => `${_fmt(v)} ر.س`;

        _setText('hub-client',            o.client_name  || '—');
        _setText('hub-order-num',         `#${o.order_number}`);
        _setHTML('hub-status-badge',      _badge(o.status, STATUS_CFG));
        _setText('hub-grand-total',       sar(gt));
        _setText('hub-paid',              sar(pd));
        _setText('hub-remaining',         sar(rem));
        _setText('hub-grand-total-mobile',sar(gt));
        _setText('hub-paid-mobile',       sar(pd));
        _setText('hub-remaining-mobile',  sar(rem));

        if (_el('hub-notes-input')) _el('hub-notes-input').value = o.internal_notes || '';
    }

    // ── Tab switching ──────────────────────────────────────────────────────────
    function _switchHubTab(tab) {
        _activeHubTab = tab;
        console.log('[poView] Switching to tab:', tab, 'OrderID:', _hubOrderId);
        ['items','financial','delivery','notes'].forEach(t => {
            const btn  = _el(`hub-tab-${t}`);
            const cont = _el(`hub-tab-${t}-content`);
            if (!btn || !cont) return;

            if (t === tab) {
                btn.classList.remove('text-slate-500','border-transparent');
                btn.classList.add('text-brand-600','border-brand-600');
                cont.classList.remove('hidden');
            } else {
                btn.classList.add('text-slate-500','border-transparent');
                btn.classList.remove('text-brand-600','border-brand-600');
                cont.classList.add('hidden');
            }
        });

        // Render the active tab
        console.log('[poView] About to render tab:', tab);
        if (tab === 'items')     { console.log('[poView] Rendering items'); _renderHubItems(); }
        if (tab === 'financial') { console.log('[poView] Rendering financial'); _renderHubFinancial(); }
        if (tab === 'delivery')  { console.log('[poView] Rendering delivery'); _renderHubDelivery(); }
        if (tab === 'notes')     { _renderHubNotes(); }
    }

    // ── Hub Tab: Items ─────────────────────────────────────────────────────────
    function _renderHubItems() {
        // Reset bulk selection on re-render
        _bulkSelected = {};
        _updateBulkBtn();

        // Status actions
        const nextSteps = STATUS_FLOW[_hubOrder.status] || [];
        const actionsEl = _el('hub-status-actions');
        if (actionsEl) {
            const canRevertOrder = ['production', 'processing'].includes(_hubOrder.status);
            const nextBtns = nextSteps.map(s =>
                `<button onclick="window.poView.updateStatus('${s.s}')"
                         class="flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-xl shadow transition-all active:scale-[0.98] ${s.cls}">
                     <i class="fa-solid fa-arrow-right"></i> ${s.label}
                 </button>`).join('');
            const revertBtn = canRevertOrder
                ? `<button onclick="window.poView.revertOrderToArchive()"
                           class="flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-xl border-2 border-red-300 text-red-600 hover:bg-red-50 transition-all active:scale-[0.98]"
                           title="إلغاء كل أوامر الموردين وأرشفة الطلب (فقط إذا لم يتم استلام أي بضاعة)">
                       <i class="fa-solid fa-rotate-left"></i> تراجع وأرشفة
                   </button>`
                : '';
            actionsEl.innerHTML = (nextBtns || revertBtn)
                ? nextBtns + revertBtn
                : '<span class="text-xs text-slate-400">لا يوجد إجراء متاح</span>';
        }

        // Items rows
        const tbody = _el('hub-items-tbody');
        if (tbody) {
            tbody.innerHTML = _hubItems.length
                ? _hubItems.map(item => {
                    const assigned  = parseFloat(item.manufacturer_po_qty || 0);
                    const received  = parseFloat(item.wh_received_qty     || 0);
                    const qty       = parseFloat(item.quantity             || 0);
                    const canAssign = qty > assigned;
                    const safeName  = ((item.product_name || '') + ' ' + (item.size_name || '')).trim().replace(/'/g, "\\'");
                    const designId  = item.design_id || '';
                    return `<tr class="border-b border-slate-50 hover:bg-slate-50/40">
                        <td class="py-2.5 px-3">
                            ${canAssign
                                ? `<input type="checkbox" data-item-id="${item.id}" data-item-name="${safeName}" data-item-qty="${qty}" data-item-assigned="${assigned}" data-design-id="${designId}"
                                          onchange="window.poView.toggleItemCheck(this)"
                                          class="w-4 h-4 rounded accent-purple-600 cursor-pointer">`
                                : `<span class="block w-4 h-4"></span>`
                            }
                        </td>
                        <td class="py-2.5 px-4 text-sm">
                            <span class="font-semibold text-slate-800">${item.product_name || '—'}</span>
                            ${item.size_name ? `<span class="text-xs text-slate-400 mr-1">${item.size_name}</span>` : ''}
                        </td>
                        <td class="py-2.5 px-4 text-center text-sm font-bold text-slate-700">${qty}</td>
                        <td class="py-2.5 px-4 text-center text-sm hidden sm:table-cell">
                            <span class="${assigned > 0 ? 'text-blue-600 font-bold' : 'text-slate-300'}">${assigned || '—'}</span>
                        </td>
                        <td class="py-2.5 px-4 text-center text-sm hidden sm:table-cell">
                            <span class="${received > 0 ? 'text-emerald-600 font-bold' : 'text-slate-300'}">${received || '—'}</span>
                        </td>
                        <td class="py-2.5 px-4 text-center">
                            ${canAssign
                                ? `<button onclick="window.poView.openAssignModal('${item.id}')"
                                           class="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 text-xs font-bold rounded-lg transition-all">
                                       <i class="fa-solid fa-plus"></i> إسناد
                                   </button>`
                                : `<span class="text-xs font-bold text-emerald-600">مكتمل ✓</span>`}
                        </td>
                    </tr>`;
                }).join('')
                : '<tr><td colspan="6" class="py-8 text-center text-slate-400 text-xs">لا توجد بنود في هذا الأمر</td></tr>';
        }

        // MO list
        const moListEl  = _el('hub-mo-list');
        const moEmptyEl = _el('hub-mo-empty');
        if (!moListEl) return;

        if (!_hubMOs.length) {
            moListEl.innerHTML = '';
            moEmptyEl?.classList.remove('hidden');
            return;
        }
        moEmptyEl?.classList.add('hidden');

        // Color palette for supplier cards — each MO gets a distinct color
        const _cardColors = [
            { border: 'border-blue-200',    bg: 'bg-blue-50/30',    icon: 'text-blue-500',      headerBg: 'bg-blue-50/50' },
            { border: 'border-emerald-200', bg: 'bg-emerald-50/30', icon: 'text-emerald-500',   headerBg: 'bg-emerald-50/50' },
            { border: 'border-amber-200',   bg: 'bg-amber-50/30',   icon: 'text-amber-500',     headerBg: 'bg-amber-50/50' },
            { border: 'border-purple-200',  bg: 'bg-purple-50/30',  icon: 'text-purple-500',    headerBg: 'bg-purple-50/50' },
            { border: 'border-rose-200',    bg: 'bg-rose-50/30',    icon: 'text-rose-500',      headerBg: 'bg-rose-50/50' },
            { border: 'border-cyan-200',    bg: 'bg-cyan-50/30',    icon: 'text-cyan-500',      headerBg: 'bg-cyan-50/50' },
            { border: 'border-indigo-200',  bg: 'bg-indigo-50/30',  icon: 'text-indigo-500',    headerBg: 'bg-indigo-50/50' },
            { border: 'border-teal-200',    bg: 'bg-teal-50/30',    icon: 'text-teal-500',      headerBg: 'bg-teal-50/50' },
        ];

        moListEl.innerHTML = _hubMOs.map((mo, moIdx) => {
            const color = _cardColors[moIdx % _cardColors.length];
            const canReceive    = ['sent','partially_received'].includes(mo.status);
            const canMarkOrdered= mo.status === 'pending';
            const canEditMO     = mo.status === 'pending';
            const canRevertSend = mo.status === 'sent';
            const canCancelMO   = ['pending', 'sent'].includes(mo.status);
            
            // Calculate receive status color
            const totalQty = (mo.items || []).reduce((s, i) => s + parseFloat(i.mo_quantity || i.po_quantity || 0), 0);
            const recQty = (mo.items || []).reduce((s, i) => s + parseFloat(i.received_qty || 0), 0);
            const pct = totalQty > 0 ? (recQty / totalQty) : 0;
            let recvColor = '🔴'; // red - no receive
            let recvText = 'مفيش استلام';
            if (pct >= 1) {
                recvColor = '🟢'; // green - full
                recvText = 'استلام كامل';
            } else if (pct > 0) {
                recvColor = '🟡'; // yellow - partial
                recvText = 'استلام جزئي';
            }
            
            // Invoice status
            const invoiceBadge = mo.has_supplier_invoice 
                ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold"><i class="fa-solid fa-file-invoice"></i> بفاتورة مورد</span>`
                : `<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-xs font-bold"><i class="fa-solid fa-file-circle-xmark"></i> بدون فاتورة</span>`;
            
            const itemsHTML = (mo.items || []).map(i => {
                const moQty  = parseFloat(i.mo_quantity  || i.po_quantity || 0);
                const recQty = parseFloat(i.received_qty || 0);
                const remQty = Math.max(0, moQty - recQty);
                const pct    = moQty > 0 ? Math.round((recQty / moQty) * 100) : 0;
                const barColor = pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-blue-500' : 'bg-slate-200';
                return `<div class="bg-white/70 rounded-lg px-3 py-2">
                    <div class="flex justify-between text-xs mb-1">
                        <span class="text-slate-600 font-semibold">${i.product_name || ''} ${i.size_name || ''}</span>
                        <span class="font-bold ${pct >= 100 ? 'text-emerald-600' : 'text-slate-700'}">
                            ${recQty} / ${moQty}
                            ${remQty > 0 ? `<span class="text-orange-500 mr-1">(متبقي ${remQty})</span>` : '<span class="text-emerald-500 mr-1">✓ مكتمل</span>'}
                        </span>
                    </div>
                    <div class="w-full bg-slate-200 rounded-full h-1.5">
                        <div class="${barColor} h-1.5 rounded-full transition-all" style="width:${pct}%"></div>
                    </div>
                </div>`;
            }).join('');

            return `<div class="${color.bg} border-2 ${color.border} rounded-xl p-4">
                <div class="flex flex-wrap items-start justify-between gap-2 mb-2 ${color.headerBg} -mx-4 -mt-4 px-4 py-2.5 rounded-t-xl border-b ${color.border}">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-truck-ramp-box ${color.icon}"></i>
                        <span class="text-sm font-bold text-slate-800">${mo.supplier_name || '—'}</span>
                        ${_badge(mo.status, MO_STATUS_CFG)}
                        <span class="text-xs text-slate-400 font-mono">#${mo.po_number || ''}</span>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <button onclick="window.poView.printMO('${mo.id}')"
                                class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg transition-all flex items-center gap-1">
                            <i class="fa-solid fa-print"></i> طباعة أمر المورد
                        </button>
                        ${canEditMO
                            ? `<button onclick="window.poView.editMO('${mo.id}')"
                                       class="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 text-xs font-bold rounded-lg transition-all flex items-center gap-1" title="تعديل الكمية والتصميم والمورد">
                                   <i class="fa-solid fa-edit"></i> تعديل
                               </button>`
                            : ''}
                        ${canMarkOrdered
                            ? `<button onclick="window.poView.updateMOStatus('${mo.id}','sent')"
                                       class="px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-bold rounded-lg transition-all flex items-center gap-1">
                                   <i class="fa-solid fa-paper-plane"></i> تم الإرسال للمورد
                               </button>`
                            : ''}
                        ${canReceive
                            ? `<button onclick="window.poView.openReceiveModal('${mo.id}')"
                                       class="px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-xs font-bold rounded-lg transition-all flex items-center gap-1">
                                   <i class="fa-solid fa-box-open"></i> استلام البضاعة
                               </button>`
                            : ''}
                        ${canRevertSend
                            ? `<button onclick="window.poView.revertSendToSupplier('${mo.id}')"
                                       class="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 text-xs font-bold rounded-lg transition-all flex items-center gap-1" title="تراجع عن الإرسال للمورد (إذا لم يتم الاستلام بعد)">
                                   <i class="fa-solid fa-rotate-left"></i> تراجع عن الإرسال
                               </button>`
                            : ''}
                        ${canCancelMO
                            ? `<button onclick="window.poView.cancelMO('${mo.id}')"
                                       class="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg transition-all flex items-center gap-1" title="إلغاء أمر المورد (حذف نهائي)">
                                   <i class="fa-solid fa-trash"></i> إلغاء
                               </button>`
                            : ''}
                    </div>
                </div>
                <div class="flex items-center gap-2 mb-2 text-xs">
                    <span class="font-bold" title="${recvText}">${recvColor}</span>
                    ${invoiceBadge}
                    ${mo.expected_delivery ? `<span class="text-slate-500">التسليم المتوقع: <b class="text-slate-700">${_fmtDate(mo.expected_delivery)}</b></span>` : ''}
                    ${mo.notes ? `<span class="text-slate-400">· ${mo.notes}</span>` : ''}
                </div>
                ${itemsHTML ? `<div class="space-y-1">${itemsHTML}</div>` : ''}
            </div>`;
        }).join('');
    }

    // ── Hub Tab: Financial ─────────────────────────────────────────────────────
    async function _renderHubFinancial() {
        console.log('[poView] _renderHubFinancial called, orderId:', _hubOrderId);
        const invTbody = _el('hub-invoices-tbody');
        const payTbody = _el('hub-payments-tbody');
        console.log('[poView] Financial elements:', { invTbody: !!invTbody, payTbody: !!payTbody });
        if (!invTbody && !payTbody) return;

        if (invTbody) invTbody.innerHTML = '<tr><td colspan="4" class="py-4 text-center text-slate-300 text-xs"><i class="fa-solid fa-circle-notch fa-spin"></i></td></tr>';
        if (payTbody) payTbody.innerHTML = '<tr><td colspan="4" class="py-4 text-center text-slate-300 text-xs"><i class="fa-solid fa-circle-notch fa-spin"></i></td></tr>';

        try {
            console.log('[poView] Calling API:', `/api/orders/${_hubOrderId}/financial`);
            const res = await window.apiFetch(`/api/orders/${_hubOrderId}/financial`);
            console.log('[poView] API response:', res);
            const fin = res?.data;

            if (!fin) {
                // API returned success but no data object
                if (invTbody) invTbody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-slate-400 text-xs">لا توجد فواتير</td></tr>';
                if (payTbody) payTbody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-slate-400 text-xs">لا توجد دفعات مسجلة</td></tr>';
                return;
            }

            // Invoices
            if (invTbody) {
                const invoices = fin.invoices || [];
                invTbody.innerHTML = invoices.length
                    ? invoices.map(inv =>
                        `<tr class="border-b border-slate-50 hover:bg-slate-50/50">
                            <td class="py-2.5 px-4 text-sm font-mono font-bold text-slate-700">#${inv.invoice_number}</td>
                            <td class="py-2.5 px-4 text-xs text-slate-500 hidden sm:table-cell">${_fmtDate(inv.invoice_date)}</td>
                            <td class="py-2.5 px-4">
                                <span class="text-xs px-2 py-1 rounded-lg font-bold ${inv.status === 'issued' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
                                    ${inv.status === 'issued' ? 'نهائية' : 'أولية'}
                                </span>
                            </td>
                            <td class="py-2.5 px-4 text-sm font-bold text-slate-800">${_fmt(inv.grand_total)} ر.س</td>
                            <td class="py-2.5 px-4 text-center">
                                <button onclick="window.poView.printInvoice('${inv.id}')"
                                        class="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-bold rounded-lg transition-colors">
                                    <i class="fa-solid fa-print"></i>
                                </button>
                            </td>
                            <td class="py-2.5 px-4 text-center">
                                <button onclick="window.poView.shareInvoice('${inv.id}')"
                                        class="px-2.5 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-600 text-xs font-bold rounded-lg transition-colors"
                                        title="نسخ رابط الفاتورة للعميل">
                                    <i class="fa-solid fa-link"></i>
                                </button>
                            </td>
                            <td class="py-2.5 px-4 text-center">
                                ${inv.status !== 'issued' && inv.status !== 'paid' && inv.status !== 'cancelled'
                                    ? `<button onclick="window.poView.editInvoice('${inv.id}')"
                                        class="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-600 text-xs font-bold rounded-lg transition-colors"
                                        title="تعديل الفاتورة">
                                        <i class="fa-solid fa-pen-to-square"></i>
                                    </button>`
                                    : '<span class="text-slate-300 text-xs">—</span>'}
                            </td>
                        </tr>`).join('')
                    : '<tr><td colspan="7" class="py-6 text-center text-slate-400 text-xs">لا توجد فواتير</td></tr>';
            }

            // Payments
            if (payTbody) {
                const payments = fin.payments || [];
                payTbody.innerHTML = payments.length
                    ? payments.map(p =>
                        `<tr class="border-b border-slate-50 hover:bg-slate-50/50">
                            <td class="py-2.5 px-4 text-xs text-slate-500">${_fmtDate(p.created_at)}</td>
                            <td class="py-2.5 px-4 text-xs text-slate-600">${PAY_METHODS[p.payment_method] || p.payment_method || '—'}</td>
                            <td class="py-2.5 px-4 text-sm font-bold text-emerald-700">${_fmt(p.amount)} ر.س</td>
                            <td class="py-2.5 px-4 text-xs text-slate-400 hidden sm:table-cell">${p.description || '—'}</td>
                        </tr>`).join('')
                    : '<tr><td colspan="4" class="py-6 text-center text-slate-400 text-xs">لا توجد دفعات مسجلة</td></tr>';
            }
        } catch (err) {
            console.error('[poView] financial:', err);
            if (invTbody) invTbody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-red-400 text-xs">فشل تحميل الفواتير</td></tr>';
            if (payTbody) payTbody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-red-400 text-xs">فشل تحميل الدفعات</td></tr>';
        }
    }

    // ── Hub Tab: Delivery ──────────────────────────────────────────────────────
    async function _renderHubDelivery() {
        const tbody = _el('hub-delivery-tbody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-slate-300 text-xs"><i class="fa-solid fa-circle-notch fa-spin"></i></td></tr>';

        try {
            const res   = await window.apiFetch(`/api/delivery-notes?order_id=${_hubOrderId}`);
            const notes = res?.data || [];

            if (!notes.length) {
                tbody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-slate-400 text-xs">لا توجد أوامر فسح</td></tr>';
                return;
            }

            const DN_STATUS = {
                pending:   { label: 'معلق',    cls: 'bg-amber-100 text-amber-700' },
                delivered: { label: 'مُسلَّم', cls: 'bg-emerald-100 text-emerald-700' },
                partial:   { label: 'جزئي',    cls: 'bg-blue-100 text-blue-700' },
                completed: { label: 'مكتمل',   cls: 'bg-emerald-100 text-emerald-700' },
            };

            tbody.innerHTML = notes.map(dn =>
                `<tr class="border-b border-slate-50 hover:bg-slate-50/50">
                    <td class="py-2.5 px-4 font-mono font-bold text-slate-700">#${dn.note_number}</td>
                    <td class="py-2.5 px-4 text-xs text-slate-500 hidden sm:table-cell">${_fmtDate(dn.created_at)}</td>
                    <td class="py-2.5 px-4">${_badge(dn.status, DN_STATUS)}</td>
                    <td class="py-2.5 px-4 text-xs text-slate-500">${dn.item_count || '—'} صنف</td>
                    <td class="py-2.5 px-4 text-center">
                        <button onclick="window.poView.printDN('${dn.id}')"
                                class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg transition-all">
                            <i class="fa-solid fa-print"></i>
                        </button>
                    </td>
                </tr>`
            ).join('');
        } catch (err) {
            console.error('[poView] delivery:', err);
            _el('hub-delivery-tbody').innerHTML = '<tr><td colspan="5" class="py-6 text-center text-red-400 text-xs">فشل تحميل السندات</td></tr>';
        }
    }

    // ── Update order status ────────────────────────────────────────────────────
    async function _updateStatus(newStatus) {
        const label = STATUS_CFG[newStatus]?.label || newStatus;
        if (!confirm(`تأكيد تغيير حالة الأمر إلى "${label}"؟`)) return;
        try {
            await window.apiFetch(`/api/orders/${_hubOrderId}/status`, {
                method: 'PATCH',
                body: { status: newStatus },
            });
            _toast(`تم تحديث الحالة إلى ${label}`);
            await _loadOrders();
            await _openHub(_hubOrderId);
        } catch (err) {
            _toast(err.message || 'فشل تحديث الحالة', 'error');
        }
    }

    // ── MO Status ─────────────────────────────────────────────────────────────
    async function _updateMOStatus(moId, newStatus) {
        try {
            await window.apiFetch(`/api/manufacturer-orders/${moId}/status`, {
                method: 'PATCH',
                body: { status: newStatus },
            });
            _toast('تم تحديث حالة أمر المورد');
            // Refresh MOs
            const moRes = await window.apiFetch(`/api/manufacturer-orders/by-order/${_hubOrderId}`);
            _hubMOs = moRes?.data || [];
            _renderHubItems();
        } catch (err) {
            _toast(err.message || 'فشل تحديث الحالة', 'error');
        }
    }

    // ── Revert Send to Supplier ───────────────────────────────────────────────
    async function _revertSendToSupplier(moId) {
        if (!confirm('هل أنت متأكد من تراجع الإرسال للمورد؟\n\n⚠️ سيتم إرجاع الأمر لحالة "معلق" (Pending)\n✓ يمكنك استخدام هذا فقط إذا لم يتم الاستلام بعد')) {
            return;
        }
        
        try {
            // Call API to revert status
            await window.apiFetch(`/api/manufacturer-orders/${moId}/revert-send`, {
                method: 'POST',
            });
            
            _toast('تم تراجع الإرسال بنجاح - الأمر عاد لحالة "معلق"');

            // Refresh MOs
            const moRes = await window.apiFetch(`/api/manufacturer-orders/by-order/${_hubOrderId}`);
            _hubMOs = moRes?.data || [];
            _renderHubItems();
            await _loadOrders();
        } catch (err) {
            console.error('[revertSendToSupplier] Error:', err);
            _toast(err.message || 'فشل تراجع الإرسال - تأكد من عدم وجود استلام', 'error');
        }
    }

    // ── Edit MO ────────────────────────────────────────────────────────────────
    async function _editMO(moId) {
        const mo = _hubMOs.find(m => m.id === moId);
        if (!mo) { _toast('أمر المورد غير موجود', 'error'); return; }
        if (mo.status !== 'pending') { _toast('يمكن التعديل فقط للأوامر المعلقة', 'error'); return; }

        // Load full MO details and suppliers
        try {
            const [moRes, supRes] = await Promise.all([
                window.apiFetch(`/api/manufacturer-orders/${moId}`),
                window.apiFetch('/api/suppliers?status=active')
            ]);
            
            const moDetails = moRes?.data;
            const suppliers = supRes?.data || [];
            
            if (!moDetails) { _toast('فشل تحميل بيانات أمر المورد', 'error'); return; }

            // Load suppliers into dropdown
            const sel = _el('assign-supplier-select');
            if (sel) {
                sel.innerHTML = '<option value="">— اختر المورد —</option>' +
                    suppliers.map(s => `<option value="${s.id}">${s.company_name || s.name}</option>`).join('');
            }

            // Open assign modal with existing data for editing
            _setVal('assign-mo-id', moId); // Hidden field for edit mode
            _setVal('assign-order-item-id', moDetails.items?.[0]?.order_item_id || '');
            _setVal('assign-order-id', _hubOrderId);
            _setText('assign-item-name', `${mo.supplier_name || '—'} — ${moDetails.items?.length || 0} صنف`);
            
            // Set existing values
            _setVal('assign-supplier-select', mo.manufacturer_id || '');
            _setVal('assign-qty', moDetails.items?.[0]?.mo_quantity || moDetails.items?.[0]?.po_quantity || '');
            _setVal('assign-expected-delivery', mo.expected_delivery || '');
            _setVal('assign-notes', mo.notes || '');
            
            // Show modal
            _showModal('po-assign-modal');
            
        } catch (err) {
            console.error('[editMO] Error:', err);
            _toast(err.message || 'فشل تحميل بيانات الأمر', 'error');
        }
    }

    // ── Cancel/Delete MO ─────────────────────────────────────────────────────
    async function _cancelMO(moId) {
        const mo = _hubMOs.find(m => m.id === moId);
        if (!mo) { _toast('أمر المورد غير موجود', 'error'); return; }
        
        // Check if can cancel
        if (!['pending', 'sent'].includes(mo.status)) {
            _toast('لا يمكن الإلغاء إلا للأوامر المعلقة أو المرسلة', 'error');
            return;
        }
        
        if (!confirm('هل أنت متأكد من إلغاء أمر المورد؟\n\n⚠️ هذا الإجراء س:\n• حذف أمر المورد نهائياً\n• إرجاع الأصناف لحالة "غير مسندة"\n• لا يمكن التراجع عن هذا الإجراء')) {
            return;
        }
        
        try {
            await window.apiFetch(`/api/manufacturer-orders/${moId}`, {
                method: 'DELETE',
            });
            
            _toast('تم إلغاء أمر المورد بنجاح');
            
            // Refresh both order items (to update manufacturer_po_qty) and MOs
            const [orderRes, moRes] = await Promise.all([
                window.apiFetch(`/api/orders/${_hubOrderId}`),
                window.apiFetch(`/api/manufacturer-orders/by-order/${_hubOrderId}`),
            ]);
            _hubOrder = orderRes?.data || _hubOrder;
            _hubItems = _hubOrder?.items || [];
            _hubMOs   = moRes?.data || [];
            _renderHubHeader();
            _renderHubItems();
            await _loadOrders();
        } catch (err) {
            console.error('[cancelMO] Error:', err);
            _toast(err.message || 'فشل إلغاء أمر المورد - تأكد من عدم وجود استلام', 'error');
        }
    }

    // ── Revert Order to Archive ────────────────────────────────────────────────
    async function _revertOrderToArchive() {
        const orderNum = _hubOrder?.order_number || '';

        if (!confirm(
            `هل أنت متأكد من تراجع الطلب #${orderNum}؟\n\n` +
            `⚠️ هذا الإجراء سـ:\n` +
            `• إلغاء كل أوامر الموردين (غير المستلمة)\n` +
            `• إعادة الأصناف لحالة "غير مسندة"\n` +
            `• أرشفة الطلب (يمكنك إعادة تفعيله لاحقاً)\n\n` +
            `❌ لن يُنفَّذ إذا كانت هناك بضاعة مستلمة من أي مورد.`
        )) return;

        try {
            const res = await window.apiFetch(
                `/api/manufacturer-orders/revert-order/${_hubOrderId}`,
                { method: 'POST' }
            );

            _toast(res.message || 'تم أرشفة الطلب بنجاح');

            // Close hub and reload orders list
            _hideModal('po-hub-modal');
            await _loadOrders();
        } catch (err) {
            console.error('[revertOrderToArchive] Error:', err);
            _toast(err.message || 'فشل التراجع — تأكد من عدم وجود بضاعة مستلمة', 'error');
        }
    }

    // ── Print MO ──────────────────────────────────────────────────────────────
    async function _printMO(moId) {
        try {
            const res = await window.apiFetch(`/api/manufacturer-orders/${moId}`);
            const mo  = res?.data;
            if (!mo) { _toast('فشل تحميل بيانات أمر المورد', 'error'); return; }

            const logoBase64 = await _loadLogoBase64();

            // ── Build table rows ──
            const items = (mo.items || []).map(i => {
                const designStatus = i.design_status || 'new';
                const isReprint    = designStatus === 'redesign' || designStatus === 'reprint';
                const designLabel  = isReprint ? 'إعادة طباعة' : 'تصميم جديد';
                const designBg     = isReprint ? '#fff7ed' : '#f0fdf4';
                const designBorder = isReprint ? '#f59e0b' : '#22c55e';
                const designText   = isReprint ? '#b45309' : '#15803d';
                const designDot    = isReprint ? '↻' : '✎';

                const thumbMarkup = _buildPrintPreviewMarkup(i.design_thumbnail, i.design_name || '', 'thumb');

                const qty      = parseInt(i.mo_quantity || i.po_quantity || 0);
                const unitName = i.unit_name || 'قطعة';

                return `<tr>
                    <td style="padding:10px 12px;text-align:center;vertical-align:middle;border-bottom:1px solid #f1f5f9;">
                        ${thumbMarkup}
                        ${i.design_name ? `<div style="font-size:9px;color:#64748b;margin-top:3px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${i.design_name}</div>` : ''}
                    </td>
                    <td style="padding:10px 14px;font-weight:700;font-size:14px;color:#1e293b;vertical-align:middle;border-bottom:1px solid #f1f5f9;">${i.product_name || '—'}</td>
                    <td style="padding:10px 12px;text-align:center;font-size:13px;color:#475569;vertical-align:middle;border-bottom:1px solid #f1f5f9;">${i.size_name || '—'}</td>
                    <td style="padding:10px 12px;text-align:center;font-size:13px;color:#475569;vertical-align:middle;border-bottom:1px solid #f1f5f9;">${unitName}</td>
                    <td style="padding:10px 12px;text-align:center;font-size:18px;font-weight:900;color:#4c1d95;vertical-align:middle;border-bottom:1px solid #f1f5f9;">${qty}</td>
                    <td style="padding:10px 12px;text-align:center;vertical-align:middle;border-bottom:1px solid #f1f5f9;">
                        <span style="display:inline-flex;align-items:center;gap:5px;background:${designBg};color:${designText};padding:5px 10px;border-radius:20px;font-size:11px;font-weight:700;border:1px solid ${designBorder};">
                            <span>${designDot}</span>${designLabel}
                        </span>
                    </td>
                </tr>`;
            }).join('');

            // ── Build design full-page previews ──
            const designPages = (mo.items || [])
                .filter(i => i.design_thumbnail)
                .map((i, idx) => {
                    const normalizedUrl = _normalizeDesignUrl(i.design_thumbnail);
                    const previewMarkup = _buildPrintPreviewMarkup(normalizedUrl, i.design_name || '', 'page');
                    return `<div style="page-break-before:always;padding:30px 40px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #f1f5f9;">
                            <div>
                                <h2 style="margin:0;font-size:17px;font-weight:800;color:#1e293b;">ملحق التصميم ${idx + 1} — ${i.product_name || ''} ${i.size_name || ''}</h2>
                                <p style="margin:4px 0 0;font-size:12px;color:#64748b;">
                                    ${i.design_name ? `اسم التصميم: <b>${i.design_name}</b> &nbsp;|&nbsp; ` : ''}
                                    الكمية: <b>${parseInt(i.mo_quantity || i.po_quantity || 0)}</b> &nbsp;|&nbsp; أمر #${mo.mo_number}
                                </p>
                            </div>
                            <span style="background:#5d198e;color:white;padding:8px 18px;border-radius:10px;font-size:13px;font-weight:900;">${mo.mo_number}</span>
                        </div>
                        <div style="margin-top:25px;">
                            ${previewMarkup}
                        </div>
                        <div style="text-align:center;margin-top:16px;">
                            <a href="${normalizedUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:8px;padding:10px 22px;background:#5d198e;color:white;text-decoration:none;border-radius:10px;font-size:13px;font-weight:700;">⬇️ تحميل ملف التصميم</a>
                        </div>
                    </div>`;
                }).join('');

            const win = window.open('', '_blank', 'width=860,height=700');
            win.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>أمر تشغيل مورد #${mo.mo_number}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #1e293b; direction: rtl; background: #fff; }
  @page { margin: 12mm 15mm; }
  @media print { .no-print { display: none !important; } body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }

  /* ── Header Banner ── */
  .page-header {
    background: #5d198e;
    padding: 28px 36px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 28px;
  }
  .header-brand { display: flex; align-items: center; gap: 14px; }
  .header-brand img { width: 64px; height: 64px; object-fit: contain; }
  .header-brand-text h1 { font-size: 22px; font-weight: 900; color: #fbbf24; letter-spacing: 0.5px; }
  .header-brand-text p  { font-size: 12px; color: #c4b5fd; margin-top: 2px; }
  .mo-badge {
    background: #fbbf24;
    color: #4c1d95;
    padding: 10px 22px;
    border-radius: 12px;
    font-size: 20px;
    font-weight: 900;
    letter-spacing: 1px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }

  /* ── Body ── */
  .body-wrap { padding: 0 36px 36px; }

  /* ── Info Grid ── */
  .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-bottom: 24px; }
  .info-box {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 14px 16px;
    border-right: 4px solid #5d198e;
  }
  .info-box label { font-size: 10px; color: #94a3b8; display: block; margin-bottom: 5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; }
  .info-box span   { font-size: 15px; font-weight: 800; color: #1e293b; }

  /* ── Section Title ── */
  .section-title {
    font-size: 13px;
    font-weight: 800;
    color: #5d198e;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-title::after { content: ''; flex: 1; height: 2px; background: linear-gradient(to left, transparent, #e9d5ff); }

  /* ── Table ── */
  table { width: 100%; border-collapse: collapse; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(76,29,149,0.08); }
  thead tr { background: #5d198e; }
  th { color: #fbbf24; padding: 13px 12px; font-size: 12px; font-weight: 800; letter-spacing: 0.5px; }
  tbody tr:nth-child(even) { background: #faf5ff; }
  tbody tr:hover { background: #f3e8ff; }
  td { vertical-align: middle; }

  /* ── Notes ── */
  .notes-box { background: #fffbeb; border: 1px solid #fde68a; border-right: 4px solid #f59e0b; border-radius: 10px; padding: 12px 16px; margin-bottom: 20px; font-size: 13px; color: #92400e; }

  /* ── Footer ── */
  .doc-footer {
    margin-top: 36px;
    padding-top: 16px;
    border-top: 2px solid #f1f5f9;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: #94a3b8;
  }
  .footer-brand { font-weight: 800; color: #5d198e; font-size: 13px; }

  /* ── Print button ── */
  .print-btn {
    display: inline-flex; align-items: center; gap: 8px;
    margin-top: 20px; padding: 11px 28px;
    background: #5d198e;
    color: white; border: none; border-radius: 10px;
    font-size: 14px; font-weight: 800; cursor: pointer;
    box-shadow: 0 4px 12px rgba(93,25,142,0.35);
    transition: opacity 0.2s;
  }
  .print-btn:hover { opacity: 0.9; }
  .print-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── Loading overlay ── */
  .print-loading {
    position: fixed; inset: 0; background: rgba(255,255,255,0.95);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 9999; transition: opacity 0.3s;
  }
  .print-loading .spinner {
    width: 48px; height: 48px; border: 4px solid #e9d5ff; border-top-color: #5d198e;
    border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .print-loading p { font-size: 14px; color: #5d198e; font-weight: 700; }
</style>
</head>
<body>

<!-- ── Header Banner ── -->
<div class="page-header">
  <div class="header-brand">
    ${logoBase64 ? `<img src="${logoBase64}" alt="G.PACK Logo">` : ''}
    <div class="header-brand-text">
      <h1>G.PACK</h1>
      <p>أمر تشغيل مورد &nbsp;·&nbsp; Manufacturer Order</p>
    </div>
  </div>
  <div class="mo-badge">${mo.mo_number}</div>
</div>

<!-- ── Body ── -->
<div class="body-wrap">

  <!-- Info Cards -->
  <div class="info-grid">
    <div class="info-box">
      <label>المورد / المطبعة</label>
      <span>${mo.supplier_name || '—'}</span>
    </div>
    <div class="info-box">
      <label>تاريخ الأمر</label>
      <span>${_fmtDate(mo.created_at)}</span>
    </div>
    <div class="info-box">
      <label>تاريخ التسليم المتوقع</label>
      <span>${mo.expected_delivery ? _fmtDate(mo.expected_delivery) : '—'}</span>
    </div>
  </div>

  ${mo.notes ? `<div class="notes-box"><b>ملاحظات:</b> ${mo.notes}</div>` : ''}

  <!-- Items Table -->
  <div class="section-title">بنود الطلب</div>
  <table>
    <thead>
      <tr>
        <th style="text-align:center;width:88px;">التصميم</th>
        <th style="text-align:right;">اسم الصنف</th>
        <th style="text-align:center;width:90px;">المقاس</th>
        <th style="text-align:center;width:80px;">الوحدة</th>
        <th style="text-align:center;width:90px;">الكمية المطلوبة</th>
        <th style="text-align:center;width:130px;">نوع التصميم</th>
      </tr>
    </thead>
    <tbody>
      ${items || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">لا توجد بنود</td></tr>'}
    </tbody>
  </table>

  <!-- Footer -->
  <div class="doc-footer">
    <span class="footer-brand">G.PACK ERP 2.0</span>
    <span>تاريخ الطباعة: ${new Date().toLocaleDateString('en-GB')}</span>
  </div>

  <div class="no-print" style="text-align:center;margin-top:24px;">
    <button id="print-trigger-btn" class="print-btn" disabled onclick="window.print()">🖨️ &nbsp; طباعة أمر التشغيل</button>
    <p id="print-status" style="font-size:12px;color:#94a3b8;margin-top:10px;">جارٍ تحميل التصاميم...</p>
  </div>

</div>

${designPages}
<div id="print-loading-overlay" class="print-loading">
  <div class="spinner"></div>
  <p>جارٍ تحميل التصاميم للطباعة...</p>
</div>
<script>
  (function() {
    var overlay = document.getElementById('print-loading-overlay');
    var btn = document.getElementById('print-trigger-btn');
    var status = document.getElementById('print-status');
    var imgs = Array.prototype.slice.call(document.images);
    var iframes = Array.prototype.slice.call(document.querySelectorAll('iframe'));
    var total = imgs.length + iframes.length;
    var loaded = 0;

    function checkDone() {
      loaded++;
      if (loaded >= total) finishLoad();
    }

    function finishLoad() {
      if (overlay) { overlay.style.opacity = '0'; setTimeout(function(){ overlay.style.display = 'none'; }, 300); }
      if (btn) btn.disabled = false;
      if (status) status.textContent = 'جاهز للطباعة — اضغط الزر بالأعلى أو Ctrl+P';
      window.focus();
    }

    if (total === 0) { finishLoad(); return; }

    imgs.forEach(function(img) {
      if (img.complete && img.naturalWidth > 0) { checkDone(); }
      else {
        img.addEventListener('load', checkDone);
        img.addEventListener('error', checkDone);
      }
    });

    // For iframes (PDF embeds), use a shorter timeout since iframe load events are unreliable for PDFs
    iframes.forEach(function(iframe) {
      iframe.addEventListener('load', checkDone);
    });
    // If there are iframes, finish after 5s regardless (PDFs in iframes may not fire load reliably)
    if (iframes.length > 0) {
      setTimeout(function() { if (btn && btn.disabled) finishLoad(); }, 5000);
    }

    // Safety timeout: 15s max
    setTimeout(function() { if (btn && btn.disabled) finishLoad(); }, 15000);
  })();
</script>
</body>
</html>`);
            win.document.close();
            win.focus();
        } catch (err) {
            _toast('فشل تحميل بيانات الطباعة', 'error');
            console.error('[poView] printMO:', err);
        }
    }

    // ── Print Delivery Note ────────────────────────────────────────────────────
    async function _printDN(dnId) {
        try {
            const res = await window.apiFetch(`/api/delivery-notes/${dnId}`);
            const dn  = res?.data;
            if (!dn) { _toast('فشل تحميل بيانات أمر الفسح', 'error'); return; }

            const items = (dn.items || []).map(i =>
                `<tr>
                    <td style="border:1px solid #ddd;padding:8px">${i.product_name || '—'} ${i.variant_name || ''}</td>
                    <td style="border:1px solid #ddd;padding:8px;text-align:center">${i.quantity}</td>
                    <td style="border:1px solid #ddd;padding:8px;text-align:center">${i.delivered_qty || 0}</td>
                </tr>`
            ).join('');

            const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>أمر فسح #${dn.note_number}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; color: #1e293b; direction: rtl; }
  h1 { font-size: 20px; } .sub { color: #64748b; font-size: 13px; margin-bottom: 24px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
  .info-box label { font-size: 11px; color: #94a3b8; display: block; margin-bottom: 4px; }
  .info-box span { font-size: 15px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f1f5f9; border: 1px solid #ddd; padding: 10px; font-size: 13px; }
  td { font-size: 13px; }
  .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
  @media print { button { display: none; } }
</style>
</head>
<body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
  <div><h1>أمر فسح</h1><div class="sub">G.PACK ERP 2.0</div></div>
  <div style="text-align:left;font-size:22px;font-weight:900;color:#7c3aed">#${dn.note_number}</div>
</div>
<div class="info-grid">
  <div class="info-box"><label>العميل</label><span>${dn.client_name || '—'}</span></div>
  <div class="info-box"><label>رقم الطلب</label><span>#${dn.order_number || '—'}</span></div>
  <div class="info-box"><label>التاريخ</label><span>${_fmtDate(dn.created_at)}</span></div>
  <div class="info-box"><label>الحالة</label><span>${dn.status === 'delivered' ? 'مُسلَّم' : dn.status === 'partial' ? 'جزئي' : 'معلق'}</span></div>
</div>
<table>
  <thead><tr>
    <th style="text-align:right">المنتج / المقاس</th>
    <th style="text-align:center">الكمية المطلوبة</th>
    <th style="text-align:center">الكمية المسلَّمة</th>
  </tr></thead>
  <tbody>${items || '<tr><td colspan="3" style="text-align:center;padding:16px;color:#94a3b8">لا توجد بنود</td></tr>'}</tbody>
</table>
${dn.notes ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:16px;font-size:13px"><b>ملاحظات:</b> ${dn.notes}</div>` : ''}
<div style="margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:40px">
  <div style="border-top:2px solid #1e293b;padding-top:8px;text-align:center;font-size:12px">توقيع المستلم</div>
  <div style="border-top:2px solid #1e293b;padding-top:8px;text-align:center;font-size:12px">توقيع المسلِّم</div>
</div>
<div class="footer">
  <span>تاريخ الطباعة: ${new Date().toLocaleDateString('en-GB')}</span>
  <span>G.PACK ERP 2.0</span>
</div>
<br>
<button onclick="window.print()" style="padding:10px 24px;background:#7c3aed;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:700">🖨️ طباعة</button>
</body></html>`;

            const win = window.open('', '_blank', 'width=800,height=600');
            if (!win) {
                _toast('المتصفح يحظر النوافذ المنبثقة. يرجى السماح بالنوافذ المنبثقة لهذا الموقع.', 'error');
                return;
            }
            win.document.write(html);
            win.document.close();
            win.focus();
        } catch (err) {
            _toast('فشل تحميل بيانات أمر الفسح', 'error');
            console.error('[poView] printDN:', err);
        }
    }

    // ── Receive Goods Modal ────────────────────────────────────────────────────
    async function _openReceiveModal(moId) {
        const mo = _hubMOs.find(m => m.id === moId);
        if (!mo) { _toast('لم يتم العثور على أمر المورد', 'error'); return; }

        _setVal('receive-mo-id', moId);
        _setText('receive-mo-supplier', mo.supplier_name || '—');

        // Reload warehouses to get latest data
        await _loadWarehouses();

        // Populate warehouse select
        const wSel = _el('receive-warehouse-select');
        if (wSel) {
            wSel.innerHTML = '<option value="">— المستودع *—</option>' +
                _warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
        }

        // Populate items — only items with remaining qty
        const container = _el('receive-items-container');
        if (container) {
            const receivableItems = (mo.items || []).filter(item => {
                const moQty  = parseFloat(item.mo_quantity || item.po_quantity || 0);
                const recQty = parseFloat(item.received_qty || 0);
                return moQty - recQty > 0;
            });

            if (!receivableItems.length) {
                container.innerHTML = '<p class="text-sm text-emerald-600 font-bold text-center py-4">✓ تم استلام جميع الأصناف بالكامل</p>';
            } else {
                container.innerHTML = receivableItems.map(item => {
                    const moQty  = parseFloat(item.mo_quantity || item.po_quantity || 0);
                    const recQty = parseFloat(item.received_qty || 0);
                    const remQty = moQty - recQty;
                    const estCost = parseFloat(item.unit_cost || 0);
                    return `<div class="py-3 border-b border-slate-100 last:border-0">
                        <div class="flex flex-col gap-2">
                            <div class="flex items-center justify-between">
                                <div class="flex-1">
                                    <div class="text-sm font-semibold text-slate-800">${item.product_name || '—'} ${item.size_name || ''}</div>
                                    <div class="flex gap-3 text-xs mt-0.5">
                                        <span class="text-slate-400">المطلوب: <b class="text-blue-600">${moQty}</b></span>
                                        ${recQty > 0 ? `<span class="text-slate-400">مستلم سابقاً: <b class="text-emerald-600">${recQty}</b></span>` : ''}
                                        <span class="text-slate-400">المتبقي: <b class="text-orange-600">${remQty}</b></span>
                                        <span class="text-slate-400">سعر الوحدة: <b class="text-purple-600">${estCost.toFixed(2)}</b></span>
                                    </div>
                                </div>
                            </div>
                            <input type="hidden" data-receive-moi="${item.manufacturer_order_item_id || item.id}"
                                                 data-receive-variant="${item.variant_id || ''}"
                                                 data-receive-oi="${item.order_item_id || ''}">
                            <input type="hidden" data-receive-unit-cost value="${estCost}">
                            <div class="grid grid-cols-2 gap-2">
                                <div class="flex flex-col">
                                    <label class="text-xs text-slate-500 mb-0.5">الكمية المستلمة</label>
                                    <input type="number" min="0" max="${remQty}" step="1"
                                           value="0"
                                           data-receive-qty
                                           class="px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center font-bold outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all" />
                                </div>
                                <div class="flex flex-col">
                                    <label class="text-xs text-slate-500 mb-0.5">ملاحظات الصنف</label>
                                    <input type="text" 
                                           data-receive-item-notes
                                           placeholder="اختياري"
                                           class="px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center outline-none focus:border-slate-400 transition-all">
                                </div>
                            </div>
                        </div>
                    </div>`;
                }).join('');
            }
        }

        // Reset fields
        _setVal('receive-notes', '');
        _setVal('receive-supplier-invoice-ref', '');
        const hasInvoiceToggle = _el('receive-has-invoice');
        if (hasInvoiceToggle) hasInvoiceToggle.checked = false;

        _showModal('po-receive-modal');
    }

    function _onReceiveInvoiceToggle() {
        const hasInvoice = _el('receive-has-invoice')?.checked || false;
        const refInput = _el('receive-supplier-invoice-ref');
        if (refInput) {
            refInput.disabled = !hasInvoice;
            if (!hasInvoice) refInput.value = '';
        }
    }

    async function _saveReceive() {
        const moId        = _el('receive-mo-id')?.value;
        const warehouseId = _el('receive-warehouse-select')?.value;
        const notes       = _el('receive-notes')?.value || '';
        const hasInvoice  = _el('receive-has-invoice')?.checked || false;
        const supplierInvoiceRef = _el('receive-supplier-invoice-ref')?.value || '';

        if (!warehouseId) { _toast('اختر المستودع أولاً', 'error'); return; }

        const container = _el('receive-items-container');
        if (!container) return;

        const qtyEls     = container.querySelectorAll('[data-receive-qty]');
        const notesEls   = container.querySelectorAll('[data-receive-item-notes]');
        const moiEls     = container.querySelectorAll('[data-receive-moi]');
        const variantEls = container.querySelectorAll('[data-receive-variant]');
        const oiEls      = container.querySelectorAll('[data-receive-oi]');

        const items = [];
        for (let i = 0; i < qtyEls.length; i++) {
            const qty       = parseFloat(qtyEls[i].value);
            const itemNotes   = notesEls[i]?.value || '';
            const moid      = moiEls[i]?.getAttribute('data-receive-moi');
            const vid       = variantEls[i]?.getAttribute('data-receive-variant');
            const oid       = oiEls[i]?.getAttribute('data-receive-oi');
            if (qty > 0 && vid) {
                items.push({
                    manufacturer_order_item_id: moid,
                    variant_id:   vid,
                    order_item_id: oid || undefined,
                    quantity: qty,
                    item_notes: itemNotes,
                });
            }
        }

        if (!items.length) { _toast('أدخل كمية واحدة على الأقل', 'error'); return; }

        try {
            const res = await window.apiFetch(`/api/manufacturer-orders/${moId}/receive`, {
                method: 'POST',
                body: {
                    warehouse_id: warehouseId,
                    items,
                    has_supplier_invoice: hasInvoice,
                    supplier_invoice_ref: supplierInvoiceRef,
                    notes,
                },
            });
            _toast(res?.message || 'تم تسجيل الاستلام بنجاح');
            _hideModal('po-receive-modal');
            // Refresh hub data
            const [orderRes, moRes] = await Promise.all([
                window.apiFetch(`/api/orders/${_hubOrderId}`),
                window.apiFetch(`/api/manufacturer-orders/by-order/${_hubOrderId}`),
            ]);
            _hubOrder = orderRes?.data || _hubOrder;
            _hubItems = _hubOrder?.items || [];
            _hubMOs   = moRes?.data || [];
            _renderHubHeader();
            _renderHubItems();
            await _loadOrders();
        } catch (err) {
            _toast(err.message || 'فشل تسجيل الاستلام', 'error');
        }
    }

    // ── Assign Supplier Modal ──────────────────────────────────────────────────
    function _openAssignModal(orderItemId) {
        const item = _hubItems.find(i => i.id === orderItemId);
        if (!item) { _toast('الصنف غير موجود', 'error'); return; }

        const qty       = parseFloat(item.quantity || 0);
        const assigned  = parseFloat(item.manufacturer_po_qty || 0);
        const available = qty - assigned;

        _setVal('assign-order-item-id', orderItemId);
        _setVal('assign-order-id',      _hubOrderId);
        _setText('assign-item-name',      `${item.product_name || '—'} ${item.size_name || ''}`);
        _setText('assign-item-qty',       qty);
        _setText('assign-item-assigned',  assigned);
        _setText('assign-item-available', available);
        _setVal('assign-qty',             available > 0 ? available : '');
        _setVal('assign-expected-delivery','');
        _setVal('assign-notes',           '');

        // Design status - read from order item and set radio button
        const designStatus = item.design_status || 'new';
        const isNew = designStatus === 'new';
        const isRedesign = !isNew; // anything other than 'new' is reprint/redesign

        // Set radio button based on item's design_status
        const radios = document.querySelectorAll('input[name="assign-design-status"]');
        radios.forEach(r => {
            r.checked = (r.value === 'new' && isNew) || (r.value === 'reprint' && isRedesign);
        });

        // Set hidden design_id input
        _setVal('assign-selected-design-id', item.design_id || '');
        _setVal('upload-design-client-id', item.client_id || '');

        // Show design preview
        const previewBox = _el('assign-design-preview-box');
        const noDesignBox = _el('assign-no-design-box');
        const nameEl = _el('assign-design-name');
        const typeLabel = _el('assign-design-type-label');
        const btnText = _el('assign-design-btn-text');
        const statusBadge = _el('assign-design-status-badge');

        if (item.design_id) {
            // Has design - show preview
            if (previewBox) previewBox.classList.remove('hidden');
            if (noDesignBox) noDesignBox.classList.add('hidden');
            if (statusBadge) {
                statusBadge.textContent = isNew ? 'تصميم جديد' : 'إعادة طباعة';
                statusBadge.className = `text-xs px-2 py-0.5 rounded-full ${isNew ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`;
                statusBadge.classList.remove('hidden');
            }
            if (btnText) btnText.textContent = 'تغيير التصميم';

            // Set thumbnail
            const displayName = item.design_name || 'تصميم #' + (item.design_id || '').substring(0, 8);
            _setAssignPreviewMedia(item.design_thumbnail, displayName, isNew ? 'تصميم جديد' : 'إعادة طباعة', _getFileExt(item.design_thumbnail || ''));
            if (nameEl) nameEl.textContent = displayName;
            if (typeLabel) typeLabel.textContent = isNew ? 'تصميم جديد' : 'إعادة طباعة';
        } else {
            // No design
            if (previewBox) previewBox.classList.add('hidden');
            if (noDesignBox) noDesignBox.classList.remove('hidden');
            if (statusBadge) statusBadge.classList.add('hidden');
            if (btnText) btnText.textContent = 'اختر تصميم';
            _setAssignPreviewMedia('', '', '');
        }

        // Store item with client_id for design operations
        _currentAssignItem = {
            ...item,
            client_id: _hubOrder?.client_id || _hubOrder?.client?.id
        };

        const sel = _el('assign-supplier-select');
        if (sel) {
            sel.innerHTML = '<option value="">— اختر المورد —</option>' +
                _suppliers.map(s => `<option value="${s.id}">${s.company_name || s.name}</option>`).join('');
        }
        _showModal('po-assign-modal');
    }

    async function _saveAssignment() {
        const orderItemId = _el('assign-order-item-id')?.value;
        const orderId     = _el('assign-order-id')?.value;
        const supplierId  = _el('assign-supplier-select')?.value;
        const qty         = parseFloat(_el('assign-qty')?.value);
        const expDelivery = _el('assign-expected-delivery')?.value;
        const notes       = _el('assign-notes')?.value;

        // Get selected design status from radio buttons
        const designStatusRadio = document.querySelector('input[name="assign-design-status"]:checked');
        const selectedDesignStatus = designStatusRadio?.value || 'new';

        // Get the selected design_id from the hidden input (set when selecting/uploading design)
        const selectedDesignId = _el('assign-selected-design-id')?.value;
        
        // For 'reprint', use the original item's design_id if no new design selected
        const item = _hubItems.find(i => i.id === orderItemId);
        const designId = selectedDesignId || (selectedDesignStatus !== 'new' ? item?.design_id : null);

        if (!supplierId) { _toast('اختر المورد', 'error'); return; }
        if (!qty || qty <= 0) { _toast('أدخل كمية صحيحة', 'error'); return; }

        try {
            await window.apiFetch('/api/manufacturer-orders', {
                method: 'POST',
                body: {
                    order_id:          orderId,
                    supplier_id:       supplierId,
                    items:             [{
                        order_item_id: orderItemId,
                        quantity: qty,
                        design_status: selectedDesignStatus,
                        design_id: designId
                    }],
                    expected_delivery: expDelivery || null,
                    notes:             notes       || null,
                },
            });
            _toast('تم إنشاء أمر التشغيل للمورد بنجاح');
            _hideModal('po-assign-modal');
            // Refresh
            const [orderRes, moRes] = await Promise.all([
                window.apiFetch(`/api/orders/${_hubOrderId}`),
                window.apiFetch(`/api/manufacturer-orders/by-order/${_hubOrderId}`),
            ]);
            _hubOrder = orderRes?.data || _hubOrder;
            _hubItems = _hubOrder?.items || [];
            _hubMOs   = moRes?.data || [];
            _renderHubItems();
            await _loadOrders();
        } catch (err) {
            _toast(err.message || 'فشل إنشاء أمر التشغيل', 'error');
        }
    }

    // ── Design Selector Modal ────────────────────────────────────────────────
    let _clientDesigns = [];
    let _currentAssignItem = null;

    async function _openDesignSelector() {
        if (!_currentAssignItem?.client_id) {
            _toast('لا يوجد عميل مرتبط بالصنف', 'error');
            return;
        }

        _showModal('po-design-selector-modal');
        _setVal('design-search', '');
        document.getElementById('design-selector-list').innerHTML = '<p class="text-center text-slate-400 py-4">جاري تحميل التصاميم...</p>';

        try {
            const variantId = _currentAssignItem?.variant_id || _currentAssignItem?.product_variant_id;
            const res = await window.apiFetch(`/api/client-designs?client_id=${_currentAssignItem.client_id}&variant_id=${variantId}`);
            _clientDesigns = res?.data || [];
            _renderDesignList(_clientDesigns);
        } catch (err) {
            document.getElementById('design-selector-list').innerHTML = '<p class="text-center text-red-400 py-4">فشل تحميل التصاميم</p>';
        }
    }

    function _closeDesignSelector() {
        _hideModal('po-design-selector-modal');
    }

    function _renderDesignList(designs) {
        const container = document.getElementById('design-selector-list');
        if (!designs.length) {
            container.innerHTML = '<p class="text-center text-slate-400 py-4">لا توجد تصاميم لهذا الصنف</p>';
            return;
        }

        container.innerHTML = designs.map(d => {
            const designName = d.design_name || `تصميم ${d.design_number || ''}`;
            const previewMarkup = _buildDesignPreviewMarkup(d.thumbnail_url, designName, { variant: 'thumb' });
            const safeNameAttr = _escapeAttrValue(designName);
            const safeUrlAttr = _escapeAttrValue(d.thumbnail_url || '');
            const fileExtAttr = _escapeAttrValue(_getFileExt(d.thumbnail_url || ''));
            return `
            <div onclick="window.poView._selectDesign('${d.id}', '${safeNameAttr}', '${safeUrlAttr}', '${fileExtAttr}')"
                 class="flex items-center gap-3 p-3 bg-slate-50 hover:bg-brand-50 border border-slate-200 hover:border-brand-300 rounded-lg cursor-pointer transition-all">
                <div class="w-12 h-12 rounded bg-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
                    ${previewMarkup}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-bold text-slate-800 truncate">${designName}</div>
                    <div class="text-xs text-slate-500">#${d.design_number || (d.id || '').substring(0, 8)}</div>
                </div>
                <i class="fa-solid fa-check-circle text-slate-300"></i>
            </div>`;
        }).join('');
    }

    function _filterDesigns(query) {
        const q = query.toLowerCase();
        const filtered = _clientDesigns.filter(d =>
            (d.design_name || '').toLowerCase().includes(q) ||
            (d.design_number || '').toString().includes(q)
        );
        _renderDesignList(filtered);
    }

    function _selectDesign(designId, designName, thumbnail, extension) {
        // Update hidden input
        _setVal('assign-selected-design-id', designId);

        // Update preview
        const previewBox = _el('assign-design-preview-box');
        const noDesignBox = _el('assign-no-design-box');
        const nameEl = _el('assign-design-name');
        const btnText = _el('assign-design-btn-text');
        const statusBadge = _el('assign-design-status-badge');

        if (previewBox) previewBox.classList.remove('hidden');
        if (noDesignBox) noDesignBox.classList.add('hidden');
        if (btnText) btnText.textContent = 'تغيير التصميم';
        if (statusBadge) {
            statusBadge.classList.remove('hidden');
            statusBadge.textContent = 'إعادة طباعة';
            statusBadge.className = 'text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700';
        }

        _setAssignPreviewMedia(thumbnail, designName, 'إعادة طباعة', extension);
        if (nameEl) nameEl.textContent = designName;

        // Auto switch to reprint when selecting existing design
        const reprintRadio = document.querySelector('input[name="assign-design-status"][value="reprint"]');
        if (reprintRadio) reprintRadio.checked = true;

        _closeDesignSelector();
        _toast('تم اختيار التصميم');
    }

    // ── Design Upload Modal ───────────────────────────────────────────────────
    let _selectedDesignFile = null;

    function _openDesignUpload() {
        if (!_currentAssignItem?.client_id) {
            _toast('لا يوجد عميل مرتبط بالصنف', 'error');
            return;
        }
        _setVal('upload-design-client-id', _currentAssignItem.client_id);
        _setVal('upload-design-name', '');
        _clearDesignFile();
        _showModal('po-design-upload-modal');
    }

    function _closeDesignUpload() {
        _hideModal('po-design-upload-modal');
    }

    function _onDesignFileSelected(input) {
        const file = input?.files?.[0];
        if (!file) return;

        _selectedDesignFile = file;

        const fileInfo = _el('upload-design-file-info');
        const fileName = _el('upload-design-file-name');
        const previewImg = _el('upload-design-preview-img');

        if (fileInfo) fileInfo.classList.remove('hidden');
        if (fileName) fileName.textContent = `${file.name} (${(file.size/1024/1024).toFixed(2)} MB)`;

        // Show local preview for images
        if (previewImg && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                previewImg.src = e.target.result;
                previewImg.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        }
    }

    function _clearDesignFile() {
        _selectedDesignFile = null;
        const input = _el('upload-design-file');
        if (input) input.value = '';

        const fileInfo = _el('upload-design-file-info');
        if (fileInfo) fileInfo.classList.add('hidden');
    }

    async function _uploadDesign() {
        const name = _el('upload-design-name')?.value?.trim();
        const clientId = _el('upload-design-client-id')?.value;
        const uploadBtn = _el('upload-design-btn');
        const uploadText = _el('upload-design-btn-text');
        const uploadSpinner = _el('upload-design-spinner');

        if (!name) { _toast('أدخل اسم التصميم', 'error'); return; }
        if (!_selectedDesignFile) { _toast('اختر ملف التصميم', 'error'); return; }

        // Show loading state
        if (uploadBtn) uploadBtn.disabled = true;
        if (uploadText) uploadText.textContent = 'جاري الرفع...';
        if (uploadSpinner) uploadSpinner.classList.remove('hidden');

        const formData = new FormData();
        formData.append('design_name', name);
        formData.append('client_id', clientId);
        formData.append('variant_id', _currentAssignItem?.variant_id || _currentAssignItem?.product_variant_id || '');
        formData.append('thumbnail', _selectedDesignFile);

        try {
            const res = await fetch('/api/client-designs', {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `فشل الرفع: ${res.status}`);
            }

            const data = await res.json();
            const design = data?.data;

            // Log for debugging
            console.log('[Upload] Design response:', design);

            // Update assignment with new design
            _setVal('assign-selected-design-id', design?.id || '');

            const previewBox = _el('assign-design-preview-box');
            const noDesignBox = _el('assign-no-design-box');
            const nameEl = _el('assign-design-name');
            const btnText = _el('assign-design-btn-text');
            const statusBadge = _el('assign-design-status-badge');

            if (previewBox) previewBox.classList.remove('hidden');
            if (noDesignBox) noDesignBox.classList.add('hidden');
            if (btnText) btnText.textContent = 'تغيير التصميم';
            if (statusBadge) {
                statusBadge.classList.remove('hidden');
                statusBadge.textContent = 'تصميم جديد';
                statusBadge.className = 'text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700';
            }

            _setAssignPreviewMedia(design?.thumbnail_url || '', name, 'تصميم جديد', _getFileExt(design?.thumbnail_url || ''));
            if (nameEl) nameEl.textContent = name;

            // Auto switch to new design
            const newRadio = document.querySelector('input[name="assign-design-status"][value="new"]');
            if (newRadio) newRadio.checked = true;

            _closeDesignUpload();
            _toast('تم رفع التصميم بنجاح');
        } catch (err) {
            _toast(err.message || 'فشل رفع التصميم', 'error');
            console.error('[Upload] Error:', err);
        } finally {
            // Reset button state
            const uploadBtn = _el('upload-design-btn');
            const uploadText = _el('upload-design-btn-text');
            const uploadSpinner = _el('upload-design-spinner');
            if (uploadBtn) uploadBtn.disabled = false;
            if (uploadText) uploadText.textContent = 'رفع';
            if (uploadSpinner) uploadSpinner.classList.add('hidden');
        }
    }

    // ── Invoice Modal ──────────────────────────────────────────────────────────
    async function _openInvoiceModal() {
        _setVal('invoice-notes', '');
        _setVal('invoice-extra-expenses', '');
        _setVal('invoice-extra-desc', '');
        _setVal('invoice-discount', '');

        // Load previous payments, render items, and fetch proforma data in parallel
        const [, fin, proforma] = await Promise.all([
            _renderInvoiceItems(),
            window.apiFetch(`/api/orders/${_hubOrderId}/financial`).catch(() => null),
            window.apiFetch(`/api/orders/${_hubOrderId}/proforma`).catch(() => null),
        ]);

        const totalPaid = (fin?.data?.payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
        _invoicePrevPaid = totalPaid;
        _setText('invoice-prev-paid', `${_fmt(totalPaid)} ر.س`);

        // Pre-fill expenses & discount from existing proforma (if any)
        const proformaData = proforma?.data;
        if (proformaData) {
            if (parseFloat(proformaData.additional_expenses || 0) > 0) {
                _setVal('invoice-extra-expenses', parseFloat(proformaData.additional_expenses).toFixed(2));
                const expDesc = (proformaData.expenses && proformaData.expenses[0]?.description) || '';
                _setVal('invoice-extra-desc', expDesc);
            }
            if (parseFloat(proformaData.discount_amount || 0) > 0) {
                _setVal('invoice-discount', parseFloat(proformaData.discount_amount).toFixed(2));
            }
        }

        _calcInvoiceTotal();
        _showModal('po-invoice-modal');
    }

    async function _renderInvoiceItems() {
        const container = _el('invoice-items-container');
        if (!container) return;

        const type = _el('invoice-type')?.value || 'proforma';
        const isProforma = type === 'proforma';

        const billableItems = _hubItems.filter(item => parseFloat(item.manufacturer_po_qty || 0) > 0);

        // Available qty for invoicing = wh_received_qty on this order item (NOT total warehouse stock).
        // Total warehouse stock is shared across all orders; we must only allow invoicing what was
        // received specifically for this order.
        container.innerHTML = billableItems.map(item => {
            const whReceived = Math.floor(parseFloat(item.wh_received_qty || 0));
            const orderQty   = Math.floor(parseFloat(item.quantity || 0));
            const qty        = isProforma ? orderQty : whReceived;
            const available  = whReceived;
            const maxAttr    = isProforma ? `max="${orderQty}"` : `max="${available}"`;
            const stockBadge = available <= 0
                ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600" title="الكمية المستلمة للطلب">لم يُستلم بعد</span>`
                : `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700" title="الكمية المستلمة للطلب">${available}</span>`;
            return `<div class="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0">
                    <div class="flex-1 min-w-0">
                        <p class="text-sm text-slate-700 font-semibold truncate">${item.product_name || '\u2014'} ${item.size_name || ''}</p>
                        <div class="flex items-center gap-1 mt-0.5">
                            <span class="text-[10px] text-slate-400">\u0645\u062a\u0627\u062d:</span>
                            ${stockBadge}
                        </div>
                    </div>
                    <input type="hidden" data-variant-id="${item.variant_id || ''}">
                    <div class="flex items-center gap-2">
                        <input type="number" min="0" ${maxAttr} step="1" value="${Math.floor(qty)}"
                               data-item-qty data-available="${available ?? ''}"
                               class="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center outline-none focus:border-brand-500"
                               oninput="window.poView.calcInvoiceTotal()">
                        <input type="number" min="0" step="0.01" value="${parseFloat(item.unit_price||0).toFixed(2)}"
                               data-item-price
                               class="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center outline-none focus:border-brand-500"
                               oninput="window.poView.calcInvoiceTotal()">
                    </div>
                </div>`;
        }).join('') || '<p class="text-sm text-slate-400 text-center py-3">\u0644\u0627 \u062a\u0648\u062c\u062f \u0628\u0646\u0648\u062f</p>';

        _calcInvoiceTotal();
    }

    function _calcInvoiceTotal() {
        const container = _el('invoice-items-container');
        if (!container) return;
        let subtotal = 0;
        const qtyEls   = container.querySelectorAll('[data-item-qty]');
        const priceEls = container.querySelectorAll('[data-item-price]');
        qtyEls.forEach((qEl, i) => {
            subtotal += parseFloat(qEl.value || 0) * parseFloat(priceEls[i]?.value || 0);
        });
        const discount = parseFloat(_el('invoice-discount')?.value || 0);
        const extra    = parseFloat(_el('invoice-extra-expenses')?.value || 0);
        const tax   = subtotal * 0.15;
        const total = Math.max(0, subtotal + tax + extra - discount);
        _setText('invoice-total-display', `${_fmt(total)} ر.س`);

        // Calculate net remaining (total - previous payments)
        const netRemaining = Math.max(0, total - (_invoicePrevPaid || 0));
        _setText('invoice-net-remaining', `${_fmt(netRemaining)} ر.س`);
    }

    async function _saveInvoice() {
        const type      = _el('invoice-type')?.value || 'proforma';
        const extra     = parseFloat(_el('invoice-extra-expenses')?.value) || 0;
        const extraDesc = (_el('invoice-extra-desc')?.value || '').trim();
        const discount  = parseFloat(_el('invoice-discount')?.value) || 0;
        const notes     = _el('invoice-notes')?.value || '';
        const container = _el('invoice-items-container');
        if (!container) return;

        const qtyEls     = container.querySelectorAll('[data-item-qty]');
        const priceEls   = container.querySelectorAll('[data-item-price]');
        const variantEls = container.querySelectorAll('[data-variant-id]');
        const items = [];

        for (let i = 0; i < qtyEls.length; i++) {
            const qty   = parseFloat(qtyEls[i].value);
            const price = parseFloat(priceEls[i]?.value);
            const vid   = variantEls[i]?.getAttribute('data-variant-id');
            if (qty > 0 && price > 0 && vid) items.push({ variant_id: vid, qty, unit_price: price });
        }

        if (!items.length) { _toast('أضف بنداً واحداً على الأقل', 'error'); return; }

        // Frontend validation: check qty vs available stock (final invoices only)
        const qtyEls2 = type === 'final' ? container.querySelectorAll('[data-item-qty]') : [];
        for (const inp of qtyEls2) {
            const available = inp.getAttribute('data-available');
            if (available === '' || available === null) continue;
            const avNum = parseFloat(available);
            const enteredQty = parseFloat(inp.value || 0);
            if (enteredQty > avNum) {
                _toast(`الكمية المطلوبة (${enteredQty}) تتجاوز الكمية المستلمة لهذا الطلب (${avNum})`, 'error');
                inp.classList.add('border-red-400');
                return;
            }
            inp.classList.remove('border-red-400');
        }

        try {
            await window.apiFetch(`/api/orders/${_hubOrderId}/invoice`, {
                method: 'POST',
                body: { type, items, additional_expenses: extra, additional_expense_label: extraDesc, discount_amount: discount, notes },
            });
            _toast('تم إصدار الفاتورة بنجاح');
            _hideModal('po-invoice-modal');
            _setVal('invoice-extra-expenses', '');
            _setVal('invoice-extra-desc', '');
            _setVal('invoice-discount', '');
            // Reload order to get updated grand_total after final invoice sync
            if (type === 'final') {
                const fresh = await window.apiFetch(`/api/orders/${_hubOrderId}`);
                if (fresh?.data) { _hubOrder = fresh.data; _renderHubHeader(); }
            }
            await _renderHubFinancial();
        } catch (err) {
            _toast(err.message || 'فشل إصدار الفاتورة', 'error');
        }
    }

    // ── Payment Modal ──────────────────────────────────────────────────────────
    async function _openPaymentModal() {
        const remaining = Math.max(0,
            parseFloat(_hubOrder.grand_total || 0) - parseFloat(_hubOrder.paid_amount || 0)
        );
        _setText('payment-remaining-display', `${_fmt(remaining)} ر.س`);
        _setVal('payment-amount', '');
        _setVal('payment-notes',  '');

        // Reset to cash
        _setVal('payment-method', 'cash');
        _onPaymentMethodChange('cash');

        // Load cash boxes, bank accounts, POS terminals in parallel
        await Promise.all([
            _loadCashBoxes(),
            _loadBankAccounts(),
            _loadPosTerminals(),
        ]);

        const amtEl = _el('payment-amount');
        if (amtEl) setTimeout(() => amtEl.focus(), 100);
        _showModal('po-payment-modal');
    }

    async function _loadCashBoxes() {
        try {
            const res = await window.apiFetch('/api/orders/lookup/cash-accounts');
            const sel = _el('payment-cash-box');
            if (!sel) return;
            const items = res?.data || [];
            sel.innerHTML = '<option value="">— اختر الصندوق —</option>' +
                items.map(a => `<option value="${a.code}">${a.name}</option>`).join('');
        } catch { /* no-op */ }
    }

    async function _loadBankAccounts() {
        try {
            const res = await window.apiFetch('/api/orders/lookup/bank-accounts');
            const sel = _el('payment-bank-account');
            if (!sel) return;
            const items = res?.data || [];
            sel.innerHTML = '<option value="">— اختر الحساب البنكي —</option>' +
                items.map(a => `<option value="${a.code}">${a.name}</option>`).join('');
        } catch { /* no-op */ }
    }

    async function _loadPosTerminals() {
        try {
            const res = await window.apiFetch('/api/orders/lookup/pos-terminals');
            const sel = _el('payment-pos-terminal');
            if (!sel) return;
            const items = res?.data || [];
            sel.innerHTML = '<option value="">— اختر جهاز نقاط البيع —</option>' +
                items.map(a => `<option value="${a.code}">${a.name}</option>`).join('');
        } catch { /* no-op */ }
    }

    function _onPaymentMethodChange(method) {
        const cashEl = _el('payment-cash-fields');
        const bankEl = _el('payment-bank-fields');
        const posEl  = _el('payment-pos-fields');
        if (cashEl) cashEl.classList.toggle('hidden', method !== 'cash');
        if (bankEl) bankEl.classList.toggle('hidden', method !== 'bank_transfer');
        if (posEl)  posEl.classList.toggle('hidden', method !== 'pos');
    }

    async function _savePayment() {
        const amount = parseFloat(_el('payment-amount')?.value);
        const method = _el('payment-method')?.value || 'cash';
        const notes  = _el('payment-notes')?.value  || '';

        if (!amount || amount <= 0) { _toast('أدخل مبلغاً صحيحاً', 'error'); return; }

        const body = { amount, payment_method: method, notes };

        if (method === 'cash') {
            const cashBox = _el('payment-cash-box')?.value || '';
            if (!cashBox) { _toast('اختر الصندوق', 'error'); return; }
            body.cash_box = cashBox;
        } else if (method === 'bank_transfer') {
            const bankAccount = _el('payment-bank-account')?.value || '';
            const bankRef = _el('payment-bank-ref')?.value || '';
            if (!bankAccount) { _toast('اختر الحساب البنكي', 'error'); return; }
            body.bank_account = bankAccount;
            body.bank_ref = bankRef;
        } else if (method === 'pos') {
            const posTerminal = _el('payment-pos-terminal')?.value || '';
            const posRef = _el('payment-pos-ref')?.value || '';
            if (!posTerminal) { _toast('اختر جهاز نقاط البيع', 'error'); return; }
            body.pos_terminal = posTerminal;
            body.pos_ref = posRef;
        }

        try {
            const res = await window.apiFetch(`/api/orders/${_hubOrderId}/payment`, {
                method: 'POST',
                body,
            });
            _toast('تم تسجيل الدفعة بنجاح');
            _hideModal('po-payment-modal');
            if (res?.data) {
                _hubOrder.paid_amount = res.data.paid_amount;
                _renderHubHeader();
            }
            await _renderHubFinancial();
            await _loadOrders();
        } catch (err) {
            _toast(err.message || 'فشل تسجيل الدفعة', 'error');
        }
    }

    // ── Delivery Modal ─────────────────────────────────────────────────────────
    async function _openDeliveryModal() {
        const container = _el('delivery-items-container');
        if (!container) { _showModal('po-delivery-modal'); return; }

        container.innerHTML = '<p class="text-sm text-slate-400 text-center py-4"><i class="fa-solid fa-circle-notch fa-spin"></i></p>';
        _setVal('delivery-notes', '');
        _showModal('po-delivery-modal');

        // Fetch available stock for this client
        const stockMap = {};
        try {
            const clientId = _hubOrder?.client_id;
            if (clientId) {
                const r = await window.apiFetch(`/api/inventory/stock?client_id=${clientId}`);
                (r?.data || []).forEach(s => { stockMap[s.variant_id] = parseFloat(s.qty_on_hand ?? s.quantity ?? 0); });
            }
        } catch { /* no-op */ }
        const stockFetched = Object.keys(stockMap).length > 0;

        container.innerHTML = _hubItems.map(item => {
            const ordered      = parseFloat(item.quantity        || 0);
            const delivered    = parseFloat(item.delivered_qty   || 0);
            const whReceived   = parseFloat(item.wh_received_qty || 0);
            // Can only dispatch what was physically received for THIS order
            const canDispatch  = Math.max(0, whReceived - delivered);
            const maxVal       = canDispatch;

            const receivedBadge = `<span class="text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                whReceived <= 0 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'
            }">مستلم في المخزن: ${whReceived}</span>`;
            const deliveredBadge = delivered > 0
                ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-slate-100 text-slate-500">تم تسليم: ${delivered}</span>`
                : '';
            const canBadge = `<span class="text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                canDispatch <= 0 ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'
            }">يمكن إصدار: ${canDispatch}</span>`;

            return `<div class="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                    <div class="flex-1 min-w-0">
                        <p class="text-sm text-slate-700 font-semibold truncate">${item.product_name || '\u2014'} ${item.size_name || ''}</p>
                        <div class="flex items-center gap-1 mt-0.5 flex-wrap">
                            <span class="text-[10px] text-slate-400">مطلوب: ${ordered}</span>
                            ${receivedBadge}
                            ${deliveredBadge}
                            ${canBadge}
                        </div>
                    </div>
                    <input type="hidden" data-delivery-variant="${item.variant_id || ''}" data-delivery-available="${canDispatch}" data-delivery-remaining="${canDispatch}">
                    <input type="number" min="0" max="${maxVal}" step="1" value="${maxVal > 0 ? maxVal : 0}"
                           data-delivery-qty
                           class="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center outline-none focus:border-brand-500"
                           placeholder="الكمية" ${canDispatch <= 0 ? 'disabled' : ''}>
                </div>`;
        }).join('') || '<p class="text-sm text-slate-400 text-center py-3">\u0644\u0627 \u062a\u0648\u062c\u062f \u0628\u0646\u0648\u062f</p>'
    }

    async function _saveDelivery() {
        const container = _el('delivery-items-container');
        if (!container) return;
        const notes = _el('delivery-notes')?.value || '';

        const qtyEls     = container.querySelectorAll('[data-delivery-qty]');
        const variantEls = container.querySelectorAll('[data-delivery-variant]');
        const items = [];

        for (let i = 0; i < qtyEls.length; i++) {
            const qty       = parseFloat(qtyEls[i].value);
            const vid       = variantEls[i]?.getAttribute('data-delivery-variant');
            const available = variantEls[i]?.getAttribute('data-delivery-available');
            if (!qty || qty <= 0 || !vid) continue;
            // Frontend stock check
            if (available !== '' && available !== null) {
                const avNum = parseFloat(available);
                if (qty > avNum) {
                    _toast(`الكمية (${qty}) تتجاوز المخزون المتاح (${avNum})`, 'error');
                    qtyEls[i].classList.add('border-red-400');
                    return;
                }
            }
            qtyEls[i].classList.remove('border-red-400');
            items.push({ variant_id: vid, quantity: qty });
        }

        if (!items.length) { _toast('أدخل كمية واحدة على الأقل', 'error'); return; }

        try {
            // Create delivery note only (pending) — warehouse manager dispatches from warehouses page
            const dnRes = await window.apiFetch('/api/delivery-notes', {
                method: 'POST',
                body: { order_id: _hubOrderId, client_id: _hubOrder.client_id, items, notes },
            });
            const dnId = dnRes?.data?.id;
            if (!dnId) throw new Error('فشل إنشاء سند التسليم');

            _toast('تم إصدار سند التسليم — بانتظار موافقة أمين المستودع ✅');
            _hideModal('po-delivery-modal');
            await _renderHubDelivery();
        } catch (err) {
            _toast(err.message || 'فشل إصدار سند التسليم', 'error');
        }
    }

    // ── Print Invoice ─────────────────────────────────────────────────────────
    async function _shareInvoice(invoiceId) {
        try {
            _toast('جاري إنشاء الرابط...', 'info');
            const res = await window.apiFetch(`/api/invoices/${invoiceId}/share`, {
                method: 'POST',
                body: JSON.stringify({ expires_days: 30 })
            });
            if (!res?.url) throw new Error('تعذّر إنشاء الرابط');
            await navigator.clipboard.writeText(res.url);
            _toast('تم نسخ رابط الفاتورة — أرسله للعميل', 'success');
        } catch (err) {
            console.error('[poView] shareInvoice:', err);
            _toast(err.message || 'فشل إنشاء رابط المشاركة', 'error');
        }
    }

    let _editingInvoiceId = null;

    async function _editInvoice(invoiceId) {
        try {
            const res = await window.apiFetch(`/api/invoices/${invoiceId}`);
            const inv = res?.data;
            if (!inv) { _toast('تعذّر تحميل بيانات الفاتورة', 'error'); return; }

            if (inv.status === 'issued' || inv.status === 'paid' || inv.status === 'cancelled') {
                _toast('لا يمكن تعديل هذه الفاتورة', 'error'); return;
            }

            _editingInvoiceId = invoiceId;

            // Populate modal fields
            _setVal('invoice-notes', inv.notes || '');
            _setVal('invoice-extra-expenses', inv.additional_expenses || '');
            _setVal('invoice-discount', inv.discount_amount || '');

            // Set expense description
            const expDesc = (inv.expenses && inv.expenses[0]?.description) || '';
            _setVal('invoice-extra-desc', expDesc);

            // Disable type selector (can't change type during edit)
            const typeEl = _el('invoice-type');
            if (typeEl) { typeEl.value = 'proforma'; typeEl.disabled = true; }

            // Render items with existing values
            const container = _el('invoice-items-container');
            if (!container) return;

            const items = inv.items || [];
            container.innerHTML = items.map(item => {
                const qty = parseFloat(item.quantity || 0);
                const price = parseFloat(item.unit_price || 0);
                return `<div class="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0">
                    <div class="flex-1 min-w-0">
                        <p class="text-sm text-slate-700 font-semibold truncate">${item.product_name || '—'} ${item.size_name || ''}</p>
                    </div>
                    <input type="hidden" data-variant-id="${item.variant_id || ''}">
                    <div class="flex items-center gap-2">
                        <input type="number" min="0" step="1" value="${qty}"
                               data-item-qty
                               class="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center outline-none focus:border-brand-500"
                               oninput="window.poView.calcInvoiceTotal()">
                        <input type="number" min="0" step="0.01" value="${price.toFixed(2)}"
                               data-item-price
                               class="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center outline-none focus:border-brand-500"
                               oninput="window.poView.calcInvoiceTotal()">
                    </div>
                </div>`;
            }).join('');

            // Load previous payments
            const fin = await window.apiFetch(`/api/orders/${_hubOrderId}/financial`).catch(() => null);
            const totalPaid = (fin?.data?.payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
            _invoicePrevPaid = totalPaid;
            _setText('invoice-prev-paid', `${_fmt(totalPaid)} ر.س`);

            _calcInvoiceTotal();

            // Change save button text and action
            const saveBtn = _el('po-invoice-save-btn');
            if (saveBtn) {
                saveBtn.innerHTML = '<i class="fa-solid fa-check ml-1"></i> حفظ التعديلات';
                saveBtn.setAttribute('onclick', 'window.poView.saveEditInvoice()');
            }

            // Change modal title
            const titleEl = _el('po-invoice-modal-title');
            if (titleEl) titleEl.textContent = 'تعديل فاتورة أولية #' + inv.invoice_number;

            _showModal('po-invoice-modal');
        } catch (err) {
            console.error('[poView] editInvoice:', err);
            _toast(err.message || 'فشل تحميل الفاتورة للتعديل', 'error');
        }
    }

    async function _saveEditInvoice() {
        if (!_editingInvoiceId) return;

        const extra     = parseFloat(_el('invoice-extra-expenses')?.value) || 0;
        const extraDesc = (_el('invoice-extra-desc')?.value || '').trim();
        const discount  = parseFloat(_el('invoice-discount')?.value) || 0;
        const notes     = _el('invoice-notes')?.value || '';
        const container = _el('invoice-items-container');
        if (!container) return;

        const qtyEls     = container.querySelectorAll('[data-item-qty]');
        const priceEls   = container.querySelectorAll('[data-item-price]');
        const variantEls = container.querySelectorAll('[data-variant-id]');
        const items = [];

        for (let i = 0; i < qtyEls.length; i++) {
            const qty   = parseFloat(qtyEls[i].value);
            const price = parseFloat(priceEls[i]?.value);
            const vid   = variantEls[i]?.getAttribute('data-variant-id');
            if (qty > 0 && price > 0 && vid) items.push({ variant_id: vid, quantity: qty, unit_price: price });
        }

        if (!items.length) { _toast('أضف بنداً واحداً على الأقل', 'error'); return; }

        try {
            await window.apiFetch(`/api/invoices/${_editingInvoiceId}`, {
                method: 'PUT',
                body: { items, additional_expenses: extra, additional_expense_label: extraDesc, discount_amount: discount, notes },
            });
            _toast('تم تعديل الفاتورة بنجاح');
            _hideModal('po-invoice-modal');
            _resetInvoiceModal();
            await _renderHubFinancial();
        } catch (err) {
            _toast(err.message || 'فشل تعديل الفاتورة', 'error');
        }
    }

    function _resetInvoiceModal() {
        _editingInvoiceId = null;
        const typeEl = _el('invoice-type');
        if (typeEl) typeEl.disabled = false;
        const saveBtn = _el('po-invoice-save-btn');
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="fa-solid fa-check ml-1"></i> إصدار الفاتورة';
            saveBtn.setAttribute('onclick', 'window.poView.saveInvoice()');
        }
        const titleEl = _el('po-invoice-modal-title');
        if (titleEl) titleEl.textContent = 'إصدار فاتورة';
    }

    async function _printInvoice(invoiceId) {
        try {
            const res = await window.apiFetch(`/api/orders/${_hubOrderId}/invoice/${invoiceId}`);
            const inv = res?.data;
            if (!inv) { _toast('تعذر تحميل بيانات الفاتورة', 'error'); return; }

            const items = inv.items || [];
            const expenseItems = (inv.expenses || []).map(exp => ({
                product_name: exp.description
                    ? `مصاريف إضافية (${exp.description})`
                    : 'مصاريف إضافية',
                size_name: '',
                quantity: 1,
                unit_price: parseFloat(exp.amount || 0),
                line_total: parseFloat(exp.amount || 0),
                discount_percent: 0,
                isExpense: true,
            }));
            const tableItems = [...items, ...expenseItems];
            const payments = inv.payments || [];
            const totalPaid = payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
            const remaining = Math.max(0, parseFloat(inv.grand_total || 0) - totalPaid);
            const logoBase64 = await _loadLogoBase64();
            const isProforma = inv.status !== 'issued';
            const invoiceTitle = isProforma ? 'فاتورة أولية' : 'فاتورة نهائية';
            const PAY_M = { cash: 'نقدي', bank_transfer: 'تحويل بنكي', check: 'شيك', card: 'بطاقة' };

            const itemsRows = tableItems.map((item, idx) => {
                const qty = item.isExpense ? 1 : parseFloat(item.quantity || 0);
                const unitPrice = item.isExpense ? item.unit_price : parseFloat(item.unit_price || 0);
                const lineTotal = item.isExpense
                    ? unitPrice
                    : (item.line_total || parseFloat(item.quantity || 0) * parseFloat(item.unit_price || 0));
                const nameCell = item.isExpense
                    ? `${item.product_name || 'مصاريف إضافية'}`
                    : `${item.product_name || '—'} ${item.size_name || ''}`;
                const qtyCell = item.isExpense ? qty : qty;
                return `
                <tr>
                    <td style="padding:10px 12px; border-bottom:1px solid #e2e8f0; text-align:center; color:#64748b; font-size:13px;">${idx + 1}</td>
                    <td style="padding:10px 12px; border-bottom:1px solid #e2e8f0; font-weight:600; color:#1e293b; font-size:13px;">${nameCell}</td>
                    <td style="padding:10px 12px; border-bottom:1px solid #e2e8f0; text-align:center; color:#334155; font-size:13px;">${qtyCell}</td>
                    <td style="padding:10px 12px; border-bottom:1px solid #e2e8f0; text-align:center; color:#334155; font-size:13px;">${_fmt(unitPrice)}</td>
                    <td style="padding:10px 12px; border-bottom:1px solid #e2e8f0; text-align:center; font-weight:700; color:#0f172a; font-size:13px;">${_fmt(lineTotal)}</td>
                </tr>`;
            }).join('');

            const paymentRows = payments.length ? payments.map(p => `
                <tr>
                    <td style="padding:8px 12px; border-bottom:1px solid #e2e8f0; font-size:12px; color:#64748b;">${_fmtDate(p.created_at)}</td>
                    <td style="padding:8px 12px; border-bottom:1px solid #e2e8f0; font-size:12px; color:#334155;">${PAY_M[p.payment_method] || p.payment_method || '—'}</td>
                    <td style="padding:8px 12px; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:700; color:#059669;">${_fmt(p.amount)} ر.س</td>
                    <td style="padding:8px 12px; border-bottom:1px solid #e2e8f0; font-size:11px; color:#94a3b8;">${p.description || '—'}</td>
                </tr>`).join('') : '';

            const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
    <meta charset="UTF-8">
    <title>${invoiceTitle} #${inv.invoice_number}</title>
    <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background:#fff; color:#1e293b; padding:30px; }
        @media print { body { padding:15px; } .no-print { display:none !important; } @page { margin:15mm; } }
        .invoice-container { max-width:800px; margin:0 auto; }
        .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:30px; padding-bottom:20px; border-bottom:3px solid #4b0082; }
        .logo-section { display:flex; align-items:center; gap:12px; }
        .logo-section img { width:58px; height:58px; object-fit:contain; }
        .logo-text h1 { font-size:24px; font-weight:900; color:#4b0082; margin-bottom:4px; }
        .logo-text p { font-size:12px; color:#64748b; }
        .invoice-meta { text-align:left; }
        .invoice-meta .inv-number { font-size:22px; font-weight:900; color:#1e293b; }
        .invoice-meta .inv-date { font-size:13px; color:#64748b; margin-top:4px; }
        .invoice-type-badge { display:inline-block; padding:4px 14px; border-radius:20px; font-size:12px; font-weight:700; margin-top:8px; }
        .badge-final { background:#ffd700; color:#4b0082; }
        .badge-proforma { background:#fff7cc; color:#5d198e; }
        .client-section { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:25px; background:#f8fafc; border-radius:12px; padding:20px; border:1px solid #e2e8f0; }
        .client-section h4 { font-size:11px; color:#94a3b8; font-weight:700; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px; }
        .client-section p { font-size:14px; color:#1e293b; font-weight:600; }
        .client-section .sub { font-size:12px; color:#64748b; margin-top:2px; }
        table.items { width:100%; border-collapse:collapse; margin-bottom:20px; border-radius:12px; overflow:hidden; border:1px solid #e2e8f0; }
        table.items thead { background:linear-gradient(135deg, #4b0082, #6e329b); }
        table.items thead th { padding:12px; color:#fff; font-size:12px; font-weight:700; text-align:center; }
        table.items thead th:nth-child(2) { text-align:right; }
        table.items tbody tr:last-child td { border-bottom:none; }
        table.items tbody tr:hover { background:#f8fafc; }
        .totals-grid { display:grid; grid-template-columns:1fr 280px; gap:20px; margin-bottom:25px; }
        .totals-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:16px; }
        .total-row { display:flex; justify-content:space-between; padding:8px 0; font-size:14px; border-bottom:1px solid #f1f5f9; }
        .total-row:last-child { border-bottom:none; }
        .total-row.grand { font-size:18px; font-weight:900; color:#4b0082; padding-top:12px; border-top:2px solid #4b0082; }
        .total-row.paid { color:#059669; font-weight:700; }
        .total-row.remaining { color:#dc2626; font-weight:800; font-size:16px; padding-top:10px; border-top:2px dashed #fca5a5; }
        .payments-section { margin-bottom:25px; border:1px solid #ffd700; border-radius:8px; overflow:hidden; }
        .payments-section h3 { font-size:14px; font-weight:700; color:#4b0082; margin-bottom:10px; padding:10px 12px 0; }
        table.payments { width:100%; border-collapse:collapse; border-top:1px solid #ffd700; }
        table.payments thead { background:linear-gradient(135deg, #ffd700, #ffeb7f); }
        table.payments thead th { padding:8px 12px; font-size:11px; color:#4b0082; font-weight:700; text-align:right; }
        .footer { text-align:center; padding-top:20px; border-top:2px solid #ffd700; margin-top:30px; }
        .footer p { font-size:11px; color:#94a3b8; }
        .print-btn { position:fixed; bottom:20px; left:20px; padding:12px 24px; background:#4b0082; color:#ffd700; border:none; border-radius:10px; font-size:14px; font-weight:700; cursor:pointer; box-shadow:0 4px 12px rgba(75,0,130,0.3); }
        .print-btn:hover { background:#5d198e; }
    </style>
</head>
<body>
    <div class="invoice-container">
        <div class="header">
            <div class="logo-section">
                ${logoBase64 ? `<img src="${logoBase64}" alt="G.PACK Logo">` : ''}
                <div class="logo-text">
                    <h1>G.PACK</h1>
                    <p>حلول التعبئة والتغليف</p>
                    <p>ينبع، المملكة العربية السعودية</p>
                </div>
            </div>
            <div class="invoice-meta">
                <div class="inv-number">#${inv.invoice_number}</div>
                <div class="inv-date">${_fmtDate(inv.invoice_date)}</div>
                <span class="invoice-type-badge ${isProforma ? 'badge-proforma' : 'badge-final'}">
                    ${invoiceTitle}
                </span>
            </div>
        </div>

        <div class="client-section">
            <div>
                <h4>العميل</h4>
                <p>${inv.client_name || '—'}</p>
                <p class="sub">${inv.client_phone || ''} ${inv.client_email ? '• ' + inv.client_email : ''}</p>
                ${inv.client_address ? `<p class="sub">${inv.client_address}</p>` : ''}
                ${inv.client_tax_number ? `<p class="sub">الرقم الضريبي: ${inv.client_tax_number}</p>` : ''}
            </div>
            <div>
                <h4>مرجع الطلب</h4>
                <p>أمر #${inv.order_number}</p>
                <p class="sub">رقم الفاتورة: ${inv.invoice_number}</p>
            </div>
        </div>

        <table class="items">
            <thead>
                <tr>
                    <th>#</th>
                    <th>الصنف</th>
                    <th>الكمية</th>
                    <th>سعر الوحدة</th>
                    <th>المجموع</th>
                </tr>
            </thead>
            <tbody>
                ${itemsRows}
            </tbody>
        </table>

        <div class="totals-grid">
            <div>
                ${inv.notes ? `<div style="background:#fffbeb; border:1px solid #fef3c7; border-radius:10px; padding:12px; font-size:13px; color:#92400e;"><strong>ملاحظات:</strong> ${inv.notes}</div>` : ''}
            </div>
            <div class="totals-box">
                <div class="total-row">
                    <span>المجموع</span>
                    <span>${_fmt(parseFloat(inv.subtotal || 0) + parseFloat(inv.additional_expenses || 0))} ر.س</span>
                </div>
                <div class="total-row">
                    <span>الضريبة (${Math.round(parseFloat(inv.tax_rate || 0.15) * 100)}%)</span>
                    <span>${_fmt(inv.tax_amount)} ر.س</span>
                </div>
                ${parseFloat(inv.discount_amount || 0) > 0 ? `<div class="total-row"><span>خصم</span><span>- ${_fmt(inv.discount_amount)} ر.س</span></div>` : ''}
                <div class="total-row grand">
                    <span>الإجمالي</span>
                    <span>${_fmt(inv.grand_total)} ر.س</span>
                </div>
                ${totalPaid > 0 ? `<div class="total-row paid"><span>المدفوع</span><span>- ${_fmt(totalPaid)} ر.س</span></div>` : ''}
                ${totalPaid > 0 ? `<div class="total-row remaining"><span>المتبقي</span><span>${_fmt(remaining)} ر.س</span></div>` : ''}
            </div>
        </div>

        ${payments.length ? `
        <div class="payments-section">
            <h3>سجل الدفعات</h3>
            <table class="payments">
                <thead>
                    <tr>
                        <th>التاريخ</th>
                        <th>الطريقة</th>
                        <th>المبلغ</th>
                        <th>ملاحظات</th>
                    </tr>
                </thead>
                <tbody>${paymentRows}</tbody>
            </table>
        </div>` : ''}

        <div class="footer">
            <p>شكراً لتعاملكم معنا • G.PACK — حلول التعبئة والتغليف</p>
            <p style="margin-top:4px;">تم إنشاء هذه الفاتورة إلكترونياً ولا تحتاج إلى توقيع</p>
        </div>
    </div>
    <button class="print-btn no-print" onclick="window.print()">🖨️ طباعة</button>
</body>
</html>`;

            const w = window.open('', '_blank');
            w.document.write(html);
            w.document.close();
        } catch (err) {
            _toast(err.message || 'فشل تحميل الفاتورة', 'error');
        }
    }

    // ── Chat Notes ─────────────────────────────────────────────────────────────
    function _fmtDateTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function _renderNotesBubbles(notes) {
        const container = _el('hub-chat-messages');
        const emptyEl   = _el('hub-chat-empty');
        if (!container) return;

        const currentUser = window._currentUser?.name || window._currentUser?.username || '';

        if (!notes.length) {
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }
        if (emptyEl) emptyEl.classList.add('hidden');

        const bubblesHTML = notes.map(n => {
            const isMe = currentUser && n.user_name === currentUser;
            const align = isMe ? 'items-end' : 'items-start';
            const bubbleCls = isMe
                ? 'bg-brand-600 text-white rounded-br-sm'
                : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm';
            const nameCls = isMe ? 'text-right text-brand-600' : 'text-right text-slate-500';
            return `
            <div class="flex flex-col ${align} gap-0.5">
                <div class="flex items-center gap-2 px-1">
                    <span class="text-xs font-bold ${nameCls}">${n.user_name}</span>
                    <span class="text-xs text-slate-400">${_fmtDateTime(n.created_at)}</span>
                </div>
                <div class="max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${bubbleCls}" style="white-space:pre-wrap">${n.message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
            </div>`;
        }).join('');

        container.innerHTML = bubblesHTML;
        container.scrollTop = container.scrollHeight;
    }

    async function _renderHubNotes() {
        try {
            const res = await window.apiFetch(`/api/orders/${_hubOrderId}/notes`);
            _renderNotesBubbles(res?.data || []);
        } catch (err) {
            console.error('[notes] load error:', err);
        }
    }

    async function _sendNote() {
        const input = _el('hub-chat-input');
        const message = input?.value?.trim();
        if (!message) return;

        input.value = '';
        input.disabled = true;

        try {
            await window.apiFetch(`/api/orders/${_hubOrderId}/notes`, {
                method: 'POST',
                body: { message },
            });
            await _renderHubNotes();
        } catch (err) {
            _toast(err.message || 'فشل إرسال الرسالة', 'error');
            input.value = message;
        } finally {
            input.disabled = false;
            input.focus();
        }
    }

    async function _saveNotes() { await _renderHubNotes(); }

    // ── Tab switching (page list) ──────────────────────────────────────────────
    function _switchTab(tab) {
        _activeTab = tab;
        ['pending_assignment','active','completed','archived'].forEach(t => {
            const btn = _el(`po-tab-${t}`);
            if (!btn) return;
            if (t === tab) {
                btn.classList.remove('text-slate-500','border-transparent');
                btn.classList.add('text-brand-600','border-brand-600');
            } else {
                btn.classList.add('text-slate-500','border-transparent');
                btn.classList.remove('text-brand-600','border-brand-600');
            }
        });
        _renderTable();
    }

    // ── Modal helpers ──────────────────────────────────────────────────────────
    function _showModal(id) { const e = _el(id); if (e) e.classList.remove('hidden'); }
    function _hideModal(id) { const e = _el(id); if (e) e.classList.add('hidden'); }

    // ── Bulk Assign ────────────────────────────────────────────────────────────
    function _updateBulkBtn() {
        const count = Object.keys(_bulkSelected).length;
        const btn   = _el('hub-bulk-assign-btn');
        const badge = _el('hub-bulk-count');
        if (!btn) return;
        if (count > 0) {
            btn.classList.remove('hidden');
            btn.classList.add('flex');
            if (badge) badge.textContent = count;
        } else {
            btn.classList.add('hidden');
            btn.classList.remove('flex');
        }
    }

    function _toggleItemCheck(cb) {
        const id       = cb.dataset.itemId;
        const name     = cb.dataset.itemName;
        const qty      = parseFloat(cb.dataset.itemQty);
        const assigned = parseFloat(cb.dataset.itemAssigned);
        const designId = cb.dataset.designId || null;
        if (cb.checked) {
            _bulkSelected[id] = { id, name, qty, assigned, designId };
        } else {
            delete _bulkSelected[id];
        }
        _updateBulkBtn();
        const checkAll = _el('hub-items-check-all');
        if (checkAll) {
            const all = document.querySelectorAll('#hub-items-tbody input[type="checkbox"]');
            checkAll.checked = all.length > 0 && [...all].every(c => c.checked);
        }
    }

    function _toggleAllItems(checked) {
        _bulkSelected = {};
        const all = document.querySelectorAll('#hub-items-tbody input[type="checkbox"]');
        all.forEach(cb => {
            cb.checked = checked;
            if (checked) {
                _bulkSelected[cb.dataset.itemId] = {
                    id:       cb.dataset.itemId,
                    name:     cb.dataset.itemName,
                    qty:      parseFloat(cb.dataset.itemQty),
                    assigned: parseFloat(cb.dataset.itemAssigned),
                    designId: cb.dataset.designId || null,
                };
            }
        });
        _updateBulkBtn();
    }

    function _openBulkAssignModal() {
        const items = Object.values(_bulkSelected);
        if (!items.length) { _toast('اختر صنفاً واحداً على الأقل', 'error'); return; }

        const summaryEl = _el('bulk-items-summary');
        if (summaryEl) {
            summaryEl.innerHTML = items.map(i => {
                const available = i.qty - i.assigned;
                return `<div class="flex items-center justify-between px-3 py-2.5 text-sm">
                    <span class="font-semibold text-slate-800">${i.name}</span>
                    <span class="text-xs text-purple-600 font-bold bg-purple-50 px-2 py-0.5 rounded-full">${available} وحدة</span>
                </div>`;
            }).join('');
        }

        const sel = _el('bulk-supplier-select');
        if (sel) {
            sel.innerHTML = '<option value="">— اختر المورد —</option>' +
                _suppliers.map(s => `<option value="${s.id}">${s.company_name || s.name}</option>`).join('');
        }

        const deliveryEl = _el('bulk-expected-delivery');
        const notesEl    = _el('bulk-notes');
        if (deliveryEl) deliveryEl.value = '';
        if (notesEl)    notesEl.value    = '';
        const defaultRadio = document.querySelector('input[name="bulk-design-status"][value="new"]');
        if (defaultRadio) defaultRadio.checked = true;

        _showModal('po-bulk-assign-modal');
    }

    async function _saveBulkAssignment() {
        const supplierId  = (_el('bulk-supplier-select')   || {}).value;
        const expDelivery = (_el('bulk-expected-delivery') || {}).value;
        const notes       = (_el('bulk-notes')             || {}).value;
        const designStatus = (document.querySelector('input[name="bulk-design-status"]:checked') || {}).value || 'new';

        if (!supplierId) { _toast('اختر المورد', 'error'); return; }

        const items = Object.values(_bulkSelected).map(i => ({
            order_item_id: i.id,
            quantity:      i.qty - i.assigned,
            design_status: designStatus,
            design_id:     i.designId || null,
        }));

        if (!items.length) { _toast('لا توجد أصناف محددة', 'error'); return; }

        const btn = _el('bulk-save-btn');
        try {
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جاري الإنشاء...'; }

            await window.apiFetch('/api/manufacturer-orders', {
                method: 'POST',
                body: {
                    order_id:          _hubOrderId,
                    supplier_id:       supplierId,
                    items,
                    expected_delivery: expDelivery || null,
                    notes:             notes       || null,
                },
            });

            _toast(`تم إنشاء أمر التشغيل المجمع بـ ${items.length} أصناف`);
            _hideModal('po-bulk-assign-modal');
            await _openHub(_hubOrderId);
            await _loadOrders();
        } catch (err) {
            _toast(err.message || 'فشل إنشاء أمر التشغيل المجمع', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-layer-group ml-1"></i> إنشاء أمر التشغيل المجمع'; }
        }
    }

    // ── Init ───────────────────────────────────────────────────────────────────
    async function _init() {
        await Promise.all([_loadOrders(), _loadSuppliers(), _loadWarehouses()]);
        const searchEl = _el('po-search');
        if (searchEl) searchEl.addEventListener('input', _renderTable);
    }

    // ── Quick Add Supplier ─────────────────────────────────────────────────────
    function _openQuickSupplierModal() {
        _setVal('qs-name', '');
        _setVal('qs-type', 'manufacturer');
        _setVal('qs-contact', '');
        _setVal('qs-phone', '');
        _showModal('po-quick-supplier-modal');
    }

    async function _saveQuickSupplier() {
        const name    = _el('qs-name')?.value?.trim();
        const type    = _el('qs-type')?.value || 'manufacturer';
        const contact = _el('qs-contact')?.value?.trim() || null;
        const phone   = _el('qs-phone')?.value?.trim() || null;

        if (!name) { _toast('اسم المورد مطلوب', 'error'); return; }

        try {
            const res = await window.apiFetch('/api/suppliers', {
                method: 'POST',
                body: { company_name: name, supplier_type: type, contact_person: contact, phone },
            });

            if (res?.data) {
                _suppliers.unshift(res.data);
                const newId = res.data.id;

                const assignSel = _el('assign-supplier-select');
                if (assignSel) {
                    const opt = document.createElement('option');
                    opt.value = newId;
                    opt.textContent = res.data.company_name || res.data.name;
                    assignSel.appendChild(opt);
                    assignSel.value = newId;
                }

                const bulkSel = _el('bulk-supplier-select');
                if (bulkSel) {
                    const opt = document.createElement('option');
                    opt.value = newId;
                    opt.textContent = res.data.company_name || res.data.name;
                    bulkSel.appendChild(opt);
                    bulkSel.value = newId;
                }

                _hideModal('po-quick-supplier-modal');
                _toast('تم إضافة المورد بنجاح');
            }
        } catch (err) {
            _toast(err.message || 'فشل إضافة المورد', 'error');
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    window.poView = {
        reload:             _loadOrders,
        switchTab:          _switchTab,
        applySearch:        _renderTable,
        openHub:            _openHub,
        closeHub:           () => _hideModal('po-hub-modal'),
        switchHubTab:       _switchHubTab,
        updateStatus:       _updateStatus,
        updateMOStatus:     _updateMOStatus,
        revertSendToSupplier: _revertSendToSupplier,
        editMO:             _editMO,
        cancelMO:           _cancelMO,
        revertOrderToArchive: _revertOrderToArchive,
        printMO:            _printMO,
        printDN:            _printDN,
        openReceiveModal:   _openReceiveModal,
        closeReceiveModal:  () => _hideModal('po-receive-modal'),
        saveReceive:        _saveReceive,
        _onReceiveInvoiceToggle: _onReceiveInvoiceToggle,
        openAssignModal:      _openAssignModal,
        closeAssignModal:     () => _hideModal('po-assign-modal'),
        openAssignPreview:    _openAssignPreview,
        closeAssignPreview:   _closeAssignPreview,
        saveAssignment:       _saveAssignment,
        toggleItemCheck:      _toggleItemCheck,
        toggleAllItems:       _toggleAllItems,
        openBulkAssignModal:  _openBulkAssignModal,
        closeBulkAssignModal: () => _hideModal('po-bulk-assign-modal'),
        saveBulkAssignment:   _saveBulkAssignment,
        openInvoiceModal:   _openInvoiceModal,
        closeInvoiceModal:  () => { _resetInvoiceModal(); _hideModal('po-invoice-modal'); },
        onInvoiceTypeChange: _renderInvoiceItems,
        calcInvoiceTotal:   _calcInvoiceTotal,
        saveInvoice:        _saveInvoice,
        printInvoice:       _printInvoice,
        shareInvoice:       _shareInvoice,
        editInvoice:        _editInvoice,
        saveEditInvoice:    _saveEditInvoice,
        openPaymentModal:   _openPaymentModal,
        closePaymentModal:  () => _hideModal('po-payment-modal'),
        onPaymentMethodChange: _onPaymentMethodChange,
        savePayment:        _savePayment,
        openDeliveryModal:  _openDeliveryModal,
        closeDeliveryModal: () => _hideModal('po-delivery-modal'),
        saveDelivery:       _saveDelivery,
        saveNotes:          _saveNotes,
        sendNote:           _sendNote,
        // Design management
        _openDesignSelector:   _openDesignSelector,
        _closeDesignSelector:  _closeDesignSelector,
        _filterDesigns:        _filterDesigns,
        _selectDesign:         _selectDesign,
        _openDesignUpload:     _openDesignUpload,
        _closeDesignUpload:    _closeDesignUpload,
        _onDesignFileSelected: _onDesignFileSelected,
        _clearDesignFile:      _clearDesignFile,
        _uploadDesign:         _uploadDesign,
        // Quick add supplier
        openQuickSupplierModal:  _openQuickSupplierModal,
        closeQuickSupplierModal: () => _hideModal('po-quick-supplier-modal'),
        saveQuickSupplier:       _saveQuickSupplier,
    };

    _init();

})();
