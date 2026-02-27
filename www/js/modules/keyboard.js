/**
 * Keyboard Shortcuts Module - Tidyflux
 * @module keyboard
 * 
 * Customizable keyboard shortcuts with Miniflux-compatible defaults.
 * Users can remap any shortcut via the settings dialog.
 * 
 * Default shortcuts (following Miniflux conventions):
 * 
 *   List view:
 *     j / ↓    - Next article
 *     k / ↑    - Previous article
 *     o / Enter - Open selected article
 *     /        - Search
 *     r        - Refresh list
 *     a        - Add feed
 *
 *   Reading view:
 *     Space        - Scroll down / Next article
 *     Shift+Space  - Scroll up / Previous article
 *     n        - Next article
 *     p        - Previous article
 *     f        - Toggle star / favorite
 *     m        - Toggle read / unread
 *     v        - Open original in new tab
 *     d        - Fetch original content
 *     s        - Save to third-party service
 *     t        - Translate article
 *     g        - Summarize article
 *     Escape   - Go back to list
 *
 *   Global:
 *     ?        - Show shortcuts help
 */

import { DOMElements } from '../dom.js';
import { AppState } from '../state.js';
import { ArticlesView } from './view/articles-view.js';
import { FeedManager } from './feed-manager.js';
import { createDialog } from './view/utils.js';
import { i18n } from './i18n.js';

const CLASS_ARTICLE_VIEW_ACTIVE = 'article-view-active';

/**
 * Storage key for custom shortcuts
 */
const STORAGE_KEY = 'tidyflux_keyboard_shortcuts';

/**
 * Default shortcut mapping: action → key(s)
 * Each action maps to an array of accepted keys.
 * The first key in the array is the "primary" (displayed in help).
 */
const DEFAULT_SHORTCUTS = {
    // List view
    nextItem: ['j'],
    prevItem: ['k'],
    openItem: ['o', 'Enter'],
    search: ['/'],
    refresh: ['r'],
    addFeed: ['a'],

    // Reading view
    scrollDown: [' '],
    scrollUp: ['Shift+ '],
    nextArticle: ['n'],
    prevArticle: ['p'],
    toggleStar: ['f'],
    toggleRead: ['m'],
    openOriginal: ['v'],
    fetchContent: ['d'],
    saveThirdParty: ['s'],
    translateArticle: ['t'],
    summarizeArticle: ['g'],
    aiChat: ['c'],
    goBack: ['Escape'],

    // Global
    showHelp: ['?'],
};

/**
 * Action metadata: labels for i18n
 * Grouped by context for display in help and settings
 */
const ACTION_META = {
    nextItem: { group: 'list', i18nKey: 'keyboard.next_item' },
    prevItem: { group: 'list', i18nKey: 'keyboard.prev_item' },
    openItem: { group: 'list', i18nKey: 'keyboard.open_item' },
    search: { group: 'list', i18nKey: 'keyboard.search' },
    refresh: { group: 'list', i18nKey: 'keyboard.refresh' },
    addFeed: { group: 'list', i18nKey: 'keyboard.add_feed' },

    scrollDown: { group: 'reading', i18nKey: 'keyboard.scroll_down' },
    scrollUp: { group: 'reading', i18nKey: 'keyboard.scroll_up' },
    nextArticle: { group: 'reading', i18nKey: 'keyboard.next_article' },
    prevArticle: { group: 'reading', i18nKey: 'keyboard.prev_article' },
    toggleStar: { group: 'reading', i18nKey: 'keyboard.toggle_star' },
    toggleRead: { group: 'reading', i18nKey: 'keyboard.toggle_read' },
    openOriginal: { group: 'reading', i18nKey: 'keyboard.open_original' },
    fetchContent: { group: 'reading', i18nKey: 'keyboard.fetch_content' },
    saveThirdParty: { group: 'reading', i18nKey: 'keyboard.save_third_party' },
    translateArticle: { group: 'reading', i18nKey: 'keyboard.translate_article' },
    summarizeArticle: { group: 'reading', i18nKey: 'keyboard.summarize_article' },
    aiChat: { group: 'reading', i18nKey: 'keyboard.ai_chat' },
    goBack: { group: 'reading', i18nKey: 'keyboard.go_back' },

    showHelp: { group: 'global', i18nKey: 'keyboard.show_help' },
};

const GROUP_I18N_KEYS = {
    list: 'keyboard.group_list',
    reading: 'keyboard.group_reading',
    global: 'keyboard.group_global',
};

/**
 * Keyboard Shortcuts Manager
 */
export const KeyboardShortcuts = {
    /** ViewManager reference */
    viewManager: null,
    /** Whether shortcuts are enabled */
    enabled: true,
    /** Help dialog element reference */
    helpDialog: null,
    /** Current shortcut mapping (action → keys[]) */
    shortcuts: null,
    /** Reverse mapping (key → action) for fast lookup, rebuilt on change */
    _keyToAction: null,
    /** Whether the global keydown listener has been bound */
    _bound: false,

    /**
     * Initialize keyboard shortcuts
     * @param {Object} viewManager - ViewManager instance
     */
    init(viewManager) {
        this.viewManager = viewManager;
        this.shortcuts = this._loadShortcuts();
        this._buildReverseMap();
        if (!this._bound) {
            this._bindGlobalKeydown();
            this._bound = true;
        }
    },

    /**
     * Re-sync shortcuts after server preferences have been loaded.
     * Called after AppState.preferences is populated from the server.
     */
    syncFromPreferences() {
        if (AppState.preferences?.keyboard_shortcuts) {
            this.shortcuts = this._loadShortcuts();
            this._buildReverseMap();
            // Also update localStorage cache
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.shortcuts));
            } catch (e) { /* ignore */ }
        }
    },

    // ==================== Persistence ====================

    /**
     * Load custom shortcuts, prioritizing server preferences over localStorage
     * @returns {Object}
     */
    _loadShortcuts() {
        const base = JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
        try {
            // Priority: server preferences > localStorage
            const saved = AppState.preferences?.keyboard_shortcuts
                || JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (saved) {
                for (const action of Object.keys(base)) {
                    if (saved[action] && Array.isArray(saved[action]) && saved[action].length > 0) {
                        base[action] = saved[action];
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to load keyboard shortcuts:', e);
        }
        return base;
    },

    /**
     * Save current shortcuts to server preferences and localStorage (as cache)
     */
    _saveShortcuts() {
        try {
            // Save to localStorage as cache
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.shortcuts));
            // Save to server preferences
            FeedManager.setPreference('keyboard_shortcuts', this.shortcuts).catch(err => {
                console.warn('Failed to sync keyboard shortcuts to server:', err);
            });
        } catch (e) {
            console.warn('Failed to save keyboard shortcuts:', e);
        }
    },

    /**
     * Build reverse map: key → { action, group }
     */
    _buildReverseMap() {
        this._keyToAction = {};
        for (const [action, keys] of Object.entries(this.shortcuts)) {
            const meta = ACTION_META[action];
            if (!meta) continue;
            for (const key of keys) {
                // Shift+ prefix keys: store with shift flag
                if (key.startsWith('Shift+')) {
                    const realKey = key.slice(6);
                    this._keyToAction['Shift+' + realKey] = { action, group: meta.group };
                } else {
                    this._keyToAction[key] = { action, group: meta.group };
                }
            }
        }
    },

    /**
     * Update a single shortcut
     * @param {string} action - Action name
     * @param {string[]} keys - New key(s)
     */
    updateShortcut(action, keys) {
        if (!DEFAULT_SHORTCUTS[action]) return;
        this.shortcuts[action] = keys;
        this._buildReverseMap();
        this._saveShortcuts();
    },

    /**
     * Reset all shortcuts to defaults
     */
    resetToDefaults() {
        this.shortcuts = JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
        this._buildReverseMap();
        this._saveShortcuts();
    },

    /**
     * Get the default shortcuts (for comparison / reset)
     * @returns {Object}
     */
    getDefaults() {
        return JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
    },

    // ==================== State Checks ====================

    /**
     * Check if an interactive element is focused
     * @returns {boolean}
     */
    _isInputFocused() {
        const el = document.activeElement;
        if (!el) return false;
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (el.isContentEditable) return true;
        return false;
    },

    /**
     * Check if a dialog/modal is currently open
     * @returns {boolean}
     */
    _isDialogOpen() {
        const overlay = document.querySelector('.dialog-overlay');
        if (overlay) return true;
        const modal = document.querySelector('.modal-overlay');
        if (modal) return true;
        const contextMenu = document.querySelector('body > .context-menu');
        if (contextMenu) return true;
        return false;
    },

    /**
     * Check if currently viewing an article
     * On mobile: body has 'article-view-active' class
     * On desktop: check if an article is currently loaded in the content panel
     * @returns {boolean}
     */
    _isArticleViewActive() {
        // Mobile: body class is toggled
        if (DOMElements.body.classList.contains(CLASS_ARTICLE_VIEW_ACTIVE)) return true;
        // Desktop: check if an article is currently displayed
        return !!AppState.content.currentArticleId;
    },

    // ==================== List Navigation ====================

    /** Currently focused article index in AppState.articles */
    _focusedIndex: -1,
    /** Reference to last known articles array (to detect list changes) */
    _lastArticles: null,

    /**
     * Navigate to next or previous article in the list (highlight only, no open)
     * @param {number} direction - 1 for next, -1 for previous
     */
    _navigateList(direction) {
        const articles = AppState.articles;
        if (!articles || articles.length === 0) return;

        // Reset index when articles list has changed (search, feed switch, etc.)
        if (articles !== this._lastArticles) {
            this._focusedIndex = -1;
            this._lastArticles = articles;
        }

        // If no focused index, start from beginning (j) or end (k)
        if (this._focusedIndex < 0 || this._focusedIndex >= articles.length) {
            this._focusedIndex = direction === 1 ? 0 : articles.length - 1;
        } else {
            this._focusedIndex += direction;
        }

        // Clamp
        if (this._focusedIndex < 0) this._focusedIndex = 0;
        if (this._focusedIndex >= articles.length) this._focusedIndex = articles.length - 1;

        const article = articles[this._focusedIndex];
        if (!article) return;

        // Only highlight, don't open
        this._highlightArticle(article.id);
    },

    /**
     * Highlight an article by ID - works with both virtual and regular lists
     * @param {string|number} articleId
     */
    _highlightArticle(articleId) {
        // Remove previous keyboard-active
        DOMElements.articlesList?.querySelectorAll('.keyboard-active').forEach(el => {
            el.classList.remove('keyboard-active');
        });

        // Use virtual list scrollToItem if available (ensures the element is rendered)
        if (ArticlesView.useVirtualScroll && ArticlesView.virtualList) {
            ArticlesView.virtualList.scrollToItem(articleId);
            // After scrollToItem renders, find the element
            requestAnimationFrame(() => {
                const el = DOMElements.articlesList?.querySelector(`.article-item[data-id="${articleId}"]`);
                if (el) {
                    el.classList.add('keyboard-active');
                }
            });
        } else {
            // Regular list - element is always in DOM
            const el = DOMElements.articlesList?.querySelector(`.article-item[data-id="${articleId}"]`);
            if (el) {
                el.classList.add('keyboard-active');
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    },

    // ==================== Actions ====================

    _openActiveItem() {
        const articles = AppState.articles;
        if (!articles || this._focusedIndex < 0 || this._focusedIndex >= articles.length) return;
        const article = articles[this._focusedIndex];
        if (article && this.viewManager) {
            this.viewManager.selectArticle(article.id);
        }
    },

    _goBack() {
        if (this._isArticleViewActive()) {
            // Sync focused index to current article before going back
            if (AppState.content.currentArticleId && AppState.articles) {
                const idx = AppState.articles.findIndex(a => a.id == AppState.content.currentArticleId);
                if (idx !== -1) this._focusedIndex = idx;
            }
            const backBtn = document.getElementById('article-back-btn');
            if (backBtn) backBtn.click();
            else history.back();
        }
    },

    _toggleStar() {
        const btn = document.getElementById('article-toggle-fav-btn');
        if (btn) btn.click();
    },

    _toggleRead() {
        const btn = document.getElementById('article-toggle-read-btn');
        if (btn) btn.click();
    },

    _openOriginal() {
        const link = DOMElements.articleContent?.querySelector('.article-title-link');
        if (link) window.open(link.href, '_blank', 'noopener,noreferrer');
    },

    _fetchContent() {
        const btn = document.getElementById('article-fetch-content-btn');
        if (btn) btn.click();
    },

    async _saveThirdParty() {
        const articleId = AppState.content.currentArticleId;
        if (!articleId) return;
        const toolbar = document.querySelector('.article-toolbar') || DOMElements.contentPanel;
        try {
            // Check if integrations are configured first
            const status = await FeedManager.getIntegrationsStatus();
            if (!status.has_integrations) {
                this._showInlineNotification(toolbar, i18n.t('article.no_integrations') || 'No third-party services configured', 3000);
                return;
            }
            await FeedManager.saveToThirdParty(articleId);
            this._showInlineNotification(toolbar, '✓ ' + (i18n.t('article.save_success') || 'Saved'), 2000);
        } catch (err) {
            this._showInlineNotification(toolbar, '✕ ' + (err.message || i18n.t('article.save_failed') || 'Save failed'), 3000);
        }
    },

    /**
     * 在指定容器内显示临时内联通知
     * @param {Element} container - 通知容器元素
     * @param {string} message - 通知消息
     * @param {number} duration - 显示时长(毫秒)
     */
    _showInlineNotification(container, message, duration = 3000) {
        if (!container) return;
        // 移除已有的内联通知
        document.querySelectorAll('.inline-notification').forEach(n => n.remove());
        const el = document.createElement('div');
        el.className = 'inline-notification';
        el.textContent = message;
        el.style.cssText = 'position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 100; padding: 8px 16px; border-radius: var(--radius); background: var(--card-bg); box-shadow: var(--card-shadow); backdrop-filter: blur(var(--glass-blur)); -webkit-backdrop-filter: blur(var(--glass-blur)); font-size: 0.85em; font-weight: 500; text-align: center; line-height: 1.4; white-space: normal; word-break: break-word; max-width: 80%; opacity: 1; transition: opacity 0.3s;';
        // 确保容器有定位上下文
        const pos = getComputedStyle(container).position;
        if (pos === 'static') container.style.position = 'relative';
        container.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }, duration);
    },

    _translateArticle() {
        const btn = document.getElementById('article-translate-btn');
        if (btn) btn.click();
    },

    _summarizeArticle() {
        const btn = document.getElementById('article-summarize-btn');
        if (btn) btn.click();
    },

    _aiChat() {
        const btn = document.getElementById('article-chat-btn');
        if (btn) btn.click();
    },

    _refresh() {
        const btn = document.getElementById('articles-refresh-btn');
        if (btn) btn.click();
    },

    _openSearch() {
        const btn = document.getElementById('articles-search-btn');
        if (btn) btn.click();
    },

    _nextArticle() {
        if (!AppState.articles || !AppState.content.currentArticleId) return;
        const idx = AppState.articles.findIndex(a => a.id == AppState.content.currentArticleId);
        if (idx !== -1 && idx < AppState.articles.length - 1) {
            const nextId = AppState.articles[idx + 1].id;
            if (this.viewManager) this.viewManager.selectArticle(nextId);
        } else {
            // Try load more
            const loadMoreBtn = DOMElements.contentPanel?.querySelector('.load-more-nav-btn');
            if (loadMoreBtn) loadMoreBtn.click();
        }
    },

    _prevArticle() {
        if (!AppState.articles || !AppState.content.currentArticleId) return;
        const idx = AppState.articles.findIndex(a => a.id == AppState.content.currentArticleId);
        if (idx > 0) {
            const prevId = AppState.articles[idx - 1].id;
            if (this.viewManager) this.viewManager.selectArticle(prevId);
        }
    },

    /**
     * Get the article scroll container (.article-content)
     * @returns {Element|null}
     */
    _getArticleScrollContainer() {
        return DOMElements.articleContent || DOMElements.contentPanel?.querySelector('.article-content');
    },

    /**
     * Scroll article content down by ~85% viewport.
     * If already at the bottom, jump to the next article.
     */
    _scrollDown() {
        const container = this._getArticleScrollContainer();
        if (!container) return;

        const { scrollTop, scrollHeight, clientHeight } = container;
        const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;

        if (isAtBottom) {
            this._nextArticle();
        } else {
            container.scrollBy({ top: clientHeight * 0.8, behavior: 'smooth' });
        }
    },

    /**
     * Scroll article content up by ~85% viewport.
     * If already at the top, jump to the previous article.
     */
    _scrollUp() {
        const container = this._getArticleScrollContainer();
        if (!container) return;

        const isAtTop = container.scrollTop <= 10;

        if (isAtTop) {
            this._prevArticle();
        } else {
            container.scrollBy({ top: -(container.clientHeight * 0.8), behavior: 'smooth' });
        }
    },

    _addFeed() {
        if (this.viewManager) this.viewManager.showAddFeedDialog();
    },

    // ==================== Action Dispatch ====================

    /**
     * Execute an action by name
     * @param {string} action
     * @param {boolean} isArticleView
     * @returns {boolean} whether the action was handled
     */
    _dispatch(action, isArticleView) {
        switch (action) {
            // j/k: highlight in list only (don't open)
            case 'nextItem':
                this._navigateList(1); return true;
            case 'prevItem':
                this._navigateList(-1); return true;
            case 'openItem':
                this._openActiveItem(); return true;

            // Always available (desktop: list + content panels are both visible)
            case 'search':
                this._openSearch(); return true;
            case 'refresh':
                this._refresh(); return true;
            case 'addFeed':
                this._addFeed(); return true;

            // Article actions: require an article to be loaded
            case 'scrollDown':
                if (isArticleView) { this._scrollDown(); return true; }
                return false;
            case 'scrollUp':
                if (isArticleView) { this._scrollUp(); return true; }
                return false;
            case 'nextArticle':
                if (isArticleView) { this._nextArticle(); return true; }
                return false;
            case 'prevArticle':
                if (isArticleView) { this._prevArticle(); return true; }
                return false;
            case 'toggleStar':
                if (isArticleView) { this._toggleStar(); return true; }
                return false;
            case 'toggleRead':
                if (isArticleView) { this._toggleRead(); return true; }
                return false;
            case 'openOriginal':
                if (isArticleView) { this._openOriginal(); return true; }
                return false;
            case 'fetchContent':
                if (isArticleView) { this._fetchContent(); return true; }
                return false;
            case 'saveThirdParty':
                if (isArticleView) { this._saveThirdParty(); return true; }
                return false;
            case 'translateArticle':
                if (isArticleView) { this._translateArticle(); return true; }
                return false;
            case 'summarizeArticle':
                if (isArticleView) { this._summarizeArticle(); return true; }
                return false;
            case 'aiChat':
                if (isArticleView) { this._aiChat(); return true; }
                return false;
            case 'goBack':
                this._goBack();
                return true;

            // Global
            case 'showHelp':
                this._toggleHelp();
                return true;

            default:
                return false;
        }
    },

    // ==================== Key Binding ====================

    _bindGlobalKeydown() {
        document.addEventListener('keydown', (e) => {
            if (!this.enabled) return;

            // Always allow Escape to close help dialog
            if (e.key === 'Escape' && this.helpDialog && document.body.contains(this.helpDialog)) {
                this._closeHelpFn?.();
                this.helpDialog = null;
                this._closeHelpFn = null;
                e.preventDefault();
                return;
            }

            // Don't intercept when typing in inputs
            if (this._isInputFocused()) return;

            // Don't intercept when dialog is open
            if (this._isDialogOpen()) return;

            // Don't intercept with modifier keys (Ctrl, Cmd, Alt)
            // Exception: Shift is allowed (needed for ? = Shift+/ and Shift+Space)
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            // Build lookup key: prefix with Shift+ when shift is held (except for keys that produce shifted chars like ?)
            const key = e.key;
            const lookupKey = e.shiftKey ? 'Shift+' + key : key;

            // Try Shift+ prefixed key first, then plain key
            const mapping = this._keyToAction[lookupKey] || this._keyToAction[key];
            if (!mapping) return;

            const isArticleView = this._isArticleViewActive();
            const handled = this._dispatch(mapping.action, isArticleView);
            if (handled) {
                e.preventDefault();
            }
        });
    },

    // ==================== Shortcuts Dialog ====================

    _toggleHelp() {
        if (this.helpDialog && document.body.contains(this.helpDialog)) {
            this._closeHelpFn?.();
            this.helpDialog = null;
            this._closeHelpFn = null;
        } else {
            this._showHelp();
        }
    },

    /**
     * Format key display
     * @param {string} key
     * @returns {string}
     */
    _formatKey(key) {
        // Handle Shift+ combo keys generically
        if (key.startsWith('Shift+')) {
            const inner = key.slice(6);
            return '⇧ ' + this._formatKey(inner);
        }
        const map = {
            'Escape': 'Esc',
            'Enter': '↵',
            'ArrowUp': '↑',
            'ArrowDown': '↓',
            'ArrowLeft': '←',
            'ArrowRight': '→',
            ' ': 'Space',
        };
        // Uppercase single letter keys for display
        if (key.length === 1 && key >= 'a' && key <= 'z') {
            return key.toUpperCase();
        }
        return map[key] || key;
    },

    _showHelp() {
        if (this.helpDialog && document.body.contains(this.helpDialog)) return;
        this.helpDialog = null;

        // Defensive: ensure shortcuts are loaded
        if (!this.shortcuts) {
            this.shortcuts = this._loadShortcuts();
            this._buildReverseMap();
        }

        const title = i18n.t('settings.keyboard_shortcuts');
        const resetText = i18n.t('settings.keyboard_reset');
        const saveText = i18n.t('settings.keyboard_save');
        const hintText = i18n.t('settings.keyboard_shortcuts_hint');

        const groupOrder = ['list', 'reading', 'global'];
        const groups = {};
        for (const [action, meta] of Object.entries(ACTION_META)) {
            if (!groups[meta.group]) groups[meta.group] = [];
            groups[meta.group].push({
                action,
                keys: [...(this.shortcuts[action] || [])],
                label: i18n.t(meta.i18nKey),
            });
        }

        const CloseIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

        const { dialog, close } = createDialog('settings-dialog', `
            <div class="settings-dialog-content" style="position: relative; max-width: 480px; display: flex; flex-direction: column; overflow-x: hidden;">
                <button class="icon-btn close-dialog-btn" title="${i18n.t('common.close')}" style="position: absolute; right: 16px; top: 16px; width: 32px; height: 32px; z-index: 10;">
                    ${CloseIcon}
                </button>
                <h3>${title}</h3>
                <div class="keyboard-customize-hint" style="margin-bottom: 12px;">${hintText}</div>
                <div id="keyboard-conflict-msg" style="display:none; padding: 8px 12px; margin-bottom: 10px; border-radius: var(--radius); background: color-mix(in srgb, var(--accent-color), transparent 88%); color: var(--text-color); font-size: 0.85em; line-height: 1.4; transition: opacity 0.3s;"></div>
                <div style="flex: 1; min-height: 0; overflow-y: auto; margin: 0 -24px; padding: 0 24px;">
                    ${groupOrder.map(g => `
                        <div class="keyboard-help-section">
                            <h3>${i18n.t(GROUP_I18N_KEYS[g])}</h3>
                            <div class="keyboard-customize-items">
                                ${(groups[g] || []).map(item => `
                                    <div class="keyboard-customize-row" data-action="${item.action}">
                                        <span class="keyboard-customize-label">${item.label}</span>
                                        <div class="keyboard-customize-key-input" tabindex="0" data-action="${item.action}">
                                            ${item.keys.map(k => `<kbd>${this._formatKey(k)}</kbd>`).join('<span style="color: var(--meta-color); font-size: 0.75em; margin: 0 2px;">/</span>')}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-color); flex-shrink: 0;">
                    <div class="appearance-mode-group" style="gap: 8px;">
                        <button type="button" id="keyboard-reset-btn" class="appearance-mode-btn" style="flex: 1; justify-content: center;">${resetText}</button>
                        <button type="button" id="keyboard-save-btn" class="appearance-mode-btn active" style="flex: 1; justify-content: center;">${saveText}</button>
                    </div>
                </div>
            </div>
        `);

        this.helpDialog = dialog;
        this._closeHelpFn = close;

        // Working copy of shortcuts
        const draft = JSON.parse(JSON.stringify(this.shortcuts));

        // Key recording
        let activeInput = null;

        // Helper to cancel active recording
        const cancelRecording = () => {
            if (!activeInput) return;
            activeInput.classList.remove('recording');
            const prevAction = activeInput.dataset.action;
            const prevKeys = draft[prevAction] || [];
            activeInput.innerHTML = prevKeys.length
                ? prevKeys.map(k => `<kbd>${this._formatKey(k)}</kbd>`).join(' ')
                : `<span style="color: var(--meta-color); font-size: 0.8em;">${i18n.t('settings.keyboard_none')}</span>`;
            activeInput = null;
        };

        const keyInputs = dialog.querySelectorAll('.keyboard-customize-key-input');
        keyInputs.forEach(input => {
            input.addEventListener('click', (e) => {
                e.stopPropagation();
                // Click same input again → cancel
                if (activeInput === input) {
                    cancelRecording();
                    return;
                }
                // Cancel previous if any
                if (activeInput) cancelRecording();
                activeInput = input;
                input.classList.add('recording');
                input.innerHTML = `<span class="recording-hint">${i18n.t('settings.keyboard_press_key')}</span>`;
            });
        });

        // Click on blank area → cancel recording
        dialog.addEventListener('click', (e) => {
            if (!activeInput) return;
            if (!e.target.closest('.keyboard-customize-key-input')) {
                cancelRecording();
            }
        });

        const keyHandler = (e) => {
            if (!activeInput) return;
            e.preventDefault();
            e.stopPropagation();

            const rawKey = e.key;
            if (['Shift', 'Control', 'Alt', 'Meta'].includes(rawKey)) return;

            // Shift 组合键：Shift+/ 已产生 '?' 等独立字符的不加前缀，其余加 Shift+ 前缀
            let key = rawKey;
            if (e.shiftKey) {
                const isAlphaOrSpecialKey = rawKey === ' ' || rawKey.length > 1 || rawKey === rawKey.toLowerCase();
                if (isAlphaOrSpecialKey) {
                    key = 'Shift+' + rawKey;
                }
            }

            const action = activeInput.dataset.action;

            // Check for conflicts with other actions
            for (const [otherAction, otherKeys] of Object.entries(draft)) {
                if (otherAction === action) continue;
                if (otherKeys.includes(key)) {
                    // Found conflict - show warning and clear the conflicting binding
                    const meta = ACTION_META[otherAction];
                    const conflictLabel = meta ? i18n.t(meta.i18nKey) : otherAction;
                    // Show conflict message inside the dialog
                    const conflictMsg = dialog.querySelector('#keyboard-conflict-msg');
                    if (conflictMsg) {
                        conflictMsg.textContent = i18n.t('settings.keyboard_conflict', { key: this._formatKey(key), label: conflictLabel });
                        conflictMsg.style.display = 'block';
                        conflictMsg.style.opacity = '1';
                        clearTimeout(conflictMsg._hideTimer);
                        conflictMsg._hideTimer = setTimeout(() => {
                            conflictMsg.style.opacity = '0';
                            setTimeout(() => { conflictMsg.style.display = 'none'; }, 300);
                        }, 3000);
                    }

                    // Clear conflicting action's key
                    draft[otherAction] = draft[otherAction].filter(k => k !== key);

                    // Update the conflicting row's display
                    const conflictInput = dialog.querySelector(`.keyboard-customize-key-input[data-action="${otherAction}"]`);
                    if (conflictInput) {
                        const remainingKeys = draft[otherAction];
                        conflictInput.innerHTML = remainingKeys.length
                            ? remainingKeys.map(k => `<kbd>${this._formatKey(k)}</kbd>`).join(' ')
                            : `<span style="color: var(--meta-color); font-size: 0.8em;">${i18n.t('settings.keyboard_none')}</span>`;
                        // Flash the conflicting row
                        const row = conflictInput.closest('.keyboard-customize-row');
                        if (row) {
                            row.style.background = 'color-mix(in srgb, var(--accent-color), transparent 85%)';
                            setTimeout(() => { row.style.background = ''; }, 1500);
                        }
                    }
                    break;
                }
            }

            draft[action] = [key];
            activeInput.innerHTML = `<kbd>${this._formatKey(key)}</kbd>`;
            activeInput.classList.remove('recording');
            activeInput = null;
        };

        dialog.addEventListener('keydown', keyHandler, true);

        // Reset
        dialog.querySelector('#keyboard-reset-btn')?.addEventListener('click', () => {
            const defaults = this.getDefaults();
            Object.assign(draft, defaults);
            keyInputs.forEach(input => {
                const action = input.dataset.action;
                const keys = defaults[action] || [];
                input.innerHTML = keys.map(k => `<kbd>${this._formatKey(k)}</kbd>`).join(' ');
                input.classList.remove('recording');
            });
            activeInput = null;
        });

        // Save
        dialog.querySelector('#keyboard-save-btn')?.addEventListener('click', () => {
            this.shortcuts = draft;
            this._buildReverseMap();
            this._saveShortcuts();
            // Show success message
            const conflictMsg = dialog.querySelector('#keyboard-conflict-msg');
            if (conflictMsg) {
                conflictMsg.textContent = i18n.t('settings.keyboard_saved');
                conflictMsg.style.display = 'block';
                conflictMsg.style.opacity = '1';
                clearTimeout(conflictMsg._hideTimer);
                conflictMsg._hideTimer = setTimeout(() => {
                    conflictMsg.style.opacity = '0';
                    setTimeout(() => { conflictMsg.style.display = 'none'; }, 300);
                }, 2000);
            }
        });
    },
};
