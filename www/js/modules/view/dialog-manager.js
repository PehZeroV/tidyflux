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

                <div class="digest-manager-section">
                    <div style="font-weight: 600; margin-bottom: 4px;">${i18n.t('digest.task_list')}</div>
                    <div style="font-size: 0.8em; color: var(--meta-color); margin-bottom: 10px;">${i18n.t('digest.task_list_hint')}</div>
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
                </div>

                <!-- Timezone Settings -->
                <div class="digest-manager-section" style="margin-top: 16px; border-top: 1px solid var(--border-color); padding-top: 16px;">
                    <div style="font-weight: 600; margin-bottom: 12px;">${i18n.t('settings.timezone')}</div>
                    <div style="margin-bottom: 8px;">
                        <select id="manager-timezone-select" class="auth-input" style="margin-bottom: 0; cursor: pointer;">
                            <option value="">${i18n.t('settings.timezone_system_default')}</option>
                        </select>
                    </div>
                    <div id="manager-timezone-preview" style="font-size: 0.8em; color: var(--meta-color); margin-bottom: 0;"></div>
                </div>

                <!-- Digest Prompt Settings -->
                <div class="digest-manager-section" style="margin-top: 16px; border-top: 1px solid var(--border-color); padding-top: 16px;">
                    <div style="font-weight: 600; margin-bottom: 6px;">${i18n.t('ai.digest_prompt')}</div>
                    <div style="font-size: 0.8em; color: var(--meta-color); margin-bottom: 10px;">${i18n.t('digest.prompt_hint')}</div>
                    <div style="margin-bottom: 12px;">
                        <textarea id="manager-digest-prompt" class="auth-input" rows="5" placeholder="${i18n.t('ai.digest_prompt_placeholder')}" style="margin-bottom: 8px; resize: vertical; min-height: 96px;"></textarea>
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
                <div class="digest-manager-section" style="margin-top: 16px; border-top: 1px solid var(--border-color); padding-top: 16px;">
                    <div style="font-weight: 600; margin-bottom: 6px;">${i18n.t('settings.push_notification')}</div>
                    <div style="font-size: 0.8em; color: var(--meta-color); margin-bottom: 10px;">${i18n.t('settings.push_section_hint')}</div>
                    <div id="global-push-config">
                        <div style="margin-bottom: 12px;">
                            <div class="settings-item-label" style="margin-bottom: 6px;">${i18n.t('settings.push_url')}</div>
                            <input type="text" id="global-push-url" class="auth-input" placeholder="${i18n.t('settings.push_url_placeholder')}" style="margin-bottom: 0;">
                        </div>
                        <div style="margin-bottom: 12px;">
                            <div class="settings-item-label" style="margin-bottom: 6px;">${i18n.t('settings.push_method')}</div>
                            <div class="appearance-mode-group" style="margin-bottom: 0;">
                                <button type="button" class="appearance-mode-btn" data-push-method="GET">GET</button>
                                <button type="button" class="appearance-mode-btn active" data-push-method="POST">POST</button>
                            </div>
                        </div>
                        <div id="global-push-url-hint-get" style="font-size: 0.8em; color: var(--meta-color); margin-bottom: 12px; display: none;">${i18n.t('settings.push_url_hint_get')}</div>
                        <div id="global-push-body-section" style="margin-bottom: 12px;">
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

                <!-- Execution Log -->
                <div class="digest-manager-section" style="margin-top: 16px; border-top: 1px solid var(--border-color); padding-top: 16px;">
                    <div style="font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
                        <span>${i18n.t('digest.log_title')}</span>
                    </div>
                    <div id="digest-log-list">
                        <div style="text-align: center; padding: 12px; color: var(--meta-color); font-size: 0.9em;">
                            ${i18n.t('common.loading')}
                        </div>
                    </div>
                    <div id="digest-log-load-more" style="display: none; margin-top: 8px;">
                        <div class="appearance-mode-group">
                            <button type="button" id="digest-log-more-btn" class="appearance-mode-btn" style="justify-content: center; width: 100%;">
                                ${i18n.t('digest.log_load_more')}
                            </button>
                        </div>
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

        // Timezone elements
        const timezoneSelect = dialog.querySelector('#manager-timezone-select');
        const timezonePreview = dialog.querySelector('#manager-timezone-preview');

        // Common IANA timezone list
        const timezones = [
            'Pacific/Midway', 'Pacific/Honolulu', 'America/Anchorage',
            'America/Los_Angeles', 'America/Denver', 'America/Chicago',
            'America/New_York', 'America/Sao_Paulo',
            'Atlantic/Reykjavik', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
            'Europe/Moscow', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok',
            'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
            'Australia/Sydney', 'Pacific/Auckland'
        ];

        // Populate timezone dropdown
        timezones.forEach(tz => {
            const opt = document.createElement('option');
            opt.value = tz;
            try {
                const now = new Date();
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: tz,
                    timeZoneName: 'shortOffset'
                });
                const parts = formatter.formatToParts(now);
                const offsetPart = parts.find(p => p.type === 'timeZoneName');
                const offset = offsetPart ? offsetPart.value : '';
                opt.textContent = `${tz.replace(/_/g, ' ')} (${offset})`;
            } catch {
                opt.textContent = tz.replace(/_/g, ' ');
            }
            timezoneSelect.appendChild(opt);
        });

        // Server timezone info (will be filled by API call)
        let serverEffectiveTz = '';

        // Fetch server timezone and update default option label
        (async () => {
            try {
                const resp = await fetch(API_ENDPOINTS.PREFERENCES.SERVER_TIMEZONE, {
                    headers: { 'Authorization': `Bearer ${AuthManager.getToken()}` }
                });
                if (resp.ok) {
                    const { envTZ, systemTimezone } = await resp.json();
                    serverEffectiveTz = envTZ || systemTimezone || '';
                    const defaultOpt = timezoneSelect.querySelector('option[value=""]');
                    if (defaultOpt && serverEffectiveTz) {
                        const source = envTZ ? i18n.t('settings.env_var') : '';
                        defaultOpt.textContent = `${serverEffectiveTz.replace(/_/g, ' ')}${source}`;
                    }
                    updateTimezonePreview();
                }
            } catch (e) {
                console.warn('Failed to fetch server timezone:', e);
            }
        })();

        // Update preview showing current time in selected timezone
        let timezonePreviewTimer = null;
        const updateTimezonePreview = () => {
            const tz = timezoneSelect.value || serverEffectiveTz;
            if (!tz) {
                timezonePreview.textContent = '';
                return;
            }
            try {
                const now = new Date();
                const timeStr = now.toLocaleTimeString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                timezonePreview.textContent = `${i18n.t('settings.timezone_current_time')}: ${timeStr}`;
            } catch {
                timezonePreview.textContent = '';
            }
        };

        timezoneSelect.addEventListener('change', async () => {
            updateTimezonePreview();
            // Auto-save on change
            try {
                const response = await fetch(API_ENDPOINTS.PREFERENCES.BASE, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${AuthManager.getToken()}`
                    },
                    body: JSON.stringify({
                        key: 'digest_timezone',
                        value: timezoneSelect.value
                    })
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                showToast(`✓ ${i18n.t('settings.save_success')}`, 1500, false);
            } catch (err) {
                console.error('Save timezone failed:', err);
                showToast(`✗ ${i18n.t('common.error')}`, 2000, false);
            }
        });
        updateTimezonePreview();
        timezonePreviewTimer = setInterval(updateTimezonePreview, 1000);

        // Cleanup timer when dialog closes
        const observer = new MutationObserver(() => {
            if (!document.body.contains(dialog)) {
                clearInterval(timezonePreviewTimer);
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

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
        const globalPushBodySection = dialog.querySelector('#global-push-body-section');
        const globalPushUrlHintGet = dialog.querySelector('#global-push-url-hint-get');
        const pushMethodBtns = dialog.querySelectorAll('[data-push-method]');

        // Track selected push method
        let selectedPushMethod = 'POST';

        const updatePushMethodUI = () => {
            pushMethodBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.pushMethod === selectedPushMethod);
            });
            if (selectedPushMethod === 'GET') {
                globalPushBodySection.style.display = 'none';
                globalPushUrlHintGet.style.display = '';
            } else {
                globalPushBodySection.style.display = '';
                globalPushUrlHintGet.style.display = 'none';
            }
        };

        pushMethodBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                selectedPushMethod = btn.dataset.pushMethod;
                updatePushMethodUI();
            });
        });




        globalPushTestBtn.addEventListener('click', async () => {
            const urlTemplate = globalPushUrl.value.trim();
            if (!urlTemplate) {
                globalPushMsg.textContent = `✗ ${i18n.t('settings.push_url')}`;
                globalPushMsg.style.color = 'var(--danger-color)';
                return;
            }
            globalPushTestBtn.disabled = true;
            globalPushMsg.textContent = '...';
            globalPushMsg.style.color = 'var(--meta-color)';
            try {
                let testUrl = urlTemplate;
                let testBody = undefined;
                if (selectedPushMethod === 'GET') {
                    testUrl = urlTemplate
                        .replace(/\{\{title\}\}/g, encodeURIComponent('Test Digest Title'))
                        .replace(/\{\{digest_content\}\}/g, encodeURIComponent('This is a test push notification.'));
                } else {
                    let bodyTemplate = globalPushBody.value.trim();

                    // Intelligent Body Auto-fill
                    if (!bodyTemplate) {
                        const lowerUrl = urlTemplate.toLowerCase();
                        if (lowerUrl.includes('discord.com')) {
                            bodyTemplate = '{"content": "**{{title}}**\\n{{digest_content}}"}';
                        } else if (lowerUrl.includes('dingtalk.com')) {
                            bodyTemplate = '{"msgtype": "text", "text": {"content": "【{{title}}】\\n{{digest_content}}"}}';
                        } else if (lowerUrl.includes('feishu.cn') || lowerUrl.includes('larksuite.com')) {
                            bodyTemplate = '{"msg_type": "text", "content": {"text": "【{{title}}】\\n{{digest_content}}"}}';
                        } else if (lowerUrl.includes('slack.com')) {
                            bodyTemplate = '{"text": "*{{title}}*\\n{{digest_content}}"}';
                        } else {
                            // Default generic JSON
                            bodyTemplate = '{"title": "{{title}}", "content": "{{digest_content}}"}';
                        }
                        // Auto-fill the textarea for the user
                        globalPushBody.value = bodyTemplate;

                        // Flash message to inform user
                        showToast(i18n.t('settings.push_autofill_hint') || 'Auto-filled body template', 2000, false);
                    } else {
                        // Validate existing JSON
                        try {
                            JSON.parse(bodyTemplate);
                        } catch (e) {
                            // Only warn if it looks like they are trying to write JSON
                            if (bodyTemplate.startsWith('{')) {
                                globalPushMsg.textContent = `✗ ${i18n.t('common.error')}: Invalid JSON format`;
                                globalPushMsg.style.color = 'var(--danger-color)';
                                globalPushTestBtn.disabled = false;
                                setTimeout(() => { globalPushMsg.textContent = ''; }, 3000);
                                return;
                            }
                        }
                    }

                    testBody = bodyTemplate
                        .replace(/\{\{title\}\}/g, 'Test Digest Title')
                        .replace(/\{\{digest_content\}\}/g, 'This is a test push notification.');
                }
                const resp = await fetch(API_ENDPOINTS.DIGEST.TEST_PUSH, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${AuthManager.getToken()}`
                    },
                    body: JSON.stringify({ url: testUrl, body: testBody, method: selectedPushMethod })
                });
                const result = await resp.json();
                if (result.ok) {
                    globalPushMsg.textContent = `✓ ${i18n.t('settings.push_test_success')}`;
                    globalPushMsg.style.color = 'var(--accent-color)';
                } else {
                    let errMsg = result.response || result.status;
                    if (errMsg && errMsg.length > 50) errMsg = errMsg.substring(0, 50) + '...';
                    globalPushMsg.textContent = `✗ HTTP ${result.status}: ${errMsg}`;
                    globalPushMsg.style.color = 'var(--danger-color)';
                }
            } catch (err) {
                globalPushMsg.textContent = `✗ ${i18n.t('settings.push_test_failed')}`;
                globalPushMsg.style.color = 'var(--danger-color)';
            }
            globalPushTestBtn.disabled = false;
            // setTimeout(() => { globalPushMsg.textContent = ''; }, 5000); // Wait longer for error
        });

        const savePushConfig = async () => {
            try {
                const pushConfig = {
                    url: globalPushUrl.value.trim(),
                    method: selectedPushMethod,
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
                selectedPushMethod = pushCfg.method || 'POST';
                updatePushMethodUI();

                // Load timezone
                const savedTz = prefs.digest_timezone || '';
                timezoneSelect.value = savedTz;
                updateTimezonePreview();

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
                    <div class="digest-manager-empty" style="text-align: center; padding: 28px 20px; color: var(--meta-color); font-size: 0.95em;">
                        <div style="margin-bottom: 8px;">${i18n.t('digest.no_scheduled_tasks')}</div>
                        <div style="font-size: 0.85em; opacity: 0.9;">${i18n.t('digest.task_list_hint')}</div>
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

            // Sort: enabled tasks first (pinned), then by earliest time ascending
            const sortedKeys = Object.keys(grouped).sort((a, b) => {
                const tasksA = grouped[a];
                const tasksB = grouped[b];
                const enabledA = tasksA.some(t => t.enabled);
                const enabledB = tasksB.some(t => t.enabled);

                // Enabled tasks come first
                if (enabledA !== enabledB) return enabledA ? -1 : 1;

                // Within same enabled state, sort by earliest time
                const minTimeA = tasksA.map(t => t.time).sort()[0] || '';
                const minTimeB = tasksB.map(t => t.time).sort()[0] || '';
                return minTimeA.localeCompare(minTimeB);
            });

            sortedKeys.forEach(key => {
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
                        <button class="icon-btn run-task-btn" title="${i18n.t('digest.run_now') || 'Run Now'}" style="width: 28px; height: 28px; opacity: 0.7; transition: opacity 0.2s;">
                            ${Icons.play_arrow}
                        </button>
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

                // Run Now
                card.querySelector('.run-task-btn').addEventListener('click', async (e) => {
                    const btn = e.currentTarget;
                    if (btn.disabled) return;

                    // Check AI configuration before running
                    if (!AIService.isConfigured()) {
                        await Modal.alertWithSettings(
                            i18n.t('digest.ai_not_configured'),
                            i18n.t('common.go_to_settings'),
                            () => this.showSettingsDialog(false)
                        );
                        return;
                    }

                    // Find index of the first task in this group within allSchedules
                    // We trigger the first one as representative (layout/hours usually same)
                    const taskIndex = allSchedules.indexOf(tasks[0]);
                    if (taskIndex === -1) return;

                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                    const originalIcon = btn.innerHTML;
                    btn.innerHTML = Icons.spinner; // Spinner icon

                    showToast(i18n.t('digest.generating') || 'Generating digest...', 3000);

                    try {
                        const response = await fetch(API_ENDPOINTS.DIGEST.RUN_TASK || '/api/digest/run-task', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${AuthManager.getToken()}`
                            },
                            body: JSON.stringify({ taskIndex })
                        });

                        const result = await response.json();
                        if (response.ok && result.success) {
                            // Check if no articles were found
                            if (result.digest && (result.digest.articleCount === 0 || !result.digest.id)) {
                                const hours = first.hours || 24;
                                const noArticlesMsg = result.digest.content || i18n.t('digest.no_articles', { hours });
                                showToast(noArticlesMsg, 3000, false);
                                return;
                            }
                            let msg = i18n.t('digest.manager_success');
                            if (result.push) {
                                if (result.push.attempted) {
                                    msg += result.push.success
                                        ? ` & ${i18n.t('digest.push_success', { status: result.push.status || 'OK' })}`
                                        : ` (${i18n.t('digest.push_failed', { status: result.push.status || '' })})`;
                                } else if (result.push.reason === 'not_configured') {
                                    msg += ` (${i18n.t('digest.push_not_configured')})`;
                                } else if (result.push.reason === 'disabled') {
                                    msg += ` (${i18n.t('digest.push_disabled')})`;
                                }
                            }
                            showToast(msg, 3000, false);
                        } else {
                            throw new Error(result.error || 'Failed');
                        }
                    } catch (err) {
                        console.error('Run task failed:', err);
                        showToast(`${i18n.t('common.error')}: ${err.message}`, 3000, false);
                    } finally {
                        btn.disabled = false;
                        btn.style.opacity = '0.7';
                        btn.innerHTML = originalIcon;
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
            this.showDigestScheduleDialog({ noPreselect: true });
        });

        loadTasks();

        // ==================== Execution Logs ====================
        const logListContainer = dialog.querySelector('#digest-log-list');
        const logLoadMoreWrapper = dialog.querySelector('#digest-log-load-more');
        const logLoadMoreBtn = dialog.querySelector('#digest-log-more-btn');
        let logOffset = 0;
        let logTotal = 0;
        const LOG_PAGE_SIZE = 20;

        const formatLogTime = (isoStr) => {
            if (!isoStr) return '';
            try {
                // isoStr is UTC from SQLite (e.g. "2026-02-22 12:15:10")
                const d = new Date(isoStr + 'Z');
                const pad = n => String(n).padStart(2, '0');
                return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
            } catch {
                return isoStr;
            }
        };

        const getStatusBadge = (status) => {
            if (status === 'success') return `<span style="color: var(--accent-color); font-weight: 600;">${i18n.t('digest.log_success')}</span>`;
            if (status === 'failed') return `<span style="color: var(--danger-color); font-weight: 600;">${i18n.t('digest.log_failed')}</span>`;
            return `<span style="color: var(--meta-color);">${i18n.t('digest.log_skipped')}</span>`;
        };

        const getTriggerBadge = (triggeredBy) => {
            if (triggeredBy === 'manual') return `<span style="background: var(--accent-color); color: #fff; padding: 1px 6px; border-radius: 4px; font-size: 0.75em;">${i18n.t('digest.log_manual')}</span>`;
            return `<span style="background: var(--meta-color); color: #fff; padding: 1px 6px; border-radius: 4px; font-size: 0.75em; opacity: 0.7;">${i18n.t('digest.log_scheduler')}</span>`;
        };

        const getPushBadge = (pushStatus) => {
            if (!pushStatus || pushStatus === 'disabled') return '';
            if (pushStatus === 'success') return `<span style="font-size: 0.8em;">🔔 ✅</span>`;
            if (pushStatus === 'failed') return `<span style="font-size: 0.8em;">🔔 ❌</span>`;
            if (pushStatus === 'not_configured') return `<span style="font-size: 0.8em;">🔔 ⚠️</span>`;
            return '';
        };

        const renderLogItem = (log) => {
            const scopeName = log.scope_name || (log.scope === 'all' ? i18n.t('nav.all') : `#${log.scope_id || ''}`);
            const statusBadge = getStatusBadge(log.status);
            const triggerBadge = getTriggerBadge(log.triggered_by);
            const pushBadge = getPushBadge(log.push_status);
            const timeStr = formatLogTime(log.created_at);
            const duration = log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : '';

            let details = '';
            if (log.status === 'success') {
                details = `<span>${i18n.t('digest.log_articles', { count: log.article_count || 0 })}</span>`;
                if (duration) details += ` <span style="opacity: 0.5;">·</span> <span>${duration}</span>`;
                const pt = log.prompt_tokens || 0;
                const ct = log.completion_tokens || 0;
                if (pt > 0 || ct > 0) {
                    const fmt = n => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
                    details += ` <span style="opacity: 0.5;">·</span> <span style="font-family: monospace; font-size: 0.9em;">↑${fmt(pt)} ↓${fmt(ct)}</span>`;
                }
            } else if (log.error) {
                details = `<span style="color: var(--danger-color);">${log.error}</span>`;
            }

            const div = document.createElement('div');
            div.style.cssText = 'padding: 8px 12px; border-radius: var(--radius); background: var(--card-bg); margin-bottom: 4px; font-size: 0.85em; box-shadow: var(--card-shadow);';
            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;">
                        ${triggerBadge}
                        <span style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${scopeName}</span>
                        ${pushBadge}
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                        ${statusBadge}
                    </div>
                </div>
                ${details ? `<div style="margin-top: 4px; color: var(--meta-color); font-size: 0.9em; display: flex; gap: 6px; align-items: center;">
                    <span style="font-family: monospace; opacity: 0.7;">${timeStr}</span>
                    <span style="opacity: 0.4;">·</span>
                    ${details}
                </div>` : `<div style="margin-top: 2px; font-family: monospace; color: var(--meta-color); font-size: 0.85em; opacity: 0.7;">${timeStr}</div>`}
                ${log.push_error ? `<div style="margin-top: 2px; font-size: 0.8em; color: var(--danger-color);">🔔 ${log.push_error}</div>` : ''}
            `;
            return div;
        };

        const loadLogs = async (append = false) => {
            try {
                const resp = await fetch(`${API_ENDPOINTS.DIGEST.LOGS}?limit=${LOG_PAGE_SIZE}&offset=${logOffset}`, {
                    headers: { 'Authorization': `Bearer ${AuthManager.getToken()}` }
                });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                logTotal = data.total || 0;

                if (!append) logListContainer.innerHTML = '';

                if (data.logs && data.logs.length > 0) {
                    data.logs.forEach(log => {
                        logListContainer.appendChild(renderLogItem(log));
                    });
                    logOffset += data.logs.length;
                } else if (!append) {
                    logListContainer.innerHTML = `
                        <div style="text-align: center; padding: 16px; color: var(--meta-color); font-size: 0.9em;">
                            ${i18n.t('digest.log_empty')}
                        </div>
                    `;
                }

                // Show/hide load more button
                logLoadMoreWrapper.style.display = logOffset < logTotal ? '' : 'none';
            } catch (err) {
                console.error('Load digest logs error:', err);
                if (!append) {
                    logListContainer.innerHTML = `
                        <div style="text-align: center; padding: 12px; color: var(--danger-color); font-size: 0.9em;">
                            ${i18n.t('common.load_error')}
                        </div>
                    `;
                }
            }
        };

        logLoadMoreBtn.addEventListener('click', () => loadLogs(true));

        // Initial load of logs
        loadLogs();
    },
};
