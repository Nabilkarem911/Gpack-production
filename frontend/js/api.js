'use strict';

// =============================================================================
// G.PACK 2.0 - Centralized API Layer (api.js)
// All backend communication goes through apiFetch().
// Automatically attaches JWT, handles 401, and parses JSON responses.
// =============================================================================

var API_BASE = '/api'; // var allows re-declaration if script loads more than once in SPA

// Global permissions object — populated by auth.js after login.
// Modules check window.GpackPerms to gate UI elements.
window.GpackPerms = {};

// Current authenticated user — populated by auth.js after login.
window.GpackUser = null;

// =============================================================================
// showToast(message, type)
// Renders a self-dismissing toast notification.
// type: 'success' | 'error' | 'warning' | 'info'
// =============================================================================
window.showToast = function (message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const colors = {
        success: 'bg-emerald-600',
        error:   'bg-red-600',
        warning: 'bg-amber-500',
        info:    'bg-brand-600',
    };

    const icons = {
        success: 'fa-circle-check',
        error:   'fa-circle-xmark',
        warning: 'fa-triangle-exclamation',
        info:    'fa-circle-info',
    };

    const toast = document.createElement('div');
    toast.className = `flex items-center gap-3 px-4 py-3 rounded-xl text-white text-sm font-medium shadow-lg max-w-sm
        ${colors[type] || colors.info} transform translate-x-0 transition-all duration-300`;

    toast.innerHTML = `
        <i class="fa-solid ${icons[type] || icons.info} text-base flex-shrink-0"></i>
        <span class="flex-1">${message}</span>
        <button onclick="this.parentElement.remove()" class="opacity-70 hover:opacity-100 transition-opacity flex-shrink-0">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(2rem)';
        setTimeout(() => toast.remove(), 300);
    }, 4500);
};

// =============================================================================
// showLoginView() / showAppLayout()
// Called by the auth layer to switch between login and app shell.
// =============================================================================
window.showLoginView = function () {
    const loginView  = document.getElementById('login-view');
    const appLayout  = document.getElementById('app-layout');
    if (loginView)  loginView.classList.remove('hidden');
    if (appLayout)  appLayout.classList.add('hidden');
};

window.showAppLayout = function () {
    const loginView  = document.getElementById('login-view');
    const appLayout  = document.getElementById('app-layout');
    if (loginView)  loginView.classList.add('hidden');
    if (appLayout)  appLayout.classList.remove('hidden');
};

// =============================================================================
// apiFetch(endpoint, options)
// The single gateway for all HTTP calls to the G.PACK backend.
//
// @param {string} endpoint  - e.g. '/api/auth/login' or '/clients'
//                             If it doesn't start with '/api', '/api' is prepended.
// @param {object} options   - Standard fetch() options (method, body, headers, etc.)
// @returns {Promise<any>}   - Parsed JSON response body.
// @throws {Error}           - With a user-friendly Arabic message on failure.
// =============================================================================
window.apiFetch = async function (endpoint, options = {}) {
    // Normalise the URL
    const url = endpoint.startsWith('/api') ? endpoint : `${API_BASE}${endpoint}`;

    // Build headers
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
    };

    const token = localStorage.getItem('gpack_token');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    let response;
    try {
        response = await fetch(url, {
            ...options,
            headers,
            body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
        });
    } catch (networkErr) {
        console.error('[API] Network error:', networkErr);
        throw new Error('تعذّر الاتصال بالخادم. يرجى التحقق من الاتصال بالإنترنت.');
    }

    // 401 — session expired or invalid token
    if (response.status === 401) {
        localStorage.removeItem('gpack_token');
        localStorage.removeItem('gpack_user');
        window.GpackUser    = null;
        window.GpackPerms   = {};
        window.showLoginView();
        window.showToast('انتهت جلستك. يرجى تسجيل الدخول مجدداً.', 'warning');
        throw new Error('Unauthorized');
    }

    // Parse JSON (even on error responses to extract message)
    let data;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        data = await response.json();
    } else {
        data = await response.text();
    }

    // Non-2xx responses
    if (!response.ok) {
        const message = (data && data.error) ? data.error : `خطأ في الخادم (${response.status})`;
        throw new Error(message);
    }

    return data;
};
