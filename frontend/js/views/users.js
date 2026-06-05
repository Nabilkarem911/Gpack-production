'use strict';
// G.PACK 2.0 - Users & Roles View (Clean Build)

const usersView = (() => {
    // ?? State ??????????????????????????????????????????????????????
    let _users = [];
    let _roles = [];
    let _editingUserId  = null;
    let _editingRoleId  = null;

    // ?? Permission Modules (CRUD grid) ?????????????????????????????
    const _PERMISSION_MODULES = [
        { key: 'dashboard',   label: '·ÊÕ… «· Õﬂ„' },
        { key: 'quotations',  label: '⁄—Ê÷ «·√”⁄«—' },
        { key: 'orders',      label: '«·ÿ·»« ' },
        { key: 'clients',     label: '«·⁄„·«¡' },
        { key: 'products',    label: '«·„‰ Ã« ' },
        { key: 'inventory',   label: '«·„Œ“Ê‰' },
        { key: 'warehouses',  label: '«·„” Êœ⁄« ' },
        { key: 'invoices',    label: '«·›Ê« Ì—' },
        { key: 'accounting',  label: '«·„Õ«”»…' },
        { key: 'reports',     label: '«· ﬁ«—Ì—' },
        { key: 'tasks',       label: '«·„Â«„' },
        { key: 'users',       label: '«·„” Œœ„Ì‰' },
        { key: 'settings',    label: '«·≈⁄œ«œ« ' },
    ];

    // ?? Helpers ????????????????????????????????????????????????????
    function el(id) { return document.getElementById(id); }

    function _roleLabel(roleName) {
        const map = {
            super_admin: '„œÌ— «·‰Ÿ«„',
            admin: '√œ„‰',
            manager: '„œÌ—',
            sales: '„»Ì⁄« ',
            accountant: '„Õ«”»',
            warehouse: '„” Êœ⁄',
        };
        return map[roleName] || roleName;
    }

    function toast(msg, type = 'success') {
        if (typeof window.showToast === 'function') {
            window.showToast(msg, type);
            return;
        }
        const t = document.createElement('div');
        t.className = `fixed top-5 left-1/2 -translate-x-1/2 z-[9999] px-5 py-2.5 rounded-xl text-white text-sm font-medium shadow-lg
                       ${type === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`;
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    // ?? API ????????????????????????????????????????????????????????
    async function api(path, opts = {}) {
        const res = await window.apiFetch(path, opts);
        if (!res.success) throw new Error(res.error || 'Œÿ√ €Ì— „⁄—Ê›');
        return res;
    }

    // ?? Load ???????????????????????????????????????????????????????
    async function loadAll() {
        try {
            const [usersRes, rolesRes] = await Promise.all([
                api('/api/users'),
                api('/api/users/roles')
            ]);
            _users = usersRes.data  || [];
            _roles = rolesRes.data  || [];
            updateStats();
            renderUsers();
            renderRoles();
            _populateRoleDropdowns();
        } catch (err) {
            console.error('[usersView] loadAll error:', err);
            toast('›‘· ›Ì  Õ„Ì· «·»Ì«‰« ', 'error');
        }
    }

    // ?? Stats ??????????????????????????????????????????????????????
    function updateStats() {
        el('stat-total').textContent      = _users.length;
        el('stat-active').textContent     = _users.filter(u => u.status === 'active').length;
        el('stat-roles').textContent      = _roles.length;
        el('stat-with-roles').textContent = _users.filter(u => u.role_id).length;
    }

    // ?? Tabs ???????????????????????????????????????????????????????
    function switchTab(tab) {
        const isUsers = tab === 'users';
        el('tab-users').classList.toggle('hidden', !isUsers);
        el('tab-roles').classList.toggle('hidden', isUsers);

        const uBtn = el('tab-users-btn');
        const rBtn = el('tab-roles-btn');
        if (isUsers) {
            uBtn.className = 'px-6 py-3 text-sm font-semibold text-brand-600 border-b-2 border-brand-600 bg-brand-50 transition-all';
            rBtn.className = 'px-6 py-3 text-sm font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-all';
        } else {
            rBtn.className = 'px-6 py-3 text-sm font-semibold text-brand-600 border-b-2 border-brand-600 bg-brand-50 transition-all';
            uBtn.className = 'px-6 py-3 text-sm font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-all';
        }
    }

    // ?? Render Users ???????????????????????????????????????????????
    function renderUsers() {
        const tbody  = el('users-tbody');
        const empty  = el('users-empty');
        const search = (el('search-users')?.value || '').toLowerCase();
        const roleF  = el('filter-role')?.value  || '';
        const statF  = el('filter-status')?.value || '';

        const list = _users.filter(u => {
            if (search && !u.name?.toLowerCase().includes(search) && !u.email?.toLowerCase().includes(search)) return false;
            if (roleF  && u.role_id !== roleF)    return false;
            if (statF  && u.status  !== statF)    return false;
            return true;
        });

        if (!list.length) {
            tbody.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        tbody.innerHTML = list.map(u => {
            const role       = _roles.find(r => r.id === u.role_id);
            const roleBadge  = role
                ? `<span class="inline-flex px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-50 text-purple-700">${_roleLabel(role.role_name)}</span>`
                : `<span class="inline-flex px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-500">»œÊ‰ œÊ—</span>`;
            const statusBadge = u.status === 'active'
                ? `<span class="inline-flex px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-100 text-emerald-700">‰‘ÿ</span>`
                : `<span class="inline-flex px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-500">„⁄ÿ·</span>`;
            const initial = (u.name || 'U').charAt(0).toUpperCase();
            const date    = u.created_at ? new Date(u.created_at).toLocaleDateString('ar-SA-u-nu-latn') : '-';

            return `<tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td class="px-4 py-3">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm">${initial}</div>
                        <div>
                            <p class="font-semibold text-slate-800 text-sm">${u.name || '-'}</p>
                            <p class="text-xs text-slate-400">${date}</p>
                        </div>
                    </div>
                </td>
                <td class="px-4 py-3 text-sm text-slate-600">${u.email || '-'}</td>
                <td class="px-4 py-3">${roleBadge}</td>
                <td class="px-4 py-3">${statusBadge}</td>
                <td class="px-4 py-3 text-center">
                    <div class="flex items-center justify-center gap-1">
                        <button onclick="usersView.openUserModal('${u.id}')"
                                class="w-8 h-8 rounded-lg hover:bg-blue-50 text-blue-500 flex items-center justify-center transition-colors" title=" ⁄œÌ·">
                            <i class="fa-solid fa-pen-to-square text-xs"></i>
                        </button>
                        <button onclick="usersView.toggleStatus('${u.id}')"
                                class="w-8 h-8 rounded-lg hover:bg-amber-50 text-amber-500 flex items-center justify-center transition-colors"
                                title="${u.status === 'active' ? ' ⁄ÿÌ·' : ' ›⁄Ì·'}">
                            <i class="fa-solid fa-${u.status === 'active' ? 'ban' : 'check'} text-xs"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    // ?? Render Roles ???????????????????????????????????????????????
    function renderRoles() {
        const tbody = el('roles-tbody');
        const empty = el('roles-empty');

        if (!_roles.length) {
            tbody.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        tbody.innerHTML = _roles.map(r => {
            const count      = _users.filter(u => u.role_id === r.id).length;
            const isSuperAdmin = r.role_name === 'super_admin';
            const badge      = isSuperAdmin
                ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-700"><i class="fa-solid fa-crown text-xs"></i> „œÌ— «·‰Ÿ«„</span>`
                : `<span class="inline-flex px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-600">${_roleLabel(r.role_name)}</span>`;

            return `<tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td class="px-4 py-3">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-sm">
                            ${isSuperAdmin ? '<i class="fa-solid fa-crown text-xs"></i>' : (r.role_name || 'R').charAt(0).toUpperCase()}
                        </div>
                        <div>${badge}</div>
                    </div>
                </td>
                <td class="px-4 py-3 text-sm text-slate-500">${r.description || '-'}</td>
                <td class="px-4 py-3">
                    <span class="inline-flex px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700">${count} „” Œœ„</span>
                </td>
                <td class="px-4 py-3 text-center">
                    <div class="flex items-center justify-center gap-1">
                        ${!isSuperAdmin ? `
                        <button onclick="usersView.openRoleModal('${r.id}')"
                                class="w-8 h-8 rounded-lg hover:bg-blue-50 text-blue-500 flex items-center justify-center transition-colors" title=" ⁄œÌ·">
                            <i class="fa-solid fa-pen-to-square text-xs"></i>
                        </button>
                        ${count === 0 ? `
                        <button onclick="usersView.deleteRole('${r.id}')"
                                class="w-8 h-8 rounded-lg hover:bg-red-50 text-red-500 flex items-center justify-center transition-colors" title="Õ–›">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>` : ''}
                        ` : '<span class="text-xs text-slate-400">„Õ„Ì</span>'}
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    // ?? Populate dropdowns ?????????????????????????????????????????
    function _populateRoleDropdowns() {
        const opts = _roles.map(r => `<option value="${r.id}">${_roleLabel(r.role_name)}</option>`).join('');
        const filterEl = el('filter-role');
        if (filterEl) filterEl.innerHTML = '<option value="">Ã„Ì⁄ «·√œÊ«—</option>' + opts;
        const umRole = el('um-role');
        if (umRole) umRole.innerHTML = '<option value="">»œÊ‰ œÊ—</option>' + opts;
    }

    // ?? User Modal ?????????????????????????????????????????????????
    function openUserModal(userId = null) {
        _editingUserId = userId;
        el('user-modal-title').textContent = userId ? ' ⁄œÌ· „” Œœ„' : '„” Œœ„ ÃœÌœ';
        el('um-password-label').innerHTML = userId
            ? 'ﬂ·„… «·„—Ê— «·ÃœÌœ… <span class="text-slate-400 font-normal text-xs">(« —ﬂÂ« ›«—€… ·⁄œ„ «· €ÌÌ—)</span>'
            : 'ﬂ·„… «·„—Ê— <span class="text-red-500">*</span>';

        if (userId) {
            const u = _users.find(u => u.id === userId);
            if (!u) return;
            el('um-name').value   = u.name  || '';
            el('um-email').value  = u.email || '';
            el('um-role').value   = u.role_id || '';
            el('um-status').value = u.status || 'active';
        } else {
            el('um-name').value   = '';
            el('um-email').value  = '';
            el('um-password').value = '';
            el('um-role').value   = '';
            el('um-status').value = 'active';
        }
        el('user-modal').classList.remove('hidden');
    }

    function closeUserModal() {
        el('user-modal').classList.add('hidden');
        _editingUserId = null;
    }

    async function saveUser() {
        const name   = el('um-name').value.trim();
        const email  = el('um-email').value.trim();
        const roleId = el('um-role').value;
        const status = el('um-status').value;

        if (!name || !email) { toast('«·«”„ Ê«·»—Ìœ „ÿ·Ê»«‰', 'error'); return; }

        const body = { name, email, role_id: roleId || null, status };

        const pw = el('um-password').value;
        if (!_editingUserId) {
            if (!pw || pw.length < 6) { toast('ﬂ·„… «·„—Ê— „ÿ·Ê»… (6 √Õ—› ⁄·Ï «·√ﬁ·)', 'error'); return; }
            body.password = pw;
        } else if (pw && pw.length > 0) {
            if (pw.length < 6) { toast('ﬂ·„… «·„—Ê— ÌÃ» √‰  ﬂÊ‰ 6 √Õ—› ⁄·Ï «·√ﬁ·', 'error'); return; }
            body.password = pw;
        }

        try {
            if (_editingUserId) {
                await api(`/api/users/${_editingUserId}`, { method: 'PUT', body });
                toast(' „  ÕœÌÀ «·„” Œœ„');
            } else {
                await api('/api/users', { method: 'POST', body });
                toast(' „ ≈‰‘«¡ «·„” Œœ„');
            }
            closeUserModal();
            await loadAll();
        } catch (err) {
            toast(err.message || '›‘· ›Ì «·Õ›Ÿ', 'error');
        }
    }

    async function toggleStatus(userId) {
        const u = _users.find(u => u.id === userId);
        if (!u) return;
        const newStatus = u.status === 'active' ? 'inactive' : 'active';
        if (!confirm(`Â·  —Ìœ ${newStatus === 'active' ? ' ›⁄Ì·' : ' ⁄ÿÌ·'} «·„” Œœ„ "${u.name}"ø`)) return;
        try {
            await api(`/api/users/${userId}`, { method: 'PUT', body: { status: newStatus } });
            toast(newStatus === 'active' ? ' „ «· ›⁄Ì·' : ' „ «· ⁄ÿÌ·');
            await loadAll();
        } catch (err) {
            toast(err.message || '›‘· ›Ì «· ÕœÌÀ', 'error');
        }
    }

    // ?? Role Permissions Grid ?????????????????????????????????????
    function _renderRolePermissions(existingPerms = {}) {
        const tbody = el('rm-perms-tbody');
        if (!tbody) return;
        tbody.innerHTML = _PERMISSION_MODULES.map(m => {
            const p = existingPerms[m.key] || {};
            return `
                <tr class="hover:bg-slate-50">
                    <td class="py-2 px-3 text-slate-700 font-medium text-xs">${m.label}</td>
                    <td class="py-2 px-2 text-center">
                        <input type="checkbox" data-mod="${m.key}" data-action="view"
                               ${p.view === true ? 'checked' : ''}
                               class="rm-perm-cb w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer">
                    </td>
                    <td class="py-2 px-2 text-center">
                        <input type="checkbox" data-mod="${m.key}" data-action="create"
                               ${p.create === true ? 'checked' : ''}
                               class="rm-perm-cb w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer">
                    </td>
                    <td class="py-2 px-2 text-center">
                        <input type="checkbox" data-mod="${m.key}" data-action="edit"
                               ${p.edit === true ? 'checked' : ''}
                               class="rm-perm-cb w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer">
                    </td>
                    <td class="py-2 px-2 text-center">
                        <input type="checkbox" data-mod="${m.key}" data-action="delete"
                               ${p.delete === true ? 'checked' : ''}
                               class="rm-perm-cb w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer">
                    </td>
                </tr>`;
        }).join('');
    }

    function _collectRolePermissions() {
        const perms = {};
        document.querySelectorAll('.rm-perm-cb').forEach(cb => {
            const mod = cb.getAttribute('data-mod');
            const action = cb.getAttribute('data-action');
            if (!perms[mod]) perms[mod] = {};
            perms[mod][action] = cb.checked;
        });
        return perms;
    }

    function _toggleAllPermissions(checked) {
        document.querySelectorAll('.rm-perm-cb').forEach(cb => { cb.checked = checked; });
    }

    // ?? Role Modal ?????????????????????????????????????????????????
    function openRoleModal(roleId = null) {
        _editingRoleId = roleId;
        el('role-modal-title').textContent = roleId ? ' ⁄œÌ· œÊ—' : 'œÊ— ÃœÌœ';

        if (roleId) {
            const r = _roles.find(r => r.id === roleId);
            if (!r) return;
            el('rm-name').value = r.role_name   || '';
            el('rm-desc').value = r.description || '';
            _renderRolePermissions(r.permissions || {});
        } else {
            el('rm-name').value = '';
            el('rm-desc').value = '';
            _renderRolePermissions({});
        }
        el('role-modal').classList.remove('hidden');
    }

    function closeRoleModal() {
        el('role-modal').classList.add('hidden');
        _editingRoleId = null;
    }

    async function saveRole() {
        const name = el('rm-name').value.trim();
        const desc = el('rm-desc').value.trim();
        const permissions = _collectRolePermissions();

        if (!name) { toast('«”„ «·œÊ— „ÿ·Ê»', 'error'); return; }

        try {
            if (_editingRoleId) {
                await api(`/api/users/roles/${_editingRoleId}`, {
                    method: 'PUT',
                    body: { role_name: name, description: desc, permissions }
                });
                toast(' „  ÕœÌÀ «·œÊ—');
            } else {
                await api('/api/users/roles', {
                    method: 'POST',
                    body: { role_name: name, description: desc, permissions }
                });
                toast(' „ ≈‰‘«¡ «·œÊ—');
            }
            closeRoleModal();
            await loadAll();
        } catch (err) {
            toast(err.message || '›‘· ›Ì «·Õ›Ÿ', 'error');
        }
    }

    async function deleteRole(roleId) {
        const r = _roles.find(r => r.id === roleId);
        if (!r) return;
        if (!confirm(`Â·  —Ìœ Õ–› «·œÊ— "${r.role_name}"ø`)) return;
        try {
            await api(`/api/users/roles/${roleId}`, { method: 'DELETE' });
            toast(' „ Õ–› «·œÊ—');
            await loadAll();
        } catch (err) {
            toast(err.message || '›‘· ›Ì «·Õ–›', 'error');
        }
    }

    // ?? Init ???????????????????????????????????????????????????????
    function _init() {
        el('btn-add-user')?.addEventListener('click', () => openUserModal());
        el('btn-add-role')?.addEventListener('click', () => openRoleModal());

        // Close modals on backdrop click
        el('user-modal')?.addEventListener('click', e => { if (e.target.id === 'user-modal') closeUserModal(); });
        el('role-modal')?.addEventListener('click', e => { if (e.target.id === 'role-modal') closeRoleModal(); });

        loadAll();
    }

    // ?? Public API ?????????????????????????????????????????????????
    return {
        _init,
        switchTab,
        renderUsers,
        openUserModal,
        closeUserModal,
        saveUser,
        toggleStatus,
        openRoleModal,
        closeRoleModal,
        saveRole,
        deleteRole,
        _toggleAllPermissions,
    };
})();

// Auto-init
window.initUsersView = () => usersView._init();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', usersView._init);
} else {
    usersView._init();
}
