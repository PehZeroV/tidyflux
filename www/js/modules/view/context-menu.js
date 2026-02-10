/**
 * ContextMenu - 上下文菜单模块
 * @module view/context-menu
 */

import { AppState } from '../../state.js';
import { FeedManager } from '../feed-manager.js';
import { showToast, createContextMenu } from './utils.js';
import { i18n } from '../i18n.js';
import { Modal } from './components.js';
import { Icons } from '../icons.js';

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
            <div class="context-menu-item" data-action="refresh-group" data-group-id="${groupId}">
                ${Icons.refresh}
                ${i18n.t('context.refresh_group')}
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
            } else if (action === 'refresh-group') {
                showToast(i18n.t('common.refreshing'));
                try {
                    await FeedManager.refreshGroup(gid);
                } catch (err) {
                    alert(err.message || i18n.t('common.refresh_failed'));
                }

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
            <div class="context-menu-item" data-action="refresh" data-feed-id="${feedId}">
                ${Icons.refresh}
                ${i18n.t('context.refresh_feed')}
            </div>
            <div class="context-menu-divider"></div>
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

            if (action === 'refresh') {
                showToast(i18n.t('common.refreshing'));
                try {
                    await FeedManager.refreshFeed(fid);
                } catch (err) {
                    alert(err.message || i18n.t('common.refresh_failed'));
                }

            } else if (action === 'edit-feed') {
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

        let itemsHtml = '';

        if (!isFavorites && !isDigests) {
            itemsHtml += `
            <div class="context-menu-item" data-action="manual-refresh">
                ${Icons.miniflux}
                ${i18n.t('context.refresh_miniflux')}
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" data-action="generate-digest">
                ${Icons.newspaper}
                ${i18n.t('digest.generate')}
            </div>
            <div class="context-menu-item" data-action="schedule-digest">
                ${Icons.schedule}
                ${i18n.t('ai.scheduled_digest')}
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
`;

        const html = itemsHtml;


        // 使用按钮位置定位
        const btn = event.currentTarget;
        const rect = btn.getBoundingClientRect();

        // 清理旧的菜单和事件监听器
        document.querySelectorAll('.context-menu').forEach(m => m.remove());
        if (articlesMenuCloseHandler) {
            document.removeEventListener('click', articlesMenuCloseHandler, true);
            articlesMenuCloseHandler = null;
        }

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.innerHTML = html;
        document.body.appendChild(menu);

        const actualWidth = menu.offsetWidth;
        let x = rect.right - actualWidth;
        const y = rect.bottom + 10;

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

        menu.addEventListener('click', async (e) => {
            const item = e.target.closest('.context-menu-item');
            if (!item || item.classList.contains('disabled')) return;

            const action = item.dataset.action;
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
                    showToast(i18n.t('common.refresh_failed'));
                } finally {
                    isManualRefreshing = false;
                }
            } else if (action === 'generate-digest') {
                if (AppState.currentFeedId) {
                    this.viewManager.generateDigestForFeed(AppState.currentFeedId);
                } else if (AppState.currentGroupId) {
                    this.viewManager.generateDigestForGroup(AppState.currentGroupId);
                } else {
                    this.viewManager.generateDigest('all');
                }
            } else if (action === 'schedule-digest') {
                this.viewManager.showDigestScheduleDialog({
                    feedId: AppState.currentFeedId,
                    groupId: AppState.currentGroupId
                });
            } else if (action === 'mark-all-read') {
                if (await Modal.confirm(i18n.t('context.confirm_mark_all_read'))) {
                    await FeedManager.markAllAsRead(AppState.currentFeedId, AppState.currentGroupId);
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
            }
        });
    }
};
