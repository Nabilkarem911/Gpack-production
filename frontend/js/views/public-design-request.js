'use strict';
(function () {
    const token = new URLSearchParams(location.search).get('token') || new URLSearchParams(location.hash.split('?')[1] || '').get('token');

    let data;
    let recorder;
    let chunks = [];
    let audioFile;
    let pickingFile = false;
    let inputFocused = false;
    let appHidden = false;
    let selectedVersionId = null;
    let pickingTimer = null;
    let inputFocusTimer = null;
    let previousVersionIds = new Set();
    let isUploading = false;

    const statusLabels = {
        waiting_design: 'بانتظار التصميم',
        in_progress: 'قيد التنفيذ',
        designer_review: 'مراجعة التصميم',
        client_review: 'بانتظار اعتمادك',
        revision_requested: 'تعديلات مطلوبة',
        approved: 'معتمد',
        completed: 'مكتمل',
    };

    const statusColors = {
        waiting_design: 'bg-amber-50 text-amber-700 border-amber-100',
        in_progress: 'bg-blue-50 text-blue-700 border-blue-100',
        designer_review: 'bg-purple-50 text-purple-700 border-purple-100',
        client_review: 'bg-cyan-50 text-cyan-700 border-cyan-100',
        revision_requested: 'bg-orange-50 text-orange-700 border-orange-100',
        approved: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        completed: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    };

    const el = id => document.getElementById(id);

    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const fmt = value => value ? new Date(value).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

    const getFileExt = url => {
        if (!url) return '';
        const clean = String(url).split('?')[0].split('#')[0];
        const idx = clean.lastIndexOf('.');
        return idx === -1 ? '' : clean.substring(idx + 1).toLowerCase();
    };

    const isImage = mime => /^(image\/(png|jpe?g|gif|webp|bmp|tif?f|svg))$/i.test(mime) || /^(png|jpe?g|gif|webp|bmp|tif?f|svg)$/i.test(mime);

    const isPdf = mime => String(mime).toLowerCase().includes('pdf') || getFileExt(mime) === 'pdf';

    const isAudio = mime => String(mime).toLowerCase().startsWith('audio/');

    const fileHtml = f => {
        if (!f) return '';
        const url = esc(f.path);
        const name = esc(f.original_name || 'مرفق');
        if (String(f.mime_type).toLowerCase().startsWith('audio/')) {
            return `<audio controls preload="metadata" class="max-w-full h-9 mt-1"><source src="${url}" type="${esc(f.mime_type)}"></audio>`;
        }
        return `<a target="_blank" class="text-[#563D5D] underline text-xs" href="${url}">${name}</a>`;
    };

    const displayName = () => data.request.item_name || ((data.items || [])[0] || {}).product_name || 'طلب تصميم';

    const displaySize = () => data.request.item_size || ((data.items || [])[0] || {}).size_name || 'غير محدد';

    const displayRequestNumber = () => data.request.request_number || 'DES-00000';

    const displayClientName = () => data.request.client_name || '—';

    const displayDesignerName = () => data.request.designer_name || '—';

    const countRevisions = () => (data.items || []).reduce((sum, item) => sum + ((item.revisions || []).length), 0);

    const latestVersion = () => {
        const versions = data.versions || [];
        return versions[0] || null;
    };

    const selectedVersion = () => {
        const versions = data.versions || [];
        if (selectedVersionId) {
            const found = versions.find(v => v.id === selectedVersionId);
            if (found) return found;
        }
        return versions[0] || null;
    };

    const primaryItem = () => (data.items || [])[0] || null;

    const statusBadge = (status) => {
        const label = statusLabels[status] || status;
        const color = statusColors[status] || 'bg-slate-100 text-slate-600 border-slate-100';
        return `<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border ${color}">${esc(label)}</span>`;
    };

    const renderMedia = (file, container) => {
        if (!file) {
            container.innerHTML = '<p class="text-slate-400 text-sm">لا يوجد ملف للمعاينة</p>';
            return;
        }
        const url = esc(file.path);
        const mime = String(file.mime_type || '').toLowerCase();
        const ext = getFileExt(file.path);

        if (isImage(mime) || isImage(ext)) {
            container.innerHTML = `<img src="${url}" alt="${esc(file.original_name || '')}" class="preview-media rounded-xl" />`;
        } else if (isPdf(mime) || isPdf(ext)) {
            container.innerHTML = `<object data="${url}#toolbar=0&navpanes=0" type="application/pdf" class="w-full h-[520px] rounded-xl border-0 bg-white"><div class="p-8 text-center text-slate-500"><i class="fa-solid fa-file-pdf text-4xl text-red-400 mb-2"></i><p class="text-sm">${esc(file.original_name || '')}</p><a href="${url}" target="_blank" class="text-[#563D5D] text-xs mt-2 inline-block">فتح الملف</a></div></object>`;
        } else if (isAudio(mime) || isAudio(ext)) {
            container.innerHTML = `<div class="text-center"><audio controls preload="metadata" class="w-full max-w-md"><source src="${url}" type="${esc(file.mime_type || 'audio/mpeg')}"></audio><p class="text-xs text-slate-400 mt-2">${esc(file.original_name || '')}</p></div>`;
        } else {
            container.innerHTML = `<div class="text-center p-8"><i class="fa-solid fa-file text-4xl text-slate-300 mb-3"></i><p class="text-sm text-slate-600">${esc(file.original_name || 'ملف')}</p><a href="${url}" target="_blank" class="mt-3 inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-[#563D5D] text-white text-xs font-bold"><i class="fa-solid fa-download"></i> تحميل الملف</a></div>`;
        }
    };

    const renderVersionHistory = () => {
        const versions = data.versions || [];
        const list = el('version-list');
        const history = el('version-history');
        if (!list || !history) return;

        if (versions.length <= 1) {
            history.classList.add('hidden');
            return;
        }

        history.classList.remove('hidden');
        el('version-count').textContent = versions.length;

        list.innerHTML = versions.map(v => {
            const isActive = v.id === selectedVersionId;
            const file = v.file;
            const thumb = (() => {
                if (!file) return `<div class="w-full h-full flex items-center justify-center text-slate-400 text-xs">V${v.version_number}</div>`;
                const ext = getFileExt(file.path);
                if (isImage(file.mime_type) || isImage(ext)) {
                    return `<img src="${esc(file.path)}" class="w-full h-full object-cover" alt="" />`;
                }
                return `<div class="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-500 text-[10px]"><i class="fa-solid fa-file"></i><span>V${v.version_number}</span></div>`;
            })();
            return `<button type="button" data-version-id="${esc(v.id)}" class="version-thumb ${isActive ? 'active' : ''}" title="V${v.version_number} — ${esc(statusLabels[v.status] || v.status)}">${thumb}</button>`;
        }).join('');

        list.querySelectorAll('[data-version-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedVersionId = btn.dataset.versionId;
                renderPreview();
                renderVersionHistory();
            });
        });
    };

    const renderPreview = () => {
        const version = selectedVersion();
        const previewCard = el('preview-card');
        const noPreview = el('no-preview');
        const previewBody = el('preview-body');
        const previewVersion = el('preview-version');
        const designerNotes = el('designer-notes');

        if (!version || !version.file) {
            previewCard.classList.add('hidden');
            noPreview.classList.remove('hidden');
            return;
        }

        previewCard.classList.remove('hidden');
        noPreview.classList.add('hidden');
        previewVersion.textContent = `V${version.version_number} — ${statusLabels[version.status] || version.status}`;
        renderMedia(version.file, previewBody);

        if (version.designer_notes) {
            designerNotes.classList.remove('hidden');
            designerNotes.innerHTML = `<b class="block text-xs text-slate-500 mb-1">ملاحظات المصمم</b>${esc(version.designer_notes)}`;
        } else {
            designerNotes.classList.add('hidden');
            designerNotes.innerHTML = '';
        }
    };

    const renderItem = () => {
        const item = primaryItem();
        const body = el('item-body');
        if (!body) return;

        if (!item) {
            body.innerHTML = '<p class="text-slate-400 text-sm">لا توجد تفاصيل للصنف.</p>';
            return;
        }

        el('item-status').innerHTML = statusBadge(item.status);

        const attachmentsHtml = (item.attachments || []).length
            ? `<div class="flex flex-wrap gap-2">${item.attachments.map(a => fileHtml(a)).join('')}</div>`
            : '<p class="text-xs text-slate-400">لا توجد مرفقات</p>';

        const notesHtml = item.notes
            ? `<div class="rounded-xl bg-amber-50 border border-amber-100 p-3 text-sm text-amber-900"><b class="block text-xs text-amber-700 mb-1">ملاحظات الصنف</b>${esc(item.notes)}</div>`
            : '';

        const revisionsHtml = (item.revisions || []).length
            ? `<div class="space-y-2">${item.revisions.map(rev => `<div class="rounded-xl bg-orange-50 border border-orange-100 p-3 text-sm text-orange-900"><b class="block text-xs text-orange-700 mb-1"><i class="fa-solid fa-triangle-exclamation ml-1"></i>تعديل مطلوب — ${fmt(rev.created_at)}</b><p class="leading-relaxed">${esc(rev.notes)}</p></div>`).join('')}</div>`
            : '';

        const controlsHtml = renderItemControls(item);

        body.innerHTML = `
            <div>
                <h3 class="font-bold text-slate-800 text-sm">${esc(item.product_name)} — ${esc(item.size_name || 'بدون مقاس')}</h3>
                ${notesHtml}
            </div>
            <div>
                <b class="block text-xs text-slate-500 mb-2">المرفقات</b>
                ${attachmentsHtml}
            </div>
            ${revisionsHtml ? `<div>${revisionsHtml}</div>` : ''}
            <div id="item-controls">${controlsHtml}</div>
        `;

        attachItemControlListeners();
    };

    const renderItemControls = (item) => {
        const isDesigner = data.viewer_role === 'designer';
        const latest = (item.versions || [])[0];

        if (isDesigner) {
            let html = '';
            if (['waiting_design', 'revision_requested'].includes(data.request.status)) {
                html += `<button type="button" id="start-work" class="w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white py-3 text-sm font-bold mb-3"><i class="fa-solid fa-play ml-1"></i> بدء تنفيذ التصميم</button>`;
            }

            const canUpload = !latest || ['waiting_design', 'in_progress', 'revision_requested'].includes(item.status);
            if (canUpload) {
                html += `
                    <form id="version-form" class="space-y-3" data-item-id="${esc(item.id)}">
                        <label class="block">
                            <span class="block text-xs font-bold text-slate-700 mb-1">ملف التصميم</span>
                            <input name="design_file" required type="file" accept="image/*,audio/*,application/pdf,.ai,.psd,.eps,.svg,.cdr,.ind,.indd,.idml,.fig,.sketch,.xd,.tif,.tiff,.dwg,.dxf,.zip,.rar,.7z,.doc,.docx,.xls,.xlsx,.ppt,.pptx" class="w-full border border-slate-200 rounded-xl p-2 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-xs file:text-slate-700">
                        </label>
                        <label class="block">
                            <span class="block text-xs font-bold text-slate-700 mb-1">ملاحظات للعميل (اختياري)</span>
                            <textarea name="designer_notes" rows="2" class="w-full border border-slate-200 rounded-xl p-2 text-xs resize-none focus:border-[#563D5D] focus:ring-2 focus:ring-[#563D5D]/10" placeholder="اكتب أي ملاحظات تخص هذا التصميم..."></textarea>
                        </label>
                        <button type="submit" class="w-full rounded-xl bg-[#563D5D] hover:bg-[#452f4b] text-white py-3 text-sm font-bold"><i class="fa-solid fa-cloud-arrow-up ml-1"></i> تسليم التصميم</button>
                    </form>
                `;
            }

            if (data.request.status === 'approved' && (data.items || []).every(i => i.status === 'approved')) {
                html += `<button type="button" id="public-complete" class="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white py-3 text-sm font-bold mt-3"><i class="fa-solid fa-check ml-1"></i> إغلاق الطلب</button>`;
            }

            if (latest && item.status === 'client_review') {
                html += `<p class="text-xs text-slate-400 text-center py-2">التصميم بانتظار رد العميل.</p>`;
            }

            return html;
        }

        // Client controls
        if (latest && item.status === 'client_review') {
            return `
                <div class="grid grid-cols-2 gap-3">
                    <button type="button" id="item-approve" data-item-id="${esc(item.id)}" data-version-id="${esc(latest.id)}" class="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white py-3 text-sm font-bold"><i class="fa-solid fa-circle-check ml-1"></i> اعتماد التصميم</button>
                    <button type="button" id="item-revision" data-item-id="${esc(item.id)}" data-version-id="${esc(latest.id)}" class="rounded-xl bg-orange-500 hover:bg-orange-600 text-white py-3 text-sm font-bold"><i class="fa-solid fa-rotate ml-1"></i> طلب تعديل</button>
                </div>
            `;
        }

        if (item.status === 'approved') {
            return `<div class="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center text-emerald-800 text-sm font-bold"><i class="fa-solid fa-circle-check ml-1"></i> تم اعتماد هذا التصميم</div>`;
        }

        if (data.request.status === 'completed') {
            return `<div class="rounded-xl bg-slate-100 p-3 text-center text-slate-600 text-sm font-bold"><i class="fa-solid fa-lock ml-1"></i> تم إغلاق الطلب</div>`;
        }

        return `<p class="text-xs text-slate-400 text-center">لم يُرفع تصميم لهذا الصنف بعد.</p>`;
    };

    const attachItemControlListeners = () => {
        const startBtn = el('start-work');
        if (startBtn) startBtn.addEventListener('click', startDesigner);

        const versionForm = el('version-form');
        if (versionForm) versionForm.addEventListener('submit', submitVersion);

        const completeBtn = el('public-complete');
        if (completeBtn) completeBtn.addEventListener('click', completeRequest);

        const approveBtn = el('item-approve');
        if (approveBtn) approveBtn.addEventListener('click', () => respond('approve', approveBtn.dataset.itemId, approveBtn.dataset.versionId));

        const revisionBtn = el('item-revision');
        if (revisionBtn) revisionBtn.addEventListener('click', () => respond('revision', revisionBtn.dataset.itemId, revisionBtn.dataset.versionId));
    };

    const isNearBottom = (container, threshold = 100) => container ? container.scrollHeight - container.scrollTop - container.clientHeight <= threshold : true;

    const renderMessages = () => {
        const container = el('messages');
        if (!container) return;

        const nearBottom = isNearBottom(container);

        container.innerHTML = (data.messages || []).map(m => {
            const own = data.viewer_role === 'designer' ? m.sender_type === 'designer' : m.sender_type === 'client';
            return `<div class="${own ? 'message-row-own' : 'message-row-other'}">
                <div class="message-bubble ${own ? 'message-own' : 'message-other'}">
                    <small class="block opacity-70 mb-1">${esc(m.sender_name || 'فريق G.PACK')} • ${fmt(m.created_at)}</small>
                    ${m.message ? `<div>${esc(m.message)}</div>` : ''}
                    ${m.attachment ? fileHtml(m.attachment) : ''}
                </div>
            </div>`;
        }).join('') || '<p class="text-center text-slate-400 text-sm py-16">ابدأ بإرسال تفاصيل التصميم</p>';

        if (nearBottom) {
            container.scrollTop = container.scrollHeight;
        }
    };

    const lastActivityDate = () => {
        const r = data.request;
        return r.approved_at || r.started_at || r.created_at;
    };

    const renderHeader = () => {
        el('title').textContent = data.viewer_role === 'designer' ? `مساحة عمل المصمم — ${displayName()}` : `${displayRequestNumber()} — ${displayName()}`;
        document.title = data.viewer_role === 'designer'
            ? `مساحة عمل المصمم — ${displayRequestNumber()} | G.PACK`
            : `${displayRequestNumber()} — ${displayName()} | G.PACK`;
        el('request-number').textContent = displayRequestNumber();
        el('request-date').textContent = fmt(data.request.created_at);
        el('size').textContent = displaySize();

        const revCount = countRevisions();
        el('revisions-count').textContent = `${revCount} ${revCount === 1 ? 'تعديل' : 'تعديلات'}`;

        el('status').innerHTML = statusBadge(data.request.status);
        el('brief').textContent = data.request.brief || '';

        el('client').textContent = displayClientName();
        el('designer').textContent = displayDesignerName();
        el('created-at').textContent = fmt(data.request.created_at);
        el('last-activity').textContent = fmt(lastActivityDate());
    };

    const render = () => {
        renderHeader();
        renderPreview();
        renderVersionHistory();
        renderItem();
        renderMessages();
    };

    async function load() {
        if (!token) return fail('الرابط غير صالح');
        try {
            const r = await fetch(`/api/public/design-requests/${encodeURIComponent(token)}`, { cache: 'no-store' });
            const newData = await r.json();
            if (!r.ok) return fail(newData.error);

            // Preserve selected version; auto-switch to a newly uploaded version.
            const versions = newData.versions || [];
            const newVersionIds = new Set(versions.map(v => v.id));
            const hasNewVersion = [...newVersionIds].some(id => !previousVersionIds.has(id));

            if (!selectedVersionId || !versions.find(v => v.id === selectedVersionId) || hasNewVersion) {
                selectedVersionId = versions[0]?.id || null;
            }

            previousVersionIds = newVersionIds;
            data = newData;
            el('loading').classList.add('hidden');
            el('error-state').classList.add('hidden');
            el('main-content').classList.remove('hidden');
            render();
        } catch (error) {
            fail('تعذر الاتصال بالخادم');
        }
    }

    async function send(e) {
        e.preventDefault();
        const text = el('text').value.trim();
        const file = audioFile || el('file').files[0];
        if (!text && !file) return;

        const body = new FormData();
        if (text) body.append('message', text);
        if (file) body.append('attachment', file, file.name || 'voice.webm');

        const item = primaryItem();
        if (item) body.append('item_id', item.id);

        try {
            const r = await fetch(`/api/public/design-requests/${encodeURIComponent(token)}/message`, { method: 'POST', body });
            if (!r.ok) return alert((await r.json()).error || 'تعذر الإرسال');
            el('text').value = '';
            el('file').value = '';
            el('file-name').textContent = '';
            audioFile = null;
            await load();
        } catch (error) {
            alert('تعذر إرسال الرسالة');
        }
    }

    async function respond(action, itemId, versionId) {
        const notes = action === 'revision' ? prompt('اكتب التعديلات المطلوبة') : '';
        if (action === 'revision' && !notes) return;

        const item = primaryItem();
        if (!itemId && item) {
            itemId = item.id;
        }
        if (!itemId) return alert('لا يوجد صنف للرد عليه');

        if (!versionId && item) {
            versionId = item.versions?.[0]?.id;
        }

        const payload = { action, notes, item_id: itemId, version_id: versionId };
        try {
            const r = await fetch(`/api/public/design-requests/${encodeURIComponent(token)}/respond`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!r.ok) return alert((await r.json()).error || 'تعذر تسجيل الرد');
            await load();
        } catch (error) {
            alert('تعذر تسجيل الرد');
        }
    }

    async function submitVersion(e) {
        e.preventDefault();
        const form = e.currentTarget;
        const file = form.design_file.files[0];
        if (!file) return alert('اختر ملف التصميم');

        const submitBtn = form.querySelector('button[type="submit"]');
        const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';

        try {
            isUploading = true;
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-1"></i> جاري التحميل...';
            }

            const body = new FormData();
            body.append('design_file', file);
            body.append('item_id', form.dataset.itemId || (primaryItem() && primaryItem().id) || '');
            body.append('designer_notes', form.designer_notes?.value || '');

            const r = await fetch(`/api/public/design-requests/${encodeURIComponent(token)}/version`, { method: 'POST', body });
            if (!r.ok) throw new Error((await r.json()).error || 'تعذر رفع التصميم');
            await load();
        } catch (error) {
            alert(error.message || 'تعذر رفع التصميم');
            if (submitBtn && submitBtn.isConnected) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnHtml;
            }
        } finally {
            isUploading = false;
        }
    }

    async function startDesigner() {
        try {
            const r = await fetch(`/api/public/design-requests/${encodeURIComponent(token)}/start`, { method: 'PUT' });
            if (!r.ok) return alert((await r.json()).error || 'تعذر بدء التنفيذ');
            await load();
        } catch (error) {
            alert('تعذر بدء التنفيذ');
        }
    }

    async function completeRequest() {
        if (!confirm('هل أنت متأكد من إغلاق الطلب؟')) return;
        try {
            const r = await fetch(`/api/public/design-requests/${encodeURIComponent(token)}/complete`, { method: 'POST' });
            if (!r.ok) return alert((await r.json()).error || 'تعذر إغلاق الطلب');
            await load();
        } catch (error) {
            alert('تعذر إغلاق الطلب');
        }
    }

    async function enableMic() {
        if (!window.isSecureContext) return alert('يجب فتح الرابط عبر HTTPS حتى يعمل الميكروفون');
        if (!navigator.mediaDevices?.getUserMedia) return alert('المتصفح لا يدعم التسجيل الصوتي');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            el('enable-mic').textContent = 'تم تفعيل الميكروفون';
            el('enable-mic').className = 'mt-2 w-full h-9 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold';
        } catch (error) {
            alert(error.name === 'NotAllowedError' ? 'تم رفض إذن الميكروفون. اضغط علامة القفل بجانب عنوان الموقع ثم اسمح بالميكروفون.' : `تعذر تفعيل الميكروفون: ${error.message || error.name}`);
        }
    }

    async function voice() {
        if (recorder && recorder.state === 'recording') {
            recorder.stop();
            el('voice').innerHTML = '<i class="fa-solid fa-microphone"></i>';
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return alert('التسجيل الصوتي غير مدعوم في هذا المتصفح');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
            chunks = [];
            const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type)) || '';
            recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
            recorder.onstop = () => {
                const type = recorder.mimeType || 'audio/webm';
                const extension = type.includes('mp4') ? 'm4a' : 'webm';
                audioFile = new File([new Blob(chunks, { type })], `voice-message.${extension}`, { type });
                el('file-name').textContent = 'تم تجهيز تسجيل صوتي للإرسال';
                el('recording').classList.add('hidden');
                el('voice').innerHTML = '<i class="fa-solid fa-microphone"></i>';
                stream.getTracks().forEach(track => track.stop());
            };
            recorder.start();
            el('recording').classList.remove('hidden');
            el('voice').innerHTML = '<i class="fa-solid fa-stop"></i>';
        } catch (error) {
            el('recording').classList.add('hidden');
            alert(error.name === 'NotAllowedError' ? 'اسمح للموقع باستخدام الميكروفون ثم حاول مرة أخرى' : 'تعذر تشغيل التسجيل الصوتي');
        }
    }

    async function checkMicPermission() {
        if (!navigator.permissions?.query) return;
        try {
            const permission = await navigator.permissions.query({ name: 'microphone' });
            const btn = el('enable-mic');
            if (permission.state !== 'granted') {
                btn.classList.remove('hidden');
            }
            permission.onchange = checkMicPermission;
        } catch (_) {}
    }

    function fail(message) {
        el('loading').classList.add('hidden');
        el('main-content').classList.add('hidden');
        el('error-msg').textContent = message;
        el('error-state').classList.remove('hidden');
    }

    const clearPickingTimer = () => { if (pickingTimer) { clearTimeout(pickingTimer); pickingTimer = null; } };
    const setPicking = () => { pickingFile = true; clearPickingTimer(); pickingTimer = setTimeout(() => { pickingFile = false; pickingTimer = null; }, 300000); };
    const resetPicking = () => { clearPickingTimer(); pickingFile = false; };
    const setInputFocused = () => { inputFocused = true; if (inputFocusTimer) { clearTimeout(inputFocusTimer); inputFocusTimer = null; } };
    const resetInputFocused = () => { if (inputFocusTimer) clearTimeout(inputFocusTimer); inputFocusTimer = setTimeout(() => { inputFocused = false; inputFocusTimer = null; }, 500); };

    document.addEventListener('visibilitychange', () => appHidden = document.hidden);
    document.addEventListener('focusin', e => { if (e.target?.type === 'file') setPicking(); else if (e.target?.closest('#app') && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) setInputFocused(); });
    document.addEventListener('focusout', e => { if (e.target?.type === 'file') { if (!e.target.files?.[0]) setPicking(); } else if (e.target?.closest('#app') && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) resetInputFocused(); });
    document.addEventListener('click', e => { if (e.target?.type === 'file') setPicking(); });

    el('message-form').addEventListener('submit', send);
    el('file').addEventListener('change', e => { el('file-name').textContent = e.target.files[0]?.name || ''; audioFile = null; resetPicking(); });
    el('voice').addEventListener('click', voice);
    el('enable-mic').addEventListener('click', enableMic);

    load().catch(() => fail('تعذر الاتصال بالخادم'));
    checkMicPermission();

    setInterval(() => {
        if (token && !appHidden && !pickingFile && !inputFocused && !audioFile && !isUploading && ![...document.querySelectorAll('#app input[type="file"]')].some(i => i.files?.[0])) {
            load().catch(() => {});
        }
    }, 1500);
})();
