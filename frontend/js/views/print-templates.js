'use strict';

(function () {
    let templates = [];
    let activeToken = window.getCurrentNavToken ? window.getCurrentNavToken() : 0;
    let supplierNamesVisible = false;

    const $ = id => document.getElementById(id);
    const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const safeUploadPath = value => typeof value === 'string'
        && /^\/uploads\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)
        ? value
        : null;
    const dateText = value => value ? new Date(value).toLocaleDateString('ar-SA') : '—';

    function updateSupplierPrivacyButton() {
        const button = $('print-template-supplier-privacy');
        if (!button) return;
        button.innerHTML = supplierNamesVisible
            ? '<i class="fa-solid fa-eye"></i><span>الموردون ظاهرون</span>'
            : '<i class="fa-solid fa-eye-slash"></i><span>الموردون مخفيون</span>';
        button.title = supplierNamesVisible ? 'إخفاء أسماء الموردين' : 'إظهار أسماء الموردين';
    }

    function applySupplierPrivacy() {
        document.querySelectorAll('.print-template-supplier-name').forEach(element => {
            element.textContent = supplierNamesVisible ? element.dataset.supplierName : '********';
        });
        updateSupplierPrivacyButton();
    }

    function toggleSupplierPrivacy() {
        supplierNamesVisible = !supplierNamesVisible;
        applySupplierPrivacy();
    }

    const decodeFilename = value => {
        const original = String(value ?? '');
        if (!/[ÃÂØÙÐÑ]/.test(original)) return original;
        try {
            const bytes = Uint8Array.from(original, char => char.charCodeAt(0));
            const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            return /[\u0600-\u06ff]/.test(decoded) ? decoded : original;
        } catch (_err) {
            return original;
        }
    };

    function cardTemplate(template) {
        const review = Number(template.missing_design_count || 0) > 0;
        return `<button type="button" data-template-id="${escapeHtml(template.id)}"
            class="template-card text-right bg-white border ${review ? 'border-amber-200' : 'border-slate-100'} rounded-2xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all p-5">
            <div class="flex items-start justify-between gap-3">
                <div class="w-11 h-11 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><i class="fa-solid fa-print text-lg"></i></div>
                <span class="font-mono text-sm font-extrabold text-brand-700 bg-brand-50 px-2.5 py-1 rounded-lg">${escapeHtml(template.template_code)}</span>
            </div>
            <div class="mt-4">
                <h3 class="font-extrabold text-slate-800 truncate">${escapeHtml(template.product_name)}</h3>
                <p class="text-sm text-slate-500 mt-1"><i class="fa-solid fa-ruler-combined ml-1"></i>${escapeHtml(template.size_name)}</p>
            </div>
            <div class="grid grid-cols-2 gap-2 mt-5 text-xs">
                <span class="bg-slate-50 rounded-lg p-2 text-slate-600"><b class="block text-base text-slate-800">${template.design_count || 0}</b>تصميم</span>
                <span class="bg-slate-50 rounded-lg p-2 text-slate-600"><b class="block text-base text-slate-800">${template.client_count || 0}</b>عميل</span>
                <span class="bg-slate-50 rounded-lg p-2 text-slate-600"><b class="block text-base text-slate-800">${template.supplier_count || 0}</b>مورد</span>
                <span class="bg-slate-50 rounded-lg p-2 text-slate-600"><b class="block text-base text-slate-800">${template.order_count || 0}</b>أمر تشغيل</span>
            </div>
            ${review ? '<p class="mt-4 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2"><i class="fa-solid fa-triangle-exclamation ml-1"></i>يوجد إسناد بتصميم غير موجود</p>' : ''}
        </button>`;
    }

    function render() {
        const grid = $('print-templates-grid');
        const empty = $('print-templates-empty');
        const query = ($('print-templates-search')?.value || '').trim().toLowerCase();
        const filter = $('print-templates-filter')?.value || 'all';
        const filtered = templates.filter(template => {
            const matchesSearch = !query || [template.template_code, template.product_name, template.size_name]
                .some(value => String(value || '').toLowerCase().includes(query));
            const matchesFilter = filter === 'all'
                || (filter === 'used' && Number(template.supplier_count || 0) > 0)
                || (filter === 'missing' && Number(template.missing_design_count || 0) > 0);
            return matchesSearch && matchesFilter;
        });

        if (!grid || !empty) return;
        grid.innerHTML = filtered.map(cardTemplate).join('');
        grid.classList.toggle('hidden', filtered.length === 0);
        empty.classList.toggle('hidden', filtered.length !== 0);
        grid.querySelectorAll('.template-card').forEach(card => {
            card.addEventListener('click', () => openDetails(card.dataset.templateId));
        });
    }

    async function load() {
        try {
            const response = await window.apiFetch('/api/print-templates');
            if (window.isViewActive && !window.isViewActive(activeToken)) return;
            templates = Array.isArray(response?.data) ? response.data : [];
            $('print-templates-loading')?.classList.add('hidden');
            render();
        } catch (err) {
            $('print-templates-loading').innerHTML = `<div class="text-red-400"><i class="fa-solid fa-circle-exclamation text-2xl"></i><p class="text-sm mt-3">${escapeHtml(err.message || 'فشل تحميل القوالب')}</p></div>`;
        }
    }

    function fileMarkup(file) {
        const filePath = safeUploadPath(file.path);
        if (!filePath) return `<span class="text-xs text-slate-400">ملف غير صالح</span>`;
        const isImage = String(file.mime_type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(filePath);
        const previewPath = safeUploadPath(file.preview_path) || (isImage ? filePath : null);
        const fileName = decodeFilename(file.name || file.type || 'ملف');
        return `<div class="flex items-center gap-3 border border-slate-100 rounded-xl p-3">
            <a href="${escapeHtml(filePath)}" target="_blank" rel="noopener noreferrer" class="shrink-0 block rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400" title="فتح التصميم في صفحة جديدة">
                ${previewPath ? `<div class="w-36 h-28 rounded-lg bg-slate-50 overflow-hidden"><img src="${escapeHtml(previewPath)}" alt="فتح التصميم" class="w-full h-full object-contain" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'"><div style="display:none" class="w-full h-full items-center justify-center text-slate-400"><i class="fa-solid fa-file-image text-xl"></i></div></div>` : '<div class="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400"><i class="fa-solid fa-file text-xl"></i></div>'}
            </a>
            <div class="min-w-0 flex-1"><p class="text-sm font-semibold text-slate-700 truncate">${escapeHtml(fileName)}</p><p class="text-xs text-slate-400">${escapeHtml(file.type || '')}</p></div>
            <a href="${escapeHtml(filePath)}" target="_blank" rel="noopener noreferrer" download class="text-brand-600 hover:text-brand-800" title="عرض وتحميل"><i class="fa-solid fa-download"></i></a>
        </div>`;
    }

    async function openDetails(id) {
        const modal = $('print-template-details-modal');
        const body = $('print-template-details-body');
        if (!modal || !body) return;
        supplierNamesVisible = false;
        updateSupplierPrivacyButton();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        body.innerHTML = '<div class="py-12 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-2xl"></i></div>';
        try {
            const response = await window.apiFetch(`/api/print-templates/${encodeURIComponent(id)}`);
            const template = response?.data;
            if (!template) throw new Error('القالب غير موجود');
            $('print-template-details-code').textContent = template.template_code;
            $('print-template-details-title').textContent = `${template.product_name} — ${template.size_name}`;
            body.innerHTML = template.designs.map(design => {
                const usage = Array.isArray(design.usage) ? design.usage : [];
                const files = Array.isArray(design.files) ? design.files : [];
                return `<section class="border border-slate-100 rounded-2xl p-4 mb-4">
                    <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                        <div><h3 class="font-extrabold text-slate-800">${escapeHtml(design.design_name || `تصميم ${design.design_number}`)}</h3><p class="text-sm text-slate-500 mt-1">العميل: <span class="font-bold text-slate-700">${escapeHtml(design.client_name || 'غير معروف')}</span></p></div>
                        <span class="text-xs px-2 py-1 rounded-full ${design.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${design.is_active ? 'نشط' : 'غير نشط'}</span>
                    </div>
                    ${files.length ? `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">${files.map(fileMarkup).join('')}</div>` : '<p class="mt-4 text-xs text-amber-600 bg-amber-50 rounded-lg p-3">لا توجد ملفات لهذا التصميم.</p>'}
                    <div class="mt-4"><p class="text-xs font-bold text-slate-500 mb-2">الموردون وأوامر التشغيل</p>${usage.length ? `<div class="space-y-2">${usage.map(item => {
                        const supplierName = item.supplier_name || 'مورد غير معروف';
                        const supplierLabel = item.supplier_name ? '********' : supplierName;
                        return `<div class="flex flex-wrap items-center gap-2 text-xs bg-slate-50 rounded-lg px-3 py-2"><span class="print-template-supplier-name font-bold text-slate-700" data-supplier-name="${escapeHtml(supplierName)}">${supplierLabel}</span><span class="text-slate-400">أمر تشغيل #${escapeHtml(item.order_number || '—')}</span><span class="text-slate-400">${dateText(item.used_at)}</span></div>`;
                    }).join('')}</div>` : '<p class="text-xs text-slate-400">لم يتم إسناد هذا التصميم لمورد بعد.</p>'}</div>
                    <div class="flex gap-4 mt-3 text-xs text-slate-400"><span>أول استخدام: ${dateText(design.first_used_at)}</span><span>آخر استخدام: ${dateText(design.last_used_at)}</span></div>
                </section>`;
            }).join('') || '<p class="py-10 text-center text-slate-400">لا توجد تصميمات مسجلة.</p>';
            if (template.missing_design_links?.length) {
                body.innerHTML += `<div class="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800"><b>سجلات تحتاج مراجعة:</b><p class="text-xs mt-1">يوجد ${template.missing_design_links.length} إسناد يشير إلى تصميم غير موجود.</p></div>`;
            }
            applySupplierPrivacy();
        } catch (err) {
            body.innerHTML = `<p class="py-10 text-center text-red-400">${escapeHtml(err.message || 'فشل تحميل التفاصيل')}</p>`;
        }
    }

    function closeDetails() {
        $('print-template-details-modal')?.classList.add('hidden');
        $('print-template-details-modal')?.classList.remove('flex');
    }

    $('print-templates-refresh')?.addEventListener('click', load);
    $('print-templates-search')?.addEventListener('input', render);
    $('print-templates-filter')?.addEventListener('change', render);
    $('print-template-details-close')?.addEventListener('click', closeDetails);
    $('print-template-supplier-privacy')?.addEventListener('click', toggleSupplierPrivacy);
    $('print-template-details-modal')?.addEventListener('click', event => {
        if (event.target === $('print-template-details-modal')) closeDetails();
    });

    load();
})();
