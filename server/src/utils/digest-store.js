/**
 * Digest Store - 简报持久化存储 (SQLite 版本)
 *
 * 对外 API 保持不变，内部从 JSON 文件迁移至 SQLite。
 * 首次启动时会自动将旧 JSON 数据导入 SQLite。
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './database.js';
import { t } from './i18n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const DIGEST_DIR = path.join(DATA_DIR, 'digests');

// 生成简报 ID
function generateDigestId(timestamp = Date.now()) {
    return `digest_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
}

export const DigestStore = {
    /**
     * 启动时调用：将旧 JSON 文件迁移至 SQLite
     */
    async migrateFromJson() {
        if (!existsSync(DIGEST_DIR)) return;

        const db = getDb();

        // 如果 digests 表已经有数据，跳过迁移
        const count = db.prepare('SELECT COUNT(*) as cnt FROM digests').get();
        if (count.cnt > 0) return;

        try {
            const files = await fs.readdir(DIGEST_DIR);
            const jsonFiles = files.filter(f => f.endsWith('.json'));

            if (jsonFiles.length === 0) return;

            console.log(`[DigestStore] Migrating ${jsonFiles.length} JSON files to SQLite...`);

            const insertStmt = db.prepare(`
                INSERT OR IGNORE INTO digests
                    (id, user_id, type, scope, scope_id, scope_name, title, content,
                     article_count, hours, generated_at, is_read, article_refs)
                VALUES
                    (@id, @user_id, @type, @scope, @scope_id, @scope_name, @title, @content,
                     @article_count, @hours, @generated_at, @is_read, @article_refs)
            `);

            const insertMany = db.transaction((rows) => {
                for (const row of rows) {
                    insertStmt.run(row);
                }
            });

            let totalMigrated = 0;

            for (const file of jsonFiles) {
                // 文件名格式：{userId}_{YYYY-MM-DD}.json
                const match = file.match(/^(.+)_(\d{4}-\d{2}-\d{2})\.json$/);
                if (!match) continue;

                const userId = match[1];

                try {
                    const filePath = path.join(DIGEST_DIR, file);
                    const data = await fs.readFile(filePath, 'utf8');
                    const digests = JSON.parse(data);

                    if (!Array.isArray(digests) || digests.length === 0) continue;

                    const rows = digests.map(d => ({
                        id: d.id,
                        user_id: userId,
                        type: d.type || 'digest',
                        scope: d.scope || 'all',
                        scope_id: d.scopeId ?? null,
                        scope_name: d.scopeName || null,
                        title: d.title || '',
                        content: d.content || '',
                        article_count: d.articleCount || 0,
                        hours: d.hours || 12,
                        generated_at: d.generatedAt || new Date().toISOString(),
                        is_read: d.isRead ? 1 : 0,
                        article_refs: d.articleRefs ? JSON.stringify(d.articleRefs) : null,
                    }));

                    insertMany(rows);
                    totalMigrated += rows.length;
                } catch (e) {
                    console.error(`[DigestStore] Error migrating ${file}:`, e);
                }
            }

            console.log(`[DigestStore] Migration complete: ${totalMigrated} digests imported.`);

            // 迁移完成后重命名整个目录，保留备份但不再读取
            const backupDir = DIGEST_DIR + '_backup';
            if (!existsSync(backupDir)) {
                await fs.rename(DIGEST_DIR, backupDir);
                console.log(`[DigestStore] Old JSON dir renamed to digests_backup/`);
            }
        } catch (e) {
            console.error('[DigestStore] Migration error:', e);
        }
    },

    /**
     * 加载简报列表
     */
    getAll(userId, options = {}) {
        const { scope, scopeId, unreadOnly = false, limit = 100, before = null } = options;
        const db = getDb();

        const conditions = ['user_id = ?'];
        const params = [userId];

        if (scope && scopeId) {
            conditions.push('scope = ?');
            conditions.push('scope_id = ?');
            params.push(scope, scopeId);
        } else if (scope === 'all') {
            conditions.push('scope = ?');
            params.push('all');
        }

        if (unreadOnly) {
            conditions.push('is_read = 0');
        }

        if (before) {
            const beforeDate = new Date(before);
            if (!isNaN(beforeDate.getTime())) {
                conditions.push('generated_at < ?');
                params.push(beforeDate.toISOString());
            }
        }

        const where = conditions.join(' AND ');
        params.push(limit);

        const rows = db.prepare(`
            SELECT * FROM digests
            WHERE ${where}
            ORDER BY generated_at DESC
            LIMIT ?
        `).all(...params);

        return rows.map(_rowToDigest);
    },

    /**
     * 获取单个简报
     */
    get(userId, digestId) {
        const db = getDb();
        const row = db.prepare(
            'SELECT * FROM digests WHERE user_id = ? AND id = ?'
        ).get(userId, digestId);

        return row ? _rowToDigest(row) : null;
    },

    /**
     * 添加简报
     */
    add(userId, digestData) {
        const db = getDb();
        const now = new Date(digestData.generatedAt || Date.now());
        const timestamp = now.getTime();

        const pad = (n) => String(n).padStart(2, '0');
        const timeStr = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}:${pad(now.getMinutes())}`;

        const digest = {
            id: generateDigestId(timestamp),
            user_id: userId,
            type: 'digest',
            scope: digestData.scope || 'all',
            scope_id: digestData.scopeId ?? null,
            scope_name: digestData.scopeName || t('all_subscriptions'),
            title: digestData.title || `${digestData.scopeName || t('all')} · ${t('digest_word')} ${timeStr}`,
            content: digestData.content || '',
            article_count: digestData.articleCount || 0,
            hours: digestData.hours || 12,
            generated_at: digestData.generatedAt || now.toISOString(),
            is_read: 0,
            article_refs: digestData.articleRefs ? JSON.stringify(digestData.articleRefs) : null,
        };

        db.prepare(`
            INSERT INTO digests
                (id, user_id, type, scope, scope_id, scope_name, title, content,
                 article_count, hours, generated_at, is_read, article_refs)
            VALUES
                (@id, @user_id, @type, @scope, @scope_id, @scope_name, @title, @content,
                 @article_count, @hours, @generated_at, @is_read, @article_refs)
        `).run(digest);

        // 返回与旧格式一致的对象
        return {
            id: digest.id,
            type: digest.type,
            scope: digest.scope,
            scopeId: digest.scope_id,
            scopeName: digest.scope_name,
            title: digest.title,
            content: digest.content,
            articleCount: digest.article_count,
            hours: digest.hours,
            generatedAt: digest.generated_at,
            isRead: false,
            articleRefs: digestData.articleRefs || null,
        };
    },

    /**
     * 标记已读
     */
    markAsRead(userId, digestId) {
        const db = getDb();
        const result = db.prepare(
            'UPDATE digests SET is_read = 1 WHERE user_id = ? AND id = ?'
        ).run(userId, digestId);
        return result.changes > 0;
    },

    /**
     * 标记未读
     */
    markAsUnread(userId, digestId) {
        const db = getDb();
        const result = db.prepare(
            'UPDATE digests SET is_read = 0 WHERE user_id = ? AND id = ?'
        ).run(userId, digestId);
        return result.changes > 0;
    },

    /**
     * 删除简报
     */
    delete(userId, digestId) {
        const db = getDb();
        const result = db.prepare(
            'DELETE FROM digests WHERE user_id = ? AND id = ?'
        ).run(userId, digestId);
        return result.changes > 0;
    },

    /**
     * 获取用于文章列表的简报（列表模式：不返回 content 和 articleRefs）
     */
    getForArticleList(userId, options = {}) {
        const limit = options.limit || 100;
        const db = getDb();

        const conditions = ['user_id = ?'];
        const params = [userId];

        if (options.scope && options.scopeId) {
            conditions.push('scope = ?');
            conditions.push('scope_id = ?');
            params.push(options.scope, options.scopeId);
        } else if (options.scope === 'all') {
            conditions.push('scope = ?');
            params.push('all');
        }

        if (options.unreadOnly) {
            conditions.push('is_read = 0');
        }

        if (options.before) {
            const beforeDate = new Date(options.before);
            if (!isNaN(beforeDate.getTime())) {
                conditions.push('generated_at < ?');
                params.push(beforeDate.toISOString());
            }
        }

        const where = conditions.join(' AND ');
        params.push(limit);

        // 列表模式：不查询 content 和 article_refs，减少传输和内存
        const rows = db.prepare(`
            SELECT id, user_id, type, scope, scope_id, scope_name, title,
                   article_count, hours, generated_at, is_read
            FROM digests
            WHERE ${where}
            ORDER BY generated_at DESC
            LIMIT ?
        `).all(...params);

        const now = new Date();
        const todayAtMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        const pinned = [];
        const normal = [];

        for (const row of rows) {
            const isToday = new Date(row.generated_at).getTime() >= todayAtMidnight;
            const shouldPin = isToday && !options.before && !row.is_read;

            const articleFormat = {
                id: row.id,
                type: 'digest',
                feed_id: null,
                title: row.title,
                published_at: row.generated_at,
                is_read: row.is_read ? 1 : 0,
                is_favorited: 0,
                thumbnail_url: null,
                feed_title: row.scope_name,
                author: 'AI',
                url: null,
                digest_scope: row.scope,
                digest_scope_id: row.scope_id,
                article_count: row.article_count,
            };

            if (shouldPin) {
                pinned.push(articleFormat);
            } else {
                normal.push(articleFormat);
            }
        }

        return { pinned, normal };
    },
};

/**
 * 将数据库行转换为旧格式对象（向后兼容）
 */
function _rowToDigest(row) {
    return {
        id: row.id,
        type: row.type,
        scope: row.scope,
        scopeId: row.scope_id,
        scopeName: row.scope_name,
        title: row.title,
        content: row.content,
        articleCount: row.article_count,
        hours: row.hours,
        generatedAt: row.generated_at,
        isRead: !!row.is_read,
        articleRefs: row.article_refs ? JSON.parse(row.article_refs) : null,
    };
}
