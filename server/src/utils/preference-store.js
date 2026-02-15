import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { encrypt, decrypt } from './encryption.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 获取数据目录路径
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const PREFERENCES_DIR = path.join(DATA_DIR, 'preferences');

// 保证目录存在的同步辅助函数（仅在初始化或路径获取时使用）
function ensureDirSync(dir) {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

// 获取用户偏好设置文件路径
function getUserPrefsPath(userId) {
    ensureDirSync(PREFERENCES_DIR);
    return path.join(PREFERENCES_DIR, `${userId}.json`);
}

/**
 * 结构化克隆对象（替代 JSON.parse/stringify 方案以支持更复杂的数据结构且性能更佳）
 */
function structuredCloneCompat(obj) {
    if (typeof structuredClone === 'function') {
        return structuredClone(obj);
    }
    // 回退方案：对于纯 JSON 对象，JSON 方案依然是最快的
    return JSON.parse(JSON.stringify(obj));
}

export const PreferenceStore = {
    // Per-user write locks to prevent concurrent read-modify-write
    _locks: new Map(),

    async _withLock(userId, fn) {
        // Wait for any pending write to finish
        while (this._locks.get(userId)) {
            await this._locks.get(userId);
        }
        let resolve;
        const promise = new Promise(r => { resolve = r; });
        this._locks.set(userId, promise);
        try {
            return await fn();
        } finally {
            this._locks.delete(userId);
            resolve();
        }
    },

    /**
     * 异步读取用户偏好设置
     */
    async get(userId) {
        const filePath = getUserPrefsPath(userId);
        try {
            const data = await fs.readFile(filePath, 'utf8');
            const prefs = JSON.parse(data);

            // 解密 AI API Key
            if (prefs.ai_config?.encryptedApiKey) {
                const decryptedKey = decrypt(prefs.ai_config.encryptedApiKey);
                if (decryptedKey) {
                    prefs.ai_config.apiKey = decryptedKey;
                }
                delete prefs.ai_config.encryptedApiKey;
            }

            return prefs;
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(`Error loading preferences for ${userId}:`, error);
            }
        }
        return {};
    },

    /**
     * 异步保存用户偏好设置
     */
    async save(userId, prefs) {
        const filePath = getUserPrefsPath(userId);
        try {
            const prefsToSave = structuredCloneCompat(prefs);

            // 加密 AI API Key
            if (prefsToSave.ai_config?.apiKey) {
                const encrypted = encrypt(prefsToSave.ai_config.apiKey);
                if (encrypted) {
                    prefsToSave.ai_config.encryptedApiKey = encrypted;
                    delete prefsToSave.ai_config.apiKey;
                }
            }

            await fs.writeFile(filePath, JSON.stringify(prefsToSave, null, 2), 'utf8');
            return true;
        } catch (error) {
            console.error(`Error saving preferences for ${userId}:`, error);
            return false;
        }
    },

    /**
     * 原子更新：在锁内 读取 → 合并 → 保存，防止并发覆盖
     */
    async update(userId, updates) {
        return this._withLock(userId, async () => {
            const currentPrefs = await this.get(userId);

            // Special handling for ai_config: preserve API Key if masked
            if (updates.ai_config?.apiKey === '********') {
                if (currentPrefs.ai_config?.apiKey) {
                    updates.ai_config.apiKey = currentPrefs.ai_config.apiKey;
                } else {
                    delete updates.ai_config.apiKey;
                }
            }

            const newPrefs = { ...currentPrefs, ...updates };
            const success = await this.save(userId, newPrefs);
            return { success, preferences: newPrefs };
        });
    },

    /**
     * 异步获取所有用户的 ID 列表
     */
    async getAllUserIds() {
        try {
            ensureDirSync(PREFERENCES_DIR);
            const files = await fs.readdir(PREFERENCES_DIR);
            return files
                .filter(file => file.endsWith('.json'))
                .map(file => file.replace('.json', ''));
        } catch (error) {
            console.error('Error getting all user IDs:', error);
            return [];
        }
    },

    /**
     * 生成用户唯一 ID
     */
    getUserId(user) {
        if (!user) return 'default';
        const username = user.miniflux_username || user.username || 'default';
        return Buffer.from(username).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    },

    /**
     * 启动时迁移：将散落在顶层的 feed_*、group_*、all 过滤设置
     * 归入 list_filters 对象。已迁移的文件跳过。
     */
    async migrateAll() {
        const FILTER_KEY_RE = /^(feed_\d+|group_\d+|all)$/;
        try {
            const userIds = await this.getAllUserIds();
            for (const userId of userIds) {
                const prefs = await this.get(userId);
                const keysToMove = Object.keys(prefs).filter(k => FILTER_KEY_RE.test(k));
                if (keysToMove.length === 0) continue;

                // 归入 list_filters
                const filters = prefs.list_filters || {};
                for (const key of keysToMove) {
                    if (filters[key] === undefined) {
                        filters[key] = prefs[key];
                    }
                    delete prefs[key];
                }
                prefs.list_filters = filters;
                await this.save(userId, prefs);
                console.log(`[PreferenceStore] Migrated ${keysToMove.length} filter keys for user ${userId}`);
            }
        } catch (err) {
            console.error('[PreferenceStore] Migration error:', err);
        }
    }
};
