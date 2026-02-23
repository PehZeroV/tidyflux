/**
 * Cache Routes - AI 缓存 API
 *
 * 提供翻译/摘要缓存的读写接口，替代前端 IndexedDB。
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { CacheStore } from '../utils/cache-store.js';
import { PreferenceStore } from '../utils/preference-store.js';

const router = express.Router();

/**
 * GET /api/cache/:key
 * 读取单个缓存
 */
router.get('/:key', authenticateToken, (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        const content = CacheStore.get(userId, req.params.key);
        res.json({ content });
    } catch (error) {
        console.error('Cache get error:', error);
        res.status(500).json({ error: 'Cache read failed' });
    }
});

/**
 * PUT /api/cache/:key
 * 写入单个缓存
 */
router.put('/:key', authenticateToken, (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        const { content } = req.body;
        CacheStore.set(userId, req.params.key, content);
        res.json({ success: true });
    } catch (error) {
        console.error('Cache set error:', error);
        res.status(500).json({ error: 'Cache write failed' });
    }
});

/**
 * DELETE /api/cache/:key
 * 删除单个缓存
 */
router.delete('/:key', authenticateToken, (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        CacheStore.delete(userId, req.params.key);
        res.json({ success: true });
    } catch (error) {
        console.error('Cache delete error:', error);
        res.status(500).json({ error: 'Cache delete failed' });
    }
});

/**
 * POST /api/cache/batch/get
 * 批量读取 (按前缀)
 */
router.post('/batch/get', authenticateToken, (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        const { prefix, limit } = req.body;

        if (!prefix) {
            return res.status(400).json({ error: 'prefix required' });
        }

        const entries = CacheStore.getByPrefix(userId, prefix, limit);
        res.json({ entries });
    } catch (error) {
        console.error('Cache batch get error:', error);
        res.status(500).json({ error: 'Cache batch read failed' });
    }
});

/**
 * POST /api/cache/batch/lookup
 * 批量精确查询（按 key 列表）
 */
router.post('/batch/lookup', authenticateToken, (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        const { keys } = req.body;

        if (!Array.isArray(keys) || keys.length === 0) {
            return res.status(400).json({ error: 'keys array required' });
        }

        const entries = CacheStore.getMany(userId, keys);
        res.json({ entries });
    } catch (error) {
        console.error('Cache batch lookup error:', error);
        res.status(500).json({ error: 'Cache batch lookup failed' });
    }
});

/**
 * POST /api/cache/batch/set
 * 批量写入
 */
router.post('/batch/set', authenticateToken, (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        const { entries } = req.body;

        if (!Array.isArray(entries)) {
            return res.status(400).json({ error: 'entries array required' });
        }

        CacheStore.setMany(userId, entries);
        res.json({ success: true });
    } catch (error) {
        console.error('Cache batch set error:', error);
        res.status(500).json({ error: 'Cache batch write failed' });
    }
});

/**
 * DELETE /api/cache
 * 清空所有缓存
 */
router.delete('/', authenticateToken, (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        CacheStore.clear(userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Cache clear error:', error);
        res.status(500).json({ error: 'Cache clear failed' });
    }
});

/**
 * GET /api/cache
 * 获取缓存统计
 */
router.get('/', authenticateToken, (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        const stats = CacheStore.getStats(userId);
        res.json(stats);
    } catch (error) {
        console.error('Cache stats error:', error);
        res.status(500).json({ error: 'Cache stats failed' });
    }
});

export default router;
