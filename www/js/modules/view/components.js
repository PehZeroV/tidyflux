import { createDialog } from './utils.js';
import { i18n } from '../i18n.js';

/**
 * Custom Modal Dialogs replacing native alert/confirm/prompt
 */
export class Modal {
    /**
     * Show an alert dialog
     * @param {string} message 
     * @param {string} [title] 
     * @returns {Promise<void>}
     */
    /**
     * Internal common dialog renderer
     * @private
     */
    static _renderDialog({ title, body, footer, onReady }) {
        return new Promise((resolve) => {
            const { dialog, close } = createDialog('custom-modal-dialog', `
                <div class="custom-modal-content">
                    ${title ? `<div class="custom-modal-header">${title}</div>` : ''}
                    <div class="custom-modal-body">${body}</div>
                    <div class="custom-modal-footer">${footer}</div>
                </div>
            `);

            const finalize = (result) => {
                close();
                resolve(result);
            };

            if (onReady) onReady(dialog, finalize);
        });
    }

    /**
     * Show an alert dialog
     */
    static alert(message, title = '') {
        return this._renderDialog({
            title,
            body: `<p>${message}</p>`,
            footer: `<button class="appearance-mode-btn active ok-btn padded">${i18n.t('common.ok') || 'OK'}</button>`,
            onReady: (dialog, finalize) => {
                const okBtn = dialog.querySelector('.ok-btn');
                okBtn.addEventListener('click', () => finalize());

                const keyHandler = (e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') {
                        finalize();
                        document.removeEventListener('keydown', keyHandler);
                    }
                };
                document.addEventListener('keydown', keyHandler);
            }
        });
    }

    /**
     * Show an alert dialog with a "Go to Settings" button
     */
    static alertWithSettings(message, settingsLabel, onSettings, title = '') {
        return this._renderDialog({
            title,
            body: `<p>${message}</p>`,
            footer: `
                <button class="appearance-mode-btn settings-btn m-right-8">${settingsLabel}</button>
                <button class="appearance-mode-btn active ok-btn padded">${i18n.t('common.ok') || 'OK'}</button>
            `,
            onReady: (dialog, finalize) => {
                const okBtn = dialog.querySelector('.ok-btn');
                const settingsBtn = dialog.querySelector('.settings-btn');

                okBtn.addEventListener('click', () => finalize());
                settingsBtn.addEventListener('click', () => {
                    finalize();
                    if (onSettings) onSettings();
                });

                const keyHandler = (e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') {
                        finalize();
                        document.removeEventListener('keydown', keyHandler);
                    }
                };
                document.addEventListener('keydown', keyHandler);
            }
        });
    }

    /**
     * Show a confirm dialog
     */
    static confirm(message, title = '') {
        return this._renderDialog({
            title,
            body: `<p>${message}</p>`,
            footer: `
                <button class="appearance-mode-btn cancel-btn">${i18n.t('common.cancel') || 'Cancel'}</button>
                <button class="appearance-mode-btn active confirm-btn btn-danger">${i18n.t('common.confirm') || 'Confirm'}</button>
            `,
            onReady: (dialog, finalize) => {
                const confirmBtn = dialog.querySelector('.confirm-btn');
                const cancelBtn = dialog.querySelector('.cancel-btn');

                confirmBtn.addEventListener('click', () => finalize(true));
                cancelBtn.addEventListener('click', () => finalize(false));

                const keyHandler = (e) => {
                    if (e.key === 'Escape') {
                        finalize(false);
                        document.removeEventListener('keydown', keyHandler);
                    } else if (e.key === 'Enter') {
                        finalize(true);
                        document.removeEventListener('keydown', keyHandler);
                    }
                };
                document.addEventListener('keydown', keyHandler);

                dialog.addEventListener('click', (e) => {
                    if (e.target === dialog) finalize(false);
                });
            }
        });
    }

    /**
     * Show a prompt dialog
     */
    static prompt(message, defaultValue = '', title = '') {
        return this._renderDialog({
            title,
            body: `
                <p>${message}</p>
                <input type="text" class="custom-modal-input" value="${defaultValue}" />
            `,
            footer: `
                <button class="appearance-mode-btn cancel-btn">${i18n.t('common.cancel') || 'Cancel'}</button>
                <button class="appearance-mode-btn active confirm-btn btn-danger">${i18n.t('common.confirm') || 'OK'}</button>
            `,
            onReady: (dialog, finalize) => {
                const input = dialog.querySelector('input');
                const confirmBtn = dialog.querySelector('.confirm-btn');
                const cancelBtn = dialog.querySelector('.cancel-btn');

                input.select();
                input.focus();

                confirmBtn.addEventListener('click', () => finalize(input.value));
                cancelBtn.addEventListener('click', () => finalize(null));

                dialog.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') finalize(input.value);
                });

                const escHandler = (e) => {
                    if (e.key === 'Escape') {
                        finalize(null);
                        document.removeEventListener('keydown', escHandler);
                    }
                };
                document.addEventListener('keydown', escHandler);

                dialog.addEventListener('click', (e) => {
                    if (e.target === dialog) finalize(null);
                });
            }
        });
    }
}

/**
 * Custom Select Component
 */
export class CustomSelect {
    /**
     * @param {HTMLSelectElement} selectElement 
     */
    constructor(selectElement) {
        if (!selectElement || selectElement.tagName !== 'SELECT') return;
        if (selectElement.dataset.customSelectInitialized) return;

        this.nativeSelect = selectElement;
        this.init();
    }

    init() {
        // Create Wrapper
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'custom-select-wrapper';
        this.nativeSelect.parentNode.insertBefore(this.wrapper, this.nativeSelect);
        this.wrapper.appendChild(this.nativeSelect);
        // Create Trigger
        this.trigger = document.createElement('div');
        this.trigger.className = 'custom-select-trigger';
        // Add tabindex for keyboard focus
        this.trigger.setAttribute('tabindex', '0');
        this.wrapper.appendChild(this.trigger);
        // Create Options List - appended to body for fixed positioning
        this.optionsList = document.createElement('div');
        this.optionsList.className = 'custom-select-options';
        document.body.appendChild(this.optionsList);

        // Event Delegation for options
        this.optionsList.addEventListener('click', (e) => {
            const optionEl = e.target.closest('.custom-select-option');
            if (optionEl) {
                e.stopPropagation();
                // Ensure the value exists in dataset
                if ('value' in optionEl.dataset) {
                    this.select(optionEl.dataset.value);
                }
            }
        });

        // Populate
        this.refresh();

        // Bind Events
        this.nativeSelect.addEventListener('change', () => this.refreshTrigger());


        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent closing immediately
            this.toggle();
        });

        this.trigger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggle();
            }
        });

        // Close when clicking outside
        this.clickOutsideHandler = (e) => {
            if (!this.wrapper.contains(e.target) && !this.optionsList.contains(e.target)) {
                this.close();
            }
        };
        document.addEventListener('click', this.clickOutsideHandler);

        // Reposition on scroll/resize
        this._scrollHandler = () => {
            if (this.wrapper.classList.contains('open')) {
                this._positionOptions();
            }
        };
        this._resizeHandler = this._scrollHandler;

        this.nativeSelect.dataset.customSelectInitialized = 'true';

        // Store reference on wrapper for external access
        this.wrapper._customSelect = this;

        // Auto-cleanup when wrapper is removed from DOM (e.g., dialog close)
        this._mutationObserver = new MutationObserver(() => {
            if (!document.body.contains(this.wrapper)) {
                this.destroy();
            }
        });
        this._mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    /**
     * Clean up all event listeners and remove orphaned DOM elements
     */
    destroy() {
        this.close();
        if (this.optionsList && this.optionsList.parentNode) {
            this.optionsList.remove();
        }
        document.removeEventListener('click', this.clickOutsideHandler);
        if (this._mutationObserver) {
            this._mutationObserver.disconnect();
            this._mutationObserver = null;
        }
    }

    refresh() {
        // Clear options
        this.optionsList.innerHTML = '';

        const renderOption = (opt) => {
            const el = document.createElement('div');
            el.className = 'custom-select-option';
            if (opt.selected) el.classList.add('selected');
            el.textContent = opt.textContent;
            el.dataset.value = opt.value;
            this.optionsList.appendChild(el);
        };

        // Walk through top-level children to preserve optgroup structure
        Array.from(this.nativeSelect.children).forEach(child => {
            if (child.tagName === 'OPTGROUP') {
                const label = document.createElement('div');
                label.className = 'custom-select-group-label';
                label.textContent = child.label;
                this.optionsList.appendChild(label);
                Array.from(child.children).forEach(opt => renderOption(opt));
            } else if (child.tagName === 'OPTION') {
                renderOption(child);
            }
        });

        this.refreshTrigger();
    }

    refreshTrigger() {
        const selected = this.nativeSelect.options[this.nativeSelect.selectedIndex];
        const text = selected ? selected.textContent : '';
        this.trigger.innerHTML = `
            <span>${text}</span>
            <div class="custom-select-arrow"></div>
        `;

        // Update selection in options list
        const optionEls = this.optionsList.querySelectorAll('.custom-select-option');
        optionEls.forEach(el => {
            if (el.dataset.value === (selected ? selected.value : '')) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        });
    }

    select(value) {
        this.nativeSelect.value = value;
        this.nativeSelect.dispatchEvent(new Event('change'));
        this.close();
    }

    toggle() {
        if (this.wrapper.classList.contains('open')) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        // Close other custom selects efficiently
        if (CustomSelect.activeInstance && CustomSelect.activeInstance !== this) {
            CustomSelect.activeInstance.close();
        }
        CustomSelect.activeInstance = this;

        this.wrapper.classList.add('open');
        this.trigger.classList.add('open');
        this.optionsList.classList.add('custom-select-options-visible');
        this._positionOptions();

        // Listen for scroll on all ancestors and window resize
        window.addEventListener('resize', this._resizeHandler);
        this._scrollAncestors = [];
        let el = this.wrapper.parentElement;
        while (el) {
            el.addEventListener('scroll', this._scrollHandler, { passive: true });
            this._scrollAncestors.push(el);
            el = el.parentElement;
        }
    }

    close() {
        this.wrapper.classList.remove('open');
        this.trigger.classList.remove('open');
        this.optionsList.classList.remove('custom-select-options-visible');
        if (CustomSelect.activeInstance === this) {
            CustomSelect.activeInstance = null;
        }

        // Remove scroll/resize listeners
        window.removeEventListener('resize', this._resizeHandler);
        if (this._scrollAncestors) {
            this._scrollAncestors.forEach(el => {
                el.removeEventListener('scroll', this._scrollHandler);
            });
            this._scrollAncestors = null;
        }
    }

    /**
     * Position the options list using fixed positioning relative to the trigger
     */
    _positionOptions() {
        const triggerRect = this.trigger.getBoundingClientRect();
        const optsList = this.optionsList;

        // Temporarily make visible for measurement
        optsList.style.position = 'fixed';
        optsList.style.left = `${triggerRect.left}px`;
        optsList.style.width = `${triggerRect.width}px`;

        // Measure dropdown height
        const optsHeight = optsList.scrollHeight;
        const maxH = Math.min(400, window.innerHeight * 0.4);
        const actualHeight = Math.min(optsHeight, maxH);

        // Check if there's enough space below, otherwise open upward
        const spaceBelow = window.innerHeight - triggerRect.bottom - 10;
        const spaceAbove = triggerRect.top - 10;

        if (spaceBelow >= actualHeight || spaceBelow >= spaceAbove) {
            // Open downward
            optsList.style.top = `${triggerRect.bottom + 6}px`;
            optsList.style.bottom = 'auto';
            optsList.style.maxHeight = `${Math.min(maxH, spaceBelow)}px`;
        } else {
            // Open upward
            optsList.style.top = 'auto';
            optsList.style.bottom = `${window.innerHeight - triggerRect.top + 6}px`;
            optsList.style.maxHeight = `${Math.min(maxH, spaceAbove)}px`;
        }
    }

    /**
     * Replace all selects in a container
     * @param {HTMLElement} container 
     */
    static replaceAll(container) {
        const selects = container.querySelectorAll('select');
        selects.forEach(s => new CustomSelect(s));
    }
}
