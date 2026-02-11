import { getMinifluxClient } from '../middleware/auth.js';
import { PreferenceStore } from '../utils/preference-store.js';
import { DigestService } from '../services/digest-service.js';

/**
 * 获取当前时间字符串 (HH:mm)
 * @param {string} [timezone] - IANA 时区标识符，例如 'Asia/Shanghai'。
 *   如果提供，则使用该时区计算当前时间；否则使用系统/容器默认时区。
 */
function getCurrentTimeStr(timezone) {
    const now = new Date();
    if (timezone) {
        try {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            const parts = formatter.formatToParts(now);
            const hours = parts.find(p => p.type === 'hour').value.padStart(2, '0');
            const minutes = parts.find(p => p.type === 'minute').value.padStart(2, '0');
            return `${hours}:${minutes}`;
        } catch (e) {
            // 无效时区回退到系统默认
            console.warn(`Invalid timezone "${timezone}", falling back to system default:`, e.message);
        }
    }
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

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
async function sendPushNotification(pushConfig, title, content, userId) {
    const pushMethod = (pushConfig.method || 'POST').toUpperCase();

    // ---- GET 模式：URL 编码，单条发送 ----
    if (pushMethod === 'GET') {
        const pushUrl = pushConfig.url
            .replace(/\{\{title\}\}/g, encodeURIComponent(title))
            .replace(/\{\{digest_content\}\}/g, encodeURIComponent(content));
        const resp = await fetch(pushUrl, { method: 'GET' });
        console.log(`Push notification sent for user ${userId} [GET ${pushUrl}]: ${resp.status}`);
        if (!resp.ok) {
            try { const errBody = await resp.text(); console.error(`Push response body:`, errBody); } catch { }
        }
        return;
    }

    // ---- POST 模式：检测限制 & 自动分段 ----
    const bodyTemplate = pushConfig.body || '{}';

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
            console.log(`Push content split into ${contentChunks.length} chunk(s) for user ${userId} (${pushUrl.split('/')[2]}, limit: ${fieldLimit})`);
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

        const resp = await fetch(pushConfig.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
        });

        const chunkLabel = contentChunks.length > 1 ? ` (${i + 1}/${contentChunks.length})` : '';
        console.log(`Push notification sent for user ${userId} [POST ${pushConfig.url}]${chunkLabel}: ${resp.status}`);
        if (!resp.ok) {
            try { const errBody = await resp.text(); console.error(`Push response body:`, errBody); } catch { }
        }

        // 多条之间加延迟，保证 Discord 等服务按顺序接收
        if (i < contentChunks.length - 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

export const DigestScheduler = {
    /**
     * 启动简报调度器
     */
    start() {
        console.log('Starting Digest Scheduler...');

        const run = async () => {
            try {
                await this.runCheck();
            } catch (err) {
                console.error('Digest Scheduler runCheck error:', err);
            }
            // 每分钟整点过 5 秒执行，减少与整点任务的竞争
            const nextRunDelay = 60000 - (Date.now() % 60000) + 5000;
            setTimeout(run, nextRunDelay);
        };

        // 第一次延迟 10 秒启动
        setTimeout(run, 10000);
    },

    /**
     * 执行调度检查
     */
    async runCheck() {
        const userIds = await PreferenceStore.getAllUserIds();

        for (const userId of userIds) {
            try {
                const prefs = await PreferenceStore.get(userId);
                const userTimezone = prefs.digest_timezone || '';
                const currentTime = getCurrentTimeStr(userTimezone);
                let schedules = [];

                // 配置迁移与初始化
                if (Array.isArray(prefs.digest_schedules)) {
                    schedules = prefs.digest_schedules;
                } else if (prefs.digest_schedule && typeof prefs.digest_schedule === 'object') {
                    schedules = [{ id: 'default', ...prefs.digest_schedule }];
                    prefs.digest_schedules = schedules;
                    delete prefs.digest_schedule;
                    await PreferenceStore.save(userId, prefs);
                }

                if (schedules.length === 0) continue;

                for (const task of schedules) {
                    if (!task.enabled || task.time !== currentTime) continue;

                    console.log(`Triggering scheduled digest for user ${userId} [Scope: ${task.scope}] at ${currentTime}`);

                    const aiConfig = prefs.ai_config;
                    if (!aiConfig?.apiKey) {
                        console.error(`Skipping digest for ${userId}: AI not configured.`);
                        continue;
                    }

                    const minifluxClient = await getMinifluxClient();
                    if (!minifluxClient) {
                        console.error(`Skipping digest for ${userId}: Miniflux client not available.`);
                        continue;
                    }

                    const targetLang = aiConfig.targetLang || aiConfig.summarizeLang || 'zh-CN';

                    const digestOptions = {
                        scope: task.scope || 'all',
                        hours: task.hours || 24,
                        targetLang: targetLang,
                        aiConfig: aiConfig,
                        prompt: aiConfig.digestPrompt,
                        unreadOnly: task.unreadOnly !== false, // default true
                        timezone: userTimezone || ''
                    };

                    if (task.scope === 'feed') {
                        digestOptions.feedId = task.feedId || task.scopeId;
                        // Validate feed still exists
                        try {
                            await minifluxClient.getFeed(parseInt(digestOptions.feedId));
                        } catch (e) {
                            console.warn(`Skipping digest for user ${userId}: feed ${digestOptions.feedId} no longer exists. Disabling task.`);
                            task.enabled = false;
                            await PreferenceStore.save(userId, prefs);
                            continue;
                        }
                    } else if (task.scope === 'group') {
                        digestOptions.groupId = task.groupId || task.scopeId;
                        // Validate group still exists
                        try {
                            const categories = await minifluxClient.getCategories();
                            const exists = categories.some(c => c.id === parseInt(digestOptions.groupId));
                            if (!exists) throw new Error('not found');
                        } catch (e) {
                            console.warn(`Skipping digest for user ${userId}: group ${digestOptions.groupId} no longer exists. Disabling task.`);
                            task.enabled = false;
                            await PreferenceStore.save(userId, prefs);
                            continue;
                        }
                    }

                    // 串行执行：生成 → 推送 → 下一个（防止 AI API 429 限流）
                    const pushConfig = prefs.digest_push_config;
                    try {
                        const result = await DigestService.generate(minifluxClient, userId, digestOptions);

                        if (!result.success) {
                            console.error(`Digest generation failed for user ${userId} [Task: ${task.scope}]:`, result);
                            continue;
                        }

                        console.log(`Digest generated for user ${userId} [Task: ${task.scope}]:`, result.digest.id);

                        // Push notification (per-task enabled + global config)
                        if (task.pushEnabled && pushConfig?.url) {
                            try {
                                await sendPushNotification(
                                    pushConfig,
                                    result.digest.title || '',
                                    result.digest.content || '',
                                    userId
                                );
                            } catch (pushErr) {
                                console.error(`Push notification failed for user ${userId}:`, pushErr.message);
                            }
                        }
                    } catch (err) {
                        console.error(`Error in digest generation for user ${userId}:`, err);
                    }
                }
            } catch (error) {
                console.error(`Error in digest scheduler for user ${userId}:`, error);
            }
        }
    }
};
