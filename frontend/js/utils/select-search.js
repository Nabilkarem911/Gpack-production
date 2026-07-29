'use strict';

// =============================================================================
// G.PACK 2.0 - makeSelectSearchable
// Wraps any native <select> with a searchable input + keyboard-navigable dropdown.
// Does NOT remove the original <select> from DOM (hides it with display:none).
// Fires the original onchange handler after selection.
//
// Usage:
//   const ss = window.makeSelectSearchable(document.getElementById('my-select'), {
//       placeholder: '🔍 ابحث...',
//       zIndex: 'z-[100]',
//   });
//   ss.refresh();   // call after updating <option> elements
//   ss.destroy();   // restores original <select>
// =============================================================================

(function () {

    function makeSelectSearchable(selectEl, opts) {
        if (!selectEl || selectEl.dataset.searchable === '1') return null;
        if (selectEl.disabled || selectEl.hidden || selectEl.style.display === 'none') return null;

        // Support both makeSelectSearchable(el, 'placeholder') and makeSelectSearchable(el, {placeholder: '...'})
        if (typeof opts === 'string') { opts = { placeholder: opts }; }
        opts = opts || {};
        selectEl.dataset.searchable = '1';

        var placeholder = opts.placeholder || '';
        var zClass = opts.zIndex || 'z-[100]';

        // If no explicit placeholder, use the first <option> text (the empty-value one)
        if (!placeholder) {
            var firstOpt = selectEl.options[0];
            if (firstOpt && !firstOpt.value) {
                placeholder = firstOpt.textContent;
            } else {
                placeholder = '🔍 بحث...';
            }
        }

        var parent = selectEl.parentElement;
        var wrap = document.createElement('div');
        wrap.className = 'searchable-wrap relative w-full';

        var input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder;
        input.autocomplete = 'off';

        // Give input an id so <label for="..."> can be retargeted
        if (selectEl.id) {
            input.id = selectEl.id + '_search';
            // Find and retarget associated labels
            var labels = document.querySelectorAll('label[for="' + selectEl.id + '"]');
            for (var li = 0; li < labels.length; li++) {
                labels[li].setAttribute('for', input.id);
            }
        }
        input.className = selectEl.className
            .replace('appearance-none', '')
            .replace(/\brow-product\b/g, '')
            .replace(/\brow-variant\b/g, '')
            .replace(/\brow-category\b/g, '')
            .replace(/\brow-design-select\b/g, '')
            .trim() + ' cursor-text';

        var dd = document.createElement('div');
        dd.className = 'searchable-dd absolute ' + zClass + ' left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg hidden';
        dd.style.direction = 'rtl';

        selectEl.style.display = 'none';
        parent.insertBefore(wrap, selectEl);
        wrap.appendChild(input);
        wrap.appendChild(dd);
        wrap.appendChild(selectEl);

        // Also hide the first empty-value <option> from the dropdown since its text
        // is now used as the input placeholder (avoids duplicate entry in the list)
        // — handled in _buildList by skipping empty-value options when no filter

        var _picking = false;
        var _activeIdx = -1;
        var _filteredOpts = [];

        function _selectOption(value, label) {
            _picking = true;
            selectEl.value = value;
            input.value = label;
            dd.classList.add('hidden');
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            setTimeout(function () { _picking = false; }, 0);
        }

        function _buildList(filter) {
            dd.innerHTML = '';
            var q = (filter || '').trim().toLowerCase();
            var opts = Array.from(selectEl.options);
            _filteredOpts = [];
            var hasMatch = false;

            opts.forEach(function (opt) {
                if (!opt.value && !q) {
                    var div0 = document.createElement('div');
                    div0.textContent = opt.textContent;
                    div0.className = 'px-3 py-2 text-sm text-slate-400 cursor-pointer hover:bg-slate-50';
                    div0.addEventListener('mousedown', function (e) { e.preventDefault(); });
                    div0.addEventListener('click', function () { _selectOption('', ''); });
                    dd.appendChild(div0);
                    _filteredOpts.push({ value: '', label: opt.textContent, el: div0 });
                    hasMatch = true;
                    return;
                }
                if (!opt.value) return;
                var text = opt.textContent;
                if (q && text.toLowerCase().indexOf(q) === -1) return;
                hasMatch = true;
                var div = document.createElement('div');
                div.textContent = text;
                div.className = 'px-3 py-2 text-sm text-slate-800 cursor-pointer hover:bg-brand-50 hover:text-brand-700 transition-colors';
                if (opt.value === selectEl.value) {
                    div.classList.add('bg-brand-50', 'font-bold', 'text-brand-700');
                }
                div.addEventListener('mousedown', function (e) { e.preventDefault(); });
                div.addEventListener('click', function () { _selectOption(opt.value, text); });
                div.addEventListener('mouseenter', function () {
                    var idx = Array.from(dd.children).indexOf(div);
                    if (idx >= 0) {
                        _activeIdx = idx;
                        _highlightActive();
                    }
                });
                dd.appendChild(div);
                _filteredOpts.push({ value: opt.value, label: text, el: div });
            });

            if (!hasMatch) {
                var empty = document.createElement('div');
                empty.textContent = 'لا توجد نتائج';
                empty.className = 'px-3 py-2 text-sm text-slate-400 text-center';
                dd.appendChild(empty);
            }
            _activeIdx = -1;
        }

        function _highlightActive() {
            var children = dd.children;
            for (var i = 0; i < children.length; i++) {
                if (i === _activeIdx) {
                    children[i].classList.add('bg-brand-100');
                    children[i].scrollIntoView({ block: 'nearest' });
                } else {
                    children[i].classList.remove('bg-brand-100');
                }
            }
        }

        function _syncDisplay() {
            var opt = selectEl.options[selectEl.selectedIndex];
            input.value = (opt && opt.value) ? opt.textContent : '';
        }

        // Focus → open dropdown
        input.addEventListener('focus', function () {
            input.select();
            _buildList('');
            dd.classList.remove('hidden');
        });

        // Input → filter
        input.addEventListener('input', function () {
            _buildList(input.value);
            dd.classList.remove('hidden');
        });

        // Blur → close (with delay for click)
        input.addEventListener('blur', function () {
            setTimeout(function () {
                if (!_picking) {
                    dd.classList.add('hidden');
                    _syncDisplay();
                }
            }, 200);
        });

        // Keyboard navigation
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                dd.classList.add('hidden');
                input.blur();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (dd.classList.contains('hidden')) {
                    _buildList('');
                    dd.classList.remove('hidden');
                    return;
                }
                _activeIdx = Math.min(_activeIdx + 1, _filteredOpts.length - 1);
                _highlightActive();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (_activeIdx > 0) {
                    _activeIdx--;
                    _highlightActive();
                }
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                if (_activeIdx >= 0 && _filteredOpts[_activeIdx]) {
                    _selectOption(_filteredOpts[_activeIdx].value, _filteredOpts[_activeIdx].label);
                }
                return;
            }
        });

        _syncDisplay();

        // Watch for dynamic option changes
        var obs = new MutationObserver(function () {
            setTimeout(_syncDisplay, 0);
        });
        obs.observe(selectEl, { childList: true, subtree: true });

        return {
            refresh: function () { _syncDisplay(); },
            destroy: function () {
                obs.disconnect();
                selectEl.style.display = '';
                selectEl.dataset.searchable = '';
                if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
            },
            input: input,
        };
    }

    window.makeSelectSearchable = makeSelectSearchable;

})();
