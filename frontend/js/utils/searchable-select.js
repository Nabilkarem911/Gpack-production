'use strict';

// =============================================================================
// G.PACK 2.0 - SearchableSelect
// Reusable vanilla-JS dropdown with built-in search/filter.
// Works in RTL Arabic layouts. No dependencies.
//
// Usage:
//   const ss = new window.SearchableSelect(document.getElementById('my-container'), {
//       placeholder: '— اختر —',
//       searchPlaceholder: 'بحث...',
//       emptyText: 'لا توجد نتائج',
//       iconClass: 'fa-solid fa-ruler',
//   });
//   ss.setData([{ value: '1', label: 'كيلوجرام (كجم)' }, ...]);
//   ss.value = '1';        // set selected
//   const v = ss.value;    // get selected
//   ss.clear();            // reset to placeholder
// =============================================================================

(function () {

    class SearchableSelect {

        constructor(container, opts = {}) {
            this.container = container;
            this.items       = [];
            this._value      = '';
            this._label      = '';
            this.isOpen      = false;
            this.opts = {
                placeholder:      opts.placeholder      || '— اختر —',
                searchPlaceholder: opts.searchPlaceholder || 'بحث...',
                emptyText:        opts.emptyText        || 'لا توجد نتائج',
                iconClass:        opts.iconClass        || '',
                onChange:         opts.onChange         || null,
            };

            this._build();
            this._bind();
        }

        // ── Build DOM ──────────────────────────────────────────────────────────
        _build() {
            this.container.innerHTML = '';
            this.container.classList.add('relative');
            this.container.style.cursor = 'pointer';

            // Trigger button (looks like the existing select)
            this.trigger = document.createElement('div');
            this.trigger.className = 'w-full flex items-center gap-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 outline-none transition-all select-none';
            this.trigger.style.minHeight = '48px';

            // Icon
            if (this.opts.iconClass) {
                const icon = document.createElement('i');
                icon.className = this.opts.iconClass + ' text-sm text-slate-400';
                this.trigger.appendChild(icon);
            }

            // Label span
            this.labelSpan = document.createElement('span');
            this.labelSpan.className = 'flex-1 truncate';
            this.labelSpan.textContent = this.opts.placeholder;
            this.labelSpan.style.color = '#94a3b8'; // slate-400 placeholder color
            this.trigger.appendChild(this.labelSpan);

            // Chevron
            this.chevron = document.createElement('i');
            this.chevron.className = 'fa-solid fa-chevron-down text-xs text-slate-400 transition-transform duration-200';
            this.trigger.appendChild(this.chevron);

            this.container.appendChild(this.trigger);

            // Dropdown panel (hidden by default)
            this.dropdown = document.createElement('div');
            this.dropdown.className = 'absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden hidden';

            // Search input wrapper
            const searchWrapper = document.createElement('div');
            searchWrapper.className = 'p-2 border-b border-slate-100';

            this.searchInput = document.createElement('input');
            this.searchInput.type = 'text';
            this.searchInput.placeholder = this.opts.searchPlaceholder;
            this.searchInput.className = 'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition-all';
            searchWrapper.appendChild(this.searchInput);

            this.dropdown.appendChild(searchWrapper);

            // Options list container
            this.listContainer = document.createElement('div');
            this.listContainer.className = 'max-h-52 overflow-y-auto py-1';
            this.dropdown.appendChild(this.listContainer);

            this.container.appendChild(this.dropdown);

            // Focus / blur visual states
            this.trigger.addEventListener('mouseenter', () => {
                if (!this.isOpen) {
                    this.trigger.style.borderColor = '#e2e8f0';
                    this.trigger.style.backgroundColor = '#f8fafc';
                }
            });
        }

        // ── Bind events ────────────────────────────────────────────────────────
        _bind() {
            // Toggle on trigger click
            this.trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggle();
            });

            // Filter on input
            this.searchInput.addEventListener('input', () => {
                this._renderList(this.searchInput.value.trim().toLowerCase());
            });

            // Prevent dropdown close when clicking inside search
            this.searchInput.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // Close on outside click
            document.addEventListener('click', (e) => {
                if (this.isOpen && !this.container.contains(e.target)) {
                    this.close();
                }
            });

            // Keyboard: Escape closes
            this.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.close();
                    this.trigger.focus();
                }
            });
        }

        // ── Render the filtered list ───────────────────────────────────────────
        _renderList(query) {
            this.listContainer.innerHTML = '';

            let filtered = this.items;
            if (query) {
                filtered = this.items.filter(item =>
                    item.label.toLowerCase().includes(query)
                );
            }

            if (filtered.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'px-4 py-3 text-sm text-slate-400 text-center';
                empty.textContent = this.opts.emptyText;
                this.listContainer.appendChild(empty);
                return;
            }

            filtered.forEach(item => {
                const opt = document.createElement('div');
                opt.className = 'px-4 py-2.5 text-sm cursor-pointer transition-colors flex items-center gap-2';
                if (item.value === this._value) {
                    opt.classList.add('bg-brand-50', 'text-brand-700', 'font-semibold');
                } else {
                    opt.classList.add('text-slate-700', 'hover:bg-slate-50');
                }

                const span = document.createElement('span');
                span.className = 'flex-1 truncate';
                span.textContent = item.label;
                opt.appendChild(span);

                if (item.value === this._value) {
                    const check = document.createElement('i');
                    check.className = 'fa-solid fa-check text-xs text-brand-600';
                    opt.appendChild(check);
                }

                opt.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.select(item.value);
                    this.close();
                });

                this.listContainer.appendChild(opt);
            });
        }

        // ── Public API ─────────────────────────────────────────────────────────

        setData(items) {
            this.items = (items || []).map(it => ({
                value: String(it.value),
                label: it.label,
            }));
            // Refresh label if a value was already selected
            if (this._value) {
                const found = this.items.find(i => i.value === this._value);
                if (found) {
                    this._label = found.label;
                    this._updateDisplay();
                }
            }
            if (this.isOpen) this._renderList(this.searchInput.value.trim().toLowerCase());
        }

        select(value) {
            const v = String(value || '');
            this._value = v;
            const found = this.items.find(i => i.value === v);
            this._label = found ? found.label : '';
            this._updateDisplay();
            if (typeof this.opts.onChange === 'function') {
                this.opts.onChange(v);
            }
        }

        get value() {
            return this._value;
        }

        set value(val) {
            this.select(val);
        }

        clear() {
            this._value = '';
            this._label = '';
            this._updateDisplay();
        }

        // ── Internal helpers ───────────────────────────────────────────────────

        _updateDisplay() {
            if (this._label) {
                this.labelSpan.textContent = this._label;
                this.labelSpan.style.color = '#1e293b'; // slate-800
            } else {
                this.labelSpan.textContent = this.opts.placeholder;
                this.labelSpan.style.color = '#94a3b8'; // slate-400
            }
        }

        open() {
            if (this.isOpen) return;
            this.isOpen = true;
            this.dropdown.classList.remove('hidden');
            this.chevron.style.transform = 'rotate(180deg)';
            this.trigger.style.borderColor = '#4f46e5'; // brand-500
            this.trigger.style.backgroundColor = '#ffffff';
            this.searchInput.value = '';
            this._renderList('');
            setTimeout(() => this.searchInput.focus(), 50);
        }

        close() {
            if (!this.isOpen) return;
            this.isOpen = false;
            this.dropdown.classList.add('hidden');
            this.chevron.style.transform = '';
            this.trigger.style.borderColor = '';
            this.trigger.style.backgroundColor = '';
        }

        toggle() {
            if (this.isOpen) this.close();
            else this.open();
        }
    }

    // Expose globally
    window.SearchableSelect = SearchableSelect;

})();
