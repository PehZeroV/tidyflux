/**
 * Digest Log Store - 定时简报执行日志存储
 *
 * 记录每次定时任务或手动触发的简报生成结果，
 * 包括成功/失败状态、文章数量、错误信息、推送结果等。
 */

import { getDb } from './database.js';

export const DigestLogStore = {
    /**
     * 添加一条执行日志
     * @param {object} log
     * @param {string} log.userId
     * @param {string} log.scope - 'all' | 'feed' | 'group'
     * @param {number} [log.scopeId]
     * @param {string} [log.scopeName]
     * @param {string} log.status - 'success' | 'failed' | 'skipped'
     * @param {number} [log.articleCount]
     * @param {string} [log.digestId]
     * @param {string} [log.error]
     * @param {string} [log.pushStatus] - 'success' | 'failed' | 'skipped' | 'disabled' | 'not_configured'
     * @param {string} [log.pushError]
     * @param {number} [log.durationMs]
     * @param {number} [log.promptTokens] - Input tokens consumed
     * @param {number} [log.completionTokens] - Output tokens consumed
     * @param {string} [log.triggeredBy] - 'scheduler' | 'manual'
     */
    add(log) {
        const db = getDb();
        const stmt = db.prepare(`
            INSERT INTO digest_logs (user_id, scope, scope_id, scope_name, status, article_count, digest_id, error, push_status, push_error, duration_ms, prompt_tokens, completion_tokens, triggered_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            log.userId,
            log.scope || 'all',
            log.scopeId || null,
            log.scopeName || null,
            log.status || 'success',
            log.articleCount || 0,
            log.digestId || null,
            log.error || null,
            log.pushStatus || null,
            log.pushError || null,
            log.durationMs || 0,
            log.promptTokens || 0,
            log.completionTokens || 0,
            log.triggeredBy || 'scheduler'
        );
    },

    /**
     * 获取用户的执行日志列表
     * @param {string} userId
     * @param {object} [options]
     * @param {number} [options.limit=50] - 返回条数
     * @param {number} [options.offset=0] - 偏移量
     * @returns {Array<object>}
     */
    getAll(userId, options = {}) {
        const db = getDb();
        const limit = options.limit || 50;
        const offset = options.offset || 0;

        const stmt = db.prepare(`
            SELECT * FROM digest_logs
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `);

        const rows = stmt.all(userId, limit, offset);

        // Also get total count
        const countStmt = db.prepare(`SELECT COUNT(*) as total FROM digest_logs WHERE user_id = ?`);
        const { total } = countStmt.get(userId);

        return { logs: rows, total };
    }
};
