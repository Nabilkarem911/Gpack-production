'use strict';

// =============================================================================
// G.PACK 2.0 - Authentication Module (auth.js)
// Handles login form submission, session restoration, and logout.
// Depends on: api.js (apiFetch, showLoginView, showAppLayout, GpackUser, GpackPerms)
// =============================================================================

// =============================================================================
// _applySession(user)
// Hydrates global state from a user object (login or stored session).
// =============================================================================
function _applySession(user) {
    window.GpackUser  = user;
    window.GpackPerms = user.permissions || {};
}

// =============================================================================
// _renderLoginView()
// Fetches the login HTML fragment and injects it into #login-view.
// Then wires up the form submit handler.
// =============================================================================
async function _renderLoginView() {
    const container = document.getElementById('login-view');
    if (!container) return;

    try {
        const res = await fetch('/views/login.html');
        const html = await res.text();
        container.innerHTML = html;
        container.classList.remove('hidden');
    } catch (e) {
        container.innerHTML = '<p class="text-red-500 text-center p-8">تعذّر تحميل صفحة تسجيل الدخول.</p>';
        container.classList.remove('hidden');
    }

    // Wire up the login form
    const form = document.getElementById('login-form');
    if (!form) return;

    form.addEventListener('submit', _handleLoginSubmit);
}

// =============================================================================
// _handleLoginSubmit(event)
// Validates fields, calls the API, stores session on success.
// =============================================================================
async function _handleLoginSubmit(event) {
    event.preventDefault();

    const emailInput    = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const submitBtn     = document.getElementById('login-submit-btn');
    const errorBox      = document.getElementById('login-error');

    const email    = (emailInput?.value || '').trim();
    const password = (passwordInput?.value || '').trim();

    // Clear previous error
    if (errorBox) {
        errorBox.textContent = '';
        errorBox.classList.add('hidden');
    }

    if (!email || !password) {
        _showLoginError('يرجى إدخال البريد الإلكتروني وكلمة المرور.');
        return;
    }

    // Loading state
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin ml-2"></i> جارٍ تسجيل الدخول...';
    }

    try {
        const data = await window.apiFetch('/api/auth/login', {
            method: 'POST',
            body: { email, password },
        });

        // Persist session
        localStorage.setItem('gpack_token', data.token);
        localStorage.setItem('gpack_user', JSON.stringify(data.user));

        // Hydrate globals
        _applySession(data.user);

        // Transition to app layout
        window.showAppLayout();

        // Initialise layout (sidebar, header, router)
        if (typeof window.initLayout === 'function') {
            window.initLayout();
        }

        // Navigate to dashboard
        if (typeof window.navigateTo === 'function') {
            window.navigateTo('dashboard');
        }

        window.showToast(`مرحباً، ${data.user.name} 👋`, 'success');

    } catch (err) {
        _showLoginError(err.message || 'فشل تسجيل الدخول. يرجى المحاولة مرة أخرى.');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket ml-2"></i> تسجيل الدخول';
        }
    }
}

// =============================================================================
// _showLoginError(message)
// Displays an inline error message inside the login form.
// =============================================================================
function _showLoginError(message) {
    const errorBox = document.getElementById('login-error');
    if (errorBox) {
        errorBox.textContent = message;
        errorBox.classList.remove('hidden');
    }
}

// =============================================================================
// logout()
// Clears session storage, resets globals, and shows login view.
// Exported to window so layout.js can call it from the sidebar button.
// =============================================================================
window.logout = function () {
    // Fire-and-forget — stateless JWT, no server round-trip needed
    const token = localStorage.getItem('gpack_token');
    if (token) {
        window.apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    }

    localStorage.removeItem('gpack_token');
    localStorage.removeItem('gpack_user');
    window.GpackUser  = null;
    window.GpackPerms = {};

    // Reset sidebar active state
    document.querySelectorAll('.nav-item.active').forEach(el => el.classList.remove('active'));

    window.showLoginView();
    _renderLoginView();
    window.showToast('تم تسجيل الخروج بنجاح.', 'info');
};

// =============================================================================
// initAuth()
// Entry point called by app.js on page load.
// Checks for an existing stored session and restores it, or shows login.
// =============================================================================
window.initAuth = async function () {
    const token     = localStorage.getItem('gpack_token');
    const userStr   = localStorage.getItem('gpack_user');

    if (token && userStr) {
        try {
            // Validate the token is still accepted by the server
            const data = await window.apiFetch('/api/auth/me');
            _applySession(data.user);

            // Update stored user in case permissions changed
            localStorage.setItem('gpack_user', JSON.stringify(data.user));

            window.showAppLayout();

            if (typeof window.initLayout === 'function') {
                window.initLayout();
            }
            if (typeof window.navigateTo === 'function') {
                window.navigateTo('dashboard');
            }
        } catch (err) {
            // Token invalid/expired — clear and show login
            localStorage.removeItem('gpack_token');
            localStorage.removeItem('gpack_user');
            window.showLoginView();
            await _renderLoginView();
        }
    } else {
        window.showLoginView();
        await _renderLoginView();
    }
};
