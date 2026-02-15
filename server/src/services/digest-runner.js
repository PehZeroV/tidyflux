import { getMinifluxClient } from '../middleware/auth.js';
import { DigestService } from './digest-service.js';
import { sendPushNotification } from './push-service.js';
import { PreferenceStore } from '../utils/preference-store.js';

export const DigestRunner = {
    /**
     * 执行单个简报任务
     * @param {string} userId - 用户 ID
     * @param {object} task - 任务配置对象
     * @param {object} prefs - 用户偏好设置（包含 AI 配置和推送配置）
     * @param {object} options - 额外选项 { force: boolean }
     */
    async runTask(userId, task, prefs, options = { force: false }) {
        const aiConfig = prefs.ai_config;
        if (!aiConfig?.apiKey) {
            console.error(`Skipping digest for ${userId}: AI not configured.`);
            return { success: false, error: 'AI not configured' };
        }

        const minifluxClient = await getMinifluxClient();
        if (!minifluxClient) {
            console.error(`Skipping digest for ${userId}: Miniflux client not available.`);
            return { success: false, error: 'Miniflux unavailable' };
        }

        const targetLang = aiConfig.targetLang || aiConfig.summarizeLang || 'zh-CN';
        const userTimezone = prefs.digest_timezone || '';

        const digestOptions = {
            scope: task.scope || 'all',
            hours: task.hours || 24,
            targetLang: targetLang,
            aiConfig: aiConfig,
            prompt: aiConfig.digestPrompt,
            unreadOnly: task.unreadOnly !== false, // default true
            timezone: userTimezone
        };

        if (task.scope === 'feed') {
            digestOptions.feedId = task.feedId || task.scopeId;
            // Validate feed still exists
            try {
                await minifluxClient.getFeed(parseInt(digestOptions.feedId));
            } catch (e) {
                console.warn(`Skipping digest for user ${userId}: feed ${digestOptions.feedId} no longer exists.`);
                if (!options.force) {
                    // Update task to disabled if not forced run (which might be testing)
                    // But here we just return error, caller handles persistence if needed
                    // For scheduler, it disables the task. For manual run, just error.
                    return { success: false, error: 'Feed not found' };
                }
            }
        } else if (task.scope === 'group') {
            digestOptions.groupId = task.groupId || task.scopeId;
            // Validate group still exists
            try {
                const categories = await minifluxClient.getCategories();
                const exists = categories.some(c => c.id === parseInt(digestOptions.groupId));
                if (!exists) throw new Error('not found');
            } catch (e) {
                console.warn(`Skipping digest for user ${userId}: group ${digestOptions.groupId} no longer exists.`);
                if (!options.force) {
                    return { success: false, error: 'Group not found' };
                }
            }
        }

        try {
            const result = await DigestService.generate(minifluxClient, userId, digestOptions);

            if (!result.success) {
                console.error(`Digest generation failed for user ${userId} [Task: ${task.scope}]:`, result);
                return { success: false, error: result.error || 'Generation failed' };
            }

            console.log(`Digest generated for user ${userId} [Task: ${task.scope}]:`, result.digest.id);

            // Push notification
            const pushConfig = prefs.digest_push_config;
            let pushResult = { attempted: false };
            
            if ((task.pushEnabled || options.forcePush) && pushConfig?.url) {
                pushResult.attempted = true;
                try {
                    const pushResp = await sendPushNotification(
                        pushConfig,
                        result.digest.title || '',
                        result.digest.content || '',
                        userId
                    );
                    pushResult.success = true;
                    if (pushResp && pushResp.status) {
                        pushResult.status = pushResp.status;
                    }
                } catch (pushErr) {
                    console.error(`Push notification failed for user ${userId}:`, pushErr.message);
                    pushResult.success = false;
                    pushResult.error = pushErr.message;
                    pushResult.status = 'ERR';
                }
            }

            return { success: true, digest: result.digest, push: pushResult };

        } catch (err) {
            console.error(`Error in digest generation/push for user ${userId}:`, err);
            return { success: false, error: err.message };
        }
    }
};
