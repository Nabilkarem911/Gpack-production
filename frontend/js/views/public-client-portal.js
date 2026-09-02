'use strict';

(function() {
    const _el = (id) => document.getElementById(id);
    const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

    const STATUS_MAP = {
        quote: { label: 'عرض سعر', cls: 'bg-amber-100 text-amber-700' },
        confirmed: { label: 'مؤكد', cls: 'bg-blue-100 text-blue-700' },
        production: { label: 'قيد التصنيع', cls: 'bg-purple-100 text-purple-700' },
        processing: { label: 'قيد التجهيز', cls: 'bg-indigo-100 text-indigo-700' },
        completed: { label: 'تم الانتهاء', cls: 'bg-emerald-100 text-emerald-700' },
        shipped: { label: 'تم الشحن', cls: 'bg-cyan-100 text-cyan-700' },
        delivered: { label: 'تم التسليم', cls: 'bg-teal-100 text-teal-700' },
        cancelled: { label: 'ملغي', cls: 'bg-red-100 text-red-700' },
        archived: { label: 'مؤرشف', cls: 'bg-slate-100 text-slate-500' },
        draft: { label: 'مسودة', cls: 'bg-slate-100 text-slate-500' },
    };

    const PAYMENT_METHODS = {
        cash: 'نقداً',
        bank_transfer: 'تحويل بنكي',
        check: 'شيك',
        card: 'بطاقة',
    };

    let _token = null;
    let _clientData = null;
    let _orders = [];
    let _designRequests = [];
    let _currentOrderId = null;

    function _badge(status) {
        const s = STATUS_MAP[status] || { label: status || '—', cls: 'bg-slate-100 text-slate-500' };
        return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${s.cls}">${s.label}</span>`;
    }

    function _money(n) {
        return fmt(n);
    }

    function _setLoading(visible) {
        _el('cp-loading')?.classList.toggle('hidden', !visible);
    }

    function _setError(msg) {
        _setLoading(false);
        const err = _el('cp-error');
        if (_el('cp-error-msg')) _el('cp-error-msg').textContent = msg || 'هذا الرابط غير صحيح أو العميل غير نشط.';
        err?.classList.remove('hidden');
    }

    function _orderStateLabel(order) {
        return order?.status_label || STATUS_MAP[order?.derived_status || order?.status]?.label || order?.status || '—';
    }

    function _orderStateClass(order) {
        return order?.status_color || STATUS_MAP[order?.derived_status || order?.status]?.cls || 'bg-slate-100 text-slate-600';
    }

    async function _loadPortal() {
        const params = new URLSearchParams(window.location.search);
        _token = params.get('token');

        if (!_token) {
            _setError('لا يوجد token في الرابط.');
            return;
        }

        try {
            const res = await fetch(`/api/public/client-portal/${encodeURIComponent(_token)}`);
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'الرابط غير صالح.');
            }

            const payload = await res.json();
            const data = payload.data || payload;
            _clientData = data.client || null;
            _orders = data.orders || [];
            _designRequests = data.design_requests || [];

            _renderHeader();
            _renderOrders();
            _renderDesigns();

            _setLoading(false);
            _el('cp-main')?.classList.remove('hidden');
        } catch (err) {
            console.error('[ClientPortal] load error:', err);
            _setError(err.message || 'تعذّر تحميل البيانات.');
        }
    }

    function _renderHeader() {
        if (!_clientData) return;
        _el('client-name').textContent = _clientData.name || '—';
        const contact = [_clientData.contact_person, _clientData.phone].filter(Boolean).join(' • ');
        _el('client-contact').textContent = contact || _clientData.email || '';
    }

    function _renderOrders() {
        const tbody = _el('orders-tbody');
        const empty = _el('orders-empty');
        const badge = _el('orders-badge');
        const count = _el('orders-count');

        if (!tbody) return;
        if (badge) badge.textContent = String(_orders.length);
        if (count) count.textContent = String(_orders.length);

        if (!_orders.length) {
            tbody.innerHTML = '';
            empty?.classList.remove('hidden');
            return;
        }

        empty?.classList.add('hidden');
        tbody.innerHTML = _orders.map(order => {
            const remaining = Math.max(0, parseFloat(order.grand_total || 0) - parseFloat(order.paid_total || order.paid_amount || 0));
            return `
                <tr class="border-b border-slate-100 hover:bg-slate-50/70 transition-colors cursor-pointer" onclick="window._cpOpenOrder('${order.id}')">
                    <td class="py-3 px-4 font-mono font-bold text-slate-700">#${esc(order.order_number)}</td>
                    <td class="py-3 px-4"><span class="inline-flex items-center gap-1.5"><span class="status-dot ${order.derived_status === 'delivered' ? 'bg-teal-500' : order.derived_status === 'shipped' ? 'bg-cyan-500' : order.derived_status === 'completed' ? 'bg-emerald-500' : 'bg-purple-500'}"></span>${_badge(order.derived_status)}</span></td>
                    <td class="py-3 px-4 text-slate-500 hidden sm:table-cell">${order.order_date ? new Date(order.order_date).toLocaleDateString('ar-SA-u-nu-latn') : '—'}</td>
                    <td class="py-3 px-4 text-slate-500 hidden md:table-cell">${order.item_count || 0} صنف</td>
                    <td class="py-3 px-4 font-bold text-slate-800 font-mono">${_money(order.grand_total)}</td>
                    <td class="py-3 px-4 text-emerald-600 font-semibold font-mono hidden md:table-cell">${_money(order.paid_total || order.paid_amount)}</td>
                    <td class="py-3 px-4 font-semibold font-mono hidden md:table-cell ${remaining > 0 ? 'text-red-500' : 'text-emerald-500'}">${_money(remaining)}</td>
                    <td class="py-3 px-4 text-center">
                        <span class="inline-flex items-center gap-1 text-xs font-bold text-brand-700 bg-brand-50 px-2.5 py-1.5 rounded-lg">
                            <i class="fa-solid fa-eye"></i>عرض
                        </span>
                    </td>
                </tr>`;
        }).join('');
    }

    function _renderDesigns() {
        const list = _el('designs-list');
        const empty = _el('designs-empty');
        const badge = _el('designs-badge');
        const count = _el('designs-count');

        if (badge) badge.textContent = String(_designRequests.length);
        if (count) count.textContent = String(_designRequests.length);

        if (!_designRequests.length) {
            if (list) list.innerHTML = '';
            empty?.classList.remove('hidden');
            return;
        }

        empty?.classList.add('hidden');
        if (!list) return;

        list.innerHTML = _designRequests.map(dr => {
            const url = dr.design_url ? `href="${esc(dr.design_url)}" target="_blank"` : '';
            const title = esc(dr.item_name || `طلب تصميم #${dr.request_number}`);
            const size = dr.item_size ? `<p class="text-xs text-slate-400 mt-1"><i class="fa-solid fa-ruler-combined ml-1"></i>${esc(dr.item_size)}</p>` : '';
            const subtitle = dr.brief ? `<p class="text-xs text-slate-500 mt-2 line-clamp-2">${esc(dr.brief)}</p>` : '';
            return `
                <a ${url} class="block rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-300 hover:shadow-md transition-all">
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <p class="font-mono text-xs text-slate-400">#${esc(String(dr.request_number).padStart(5, '0'))}</p>
                            <h3 class="text-sm font-bold text-slate-800 mt-1">${title}</h3>
                            ${size}
                        </div>
                        <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold whitespace-nowrap ${dr.status_color || 'bg-slate-100 text-slate-500'}">${esc(dr.status_label || dr.status)}</span>
                    </div>
                    ${subtitle}
                    <div class="mt-3 flex items-center justify-between text-xs text-slate-500">
                        <span><i class="fa-solid fa-user-pen ml-1"></i>${esc(dr.designer_name || '—')}</span>
                        <span>${dr.created_at ? new Date(dr.created_at).toLocaleDateString('ar-SA-u-nu-latn') : '—'}</span>
                    </div>
                </a>`;
        }).join('');
    }

    function _renderOrderModal(data) {
        const order = data.order || {};
        const items = data.items || [];
        const payments = data.payments || [];
        const invoices = data.invoices || [];
        const timeline = data.timeline || [];

        _el('order-modal-title').textContent = `طلب #${order.order_number || '—'}`;
        _el('order-modal-subtitle').textContent = order.client_name || '';
        _el('order-status-badge').innerHTML = _badge(order.derived_status || order.status);
        _el('order-status-text').textContent = `الحالة الحالية: ${_orderStateLabel(order)}`;
        _el('order-grand-total').textContent = _money(order.grand_total);
        const paidTotal = parseFloat(order.paid_total || data.paid_total || order.paid_amount || 0);
        _el('order-paid').textContent = _money(paidTotal);
        _el('order-remaining').textContent = _money(Math.max(0, parseFloat(order.grand_total || 0) - paidTotal));
        _el('order-items-count').textContent = String(order.item_count || items.length || 0);
        _el('order-wh-received').textContent = _money(order.wh_received_qty || 0);
        _el('order-released').textContent = _money(order.released_qty || 0);

        const itemsTbody = _el('order-items-tbody');
        if (itemsTbody) {
            if (!items.length) {
                itemsTbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-400 text-sm">لا توجد أصناف</td></tr>`;
            } else {
                itemsTbody.innerHTML = items.map(item => `
                    <tr class="hover:bg-slate-50/60">
                        <td class="py-3 px-4 font-semibold text-slate-700">${esc(item.product_name || '—')} <span class="text-slate-400 font-normal">${esc(item.size_name || '')}</span></td>
                        <td class="py-3 px-4 text-center font-mono">${_money(item.quantity)}</td>
                        <td class="py-3 px-4 text-center font-mono hidden sm:table-cell">${_money(item.wh_received_qty || 0)}</td>
                        <td class="py-3 px-4 text-center font-mono hidden md:table-cell">${_money(item.released_qty || 0)}</td>
                        <td class="py-3 px-4 text-left font-mono font-bold hidden md:table-cell">${_money(item.line_total)}</td>
                    </tr>
                `).join('');
            }
        }

        const paymentsTbody = _el('order-payments-tbody');
        if (paymentsTbody) {
            if (!payments.length) {
                paymentsTbody.innerHTML = `<tr><td colspan="3" class="py-8 text-center text-slate-400 text-xs">لا توجد دفعات مسجلة</td></tr>`;
            } else {
                paymentsTbody.innerHTML = payments.map(p => `
                    <tr class="hover:bg-slate-50/60">
                        <td class="py-2 px-3 text-slate-500">${p.created_at ? new Date(p.created_at).toLocaleDateString('ar-SA-u-nu-latn') : '—'}</td>
                        <td class="py-2 px-3 text-slate-600">${esc(PAYMENT_METHODS[p.payment_method] || p.payment_method || '—')}</td>
                        <td class="py-2 px-3 font-mono font-bold text-emerald-700">${_money(p.amount)}</td>
                    </tr>
                `).join('');
            }
        }

        const invoicesList = _el('order-invoices-list');
        if (invoicesList) {
            if (!invoices.length) {
                invoicesList.innerHTML = `<div class="py-8 text-center text-slate-400 text-sm">لا توجد فواتير</div>`;
            } else {
                invoicesList.innerHTML = invoices.map(inv => `
                    <div class="rounded-xl border border-slate-200 p-3 bg-slate-50/40">
                        <div class="flex items-center justify-between gap-3">
                            <div>
                                <p class="text-sm font-bold text-slate-800">فاتورة #${esc(inv.invoice_number || '—')}</p>
                                <p class="text-xs text-slate-500">${inv.created_at ? new Date(inv.created_at).toLocaleDateString('ar-SA-u-nu-latn') : '—'}</p>
                            </div>
                            <div class="text-left">
                                <p class="font-mono font-bold text-slate-800">${_money(inv.grand_total)}</p>
                                <p class="text-xs ${inv.status === 'final' ? 'text-emerald-600' : 'text-amber-600'} font-bold">${esc(inv.status || '—')}</p>
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        }

        const timelineWrap = _el('order-timeline');
        if (timelineWrap) {
            timelineWrap.innerHTML = timeline.map(step => `
                <div class="rounded-2xl border ${step.active ? 'border-brand-200 bg-brand-50/50' : 'border-slate-200 bg-slate-50'} p-4">
                    <div class="flex items-center justify-between gap-2 mb-2">
                        <p class="text-sm font-black ${step.active ? 'text-brand-800' : 'text-slate-500'}">${esc(step.label)}</p>
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black ${step.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${step.active ? 'متحقق' : 'قادم'}</span>
                    </div>
                    <p class="text-xs text-slate-500 mb-2">${step.date ? new Date(step.date).toLocaleDateString('ar-SA-u-nu-latn') : '—'}</p>
                    <p class="text-xs text-slate-600 leading-5">${esc(step.description || '')}</p>
                </div>
            `).join('');
        }
    }

    window.cpTab = function(name) {
        ['orders', 'designs'].forEach(tab => {
            _el(`panel-${tab}`)?.classList.toggle('hidden', tab !== name);
            _el(`tab-${tab}`)?.classList.toggle('active', tab === name);
        });
    };

    window._cpOpenOrder = async function(orderId) {
        _currentOrderId = orderId;
        const modal = _el('cp-order-modal');
        if (!modal || !_token) return;

        _el('order-modal-loading')?.classList.remove('hidden');
        _el('order-modal-body')?.classList.add('hidden');
        _el('order-modal-error')?.classList.add('hidden');

        modal.style.display = 'flex';
        requestAnimationFrame(() => modal.classList.add('opacity-100'));

        try {
            const res = await fetch(`/api/public/client-portal/${encodeURIComponent(_token)}/orders/${encodeURIComponent(orderId)}`);
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'تعذّر تحميل الطلب.');
            }
            const payload = await res.json();
            const data = payload.data || payload;
            _renderOrderModal(data);
            _el('order-modal-loading')?.classList.add('hidden');
            _el('order-modal-body')?.classList.remove('hidden');
        } catch (err) {
            console.error('[ClientPortal] order error:', err);
            _el('order-modal-loading')?.classList.add('hidden');
            const msg = _el('order-modal-error-msg');
            if (msg) msg.textContent = err.message || 'تعذّر تحميل الطلب.';
            _el('order-modal-error')?.classList.remove('hidden');
        }
    };

    window._cpCloseOrderModal = function() {
        const modal = _el('cp-order-modal');
        if (!modal) return;
        modal.classList.remove('opacity-100');
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    };

    _loadPortal();
})();
