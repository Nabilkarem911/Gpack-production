'use strict';

// =============================================================================
// G.PACK 2.0 — Public Client Statement Controller
// كشف حساب عام للعميل (بدون تسجيل دخول)
// =============================================================================

(function() {
    const _el = (id) => document.getElementById(id);
    const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

    // ── Init ───────────────────────────────────────────────────────────────────
    function _init() {
        console.log('[PublicStatement] Initializing...');
        
        // Get token from URL
        const hash = window.location.hash || '';
        console.log('[PublicStatement] Hash:', hash);
        
        const match = hash.match(/[?&]t=([^&]+)/);
        const token = match ? match[1] : null;
        console.log('[PublicStatement] Token:', token);

        if (!token) {
            console.error('[PublicStatement] No token found');
            _showError();
            return;
        }

        // Decode token to get client ID (URL-safe base64)
        try {
            // Restore padding and decode
            let base64 = token.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) base64 += '=';
            console.log('[PublicStatement] Base64:', base64);
            
            const clientId = decodeURIComponent(escape(atob(base64)));
            console.log('[PublicStatement] Decoded clientId:', clientId);
            
            _loadClientStatement(clientId);
        } catch (err) {
            console.error('[PublicStatement] Invalid token:', err);
            _showError();
        }
    }

    // ── Load Client Statement (Public API) ─────────────────────────────────────
    async function _loadClientStatement(clientId) {
        console.log('[PublicStatement] Loading for client:', clientId);
        try {
            // Use public endpoint (no auth required)
            const res = await fetch(`/api/public/client-statement/${clientId}`);
            console.log('[PublicStatement] Response status:', res.status);
            
            if (!res.ok) {
                const errorText = await res.text();
                console.error('[PublicStatement] API error:', errorText);
                throw new Error('Failed to load statement');
            }

            const data = await res.json();
            console.log('[PublicStatement] Data received:', data);
            _renderStatement(data);
        } catch (err) {
            console.error('[PublicStatement] Error:', err);
            _showError();
        }
    }

    // ── Render Statement ──────────────────────────────────────────────────────
    function _renderStatement(data) {
        console.log('[PublicStatement] Rendering data:', data);
        
        const client = data.client;
        const summary = data.summary || {};
        const transactions = data.transactions || [];

        // Hide loading
        _el('pcs-loading').classList.add('hidden');

        // Check if client exists
        if (!client) {
            console.error('[PublicStatement] No client data');
            _showError();
            return;
        }

        // Client info
        _el('pcs-client-name').textContent = esc(client.name || '---');
        _el('pcs-client-details').textContent = `${esc(client.phone || '')} ${client.city ? '• ' + esc(client.city) : ''}`;
        _el('pcs-party-info').classList.remove('hidden');
        
        console.log('[PublicStatement] Client info rendered');

        // Summary
        _el('pcs-total-debit').textContent = fmt(summary.total_invoices);
        _el('pcs-total-credit').textContent = fmt(summary.total_payments);
        
        const balance = summary.balance || 0;
        _el('pcs-final-balance').textContent = fmt(balance);
        _el('pcs-final-balance').className = `text-2xl font-black ${balance > 0 ? 'text-red-600' : balance < 0 ? 'text-emerald-600' : 'text-slate-800'}`;
        
        _el('pcs-summary-section').classList.remove('hidden');

        // Transactions
        if (transactions.length === 0) {
            _el('pcs-tbody').innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400">لا توجد حركات مسجلة</td></tr>`;
        } else {
            _el('pcs-tbody').innerHTML = transactions.map((t, idx) => {
                const isEven = idx % 2 === 0;
                const rowClass = isEven ? 'bg-white' : 'bg-slate-50/50';
                const debit = parseFloat(t.debit || 0);
                const credit = parseFloat(t.credit || 0);
                const balance = parseFloat(t.running_balance || t.balance || 0);
                
                return `<tr class="${rowClass} border-b border-slate-100">
                    <td class="py-3 px-4 text-slate-600 text-xs">${new Date(t.trans_date).toLocaleDateString('ar-EG')}</td>
                    <td class="py-3 px-4">
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${_getDocTypeClass(t.document_type)}">
                            ${_getDocTypeIcon(t.document_type)}
                            ${esc(t.document_type)}
                        </span>
                    </td>
                    <td class="py-3 px-4">${_getDocLink(t)}</td>
                    <td class="py-3 px-4 font-mono font-bold ${debit > 0 ? 'text-red-600' : 'text-slate-300'}">${debit > 0 ? fmt(debit) : '-'}</td>
                    <td class="py-3 px-4 font-mono font-bold ${credit > 0 ? 'text-emerald-600' : 'text-slate-300'}">${credit > 0 ? fmt(credit) : '-'}</td>
                    <td class="py-3 px-4 font-mono font-bold ${_getBalanceColor(balance)}">${fmt(balance)}</td>
                    <td class="py-3 px-4 text-slate-500 text-xs">${esc(t.notes || '')}</td>
                </tr>`;
            }).join('');
        }

        _el('pcs-statement-section').classList.remove('hidden');
    }

    // ── Show Error ─────────────────────────────────────────────────────────────
    function _showError() {
        _el('pcs-loading').classList.add('hidden');
        _el('pcs-error').classList.remove('hidden');
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────
    function _getDocLink(t) {
        if (t.document_type.includes('مبيعات')) {
            const invoiceUrl = `${window.location.origin}/public-invoice.html?id=${t.transaction_id}`;
            return `<a href="${invoiceUrl}" target="_blank" rel="noopener noreferrer"
                class="inline-flex items-center gap-1.5 font-mono text-blue-600 hover:text-blue-800 hover:underline transition-colors" 
                title="فتح الفاتورة في صفحة جديدة">
                <i class="fa-solid fa-file-invoice text-blue-500"></i>
                #${esc(t.document_number)}
                <i class="fa-solid fa-external-link-alt text-xs text-slate-400"></i>
            </a>`;
        }
        if (t.document_type.includes('قبض')) {
            return `<span class="inline-flex items-center gap-1.5 font-mono text-emerald-600">
                <i class="fa-solid fa-file-invoice-dollar text-emerald-500"></i>
                #${esc(t.document_number)}
            </span>`;
        }
        return `<span class="font-mono text-slate-700">#${esc(t.document_number)}</span>`;
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

    // ── Start ─────────────────────────────────────────────────────────────────
    _init();
})();
