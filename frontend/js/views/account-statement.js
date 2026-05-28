'use strict';

// =============================================================================
// G.PACK 2.0 — Account Statement Controller
// كشف حساب عميل / مورد
// =============================================================================

(function() {
    const _el = (id) => document.getElementById(id);
    const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

    let _selectedParty = null; // { id, type, name, phone, city }
    let _searchTimeout = null;

    // ── Init ───────────────────────────────────────────────────────────────────
    function _init() {
        // Set default date range (current month)
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        _el('as-to-date').value = today.toISOString().split('T')[0];
        _el('as-from-date').value = firstDay.toISOString().split('T')[0];
    }

    // ── Search Party ─────────────────────────────────────────────────────────────
    window.asSearchParty = function(query) {
        clearTimeout(_searchTimeout);
        if (!query || query.length < 2) {
            _el('as-search-results').classList.add('hidden');
            return;
        }

        _searchTimeout = setTimeout(async () => {
            try {
                const res = await window.apiFetch(`/api/account-statement/lookup?search=${encodeURIComponent(query)}`);
                _renderSearchResults(res);
            } catch (err) {
                console.error('Search error:', err);
            }
        }, 300);
    };

    function _renderSearchResults(data) {
        const container = _el('as-search-results');
        const clients = data.clients || [];
        const suppliers = data.suppliers || [];

        if (clients.length === 0 && suppliers.length === 0) {
            container.classList.add('hidden');
            return;
        }

        let html = '';

        // Clients section
        if (clients.length > 0) {
            html += `<div class="px-3 py-2 bg-slate-50 text-xs font-bold text-slate-500">العملاء</div>`;
            html += clients.map(c => `
                <div onclick="window.asSelectParty('${esc(c.id)}', 'client', '${esc(c.name)}', '${esc(c.phone)}', '${esc(c.city)}')"
                     class="px-4 py-3 hover:bg-blue-50 cursor-pointer border-b border-slate-100 last:border-0">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-user text-brand-500"></i>
                        <span class="font-semibold text-slate-700">${esc(c.name)}</span>
                    </div>
                    <div class="text-xs text-slate-400 mt-1">${esc(c.phone || '')} ${c.city ? '• ' + esc(c.city) : ''}</div>
                </div>
            `).join('');
        }

        // Suppliers section
        if (suppliers.length > 0) {
            html += `<div class="px-3 py-2 bg-slate-50 text-xs font-bold text-slate-500">الموردين</div>`;
            html += suppliers.map(s => `
                <div onclick="window.asSelectParty('${esc(s.id)}', 'supplier', '${esc(s.name)}', '${esc(s.phone)}', '${esc(s.city)}')"
                     class="px-4 py-3 hover:bg-amber-50 cursor-pointer border-b border-slate-100 last:border-0">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-truck text-amber-500"></i>
                        <span class="font-semibold text-slate-700">${esc(s.name)}</span>
                    </div>
                    <div class="text-xs text-slate-400 mt-1">${esc(s.phone || '')} ${s.city ? '• ' + esc(s.city) : ''}</div>
                </div>
            `).join('');
        }

        container.innerHTML = html;
        container.classList.remove('hidden');
    }

    // ── Select Party ─────────────────────────────────────────────────────────────
    window.asSelectParty = function(id, type, name, phone, city) {
        _selectedParty = { id, type, name, phone, city };
        
        // Update UI
        _el('as-search-input').value = name;
        _el('as-search-results').classList.add('hidden');
        
        _el('as-party-type').textContent = type === 'client' ? 'عميل' : 'مورد';
        _el('as-party-name').textContent = name;
        _el('as-party-details').textContent = `${phone || '---'} ${city ? '• ' + city : ''}`;
        
        _el('as-party-icon').className = type === 'client' 
            ? 'fa-solid fa-user text-2xl text-brand-500'
            : 'fa-solid fa-truck text-2xl text-amber-500';
        
        // Show public link button only for clients
        const publicLinkBtn = _el('as-public-link-btn');
        if (type === 'client') {
            publicLinkBtn.classList.remove('hidden');
        } else {
            publicLinkBtn.classList.add('hidden');
        }
        
        // Show/hide appropriate sections
        _el('as-initial').classList.add('hidden');
        _el('as-party-info').classList.remove('hidden');
        _el('as-statement-section').classList.add('hidden');
        _el('as-summary-section').classList.add('hidden');
    };

    // ── Load Statement ──────────────────────────────────────────────────────────
    window.asLoadStatement = async function() {
        if (!_selectedParty) {
            alert('الرجاء اختيار عميل أو مورد أولاً');
            return;
        }

        const fromDate = _el('as-from-date').value;
        const toDate = _el('as-to-date').value;

        try {
            const endpoint = _selectedParty.type === 'client' 
                ? `/api/account-statement/client/${_selectedParty.id}`
                : `/api/account-statement/supplier/${_selectedParty.id}`;
            
            const params = [];
            if (fromDate) params.push(`from=${fromDate}`);
            if (toDate) params.push(`to=${toDate}`);
            
            const url = endpoint + (params.length > 0 ? '?' + params.join('&') : '');
            
            const res = await window.apiFetch(url);
            _renderStatement(res);
        } catch (err) {
            alert('خطأ في تحميل كشف الحساب: ' + err.message);
        }
    };

    function _renderStatement(data) {
        const summary = data.summary || {};
        const transactions = data.transactions || [];

        // Update summary labels based on party type
        if (_selectedParty.type === 'client') {
            _el('as-debit-label').textContent = 'عليه (فواتير)';
            _el('as-credit-label').textContent = 'له (مدفوعات)';
        } else {
            _el('as-debit-label').textContent = 'عليه (مدفوعات)';
            _el('as-credit-label').textContent = 'له (فواتير)';
        }

        // Update summary values
        _el('as-total-debit').textContent = fmt(summary.total_invoices);
        _el('as-total-credit').textContent = fmt(summary.total_payments);
        _el('as-final-balance').textContent = fmt(summary.balance);
        _el('as-party-balance').textContent = fmt(summary.balance);
        
        // Color balance based on value
        const balanceEl = _el('as-party-balance');
        if (summary.balance > 0) {
            balanceEl.className = 'text-3xl font-black text-red-600';
        } else if (summary.balance < 0) {
            balanceEl.className = 'text-3xl font-black text-emerald-600';
        } else {
            balanceEl.className = 'text-3xl font-black text-slate-600';
        }

        // Show summary
        _el('as-summary-section').classList.remove('hidden');

        // Render transactions
        if (transactions.length === 0) {
            _el('as-tbody').innerHTML = '';
            _el('as-empty').classList.remove('hidden');
        } else {
            _el('as-empty').classList.add('hidden');
            _el('as-tbody').innerHTML = transactions.map((t, idx) => {
                const isEven = idx % 2 === 0;
                const rowClass = isEven ? 'bg-white' : 'bg-slate-50/50';
                const debit = parseFloat(t.debit || 0);
                const credit = parseFloat(t.credit || 0);
                const balance = parseFloat(t.running_balance || t.balance || 0);
                const docLink = _getDocLink(t);
                
                return `<tr class="${rowClass} border-b border-slate-100 hover:bg-blue-50/30 transition-colors">
                    <td class="py-3 px-4 text-slate-600 text-xs">${new Date(t.trans_date).toLocaleDateString('ar-EG')}</td>
                    <td class="py-3 px-4">
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${_getDocTypeClass(t.document_type)}">
                            ${_getDocTypeIcon(t.document_type)}
                            ${esc(t.document_type)}
                        </span>
                    </td>
                    <td class="py-3 px-4 font-mono text-slate-700">
                        ${docLink ? `<button onclick="${docLink}" class="hover:text-brand-600 hover:underline font-bold">#${esc(t.document_number)}</button>` : `#${esc(t.document_number)}`}
                    </td>
                    <td class="py-3 px-4 font-mono font-bold ${debit > 0 ? 'text-red-600' : 'text-slate-300'}">${debit > 0 ? fmt(debit) : '-'}</td>
                    <td class="py-3 px-4 font-mono font-bold ${credit > 0 ? 'text-emerald-600' : 'text-slate-300'}">${credit > 0 ? fmt(credit) : '-'}</td>
                    <td class="py-3 px-4 font-mono font-bold ${_getBalanceColor(balance)}">${fmt(balance)}</td>
                    <td class="py-3 px-4 text-slate-500 text-xs">${esc(t.notes || '')}</td>
                </tr>`;
            }).join('');
        }

        // Show statement section
        _el('as-statement-section').classList.remove('hidden');
    }

    function _getDocTypeClass(type) {
        if (type.includes('مبيعات')) return 'bg-blue-100 text-blue-700';
        if (type.includes('مشتريات')) return 'bg-amber-100 text-amber-700';
        if (type.includes('قبض')) return 'bg-emerald-100 text-emerald-700';
        if (type.includes('صرف')) return 'bg-red-100 text-red-700';
        return 'bg-slate-100 text-slate-700';
    }

    function _getDocTypeIcon(type) {
        if (type.includes('مبيعات')) return '<i class="fa-solid fa-file-invoice"></i>';
        if (type.includes('مشتريات')) return '<i class="fa-solid fa-cart-shopping"></i>';
        if (type.includes('قبض')) return '<i class="fa-solid fa-hand-holding-dollar"></i>';
        if (type.includes('صرف')) return '<i class="fa-solid fa-money-bill-transfer"></i>';
        return '<i class="fa-solid fa-file"></i>';
    }

    function _getBalanceColor(balance) {
        if (balance > 0) return 'text-red-600';
        if (balance < 0) return 'text-emerald-600';
        return 'text-slate-600';
    }

    function _getDocLink(t) {
        if (t.document_type === 'فاتورة مبيعات') {
            return `window.navigateTo('sales-invoice-detail?id=${esc(t.transaction_id)}')`;
        }
        if (t.document_type === 'فاتورة مشتريات') {
            return `window.navigateTo('purchase-invoice-detail?id=${esc(t.transaction_id)}')`;
        }
        // Vouchers don't have detail pages yet
        return null;
    }

    // ── Public Statement Link Generator ──────────────────────────────────────
    window.asGetPublicLink = function() {
        if (!_selectedParty || _selectedParty.type !== 'client') {
            alert('الرابط العام متاح فقط للعملاء');
            return;
        }
        
        // Generate a token-based public link (URL-safe base64)
        const baseUrl = window.location.origin;
        const clientId = _selectedParty.id;
        // URL-safe base64 encoding (replace + with -, / with _, remove =)
        const token = btoa(unescape(encodeURIComponent(clientId)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
        
        const publicUrl = `${baseUrl}/#/public-client-statement?t=${token}`;
        
        // Copy to clipboard
        navigator.clipboard.writeText(publicUrl).then(() => {
            alert(`✅ تم نسخ رابط كشف الحساب للعميل:\n\n${publicUrl}\n\nالعميل يمكنه فتح هذا الرابط مباشرة بدون تسجيل الدخول.`);
        }).catch(() => {
            prompt('انسخ هذا الرابط وأرسله للعميل:', publicUrl);
        });
    };

    // ── Click outside to close search results ────────────────────────────────────
    document.addEventListener('click', (e) => {
        const searchContainer = _el('as-search-input')?.closest('.flex-1');
        if (searchContainer && !searchContainer.contains(e.target)) {
            _el('as-search-results').classList.add('hidden');
        }
    });

    // ── Start ───────────────────────────────────────────────────────────────────
    _init();
})();
