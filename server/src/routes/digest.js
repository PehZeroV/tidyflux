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
import cron from 'node-cron';
import fetch from 'node-fetch';

const router = express.Router();

/**
 * 替换模板变量
 */
function replaceTemplateVars(template, content = '', title = '') {
    const now = new Date();
    const replacements = {
        title: title,
        summary_content: content,
        yyyy: now.getFullYear(),
        MM: String(now.getMonth() + 1).padStart(2, '0'),
        dd: String(now.getDate()).padStart(2, '0'),
        HH: String(now.getHours()).padStart(2, '0'),
        mm: String(now.getMinutes()).padStart(2, '0'),
        ss: String(now.getSeconds()).padStart(2, '0')
    };

    let result = template;
    Object.keys(replacements).forEach(key => {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        result = result.replace(regex, replacements[key]);
    });

    return result;
}



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
        res.status(500).json({ error: '获取简报列表失败' });
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
            return res.status(404).json({ error: '简报不存在' });
        }

        res.json({
            success: true,
            digest
        });
    } catch (error) {
        console.error('Get digest error:', error);
        res.status(500).json({ error: '获取简报失败' });
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
            targetLang = '简体中文',
            prompt: customPrompt,
            aiConfig
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
            aiConfig: storedAiConfig
        };

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
                sendEvent({ type: 'error', data: { error: err.message || '生成简报失败' } });
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
            sendEvent({ type: 'error', data: { error: error.message || '生成简报失败' } });
            res.end();
        } else {
            res.status(500).json({ error: error.message || '生成简报失败' });
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
            return res.status(404).json({ error: '简报不存在' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Mark digest read error:', error);
        res.status(500).json({ error: '标记失败' });
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
            return res.status(404).json({ error: '简报不存在' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Mark digest unread error:', error);
        res.status(500).json({ error: '标记失败' });
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
            return res.status(404).json({ error: '简报不存在' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Delete digest error:', error);
        res.status(500).json({ error: '删除失败' });
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
            error: '预览失败'
        });
    }
});

/**
 * POST /api/digest/parse-cron
 * 解析Cron表达式并返回下5次执行时间
 */
router.post('/parse-cron', authenticateToken, async (req, res) => {
    try {
        const { expression } = req.body;
        
        console.log('[parse-cron] Received expression:', expression);
        
        if (!expression) {
            console.log('[parse-cron] No expression provided');
            return res.status(400).json({ error: 'Cron expression is required' });
        }

        // 验证cron表达式
        const isValid = cron.validate(expression);
        console.log('[parse-cron] Validation result:', isValid);
        
        if (!isValid) {
            console.log('[parse-cron] Invalid cron expression');
            return res.status(400).json({ error: 'Invalid cron expression' });
        }

        // 计算下5次执行时间
        const nextRuns = [];
        const now = new Date();
        let currentDate = new Date(now);

        // 使用简单的方法计算接下来的执行时间
        for (let i = 0; i < 5; i++) {
            currentDate = getNextCronDate(expression, currentDate);
            if (currentDate) {
                nextRuns.push(currentDate.toLocaleString('zh-CN', { 
                    year: 'numeric', 
                    month: '2-digit', 
                    day: '2-digit', 
                    hour: '2-digit', 
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false 
                }));
            }
        }

        console.log('[parse-cron] Next runs:', nextRuns);

        res.json({
            success: true,
            nextRuns
        });
    } catch (error) {
        console.error('[parse-cron] Error:', error);
        res.status(400).json({ error: 'Invalid cron expression', message: error.message });
    }
});

/**
 * POST /api/digest/manual-trigger
 * 手动触发简报生成任务
 */
router.post('/manual-trigger', authenticateToken, async (req, res) => {
    try {
        const {
            title,
            digestTitle,
            scopes,
            customPrompt,
            timeRange,
            includeRead,
            enablePush
        } = req.body;

        const userId = PreferenceStore.getUserId(req.user);
        const prefs = await PreferenceStore.get(userId);
        const storedAiConfig = prefs.ai_config || {};

        if (!storedAiConfig.apiKey) {
            return res.status(400).json({ error: 'AI service not configured' });
        }

        // 处理范围
        let digestOptions = {
            scope: 'all',
            hours: 24,
            targetLang: storedAiConfig.targetLang || '简体中文',
            prompt: customPrompt,
            aiConfig: storedAiConfig,
            includeRead: includeRead || false
        };

        // 如果指定了时间范围，使用timeRange参数
        if (timeRange) {
            digestOptions.timeRange = parseInt(timeRange);
        }

        if (scopes && scopes.length > 0) {
            if (scopes.includes('all')) {
                digestOptions.scope = 'all';
            } else {
                // 提取所有分类ID
                const categoryIds = scopes
                    .filter(s => s.startsWith('group_'))
                    .map(s => parseInt(s.replace('group_', '')));
                
                if (categoryIds.length > 0) {
                    digestOptions.categoryIds = categoryIds;
                    digestOptions.scope = 'group';
                }
            }
        }

        // 处理简报标题（替换时间变量）
        if (digestTitle) {
            const processedTitle = replaceTemplateVars(digestTitle);
            digestOptions.customTitle = processedTitle;
        }

        // 生成简报
        const result = await DigestService.generate(req.miniflux, userId, digestOptions);

        // 如果启用推送，发送推送
        if (enablePush && result.success) {
            const pushSettings = prefs.push_settings || {};
            if (pushSettings.url) {
                try {
                    const pushTitle = digestTitle ? replaceTemplateVars(digestTitle) : title;
                    await sendPushNotification(pushSettings, result.digest.content, pushTitle);
                } catch (pushError) {
                    console.error('Push notification error:', pushError);
                }
            }
        }

        res.json({
            success: true,
            digest: result.digest
        });
    } catch (error) {
        console.error('Manual trigger error:', error);
        res.status(500).json({ error: error.message || '执行失败' });
    }
});

/**
 * 辅助函数：获取下一次cron执行时间
 */
function getNextCronDate(expression, fromDate) {
    const parts = expression.split(' ');
    if (parts.length !== 5) return null;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    
    let nextDate = new Date(fromDate);
    nextDate.setSeconds(0);
    nextDate.setMilliseconds(0);
    nextDate.setMinutes(nextDate.getMinutes() + 1); // 从下一分钟开始

    // 简单实现：最多尝试1000次
    for (let i = 0; i < 1000; i++) {
        if (matchesCron(nextDate, minute, hour, dayOfMonth, month, dayOfWeek)) {
            return nextDate;
        }
        nextDate.setMinutes(nextDate.getMinutes() + 1);
    }

    return null;
}

/**
 * 辅助函数：检查日期是否匹配cron表达式
 */
function matchesCron(date, minute, hour, dayOfMonth, month, dayOfWeek) {
    const m = date.getMinutes();
    const h = date.getHours();
    const d = date.getDate();
    const mo = date.getMonth() + 1;
    const dow = date.getDay();

    if (!matchesCronField(m, minute, 0, 59)) return false;
    if (!matchesCronField(h, hour, 0, 23)) return false;
    if (!matchesCronField(d, dayOfMonth, 1, 31)) return false;
    if (!matchesCronField(mo, month, 1, 12)) return false;
    if (!matchesCronField(dow, dayOfWeek, 0, 6)) return false;

    return true;
}

/**
 * 辅助函数：检查值是否匹配cron字段
 */
function matchesCronField(value, field, min, max) {
    if (field === '*') return true;
    
    // 处理步长 */n 或 start-end/step
    if (field.includes('/')) {
        const parts = field.split('/');
        const step = parseInt(parts[1]);
        
        if (parts[0] === '*') {
            // */n 表示从min开始，每隔step执行
            return (value - min) % step === 0;
        } else if (parts[0].includes('-')) {
            // start-end/step
            const [start, end] = parts[0].split('-').map(Number);
            return value >= start && value <= end && (value - start) % step === 0;
        } else {
            // n/step (从n开始)
            const start = parseInt(parts[0]);
            return value >= start && (value - start) % step === 0;
        }
    }
    
    // 处理范围 n-m
    if (field.includes('-')) {
        const [start, end] = field.split('-').map(Number);
        return value >= start && value <= end;
    }
    
    // 处理列表 n,m,o
    if (field.includes(',')) {
        const values = field.split(',').map(Number);
        return values.includes(value);
    }
    
    // 处理单个值
    return value === parseInt(field);
}

/**
 * 辅助函数：发送推送通知
 */
async function sendPushNotification(pushSettings, content, title) {
    const { url, method, body: bodyTemplate } = pushSettings;
    
    if (!url) return;

    let processedBody = replaceTemplateVars(bodyTemplate || '', content, title);
    
    // 处理中英文引号
    processedBody = processedBody.replace(/[""]/g, '"').replace(/['']/g, "'");

    const options = {
        method: method || 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    if (method === 'POST' && processedBody) {
        options.body = processedBody;
    }

    const response = await fetch(url, options);
    return response;
}

export default router;
