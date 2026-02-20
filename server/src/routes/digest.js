/**
 * Digest Routes - 简报生成 API
 * 
 * 提供订阅源/分组的 AI 简报生成功能
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { DigestStore } from '../utils/digest-store.js';
import { DigestService, getRecentUnreadArticles } from '../services/digest-service.js';
import { PreferenceStore } from '../utils/preference-store.js';
import { DigestRunner } from '../services/digest-runner.js';
import { t, getLang } from '../utils/i18n.js';

const router = express.Router();



/**
 * GET /api/digest/list
 * 获取简报列表（用于文章列表显示）
 */
router.get('/list', authenticateToken, async (req, res) => {
    try {
        const { scope, scopeId, unreadOnly } = req.query;

        const options = {};
        if (scope) options.scope = scope;
        if (scopeId) {
            const parsedId = parseInt(scopeId);
            if (isNaN(parsedId)) {
                return res.status(400).json({ error: 'Invalid scopeId' });
            }
            options.scopeId = parsedId;
        }
        if (unreadOnly === 'true' || unreadOnly === '1') options.unreadOnly = true;

        // 支持 before 参数进行分页 (ISO 字符串或时间戳)
        const { before } = req.query;
        if (before) options.before = before;

        const userId = PreferenceStore.getUserId(req.user);
        const result = await DigestStore.getForArticleList(userId, options);

        res.json({
            success: true,
            digests: result
        });
    } catch (error) {
        console.error('Get digest list error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('fetch_digest_list_failed', lang) });
    }
});

/**
 * GET /api/digest/:id
 * 获取单个简报详情
 */
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = PreferenceStore.getUserId(req.user);
        const digest = await DigestStore.get(userId, id);

        if (!digest) {
            const lang = getLang(req);
            return res.status(404).json({ error: t('digest_not_found', lang) });
        }

        res.json({
            success: true,
            digest
        });
    } catch (error) {
        console.error('Get digest error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('fetch_digest_failed', lang) });
    }
});

/**
 * POST /api/digest/generate
 * 生成简报并存储
 */
router.post('/generate', authenticateToken, async (req, res) => {
    // Check if client wants stream
    const useStream = req.query.stream === 'true' || req.headers.accept === 'text/event-stream';

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    if (useStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        // Flush headers immediately
        if (res.flushHeaders) res.flushHeaders();
    }

    try {
        const {
            scope = 'all',
            feedId,
            groupId,
            hours = 12,
            afterTimestamp,
            targetLang = '简体中文',
            prompt: customPrompt
        } = req.body;

        const userId = PreferenceStore.getUserId(req.user);
        const prefs = await PreferenceStore.get(userId);
        const storedAiConfig = prefs.ai_config || {};

        if (!storedAiConfig.apiKey) {
            const error = { error: 'AI service not configured' };
            if (useStream) {
                sendEvent({ type: 'error', data: error });
                return res.end();
            }
            return res.status(400).json(error);
        }

        const options = {
            scope,
            hours: parseInt(hours),
            targetLang,
            prompt: customPrompt,
            aiConfig: storedAiConfig,
            timezone: prefs.digest_timezone || ''
        };

        if (afterTimestamp) options.afterTimestamp = parseInt(afterTimestamp);
        if (isNaN(options.hours)) options.hours = 12;

        if (feedId) {
            options.feedId = parseInt(feedId);
            if (isNaN(options.feedId)) {
                const error = { error: 'Invalid feedId' };
                if (useStream) {
                    sendEvent({ type: 'error', data: error });
                    return res.end();
                }
                return res.status(400).json(error);
            }
        }
        if (groupId) {
            options.groupId = parseInt(groupId);
            if (isNaN(options.groupId)) {
                const error = { error: 'Invalid groupId' };
                if (useStream) {
                    sendEvent({ type: 'error', data: error });
                    return res.end();
                }
                return res.status(400).json(error);
            }
        }

        if (useStream) {
            sendEvent({ type: 'status', message: 'generating' });

            // Keep connection alive with simple comments/heartbeat if needed, 
            // but for now we just await the result.
            // If the generation takes effective time (> 2min), we might need heartbeats.
            const heartbeat = setInterval(() => {
                res.write(': heartbeat\n\n');
            }, 10000);

            try {
                const result = await DigestService.generate(req.miniflux, userId, options);
                clearInterval(heartbeat);
                sendEvent({ type: 'result', data: result });
                res.end();
            } catch (err) {
                clearInterval(heartbeat);
                console.error('Generate digest error:', err);
                const lang = getLang(req);
                sendEvent({ type: 'error', data: { error: err.message || t('generate_digest_failed', lang) } });
                res.end();
            }
        } else {
            const result = await DigestService.generate(req.miniflux, userId, options);
            res.json(result);
        }
    } catch (error) {
        console.error('Generate digest error:', error);
        if (useStream) {
            if (!res.headersSent) {
                // If headers not sent (shouldn't happen if useStream was true and we set headers early), 
                // but if error logic happened before headers.
                res.status(500);
            }
            const lang = getLang(req);
            sendEvent({ type: 'error', data: { error: error.message || t('generate_digest_failed', lang) } });
            res.end();
        } else {
            const lang = getLang(req);
            res.status(500).json({ error: error.message || t('generate_digest_failed', lang) });
        }
    }
});


/**
 * POST /api/digest/:id/read
 * 标记简报为已读
 */
router.post('/:id/read', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = PreferenceStore.getUserId(req.user);
        const success = await DigestStore.markAsRead(userId, id);

        if (!success) {
            const lang = getLang(req);
            return res.status(404).json({ error: t('digest_not_found', lang) });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Mark digest read error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('mark_failed', lang) });
    }
});

/**
 * DELETE /api/digest/:id/read
 * 标记简报为未读
 */
router.delete('/:id/read', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = PreferenceStore.getUserId(req.user);
        const success = await DigestStore.markAsUnread(userId, id);

        if (!success) {
            const lang = getLang(req);
            return res.status(404).json({ error: t('digest_not_found', lang) });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Mark digest unread error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('mark_failed', lang) });
    }
});

/**
 * DELETE /api/digest/:id
 * 删除简报
 */
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = PreferenceStore.getUserId(req.user);
        const success = await DigestStore.delete(userId, id);

        if (!success) {
            const lang = getLang(req);
            return res.status(404).json({ error: t('digest_not_found', lang) });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Delete digest error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('delete_failed', lang) });
    }
});

/**
 * GET /api/digest/preview
 * 预览可用于生成简报的文章
 */
router.get('/preview', authenticateToken, async (req, res) => {
    try {
        const {
            scope = 'all',
            feedId,
            groupId,
            hours = 12
        } = req.query;

        const parsedHours = parseInt(hours);
        const options = { hours: isNaN(parsedHours) ? 12 : parsedHours };

        if (scope === 'feed' && feedId) {
            const parsedFeedId = parseInt(feedId);
            if (isNaN(parsedFeedId)) return res.status(400).json({ error: 'Invalid feedId' });
            options.feedId = parsedFeedId;
        } else if (scope === 'group' && groupId) {
            const parsedGroupId = parseInt(groupId);
            if (isNaN(parsedGroupId)) return res.status(400).json({ error: 'Invalid groupId' });
            options.groupId = parsedGroupId;
        }

        const articles = await getRecentUnreadArticles(req.miniflux, options);

        res.json({
            success: true,
            preview: {
                articleCount: articles.length,
                articles: articles.slice(0, 10).map(a => ({
                    id: a.id,
                    title: a.title,
                    feedTitle: a.feed ? a.feed.title : '',
                    publishedAt: a.published_at
                })),
                hours: parseInt(hours)
            }
        });

    } catch (error) {
        console.error('Preview digest error:', error);
        res.status(500).json({
            error: t('preview_failed', getLang(req))
        });
    }
});

/**
 * POST /api/digest/test-push
 * 测试推送通知（通过后端代理，避免 CORS 问题）
 */
router.post('/test-push', authenticateToken, async (req, res) => {
    try {
        const { url, body, method } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const useMethod = (method || 'POST').toUpperCase();
        let resp;
        if (useMethod === 'GET') {
            resp = await fetch(url, { method: 'GET' });
        } else {
            resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body || '{}'
            });
        }

        const responseText = await resp.text();
        res.json({
            status: resp.status,
            ok: resp.ok,
            response: responseText
        });
    } catch (error) {
        console.error('Test push error:', error);
        res.status(500).json({
            error: error.message
        });
    }
});

/**
 * POST /api/digest/run-task
 * 手动触发指定的定时简报任务
 */
router.post('/run-task', authenticateToken, async (req, res) => {
    try {
        const { taskIndex } = req.body;
        if (typeof taskIndex !== 'number') {
            return res.status(400).json({ error: 'Task index required' });
        }

        const userId = PreferenceStore.getUserId(req.user);
        const prefs = await PreferenceStore.get(userId);

        if (!prefs.digest_schedules || !prefs.digest_schedules[taskIndex]) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const task = prefs.digest_schedules[taskIndex];

        const result = await DigestRunner.runTask(userId, task, prefs, { force: true });

        if (result.success) {
            res.json({ success: true, digest: result.digest, push: result.push });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('Run task error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
