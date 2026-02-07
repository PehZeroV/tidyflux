/**
 * Dialogs - 对话框模块
 * @module view/dialogs
 */

import { AppState } from '../../state.js';
import { DOMElements } from '../../dom.js';
import { FeedManager } from '../feed-manager.js';
import { AuthManager } from '../auth-manager.js';
import { setTheme, setColorScheme, THEMES, COLOR_SCHEME_MODES } from '../theme-manager.js';
import { createDialog, showToast } from './utils.js';
import { Modal, CustomSelect } from './components.js';
import { i18n } from '../i18n.js';
import { AIService, AI_LANGUAGES } from '../ai-service.js';
import { API_ENDPOINTS } from '../../constants.js';
import { Icons } from '../icons.js';

// UUID 生成辅助函数（兼容旧版浏览器）
function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 对话框管理
 */
export const Dialogs = {
    /** 视图管理器引用 */
    viewManager: null,

    /**
     * 初始化模块
     * @param {Object} viewManager - ViewManager 实例引用
     */
    init(viewManager) {
        this.viewManager = viewManager;
    },

    /**
     * 显示添加订阅对话框
     */
    showAddFeedDialog() {
        const groups = AppState.groups || [];
        const { dialog, close } = createDialog('settings-dialog', `
            <div class="settings-dialog-content" style="position: relative;">
                <button class="icon-btn close-dialog-btn" title="${i18n.t('common.close')}" style="position: absolute; right: 16px; top: 16px; width: 32px; height: 32px;">
                    ${Icons.close}
                </button>
                <h3>${i18n.t('dialogs.add_feed_title')}</h3>
                
                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('dialogs.add_subscription')}</div>
                    ${groups.length > 0 ? `
                    <input type="url" id="new-feed-url" class="auth-input" placeholder="${i18n.t('dialogs.enter_rss_url')}" autofocus style="margin-bottom: 8px;">
                    <select id="new-feed-group" class="dialog-select" style="margin-bottom: 12px;">
                        ${groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('')}
                    </select>
                    <div class="appearance-mode-group">
                        <button class="confirm-btn appearance-mode-btn active" style="justify-content: center; width: 100%;">${i18n.t('dialogs.add')}</button>
                    </div>
                    ` : `
                    <div class="no-groups-warning" style="padding: 16px; background: var(--card-bg); border-radius: 8px; text-align: center; color: var(--meta-color);">
                        <p style="margin: 0 0 12px 0;">${i18n.t('dialogs.no_groups_alert')}</p>
                        <p style="margin: 0; font-size: 0.85em;">${i18n.t('dialogs.create_group_hint')}</p>
                    </div>
                    `}
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('settings.group_management')}</div>
                    <div class="appearance-mode-group">
                        <button id="manage-groups-btn" class="appearance-mode-btn">${i18n.t('settings.manage_groups')}</button>
                    </div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('settings.data_management')}</div>
                    <div class="appearance-mode-group">
                        <button id="import-opml-btn" class="appearance-mode-btn">${i18n.t('settings.import_opml')}</button>
                        <button id="export-opml-btn" class="appearance-mode-btn">${i18n.t('settings.export_opml')}</button>
                        <input type="file" id="opml-file-input" accept=".opml,.xml" style="display: none;">
                    </div>
                </div>
            </div>
        `);

        const urlInput = dialog.querySelector('#new-feed-url');
        const groupSelect = dialog.querySelector('#new-feed-group');
        const confirmBtn = dialog.querySelector('.confirm-btn');
        const closeBtn = dialog.querySelector('.close-dialog-btn');
        const manageGroupsBtn = dialog.querySelector('#manage-groups-btn');
        const importBtn = dialog.querySelector('#import-opml-btn');
        const exportBtn = dialog.querySelector('#export-opml-btn');
        const opmlFileInput = dialog.querySelector('#opml-file-input');

        closeBtn.addEventListener('click', close);

        // Init Custom Select
        const container = dialog.querySelector('.settings-dialog-content');
        if (container) CustomSelect.replaceAll(container);

        // 只有在有分组时才绑定添加订阅相关的事件
        if (confirmBtn && urlInput && groupSelect) {
            confirmBtn.addEventListener('click', async () => {
                const url = urlInput.value.trim();
                if (!url) return;

                const groupId = groupSelect.value;
                if (!groupId) {
                    await Modal.alert(i18n.t('dialogs.no_groups_alert'));
                    return;
                }

                confirmBtn.textContent = i18n.t('dialogs.adding');
                confirmBtn.disabled = true;

                try {
                    await FeedManager.addFeed(url, groupId);
                    close();
                    await this.viewManager.loadFeeds();
                } catch (err) {
                    await Modal.alert(err.message);
                    confirmBtn.textContent = i18n.t('dialogs.add');
                    confirmBtn.disabled = false;
                }
            });

            urlInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') confirmBtn.click();
                if (e.key === 'Escape') close();
            });
        }

        // 管理分组
        manageGroupsBtn.addEventListener('click', () => {
            close();
            this.showGroupManagerDialog();
        });

        // 导入 OPML
        importBtn.addEventListener('click', async () => {
            // 检查是否有分组
            const currentGroups = AppState.groups || [];
            if (currentGroups.length === 0) {
                await Modal.alert(i18n.t('dialogs.no_groups_alert'));
                return;
            }
            opmlFileInput.click();
        });

        opmlFileInput.addEventListener('change', async (e) => {
            if (e.target.files.length > 0) {
                const file = e.target.files[0];
                const originalText = importBtn.textContent;
                importBtn.textContent = i18n.t('settings.importing');
                importBtn.disabled = true;

                try {
                    await FeedManager.importOpml(file);
                    try {
                        await FeedManager.refreshFeeds();
                    } catch (err) {
                        console.warn('Auto refresh after import failed:', err);
                    }
                    showToast(i18n.t('settings.import_success_refresh'), 3000, false);
                    setTimeout(() => {
                        window.location.reload();
                    }, 2000);
                } catch (err) {
                    await Modal.alert(err.message);
                    importBtn.textContent = originalText;
                    importBtn.disabled = false;
                }
                opmlFileInput.value = '';
            }
        });

        // 导出 OPML
        exportBtn.addEventListener('click', async () => {
            const originalText = exportBtn.textContent;
            exportBtn.textContent = i18n.t('settings.exporting');
            exportBtn.disabled = true;

            try {
                const blob = await FeedManager.exportOpml();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'tidyflux.opml';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            } catch (err) {
                await Modal.alert(err.message);
            } finally {
                exportBtn.textContent = originalText;
                exportBtn.disabled = false;
            }
        });
    },

    /**
     * 显示编辑订阅对话框
     * @param {string|number} feedId - 订阅源 ID
     */
    showEditFeedDialog(feedId) {
        // Initial Loading State
        const { dialog, close } = createDialog('settings-dialog', `
            <div class="settings-dialog-content" style="position: relative; min-height: 200px; display: flex; align-items: center; justify-content: center;">
                <div class="miniflux-loading">${i18n.t('common.loading')}</div>
            </div>
        `);

        // Load Data
        (async () => {
            try {
                const feed = await FeedManager.getFeed(feedId);
                const groups = AppState.groups || [];

                // Render Form
                const contentHtml = `
                    <button class="icon-btn close-dialog-btn" title="${i18n.t('settings.close')}" style="position: absolute; right: 16px; top: 16px; width: 32px; height: 32px;">
                        ${Icons.close}
                    </button>
                    <h3>${i18n.t('dialogs.edit_subscription')}</h3>
                    
                    <div class="settings-section">
                        <label class="miniflux-input-label">${i18n.t('dialogs.feed_title')}</label>
                        <input type="text" id="edit-feed-title" class="auth-input" style="margin-bottom: 12px;">

                        <div style="margin-bottom: 12px;">
                            <label class="miniflux-input-label">${i18n.t('nav.categories')}</label>
                            <select id="edit-feed-group" class="dialog-select">
                                ${groups.map(g => `<option value="${g.id}" ${feed.category.id == g.id ? 'selected' : ''}>${g.name}</option>`).join('')}
                            </select>
                        </div>

                        <label class="miniflux-input-label">${i18n.t('dialogs.site_url')}</label>
                        <input type="url" id="edit-site-url" class="auth-input" style="margin-bottom: 12px;">

                        <label class="miniflux-input-label">${i18n.t('dialogs.feed_url')}</label>
                        <input type="url" id="edit-feed-url" class="auth-input" style="margin-bottom: 12px;">



                        <div class="appearance-mode-group" style="margin-top: 24px;">
                             <button id="delete-feed-btn" class="appearance-mode-btn danger" style="flex: 1;">${i18n.t('context.delete_feed')}</button>
                            <button id="save-feed-btn" class="appearance-mode-btn active" style="flex: 1;">${i18n.t('dialogs.update')}</button>
                        </div>
                    </div>
                `;

                const container = dialog.querySelector('.settings-dialog-content');
                container.style.display = 'block';
                container.style.minHeight = 'auto';
                container.style.alignItems = 'initial';
                container.style.justifyContent = 'initial';
                container.innerHTML = contentHtml;

                // Bind Events
                const closeBtn = dialog.querySelector('.close-dialog-btn');

                // Init Custom Select
                CustomSelect.replaceAll(container);
                const saveBtn = dialog.querySelector('#save-feed-btn');
                const deleteBtn = dialog.querySelector('#delete-feed-btn');
                const titleInput = dialog.querySelector('#edit-feed-title');
                const groupSelect = dialog.querySelector('#edit-feed-group');
                const siteUrlInput = dialog.querySelector('#edit-site-url');
                const feedUrlInput = dialog.querySelector('#edit-feed-url');

                // Set values safely to avoid XSS
                titleInput.value = feed.title || '';
                siteUrlInput.value = feed.site_url || '';
                feedUrlInput.value = feed.feed_url || '';


                closeBtn.addEventListener('click', close);

                saveBtn.addEventListener('click', async () => {
                    const updates = {
                        title: titleInput.value.trim(),
                        category_id: parseInt(groupSelect.value, 10),
                        site_url: siteUrlInput.value.trim(),
                        feed_url: feedUrlInput.value.trim(),

                    };

                    if (!updates.title || !updates.feed_url) {
                        await Modal.alert(i18n.t('settings.fill_all_info'));
                        return;
                    }

                    saveBtn.textContent = i18n.t('settings.saving');
                    saveBtn.disabled = true;

                    try {
                        await FeedManager.updateFeed(feedId, updates);
                        close();
                        await this.viewManager.loadFeeds();
                        // If current feed is the one edited, reload articles to reflect potential changes
                        if (AppState.currentFeedId == feedId) {
                            // Assuming access to DOMElements through imports in dialogs.js, but let's check
                            // DOMElements is imported.
                            DOMElements.currentFeedTitle.textContent = updates.title;
                        }
                    } catch (err) {
                        await Modal.alert(err.message);
                        saveBtn.textContent = i18n.t('dialogs.update');
                        saveBtn.disabled = false;
                    }
                });

                deleteBtn.addEventListener('click', async () => {
                    if (await Modal.confirm(i18n.t('context.confirm_delete_feed'))) {
                        try {
                            await FeedManager.deleteFeed(feedId);
                            close();
                            await this.viewManager.loadFeeds();
                            if (AppState.currentFeedId == feedId) {
                                window.location.hash = '#/all';
                            }
                        } catch (err) {
                            await Modal.alert(err.message);
                        }
                    }
                });

            } catch (err) {
                console.error('Load feed info error:', err);
                const container = dialog.querySelector('.settings-dialog-content');
                container.innerHTML = `
                    <button class="icon-btn close-dialog-btn" title="${i18n.t('settings.close')}" style="position: absolute; right: 16px; top: 16px; width: 32px; height: 32px;">
                        ${Icons.close}
                    </button>
                    <div class="miniflux-config-error" style="text-align:center; padding: 20px;">${i18n.t('common.load_error')}</div>
                 `;
                dialog.querySelector('.close-dialog-btn').addEventListener('click', close);
            }
        })();
    },

    /**
     * 显示分组管理对话框
     */
    showGroupManagerDialog() {
        const renderGroupList = () => {
            const groups = AppState.groups || [];
            if (groups.length === 0) {
                return `<div class="empty-msg" style="padding: 20px; text-align: center;">${i18n.t('dialogs.no_groups')}</div>`;
            }
            return groups.map(g => `
                <div class="group-manager-item" data-group-id="${g.id}">
                    <span class="group-manager-name">${g.name}</span>
                    <span class="group-manager-count">${i18n.t('dialogs.subscription_count', { count: g.feed_count || 0 })}</span>
                    <div class="group-manager-actions">
                        <button class="group-rename-btn" data-group-id="${g.id}" data-group-name="${g.name}" title="${i18n.t('context.rename')}">✎</button>
                        <button class="group-delete-btn" data-group-id="${g.id}" title="${i18n.t('context.delete_group')}">×</button>
                    </div>
                </div>
            `).join('');
        };

        const { dialog, close } = createDialog('settings-dialog', `
            <div class="settings-dialog-content" style="position: relative;">
                <button class="icon-btn close-dialog-btn" title="${i18n.t('settings.close')}" style="position: absolute; right: 16px; top: 16px; width: 32px; height: 32px;">
                    ${Icons.close}
                </button>
                <h3>${i18n.t('dialogs.manage_groups')}</h3>
                
                <div class="group-add-row">
                    <input type="text" id="new-group-name" placeholder="${i18n.t('dialogs.new_group_placeholder')}" class="dialog-input">
                    <button id="add-group-btn" class="group-add-btn">${i18n.t('dialogs.add')}</button>
                </div>
                
                <div id="group-list" class="group-manager-list">
                    ${renderGroupList()}
                </div>
            </div>
        `);

        const groupList = dialog.querySelector('#group-list');
        const nameInput = dialog.querySelector('#new-group-name');
        const addBtn = dialog.querySelector('#add-group-btn');
        const closeBtn = dialog.querySelector('.close-dialog-btn');

        closeBtn.addEventListener('click', close);

        addBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name) return;

            addBtn.disabled = true;
            try {
                await FeedManager.addGroup(name);
                nameInput.value = '';
                const [feeds, groups] = await Promise.all([FeedManager.getFeeds(), FeedManager.getGroups()]);
                AppState.feeds = feeds;
                AppState.groups = groups;
                groupList.innerHTML = renderGroupList();
                this.viewManager.renderFeedsList(feeds, groups);
            } catch (err) {
                await Modal.alert(err.message);
            } finally {
                addBtn.disabled = false;
            }
        });

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addBtn.click();
        });

        groupList.addEventListener('click', async (e) => {
            const renameBtn = e.target.closest('.group-rename-btn');
            if (renameBtn) {
                const groupId = renameBtn.dataset.groupId;
                const oldName = renameBtn.dataset.groupName;
                const newName = await Modal.prompt(i18n.t('auth.enter_new_group_name'), oldName);
                if (newName && newName.trim() && newName.trim() !== oldName) {
                    try {
                        await FeedManager.updateGroup(groupId, { name: newName.trim() });
                        const [feeds, groups] = await Promise.all([FeedManager.getFeeds(), FeedManager.getGroups()]);
                        AppState.feeds = feeds;
                        AppState.groups = groups;
                        groupList.innerHTML = renderGroupList();
                        this.viewManager.renderFeedsList(feeds, groups);
                    } catch (err) {
                        await Modal.alert(err.message);
                    }
                }
                return;
            }

            const deleteBtn = e.target.closest('.group-delete-btn');
            if (deleteBtn) {
                const groupId = deleteBtn.dataset.groupId;
                if (!await Modal.confirm(i18n.t('context.confirm_delete_group'))) return;
                try {
                    await FeedManager.deleteGroup(groupId);
                    const [feeds, groups] = await Promise.all([FeedManager.getFeeds(), FeedManager.getGroups()]);
                    AppState.feeds = feeds;
                    AppState.groups = groups;
                    groupList.innerHTML = renderGroupList();
                    this.viewManager.renderFeedsList(feeds, groups);
                } catch (err) {
                    await Modal.alert(err.message);
                }
            }
        });
    },

    /**
     * 显示设置对话框
     * @param {boolean} forceMode - 强制模式，不可关闭，仅显示 Miniflux 配置
     */
    showSettingsDialog(forceMode = false) {
        const vm = this.viewManager;
        const currentTheme = AppState.preferences?.theme || 'default';
        const currentColorScheme = AppState.preferences?.color_scheme || 'auto';
        const currentLang = i18n.locale;

        const langSelectOptions = [
            { id: 'zh', name: '简体中文' },
            { id: 'en', name: 'English' }
        ].map(lang =>
            `<option value="${lang.id}" ${currentLang === lang.id ? 'selected' : ''}>${lang.name}</option>`
        ).join('');

        // 强制模式下只显示 Miniflux 配置相关内容
        const showFullSettings = !forceMode;

        // 主题色选项
        const themeOptions = THEMES.map(theme =>
            `<button class="theme-color-btn ${currentTheme === theme.id ? 'active' : ''}" data-theme="${theme.id}" title="${i18n.t('theme.' + theme.id)}">
                <span class="color-dot" style="background-color: ${theme.color || 'var(--accent-color)'}"></span>
            </button>`
        ).join('');

        // 颜色模式选项
        const colorModeOptions = COLOR_SCHEME_MODES.map(mode =>
            `<button class="appearance-mode-btn ${currentColorScheme === mode.id ? 'active' : ''}" data-mode="${mode.id}">
                <span class="mode-icon">${mode.icon || ''}</span>
                ${i18n.t('settings.' + mode.id)}
            </button>`
        ).join('');

        const { dialog, close } = createDialog('settings-dialog', `
            <div class="settings-dialog-content" style="position: relative;">
                ${showFullSettings ? `
                <button class="icon-btn close-dialog-btn" title="${i18n.t('settings.close')}" style="position: absolute; right: 16px; top: 16px; width: 32px; height: 32px;">
                    ${Icons.close}
                </button>` : ''}
                <h3>${forceMode ? i18n.t('settings.miniflux_settings') : i18n.t('settings.title')}</h3>
                ${forceMode ? `<p style="color: var(--meta-color); font-size: 0.9em; margin-bottom: 16px;">${i18n.t('auth.configure_miniflux_hint')}</p>` : ''}
                
                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('dialogs.miniflux_connection')}</div>
                    <div id="miniflux-config-info" class="miniflux-config-info">
                        <div class="miniflux-loading">${i18n.t('app.loading')}</div>
                    </div>
                </div>
                
                ${showFullSettings ? `
                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('settings.language')}</div>
                    <select id="settings-language-select" class="dialog-select">
                        ${langSelectOptions}
                    </select>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('settings.appearance')}</div>
                    
                    <div class="theme-option-group" style="margin-bottom: 16px;">
                        <div class="settings-item-label">${i18n.t('settings.theme_color')}</div>
                        <div class="theme-color-grid" id="settings-theme-colors">
                            ${themeOptions}
                        </div>
                    </div>

                    <div class="theme-option-group">
                        <div class="settings-item-label">${i18n.t('settings.mode')}</div>
                        <div class="appearance-mode-group" id="settings-appearance-modes">
                            ${colorModeOptions}
                        </div>
                    </div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('ai.settings_title')}</div>
                    <form id="ai-settings-form">
                        <label class="miniflux-input-label">${i18n.t('ai.api_url')}</label>
                        <input type="text" id="ai-api-url" class="auth-input" placeholder="https://api.openai.com/v1" style="margin-bottom: 8px;">
                        
                        <label class="miniflux-input-label">${i18n.t('ai.api_key')}</label>
                        <input type="password" id="ai-api-key" class="auth-input" placeholder="sk-..." style="margin-bottom: 8px;" autocomplete="off" spellcheck="false">
                        
                        <label class="miniflux-input-label">${i18n.t('ai.model')}</label>
                        <input type="text" id="ai-model" class="auth-input" placeholder="gpt-4.1-mini" style="margin-bottom: 8px;" autocomplete="off">

                        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                            <div style="flex: 1;">
                                <label class="miniflux-input-label">${i18n.t('ai.temperature')}</label>
                                <input type="number" id="ai-temperature" class="auth-input" min="0" max="2" step="0.1" placeholder="1.0">
                            </div>
                            <div style="flex: 1;">
                                <label class="miniflux-input-label">${i18n.t('ai.concurrency')}</label>
                                <input type="number" id="ai-concurrency" class="auth-input" min="1" max="50" step="1" placeholder="5">
                            </div>
                        </div>

                        <div style="margin-bottom: 12px;">
                            <label class="miniflux-input-label">${i18n.t('ai.target_lang')}</label>
                            <select id="ai-target-lang" class="dialog-select">
                                ${AI_LANGUAGES.map(lang =>
            `<option value="${lang.id}">${i18n.locale === 'zh' ? lang.name : lang.nameEn}</option>`
        ).join('')}
                            </select>
                        </div>

                        <div class="collapsible-section" style="margin-bottom: 16px;">
                            <button type="button" class="collapsible-toggle" style="background: none; border: none; padding: 0; color: var(--accent-color); font-size: 0.9em; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                                <span class="toggle-icon">▶</span> ${i18n.t('settings.edit_prompts_translate_summarize')}
                            </button>
                            <div class="collapsible-content" style="display: none; margin-top: 12px;">
                                <label class="miniflux-input-label">${i18n.t('ai.translate_prompt')}</label>
                                <textarea id="ai-translate-prompt" class="auth-input" rows="3" placeholder="${i18n.t('ai.translate_prompt_placeholder')}" style="margin-bottom: 8px; resize: vertical; min-height: 80px;"></textarea>
                                
                                <label class="miniflux-input-label">${i18n.t('ai.summarize_prompt')}</label>
                                <textarea id="ai-summarize-prompt" class="auth-input" rows="3" placeholder="${i18n.t('ai.summarize_prompt_placeholder')}" style="margin-bottom: 8px; resize: vertical; min-height: 80px;"></textarea>

                                <button type="button" id="ai-reset-prompts-btn" style="background: none; border: none; color: var(--accent-color); padding: 4px 0; font-size: 0.85em; cursor: pointer; margin-top: 8px;">
                                    ${i18n.t('ai.reset_prompts')}
                                </button>
                            </div>
                        </div>



                        <div class="appearance-mode-group">
                            <button type="button" id="ai-test-btn" class="appearance-mode-btn" style="flex: 1;">${i18n.t('settings.test_connection')}</button>
                            <button type="submit" class="appearance-mode-btn active" style="flex: 1;">${i18n.t('common.save')}</button>
                        </div>
                        <div id="ai-settings-msg" style="text-align: center; margin-top: 8px; font-size: 0.85em;"></div>
                    </form>
                </div>
                

` : ''}

                ${showFullSettings ? `
                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('settings.digest_management')}</div>
                    <div class="appearance-mode-group">
                        <button type="button" id="digest-manager-btn" class="appearance-mode-btn active" style="justify-content: center; width: 100%;">${i18n.t('settings.digest_manager')}</button>
                    </div>
                </div>
                ` : ''}
                
                ${showFullSettings ? `
                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('settings.account_security')}</div>

                    <form id="settings-change-password-form" style="margin-bottom: 16px;">
                        <input type="password" id="settings-new-password" class="auth-input" placeholder="${i18n.t('settings.new_password')}" style="margin-bottom: 8px;" required>
                        <input type="password" id="settings-confirm-password" class="auth-input" placeholder="${i18n.t('settings.confirm_password')}" style="margin-bottom: 8px;" required>
                        <div class="appearance-mode-group">
                            <button type="submit" class="appearance-mode-btn active" style="justify-content: center; width: 100%;">${i18n.t('settings.change_password')}</button>
                        </div>
                        <div style="text-align: center; margin-top: 8px;">
                            <span id="settings-password-msg" style="font-size: 0.85em;"></span>
                        </div>
                    </form>

                    <div class="settings-section-title" style="margin-top: 24px;">${i18n.t('settings.login')}</div>
                    <div class="appearance-mode-group">
                        <button class="logout-btn-full appearance-mode-btn active" style="justify-content: center; width: 100%;">${i18n.t('nav.logout')}</button>
                    </div>
                </div>` : ''}
            </div>
        `);

        const closeBtn = dialog.querySelector('.close-dialog-btn');
        const logoutBtn = dialog.querySelector('.logout-btn-full');
        const themeColorBtns = dialog.querySelectorAll('.theme-color-btn');
        const modeBtns = dialog.querySelectorAll('.appearance-mode-btn[data-mode]');
        const langSelect = dialog.querySelector('#settings-language-select');
        const passwordForm = dialog.querySelector('#settings-change-password-form');
        const passwordMsg = dialog.querySelector('#settings-password-msg');
        const minifluxConfigInfo = dialog.querySelector('#miniflux-config-info');

        // Init CustomSelects
        const contentContainer = dialog.querySelector('.settings-dialog-content');
        if (contentContainer) CustomSelect.replaceAll(contentContainer);

        // 异步加载 Miniflux 配置信息
        this._loadMinifluxConfig(minifluxConfigInfo);

        // 主题色切换强制模式下不允许关闭
        if (!forceMode) {
            closeBtn?.addEventListener('click', close);
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) close();
            });
        }

        // 主题色切换
        themeColorBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                const theme = btn.dataset.theme;
                setTheme(theme);
                AppState.preferences = AppState.preferences || {};
                AppState.preferences.theme = theme;
                themeColorBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                try {
                    await FeedManager.setPreference('theme', theme);
                } catch (err) {
                    console.error('Save theme error:', err);
                }
            });
        });

        // 颜色模式切换
        modeBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                const mode = btn.dataset.mode;
                setColorScheme(mode);
                AppState.preferences = AppState.preferences || {};
                AppState.preferences.color_scheme = mode;
                modeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                try {
                    await FeedManager.setPreference('color_scheme', mode);
                } catch (err) {
                    console.error('Save color scheme error:', err);
                }
            });
        });

        // 语言切换
        if (langSelect) {
            langSelect.addEventListener('change', async () => {
                const lang = langSelect.value;
                if (lang !== i18n.locale) {
                    try {
                        await FeedManager.setPreference('language', lang);
                    } catch (err) {
                        console.error('Save language preference error:', err);
                    }
                    i18n.locale = lang;
                    window.location.reload();
                }
            });
        }


        // AI 设置逻辑
        if (showFullSettings) {
            this._bindAISettingsEvents(dialog);
        }

        // 简报管理器按钮
        const digestManagerBtn = dialog.querySelector('#digest-manager-btn');
        if (digestManagerBtn) {
            digestManagerBtn.addEventListener('click', () => {
                this.showDigestManagerDialog();
            });
        }

        // 修改密码（仅在非强制模式下存在）
        if (passwordForm) {
            passwordForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const newPwd = dialog.querySelector('#settings-new-password').value;
                const confirmPwd = dialog.querySelector('#settings-confirm-password').value;

                if (newPwd !== confirmPwd) {
                    passwordMsg.textContent = i18n.t('settings.password_mismatch');
                    passwordMsg.style.color = 'var(--danger-color)';
                    return;
                }

                const submitBtn = passwordForm.querySelector('button[type="submit"]');
                submitBtn.disabled = true;

                try {
                    await AuthManager.changePassword(newPwd);
                    passwordMsg.textContent = i18n.t('settings.password_change_success');
                    passwordMsg.style.color = 'var(--accent-color)';
                    dialog.querySelector('#settings-new-password').value = '';
                    dialog.querySelector('#settings-confirm-password').value = '';
                } catch (err) {
                    passwordMsg.textContent = err.message;
                    passwordMsg.style.color = 'var(--danger-color)';
                } finally {
                    submitBtn.disabled = false;
                }
            });
        }

        // 退出登录（仅在非强制模式下存在）
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                if (await Modal.confirm(i18n.t('auth.confirm_logout'))) {
                    close();
                    AuthManager.logout();
                }
            });
        }
    },

    /**
     * 绑定 AI 设置相关事件
     */
    _bindAISettingsEvents(dialog) {
        const aiForm = dialog.querySelector('#ai-settings-form');
        const aiUrlInput = dialog.querySelector('#ai-api-url');
        const aiKeyInput = dialog.querySelector('#ai-api-key');
        const aiModelInput = dialog.querySelector('#ai-model');
        const aiTemperatureInput = dialog.querySelector('#ai-temperature');
        const aiConcurrencyInput = dialog.querySelector('#ai-concurrency');
        const aiTargetLangSelect = dialog.querySelector('#ai-target-lang');
        const aiTranslatePromptInput = dialog.querySelector('#ai-translate-prompt');
        const aiSummarizePromptInput = dialog.querySelector('#ai-summarize-prompt');
        const aiMsg = dialog.querySelector('#ai-settings-msg');
        const collapsibleToggle = dialog.querySelector('.collapsible-toggle');
        const collapsibleContent = dialog.querySelector('.collapsible-content');

        // 加载当前 AI 配置
        const aiConfig = AIService.getConfig();
        const defaultTranslatePrompt = AIService.getDefaultPrompt('translate');
        const defaultSummarizePrompt = AIService.getDefaultPrompt('summarize');

        if (aiUrlInput) aiUrlInput.value = aiConfig.apiUrl || '';
        if (aiKeyInput) aiKeyInput.value = aiConfig.apiKey || '';
        if (aiModelInput) aiModelInput.value = aiConfig.model || 'gpt-4.1-mini';

        // 温度和并发初始化
        if (aiTemperatureInput) {
            aiTemperatureInput.value = aiConfig.temperature ?? 1;
        }
        if (aiConcurrencyInput) {
            aiConcurrencyInput.value = aiConfig.concurrency ?? 5;
        }

        if (aiTargetLangSelect) {
            aiTargetLangSelect.value = aiConfig.targetLang || 'zh-CN';
            aiTargetLangSelect.dispatchEvent(new Event('change'));
        }

        if (aiTranslatePromptInput) aiTranslatePromptInput.value = aiConfig.translatePrompt || defaultTranslatePrompt;
        if (aiSummarizePromptInput) aiSummarizePromptInput.value = aiConfig.summarizePrompt || defaultSummarizePrompt;

        // 折叠面板切换
        if (collapsibleToggle) {
            collapsibleToggle.addEventListener('click', () => {
                const isHidden = collapsibleContent.style.display === 'none';
                collapsibleContent.style.display = isHidden ? 'block' : 'none';
                const icon = collapsibleToggle.querySelector('.toggle-icon');
                if (icon) {
                    icon.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
                    icon.style.display = 'inline-block';
                    icon.style.transition = 'transform 0.2s';
                }
            });
        }

        // Reset Prompts Button
        const aiResetPromptsBtn = dialog.querySelector('#ai-reset-prompts-btn');
        if (aiResetPromptsBtn) {
            aiResetPromptsBtn.addEventListener('click', () => {
                if (aiTranslatePromptInput) aiTranslatePromptInput.value = defaultTranslatePrompt;
                if (aiSummarizePromptInput) aiSummarizePromptInput.value = defaultSummarizePrompt;
            });
        }

        // Test Connection
        const aiTestBtn = dialog.querySelector('#ai-test-btn');
        if (aiTestBtn) {
            aiTestBtn.addEventListener('click', async () => {
                const config = {
                    apiUrl: aiUrlInput.value.trim(),
                    apiKey: aiKeyInput.value.trim(),
                    model: aiModelInput.value.trim(),
                    targetLang: aiTargetLangSelect.value
                };

                if (!config.apiUrl || !config.apiKey) {
                    aiMsg.textContent = i18n.t('settings.fill_all_info');
                    aiMsg.style.color = 'var(--danger-color)';
                    return;
                }

                aiTestBtn.disabled = true;
                const originalText = aiTestBtn.textContent;
                aiTestBtn.textContent = i18n.t('settings.testing');
                aiMsg.textContent = '';

                try {
                    const result = await AIService.testConnection(config);
                    aiMsg.textContent = `✓ Success! Reply: "${result.reply}"`;
                    aiMsg.style.color = 'var(--accent-color)';
                } catch (err) {
                    aiMsg.textContent = err.message;
                    aiMsg.style.color = 'var(--danger-color)';
                } finally {
                    aiTestBtn.disabled = false;
                    aiTestBtn.textContent = originalText;
                }
            });
        }

        // 保存 AI 配置
        if (aiForm) {
            aiForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                const config = {
                    apiUrl: aiUrlInput.value.trim(),
                    apiKey: aiKeyInput.value.trim(),
                    model: aiModelInput.value.trim(),
                    temperature: parseFloat(aiTemperatureInput?.value) || 1,
                    concurrency: parseInt(aiConcurrencyInput?.value) || 5,
                    targetLang: aiTargetLangSelect.value,
                    translatePrompt: aiTranslatePromptInput.value.trim(),
                    summarizePrompt: aiSummarizePromptInput.value.trim()
                };

                try {
                    await AIService.saveConfig(config);
                    aiMsg.textContent = `✓ ${i18n.t('ai.save_success')}`;
                    aiMsg.style.color = 'var(--accent-color)';
                } catch (err) {
                    console.error('Save AI settings error:', err);
                    aiMsg.textContent = `${i18n.t('ai.api_error')}`;
                    aiMsg.style.color = 'var(--danger-color)';
                }

                setTimeout(() => {
                    aiMsg.textContent = '';
                }, 3000);
            });
        }
    },

    /**
     * 显示定时简报配置对话框

     * @param {Object} context - { feedId, groupId } 如果都为空则针对 'all'
     */
    showDigestScheduleDialog(context = {}) {
        const { feedId, groupId } = context;
        let scope = 'all';
        let scopeId = null;
        let title = i18n.t('nav.all');

        if (groupId) {
            scope = 'group';
            scopeId = groupId;
            const group = AppState.groups?.find(g => g.id == groupId);
            title = group ? group.name : 'Group';
        } else if (feedId) {
            scope = 'feed';
            scopeId = feedId;
            const feed = AppState.feeds?.find(f => f.id == feedId);
            title = feed ? feed.title : 'Feed';
        }

        const { dialog, close } = createDialog('settings-dialog', `
            <div class="settings-dialog-content" style="position: relative; max-width: 400px; min-height: 480px;">
                <button class="icon-btn close-dialog-btn" title="${i18n.t('settings.close')}" style="position: absolute; right: 16px; top: 16px; width: 32px; height: 32px;">
                    ${Icons.close}
                </button>
                <h3>${i18n.t('ai.scheduled_digest')}</h3>
                <p style="color: var(--meta-color); font-size: 0.9em; margin-bottom: 24px;">
                    ${i18n.t('ai.digest_target')}: <strong style="color: var(--text-primary);">${title}</strong>
                </p>

                <div class="schedule-loader" style="text-align: center; padding: 20px;">
                    ${i18n.t('app.loading')}
                </div>

                <form id="schedule-form" style="display: none;">
                    
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
                         <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-weight: 600;">${i18n.t('settings.enable')}</span>
                            <label class="switch">
                                <input type="checkbox" id="schedule-enabled">
                                <span class="slider round"></span>
                            </label>
                        </div>
                    </div>

                    <div id="schedule-config-area" style="transition: opacity 0.3s;">
                        <!-- Frequency Selection -->
                        <div style="margin-bottom: 20px;">
                            <div class="settings-item-label" style="margin-bottom: 8px;">${i18n.t('settings.frequency')}</div>
                            <div class="appearance-mode-group" style="margin-bottom: 0;">
                                <button type="button" class="appearance-mode-btn active" id="freq-once" style="flex: 1; justify-content: center;">
                                    ${i18n.t('settings.once_daily')}
                                </button>
                                <button type="button" class="appearance-mode-btn" id="freq-twice" style="flex: 1; justify-content: center;">
                                    ${i18n.t('settings.twice_daily')}
                                </button>
                            </div>
                            <p id="freq-desc" style="font-size: 0.85em; color: var(--meta-color); margin-top: 6px;">
                                ${i18n.t('settings.once_daily_desc')}
                            </p>
                        </div>

                        <!-- Time Picker -->
                        <div class="custom-time-picker" id="custom-time-picker" style="margin-bottom: 12px;">
                            <div class="time-picker-highlight"></div>
                            <div class="time-column hours-column">
                                ${Array.from({ length: 24 }, (_, i) => `<div class="time-item" data-value="${String(i).padStart(2, '0')}">${String(i).padStart(2, '0')}</div>`).join('')}
                            </div>
                            <div class="time-colon">:</div>
                            <div class="time-column minutes-column">
                                ${Array.from({ length: 12 }, (_, i) => {
            const min = i * 5;
            return `<div class="time-item" data-value="${String(min).padStart(2, '0')}">${String(min).padStart(2, '0')}</div>`;
        }).join('')}
                            </div>
                        </div>

                        <!-- Second Time Preview -->
                        <div id="second-time-preview" style="text-align: center; margin-bottom: 20px; font-size: 0.9em; color: var(--accent-color); display: none;">
                            <!-- JS filled -->
                        </div>
                    </div>

                    <div class="appearance-mode-group">
                        <button type="submit" class="appearance-mode-btn active" style="justify-content: center; width: 100%;">${i18n.t('common.save')}</button>
                    </div>
                    <div id="schedule-msg" style="text-align: center; margin-top: 12px; font-size: 0.85em;"></div>
                    
                    <div style="margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 16px; text-align: center;">
                         <button type="button" id="manage-others-btn" style="background: transparent; border: none; color: var(--meta-color); font-size: 0.9em; cursor: pointer; text-decoration: underline;">
                             ${i18n.t('settings.manage_all_schedules')}
                         </button>
                    </div>
                </form>

                <!-- Other Schedules View -->
                <div id="other-schedules-view" style="display: none; height: 100%; flex-direction: column;">
                     <div style="display: flex; align-items: center; margin-bottom: 16px;">
                        <button type="button" id="back-to-main-btn" class="icon-btn" style="margin-right: 8px;">
                            ${Icons.arrow_back}
                        </button>
                        <h4 style="margin: 0;">${i18n.t('settings.other_schedules')}</h4>
                     </div>
                     <div id="other-tasks-list" style="flex: 1; overflow-y: auto; padding-right: 4px;">
                         <!-- Filled by JS -->
                     </div>
                </div>
            </div>
        `);

        const closeBtn = dialog.querySelector('.close-dialog-btn');
        const loader = dialog.querySelector('.schedule-loader');
        const form = dialog.querySelector('#schedule-form');
        const enabledInput = dialog.querySelector('#schedule-enabled');
        const configArea = dialog.querySelector('#schedule-config-area');

        const freqOnceBtn = dialog.querySelector('#freq-once');
        const freqTwiceBtn = dialog.querySelector('#freq-twice');
        const freqDesc = dialog.querySelector('#freq-desc');
        const secondTimePreview = dialog.querySelector('#second-time-preview');

        const pickerContainer = dialog.querySelector('#custom-time-picker');
        const msgEl = dialog.querySelector('#schedule-msg');
        const optionsDiv = dialog.querySelector('#schedule-options'); // Keeping ref for safety although structure changed

        const manageOthersBtn = dialog.querySelector('#manage-others-btn');
        const otherSchedulesView = dialog.querySelector('#other-schedules-view');
        const backToMainBtn = dialog.querySelector('#back-to-main-btn');
        const otherTasksList = dialog.querySelector('#other-tasks-list');

        // Logic state
        let allSchedules = [];
        let isTwiceDaily = false;
        let getPickerTime = () => '08:00';

        // --- Helpers ---

        const getScopeName = (tScope, tScopeId) => {
            if (tScope === 'all') return i18n.t('nav.all');
            if (tScope === 'group') {
                const group = AppState.groups?.find(g => g.id == tScopeId);
                return group ? group.name : `Group #${tScopeId}`;
            }
            if (tScope === 'feed') {
                const feed = AppState.feeds?.find(f => f.id == tScopeId);
                return feed ? feed.title : `Feed #${tScopeId}`;
            }
            return i18n.t('common.unnamed');
        };

        const renderOtherTasks = () => {
            // Filter out tasks belonging to CURRENT scope
            const isMatch = (t) => {
                if (t.scope !== scope) return false;
                if (t.scopeId == scopeId) return true;
                return String(t.scopeId || '') === String(scopeId || '');
            };
            const others = allSchedules.filter(t => !isMatch(t));

            if (others.length === 0) {
                otherTasksList.innerHTML = `<div style="text-align: center; color: var(--meta-color); padding: 20px;">${i18n.t('settings.no_other_schedules')}</div>`;
                return;
            }



            const grouped = {};
            others.forEach(t => {
                const key = `${t.scope}_${t.scopeId}`;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(t);
            });

            otherTasksList.innerHTML = '';

            Object.keys(grouped).forEach(key => {
                const tasks = grouped[key];
                const first = tasks[0];
                const name = getScopeName(first.scope, first.scopeId);

                const card = document.createElement('div');
                card.style.cssText = `
                    background: var(--card-bg);
                    padding: 10px 16px;
                    border-radius: var(--radius);
                    margin-bottom: 8px;
                    box-shadow: var(--card-shadow);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border: none;
                `;

                const timeStr = tasks.map(t => t.time).sort().join(' & ');
                const freqLabel = tasks.length > 1 ? i18n.t('settings.twice_daily') : i18n.t('settings.once_daily');

                card.innerHTML = `
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 700; font-size: 1em; color: var(--title-color); margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</div>
                        <div style="font-size: 0.85em; color: var(--meta-color);">
                            ${freqLabel} • ${timeStr}
                        </div>
                    </div>
                    <button class="icon-btn delete-task-btn" style="color: var(--danger-color); margin-left: 8px; width: 28px; height: 28px; opacity: 0.8; transition: opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                    </button>
                `;

                // Delete logic
                card.querySelector('.delete-task-btn').onclick = async () => {
                    if (!await Modal.confirm(i18n.t('settings.confirm_delete_schedule'))) return;

                    // Remove these tasks from allSchedules
                    allSchedules = allSchedules.filter(t => !tasks.includes(t));

                    // Save immediately
                    try {
                        const response = await fetch(API_ENDPOINTS.PREFERENCES.BASE, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${AuthManager.getToken()}`
                            },
                            body: JSON.stringify({
                                key: 'digest_schedules',
                                value: allSchedules
                            })
                        });
                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}`);
                        }
                        // Re-render
                        renderOtherTasks();
                    } catch (err) {
                        console.error("Delete failed", err);
                        await Modal.alert(i18n.t('ai.api_error'));
                    }
                };

                otherTasksList.appendChild(card);
            });
        };

        const updateFrequencyUI = () => {
            if (isTwiceDaily) {
                freqOnceBtn.classList.remove('active');
                freqTwiceBtn.classList.add('active');
                freqDesc.textContent = i18n.t('settings.twice_daily_desc'); // "Every 12 hours"
                secondTimePreview.style.display = 'block';
                updateSecondTimePreview();
            } else {
                freqTwiceBtn.classList.remove('active');
                freqOnceBtn.classList.add('active');
                freqDesc.textContent = i18n.t('settings.once_daily_desc'); // "Collect last 24h content"
                secondTimePreview.style.display = 'none';
            }
        };

        const updateSecondTimePreview = () => {
            if (!isTwiceDaily) return;
            const time = getPickerTime();
            const [h, m] = time.split(':').map(Number);
            const nextH = (h + 12) % 24;
            const nextTime = `${String(nextH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            secondTimePreview.innerHTML = `${i18n.t('settings.second_run_at')} <strong>${nextTime}</strong> (+12h)`;
        };

        const setupTimePicker = (container, initialTime) => {
            let [initH, initM] = (initialTime || '08:00').split(':');

            // Round minutes to nearest 5
            let mVal = parseInt(initM, 10);
            mVal = Math.round(mVal / 5) * 5;
            if (mVal >= 60) {
                mVal = 0;
                // Ideally carry over hour, but simple clamp is fine for UI init sync
            }
            initM = String(mVal).padStart(2, '0');

            const hCol = container.querySelector('.hours-column');
            const mCol = container.querySelector('.minutes-column');
            const ITEM_HEIGHT = 40;

            const selectItem = (col, value, smooth = true) => {
                const items = Array.from(col.querySelectorAll('.time-item'));
                items.forEach(el => el.classList.remove('active'));
                const target = items.find(el => el.dataset.value === value) || items[0];
                target.classList.add('active');
                if (smooth) {
                    col.scrollTo({ top: items.indexOf(target) * ITEM_HEIGHT, behavior: 'smooth' });
                } else {
                    col.scrollTop = items.indexOf(target) * ITEM_HEIGHT;
                }
            };

            const handleScroll = (col) => {
                const scrollTop = col.scrollTop;
                const index = Math.round(scrollTop / ITEM_HEIGHT);
                const items = col.querySelectorAll('.time-item');
                if (items[index]) {
                    items.forEach(el => el.classList.remove('active'));
                    items[index].classList.add('active');
                    if (isTwiceDaily) updateSecondTimePreview();
                }
            };

            [hCol, mCol].forEach(col => {
                col.addEventListener('click', e => {
                    if (e.target.classList.contains('time-item')) {
                        selectItem(col, e.target.dataset.value);
                        if (isTwiceDaily) updateSecondTimePreview();
                    }
                });
                let scrollTimeout;
                col.addEventListener('scroll', () => {
                    clearTimeout(scrollTimeout);
                    scrollTimeout = setTimeout(() => handleScroll(col), 100);
                });
            });

            // Init
            setTimeout(() => {
                selectItem(hCol, initH, false);
                selectItem(mCol, initM, false);
            }, 50);

            return () => {
                const h = hCol.querySelector('.active')?.dataset.value || '00';
                const m = mCol.querySelector('.active')?.dataset.value || '00';
                return `${h}:${m}`;
            };
        };

        // --- Events ---

        closeBtn.addEventListener('click', close);

        freqOnceBtn.addEventListener('click', () => { isTwiceDaily = false; updateFrequencyUI(); });
        freqTwiceBtn.addEventListener('click', () => { isTwiceDaily = true; updateFrequencyUI(); });

        enabledInput.addEventListener('change', () => {
            configArea.style.opacity = enabledInput.checked ? '1' : '0.5';
            configArea.style.pointerEvents = enabledInput.checked ? 'auto' : 'none';
        });

        manageOthersBtn.addEventListener('click', () => {
            form.style.display = 'none';
            otherSchedulesView.style.display = 'flex';
            renderOtherTasks();
        });

        backToMainBtn.addEventListener('click', () => {
            otherSchedulesView.style.display = 'none';
            form.style.display = 'block';
        });

        // Fetch
        // --- Load Data ---

        fetch(API_ENDPOINTS.PREFERENCES.BASE, {
            headers: { 'Authorization': `Bearer ${AuthManager.getToken()}` }
        })
            .then(res => res.json())
            .then(prefs => {
                allSchedules = prefs.digest_schedules || [];

                // Filter tasks for current scope
                const existingTasks = allSchedules.filter(t =>
                    t.scope === scope && String(t.scopeId || '') === String(scopeId || '')
                );

                // Determine initial state
                // If we have > 1 enabled task, or > 1 task total, assume Twice daily
                // Otherwise Once daily
                if (existingTasks.length > 1) {
                    isTwiceDaily = true;
                } else {
                    isTwiceDaily = false;
                }

                const firstTask = existingTasks[0];
                const initialTime = firstTask ? firstTask.time : '08:00';

                // Determine if enabled: if any task is enabled (or logic preference)
                const isEnabled = existingTasks.length > 0 && existingTasks.some(t => t.enabled);

                enabledInput.checked = isEnabled;

                configArea.style.opacity = enabledInput.checked ? '1' : '0.5';
                configArea.style.pointerEvents = enabledInput.checked ? 'auto' : 'none';

                getPickerTime = setupTimePicker(pickerContainer, initialTime);
                updateFrequencyUI();

                loader.style.display = 'none';
                form.style.display = 'block';
            })
            .catch(err => {
                console.error('Load error', err);
                loader.textContent = i18n.t('common.load_error');
            });

        // --- Save ---

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = i18n.t('settings.saving');
            msgEl.textContent = '';

            const time = getPickerTime();
            const isEnabled = enabledInput.checked;

            // Build new tasks
            const newTasks = [];

            if (isTwiceDaily) {
                // Task 1
                newTasks.push({
                    id: generateUUID(),
                    scope: scope,
                    scopeId: scopeId,
                    feedId: scope === 'feed' ? scopeId : null,
                    groupId: scope === 'group' ? scopeId : null,
                    time: time,
                    enabled: isEnabled,
                    hours: 12, // 12h range

                });
                // Task 2 (+12h)
                const [h, m] = time.split(':').map(Number);
                const nextH = (h + 12) % 24;
                const nextTime = `${String(nextH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

                newTasks.push({
                    id: generateUUID(),
                    scope: scope,
                    scopeId: scopeId,
                    feedId: scope === 'feed' ? scopeId : null,
                    groupId: scope === 'group' ? scopeId : null,
                    time: nextTime,
                    enabled: isEnabled,
                    hours: 12, // 12h range

                });
            } else {
                // Task 1 (Once)
                newTasks.push({
                    id: generateUUID(),
                    scope: scope,
                    scopeId: scopeId,
                    feedId: scope === 'feed' ? scopeId : null,
                    groupId: scope === 'group' ? scopeId : null,
                    time: time,
                    enabled: isEnabled,
                    hours: 24, // 24h range for once daily

                });
            }

            // Merge with backend data
            // Remove OLD tasks for this scope
            const isMatch = (t) => {
                if (t.scope !== scope) return false;
                if (t.scopeId == scopeId) return true;
                return String(t.scopeId || '') === String(scopeId || '');
            };
            const otherTasks = allSchedules.filter(t => !isMatch(t));

            const finalTasks = [...otherTasks, ...newTasks];

            try {
                const response = await fetch(API_ENDPOINTS.PREFERENCES.BASE, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${AuthManager.getToken()}`
                    },
                    body: JSON.stringify({
                        key: 'digest_schedules',
                        value: finalTasks
                    })
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                msgEl.textContent = `✓ ${i18n.t('settings.save_success')}`;
                msgEl.style.color = 'var(--accent-color)';
                setTimeout(close, 1000);
            } catch (err) {
                console.error('Save error:', err);
                msgEl.textContent = i18n.t('ai.api_error');
                msgEl.style.color = 'var(--danger-color)';
                submitBtn.disabled = false;
                submitBtn.textContent = i18n.t('common.save');
            }
        });
    },

    /**
     * 异步加载 Miniflux 配置逻辑
     */
    async _loadMinifluxConfig(minifluxConfigInfo) {
        try {
            const config = await AuthManager.getMinifluxConfig();
            if (config.configured) {
                this._renderMinifluxConfigured(minifluxConfigInfo, config);
            } else {
                this._renderMinifluxConfigForm(minifluxConfigInfo);
            }
        } catch (err) {
            console.error('Load Miniflux config error:', err);
            minifluxConfigInfo.innerHTML = `
                <div class="miniflux-config-error" style="text-align: center; color: var(--danger-color); margin-bottom: 12px;">${i18n.t('common.load_error')}</div>
                <div class="appearance-mode-group">
                    <button id="retry-miniflux-btn" class="appearance-mode-btn" style="width: 100%; justify-content: center;">${i18n.t('settings.edit_connection')}</button>
                </div>
            `;
            minifluxConfigInfo.querySelector('#retry-miniflux-btn')?.addEventListener('click', () => {
                this._renderMinifluxConfigForm(minifluxConfigInfo);
            });
        }
    },

    /**
     * 渲染已配置状态
     */
    _renderMinifluxConfigured(container, config) {
        const sourceText = config.source === 'env' ? i18n.t('settings.env_var') : i18n.t('settings.manual_config');
        const isEnv = config.source === 'env';

        container.innerHTML = `
            <div class="miniflux-config-item">
                <span class="miniflux-config-label">${i18n.t('settings.status')}</span>
                <span class="miniflux-config-value miniflux-status-connected" id="miniflux-status-value">
                    <span class="status-dot" style="background-color: var(--meta-color);"></span>${i18n.t('settings.connected')} ${sourceText} <span style="font-size: 0.9em; opacity: 0.8;">(${i18n.t('app.loading')}...)</span>
                </span>
            </div>
            <div class="miniflux-config-item">
                <span class="miniflux-config-label">${i18n.t('settings.server_url')}</span>
                <span class="miniflux-config-value">${config.url}</span>
            </div>
            <div class="miniflux-config-item">
                <span class="miniflux-config-label">${config.authType === 'api_key' ? i18n.t('settings.auth_api_key') : i18n.t('settings.username')}</span>
                <span class="miniflux-config-value">${config.authType === 'api_key' ? '********' : (config.username || '-')}</span>
            </div>
            ${!isEnv ? `
            <div class="appearance-mode-group" style="margin-top: 12px;">
                <button id="edit-miniflux-config-btn" class="appearance-mode-btn" style="justify-content: center; width: 100%;">${i18n.t('settings.edit_connection')}</button>
            </div>
            ` : ''}
        `;

        // 异步检查真实连接状态
        AuthManager.getMinifluxStatus().then(status => {
            const statusEl = container.querySelector('#miniflux-status-value');
            if (!statusEl) return;

            if (status.connected) {
                statusEl.innerHTML = `<span class="status-dot"></span>${i18n.t('settings.connected')} ${sourceText}`;
            } else {
                statusEl.className = 'miniflux-config-value miniflux-status-disconnected';
                statusEl.style.color = 'var(--danger-color)';
                statusEl.innerHTML = `<span class="status-dot" style="background-color: var(--danger-color);"></span>${i18n.t('auth.login_failed')}: ${status.error || 'Connection Invalid'}`;
            }
        }).catch(err => {
            const statusEl = container.querySelector('#miniflux-status-value');
            if (statusEl) {
                statusEl.className = 'miniflux-config-value miniflux-status-disconnected';
                statusEl.style.color = 'var(--danger-color)';
                statusEl.innerHTML = `<span class="status-dot" style="background-color: var(--danger-color);"></span>Error: ${err.message}`;
            }
        });

        if (!isEnv) {
            container.querySelector('#edit-miniflux-config-btn')?.addEventListener('click', () => {
                this._renderMinifluxConfigForm(container, config);
            });
        }
    },

    /**
     * 渲染 Miniflux 配置表单
     */
    _renderMinifluxConfigForm(container, prefill = null) {
        const isEditing = !!prefill;
        const authType = prefill?.authType || 'basic';

        container.innerHTML = `
            <div class="miniflux-config-item">
                <span class="miniflux-config-label">${i18n.t('settings.status')}</span>
                <span class="miniflux-config-value miniflux-status-disconnected">
                    <span class="status-dot"></span>${isEditing ? i18n.t('settings.editing') : i18n.t('settings.not_configured')}
                </span>
            </div>
            <form id="miniflux-config-form" class="miniflux-config-form">
                <label class="miniflux-input-label">${i18n.t('settings.miniflux_url')}</label>
                <input type="text" id="miniflux-url" class="auth-input" placeholder="https://miniflux.example.com" style="margin-bottom: 12px;" value="${prefill?.url || ''}" required>
                
                <label class="miniflux-input-label">${i18n.t('settings.auth_method')}</label>
                <div class="auth-type-selector" style="display:flex; gap:10px; margin-bottom:12px;">
                    <button type="button" class="appearance-mode-btn ${authType === 'basic' ? 'active' : ''}" id="auth-type-basic" style="flex:1; justify-content:center;">${i18n.t('settings.auth_basic')}</button>
                    <button type="button" class="appearance-mode-btn ${authType === 'api_key' ? 'active' : ''}" id="auth-type-apikey" style="flex:1; justify-content:center;">${i18n.t('settings.auth_api_key')}</button>
                </div>

                <div id="auth-fields-basic" style="${authType === 'basic' ? 'display:block' : 'display:none'}">
                    <label class="miniflux-input-label">${i18n.t('settings.username_password')}</label>
                    <input type="text" id="miniflux-username" class="auth-input" placeholder="admin" style="margin-bottom: 8px;" value="${prefill?.username || ''}">
                    <input type="password" id="miniflux-password" class="auth-input" placeholder="${isEditing ? i18n.t('settings.enter_new_password') : '••••••••'}" style="margin-bottom: 12px;">
                </div>

                <div id="auth-fields-apikey" style="${authType === 'api_key' ? 'display:block' : 'display:none'}">
                    <label class="miniflux-input-label">${i18n.t('settings.auth_api_key')}</label>
                    <input type="password" id="miniflux-api-key" class="auth-input" placeholder="${i18n.t('settings.api_key_placeholder')}" style="margin-bottom: 12px;" value="${prefill?.apiKey || ''}" autocomplete="off">
                </div>

                <div class="appearance-mode-group">
                    ${isEditing ? `<button type="button" id="miniflux-cancel-btn" class="appearance-mode-btn" style="flex: 1;">${i18n.t('common.cancel')}</button>` : ''}
                    <button type="button" id="miniflux-test-btn" class="appearance-mode-btn" style="flex: 1;">${i18n.t('settings.test_connection')}</button>
                    <button type="submit" class="appearance-mode-btn active" style="flex: 1;">${i18n.t('settings.save_config')}</button>
                </div>
                <div id="miniflux-config-msg" style="text-align: center; margin-top: 8px; font-size: 0.85em;"></div>
            </form>
        `;

        this._bindMinifluxFormEvents(container, isEditing);
    },

    /**
     * 绑定 Miniflux 配置表单事件
     */
    _bindMinifluxFormEvents(container, isEditing) {
        const form = container.querySelector('#miniflux-config-form');
        const testBtn = container.querySelector('#miniflux-test-btn');
        const cancelBtn = container.querySelector('#miniflux-cancel-btn');
        const msgEl = container.querySelector('#miniflux-config-msg');

        const btnBasic = container.querySelector('#auth-type-basic');
        const btnApiKey = container.querySelector('#auth-type-apikey');
        const fieldsBasic = container.querySelector('#auth-fields-basic');
        const fieldsApiKey = container.querySelector('#auth-fields-apikey');

        let currentAuthType = btnBasic.classList.contains('active') ? 'basic' : 'api_key';

        btnBasic.addEventListener('click', () => {
            currentAuthType = 'basic';
            btnBasic.classList.add('active');
            btnApiKey.classList.remove('active');
            fieldsBasic.style.display = 'block';
            fieldsApiKey.style.display = 'none';
        });

        btnApiKey.addEventListener('click', () => {
            currentAuthType = 'api_key';
            btnBasic.classList.remove('active');
            btnApiKey.classList.add('active');
            fieldsBasic.style.display = 'none';
            fieldsApiKey.style.display = 'block';
        });

        const getFormData = () => {
            const urlInput = container.querySelector('#miniflux-url');
            let url = urlInput.value.trim();
            if (url && !url.match(/^https?:\/\//i)) url = 'https://' + url;
            url = url.replace(/\/+$/, '');
            urlInput.value = url;

            if (currentAuthType === 'basic') {
                return {
                    url,
                    username: container.querySelector('#miniflux-username').value.trim(),
                    password: container.querySelector('#miniflux-password').value,
                    authType: 'basic'
                };
            } else {
                return {
                    url,
                    apiKey: container.querySelector('#miniflux-api-key').value.trim(),
                    authType: 'api_key'
                };
            }
        };

        testBtn.addEventListener('click', async () => {
            const data = getFormData();
            if (!data.url || (data.authType === 'basic' && (!data.username || !data.password)) || (data.authType === 'api_key' && !data.apiKey)) {
                msgEl.textContent = i18n.t('settings.fill_all_info');
                msgEl.style.color = 'var(--danger-color)';
                return;
            }

            testBtn.disabled = true;
            testBtn.textContent = i18n.t('settings.testing');
            msgEl.textContent = '';

            try {
                const result = await AuthManager.testMinifluxConnection(data.url, data.username, data.password, data.apiKey, data.authType);
                msgEl.textContent = `✓ ${i18n.t('settings.connection_success')} (${result.user})`;
                msgEl.style.color = 'var(--accent-color)';
            } catch (err) {
                msgEl.textContent = err.message;
                msgEl.style.color = 'var(--danger-color)';
            } finally {
                testBtn.disabled = false;
                testBtn.textContent = i18n.t('settings.test_connection');
            }
        });

        cancelBtn?.addEventListener('click', async () => {
            const config = await AuthManager.getMinifluxConfig();
            this._renderMinifluxConfigured(container, config);
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = getFormData();
            if (data.authType === 'basic' && !data.password) {
                msgEl.textContent = i18n.t('settings.fill_all_info');
                msgEl.style.color = 'var(--danger-color)';
                return;
            }

            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = i18n.t('settings.saving');

            try {
                await AuthManager.saveMinifluxConfig(data.url, data.username, data.password, data.apiKey, data.authType);
                msgEl.textContent = `✓ ${i18n.t('settings.save_success_refresh')}`;
                msgEl.style.color = 'var(--accent-color)';
                setTimeout(() => window.location.reload(), 1000);
            } catch (err) {
                msgEl.textContent = err.message;
                msgEl.style.color = 'var(--danger-color)';
                submitBtn.disabled = false;
                submitBtn.textContent = i18n.t('settings.save_config');
            }
        });
    },

    /**
     * 显示简报管理器对话框
     */
    showDigestManagerDialog() {
        const { dialog, close } = createDialog('settings-dialog digest-manager-dialog', `
            <div class="settings-dialog-content" style="position: relative; max-width: 900px; min-height: 600px;">
                <button class="icon-btn close-dialog-btn" title="${i18n.t('common.close')}" style="position: absolute; right: 16px; top: 16px; width: 32px; height: 32px; z-index: 10;">
                    ${Icons.close}
                </button>
                <h3>${i18n.t('digest.manager_title')}</h3>
                
                <!-- 任务列表 -->
                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('digest.task_list')}</div>
                    <div id="digest-tasks-container" style="margin-bottom: 16px;">
                        <div style="text-align: center; padding: 20px; color: var(--meta-color);">
                            ${i18n.t('common.loading')}
                        </div>
                    </div>
                    <div class="appearance-mode-group">
                        <button type="button" id="add-digest-task-btn" class="appearance-mode-btn active" style="justify-content: center; width: 100%;">
                            ${i18n.t('digest.add_task')}
                        </button>
                    </div>
                </div>

                <!-- 推送设置 -->
                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('digest.push_settings')}</div>
                    <form id="push-settings-form">
                        <label class="miniflux-input-label">${i18n.t('digest.request_url')}</label>
                        <input type="text" id="push-url" class="auth-input" placeholder="${i18n.t('digest.request_url_placeholder')}" style="margin-bottom: 8px;">
                        
                        <label class="miniflux-input-label">${i18n.t('digest.request_method')}</label>
                        <select id="push-method" class="dialog-select" style="margin-bottom: 8px;">
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                        </select>
                        
                        <label class="miniflux-input-label">${i18n.t('digest.request_body')}</label>
                        <div style="font-size: 0.85em; color: var(--meta-color); margin-bottom: 4px;">
                            ${i18n.t('digest.request_body_hint')}
                        </div>
                        <textarea id="push-body" class="auth-input" rows="6" placeholder="${i18n.t('digest.request_body_placeholder')}" style="margin-bottom: 12px; resize: vertical; min-height: 120px; font-family: monospace;"></textarea>
                        
                        <div class="appearance-mode-group" style="margin-bottom: 8px;">
                            <button type="button" id="push-test-btn" class="appearance-mode-btn" style="flex: 1;">${i18n.t('digest.push_test')}</button>
                            <button type="submit" class="appearance-mode-btn active" style="flex: 1;">${i18n.t('common.save')}</button>
                        </div>
                        <div id="push-settings-msg" style="font-size: 0.85em; margin-top: 8px;"></div>
                        
                        <div id="push-test-result" style="display: none; margin-top: 12px; padding: 12px; background: var(--card-bg); border-radius: var(--radius); max-height: 200px; overflow-y: auto;">
                            <div style="font-weight: 600; margin-bottom: 8px; color: var(--text-primary);">${i18n.t('digest.push_result')}:</div>
                            <pre id="push-result-content" style="margin: 0; white-space: pre-wrap; word-wrap: break-word; font-size: 0.85em; color: var(--meta-color);"></pre>
                        </div>
                    </form>
                </div>
            </div>
        `);

        const closeBtn = dialog.querySelector('.close-dialog-btn');
        const tasksContainer = dialog.querySelector('#digest-tasks-container');
        const addTaskBtn = dialog.querySelector('#add-digest-task-btn');
        const pushForm = dialog.querySelector('#push-settings-form');
        const pushUrlInput = dialog.querySelector('#push-url');
        const pushMethodSelect = dialog.querySelector('#push-method');
        const pushBodyInput = dialog.querySelector('#push-body');
        const pushTestBtn = dialog.querySelector('#push-test-btn');
        const pushMsg = dialog.querySelector('#push-settings-msg');
        const pushTestResult = dialog.querySelector('#push-test-result');
        const pushResultContent = dialog.querySelector('#push-result-content');

        closeBtn.addEventListener('click', close);
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) close();
        });

        // 加载任务列表
        this._loadDigestTasks(tasksContainer);

        // 加载推送设置
        this._loadPushSettings(pushUrlInput, pushMethodSelect, pushBodyInput);

        // 添加任务按钮
        addTaskBtn.addEventListener('click', () => {
            this.showDigestTaskEditDialog(null, () => {
                this._loadDigestTasks(tasksContainer);
            });
        });

        // 推送测试
        pushTestBtn.addEventListener('click', async () => {
            const url = pushUrlInput.value.trim();
            const method = pushMethodSelect.value;
            const body = pushBodyInput.value.trim();

            if (!url) {
                pushMsg.textContent = i18n.t('settings.fill_all_info');
                pushMsg.style.color = 'var(--danger-color)';
                return;
            }

            pushTestBtn.disabled = true;
            pushTestBtn.textContent = i18n.t('digest.push_testing');
            pushMsg.textContent = '';
            pushTestResult.style.display = 'none';

            try {
                const testContent = 'This is a test push notification from Tidyflux Digest Manager.';
                const result = await this._sendPushRequest(url, method, body, testContent);
                
                pushMsg.textContent = `✓ ${i18n.t('digest.push_success')}`;
                pushMsg.style.color = 'var(--accent-color)';
                pushTestResult.style.display = 'block';
                pushResultContent.textContent = JSON.stringify(result, null, 2);
            } catch (err) {
                pushMsg.textContent = `${i18n.t('digest.push_failed')}: ${err.message}`;
                pushMsg.style.color = 'var(--danger-color)';
                pushTestResult.style.display = 'block';
                pushResultContent.textContent = err.message;
            } finally {
                pushTestBtn.disabled = false;
                pushTestBtn.textContent = i18n.t('digest.push_test');
            }
        });

        // 保存推送设置
        pushForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const config = {
                url: pushUrlInput.value.trim(),
                method: pushMethodSelect.value,
                body: pushBodyInput.value.trim()
            };

            try {
                await this._savePushSettings(config);
                pushMsg.textContent = `✓ ${i18n.t('digest.settings_saved')}`;
                pushMsg.style.color = 'var(--accent-color)';
            } catch (err) {
                pushMsg.textContent = err.message;
                pushMsg.style.color = 'var(--danger-color)';
            }

            setTimeout(() => {
                pushMsg.textContent = '';
            }, 3000);
        });
    },

    /**
     * 加载简报任务列表
     */
    async _loadDigestTasks(container) {
        try {
            const response = await AuthManager.fetchWithAuth(API_ENDPOINTS.PREFERENCES.BASE);
            if (!response.ok) throw new Error('Failed to load tasks');
            
            const prefs = await response.json();
            const tasks = prefs.digest_tasks || [];

            if (tasks.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px 20px; color: var(--meta-color);">
                        ${i18n.t('digest.no_tasks')}
                    </div>
                `;
                return;
            }

            // 渲染任务列表
            container.innerHTML = `
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="border-bottom: 2px solid var(--border-color);">
                                <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: var(--text-secondary);">${i18n.t('digest.task_title')}</th>
                                <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: var(--text-secondary);">${i18n.t('digest.digest_title')}</th>
                                <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: var(--text-secondary);">${i18n.t('digest.task_scope')}</th>
                                <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: var(--text-secondary);">${i18n.t('digest.trigger_time')}</th>
                                <th style="padding: 12px 8px; text-align: center; font-weight: 600; color: var(--text-secondary);">${i18n.t('digest.time_range')}</th>
                                <th style="padding: 12px 8px; text-align: center; font-weight: 600; color: var(--text-secondary);">${i18n.t('digest.enable_push')}</th>
                                <th style="padding: 12px 8px; text-align: center; font-weight: 600; color: var(--text-secondary);">${i18n.t('digest.include_read')}</th>
                                <th style="padding: 12px 8px; text-align: center; font-weight: 600; color: var(--text-secondary);">${i18n.t('digest.options')}</th>
                            </tr>
                        </thead>
                        <tbody id="tasks-tbody">
                        </tbody>
                    </table>
                </div>
            `;

            const tbody = container.querySelector('#tasks-tbody');
            tasks.forEach(task => {
                const row = document.createElement('tr');
                row.style.borderBottom = '1px solid var(--border-color)';
                
                const scopeNames = this._getTaskScopeNames(task.scopes);
                const timeRangeText = task.timeRange ? `${task.timeRange}h` : '-';
                const digestTitleText = task.digestTitle || '-';
                
                row.innerHTML = `
                    <td style="padding: 12px 8px;">${task.title || i18n.t('common.unnamed')}</td>
                    <td style="padding: 12px 8px; font-size: 0.9em; color: var(--meta-color);">${digestTitleText}</td>
                    <td style="padding: 12px 8px; font-size: 0.9em; color: var(--meta-color);">${scopeNames}</td>
                    <td style="padding: 12px 8px; font-size: 0.9em; font-family: monospace;">${task.cronExpression}</td>
                    <td style="padding: 12px 8px; text-align: center; font-size: 0.9em;">${timeRangeText}</td>
                    <td style="padding: 12px 8px; text-align: center;">${task.enablePush ? i18n.t('digest.yes') : i18n.t('digest.no')}</td>
                    <td style="padding: 12px 8px; text-align: center;">${task.includeRead ? i18n.t('digest.yes') : i18n.t('digest.no')}</td>
                    <td style="padding: 12px 8px; text-align: center;">
                        <button class="icon-btn edit-task-btn" data-task-id="${task.id}" style="margin-right: 4px;" title="${i18n.t('digest.edit_task')}">
                            ${Icons.edit}
                        </button>
                        <button class="icon-btn delete-task-btn" data-task-id="${task.id}" style="color: var(--danger-color);" title="${i18n.t('digest.delete_task')}">
                            ${Icons.delete}
                        </button>
                    </td>
                `;

                tbody.appendChild(row);
            });

            // 绑定编辑和删除事件
            container.querySelectorAll('.edit-task-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const taskId = btn.dataset.taskId;
                    const task = tasks.find(t => t.id === taskId);
                    this.showDigestTaskEditDialog(task, () => {
                        this._loadDigestTasks(container);
                    });
                });
            });

            container.querySelectorAll('.delete-task-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!await Modal.confirm(i18n.t('digest.confirm_delete_task'))) return;
                    
                    const taskId = btn.dataset.taskId;
                    await this._deleteDigestTask(taskId);
                    this._loadDigestTasks(container);
                });
            });

        } catch (err) {
            console.error('Load digest tasks error:', err);
            container.innerHTML = `
                <div style="text-align: center; padding: 20px; color: var(--danger-color);">
                    ${i18n.t('common.load_error')}
                </div>
            `;
        }
    },

    /**
     * 获取任务范围名称
     */
    _getTaskScopeNames(scopes) {
        if (!scopes || scopes.length === 0) return i18n.t('digest.scope_all');
        
        if (scopes.includes('all')) return i18n.t('digest.scope_all');
        
        const names = scopes.map(scopeId => {
            // 尝试从分组中查找
            const group = AppState.groups?.find(g => g.id == scopeId);
            if (group) return group.name;
            
            // 尝试从订阅源中查找
            const feed = AppState.feeds?.find(f => f.id == scopeId);
            if (feed) return feed.title;
            
            return `#${scopeId}`;
        });
        
        return names.join(', ');
    },

    /**
     * 删除简报任务
     */
    async _deleteDigestTask(taskId) {
        const response = await AuthManager.fetchWithAuth(API_ENDPOINTS.PREFERENCES.BASE);
        if (!response.ok) throw new Error('Failed to load tasks');
        
        const prefs = await response.json();
        const tasks = prefs.digest_tasks || [];
        const newTasks = tasks.filter(t => t.id !== taskId);

        const saveResponse = await AuthManager.fetchWithAuth(API_ENDPOINTS.PREFERENCES.BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: 'digest_tasks',
                value: newTasks
            })
        });

        if (!saveResponse.ok) throw new Error('Failed to delete task');
    },

    /**
     * 加载推送设置
     */
    async _loadPushSettings(urlInput, methodSelect, bodyInput) {
        try {
            const response = await AuthManager.fetchWithAuth(API_ENDPOINTS.PREFERENCES.BASE);
            if (!response.ok) return;
            
            const prefs = await response.json();
            const pushSettings = prefs.push_settings || {};

            urlInput.value = pushSettings.url || '';
            methodSelect.value = pushSettings.method || 'POST';
            bodyInput.value = pushSettings.body || '';
        } catch (err) {
            console.error('Load push settings error:', err);
        }
    },

    /**
     * 保存推送设置
     */
    async _savePushSettings(config) {
        const response = await AuthManager.fetchWithAuth(API_ENDPOINTS.PREFERENCES.BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: 'push_settings',
                value: config
            })
        });

        if (!response.ok) throw new Error('Failed to save push settings');
    },

    /**
     * 发送推送请求
     */
    async _sendPushRequest(url, method, bodyTemplate, content) {
        // 替换模板变量
        const now = new Date();
        const replacements = {
            summary_content: content,
            yyyy: now.getFullYear(),
            MM: String(now.getMonth() + 1).padStart(2, '0'),
            dd: String(now.getDate()).padStart(2, '0'),
            HH: String(now.getHours()).padStart(2, '0'),
            mm: String(now.getMinutes()).padStart(2, '0'),
            ss: String(now.getSeconds()).padStart(2, '0')
        };

        let processedBody = bodyTemplate;
        Object.keys(replacements).forEach(key => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            processedBody = processedBody.replace(regex, replacements[key]);
        });

        // 处理中英文引号
        processedBody = processedBody.replace(/[""]/g, '"').replace(/['']/g, "'");

        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (method === 'POST' && processedBody) {
            options.body = processedBody;
        }

        const response = await fetch(url, options);
        const text = await response.text();
        
        try {
            return JSON.parse(text);
        } catch {
            return { status: response.status, body: text };
        }
    },

    /**
     * 显示任务编辑对话框
     */
    showDigestTaskEditDialog(task, onSave) {
        const isEdit = !!task;
        const { dialog, close } = createDialog('settings-dialog digest-task-edit-dialog', `
            <div class="settings-dialog-content" style="position: relative; max-width: 700px; max-height: 90vh; overflow-y: auto;">
                <button class="icon-btn close-dialog-btn" title="${i18n.t('common.close')}" style="position: absolute; right: 16px; top: 16px; width: 32px; height: 32px; z-index: 10;">
                    ${Icons.close}
                </button>
                <h3>${isEdit ? i18n.t('digest.edit_task') : i18n.t('digest.add_task')}</h3>
                
                <form id="task-edit-form">
                    <!-- 任务标题 -->
                    <div style="margin-bottom: 16px;">
                        <label class="miniflux-input-label">${i18n.t('digest.task_title')}</label>
                        <input type="text" id="task-title" class="auth-input" placeholder="${i18n.t('digest.title_placeholder')}" style="margin-bottom: 4px;" required>
                        <div style="font-size: 0.85em; color: var(--meta-color);">
                            ${i18n.t('digest.title_hint')}
                        </div>
                    </div>

                    <!-- 简报标题 -->
                    <div style="margin-bottom: 16px;">
                        <label class="miniflux-input-label">${i18n.t('digest.digest_title')}</label>
                        <input type="text" id="digest-title" class="auth-input" placeholder="${i18n.t('digest.digest_title_placeholder')}" style="margin-bottom: 4px;">
                        <div style="font-size: 0.85em; color: var(--meta-color);">
                            ${i18n.t('digest.digest_title_hint')}
                        </div>
                    </div>

                    <!-- 总结范围 -->
                    <div style="margin-bottom: 16px;">
                        <label class="miniflux-input-label">${i18n.t('digest.scope_select')}</label>
                        <div id="scope-tags-container" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; min-height: 40px; padding: 8px; border: 1px solid var(--border-color); border-radius: var(--radius); background: var(--card-bg);">
                            <!-- 标签将在这里显示 -->
                        </div>
                        <select id="scope-selector" class="dialog-select" style="margin-bottom: 4px;">
                            <option value="">${i18n.t('digest.scope_select')}</option>
                            <option value="all">${i18n.t('digest.scope_all')}</option>
                        </select>
                        <div style="font-size: 0.85em; color: var(--meta-color);">
                            ${i18n.t('digest.scope_hint')}
                        </div>
                    </div>

                    <!-- 自定义提示词 -->
                    <div style="margin-bottom: 16px;">
                        <label class="miniflux-input-label">${i18n.t('digest.custom_prompt')}</label>
                        <textarea id="task-prompt" class="auth-input" rows="4" placeholder="${i18n.t('digest.prompt_placeholder')}" style="margin-bottom: 4px; resize: vertical; min-height: 100px; font-family: monospace;"></textarea>
                        <div style="font-size: 0.85em; color: var(--meta-color);">
                            ${i18n.t('digest.prompt_hint')}
                        </div>
                    </div>

                    <!-- Cron表达式 -->
                    <div style="margin-bottom: 16px;">
                        <label class="miniflux-input-label">${i18n.t('digest.cron_expression')}</label>
                        <div style="display: flex; gap: 8px; margin-bottom: 4px;">
                            <input type="text" id="task-cron" class="auth-input" placeholder="${i18n.t('digest.cron_placeholder')}" style="flex: 1;" required>
                            <button type="button" id="parse-cron-btn" class="appearance-mode-btn" style="padding: 0 20px;">${i18n.t('digest.parse_cron')}</button>
                        </div>
                        <div style="font-size: 0.85em; color: var(--meta-color); margin-bottom: 8px;">
                            ${i18n.t('digest.cron_hint')}
                        </div>
                        <div id="cron-next-runs" style="display: none; padding: 8px; background: var(--card-bg); border-radius: var(--radius); font-size: 0.85em;">
                            <div style="font-weight: 600; margin-bottom: 4px; color: var(--text-primary);">${i18n.t('digest.next_runs')}:</div>
                            <div id="cron-runs-list" style="color: var(--meta-color);"></div>
                        </div>
                    </div>

                    <!-- 时间范围 -->
                    <div style="margin-bottom: 16px;">
                        <label class="miniflux-input-label">${i18n.t('digest.time_range')}</label>
                        <input type="number" id="task-time-range" class="auth-input" value="24" min="1" required style="margin-bottom: 4px;">
                        <div style="font-size: 0.85em; color: var(--meta-color);">
                            ${i18n.t('digest.time_range_hours_hint')}
                        </div>
                    </div>

                    <!-- 选项 -->
                    <div style="margin-bottom: 16px;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                            <input type="checkbox" id="task-include-read" style="width: 18px; height: 18px; cursor: pointer;">
                            <label for="task-include-read" style="cursor: pointer; user-select: none;">${i18n.t('digest.include_read_articles')}</label>
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <input type="checkbox" id="task-enable-push" style="width: 18px; height: 18px; cursor: pointer;">
                            <label for="task-enable-push" style="cursor: pointer; user-select: none;">${i18n.t('digest.enable_push_notify')}</label>
                        </div>
                    </div>

                    <!-- 按钮 -->
                    <div class="appearance-mode-group" style="margin-bottom: 8px;">
                        <button type="button" id="manual-trigger-btn" class="appearance-mode-btn" style="flex: 1;">${i18n.t('digest.manual_trigger')}</button>
                        <button type="submit" class="appearance-mode-btn active" style="flex: 1;">${i18n.t('common.save')}</button>
                    </div>
                    <div id="task-edit-msg" style="text-align: center; font-size: 0.85em; margin-top: 8px;"></div>
                </form>
            </div>
        `);

        const closeBtn = dialog.querySelector('.close-dialog-btn');
        const form = dialog.querySelector('#task-edit-form');
        const titleInput = dialog.querySelector('#task-title');
        const digestTitleInput = dialog.querySelector('#digest-title');
        const scopeTagsContainer = dialog.querySelector('#scope-tags-container');
        const scopeSelector = dialog.querySelector('#scope-selector');
        const promptInput = dialog.querySelector('#task-prompt');
        const cronInput = dialog.querySelector('#task-cron');
        const parseCronBtn = dialog.querySelector('#parse-cron-btn');
        const cronNextRuns = dialog.querySelector('#cron-next-runs');
        const cronRunsList = dialog.querySelector('#cron-runs-list');
        const timeRangeInput = dialog.querySelector('#task-time-range');
        const includeReadCheckbox = dialog.querySelector('#task-include-read');
        const enablePushCheckbox = dialog.querySelector('#task-enable-push');
        const manualTriggerBtn = dialog.querySelector('#manual-trigger-btn');
        const msgEl = dialog.querySelector('#task-edit-msg');

        let selectedScopes = [];

        closeBtn.addEventListener('click', close);
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) close();
        });

        // 填充范围选择器
        const groups = AppState.groups || [];
        groups.forEach(group => {
            const option = document.createElement('option');
            option.value = `group_${group.id}`;
            option.textContent = group.name;
            scopeSelector.appendChild(option);
        });

        // 渲染已选择的标签
        const renderScopeTags = () => {
            scopeTagsContainer.innerHTML = '';
            
            if (selectedScopes.length === 0) {
                scopeTagsContainer.innerHTML = '<span style="color: var(--meta-color); font-size: 0.9em;">未选择范围</span>';
                return;
            }

            selectedScopes.forEach(scopeId => {
                const tag = document.createElement('span');
                tag.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 4px 10px;
                    background: var(--accent-color);
                    color: white;
                    border-radius: 12px;
                    font-size: 0.85em;
                    cursor: pointer;
                    transition: opacity 0.2s;
                `;
                tag.onmouseover = () => tag.style.opacity = '0.8';
                tag.onmouseout = () => tag.style.opacity = '1';

                let name = '';
                if (scopeId === 'all') {
                    name = i18n.t('digest.scope_all');
                } else if (scopeId.startsWith('group_')) {
                    const groupId = scopeId.replace('group_', '');
                    const group = groups.find(g => g.id == groupId);
                    name = group ? group.name : `Group #${groupId}`;
                }

                tag.innerHTML = `
                    ${name}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                `;

                tag.addEventListener('click', () => {
                    selectedScopes = selectedScopes.filter(s => s !== scopeId);
                    renderScopeTags();
                    updateScopeSelector();
                });

                scopeTagsContainer.appendChild(tag);
            });
        };

        // 更新选择器状态
        const updateScopeSelector = () => {
            const hasAll = selectedScopes.includes('all');
            
            Array.from(scopeSelector.options).forEach(option => {
                if (option.value === '') return;
                
                if (hasAll && option.value !== 'all') {
                    option.disabled = true;
                } else if (option.value === 'all' && selectedScopes.length > 0 && !hasAll) {
                    option.disabled = true;
                } else if (selectedScopes.includes(option.value)) {
                    option.disabled = true;
                } else {
                    option.disabled = false;
                }
            });
        };

        // 范围选择器变化
        scopeSelector.addEventListener('change', () => {
            const value = scopeSelector.value;
            if (!value) return;

            if (value === 'all') {
                selectedScopes = ['all'];
            } else {
                if (!selectedScopes.includes(value)) {
                    selectedScopes.push(value);
                }
            }

            renderScopeTags();
            updateScopeSelector();
            scopeSelector.value = '';
        });

        // 解析Cron表达式
        parseCronBtn.addEventListener('click', async () => {
            const cronExpr = cronInput.value.trim();
            if (!cronExpr) {
                msgEl.textContent = i18n.t('settings.fill_all_info');
                msgEl.style.color = 'var(--danger-color)';
                return;
            }

            try {
                const response = await AuthManager.fetchWithAuth(`${API_ENDPOINTS.DIGEST.BASE}/parse-cron`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ expression: cronExpr })
                });

                if (!response.ok) throw new Error('Invalid cron expression');

                const result = await response.json();
                cronNextRuns.style.display = 'block';
                cronRunsList.innerHTML = result.nextRuns.map(time => `<div>• ${time}</div>`).join('');
                msgEl.textContent = '';
            } catch (err) {
                msgEl.textContent = i18n.t('digest.invalid_cron');
                msgEl.style.color = 'var(--danger-color)';
                cronNextRuns.style.display = 'none';
            }
        });

        // 手动触发测试
        manualTriggerBtn.addEventListener('click', async () => {
            if (selectedScopes.length === 0) {
                msgEl.textContent = '请先选择总结范围';
                msgEl.style.color = 'var(--danger-color)';
                return;
            }

            manualTriggerBtn.disabled = true;
            manualTriggerBtn.textContent = i18n.t('digest.triggering');
            msgEl.textContent = '';

            try {
                const taskData = {
                    title: titleInput.value.trim(),
                    digestTitle: digestTitleInput.value.trim(),
                    scopes: selectedScopes,
                    customPrompt: promptInput.value.trim(),
                    timeRange: timeRangeInput.value ? parseInt(timeRangeInput.value) : 24,
                    includeRead: includeReadCheckbox.checked,
                    enablePush: enablePushCheckbox.checked
                };

                const response = await AuthManager.fetchWithAuth(`${API_ENDPOINTS.DIGEST.BASE}/manual-trigger`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(taskData)
                });

                if (!response.ok) throw new Error('Trigger failed');

                msgEl.textContent = `✓ ${i18n.t('digest.trigger_success')}`;
                msgEl.style.color = 'var(--accent-color)';
            } catch (err) {
                msgEl.textContent = `${i18n.t('digest.trigger_failed')}: ${err.message}`;
                msgEl.style.color = 'var(--danger-color)';
            } finally {
                manualTriggerBtn.disabled = false;
                manualTriggerBtn.textContent = i18n.t('digest.manual_trigger');
            }
        });

        // 保存任务
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (selectedScopes.length === 0) {
                msgEl.textContent = '请先选择总结范围';
                msgEl.style.color = 'var(--danger-color)';
                return;
            }

            const taskData = {
                id: task?.id || generateUUID(),
                title: titleInput.value.trim(),
                digestTitle: digestTitleInput.value.trim(),
                scopes: selectedScopes,
                customPrompt: promptInput.value.trim(),
                cronExpression: cronInput.value.trim(),
                timeRange: timeRangeInput.value ? parseInt(timeRangeInput.value) : 24,
                includeRead: includeReadCheckbox.checked,
                enablePush: enablePushCheckbox.checked
            };

            try {
                // 加载现有任务
                const response = await AuthManager.fetchWithAuth(API_ENDPOINTS.PREFERENCES.BASE);
                if (!response.ok) throw new Error('Failed to load tasks');
                
                const prefs = await response.json();
                let tasks = prefs.digest_tasks || [];

                if (isEdit) {
                    tasks = tasks.map(t => t.id === task.id ? taskData : t);
                } else {
                    tasks.push(taskData);
                }

                // 保存任务
                const saveResponse = await AuthManager.fetchWithAuth(API_ENDPOINTS.PREFERENCES.BASE, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        key: 'digest_tasks',
                        value: tasks
                    })
                });

                if (!saveResponse.ok) throw new Error('Failed to save task');

                msgEl.textContent = `✓ ${i18n.t('common.save')}${i18n.t('common.success')}`;
                msgEl.style.color = 'var(--accent-color)';

                setTimeout(() => {
                    close();
                    if (onSave) onSave();
                }, 1000);

            } catch (err) {
                msgEl.textContent = err.message;
                msgEl.style.color = 'var(--danger-color)';
            }
        });

        // 如果是编辑模式，填充数据
        if (isEdit && task) {
            titleInput.value = task.title || '';
            digestTitleInput.value = task.digestTitle || '';
            selectedScopes = task.scopes || [];
            promptInput.value = task.customPrompt || '';
            cronInput.value = task.cronExpression || '';
            timeRangeInput.value = task.timeRange || 24;
            includeReadCheckbox.checked = task.includeRead || false;
            enablePushCheckbox.checked = task.enablePush || false;
            
            renderScopeTags();
            updateScopeSelector();
        } else {
            // 新建任务时，填充默认的简报提示词
            const defaultPrompt = AIService.getDefaultPrompt('digest');
            promptInput.value = defaultPrompt;
            timeRangeInput.value = 24;
            renderScopeTags();
        }
    }
};
