/**
 * ManagerDialog - 定时简报管理对话框模块
 * @module view/manager-dialog
 */

import { AppState } from '../../state.js';
import { AuthManager } from '../auth-manager.js';
import { createDialog, showToast } from './utils.js';
import { Modal } from './components.js';
import { i18n } from '../i18n.js';
import { AIService } from '../ai-service.js';
import { API_ENDPOINTS } from '../../constants.js';
import { Icons } from '../icons.js';

/**
 * 定时简报管理对话框相关方法
 * 通过 mixin 模式合并到 Dialogs 对象
 */
export const ManagerDialogMixin = {
    /**
     * 显示定时简报管理对话框
     * 列出所有已有的定时简报任务
     */
    showDigestManagerDialog() {
        const { dialog, close } = createDialog('settings-dialog', `
            <div class="settings-dialog-content" style="position: relative; max-width: 500px; min-height: 400px;">
                <button class="icon-btn close-dialog-btn" title="${i18n.t('common.close')}" style="position: absolute; right: 16px; top: 16px; width: 32px; height: 32px; z-index: 10;">
                    ${Icons.close}
                </button>
                <h3>${i18n.t('digest.manager_title')}</h3>

                <div style="font-weight: 600; margin-top: 16px; margin-bottom: 8px;">${i18n.t('digest.task_list')}</div>
                <div id="digest-manager-list">
                    <div style="text-align: center; padding: 20px; color: var(--meta-color);">
                        ${i18n.t('common.loading')}
                    </div>
                </div>

                <div style="margin-top: 12px; margin-bottom: 4px;">
                    <div class="appearance-mode-group">
                        <button type="button" id="digest-manager-add-btn" class="appearance-mode-btn active" style="justify-content: center; width: 100%;">
                            ${i18n.t('digest.add_scheduled')}
                        </button>
                    </div>
                </div>

                <!-- Digest Prompt Settings -->
                <div style="margin-top: 16px; border-top: 1px solid var(--border-color); padding-top: 16px;">
                    <div style="font-weight: 600; margin-bottom: 12px;">${i18n.t('ai.digest_prompt')}</div>
                    <div style="margin-bottom: 12px;">
                        <textarea id="manager-digest-prompt" class="auth-input" rows="4" placeholder="${i18n.t('ai.digest_prompt_placeholder')}" style="margin-bottom: 8px; resize: vertical; min-height: 80px;"></textarea>
                    </div>
                    <div style="display: flex; gap: 8px; margin-bottom: 4px;">
                        <button type="button" id="manager-digest-prompt-reset-btn" class="appearance-mode-btn" style="flex: 1; justify-content: center;">
                            ${i18n.t('ai.reset_prompts')}
                        </button>
                        <button type="button" id="manager-digest-prompt-save-btn" class="appearance-mode-btn active" style="flex: 1; justify-content: center;">
                            ${i18n.t('common.save')}
                        </button>
                    </div>
                    <div id="manager-digest-prompt-msg" style="text-align: center; font-size: 0.85em; min-height: 1.2em;"></div>
                </div>

                <!-- Global Push Settings -->
                <div style="margin-top: 16px; border-top: 1px solid var(--border-color); padding-top: 16px;">
                    <div style="font-weight: 600; margin-bottom: 12px;">${i18n.t('settings.push_notification')}</div>
                    <div id="global-push-config">
                        <div style="margin-bottom: 12px;">
                            <div class="settings-item-label" style="margin-bottom: 6px;">${i18n.t('settings.push_url')}</div>
                            <input type="text" id="global-push-url" class="auth-input" placeholder="${i18n.t('settings.push_url_placeholder')}" style="margin-bottom: 0;">
                        </div>
                        <div style="margin-bottom: 12px;">
                            <div class="settings-item-label" style="margin-bottom: 6px;">${i18n.t('settings.push_body')}</div>
                            <textarea id="global-push-body" class="auth-input" rows="4" placeholder='{"title": "{{title}}", "content": "{{digest_content}}"}' style="margin-bottom: 8px; resize: vertical; font-family: monospace;"></textarea>
                            <div style="font-size: 0.8em; color: var(--meta-color); margin-top: 4px;">${i18n.t('settings.push_body_hint')}</div>
                        </div>
                        <div style="display: flex; gap: 8px; margin-bottom: 4px;">
                            <button type="button" id="global-push-test-btn" class="appearance-mode-btn" style="flex: 1; justify-content: center;">
                                ${i18n.t('settings.push_test')}
                            </button>
                            <button type="button" id="global-push-save-btn" class="appearance-mode-btn active" style="flex: 1; justify-content: center;">
                                ${i18n.t('common.save')}
                            </button>
                        </div>
                        <div id="global-push-msg" style="text-align: center; font-size: 0.85em; min-height: 1.2em;"></div>
                    </div>
                </div>

            </div>
        `);

        const listContainer = dialog.querySelector('#digest-manager-list');
        const addBtn = dialog.querySelector('#digest-manager-add-btn');

        // Digest prompt elements
        const digestPromptInput = dialog.querySelector('#manager-digest-prompt');
        const digestPromptResetBtn = dialog.querySelector('#manager-digest-prompt-reset-btn');
        const digestPromptSaveBtn = dialog.querySelector('#manager-digest-prompt-save-btn');
        const digestPromptMsg = dialog.querySelector('#manager-digest-prompt-msg');

        // Load digest prompt
        const aiConfig = AIService.getConfig();
        const defaultDigestPrompt = AIService.getDefaultPrompt('digest');
        digestPromptInput.value = aiConfig.digestPrompt || defaultDigestPrompt;

        // Reset digest prompt
        digestPromptResetBtn.addEventListener('click', () => {
            digestPromptInput.value = defaultDigestPrompt;
        });

        // Save digest prompt
        digestPromptSaveBtn.addEventListener('click', async () => {
            digestPromptSaveBtn.disabled = true;
            digestPromptMsg.textContent = '...';
            digestPromptMsg.style.color = 'var(--meta-color)';
            try {
                const currentConfig = AIService.getConfig();
                currentConfig.digestPrompt = digestPromptInput.value.trim();
                await AIService.saveConfig(currentConfig);
                digestPromptMsg.textContent = `✓ ${i18n.t('settings.save_success')}`;
                digestPromptMsg.style.color = 'var(--accent-color)';
            } catch (err) {
                console.error('Save digest prompt failed:', err);
                digestPromptMsg.textContent = `✗ ${i18n.t('common.error')}`;
                digestPromptMsg.style.color = 'var(--danger-color)';
            }
            digestPromptSaveBtn.disabled = false;
            setTimeout(() => { digestPromptMsg.textContent = ''; }, 2000);
        });

        // Push notification elements
        const globalPushUrl = dialog.querySelector('#global-push-url');
        const globalPushBody = dialog.querySelector('#global-push-body');
        const globalPushTestBtn = dialog.querySelector('#global-push-test-btn');
        const globalPushSaveBtn = dialog.querySelector('#global-push-save-btn');
        const globalPushMsg = dialog.querySelector('#global-push-msg');




        globalPushTestBtn.addEventListener('click', async () => {
            const url = globalPushUrl.value.trim();
            if (!url) {
                globalPushMsg.textContent = `✗ ${i18n.t('settings.push_url')}`;
                globalPushMsg.style.color = 'var(--danger-color)';
                return;
            }
            globalPushTestBtn.disabled = true;
            globalPushMsg.textContent = '...';
            globalPushMsg.style.color = 'var(--meta-color)';
            try {
                const bodyTemplate = globalPushBody.value.trim() || '{}';
                const body = bodyTemplate
                    .replace(/\{\{title\}\}/g, 'Test Digest Title')
                    .replace(/\{\{digest_content\}\}/g, 'This is a test push notification.');
                const resp = await fetch(API_ENDPOINTS.DIGEST.TEST_PUSH, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${AuthManager.getToken()}`
                    },
                    body: JSON.stringify({ url, body })
                });
                const result = await resp.json();
                if (result.ok) {
                    globalPushMsg.textContent = `✓ ${i18n.t('settings.push_test_success')}`;
                    globalPushMsg.style.color = 'var(--accent-color)';
                } else {
                    globalPushMsg.textContent = `✗ HTTP ${result.status || resp.status}`;
                    globalPushMsg.style.color = 'var(--danger-color)';
                }
            } catch (err) {
                globalPushMsg.textContent = `✗ ${i18n.t('settings.push_test_failed')}`;
                globalPushMsg.style.color = 'var(--danger-color)';
            }
            globalPushTestBtn.disabled = false;
            setTimeout(() => { globalPushMsg.textContent = ''; }, 3000);
        });

        const savePushConfig = async () => {
            try {
                const pushConfig = {
                    url: globalPushUrl.value.trim(),
                    body: globalPushBody.value.trim()
                };
                const response = await fetch(API_ENDPOINTS.PREFERENCES.BASE, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${AuthManager.getToken()}`
                    },
                    body: JSON.stringify({
                        key: 'digest_push_config',
                        value: pushConfig
                    })
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return true;
            } catch (err) {
                console.error('Save push config failed:', err);
                return false;
            }
        };

        globalPushSaveBtn.addEventListener('click', async () => {
            globalPushSaveBtn.disabled = true;
            globalPushMsg.textContent = '...';
            globalPushMsg.style.color = 'var(--meta-color)';
            const success = await savePushConfig();
            if (success) {
                globalPushMsg.textContent = `✓ ${i18n.t('settings.save_success')}`;
                globalPushMsg.style.color = 'var(--accent-color)';
            } else {
                globalPushMsg.textContent = `✗ ${i18n.t('common.error')}`;
                globalPushMsg.style.color = 'var(--danger-color)';
            }
            globalPushSaveBtn.disabled = false;
            setTimeout(() => { globalPushMsg.textContent = ''; }, 2000);
        });

        // Helper: get scope display name
        const getScopeName = (task) => {
            if (task.scope === 'all') return i18n.t('nav.all');
            if (task.scope === 'group') {
                const group = AppState.groups?.find(g => g.id == (task.scopeId || task.groupId));
                return group ? group.name : `Group #${task.scopeId || task.groupId}`;
            }
            if (task.scope === 'feed') {
                const feed = AppState.feeds?.find(f => f.id == (task.scopeId || task.feedId));
                return feed ? feed.title : `Feed #${task.scopeId || task.feedId}`;
            }
            return i18n.t('common.unnamed');
        };

        let allSchedules = [];

        // Load and render tasks
        const loadTasks = async () => {
            try {
                const response = await fetch(API_ENDPOINTS.PREFERENCES.BASE, {
                    headers: { 'Authorization': `Bearer ${AuthManager.getToken()}` }
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const prefs = await response.json();
                allSchedules = prefs.digest_schedules || [];

                // Load push config
                const pushCfg = prefs.digest_push_config || {};
                globalPushUrl.value = pushCfg.url || '';
                globalPushBody.value = pushCfg.body || '';

                renderTasks();
            } catch (err) {
                console.error('Load digest tasks error:', err);
                listContainer.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: var(--danger-color);">
                        ${i18n.t('common.load_error')}
                    </div>
                `;
            }
        };

        const renderTasks = () => {
            if (allSchedules.length === 0) {
                listContainer.innerHTML = `
                    <div style="text-align: center; padding: 40px 20px; color: var(--meta-color);">
                        ${i18n.t('digest.no_scheduled_tasks')}
                    </div>
                `;
                return;
            }

            // Group tasks by scope+scopeId (a twice-daily schedule has 2 tasks)
            const grouped = {};
            allSchedules.forEach(t => {
                const key = `${t.scope}_${t.scopeId || ''}`;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(t);
            });

            listContainer.innerHTML = '';

            Object.keys(grouped).forEach(key => {
                const tasks = grouped[key];
                const first = tasks[0];
                const scopeName = getScopeName(first);
                const isEnabled = tasks.some(t => t.enabled);
                const timeStr = tasks.map(t => t.time).sort().join(' & ');
                const freqLabel = tasks.length > 1 ? i18n.t('settings.twice_daily') : i18n.t('settings.once_daily');
                const hoursLabel = first.hours ? `${first.hours}h` : '24h';
                const hasPush = first.pushEnabled;

                const card = document.createElement('div');
                card.style.cssText = `
                    background: var(--card-bg);
                    padding: 14px 16px;
                    border-radius: var(--radius);
                    margin-bottom: 8px;
                    box-shadow: var(--card-shadow);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border: none;
                    transition: box-shadow 0.2s;
                `;

                card.innerHTML = `
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 700; font-size: 1em; color: var(--title-color); margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${scopeName}
                        </div>
                        <div style="font-size: 0.85em; color: var(--meta-color); display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                            <span>${freqLabel}</span>
                            <span style="opacity: 0.4;">·</span>
                            <span style="font-family: monospace;">${timeStr}</span>
                            <span style="opacity: 0.4;">·</span>
                            <span>${hoursLabel}</span>
                            ${hasPush ? `<span style="opacity: 0.4;">·</span><span title="${i18n.t('settings.push_notification')}">🔔</span>` : ''}
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; margin-left: 8px; align-items: center;">
                        <label class="switch" style="margin: 0;">
                            <input type="checkbox" class="toggle-task-btn" ${isEnabled ? 'checked' : ''}>
                            <span class="slider round"></span>
                        </label>
                        <button class="icon-btn edit-task-btn" title="${i18n.t('ai.scheduled_digest')}" style="width: 28px; height: 28px; opacity: 0.7; transition: opacity 0.2s;">
                            ${Icons.edit}
                        </button>
                        <button class="icon-btn delete-task-btn" title="${i18n.t('digest.delete')}" style="color: var(--danger-color); width: 28px; height: 28px; opacity: 0.7; transition: opacity 0.2s;">
                            ${Icons.delete}
                        </button>
                    </div>
                `;

                // Update card opacity based on enabled state
                card.style.opacity = isEnabled ? '1' : '0.6';

                // Toggle enabled/disabled
                card.querySelector('.toggle-task-btn').addEventListener('change', async (e) => {
                    const newEnabled = e.target.checked;

                    // Update all tasks in this group
                    tasks.forEach(t => { t.enabled = newEnabled; });

                    // Update card opacity
                    card.style.opacity = newEnabled ? '1' : '0.6';

                    try {
                        const response = await fetch(API_ENDPOINTS.PREFERENCES.BASE, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${AuthManager.getToken()}`
                            },
                            body: JSON.stringify({
                                key: 'digest_schedules',
                                value: allSchedules
                            })
                        });
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    } catch (err) {
                        console.error('Toggle task failed:', err);
                        // Revert on error
                        e.target.checked = !newEnabled;
                        tasks.forEach(t => { t.enabled = !newEnabled; });
                        card.style.opacity = !newEnabled ? '1' : '0.6';
                        showToast(i18n.t('common.error'), 2000, false);
                    }
                });

                // Edit: open schedule dialog for this scope
                card.querySelector('.edit-task-btn').addEventListener('click', () => {
                    close();
                    const context = {};
                    if (first.scope === 'feed') context.feedId = first.scopeId || first.feedId;
                    if (first.scope === 'group') context.groupId = first.scopeId || first.groupId;
                    this.showDigestScheduleDialog(context);
                });

                // Delete
                card.querySelector('.delete-task-btn').addEventListener('click', async () => {
                    if (!await Modal.confirm(i18n.t('settings.confirm_delete_schedule'))) return;

                    // Remove these tasks
                    allSchedules = allSchedules.filter(t => !tasks.includes(t));

                    try {
                        const response = await fetch(API_ENDPOINTS.PREFERENCES.BASE, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${AuthManager.getToken()}`
                            },
                            body: JSON.stringify({
                                key: 'digest_schedules',
                                value: allSchedules
                            })
                        });
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        renderTasks();
                    } catch (err) {
                        console.error('Delete task failed:', err);
                        showToast(i18n.t('common.error'), 2000, false);
                    }
                });

                listContainer.appendChild(card);
            });
        };

        // Add button → go to schedule dialog
        addBtn.addEventListener('click', () => {
            close();
            this.showDigestScheduleDialog({});
        });

        loadTasks();
    },
};
