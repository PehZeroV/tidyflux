/**
 * Digest Store - 简报持久化存储
 */

import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { t } from './i18n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DIGEST_DIR = path.join(DATA_DIR, 'digests');

// 确保目录存在的同步辅助函数
function ensureDirSync() {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!existsSync(DIGEST_DIR)) {
        mkdirSync(DIGEST_DIR, { recursive: true });
    }
}

// 获取日期字符串 (YYYY-MM-DD)
function getDateStr(date) {
    if (typeof date === 'string' || typeof date === 'number') date = new Date(date);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 从简报 ID 中提取日期字符串
function getDateStrFromId(id) {
    try {
        const parts = id.split('_');
        if (parts.length >= 2) {
            const timestamp = parseInt(parts[1]);
            if (!isNaN(timestamp)) {
                return getDateStr(timestamp);
            }
        }
    } catch (e) {
        console.error('Parse date from ID error:', e);
    }
    return null;
}

// 获取用户简报文件路径 (按日期)
function getUserDigestFile(userId, dateStr) {
    ensureDirSync();
    return path.join(DIGEST_DIR, `${userId}_${dateStr}.json`);
}

// 异步加载指定日期的简报
async function loadDigestsForDate(userId, dateStr) {
    const file = getUserDigestFile(userId, dateStr);
    try {
        const data = await fs.readFile(file, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        if (e.code !== 'ENOENT') {
            console.error(`Load digests for ${dateStr} error:`, e);
        }
    }
    return [];
}

// 异步保存指定日期的简报
async function saveDigestsForDate(userId, dateStr, digests) {
    const file = getUserDigestFile(userId, dateStr);
    try {
        await fs.writeFile(file, JSON.stringify(digests, null, 2), 'utf8');
    } catch (e) {
        console.error(`Save digests for ${dateStr} error:`, e);
    }
}

/**
 * 异步加载最近的简报 (支持分页/游标)
 */
async function loadRecentUserDigests(userId, limit = 50, before = null) {
    ensureDirSync();
    let allDigests = [];
    let beforeDate = before ? new Date(before) : new Date(Date.now() + 1000);
    if (isNaN(beforeDate.getTime())) beforeDate = new Date(Date.now() + 1000);

    const beforeDateStr = getDateStr(beforeDate);
    const beforeTimestamp = beforeDate.getTime();

    try {
        const files = await fs.readdir(DIGEST_DIR);
        const regex = new RegExp(`^${userId}_(\\d{4}-\\d{2}-\\d{2})\\.json$`);
        const userFiles = files.filter(f => regex.test(f)).sort().reverse();

        for (const file of userFiles) {
            const fileDateStr = file.match(regex)[1];
            if (fileDateStr > beforeDateStr) continue;

            try {
                const filePath = path.join(DIGEST_DIR, file);
                const data = await fs.readFile(filePath, 'utf8');
                let content = JSON.parse(data);

                if (fileDateStr === beforeDateStr) {
                    content = content.filter(d => new Date(d.generatedAt).getTime() < beforeTimestamp);
                }

                allDigests = allDigests.concat(content);
                if (allDigests.length >= limit) break;
            } catch (e) {
                console.error(`Error reading ${file}:`, e);
            }
        }
    } catch (e) {
        console.error('Load recent digests error:', e);
    }

    return allDigests.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt)).slice(0, limit);
}

// 生成简报 ID
function generateDigestId(timestamp = Date.now()) {
    return `digest_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
}

export const DigestStore = {
    /**
     * 加载所有简报
     */
    async getAll(userId, options = {}) {
        const { scope, scopeId, unreadOnly = false, limit = 100, before = null } = options;
        let digests = await loadRecentUserDigests(userId, limit, before);

        if (scope && scopeId) {
            digests = digests.filter(d => d.scope === scope && d.scopeId == scopeId);
        } else if (scope === 'all') {
            digests = digests.filter(d => d.scope === 'all');
        }

        if (unreadOnly) {
            digests = digests.filter(d => !d.isRead);
        }

        return digests;
    },

    /**
     * 获取单个简报
     */
    async get(userId, digestId) {
        const dateStr = getDateStrFromId(digestId);
        if (dateStr) {
            const digests = await loadDigestsForDate(userId, dateStr);
            const digest = digests.find(d => d.id === digestId);
            if (digest) return digest;
        }

        const recent = await loadRecentUserDigests(userId, 200);
        return recent.find(d => d.id === digestId) || null;
    },

    /**
     * 添加简报
     */
    async add(userId, digestData) {
        const now = new Date(digestData.generatedAt || Date.now());
        const timestamp = now.getTime();
        const dateStr = getDateStr(now);

        const dayDigests = await loadDigestsForDate(userId, dateStr);

        const pad = (n) => String(n).padStart(2, '0');
        const timeStr = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}:${pad(now.getMinutes())}`;

        const digest = {
            id: generateDigestId(timestamp),
            type: 'digest',
            scope: digestData.scope || 'all',
            scopeId: digestData.scopeId || null,
            scopeName: digestData.scopeName || t('all_subscriptions'),
            title: digestData.title || `${digestData.scopeName || t('all')} · ${t('digest_word')} ${timeStr}`,
            content: digestData.content,
            articleCount: digestData.articleCount || 0,
            hours: digestData.hours || 12,
            generatedAt: digestData.generatedAt || now.toISOString(),
            isRead: false
        };

        dayDigests.unshift(digest);
        await saveDigestsForDate(userId, dateStr, dayDigests);

        return digest;
    },

    /**
     * 更新简报状态 (通用方法)
     */
    async _updateDigestStatus(userId, digestId, updates) {
        const dateStr = getDateStrFromId(digestId);
        if (!dateStr) return false;

        const dayDigests = await loadDigestsForDate(userId, dateStr);
        const targetIndex = dayDigests.findIndex(d => d.id === digestId);

        if (targetIndex !== -1) {
            Object.assign(dayDigests[targetIndex], updates);
            await saveDigestsForDate(userId, dateStr, dayDigests);
            return true;
        }
        return false;
    },

    async markAsRead(userId, digestId) {
        return await this._updateDigestStatus(userId, digestId, { isRead: true });
    },

    async markAsUnread(userId, digestId) {
        return await this._updateDigestStatus(userId, digestId, { isRead: false });
    },

    async delete(userId, digestId) {
        const dateStr = getDateStrFromId(digestId);
        if (!dateStr) return false;

        const dayDigests = await loadDigestsForDate(userId, dateStr);
        const index = dayDigests.findIndex(d => d.id === digestId);

        if (index !== -1) {
            dayDigests.splice(index, 1);
            await saveDigestsForDate(userId, dateStr, dayDigests);
            return true;
        }
        return false;
    },

    /**
     * 获取用于文章列表的简报
     */
    async getForArticleList(userId, options = {}) {
        const limit = options.limit || 100;
        const digests = await this.getAll(userId, { ...options, limit });

        const now = new Date();
        const todayAtMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        const todayUnread = [];
        const others = [];

        digests.forEach(d => {
            const isToday = new Date(d.generatedAt).getTime() >= todayAtMidnight;
            const shouldPin = isToday && !options.before && !d.isRead;

            const articleFormat = {
                id: d.id,
                type: 'digest',
                feed_id: null,
                title: d.title,
                content: d.content,
                published_at: d.generatedAt,
                is_read: d.isRead ? 1 : 0,
                is_favorited: 0,
                thumbnail_url: null,
                feed_title: d.scopeName,
                author: 'AI',
                url: null,
                digest_scope: d.scope,
                digest_scope_id: d.scopeId,
                article_count: d.articleCount
            };

            if (shouldPin) {
                todayUnread.push(articleFormat);
            } else if (!options.unreadOnly || !d.isRead) {
                others.push(articleFormat);
            }
        });

        return { pinned: todayUnread, normal: others };
    }
};
