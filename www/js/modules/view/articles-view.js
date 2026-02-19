import { DOMElements } from '../../dom.js';
import { AppState } from '../../state.js';
import { FeedManager } from '../feed-manager.js';
import { VirtualList } from '../virtual-list.js';
import { formatDate, isMobileDevice, showToast, escapeHtml } from './utils.js';
import { i18n } from '../i18n.js';
import { AIService } from '../ai-service.js';

/**
 * 列表判定与功能常量配置
 */
const ARTICLES_CONFIG = {
    VIRTUAL_SCROLL_THRESHOLD: 50,      // 触发虚拟滚动的文章数量阈值
    PAGINATION_LIMIT: 50,              // 每页加载的文章数量
    SCROLL_TOP_THRESHOLD: 300,         // 显示回到顶部按钮的滚动高度
    NEW_ARTICLES_CHECK_MS: 10 * 1000,  // 新文章轮询间隔 (10秒)
    VIRTUAL_ITEM_HEIGHT: 85,           // 虚拟列表项预计高度
    VIRTUAL_BUFFER_SIZE: 8,            // 虚拟列表缓冲区页数
    SKELETON_COUNT: 12,                // 初始加载时的骨架屏数量
    SCROLL_END_DELAY: 1000,            // 判定滚动停止的延迟 (ms)
    SCROLL_READ_DELAY: 150,            // 滚动标记已读的防抖延迟 (ms)
    SCROLL_READ_BATCH_DELAY: 500,      // 滚动标记已读的批量处理延迟 (ms)
    PRELOAD_THRESHOLD_PX: 800          // 触发下一页预加载的底部剩余高度
};

/**
 * 文章列表视图管理
 */
export const ArticlesView = {
    /** 视图管理器引用 */
    viewManager: null,
    /** 虚拟列表实例 */
    virtualList: null,
    /** 是否使用虚拟滚动 */
    useVirtualScroll: false,
    /** 是否正在加载更多 */
    isLoadingMore: false,
    /** 轮询定时器 */
    checkInterval: null,
    /** 用户是否正在滚动 */
    isScrolling: false,
    /** 滚动结束检测定时器 */
    scrollEndTimer: null,
    /** 待插入的新文章队列（用户滚动时暂存） */
    pendingNewArticles: [],
    /** 当前加载请求 ID (用于解决竞态条件) */
    currentRequestId: 0,
    /** 下一页数据缓存 */
    nextPageCache: null,
    /** 是否正在预加载 */
    isPreloading: false,
    /** 滚动标记已读待处理 ID 集合 */
    _scrollReadPendingIds: new Set(),
    /** 滚动标记已读批量处理定时器 */
    _scrollReadBatchTimer: null,
    /** 标题翻译进行中的 AbortController */
    _titleTranslationAbort: null,
    /** 自动翻译共享队列 */
    _autoTranslateQueue: [],
    /** 自动翻译已入队的文章 ID 集合（去重） */
    _autoTranslateQueued: new Set(),
    /** 自动翻译当前活跃的 worker 数量 */
    _autoTranslateWorkerCount: 0,
    /** 手动翻译模式标记（绕过 shouldTranslateFeed 检查） */
    _manualTranslateActive: false,
    /** 翻译是否被隐藏（点击按钮收起所有翻译） */
    _translationHidden: false,
    /** 手动翻译共享队列 */
    _manualTranslateQueue: [],
    /** 已入队的文章 ID 集合（去重） */
    _manualTranslateQueued: new Set(),
    /** 当前活跃的 worker 数量 */
    _manualTranslateWorkerCount: 0,
    /** 翻译失败记录 Map */
    _titleTranslationFailed: new Map(),
    /**
     * 初始化模块
     * @param {Object} viewManager - ViewManager 实例引用
     */
    init(viewManager) {
        this.viewManager = viewManager;
    },

    /**
     * 加载文章列表
     */
    async loadArticles(feedId, groupId = null) {
        const requestId = Date.now();
        this.currentRequestId = requestId;

        this._resetListState();

        try {
            if (AppState.viewingDigests) {
                await this._loadDigestItems(requestId);
            } else {
                await this._loadNormalArticles(requestId, feedId, groupId);
            }
        } catch (err) {
            if (this.currentRequestId === requestId) {
                console.error('Load articles error:', err);
                DOMElements.articlesList.innerHTML = `<div class="error-msg">${i18n.t('common.load_error')}</div>`;
            }
        }
    },

    /**
     * 重置列表显示状态
     */
    _resetListState() {
        AppState.pagination = null;
        AppState.articles = [];
        this.nextPageCache = null; // Clear cached next page from previous feed
        this.isLoadingMore = false; // Reset loading flag
        this.stopNewArticlesPoller();

        if (this.virtualList) {
            this.virtualList.destroy();
            this.virtualList = null;
        }
        this.useVirtualScroll = false;
        // 取消所有进行中的翻译请求
        if (this._titleTranslationAbort) {
            this._titleTranslationAbort.abort();
            this._titleTranslationAbort = null;
        }
        this._manualTranslateActive = false;
        this._translationHidden = false;
        this._autoTranslateQueue = [];
        this._autoTranslateQueued.clear();
        this._autoTranslateWorkerCount = 0;
        this._manualTranslateQueue = [];
        this._manualTranslateQueued.clear();
        this._manualTranslateWorkerCount = 0;
        this._unbindManualTranslateScroll();
        this.updateTranslateBtnTooltip();

        DOMElements.articlesList.innerHTML = this.generateSkeletonHTML(ARTICLES_CONFIG.SKELETON_COUNT);
        DOMElements.articlesList.scrollTop = 0;
    },

    /**
     * 加载简报列表
     */
    async _loadDigestItems(requestId) {
        const result = await FeedManager.getDigests({
            unreadOnly: AppState.showUnreadOnly
        });

        if (this.currentRequestId !== requestId) return;

        const digestsData = result.digests || { pinned: [], normal: [] };
        const allItems = this._buildDigestList(digestsData);

        AppState.articles = allItems;
        AppState.pagination = {
            page: 1,
            limit: 100,
            total: allItems.length,
            totalPages: 1,
            hasMore: false
        };

        this.renderArticlesList(allItems);
    },

    /**
     * 加载普通文章列表
     */
    async _loadNormalArticles(requestId, feedId, groupId) {
        const params = {
            page: 1,
            feedId,
            groupId,
            unreadOnly: AppState.showUnreadOnly,
            favorites: AppState.viewingFavorites
        };

        // 今天模式：只加载今天的文章
        if (AppState.viewingToday) {
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            params.afterPublishedAt = todayStart.toISOString();
        }

        // 历史记录模式：只加载已读文章
        if (AppState.viewingHistory) {
            params.readOnly = true;
        }

        const articlesResult = await FeedManager.getArticles(params);

        if (this.currentRequestId !== requestId) return;

        AppState.articles = articlesResult.articles;
        AppState.pagination = articlesResult.pagination;
        AppState.pagination.page = 1;

        this.renderArticlesList(articlesResult.articles);
        this.startNewArticlesPoller();
        // this.checkUnreadDigestsAndShowToast(); // Handled by ViewManager
        this.preloadNextPage();
    },

    /**
     * 获取今天模式的过滤参数
     * @returns {string|null} afterPublishedAt ISO 字符串
     */
    _getTodayFilter() {
        if (!AppState.viewingToday) return null;
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return todayStart.toISOString();
    },

    /**
     * 获取简报列表
     * @param {string|null} feedId - 订阅源 ID
     * @param {string|null} groupId - 分组 ID
     * @returns {Object} 简报数据
     */
    async fetchDigests(feedId, groupId) {
        try {
            const options = { unreadOnly: AppState.showUnreadOnly };
            if (feedId) {
                options.scope = 'feed';
                options.scopeId = feedId;
            } else if (groupId) {
                options.scope = 'group';
                options.scopeId = groupId;
            }
            const result = await FeedManager.getDigests(options);
            return result.digests || { pinned: [], normal: [] };
        } catch (err) {
            console.warn('Fetch digests failed:', err);
            return { pinned: [], normal: [] };
        }
    },

    /**
     * 构建简报列表（置顶优先，其余按时间排序）
     * @param {Object} digests - 简报数据 { pinned, normal }
     * @returns {Array} 排序后的简报列表
     */
    _buildDigestList(digests) {
        const pinned = digests.pinned || [];
        const normal = (digests.normal || []).sort((a, b) => {
            return new Date(b.published_at) - new Date(a.published_at);
        });
        return [...pinned, ...normal];
    },

    /**
     * 渲染文章列表
     * @param {Array} articles - 文章数组
     */
    renderArticlesList(articles) {
        if (articles.length === 0) {
            if (this.virtualList) {
                this.virtualList.destroy();
                this.virtualList = null;
            }
            this.useVirtualScroll = false;

            const emptyText = AppState.viewingDigests
                ? (i18n.t('digest.no_digests') || i18n.t('article.no_articles'))
                : i18n.t('article.no_articles');

            DOMElements.articlesList.innerHTML = `<div class="empty-msg" style="padding: 40px 20px; text-align: center; color: var(--text-secondary);">${emptyText}</div>`;
            return;
        }


        // 决定是否使用虚拟滚动
        if (isMobileDevice() || articles.length >= ARTICLES_CONFIG.VIRTUAL_SCROLL_THRESHOLD) {
            this.useVirtualScroll = true;
            this.initVirtualList();


            this.virtualList.setItems(articles);
        } else {
            this.useVirtualScroll = false;
            if (this.virtualList) {
                this.virtualList.destroy();
                this.virtualList = null;
            }

            const html = this.generateArticlesHTML(articles);
            DOMElements.articlesList.innerHTML = html;
            this.bindArticleItemEvents();
        }

        // 触发标题翻译
        this.triggerTitleTranslations(articles);
        this.updateTranslateBtnTooltip();
    },

    /**
     * 追加文章到列表
     * @param {Array} articles - 文章数组
     */
    appendArticlesList(articles) {
        if (articles.length === 0) return;

        // 强强制逻辑：只要总数量超过阈值，或者已经启用了虚拟列表，就必须走虚拟列表路径
        // Fallback: 如果 virtualList 实例意外丢失但数量很多，重新初始化
        if (this.useVirtualScroll || AppState.articles.length >= ARTICLES_CONFIG.VIRTUAL_SCROLL_THRESHOLD) {
            if (!this.virtualList) {
                console.warn('VirtualList missing in append mode, re-initializing...');
                // 如果没有实例，可能是从未初始化过，需要用全量数据初始化
                this.useVirtualScroll = true;
                this.initVirtualList(); // 这会使用 AppState.articles 进行全量渲染
                return;
            }

            // 正常追加
            this.virtualList.appendItems(articles);
            // 触发标题翻译（虚拟列表路径也需要，不取消之前的翻译任务）
            this.triggerTitleTranslations(articles, false);
            return;
        }

        const html = this.generateArticlesHTML(articles);
        DOMElements.articlesList.insertAdjacentHTML('beforeend', html);

        // Bind events for new items
        this.bindArticleItemEvents();

        // 触发标题翻译（追加模式，不取消之前的翻译任务）
        this.triggerTitleTranslations(articles, false);
    },

    /**
     * 初始化虚拟列表
     */
    initVirtualList() {
        if (this.virtualList) {
            this.virtualList.destroy();
            this.virtualList = null;
        }

        const self = this;
        this.virtualList = new VirtualList({
            container: DOMElements.articlesList,
            itemHeight: ARTICLES_CONFIG.VIRTUAL_ITEM_HEIGHT,
            bufferSize: ARTICLES_CONFIG.VIRTUAL_BUFFER_SIZE,
            renderItem: (item) => self.generateSingleArticleHTML(item),
            onItemClick: (item) => self.viewManager.selectArticle(item.id),
            onLoadMore: () => {
                if (!self.isLoadingMore) self.loadMoreArticles();
            },
            getActiveId: () => AppState.currentArticleId,
            onScrolledPast: (items) => self.handleScrollMarkAsRead(items)
        });
    },

    /**
     * 生成单个文章的 HTML（用于虚拟列表）
     * @param {Object} article - 文章对象
     * @returns {string} HTML 字符串
     */
    generateSingleArticleHTML(article) {
        // 检查是否是简报
        if (article.type === 'digest') {
            return this.generateDigestItemHTML(article, true);
        }

        const date = formatDate(article.published_at);
        const isFavorited = article.is_favorited;
        const showThumbnails = AppState.preferences?.show_thumbnails !== false;
        const thumbnail = (showThumbnails && article.thumbnail_url) ? article.thumbnail_url : null;

        const hasImage = !!thumbnail;
        let thumbnailHtml = '';
        if (hasImage) {
            thumbnailHtml = `<div class="article-item-image">
                    <img src="${thumbnail}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none';">
                </div>`;
        }

        // 生成标题 HTML（支持翻译）
        const titleHtml = this._buildTitleHtml(article);
        const hasTranslation = titleHtml.includes('article-title-translated');

        return `
            <div class="article-item-content">
                <div class="article-item-title ${hasTranslation ? 'has-translation' : ''}" data-article-id="${article.id}">${titleHtml}</div>
                <div class="article-item-meta">
                    ${isFavorited ? '<span class="favorited-icon">★</span>' : ''}
                    <span class="feed-title">${escapeHtml(article.feed_title || '')}</span>
                    <span class="article-date">${date}</span>
                </div>
            </div>
            ${thumbnailHtml}
        `;
    },

    /**
     * 生成简报项的 HTML
     * @param {Object} digest - 简报对象
     * @param {boolean} innerOnly - 是否只返回内部内容
     * @returns {string} HTML 字符串
     */
    generateDigestItemHTML(digest, innerOnly = false) {
        const date = formatDate(digest.published_at);
        const unreadClass = digest.is_read ? '' : 'unread';

        const inner = `
            <div class="article-item-content">
                <div class="article-item-title">
                    ${escapeHtml(digest.title)}
                </div>
                <div class="article-item-meta">
                    <span class="digest-label">${i18n.t('digest.title')}</span>
                    <span class="feed-title">${escapeHtml(digest.feed_title || '')}</span>
                    <span class="article-date">${date}</span>
                </div>
            </div>
        `;

        if (innerOnly) {
            return inner;
        }

        return `
            <div class="article-item digest-item ${unreadClass} ${AppState.currentArticleId == digest.id ? 'active' : ''}" data-id="${digest.id}" data-type="digest">
                ${inner}
            </div>
        `;
    },

    /**
     * 生成文章列表 HTML
     * @param {Array} articles - 文章数组
     * @returns {string} HTML 字符串
     */
    generateArticlesHTML(articles) {
        const showThumbnails = AppState.preferences?.show_thumbnails !== false;
        return articles.map(article => {
            // 检查是否是简报
            if (article.type === 'digest') {
                return this.generateDigestItemHTML(article, false);
            }

            const date = formatDate(article.published_at);
            const unreadClass = article.is_read ? '' : 'unread';
            const thumbnail = (showThumbnails && article.thumbnail_url) ? article.thumbnail_url : null;

            const hasImage = !!thumbnail;
            const isFavorited = article.is_favorited;

            let thumbnailHtml = '';
            if (hasImage) {
                thumbnailHtml = `<div class="article-item-image">
                        <img src="${thumbnail}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none';">
                    </div>`;
            }

            // 生成标题 HTML（支持翻译）
            const titleHtml = this._buildTitleHtml(article);
            const hasTranslation = titleHtml.includes('article-title-translated');

            return `
                <div class="article-item ${unreadClass} ${hasImage ? 'has-image' : ''} ${AppState.currentArticleId == article.id ? 'active' : ''}" data-id="${article.id}">
                    <div class="article-item-content">
                        <div class="article-item-title ${hasTranslation ? 'has-translation' : ''}" data-article-id="${article.id}">${titleHtml}</div>
                        <div class="article-item-meta">
                            ${isFavorited ? '<span class="favorited-icon">★</span>' : ''}
                            <span class="feed-title">${escapeHtml(article.feed_title || '')}</span>
                            <span class="article-date">${date}</span>
                        </div>
                    </div>
                    ${thumbnailHtml}
                </div>
            `;
        }).join('');
    },

    /**
     * 构建标题 HTML（支持翻译缓存显示）
     * @param {Object} article - 文章对象
     * @returns {string} 标题 HTML
     */
    // 翻译失败的标题 Map（临时，不持久化，key: title||langId, value: 错误信息）
    _titleTranslationFailed: new Map(),

    _buildTitleHtml(article) {
        const escaped = escapeHtml(article.title);

        // 检查该订阅源是否应翻译标题（三级继承：订阅源 > 分组 > 全局）
        // 手动翻译模式下，如果有缓存或有失败记录，也显示翻译结果
        // 翻译被隐藏时，直接返回原标题
        if (this._translationHidden) {
            return escaped;
        }

        const shouldTranslate = AIService.shouldTranslateFeed(article.feed_id);
        if (!shouldTranslate && !this._manualTranslateActive) {
            return escaped;
        }

        const aiConfig = AIService.getConfig();
        const targetLangId = aiConfig.targetLang || 'zh-CN';
        const cached = AIService.getTitleCache(article.title, targetLangId);
        const mode = aiConfig.titleTranslationMode || 'bilingual';

        // 非自动翻译的订阅源：仅在有缓存或失败记录时显示翻译，不显示 loading
        if (!shouldTranslate && this._manualTranslateActive) {
            if (cached) {
                if (mode === 'translated') {
                    return `<div class="article-title-translated">${escapeHtml(cached)}</div>`;
                }
                return `<div class="article-title-translated">${escapeHtml(cached)}</div><div class="article-title-original">${escaped}</div>`;
            }
            const failKey = `${article.title}||${targetLangId}`;
            const failMsg = this._titleTranslationFailed.get(failKey);
            if (failMsg) {
                return `<div class="title-translate-error">${escapeHtml(failMsg)}</div><div class="article-title-original">${escaped}</div>`;
            }
            // 手动翻译模式但没有缓存也没有失败 → 显示 loading
            return `<div class="title-translating">…</div><div class="article-title-original">${escaped}</div>`;
        }

        if (cached) {
            if (mode === 'translated') {
                return `<div class="article-title-translated">${escapeHtml(cached)}</div>`;
            }
            // 双语模式
            return `<div class="article-title-translated">${escapeHtml(cached)}</div><div class="article-title-original">${escaped}</div>`;
        }

        // 翻译失败的标题：显示错误提示 + 原标题
        const failKey = `${article.title}||${targetLangId}`;
        const failMsg = this._titleTranslationFailed.get(failKey);
        if (failMsg) {
            return `<div class="title-translate-error">${escapeHtml(failMsg)}</div><div class="article-title-original">${escaped}</div>`;
        }

        // 尚未翻译，显示 loading 占位 + 原标题（与翻译后布局一致：翻译在上，原文在下）
        return `<div class="title-translating">…</div><div class="article-title-original">${escaped}</div>`;
    },

    /**
     * @param {Array} articles - 文章数组
     */
    _refreshTitleElements(articles) {
        articles.forEach(a => {
            if (a.type === 'digest') return;
            const titleEl = DOMElements.articlesList.querySelector(`.article-item-title[data-article-id="${a.id}"]`);
            if (!titleEl) return;
            const html = this._buildTitleHtml(a);
            const currentHtml = titleEl.innerHTML;
            // 只在内容变化时更新，减少不必要的 DOM 操作
            if (currentHtml !== html) {
                titleEl.innerHTML = html;
                if (html.includes('article-title-translated') || html.includes('title-translating')) {
                    titleEl.classList.add('has-translation');
                }
            }
        });
    },

    /**
     * 异步批量触发标题翻译并更新 DOM
     * @param {Array} articles - 文章数组
     * @param {boolean} cancelPrevious - 是否取消上一次的翻译任务（默认 true，追加模式下传 false）
     */
    async triggerTitleTranslations(articles, cancelPrevious = true) {
        const aiConfig = AIService.getConfig();
        // AI 未配置则直接返回
        if (!AIService.isConfigured()) return;

        // 仅在全量加载时取消上一次的翻译任务
        if (cancelPrevious) {
            if (this._titleTranslationAbort) {
                this._titleTranslationAbort.abort();
            }
            this._titleTranslationAbort = new AbortController();
            this._titleTranslationFailed.clear();
            // 清空队列和 worker
            this._autoTranslateQueue = [];
            this._autoTranslateQueued.clear();
            this._autoTranslateWorkerCount = 0;
        }

        const targetLangId = aiConfig.targetLang || 'zh-CN';

        // 过滤出需要翻译的文章（未缓存、且该订阅源允许翻译）
        const needTranslate = articles.filter(a => {
            if (!AIService.shouldTranslateFeed(a.feed_id)) return false;
            if (this._autoTranslateQueued.has(a.id)) return false;
            return !AIService.getTitleCache(a.title, targetLangId);
        });

        if (needTranslate.length === 0) {
            this._refreshTitleElements(articles);
            return;
        }

        // 加入共享队列并去重
        for (const a of needTranslate) {
            this._autoTranslateQueue.push(a);
            this._autoTranslateQueued.add(a.id);
        }

        // 启动 worker（补齐到并发上限）
        const CONCURRENT_LIMIT = aiConfig.concurrency || 5;
        while (this._autoTranslateWorkerCount < CONCURRENT_LIMIT && this._autoTranslateQueue.length > 0) {
            this._startAutoTranslateWorker();
        }
    },

    /**
     * 启动一个自动翻译 worker，从共享队列取任务直到队列为空
     */
    async _startAutoTranslateWorker() {
        this._autoTranslateWorkerCount++;

        const aiConfig = AIService.getConfig();
        const targetLangId = aiConfig.targetLang || 'zh-CN';
        const mode = aiConfig.titleTranslationMode || 'bilingual';
        const signal = this._titleTranslationAbort?.signal;
        const BATCH_SIZE = 10;

        try {
            while (this._autoTranslateQueue.length > 0) {
                if (signal?.aborted) return;

                // 从队列头部取一个批次
                const batch = this._autoTranslateQueue.splice(0, BATCH_SIZE);

                try {
                    const resultMap = await AIService.translateTitlesBatch(batch, targetLangId, signal);
                    if (signal?.aborted) return;

                    resultMap.forEach((translated, articleId) => {
                        const titleEl = DOMElements.articlesList.querySelector(`.article-item-title[data-article-id="${articleId}"]`);
                        if (!titleEl) return;
                        const article = AppState.articles.find(a => a.id == articleId);
                        if (!article) return;
                        const escaped = escapeHtml(article.title);
                        if (mode === 'translated') {
                            titleEl.innerHTML = `<div class="article-title-translated">${escapeHtml(translated)}</div>`;
                        } else {
                            titleEl.innerHTML = `<div class="article-title-translated">${escapeHtml(translated)}</div><div class="article-title-original">${escaped}</div>`;
                        }
                        titleEl.classList.add('has-translation');
                    });
                } catch (e) {
                    if (e.name === 'AbortError') return;
                    console.error('[ArticlesView] Title translation batch failed:', e);
                    const statusCode = e.statusCode || e.status || '';
                    const errorMsg = statusCode ? `${i18n.t('ai.translate_failed')} (${statusCode})` : i18n.t('ai.translate_failed');
                    batch.forEach(a => {
                        this._titleTranslationFailed.set(`${a.title}||${targetLangId}`, errorMsg);
                        const titleEl = DOMElements.articlesList.querySelector(`.article-item-title[data-article-id="${a.id}"]`);
                        if (!titleEl) return;
                        titleEl.innerHTML = `<div class="title-translate-error">${escapeHtml(errorMsg)}</div><div class="article-title-original">${escapeHtml(a.title)}</div>`;
                        titleEl.classList.add('has-translation');
                    });
                }
            }
        } finally {
            this._autoTranslateWorkerCount--;
        }
    },

    /**
     * 生成骨架屏 HTML
     * @param {number} count - 骨架项数量
     * @returns {string} HTML 字符串
     */
    generateSkeletonHTML(count = 12) {
        const items = [];
        for (let i = 0; i < count; i++) {
            // 交替显示缩略图骨架（模拟真实内容）
            const hasThumbnail = i % 2 === 0;
            items.push(`
                <div class="skeleton-item ${hasThumbnail ? 'with-thumbnail' : ''}">
                    <div class="skeleton-content">
                        <div class="skeleton-line title"></div>
                        <div class="skeleton-line meta"></div>
                    </div>
                    ${hasThumbnail ? '<div class="skeleton-thumbnail"></div>' : ''}
                </div>
            `);
        }
        return `<div class="skeleton-container">${items.join('')}</div>`;
    },

    /**
     * 绑定文章项点击事件
     */
    bindArticleItemEvents() {
        DOMElements.articlesList.querySelectorAll('.article-item:not([data-events-bound])').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.id;
                this.viewManager.selectArticle(id);
            });
            item.setAttribute('data-events-bound', 'true');
        });
    },

    /**
     * 加载更多文章
     * @param {boolean} showButton - 是否显示按钮
     */
    async loadMoreArticles() {
        if (this.isLoadingMore) return;
        if (!AppState.pagination || !AppState.pagination.hasMore) return;

        // 如果有缓存的下一页数据，直接使用
        if (this.nextPageCache && this.nextPageCache.page === AppState.pagination.page + 1) {
            console.debug('Using preloaded next page:', this.nextPageCache.page);
            const cached = this.nextPageCache;
            this.nextPageCache = null; // 消费缓存

            // 模拟网络延迟的异步行为，确保 UI 渲染不卡顿
            await Promise.resolve();

            this.processMoreArticles(cached.data);
            return;
        }

        const requestId = this.currentRequestId;
        this.isLoadingMore = true;

        try {
            const nextPage = AppState.pagination.page + 1;
            let result;

            if (AppState.isSearchMode && AppState.searchQuery) {
                result = await FeedManager.searchArticles(AppState.searchQuery, nextPage);
            } else {
                let cursor = null;
                if ((AppState.showUnreadOnly || AppState.viewingToday) && !AppState.viewingHistory && AppState.articles.length > 0) {
                    const lastArticle = AppState.articles[AppState.articles.length - 1];
                    if (lastArticle && lastArticle.published_at && lastArticle.id) {
                        cursor = {
                            publishedAt: lastArticle.published_at,
                            id: lastArticle.id,
                            isAfter: false  // false 表示 "before"，即获取更早的文章
                        };
                    }
                }

                result = await FeedManager.getArticles({
                    page: nextPage,
                    feedId: AppState.currentFeedId,
                    groupId: AppState.currentGroupId,
                    unreadOnly: AppState.showUnreadOnly,
                    readOnly: AppState.viewingHistory,
                    favorites: AppState.viewingFavorites,
                    cursor,
                    afterPublishedAt: this._getTodayFilter()
                });
            }

            if (this.currentRequestId !== requestId) return;

            this.processMoreArticles(result);
        } catch (err) {
            console.error('Load more articles error:', err);
        } finally {
            this.isLoadingMore = false;
        }
    },

    /**
     * 处理更多文章数据的共有逻辑 (渲染 + 触发下一次预加载)
     */
    processMoreArticles(result) {
        const nextPage = result.pagination.page;

        // 过滤重复
        const existingIds = new Set(AppState.articles.map(a => a.id));
        const newArticles = result.articles.filter(a => !existingIds.has(a.id));

        if (newArticles.length > 0) {
            AppState.articles = [...AppState.articles, ...newArticles];
            AppState.pagination = result.pagination;
            AppState.pagination.page = nextPage;

            this.appendArticlesList(newArticles);
        } else {
            // Still update pagination to avoid infinite retries on the same page
            if (result.articles.length > 0) {
                console.warn('Received only duplicate articles in loadMore');
            }
            AppState.pagination = result.pagination;
            AppState.pagination.page = nextPage;
        }

        // 当前页加载并渲染完后，继续预加载下一页
        this.preloadNextPage();
    },

    /**
     * 静默预加载下一页
     */
    async preloadNextPage() {
        if (this.isPreloading || !AppState.pagination || !AppState.pagination.hasMore) return;
        // 如果已经缓存了下一页，就不重复预加载
        if (this.nextPageCache && this.nextPageCache.page === AppState.pagination.page + 1) return;

        this.isPreloading = true;
        const nextPage = AppState.pagination.page + 1;
        const requestId = this.currentRequestId;

        try {
            console.debug('Preloading page:', nextPage);
            let result;
            if (AppState.isSearchMode && AppState.searchQuery) {
                result = await FeedManager.searchArticles(AppState.searchQuery, nextPage);
            } else {
                // 构建游标：在 unreadOnly 或 今天 模式下，使用最后一篇文章的信息作为游标
                // 注意：历史记录模式不能用游标，因为排序字段是 changed_at 而非 published_at
                let cursor = null;
                if ((AppState.showUnreadOnly || AppState.viewingToday) && !AppState.viewingHistory && AppState.articles.length > 0) {
                    const lastArticle = AppState.articles[AppState.articles.length - 1];
                    if (lastArticle && lastArticle.published_at && lastArticle.id) {
                        cursor = {
                            publishedAt: lastArticle.published_at,
                            id: lastArticle.id,
                            isAfter: false  // false 表示 "before"，即获取更早的文章
                        };
                    }
                }

                result = await FeedManager.getArticles({
                    page: nextPage,
                    feedId: AppState.currentFeedId,
                    groupId: AppState.currentGroupId,
                    unreadOnly: AppState.showUnreadOnly,
                    readOnly: AppState.viewingHistory,
                    favorites: AppState.viewingFavorites,
                    cursor,
                    afterPublishedAt: this._getTodayFilter()
                });
            }

            // 只有当请求 ID 没变（用户没切换页面），且页码仍然匹配时才缓存
            if (this.currentRequestId === requestId && AppState.pagination.page + 1 === nextPage) {
                this.nextPageCache = {
                    page: nextPage,
                    data: result
                };
                console.debug('Preloaded page', nextPage, 'cached');
            }
        } catch (err) {
            console.warn('Preload failed (silent):', err);
        } finally {
            this.isPreloading = false;
        }
    },

    /**
     * 滚动到指定文章
     * @param {string|number} articleId 
     */
    scrollToArticle(articleId) {
        if (!articleId) return;

        if (this.useVirtualScroll && this.virtualList) {
            this.virtualList.scrollToItem(articleId);
            this.virtualList.updateActiveItem(articleId);
        } else {
            const el = DOMElements.articlesList.querySelector(`.article-item[data-id="${articleId}"]`);
            if (el) {
                // 如果使用普通滚动，确保它在视口内
                el.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                // 更新激活状态
                DOMElements.articlesList.querySelectorAll('.article-item.active').forEach(item => {
                    item.classList.remove('active');
                });
                el.classList.add('active');
            }
        }
    },

    /**
     * 启动新文章轮询
     */
    startNewArticlesPoller() {
        this.stopNewArticlesPoller();
        this.checkInterval = setInterval(() => this.checkForNewArticles(), ARTICLES_CONFIG.NEW_ARTICLES_CHECK_MS);
    },

    /**
     * 停止新文章轮询
     */
    stopNewArticlesPoller() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    },

    /**
     * 检查新文章
     */
    async checkForNewArticles() {
        const requestId = this.currentRequestId;
        if (!AppState.articles || AppState.articles.length === 0) return;
        if (AppState.viewingFavorites || AppState.viewingDigests || AppState.viewingHistory) return;
        // 搜索模式下不检查新文章，避免将新文章插入搜索结果
        if (AppState.isSearchMode) return;

        // 如果列表不是处于顶部，暂停自动更新，防止列表抖动
        // 尤其是在虚拟列表中，未渲染的新增项高度只能估算，会导致滚动位置计算偏差
        if (DOMElements.articlesList.scrollTop > 10) {
            return;
        }

        // 移动端：只在列表页才检测新文章
        if (isMobileDevice()) {
            const hash = window.location.hash;
            const isArticlePage = hash.startsWith('#/article/');
            const isFeedsPage = hash === '#/feeds';

            // 文章页和订阅源页完全跳过检测
            if (isArticlePage || isFeedsPage) {
                console.debug('Skip new articles check: not on list page (mobile)');
                return;
            }
        }

        try {
            const existingIds = new Set(AppState.articles.map(a => a.id));
            const result = await FeedManager.getArticles({
                page: 1,
                feedId: AppState.currentFeedId,
                groupId: AppState.currentGroupId,
                unreadOnly: true,
                favorites: false,
                afterPublishedAt: this._getTodayFilter()
            });

            if (this.currentRequestId !== requestId) return;

            if (!result.articles || result.articles.length === 0) return;

            let maxId = 0;
            if (AppState.articles.length > 0) {
                maxId = Math.max(...AppState.articles.map(a => a.id));
            }

            const newArticles = result.articles.filter(a => !existingIds.has(a.id) && a.id > maxId);

            if (newArticles.length > 0) {
                console.debug(`Found ${newArticles.length} new articles, prepending...`);



                AppState.articles = [...newArticles, ...AppState.articles];

                if (this.useVirtualScroll && this.virtualList) {
                    this.virtualList.prependItems(newArticles);
                } else {
                    const scrollTop = DOMElements.articlesList.scrollTop;
                    const html = this.generateArticlesHTML(newArticles);
                    const firstItem = DOMElements.articlesList.querySelector('.article-item');
                    const oldOffset = firstItem ? firstItem.offsetTop : 0;

                    DOMElements.articlesList.insertAdjacentHTML('afterbegin', html);

                    DOMElements.articlesList.querySelectorAll('.article-item:not([data-events-bound])').forEach(item => {
                        item.addEventListener('click', () => {
                            const id = item.dataset.id;
                            this.viewManager.selectArticle(id);
                        });
                        item.setAttribute('data-events-bound', 'true');
                    });

                    // 保持滚动位置
                    if (scrollTop > 0 && firstItem) {
                        const newOffset = firstItem.offsetTop - oldOffset;
                        DOMElements.articlesList.scrollTop = scrollTop + newOffset;
                    }
                }

                await this.viewManager.refreshFeedCounts();

                // 为新插入的文章触发标题翻译（不取消之前的翻译任务）
                this.triggerTitleTranslations(newArticles, false);
            }
        } catch (err) {
            console.debug('Check new articles failed', err);
        }
    },

    /**
     * 处理文章列表滚动
     */
    handleArticlesScroll() {
        const list = DOMElements.articlesList;
        if (!list) return;

        // 标记正在滚动
        this.isScrolling = true;

        // 清除之前的滚动结束检测定时器
        if (this.scrollEndTimer) {
            clearTimeout(this.scrollEndTimer);
        }

        const scrollTop = list.scrollTop;
        const scrollHeight = list.scrollHeight;
        const clientHeight = list.clientHeight;

        // 设置滚动结束检测（统一使用 1 秒，确保惯性滚动结束后再允许插入新文章）
        this.scrollEndTimer = setTimeout(() => {
            this.isScrolling = false;
            this.scrollEndTimer = null;

            // 滚动停止时，检查普通列表是否到达底部
            if (!this.useVirtualScroll) {
                this.checkScrollReadAtBottomForNormalList(list);
            }
        }, ARTICLES_CONFIG.SCROLL_END_DELAY);

        // 控制回到顶部按钮显示
        if (DOMElements.scrollToTopBtn) {
            if (scrollTop > ARTICLES_CONFIG.SCROLL_TOP_THRESHOLD) {
                DOMElements.scrollToTopBtn.classList.add('visible');
            } else {
                DOMElements.scrollToTopBtn.classList.remove('visible');
            }
        }

        // 提前加载：当距离底部小于 2 个视口高度时开始预加载
        const preloadThreshold = Math.max(ARTICLES_CONFIG.PRELOAD_THRESHOLD_PX, clientHeight * 2);
        if (scrollHeight - scrollTop - clientHeight < preloadThreshold) {
            this.loadMoreArticles();
        }

        // 处理非虚拟列表的滚动标记已读
        if (!this.useVirtualScroll) {
            if (this._scrollReadTimeout) return;
            this._scrollReadTimeout = setTimeout(() => {
                this._scrollReadTimeout = null;
                this.checkScrollReadForNormalList(list);
            }, ARTICLES_CONFIG.SCROLL_READ_DELAY);
        }
    },

    /**
     * 检查普通列表的滚动已读
     * @param {HTMLElement} list - 列表容器
     */
    checkScrollReadForNormalList(list) {
        if (!AppState.preferences?.scroll_mark_as_read) return;

        const listRect = list.getBoundingClientRect();
        const unreadEls = list.querySelectorAll('.article-item.unread');
        const scrolledPast = [];

        unreadEls.forEach(el => {
            const elRect = el.getBoundingClientRect();
            // 元素底部位置 < 容器顶部位置，说明已经完全滚出视口上方
            // 添加 10px 的缓冲，确保视觉确认
            if (elRect.bottom < listRect.top) {
                const id = el.dataset.id;
                const article = AppState.articles.find(a => a.id == id);
                if (article) scrolledPast.push(article);
            }
        });

        if (scrolledPast.length > 0) {
            this.handleScrollMarkAsRead(scrolledPast);
        }
    },

    /**
     * 检查普通列表是否到达底部，如果是则标记可见区域内的未读项目
     * 用于处理最后一屏无法通过"滚动经过"检测的问题
     * @param {HTMLElement} list - 列表容器
     */
    checkScrollReadAtBottomForNormalList(list) {
        if (!AppState.preferences?.scroll_mark_as_read) return;

        const scrollTop = list.scrollTop;
        const scrollHeight = list.scrollHeight;
        const clientHeight = list.clientHeight;
        const distanceToBottom = scrollHeight - scrollTop - clientHeight;

        // 只在接近底部（距离底部小于 50px）时处理
        if (distanceToBottom > 50) return;

        const listRect = list.getBoundingClientRect();
        const unreadEls = list.querySelectorAll('.article-item.unread');
        const visibleItems = [];

        unreadEls.forEach(el => {
            const elRect = el.getBoundingClientRect();
            // 检查元素是否在视口内（至少部分可见）
            if (elRect.bottom > listRect.top && elRect.top < listRect.bottom) {
                const id = el.dataset.id;
                const article = AppState.articles.find(a => a.id == id);
                if (article) visibleItems.push(article);
            }
        });

        if (visibleItems.length > 0) {
            this.handleScrollMarkAsRead(visibleItems);
        }
    },

    /**
     * 处理滚动标记已读
     * 使用批量收集 + 防抖机制，避免快速滚动时触发大量 API 请求
     * @param {Array} items - 滚动经过的文章项
     */
    handleScrollMarkAsRead(items) {
        // 检查设置是否开启
        if (!AppState.preferences?.scroll_mark_as_read) return;

        // 过滤掉已读的和简报（简报使用不同的已读 API）
        const unreadItems = items.filter(item => !item.is_read && !String(item.id).startsWith('digest_'));
        if (unreadItems.length === 0) return;

        // 乐观更新 UI 并收集 ID
        unreadItems.forEach(item => {
            item.is_read = true;

            // 更新虚拟列表中的状态
            if (this.virtualList) {
                this.virtualList.updateItem(item.id, { is_read: true });
            } else {
                // 更新普通列表 DOM
                const el = DOMElements.articlesList.querySelector(`.article-item[data-id="${item.id}"]`);
                if (el) el.classList.remove('unread');
            }

            // 收集待处理的 ID
            this._scrollReadPendingIds.add(item.id);
        });

        // 防抖：延迟批量处理
        if (this._scrollReadBatchTimer) {
            clearTimeout(this._scrollReadBatchTimer);
        }

        this._scrollReadBatchTimer = setTimeout(() => {
            this._flushScrollReadBatch();
        }, ARTICLES_CONFIG.SCROLL_READ_BATCH_DELAY);
    },

    /**
     * 批量处理滚动标记已读
     * @private
     */
    async _flushScrollReadBatch() {
        this._scrollReadBatchTimer = null;

        if (this._scrollReadPendingIds.size === 0) return;

        const ids = Array.from(this._scrollReadPendingIds);
        this._scrollReadPendingIds.clear();

        try {
            // Use batch API instead of N+1 individual calls
            await FeedManager.markAsReadBatch(ids);
            // 刷新计数（使用 ViewManager 的防抖版本）
            this.viewManager.debouncedRefreshFeedCounts();
        } catch (err) {
            console.error('Scroll mark as read failed:', err);
        }
    },

    /**
     * Check for unread digests and show toast
     * @param {Object} prefetchedResult
     */
    async checkUnreadDigestsAndShowToast(prefetchedResult = null) {
        if (AppState.viewingDigests) return;

        try {
            // Only check if we are not already viewing digests
            let result = prefetchedResult;
            if (!result) {
                result = await FeedManager.getDigests({ unreadOnly: true });
            }
            if (!result || !result.digests) return;

            const pinned = result.digests.pinned || [];
            const normal = result.digests.normal || [];
            const count = pinned.length + normal.length;

            if (count > 0) {
                const lastShown = parseInt(sessionStorage.getItem('tidyflux_digest_toast_count') || '-1');
                if (count > lastShown) {
                    showToast(
                        i18n.t('digest.unread_toast', { count }),
                        3000,
                        false,
                        () => this.viewManager.selectDigests()
                    );
                }
                sessionStorage.setItem('tidyflux_digest_toast_count', count);
            } else {
                sessionStorage.setItem('tidyflux_digest_toast_count', 0);
            }
        } catch (err) {
            console.debug('Check unread digests failed:', err);
        }
    },

    /**
     * 更新翻译按钮的 tooltip（根据当前视图是否有自动翻译）
     */
    updateTranslateBtnTooltip() {
        const btn = document.getElementById('articles-translate-btn');
        if (!btn) return;

        // 判断当前视图是否整体开启了自动翻译
        let isAutoTranslateView = false;
        if (!this._translationHidden) {
            if (AppState.currentFeedId) {
                // 单个订阅源视图
                isAutoTranslateView = AIService.shouldTranslateFeed(AppState.currentFeedId);
            } else if (AppState.currentGroupId) {
                // 分组视图：检查分组设置
                const groupOverride = AIService.getGroupTranslationOverride(AppState.currentGroupId);
                isAutoTranslateView = groupOverride === 'on';
            }
            // 全部文章/今天/历史/收藏等混合视图默认不算自动翻译视图
        }

        if (this._manualTranslateActive || isAutoTranslateView) {
            btn.setAttribute('data-tooltip', i18n.t('ai.cancel_translate'));
        } else {
            btn.setAttribute('data-tooltip', i18n.t('ai.translate_titles'));
        }
    },

    /**
     * 隐藏所有翻译结果（包括自动翻译和手动翻译），恢复原标题
     */
    hideAllTranslations() {
        // 取消进行中的翻译请求
        if (this._titleTranslationAbort) {
            this._titleTranslationAbort.abort();
            this._titleTranslationAbort = null;
        }

        this._manualTranslateActive = false;
        this._translationHidden = true;
        this._titleTranslationFailed.clear();
        this._manualTranslateQueue = [];
        this._manualTranslateQueued.clear();
        this._manualTranslateWorkerCount = 0;
        this._unbindManualTranslateScroll();

        // 重新渲染列表以恢复原标题（_buildTitleHtml 会检查 _translationHidden）
        if (this.useVirtualScroll && this.virtualList) {
            this.virtualList.refreshVisibleItems();
        } else {
            const articles = AppState.articles;
            articles.forEach(a => {
                if (a.type === 'digest') return;
                const titleEl = DOMElements.articlesList.querySelector(`.article-item-title[data-article-id="${a.id}"]`);
                if (!titleEl) return;
                titleEl.innerHTML = escapeHtml(a.title);
                titleEl.classList.remove('has-translation');
            });
        }
    },

    /**
     * 恢复翻译显示（取消隐藏状态，恢复自动翻译 + 触发手动翻译）
     */
    async showAllTranslations() {
        this._translationHidden = false;

        // 刷新列表，自动翻译的缓存会自动显示
        if (this.useVirtualScroll && this.virtualList) {
            this.virtualList.refreshVisibleItems();
        }

        // 同时启动手动翻译
        await this.manualTranslateTitles();
    },

    /**
     * 手动翻译当前列表所有文章标题（无视订阅源翻译设置）
     */
    async manualTranslateTitles() {
        const articles = AppState.articles;
        if (!articles || articles.length === 0) return;

        // 设置手动翻译标记，使 _buildTitleHtml 显示所有翻译
        this._manualTranslateActive = true;

        // 取消上一次的翻译任务
        if (this._titleTranslationAbort) {
            this._titleTranslationAbort.abort();
        }
        this._titleTranslationAbort = new AbortController();
        this._titleTranslationFailed.clear();

        // 刷新显示（已缓存的会立即显示翻译）
        if (this.useVirtualScroll && this.virtualList) {
            this.virtualList.refreshVisibleItems();
        } else {
            // 普通列表：重新构建所有标题 HTML（缓存会立即显示）
            articles.forEach(a => {
                if (a.type === 'digest') return;
                const titleEl = DOMElements.articlesList.querySelector(`.article-item-title[data-article-id="${a.id}"]`);
                if (!titleEl) return;
                const html = this._buildTitleHtml(a);
                titleEl.innerHTML = html;
                if (html !== escapeHtml(a.title)) {
                    titleEl.classList.add('has-translation');
                }
            });
        }

        // 翻译当前可见的文章
        await this._translateVisibleArticles();

        // 绑定滚动监听，滚动时翻译新可见的文章
        this._bindManualTranslateScroll();
    },

    /**
     * 获取当前可见区域内的文章
     * @returns {Array} 可见文章数组
     */
    _getVisibleArticles() {
        const articles = AppState.articles;
        if (!articles || articles.length === 0) return [];

        if (this.useVirtualScroll && this.virtualList) {
            // 虚拟列表：直接用 startIndex / endIndex
            const start = this.virtualList.startIndex || 0;
            const end = this.virtualList.endIndex || 0;
            return articles.slice(start, end);
        }

        // 普通列表：检查 DOM 可见性
        const list = DOMElements.articlesList;
        if (!list) return [];
        const listRect = list.getBoundingClientRect();
        const visible = [];
        list.querySelectorAll('.article-item').forEach(el => {
            const elRect = el.getBoundingClientRect();
            // 至少部分在视口内
            if (elRect.bottom > listRect.top && elRect.top < listRect.bottom) {
                const id = el.dataset.id;
                const article = articles.find(a => a.id == id);
                if (article) visible.push(article);
            }
        });
        return visible;
    },

    /**
     * 翻译当前可见的文章标题（工作池模式）
     * 将可见文章加入共享队列，worker 自动取任务
     */
    _translateVisibleArticles() {
        if (!this._manualTranslateActive) return;

        const aiConfig = AIService.getConfig();
        const targetLangId = aiConfig.targetLang || 'zh-CN';

        const visible = this._getVisibleArticles();
        const needTranslate = visible.filter(a => {
            if (a.type === 'digest') return false;
            if (this._manualTranslateQueued.has(a.id)) return false;
            return !AIService.getTitleCache(a.title, targetLangId);
        });

        if (needTranslate.length === 0) return;

        // 加入队列并去重
        for (const a of needTranslate) {
            this._manualTranslateQueue.push(a);
            this._manualTranslateQueued.add(a.id);
        }

        // 启动 worker（补齐到并发上限）
        const CONCURRENT_LIMIT = aiConfig.concurrency || 5;
        while (this._manualTranslateWorkerCount < CONCURRENT_LIMIT && this._manualTranslateQueue.length > 0) {
            this._startManualTranslateWorker();
        }
    },

    /**
     * 启动一个翻译 worker，从共享队列取任务直到队列为空
     */
    async _startManualTranslateWorker() {
        this._manualTranslateWorkerCount++;

        const aiConfig = AIService.getConfig();
        const targetLangId = aiConfig.targetLang || 'zh-CN';
        const mode = aiConfig.titleTranslationMode || 'bilingual';
        const signal = this._titleTranslationAbort?.signal;
        const BATCH_SIZE = 10;

        try {
            while (this._manualTranslateQueue.length > 0 && this._manualTranslateActive) {
                if (signal?.aborted) return;

                // 从队列头部取一个批次
                const batch = this._manualTranslateQueue.splice(0, BATCH_SIZE);

                try {
                    const resultMap = await AIService.translateTitlesBatch(batch, targetLangId, signal);
                    if (signal?.aborted || !this._manualTranslateActive) return;

                    resultMap.forEach((translated, articleId) => {
                        const titleEl = DOMElements.articlesList.querySelector(`.article-item-title[data-article-id="${articleId}"]`);
                        if (!titleEl) return;
                        const article = AppState.articles.find(a => a.id == articleId);
                        if (!article) return;
                        const escaped = escapeHtml(article.title);
                        if (mode === 'translated') {
                            titleEl.innerHTML = `<div class="article-title-translated">${escapeHtml(translated)}</div>`;
                        } else {
                            titleEl.innerHTML = `<div class="article-title-translated">${escapeHtml(translated)}</div><div class="article-title-original">${escaped}</div>`;
                        }
                        titleEl.classList.add('has-translation');
                    });
                } catch (e) {
                    if (e.name === 'AbortError') return;
                    console.error('[ArticlesView] Manual title translation failed:', e);
                    const statusCode = e.statusCode || e.status || '';
                    const errorMsg = statusCode ? `${i18n.t('ai.translate_failed')} (${statusCode})` : i18n.t('ai.translate_failed');
                    batch.forEach(a => {
                        this._titleTranslationFailed.set(`${a.title}||${targetLangId}`, errorMsg);
                        const titleEl = DOMElements.articlesList.querySelector(`.article-item-title[data-article-id="${a.id}"]`);
                        if (!titleEl) return;
                        titleEl.innerHTML = `<div class="title-translate-error">${escapeHtml(errorMsg)}</div><div class="article-title-original">${escapeHtml(a.title)}</div>`;
                        titleEl.classList.add('has-translation');
                    });
                }
            }
        } finally {
            this._manualTranslateWorkerCount--;
        }
    },

    /** 滚动翻译防抖定时器 */
    _manualTranslateScrollTimer: null,
    /** 滚动翻译监听函数引用 */
    _manualTranslateScrollHandler: null,

    /**
     * 绑定滚动监听，滚动停止后翻译新可见的文章（防抖 500ms）
     * 使用 debounce 而非 throttle，避免滚动过程中频繁刷新 DOM 导致图片闪烁
     */
    _bindManualTranslateScroll() {
        // 已绑定则跳过
        if (this._manualTranslateScrollHandler) return;

        this._manualTranslateScrollHandler = () => {
            if (!this._manualTranslateActive) return;
            // 防抖：清除上一次定时器，等滚动停止后再执行
            if (this._manualTranslateScrollTimer) {
                clearTimeout(this._manualTranslateScrollTimer);
            }
            this._manualTranslateScrollTimer = setTimeout(() => {
                this._manualTranslateScrollTimer = null;
                this._translateVisibleArticles();
            }, 500);
        };

        DOMElements.articlesList?.addEventListener('scroll', this._manualTranslateScrollHandler, { passive: true });
    },

    /**
     * 解绑滚动翻译监听
     */
    _unbindManualTranslateScroll() {
        if (this._manualTranslateScrollHandler) {
            DOMElements.articlesList?.removeEventListener('scroll', this._manualTranslateScrollHandler);
            this._manualTranslateScrollHandler = null;
        }
        if (this._manualTranslateScrollTimer) {
            clearTimeout(this._manualTranslateScrollTimer);
            this._manualTranslateScrollTimer = null;
        }
    }
};
