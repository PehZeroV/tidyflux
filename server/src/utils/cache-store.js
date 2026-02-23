/**
 * Cache Store - AI 翻译/摘要缓存 (SQLite)
 *
 * 支持：翻译缓存、摘要缓存、标题翻译批量缓存。
 */

import { getDb } from './database.js';

const MAX_ENTRIES_PER_USER = 1000000;
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 每天最多检查一次

export const CacheStore = {
    _lastCleanupTime: 0,
    /**
     * 读取缓存
     * @param {string} userId
     * @param {string} key
     * @returns {string|null}
     */
    get(userId, key) {
        const db = getDb();
        const row = db.prepare(
            'SELECT content FROM ai_cache WHERE user_id = ? AND key = ?'
        ).get(userId, key);
        return row ? row.content : null;
    },

    /**
     * 写入缓存
     * @param {string} userId
     * @param {string} key
     * @param {string} content
     */
    set(userId, key, content) {
        const db = getDb();
        db.prepare(`
            INSERT INTO ai_cache (key, user_id, content, timestamp)
            VALUES (?, ?, ?, unixepoch())
            ON CONFLICT(key) DO UPDATE SET content = excluded.content, timestamp = excluded.timestamp
        `).run(key, userId, content);
    },

    /**
     * 删除缓存
     * @param {string} userId
     * @param {string} key
     */
    delete(userId, key) {
        const db = getDb();
        db.prepare(
            'DELETE FROM ai_cache WHERE user_id = ? AND key = ?'
        ).run(userId, key);
    },

    /**
     * 批量读取（用于标题翻译缓存等批量场景）
     * @param {string} userId
     * @param {string} prefix - key 前缀
     * @param {number} [limit] - 最大返回条数（按最近更新排序）
     * @returns {Array<{key: string, content: string}>}
     */
    getByPrefix(userId, prefix, limit) {
        const db = getDb();
        if (limit && limit > 0) {
            return db.prepare(
                'SELECT key, content FROM ai_cache WHERE user_id = ? AND key LIKE ? ORDER BY timestamp DESC LIMIT ?'
            ).all(userId, prefix + '%', limit);
        }
        return db.prepare(
            'SELECT key, content FROM ai_cache WHERE user_id = ? AND key LIKE ?'
        ).all(userId, prefix + '%');
    },

    /**
     * 批量按 key 精确查询
     * @param {string} userId
     * @param {Array<string>} keys
     * @returns {Array<{key: string, content: string}>}
     */
    getMany(userId, keys) {
        if (!keys || keys.length === 0) return [];
        const db = getDb();
        const placeholders = keys.map(() => '?').join(',');
        return db.prepare(
            `SELECT key, content FROM ai_cache WHERE user_id = ? AND key IN (${placeholders})`
        ).all(userId, ...keys);
    },

    /**
     * 批量写入
     * @param {string} userId
     * @param {Array<{key: string, content: string}>} entries
     */
    setMany(userId, entries) {
        if (!entries || entries.length === 0) return;

        const db = getDb();
        const stmt = db.prepare(`
            INSERT INTO ai_cache (key, user_id, content, timestamp)
            VALUES (?, ?, ?, unixepoch())
            ON CONFLICT(key) DO UPDATE SET content = excluded.content, timestamp = excluded.timestamp
        `);

        const insertMany = db.transaction((items) => {
            for (const item of items) {
                stmt.run(item.key, userId, item.content);
            }
        });

        insertMany(entries);
        this._maybeCleanup(userId);
    },

    /**
     * 清空用户所有缓存
     * @param {string} userId
     */
    clear(userId) {
        const db = getDb();
        db.prepare('DELETE FROM ai_cache WHERE user_id = ?').run(userId);
    },

    /**
     * 按时间节流触发清理（每天最多检查一次）
     * @param {string} userId
     */
    _maybeCleanup(userId) {
        const now = Date.now();
        if (now - this._lastCleanupTime < CLEANUP_INTERVAL) return;
        this._lastCleanupTime = now;

        const db = getDb();
        const count = db.prepare(
            'SELECT COUNT(*) as cnt FROM ai_cache WHERE user_id = ?'
        ).get(userId);

        if (count.cnt <= MAX_ENTRIES_PER_USER) return;

        const excess = count.cnt - MAX_ENTRIES_PER_USER;
        db.prepare(`
            DELETE FROM ai_cache WHERE rowid IN (
                SELECT rowid FROM ai_cache
                WHERE user_id = ?
                ORDER BY timestamp ASC
                LIMIT ?
            )
        `).run(userId, excess);
    },

    /**
     * 获取缓存统计
     * @param {string} userId
     * @returns {{count: number}}
     */
    getStats(userId) {
        const db = getDb();
        const row = db.prepare(
            'SELECT COUNT(*) as cnt FROM ai_cache WHERE user_id = ?'
        ).get(userId);
        return { count: row.cnt };
    },
};
