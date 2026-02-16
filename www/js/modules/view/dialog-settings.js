/**
 * SettingsDialog - 设置对话框模块
 * @module view/settings-dialog
 */

import { AppState } from '../../state.js';
import { FeedManager } from '../feed-manager.js';
import { AuthManager } from '../auth-manager.js';
import { setTheme, setColorScheme, THEMES, COLOR_SCHEME_MODES } from '../theme-manager.js';
import { createDialog } from './utils.js';
import { Modal, CustomSelect } from './components.js';
import { i18n } from '../i18n.js';
import { AIService, AI_LANGUAGES } from '../ai-service.js';
import { Icons } from '../icons.js';
import { KeyboardShortcuts } from '../keyboard.js';

// AI Provider configurations
const AI_PROVIDERS = {
    openai: {
        name: 'OpenAI',
        apiUrl: 'https://api.openai.com/v1',
        hasRegion: false
    },
    claude: {
        name: 'Claude',
        apiUrl: 'https://api.anthropic.com/v1',
        hasRegion: false
    },
    gemini: {
        name: 'Google Gemini',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        hasRegion: false
    },
    minimax: {
        name: 'MiniMax',
        apiUrl: {
            china: 'https://api.minimaxi.com/v1',
            international: 'https://api.minimax.io/v1'
        },
        hasRegion: true
    },
    zhipu: {
        name: 'ZhiPu AI',
        apiUrl: {
            china: 'https://open.bigmodel.cn/api/paas/v4',
            international: 'https://api.z.ai/api/paas/v4'
        },
        hasRegion: true
    },
    kimi: {
        name: 'Kimi',
        apiUrl: {
            china: 'https://api.moonshot.cn/v1',
            international: 'https://api.moonshot.ai/v1'
        },
        hasRegion: true
    },
    openrouter: {
        name: 'OpenRouter',
        apiUrl: 'https://openrouter.ai/api/v1',
        hasRegion: false
    },
    custom: {
        name: 'Custom',
        apiUrl: '',
        hasRegion: false
    }
};

/**
 * 设置对话框相关方法
 * 通过 mixin 模式合并到 Dialogs 对象
 */
export const SettingsDialogMixin = {
    /**
     * 显示设置对话框
     * @param {boolean} forceMode - 强制模式，不可关闭，仅显示 Miniflux 配置
     */
    showSettingsDialog(forceMode = false) {
        const vm = this.viewManager;
        const currentTheme = AppState.preferences?.theme || 'default';
        const currentColorScheme = AppState.preferences?.color_scheme || 'auto';
        const currentLang = i18n.locale;

        const langSelectOptions = [
            { id: 'zh', name: '简体中文' },
            { id: 'en', name: 'English' }
        ].map(l => `<option value="${l.id}" ${currentLang === l.id ? 'selected' : ''}>${l.name}</option>`).join('');

        const showFullSettings = !forceMode;

        // 主题色选项
        const themeOptions = THEMES.map(theme =>
            `<button class="theme-color-btn ${currentTheme === theme.id ? 'active' : ''}" data-theme="${theme.id}" title="${i18n.t('theme.' + theme.id)}">
                <span class="color-dot" style="background-color: ${theme.color || 'var(--accent-color)'}"></span>
            </button>`
        ).join('');

        const colorModeOptions = COLOR_SCHEME_MODES.map(mode =>
            `<button class="appearance-mode-btn ${mode.id === currentColorScheme ? 'active' : ''}" data-mode="${mode.id}">
                <span class="mode-icon">${mode.icon || ''}</span>
                ${i18n.t('settings.' + mode.id)}
            </button>`
        ).join('');

        const { dialog, close } = createDialog('settings-dialog', `
            <div class="settings-dialog-content" style="position: relative;">
                ${showFullSettings ? `
                <button class="icon-btn close-dialog-btn" title="${i18n.t('settings.close')}" style="position: absolute; right: 16px; top: 16px; width: 32px; height: 32px;">
                    ${Icons.close}
                </button>` : ''}
                <h3>${forceMode ? i18n.t('settings.miniflux_settings') : i18n.t('settings.title')}</h3>
                ${forceMode ? `<p style="color: var(--meta-color); font-size: 0.9em; margin-bottom: 16px;">${i18n.t('auth.configure_miniflux_hint')}</p>` : ''}
                
                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('dialogs.miniflux_connection')}</div>
                    <div id="miniflux-config-info" class="miniflux-config-info">
                        <div class="miniflux-loading">${i18n.t('common.loading')}</div>
                    </div>
                </div>
                
                ${showFullSettings ? `
                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('settings.language')}</div>
                    <select id="settings-language-select" class="dialog-select">
                        ${langSelectOptions}
                    </select>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('settings.appearance')}</div>
                    
                    <div class="theme-option-group" style="margin-bottom: 16px;">
                        <div class="settings-item-label">${i18n.t('settings.theme_color')}</div>
                        <div class="theme-color-grid" id="settings-theme-colors">
                            ${themeOptions}
                        </div>
                    </div>

                    <div class="theme-option-group">
                        <div class="settings-item-label">${i18n.t('settings.mode')}</div>
                        <div class="appearance-mode-group" id="settings-appearance-modes">
                            ${colorModeOptions}
                        </div>
                    </div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('ai.settings_title')}</div>
                    <form id="ai-settings-form" autocomplete="off">
                        <label class="miniflux-input-label">${i18n.t('ai.provider')}</label>
                        <select id="ai-provider" class="dialog-select" style="margin-bottom: 8px;">
                            <option value="openai">${i18n.t('ai.provider_openai')}</option>
                            <option value="claude">${i18n.t('ai.provider_claude')}</option>
                            <option value="gemini">${i18n.t('ai.provider_gemini')}</option>
                            <option value="minimax">${i18n.t('ai.provider_minimax')}</option>
                            <option value="zhipu">${i18n.t('ai.provider_zhipu')}</option>
                            <option value="kimi">${i18n.t('ai.provider_kimi')}</option>
                            <option value="openrouter">${i18n.t('ai.provider_openrouter')}</option>
                            <option value="custom">${i18n.t('ai.provider_custom')}</option>
                        </select>

                        <div id="ai-region-container" style="display: none; margin-bottom: 8px;">
                            <label class="miniflux-input-label">${i18n.t('ai.region')}</label>
                            <select id="ai-region" class="dialog-select">
                                <option value="china">${i18n.t('ai.region_china')}</option>
                                <option value="international">${i18n.t('ai.region_international')}</option>
                            </select>
                        </div>

                        <label class="miniflux-input-label">${i18n.t('ai.api_url')}</label>
                        <input type="text" id="ai-api-url" class="auth-input" placeholder="https://api.openai.com/v1" style="margin-bottom: 8px;">

                        <label class="miniflux-input-label">${i18n.t('ai.api_key')}</label>
                        <input type="text" id="ai-api-key" class="auth-input auth-input-secret" placeholder="sk-..." style="margin-bottom: 8px;" autocomplete="off" spellcheck="false">

                        <label class="miniflux-input-label">${i18n.t('ai.model')}</label>
                        <div id="ai-model-input-container">
                            <input type="text" id="ai-model-input" class="auth-input" placeholder="${i18n.t('ai.model_input_placeholder')}" style="margin-bottom: 8px;" autocomplete="off">
                        </div>

                        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                            <div style="flex: 1;">
                                <label class="miniflux-input-label">${i18n.t('ai.temperature')}</label>
                                <input type="number" id="ai-temperature" class="auth-input" min="0" max="2" step="0.1" placeholder="0.7">
                            </div>
                            <div style="flex: 1;">
                                <label class="miniflux-input-label">${i18n.t('ai.concurrency')}</label>
                                <input type="number" id="ai-concurrency" class="auth-input" min="1" max="50" step="1" placeholder="5">
                            </div>
                        </div>

                        <div style="margin-bottom: 12px;">
                            <label class="miniflux-input-label">${i18n.t('ai.target_lang')}</label>
                            <select id="ai-target-lang" class="dialog-select">
                                ${AI_LANGUAGES.map(lang =>
            `<option value="${lang.id}">${i18n.locale === 'zh' ? lang.name : lang.nameEn}</option>`
        ).join('')}
                            </select>
                        </div>


                        <div class="collapsible-section" style="margin-bottom: 16px;">
                            <button type="button" class="collapsible-toggle" style="background: none; border: none; padding: 0; color: var(--accent-color); font-size: 0.9em; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                                <span class="toggle-icon">▶</span> ${i18n.t('settings.edit_config')}
                            </button>
                            <div class="collapsible-content" style="display: none; margin-top: 12px;">
                                <label class="miniflux-input-label">${i18n.t('ai.translate_prompt')}</label>
                                <textarea id="ai-translate-prompt" class="auth-input" rows="3" placeholder="${i18n.t('ai.translate_prompt_placeholder')}" style="margin-bottom: 8px; resize: vertical; min-height: 80px;"></textarea>

                                <label class="miniflux-input-label">${i18n.t('ai.summarize_prompt')}</label>
                                <textarea id="ai-summarize-prompt" class="auth-input" rows="3" placeholder="${i18n.t('ai.summarize_prompt_placeholder')}" style="margin-bottom: 8px; resize: vertical; min-height: 80px;"></textarea>

                                <label class="miniflux-input-label">${i18n.t('ai.digest_prompt')}</label>
                                <textarea id="ai-digest-prompt" class="auth-input" rows="3" placeholder="${i18n.t('ai.digest_prompt_placeholder')}" style="margin-bottom: 8px; resize: vertical; min-height: 80px;"></textarea>
                                <div style="font-size: 0.8em; color: var(--meta-color); margin-bottom: 8px;">${i18n.t('digest.prompt_hint')}</div>

                                <button type="button" id="ai-reset-prompts-btn" style="background: none; border: none; color: var(--accent-color); padding: 4px 0; font-size: 0.85em; cursor: pointer; margin-top: 8px;">
                                    ${i18n.t('ai.reset_prompts')}
                                </button>
                            </div>
                        </div>

                        <div class="appearance-mode-group">
                            <button type="button" id="ai-test-btn" class="appearance-mode-btn" style="flex: 1;">${i18n.t('settings.test_connection')}</button>
                            <button type="submit" class="appearance-mode-btn active" style="flex: 1;">${i18n.t('common.save')}</button>
                        </div>
                        <div id="ai-settings-msg" style="margin-top: 8px; font-size: 0.8em; line-height: 1.5;"></div>
                    </form>
                </div>
                

` : ''}
                
                ${showFullSettings ? `
                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('ai.ai_automation')} / ${i18n.t('digest.manage_scheduled')}</div>
                    <div class="appearance-mode-group" style="display: flex; gap: 8px;">
                        <button type="button" id="settings-manage-translation-btn" class="appearance-mode-btn active" style="justify-content: center; flex: 1;">${i18n.t('ai.ai_automation')}</button>
                        <button type="button" id="settings-manage-digest-btn" class="appearance-mode-btn active" style="justify-content: center; flex: 1;">${i18n.t('digest.manager_title')}</button>
                    </div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('settings.keyboard_shortcuts')}</div>
                    <div class="appearance-mode-group">
                        <button type="button" id="settings-keyboard-shortcuts-btn" class="appearance-mode-btn active" style="justify-content: center; width: 100%;">${i18n.t('settings.keyboard_shortcuts')}</button>
                    </div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">${i18n.t('settings.account_security')}</div>

                    <form id="settings-change-password-form" style="margin-bottom: 16px;" autocomplete="off">
                        <input type="password" id="settings-new-password" class="auth-input" placeholder="${i18n.t('settings.new_password')}" style="margin-bottom: 8px;" required autocomplete="new-password">
                        <input type="password" id="settings-confirm-password" class="auth-input" placeholder="${i18n.t('settings.confirm_password')}" style="margin-bottom: 8px;" required autocomplete="new-password">
                        <div class="appearance-mode-group">
                            <button type="submit" class="appearance-mode-btn active" style="justify-content: center; width: 100%;">${i18n.t('settings.change_password')}</button>
                        </div>
                        <div style="text-align: center; margin-top: 8px;">
                            <span id="settings-password-msg" style="font-size: 0.85em;"></span>
                        </div>
                    </form>

                    <div class="settings-section-title" style="margin-top: 24px;">${i18n.t('settings.login')}</div>
                    <div class="appearance-mode-group">
                        <button class="logout-btn-full appearance-mode-btn active" style="justify-content: center; width: 100%;">${i18n.t('nav.logout')}</button>
                    </div>
                </div>

                <div class="settings-footer">
                    <a href="https://github.com/PehZeroV/tidyflux" target="_blank" rel="noopener noreferrer" class="settings-github-link">
                        ${Icons.github}
                        <span>Tidyflux</span>
                        <span class="settings-github-dot">·</span>
                        <span class="settings-github-desc">${i18n.t('app.description')}</span>
                    </a>
                </div>
                ` : ''}
            </div>
        `, { preventClose: forceMode });

        const logoutBtn = dialog.querySelector('.logout-btn-full');
        const themeColorBtns = dialog.querySelectorAll('.theme-color-btn');
        const modeBtns = dialog.querySelectorAll('.appearance-mode-btn[data-mode]');
        const langSelect = dialog.querySelector('#settings-language-select');
        const passwordForm = dialog.querySelector('#settings-change-password-form');
        const passwordMsg = dialog.querySelector('#settings-password-msg');
        const minifluxConfigInfo = dialog.querySelector('#miniflux-config-info');

        // Init CustomSelects
        const contentContainer = dialog.querySelector('.settings-dialog-content');
        if (contentContainer) CustomSelect.replaceAll(contentContainer);

        // 异步加载 Miniflux 配置信息
        this._loadMinifluxConfig(minifluxConfigInfo);

        // 管理定时简报按钮
        const manageDigestBtn = dialog.querySelector('#settings-manage-digest-btn');
        if (manageDigestBtn) {
            manageDigestBtn.addEventListener('click', () => {
                close();
                this.showDigestManagerDialog();
            });
        }

        // 快捷键管理按钮
        const keyboardBtn = dialog.querySelector('#settings-keyboard-shortcuts-btn');
        if (keyboardBtn) {
            keyboardBtn.addEventListener('click', () => {
                close();
                KeyboardShortcuts._showHelp.call(KeyboardShortcuts);
            });
        }



        // 主题色切换
        themeColorBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                const theme = btn.dataset.theme;
                setTheme(theme);
                AppState.preferences = AppState.preferences || {};
                AppState.preferences.theme = theme;
                themeColorBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                try {
                    await FeedManager.setPreference('theme', theme);
                } catch (err) {
                    console.error('Save theme error:', err);
                }
            });
        });

        // 颜色模式切换
        modeBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                const mode = btn.dataset.mode;
                setColorScheme(mode);
                AppState.preferences = AppState.preferences || {};
                AppState.preferences.color_scheme = mode;
                modeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                try {
                    await FeedManager.setPreference('color_scheme', mode);
                } catch (err) {
                    console.error('Save color scheme error:', err);
                }
            });
        });

        // 语言切换
        if (langSelect) {
            langSelect.addEventListener('change', async () => {
                const lang = langSelect.value;
                if (lang !== i18n.locale) {
                    try {
                        await FeedManager.setPreference('language', lang);
                    } catch (err) {
                        console.error('Save language preference error:', err);
                    }
                    i18n.locale = lang;
                    window.location.reload();
                }
            });
        }


        // AI 设置逻辑
        if (showFullSettings) {
            this._bindAISettingsEvents(dialog);

            // 标题翻译管理按钮
            const translationBtn = dialog.querySelector('#settings-manage-translation-btn');
            if (translationBtn) {
                translationBtn.addEventListener('click', () => {
                    close();
                    this.showTranslationDialog();
                });
            }
        }

        // 修改密码（仅在非强制模式下存在）
        if (passwordForm) {
            passwordForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const newPwd = dialog.querySelector('#settings-new-password').value;
                const confirmPwd = dialog.querySelector('#settings-confirm-password').value;

                if (newPwd !== confirmPwd) {
                    passwordMsg.textContent = i18n.t('settings.password_mismatch');
                    passwordMsg.style.color = 'var(--danger-color)';
                    return;
                }

                const submitBtn = passwordForm.querySelector('button[type="submit"]');
                submitBtn.disabled = true;

                try {
                    await AuthManager.changePassword(newPwd);
                    passwordMsg.textContent = i18n.t('settings.password_change_success');
                    passwordMsg.style.color = 'var(--accent-color)';
                    dialog.querySelector('#settings-new-password').value = '';
                    dialog.querySelector('#settings-confirm-password').value = '';
                } catch (err) {
                    passwordMsg.textContent = err.message;
                    passwordMsg.style.color = 'var(--danger-color)';
                } finally {
                    submitBtn.disabled = false;
                }
            });
        }

        // 退出登录（仅在非强制模式下存在）
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                if (await Modal.confirm(i18n.t('auth.confirm_logout'))) {
                    close();
                    AuthManager.logout();
                }
            });
        }
    },

    /**
     * 绑定 AI 设置相关事件
     */
    _bindAISettingsEvents(dialog) {
        const aiForm = dialog.querySelector('#ai-settings-form');
        const aiProviderSelect = dialog.querySelector('#ai-provider');
        const aiRegionContainer = dialog.querySelector('#ai-region-container');
        const aiRegionSelect = dialog.querySelector('#ai-region');
        const aiUrlInput = dialog.querySelector('#ai-api-url');
        const aiKeyInput = dialog.querySelector('#ai-api-key');
        const aiModelInput = dialog.querySelector('#ai-model-input');
        const aiTemperatureInput = dialog.querySelector('#ai-temperature');
        const aiConcurrencyInput = dialog.querySelector('#ai-concurrency');
        const aiTargetLangSelect = dialog.querySelector('#ai-target-lang');
        const aiTranslatePromptInput = dialog.querySelector('#ai-translate-prompt');
        const aiSummarizePromptInput = dialog.querySelector('#ai-summarize-prompt');
        const aiMsg = dialog.querySelector('#ai-settings-msg');
        const collapsibleToggle = dialog.querySelector('.collapsible-toggle');
        const collapsibleContent = dialog.querySelector('.collapsible-content');

        // 加载当前 AI 配置
        const aiConfig = AIService.getConfig();
        const defaultTranslatePrompt = AIService.getDefaultPrompt('translate');
        const defaultSummarizePrompt = AIService.getDefaultPrompt('summarize');
        const defaultDigestPrompt = AIService.getDefaultPrompt('digest');

        // Helper: Detect provider from API URL
        const detectProviderFromUrl = (url) => {
            if (!url) return 'openai';
            if (url.includes('anthropic.com')) return 'claude';
            if (url.includes('openrouter.ai')) return 'openrouter';
            if (url.includes('generativelanguage.googleapis.com')) return 'gemini';
            if (url.includes('minimaxi.com') || url.includes('minimax.io')) return 'minimax';
            if (url.includes('bigmodel.cn') || url.includes('z.ai')) return 'zhipu';
            if (url.includes('moonshot.cn') || url.includes('moonshot.ai')) return 'kimi';
            if (url.includes('openai.com')) return 'openai';
            return 'custom';
        };

        // Helper: Get current model value
        const getCurrentModel = () => {
            return aiModelInput.value.trim();
        };

        // Helper: Set model value
        const setModelValue = (model) => {
            aiModelInput.value = model;
        };

        // Helper: Update UI based on provider
        const updateProviderUI = (provider, preserveUrl = false) => {
            const providerConfig = AI_PROVIDERS[provider];

            // Show/hide region selector
            if (providerConfig.hasRegion) {
                aiRegionContainer.style.display = 'block';
            } else {
                aiRegionContainer.style.display = 'none';
            }

            // Update API URL
            if (!preserveUrl) {
                if (provider === 'custom') {
                    // Restore last custom URL
                    aiUrlInput.value = lastCustomUrl;
                } else if (providerConfig.hasRegion) {
                    const region = aiRegionSelect.value;
                    aiUrlInput.value = providerConfig.apiUrl[region];
                } else {
                    aiUrlInput.value = providerConfig.apiUrl;
                }
            }

            // Set model input placeholder
            aiModelInput.placeholder = i18n.t('ai.model_input_placeholder');

            // Disable URL input for non-custom providers
            if (provider === 'custom') {
                aiUrlInput.removeAttribute('readonly');
                aiUrlInput.style.opacity = '1';
            } else {
                aiUrlInput.setAttribute('readonly', 'true');
                aiUrlInput.style.opacity = '0.7';
            }
        };

        // Track custom URL across provider switches
        let lastCustomUrl = aiConfig.provider === 'custom' ? (aiConfig.apiUrl || '') : '';

        // Initialize from saved config
        const savedProvider = aiConfig.provider || detectProviderFromUrl(aiConfig.apiUrl);
        aiProviderSelect.value = savedProvider;
        // Notify CustomSelect wrapper to refresh its displayed text
        aiProviderSelect.dispatchEvent(new Event('change'));

        // Set region if applicable
        if (aiConfig.apiUrl) {
            if (aiConfig.apiUrl.includes('minimax.io') || aiConfig.apiUrl.includes('z.ai') || aiConfig.apiUrl.includes('moonshot.ai')) {
                aiRegionSelect.value = 'international';
            } else {
                aiRegionSelect.value = 'china';
            }
            aiRegionSelect.dispatchEvent(new Event('change'));
        }

        updateProviderUI(savedProvider, true);

        if (aiUrlInput) aiUrlInput.value = aiConfig.apiUrl || '';
        if (aiKeyInput) aiKeyInput.value = aiConfig.apiKey || '';
        if (aiConfig.model) setModelValue(aiConfig.model);

        // 温度默认值改为 0.7
        if (aiTemperatureInput) {
            aiTemperatureInput.value = aiConfig.temperature ?? 0.7;
        }
        if (aiConcurrencyInput) {
            aiConcurrencyInput.value = aiConfig.concurrency ?? 5;
        }

        if (aiTargetLangSelect) {
            aiTargetLangSelect.value = aiConfig.targetLang || 'zh-CN';
            aiTargetLangSelect.dispatchEvent(new Event('change'));
        }

        if (aiTranslatePromptInput) aiTranslatePromptInput.value = aiConfig.translatePrompt || defaultTranslatePrompt;
        if (aiSummarizePromptInput) aiSummarizePromptInput.value = aiConfig.summarizePrompt || defaultSummarizePrompt;
        const aiDigestPromptInput = dialog.querySelector('#ai-digest-prompt');
        if (aiDigestPromptInput) aiDigestPromptInput.value = aiConfig.digestPrompt || defaultDigestPrompt;


        // Provider change handler
        aiProviderSelect.addEventListener('change', () => {
            const newProvider = aiProviderSelect.value;
            const oldProvider = aiProviderSelect._lastProvider || savedProvider;

            // Save current URL if leaving custom
            if (oldProvider === 'custom') {
                lastCustomUrl = aiUrlInput.value;
            }

            aiProviderSelect._lastProvider = newProvider;
            updateProviderUI(newProvider);
        });

        // Region change handler
        aiRegionSelect.addEventListener('change', () => {
            const provider = aiProviderSelect.value;
            const providerConfig = AI_PROVIDERS[provider];
            if (providerConfig.hasRegion) {
                aiUrlInput.value = providerConfig.apiUrl[aiRegionSelect.value];
            }
        });

        // 折叠面板切换
        if (collapsibleToggle) {
            collapsibleToggle.addEventListener('click', () => {
                const isHidden = collapsibleContent.style.display === 'none';
                collapsibleContent.style.display = isHidden ? 'block' : 'none';
                const icon = collapsibleToggle.querySelector('.toggle-icon');
                if (icon) {
                    icon.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
                    icon.style.display = 'inline-block';
                    icon.style.transition = 'transform 0.2s';
                }
            });
        }

        // Reset Prompts Button
        const aiResetPromptsBtn = dialog.querySelector('#ai-reset-prompts-btn');
        if (aiResetPromptsBtn) {
            aiResetPromptsBtn.addEventListener('click', () => {
                if (aiTranslatePromptInput) aiTranslatePromptInput.value = defaultTranslatePrompt;
                if (aiSummarizePromptInput) aiSummarizePromptInput.value = defaultSummarizePrompt;
                if (aiDigestPromptInput) aiDigestPromptInput.value = defaultDigestPrompt;
            });
        }

        // Test Connection
        const aiTestBtn = dialog.querySelector('#ai-test-btn');
        if (aiTestBtn) {
            aiTestBtn.addEventListener('click', async () => {
                const model = getCurrentModel();
                const config = {
                    apiUrl: aiUrlInput.value.trim(),
                    apiKey: aiKeyInput.value.trim(),
                    model: model,
                    targetLang: aiTargetLangSelect.value
                };

                if (!config.apiUrl || !config.apiKey || !config.model) {
                    aiMsg.innerHTML = `<span style="color: var(--danger-color);">${i18n.t('settings.fill_all_info')}</span>`;
                    return;
                }

                aiTestBtn.disabled = true;
                const originalText = aiTestBtn.textContent;
                aiTestBtn.textContent = i18n.t('settings.testing');
                aiMsg.innerHTML = `<span style="color: var(--meta-color);">${i18n.t('settings.testing')}</span>`;

                const startTime = Date.now();
                try {
                    const result = await AIService.testConnection(config);
                    const latency = Date.now() - startTime;
                    aiMsg.innerHTML = `
                        <span style="color: var(--accent-color);">✓ ${i18n.t('ai.test_success')}</span>
                        <br><span style="color: var(--meta-color); font-size: 0.9em;">
                        ${i18n.t('ai.test_latency')}: ${latency}ms |
                        ${i18n.t('ai.test_response')}: "${result.reply?.substring(0, 50)}${result.reply?.length > 50 ? '...' : ''}"
                        </span>
                    `;
                } catch (err) {
                    const latency = Date.now() - startTime;
                    aiMsg.innerHTML = `
                        <span style="color: var(--danger-color);">✗ ${err.message}</span>
                        <br><span style="color: var(--meta-color); font-size: 0.9em;">${i18n.t('ai.test_latency')}: ${latency}ms</span>
                    `;
                } finally {
                    aiTestBtn.disabled = false;
                    aiTestBtn.textContent = originalText;
                }
            });
        }

        // 保存 AI 配置
        if (aiForm) {
            aiForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                const model = getCurrentModel();
                const config = {
                    provider: aiProviderSelect.value,
                    region: aiRegionSelect.value,
                    apiUrl: aiUrlInput.value.trim(),
                    apiKey: aiKeyInput.value.trim(),
                    model: model,
                    temperature: parseFloat(aiTemperatureInput?.value) || 0.7,
                    concurrency: parseInt(aiConcurrencyInput?.value) || 5,
                    targetLang: aiTargetLangSelect.value,
                    translatePrompt: aiTranslatePromptInput.value.trim(),
                    summarizePrompt: aiSummarizePromptInput.value.trim(),
                    digestPrompt: aiDigestPromptInput ? aiDigestPromptInput.value.trim() : (AIService.getConfig().digestPrompt || '')
                };

                try {
                    await AIService.saveConfig(config);
                    aiMsg.innerHTML = `<span style="color: var(--accent-color);">✓ ${i18n.t('ai.save_success')}</span>`;
                } catch (err) {
                    console.error('Save AI settings error:', err);
                    aiMsg.innerHTML = `<span style="color: var(--danger-color);">${i18n.t('ai.api_error')}</span>`;
                }

                setTimeout(() => {
                    aiMsg.innerHTML = '';
                }, 3000);
            });
        }
    },

    /**
     * 异步加载 Miniflux 配置逻辑
     */
    async _loadMinifluxConfig(minifluxConfigInfo) {
        try {
            const config = await AuthManager.getMinifluxConfig();
            if (config.configured) {
                this._renderMinifluxConfigured(minifluxConfigInfo, config);
            } else {
                this._renderMinifluxConfigForm(minifluxConfigInfo);
            }
        } catch (err) {
            console.error('Load Miniflux config error:', err);
            minifluxConfigInfo.innerHTML = `
                <div class="miniflux-config-error" style="text-align: center; color: var(--danger-color); margin-bottom: 12px;">${i18n.t('common.load_error')}</div>
                <div class="appearance-mode-group">
                    <button id="retry-miniflux-btn" class="appearance-mode-btn" style="width: 100%; justify-content: center;">${i18n.t('settings.edit_connection')}</button>
                </div>
            `;
            minifluxConfigInfo.querySelector('#retry-miniflux-btn')?.addEventListener('click', () => {
                this._renderMinifluxConfigForm(minifluxConfigInfo);
            });
        }
    },

    /**
     * 渲染已配置状态
     */
    _renderMinifluxConfigured(container, config) {
        const sourceText = config.source === 'env' ? i18n.t('settings.env_var') : i18n.t('settings.manual_config');
        const isEnv = config.source === 'env';

        container.innerHTML = `
            <div class="miniflux-config-item">
                <span class="miniflux-config-label">${i18n.t('settings.status')}</span>
                <span class="miniflux-config-value miniflux-status-connected" id="miniflux-status-value">
                    <span class="status-dot" style="background-color: var(--meta-color);"></span>${i18n.t('settings.connected')} ${sourceText} <span style="font-size: 0.9em; opacity: 0.8;">(${i18n.t('common.loading')}...)</span>
                </span>
            </div>
            <div class="miniflux-config-item">
                <span class="miniflux-config-label">${i18n.t('settings.server_url')}</span>
                <span class="miniflux-config-value">${config.url}</span>
            </div>
            <div class="miniflux-config-item">
                <span class="miniflux-config-label">${config.authType === 'api_key' ? i18n.t('settings.auth_api_key') : i18n.t('settings.username')}</span>
                <span class="miniflux-config-value">${config.authType === 'api_key' ? '********' : (config.username || '-')}</span>
            </div>
            ${!isEnv ? `
            <div class="appearance-mode-group" style="margin-top: 12px;">
                <button id="edit-miniflux-config-btn" class="appearance-mode-btn" style="justify-content: center; width: 100%;">${i18n.t('settings.edit_connection')}</button>
            </div>
            ` : ''}
        `;

        // 异步检查真实连接状态
        AuthManager.getMinifluxStatus().then(status => {
            const statusEl = container.querySelector('#miniflux-status-value');
            if (!statusEl) return;

            if (status.connected) {
                statusEl.innerHTML = `<span class="status-dot"></span>${i18n.t('settings.connected')} ${sourceText}`;
            } else {
                statusEl.className = 'miniflux-config-value miniflux-status-disconnected';
                statusEl.style.color = 'var(--danger-color)';
                statusEl.innerHTML = `<span class="status-dot" style="background-color: var(--danger-color);"></span>${i18n.t('auth.login_failed')}: ${status.error || 'Connection Invalid'}`;
            }
        }).catch(err => {
            const statusEl = container.querySelector('#miniflux-status-value');
            if (statusEl) {
                statusEl.className = 'miniflux-config-value miniflux-status-disconnected';
                statusEl.style.color = 'var(--danger-color)';
                statusEl.innerHTML = `<span class="status-dot" style="background-color: var(--danger-color);"></span>Error: ${err.message}`;
            }
        });

        if (!isEnv) {
            container.querySelector('#edit-miniflux-config-btn')?.addEventListener('click', () => {
                this._renderMinifluxConfigForm(container, config);
            });
        }
    },

    /**
     * 渲染 Miniflux 配置表单
     */
    _renderMinifluxConfigForm(container, prefill = null) {
        const isEditing = !!prefill;
        const authType = prefill?.authType || 'basic';

        container.innerHTML = `
            <div class="miniflux-config-item">
                <span class="miniflux-config-label">${i18n.t('settings.status')}</span>
                <span class="miniflux-config-value miniflux-status-disconnected">
                    <span class="status-dot"></span>${isEditing ? i18n.t('settings.editing') : i18n.t('settings.not_configured')}
                </span>
            </div>
            <form id="miniflux-config-form" class="miniflux-config-form" autocomplete="off">
                <label class="miniflux-input-label">${i18n.t('settings.miniflux_url')}</label>
                <input type="text" id="miniflux-url" class="auth-input" placeholder="https://miniflux.example.com" style="margin-bottom: 12px;" value="${prefill?.url || ''}" required>
                
                <label class="miniflux-input-label">${i18n.t('settings.auth_method')}</label>
                <div class="auth-type-selector" style="display:flex; gap:10px; margin-bottom:12px;">
                    <button type="button" class="appearance-mode-btn ${authType === 'basic' ? 'active' : ''}" id="auth-type-basic" style="flex:1; justify-content:center;">${i18n.t('settings.auth_basic')}</button>
                    <button type="button" class="appearance-mode-btn ${authType === 'api_key' ? 'active' : ''}" id="auth-type-apikey" style="flex:1; justify-content:center;">${i18n.t('settings.auth_api_key')}</button>
                </div>

                <div id="auth-fields-basic" style="${authType === 'basic' ? 'display:block' : 'display:none'}">
                    <label class="miniflux-input-label">${i18n.t('settings.username_password')}</label>
                    <input type="text" id="miniflux-username" class="auth-input" placeholder="admin" style="margin-bottom: 8px;" value="${prefill?.username || ''}" autocomplete="off">
                    <input type="password" id="miniflux-password" class="auth-input" placeholder="${isEditing ? i18n.t('settings.enter_new_password') : '••••••••'}" style="margin-bottom: 12px;" autocomplete="new-password">
                </div>

                <div id="auth-fields-apikey" style="${authType === 'api_key' ? 'display:block' : 'display:none'}">
                    <label class="miniflux-input-label">${i18n.t('settings.auth_api_key')}</label>
                    <input type="text" id="miniflux-api-key" class="auth-input auth-input-secret" placeholder="${i18n.t('settings.api_key_placeholder')}" style="margin-bottom: 12px;" value="${prefill?.apiKey || ''}" autocomplete="off">
                </div>

                <div class="appearance-mode-group">
                    ${isEditing ? `<button type="button" id="miniflux-cancel-btn" class="appearance-mode-btn" style="flex: 1;">${i18n.t('common.cancel')}</button>` : ''}
                    <button type="button" id="miniflux-test-btn" class="appearance-mode-btn" style="flex: 1;">${i18n.t('settings.test_connection')}</button>
                    <button type="submit" class="appearance-mode-btn active" style="flex: 1;">${i18n.t('settings.save_config')}</button>
                </div>
                <div id="miniflux-config-msg" style="text-align: center; margin-top: 8px; font-size: 0.85em;"></div>
            </form>
        `;

        this._bindMinifluxFormEvents(container, isEditing);
    },

    /**
     * 绑定 Miniflux 配置表单事件
     */
    _bindMinifluxFormEvents(container, isEditing) {
        const form = container.querySelector('#miniflux-config-form');
        const testBtn = container.querySelector('#miniflux-test-btn');
        const cancelBtn = container.querySelector('#miniflux-cancel-btn');
        const msgEl = container.querySelector('#miniflux-config-msg');

        const btnBasic = container.querySelector('#auth-type-basic');
        const btnApiKey = container.querySelector('#auth-type-apikey');
        const fieldsBasic = container.querySelector('#auth-fields-basic');
        const fieldsApiKey = container.querySelector('#auth-fields-apikey');

        let currentAuthType = btnBasic.classList.contains('active') ? 'basic' : 'api_key';

        btnBasic.addEventListener('click', () => {
            currentAuthType = 'basic';
            btnBasic.classList.add('active');
            btnApiKey.classList.remove('active');
            fieldsBasic.style.display = 'block';
            fieldsApiKey.style.display = 'none';
        });

        btnApiKey.addEventListener('click', () => {
            currentAuthType = 'api_key';
            btnBasic.classList.remove('active');
            btnApiKey.classList.add('active');
            fieldsBasic.style.display = 'none';
            fieldsApiKey.style.display = 'block';
        });

        const getFormData = () => {
            const urlInput = container.querySelector('#miniflux-url');
            let url = urlInput.value.trim();
            if (url && !url.match(/^https?:\/\//i)) url = 'https://' + url;
            url = url.replace(/\/+$/, '');
            urlInput.value = url;

            if (currentAuthType === 'basic') {
                return {
                    url,
                    username: container.querySelector('#miniflux-username').value.trim(),
                    password: container.querySelector('#miniflux-password').value,
                    authType: 'basic'
                };
            } else {
                return {
                    url,
                    apiKey: container.querySelector('#miniflux-api-key').value.trim(),
                    authType: 'api_key'
                };
            }
        };

        testBtn.addEventListener('click', async () => {
            const data = getFormData();
            if (!data.url || (data.authType === 'basic' && (!data.username || !data.password)) || (data.authType === 'api_key' && !data.apiKey)) {
                msgEl.textContent = i18n.t('settings.fill_all_info');
                msgEl.style.color = 'var(--danger-color)';
                return;
            }

            testBtn.disabled = true;
            testBtn.textContent = i18n.t('settings.testing');
            msgEl.textContent = '';

            try {
                const result = await AuthManager.testMinifluxConnection(data.url, data.username, data.password, data.apiKey, data.authType);
                msgEl.textContent = `✓ ${i18n.t('settings.connection_success')} (${result.user})`;
                msgEl.style.color = 'var(--accent-color)';
            } catch (err) {
                msgEl.textContent = err.message;
                msgEl.style.color = 'var(--danger-color)';
            } finally {
                testBtn.disabled = false;
                testBtn.textContent = i18n.t('settings.test_connection');
            }
        });

        cancelBtn?.addEventListener('click', async () => {
            const config = await AuthManager.getMinifluxConfig();
            this._renderMinifluxConfigured(container, config);
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = getFormData();
            if (data.authType === 'basic' && !data.password) {
                msgEl.textContent = i18n.t('settings.fill_all_info');
                msgEl.style.color = 'var(--danger-color)';
                return;
            }

            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = i18n.t('settings.saving');

            try {
                await AuthManager.saveMinifluxConfig(data.url, data.username, data.password, data.apiKey, data.authType);
                msgEl.textContent = `✓ ${i18n.t('settings.save_success_refresh')}`;
                msgEl.style.color = 'var(--accent-color)';
                setTimeout(() => window.location.reload(), 1000);
            } catch (err) {
                msgEl.textContent = err.message;
                msgEl.style.color = 'var(--danger-color)';
                submitBtn.disabled = false;
                submitBtn.textContent = i18n.t('settings.save_config');
            }
        });
    }
};
