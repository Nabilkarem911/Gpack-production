'use strict';

// =============================================================================
// G.PACK 2.0 - Application Bootstrap (app.js)
// This is the last script loaded by index.html.
// It is the single entry point that kicks off the entire application.
// Depends on: api.js, auth.js, layout.js (all already loaded and executed)
// =============================================================================

// Public views that don't require authentication (attached to window to avoid redeclaration)
window.PUBLIC_VIEWS = window.PUBLIC_VIEWS || ['public-client-statement', 'public-invoice'];

function _isPublicRoute() {
    const hash = window.location.hash || '';
    return window.PUBLIC_VIEWS.some(view => hash.replace('#/', '').startsWith(view));
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[G.PACK 2.0] Application initializing...');

    // Check if this is a public route (no auth required)
    if (_isPublicRoute()) {
        console.log('[G.PACK 2.0] Public route detected — skipping auth');
        // Show app layout but hide sidebar for public pages
        const layout = document.getElementById('app-layout');
        const login = document.getElementById('login-view');
        const sidebar = document.getElementById('sidebar');
        
        if (login) login.classList.add('hidden');
        if (layout) layout.classList.remove('hidden'); // Show layout
        if (sidebar) sidebar.classList.add('hidden'); // Hide sidebar only
        
        // Adjust main-content to be full width
        const main = document.getElementById('main-content');
        if (main) {
            main.style.marginRight = '0';
            main.style.width = '100%';
        }
        
        // Extract view name from hash and navigate
        const hash = window.location.hash;
        const viewMatch = hash.replace('#/', '').split('?')[0];
        if (viewMatch && typeof window.navigateTo === 'function') {
            await window.navigateTo(viewMatch);
        }
        console.log('[G.PACK 2.0] Public page loaded.');
        return;
    }

    // Kick off the authentication check for protected routes
    // initAuth() will either restore an existing session or render the login view.
    if (typeof window.initAuth === 'function') {
        await window.initAuth();
    } else {
        console.error('[App] initAuth() not found. Ensure auth.js is loaded before app.js.');
    }

    console.log('[G.PACK 2.0] Bootstrap complete.');
});
