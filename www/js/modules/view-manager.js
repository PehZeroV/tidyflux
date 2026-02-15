/**
 * ViewManager - Tidyflux 视图管理器
 * 重构版本：作为模块协调器
 * @module view-manager
 */

import { DOMElements } from '../dom.js';
import { AppState } from '../state.js';
import { FeedManager } from './feed-manager.js';
import { i18n } from './i18n.js';

// 导入子模块
import { AuthView } from './view/auth-view.js';
import { FeedsView } from './view/feeds-view.js';
import { ArticlesView } from './view/articles-view.js';
import { ArticleContentView } from './view/article-content.js';
import { Dialogs } from './view/dialogs.js';
import { SearchView } from './view/search-view.js';
import { Gestures } from './view/gestures.js';
import { ContextMenu } from './view/context-menu.js';
import { DigestView } from './view/digest-view.js';
import {
    formatDate,
    isIOSSafari,
    isMobileDevice,
    extractFirstImage,
    getThumbnailUrl,
    showToast
} from './view/utils.js';
import { Modal } from './view/components.js';

const STORAGE_KEY_FILTERS = 'tidyflux_list_filters';
const BREAKPOINT_MOBILE = 800;
const BREAKPOINT_TABLET = 1100;

/**
 * ViewManager - 模块协调器
 * 
 * 负责：
 * 1. 初始化所有子模块
 * 2. 提供统一的公共 API
 * 3. 协调模块间交互
 * 4. 维护跨模块状态
 */
export const ViewManager = {
    /** 是否正在加载更多 */
    isLoadingMore: false,
    /** 轮询定时器 */
    checkInterval: null,
    /** 虚拟列表引用 */
    virtualList: null,
    /** 是否使用虚拟滚动 */
    useVirtualScroll: false,
    /** 虚拟滚动阈值 */
    virtualScrollThreshold: 100,
    /** 订阅源是否已加载 */
    feedsLoaded: false,
    /** 订阅源加载 Promise */
    feedsLoadPromise: null,
    /** 是否为程序化导航 */
    isProgrammaticNav: false,
    /** 是否强制刷新列表（点击时设置，滑动返回时不设置） */
    forceRefreshList: false,

    // ==================== 初始化 ====================

    /**
     * 初始化所有子模块
     */
    initSubModules() {
        AuthView.init(this);
        FeedsView.init(this);
        ArticlesView.init(this);
        ArticleContentView.init(this);
        Dialogs.init(this);
        SearchView.init(this);
        Gestures.init(this);
        ContextMenu.init(this);
        DigestView.init(this);
    },

    /**
     * 同步状态到子模块
     */
    _syncStateToModules() {
        // 同步虚拟列表引用
        this.virtualList = ArticlesView.virtualList;
        this.useVirtualScroll = ArticlesView.useVirtualScroll;
        this.isLoadingMore = ArticlesView.isLoadingMore;
        this.checkInterval = ArticlesView.checkInterval;
    },

    // ==================== Auth 相关 ====================

    async showAuthView() {
        this.initSubModules();
        await AuthView.showAuthView();
    },

    showManualLoginForm(errorMessage = null) {
        AuthView.showManualLoginForm(errorMessage);
    },

    // ==================== 布局初始化 ====================

    async initThreeColumnLayout() {
        this.initSubModules();
        document.title = 'Tidyflux';
        DOMElements.appContainer.style.display = 'flex';

        // 无论初始化是否成功，都必须绑定基础事件（如设置、显示订阅源按钮等），防止页面“假死”
        this.bindEvents();

        // Start fetching data
        const feedsDataPromise = FeedsView.fetchFeedsData();
        // Catch error in the public promise so Router doesn't crash on await
        this.feedsLoadPromise = feedsDataPromise.catch(() => null);

        try {
            const data = await feedsDataPromise;
            this.feedsLoaded = true;

            // Defer rendering to allow Article Request to start first (prevents Favicon blocking)
            setTimeout(() => {
                FeedsView.render(data);
            }, 0);
        } catch (err) {
            console.error('Init feeds failed', err);
            DOMElements.feedsList.innerHTML = `
                <div class="error-msg" style="padding: 20px; text-align: center;">
                    <p style="margin-bottom: 12px; color: var(--accent-color);">${i18n.t('common.load_error')}</p>
                    <button class="btn btn-primary" onclick="window.location.reload()">${i18n.t('common.retry') || 'Retry'}</button>
                </div>
            `;
        }
    },

    async waitForFeedsLoaded() {
        if (!this.feedsLoaded && this.feedsLoadPromise) {
            await this.feedsLoadPromise;
        }
    },

    // ==================== Feeds 相关 ====================

    async loadFeeds() {
        await FeedsView.loadFeeds();
    },

    renderFeedsList(feeds, groups = []) {
        FeedsView.renderFeedsList(feeds, groups);
    },

    selectFeed(feedId) {
        FeedsView.selectFeed(feedId);
    },

    selectGroup(groupId) {
        FeedsView.selectGroup(groupId);
    },

    selectFavorites() {
        FeedsView.selectFavorites();
    },

    selectDigests() {
        FeedsView.selectDigests();
    },

    updateSidebarActiveState(options) {
        FeedsView.updateSidebarActiveState(options);
    },

    getCollapsedGroups() {
        return FeedsView.getCollapsedGroups();
    },

    async setGroupCollapsed(groupId, collapsed) {
        await FeedsView.setGroupCollapsed(groupId, collapsed);
    },

    getPinnedGroups() {
        return FeedsView.getPinnedGroups();
    },

    async setGroupPinned(groupId, pinned) {
        await FeedsView.setGroupPinned(groupId, pinned);
    },

    async togglePinGroup(groupId, pinned) {
        const id = parseInt(groupId, 10);
        await this.setGroupPinned(id, pinned);
        await this.loadFeeds();
    },

    async renameGroup(groupId, newName) {
        try {
            await FeedManager.updateGroup(groupId, { name: newName });
            await this.loadFeeds();
        } catch (err) {
            await Modal.alert(err.message);
        }
    },

    async deleteGroup(groupId) {
        try {
            await FeedManager.deleteGroup(groupId);
            await this.loadFeeds();
        } catch (err) {
            await Modal.alert(err.message);
        }
    },

    async moveFeedToGroup(feedId, groupId) {
        try {
            await FeedManager.updateFeedGroup(feedId, groupId);
            await this.loadFeeds();
        } catch (err) {
            await Modal.alert(err.message);
        }
    },

    async deleteFeed(feedId) {
        try {
            await FeedManager.deleteFeed(feedId);
            await this.loadFeeds();
        } catch (err) {
            await Modal.alert(err.message);
        }
    },

    // ==================== 路由渲染方法 ====================

    async _renderFeed(feedId) {
        await this.waitForFeedsLoaded();

        // 检查是否需要跳过重复加载（滑动返回时不刷新，点击时刷新）
        const isSame = !AppState.isSearchMode &&
            (AppState.currentFeedId == (feedId || '') || (feedId === null && !AppState.currentFeedId)) &&
            !AppState.currentGroupId && !AppState.viewingFavorites && !AppState.viewingDigests && AppState.articles.length > 0;

        if (isSame && !this.forceRefreshList) {
            if (window.innerWidth <= BREAKPOINT_TABLET) this.showPanel('articles');
            this._restoreScrollPosition();
            return;
        }

        // 重置强制刷新标记
        this.forceRefreshList = false;

        // 退出搜索模式
        AppState.isSearchMode = false;
        AppState.searchQuery = '';

        AppState.currentFeedId = feedId;
        AppState.currentGroupId = null;
        AppState.viewingFavorites = false;
        AppState.viewingDigests = false;

        const filterKey = feedId ? `feed_${feedId}` : 'all';
        const saved = this.loadFilterSetting(filterKey);
        AppState.showUnreadOnly = saved !== null ? saved : true;

        this.updateSidebarActiveState({ feedId });

        if (feedId) {
            const feed = AppState.feeds.find(f => f.id == feedId);
            DOMElements.currentFeedTitle.textContent = feed?.title || i18n.t('nav.article_list');
        } else {
            DOMElements.currentFeedTitle.textContent = i18n.t('nav.all');
        }

        // 先显示面板，让骨架屏可见
        if (window.innerWidth <= BREAKPOINT_TABLET) this.showPanel('articles');
        await this.loadArticles(feedId, null);
    },

    async _renderGroup(groupId) {
        await this.waitForFeedsLoaded();

        // 检查是否需要跳过重复加载
        if (!AppState.isSearchMode && AppState.currentGroupId == groupId && AppState.articles.length > 0 && !this.forceRefreshList) {
            if (window.innerWidth <= BREAKPOINT_TABLET) this.showPanel('articles');
            this._restoreScrollPosition();
            return;
        }

        // 重置强制刷新标记
        this.forceRefreshList = false;

        // 退出搜索模式
        AppState.isSearchMode = false;
        AppState.searchQuery = '';

        AppState.currentFeedId = null;
        AppState.currentGroupId = groupId;
        AppState.viewingFavorites = false;
        AppState.viewingDigests = false;

        const saved = this.loadFilterSetting(`group_${groupId}`);
        AppState.showUnreadOnly = saved !== null ? saved : true;

        this.updateSidebarActiveState({ groupId });

        const group = AppState.groups?.find(g => g.id == groupId);
        DOMElements.currentFeedTitle.textContent = group?.name || i18n.t('nav.group_articles');

        // 先显示面板，让骨架屏可见
        if (window.innerWidth <= BREAKPOINT_TABLET) this.showPanel('articles');
        await this.loadArticles(null, groupId);
    },

    async _renderFavorites() {
        await this.waitForFeedsLoaded();

        // 检查是否需要跳过重复加载
        if (!AppState.isSearchMode && AppState.viewingFavorites === true && AppState.articles.length > 0 && !this.forceRefreshList) {
            if (window.innerWidth <= BREAKPOINT_TABLET) this.showPanel('articles');
            this._restoreScrollPosition();
            return;
        }

        // 重置强制刷新标记
        this.forceRefreshList = false;

        // 退出搜索模式
        AppState.isSearchMode = false;
        AppState.searchQuery = '';

        AppState.currentFeedId = null;
        AppState.currentGroupId = null;
        AppState.viewingFavorites = true;
        AppState.viewingDigests = false;
        AppState.showUnreadOnly = false;

        this.updateSidebarActiveState({ favorites: true });
        DOMElements.currentFeedTitle.textContent = i18n.t('nav.starred');

        // 先显示面板，让骨架屏可见
        if (window.innerWidth <= BREAKPOINT_TABLET) this.showPanel('articles');
        await this.loadArticles(null, null);
    },

    async _renderDigests() {
        await this.waitForFeedsLoaded();

        if (!AppState.isSearchMode && AppState.viewingDigests === true && AppState.articles.length > 0 && !this.forceRefreshList) {
            if (window.innerWidth <= BREAKPOINT_TABLET) this.showPanel('articles');
            this._restoreScrollPosition();
            return;
        }

        this.forceRefreshList = false;
        AppState.isSearchMode = false;
        AppState.searchQuery = '';

        AppState.currentFeedId = null;
        AppState.currentGroupId = null;
        AppState.viewingFavorites = false;
        AppState.viewingDigests = true;
        // Briefings default to unread only or all? User implies "only unread at top", suggesting we might show all but prioritize.
        // Let's default to whatever filter logic or just show all for now.
        AppState.showUnreadOnly = false;

        this.updateSidebarActiveState({ digests: true });
        DOMElements.currentFeedTitle.textContent = i18n.t('nav.briefings');

        if (window.innerWidth <= BREAKPOINT_TABLET) this.showPanel('articles');
        await this.loadArticles(null, null);
    },

    _restoreScrollPosition() {
        // Clear article content DOM to release memory from complex HTML (prevents iOS Safari freeze)
        // Only do this on iOS Safari, as it causes white screen issues on Android Chrome
        if (isIOSSafari() && DOMElements.articleContent) {
            DOMElements.articleContent.innerHTML = '';
        }

        if (this.useVirtualScroll && this.virtualList) {
            if (AppState.lastListViewScrollTop !== null) {
                this.virtualList.setScrollTop(AppState.lastListViewScrollTop);
            }
            this.virtualList.render();
        } else {
            const isEmpty = DOMElements.articlesList.innerHTML.trim() === '' ||
                DOMElements.articlesList.querySelector('.loading');
            if (isEmpty) {
                ArticlesView.renderArticlesList(AppState.articles);
            }
            if (AppState.lastListViewScrollTop !== null) {
                DOMElements.articlesList.scrollTop = AppState.lastListViewScrollTop;
            }
        }
    },

    // ==================== Articles 相关 ====================

    async loadArticles(feedId, groupId = null) {
        await ArticlesView.loadArticles(feedId, groupId);
        this._syncStateToModules();
        this.refreshFeedCounts();
    },

    renderArticlesList(articles) {
        ArticlesView.renderArticlesList(articles);
        this._syncStateToModules();
    },

    async loadMoreArticles(showButton = false) {
        await ArticlesView.loadMoreArticles(showButton);
        this._syncStateToModules();
    },

    startNewArticlesPoller() {
        ArticlesView.startNewArticlesPoller();
        this.checkInterval = ArticlesView.checkInterval;
    },

    stopNewArticlesPoller() {
        ArticlesView.stopNewArticlesPoller();
        this.checkInterval = null;
    },

    async checkForNewArticles() {
        await ArticlesView.checkForNewArticles();
    },

    /** 防抖刷新计数的定时器 */
    _refreshCountsTimer: null,
    /** 防抖延迟 (ms) */
    _refreshCountsDelay: 1000,

    async refreshFeedCounts() {
        try {
            // Fetch Feeds, Groups and Digest Counts
            const [feeds, groups, digests] = await Promise.all([
                FeedManager.getFeeds(),
                FeedManager.getGroups(),
                FeedManager.getDigests({ unreadOnly: true })
            ]);
            AppState.feeds = feeds;
            AppState.groups = groups;
            // Store digests count/metadata if needed? No, pass it to view
            this.updateFeedUnreadCounts(digests && digests.digests ? digests.digests : null);

            await ArticlesView.checkUnreadDigestsAndShowToast(digests);
        } catch (err) {
            console.debug('Refresh feed counts failed', err);
        }
    },

    /**
     * 防抖版本的 refreshFeedCounts
     * 用于滚动标记已读等高频场景，合并多次调用为一次请求
     */
    debouncedRefreshFeedCounts() {
        if (this._refreshCountsTimer) {
            clearTimeout(this._refreshCountsTimer);
        }
        this._refreshCountsTimer = setTimeout(() => {
            this._refreshCountsTimer = null;
            this.refreshFeedCounts();
        }, this._refreshCountsDelay);
    },

    updateFeedUnreadCounts(digestsData = null) {
        if (DOMElements.feedsList.innerHTML.trim() === '') {
            // 如果列表为空，则全量渲染
            FeedsView.renderFeedsList(AppState.feeds, AppState.groups, digestsData);
        } else {
            // 否则只更新计数，避免重绘闪烁
            FeedsView.updateUnreadCounts(AppState.feeds, AppState.groups, digestsData);
        }
    },

    // ==================== Article Content 相关 ====================

    selectArticle(articleId) {
        ArticleContentView.selectArticle(articleId);
    },

    async _renderArticle(articleId, cachedArticle = null) {
        await ArticleContentView._renderArticle(articleId, cachedArticle);
    },

    async showArticleView(articleId) {
        await this._renderArticle(articleId);
    },

    // ==================== Context Menu 相关 ====================

    showGroupContextMenu(event, groupId) {
        ContextMenu.showGroupContextMenu(event, groupId);
    },

    showFeedContextMenu(event, feedId) {
        ContextMenu.showFeedContextMenu(event, feedId);
    },

    showArticlesContextMenu(event) {
        ContextMenu.showArticlesContextMenu(event);
    },

    // ==================== Digest 相关 ====================

    generateDigest(scope = 'all', feedId = null, groupId = null) {
        DigestView.generate(scope, feedId, groupId);
    },

    generateDigestForFeed(feedId) {
        DigestView.generateForFeed(feedId);
    },

    generateDigestForGroup(groupId) {
        DigestView.generateForGroup(groupId);
    },

    // ==================== Dialog 相关 ====================

    showAddFeedDialog() {
        Dialogs.showAddFeedDialog();
    },

    showEditFeedDialog(feedId) {
        Dialogs.showEditFeedDialog(feedId);
    },

    showGroupManagerDialog() {
        Dialogs.showGroupManagerDialog();
    },

    showSettingsDialog(forceMode = false) {
        Dialogs.showSettingsDialog(forceMode);
    },

    showDigestScheduleDialog(context) {
        Dialogs.showDigestScheduleDialog(context);
    },

    // ==================== Search 相关 ====================

    showSearchDialog() {
        SearchView.showSearchDialog();
    },

    // ==================== Panel/Gestures 相关 ====================

    showPanel(panel) {
        Gestures.showPanel(panel);
    },

    bindSwipeGestures() {
        Gestures.bindSwipeGestures();
    },

    // ==================== Settings/Filter 相关 ====================

    loadFilterSetting(key) {
        // 优先从 list_filters 命名空间读取
        if (AppState.preferences?.list_filters?.[key] !== undefined) {
            return AppState.preferences.list_filters[key];
        }
        // 向下兼容：旧版可能存在顶层
        if (AppState.preferences?.[key] !== undefined) {
            return AppState.preferences[key];
        }
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY_FILTERS) || '{}');
            return stored[key] !== undefined ? stored[key] : null;
        } catch {
            return null;
        }
    },

    async saveFilterSetting(key, value) {
        AppState.preferences = AppState.preferences || {};
        AppState.preferences.list_filters = AppState.preferences.list_filters || {};
        AppState.preferences.list_filters[key] = value;

        try {
            // 以 list_filters 整体保存，避免散装 key
            await FeedManager.setPreference('list_filters', AppState.preferences.list_filters);
        } catch (err) {
            console.error('Sync preference error:', err);
        }

        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY_FILTERS) || '{}');
            stored[key] = value;
            localStorage.setItem(STORAGE_KEY_FILTERS, JSON.stringify(stored));
        } catch (err) {
            console.error('Save settings error:', err);
        }
    },

    // ==================== Utility 相关 ====================

    formatDate,
    isIOSSafari,
    isMobileDevice,
    extractFirstImage,
    getThumbnailUrl,
    showToast,

    handleWindowResize() {
        // 仅在移动端尺寸下处理面板显示逻辑
        if (window.innerWidth <= BREAKPOINT_MOBILE) {
            // 如果有选中文章且当前路由是文章页，优先显示文章内容
            // Fix: 增加路由判断，防止在列表页(如 #/all) 且有残留 currentArticleId 时，
            // 触发 resize (如键盘弹出) 导致错误跳回文章页
            if (AppState.currentArticleId && window.location.hash.startsWith('#/article/')) {
                this.showPanel('content');
            }
            // 如果在订阅源列表路由，显示订阅源
            else if (window.location.hash === '#/feeds') {
                this.showPanel('feeds');
            }
            // 默认显示文章列表
            else {
                this.showPanel('articles');
            }
        } else if (window.innerWidth <= BREAKPOINT_TABLET) {
            // 平板/窄屏模式
            // 如果路由是 feeds，显示 feeds 面板 (作为 overlay)
            if (window.location.hash === '#/feeds') {
                this.showPanel('feeds');
            } else {
                // 否则确保 feeds 面板隐藏 (移除 active)
                DOMElements.feedsPanel?.classList.remove('active');
            }
        }
    },

    // ==================== 订阅栏宽度调节（仅桌面端） ====================

    initFeedsPanelResize() {
        const panel = DOMElements.feedsPanel;
        const handle = document.getElementById('feeds-panel-resize-handle');
        if (!panel || !handle) return;

        const STORAGE_WIDTH = 'tidyflux_feedsPanelWidth';
        const MIN_W = 160;
        const MAX_W = 400;

        const applyWidth = (w) => {
            const px = Math.round(Math.max(MIN_W, Math.min(MAX_W, w))) + 'px';
            panel.style.width = px;
            panel.style.minWidth = px;
            panel.style.maxWidth = px;
        };

        try {
            const savedW = parseInt(localStorage.getItem(STORAGE_WIDTH), 10);
            if (!isNaN(savedW)) applyWidth(savedW);
        } catch (_) { }

        let startX = 0, startW = 0;
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startX = e.clientX;
            startW = panel.offsetWidth;
            handle.classList.add('feeds-panel-resize-handle--dragging');
            const onMove = (e2) => {
                const dx = e2.clientX - startX;
                applyWidth(startW + dx);
            };
            const onUp = () => {
                handle.classList.remove('feeds-panel-resize-handle--dragging');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                try {
                    localStorage.setItem(STORAGE_WIDTH, String(panel.offsetWidth));
                } catch (_) { }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    },

    // ==================== Event Binding ====================

    bindEvents() {
        this.initFeedsPanelResize();
        this.bindSwipeGestures();

        // 绑定窗口调整事件，解决从桌面端切换到移动端时的空白问题
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.handleWindowResize();
            }, 100);
        });

        document.getElementById('add-feed-btn')?.addEventListener('click', () => {
            this.showAddFeedDialog();
        });

        document.getElementById('settings-btn')?.addEventListener('click', () => {
            this.showSettingsDialog();
        });

        DOMElements.scrollToTopBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();

            // 1. 立即回到顶部 (提供即时反馈)
            if (DOMElements.articlesList) {
                if (ArticlesView.useVirtualScroll && ArticlesView.virtualList) {
                    ArticlesView.virtualList.setScrollTop(0);
                    ArticlesView.virtualList.render();
                } else {
                    DOMElements.articlesList.scrollTop = 0;
                }
            }

            // 2. 如果是搜索模式，仅回到顶部，不刷新（保留搜索上下文）
            if (AppState.isSearchMode) return;

            // 3. 强制刷新当前列表
            this.forceRefreshList = true;

            // 显示加载状态（可选，也可以依赖 loadArticles 的处理）
            // DOMElements.articlesList.innerHTML = `<div class="loading">${i18n.t('common.loading')}</div>`;

            if (AppState.viewingDigests) {
                await this._renderDigests();
            } else if (AppState.viewingFavorites) {
                await this._renderFavorites();
            } else if (AppState.currentGroupId) {
                await this._renderGroup(AppState.currentGroupId);
            } else {
                await this._renderFeed(AppState.currentFeedId);
            }
        });

        document.getElementById('articles-search-btn')?.addEventListener('click', () => {
            SearchView.showInlineSearchBox();
        });

        document.getElementById('articles-refresh-btn')?.addEventListener('click', async (e) => {
            e.stopPropagation();

            const btn = document.getElementById('articles-refresh-btn');
            if (btn.classList.contains('is-loading')) return;

            btn.classList.add('is-loading');
            try {
                await this.loadArticles(AppState.currentFeedId, AppState.currentGroupId);
            } catch (err) {
                console.error('Refresh failed:', err);
            } finally {
                btn.classList.remove('is-loading');
            }
        });

        // Scroll-to-top triggers an immediate article reload
        let wasScrolledDown = false;
        let scrollTopCooldown = false;
        DOMElements.articlesList.addEventListener('scroll', () => {
            if (DOMElements.articlesList.scrollTop > 50) {
                wasScrolledDown = true;
            } else if (DOMElements.articlesList.scrollTop === 0 && wasScrolledDown && !scrollTopCooldown) {
                wasScrolledDown = false;
                scrollTopCooldown = true;
                setTimeout(() => {
                    this.checkForNewArticles().catch(() => { });
                }, 500);
                setTimeout(() => { scrollTopCooldown = false; }, 3000);
            }
        }, { passive: true });

        document.getElementById('articles-menu-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showArticlesContextMenu(e);
        });

        // 移动端显示订阅源面板按钮
        document.getElementById('show-feeds-btn')?.addEventListener('click', () => {
            this.isProgrammaticNav = true;
            window.location.hash = '#/feeds';
        });

        // Throttled scroll handler
        let scrollTicking = false;
        DOMElements.articlesList?.addEventListener('scroll', () => {
            if (!scrollTicking) {
                window.requestAnimationFrame(() => {
                    ArticlesView.handleArticlesScroll();
                    scrollTicking = false;
                });
                scrollTicking = true;
            }
        });

        // 点击外部关闭订阅源面板 (仅在 801-1100px 双栏模式下有效)
        document.addEventListener('click', (e) => {
            if (window.innerWidth > BREAKPOINT_MOBILE && window.innerWidth <= BREAKPOINT_TABLET) {
                const feedsPanel = DOMElements.feedsPanel;
                const toggleBtn = document.getElementById('show-feeds-btn');

                // 如果面板是激活的
                if (feedsPanel && feedsPanel.classList.contains('active')) {
                    // 如果点击不在面板内，也不在切换按钮上
                    if (!feedsPanel.contains(e.target) && (!toggleBtn || !toggleBtn.contains(e.target))) {
                        if (window.location.hash === '#/feeds') {
                            this.isProgrammaticNav = true;
                            history.back();
                        } else {
                            feedsPanel.classList.remove('active');
                        }
                    }
                }
            }
        });
    },

    // ==================== Legacy/Compat 方法 ====================

    /** @deprecated 空方法，保留兼容性 */
    showListView() { },

    showFeedList() {
        this.initThreeColumnLayout();
    }
};
