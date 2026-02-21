/**
 * Digest View - 简报视图
 * 
 * 提供简报生成功能
 */

import { i18n } from '../i18n.js';
import { AuthManager } from '../auth-manager.js';
import { AIService } from '../ai-service.js';
import { showToast } from './utils.js';
import { Modal } from './components.js';
import { Dialogs } from './dialogs.js';

/**
 * 简报视图管理
 */
export const DigestView = {
    viewManager: null,

    /**
     * 初始化简报视图
     * @param {Object} viewManager - ViewManager 实例引用
     */
    init(viewManager) {
        this.viewManager = viewManager;
    },

    /**
     * 生成简报
     * @param {string} scope - 'all' | 'feed' | 'group'
     * @param {number} feedId - 订阅源 ID
     * @param {number} groupId - 分组 ID
     */
    async generate(scope = 'all', feedId = null, groupId = null, hours = null, afterTimestamp = null, unreadOnly = true) {
        // 检查 AI 配置
        if (!AIService.isConfigured()) {
            await Modal.alertWithSettings(i18n.t('digest.ai_not_configured'), i18n.t('common.go_to_settings'), () => Dialogs.showSettingsDialog(false));
            return;
        }

        // 显示正在生成提示 (长连接，提示用户稍后查看)
        showToast(i18n.t('digest.generating'), 5000, true);

        try {
            const aiConfig = AIService.getConfig();

            const body = {
                scope,
                feedId,
                groupId,
                hours: hours || 12,
                targetLang: AIService.getLanguageName(aiConfig.targetLang || 'zh-CN'),
                prompt: aiConfig.digestPrompt,
                unreadOnly
            };
            if (afterTimestamp) body.afterTimestamp = afterTimestamp;

            const response = await AuthManager.fetchWithAuth('/api/digest/generate?stream=true', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || i18n.t('digest.error'));
            }

            // 处理 SSE 流
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.slice(6).trim();
                            if (!dataStr) continue;

                            try {
                                const event = JSON.parse(dataStr);

                                if (event.type === 'error') {
                                    throw new Error(event.data?.error || i18n.t('digest.error'));
                                }

                                if (event.type === 'result') {
                                    const { digest } = event.data;

                                    if (digest && digest.id) {
                                        // 成功生成，显示可交互 Toast

                                        // 标记列表强制刷新，以便下次进入列表时重新加载（显示新简报）
                                        // 不要直接清空 AppState.articles，否则会导致当前显示的列表突然清空
                                        if (this.viewManager) {
                                            this.viewManager.forceRefreshList = true;
                                        }

                                        // 构建跳转链接
                                        const params = new URLSearchParams();
                                        if (feedId) params.set('feed', feedId);
                                        if (groupId) params.set('group', groupId);
                                        const queryString = params.toString();
                                        const hash = queryString
                                            ? `#/article/${digest.id}?${queryString}`
                                            : `#/article/${digest.id}`;

                                        showToast(i18n.t('digest.success'), 15000, false, () => {
                                            window.location.hash = hash;
                                        });
                                    } else {
                                        // 无内容
                                        showToast(digest?.content || i18n.t('digest.no_articles', { hours: 12 }), 5000, false);
                                    }
                                }
                            } catch (e) {
                                if (e.message && e.message !== 'Unexpected end of JSON input') {
                                    throw e;
                                }
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }

        } catch (error) {
            console.error('Generate digest error:', error);
            // 只有明显错误才弹窗，避免干扰
            if (error.name !== 'AbortError') {
                showToast(error.message || i18n.t('digest.error'), 5000, false);
            }
        }
    },

    /**
     * 为订阅源生成简报
     */
    generateForFeed(feedId) {
        return this.generate('feed', feedId, null);
    },

    /**
     * 为分组生成简报
     */
    generateForGroup(groupId) {
        return this.generate('group', null, groupId);
    },
};
