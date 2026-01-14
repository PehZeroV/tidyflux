import { getMinifluxClient } from '../middleware/auth.js';
import { PreferenceStore } from '../utils/preference-store.js';
import { DigestService } from '../services/digest-service.js';

/**
 * 获取当前时间字符串 (HH:mm)
 */
function getCurrentTimeStr() {
    const now = new Date();
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
        const currentTime = getCurrentTimeStr();
        const userIds = await PreferenceStore.getAllUserIds();

        for (const userId of userIds) {
            try {
                const prefs = await PreferenceStore.get(userId);
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
                        prompt: aiConfig.digestPrompt
                    };

                    if (task.scope === 'feed') {
                        digestOptions.feedId = task.feedId || task.scopeId;
                    } else if (task.scope === 'group') {
                        digestOptions.groupId = task.groupId || task.scopeId;
                    }

                    // 异步执行生成任务，不阻塞调度循环
                    DigestService.generate(minifluxClient, userId, digestOptions)
                        .then(result => {
                            if (result.success) {
                                console.log(`Digest generated for user ${userId} [Task: ${task.scope}]:`, result.digest.id);
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
