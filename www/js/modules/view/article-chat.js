/**
 * ArticleChatMixin - AI 对话功能模块
 * @module view/article-chat
 *
 * 通过 Mixin 模式合并到 ArticleContentView
 * - openChat: 打开 AI 对话框
 * - closeChat: 关闭 AI 对话框
 * - bindChatButton: 绑定对话按钮事件
 *
 * 行为逻辑：
 * - 如果内容区域剩余宽度 >= 900px，文章左挤，对话框在右边
 * - 如果剩余宽度 < 900px，对话框悬浮在文章上方
 *
 * 持久化：
 * - 聊天记录自动保存到服务端数据库（按 article_id）
 * - 重新打开同一篇文章的对话时恢复历史消息
 */

import { AIService } from '../ai-service.js';
import { escapeHtml } from './utils.js';
import { AuthManager } from '../auth-manager.js';
import { API_ENDPOINTS } from '../../constants.js';
import { i18n } from '../i18n.js';
import { Modal } from './components.js';
import { Dialogs } from './dialogs.js';

export const ArticleChatMixin = {
    /** 当前聊天的 AbortController */
    _chatController: null,
    /** 聊天消息历史 */
    _chatMessages: [],
    /** 聊天面板 DOM 元素 */
    _chatPanel: null,
    /** 当前聊天关联的文章 */
    _chatArticle: null,
    /** 保存计时器（防抖） */
    _chatSaveTimer: null,

    /**
     * 打开 AI 对话框
     * @param {Object} article - 文章对象
     */
    async openChat(article) {
        if (!AIService.isConfigured()) {
            Modal.alertWithSettings(
                i18n.t('ai.not_configured'),
                i18n.t('common.go_to_settings'),
                () => Dialogs.showSettingsDialog(false)
            );
            return;
        }

        // 如果已经打开，直接聚焦
        if (this._chatPanel) {
            const input = this._chatPanel.querySelector('.chat-input');
            if (input) input.focus();
            return;
        }

        this._chatArticle = article;
        this._chatMessages = [];
        this._createChatPanel(article);
        this._updateChatLayout();

        // 监听窗口大小变化
        this._chatResizeHandler = () => this._updateChatLayout();
        window.addEventListener('resize', this._chatResizeHandler);

        // 从数据库加载历史聊天记录
        await this._loadChatHistory(article);
    },

    /**
     * 关闭 AI 对话框
     */
    closeChat() {
        if (this._chatController) {
            this._chatController.abort();
            this._chatController = null;
        }

        // 取消待保存的防抖
        if (this._chatSaveTimer) {
            clearTimeout(this._chatSaveTimer);
            this._chatSaveTimer = null;
        }

        // 在关闭之前同步保存（如果有消息且有文章关联）
        if (this._chatMessages.length > 0 && this._chatArticle) {
            this._saveChatHistory(this._chatArticle);
        }

        if (this._chatPanel) {
            this._chatPanel.remove();
            this._chatPanel = null;
        }

        // 恢复布局
        const contentPanel = document.getElementById('content-panel');
        if (contentPanel) {
            contentPanel.classList.remove('chat-open');
            contentPanel.classList.remove('chat-docked-layout');
        }

        // 移除事件监听
        if (this._chatResizeHandler) {
            window.removeEventListener('resize', this._chatResizeHandler);
            this._chatResizeHandler = null;
        }

        this._chatArticle = null;
        this._chatMessages = [];
    },

    /**
     * 绑定聊天按钮事件
     * @param {Object} article - 文章对象
     */
    bindChatButton(article) {
        const chatBtn = document.getElementById('article-chat-btn');
        if (!chatBtn) return;

        // 异步检测此文章是否有聊天历史，如果有则显示一个小标记
        this._checkChatExists(article.id).then(exists => {
            if (exists && chatBtn) {
                chatBtn.classList.add('has-chat');
            }
        });

        chatBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (this._chatPanel) {
                this.closeChat();
                chatBtn.classList.remove('active');
            } else {
                this.openChat(article);
                chatBtn.classList.add('active');
            }
        });
    },

    // ==================== 持久化方法 ====================

    /**
     * 从数据库加载聊天历史
     * @param {Object} article
     */
    async _loadChatHistory(article) {
        try {
            const response = await AuthManager.fetchWithAuth(
                `${API_ENDPOINTS.CHAT.BASE}/${article.id}`
            );
            if (!response.ok) return;

            const data = await response.json();
            if (data.chat && data.chat.messages && data.chat.messages.length > 0) {
                this._chatMessages = data.chat.messages;
                this._restoreMessages(data.chat.messages);
            }
        } catch (err) {
            console.warn('[AI Chat] Failed to load history:', err);
        }
    },

    /**
     * 保存聊天记录到数据库（防抖 1 秒）
     * @param {Object} article
     */
    _debounceSaveChatHistory(article) {
        if (this._chatSaveTimer) {
            clearTimeout(this._chatSaveTimer);
        }
        this._chatSaveTimer = setTimeout(() => {
            this._saveChatHistory(article);
            this._chatSaveTimer = null;
        }, 1000);
    },

    /**
     * 立即保存聊天记录到数据库
     * @param {Object} article
     */
    async _saveChatHistory(article) {
        if (!article || this._chatMessages.length === 0) return;

        try {
            await AuthManager.fetchWithAuth(
                `${API_ENDPOINTS.CHAT.BASE}/${article.id}`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: this._chatMessages,
                        title: article.title || null
                    })
                }
            );
        } catch (err) {
            console.warn('[AI Chat] Failed to save history:', err);
        }
    },

    /**
     * 检查某篇文章是否有聊天记录
     * @param {string|number} articleId
     * @returns {Promise<boolean>}
     */
    async _checkChatExists(articleId) {
        try {
            const response = await AuthManager.fetchWithAuth(
                `${API_ENDPOINTS.CHAT.BASE}/${articleId}`
            );
            if (!response.ok) return false;
            const data = await response.json();
            return !!(data.chat && data.chat.messages && data.chat.messages.length > 0);
        } catch {
            return false;
        }
    },

    /**
     * 恢复历史消息到 UI
     * @param {Array} messages
     */
    _restoreMessages(messages) {
        if (!this._chatPanel) return;

        const messagesContainer = this._chatPanel.querySelector('.ai-chat-messages');
        const welcomeEl = messagesContainer.querySelector('.ai-chat-welcome');
        if (welcomeEl) welcomeEl.remove();

        for (const msg of messages) {
            this._appendMessageBubble(msg.role, msg.content, /* render markdown */ msg.role === 'assistant');
        }

        // 滚动到底部
        requestAnimationFrame(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        });
    },

    // ==================== UI 创建方法 ====================

    /**
     * 创建对话面板 DOM
     * @param {Object} article - 文章对象
     */
    _createChatPanel(article) {
        const panel = document.createElement('div');
        panel.className = 'ai-chat-panel';
        panel.innerHTML = `
            <div class="ai-chat-header">
                <div class="ai-chat-header-left">
                    <span class="ai-chat-title">${i18n.t('ai.chat_title')}</span>
                </div>
                <div class="ai-chat-header-actions">
                    <button class="ai-chat-clear-btn" data-tooltip="${i18n.t('ai.chat_clear')}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                    </button>
                    <button class="ai-chat-close-btn" data-tooltip="${i18n.t('common.close')}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="ai-chat-messages">
                <div class="ai-chat-welcome">
                    <div class="ai-chat-welcome-icon">✦</div>
                    <div class="ai-chat-welcome-text">${i18n.t('ai.chat_welcome')}</div>
                    <div class="ai-chat-welcome-hint">${i18n.t('ai.chat_context_hint')}</div>
                    <div class="ai-chat-quick-actions">
                        <button class="ai-chat-quick-btn" data-action="summary">${i18n.t('ai.chat_quick_summary')}</button>
                    </div>
                </div>
            </div>
            <div class="ai-chat-input-area">
                <div class="ai-chat-input-wrapper">
                    <textarea class="chat-input" placeholder="${i18n.t('ai.chat_placeholder')}" rows="1"></textarea>
                    <button class="ai-chat-send-btn" disabled>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="12" y1="19" x2="12" y2="5"></line>
                            <polyline points="5 12 12 5 19 12"></polyline>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        // 绑定关闭按钮
        const closeBtn = panel.querySelector('.ai-chat-close-btn');
        closeBtn.addEventListener('click', () => {
            this.closeChat();
            const chatBtn = document.getElementById('article-chat-btn');
            if (chatBtn) chatBtn.classList.remove('active');
        });

        // 绑定清空按钮
        const clearBtn = panel.querySelector('.ai-chat-clear-btn');
        clearBtn.addEventListener('click', async () => {
            if (this._chatMessages.length === 0) return;

            // 清空消息
            this._chatMessages = [];
            const messagesContainer = panel.querySelector('.ai-chat-messages');
            messagesContainer.innerHTML = `
                <div class="ai-chat-welcome">
                    <div class="ai-chat-welcome-icon">✦</div>
                    <div class="ai-chat-welcome-text">${i18n.t('ai.chat_welcome')}</div>
                    <div class="ai-chat-welcome-hint">${i18n.t('ai.chat_context_hint')}</div>
                    <div class="ai-chat-quick-actions">
                        <button class="ai-chat-quick-btn" data-action="summary">${i18n.t('ai.chat_quick_summary')}</button>
                    </div>
                </div>
            `;

            // 从数据库删除
            if (article?.id) {
                try {
                    await AuthManager.fetchWithAuth(
                        `${API_ENDPOINTS.CHAT.BASE}/${article.id}`,
                        { method: 'DELETE' }
                    );
                } catch (err) {
                    console.warn('[AI Chat] Failed to delete history:', err);
                }
            }

            // 移除 toolbar 上的 has-chat 标记
            const chatBtn = document.getElementById('article-chat-btn');
            if (chatBtn) chatBtn.classList.remove('has-chat');
        });

        const input = panel.querySelector('.chat-input');
        const sendBtn = panel.querySelector('.ai-chat-send-btn');

        // 绑定快捷动作按钮
        panel.addEventListener('click', (e) => {
            const quickBtn = e.target.closest('.ai-chat-quick-btn');
            if (!quickBtn) return;
            const action = quickBtn.dataset.action;
            if (action === 'summary') {
                this._sendMessage(article, 'Please create a detailed summary of this article.');
            }
        });

        // 自动调整高度（仅多行时才撑高）
        input.addEventListener('input', () => {
            input.style.height = '';
            if (input.scrollHeight > input.clientHeight) {
                input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            }
            sendBtn.disabled = !input.value.trim();
        });

        // Enter 发送，Shift+Enter 换行
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                if (input.value.trim()) {
                    this._sendMessage(article, input.value.trim());
                    input.value = '';
                    input.style.height = 'auto';
                    sendBtn.disabled = true;
                }
            }
        });

        sendBtn.addEventListener('click', () => {
            if (input.value.trim()) {
                this._sendMessage(article, input.value.trim());
                input.value = '';
                input.style.height = 'auto';
                sendBtn.disabled = true;
            }
        });

        // 将面板添加到 content-panel
        const contentPanel = document.getElementById('content-panel');
        if (contentPanel) {
            contentPanel.appendChild(panel);
        }

        this._chatPanel = panel;

        // 桌面端自动聚焦输入框，移动端不自动聚焦以避免键盘弹出
        if (window.innerWidth > 800) {
            requestAnimationFrame(() => input.focus());
        }
    },

    /**
     * 更新聊天布局（推挤 vs 悬浮）
     */
    _updateChatLayout() {
        const contentPanel = document.getElementById('content-panel');
        if (!contentPanel || !this._chatPanel) return;

        const panelWidth = contentPanel.offsetWidth;

        // 始终标记 chat-open（用于隐藏导航按钮等）
        contentPanel.classList.add('chat-open');

        // 900px 以上：文章左移 + 对话框固定在右
        // 900px 以下：对话框悬浮在文章上
        if (panelWidth >= 900) {
            contentPanel.classList.add('chat-docked-layout');
            this._chatPanel.classList.remove('chat-floating');
            this._chatPanel.classList.add('chat-docked');
        } else {
            contentPanel.classList.remove('chat-docked-layout');
            this._chatPanel.classList.remove('chat-docked');
            this._chatPanel.classList.add('chat-floating');
        }
    },

    // ==================== 消息发送 ====================

    /**
     * 发送消息到 AI
     * @param {Object} article - 文章对象
     * @param {string} userMessage - 用户消息
     */
    async _sendMessage(article, userMessage) {
        if (!this._chatPanel) return;

        const messagesContainer = this._chatPanel.querySelector('.ai-chat-messages');
        const welcomeEl = messagesContainer.querySelector('.ai-chat-welcome');
        if (welcomeEl) welcomeEl.remove();

        // 添加用户消息
        this._chatMessages.push({ role: 'user', content: userMessage });
        this._appendMessageBubble('user', userMessage);

        // 创建 AI 回复气泡
        const aiBubble = this._appendMessageBubble('assistant', '');
        const contentEl = aiBubble.querySelector('.ai-chat-bubble-content');
        contentEl.innerHTML = `<span class="ai-chat-thinking">${i18n.t('ai.chat_thinking')}</span>`;

        // 禁用输入
        const input = this._chatPanel.querySelector('.chat-input');
        const sendBtn = this._chatPanel.querySelector('.ai-chat-send-btn');
        input.disabled = true;
        sendBtn.disabled = true;

        // 构建完整的 prompt
        const systemContext = this._buildArticleContext(article);
        const prompt = this._buildConversationPrompt(systemContext, this._chatMessages);


        // 跟踪用户是否正在手动浏览上方内容，如果是则不自动滚到底部
        let userScrolled = false;
        const scrollHandler = () => {
            const distanceFromBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
            userScrolled = distanceFromBottom > 50;
        };

        try {
            this._chatController = new AbortController();
            const signal = this._chatController.signal;

            messagesContainer.addEventListener('scroll', scrollHandler);

            let streamedText = '';
            await AIService.callAPI(prompt, (chunk) => {
                streamedText += chunk;
                contentEl.innerHTML = this._renderChatMarkdown(streamedText);
                if (!userScrolled) {
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }
            }, signal);

            // 保存 AI 回复
            this._chatMessages.push({ role: 'assistant', content: streamedText });

            // 保存到数据库（防抖）
            this._debounceSaveChatHistory(article);

            // 标记 has-chat
            const chatBtn = document.getElementById('article-chat-btn');
            if (chatBtn) chatBtn.classList.add('has-chat');

        } catch (err) {
            if (err.name === 'AbortError') {
                contentEl.innerHTML = `<span style="color: var(--meta-color); font-style: italic;">${i18n.t('ai.chat_cancelled')}</span>`;
                return;
            }
            console.error('[AI Chat] Error:', err);
            const statusCode = err.statusCode || err.status || '';
            const errorMsg = statusCode ? `${i18n.t('ai.api_error')} (${statusCode})` : i18n.t('ai.api_error');
            contentEl.innerHTML = `<span style="color: var(--danger-color);">${errorMsg}</span>
                <button class="ai-retry-btn">${i18n.t('common.retry')}</button>`;
            contentEl.querySelector('.ai-retry-btn')?.addEventListener('click', () => {
                this._chatMessages.pop(); // 移除用户消息
                aiBubble.remove();
                this._sendMessage(article, userMessage);
            });
        } finally {
            messagesContainer.removeEventListener('scroll', scrollHandler);
            this._chatController = null;
            if (this._chatPanel) {
                input.disabled = false;
                sendBtn.disabled = !input.value.trim();
                if (window.innerWidth > 800) {
                    input.focus();
                }
            }
        }
    },

    // ==================== 辅助方法 ====================

    /**
     * 添加消息气泡
     * @param {'user'|'assistant'} role
     * @param {string} content
     * @param {boolean} [renderMarkdown=false] - 是否渲染 Markdown
     * @returns {HTMLElement}
     */
    _appendMessageBubble(role, content, renderMarkdown = false) {
        const messagesContainer = this._chatPanel.querySelector('.ai-chat-messages');

        const bubble = document.createElement('div');
        bubble.className = `ai-chat-message ai-chat-message-${role}`;

        let renderedContent;
        if (role === 'user') {
            renderedContent = escapeHtml(content);
        } else if (renderMarkdown && content) {
            renderedContent = this._renderChatMarkdown(content);
        } else {
            renderedContent = content;
        }

        bubble.innerHTML = `
            <div class="ai-chat-bubble ai-chat-bubble-${role}">
                <div class="ai-chat-bubble-content">${renderedContent}</div>
            </div>
        `;

        messagesContainer.appendChild(bubble);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        return bubble;
    },

    /**
     * 构建文章上下文（发送给 AI 的文章信息）
     * @param {Object} article
     * @returns {string}
     */
    _buildArticleContext(article) {
        const parts = [];
        parts.push(`Title: ${article.title || 'Untitled'}`);

        if (article.feed_title) {
            parts.push(`Source: ${article.feed_title}`);
        }
        if (article.author) {
            parts.push(`Author: ${article.author}`);
        }
        if (article.published_at) {
            parts.push(`Published: ${article.published_at}`);
        }
        if (article.url) {
            parts.push(`URL: ${article.url}`);
        }

        // 提取文章纯文本内容
        const textContent = AIService.extractText(article.content || article.summary || '');
        if (textContent) {
            parts.push(`\nArticle Content:\n${textContent}`);
        }

        return parts.join('\n');
    },

    /**
     * 构建对话 prompt
     * @param {string} articleContext - 文章上下文
     * @param {Array} messages - 对话历史
     * @returns {string}
     */
    _buildConversationPrompt(articleContext, messages) {
        const targetLang = AIService.getTargetLang();
        const langName = AIService.getLanguageName(targetLang);

        let prompt = `You are a helpful AI assistant. The user is reading an article and wants to discuss it with you. Please respond in ${langName}.\n\n`;
        prompt += `Here is the article the user is reading:\n---\n${articleContext}\n---\n\n`;

        if (messages.length > 1) {
            prompt += `Previous conversation:\n`;
            for (let i = 0; i < messages.length - 1; i++) {
                const msg = messages[i];
                if (msg.role === 'user') {
                    prompt += `User: ${msg.content}\n`;
                } else {
                    prompt += `Assistant: ${msg.content}\n`;
                }
            }
            prompt += `\n`;
        }

        const lastMessage = messages[messages.length - 1];
        prompt += `User's current question: ${lastMessage.content}\n\nPlease respond:`;

        return prompt;
    },

    /**
     * 简单 Markdown 渲染
     * @param {string} text
     * @returns {string}
     */
    _renderChatMarkdown(text) {
        if (!text) return '';

        // 使用 ArticleContentView 的 parseMarkdown（如果可用）
        if (typeof this.parseMarkdown === 'function') {
            return this.parseMarkdown(text);
        }

        // 降级方案：基础渲染
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    },

};
