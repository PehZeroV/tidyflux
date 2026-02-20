/**
 * 应用状态管理模块 - Tidyflux
 * @module state
 */

/**
 * 应用全局状态对象
 * 采用模块化组织，各部分状态职责明确
 */
const state = {
    // 用户与鉴权状态
    user: {
        isLoggedIn: false,
        preferences: {},
    },
    // 导航与结构状态
    navigation: {
        feeds: [],
        groups: [],
        currentFeedId: null,
        currentGroupId: null,
        viewingFavorites: false,
        viewingDigests: false,
        viewingToday: false,
        viewingHistory: false,
    },
    // 内容与分页状态
    content: {
        articles: [],
        pagination: {
            page: 1,
            limit: 50,
            total: 0,
            totalPages: 1
        },
        currentArticleId: null,
    },
    // 过滤与排序设置
    filter: {
        showUnreadOnly: true,
    },
    // UI 临时状态
    ui: {
        lastListViewScrollTop: null,
    },
    // 搜索状态
    search: {
        isSearchMode: false,
        searchQuery: '',
    },
};

/**
 * 兼容旧代码的 Proxy 访问器
 * 将旧的扁平化访问请求转发到正确的模块路径
 */
const legacyMap = {
    isLoggedIn: ['user', 'isLoggedIn'],
    feeds: ['navigation', 'feeds'],
    groups: ['navigation', 'groups'],
    currentFeedId: ['navigation', 'currentFeedId'],
    currentGroupId: ['navigation', 'currentGroupId'],
    viewingFavorites: ['navigation', 'viewingFavorites'],
    viewingDigests: ['navigation', 'viewingDigests'],
    viewingToday: ['navigation', 'viewingToday'],
    viewingHistory: ['navigation', 'viewingHistory'],
    articles: ['content', 'articles'],
    pagination: ['content', 'pagination'],
    currentArticleId: ['content', 'currentArticleId'],
    showUnreadOnly: ['filter', 'showUnreadOnly'],
    isSearchMode: ['search', 'isSearchMode'],
    searchQuery: ['search', 'searchQuery'],
    preferences: ['user', 'preferences'],
    lastListViewScrollTop: ['ui', 'lastListViewScrollTop']
};

export const AppState = state;

// 初始化兼容性层
Object.keys(legacyMap).forEach(key => {
    const [module, property] = legacyMap[key];
    Object.defineProperty(AppState, key, {
        get: () => state[module][property],
        set: (v) => state[module][property] = v,
        enumerable: true,
        configurable: true
    });
});

