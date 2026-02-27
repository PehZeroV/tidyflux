/**
 * Cache Store - AI 翻译/摘要缓存 (SQLite)
 *
 * 支持：翻译缓存、摘要缓存、标题翻译批量缓存。
 */

import { getDb } from './database.js';

const MAX_ENTRIES_PER_USER = 1000000;
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 小时

export const CacheStore = {
    _cleanupTimer: null,

    /**
     * 启动 24 小时定时清理（进程启动时调用一次）
     */
    startCleanupTimer() {
        if (this._cleanupTimer) return;
        // 启动后延迟 1 分钟执行首次清理，之后每 24 小时一次
        const initTimer = setTimeout(() => this._cleanupAll(), 60 * 1000);
        if (initTimer.unref) initTimer.unref();
        this._cleanupTimer = setInterval(() => this._cleanupAll(), CLEANUP_INTERVAL);
        // 允许进程正常退出
        if (this._cleanupTimer.unref) this._cleanupTimer.unref();
    },

    /**
     * 清理所有用户的超量缓存
     */
    _cleanupAll() {
        try {
            const db = getDb();
            const users = db.prepare(
                'SELECT DISTINCT user_id FROM ai_cache'
            ).all();

            for (const { user_id } of users) {
                const count = db.prepare(
                    'SELECT COUNT(*) as cnt FROM ai_cache WHERE user_id = ?'
                ).get(user_id);

                if (count.cnt > MAX_ENTRIES_PER_USER) {
                    const excess = count.cnt - MAX_ENTRIES_PER_USER;
                    db.prepare(`
                        DELETE FROM ai_cache WHERE rowid IN (
                            SELECT rowid FROM ai_cache
                            WHERE user_id = ?
                            ORDER BY timestamp ASC
                            LIMIT ?
                        )
                    `).run(user_id, excess);
                    console.log(`[CacheStore] Cleaned ${excess} expired entries for user ${user_id}`);
                }
            }
        } catch (err) {
            console.error('[CacheStore] Cleanup error:', err.message);
        }
    },

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
