/**
 * Digest Routes - 简报生成 API
 * 
 * 提供订阅源/分组的 AI 简报生成功能
 */

import express from 'express';
import { authenticateToken, requireMinifluxConfigured } from '../middleware/auth.js';
import { DigestStore } from '../utils/digest-store.js';
import { DigestService } from '../services/digest-service.js';
import { PreferenceStore } from '../utils/preference-store.js';
import { DigestRunner } from '../services/digest-runner.js';
import { DigestLogStore } from '../utils/digest-log-store.js';
import { t, getLang } from '../utils/i18n.js';

const router = express.Router();

router.use(authenticateToken);



/**
 * GET /api/digest/list
 * 获取简报列表（用于文章列表显示）
 */
router.get('/list', async (req, res) => {
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
 * GET /api/digest/logs
 * 获取定时简报执行日志
 */
router.get('/logs', async (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset = parseInt(req.query.offset) || 0;

        const result = DigestLogStore.getAll(userId, { limit, offset });

        res.json({
            success: true,
            logs: result.logs,
            total: result.total
        });
    } catch (error) {
        console.error('Get digest logs error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/digest/:id
 * 获取单个简报详情
 */
router.get('/:id', async (req, res) => {
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
router.post('/generate', requireMinifluxConfigured, async (req, res) => {
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
            prompt: customPrompt,
            unreadOnly = true
        } = req.body;

        const userId = PreferenceStore.getUserId(req.user);
        const prefs = await PreferenceStore.get(userId);
        const storedAiConfig = prefs.ai_config || {};

        const isOllama = storedAiConfig.provider === 'ollama';
        if (!storedAiConfig.apiUrl || (!isOllama && !storedAiConfig.apiKey)) {
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
            timezone: prefs.digest_timezone || '',
            unreadOnly: unreadOnly !== false,
            uiLang: getLang(req)
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

        // 解析 scope 名称用于日志
        let scopeName = null;
        try {
            if (scope === 'feed' && options.feedId && req.miniflux) {
                const feed = await req.miniflux.getFeed(options.feedId);
                scopeName = feed?.title || null;
            } else if (scope === 'group' && options.groupId && req.miniflux) {
                const categories = await req.miniflux.getCategories();
                const cat = categories?.find(c => c.id === options.groupId);
                scopeName = cat?.title || null;
            }
        } catch { /* ignore */ }

        const startTime = Date.now();

        const logResult = (result, error) => {
            const durationMs = Date.now() - startTime;
            if (error) {
                DigestLogStore.add({
                    userId, scope, scopeId: options.feedId || options.groupId || null,
                    scopeName, status: 'failed',
                    error: error.message || String(error),
                    durationMs, triggeredBy: 'manual'
                });
            } else if (result?.success && result.digest) {
                DigestLogStore.add({
                    userId, scope, scopeId: options.feedId || options.groupId || null,
                    scopeName, status: 'success',
                    articleCount: result.digest.articleCount || 0,
                    digestId: result.digest.id,
                    durationMs,
                    promptTokens: result.usage?.prompt_tokens || 0,
                    completionTokens: result.usage?.completion_tokens || 0,
                    triggeredBy: 'manual'
                });
            }
        };

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
                logResult(result, null);
                sendEvent({ type: 'result', data: result });
                res.end();
            } catch (err) {
                clearInterval(heartbeat);
                console.error('Generate digest error:', err);
                logResult(null, err);
                const lang = getLang(req);
                sendEvent({ type: 'error', data: { error: err.message || t('generate_digest_failed', lang) } });
                res.end();
            }
        } else {
            try {
                const result = await DigestService.generate(req.miniflux, userId, options);
                logResult(result, null);
                res.json(result);
            } catch (err) {
                console.error('Generate digest error:', err);
                logResult(null, err);
                throw err;
            }
        }
    } catch (error) {
        console.error('Generate digest error:', error);
        if (useStream) {
            if (!res.headersSent) {
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
router.post('/:id/read', async (req, res) => {
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
router.delete('/:id/read', async (req, res) => {
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
router.delete('/:id', async (req, res) => {
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
 * POST /api/digest/test-push
 * 测试推送通知（通过后端代理，避免 CORS 问题）
 */
router.post('/test-push', async (req, res) => {
    try {
        const { url, body, method } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        // 只允许 http/https，防止 file:// 等协议
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            return res.status(400).json({ error: 'Invalid URL' });
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return res.status(400).json({ error: 'Only http and https URLs are allowed' });
        }

        const ALLOWED_METHODS = ['GET', 'POST'];
        const useMethod = (method || 'POST').toUpperCase();
        if (!ALLOWED_METHODS.includes(useMethod)) {
            return res.status(400).json({ error: 'Only GET and POST methods are allowed' });
        }
        const fetchOptions = {
            method: useMethod,
            signal: AbortSignal.timeout(10000) // 10s 超时，防止上游卡住占用连接
        };

        if (useMethod !== 'GET') {
            fetchOptions.headers = { 'Content-Type': 'application/json' };
            fetchOptions.body = body || '{}';
        }

        const resp = await fetch(url, fetchOptions);
        const responseText = await resp.text();
        res.json({
            status: resp.status,
            ok: resp.ok,
            response: responseText
        });
    } catch (error) {
        console.error('Test push error:', error);
        res.status(500).json({
            error: error.name === 'TimeoutError' ? 'Request timed out (10s)' : error.message
        });
    }
});

/**
 * POST /api/digest/run-task
 * 手动触发指定的定时简报任务
 */
router.post('/run-task', requireMinifluxConfigured, async (req, res) => {
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
        const startTime = Date.now();

        // 解析 scope 名称
        let scopeName = null;
        try {
            if (task.scope === 'feed') {
                const fid = task.feedId || task.scopeId;
                if (fid && req.miniflux) {
                    const feed = await req.miniflux.getFeed(parseInt(fid));
                    scopeName = feed?.title || null;
                }
            } else if (task.scope === 'group') {
                const gid = task.groupId || task.scopeId;
                if (gid && req.miniflux) {
                    const categories = await req.miniflux.getCategories();
                    const cat = categories?.find(c => c.id === parseInt(gid));
                    scopeName = cat?.title || null;
                }
            }
        } catch { /* ignore */ }

        const result = await DigestRunner.runTask(userId, task, prefs, { force: true });
        const durationMs = Date.now() - startTime;

        if (result.success) {
            // 记录手动运行成功日志
            const pushResult = result.push || {};
            let pushStatus = 'disabled';
            if (pushResult.attempted) {
                pushStatus = pushResult.success ? 'success' : 'failed';
            } else if (pushResult.reason === 'not_configured') {
                pushStatus = 'not_configured';
            } else if (pushResult.reason === 'no_articles') {
                pushStatus = 'skipped';
            }

            DigestLogStore.add({
                userId,
                scope: task.scope || 'all',
                scopeId: task.feedId || task.groupId || task.scopeId,
                scopeName,
                status: 'success',
                articleCount: result.digest?.articleCount || 0,
                digestId: result.digest?.id,
                pushStatus,
                pushError: pushResult.error || null,
                durationMs,
                promptTokens: result.usage?.prompt_tokens || 0,
                completionTokens: result.usage?.completion_tokens || 0,
                triggeredBy: 'manual'
            });

            res.json({ success: true, digest: result.digest, push: result.push, usage: result.usage });
        } else {
            // 记录手动运行失败日志
            DigestLogStore.add({
                userId,
                scope: task.scope || 'all',
                scopeId: task.feedId || task.groupId || task.scopeId,
                scopeName,
                status: 'failed',
                error: result.error || 'Unknown error',
                durationMs,
                triggeredBy: 'manual'
            });

            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('Run task error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
