'use strict';

// =============================================================================
// G.PACK 2.0 — Dashboard View
// Loads real-time statistics and displays them on the dashboard
// =============================================================================

const dashboardView = {
    
    // ─────────────────────────────────────────────────────────────────────────
    // Initialize Dashboard
    // ─────────────────────────────────────────────────────────────────────────
    async _init() {
        console.log('[Dashboard] Initializing view...');
        await this._loadDashboardStats();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Load Dashboard Statistics from API
    // ─────────────────────────────────────────────────────────────────────────
    async _loadDashboardStats() {
        try {
            const response = await apiFetch('/api/dashboard/stats');
            const data = response.data || {};
            
            // Update KPI Cards
            this._updateStat('stat-quotations', data.quotations_count || 0);
            this._updateStat('stat-orders', data.orders_count || 0);
            this._updateStat('stat-revenue', this._formatCurrency(data.total_revenue || 0));
            this._updateStat('stat-receivables', this._formatCurrency(data.outstanding_receivables || 0));
            
            console.log('[Dashboard] Stats loaded successfully');
        } catch (error) {
            console.error('[Dashboard] Failed to load stats:', error);
            // Keep showing 0 values on error - better than showing fake data
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Update a Stat Element
    // ─────────────────────────────────────────────────────────────────────────
    _updateStat(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = value;
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Format Currency (Arabic locale)
    // ─────────────────────────────────────────────────────────────────────────
    _formatCurrency(amount) {
        const num = parseFloat(amount || 0);
        
        // Format large numbers
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'م'; // Million
        } else if (num >= 1000) {
            return (num / 1000).toFixed(0) + 'K'; // Thousand
        }

        return num.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        });
    }
};

// Export for use in app.js routing
window.dashboardView = dashboardView;
