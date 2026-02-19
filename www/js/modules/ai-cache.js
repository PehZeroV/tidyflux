/**
 * AI 缓存模块 - 使用服务端 SQLite 缓存翻译和摘要结果
 * 
 * 对外 API 保持不变（getSummary / setSummary / getTranslation / setTranslation / ...）
 * 通过调用 /api/cache 服务端接口实现持久化。
 * @module ai-cache
 */

import { AuthManager } from './auth-manager.js';

const CACHE_API = '/api/cache';

/**
 * 生成缓存 key
 */
function _makeKey(entryId, type, lang = '') {
    return `${type}:${entryId}${lang ? ':' + lang : ''}`;
}

export const AICache = {
    /**
     * 初始化缓存（服务端自动管理，前端无需操作）
     */
    async init() {
        // 服务端自动管理清理，无需前端操作
    },

    /**
     * 获取缓存的摘要
     */
    async getSummary(entryId) {
        return this._get(_makeKey(entryId, 'summary'));
    },

    /**
     * 保存摘要到缓存
     */
    async setSummary(entryId, content) {
        return this._set(_makeKey(entryId, 'summary'), content);
    },

    /**
     * 获取缓存的翻译
     */
    async getTranslation(entryId, lang) {
        return this._get(_makeKey(entryId, 'translation', lang));
    },

    /**
     * 保存翻译到缓存
     */
    async setTranslation(entryId, lang, content) {
        return this._set(_makeKey(entryId, 'translation', lang), content);
    },

    /**
     * 删除缓存的摘要
     */
    async deleteSummary(entryId) {
        return this._delete(_makeKey(entryId, 'summary'));
    },

    /**
     * 删除缓存的翻译
     */
    async deleteTranslation(entryId, lang) {
        return this._delete(_makeKey(entryId, 'translation', lang));
    },

    /**
     * 批量加载标题翻译缓存
     * @returns {Promise<Map|null>}
     */
    async loadTitleCache() {
        try {
            const response = await AuthManager.fetchWithAuth(`${CACHE_API}/batch/get`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prefix: 'title:' })
            });

            if (!response.ok) return null;

            const data = await response.json();
            if (data.entries && data.entries.length > 0) {
                const map = new Map();
                for (const entry of data.entries) {
                    // 去掉 'title:' 前缀，还原为原始 key 格式 (e.g. "原标题||zh-CN")
                    const originalKey = entry.key.startsWith('title:') ? entry.key.slice(6) : entry.key;
                    map.set(originalKey, entry.content);
                }
                return map;
            }
        } catch (e) {
            console.warn('[AICache] Load title cache failed:', e);
        }
        return null;
    },

    /**
     * 增量保存标题翻译缓存（仅保存本次新增的条目）
     * @param {Array<{cacheKey: string, content: string}>} newEntries - 新翻译的条目
     */
    async saveTitleCacheBatch(newEntries) {
        if (!newEntries || newEntries.length === 0) return;
        try {
            const entries = newEntries.map(e => ({
                key: `title:${e.cacheKey}`,
                content: e.content
            }));

            await AuthManager.fetchWithAuth(`${CACHE_API}/batch/set`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries })
            });
        } catch (e) {
            console.warn('[AICache] Save title cache batch failed:', e);
        }
    },

    /**
     * 通用读取
     */
    async _get(key) {
        try {
            const response = await AuthManager.fetchWithAuth(
                `${CACHE_API}/${encodeURIComponent(key)}`
            );
            if (!response.ok) return null;
            const data = await response.json();
            return data.content ?? null;
        } catch {
            return null;
        }
    },

    /**
     * 通用写入
     */
    async _set(key, content) {
        try {
            await AuthManager.fetchWithAuth(`${CACHE_API}/${encodeURIComponent(key)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
        } catch (e) {
            console.warn('[AICache] Write failed:', e);
        }
    },

    /**
     * 删除条目
     */
    async _delete(key) {
        try {
            await AuthManager.fetchWithAuth(`${CACHE_API}/${encodeURIComponent(key)}`, {
                method: 'DELETE'
            });
        } catch {
            // ignore
        }
    },

    /**
     * 清空所有缓存
     */
    async clear() {
        try {
            await AuthManager.fetchWithAuth(CACHE_API, {
                method: 'DELETE'
            });
            console.debug('[AICache] Cache cleared');
        } catch {
            // ignore
        }
    }
};
