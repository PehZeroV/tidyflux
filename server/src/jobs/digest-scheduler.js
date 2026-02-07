import { getMinifluxClient } from '../middleware/auth.js';
import { PreferenceStore } from '../utils/preference-store.js';
import { DigestService } from '../services/digest-service.js';
import cron from 'node-cron';
import fetch from 'node-fetch';

/**
 * 获取当前时间字符串 (HH:mm)
 */
function getCurrentTimeStr() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

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
 * 发送推送通知
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

    try {
        const response = await fetch(url, options);
        console.log(`Push notification sent: ${response.status}`);
        return response;
    } catch (error) {
        console.error('Push notification error:', error);
        throw error;
    }
}

/**
 * 检查cron表达式是否匹配当前时间
 */
function shouldRunCronTask(cronExpression) {
    try {
        if (!cron.validate(cronExpression)) {
            return false;
        }
        
        const now = new Date();
        const parts = cronExpression.split(' ');
        if (parts.length !== 5) return false;

        const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
        
        const m = now.getMinutes();
        const h = now.getHours();
        const d = now.getDate();
        const mo = now.getMonth() + 1;
        const dow = now.getDay();

        return matchesCronField(m, minute, 0, 59) &&
               matchesCronField(h, hour, 0, 23) &&
               matchesCronField(d, dayOfMonth, 1, 31) &&
               matchesCronField(mo, month, 1, 12) &&
               matchesCronField(dow, dayOfWeek, 0, 6);
    } catch (error) {
        console.error('Error checking cron expression:', error);
        return false;
    }
}

/**
 * 检查值是否匹配cron字段
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
                
                // 处理旧的定时任务格式（兼容性）
                let schedules = [];
                if (Array.isArray(prefs.digest_schedules)) {
                    schedules = prefs.digest_schedules;
                } else if (prefs.digest_schedule && typeof prefs.digest_schedule === 'object') {
                    schedules = [{ id: 'default', ...prefs.digest_schedule }];
                    prefs.digest_schedules = schedules;
                    delete prefs.digest_schedule;
                    await PreferenceStore.save(userId, prefs);
                }

                // 处理旧格式任务
                for (const task of schedules) {
                    if (!task.enabled || task.time !== currentTime) continue;

                    console.log(`Triggering old-format scheduled digest for user ${userId} [Scope: ${task.scope}] at ${currentTime}`);

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

                // 处理新的cron任务
                const digestTasks = prefs.digest_tasks || [];
                const pushSettings = prefs.push_settings || {};

                for (const task of digestTasks) {
                    if (!task.cronExpression) continue;
                    
                    // 检查是否应该执行
                    if (!shouldRunCronTask(task.cronExpression)) continue;

                    console.log(`Triggering cron digest task for user ${userId} [Task: ${task.title}]`);

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

                    // 处理任务范围
                    const scopes = task.scopes || [];
                    let digestOptions = {
                        scope: 'all',
                        hours: 24,
                        targetLang: aiConfig.targetLang || 'zh-CN',
                        aiConfig: aiConfig,
                        prompt: task.customPrompt || aiConfig.digestPrompt,
                        includeRead: task.includeRead || false
                    };

                    // 如果指定了时间范围，使用timeRange参数
                    if (task.timeRange) {
                        digestOptions.timeRange = parseInt(task.timeRange);
                    }

                    if (scopes.length > 0 && !scopes.includes('all')) {
                        // 提取所有分类ID
                        const categoryIds = scopes
                            .filter(s => s.startsWith('group_'))
                            .map(s => parseInt(s.replace('group_', '')));
                        
                        if (categoryIds.length > 0) {
                            digestOptions.categoryIds = categoryIds;
                            digestOptions.scope = 'group';
                        }
                    }

                    // 替换标题中的时间变量
                    const processedTitle = replaceTemplateVars(task.digestTitle || task.title || 'Digest');
                    
                    // 将自定义标题添加到选项中
                    digestOptions.customTitle = processedTitle;

                    // 异步执行生成任务
                    DigestService.generate(minifluxClient, userId, digestOptions)
                        .then(async result => {
                            if (result.success) {
                                console.log(`Digest generated for user ${userId} [Task: ${task.title}]:`, result.digest.id);
                                
                                // 如果启用推送，发送推送通知
                                if (task.enablePush && pushSettings.url) {
                                    try {
                                        await sendPushNotification(pushSettings, result.digest.content, processedTitle);
                                        console.log(`Push notification sent for task: ${task.title}`);
                                    } catch (pushError) {
                                        console.error(`Push notification error for task ${task.title}:`, pushError);
                                    }
                                }
                            } else {
                                console.error(`Digest generation failed for user ${userId} [Task: ${task.title}]:`, result);
                            }
                        })
                        .catch(err => {
                            console.error(`Error in digest generation for user ${userId} [Task: ${task.title}]:`, err);
                        });
                }
            } catch (error) {
                console.error(`Error in digest scheduler for user ${userId}:`, error);
            }
        }
    }
};
