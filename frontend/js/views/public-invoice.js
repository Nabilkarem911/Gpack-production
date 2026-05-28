'use strict';

// =============================================================================
// G.PACK 2.0 — Public Invoice View Controller (No Login Required)
// عرض فاتورة مبيعات للعميل بدون تسجيل دخول
// =============================================================================

(function() {
    const _el = (id) => document.getElementById(id);
    const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

    let _invoiceId = null;

    // ── Init ───────────────────────────────────────────────────────────────────
    function _init() {
        console.log('[PublicInvoice] Initializing...');
        
        // Get invoice ID from URL hash path
        const hash = window.location.hash || '';
        const match = hash.match(/\/public-invoice\/([^\/\?]+)/);
        _invoiceId = match ? match[1] : null;

        console.log('[PublicInvoice] Invoice ID:', _invoiceId);

        if (!_invoiceId) {
            _showError();
            return;
        }

        _loadInvoice();
    }

    // ── Load Invoice ───────────────────────────────────────────────────────────
    async function _loadInvoice() {
        try {
            console.log('[PublicInvoice] Fetching invoice:', _invoiceId);
            
            // Use direct fetch (no auth required for public endpoint)
            const res = await fetch(`/api/public/invoice/${_invoiceId}`);
            console.log('[PublicInvoice] Response status:', res.status);
            
            if (!res.ok) {
                throw new Error('Invoice not found');
            }

            const data = await res.json();
            console.log('[PublicInvoice] Data:', data);
            
            _renderInvoice(data.data);
        } catch (err) {
            console.error('[PublicInvoice] Error:', err);
            _showError();
        }
    }

    // ── Render Invoice ─────────────────────────────────────────────────────────
    function _renderInvoice(inv) {
        // Hide loading, show card
        _el('pinv-loading').classList.add('hidden');
        _el('pinv-card').classList.remove('hidden');

        // Header info
        _el('pinv-number').textContent = inv.invoice_number;
        _el('pinv-date').textContent = new Date(inv.invoice_date).toLocaleDateString('ar-EG');
        _el('pinv-due').textContent = inv.due_date ? new Date(inv.due_date).toLocaleDateString('ar-EG') : 'غير محدد';
        
        // Client info
        _el('pinv-client-name').textContent = esc(inv.client_name || '---');
        _el('pinv-client-phone').textContent = esc(inv.client_phone || '');

        // Status badge
        const statusColors = {
            draft: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'مسودة' },
            proforma: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'صورية' },
            final: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'نهائية' },
            cancelled: { bg: 'bg-red-100', text: 'text-red-700', label: 'ملغية' },
        };
        const st = statusColors[inv.status] || statusColors.draft;
        _el('pinv-status').className = `px-3 py-1 rounded-lg text-xs font-bold ${st.bg} ${st.text}`;
        _el('pinv-status').textContent = st.label;

        // Items table
        if (inv.items && inv.items.length > 0) {
            _el('pinv-items').innerHTML = inv.items.map(item => `
                <tr class="hover:bg-slate-50/50">
                    <td class="py-3 px-4 font-medium text-slate-800">${esc(item.product_name)}</td>
                    <td class="py-3 px-4 text-center text-slate-600">${esc(item.size_name || '-')}</td>
                    <td class="py-3 px-4 text-center font-semibold">${fmt(item.quantity)}</td>
                    <td class="py-3 px-4 text-center font-mono">${fmt(item.unit_price)}</td>
                    <td class="py-3 px-4 text-center text-slate-500">${item.discount_percent ? item.discount_percent + '%' : '-'}</td>
                    <td class="py-3 px-4 text-left font-mono font-semibold text-slate-700">${fmt(item.line_total)}</td>
                </tr>
            `).join('');
        } else {
            _el('pinv-items').innerHTML = `
                <tr><td colspan="6" class="py-8 text-center text-slate-400">لا توجد أصناف</td></tr>
            `;
        }

        // Additional expenses
        if (inv.expenses && inv.expenses.length > 0) {
            _el('pinv-expenses-section').classList.remove('hidden');
            _el('pinv-expenses').innerHTML = inv.expenses.map(exp => `
                <tr>
                    <td class="py-2 text-slate-700">${esc(exp.description)}</td>
                    <td class="py-2 text-left font-mono font-semibold text-amber-700">${fmt(exp.amount)}</td>
                </tr>
            `).join('');
            
            const expensesTotal = inv.expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
            _el('pinv-expenses-total-row').classList.remove('hidden');
            _el('pinv-expenses-total').textContent = fmt(expensesTotal);
        }

        // Totals
        _el('pinv-subtotal').textContent = fmt(inv.subtotal);
        _el('pinv-tax').textContent = fmt(inv.tax_amount);
        _el('pinv-grand-total').textContent = fmt(inv.grand_total);

        // Notes
        if (inv.notes) {
            _el('pinv-notes-section').classList.remove('hidden');
            _el('pinv-notes').textContent = esc(inv.notes);
        }

        // View date
        _el('pinv-view-date').textContent = new Date().toLocaleDateString('ar-EG');
    }

    // ── Show Error ─────────────────────────────────────────────────────────────
    function _showError() {
        _el('pinv-loading').classList.add('hidden');
        _el('pinv-card').classList.add('hidden');
        _el('pinv-error').classList.remove('hidden');
    }

    // ── Start ──────────────────────────────────────────────────────────────────
    _init();
})();
