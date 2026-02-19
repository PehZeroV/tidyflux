/**
 * Database - 统一 SQLite 数据库模块
 * 
 * 使用 better-sqlite3 (同步 API)，所有表集中在一个 tidyflux.db 文件中。
 * 表：
 *  - digests       简报存储
 *  - ai_cache      翻译 / 摘要 / 标题翻译缓存
 */

import Database from 'better-sqlite3';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'tidyflux.db');

let _db = null;

/**
 * 获取数据库单例
 * @returns {Database}
 */
export function getDb() {
    if (_db) return _db;

    // 确保 data 目录存在
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }

    _db = new Database(DB_PATH);

    // 性能优化
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('foreign_keys = ON');

    _initTables(_db);

    return _db;
}

/**
 * 初始化所有表
 */
function _initTables(db) {
    db.exec(`
        -- ==================== 简报表 ====================
        CREATE TABLE IF NOT EXISTS digests (
            id            TEXT    PRIMARY KEY,
            user_id       TEXT    NOT NULL,
            type          TEXT    NOT NULL DEFAULT 'digest',
            scope         TEXT    NOT NULL DEFAULT 'all',
            scope_id      INTEGER,
            scope_name    TEXT,
            title         TEXT    NOT NULL,
            content       TEXT,
            article_count INTEGER DEFAULT 0,
            hours         INTEGER DEFAULT 12,
            generated_at  TEXT    NOT NULL,
            is_read       INTEGER DEFAULT 0,
            article_refs  TEXT,
            created_at    TEXT    DEFAULT (datetime('now'))
        );

        -- 按用户 + 时间倒序查询的复合索引
        CREATE INDEX IF NOT EXISTS idx_digests_user_time
            ON digests (user_id, generated_at DESC);

        -- 按用户 + scope 过滤的索引
        CREATE INDEX IF NOT EXISTS idx_digests_user_scope
            ON digests (user_id, scope, scope_id);

        -- ==================== AI 缓存表 ====================
        CREATE TABLE IF NOT EXISTS ai_cache (
            key       TEXT    PRIMARY KEY,
            user_id   TEXT    NOT NULL,
            content   TEXT,
            timestamp INTEGER NOT NULL DEFAULT (unixepoch())
        );

        -- 按用户查询和清理的索引
        CREATE INDEX IF NOT EXISTS idx_ai_cache_user
            ON ai_cache (user_id, timestamp);
    `);
}

/**
 * 关闭数据库连接（优雅退出时调用）
 */
export function closeDb() {
    if (_db) {
        _db.close();
        _db = null;
    }
}
