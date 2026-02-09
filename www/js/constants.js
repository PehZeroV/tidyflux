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
        REFRESH: '/api/feeds/refresh',
        COUNTERS: '/api/feeds/counters',
    },
    ARTICLES: {
        BASE: '/api/articles',
    },
    GROUPS: {
        BASE: '/api/groups',
    },
    PREFERENCES: {
        BASE: '/api/preferences',
    },
    AI: {
        CHAT: '/api/ai/chat',
        TEST: '/api/ai/test',
    },
    DIGEST: {
        LIST: '/api/digest/list',
        GENERATE: '/api/digest/generate',
        PREVIEW: '/api/digest/preview',
    },
    FAVICON: {
        BASE: '/api/favicon',
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
