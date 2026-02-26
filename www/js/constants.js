/**
 * 应用常量定义
 */

export const API_ENDPOINTS = {
    AUTH: {
        LOGIN: '/api/auth/login',
        REGISTER: '/api/auth/register',
        CHANGE_PASSWORD: '/api/auth/change-password',
        MINIFLUX_CONFIG: '/api/auth/miniflux-config',
        MINIFLUX_STATUS: '/api/auth/miniflux-status',
        MINIFLUX_TEST: '/api/auth/miniflux-test',
    },
    FEEDS: {
        BASE: '/api/feeds',
        DISCOVER: '/api/feeds/discover',
        REFRESH: '/api/feeds/refresh',
        COUNTERS: '/api/feeds/counters',
    },
    ARTICLES: {
        BASE: '/api/articles',
        SAVE: '/api/articles/{id}/save',
    },
    GROUPS: {
        BASE: '/api/groups',
    },
    PREFERENCES: {
        BASE: '/api/preferences',
        SERVER_TIMEZONE: '/api/preferences/server-timezone',
    },
    AI: {
        CHAT: '/api/ai/chat',
        TEST: '/api/ai/test',
    },
    CHAT: {
        BASE: '/api/chat',
    },
    DIGEST: {
        LIST: '/api/digest/list',
        GENERATE: '/api/digest/generate',
        TEST_PUSH: '/api/digest/test-push',
        RUN_TASK: '/api/digest/run-task',
        LOGS: '/api/digest/logs',
    },
    FAVICON: {
        BASE: '/api/favicon',
    },
    CACHE: {
        BASE: '/api/cache',
    }
};

export const AUTH_KEYS = {
    TOKEN: 'tidyflux_token',
    USER: 'tidyflux_user',
};

export const STORAGE_KEYS = {
    LOCALE: 'app_language',
    AI_CONFIG: 'tidyflux_ai_config',
};

/**
 * 响应式断点（px），与 CSS media queries 保持一致
 */
export const BREAKPOINTS = {
    MOBILE: 800,   // CSS: @media (max-width: 800px)
    TABLET: 1024,  // CSS: @media (max-width: 1024px)
    DESKTOP: 1100, // CSS: @media (min-width: 801px) and (max-width: 1100px)
};
