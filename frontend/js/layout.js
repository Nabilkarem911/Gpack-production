'use strict';

// =============================================================================
// G.PACK 2.0 - Layout & Router Module (layout.js)
// Builds the sidebar navigation and top header via DOM injection.
// Implements a simple hash-based SPA router (navigateTo).
// Depends on: api.js (window.GpackUser, window.GpackPerms, showToast)
// =============================================================================

// =============================================================================
// NAV_ITEMS
// The master navigation definition. Each item declares:
//   - view:       the HTML filename (without .html) inside /views/
//   - label:      Arabic display name
//   - icon:       Font Awesome class
//   - permission: key checked in window.GpackPerms (null = always visible)
//   - section:    optional section header label (rendered once per group)
// =============================================================================
// =============================================================================
// NAV_ITEMS — Only include views that have a corresponding HTML file in /views/
// Unbuilt views are commented out to prevent SPA 404 errors.
// Rule: ALWAYS add a new entry here when creating a new view HTML file.
// =============================================================================
var NAV_ITEMS = [ // var allows re-declaration if script loads more than once in SPA

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. الرئيسية
    // ─────────────────────────────────────────────────────────────────────────────
    { section: 'الرئيسية' },
    { view: 'dashboard',     label: 'لوحة التحكم',     icon: 'fa-gauge-high',    permission: 'dashboard' }, // ✅ dashboard.html

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. المبيعات
    // ─────────────────────────────────────────────────────────────────────────────
    { section: 'المبيعات' },
    { view: 'clients',          label: 'العملاء',          icon: 'fa-users',         permission: 'clients'  }, // ✅ clients.html
    { view: 'client-profile',   label: 'ملف العميل',       icon: 'fa-id-card',       permission: 'clients', hidden: true }, // ✅ client-profile.html
    { view: 'sales-invoices',   label: 'فواتير المبيعات',  icon: 'fa-file-invoice-dollar', permission: 'sales'   }, // ✅ sales-invoices.html
    { view: 'sales-invoice-detail', label: 'تفاصيل الفاتورة', icon: 'fa-file-invoice', permission: 'sales', hidden: true }, // ✅ sales-invoice-detail.html
    { view: 'quotations',       label: 'عروض الأسعار',     icon: 'fa-file-lines',    permission: 'quotations' }, // ✅ quotations.html
    { view: 'production_orders', label: 'أوامر التشغيل',    icon: 'fa-industry',      permission: 'quotations' }, // ✅ production_orders.html
    { view: 'forecast',            label: 'مركز الذكاء (AI)',  icon: 'fa-brain',         permission: 'forecast' }, // ✅ forecast.html

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. المشتريات
    // ─────────────────────────────────────────────────────────────────────────────
    { section: 'المشتريات' },
    { view: 'suppliers',           label: 'الموردين',           icon: 'fa-truck',          permission: 'suppliers' }, // ✅ suppliers.html
    { view: 'supplier-profile',    label: 'ملف المورد',         icon: 'fa-id-card',        permission: 'suppliers', hidden: true }, // ✅ supplier-profile.html
    { view: 'purchase-invoices',   label: 'فواتير المشتريات',   icon: 'fa-file-invoice',   permission: 'purchasing' }, // ✅ purchase-invoices.html
    { view: 'purchase-returns',    label: 'مرتجع المشتريات',   icon: 'fa-rotate-left',    permission: 'purchasing' }, // ✅ Phase 3

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. الحسابات
    // ─────────────────────────────────────────────────────────────────────────────
    { section: 'الحسابات' },
    { view: 'account-statement',   label: 'كشف الحساب',         icon: 'fa-chart-column',          permission: 'accounting' }, // ✅ Phase 4.1
    { view: 'receipt-voucher',     label: 'سندات القبض',        icon: 'fa-hand-holding-dollar',  permission: 'accounting' }, // ✅ Phase 4.2
    { view: 'payment-voucher',     label: 'سندات الصرف',        icon: 'fa-money-bill-transfer',   permission: 'accounting' }, // ✅ Phase 4.3
    { view: 'journal-entry',       label: 'قيد اليومية',        icon: 'fa-book-journal-whills', permission: 'accounting' }, // ✅ Phase 4
    { view: 'chart-of-accounts',   label: 'الدليل المحاسبي',    icon: 'fa-sitemap',           permission: 'accounting' }, // ✅ Phase 4

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. المستودعات
    // ─────────────────────────────────────────────────────────────────────────────
    { section: 'المستودعات' },
    { view: 'warehouses',        label: 'المخازن',           icon: 'fa-warehouse',              permission: 'warehouses' }, // ✅ warehouses.html
    { view: 'inventory',         label: 'إدارة المخزون',     icon: 'fa-boxes-stacked',          permission: 'inventory' }, // ✅ inventory.html
    { view: 'products',            label: 'الأصناف',          icon: 'fa-box-open',             permission: 'products' }, // ✅ products.html (نُقل من المبيعات)
    { view: 'product-movements',   label: 'حركات الأصناف',    icon: 'fa-arrow-right-arrow-left', permission: 'products', hidden: true }, // ✅ product-movements.html
    { view: 'vmi-dispatch',       label: 'سندات التسليم',     icon: 'fa-truck-fast',             permission: 'inventory' }, // ✅ vmi-dispatch.html
    { view: 'receiving-vouchers', label: 'سندات الاستلام',     icon: 'fa-clipboard-check', permission: 'inventory' }, // ✅ receiving-vouchers.html

    // ─────────────────────────────────────────────────────────────────────────────
    // 6. الإدارة
    // ─────────────────────────────────────────────────────────────────────────────
    { section: 'الإدارة' },
    { view: 'users',         label: 'المستخدمون',       icon: 'fa-user-gear',     permission: 'users'    }, // ✅ users.html
    { view: 'tasks',         label: 'المهام',           icon: 'fa-list-check',    permission: 'tasks'     }, // ✅ tasks.html
    { view: 'settings',      label: 'الإعدادات',        icon: 'fa-gear',          permission: 'settings'  }, // ✅ settings.html

    // ─────────────────────────────────────────────────────────────────────────────
    // Public Pages (no login required)
    // ─────────────────────────────────────────────────────────────────────────────
    { view: 'public-client-statement', label: 'كشف حساب عام', icon: 'fa-file-invoice', permission: null, hidden: true, public: true }, // ✅ Public client statement
    { view: 'public-invoice',          label: 'فاتورة عام',   icon: 'fa-file-invoice-dollar', permission: null, hidden: true, public: true }, // ✅ Public invoice view

];

// =============================================================================
// _hasPermission(permKey)
// Returns true if the current user has access to the given permission key,
// OR if the user is super_admin (all_access), OR if permKey is null.
// =============================================================================
function _hasPermission(permKey) {
    if (!permKey) return true;
    if (window.GpackPerms && window.GpackPerms.all_access === true) return true;
    const mod = window.GpackPerms && window.GpackPerms[permKey];
    if (!mod) return false;
    // New CRUD format: { view: true, create: true, ... }
    if (typeof mod === 'object') return mod.view === true;
    // Legacy boolean format
    return !!mod;
}

// =============================================================================
// _buildSidebar()
// Injects navigation items into #sidebar-nav and user info into #sidebar-user.
// =============================================================================
function _buildSidebar() {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return;

    nav.innerHTML = '';
    let html = '';

    NAV_ITEMS.forEach(item => {
        if (item.section) {
            html += `
                <p class="sidebar-section-title px-3 pt-4 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    ${item.section}
                </p>`;
            return;
        }
        if (!_hasPermission(item.permission)) return;
        if (item.hidden) return;

        html += `
            <a href="#"
               class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300
                      hover:bg-white/10 hover:text-white transition-all duration-150 group cursor-pointer"
               data-view="${item.view}"
               title="${item.label}">
                <i class="fa-solid ${item.icon} w-5 text-center text-base flex-shrink-0 text-slate-400 group-hover:text-brand-400 transition-colors"></i>
                <span class="nav-label text-sm font-medium">${item.label}</span>
            </a>`;
    });

    nav.innerHTML = html;

    // Click handler for all nav items
    nav.querySelectorAll('.nav-item[data-view]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const view = el.getAttribute('data-view');
            window.navigateTo(view);
            // Close mobile sidebar if open
            _closeMobileSidebar();
        });
    });

    // Populate sidebar user section
    _buildSidebarUser();
}

// =============================================================================
// _buildSidebarUser()
// Injects the current user's name, role, and a logout button into #sidebar-user.
// =============================================================================
function _buildSidebarUser() {
    const container = document.getElementById('sidebar-user');
    if (!container || !window.GpackUser) return;

    const user   = window.GpackUser;
    const initials = user.name
        ? user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
        : '??';

    const roleLabels = {
        super_admin:        'مدير النظام',
        sales_manager:      'مدير المبيعات',
        sales_rep:          'مندوب مبيعات',
        inventory_manager:  'مدير المستودع',
        accountant:         'محاسب',
    };
    const roleLabel = roleLabels[user.role] || user.role;

    container.innerHTML = `
        <div class="flex items-center gap-3 mb-3">
            <div class="w-9 h-9 rounded-full bg-brand-700 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                ${initials}
            </div>
            <div class="sidebar-logo-text min-w-0">
                <p class="text-white text-sm font-semibold truncate">${user.name}</p>
                <p class="text-slate-400 text-xs truncate">${roleLabel}</p>
            </div>
        </div>
        <button onclick="window.logout()"
            class="sidebar-logo-text w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg
                   text-slate-400 hover:bg-red-600/20 hover:text-red-400 transition-all text-sm font-medium">
            <i class="fa-solid fa-right-from-bracket"></i>
            <span>تسجيل الخروج</span>
        </button>`;
}

// =============================================================================
// _buildHeader()
// Populates the header avatar and username from window.GpackUser.
// =============================================================================
function _buildHeader() {
    const user = window.GpackUser;
    if (!user) return;

    const avatar   = document.getElementById('header-avatar');
    const username = document.getElementById('header-username');

    const initials = user.name
        ? user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
        : '??';

    if (avatar)   avatar.textContent = initials;
    if (username) username.textContent = user.name;
}

// =============================================================================
// _setActiveNavItem(viewName)
// Highlights the correct sidebar item for the current view.
// =============================================================================
function _setActiveNavItem(viewName) {
    document.querySelectorAll('.nav-item[data-view]').forEach(el => {
        const isActive = el.getAttribute('data-view') === viewName;
        el.classList.toggle('active', isActive);
        el.classList.toggle('bg-brand-700',   isActive);
        el.classList.toggle('text-white',      isActive);
        el.classList.toggle('text-slate-300',  !isActive);

        const icon = el.querySelector('i');
        if (icon) {
            icon.classList.toggle('text-white',      isActive);
            icon.classList.toggle('text-slate-400',  !isActive);
        }
    });
}

// =============================================================================
// _setBreadcrumb(label)
// Updates the header breadcrumb text.
// =============================================================================
function _setBreadcrumb(label) {
    const bc = document.getElementById('breadcrumb');
    if (bc) {
        bc.innerHTML = `
            <span class="text-slate-400">G.PACK</span>
            <span class="mx-1.5 text-slate-300">/</span>
            <span class="text-slate-700 font-medium">${label}</span>`;
    }
}

// =============================================================================
// _closeMobileSidebar()
// =============================================================================
function _closeMobileSidebar() {
    const sidebar  = document.getElementById('sidebar');
    const overlay  = document.getElementById('sidebar-overlay');
    if (sidebar)  sidebar.classList.remove('mobile-open');
    if (overlay)  overlay.classList.add('hidden');
}

// =============================================================================
// _initSidebarToggles()
// Wires up the mobile menu button and the desktop collapse button.
// =============================================================================
function _initSidebarToggles() {
    // Mobile open/close
    const toggleBtn = document.getElementById('sidebar-toggle');
    const overlay   = document.getElementById('sidebar-overlay');
    const sidebar   = document.getElementById('sidebar');

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            const isOpen = sidebar.classList.contains('mobile-open');
            if (isOpen) {
                _closeMobileSidebar();
            } else {
                sidebar.classList.add('mobile-open');
                if (overlay) overlay.classList.remove('hidden');
            }
        });
    }

    if (overlay) {
        overlay.addEventListener('click', _closeMobileSidebar);
    }

    // Desktop collapse
    const collapseBtn = document.getElementById('sidebar-collapse-toggle');
    if (collapseBtn && sidebar) {
        collapseBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }
}

// =============================================================================
// navigateTo(viewName)
// The SPA router. Fetches /views/<viewName>.html and injects into #main-content.
// Sets the active sidebar item and updates the breadcrumb.
// =============================================================================
window.navigateTo = async function (viewName) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    // Find nav label for breadcrumb
    const navItem = NAV_ITEMS.find(n => n.view === viewName);
    const label   = navItem ? navItem.label : viewName;

    // Permission gate: block view if user lacks permission
    if (navItem && navItem.permission && !_hasPermission(navItem.permission)) {
        mainContent.innerHTML = `
            <div class="flex flex-col items-center justify-center h-64 text-slate-400">
                <i class="fa-solid fa-lock text-5xl mb-4 text-slate-300"></i>
                <p class="text-lg font-semibold text-slate-500">غير مصرح</p>
                <p class="text-sm mt-1">ليس لديك صلاحية الوصول إلى هذه الصفحة</p>
                <button onclick="window.navigateTo('dashboard')"
                    class="mt-5 px-5 py-2 bg-brand-700 text-white rounded-lg text-sm hover:bg-brand-800 transition-colors">
                    العودة للوحة التحكم
                </button>
            </div>`;
        return;
    }

    _setActiveNavItem(viewName);
    _setBreadcrumb(label);

    // Loading state
    mainContent.classList.add('loading');

    try {
        const res = await fetch(`/views/${viewName}.html?v=20260501`);
        if (!res.ok) throw new Error(`View not found: ${viewName}`);
        const html = await res.text();

        mainContent.innerHTML = html;

        // Re-execute <script> tags injected via innerHTML.
        // innerHTML does NOT run scripts — we must recreate each one.
        // External scripts (src) and inline scripts must be handled differently.
        // Run sequentially to preserve document order.
        const scripts = Array.from(mainContent.querySelectorAll('script'));

        for (const oldScript of scripts) {
            await new Promise((resolve) => {
                const newScript = document.createElement('script');

                Array.from(oldScript.attributes).forEach(attr => {
                    newScript.setAttribute(attr.name, attr.value);
                });

                if (oldScript.getAttribute('src')) {
                    // External script: wait for load. Do NOT set textContent
                    // — setting it (even empty) suppresses the src fetch.
                    // Append cache-buster so browser always fetches latest version.
                    const rawSrc = oldScript.getAttribute('src').split('?')[0];
                    newScript.setAttribute('src', rawSrc + '?v=' + Date.now());
                    newScript.onload  = resolve;
                    newScript.onerror = () => {
                        console.error('[Router] Failed to load script:', newScript.src);
                        resolve();
                    };
                } else {
                    // Inline script: copy content, resolve immediately after insert.
                    newScript.textContent = oldScript.textContent;
                    resolve();
                }

                oldScript.parentNode.replaceChild(newScript, oldScript);
            });
        }

    } catch (err) {
        mainContent.innerHTML = `
            <div class="flex flex-col items-center justify-center h-64 text-slate-400">
                <i class="fa-solid fa-circle-exclamation text-5xl mb-4 text-slate-300"></i>
                <p class="text-lg font-semibold text-slate-500">تعذّر تحميل الصفحة</p>
                <p class="text-sm mt-1">${err.message}</p>
                <button onclick="window.navigateTo('dashboard')"
                    class="mt-5 px-5 py-2 bg-brand-700 text-white rounded-lg text-sm hover:bg-brand-800 transition-colors">
                    العودة للوحة التحكم
                </button>
            </div>`;
    } finally {
        mainContent.classList.remove('loading');
    }
};

// =============================================================================
// initLayout()
// Entry point called by auth.js after a successful login or session restore.
// =============================================================================
window.initLayout = function () {
    _buildSidebar();
    _buildHeader();
    _initSidebarToggles();
};
