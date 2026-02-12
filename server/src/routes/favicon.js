import express from 'express';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MinifluxClient } from '../miniflux.js';
import { MinifluxConfigStore } from '../utils/miniflux-config-store.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 缓存目录
// 建议使用相对于 __dirname 的路径，或通过环境变量注入
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const CACHE_DIR = path.join(DATA_DIR, 'cache', 'favicons');
const WWW_DIR = path.join(__dirname, '../../../www');

// 确保缓存目录存在
if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
}

// 缓存有效期（7天）
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_AGE = 604800; // 7 days in seconds
const ERROR_MAX_AGE = 600; // 10 minutes in seconds

/**
 * 异步获取 Miniflux 客户端
 */
async function getMinifluxClient() {
    const config = await MinifluxConfigStore.getConfig();
    if (!config) return null;
    return new MinifluxClient(config.url, config.username, config.password, config.apiKey);
}

/**
 * 辅助函数：返回默认图标
 */
async function serveDefaultIcon(res, maxAge = ERROR_MAX_AGE) {
    const defaultIconPath = path.join(WWW_DIR, 'icons', 'rss.svg');
    try {
        await fs.access(defaultIconPath);
        res.set('Content-Type', 'image/svg+xml');
        res.set('Cache-Control', `public, max-age=${maxAge}`);
        res.set('X-Cache', 'DEFAULT');
        return res.sendFile(defaultIconPath);
    } catch (e) {
        return res.status(404).end();
    }
}

/**
 * 辅助函数：检查有效缓存
 */
async function _checkCache(feedId) {
    const cacheFile = path.join(CACHE_DIR, `feed_${feedId}.png`);
    const cacheMetaFile = path.join(CACHE_DIR, `feed_${feedId}.json`);

    try {
        const metaData = await fs.readFile(cacheMetaFile, 'utf8');
        const meta = JSON.parse(metaData);
        const age = Date.now() - meta.timestamp;

        if (age < CACHE_MAX_AGE) {
            const imageBuffer = await fs.readFile(cacheFile);
            return {
                data: imageBuffer,
                mimeType: meta.mime_type || 'image/png',
                type: 'HIT'
            };
        }
    } catch (e) {
        // 忽略错误，返回 null 表示未命中
    }
    return null;
}

/**
 * 辅助函数：从陈旧缓存获取 (STALE)
 */
async function _getStaleCache(feedId) {
    const cacheFile = path.join(CACHE_DIR, `feed_${feedId}.png`);
    const cacheMetaFile = path.join(CACHE_DIR, `feed_${feedId}.json`);
    try {
        const imageBuffer = await fs.readFile(cacheFile);
        const metaData = await fs.readFile(cacheMetaFile, 'utf8');
        const meta = JSON.parse(metaData);
        return {
            data: imageBuffer,
            mimeType: meta.mime_type || 'image/png',
            type: 'STALE'
        };
    } catch (e) {
        return null;
    }
}

/**
 * 辅助函数：通过 API 获取并保存缓存
 */
async function _fetchAndCacheIcon(feedId, miniflux) {
    const cacheFile = path.join(CACHE_DIR, `feed_${feedId}.png`);
    const cacheMetaFile = path.join(CACHE_DIR, `feed_${feedId}.json`);

    const iconData = await miniflux.getFeedIcon(feedId);
    if (!iconData?.data) {
        throw new Error('No icon data');
    }

    let base64Data = iconData.data;
    let mimeType = iconData.mime_type || 'image/png';

    if (base64Data.includes(';base64,')) {
        const parts = base64Data.split(';base64,');
        mimeType = parts[0].replace(/^data:/, '');
        base64Data = parts[1];
    }

    const imageBuffer = Buffer.from(base64Data, 'base64');

    // 保存缓存 (后台执行亦可，但此处保持一致性使用 await)
    await fs.writeFile(cacheFile, imageBuffer);
    await fs.writeFile(cacheMetaFile, JSON.stringify({
        timestamp: Date.now(),
        feedId: feedId,
        mime_type: mimeType
    }));

    return {
        data: imageBuffer,
        mimeType,
        type: 'MISS'
    };
}

/**
 * 获取订阅源图标
 */
router.get('/', async (req, res) => {
    const { feedId } = req.query;

    if (!feedId) {
        return serveDefaultIcon(res);
    }

    try {
        // 1. 检查有效缓存 (HIT)
        const hit = await _checkCache(feedId);
        if (hit) {
            res.set('Content-Type', hit.mimeType);
            res.set('Cache-Control', `public, max-age=${DEFAULT_MAX_AGE}`);
            res.set('X-Cache', hit.type);
            return res.send(hit.data);
        }

        // 2. 获取 Miniflux 客户端
        const miniflux = await getMinifluxClient();
        if (!miniflux) {
            return serveDefaultIcon(res);
        }

        // 3. 尝试从 API 获取 (MISS)
        try {
            const result = await _fetchAndCacheIcon(feedId, miniflux);
            res.set('Content-Type', result.mimeType);
            res.set('Cache-Control', `public, max-age=${DEFAULT_MAX_AGE}`);
            res.set('X-Cache', result.type);
            return res.send(result.data);
        } catch (fetchError) {
            // 4. API 失败，尝试回退到陈旧缓存 (STALE)
            const stale = await _getStaleCache(feedId);
            if (stale) {
                res.set('Content-Type', stale.mimeType);
                res.set('Cache-Control', `public, max-age=${DEFAULT_MAX_AGE}`);
                res.set('X-Cache', stale.type);
                return res.send(stale.data);
            }
            // 5. 最终降级到默认图标
            return serveDefaultIcon(res);
        }
    } catch (error) {
        console.error('Favicon route error:', error);
        return serveDefaultIcon(res);
    }
});

export default router;
