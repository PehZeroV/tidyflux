import { PreferenceStore } from '../utils/preference-store.js';
import { DigestRunner } from '../services/digest-runner.js';

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

                    try {
                        const result = await DigestRunner.runTask(userId, task, prefs);

                        if (!result.success) {
                            console.error(`Digest generation logic failed for user ${userId} [Task: ${task.scope}]:`, result.error);
                            
                            // Check if we should disable the task (resource not found)
                            if (result.error === 'Feed not found' || result.error === 'Group not found') {
                                console.warn(`Disabling invalid task for user ${userId}`);
                                task.enabled = false;
                                await PreferenceStore.save(userId, prefs);
                            }
                            continue;
                        }
                        
                        console.log(`Digest task completed for user ${userId} [Task ID: ${result.digest.id}]`);

                    } catch (err) {
                        console.error(`Error in digest task execution for user ${userId}:`, err);
                    }
                }
            } catch (error) {
                console.error(`Error in digest scheduler for user ${userId}:`, error);
            }
        }
    }
};
