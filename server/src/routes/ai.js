import express from 'express';
import fetch from 'node-fetch';
import { authenticateToken } from '../middleware/auth.js';
import { PreferenceStore } from '../utils/preference-store.js';

const router = express.Router();

/**
 * POST /api/ai/chat
 * 通用 AI 对话接口 (支持流式响应)
 */
const normalizeApiUrl = (url) => {
    let normalized = url.trim();
    if (!normalized.endsWith('/')) normalized += '/';
    if (!normalized.endsWith('chat/completions')) {
        normalized += 'chat/completions';
    }
    return normalized;
};

router.post('/chat', authenticateToken, async (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        const prefs = await PreferenceStore.get(userId);
        const aiConfig = prefs.ai_config || {};

        if (!aiConfig.apiUrl || !aiConfig.apiKey) {
            return res.status(400).json({ error: 'AI 未在服务端配置' });
        }

        const apiUrl = normalizeApiUrl(aiConfig.apiUrl);

        const { messages, model, stream, temperature } = req.body;

        const controller = new AbortController();
        // 设置 600秒 (10分钟) 超时
        const timeout = setTimeout(() => {
            controller.abort();
        }, 600000);

        let response;
        try {
            // 转发请求给 AI 提供商
            response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${aiConfig.apiKey}`
                },
                body: JSON.stringify({
                    model: model || aiConfig.model || 'gpt-4.1-mini',
                    temperature: temperature ?? aiConfig.temperature ?? 1,
                    messages,
                    stream: !!stream
                }),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!response.ok) {
            const errorText = await response.text();
            let errorMsg = `AI API Error: ${response.status}`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error && errorJson.error.message) {
                    errorMsg = errorJson.error.message;
                }
            } catch (e) {
                // ignore json parse error
            }
            return res.status(response.status).json({ error: errorMsg });
        }

        if (stream) {
            // 设置 SSE 响应头
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // 创建用于中止上游请求的 controller
            const streamController = new AbortController();

            // 监听客户端断开连接，及时中止上游请求
            req.on('close', () => {
                if (!res.writableEnded) {
                    streamController.abort();
                    response.body?.destroy?.();
                }
            });

            // 将 AI 响应流直接通过管道传输给客户端
            response.body.pipe(res);

            // 监听错误
            response.body.on('error', (err) => {
                if (err.name !== 'AbortError') {
                    console.error('Stream error:', err);
                }
                res.end();
            });
        } else {
            const data = await response.json();
            res.json(data);
        }

    } catch (error) {
        console.error('AI Chat Proxy Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
});

/**
 * POST /api/ai/test
 * 测试 AI 连接配置
 */
router.post('/test', authenticateToken, async (req, res) => {
    try {
        let { apiUrl, apiKey, model } = req.body;

        // Ensure we handle the case where apiKey is masked
        if (!apiKey || apiKey === '********') {
            const userId = PreferenceStore.getUserId(req.user);
            const prefs = await PreferenceStore.get(userId);
            if (prefs.ai_config?.apiKey) {
                apiKey = prefs.ai_config.apiKey;
            } else {
                return res.status(400).json({ error: '请提供完整的 API URL 和 Key' });
            }
        }

        if (!apiUrl || !apiKey) {
            return res.status(400).json({ error: '请提供完整的 API URL 和 Key' });
        }

        const targetUrl = normalizeApiUrl(apiUrl);

        // 发送一个简单的测试请求
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model || 'gpt-4.1-mini',
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 5
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMsg = `API Error: ${response.status}`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error && errorJson.error.message) {
                    errorMsg = errorJson.error.message;
                }
            } catch (e) {
                // ignore
            }
            return res.status(response.status).json({ success: false, error: errorMsg });
        }

        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content || '';

        res.json({ success: true, message: 'Connection successful', reply });

    } catch (error) {
        console.error('AI Test Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
