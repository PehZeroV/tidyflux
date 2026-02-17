/**
 * ScheduleDialog - 定时简报配置对话框模块
 * @module view/schedule-dialog
 */

import { AppState } from '../../state.js';
import { AuthManager } from '../auth-manager.js';
import { createDialog } from './utils.js';
import { i18n } from '../i18n.js';
import { API_ENDPOINTS } from '../../constants.js';
import { Icons } from '../icons.js';

// UUID 生成辅助函数（兼容旧版浏览器）
function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 定时简报配置对话框相关方法
 * 通过 mixin 模式合并到 Dialogs 对象
 */
export const ScheduleDialogMixin = {
    /**
     * 显示定时简报配置对话框
     *
     * @param {Object} context - { feedId, groupId } 如果都为空则针对 'all'
     */
    showDigestScheduleDialog(context = {}) {
        const { feedId, groupId } = context;
        let scope = 'all';
        let scopeId = null;

        if (groupId) {
            scope = 'group';
            scopeId = groupId;
        } else if (feedId) {
            scope = 'feed';
            scopeId = feedId;
        }

        // Build scope checkbox list
        const groups = AppState.groups || [];
        const feeds = AppState.feeds || [];
        const initialScopeValue = scope === 'all' ? 'all' : `${scope}_${scopeId}`;

        const checkboxStyle = 'display: flex; align-items: center; gap: 6px; padding: 5px 8px; cursor: pointer; border-radius: calc(var(--radius) - 2px); font-size: 0.82em; overflow: hidden;';
        const cbInputStyle = 'width: 14px; height: 14px; flex-shrink: 0; cursor: pointer; accent-color: var(--accent-color);';
        const groupLabelStyle = 'padding: 6px 8px 2px; font-size: 0.72em; font-weight: 700; color: var(--meta-color); border-top: 1px solid var(--border-color); margin-top: 2px; grid-column: 1 / -1;';

        let scopeListHtml = `
            <label style="${checkboxStyle}" title="${i18n.t('nav.all')}">
                <input type="checkbox" value="all" style="${cbInputStyle}">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${i18n.t('nav.all')}</span>
            </label>`;

        if (groups.length > 0) {
            scopeListHtml += `<div style="${groupLabelStyle}">${i18n.t('nav.categories')}</div>`;
            groups.forEach(g => {
                scopeListHtml += `
                    <label style="${checkboxStyle}" title="${g.name}">
                        <input type="checkbox" value="group_${g.id}" style="${cbInputStyle}">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${g.name}</span>
                    </label>`;
            });
        }

        if (feeds.length > 0) {
            scopeListHtml += `<div style="${groupLabelStyle}">${i18n.t('nav.feeds')}</div>`;
            groups.forEach(g => {
                const groupFeeds = feeds.filter(f => f.category?.id == g.id);
                groupFeeds.forEach(f => {
                    scopeListHtml += `
                        <label style="${checkboxStyle}" title="${f.title}">
                            <input type="checkbox" value="feed_${f.id}" style="${cbInputStyle}">
                            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${f.title}</span>
                        </label>`;
                });
            });
            const ungroupedFeeds = feeds.filter(f => !f.category?.id || !groups.find(g => g.id == f.category?.id));
            ungroupedFeeds.forEach(f => {
                scopeListHtml += `
                    <label style="${checkboxStyle}" title="${f.title}">
                        <input type="checkbox" value="feed_${f.id}" style="${cbInputStyle}">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${f.title}</span>
                    </label>`;
            });
        }

        const { dialog, close } = createDialog('settings-dialog', `
            <div class="settings-dialog-content" style="position: relative; max-width: 400px; min-height: 480px;">
                <button class="icon-btn close-dialog-btn" title="${i18n.t('settings.close')}" style="position: absolute; right: 16px; top: 16px; width: 32px; height: 32px;">
                    ${Icons.close}
                </button>
                <h3>${i18n.t('ai.scheduled_digest')}</h3>

                <div style="margin-bottom: 20px;">
                    <div class="settings-item-label" style="margin-bottom: 8px;">${i18n.t('ai.digest_target')}</div>
                    <div id="schedule-scope-list" style="max-height: 200px; overflow-y: auto; border-radius: var(--radius); background: var(--card-bg); box-shadow: var(--card-shadow); backdrop-filter: blur(var(--glass-blur)); -webkit-backdrop-filter: blur(var(--glass-blur)); padding: 4px; display: grid; grid-template-columns: 1fr 1fr; gap: 1px;">
                        ${scopeListHtml}
                    </div>
                    <div id="scope-selection-hint" style="font-size: 0.8em; margin-top: 6px;"></div>
                </div>

                <div class="schedule-loader" style="text-align: center; padding: 20px;">
                    ${i18n.t('common.loading')}
                </div>

                <form id="schedule-form" style="display: none;">
                    
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
                         <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-weight: 600;">${i18n.t('settings.enable')}</span>
                            <label class="switch">
                                <input type="checkbox" id="schedule-enabled">
                                <span class="slider round"></span>
                            </label>
                        </div>
                    </div>



                    <div id="schedule-config-area" style="transition: opacity 0.3s;">
                        <!-- Frequency Selection -->
                        <div style="margin-bottom: 20px;">
                            <div class="settings-item-label" style="margin-bottom: 8px;">${i18n.t('settings.frequency')}</div>
                            <div class="appearance-mode-group" style="margin-bottom: 0;">
                                <button type="button" class="appearance-mode-btn active" id="freq-once" style="flex: 1; justify-content: center;">
                                    ${i18n.t('settings.once_daily')}
                                </button>
                                <button type="button" class="appearance-mode-btn" id="freq-twice" style="flex: 1; justify-content: center;">
                                    ${i18n.t('settings.twice_daily')}
                                </button>
                            </div>
                            <p id="freq-desc" style="font-size: 0.85em; color: var(--meta-color); margin-top: 6px;">
                                ${i18n.t('settings.once_daily_desc')}
                            </p>
                        </div>

                        <!-- Time Picker -->
                        <div class="custom-time-picker" id="custom-time-picker" style="margin-bottom: 12px;">
                            <div class="time-picker-highlight"></div>
                            <div class="time-column hours-column">
                                ${Array.from({ length: 24 }, (_, i) => `<div class="time-item" data-value="${String(i).padStart(2, '0')}">${String(i).padStart(2, '0')}</div>`).join('')}
                            </div>
                            <div class="time-colon">:</div>
                            <div class="time-column minutes-column">
                                ${Array.from({ length: 12 }, (_, i) => {
            const min = i * 5;
            return `<div class="time-item" data-value="${String(min).padStart(2, '0')}">${String(min).padStart(2, '0')}</div>`;
        }).join('')}
                            </div>
                        </div>

                        <!-- Second Time Preview -->
                        <div id="second-time-preview" style="text-align: center; margin-bottom: 20px; font-size: 0.9em; color: var(--accent-color); display: none;">
                            <!-- JS filled -->
                        </div>

                        <!-- Include Read & Push Toggle -->
                        <div style="border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 8px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 10px;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" id="schedule-include-read" style="width: 16px; height: 16px; cursor: pointer;">
                                <span>${i18n.t('settings.include_read')}</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" id="schedule-push-enabled" style="width: 16px; height: 16px; cursor: pointer;">
                                <span>${i18n.t('settings.push_notification')}</span>
                            </label>
                        </div>
                    </div>

                    <div class="appearance-mode-group">
                        <button type="submit" class="appearance-mode-btn active" style="justify-content: center; width: 100%;">${i18n.t('common.save')}</button>
                    </div>
                    <div id="schedule-msg" style="text-align: center; margin-top: 12px; font-size: 0.85em;"></div>
                    
                    <div style="margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 16px; text-align: center;">
                         <button type="button" id="manage-others-btn" style="background: transparent; border: none; color: var(--meta-color); font-size: 0.9em; cursor: pointer; text-decoration: underline;">
                             ${i18n.t('settings.manage_all_schedules')}
                         </button>
                    </div>
                </form>
            </div>
        `);

        const loader = dialog.querySelector('.schedule-loader');
        const form = dialog.querySelector('#schedule-form');
        const enabledInput = dialog.querySelector('#schedule-enabled');
        const configArea = dialog.querySelector('#schedule-config-area');
        const scopeList = dialog.querySelector('#schedule-scope-list');
        const hintEl = dialog.querySelector('#scope-selection-hint');
        const includeReadInput = dialog.querySelector('#schedule-include-read');

        const freqOnceBtn = dialog.querySelector('#freq-once');
        const freqTwiceBtn = dialog.querySelector('#freq-twice');
        const freqDesc = dialog.querySelector('#freq-desc');
        const secondTimePreview = dialog.querySelector('#second-time-preview');

        const pickerContainer = dialog.querySelector('#custom-time-picker');
        const msgEl = dialog.querySelector('#schedule-msg');

        const manageOthersBtn = dialog.querySelector('#manage-others-btn');
        const pushEnabledInput = dialog.querySelector('#schedule-push-enabled');

        // Pre-check the initial scope checkbox
        const initialCheckbox = scopeList.querySelector(`input[value="${initialScopeValue}"]`);
        if (initialCheckbox) initialCheckbox.checked = true;

        // Scope parser helper
        const parseScope = (val) => {
            if (val === 'all') return { scope: 'all', scopeId: null };
            const [s, ...idParts] = val.split('_');
            return { scope: s, scopeId: idParts.join('_') };
        };

        // Logic state
        let allSchedules = [];
        let isTwiceDaily = false;
        let getPickerTime = () => '08:00';

        // --- Helpers ---

        const updateFrequencyUI = () => {
            const isUnread = !includeReadInput.checked;
            if (isTwiceDaily) {
                freqOnceBtn.classList.remove('active');
                freqTwiceBtn.classList.add('active');
                freqDesc.textContent = i18n.t(isUnread ? 'settings.twice_daily_desc' : 'settings.twice_daily_desc_all');
                secondTimePreview.style.display = 'block';
                updateSecondTimePreview();
            } else {
                freqTwiceBtn.classList.remove('active');
                freqOnceBtn.classList.add('active');
                freqDesc.textContent = i18n.t(isUnread ? 'settings.once_daily_desc' : 'settings.once_daily_desc_all');
                secondTimePreview.style.display = 'none';
            }
        };

        const updateSecondTimePreview = () => {
            if (!isTwiceDaily) return;
            const time = getPickerTime();
            const [h, m] = time.split(':').map(Number);
            const nextH = (h + 12) % 24;
            const nextTime = `${String(nextH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            secondTimePreview.innerHTML = `${i18n.t('settings.second_run_at')} <strong>${nextTime}</strong> (+12h)`;
        };

        const setupTimePicker = (container, initialTime) => {
            let [initH, initM] = (initialTime || '08:00').split(':');

            // Round minutes to nearest 5
            let mVal = parseInt(initM, 10);
            mVal = Math.round(mVal / 5) * 5;
            if (mVal >= 60) {
                mVal = 0;
            }
            initM = String(mVal).padStart(2, '0');

            const hCol = container.querySelector('.hours-column');
            const mCol = container.querySelector('.minutes-column');
            const ITEM_HEIGHT = 40;

            const selectItem = (col, value, smooth = true) => {
                const items = Array.from(col.querySelectorAll('.time-item'));
                items.forEach(el => el.classList.remove('active'));
                const target = items.find(el => el.dataset.value === value) || items[0];
                target.classList.add('active');
                if (smooth) {
                    col.scrollTo({ top: items.indexOf(target) * ITEM_HEIGHT, behavior: 'smooth' });
                } else {
                    col.scrollTop = items.indexOf(target) * ITEM_HEIGHT;
                }
            };

            const handleScroll = (col) => {
                const scrollTop = col.scrollTop;
                const index = Math.round(scrollTop / ITEM_HEIGHT);
                const items = col.querySelectorAll('.time-item');
                if (items[index]) {
                    items.forEach(el => el.classList.remove('active'));
                    items[index].classList.add('active');
                    if (isTwiceDaily) updateSecondTimePreview();
                }
            };

            [hCol, mCol].forEach(col => {
                col.addEventListener('click', e => {
                    if (e.target.classList.contains('time-item')) {
                        selectItem(col, e.target.dataset.value);
                        if (isTwiceDaily) updateSecondTimePreview();
                    }
                });
                let scrollTimeout;
                col.addEventListener('scroll', () => {
                    clearTimeout(scrollTimeout);
                    scrollTimeout = setTimeout(() => handleScroll(col), 100);
                });
            });

            // Init
            setTimeout(() => {
                selectItem(hCol, initH, false);
                selectItem(mCol, initM, false);
            }, 50);

            return () => {
                const h = hCol.querySelector('.active')?.dataset.value || '00';
                const m = mCol.querySelector('.active')?.dataset.value || '00';
                return `${h}:${m}`;
            };
        };

        // Get all selected scope values
        const getSelectedScopes = () => {
            return Array.from(scopeList.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
        };

        // Load schedule data for current selection
        const loadScheduleForScope = () => {
            const selected = getSelectedScopes();

            // Update hint
            if (selected.length > 1) {
                hintEl.textContent = i18n.t('digest.batch_hint', { count: selected.length });
                hintEl.style.color = 'var(--accent-color)';
            } else if (selected.length === 0) {
                hintEl.textContent = i18n.t('digest.no_target_selected');
                hintEl.style.color = 'var(--meta-color)';
            } else {
                hintEl.textContent = '';
            }

            let initialTime = '08:00';

            if (selected.length === 1) {
                // Single selection - load existing settings
                const parsed = parseScope(selected[0]);
                scope = parsed.scope;
                scopeId = parsed.scopeId;
                const existingTasks = allSchedules.filter(t =>
                    t.scope === scope && String(t.scopeId || '') === String(scopeId || '')
                );

                isTwiceDaily = existingTasks.length > 1;
                const firstTask = existingTasks[0];
                initialTime = firstTask ? firstTask.time : '08:00';
                const isEnabled = existingTasks.length > 0 && existingTasks.some(t => t.enabled);
                const isUnreadOnly = firstTask ? (firstTask.unreadOnly !== false) : true;

                enabledInput.checked = isEnabled;
                includeReadInput.checked = !isUnreadOnly;
                pushEnabledInput.checked = !!firstTask?.pushEnabled;
            } else {
                // Multiple or none: show defaults
                enabledInput.checked = true;
                includeReadInput.checked = false;
                pushEnabledInput.checked = false;
                isTwiceDaily = false;
            }

            configArea.style.opacity = enabledInput.checked ? '1' : '0.5';
            configArea.style.pointerEvents = enabledInput.checked ? 'auto' : 'none';
            getPickerTime = setupTimePicker(pickerContainer, initialTime);
            updateFrequencyUI();

            loader.style.display = 'none';
            form.style.display = 'block';
        };

        // --- Events ---

        freqOnceBtn.addEventListener('click', () => { isTwiceDaily = false; updateFrequencyUI(); });
        freqTwiceBtn.addEventListener('click', () => { isTwiceDaily = true; updateFrequencyUI(); });

        enabledInput.addEventListener('change', () => {
            configArea.style.opacity = enabledInput.checked ? '1' : '0.5';
            configArea.style.pointerEvents = enabledInput.checked ? 'auto' : 'none';
        });

        includeReadInput.addEventListener('change', () => {
            updateFrequencyUI();
        });

        // Scope change: reload schedule data
        scopeList.addEventListener('change', () => {
            loadScheduleForScope();
        });

        manageOthersBtn.addEventListener('click', () => {
            close();
            this.showDigestManagerDialog();
        });

        // --- Load Data ---

        fetch(API_ENDPOINTS.PREFERENCES.BASE, {
            headers: { 'Authorization': `Bearer ${AuthManager.getToken()}` }
        })
            .then(res => res.json())
            .then(prefs => {
                allSchedules = prefs.digest_schedules || [];
                loadScheduleForScope();
            })
            .catch(err => {
                console.error('Load error', err);
                loader.textContent = i18n.t('common.load_error');
            });

        // --- Save ---

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button[type="submit"]');

            const selectedScopes = getSelectedScopes();
            if (selectedScopes.length === 0) {
                msgEl.textContent = i18n.t('digest.no_target_selected');
                msgEl.style.color = 'var(--danger-color)';
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = i18n.t('settings.saving');
            msgEl.textContent = '';

            const time = getPickerTime();
            const isEnabled = enabledInput.checked;
            const unreadOnly = !includeReadInput.checked;

            // Build new tasks for all selected scopes
            const newTasks = [];
            const selectedParsed = selectedScopes.map(parseScope);

            selectedParsed.forEach(({ scope: s, scopeId: sid }) => {
                const baseTask = {
                    scope: s,
                    scopeId: sid,
                    feedId: s === 'feed' ? sid : null,
                    groupId: s === 'group' ? sid : null,
                    enabled: isEnabled,
                    unreadOnly: unreadOnly,
                    pushEnabled: pushEnabledInput.checked,
                };

                if (isTwiceDaily) {
                    newTasks.push({ ...baseTask, id: generateUUID(), time: time, hours: 12 });
                    const [h, m] = time.split(':').map(Number);
                    const nextH = (h + 12) % 24;
                    const nextTime = `${String(nextH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                    newTasks.push({ ...baseTask, id: generateUUID(), time: nextTime, hours: 12 });
                } else {
                    newTasks.push({ ...baseTask, id: generateUUID(), time: time, hours: 24 });
                }
            });

            // Remove old tasks for all selected scopes, keep others
            const isSelected = (t) => selectedParsed.some(p =>
                t.scope === p.scope && String(t.scopeId || '') === String(p.scopeId || '')
            );
            const otherTasks = allSchedules.filter(t => !isSelected(t));
            const finalTasks = [...otherTasks, ...newTasks];

            try {
                const response = await fetch(API_ENDPOINTS.PREFERENCES.BASE, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${AuthManager.getToken()}`
                    },
                    body: JSON.stringify({
                        key: 'digest_schedules',
                        value: finalTasks
                    })
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                allSchedules = finalTasks;
                msgEl.textContent = `✓ ${i18n.t('settings.save_success')}`;
                msgEl.style.color = 'var(--accent-color)';
                submitBtn.disabled = false;
                submitBtn.textContent = i18n.t('common.save');
                setTimeout(() => { if (msgEl.style.color !== 'var(--danger-color)') msgEl.textContent = ''; }, 2000);
            } catch (err) {
                console.error('Save error:', err);
                msgEl.textContent = `✗ ${i18n.t('ai.api_error')}`;
                msgEl.style.color = 'var(--danger-color)';
                submitBtn.disabled = false;
                submitBtn.textContent = i18n.t('common.save');
            }
        });
    },
};
