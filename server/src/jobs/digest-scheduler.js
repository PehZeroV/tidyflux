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

                    // 异步执行生成任务，不阻塞调度循环
                    const pushConfig = prefs.digest_push_config;
                    DigestService.generate(minifluxClient, userId, digestOptions)
                        .then(async (result) => {
                            if (result.success) {
                                console.log(`Digest generated for user ${userId} [Task: ${task.scope}]:`, result.digest.id);

                                // Push notification (per-task enabled + global config)
                                if (task.pushEnabled && pushConfig?.url) {
                                    try {
                                        const pushUrl = pushConfig.url;
                                        const bodyTemplate = pushConfig.body || '{}';
                                        const body = bodyTemplate
                                            .replace(/\{\{title\}\}/g, result.digest.title || '')
                                            .replace(/\{\{digest_content\}\}/g, (result.digest.content || '').replace(/"/g, '\\"'));

                                        const resp = await fetch(pushUrl, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: body
                                        });
                                        console.log(`Push notification sent for user ${userId} [POST ${pushUrl}]: ${resp.status}`);
                                    } catch (pushErr) {
                                        console.error(`Push notification failed for user ${userId}:`, pushErr.message);
                                    }
                                }
                            } else {
                                console.error(`Digest generation failed for user ${userId} [Task: ${task.scope}]:`, result);
                            }
                        })
                        .catch(err => {
                            console.error(`Error in digest generation for user ${userId}:`, err);
                        });
                }
            } catch (error) {
                console.error(`Error in digest scheduler for user ${userId}:`, error);
            }
        }
    }
};
