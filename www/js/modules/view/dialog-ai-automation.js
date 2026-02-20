/**
 * TranslationDialog - AI 自动化管理对话框（标题翻译 + 自动摘要）
 * @module view/dialog-ai-automation
 */

import { AppState } from '../../state.js';
import { createDialog } from './utils.js';
import { i18n } from '../i18n.js';
import { AIService } from '../ai-service.js';
import { Icons } from '../icons.js';
import { ArticlesTitleTranslation } from './articles-title-translation.js';

/**
 * AI 自动化管理对话框
 * 通过 mixin 模式合并到 Dialogs 对象
 */
export const TranslationDialogMixin = {
    /**
     * 显示 AI 自动化管理对话框
     * @param {'translation'|'summary'} [activeTab='translation'] - 初始显示的 tab
     */
    showTranslationDialog(activeTab = 'translation') {
        // 每次打开时从 AppState.preferences 重新加载覆盖数据，
        // 避免因 init 时 preferences 尚未加载导致显示不正确
        AIService._translationOM.load();
        AIService._summaryOM.load();
        AIService._translateOM.load();

        const aiConfig = AIService.getConfig();

        const { dialog } = createDialog('settings-dialog', `
            <div class="settings-dialog-content" style="position: relative; max-width: 500px;">
                <button class="icon-btn close-dialog-btn" title="${i18n.t('common.close')}" style="position: absolute; right: 16px; top: 16px; width: 32px; height: 32px; z-index: 10;">
                    ${Icons.close}
                </button>
                <h3>${i18n.t('ai.ai_automation')}</h3>

                <div class="digest-manager-section">
                    <!-- Tab 切换 -->
                    <div style="display: flex; gap: 0; margin-bottom: 16px; border-bottom: 1px solid var(--border-color);">
                        <button type="button" class="ai-auto-tab active" data-tab="translation" style="
                            flex: 1; padding: 10px 0; background: none; border: none; cursor: pointer;
                            font-size: 0.85em; font-weight: 600; color: var(--text-secondary);
                            border-bottom: 2px solid transparent; transition: all 0.2s;
                        ">${i18n.t('ai.title_translation')}</button>
                        <button type="button" class="ai-auto-tab" data-tab="translate" style="
                            flex: 1; padding: 10px 0; background: none; border: none; cursor: pointer;
                            font-size: 0.85em; font-weight: 600; color: var(--text-secondary);
                            border-bottom: 2px solid transparent; transition: all 0.2s;
                        ">${i18n.t('ai.auto_translate_article')}</button>
                        <button type="button" class="ai-auto-tab" data-tab="summary" style="
                            flex: 1; padding: 10px 0; background: none; border: none; cursor: pointer;
                            font-size: 0.85em; font-weight: 600; color: var(--text-secondary);
                            border-bottom: 2px solid transparent; transition: all 0.2s;
                        ">${i18n.t('ai.auto_summary')}</button>
                    </div>

                    <!-- Translation Tab -->
                    <div id="tab-panel-translation" class="ai-auto-tab-panel">
                        <div style="font-size: 0.8em; color: var(--meta-color); margin-bottom: 12px;">${i18n.t('ai.title_translation_hint')}</div>

                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
                            <label class="miniflux-input-label" style="font-size: 0.85em; margin: 0; white-space: nowrap;">${i18n.t('ai.title_translation_mode')}</label>
                            <div style="display: flex; gap: 10px;">
                                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 0.85em; color: var(--text-color);">
                                    <input type="radio" name="trans-mode" value="bilingual" style="accent-color: var(--accent-color); cursor: pointer;">
                                    ${i18n.t('ai.title_translation_bilingual')}
                                </label>
                                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 0.85em; color: var(--text-color);">
                                    <input type="radio" name="trans-mode" value="translated" style="accent-color: var(--accent-color); cursor: pointer;">
                                    ${i18n.t('ai.title_translation_translated')}
                                </label>
                            </div>
                        </div>

                        <div id="translation-feeds-list" style="max-height: 55vh; overflow-y: auto; background: var(--card-bg); border-radius: var(--radius); padding: 4px 0; box-shadow: var(--card-shadow); backdrop-filter: blur(var(--glass-blur)); -webkit-backdrop-filter: blur(var(--glass-blur));">
                            <div style="text-align: center; padding: 20px; color: var(--meta-color);">
                                ${i18n.t('common.loading')}
                            </div>
                        </div>
                    </div>

                    <!-- Translate Tab -->
                    <div id="tab-panel-translate" class="ai-auto-tab-panel" style="display: none;">
                        <div style="font-size: 0.8em; color: var(--meta-color); margin-bottom: 12px;">${i18n.t('ai.auto_translate_hint_panel')}</div>

                        <div id="translate-feeds-list" style="max-height: 55vh; overflow-y: auto; background: var(--card-bg); border-radius: var(--radius); padding: 4px 0; box-shadow: var(--card-shadow); backdrop-filter: blur(var(--glass-blur)); -webkit-backdrop-filter: blur(var(--glass-blur));">
                            <div style="text-align: center; padding: 20px; color: var(--meta-color);">
                                ${i18n.t('common.loading')}
                            </div>
                        </div>
                    </div>

                    <!-- Summary Tab -->
                    <div id="tab-panel-summary" class="ai-auto-tab-panel" style="display: none;">
                        <div style="font-size: 0.8em; color: var(--meta-color); margin-bottom: 12px;">${i18n.t('ai.auto_summary_hint_panel')}</div>

                        <div id="summary-feeds-list" style="max-height: 55vh; overflow-y: auto; background: var(--card-bg); border-radius: var(--radius); padding: 4px 0; box-shadow: var(--card-shadow); backdrop-filter: blur(var(--glass-blur)); -webkit-backdrop-filter: blur(var(--glass-blur));">
                            <div style="text-align: center; padding: 20px; color: var(--meta-color);">
                                ${i18n.t('common.loading')}
                            </div>
                        </div>
                    </div>
                    <div style="font-size: 0.75em; color: var(--meta-color); margin-top: 12px; line-height: 1.5; opacity: 0.8;">
                        ⚠️ ${i18n.t('ai.rate_limit_warning')}
                    </div>
                </div>
            </div>
        `);

        // Tab switching
        const tabs = dialog.querySelectorAll('.ai-auto-tab');
        const panels = dialog.querySelectorAll('.ai-auto-tab-panel');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => {
                    t.classList.remove('active');
                    t.style.color = 'var(--text-secondary)';
                    t.style.borderBottomColor = 'transparent';
                });
                tab.classList.add('active');
                tab.style.color = 'var(--accent-color)';
                tab.style.borderBottomColor = 'var(--accent-color)';

                panels.forEach(p => p.style.display = 'none');
                const targetPanel = dialog.querySelector(`#tab-panel-${tab.dataset.tab}`);
                if (targetPanel) targetPanel.style.display = 'block';
            });
        });

        // Set initial active tab
        const initialTab = dialog.querySelector(`.ai-auto-tab[data-tab="${activeTab}"]`);
        if (initialTab) initialTab.click();

        // Mode radio (translation tab)
        const modeRadio = dialog.querySelector(`input[name="trans-mode"][value="${aiConfig.titleTranslationMode || 'bilingual'}"]`);
        if (modeRadio) modeRadio.checked = true;

        dialog.querySelectorAll('input[name="trans-mode"]').forEach(radio => {
            radio.addEventListener('change', async () => {
                try {
                    const config = AIService.getConfig();
                    config.titleTranslationMode = radio.value;
                    await AIService.saveConfig(config);
                } catch (err) {
                    console.error('[AI Auto] Failed to save translation mode:', err);
                }
            });
        });

        // Build trees
        const translationContainer = dialog.querySelector('#translation-feeds-list');
        this._renderOverrideTree(translationContainer, 'translation');

        const translateContainer = dialog.querySelector('#translate-feeds-list');
        this._renderOverrideTree(translateContainer, 'translate');

        const summaryContainer = dialog.querySelector('#summary-feeds-list');
        this._renderOverrideTree(summaryContainer, 'summary');
    },

    /**
     * 渲染覆盖控制树（标题翻译或自动摘要共用）
     * @param {HTMLElement} container
     * @param {'translation'|'summary'|'translate'} mode
     */
    _renderOverrideTree(container, mode) {
        const groups = AppState.groups || [];
        const feeds = AppState.feeds || [];

        // Getter/Setter helpers based on mode
        const { getGroup: getGroupOverride, getFeed: getFeedOverride, setFeed: setFeedOverride } = AIService.getOverrideAccessors(mode);

        const prefix = mode; // CSS class prefix

        // Organize feeds by group
        const groupMap = new Map();
        groups.forEach(g => groupMap.set(g.id, { ...g, feeds: [] }));
        const ungrouped = [];
        feeds.forEach(f => {
            if (f.group_id && groupMap.has(f.group_id)) {
                groupMap.get(f.group_id).feeds.push(f);
            } else {
                ungrouped.push(f);
            }
        });

        let html = '';

        // Compute "select all" state

        const allGroupIds = groups.filter(g => {
            return feeds.some(f => f.group_id == g.id);
        }).map(g => g.id);

        let totalOn = 0;
        let totalOff = 0;
        // Check groups
        for (const gid of allGroupIds) {
            const go = getGroupOverride(gid);
            if (go === 'on') totalOn++;
            else totalOff++;
        }
        // Check ungrouped feeds
        ungrouped.forEach(f => {
            const fo = getFeedOverride(f.id);
            if (fo === 'on') totalOn++;
            else totalOff++;
        });
        const selectAllChecked = totalOn > 0 && totalOff === 0;
        const selectAllIndeterminate = totalOn > 0 && totalOff > 0;

        html += `
        <div style="display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border-color);">
            <input type="checkbox" class="${prefix}-select-all-checkbox"
                ${selectAllChecked ? 'checked' : ''}
                data-indeterminate="${selectAllIndeterminate}"
                style="accent-color: var(--accent-color); width: 16px; height: 16px; cursor: pointer; flex-shrink: 0;">
            <span style="font-size: 0.9em; font-weight: 600; color: var(--text-color);">${i18n.t('common.select_all')}</span>
        </div>`;

        for (const [groupId, group] of groupMap) {
            if (group.feeds.length === 0) continue;

            const groupOverride = getGroupOverride(groupId);
            const groupChecked = groupOverride === 'on';

            // Check individual feed states to determine indeterminate
            let onCount = 0;
            let offCount = 0;
            group.feeds.forEach(f => {
                const fo = getFeedOverride(f.id);
                if (fo === 'on' || (fo === 'inherit' && groupChecked)) onCount++;
                else offCount++;
            });
            const indeterminate = onCount > 0 && offCount > 0;

            html += `
            <div class="${prefix}-group" data-group-id="${groupId}">
                <div class="${prefix}-group-header" style="
                    display: flex; align-items: center; gap: 8px;
                    padding: 10px 14px; cursor: pointer; user-select: none;
                    transition: background 0.15s;
                ">
                    <span class="${prefix}-expand-icon" style="
                        font-size: 10px; color: var(--meta-color);
                        transition: transform 0.2s; display: inline-block;
                        width: 12px; text-align: center;
                    ">▶</span>
                    <input type="checkbox" class="${prefix}-group-checkbox"
                        data-group-id="${groupId}"
                        data-indeterminate="${indeterminate}"
                        ${groupChecked ? 'checked' : ''}
                        style="accent-color: var(--accent-color); width: 16px; height: 16px; cursor: pointer; flex-shrink: 0;">
                    <span style="font-size: 0.9em; font-weight: 600; color: var(--text-color); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${group.name || group.title || i18n.t('common.unnamed')}</span>
                    <span style="
                        font-size: 0.7em; color: var(--meta-color);
                        background: var(--card-bg); padding: 2px 8px;
                        border-radius: 10px; flex-shrink: 0;
                    ">${group.feeds.length}</span>
                </div>
                <div class="${prefix}-group-feeds" style="display: none; padding-left: 24px; padding-bottom: 6px;">`;

            group.feeds.forEach(f => {
                const feedOverride = getFeedOverride(f.id);
                const feedChecked = feedOverride === 'on' || (feedOverride === 'inherit' && groupChecked);
                html += `
                    <div style="display: flex; align-items: center; gap: 8px; padding: 6px 14px;">
                        <input type="checkbox" class="${prefix}-feed-checkbox"
                            data-feed-id="${f.id}" data-group-id="${groupId}"
                            ${feedChecked ? 'checked' : ''}
                            style="accent-color: var(--accent-color); width: 15px; height: 15px; cursor: pointer; flex-shrink: 0;">
                        <span style="
                            font-size: 0.85em; color: var(--text-secondary);
                            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                        ">${f.title || f.url}</span>
                    </div>`;
            });

            html += `</div></div>`;
        }

        // Ungrouped feeds
        if (ungrouped.length > 0) {
            html += `<div style="border-top: 1px solid var(--border-color); margin-top: 2px; padding-top: 2px;">`;
            ungrouped.forEach(f => {
                const feedOverride = getFeedOverride(f.id);
                const feedChecked = feedOverride === 'on';
                html += `
                <div style="display: flex; align-items: center; gap: 8px; padding: 6px 14px;">
                    <input type="checkbox" class="${prefix}-feed-checkbox"
                        data-feed-id="${f.id}"
                        ${feedChecked ? 'checked' : ''}
                        style="accent-color: var(--accent-color); width: 15px; height: 15px; cursor: pointer; flex-shrink: 0;">
                    <span style="
                        font-size: 0.85em; color: var(--text-secondary);
                        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                    ">${f.title || f.url}</span>
                </div>`;
            });
            html += `</div>`;
        }

        if (!html) {
            html = `<div style="padding: 24px; text-align: center; color: var(--meta-color); font-size: 0.85em;">${i18n.t('feed.no_feeds')}</div>`;
        }

        container.innerHTML = html;

        // Set indeterminate state
        container.querySelectorAll(`.${prefix}-group-checkbox[data-indeterminate="true"]`).forEach(cb => {
            cb.indeterminate = true;
        });
        container.querySelectorAll(`.${prefix}-select-all-checkbox[data-indeterminate="true"]`).forEach(cb => {
            cb.indeterminate = true;
        });

        // Helper: update select-all checkbox state based on all group/feed checkboxes
        const updateSelectAllState = () => {
            const selectAllCb = container.querySelector(`.${prefix}-select-all-checkbox`);
            if (!selectAllCb) return;
            const groupCbs = container.querySelectorAll(`.${prefix}-group-checkbox`);
            const ungroupedFeedCbs = container.querySelectorAll(`.${prefix}-feed-checkbox:not([data-group-id])`);
            let on = 0, off = 0;
            groupCbs.forEach(cb => { if (cb.checked && !cb.indeterminate) on++; else off++; });
            ungroupedFeedCbs.forEach(cb => { if (cb.checked) on++; else off++; });
            // If any group is indeterminate, treat as mixed
            const hasIndeterminate = Array.from(groupCbs).some(cb => cb.indeterminate);
            selectAllCb.checked = on > 0 && off === 0 && !hasIndeterminate;
            selectAllCb.indeterminate = (on > 0 && off > 0) || hasIndeterminate;
        };

        // Select all checkbox → toggle all groups and ungrouped feeds
        // Batch setter map to avoid N individual HTTP requests
        const batchSetterMap = {
            translation: (entries) => AIService.setBatchTranslationOverrides(entries),
            summary: (entries) => AIService.setBatchSummaryOverrides(entries),
            translate: (entries) => AIService.setBatchAutoTranslateOverrides(entries),
        };
        const selectAllCb = container.querySelector(`.${prefix}-select-all-checkbox`);
        if (selectAllCb) {
            selectAllCb.addEventListener('change', async () => {
                try {
                    const value = selectAllCb.checked ? 'on' : 'off';
                    selectAllCb.indeterminate = false;

                    const batchEntries = [];

                    // Toggle all groups
                    const groupCbs = container.querySelectorAll(`.${prefix}-group-checkbox`);
                    for (const gcb of groupCbs) {
                        const groupId = gcb.dataset.groupId;
                        gcb.checked = selectAllCb.checked;
                        gcb.indeterminate = false;
                        batchEntries.push({ type: 'group', id: groupId, value });

                        // Reset child feeds to inherit
                        const group = gcb.closest(`.${prefix}-group`);
                        const feedCbs = group.querySelectorAll(`.${prefix}-feed-checkbox`);
                        for (const fcb of feedCbs) {
                            batchEntries.push({ type: 'feed', id: fcb.dataset.feedId, value: 'inherit' });
                            fcb.checked = selectAllCb.checked;
                        }
                    }

                    // Toggle ungrouped feeds
                    const ungroupedFeedCbs = container.querySelectorAll(`.${prefix}-feed-checkbox:not([data-group-id])`);
                    for (const fcb of ungroupedFeedCbs) {
                        fcb.checked = selectAllCb.checked;
                        batchEntries.push({ type: 'feed', id: fcb.dataset.feedId, value });
                    }

                    // Single save to server
                    await batchSetterMap[mode](batchEntries);

                    // 标题翻译模式：立即触发当前列表的标题翻译
                    if (mode === 'translation') {
                        ArticlesTitleTranslation.triggerTitleTranslations(AppState.articles);
                    }
                } catch (err) {
                    console.error('[AI Auto] Failed to save select-all override:', err);
                }
            });
        }

        // Expand / collapse groups
        container.querySelectorAll(`.${prefix}-group-header`).forEach(header => {
            header.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT') return;
                const group = header.closest(`.${prefix}-group`);
                const feedsDiv = group.querySelector(`.${prefix}-group-feeds`);
                const icon = header.querySelector(`.${prefix}-expand-icon`);
                const isHidden = feedsDiv.style.display === 'none';
                feedsDiv.style.display = isHidden ? 'block' : 'none';
                icon.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
            });
        });

        // Group checkbox → toggle all feeds
        container.querySelectorAll(`.${prefix}-group-checkbox`).forEach(cb => {
            cb.addEventListener('change', async () => {
                try {
                    const groupId = cb.dataset.groupId;
                    const value = cb.checked ? 'on' : 'off';
                    cb.indeterminate = false;

                    const batchEntries = [{ type: 'group', id: groupId, value }];

                    // Reset all child feeds to inherit
                    const group = cb.closest(`.${prefix}-group`);
                    const feedCbs = group.querySelectorAll(`.${prefix}-feed-checkbox`);
                    for (const feedCb of feedCbs) {
                        batchEntries.push({ type: 'feed', id: feedCb.dataset.feedId, value: 'inherit' });
                        feedCb.checked = cb.checked;
                    }

                    await batchSetterMap[mode](batchEntries);
                    updateSelectAllState();

                    // 标题翻译模式：立即触发当前列表的标题翻译
                    if (mode === 'translation') {
                        ArticlesTitleTranslation.triggerTitleTranslations(AppState.articles);
                    }
                } catch (err) {
                    console.error('[AI Auto] Failed to save group override:', err);
                }
            });
        });

        // Individual feed checkbox
        container.querySelectorAll(`.${prefix}-feed-checkbox`).forEach(cb => {
            cb.addEventListener('change', async () => {
                try {
                    const feedId = cb.dataset.feedId;
                    const value = cb.checked ? 'on' : 'off';
                    await setFeedOverride(feedId, value);

                    // Update parent group checkbox state
                    const groupId = cb.dataset.groupId;
                    if (groupId) {
                        const group = cb.closest(`.${prefix}-group`);
                        const feedCheckboxes = group.querySelectorAll(`.${prefix}-feed-checkbox`);
                        const allChecked = Array.from(feedCheckboxes).every(fc => fc.checked);
                        const noneChecked = Array.from(feedCheckboxes).every(fc => !fc.checked);
                        const groupCb = group.querySelector(`.${prefix}-group-checkbox`);
                        groupCb.checked = allChecked;
                        groupCb.indeterminate = !allChecked && !noneChecked;
                    }

                    updateSelectAllState();

                    // 标题翻译模式：立即触发当前列表的标题翻译
                    if (mode === 'translation') {
                        ArticlesTitleTranslation.triggerTitleTranslations(AppState.articles);
                    }
                } catch (err) {
                    console.error('[AI Auto] Failed to save feed override:', err);
                }
            });
        });
    },
};
