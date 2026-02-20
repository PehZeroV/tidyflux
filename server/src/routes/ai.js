import express from 'express';
import { Readable } from 'node:stream';
// Node 18+ has global fetch built-in
import { authenticateToken } from '../middleware/auth.js';
import { PreferenceStore } from '../utils/preference-store.js';
import { t, getLang } from '../utils/i18n.js';

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
        const isOllama = aiConfig.provider === 'ollama';

        if (!aiConfig.apiUrl || (!isOllama && !aiConfig.apiKey)) {
            const lang = getLang(req);
            return res.status(400).json({ error: t('ai_not_configured_server', lang) });
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
            const headers = { 'Content-Type': 'application/json' };
            if (aiConfig.apiKey) headers['Authorization'] = `Bearer ${aiConfig.apiKey}`;

            response = await fetch(apiUrl, {
                method: 'POST',
                headers,
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
            // 不要直接透传上游 AI 的 401/403，否则前端会误判为登录过期
            const statusCode = (response.status === 401 || response.status === 403) ? 502 : response.status;
            return res.status(statusCode).json({ error: errorMsg, status: response.status });
        }

        if (stream) {
            // 设置 SSE 响应头
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // Node 18+ 原生 fetch 的 response.body 是 Web Streams ReadableStream，
            // 需要用 Readable.fromWeb() 转为 Node.js Readable 才能 pipe
            const nodeStream = Readable.fromWeb(response.body);

            // 监听客户端断开连接，及时销毁流
            req.on('close', () => {
                if (!res.writableEnded) {
                    nodeStream.destroy();
                }
            });

            // 将 AI 响应流直接通过管道传输给客户端
            nodeStream.pipe(res);

            // 监听错误
            nodeStream.on('error', (err) => {
                if (err.name !== 'AbortError') {
                    console.error('Stream error:', err);
                }
                if (!res.writableEnded) res.end();
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
                return res.status(400).json({ error: t('provide_api_url_and_key', getLang(req)) });
            }
        }

        // For Ollama provider, apiKey is optional
        const isOllamaTest = apiUrl && (apiUrl.includes('localhost:11434') || apiUrl.includes('127.0.0.1:11434'));
        if (!apiUrl || (!isOllamaTest && !apiKey)) {
            return res.status(400).json({ error: t('provide_api_url_and_key', getLang(req)) });
        }

        const targetUrl = normalizeApiUrl(apiUrl);

        // 发送一个简单的测试请求
        const testHeaders = { 'Content-Type': 'application/json' };
        if (apiKey) testHeaders['Authorization'] = `Bearer ${apiKey}`;

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: testHeaders,
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
            // 不要直接透传上游 AI 的 401/403，否则前端会误判为登录过期
            const statusCode = (response.status === 401 || response.status === 403) ? 502 : response.status;
            return res.status(statusCode).json({ success: false, error: errorMsg });
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
