'use strict';

// =============================================================================
// G.PACK 2.0 — Account Statement Controller
// كشف حساب من الدليل المحاسبي
// =============================================================================

(function() {
    const _el = (id) => document.getElementById(id);
    const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

    let _accountsTree = { parents: [], children: [] };
    let _selectedParent = null;
    let _selectedChild = null;
    let _lastStatementData = null;

    const _typeLabels = {
        'asset': 'أصول',
        'liability': 'خصوم',
        'equity': 'حقوق ملكية',
        'revenue': 'إيرادات',
        'expense': 'مصاريف'
    };

    // ── Init ───────────────────────────────────────────────────────────────────
    async function _init() {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        _el('as-to-date').value = today.toISOString().split('T')[0];
        _el('as-from-date').value = firstDay.toISOString().split('T')[0];

        try {
            const data = await window.apiFetch('/api/account-statement/accounts-tree');
            _accountsTree = data;
            _renderParentList(data.parents);
        } catch (err) {
            console.error('Failed to load accounts tree:', err);
        }
    }

    // ── Parent Dropdown ────────────────────────────────────────────────────────
    window.asToggleParentDropdown = function() {
        const dd = _el('as-parent-dropdown');
        dd.classList.toggle('hidden');
        if (!dd.classList.contains('hidden')) {
            _el('as-parent-search').value = '';
            _renderParentList(_accountsTree.parents);
            _el('as-parent-search').focus();
            _el('as-child-dropdown').classList.add('hidden');
        }
    };

    window.asFilterParent = function(query) {
        const q = (query || '').toLowerCase();
        const filtered = _accountsTree.parents.filter(a =>
            a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)
        );
        _renderParentList(filtered);
    };

    function _renderParentList(accounts) {
        const container = _el('as-parent-list');
        if (accounts.length === 0) {
            container.innerHTML = '<div class="px-4 py-3 text-sm text-slate-400 text-center">لا توجد نتائج</div>';
            return;
        }
        container.innerHTML = accounts.map(a => `
            <div onclick="window.asSelectParent('${esc(a.id)}', '${esc(a.code)}', '${esc(a.name)}', '${esc(a.account_type)}')"
                 class="px-4 py-2.5 hover:bg-brand-50 cursor-pointer border-b border-slate-50 last:border-0 flex items-center gap-3">
                <span class="font-mono text-xs text-slate-400 w-12">${esc(a.code)}</span>
                <span class="text-sm text-slate-700 flex-1">${esc(a.name)}</span>
                <span class="text-xs text-slate-400">${_typeLabels[a.account_type] || a.account_type}</span>
            </div>
        `).join('');
    }

    window.asSelectParent = function(id, code, name, type) {
        _selectedParent = { id, code, name, type };
        _selectedChild = null;

        _el('as-parent-label').textContent = `${code} — ${name}`;
        _el('as-parent-label').classList.remove('text-slate-400');
        _el('as-parent-label').classList.add('text-slate-700');
        _el('as-parent-dropdown').classList.add('hidden');

        // Enable child dropdown
        _el('as-child-btn').disabled = false;
        _el('as-child-label').textContent = 'كل الحسابات الفرعية';
        _el('as-child-label').classList.remove('text-slate-400');
        _el('as-child-label').classList.add('text-slate-700');

        // Filter children for this parent
        const children = _accountsTree.children.filter(c => c.parent_id === id);
        _renderChildList(children);
    };

    // ── Child Dropdown ─────────────────────────────────────────────────────────
    window.asToggleChildDropdown = function() {
        if (!_selectedParent) return;
        const dd = _el('as-child-dropdown');
        dd.classList.toggle('hidden');
        if (!dd.classList.contains('hidden')) {
            _el('as-child-search').value = '';
            const children = _accountsTree.children.filter(c => c.parent_id === _selectedParent.id);
            _renderChildList(children);
            _el('as-child-search').focus();
        }
    };

    window.asFilterChild = function(query) {
        if (!_selectedParent) return;
        const q = (query || '').toLowerCase();
        const children = _accountsTree.children
            .filter(c => c.parent_id === _selectedParent.id)
            .filter(a => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q));
        _renderChildList(children);
    };

    function _renderChildList(accounts) {
        const container = _el('as-child-list');
        // Add "all" option to query the parent account directly
        let html = `
            <div onclick="window.asSelectChild('all')"
                 class="px-4 py-2.5 hover:bg-brand-50 cursor-pointer border-b border-slate-50 flex items-center gap-3">
                <i class="fa-solid fa-layer-group text-slate-400 text-xs w-12 text-center"></i>
                <span class="text-sm font-semibold text-slate-700 flex-1">كل الحسابات الفرعية (الحساب الرئيسي)</span>
            </div>
        `;
        if (accounts.length === 0) {
            html += '<div class="px-4 py-3 text-sm text-slate-400 text-center">لا توجد حسابات فرعية</div>';
        } else {
            html += accounts.map(a => {
                const isVirtual = a.sub_account_type === 'client' || a.sub_account_type === 'supplier';
                const icon = a.sub_account_type === 'client' ? 'fa-user' : a.sub_account_type === 'supplier' ? 'fa-truck' : '';
                const subInfo = isVirtual ? ` data-sub-id="${esc(a.sub_account_id)}" data-sub-type="${esc(a.sub_account_type)}"` : '';
                const subDetail = a.phone || a.city ? `<span class="text-xs text-slate-400 block mt-0.5">${esc(a.phone || '')} ${a.city ? '• ' + esc(a.city) : ''}</span>` : '';
                return `
                <div onclick="window.asSelectChild('${esc(a.id)}', '${esc(a.code)}', '${esc(a.name)}', ${isVirtual ? `'${esc(a.sub_account_id)}'` : 'null'}, ${isVirtual ? `'${esc(a.sub_account_type)}'` : 'null'})"
                     class="px-4 py-2.5 hover:bg-brand-50 cursor-pointer border-b border-slate-50 last:border-0 flex items-center gap-3">
                    <div class="flex items-center gap-2 w-28 shrink-0">
                        ${icon ? `<i class="fa-solid ${icon} text-slate-400 text-xs"></i>` : ''}
                        <span class="font-mono text-xs text-slate-400">${esc(a.code)}</span>
                    </div>
                    <div class="flex-1">
                        <span class="text-sm text-slate-700">${esc(a.name)}</span>
                        ${subDetail}
                    </div>
                </div>`;
            }).join('');
        }
        container.innerHTML = html;
    }

    window.asSelectChild = function(id, code, name, subAccountId, subAccountType) {
        if (id === 'all') {
            _selectedChild = { id: _selectedParent.id, code: _selectedParent.code, name: _selectedParent.name, isParent: true, subAccountId: null, subAccountType: null };
            _el('as-child-label').textContent = 'كل الحسابات الفرعية';
        } else {
            _selectedChild = { id, code, name, isParent: false, subAccountId: subAccountId || null, subAccountType: subAccountType || null };
            _el('as-child-label').textContent = `${code} — ${name}`;
        }
        _el('as-child-label').classList.remove('text-slate-400');
        _el('as-child-label').classList.add('text-slate-700');
        _el('as-child-dropdown').classList.add('hidden');
    };

    // ── Load Statement ──────────────────────────────────────────────────────────
    window.asLoadStatement = async function() {
        if (!_selectedChild) {
            alert('الرجاء اختيار الحساب الفرعي أولاً');
            return;
        }

        const fromDate = _el('as-from-date').value;
        const toDate = _el('as-to-date').value;

        try {
            const params = [];
            if (fromDate) params.push(`from=${fromDate}`);
            if (toDate) params.push(`to=${toDate}`);

            let url;
            const subType = _selectedChild.subAccountType;
            const subId = _selectedChild.subAccountId;

            if (subType === 'client' && subId) {
                url = `/api/account-statement/client/${subId}` + (params.length > 0 ? '?' + params.join('&') : '');
            } else if (subType === 'supplier' && subId) {
                url = `/api/account-statement/supplier/${subId}` + (params.length > 0 ? '?' + params.join('&') : '');
            } else {
                if (subId) {
                    params.push(`subAccountId=${subId}`);
                    params.push(`subAccountType=${subType || ''}`);
                }
                url = `/api/account-statement/account/${_selectedChild.id}` + (params.length > 0 ? '?' + params.join('&') : '');
            }

            const res = await window.apiFetch(url);
            _lastStatementData = res;
            _renderAccountInfo(res.account || res.client || res.supplier);
            _renderStatement(res);

            // Enable print button always, share button only for clients
            const printBtn = _el('as-print-btn');
            const shareBtn = _el('as-share-btn');
            if (printBtn) printBtn.disabled = false;
            if (shareBtn) {
                shareBtn.disabled = !(subType === 'client' && subId);
            }
        } catch (err) {
            alert('خطأ في تحميل كشف الحساب: ' + err.message);
        }
    };

    function _renderAccountInfo(account) {
        const accType = account.account_type || (account.phone !== undefined ? 'asset' : 'asset');
        _el('as-party-type').textContent = _typeLabels[accType] || accType || 'حساب';
        _el('as-party-name').textContent = account.name || account.company_name || '—';
        _el('as-party-details').textContent = account.code ? `كود: ${account.code}` : (account.phone ? `هاتف: ${account.phone}` : '');
        _el('as-initial').classList.add('hidden');
        _el('as-party-info').classList.remove('hidden');
        _el('as-statement-section').classList.add('hidden');
        _el('as-summary-section').classList.add('hidden');
    }

    function _renderStatement(data) {
        const summary = data.summary || {};
        const transactions = data.transactions || [];

        const totalDebit = summary.total_debit !== undefined ? summary.total_debit : (summary.total_invoices !== undefined ? summary.total_invoices : 0);
        const totalCredit = summary.total_credit !== undefined ? summary.total_credit : (summary.total_payments !== undefined ? summary.total_payments : 0);
        _el('as-total-debit').textContent = fmt(totalDebit);
        _el('as-total-credit').textContent = fmt(totalCredit);
        _el('as-final-balance').textContent = fmt(summary.balance);
        _el('as-party-balance').textContent = fmt(summary.balance);

        const balanceEl = _el('as-party-balance');
        if (summary.balance > 0) {
            balanceEl.className = 'text-3xl font-black text-red-600';
        } else if (summary.balance < 0) {
            balanceEl.className = 'text-3xl font-black text-emerald-600';
        } else {
            balanceEl.className = 'text-3xl font-black text-slate-600';
        }

        _el('as-summary-section').classList.remove('hidden');

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
                const balance = parseFloat(t.running_balance || 0);

                return `<tr class="${rowClass} border-b border-slate-100 hover:bg-blue-50/30 transition-colors">
                    <td class="py-3 px-4 text-slate-600 text-xs">${new Date(t.trans_date).toLocaleDateString('ar-SA-u-nu-latn')}</td>
                    <td class="py-3 px-4">
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${_getDocTypeClass(t.document_type)}">
                            ${_getDocTypeIcon(t.document_type)}
                            ${esc(t.document_type)}
                        </span>
                    </td>
                    <td class="py-3 px-4 font-mono text-slate-700 font-bold">#${esc(t.document_number)}</td>
                    <td class="py-3 px-4 font-mono font-bold ${debit > 0 ? 'text-red-600' : 'text-slate-300'}">${debit > 0 ? fmt(debit) : '-'}</td>
                    <td class="py-3 px-4 font-mono font-bold ${credit > 0 ? 'text-emerald-600' : 'text-slate-300'}">${credit > 0 ? fmt(credit) : '-'}</td>
                    <td class="py-3 px-4 font-mono font-bold ${_getBalanceColor(balance)}">${fmt(balance)}</td>
                    <td class="py-3 px-4 text-slate-500 text-xs">${esc(t.notes || '')}</td>
                </tr>`;
            }).join('');
        }

        _el('as-statement-section').classList.remove('hidden');
    }

    function _getDocTypeClass(type) {
        if (type.includes('قبض')) return 'bg-emerald-100 text-emerald-700';
        if (type.includes('صرف')) return 'bg-red-100 text-red-700';
        if (type.includes('مبيعات')) return 'bg-blue-100 text-blue-700';
        if (type.includes('مشتريات')) return 'bg-amber-100 text-amber-700';
        if (type.includes('يومية')) return 'bg-purple-100 text-purple-700';
        return 'bg-slate-100 text-slate-700';
    }

    function _getDocTypeIcon(type) {
        if (type.includes('قبض')) return '<i class="fa-solid fa-hand-holding-dollar"></i>';
        if (type.includes('صرف')) return '<i class="fa-solid fa-money-bill-transfer"></i>';
        if (type.includes('مبيعات')) return '<i class="fa-solid fa-file-invoice"></i>';
        if (type.includes('مشتريات')) return '<i class="fa-solid fa-cart-shopping"></i>';
        if (type.includes('يومية')) return '<i class="fa-solid fa-book-journal-whills"></i>';
        return '<i class="fa-solid fa-file"></i>';
    }

    function _getBalanceColor(balance) {
        if (balance > 0) return 'text-red-600';
        if (balance < 0) return 'text-emerald-600';
        return 'text-slate-600';
    }

    // ── Print Statement ─────────────────────────────────────────────────────────
    window.asPrintStatement = async function() {
        if (!_lastStatementData) return;
        const data = _lastStatementData;
        const account = data.account || data.client || data.supplier;
        const summary = data.summary || {};
        const transactions = data.transactions || [];
        const fromDate = _el('as-from-date').value;
        const toDate = _el('as-to-date').value;

        let logoBase64 = null;
        try {
            const res = await fetch('/images/logo.png');
            if (res.ok) {
                const blob = await res.blob();
                logoBase64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(new Error('logo decode failed'));
                    reader.readAsDataURL(blob);
                });
            }
        } catch (e) { /* logo optional */ }

        const totalDebit = summary.total_debit !== undefined ? summary.total_debit : (summary.total_invoices !== undefined ? summary.total_invoices : 0);
        const totalCredit = summary.total_credit !== undefined ? summary.total_credit : (summary.total_payments !== undefined ? summary.total_payments : 0);

        const rowsHTML = transactions.map((t, i) => {
            const debit = parseFloat(t.debit || 0);
            const credit = parseFloat(t.credit || 0);
            const balance = parseFloat(t.running_balance || 0);
            return `<tr>
                <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#64748b;font-size:12px">${new Date(t.trans_date).toLocaleDateString('en-GB')}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;color:#1e293b;font-size:12px">${esc(t.document_type)}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace;font-weight:700;color:#334155;font-size:12px">#${esc(t.document_number)}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:${debit > 0 ? '#dc2626' : '#cbd5e1'};font-size:12px">${debit > 0 ? fmt(debit) : '-'}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:${credit > 0 ? '#059669' : '#cbd5e1'};font-size:12px">${credit > 0 ? fmt(credit) : '-'}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:800;color:${balance > 0 ? '#dc2626' : balance < 0 ? '#059669' : '#64748b'};font-size:12px">${fmt(balance)}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#94a3b8">${esc(t.notes || '')}</td>
            </tr>`;
        }).join('');

        const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>كشف حساب — ${esc(account.name || '')}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#fff;color:#1e293b;padding:30px;direction:rtl}
@media print{body{padding:15px}.no-print{display:none!important}@page{margin:15mm}}
.doc-container{max-width:800px;margin:0 auto}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:18px;border-bottom:3px solid #4b0082}
.logo-section{display:flex;align-items:center;gap:12px}
.logo-section img{width:58px;height:58px;object-fit:contain}
.logo-text h1{font-size:24px;font-weight:900;color:#4b0082;margin-bottom:4px}
.logo-text p{font-size:12px;color:#64748b}
.doc-meta{text-align:left}
.doc-meta .doc-title{font-size:20px;font-weight:900;color:#1e293b}
.doc-meta .doc-date{font-size:12px;color:#64748b;margin-top:4px}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;background:#faf5ff;border-radius:12px;padding:20px;border:1px solid #e9d5ff}
.info-item label{font-size:11px;color:#64748b;display:block;margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px}
.info-item span{font-weight:700;font-size:14px;color:#1e293b}
.summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:24px}
.summary-card{background:#faf5ff;border:1px solid #e9d5ff;border-radius:12px;padding:16px;text-align:center}
.summary-card label{font-size:11px;color:#64748b;display:block;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px}
.summary-card .val{font-size:22px;font-weight:900}
.summary-card.debit .val{color:#dc2626}
.summary-card.credit .val{color:#059669}
.summary-card.balance .val{color:#4b0082}
table.items{width:100%;border-collapse:collapse;margin-bottom:20px;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0}
table.items thead{background:linear-gradient(135deg,#4b0082,#6e329b)}
table.items thead th{padding:12px;color:#fbbf24;font-size:11px;font-weight:700;text-align:center}
table.items thead th:nth-child(1),table.items thead th:nth-child(2),table.items thead th:nth-child(3),table.items thead th:nth-child(7){text-align:right}
table.items tbody tr:last-child td{border-bottom:none}
table.items tbody tr:nth-child(even){background:#faf5ff}
.doc-footer{margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:11px;color:#94a3b8}
.doc-footer .brand{font-weight:800;color:#5d198e;font-size:13px}
.print-btn{position:fixed;bottom:20px;left:20px;padding:12px 24px;background:#4b0082;color:#fbbf24;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(75,0,130,0.3)}
.print-btn:hover{background:#5d198e}
</style></head><body>
<div class="doc-container">
<div class="header">
    <div class="logo-section">
        ${logoBase64 ? `<img src="${logoBase64}" alt="G.PACK Logo">` : ''}
        <div class="logo-text">
            <h1>G.PACK</h1>
            <p>حلول التعبئة والتغليف</p>
            <p>ينبع، المملكة العربية السعودية</p>
        </div>
    </div>
    <div class="doc-meta">
        <div class="doc-title">كشف حساب</div>
        <div class="doc-date">${new Date().toLocaleDateString('en-GB')}</div>
        ${fromDate || toDate ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px">${fromDate ? 'من: ' + fromDate : ''} ${toDate ? 'إلى: ' + toDate : ''}</div>` : ''}
    </div>
</div>
<div class="info-grid">
    <div class="info-item"><label>الاسم</label><span>${esc(account.name || account.company_name || '—')}</span></div>
    <div class="info-item"><label>الهاتف</label><span>${esc(account.phone || '—')}</span></div>
    ${account.code ? `<div class="info-item"><label>الكود</label><span>${esc(account.code)}</span></div>` : ''}
    ${account.city ? `<div class="info-item"><label>المدينة</label><span>${esc(account.city)}</span></div>` : ''}
</div>
<div class="summary-grid">
    <div class="summary-card debit"><label>إجمالي مدين</label><div class="val">${fmt(totalDebit)}</div></div>
    <div class="summary-card credit"><label>إجمالي دائن</label><div class="val">${fmt(totalCredit)}</div></div>
    <div class="summary-card balance"><label>الرصيد</label><div class="val">${fmt(summary.balance || 0)}</div></div>
</div>
<table class="items"><thead><tr>
    <th>التاريخ</th><th>الوثيقة</th><th>الرقم</th><th>مدين</th><th>دائن</th><th>الرصيد</th><th>ملاحظات</th>
</tr></thead>
<tbody>${rowsHTML || '<tr><td colspan="7" style="text-align:center;padding:24px;color:#94a3b8">لا توجد حركات</td></tr>'}</tbody></table>
<div class="doc-footer"><span class="brand">G.PACK ERP 2.0</span><span>تاريخ الطباعة: ${new Date().toLocaleDateString('en-GB')}</span></div>
</div>
<button class="print-btn no-print" onclick="window.print()">🖨️ طباعة</button>
</body></html>`;
        const w = window.open('', '_blank', 'width=800,height=700');
        w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500);
    };

    // ── Copy Share Link ─────────────────────────────────────────────────────────
    window.asCopyShareLink = async function() {
        if (!_selectedChild || _selectedChild.subAccountType !== 'client' || !_selectedChild.subAccountId) return;
        const clientId = _selectedChild.subAccountId;
        const token = btoa(clientId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const baseUrl = window.location.origin;
        const shareUrl = `${baseUrl}/public-statement.html?client=${clientId}&t=${token}`;
        try {
            await navigator.clipboard.writeText(shareUrl);
            window.showToast('تم نسخ رابط كشف الحساب ✅', 'success');
        } catch (e) {
            prompt('انسخ الرابط يدوياً:', shareUrl);
        }
    };

    // ── Click outside to close dropdowns ───────────────────────────────────────
    document.addEventListener('click', (e) => {
        const parentWrap = _el('as-parent-btn')?.closest('.flex-1');
        if (parentWrap && !parentWrap.contains(e.target)) {
            _el('as-parent-dropdown').classList.add('hidden');
        }
        const childWrap = _el('as-child-btn')?.closest('.flex-1');
        if (childWrap && !childWrap.contains(e.target)) {
            _el('as-child-dropdown').classList.add('hidden');
        }
    });

    // ── Start ───────────────────────────────────────────────────────────────────
    _init();
})();
