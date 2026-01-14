import { Dialogs } from './dialogs.js';
/**
 * ArticleContentView - 文章内容视图模块
 * @module view/article-content
 */

import { DOMElements } from '../../dom.js';
import { AppState } from '../../state.js';
import { FeedManager } from '../feed-manager.js';
import { showToast } from './utils.js';
import { Modal } from './components.js';
import { AIService } from '../ai-service.js';
import { i18n } from '../i18n.js';
import { Icons } from '../icons.js';
import { ArticlesView } from './articles-view.js';

/**
 * 文章内容视图管理
 */
export const ArticleContentView = {
    /** 视图管理器引用 */
    viewManager: null,

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
        }
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
                    this.renderArticleContent(article);
                } else {
                    article = await FeedManager.getArticle(articleId);
                    article.is_read = 1;
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
     * 渲染简报内容
     * @param {Object} digest - 简报对象
     */
    renderDigestContent(digest) {


        // 工具栏 HTML（简化版，只有返回按钮）
        const toolbarHTML = `
            <div class="article-toolbar">
                <div class="article-toolbar-left">
                    <button class="article-toolbar-btn" id="article-back-btn" title="返回列表">
                        ${Icons.arrow_back}
                    </button>
                </div>

            </div>
        `;

        // 使用 Markdown 解析内容
        const renderedContent = this.parseMarkdown(digest.content || '');

        DOMElements.articleContent.innerHTML = `
            ${toolbarHTML}
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

        this.bindDigestToolbarEvents();
        this.updateNavButtons(digest.id);
    },

    /**
     * 绑定简报工具栏事件
     * @param {Object} digest - 简报对象
     */
    bindDigestToolbarEvents() {
        const vm = this.viewManager;

        const backBtn = document.getElementById('article-back-btn');

        // 返回按钮
        if (backBtn) {
            backBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.innerWidth <= 800) {
                    requestAnimationFrame(() => {
                        vm.isProgrammaticNav = true;
                        history.back();
                    });
                } else {
                    if (AppState.currentGroupId) {
                        window.location.hash = `#/group/${AppState.currentGroupId}`;
                    } else if (AppState.currentFeedId) {
                        window.location.hash = `#/feed/${AppState.currentFeedId}`;
                    } else if (AppState.viewingFavorites) {
                        window.location.hash = '#/favorites';
                    } else {
                        window.location.hash = '#/all';
                    }
                }
            });
        }


    },

    /**
     * 渲染文章详情内容
     * @param {Object} article - 文章对象
     */
    renderArticleContent(article) {
        // document.title = article.title || 'Tidyflux';

        const locale = AppState.user.language || 'zh-CN';
        const date = article.published_at
            ? new Date(article.published_at).toLocaleString(locale)
            : '';
        const content = article.content || article.summary || '<p>内容为空</p>';

        // 构建 feed icon 或 feed 名称
        let feedInfo = '';
        if (article.feed_id) {
            feedInfo = `<img src="/api/favicon?feedId=${article.feed_id}" class="favicon" loading="lazy" decoding="async" alt="${article.feed_title || ''}" title="${article.feed_title || ''}" style="width: 14px; height: 14px; border-radius: 4px; margin: 0; display: block;">`;
        }
        if (!feedInfo && article.feed_title) {
            feedInfo = `<span style="font-weight: 500;">${article.feed_title}</span>`;
        }

        // 构建 meta 信息行
        const metaParts = [];
        if (feedInfo) metaParts.push(feedInfo);
        if (date) metaParts.push(`<span>${date}</span>`);
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
                    <button class="article-toolbar-btn" id="article-fetch-content-btn" title="${i18n.t('feed.fetch_content_failed').replace('Failed to fetch', 'Fetch')}">
                        ${Icons.fetch_original}
                    </button>
                    <div class="toolbar-divider" style="width: 1px; height: 16px; background: var(--border-color); margin: 0 4px;"></div>
                    <button class="article-toolbar-btn" id="article-translate-btn" title="${i18n.t('ai.translate_btn')}">
                        ${Icons.translate}
                    </button>
                    <button class="article-toolbar-btn" id="article-summarize-btn" title="${i18n.t('ai.summarize_btn')}">
                        ${Icons.summarize}
                    </button>
                </div>
            </div>
        `;

        DOMElements.articleContent.innerHTML = `
            ${toolbarHTML}
            <header class="article-header">
                ${titleHTML}
                <div class="article-header-info" style="
                    color: var(--text-secondary); 
                    font-size: 14px; 
                    margin-top: 16px; 
                    display: flex; 
                    align-items: center; 
                    justify-content: flex-start;
                ">
                    ${metaHTML}
                </div>

            </header>
            <div id="article-ai-summary" class="article-ai-summary" style="display: none; margin: 16px 0; padding: 16px; background: var(--card-bg); border-radius: var(--radius); box-shadow: var(--card-shadow); border: none;">
                <div class="ai-summary-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border-color);">
                    <strong class="ai-title" style="display: flex; align-items: center; gap: 8px;">
                        <span class="ai-title-text">${i18n.t('ai.summary_title')}</span>
                    </strong>
                    <button class="ai-close-btn" style="background: none; border: none; cursor: pointer; color: var(--meta-color); font-size: 1.2em; padding: 4px;">✕</button>
                </div>
                <div class="ai-content markdown-body" style="line-height: 1.5; font-size: 0.9em;"></div>
            </div>
            <div class="article-body" style="margin-top: 24px; line-height: 1.8;">
                ${content}
            </div>

        `;

        this.enhanceCodeBlocks();
        this.bindArticleToolbarEvents(article);
        this.updateNavButtons(article.id);
    },

    /**
     * 绑定文章工具栏事件
     * @param {Object} article - 文章对象
     */
    bindArticleToolbarEvents(article) {
        const vm = this.viewManager;
        const backBtn = document.getElementById('article-back-btn');
        const readBtn = document.getElementById('article-toggle-read-btn');
        const favBtn = document.getElementById('article-toggle-fav-btn');
        const fetchBtn = document.getElementById('article-fetch-content-btn');

        // 返回按钮
        if (backBtn) {
            backBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Always return to the parent list view explicitly
                if (AppState.viewingDigests) {
                    window.location.hash = '#/digests';
                } else if (AppState.currentGroupId) {
                    window.location.hash = `#/group/${AppState.currentGroupId}`;
                } else if (AppState.currentFeedId) {
                    window.location.hash = `#/feed/${AppState.currentFeedId}`;
                } else if (AppState.viewingFavorites) {
                    window.location.hash = '#/favorites';
                } else {
                    window.location.hash = '#/all';
                }
            });
        }

        // 已读/未读切换按钮
        if (readBtn) {
            readBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    const btn = e.currentTarget;
                    if (article.is_read) {
                        await FeedManager.markAsUnread(article.id);
                        article.is_read = 0;
                        btn.classList.remove('is-read');
                        btn.classList.add('active');
                        btn.innerHTML = Icons.mark_unread;
                        btn.title = i18n.t('article.mark_read');

                        // 增加未读计数
                        this.updateLocalUnreadCount(article.feed_id, 1);
                    } else {
                        await FeedManager.markAsRead(article.id);
                        article.is_read = 1;
                        btn.classList.add('is-read');
                        btn.classList.remove('active');
                        btn.innerHTML = Icons.mark_read;
                        btn.title = i18n.t('article.mark_unread');
                        this.updateLocalUnreadCount(article.feed_id);
                    }

                    // 更新列表中的文章状态
                    const listItem = DOMElements.articlesList?.querySelector(`.article-item[data-id="${article.id}"]`);
                    if (listItem) listItem.classList.toggle('unread', !article.is_read);
                } catch (err) {
                    console.error('Toggle read status failed', err);
                }
            });
        }

        // 收藏按钮
        if (favBtn) {
            favBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    const btn = e.currentTarget;
                    if (article.is_favorited) {
                        await FeedManager.unfavoriteArticle(article.id);
                        article.is_favorited = 0;
                        btn.classList.remove('active');
                        btn.title = i18n.t('article.star');
                        btn.innerHTML = Icons.star_border;
                    } else {
                        await FeedManager.favoriteArticle(article.id);
                        article.is_favorited = 1;
                        btn.classList.add('active');
                        btn.title = i18n.t('article.unstar');
                        btn.innerHTML = Icons.star;
                    }

                    // 更新列表中的收藏星标
                    const listMeta = DOMElements.articlesList?.querySelector(`.article-item[data-id="${article.id}"] .article-item-meta`);
                    if (listMeta) {
                        const star = Array.from(listMeta.children).find(el => el.innerHTML === '★');
                        if (article.is_favorited && !star) {
                            const starEl = document.createElement('span');
                            starEl.style.color = 'var(--accent-color)';
                            starEl.innerHTML = '★';
                            listMeta.prepend(starEl);
                        } else if (!article.is_favorited && star) {
                            star.remove();
                        }
                    }
                } catch (err) {
                    console.error('Toggle favorite failed', err);
                }
            });
        }

        // 获取全文按钮
        if (fetchBtn) {
            // 如果已有原始内容缓存，更新按钮状态
            if (article._originalContent) {
                fetchBtn.innerHTML = Icons.restore_original;
                fetchBtn.title = '恢复原文';
                fetchBtn.classList.add('active');
            }

            fetchBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const btn = e.currentTarget;

                if (btn.classList.contains('loading')) return;

                // 错误状态下点击恢复
                if (btn.dataset.errorState === 'true') {
                    clearTimeout(btn.errorTimeout);
                    btn.innerHTML = btn.dataset.originalHtml;
                    btn.classList.remove('loading');
                    delete btn.dataset.errorState;
                    delete btn.dataset.originalHtml;
                    return;
                }

                // 切换回原始内容
                if (article._originalContent) {
                    const bodyEl = document.querySelector('.article-body');
                    if (bodyEl) bodyEl.innerHTML = article._originalContent;

                    const stateArticle = AppState.articles?.find(a => a.id == article.id);
                    if (stateArticle) stateArticle.content = article._originalContent;

                    delete article._originalContent;
                    fetchBtn.innerHTML = Icons.fetch_original;
                    btn.classList.remove('active');
                    btn.title = '获取全文';
                    return;
                }

                // 开始获取全文
                const originalHtml = btn.innerHTML;
                btn.innerHTML = Icons.spinner;
                btn.classList.add('loading');

                // 添加旋转动画样式
                if (!document.getElementById('spinner-style')) {
                    const style = document.createElement('style');
                    style.id = 'spinner-style';
                    style.textContent = '@keyframes rotate { 100% { transform: rotate(360deg); } } .spinner circle { stroke-dasharray: 90, 150; stroke-dashoffset: 0; stroke-linecap: round; }';
                    document.head.appendChild(style);
                }

                try {
                    const originalContent = document.querySelector('.article-body')?.innerHTML || article.content;
                    const result = await FeedManager.fetchEntryContent(article.id);

                    article._originalContent = originalContent;

                    const bodyEl = document.querySelector('.article-body');
                    if (bodyEl) {
                        bodyEl.innerHTML = result.content || result.summary || '<p>内容为空</p>';
                    }

                    const stateArticle = AppState.articles?.find(a => a.id == article.id);
                    if (stateArticle) stateArticle.content = result.content;

                    // 显示成功状态
                    btn.innerHTML = Icons.success;

                    setTimeout(() => {
                        btn.innerHTML = Icons.restore_original;
                        btn.title = '恢复原文';
                        btn.classList.add('active');
                        btn.classList.remove('loading');
                    }, 1000);
                } catch (err) {
                    console.error('Fetch content failed', err);
                    btn.innerHTML = Icons.error;
                    btn.dataset.errorState = 'true';
                    btn.dataset.originalHtml = originalHtml;
                    btn.errorTimeout = setTimeout(() => {
                        if (btn.dataset.errorState === 'true') {
                            btn.innerHTML = originalHtml;
                            btn.classList.remove('loading');
                            delete btn.dataset.errorState;
                            delete btn.dataset.originalHtml;
                        }
                    }, 2000);
                }
            });

        }

        // 绑定 AI 按钮事件
        this.bindAIButtons(article);
    },

    /**
     * 解析 Markdown
     * @param {string} text
     * @returns {string}
     */
    parseMarkdown(text) {
        if (!text) return '';

        // 1. 基础处理
        text = text.trim();

        // 2. 基础转义
        text = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        // 3. 字体样式
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');

        // 分隔线
        // text = text.replace(/^---+$/gim, '<hr style="border: 0; border-top: 1px solid var(--border-color); margin: 24px 0;">');
        text = text.replace(/^---+$/gim, '<hr class="md-hr">');

        // 4. 标题 (更紧凑)
        text = text.replace(/^#### (.*$)/gim, '<div class="md-h4">$1</div>');
        text = text.replace(/^### (.*$)/gim, '<div class="md-h3">$1</div>');
        text = text.replace(/^## (.*$)/gim, '<div class="md-h2">$1</div>');
        text = text.replace(/^# (.*$)/gim, '<div class="md-h1">$1</div>');

        // 5. 列表项 (使用 Flex 布局对齐，更紧凑)
        text = text.replace(/^\s*[-*]\s+(.*$)/gim, '<div class="md-list-item"><span class="md-list-bullet">•</span><span class="md-list-content">$1</span></div>');

        // 6. 换行处理
        // 两个以上换行 -> 段间距 (8px)
        text = text.replace(/\n\s*\n/g, '<div class="md-gap"></div>');

        // 闭合标签后的换行 -> 移除 (避免 div 后再跟 br)
        text = text.replace(/>\s*\n/g, '>');

        // 其他换行 -> br
        text = text.replace(/\n/g, '<br>');

        return text;
    },

    /**
     * 双语段落翻译
     * @param {HTMLElement} bodyEl
     * @param {HTMLElement} titleEl
     */
    /**
     * 双语段落翻译
     * @param {HTMLElement} bodyEl
     * @param {HTMLElement} titleEl
     * @param {AbortSignal} signal
     */
    async translateBilingual(bodyEl, titleEl, signal = null) {
        // 1. 识别需要翻译的块
        const blocks = [];
        if (titleEl) blocks.push({ el: titleEl, isTitle: true, text: titleEl.textContent.trim() });

        const blockTags = new Set([
            'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CANVAS', 'DD', 'DIV', 'DL', 'DT',
            'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5',
            'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'NOSCRIPT', 'OL', 'P', 'SECTION',
            'TABLE', 'TFOOT', 'UL', 'VIDEO'
        ]);

        const isMeaningfulText = (text) => {
            // 移除常见的干扰字符 (Emoji, 标点, 空白, 数字)
            // \p{P}: Punctuation, \p{S}: Symbols (including Emojis), \p{Z}: Separators, \p{N}: Numbers
            // 保留一点余地：如果文本包含至少一个字母或 CJK 字符等连续语义字符
            const cleanText = text.replace(/[\p{P}\p{S}\p{Z}\p{N}]+/gu, '').trim();
            return cleanText.length >= 1;
        };

        let pendingInlineNodes = [];

        const flushInlineBlock = () => {
            if (pendingInlineNodes.length === 0) return;

            let textContent = '';
            pendingInlineNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.tagName === 'BR') {
                        textContent += '\n';
                    } else {
                        textContent += node.innerText || node.textContent || '';
                    }
                } else {
                    textContent += node.textContent || '';
                }
            });

            const trimmedText = textContent.trim();
            if (trimmedText.length >= 2 && isMeaningfulText(trimmedText)) {
                blocks.push({
                    el: pendingInlineNodes[pendingInlineNodes.length - 1],
                    text: trimmedText
                });
            }
            pendingInlineNodes = [];
        };

        if (bodyEl.childNodes.length > 0) {
            Array.from(bodyEl.childNodes).forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const tag = node.tagName.toUpperCase();
                    if (['SCRIPT', 'STYLE', 'SVG', 'IFRAME', 'BUTTON', 'CODE'].includes(tag)) return;

                    // 容器类标签 (代码块、公式、表格)：中断当前行内累积，且不参与翻译
                    if (['MATH', 'PRE', 'TABLE'].includes(tag)) {
                        flushInlineBlock();
                        return;
                    }

                    if (node.classList.contains('ai-trans-block') || node.classList.contains('article-toolbar')) return;

                    if (blockTags.has(tag)) {
                        flushInlineBlock();

                        // 如果块级元素内部包含不需要翻译的特殊标签，直接跳过整个块的翻译
                        if (node.querySelector('math, pre, table')) {
                            return;
                        }

                        const text = node.innerText ? node.innerText.trim() : '';
                        if (text.length >= 2 && isMeaningfulText(text)) {
                            blocks.push({ el: node, text: text });
                        }
                        return;
                    }
                }

                if (node.nodeType === Node.TEXT_NODE) {
                    if (!node.textContent.trim() && pendingInlineNodes.length === 0) return;
                }

                pendingInlineNodes.push(node);
            });
            flushInlineBlock();
        } else if (bodyEl.innerText.trim().length > 0) {
            const text = bodyEl.innerText.trim();
            if (text.length >= 2 && isMeaningfulText(text)) {
                blocks.push({ el: bodyEl, text: text });
            }
        }

        // 2. 插入占位符
        blocks.forEach(block => {
            const transEl = document.createElement('div');
            transEl.className = block.isTitle ? 'ai-title-trans-block' : 'ai-trans-block';

            block.transEl = transEl;

            if (block.isTitle) {
                const computedStyle = window.getComputedStyle(block.el);

                transEl.style.fontFamily = computedStyle.fontFamily;
                transEl.style.fontSize = computedStyle.fontSize;
                transEl.style.fontWeight = computedStyle.fontWeight;
                transEl.style.lineHeight = computedStyle.lineHeight;
                transEl.style.color = computedStyle.color;
                transEl.style.letterSpacing = computedStyle.letterSpacing;
                transEl.style.textTransform = computedStyle.textTransform;

                transEl.style.marginTop = '8px';
                transEl.style.marginBottom = '24px';

                transEl.innerHTML = `<span style="opacity:0.6; font-size: 0.6em; font-weight: normal;">... ${i18n.t('ai.translating')} ...</span>`;

                const parent = block.el.tagName.toLowerCase() === 'a' ? block.el.parentElement : block.el;
                parent.insertAdjacentElement('afterend', transEl);
            } else {
                transEl.style.color = 'var(--text-secondary)';
                transEl.style.fontSize = '0.95em';
                transEl.style.marginTop = '6px';
                transEl.style.marginBottom = '20px';
                transEl.style.padding = '8px 12px';
                transEl.style.background = 'color-mix(in srgb, var(--accent-color), transparent 96%)';
                transEl.style.borderRadius = 'var(--radius)';
                transEl.innerHTML = `<span style="opacity:0.6; font-size: 0.9em;">... ${i18n.t('ai.translating')} ...</span>`;

                if (block.el.nodeType === Node.ELEMENT_NODE) {
                    block.el.insertAdjacentElement('afterend', transEl);
                } else if (block.el.parentNode) {
                    block.el.parentNode.insertBefore(transEl, block.el.nextSibling);
                }
            }
        });

        // 3. 并发队列执行翻译
        const CONCURRENT_LIMIT = 5;
        let currentIndex = 0;

        const processNext = async () => {
            while (currentIndex < blocks.length) {
                const index = currentIndex++;
                const block = blocks[index];

                if (signal?.aborted) return;

                try {
                    const aiConfig = AIService.getConfig();
                    const targetLang = aiConfig.targetLang || (i18n.locale === 'zh' ? 'zh-CN' : 'en');
                    const translation = await AIService.translate(block.text, targetLang, signal);
                    if (signal?.aborted) return;
                    block.transEl.innerHTML = this.parseMarkdown(translation);
                } catch (err) {
                    console.error('Block translate error:', err);
                    block.transEl.innerHTML = `<span style="color:red; font-size: 0.85em;">Translation failed</span>`;
                }
            }
        };

        const workers = [];
        for (let i = 0; i < CONCURRENT_LIMIT; i++) {
            workers.push(processNext());
        }

        await Promise.all(workers);
    },

    /**
     * 绑定 AI 功能按钮
     * @param {Object} article - 文章对象
     */
    bindAIButtons(article) {
        const translateBtn = document.getElementById('article-translate-btn');
        const summarizeBtn = document.getElementById('article-summarize-btn');
        const summaryBox = document.getElementById('article-ai-summary');

        // 总结功能
        if (summarizeBtn && summaryBox) {
            const summaryContent = summaryBox.querySelector('.ai-content');
            const closeBtn = summaryBox.querySelector('.ai-close-btn');

            closeBtn.addEventListener('click', () => {
                summaryBox.style.display = 'none';
            });

            // 如果已有缓存的总结，直接显示（可以在 article 对象上缓存）
            // 这里暂不实现持久化缓存，仅页面级

            summarizeBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (!AIService.isConfigured()) {
                    Modal.alertWithSettings(i18n.t('ai.not_configured'), i18n.t('common.go_to_settings'), () => Dialogs.showSettingsDialog(false));
                    return;
                }

                // 如果正在加载，点击取消
                if (summarizeBtn.classList.contains('loading')) {
                    if (article._summarizeController) {
                        article._summarizeController.abort();
                        article._summarizeController = null;
                        summarizeBtn.classList.remove('loading');
                        summaryBox.style.display = 'none';
                        summaryContent.innerHTML = '';
                    }
                    return;
                }

                if (summarizeBtn.classList.contains('active')) {
                    summaryBox.style.display = summaryBox.style.display === 'none' ? 'block' : 'none';
                    return;
                }

                summarizeBtn.classList.add('loading');
                summaryBox.style.display = 'block';
                summaryContent.innerHTML = `<div class="loading-spinner">${i18n.t('ai.summarizing')}</div>`;

                try {
                    // 创建 AbortController
                    article._summarizeController = new AbortController();
                    const signal = article._summarizeController.signal;

                    // 获取纯文本内容用于总结
                    const rawContent = AIService.extractText(article.content || '');

                    // 获取配置的目标语言
                    const aiConfig = AIService.getConfig();
                    const targetLang = aiConfig.targetLang || (i18n.locale === 'zh' ? 'zh-CN' : 'en');

                    let streamedText = '';
                    await AIService.summarize(rawContent, targetLang, (chunk) => {
                        streamedText += chunk;
                        summaryContent.innerHTML = this.parseMarkdown(streamedText);
                    }, signal);

                    summarizeBtn.classList.remove('loading');
                    summarizeBtn.classList.add('active');
                } catch (err) {
                    if (err.name === 'AbortError') {
                        console.log('Summarize aborted');
                        return;
                    }
                    console.error('Summarize failed:', err);
                    summaryContent.innerHTML = `<span style="color: red;">${i18n.t('ai.api_error')}: ${err.message}</span>`;
                    summarizeBtn.classList.remove('loading');
                } finally {
                    article._summarizeController = null;
                }
            });
        }

        // 翻译功能
        if (translateBtn) {
            // 如果已有翻译缓存
            if (article._translatedContent) {
                translateBtn.classList.add('active');
                translateBtn.title = i18n.t('ai.original_content');
            }

            translateBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                // 取消逻辑
                if (translateBtn.classList.contains('loading')) {
                    if (article._translateController) {
                        article._translateController.abort();
                        article._translateController = null;
                        translateBtn.classList.remove('loading');

                        // 清理已生成的翻译块
                        const bodyEl = document.querySelector('.article-body');
                        if (bodyEl) {
                            bodyEl.querySelectorAll('.ai-trans-block').forEach(el => el.remove());
                        }
                        const titleTransBlock = document.querySelector('.ai-title-trans-block');
                        if (titleTransBlock) titleTransBlock.remove();

                        translateBtn.classList.remove('active');
                        translateBtn.title = i18n.t('ai.translate_btn');

                        showToast('翻译已取消');
                    }
                    return;
                }

                if (!AIService.isConfigured()) {
                    Modal.alertWithSettings(i18n.t('ai.not_configured'), i18n.t('common.go_to_settings'), () => Dialogs.showSettingsDialog(false));
                    return;
                }

                const bodyEl = document.querySelector('.article-body');
                const titleHeader = document.querySelector('.article-header h1');
                const titleLink = titleHeader ? titleHeader.querySelector('a') : null;
                const titleEl = titleLink || titleHeader;

                if (!bodyEl) return;

                // 检查是否已经是双语模式（存在翻译块）
                const existingBlocks = bodyEl.querySelectorAll('.ai-trans-block');
                const existingTitleBlock = document.querySelector('.ai-title-trans-block');

                if (existingBlocks.length > 0 || existingTitleBlock) {
                    // 切换显示/隐藏
                    const anyVisible = (existingTitleBlock && existingTitleBlock.style.display !== 'none') ||
                        (existingBlocks.length > 0 && existingBlocks[0].style.display !== 'none');

                    const newDisplay = anyVisible ? 'none' : 'block';

                    if (existingTitleBlock) existingTitleBlock.style.display = newDisplay;
                    existingBlocks.forEach(el => el.style.display = newDisplay);

                    translateBtn.classList.toggle('active', !anyVisible);
                    translateBtn.title = !anyVisible ? i18n.t('ai.original_content') : i18n.t('ai.translate_btn');
                    return;
                }

                // 开始双语翻译
                translateBtn.classList.add('loading');

                try {
                    article._translateController = new AbortController();
                    await this.translateBilingual(bodyEl, titleEl, article._translateController.signal);
                    translateBtn.classList.remove('loading');
                    translateBtn.classList.add('active');
                    translateBtn.title = i18n.t('ai.original_content');
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.error('Translation failed', err);
                    Modal.alert(`${i18n.t('ai.api_error')}: ${err.message}`);
                    translateBtn.classList.remove('loading');
                }
            });
        }
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
            html += `<button class="article-nav-btn" data-nav-id="${prevId}" title="上一篇">${Icons.arrow_back}</button>`;
        }
        if (nextId) {
            html += `<button class="article-nav-btn" data-nav-id="${nextId}" title="下一篇">${Icons.arrow_forward}</button>`;
        } else if (canLoadMore) {
            html += `<button class="article-nav-btn load-more-nav-btn" title="加载更多">${Icons.arrow_forward}</button>`;
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
                            showToast(i18n.t('article.no_more_articles') || '没有更多文章了');
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




};
