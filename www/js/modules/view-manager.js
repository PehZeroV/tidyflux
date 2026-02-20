/**
 * ViewManager - Tidyflux 视图管理器
 * 重构版本：作为模块协调器
 * @module view-manager
 */

import { DOMElements } from '../dom.js';
import { AppState } from '../state.js';
import { BREAKPOINTS } from '../constants.js';
import { FeedManager } from './feed-manager.js';
import { i18n } from './i18n.js';
import { AIService } from './ai-service.js';

// 导入子模块
import { AuthView } from './view/auth-view.js';
import { FeedsView } from './view/feeds-view.js';
import { ArticlesView } from './view/articles-view.js';
import { ArticlesTitleTranslation } from './view/articles-title-translation.js';
import { ArticleContentView } from './view/article-content.js';
import { Dialogs } from './view/dialogs.js';
import { SearchView } from './view/search-view.js';
import { Gestures } from './view/gestures.js';
import { ContextMenu } from './view/context-menu.js';
import { DigestView } from './view/digest-view.js';
import { isIOSSafari } from './view/utils.js';
import { Modal } from './view/components.js';

const STORAGE_KEY_FILTERS = 'tidyflux_list_filters';
const BREAKPOINT_MOBILE = BREAKPOINTS.MOBILE;
const BREAKPOINT_TABLET = BREAKPOINTS.DESKTOP;

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



    // ==================== Auth 相关 ====================

    async showAuthView() {
        this.initSubModules();
        await AuthView.showAuthView();
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

    selectToday() {
        FeedsView.selectToday();
    },

    selectHistory() {
        FeedsView.selectHistory();
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


    // ==================== 路由渲染方法 ====================

    /**
     * 通用视图渲染方法（所有 _render* 内部调用此方法）
     * @param {Object} config
     * @param {Function} config.isSame - 判断当前视图是否相同（用于跳过重复加载）
     * @param {Object} config.state - 要设置的 AppState 属性 { currentFeedId, currentGroupId, viewing* }
     * @param {string|null} config.filterKey - 筛选设置的 key，null 表示不从设置中读取
     * @param {boolean} config.defaultUnread - filterKey 无保存值时的默认值
     * @param {Object} config.sidebarState - 传给 updateSidebarActiveState 的参数
     * @param {string} config.title - 页面标题
     * @param {string|null} config.feedId - 传给 loadArticles 的 feedId
     * @param {string|null} config.groupId - 传给 loadArticles 的 groupId
     */
    async _renderView(config) {
        await this.waitForFeedsLoaded();

        // 检查是否需要跳过重复加载
        if (!AppState.isSearchMode && config.isSame() && AppState.articles.length > 0 && !this.forceRefreshList) {
            if (window.innerWidth <= BREAKPOINT_TABLET) this.showPanel('articles');
            this._restoreScrollPosition();
            return;
        }

        this.forceRefreshList = false;
        AppState.isSearchMode = false;
        AppState.searchQuery = '';

        // 设置 AppState
        AppState.currentFeedId = config.state.currentFeedId ?? null;
        AppState.currentGroupId = config.state.currentGroupId ?? null;
        AppState.viewingFavorites = config.state.viewingFavorites ?? false;
        AppState.viewingDigests = config.state.viewingDigests ?? false;
        AppState.viewingToday = config.state.viewingToday ?? false;
        AppState.viewingHistory = config.state.viewingHistory ?? false;

        // 设置筛选
        if (config.filterKey) {
            const saved = this.loadFilterSetting(config.filterKey);
            AppState.showUnreadOnly = saved !== null ? saved : (config.defaultUnread ?? true);
        } else {
            AppState.showUnreadOnly = config.defaultUnread ?? false;
        }

        this.updateSidebarActiveState(config.sidebarState);
        DOMElements.currentFeedTitle.textContent = config.title;

        if (window.innerWidth <= BREAKPOINT_TABLET) this.showPanel('articles');
        await this.loadArticles(config.feedId ?? null, config.groupId ?? null);
    },

    async _renderFeed(feedId) {
        const title = feedId
            ? (AppState.feeds?.find(f => f.id == feedId)?.title || i18n.t('nav.article_list'))
            : i18n.t('nav.all');

        await this._renderView({
            isSame: () => (AppState.currentFeedId == (feedId || '') || (feedId === null && !AppState.currentFeedId))
                && !AppState.currentGroupId && !AppState.viewingFavorites && !AppState.viewingDigests
                && !AppState.viewingToday && !AppState.viewingHistory,
            state: { currentFeedId: feedId },
            filterKey: feedId ? `feed_${feedId}` : 'all',
            defaultUnread: true,
            sidebarState: { feedId },
            title,
            feedId,
        });
    },

    async _renderGroup(groupId) {
        const group = AppState.groups?.find(g => g.id == groupId);
        await this._renderView({
            isSame: () => AppState.currentGroupId == groupId,
            state: { currentGroupId: groupId },
            filterKey: `group_${groupId}`,
            defaultUnread: true,
            sidebarState: { groupId },
            title: group?.name || i18n.t('nav.group_articles'),
            groupId,
        });
    },

    async _renderFavorites() {
        await this._renderView({
            isSame: () => AppState.viewingFavorites === true,
            state: { viewingFavorites: true },
            filterKey: null,
            defaultUnread: false,
            sidebarState: { favorites: true },
            title: i18n.t('nav.starred'),
        });
    },

    async _renderDigests() {
        await this._renderView({
            isSame: () => AppState.viewingDigests === true,
            state: { viewingDigests: true },
            filterKey: null,
            defaultUnread: false,
            sidebarState: { digests: true },
            title: i18n.t('nav.briefings'),
        });
    },

    async _renderToday() {
        await this._renderView({
            isSame: () => AppState.viewingToday === true,
            state: { viewingToday: true },
            filterKey: 'today',
            defaultUnread: true,
            sidebarState: { today: true },
            title: i18n.t('nav.today'),
        });
    },

    async _renderHistory() {
        await this._renderView({
            isSame: () => AppState.viewingHistory === true,
            state: { viewingHistory: true },
            filterKey: null,
            defaultUnread: false,
            sidebarState: { history: true },
            title: i18n.t('nav.history'),
        });
    },

    _restoreScrollPosition() {
        // Clear article content DOM to release memory from complex HTML (prevents iOS Safari freeze)
        // Only do this on iOS Safari, as it causes white screen issues on Android Chrome
        if (isIOSSafari() && DOMElements.articleContent) {
            DOMElements.articleContent.innerHTML = '';
        }

        if (ArticlesView.useVirtualScroll && ArticlesView.virtualList) {
            if (AppState.lastListViewScrollTop !== null) {
                ArticlesView.virtualList.setScrollTop(AppState.lastListViewScrollTop);
            }
            ArticlesView.virtualList.render();
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
        this.refreshFeedCounts();
    },

    renderArticlesList(articles) {
        ArticlesView.renderArticlesList(articles);
    },

    async loadMoreArticles(showButton = false) {
        await ArticlesView.loadMoreArticles(showButton);
    },

    startNewArticlesPoller() {
        ArticlesView.startNewArticlesPoller();
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
            // Fetch Feeds, Groups, Digest Counts and Today Unread Count
            const [feeds, groups, digests, todayUnread] = await Promise.all([
                FeedManager.getFeeds(),
                FeedManager.getGroups(),
                FeedManager.getDigests({ unreadOnly: true }),
                FeedManager.getTodayUnreadCount()
            ]);
            AppState.feeds = feeds;
            AppState.groups = groups;
            this.updateFeedUnreadCounts(digests && digests.digests ? digests.digests : null, todayUnread);

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

    updateFeedUnreadCounts(digestsData = null, todayUnread = 0) {
        if (DOMElements.feedsList.innerHTML.trim() === '') {
            // 如果列表为空，则全量渲染
            FeedsView.renderFeedsList(AppState.feeds, AppState.groups, digestsData, todayUnread);
        } else {
            // 否则只更新计数，避免重绘闪烁
            FeedsView.updateUnreadCounts(AppState.feeds, AppState.groups, digestsData, todayUnread);
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

    showArticleItemContextMenu(event, articleId) {
        ContextMenu.showArticleItemContextMenu(event, articleId);
    },

    // ==================== Digest 相关 ====================

    generateDigest(scope = 'all', feedId = null, groupId = null, hours = null, afterTimestamp = null) {
        DigestView.generate(scope, feedId, groupId, hours, afterTimestamp);
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

    // ==================== 面板宽度调节（仅桌面端） ====================

    /**
     * 通用面板拖拽调宽初始化
     * @param {Object} cfg
     * @param {HTMLElement} cfg.panel - 面板元素
     * @param {string} cfg.handleId - 拖拽手柄元素 ID
     * @param {string} cfg.storageKey - localStorage 存储 key
     * @param {number} cfg.minW - 最小宽度
     * @param {number} cfg.maxW - 最大宽度
     * @param {string} cfg.draggingClass - 拖拽时添加到 handle 的 CSS class
     * @param {boolean} cfg.bodyResizingClass - 是否给 body 添加 panel-resizing class
     */
    _initPanelResize({ panel, handleId, storageKey, minW, maxW, draggingClass, bodyResizingClass = false }) {
        const handle = document.getElementById(handleId);
        if (!panel || !handle) return;

        const HOVER_DELAY = 300;

        const applyWidth = (w) => {
            const px = Math.round(Math.max(minW, Math.min(maxW, w))) + 'px';
            panel.style.width = px;
            panel.style.minWidth = px;
            panel.style.maxWidth = px;
        };

        try {
            const savedW = parseInt(localStorage.getItem(storageKey), 10);
            if (!isNaN(savedW)) applyWidth(savedW);
        } catch (_) { }

        let cursorTimer = null;
        handle.addEventListener('mouseenter', () => {
            cursorTimer = setTimeout(() => { handle.style.cursor = 'col-resize'; }, HOVER_DELAY);
        });
        handle.addEventListener('mouseleave', () => {
            clearTimeout(cursorTimer);
            handle.style.cursor = '';
        });

        let startX = 0, startW = 0;
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            clearTimeout(cursorTimer);
            handle.style.cursor = 'col-resize';
            startX = e.clientX;
            startW = panel.offsetWidth;
            handle.classList.add(draggingClass);
            if (bodyResizingClass) document.body.classList.add('panel-resizing');
            const onMove = (e2) => {
                const dx = e2.clientX - startX;
                applyWidth(startW + dx);
            };
            const onUp = () => {
                handle.classList.remove(draggingClass);
                if (bodyResizingClass) document.body.classList.remove('panel-resizing');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                try { localStorage.setItem(storageKey, String(panel.offsetWidth)); } catch (_) { }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    },

    initFeedsPanelResize() {
        this._initPanelResize({
            panel: DOMElements.feedsPanel,
            handleId: 'feeds-panel-resize-handle',
            storageKey: 'tidyflux_feedsPanelWidth',
            minW: 160, maxW: 400,
            draggingClass: 'feeds-panel-resize-handle--dragging',
        });
    },

    initArticlesPanelResize() {
        this._initPanelResize({
            panel: DOMElements.articlesPanel,
            handleId: 'articles-panel-resize-handle',
            storageKey: 'tidyflux_articlesPanelWidth',
            minW: 280, maxW: 600,
            draggingClass: 'articles-panel-resize-handle--dragging',
            bodyResizingClass: true,
        });
    },

    // ==================== Event Binding ====================

    bindEvents() {
        this.initFeedsPanelResize();
        this.initArticlesPanelResize();
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


            if (AppState.viewingToday) {
                await this._renderToday();
            } else if (AppState.viewingDigests) {
                await this._renderDigests();
            } else if (AppState.viewingFavorites) {
                await this._renderFavorites();
            } else if (AppState.viewingHistory) {
                await this._renderHistory();
            } else if (AppState.currentGroupId) {
                await this._renderGroup(AppState.currentGroupId);
            } else {
                await this._renderFeed(AppState.currentFeedId);
            }
        });

        document.getElementById('articles-search-btn')?.addEventListener('click', () => {
            SearchView.showInlineSearchBox();
        });

        // 翻译标题按钮（切换：显示翻译 / 隐藏翻译）
        const translateBtn = document.getElementById('articles-translate-btn');
        if (translateBtn) {
            // 根据配置控制按钮可见性
            if (AIService.getConfig().showTranslateBtn === false) {
                translateBtn.style.display = 'none';
            }
            translateBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!AIService.isConfigured()) {
                    Modal.alertWithSettings(i18n.t('ai.not_configured'), i18n.t('common.go_to_settings'), () => Dialogs.showSettingsDialog(false));
                    return;
                }

                // 判断当前视图是否整体开启了自动翻译
                let isAutoTranslateView = false;
                if (!ArticlesTitleTranslation._translationHidden) {
                    if (AppState.currentFeedId) {
                        isAutoTranslateView = AIService.shouldTranslateFeed(AppState.currentFeedId);
                    } else if (AppState.currentGroupId) {
                        isAutoTranslateView = AIService.getGroupTranslationOverride(AppState.currentGroupId) === 'on';
                    }
                }

                if (ArticlesTitleTranslation._manualTranslateActive || isAutoTranslateView) {
                    // 翻译正在显示 → 隐藏所有
                    ArticlesTitleTranslation.hideAllTranslations();
                } else if (ArticlesTitleTranslation._translationHidden) {
                    // 翻译已隐藏 → 恢复显示
                    await ArticlesTitleTranslation.showAllTranslations();
                } else {
                    // 初始状态（无自动翻译）→ 启动手动翻译
                    await ArticlesTitleTranslation.manualTranslateTitles();
                }
                ArticlesTitleTranslation.updateTranslateBtnTooltip();
            });
        }

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

        // 文章列表项右键菜单（事件委托，适用于虚拟列表和普通列表）
        DOMElements.articlesList?.addEventListener('contextmenu', (e) => {
            const articleItem = e.target.closest('.article-item');
            if (articleItem) {
                e.preventDefault();
                const articleId = articleItem.dataset.id;
                if (articleId) {
                    this.showArticleItemContextMenu(e, articleId);
                }
            }
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

};
