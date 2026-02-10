import { FeedManager } from '../feed-manager.js';
import { i18n } from '../i18n.js';
import { AppState } from '../../state.js';
import { DOMElements } from '../../dom.js';
import { ArticlesView } from './articles-view.js';
import { Icons } from '../icons.js';

/**
 * 搜索功能常量配置
 */
const SEARCH_CONFIG = {
    PAGINATION_LIMIT: 50,      // 搜索结果分页限制
    TRANSITION_DELAY_MS: 200,  // 动画过渡延迟
    FOCUS_DELAY_MS: 50,        // 自动聚焦延迟
    CALIBRATION_DELAY_MS: 50   // 滚动校准延迟
};

/**
 * 搜索状态
 */
const searchState = {
    lastQuery: '',
    lastResults: null,
    lastPage: 1,
    hasMore: false,
    total: 0,
    isSearching: false,
    scrollHandler: null
};


/**
 * 搜索视图管理
 */
export const SearchView = {
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
     * 显示内联搜索框（文章列表顶部浮动）
     */
    showInlineSearchBox() {
        const articlesPanel = document.getElementById('articles-panel');
        if (!articlesPanel) return;

        // 移除已有的搜索框
        const existing = articlesPanel.querySelector('.inline-search-overlay');
        if (existing) existing.remove();
        const existingBox = articlesPanel.querySelector('.inline-search-box');
        if (existingBox) existingBox.remove();

        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'inline-search-overlay';

        // 创建搜索框
        const searchBox = document.createElement('div');
        searchBox.className = 'inline-search-box';
        searchBox.innerHTML = `
            <input type="text" id="inline-search-input" placeholder="${i18n.t('nav.search_placeholder')}" autofocus>
            <button class="search-confirm-btn" title="${i18n.t('common.search')}">
                ${Icons.search}
            </button>
            <button class="search-cancel-btn" title="${i18n.t('common.cancel')}">
                ${Icons.close}
            </button>
        `;

        articlesPanel.appendChild(overlay);
        articlesPanel.appendChild(searchBox);

        const input = searchBox.querySelector('#inline-search-input');
        const confirmBtn = searchBox.querySelector('.search-confirm-btn');
        const cancelBtn = searchBox.querySelector('.search-cancel-btn');

        // 优化移动端键盘弹出逻辑：
        // 1. 先强制元素可见（但透明），以便 focus 能生效
        overlay.style.visibility = 'visible';
        searchBox.style.visibility = 'visible';

        // 2. 立即聚焦 (在用户交互的当前 tick 中)
        input.focus();

        // 3. 触发进场动画 (下一帧添加 active 类)
        requestAnimationFrame(() => {
            overlay.classList.add('active');
            searchBox.classList.add('active');
            overlay.style.visibility = '';
            searchBox.style.visibility = '';
        });

        // 4. 备用聚焦策略
        setTimeout(() => {
            if (document.activeElement !== input) input.focus();
        }, SEARCH_CONFIG.FOCUS_DELAY_MS);

        const close = () => {
            overlay.classList.remove('active');
            searchBox.classList.remove('active');
            setTimeout(() => {
                overlay.remove();
                searchBox.remove();
            }, SEARCH_CONFIG.TRANSITION_DELAY_MS);
        };

        const performSearch = async () => {
            const query = input.value.trim();
            if (!query) return;

            close();

            // 设置搜索模式
            AppState.isSearchMode = true;
            AppState.searchQuery = query;
            AppState.currentFeedId = null;
            AppState.currentGroupId = null;
            AppState.viewingFavorites = false;

            // 更新 URL
            history.replaceState(null, '', `#/search?q=${encodeURIComponent(query)}`);

            // 更新标题
            this.updateSearchTitle(query);

            // 清除侧边栏选中状态
            document.querySelectorAll('.nav-item, .feed-item, .feed-item-btn, .feed-group-name').forEach(el => el.classList.remove('active'));

            // 显示加载状态
            DOMElements.articlesList.innerHTML = `<div class="loading">${i18n.t('common.searching')}</div>`;

            // 清理虚拟列表
            if (ArticlesView.virtualList) {
                ArticlesView.virtualList.destroy();
                ArticlesView.virtualList = null;
            }
            ArticlesView.useVirtualScroll = false;

            try {
                const data = await FeedManager.searchArticles(query, 1);
                const articles = data.articles || [];

                // 更新搜索状态
                searchState.lastQuery = query;
                searchState.lastResults = articles;
                searchState.lastPage = 1;
                searchState.hasMore = data.pagination && data.pagination.hasMore;
                searchState.total = data.pagination ? data.pagination.total : 0;

                AppState.articles = articles;
                AppState.pagination = {
                    page: 1,
                    limit: SEARCH_CONFIG.PAGINATION_LIMIT,
                    total: searchState.total,
                    hasMore: searchState.hasMore,
                    totalPages: Math.ceil(searchState.total / SEARCH_CONFIG.PAGINATION_LIMIT)
                };

                // 渲染结果
                if (articles.length === 0) {
                    DOMElements.articlesList.innerHTML = `
                        <div class="empty-content" style="flex-direction: column; gap: 8px;">
                            ${Icons.search_large}
                            <p>${i18n.t('article.no_results')}</p>
                        </div>
                    `;
                } else {
                    ArticlesView.renderArticlesList(articles);
                    // 无限滚动会自动处理加载更多
                }
            } catch (error) {
                console.error('Search error:', error);
                DOMElements.articlesList.innerHTML = `<div class="error-msg">${i18n.t('common.search_failed')}</div>`;
            }
        };

        // 事件绑定
        confirmBtn.addEventListener('click', performSearch);

        // 处理 IME 输入法（如拼音）- 按回车确认输入时不触发搜索
        let isComposing = false;
        input.addEventListener('compositionstart', () => {
            isComposing = true;
        });
        input.addEventListener('compositionend', () => {
            isComposing = false;
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !isComposing) performSearch();
            if (e.key === 'Escape') close();
        });
        cancelBtn.addEventListener('click', close);
        overlay.addEventListener('click', close);
    },

    /**
     * 退出搜索模式
     */
    exitSearch() {
        AppState.searchQuery = '';
        DOMElements.currentFeedTitle.style.display = '';
        DOMElements.currentFeedTitle.style.alignItems = '';
        window.location.hash = '#/all';
    },

    /**
     * 更新搜索标题
     * @param {string} query - 搜索关键词
     */
    updateSearchTitle(query) {
        DOMElements.currentFeedTitle.style.display = 'flex';
        DOMElements.currentFeedTitle.style.alignItems = 'center';
        DOMElements.currentFeedTitle.innerHTML = `
            ${i18n.t('common.search')}:&nbsp;<span class="search-query-text">${query}</span>
            <button id="exit-search-btn" class="icon-btn" style="margin-left: 8px; width: 24px; height: 24px; min-width: 24px; display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; padding: 0; background: none; border: none; cursor: pointer; color: inherit; opacity: 0.7;" title="${i18n.t('common.close')}">
                ${Icons.close}
            </button>
        `;

        requestAnimationFrame(() => {
            const exitBtn = document.getElementById('exit-search-btn');
            if (exitBtn) {
                exitBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.exitSearch();
                });
            }
        });
    },

    /**
     * 从路由恢复搜索状态
     * @param {string} query - 搜索关键词
     */
    async restoreSearch(query) {
        if (!query) return;

        // 设置搜索模式
        AppState.isSearchMode = true;
        AppState.searchQuery = query;
        AppState.currentFeedId = null;
        AppState.currentGroupId = null;
        AppState.viewingFavorites = false;

        // 更新标题
        this.updateSearchTitle(query);

        // 清除侧边栏选中状态
        document.querySelectorAll('.nav-item, .feed-item, .feed-item-btn, .feed-group-name').forEach(el => el.classList.remove('active'));

        // 如果 AppState 中已有该查询的搜索结果，直接使用（包括加载更多后的所有文章）
        if (searchState.lastQuery === query && AppState.articles && AppState.articles.length > 0) {
            // 检查列表是否需要重新渲染：如果为空或显示loading，则渲染
            const listEl = DOMElements.articlesList;
            const isEmpty = listEl.children.length === 0 || listEl.querySelector('.loading');

            // 只有当需要时才重新渲染，避免不必要的 DOM 重建导致的闪烁和位置丢失
            if (isEmpty || (ArticlesView.useVirtualScroll && !ArticlesView.virtualList)) {
                ArticlesView.renderArticlesList(AppState.articles);
            }

            // 恢复滚动位置
            // 恢复滚动位置 - 使用多阶段恢复以确保准确性
            if (AppState.lastListViewScrollTop !== null) {
                // 第一阶段：立即尝试恢复（减少视觉跳变）
                requestAnimationFrame(() => {
                    if (ArticlesView.useVirtualScroll && ArticlesView.virtualList) {
                        ArticlesView.virtualList.setScrollTop(AppState.lastListViewScrollTop);
                    } else if (DOMElements.articlesList) {
                        DOMElements.articlesList.scrollTop = AppState.lastListViewScrollTop;
                    }
                });

                // 第二阶段：延时再次校准（等待布局完全稳定）
                setTimeout(() => {
                    if (ArticlesView.useVirtualScroll && ArticlesView.virtualList) {
                        ArticlesView.virtualList.setScrollTop(AppState.lastListViewScrollTop);
                        ArticlesView.virtualList.render(); // 强制重绘一次以修正可能的空白
                    } else if (DOMElements.articlesList) {
                        DOMElements.articlesList.scrollTop = AppState.lastListViewScrollTop;
                    }
                }, SEARCH_CONFIG.CALIBRATION_DELAY_MS);
            }
            return;
        }

        // 显示加载状态
        DOMElements.articlesList.innerHTML = `<div class="loading">${i18n.t('common.searching')}</div>`;

        // 清理虚拟列表
        if (ArticlesView.virtualList) {
            ArticlesView.virtualList.destroy();
            ArticlesView.virtualList = null;
        }
        ArticlesView.useVirtualScroll = false;

        try {
            const data = await FeedManager.searchArticles(query, 1);
            const articles = data.articles || [];

            // 更新搜索状态
            searchState.lastQuery = query;
            searchState.lastResults = articles;
            searchState.lastPage = 1;
            searchState.hasMore = data.pagination && data.pagination.hasMore;
            searchState.total = data.pagination ? data.pagination.total : 0;

            AppState.articles = articles;
            AppState.pagination = {
                page: 1,
                limit: SEARCH_CONFIG.PAGINATION_LIMIT,
                total: searchState.total,
                hasMore: searchState.hasMore,
                totalPages: Math.ceil(searchState.total / SEARCH_CONFIG.PAGINATION_LIMIT)
            };

            // 渲染结果
            if (articles.length === 0) {
                DOMElements.articlesList.innerHTML = `
                    <div class="empty-content" style="flex-direction: column; gap: 8px;">
                    ${Icons.search_large}
                        <p>${i18n.t('article.no_results')}</p>
                    </div>
                `;
            } else {
                ArticlesView.renderArticlesList(articles);
            }
        } catch (error) {
            console.error('Search restore error:', error);
            DOMElements.articlesList.innerHTML = `<div class="error-msg">${i18n.t('common.search_failed')}</div>`;
        }
    },

    /**
     * 高亮搜索关键词
     */
    highlightQuery(text, query) {
        if (!query || !text) return text;
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        return text.replace(regex, '<mark class="search-highlight">$1</mark>');
    }
};
