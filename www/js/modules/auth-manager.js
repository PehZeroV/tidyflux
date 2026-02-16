import { i18n } from './i18n.js';
import { API_ENDPOINTS, AUTH_KEYS } from '../constants.js';

export const AuthManager = {
    getToken() {
        return localStorage.getItem(AUTH_KEYS.TOKEN);
    },

    getUser() {
        const user = localStorage.getItem(AUTH_KEYS.USER);
        return user ? JSON.parse(user) : null;
    },

    isLoggedIn() {
        return !!this.getToken();
    },

    setAuth(token, user) {
        localStorage.setItem(AUTH_KEYS.TOKEN, token);
        localStorage.setItem(AUTH_KEYS.USER, JSON.stringify(user));
    },

    clearAuth() {
        localStorage.removeItem(AUTH_KEYS.TOKEN);
        localStorage.removeItem(AUTH_KEYS.USER);
    },

    async register(email, password) {
        const response = await fetch(API_ENDPOINTS.AUTH.REGISTER, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept-Language': i18n.locale || 'zh' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || i18n.t('auth.register_failed'));
        }

        this.setAuth(data.token, data.user);
        return data.user;
    },

    async login(username, password) {
        // Send credentials to backend
        const response = await fetch(API_ENDPOINTS.AUTH.LOGIN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept-Language': i18n.locale || 'zh' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || i18n.t('auth.login_failed'));
        }

        this.setAuth(data.token, data.user);
        return data.user;
    },

    async fetchWithAuth(url, options = {}) {
        const token = this.getToken();
        const headers = {
            ...options.headers,
            'Authorization': token ? `Bearer ${token}` : '',
            'Accept-Language': i18n.locale || 'zh'
        };

        const response = await fetch(url, { ...options, headers });

        if (response.status === 401 || response.status === 403) {
            console.warn('Session expired or forbidden. Logging out...');
            this.clearAuth();
            window.location.reload();
            // Create a never-resolving promise to halt further execution while reloading
            return new Promise(() => { });
        }

        return response;
    },

    async changePassword(newPassword) {
        const response = await this.fetchWithAuth(API_ENDPOINTS.AUTH.CHANGE_PASSWORD, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ newPassword })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || i18n.t('auth.password_change_failed'));
        }
        return true;
    },

    async getMinifluxConfig() {
        const response = await this.fetchWithAuth(API_ENDPOINTS.AUTH.MINIFLUX_CONFIG);

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || i18n.t('auth.config_fetch_failed'));
        }
        return data;
    },

    async getMinifluxStatus() {
        // Status check should be resilient, but if 401 occurs, fetchWithAuth handles it.
        const response = await this.fetchWithAuth(API_ENDPOINTS.AUTH.MINIFLUX_STATUS);

        const data = await response.json();
        if (!response.ok) {
            // silent fail or return structure
            return { connected: false, error: data.error };
        }
        return data;
    },

    async saveMinifluxConfig(url, username, password, apiKey, authType) {
        const response = await this.fetchWithAuth(API_ENDPOINTS.AUTH.MINIFLUX_CONFIG, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url, username, password, apiKey, authType })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || i18n.t('auth.config_save_failed'));
        }
        return data;
    },

    async testMinifluxConnection(url, username, password, apiKey, authType) {
        const response = await this.fetchWithAuth(API_ENDPOINTS.AUTH.MINIFLUX_TEST, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url, username, password, apiKey, authType })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || i18n.t('auth.connection_test_failed'));
        }
        return data;
    },

    logout() {
        this.clearAuth();
        window.location.reload();
    }
};
