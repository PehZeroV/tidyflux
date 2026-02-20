// Node 18+ has global fetch built-in

/**
 * 将文本按段落/换行边界拆分为不超过 maxLen 的块
 */
function splitText(text, maxLen) {
    if (text.length <= maxLen) return [text];

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            chunks.push(remaining);
            break;
        }

        // 优先在段落边界 (\n\n) 处拆分
        let splitPos = remaining.lastIndexOf('\n\n', maxLen);
        if (splitPos < maxLen * 0.3) {
            // 段落边界太靠前，尝试在单个换行处拆分
            splitPos = remaining.lastIndexOf('\n', maxLen);
        }
        if (splitPos < maxLen * 0.3) {
            // 最后兜底：硬切
            splitPos = maxLen;
        }

        chunks.push(remaining.substring(0, splitPos));
        remaining = remaining.substring(splitPos).replace(/^\n+/, '');
    }

    return chunks;
}

/**
 * 发送推送通知，自动检测内容长度限制并分段发送
 * 支持 Discord content (2000) / embeds.description (4096) 等常见限制
 */
export async function sendPushNotification(pushConfig, title, content, userId) {
    const pushMethod = (pushConfig.method || 'POST').toUpperCase();

    // ---- GET 模式：URL 编码，单条发送 ----
    if (pushMethod === 'GET') {
        const pushUrl = pushConfig.url
            .replace(/\{\{title\}\}/g, encodeURIComponent(title))
            .replace(/\{\{digest_content\}\}/g, encodeURIComponent(content));
        const resp = await fetch(pushUrl, { method: 'GET' });
        console.log(`Push notification sent for user ${userId} [GET ${pushConfig.url}]: ${resp.status}`);
        if (!resp.ok) {
            try { const errBody = await resp.text(); console.error(`Push response body:`, errBody); } catch { }
        }
        return;
    }

    // ---- POST 模式：检测限制 & 自动分段 ----
    let bodyTemplate = pushConfig.body || '';

    // Intelligent Body Auto-fill (same logic as frontend dialog-manager.js)
    // If no body template provided, auto-generate based on webhook service
    if (!bodyTemplate.trim()) {
        const lowerUrl = pushConfig.url.toLowerCase();
        if (lowerUrl.includes('discord.com') || lowerUrl.includes('discordapp.com')) {
            bodyTemplate = '{"content": "{{title}}\\n\\n{{digest_content}}"}';
        } else if (lowerUrl.includes('api.telegram.org')) {
            bodyTemplate = '{"chat_id": "YOUR_CHAT_ID", "text": "{{title}}\\n\\n{{digest_content}}"}';
        } else if (lowerUrl.includes('qyapi.weixin.qq.com')) {
            bodyTemplate = '{"msgtype": "text", "text": {"content": "{{title}}\\n\\n{{digest_content}}"}}';
        } else if (lowerUrl.includes('open.feishu.cn') || lowerUrl.includes('open.larksuite.com')) {
            bodyTemplate = '{"msg_type": "text", "content": {"text": "{{title}}\\n\\n{{digest_content}}"}}';
        } else {
            // Default generic JSON
            bodyTemplate = '{"title": "{{title}}", "content": "{{digest_content}}"}';
        }
        console.log(`Push body auto-filled for user ${userId} based on URL: ${pushConfig.url.substring(0, 50)}...`);
    }

    // Remove newlines from template as they break JSON string format if not escaped
    // Users often format JSON with newlines for readability in the UI
    bodyTemplate = bodyTemplate.replace(/[\r\n]+/g, '');

    let contentChunks = [content]; // 默认不拆分

    // 通过 URL 判断推送服务的内容长度限制
    const pushUrl = pushConfig.url.toLowerCase();
    let fieldLimit = 0;
    if (pushUrl.includes('discord.com') || pushUrl.includes('discordapp.com')) {
        fieldLimit = 2000;  // Discord content 限制
    } else if (pushUrl.includes('api.telegram.org')) {
        fieldLimit = 4096;  // Telegram text 限制
    } else if (pushUrl.includes('qyapi.weixin.qq.com')) {
        fieldLimit = 2048;  // 企业微信 text.content 限制
    }

    if (fieldLimit > 0 && content.length > fieldLimit) {
        // 计算模板中除 digest_content 以外的开销（标题、固定文字等）
        const templateOverhead = bodyTemplate
            .replace(/\{\{title\}\}/g, title)
            .replace(/\{\{digest_content\}\}/g, '').length;
        // 粗略估算：可用空间 = 限制 - 开销比例
        const availablePerChunk = fieldLimit - Math.min(templateOverhead, fieldLimit * 0.3);
        if (availablePerChunk > 100) {
            contentChunks = splitText(content, availablePerChunk);
            console.log(`Push content split into ${contentChunks.length} chunk(s) for user ${userId} (${pushConfig.url}, limit: ${fieldLimit})`);
        }
    }

    // 逐条发送
    for (let i = 0; i < contentChunks.length; i++) {
        // 第一段保留标题，后续段不带标题
        const chunkTitle = i === 0 ? title : '';
        const chunkSafeTitle = JSON.stringify(chunkTitle).slice(1, -1);
        const chunkSafeContent = JSON.stringify(contentChunks[i]).slice(1, -1);

        const body = bodyTemplate
            .replace(/\{\{title\}\}/g, chunkSafeTitle)
            .replace(/\{\{digest_content\}\}/g, chunkSafeContent);

        const chunkLabel = contentChunks.length > 1 ? ` (${i + 1}/${contentChunks.length})` : '';
        console.log(`Push notification sending for user ${userId} [POST ${pushConfig.url}]${chunkLabel}: body_length=${body.length}`);

        let resp;
        try {
            resp = await fetch(pushConfig.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body
            });

            console.log(`Push notification sent for user ${userId} [POST ${pushConfig.url}]${chunkLabel}: ${resp.status}`);

            if (!resp.ok) {
                try { const errBody = await resp.text(); console.error(`Push response body:`, errBody); } catch { }
            } else {
                if (pushUrl.includes('discord')) {
                    // Discord might return 204 No Content for success
                    if (resp.status === 204) console.log('Discord verified success (204)');
                }
            }
        } catch (e) {
            console.error(`Push network error:`, e);
            throw e;
        }

        // 多条之间加延迟，保证 Discord 等服务按顺序接收
        if (i < contentChunks.length - 1) {
            await new Promise(r => setTimeout(r, 500));
        }

        // Return status of the last chunk if multiple, or the single one
        // Ideally we track all, but for UI feedback last one is usually indicative
        if (i === contentChunks.length - 1) {
            return { status: resp.status, ok: resp.ok };
        }
    }
}
