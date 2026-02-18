/**
 * ArticleContentView - 文章内容视图模块
 * @module view/article-content
 *
 * 各功能拆分到独立文件：
 * - article-ai.js: AI 功能（翻译 + 总结）
 * - article-toolbar.js: 工具栏事件（文章 + 简报）
 */

import { DOMElements } from '../../dom.js';
import { AppState } from '../../state.js';
import { FeedManager } from '../feed-manager.js';
import { showToast } from './utils.js';
import { i18n } from '../i18n.js';
import { Icons } from '../icons.js';
import { AIService } from '../ai-service.js';
import { AICache } from '../ai-cache.js';

import { ArticlesView } from './articles-view.js';
import { GlobalPodcastPlayer } from '../components/podcast-player.js';
import { ArticleAIMixin } from './article-ai.js';
import { ArticleToolbarMixin } from './article-toolbar.js';

/**
 * 文章内容视图管理
 */
export const ArticleContentView = {
    /** 视图管理器引用 */
    viewManager: null,
    /** 当前正在显示的文章对象（用于切换时取消 AI 请求） */
    _currentArticle: null,

    /**
     * 初始化模块
     * @param {Object} viewManager - ViewManager 实例引用
     */
    init(viewManager) {
        this.viewManager = viewManager;

        // Add global error handler for images within article content (Delegate)
        if (DOMElements.articleContent) {
            DOMElements.articleContent.addEventListener('error', (e) => {
                if (e.target.tagName === 'IMG' && e.target.classList.contains('favicon')) {
                    e.target.src = '/icons/rss.svg';
                    e.target.onerror = null;
                }
            }, true); // Capture phase

            // 点击图片弹出大图 lightbox（委托监听）
            DOMElements.articleContent.addEventListener('click', (e) => {
                const img = e.target.closest('img');
                if (img && !img.classList.contains('favicon')) {
                    e.preventDefault();
                    e.stopPropagation();
                    this._openImageLightbox(img.src);
                }
            });
        }
    },

    /**
     * 渲染工具栏到 content-panel（与 panel-header 同级，脱离滚动容器）
     * @param {string} toolbarHTML - 工具栏 HTML
     */
    _renderToolbar(toolbarHTML) {
        this._clearToolbar();
        if (DOMElements.contentPanel) {
            DOMElements.contentPanel.insertAdjacentHTML('afterbegin', toolbarHTML);
        }
    },

    /**
     * 清除工具栏
     */
    _clearToolbar() {
        if (DOMElements.contentPanel) {
            const existing = DOMElements.contentPanel.querySelector('.article-toolbar');
            if (existing) existing.remove();
        }
    },

    /**
     * 打开图片大图 lightbox
     * @param {string} src - 图片 URL
     */
    _openImageLightbox(src) {
        // 移除已有的 lightbox
        const existing = document.querySelector('.image-lightbox-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'image-lightbox-overlay';
        overlay.innerHTML = `
            <button class="image-lightbox-close" aria-label="Close">✕</button>
            <img src="${src}" alt="" />
        `;
        document.body.appendChild(overlay);

        // 动画展开
        requestAnimationFrame(() => overlay.classList.add('active'));

        const closeLightbox = () => {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 250);
            document.removeEventListener('keydown', escHandler);
        };

        // 点击遮罩或关闭按钮关闭
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('.image-lightbox-close')) {
                closeLightbox();
            }
        });

        // ESC 关闭
        const escHandler = (e) => {
            if (e.key === 'Escape') closeLightbox();
        };
        document.addEventListener('keydown', escHandler);
    },

    /**
     * 选择文章
     * @param {string|number} articleId - 文章 ID
     */
    selectArticle(articleId) {
        const vm = this.viewManager;
        vm.isProgrammaticNav = true;

        const params = new URLSearchParams();
        if (AppState.currentFeedId) params.set('feed', AppState.currentFeedId);
        if (AppState.currentGroupId) params.set('group', AppState.currentGroupId);
        if (AppState.viewingFavorites) params.set('favorites', '1');
        if (AppState.showUnreadOnly) params.set('unread', '1');

        const queryString = params.toString();
        const hash = queryString ? `#/article/${articleId}?${queryString}` : `#/article/${articleId}`;

        // If already viewing an article, replace current history entry so "Back" goes to list
        if (window.location.hash.startsWith('#/article/')) {
            window.location.replace(hash);
        } else {
            window.location.hash = hash;
        }

        // Sync list view scroll position
        if (typeof ArticlesView !== 'undefined') {
            ArticlesView.scrollToArticle(articleId);
        }
    },

    /**
     * 渲染文章内容
     * @param {string|number} articleId - 文章 ID
     * @param {Object|null} context - 上下文对象 {feedId, groupId, favorites, unread} 或缓存的文章数据
     */
    async _renderArticle(articleId, context = null) {
        const vm = this.viewManager;

        // 等待 feeds 加载完成
        await vm.waitForFeedsLoaded();

        // 检查是否是简报 ID
        const isDigest = String(articleId).startsWith('digest_');

        // 如果文章列表为空，根据 context 加载文章列表
        if (!AppState.articles || AppState.articles.length === 0) {
            const hasExplicitContext = context && (context.feedId || context.groupId || context.favorites);

            if (isDigest && !hasExplicitContext) {
                // Fix: 如果是简报，且看起来没有特定的上下文（即不是从特定 Feed/Group 进入的），则默认进入简报列表
                AppState.currentFeedId = null;
                AppState.currentGroupId = null;
                AppState.viewingFavorites = false;
                AppState.viewingDigests = true;

                // 确保显示所有简报（包括当前正在看的），否则如果已读可能会导致列表为空
                AppState.showUnreadOnly = false;

                DOMElements.currentFeedTitle.textContent = i18n.t('nav.briefings');
                vm.updateSidebarActiveState({ digests: true });
                await vm.loadArticles(null, null);
            } else {
                // 设置 AppState 基于 context
                if (context && typeof context === 'object' && !context.title) {
                    AppState.currentFeedId = context.feedId || null;
                    AppState.currentGroupId = context.groupId || null;
                    AppState.viewingFavorites = context.favorites || false;

                    // 使用保存的筛选设置，而不是 URL 中的 unread 参数
                    let filterKey = 'all';
                    let defaultUnread = true;

                    if (context.groupId) {
                        filterKey = `group_${context.groupId}`;
                    } else if (context.feedId) {
                        filterKey = `feed_${context.feedId}`;
                    } else if (context.favorites) {
                        filterKey = 'favorites';
                        // 收藏夹默认显示全部文章（包括已读），与点击侧边栏行为保持一致
                        defaultUnread = false;
                    }
                    const savedFilter = vm.loadFilterSetting(filterKey);
                    AppState.showUnreadOnly = savedFilter !== null ? savedFilter : defaultUnread;
                } else {
                    AppState.currentFeedId = null;
                    AppState.currentGroupId = null;
                    AppState.viewingFavorites = false;
                    const savedFilter = vm.loadFilterSetting('all');
                    AppState.showUnreadOnly = savedFilter !== null ? savedFilter : true;
                }

                // 更新标题和侧边栏状态
                if (context?.favorites) {
                    DOMElements.currentFeedTitle.textContent = '我的收藏';
                } else if (context?.groupId) {
                    const group = AppState.groups?.find(g => g.id == context.groupId);
                    DOMElements.currentFeedTitle.textContent = group?.name || '分组';
                } else if (context?.feedId) {
                    const feed = AppState.feeds?.find(f => f.id == context.feedId);
                    DOMElements.currentFeedTitle.textContent = feed?.title || '订阅源';
                } else {
                    DOMElements.currentFeedTitle.textContent = '全部文章';
                }

                vm.updateSidebarActiveState(context);
                await vm.loadArticles(context?.feedId || null, context?.groupId || null);
            }
        }

        // 保存列表滚动位置
        if (DOMElements.articlesList) {
            if (vm.useVirtualScroll && vm.virtualList) {
                AppState.lastListViewScrollTop = vm.virtualList.getScrollTop();
            } else {
                AppState.lastListViewScrollTop = DOMElements.articlesList.scrollTop;
            }
        }

        AppState.currentArticleId = articleId;

        // Update current article's active and read state in list
        const cachedArticle = AppState.articles?.find(a => a.id == articleId);
        const wasUnread = cachedArticle && !cachedArticle.is_read;
        const feedId = cachedArticle?.feed_id;

        // Use ArticlesView's virtual list directly to avoid stale references (fixes search mode issue)
        if (ArticlesView.useVirtualScroll && ArticlesView.virtualList) {
            ArticlesView.virtualList.updateActiveItem(articleId);
            ArticlesView.virtualList.updateItem(articleId, { is_read: 1 });
            // Sync vm references
            vm.virtualList = ArticlesView.virtualList;
            vm.useVirtualScroll = ArticlesView.useVirtualScroll;
        } else {
            const prevActive = DOMElements.articlesList?.querySelector('.article-item.active');
            if (prevActive) prevActive.classList.remove('active');

            const newActive = DOMElements.articlesList?.querySelector(`.article-item[data-id="${articleId}"]`);
            if (newActive) {
                newActive.classList.add('active');
                newActive.classList.remove('unread');
            }
        }

        // 更新未读计数（仅普通文章）
        if (!isDigest && wasUnread && feedId) {
            if (cachedArticle) cachedArticle.is_read = 1;
            this.updateLocalUnreadCount(feedId);
        }

        // 取消上一篇文章的 AI 请求
        this._cancelPendingAI();

        // 清除旧的工具栏
        this._clearToolbar();

        // 显示加载状态
        DOMElements.articleContent.innerHTML = `<div class="loading" style="padding: 40px; text-align: center;">${i18n.t('common.loading')}</div>`;
        DOMElements.articleContent.scrollTop = 0;
        this.clearNavButtons();

        if (window.innerWidth <= 1100) {
            vm.showPanel('content');
        }

        try {
            // 如果是简报
            if (isDigest) {
                // Cleanup player if switching to digest - NO, Global Player persists
                // if (this.podcastPlayer) {
                //     this.podcastPlayer.destroy();
                //     this.podcastPlayer = null;
                // }

                let digest = cachedArticle;
                if (!digest || !digest.content) {
                    const result = await FeedManager.getDigest(articleId);
                    digest = result.digest;
                }
                if (digest) {
                    digest.is_read = true;
                    this.renderDigestContent(digest);
                    // 标记简报已读
                    FeedManager.markDigestAsRead(articleId)
                        .then(() => vm.refreshFeedCounts())
                        .catch(err => {
                            console.error('Mark digest as read error:', err);
                        });
                }
            } else {
                // 普通文章
                let article = AppState.articles?.find(a => a.id == articleId);

                if (article && article.content) {
                    article.is_read = 1;
                    this._currentArticle = article;
                    this.renderArticleContent(article);
                } else {
                    article = await FeedManager.getArticle(articleId);
                    article.is_read = 1;
                    this._currentArticle = article;
                    this.renderArticleContent(article);
                }

                // 标记为已读
                FeedManager.markAsRead(articleId).catch(err => {
                    console.error('Mark as read error:', err);
                });
            }
        } catch (err) {
            console.error('Load article error:', err);
            DOMElements.articleContent.innerHTML = `<div class="error-msg" style="padding: 40px; text-align: center; color: red;">${i18n.t('common.load_error')}</div>`;
        }
    },

    /**
     * 处理简报中的文章引用标记 [ref:ID]
     * 先替换为占位符，避免 parseMarkdown 转义 HTML
     * @param {string} content - 简报内容
     * @param {Object} articleRefs - 文章引用映射 {id: {title, feedTitle}}
     * @returns {{content: string, placeholders: Object}} 处理后的内容和占位符映射
     */
    _processArticleRefs(content, articleRefs) {
        if (!content) return { content, placeholders: {} };
        const placeholders = {};
        let idx = 0;
        // 匹配 [ref:ID] 格式，ID 可以是数字
        const processed = content.replace(/\[ref:(\d+)\]/g, (match, articleId) => {
            const ref = articleRefs && articleRefs[articleId];
            const title = ref ? ref.title : `#${articleId}`;
            const tooltip = title.replace(/"/g, '&quot;');
            const placeholder = `\x00ARTREF_${idx}\x00`;
            placeholders[placeholder] = `<a href="#/article/${articleId}" class="digest-article-ref" data-article-id="${articleId}" title="${tooltip}"><sup>[↗]</sup></a>`;
            idx++;
            return placeholder;
        });
        return { content: processed, placeholders };
    },

    /**
     * 在桌面端显示文章预览悬浮框
     * @param {string} articleId - 文章 ID
     * @param {Object} articleRefs - 文章引用映射
     */
    async _showArticlePreview(articleId, articleRefs) {
        // 移除已存在的预览
        const existing = document.querySelector('.article-preview-overlay');
        if (existing) existing.remove();

        const ref = articleRefs && articleRefs[articleId];
        const previewTitle = ref ? ref.title : `Article #${articleId}`;

        // 创建预览弹窗 — 初始只有 loading 状态
        const overlay = document.createElement('div');
        overlay.className = 'article-preview-overlay';
        overlay.innerHTML = `
            <div class="article-preview-card">
                <div class="article-preview-scroll">
                    <div class="article-preview-loading">
                        <div class="article-preview-spinner"></div>
                        <span>${i18n.t('common.loading') || 'Loading...'}</span>
                    </div>
                </div>
                <div class="article-preview-footer">
                    <button class="article-preview-btn article-preview-btn-secondary preview-close-btn">${i18n.t('common.close') || 'Close'}</button>
                    <button class="article-preview-btn article-preview-btn-primary preview-goto-btn">${i18n.t('digest.read_full') || 'Read Full Article'} →</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // 动画展开 + 背景模糊
        document.body.classList.add('dialog-open');
        requestAnimationFrame(() => overlay.classList.add('active'));

        // 用于取消 AI 请求
        const previewAbortController = new AbortController();

        // 关闭逻辑
        const closePreview = () => {
            previewAbortController.abort();
            overlay.classList.remove('active');
            document.body.classList.remove('dialog-open');
            setTimeout(() => overlay.remove(), 300);
        };

        overlay.addEventListener('click', (e) => { if (e.target === overlay) closePreview(); });
        overlay.querySelector('.preview-close-btn').addEventListener('click', closePreview);
        overlay.querySelector('.preview-goto-btn').addEventListener('click', () => {
            closePreview();
            window.location.hash = `#/article/${articleId}`;
        });
        const escHandler = (e) => {
            if (e.key === 'Escape') { closePreview(); document.removeEventListener('keydown', escHandler); }
        };
        document.addEventListener('keydown', escHandler);

        // 加载文章内容
        try {
            const article = await FeedManager.getArticle(articleId);
            const scrollArea = overlay.querySelector('.article-preview-scroll');
            if (!scrollArea || !document.body.contains(overlay)) return;

            const locale = AppState.user.language || 'zh-CN';
            const date = article.published_at
                ? new Date(article.published_at).toLocaleString(locale)
                : '';
            const content = article.content || article.summary || '';
            const feedName = article.feed?.title || ref?.feedTitle || '';
            const titleText = article.title || previewTitle;
            const titleHTML = article.url
                ? `<a href="${article.url}" target="_blank" rel="noopener noreferrer">${titleText}</a>`
                : titleText;

            // 构建 meta HTML
            let metaHTML = '';
            const metaParts = [];
            if (article.feed_id && feedName) {
                metaParts.push(`<img src="/api/favicon?feedId=${article.feed_id}" class="favicon" alt=""><span>${feedName}</span>`);
            } else if (feedName) {
                metaParts.push(`<span>${feedName}</span>`);
            }
            if (date) {
                metaParts.push(`<span>${date}</span>`);
            }
            metaHTML = metaParts.join('<span style="opacity:0.4;">·</span>');

            // 一次性替换整个滚动区域内容
            scrollArea.innerHTML = `
                <div class="article-preview-header">
                    <div class="article-preview-title">${titleHTML}</div>
                    <div class="article-preview-meta">${metaHTML}</div>
                </div>
                <div class="article-preview-content">${content || `<div class="article-preview-error">${i18n.t('article.empty_content') || 'No content'}</div>`}</div>
            `;

            // === 自动摘要 ===
            if (AIService.isConfigured() && article.feed_id && AIService.shouldAutoSummarize(article.feed_id)) {
                this._previewAutoSummarize(overlay, article, previewAbortController.signal);
            }

            // === 自动翻译 ===
            if (AIService.isConfigured() && article.feed_id && AIService.shouldAutoTranslate(article.feed_id)) {
                this._previewAutoTranslate(overlay, article, previewAbortController.signal);
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('[ArticlePreview] Failed to load article:', err);
            const scrollArea = overlay.querySelector('.article-preview-scroll');
            if (scrollArea) {
                scrollArea.innerHTML = `<div class="article-preview-error">${i18n.t('feed.fetch_articles_failed') || 'Failed to load article'}</div>`;
            }
        }
    },

    /**
     * 预览弹窗内的自动摘要
     */
    async _previewAutoSummarize(overlay, article, signal) {
        const contentEl = overlay.querySelector('.article-preview-content');
        if (!contentEl) return;

        const rawContent = AIService.extractText(article.content || '');
        if (!rawContent || rawContent.trim().length < 50) return;

        // 先检查缓存
        try {
            const cached = await AICache.getSummary(article.id);
            if (cached) {
                this._insertPreviewSummary(contentEl, this.parseMarkdown(cached));
                return;
            }
        } catch { /* ignore */ }

        // 插入加载中的摘要容器
        const summaryEl = this._insertPreviewSummary(contentEl, `<span style="opacity:0.6;">${i18n.t('ai.summarizing')}</span>`);

        try {
            const aiConfig = AIService.getConfig();
            const targetLang = aiConfig.targetLang || (i18n.locale === 'zh' ? 'zh-CN' : 'en');
            let streamedText = '';

            await AIService.summarize(rawContent, targetLang, (chunk) => {
                streamedText += chunk;
                const contentEl = summaryEl.querySelector('.preview-summary-content');
                if (contentEl) contentEl.innerHTML = this.parseMarkdown(streamedText);
            }, signal);

            AICache.setSummary(article.id, streamedText).catch(() => { });
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('[PreviewSummary] Failed:', err);
            const contentEl = summaryEl.querySelector('.preview-summary-content');
            if (contentEl) contentEl.innerHTML = `<span style="color: var(--danger-color); font-size: 0.9em;">${i18n.t('ai.api_error')}</span>`;
        }
    },

    /**
     * 在预览弹窗正文顶部插入摘要区块
     */
    _insertPreviewSummary(bodyEl, initialHTML) {
        const summaryEl = document.createElement('div');
        summaryEl.className = 'preview-summary-box';
        summaryEl.style.cssText = 'margin-bottom: 16px; padding: 14px 16px; background: color-mix(in srgb, var(--accent-color), transparent 94%); border-radius: var(--radius); font-size: 0.92em; line-height: 1.7;';
        summaryEl.innerHTML = `
            <div style="font-weight: 600; font-size: 0.85em; color: var(--accent-color); margin-bottom: 8px; display: flex; align-items: center; gap: 4px;">✦ ${i18n.t('ai.summary_title')}</div>
            <div class="preview-summary-content">${initialHTML}</div>
        `;
        bodyEl.insertBefore(summaryEl, bodyEl.firstChild);
        return summaryEl;
    },

    /**
     * 预览弹窗内的自动翻译
     */
    async _previewAutoTranslate(overlay, article, signal) {
        const contentEl = overlay.querySelector('.article-preview-content');
        const titleEl = overlay.querySelector('.article-preview-title a') || overlay.querySelector('.article-preview-title');
        if (!contentEl) return;

        // 先检查缓存
        const cacheRestored = await this._restoreTranslationFromCache(contentEl, titleEl, article.id);
        if (cacheRestored) return;

        try {
            await this.translateBilingual(contentEl, titleEl, signal, article.id);
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('[PreviewTranslate] Failed:', err);
        }
    },

    /**
     * 渲染简报内容
     * @param {Object} digest - 简报对象
     */
    renderDigestContent(digest) {


        // 工具栏 HTML（简报版，包含返回和删除按钮）
        const toolbarHTML = `
            <div class="article-toolbar">
                <div class="article-toolbar-left">
                    <button class="article-toolbar-btn" id="article-back-btn" title="${i18n.t('keyboard.go_back')}">
                        ${Icons.arrow_back}
                    </button>
                </div>
                <div class="article-toolbar-right">
                    <button class="article-toolbar-btn" id="digest-delete-btn" title="${i18n.t('digest.delete')}">
                        ${Icons.delete}
                    </button>
                </div>
            </div>
        `;

        // 渲染工具栏到 content-panel（与 panel-header 同级）
        this._renderToolbar(toolbarHTML);

        // 处理文章引用标记 [ref:ID] -> 占位符（避免被 parseMarkdown 转义）
        const { content: refProcessed, placeholders } = this._processArticleRefs(digest.content || '', digest.articleRefs);

        // 使用 Markdown 解析内容
        let renderedContent = this.parseMarkdown(refProcessed);

        // 还原占位符为实际的 HTML 链接
        for (const [placeholder, html] of Object.entries(placeholders)) {
            renderedContent = renderedContent.replace(placeholder, html);
        }

        DOMElements.articleContent.innerHTML = `
            <header class="article-header digest-header">
                <h1>
                    ${digest.title}
                </h1>
                <div class="article-header-info" style="
                    color: var(--text-secondary); 
                    font-size: 14px; 
                    margin-top: 16px; 
                    display: flex; 
                    align-items: center; 
                    gap: 8px;
                ">
                    <span style="color: var(--accent-color); font-weight: 500;">${i18n.t('digest.title')}</span>
                    <span style="opacity: 0.5;">·</span>
                    <span>${digest.feed_title || digest.scopeName || ''}</span>
                    <span style="opacity: 0.5;">·</span>
                    <span>${i18n.t('digest.article_count', { count: digest.article_count || digest.articleCount || 0 })}</span>
                </div>
            </header>
            <div class="article-body digest-body" style="margin-top: 24px; line-height: 1.8;">
                ${renderedContent}
            </div>

        `;

        // 绑定文章引用链接的点击事件
        const refLinks = DOMElements.articleContent.querySelectorAll('.digest-article-ref');
        refLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const articleId = link.dataset.articleId;
                if (!articleId) return;

                // 弹出悬浮预览框
                this._showArticlePreview(articleId, digest.articleRefs);
            });
        });

        this.bindDigestToolbarEvents(digest);
        this.updateNavButtons(digest.id);
    },

    // bindDigestToolbarEvents → article-toolbar.js (ArticleToolbarMixin)

    /**
     * 渲染文章详情内容
     * @param {Object} article - 文章对象
     */
    renderArticleContent(article) {
        // No auto-cleanup for GlobalPlayer needed, it persists. 
        // Or maybe we want to hide it if user starts reading a new article but DOESN'T play? 
        // Usually global players persist until explicit close or new play.

        // document.title = article.title || 'Tidyflux';

        // 格式化日期（根据语言）
        let dateStr = '';
        if (article.published_at) {
            const d = new Date(article.published_at);
            const h = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            if (i18n.locale === 'zh') {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                dateStr = `${y}年${m}月${day}日 ${h}:${min}`;
            } else {
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                dateStr = `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h}:${min}`;
            }
        }
        const content = article.content || article.summary || `<p>${i18n.t('feed.empty_content')}</p>`;

        // Detect audio enclosure
        let audioEnclosure = null;
        if (article.enclosures && article.enclosures.length > 0) {
            audioEnclosure = article.enclosures.find(e => e.mime_type && e.mime_type.startsWith('audio/'));
        }

        // 构建标题上方的订阅源信息（icon + 名称，可点击进入订阅源）
        let feedSourceHTML = '';
        if (article.feed_id) {
            const feedTitle = article.feed_title || '';
            feedSourceHTML = `
                <a href="#/feed/${article.feed_id}" class="article-feed-source" title="${feedTitle}">
                    <img src="/api/favicon?feedId=${article.feed_id}" class="favicon" loading="lazy" decoding="async" alt="${feedTitle}" style="width: 14px; height: 14px; border-radius: 3px; margin: 0; display: block;">
                    <span>${feedTitle}</span>
                </a>
            `;
        } else if (article.feed_title) {
            feedSourceHTML = `
                <span class="article-feed-source" style="cursor: default;">
                    <span>${article.feed_title}</span>
                </span>
            `;
        }

        // 构建标题下方的日期 + 播客按钮
        const metaParts = [];
        if (dateStr) metaParts.push(`<span>${dateStr}</span>`);
        if (audioEnclosure) {
            metaParts.push(`<button class="podcast-play-wrapper" id="podcast-play-btn" data-url="${audioEnclosure.url}" data-title="${article.title || ''}" data-cover="${article.thumbnail_url || ''}">
                <span class="podcast-play-icon">${Icons.play_circle}</span>
                <span class="podcast-play-text">${i18n.t('article.play_podcast')}</span>
            </button>`);
        }
        const metaHTML = metaParts.join('<span style="margin: 0 8px; opacity: 0.5;">·</span>');

        // 可点击的标题
        const titleHTML = article.url
            ? `<h1><a href="${article.url}" target="_blank" rel="noopener noreferrer" class="article-title-link">${article.title}</a></h1>`
            : `<h1>${article.title}</h1>`;

        const isFavorited = article.is_favorited;
        const isRead = article.is_read;

        // 工具栏 HTML
        const toolbarHTML = `
            <div class="article-toolbar">
                <div class="article-toolbar-left">
                    <button class="article-toolbar-btn" id="article-back-btn" title="${i18n.t('common.close')}">
                        ${Icons.arrow_back}
                    </button>
                </div>
                <div class="article-toolbar-right">
                   <button class="article-toolbar-btn ${isRead ? 'is-read' : 'active'}" id="article-toggle-read-btn" title="${isRead ? i18n.t('article.mark_unread') : i18n.t('article.mark_read')}">
                        ${isRead ? Icons.mark_read : Icons.mark_unread}
                    </button>
                    <button class="article-toolbar-btn ${isFavorited ? 'active' : ''}" id="article-toggle-fav-btn" title="${isFavorited ? i18n.t('article.unstar') : i18n.t('article.star')}">
                        ${isFavorited ? Icons.star : Icons.star_border}
                    </button>
                    <button class="article-toolbar-btn" id="article-fetch-content-btn" title="${i18n.t('feed.fetch_content')}">
                        ${Icons.fetch_original}
                    </button>
                    <div class="toolbar-divider" style="width: 1px; height: 16px; background: var(--border-color); margin: 0 4px;"></div>
                    <button class="article-toolbar-btn" id="article-translate-btn" title="${i18n.t('ai.translate_btn')}">
                        ${Icons.translate}
                    </button>
                    <button class="article-toolbar-btn" id="article-summarize-btn" title="${i18n.t('ai.summarize_btn')}">
                        ${Icons.summarize}
                    </button>
                    <div class="toolbar-divider" style="width: 1px; height: 16px; background: var(--border-color); margin: 0 4px;"></div>
                    <button class="article-toolbar-btn" id="article-more-btn" title="${i18n.t('article.more_actions')}">
                        ${Icons.more_vert}
                    </button>
                </div>
            </div>
        `;

        // 渲染工具栏到 content-panel（与 panel-header 同级）
        this._renderToolbar(toolbarHTML);

        DOMElements.articleContent.innerHTML = `
            <header class="article-header">
                ${feedSourceHTML}
                ${titleHTML}
                <div class="article-header-info" style="
                    color: var(--meta-color); 
                    font-size: 12px; 
                    margin-top: 0; 
                    display: flex; 
                    align-items: center; 
                    justify-content: flex-start;
                    flex-wrap: wrap;
                    gap: 4px;
                ">
                    ${metaHTML}
                </div>
            </header>
            <div id="article-ai-summary" class="article-ai-summary preview-summary-box" style="display: none; margin: 16px 0; padding: 14px 16px; background: color-mix(in srgb, var(--accent-color), transparent 94%); border-radius: var(--radius); border: none; box-shadow: none;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="font-weight: 600; font-size: 0.85em; color: var(--accent-color); display: flex; align-items: center; gap: 4px;">✦ ${i18n.t('ai.summary_title')}</div>
                    <button class="ai-close-btn" style="background: none; border: none; cursor: pointer; color: var(--meta-color); font-size: 1em; padding: 2px; opacity: 0.5;">✕</button>
                </div>
                <div class="ai-content preview-summary-content markdown-body" style="line-height: 1.7; font-size: 0.92em;"></div>
            </div>
            <div class="article-body" style="margin-top: 24px; line-height: 1.8;">
                ${content}
            </div>

        `;

        // Bind podcast play button click event
        const podcastPlayBtn = document.getElementById('podcast-play-btn');
        if (podcastPlayBtn) {
            podcastPlayBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const url = podcastPlayBtn.dataset.url;
                const title = podcastPlayBtn.dataset.title;
                const cover = podcastPlayBtn.dataset.cover;
                GlobalPodcastPlayer.play(url, title, cover);
            });
        }

        this.enhanceCodeBlocks();
        this.bindArticleToolbarEvents(article);
        this.updateNavButtons(article.id);
    },

    // bindArticleToolbarEvents → article-toolbar.js (ArticleToolbarMixin)

    /**
     * 解析 Markdown
     * @param {string} text
     * @returns {string}
     */
    parseMarkdown(text) {
        if (!text) return '';

        // 1. 基础处理
        text = text.trim();

        // 2. 提取代码块 (``` ... ```)，用占位符替代，防止内部内容被后续规则处理
        const codeBlocks = [];
        text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
            const escaped = code
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            const index = codeBlocks.length;
            codeBlocks.push(`<pre class="md-code-block"><code>${escaped}</code></pre>`);
            return `\x00CODEBLOCK_${index}\x00`;
        });

        // 3. 基础转义
        text = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        // 4. 行内代码 (`code`)
        text = text.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

        // 5. 字体样式
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
        text = text.replace(/~~(.*?)~~/g, '<del>$1</del>');

        // 6. 链接 [text](url)
        text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        // 分隔线
        text = text.replace(/^---+$/gim, '<hr class="md-hr">');

        // 7. 引用块 (> text，但 > 已被转义为 &gt;)
        text = text.replace(/^&gt;\s?(.*$)/gim, '<div class="md-blockquote">$1</div>');

        // 8. 标题 (更紧凑)
        text = text.replace(/^#### (.*$)/gim, '<div class="md-h4">$1</div>');
        text = text.replace(/^### (.*$)/gim, '<div class="md-h3">$1</div>');
        text = text.replace(/^## (.*$)/gim, '<div class="md-h2">$1</div>');
        text = text.replace(/^# (.*$)/gim, '<div class="md-h1">$1</div>');

        // 9. 有序列表 (1. item)
        text = text.replace(/^\s*(\d+)\.\s+(.*$)/gim, '<div class="md-list-item"><span class="md-list-bullet">$1.</span><span class="md-list-content">$2</span></div>');

        // 10. 无序列表项 (使用 Flex 布局对齐，更紧凑)
        text = text.replace(/^\s*[-*]\s+(.*$)/gim, '<div class="md-list-item"><span class="md-list-bullet">•</span><span class="md-list-content">$1</span></div>');

        // 11. 换行处理
        // 两个以上换行 -> 段间距 (8px)
        text = text.replace(/\n\s*\n/g, '<div class="md-gap"></div>');

        // 块级元素闭合标签后的换行 -> 移除 (避免 div/hr/pre 后再跟 br)
        text = text.replace(/(<\/div>|<hr[^>]*>|<\/pre>)\s*\n/g, '$1');

        // 其他换行 -> br
        text = text.replace(/\n/g, '<br>');

        // 12. 还原代码块占位符
        codeBlocks.forEach((block, i) => {
            text = text.replace(`\x00CODEBLOCK_${i}\x00`, block);
        });

        return text;
    },

    // translateBilingual, bindAIButtons → article-ai.js (ArticleAIMixin)

    /**
     * 取消当前文章的所有进行中 AI 请求
     */
    _cancelPendingAI() {
        const article = this._currentArticle;
        if (!article) return;

        if (article._autoSummarizeController) {
            article._autoSummarizeController.abort();
            article._autoSummarizeController = null;
        }
        if (article._summarizeController) {
            article._summarizeController.abort();
            article._summarizeController = null;
        }
        if (article._translateController) {
            article._translateController.abort();
            article._translateController = null;
        }

        this._currentArticle = null;
    },

    /**
     * 增强代码块显示
     * 为 pre 和 code 块添加语言标签和复制按钮
     */
    enhanceCodeBlocks() {
        const articleBody = DOMElements.articleContent?.querySelector('.article-body');
        if (!articleBody) return;

        const preElements = articleBody.querySelectorAll('pre');

        preElements.forEach((pre) => {
            // 避免重复处理
            if (pre.parentElement?.classList.contains('code-block-wrapper')) return;

            // 获取语言类型
            let language = 'text';
            const codeEl = pre.querySelector('code');
            if (codeEl) {
                const className = codeEl.className || '';
                const match = className.match(/(?:language-|lang-)(\w+)/);
                if (match) {
                    language = match[1];
                }
            }

            // 获取代码内容（清理多余换行）
            const getTextContent = (node) => {
                if (!node) return '';
                if (node.nodeType === Node.TEXT_NODE) return node.data;
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.tagName === 'BR') return '\n';
                    return Array.from(node.childNodes).map(getTextContent).join('');
                }
                return '';
            };

            const codeText = getTextContent(codeEl || pre)
                .replace(/\n{3,}/g, '\n\n')
                .trim();

            // 创建包装器
            const wrapper = document.createElement('div');
            wrapper.className = 'code-block-wrapper';

            // 创建头部
            const header = document.createElement('div');
            header.className = 'code-block-header';
            header.innerHTML = `
                <span class="code-language">${language.toUpperCase()}</span>
                <button class="code-copy-btn" title="${i18n.t('ai.copy')}">
                    ${Icons.copy}
                    <span class="copy-text">${i18n.t('ai.copy')}</span>
                </button>
            `;

            // 复制功能 (兼容 iOS Safari)
            const copyBtn = header.querySelector('.code-copy-btn');
            copyBtn.addEventListener('click', async () => {
                const showSuccess = () => {
                    copyBtn.innerHTML = `${Icons.copied}<span class="copy-text">${i18n.t('ai.copied')}</span>`;
                    copyBtn.classList.add('copied');
                    setTimeout(() => {
                        copyBtn.innerHTML = `${Icons.copy}<span class="copy-text">${i18n.t('ai.copy')}</span>`;
                        copyBtn.classList.remove('copied');
                    }, 2000);
                };

                // 优先使用现代 Clipboard API
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    try {
                        await navigator.clipboard.writeText(codeText);
                        showSuccess();
                        return;
                    } catch (err) {
                        // Fallback to execCommand
                    }
                }

                // Fallback: 使用 textarea + execCommand (兼容 iOS Safari)
                try {
                    const textarea = document.createElement('textarea');
                    textarea.value = codeText;
                    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
                    document.body.appendChild(textarea);
                    textarea.focus();
                    textarea.select();
                    textarea.setSelectionRange(0, codeText.length); // iOS 需要这行
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    showSuccess();
                } catch (err) {
                    console.error('Copy failed:', err);
                }
            });

            // 包装 pre 元素
            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(header);
            wrapper.appendChild(pre);
        });
    },

    /**
     * 更新本地未读计数
     * @param {string|number} feedId - 订阅源 ID
     * @param {number} delta - 变化量 (-1 减少，1 增加，默认 -1)
     */
    updateLocalUnreadCount(feedId, delta = -1) {
        if (!feedId) return;

        const feed = AppState.feeds?.find(f => f.id == feedId);
        if (!feed) return;

        feed.unread_count = Math.max(0, (parseInt(feed.unread_count) || 0) + delta);

        // 更新 DOM - 订阅源未读计数
        const feedBtn = DOMElements.feedsList?.querySelector(`.feed-item-btn[data-feed-id="${feedId}"]`);
        if (feedBtn) {
            let countEl = feedBtn.querySelector('.feed-unread-count');
            if (feed.unread_count > 0) {
                if (countEl) {
                    countEl.textContent = feed.unread_count;
                } else {
                    feedBtn.insertAdjacentHTML('beforeend', `<span class="feed-unread-count">${feed.unread_count}</span>`);
                }
            } else if (countEl) {
                countEl.remove();
            }
        }

        // 更新分组计数
        if (feed.group_id) {
            const groupEl = DOMElements.feedsList?.querySelector(`.feed-group[data-group-id="${feed.group_id}"]`);
            if (groupEl) {
                const header = groupEl.querySelector('.feed-group-header');
                let groupCountEl = header?.querySelector('.feed-group-count');
                const groupFeeds = AppState.feeds?.filter(f => f.group_id == feed.group_id) || [];
                const groupUnread = groupFeeds.reduce((sum, f) => sum + (parseInt(f.unread_count) || 0), 0);

                if (groupUnread > 0) {
                    if (groupCountEl) {
                        groupCountEl.textContent = groupUnread;
                    } else if (header) {
                        header.insertAdjacentHTML('beforeend', `<span class="feed-group-count">${groupUnread}</span>`);
                    }
                } else if (groupCountEl) {
                    groupCountEl.remove();
                }
            }
        }

        // 更新全部未读计数
        const totalUnread = AppState.feeds?.reduce((sum, f) => sum + (parseInt(f.unread_count) || 0), 0) || 0;
        const allBtn = DOMElements.feedsList?.querySelector('.feed-item-btn[data-feed-id=""]');
        if (allBtn) {
            let allCountEl = allBtn.querySelector('.all-unread-count');
            if (totalUnread > 0) {
                if (allCountEl) {
                    allCountEl.textContent = totalUnread;
                } else {
                    allBtn.insertAdjacentHTML('beforeend', `<span class="feed-unread-count all-unread-count">${totalUnread}</span>`);
                }
            } else if (allCountEl) {
                allCountEl.remove();
            }
        }
    },

    /**
    * 清除导航按钮
    */
    clearNavButtons() {
        if (!DOMElements.contentPanel) return;
        const container = DOMElements.contentPanel.querySelector('.article-nav-btns');
        if (container) {
            container.remove();
        }
    },

    /**
     * 更新导航按钮
     * @param {string|number} currentId
     */
    /**
     * 更新导航按钮
     * @param {string|number} currentId
     */
    updateNavButtons(currentId) {
        // 先清除旧的
        this.clearNavButtons();

        if (!AppState.articles || AppState.articles.length <= 1) return;

        const currentIndex = AppState.articles.findIndex(a => a.id == currentId);
        if (currentIndex === -1) return;

        const prevId = currentIndex > 0 ? AppState.articles[currentIndex - 1].id : null;
        const nextId = currentIndex < AppState.articles.length - 1 ? AppState.articles[currentIndex + 1].id : null;
        const canLoadMore = !nextId && AppState.pagination && AppState.pagination.hasMore;

        if (!prevId && !nextId && !canLoadMore) return;

        const container = document.createElement('div');
        container.className = 'article-nav-btns';

        let html = '';
        if (prevId) {
            html += `<button class="article-nav-btn" data-nav-id="${prevId}" title="${i18n.t('keyboard.prev_article')}">${Icons.arrow_back}</button>`;
        }
        if (nextId) {
            html += `<button class="article-nav-btn" data-nav-id="${nextId}" title="${i18n.t('keyboard.next_article')}">${Icons.arrow_forward}</button>`;
        } else if (canLoadMore) {
            html += `<button class="article-nav-btn load-more-nav-btn" title="${i18n.t('common.loading')}">${Icons.arrow_forward}</button>`;
        }

        container.innerHTML = html;
        if (DOMElements.contentPanel) {
            DOMElements.contentPanel.appendChild(container); // Move to contentPanel to avoid scrolling
        }

        // 绑定事件
        const btns = container.querySelectorAll('.article-nav-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (btn.classList.contains('load-more-nav-btn')) {
                    const originalHtml = btn.innerHTML;
                    btn.innerHTML = Icons.spinner; // Show loading spinner
                    btn.style.pointerEvents = 'none';

                    try {
                        await ArticlesView.loadMoreArticles();
                        // Articles loaded, find the next article from updated AppState
                        // AppState.articles updated in place
                        const updatedIndex = AppState.articles.findIndex(a => a.id == currentId);
                        if (updatedIndex !== -1 && updatedIndex < AppState.articles.length - 1) {
                            const newNextId = AppState.articles[updatedIndex + 1].id;
                            this.selectArticle(newNextId);
                        } else {
                            // Failed to find next article or still at end? Restore button
                            btn.innerHTML = originalHtml;
                            btn.style.pointerEvents = 'auto';
                            showToast(i18n.t('article.no_more_articles'));
                        }
                    } catch (err) {
                        console.error('Auto load next failed:', err);
                        btn.innerHTML = originalHtml;
                        btn.style.pointerEvents = 'auto';
                    }
                    return;
                }

                const id = btn.dataset.navId;
                if (id) {
                    this.selectArticle(id);
                }
            });
        });
    },

    // Mixin methods from sub-modules
    ...ArticleAIMixin,
    ...ArticleToolbarMixin,
};
