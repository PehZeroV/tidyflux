/**
 * ContextMenu - 上下文菜单模块
 * @module view/context-menu
 */

import { AppState } from '../../state.js';
import { DOMElements } from '../../dom.js';
import { FeedManager } from '../feed-manager.js';
import { showToast, createContextMenu, getTodayStartISO, getTodayStartTimestamp } from './utils.js';
import { i18n } from '../i18n.js';
import { Modal } from './components.js';
import { Icons } from '../icons.js';
import { Dialogs } from './dialogs.js';
import { AIService } from '../ai-service.js';
import { ArticlesView } from './articles-view.js';
import { ArticlesTitleTranslation } from './articles-title-translation.js';
import { ArticleContentView } from './article-content.js';


/**
 * 上下文菜单管理
 */
// 模块级变量：跟踪 showArticlesContextMenu 的关闭处理器
let articlesMenuCloseHandler = null;
let isManualRefreshing = false;

export const ContextMenu = {
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
     * 显示分组上下文菜单
     * @param {MouseEvent} event - 鼠标事件
     * @param {string|number} groupId - 分组 ID
     */
    showGroupContextMenu(event, groupId) {
        const group = AppState.groups.find(g => g.id == groupId);
        if (!group) return;

        const isPinned = this.viewManager.getPinnedGroups().includes(group.id);

        const html = `
            <div class="context-menu-item" data-action="toggle-pin" data-group-id="${groupId}">
                ${Icons.pin}
                ${isPinned ? i18n.t('context.unpin_group') : i18n.t('context.pin_group')}
            </div>
            <div class="context-menu-item" data-action="rename" data-group-id="${groupId}">
                ${Icons.edit}
                ${i18n.t('context.rename')}
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item danger" data-action="delete" data-group-id="${groupId}">
                ${Icons.delete}
                ${i18n.t('context.delete_group')}
            </div>
        `;

        const { menu, cleanup } = createContextMenu(event, html);

        menu.addEventListener('click', async (e) => {
            const item = e.target.closest('.context-menu-item');
            if (!item) return;

            const action = item.dataset.action;
            const gid = item.dataset.groupId;
            cleanup();

            if (action === 'toggle-pin') {
                const pinned = this.viewManager.getPinnedGroups().includes(parseInt(gid, 10));
                await this.viewManager.togglePinGroup(gid, !pinned);

            } else if (action === 'rename') {
                const newName = await Modal.prompt(i18n.t('context.enter_new_name'), group.name);
                if (newName && newName.trim() && newName !== group.name) {
                    await this.viewManager.renameGroup(gid, newName.trim());
                }
            } else if (action === 'delete') {
                if (await Modal.confirm(i18n.t('context.confirm_delete_group'))) {
                    await this.viewManager.deleteGroup(gid);
                }
            }
        });
    },

    /**
     * 显示订阅源上下文菜单
     * @param {MouseEvent} event - 鼠标事件
     * @param {string|number} feedId - 订阅源 ID
     */
    showFeedContextMenu(event, feedId) {

        const html = `
            <div class="context-menu-item" data-action="edit-feed" data-feed-id="${feedId}">
                ${Icons.edit}
                ${i18n.t('dialogs.edit_subscription')}
            </div>
        `;

        const { menu, cleanup } = createContextMenu(event, html);

        menu.addEventListener('click', async (e) => {
            const item = e.target.closest('.context-menu-item');
            if (!item) return;

            const action = item.dataset.action;
            const fid = item.dataset.feedId;
            cleanup();

            if (action === 'edit-feed') {
                this.viewManager.showEditFeedDialog(fid);
            }
        });
    },

    /**
     * 显示文章列表上下文菜单
     * @param {MouseEvent} event - 鼠标事件
     */
    showArticlesContextMenu(event) {
        const isUnreadOnly = AppState.showUnreadOnly;
        const isFavorites = AppState.viewingFavorites;
        const isDigests = AppState.viewingDigests;

        const isToday = AppState.viewingToday;
        const isHistory = AppState.viewingHistory;

        let itemsHtml = '';

        if (isDigests) {
            itemsHtml += `
            <div class="context-menu-item" data-action="manage-scheduled-digests">
                ${Icons.schedule}
                ${i18n.t('digest.manage_scheduled')}
            </div>
`;
        } else if (isToday) {
            itemsHtml += `
            <div class="context-menu-item" data-action="generate-digest">
                ${Icons.newspaper}
                ${i18n.t('digest.generate_today')}
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" data-action="mark-all-read">
                 ${Icons.check}
                ${i18n.t('context.mark_all_read')}
            </div>
            <div class="context-menu-item" data-action="toggle-view">
                    ${isUnreadOnly ? Icons.checkbox_checked : Icons.checkbox_unchecked}
                ${i18n.t('context.show_unread')}
            </div>
`;
        } else if (!isFavorites && !isHistory) {
            itemsHtml += `
            <div class="context-menu-item" data-action="manual-refresh">
                ${Icons.miniflux}
                ${i18n.t('context.refresh_miniflux')}
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" data-action="generate-digest">
                ${Icons.newspaper}
                ${AppState.currentFeedId ? i18n.t('digest.generate_for_feed') : AppState.currentGroupId ? i18n.t('digest.generate_for_group') : i18n.t('digest.generate_all')}
            </div>
            <div class="context-menu-item" data-action="schedule-digest">
                ${Icons.schedule}
                ${i18n.t('ai.scheduled_digest')}
            </div>
            <div class="context-menu-item context-menu-submenu-trigger" data-action="ai-automation">
                ${Icons.summarize}
                ${i18n.t('ai.ai_automation')}
                <span style="margin-left: auto; font-size: 10px; opacity: 0.5;">▶</span>
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" data-action="mark-all-read">
                 ${Icons.check}
                ${i18n.t('context.mark_all_read')}
            </div>
            <div class="context-menu-item" data-action="toggle-view">
                    ${isUnreadOnly ? Icons.checkbox_checked : Icons.checkbox_unchecked}
                ${i18n.t('context.show_unread')}
            </div>
`;
        }

        if (itemsHtml !== '') {
            itemsHtml += '<div class="context-menu-divider"></div>';
        }

        itemsHtml += `
            <div class="context-menu-label" style="color: var(--text-tertiary); font-size: 11px; font-weight: 600; padding: 10px 16px 4px; cursor: default; text-transform: uppercase; letter-spacing: 0.5px;">
                ${i18n.t('common.global_settings')}
            </div>
            <div class="context-menu-item" data-action="toggle-scroll-read">
                    ${AppState.preferences?.scroll_mark_as_read ? Icons.checkbox_checked : Icons.checkbox_unchecked}
                ${i18n.t('context.scroll_mark_read')}
            </div>
            <div class="context-menu-item" data-action="toggle-thumbnails">
                    ${AppState.preferences?.show_thumbnails !== false ? Icons.checkbox_checked : Icons.checkbox_unchecked}
                ${i18n.t('context.show_thumbnails')}
            </div>
            <div class="context-menu-item" data-action="toggle-summary">
                    ${AppState.preferences?.show_summary ? Icons.checkbox_checked : Icons.checkbox_unchecked}
                ${i18n.t('context.show_summary')}
            </div>
            ${AppState.preferences?.show_summary ? `
            <div class="context-menu-item" style="padding: 6px 16px;">
                <span style="font-size: 0.85em; color: var(--meta-color); margin-right: 8px;">${i18n.t('context.summary_lines')}</span>
                <span class="summary-lines-pills" style="display: inline-flex; gap: 4px; margin-left: auto;">
                    ${[1, 2, 3].map(n => `<button class="appearance-mode-btn${(AppState.preferences?.summary_lines || 2) === n ? ' active' : ''}" data-action="set-summary-lines" data-lines="${n}" style="padding: 2px 10px; font-size: 0.8em; min-width: 0;">${n}</button>`).join('')}
                </span>
            </div>
            ` : ''}
`;


        // 使用按钮位置定位
        const btn = event.currentTarget;
        const rect = btn.getBoundingClientRect();

        // 清理旧的菜单和事件监听器
        document.querySelectorAll('body > .context-menu').forEach(m => m.remove());
        if (articlesMenuCloseHandler) {
            document.removeEventListener('click', articlesMenuCloseHandler, true);
            articlesMenuCloseHandler = null;
        }

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.innerHTML = itemsHtml;
        document.body.appendChild(menu);

        const actualWidth = menu.offsetWidth;
        let x = rect.right - actualWidth;
        const y = rect.bottom + 4;

        if (x + actualWidth > window.innerWidth) {
            x = window.innerWidth - actualWidth - 10;
        }

        if (x < 10) x = 10; // 确保不会超出左边界

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        const closeHandler = (e) => {
            if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                menu.remove();
                document.removeEventListener('click', closeHandler, true);
                articlesMenuCloseHandler = null;
            }
        };
        articlesMenuCloseHandler = closeHandler;
        setTimeout(() => document.addEventListener('click', closeHandler, true), 0);

        // ===== AI Automation submenu =====
        const aiTrigger = menu.querySelector('.context-menu-submenu-trigger[data-action="ai-automation"]');
        if (aiTrigger) {
            const buildSubmenuHtml = () => {
                const feedId = AppState.currentFeedId;
                const groupId = AppState.currentGroupId;

                let titleOn = false;
                let translateOn = false;
                let summaryOn = false;

                if (feedId) {
                    titleOn = AIService.shouldTranslateFeed(feedId);
                    translateOn = AIService.shouldAutoTranslate(feedId);
                    summaryOn = AIService.shouldAutoSummarize(feedId);
                } else if (groupId) {
                    titleOn = AIService.getGroupTranslationOverride(groupId) === 'on';
                    translateOn = AIService.getGroupAutoTranslateOverride(groupId) === 'on';
                    summaryOn = AIService.getGroupSummaryOverride(groupId) === 'on';
                } else {
                    const groups = AppState.groups || [];
                    const feeds = AppState.feeds || [];
                    const ungrouped = feeds.filter(f => !f.group_id);
                    const allGroupsOn = (arr, getter) => arr.length > 0 && arr.every(g => getter(g.id) === 'on');
                    const allUngroupedOn = (arr, getter) => arr.every(f => getter(f.id) === 'on');
                    const hasAny = groups.length > 0 || ungrouped.length > 0;
                    titleOn = hasAny && allGroupsOn(groups, id => AIService.getGroupTranslationOverride(id)) && allUngroupedOn(ungrouped, id => AIService.getFeedTranslationOverride(id));
                    translateOn = hasAny && allGroupsOn(groups, id => AIService.getGroupAutoTranslateOverride(id)) && allUngroupedOn(ungrouped, id => AIService.getFeedAutoTranslateOverride(id));
                    summaryOn = hasAny && allGroupsOn(groups, id => AIService.getGroupSummaryOverride(id)) && allUngroupedOn(ungrouped, id => AIService.getFeedSummaryOverride(id));
                }

                return `
                    <div class="context-menu-label" style="display: flex; align-items: center; gap: 6px;">
                        ${Icons.summarize}
                        ${i18n.t('ai.ai_automation')}
                    </div>
                    <div class="context-menu-divider"></div>
                    <div class="context-menu-item" data-ai-action="toggle-title-translate">
                        ${titleOn ? Icons.checkbox_checked : Icons.checkbox_unchecked}
                        ${i18n.t('ai.title_translation')}
                    </div>
                    <div class="context-menu-item" data-ai-action="toggle-auto-translate">
                        ${translateOn ? Icons.checkbox_checked : Icons.checkbox_unchecked}
                        ${i18n.t('ai.auto_translate_article')}
                    </div>
                    <div class="context-menu-item" data-ai-action="toggle-auto-summary">
                        ${summaryOn ? Icons.checkbox_checked : Icons.checkbox_unchecked}
                        ${i18n.t('ai.auto_summary')}
                    </div>
                `;
            };

            const openAISubmenu = (e) => {
                e.stopPropagation();

                // Capture main menu right edge and top position
                const menuRect = menu.getBoundingClientRect();
                const menuRight = menuRect.right;
                const menuY = menuRect.top;

                // Close main menu
                menu.remove();
                document.removeEventListener('click', closeHandler, true);
                articlesMenuCloseHandler = null;

                // Create submenu at the same position (right-aligned)
                const submenu = document.createElement('div');
                submenu.className = 'context-menu context-submenu';
                submenu.innerHTML = buildSubmenuHtml();
                document.body.appendChild(submenu);

                // Right-align with the main menu's right edge
                const subW = submenu.offsetWidth;
                const subH = submenu.offsetHeight;
                let x = menuRight - subW;
                let y = menuY;

                if (x < 10) x = 10;
                if (y + subH > window.innerHeight - 10) {
                    y = window.innerHeight - subH - 10;
                }
                if (y < 10) y = 10;

                submenu.style.left = `${x}px`;
                submenu.style.top = `${y}px`;

                // Handle submenu item clicks
                submenu.addEventListener('click', async (e) => {
                    const subItem = e.target.closest('.context-menu-item');
                    if (!subItem) return;
                    e.stopPropagation();

                    const aiAction = subItem.dataset.aiAction;
                    if (!aiAction) return;

                    const feedId = AppState.currentFeedId;
                    const groupId = AppState.currentGroupId;

                    if (aiAction === 'toggle-title-translate') {
                        await this._toggleAIOverride('translation', feedId, groupId);
                        // 立即触发当前列表的标题翻译
                        ArticlesTitleTranslation.triggerTitleTranslations(AppState.articles);
                    } else if (aiAction === 'toggle-auto-translate') {
                        await this._toggleAIOverride('translate', feedId, groupId);
                    } else if (aiAction === 'toggle-auto-summary') {
                        await this._toggleAIOverride('summary', feedId, groupId);
                    }

                    // Re-render to reflect new state
                    submenu.innerHTML = buildSubmenuHtml();
                });

                // Click outside to close submenu
                const subCloseHandler = (e) => {
                    if (!submenu.contains(e.target)) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        submenu.remove();
                        document.removeEventListener('click', subCloseHandler, true);
                    }
                };
                setTimeout(() => document.addEventListener('click', subCloseHandler, true), 0);
            };

            aiTrigger.addEventListener('click', openAISubmenu);
        }

        menu.addEventListener('click', async (e) => {
            // Handle summary lines pill buttons (nested buttons inside context-menu-item)
            const lineBtn = e.target.closest('[data-action="set-summary-lines"]');
            if (lineBtn) {
                const lines = parseInt(lineBtn.dataset.lines || '2');
                AppState.preferences = AppState.preferences || {};
                AppState.preferences.summary_lines = lines;
                // Update pill active states
                menu.querySelectorAll('[data-action="set-summary-lines"]').forEach(b => b.classList.remove('active'));
                lineBtn.classList.add('active');
                try {
                    await FeedManager.setPreference('summary_lines', lines);
                    this.viewManager.renderArticlesList(AppState.articles);
                } catch (err) {
                    console.error('Save pref error:', err);
                }
                return; // Don't close menu
            }

            const item = e.target.closest('.context-menu-item');
            if (!item || item.classList.contains('disabled')) return;

            const action = item.dataset.action;

            // Don't close menu for submenu trigger
            if (action === 'ai-automation') return;

            menu.remove();
            document.removeEventListener('click', closeHandler, true);
            articlesMenuCloseHandler = null;

            if (action === 'manual-refresh') {
                if (isManualRefreshing) {
                    showToast(i18n.t('common.refresh_in_progress'));
                    return;
                }
                isManualRefreshing = true;
                showToast(i18n.t('common.refreshing'));
                try {
                    if (AppState.currentFeedId) {
                        await FeedManager.refreshFeed(AppState.currentFeedId);
                    } else if (AppState.currentGroupId) {
                        await FeedManager.refreshGroup(AppState.currentGroupId);
                    } else {
                        await FeedManager.refreshFeeds();
                    }

                    // Miniflux refreshes asynchronously, poll for new articles
                    const snapFeedId = AppState.currentFeedId;
                    const snapGroupId = AppState.currentGroupId;
                    const snapArticleId = AppState.currentArticleId;
                    let userInteracted = false;
                    const articlesList = document.getElementById('articles-list');
                    const onScroll = () => { userInteracted = true; };
                    articlesList.addEventListener('scroll', onScroll, { passive: true });

                    const shouldStop = () =>
                        userInteracted
                        || AppState.currentFeedId !== snapFeedId
                        || AppState.currentGroupId !== snapGroupId
                        || AppState.currentArticleId !== snapArticleId;

                    let everFoundNew = false;
                    let consecutiveEmpty = 0;
                    let round = 0;

                    while (!shouldStop()) {
                        await new Promise(r => setTimeout(r, 2000));
                        if (shouldStop()) break;
                        round++;

                        const prevCount = AppState.articles.length;
                        try {
                            await this.viewManager.checkForNewArticles();
                        } catch { /* ignore */ }
                        const foundNew = AppState.articles.length > prevCount;

                        if (foundNew) {
                            everFoundNew = true;
                            consecutiveEmpty = 0;
                        } else {
                            consecutiveEmpty++;
                            if (everFoundNew && consecutiveEmpty >= 2) {
                                break;
                            } else if (!everFoundNew && round >= 3 && consecutiveEmpty >= 2) {
                                break;
                            }
                        }
                    }
                    articlesList.removeEventListener('scroll', onScroll);
                } catch (err) {
                    showToast(i18n.t('common.refresh_failed'), 3000, false);
                } finally {
                    isManualRefreshing = false;
                }
            } else if (action === 'manage-scheduled-digests') {
                Dialogs.showDigestManagerDialog();
            } else if (action === 'generate-digest') {
                // Show digest generation dialog with time range and read/unread options
                const isToday = AppState.viewingToday;

                const timeOptions = [
                    { value: 12, label: i18n.t('digest.hours_12') },
                    { value: 24, label: i18n.t('digest.hours_24') },
                    { value: 48, label: i18n.t('digest.days_2') },
                    { value: 72, label: i18n.t('digest.days_3') },
                    { value: 168, label: i18n.t('digest.days_7') },
                ];

                let bodyHtml = '';

                // Time range section (hidden for "Today" view)
                if (!isToday) {
                    bodyHtml += `
                        <div style="margin-bottom: 18px;">
                            <div class="settings-item-label">${i18n.t('digest.time_range')}</div>
                            <div id="digest-time-pills" class="appearance-mode-group">
                                ${timeOptions.map(opt => `
                                    <button class="appearance-mode-btn${opt.value === 12 ? ' active' : ''}" data-value="${opt.value}">${opt.label}</button>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }

                // Read/Unread filter section
                bodyHtml += `
                    <div style="margin-bottom: 8px;">
                        <div class="settings-item-label">${i18n.t('digest.read_filter')}</div>
                        <div id="digest-read-pills" class="appearance-mode-group">
                            <button class="appearance-mode-btn active" data-value="unread">${i18n.t('digest.unread_only')}</button>
                            <button class="appearance-mode-btn" data-value="all">${i18n.t('digest.include_read')}</button>
                        </div>
                        <div id="digest-read-warning" style="font-size: 0.78em; color: var(--meta-color); margin-top: 8px; display: none;">
                            ⚠️ ${i18n.t('digest.include_read_warning')}
                        </div>
                    </div>
                `;

                const confirmed = await Modal._renderDialog({
                    title: i18n.t('digest.generate_dialog_title'),
                    body: bodyHtml,
                    footer: `
                        <button class="appearance-mode-btn cancel-btn">${i18n.t('common.cancel')}</button>
                        <button class="appearance-mode-btn active confirm-btn">${i18n.t('digest.generate_btn')}</button>
                    `,
                    onReady: (dialog, finalize) => {
                        // Pill click handlers using appearance-mode-btn pattern
                        const setupPillGroup = (containerId) => {
                            const container = dialog.querySelector(`#${containerId}`);
                            if (!container) return;
                            container.addEventListener('click', (e) => {
                                const btn = e.target.closest('.appearance-mode-btn');
                                if (!btn) return;
                                container.querySelectorAll('.appearance-mode-btn').forEach(b => b.classList.remove('active'));
                                btn.classList.add('active');

                                // Show/hide warning for include-read
                                if (containerId === 'digest-read-pills') {
                                    const warning = dialog.querySelector('#digest-read-warning');
                                    if (warning) {
                                        warning.style.display = btn.dataset.value === 'all' ? 'block' : 'none';
                                    }
                                }
                            });
                        };

                        setupPillGroup('digest-time-pills');
                        setupPillGroup('digest-read-pills');

                        dialog.querySelector('.confirm-btn').addEventListener('click', () => {
                            const timePill = dialog.querySelector('#digest-time-pills .appearance-mode-btn.active');
                            const readPill = dialog.querySelector('#digest-read-pills .appearance-mode-btn.active');
                            finalize({
                                hours: timePill ? parseInt(timePill.dataset.value) : 12,
                                unreadOnly: readPill ? readPill.dataset.value === 'unread' : true
                            });
                        });
                        dialog.querySelector('.cancel-btn').addEventListener('click', () => finalize(null));
                        dialog.addEventListener('click', (e) => { if (e.target === dialog) finalize(null); });
                    }
                });

                if (!confirmed) return;

                const { hours, unreadOnly } = confirmed;

                if (isToday) {
                    const afterTimestamp = getTodayStartTimestamp();
                    this.viewManager.generateDigest('today', null, null, null, afterTimestamp, unreadOnly);
                } else if (AppState.currentFeedId) {
                    this.viewManager.generateDigest('feed', AppState.currentFeedId, null, hours, null, unreadOnly);
                } else if (AppState.currentGroupId) {
                    this.viewManager.generateDigest('group', null, AppState.currentGroupId, hours, null, unreadOnly);
                } else {
                    this.viewManager.generateDigest('all', null, null, hours, null, unreadOnly);
                }
            } else if (action === 'schedule-digest') {
                this.viewManager.showDigestScheduleDialog({
                    feedId: AppState.currentFeedId,
                    groupId: AppState.currentGroupId
                });
            } else if (action === 'mark-all-read') {
                if (await Modal.confirm(i18n.t('context.confirm_mark_all_read'))) {
                    let afterPublishedAt = null;
                    if (AppState.viewingToday) {
                        afterPublishedAt = getTodayStartISO();
                    }
                    await FeedManager.markAllAsRead(AppState.currentFeedId, AppState.currentGroupId, afterPublishedAt);
                    await Promise.all([
                        this.viewManager.loadArticles(AppState.currentFeedId, AppState.currentGroupId),
                        this.viewManager.loadFeeds()
                    ]);
                }
            } else if (action === 'toggle-view') {
                AppState.showUnreadOnly = !AppState.showUnreadOnly;
                if (AppState.currentFeedId) {
                    await this.viewManager.saveFilterSetting(`feed_${AppState.currentFeedId}`, AppState.showUnreadOnly);
                } else if (AppState.currentGroupId) {
                    await this.viewManager.saveFilterSetting(`group_${AppState.currentGroupId}`, AppState.showUnreadOnly);
                } else if (AppState.viewingToday) {
                    await this.viewManager.saveFilterSetting('today', AppState.showUnreadOnly);
                } else if (!AppState.viewingFavorites) {
                    await this.viewManager.saveFilterSetting('all', AppState.showUnreadOnly);
                }
                await this.viewManager.loadArticles(AppState.currentFeedId, AppState.currentGroupId);
            } else if (action === 'toggle-scroll-read') {
                const newState = !AppState.preferences?.scroll_mark_as_read;
                AppState.preferences = AppState.preferences || {};
                AppState.preferences.scroll_mark_as_read = newState;

                try {
                    await FeedManager.setPreference('scroll_mark_as_read', newState);
                    showToast(newState ? i18n.t('context.scroll_read_on') : i18n.t('context.scroll_read_off'), 3000, false);
                } catch (err) {
                    console.error('Save pref error:', err);
                }
            } else if (action === 'toggle-thumbnails') {
                const currentState = AppState.preferences?.show_thumbnails !== false;
                const newState = !currentState;
                AppState.preferences = AppState.preferences || {};
                AppState.preferences.show_thumbnails = newState;

                try {
                    await FeedManager.setPreference('show_thumbnails', newState);
                    showToast(newState ? i18n.t('context.thumbnails_on') : i18n.t('context.thumbnails_off'), 3000, false);
                    // Re-render without network request
                    this.viewManager.renderArticlesList(AppState.articles);
                } catch (err) {
                    console.error('Save pref error:', err);
                }
            } else if (action === 'toggle-summary') {
                const currentState = !!AppState.preferences?.show_summary;
                const newState = !currentState;
                AppState.preferences = AppState.preferences || {};
                AppState.preferences.show_summary = newState;

                try {
                    await FeedManager.setPreference('show_summary', newState);
                    showToast(newState ? i18n.t('context.summary_on') : i18n.t('context.summary_off'), 3000, false);
                    // 开启时为已有文章预计算摘要
                    if (newState) ArticlesView._precomputeContentPreviews(AppState.articles);
                    this.viewManager.renderArticlesList(AppState.articles);
                } catch (err) {
                    console.error('Save pref error:', err);
                }
            }
        });
    },

    /**
     * 显示文章项右键菜单（文章列表中）
     * @param {MouseEvent} event - 鼠标事件
     * @param {string|number} articleId - 文章 ID
     */
    showArticleItemContextMenu(event, articleId) {
        const article = AppState.articles?.find(a => a.id == articleId);
        if (!article) return;

        // 跳过简报类型
        if (article.type === 'digest') return;

        const isRead = !!article.is_read;
        const isFavorited = !!article.is_favorited;

        const html = `
            <div class="context-menu-item" data-action="toggle-read" data-article-id="${articleId}">
                ${isRead ? Icons.mark_unread : Icons.mark_read}
                ${isRead ? i18n.t('article.mark_unread') : i18n.t('article.mark_read')}
            </div>
            <div class="context-menu-item" data-action="toggle-favorite" data-article-id="${articleId}">
                ${isFavorited ? Icons.star : Icons.star_border}
                ${isFavorited ? i18n.t('article.unstar') : i18n.t('article.star')}
            </div>
        `;

        const { menu, cleanup } = createContextMenu(event, html);

        menu.addEventListener('click', async (e) => {
            const item = e.target.closest('.context-menu-item');
            if (!item) return;

            const action = item.dataset.action;
            cleanup();

            if (action === 'toggle-read') {
                try {
                    const listItem = DOMElements.articlesList?.querySelector(`.article-item[data-id="${articleId}"]`);
                    if (article.is_read) {
                        await FeedManager.markAsUnread(articleId);
                        article.is_read = 0;
                        if (listItem) listItem.classList.add('unread');
                        // 增加未读计数
                        ArticleContentView.updateLocalUnreadCount(article.feed_id, 1);
                    } else {
                        await FeedManager.markAsRead(articleId);
                        article.is_read = 1;
                        if (listItem) listItem.classList.remove('unread');
                        // 减少未读计数
                        ArticleContentView.updateLocalUnreadCount(article.feed_id, -1);
                    }

                    // 同步更新文章工具栏的已读/未读按钮（如果当前正在显示该文章）
                    if (AppState.currentArticleId == articleId) {
                        const readBtn = document.getElementById('article-toggle-read-btn');
                        if (readBtn) {
                            if (article.is_read) {
                                readBtn.classList.add('is-read');
                                readBtn.classList.remove('active');
                                readBtn.innerHTML = Icons.mark_read;
                                readBtn.setAttribute('data-tooltip', i18n.t('article.mark_unread'));
                            } else {
                                readBtn.classList.remove('is-read');
                                readBtn.classList.add('active');
                                readBtn.innerHTML = Icons.mark_unread;
                                readBtn.setAttribute('data-tooltip', i18n.t('article.mark_read'));
                            }
                        }
                    }

                    // 如果虚拟列表正在使用，刷新可见项
                    ArticlesView.refreshIfVirtual();
                } catch (err) {
                    console.error('Toggle read status failed', err);
                }
            } else if (action === 'toggle-favorite') {
                try {
                    const listItem = DOMElements.articlesList?.querySelector(`.article-item[data-id="${articleId}"]`);
                    if (article.is_favorited) {
                        await FeedManager.unfavoriteArticle(articleId);
                        article.is_favorited = 0;
                    } else {
                        await FeedManager.favoriteArticle(articleId);
                        article.is_favorited = 1;
                    }

                    // 更新列表中的收藏星标
                    const listMeta = listItem?.querySelector('.article-item-meta');
                    if (listMeta) {
                        const existingStar = listMeta.querySelector('.favorited-icon');
                        if (article.is_favorited && !existingStar) {
                            const starEl = document.createElement('span');
                            starEl.className = 'favorited-icon';
                            starEl.innerHTML = '★';
                            listMeta.prepend(starEl);
                        } else if (!article.is_favorited && existingStar) {
                            existingStar.remove();
                        }
                    }

                    // 同步更新文章工具栏的收藏按钮（如果当前正在显示该文章）
                    if (AppState.currentArticleId == articleId) {
                        const favBtn = document.getElementById('article-toggle-fav-btn');
                        if (favBtn) {
                            if (article.is_favorited) {
                                favBtn.classList.add('active');
                                favBtn.innerHTML = Icons.star;
                                favBtn.setAttribute('data-tooltip', i18n.t('article.unstar'));
                            } else {
                                favBtn.classList.remove('active');
                                favBtn.innerHTML = Icons.star_border;
                                favBtn.setAttribute('data-tooltip', i18n.t('article.star'));
                            }
                        }
                    }

                    // 如果虚拟列表正在使用，刷新可见项
                    ArticlesView.refreshIfVirtual();
                } catch (err) {
                    console.error('Toggle favorite failed', err);
                }
            }
        });
    },

    /**
     * Toggle AI automation override for a specific feed, group, or all feeds
     * @param {'translation'|'translate'|'summary'} mode - AI feature mode
     * @param {string|number|null} feedId - Current feed ID (if viewing a specific feed)
     * @param {string|number|null} groupId - Current group ID (if viewing a group)
     */
    async _toggleAIOverride(mode, feedId, groupId) {
        const { getFeed, getGroup, setFeed, shouldFeed, setBatch } = AIService.getOverrideAccessors(mode);

        if (feedId) {
            // Toggle for specific feed — single item, no batch needed
            const currentlyOn = shouldFeed(feedId);
            const newValue = currentlyOn ? 'off' : 'on';
            await setFeed(feedId, newValue);
        } else if (groupId) {
            // Toggle for group — batch: group + all child feeds
            const currentlyOn = getGroup(groupId) === 'on';
            const newValue = currentlyOn ? 'off' : 'on';
            const batchEntries = [{ type: 'group', id: groupId, value: newValue }];
            const feeds = (AppState.feeds || []).filter(f => f.group_id == groupId);
            for (const f of feeds) {
                batchEntries.push({ type: 'feed', id: f.id, value: 'inherit' });
            }
            await setBatch(batchEntries);
        } else {
            // Toggle for all — batch: all groups + all feeds
            const groups = AppState.groups || [];
            const feeds = AppState.feeds || [];
            const ungrouped = feeds.filter(f => !f.group_id);

            // Determine if currently "all on"
            const allGroupsOn = groups.length > 0 && groups.every(g => getGroup(g.id) === 'on');
            const allUngroupedOn = ungrouped.every(f => getFeed(f.id) === 'on');
            const currentlyAllOn = (groups.length > 0 || ungrouped.length > 0) && allGroupsOn && allUngroupedOn;

            const newValue = currentlyAllOn ? 'off' : 'on';
            const batchEntries = [];

            for (const g of groups) {
                batchEntries.push({ type: 'group', id: g.id, value: newValue });
                const groupFeeds = feeds.filter(f => f.group_id == g.id);
                for (const f of groupFeeds) {
                    batchEntries.push({ type: 'feed', id: f.id, value: 'inherit' });
                }
            }
            for (const f of ungrouped) {
                batchEntries.push({ type: 'feed', id: f.id, value: newValue });
            }
            await setBatch(batchEntries);
        }
    }
};
