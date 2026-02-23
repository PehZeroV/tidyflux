import { PreferenceStore } from '../utils/preference-store.js';
import { DigestRunner } from '../services/digest-runner.js';
import { DigestLogStore } from '../utils/digest-log-store.js';
import { getMinifluxClient } from '../middleware/auth.js';

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
 * 解析 scope 的显示名称
 */
async function resolveScopeName(task) {
    try {
        const miniflux = await getMinifluxClient();
        if (!miniflux) return null;

        if (task.scope === 'feed') {
            const feedId = task.feedId || task.scopeId;
            if (feedId) {
                const feed = await miniflux.getFeed(parseInt(feedId));
                return feed?.title || null;
            }
        } else if (task.scope === 'group') {
            const groupId = task.groupId || task.scopeId;
            if (groupId) {
                const categories = await miniflux.getCategories();
                const cat = categories?.find(c => c.id === parseInt(groupId));
                return cat?.title || null;
            }
        }
    } catch {
        // ignore
    }
    return null;
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
                const schedules = Array.isArray(prefs.digest_schedules) ? prefs.digest_schedules : [];

                if (schedules.length === 0) continue;

                for (const task of schedules) {
                    if (!task.enabled || task.time !== currentTime) continue;

                    console.log(`Triggering scheduled digest for user ${userId} [Scope: ${task.scope}] at ${currentTime}`);
                    const startTime = Date.now();

                    try {
                        const result = await DigestRunner.runTask(userId, task, prefs);
                        const durationMs = Date.now() - startTime;

                        if (!result.success) {
                            console.error(`Digest generation logic failed for user ${userId} [Task: ${task.scope}]:`, result.error);

                            // 记录失败日志
                            const scopeName = await resolveScopeName(task);
                            DigestLogStore.add({
                                userId,
                                scope: task.scope || 'all',
                                scopeId: task.feedId || task.groupId || task.scopeId,
                                scopeName,
                                status: 'failed',
                                error: result.error || 'Unknown error',
                                durationMs,
                                triggeredBy: 'scheduler'
                            });

                            // Check if we should disable the task (resource not found)
                            if (result.error === 'Feed not found' || result.error === 'Group not found') {
                                console.warn(`Disabling invalid task for user ${userId}`);
                                task.enabled = false;
                                // 使用 update() 确保原子性，避免覆盖并发的用户修改
                                await PreferenceStore.update(userId, {
                                    digest_schedules: prefs.digest_schedules
                                });
                            }
                            continue;
                        }

                        console.log(`Digest task completed for user ${userId} [Task ID: ${result.digest.id}]`);

                        // 记录成功日志
                        const scopeName = await resolveScopeName(task);
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
                            articleCount: result.digest.articleCount || 0,
                            digestId: result.digest.id,
                            pushStatus,
                            pushError: pushResult.error || null,
                            durationMs,
                            promptTokens: result.usage?.prompt_tokens || 0,
                            completionTokens: result.usage?.completion_tokens || 0,
                            triggeredBy: 'scheduler'
                        });

                    } catch (err) {
                        const durationMs = Date.now() - startTime;
                        console.error(`Error in digest task execution for user ${userId}:`, err);

                        // 记录异常日志
                        const scopeName = await resolveScopeName(task);
                        DigestLogStore.add({
                            userId,
                            scope: task.scope || 'all',
                            scopeId: task.feedId || task.groupId || task.scopeId,
                            scopeName,
                            status: 'failed',
                            error: err.message || String(err),
                            durationMs,
                            triggeredBy: 'scheduler'
                        });
                    }
                }
            } catch (error) {
                console.error(`Error in digest scheduler for user ${userId}:`, error);
            }
        }
    }
};
