import { DOMElements } from '../../dom.js';
import { AppState } from '../../state.js';
import { escapeHtml } from './utils.js';
import { i18n } from '../i18n.js';
import { AIService } from '../ai-service.js';

/**
 * 文章列表标题翻译管理（自动翻译 + 手动翻译）
 * 从 ArticlesView 拆分出来，作为独立模块
 *
 * 使用方式：ArticlesTitleTranslation.init(articlesViewInstance)
 */
export const ArticlesTitleTranslation = {
    /** 宿主 ArticlesView 引用 */
    host: null,

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
    /** 滚动翻译防抖定时器 */
    _manualTranslateScrollTimer: null,
    /** 滚动翻译监听函数引用 */
    _manualTranslateScrollHandler: null,

    /**
     * 初始化翻译模块
     * @param {Object} host - ArticlesView 实例引用
     */
    init(host) {
        this.host = host;
    },

    /**
     * 重置所有翻译状态（在列表切换时调用）
     */
    resetState() {
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
    },

    /**
     * 构建标题 HTML（支持翻译缓存显示）
     * @param {Object} article - 文章对象
     * @returns {string} 标题 HTML
     */
    buildTitleHtml(article) {
        const escaped = escapeHtml(article.title);

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

        // 尚未翻译，显示 loading 占位 + 原标题
        return `<div class="title-translating">…</div><div class="article-title-original">${escaped}</div>`;
    },

    /**
     * 刷新标题 DOM 元素（根据当前翻译状态重新渲染）
     * @param {Array} articles - 文章数组
     */
    refreshTitleElements(articles) {
        articles.forEach(a => {
            if (a.type === 'digest') return;
            const titleEl = DOMElements.articlesList.querySelector(`.article-item-title[data-article-id="${a.id}"]`);
            if (!titleEl) return;
            const html = this.buildTitleHtml(a);
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
            this.refreshTitleElements(articles);
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
                    console.error('[ArticlesTitleTranslation] Title translation batch failed:', e);
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

        // 重新渲染列表以恢复原标题（buildTitleHtml 会检查 _translationHidden）
        const host = this.host;
        if (host.useVirtualScroll && host.virtualList) {
            host.virtualList.refreshVisibleItems();
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
        const host = this.host;
        if (host.useVirtualScroll && host.virtualList) {
            host.virtualList.refreshVisibleItems();
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

        // 设置手动翻译标记，使 buildTitleHtml 显示所有翻译
        this._manualTranslateActive = true;

        // 取消上一次的翻译任务
        if (this._titleTranslationAbort) {
            this._titleTranslationAbort.abort();
        }
        this._titleTranslationAbort = new AbortController();
        this._titleTranslationFailed.clear();

        // 刷新显示（已缓存的会立即显示翻译）
        const host = this.host;
        if (host.useVirtualScroll && host.virtualList) {
            host.virtualList.refreshVisibleItems();
        } else {
            // 普通列表：重新构建所有标题 HTML（缓存会立即显示）
            articles.forEach(a => {
                if (a.type === 'digest') return;
                const titleEl = DOMElements.articlesList.querySelector(`.article-item-title[data-article-id="${a.id}"]`);
                if (!titleEl) return;
                const html = this.buildTitleHtml(a);
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

        const host = this.host;
        if (host.useVirtualScroll && host.virtualList) {
            // 虚拟列表：直接用 startIndex / endIndex
            const start = host.virtualList.startIndex || 0;
            const end = host.virtualList.endIndex || 0;
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
                    console.error('[ArticlesTitleTranslation] Manual title translation failed:', e);
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
    },
};
