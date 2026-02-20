// Node 18+ has global fetch built-in
import http from 'http';
import https from 'https';

// --- 常量定义 ---
const DEFAULT_TIMEOUT = 30000;
const RETRY_DELAY_BASE = 500;
const MAX_RETRIES = 3;

// 禁用 Keep-Alive 以避免某些代理服务器下的 Premature close 错误
const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

/**
 * Miniflux API 客户端
 */
export class MinifluxClient {
    /**
     * @param {string} baseUrl - Miniflux API 根地址
     * @param {string} username - 用户名 (Basic Auth)
     * @param {string} password - 密码 (Basic Auth)
     * @param {string} apiKey - API Token (优先使用)
     * @param {Object} options - 自定义选项
     */
    constructor(baseUrl, username, password, apiKey = null, options = {}) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.username = username;
        this.password = password;
        this.apiKey = apiKey;
        this.token = null;

        // 允许注入自定义 agent 或使用默认禁用 keep-alive 的 agent
        this.httpAgent = options.httpAgent || httpAgent;
        this.httpsAgent = options.httpsAgent || httpsAgent;
    }

    /**
     * 获取认证头
     */
    getAuthHeader() {
        if (this.apiKey) {
            return {
                'X-Auth-Token': this.apiKey,
                'Content-Type': 'application/json'
            };
        }

        if (!this.token) {
            this.token = Buffer.from(`${this.username}:${this.password}`).toString('base64');
        }
        return {
            'Authorization': `Basic ${this.token}`,
            'Content-Type': 'application/json'
        };
    }

    /**
     * 执行 API 请求
     * @param {string} endpoint - 接口路径 (e.g. /me)
     * @param {Object} options - 请求选项
     * @param {number} retries - 重试次数
     */
    async request(endpoint, options = {}, retries = MAX_RETRIES) {
        const url = `${this.baseUrl}/v1${endpoint}`;
        const agent = url.startsWith('https') ? this.httpsAgent : this.httpAgent;

        const requestOptions = {
            method: options.method || 'GET',
            headers: {
                ...this.getAuthHeader(),
                ...options.headers
            },
            body: options.body,
            agent,
            timeout: options.timeout || DEFAULT_TIMEOUT
        };

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const response = await fetch(url, requestOptions);

                // 处理 204 No Content
                if (response.status === 204) {
                    return null;
                }

                const body = await response.text();

                if (response.ok) {
                    try {
                        return JSON.parse(body);
                    } catch (e) {
                        // 如果不是标准 JSON 但响应码 OK，通常不应发生，但为了兼容性返回原文本
                        return body;
                    }
                }

                // 处理非 OK 响应
                const error = new Error(`Miniflux API Error: ${response.status} ${response.statusText} - ${body}`);
                error.status = response.status;
                throw error;

            } catch (error) {

                // 认证错误不重试
                if (error.status === 401 || error.status === 403) {
                    throw error;
                }

                // 达到最大重试次数
                if (attempt === retries) {
                    console.error(`Miniflux request failed after ${retries + 1} attempts: ${endpoint}`, error.message);
                    throw error;
                }

                // 指数退避重试
                const delay = RETRY_DELAY_BASE * (attempt + 1);
                console.warn(`Miniflux request failed, retrying in ${delay}ms: ${endpoint} - ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // --- Feeds ---

    async me() { return this.request('/me'); }
    async getFeeds() { return this.request('/feeds'); }
    async getFeed(feedId) { return this.request(`/feeds/${feedId}`); }
    async getCounters() { return this.request('/feeds/counters'); }

    async createFeed(url, categoryId) {
        const body = { feed_url: url };
        if (categoryId) body.category_id = parseInt(categoryId);
        return this.request('/feeds', {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    async updateFeed(feedId, data) {
        return this.request(`/feeds/${feedId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async deleteFeed(feedId) {
        return this.request(`/feeds/${feedId}`, { method: 'DELETE' });
    }

    async refreshFeed(feedId) {
        return this.request(`/feeds/${feedId}/refresh`, { method: 'PUT' });
    }

    async refreshAllFeeds() {
        return this.request('/feeds/refresh', { method: 'PUT' });
    }

    async refreshCategory(categoryId) {
        return this.request(`/categories/${categoryId}/refresh`, { method: 'PUT' });
    }

    async getFeedIcon(feedId) {
        return this.request(`/feeds/${feedId}/icon`);
    }

    // --- Entries ---

    async getEntries(params = {}) {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
                query.append(key, value);
            }
        }
        return this.request(`/entries?${query.toString()}`);
    }

    async getEntry(entryId) { return this.request(`/entries/${entryId}`); }

    async updateEntry(entryId, data) {
        return this.request(`/entries/${entryId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async updateEntriesStatus(entryIds, status) {
        return this.request('/entries', {
            method: 'PUT',
            body: JSON.stringify({
                entry_ids: Array.isArray(entryIds) ? entryIds : [entryIds],
                status: status
            })
        });
    }

    async toggleBookmark(entryId) {
        return this.request(`/entries/${entryId}/bookmark`, { method: 'PUT' });
    }

    async fetchEntryContent(entryId) {
        return this.request(`/entries/${entryId}/fetch-content?update_content=false`, { method: 'GET' });
    }

    async saveEntry(entryId) {
        return this.request(`/entries/${entryId}/save`, { method: 'POST' });
    }

    // --- Integrations ---

    async getIntegrationsStatus() {
        return this.request('/integrations/status');
    }

    // --- Categories ---

    async getCategories() { return this.request('/categories'); }

    async createCategory(title) {
        return this.request('/categories', {
            method: 'POST',
            body: JSON.stringify({ title })
        });
    }

    async updateCategory(categoryId, title) {
        return this.request(`/categories/${categoryId}`, {
            method: 'PUT',
            body: JSON.stringify({ title })
        });
    }

    async deleteCategory(categoryId) {
        return this.request(`/categories/${categoryId}`, { method: 'DELETE' });
    }

    // --- Mark All As Read ---

    async markFeedAsRead(feedId) {
        return this.request(`/feeds/${feedId}/mark-all-as-read`, { method: 'PUT' });
    }

    async markCategoryAsRead(categoryId) {
        return this.request(`/categories/${categoryId}/mark-all-as-read`, { method: 'PUT' });
    }

    async markUserAsRead(userId) {
        return this.request(`/users/${userId}/mark-all-as-read`, { method: 'PUT' });
    }

    // --- Discover ---

    async discover(url) {
        return this.request('/discover', {
            method: 'POST',
            body: JSON.stringify({ url })
        });
    }

    // --- OPML ---

    async importOPML(xmlData) {
        const authHeader = this.getAuthHeader();
        return this.request('/import', {
            method: 'POST',
            headers: {
                ...authHeader,
                'Content-Type': 'application/xml'
            },
            body: xmlData
        });
    }

    async exportOPML() {
        const authHeader = this.getAuthHeader();
        const url = `${this.baseUrl}/v1/export`;

        const response = await fetch(url, {
            method: 'GET',
            headers: authHeader
        });

        if (!response.ok) {
            throw new Error(`Miniflux API Export Error: ${response.status}`);
        }

        return response.text();
    }
}
