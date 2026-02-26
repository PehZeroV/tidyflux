/**
 * Chat Store - AI 聊天记录持久化 (SQLite)
 *
 * 每篇文章对应一个聊天会话，按 user_id + article_id 关联。
 * 消息存储为 JSON 数组字符串。
 */

import { getDb } from './database.js';

export const ChatStore = {
    /**
     * 获取某篇文章的聊天记录
     * @param {string} userId
     * @param {string} articleId
     * @returns {{messages: Array, title: string, updated_at: string}|null}
     */
    get(userId, articleId) {
        const db = getDb();
        const row = db.prepare(
            'SELECT messages, title, updated_at FROM ai_chats WHERE user_id = ? AND article_id = ?'
        ).get(userId, String(articleId));

        if (!row) return null;

        try {
            return {
                messages: JSON.parse(row.messages),
                title: row.title,
                updated_at: row.updated_at
            };
        } catch (e) {
            console.error('[ChatStore] Failed to parse messages:', e);
            return null;
        }
    },

    /**
     * 保存/更新聊天记录
     * @param {string} userId
     * @param {string} articleId
     * @param {Array} messages - 消息数组 [{role, content}, ...]
     * @param {string} [title] - 文章标题（便于列表展示）
     */
    save(userId, articleId, messages, title = null) {
        const db = getDb();
        const messagesJson = JSON.stringify(messages);

        db.prepare(`
            INSERT INTO ai_chats (user_id, article_id, messages, title, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(user_id, article_id) DO UPDATE SET
                messages = excluded.messages,
                title = COALESCE(excluded.title, ai_chats.title),
                updated_at = datetime('now')
        `).run(userId, String(articleId), messagesJson, title);
    },

    /**
     * 删除某篇文章的聊天记录
     * @param {string} userId
     * @param {string} articleId
     */
    delete(userId, articleId) {
        const db = getDb();
        db.prepare(
            'DELETE FROM ai_chats WHERE user_id = ? AND article_id = ?'
        ).run(userId, String(articleId));
    },

    /**
     * 获取用户的聊天记录列表（最近 N 条）
     * @param {string} userId
     * @param {number} [limit=50]
     * @returns {Array<{article_id: string, title: string, updated_at: string, message_count: number}>}
     */
    list(userId, limit = 50) {
        const db = getDb();
        const rows = db.prepare(`
            SELECT article_id, title, updated_at, messages
            FROM ai_chats
            WHERE user_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
        `).all(userId, limit);

        return rows.map(row => {
            let messageCount = 0;
            try {
                messageCount = JSON.parse(row.messages).length;
            } catch (e) { /* ignore */ }
            return {
                article_id: row.article_id,
                title: row.title,
                updated_at: row.updated_at,
                message_count: messageCount
            };
        });
    },

    /**
     * 清空用户所有聊天记录
     * @param {string} userId
     */
    clear(userId) {
        const db = getDb();
        db.prepare('DELETE FROM ai_chats WHERE user_id = ?').run(userId);
    },
};
