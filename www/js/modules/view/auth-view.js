/**
 * AuthView - 认证视图模块
 * @module view/auth-view
 */

import { DOMElements } from '../../dom.js';
import { AuthManager } from '../auth-manager.js';
import { i18n } from '../i18n.js';
import { AIService } from '../ai-service.js';
import { AICache } from '../ai-cache.js';
import { setupEventListeners } from '../events.js';
import { initPanelResizer } from '../panel-resizer.js';

/**
 * 认证视图管理
 */
export const AuthView = {
    /** 视图管理器引用，在初始化时设置 */
    viewManager: null,

    /**
     * 初始化模块
     * @param {Object} viewManager - ViewManager 实例引用
     */
    init(viewManager) {
        this.viewManager = viewManager;
    },

    /**
     * 显示认证视图
     */
    async showAuthView() {
        const authContainer = DOMElements.authContainer;
        DOMElements.appContainer.style.display = 'none';
        authContainer.style.display = 'flex';
        this.showManualLoginForm();
    },

    /**
     * 显示手动登录表单
     * @param {string|null} errorMessage - 可选的错误消息
     */
    showManualLoginForm(errorMessage = null) {
        const authContainer = DOMElements.authContainer;
        authContainer.innerHTML = `
            <div class="auth-box">
                <h1 class="auth-title">${i18n.t('auth.title')}</h1>
                <p class="auth-subtitle">${i18n.t('auth.subtitle')}</p>
                
                <form id="auth-form" class="auth-form">
                    <input type="text" id="auth-username" class="auth-input" placeholder="${i18n.t('auth.username_placeholder')}" required>
                    <input type="password" id="auth-password" class="auth-input" placeholder="${i18n.t('auth.password_placeholder')}" required>
                    <button type="submit" class="auth-button" id="auth-submit-btn">${i18n.t('auth.login_button')}</button>
                </form>
                
                <div class="auth-error" id="auth-error" style="display: none;"></div>
            </div>
        `;

        const form = document.getElementById('auth-form');
        const submitBtn = document.getElementById('auth-submit-btn');
        const errorDiv = document.getElementById('auth-error');

        if (errorMessage) {
            errorDiv.textContent = errorMessage;
            errorDiv.style.display = 'block';
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('auth-username').value;
            const password = document.getElementById('auth-password').value;

            submitBtn.disabled = true;
            errorDiv.style.display = 'none';

            try {
                await AuthManager.login(username, password);
                DOMElements.authContainer.style.display = 'none';
                DOMElements.appContainer.style.display = 'flex';

                // Parallelize initialization
                const aiInitPromise = AIService.init();
                const configPromise = AuthManager.getMinifluxConfig();

                await aiInitPromise;
                AICache.init(); // Async cleanup, non-blocking

                // 检查 Miniflux 配置
                try {
                    const minifluxConfig = await configPromise;
                    if (!minifluxConfig.configured) {
                        // 未配置 Miniflux，显示强制设置对话框
                        this.viewManager.showSettingsDialog(true);
                        return;
                    }
                } catch (configErr) {
                    console.error('Check Miniflux config failed:', configErr);
                    // 检查失败也显示设置对话框
                    this.viewManager.showSettingsDialog(true);
                    return;
                }

                await this.viewManager.initThreeColumnLayout();
                initPanelResizer();
                setupEventListeners(this.viewManager);

                if (!window.location.hash || window.location.hash === '#/') {
                    window.location.hash = '#/all';
                } else {
                    window.dispatchEvent(new Event('hashchange'));
                }
            } catch (err) {
                errorDiv.textContent = err.message;
                errorDiv.style.display = 'block';
            } finally {
                submitBtn.disabled = false;
            }
        });
    }
};
