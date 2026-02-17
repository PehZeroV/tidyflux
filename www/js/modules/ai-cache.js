/**
 * AI 缓存模块 - 使用 IndexedDB 缓存翻译和摘要结果
 * @module ai-cache
 */

const DB_NAME = 'tidyflux_ai_cache';
const DB_VERSION = 1;
const STORE_NAME = 'ai_results';

// 最大缓存条目数
const MAX_ENTRIES = 5000;

let _db = null;

/**
 * 打开/获取数据库连接
 * @returns {Promise<IDBDatabase>}
 */
function _getDB() {
    if (_db) return Promise.resolve(_db);

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };

        request.onsuccess = (e) => {
            _db = e.target.result;
            // 连接断开时置空
            _db.onclose = () => { _db = null; };
            resolve(_db);
        };

        request.onerror = (e) => {
            console.warn('[AICache] Failed to open IndexedDB:', e.target.error);
            reject(e.target.error);
        };
    });
}

/**
 * 生成缓存 key
 * @param {number|string} entryId - 文章 ID
 * @param {'summary'|'translation'} type - 缓存类型
 * @param {string} [lang] - 目标语言（翻译用）
 * @returns {string}
 */
function _makeKey(entryId, type, lang = '') {
    return `${type}:${entryId}${lang ? ':' + lang : ''}`;
}

export const AICache = {
    /**
     * 初始化缓存（清理超量条目）
     */
    async init() {
        try {
            await this._cleanup();
        } catch (e) {
            console.warn('[AICache] Init cleanup failed:', e);
        }
    },

    /**
     * 获取缓存的摘要
     * @param {number|string} entryId
     * @returns {Promise<string|null>}
     */
    async getSummary(entryId) {
        return this._get(_makeKey(entryId, 'summary'));
    },

    /**
     * 保存摘要到缓存
     * @param {number|string} entryId
     * @param {string} content
     */
    async setSummary(entryId, content) {
        return this._set(_makeKey(entryId, 'summary'), content);
    },

    /**
     * 获取缓存的翻译
     * @param {number|string} entryId
     * @param {string} lang - 目标语言
     * @returns {Promise<string|null>} 翻译后的段落数组 JSON，或 null
     */
    async getTranslation(entryId, lang) {
        return this._get(_makeKey(entryId, 'translation', lang));
    },

    /**
     * 保存翻译到缓存
     * @param {number|string} entryId
     * @param {string} lang
     * @param {string} content - 翻译结果（JSON 序列化的段落数组）
     */
    async setTranslation(entryId, lang, content) {
        return this._set(_makeKey(entryId, 'translation', lang), content);
    },

    /**
     * 删除缓存的摘要
     * @param {number|string} entryId
     */
    async deleteSummary(entryId) {
        return this._delete(_makeKey(entryId, 'summary'));
    },

    /**
     * 删除缓存的翻译
     * @param {number|string} entryId
     * @param {string} lang - 目标语言
     */
    async deleteTranslation(entryId, lang) {
        return this._delete(_makeKey(entryId, 'translation', lang));
    },

    /**
     * 批量加载标题翻译缓存（启动时一次性读取）
     * @returns {Promise<Map|null>} 标题翻译 Map，或 null
     */
    async loadTitleCache() {
        try {
            const raw = await this._get('title_cache_bulk');
            if (raw) {
                const entries = JSON.parse(raw);
                return new Map(entries);
            }
        } catch { /* ignore */ }
        return null;
    },

    /**
     * 批量保存标题翻译缓存
     * @param {Map} titleMap - 标题翻译 Map
     * @param {number} maxEntries - 最大条目数
     */
    async saveTitleCache(titleMap, maxEntries = 5000) {
        try {
            // 淘汰最旧的条目
            if (titleMap.size > maxEntries) {
                const excess = titleMap.size - maxEntries;
                const iter = titleMap.keys();
                for (let i = 0; i < excess; i++) {
                    titleMap.delete(iter.next().value);
                }
            }
            const entries = Array.from(titleMap.entries());
            await this._set('title_cache_bulk', JSON.stringify(entries));
        } catch (e) {
            console.warn('[AICache] Save title cache failed:', e);
        }
    },

    /**
     * 通用读取
     * @param {string} key
     * @returns {Promise<string|null>}
     */
    async _get(key) {
        try {
            const db = await _getDB();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const request = store.get(key);

                request.onsuccess = () => {
                    const record = request.result;
                    if (!record) {
                        resolve(null);
                        return;
                    }
                    resolve(record.content);
                };

                request.onerror = () => resolve(null);
            });
        } catch {
            return null;
        }
    },

    /**
     * 通用写入
     * @param {string} key
     * @param {string} content
     */
    async _set(key, content) {
        try {
            const db = await _getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                store.put({
                    key,
                    content,
                    timestamp: Date.now()
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.warn('[AICache] Write failed:', e);
        }
    },

    /**
     * 删除条目
     * @param {string} key
     */
    async _delete(key) {
        try {
            const db = await _getDB();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).delete(key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        } catch {
            // ignore
        }
    },

    /**
     * 控制总量，淘汰最旧的条目
     */
    async _cleanup() {
        try {
            const db = await _getDB();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const countReq = store.count();

            countReq.onsuccess = () => {
                const total = countReq.result;
                if (total <= MAX_ENTRIES) return;

                const excess = total - MAX_ENTRIES;
                const oldIndex = store.index('timestamp');
                const cursor = oldIndex.openCursor();
                let removed = 0;

                cursor.onsuccess = (e) => {
                    const c = e.target.result;
                    if (c && removed < excess) {
                        c.delete();
                        removed++;
                        c.continue();
                    }
                };
            };

            await new Promise((resolve) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        } catch (e) {
            console.warn('[AICache] Cleanup failed:', e);
        }
    },

    /**
     * 清空所有缓存（供设置页使用）
     */
    async clear() {
        try {
            const db = await _getDB();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).clear();
                tx.oncomplete = () => {
                    console.debug('[AICache] Cache cleared');
                    resolve();
                };
                tx.onerror = () => resolve();
            });
        } catch {
            // ignore
        }
    }
};
