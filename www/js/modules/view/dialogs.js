/**
 * Dialogs - 对话框模块（入口）
 * @module view/dialogs
 *
 * 各对话框拆分到独立文件：
 * - settings-dialog.js: 设置对话框 + AI + Miniflux
 * - schedule-dialog.js: 定时简报配置
 * - manager-dialog.js: 定时简报管理
 */

import { AppState } from '../../state.js';
import { DOMElements } from '../../dom.js';
import { FeedManager } from '../feed-manager.js';
import { createDialog, showToast } from './utils.js';
import { Modal, CustomSelect } from './components.js';
import { i18n } from '../i18n.js';
import { Icons } from '../icons.js';

import { SettingsDialogMixin } from './dialog-settings.js';
import { ScheduleDialogMixin } from './dialog-schedule.js';
import { ManagerDialogMixin } from './dialog-manager.js';


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
                    <div id="discover-results-area"></div>
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
        const manageGroupsBtn = dialog.querySelector('#manage-groups-btn');
        const importBtn = dialog.querySelector('#import-opml-btn');
        const exportBtn = dialog.querySelector('#export-opml-btn');
        const opmlFileInput = dialog.querySelector('#opml-file-input');
        const discoverArea = dialog.querySelector('#discover-results-area');

        // Init Custom Select
        const container = dialog.querySelector('.settings-dialog-content');
        if (container) CustomSelect.replaceAll(container);

        // Track discovered feeds
        let discoveredFeeds = null;

        // 只有在有分组时才绑定添加订阅相关的事件
        if (confirmBtn && urlInput && groupSelect) {
            confirmBtn.addEventListener('click', async () => {
                const rawUrl = urlInput.value.trim();
                if (!rawUrl) return;

                const groupId = groupSelect.value;
                if (!groupId) {
                    await Modal.alert(i18n.t('dialogs.no_groups_alert'));
                    return;
                }

                // If we have discovered feeds with checkboxes, subscribe to selected
                if (discoveredFeeds && discoveredFeeds.length > 1) {
                    const selected = [];
                    discoverArea.querySelectorAll('.discover-feed-checkbox:checked').forEach(cb => {
                        selected.push(cb.value);
                    });
                    if (selected.length === 0) {
                        await Modal.alert(i18n.t('dialogs.no_feed_selected'));
                        return;
                    }

                    confirmBtn.textContent = i18n.t('dialogs.adding');
                    confirmBtn.disabled = true;

                    try {
                        // Subscribe to all selected feeds
                        const results = [];
                        for (const feedUrl of selected) {
                            try {
                                await FeedManager.addFeed(feedUrl, groupId);
                                results.push({ url: feedUrl, success: true });
                            } catch (err) {
                                results.push({ url: feedUrl, success: false, error: err.message });
                            }
                        }
                        const failures = results.filter(r => !r.success);
                        if (failures.length > 0 && failures.length < selected.length) {
                            // Partial success
                            await Modal.alert(failures.map(f => f.error).join('\n'));
                        } else if (failures.length === selected.length) {
                            throw new Error(failures[0].error);
                        }
                        close();
                        await this.viewManager.loadFeeds();
                    } catch (err) {
                        await Modal.alert(err.message);
                        confirmBtn.textContent = i18n.t('dialogs.subscribe_selected');
                        confirmBtn.disabled = false;
                    }
                    return;
                }

                // Normalize URL
                let url = rawUrl;
                if (!/^https?:\/\//i.test(url)) {
                    url = 'https://' + url;
                }

                confirmBtn.textContent = i18n.t('dialogs.discovering');
                confirmBtn.disabled = true;

                try {
                    // Try to discover feeds first
                    const feeds = await FeedManager.discoverFeeds(url);

                    if (feeds && feeds.length > 1) {
                        // Multiple feeds found, show selection
                        discoveredFeeds = feeds;
                        this._renderDiscoverResults(discoverArea, feeds, confirmBtn);
                        confirmBtn.textContent = i18n.t('dialogs.subscribe_selected');
                        confirmBtn.disabled = false;
                        return;
                    }

                    // 1 or 0 feeds found — subscribe directly
                    const feedUrl = (feeds && feeds.length === 1) ? feeds[0].url : url;
                    confirmBtn.textContent = i18n.t('dialogs.adding');

                    await FeedManager.addFeed(feedUrl, groupId);
                    close();
                    await this.viewManager.loadFeeds();
                } catch (err) {
                    // Discovery failed, try adding directly
                    try {
                        confirmBtn.textContent = i18n.t('dialogs.adding');
                        await FeedManager.addFeed(url, groupId);
                        close();
                        await this.viewManager.loadFeeds();
                    } catch (addErr) {
                        await Modal.alert(addErr.message);
                        confirmBtn.textContent = i18n.t('dialogs.add');
                        confirmBtn.disabled = false;
                    }
                }
            });

            urlInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') confirmBtn.click();
                if (e.key === 'Escape') close();
            });

            // Reset discover results when URL changes
            urlInput.addEventListener('input', () => {
                if (discoveredFeeds) {
                    discoveredFeeds = null;
                    discoverArea.innerHTML = '';
                    confirmBtn.textContent = i18n.t('dialogs.add');
                }
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
     * 渲染 feed 发现结果列表
     */
    _renderDiscoverResults(container, feeds, confirmBtn) {
        const getFeedTypeLabel = (type) => {
            if (!type) return '';
            const t = type.toLowerCase();
            if (t.includes('atom')) return i18n.t('dialogs.feed_type_atom');
            if (t.includes('json')) return i18n.t('dialogs.feed_type_json');
            return i18n.t('dialogs.feed_type_rss');
        };

        container.innerHTML = `
            <div class="discover-results" style="margin-bottom: 12px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-size: 0.85em; color: var(--meta-color);">
                        ${i18n.t('dialogs.discover_results', { count: feeds.length })}
                    </span>
                    <label style="font-size: 0.8em; color: var(--meta-color); cursor: pointer; display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" id="discover-select-all" checked style="margin: 0;">
                        ${i18n.t('dialogs.subscribe_all')}
                    </label>
                </div>
                <div class="discover-feed-list" style="display: flex; flex-direction: column; gap: 6px;">
                    ${feeds.map((feed, idx) => `
                        <label class="discover-feed-item" style="
                            display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px;
                            background: var(--card-bg); border-radius: 8px; cursor: pointer;
                            border: 1px solid var(--border-color); transition: border-color 0.2s;
                        ">
                            <input type="checkbox" class="discover-feed-checkbox" value="${feed.url}" checked
                                   style="margin-top: 2px; flex-shrink: 0;">
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 0.9em; font-weight: 500; margin-bottom: 2px; display: flex; align-items: center; gap: 6px;">
                                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${feed.title || 'Feed ' + (idx + 1)}</span>
                                    ${feed.type ? `<span style="
                                        font-size: 0.7em; padding: 1px 6px; border-radius: 4px;
                                        background: var(--primary-color); color: white; flex-shrink: 0;
                                        font-weight: 600; letter-spacing: 0.5px;
                                    ">${getFeedTypeLabel(feed.type)}</span>` : ''}
                                </div>
                                <div style="font-size: 0.75em; color: var(--meta-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                    ${feed.url}
                                </div>
                            </div>
                        </label>
                    `).join('')}
                </div>
            </div>
        `;

        // Select all toggle
        const selectAllCb = container.querySelector('#discover-select-all');
        if (selectAllCb) {
            selectAllCb.addEventListener('change', () => {
                container.querySelectorAll('.discover-feed-checkbox').forEach(cb => {
                    cb.checked = selectAllCb.checked;
                });
            });
        }

        // Update select-all state when individual checkbox changes
        container.querySelectorAll('.discover-feed-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                const all = container.querySelectorAll('.discover-feed-checkbox');
                const checked = container.querySelectorAll('.discover-feed-checkbox:checked');
                if (selectAllCb) {
                    selectAllCb.checked = checked.length === all.length;
                    selectAllCb.indeterminate = checked.length > 0 && checked.length < all.length;
                }
            });
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
                dialog.querySelector('.close-dialog-btn').addEventListener('click', close);

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

    // Mixin methods from sub-modules
    ...SettingsDialogMixin,
    ...ScheduleDialogMixin,
    ...ManagerDialogMixin,
};

