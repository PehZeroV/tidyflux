/**
 * 客户端路由模块 - Tidyflux
 * @module router
 */

import { ViewManager } from './view-manager.js';
import { AuthManager } from './auth-manager.js';
import { SearchView } from './view/search-view.js';

export const Router = {
    init() {
        // 监听 hash 变化
        window.addEventListener('hashchange', () => this.handleHashChange());
    },

    handleInitialHash() {
        // 延时一点确保 AuthManager 已初始化 (如果需要)
        setTimeout(() => {
            if (!AuthManager.isLoggedIn()) {
                // Auth view is handled by main.js calling ViewManager.showAuthView
                return;
            }

            // 如果没有 hash，且是移动端，默认跳转到文章列表
            // Desktop 默认显示 all
            // 如果没有 hash，默认跳转到 #/all
            if (!window.location.hash) {
                window.location.hash = '#/all';
                return;
            }

            this.handleHashChange();
        }, 100);
    },

    handleHashChange() {
        if (!AuthManager.isLoggedIn()) return;

        const hash = window.location.hash;

        // 1. 文章详情 #/article/:id?feed=X&group=X&favorites=1&unread=1
        //    ID 可以是数字（普通文章）或 digest_xxx（简报）
        const articleMatch = hash.match(/^#\/article\/([a-zA-Z0-9_]+)(\?.*)?$/);
        if (articleMatch) {
            const id = articleMatch[1];
            const queryString = articleMatch[2] || '';

            // 解析查询参数
            const params = new URLSearchParams(queryString.replace('?', ''));
            const context = {
                feedId: params.get('feed') || null,
                groupId: params.get('group') || null,
                favorites: params.get('favorites') === '1',
                unread: params.get('unread') === '1'
            };

            ViewManager._renderArticle(id, context);
            return;
        }

        // 2. 订阅源详情 #/feed/:id
        const feedMatch = hash.match(/^#\/feed\/(\d+)/);
        if (feedMatch) {
            const id = feedMatch[1];
            ViewManager._renderFeed(id);
            return;
        }

        // 3. 分组详情 #/group/:id
        const groupMatch = hash.match(/^#\/group\/(\d+)/);
        if (groupMatch) {
            const id = groupMatch[1];
            ViewManager._renderGroup(id);
            return;
        }

        // 4. 收藏 #/favorites
        if (hash === '#/favorites') {
            ViewManager._renderFavorites();
            return;
        }

        // 4.5. 今天 #/today
        if (hash === '#/today') {
            ViewManager._renderToday();
            return;
        }

        // 4.6. 历史记录 #/history
        if (hash === '#/history') {
            ViewManager._renderHistory();
            return;
        }

        // 5. 搜索 #/search?q=xxx
        const searchMatch = hash.match(/^#\/search\?q=(.+)$/);
        if (searchMatch) {
            const query = decodeURIComponent(searchMatch[1]);
            // 在移动端显示文章面板
            if (window.innerWidth <= 1100) {
                ViewManager.showPanel('articles');
            }
            SearchView.restoreSearch(query);
            return;
        }

        // 6. 全部文章 #/all
        if (hash === '#/all') {
            ViewManager._renderFeed(null);
            return;
        }

        // 7. 订阅源列表 #/feeds
        if (hash === '#/feeds') {
            if (window.innerWidth <= 1100) {
                ViewManager.showPanel('feeds');
            } else {
                // Desktop: ignore or show all
                ViewManager._renderFeed(null);
            }
            return;
        }

        if (hash === '#/feed-refresh') {
            // Handle if any other special routes exist
        }

        // 9. 简报 #/digests
        if (hash === '#/digests') {
            ViewManager._renderDigests();
            return;
        }

        // 8. 根路径 (无hash 或 #/)
        if (!hash || hash === '#/') {
            // Default to all
            ViewManager._renderFeed(null);
            if (window.innerWidth <= 1100) {

                ViewManager.showPanel('articles');
            }
        }
    }
};

// 启动路由
Router.init();

// Export for compatibility
export function handleRouteChange() {
    Router.handleHashChange();
}

export function navigateBackToList() {
    // try standard back
    history.back();
}
