import { i18n } from './i18n.js';
import { AuthManager } from './auth-manager.js';
import { API_ENDPOINTS, STORAGE_KEYS } from '../constants.js';
import { AppState } from '../state.js';
import { AICache } from './ai-cache.js';

const DEFAULT_AI_MODEL = 'gpt-4.1-mini';

// 默认提示词
const DEFAULT_PROMPTS = {
    translate: 'Please translate the following text into {{targetLang}}, maintaining the original format and paragraph structure. Return only the translated content, directly outputting the translation result without any additional text:\n\n{{content}}',
    summarize: 'Please summarize this article in {{targetLang}} in a few sentences. Output the result directly without any introductory text like "Here is the summary".\n\n{{content}}',
    digest: 'You are a professional news editor. Please generate a concise digest based on the following list of recent articles.\n\n## Output Requirements:\n1. Output in {{targetLang}}\n2. Start with a 2-3 sentence overview of today\'s/recent key content\n3. Categorize by topic or importance, listing key information in concise bullet points\n4. If multiple articles relate to the same topic, combine them\n5. Keep the format concise and compact, using Markdown\n6. Output the content directly, no opening remarks like "Here is the digest"\n7. When mentioning or referencing a specific article, use [ref:ARTICLE_ID] after the relevant text (where ARTICLE_ID is the ID from the article list), so readers can click to jump to the original. Example: "OpenAI released GPT-5 [ref:12345]".\n\n## Article List:\n\n{{content}}'
};

// 语言选项
export const AI_LANGUAGES = [
    { id: 'zh-CN', name: '简体中文' },
    { id: 'zh-TW', name: '繁體中文' },
    { id: 'en', name: 'English' },
    { id: 'ja', name: '日本語' },
    { id: 'ko', name: '한국어' },
    { id: 'fr', name: 'Français' },
    { id: 'de', name: 'Deutsch' },
    { id: 'es', name: 'Español' },
    { id: 'pt', name: 'Português' },
    { id: 'ru', name: 'Русский' }
];

/**
 * AI 服务
 */
export const AIService = {
    /**
     * 获取 AI 配置
     * @returns {Object} AI 配置对象
     */
    _configCache: null,
    // 标题翻译缓存 (key: title||langId, value: translated title)
    _titleCache: new Map(),
    // 标题缓存上限
    _TITLE_CACHE_MAX: 5000,
    // 标题缓存是否有未持久化的变更
    _titleCacheDirty: false,
    // 标题翻译覆盖设置 { feeds: { feedId: 'on'|'off' }, groups: { groupId: 'on'|'off' } }
    _titleTranslationOverrides: { feeds: {}, groups: {} },
    // 自动摘要覆盖设置（同结构）
    _autoSummaryOverrides: { feeds: {}, groups: {} },
    // 自动翻译全文覆盖设置（同结构）
    _autoTranslateOverrides: { feeds: {}, groups: {} },

    /**
     * 初始化 AI 服务
     */
    async init() {
        await this.loadConfig();
        await this._loadTitleCache();
        this._loadTranslationOverrides();
        this._loadSummaryOverrides();
        this._loadAutoTranslateOverrides();
    },

    /**
     * 从 IndexedDB 加载标题翻译缓存
     */
    async _loadTitleCache() {
        try {
            const cached = await AICache.loadTitleCache();
            if (cached && cached.size > 0) {
                this._titleCache = cached;
                console.debug(`[AIService] Title cache loaded: ${this._titleCache.size} entries`);
            }
        } catch (e) {
            console.warn('[AIService] Failed to load title cache:', e);
            this._titleCache = new Map();
        }
    },

    /**
     * 将标题翻译缓存持久化到 IndexedDB
     */
    _saveTitleCache() {
        if (!this._titleCacheDirty) return;
        this._titleCacheDirty = false;
        AICache.saveTitleCache(this._titleCache, this._TITLE_CACHE_MAX).catch((e) => {
            console.warn('[AIService] Failed to save title cache:', e);
        });
    },

    /**
     * 从 AppState.preferences 加载翻译覆盖设置
     */
    _loadTranslationOverrides() {
        try {
            // 尝试从 AppState.preferences 读取（服务端同步的数据）
            const prefs = AppState?.preferences || {};
            if (prefs.title_translation_overrides) {
                this._titleTranslationOverrides = prefs.title_translation_overrides;
                return;
            }
        } catch (e) { /* ignore */ }
        this._titleTranslationOverrides = { feeds: {}, groups: {} };
    },

    /**
     * 保存翻译覆盖设置到服务端
     */
    async _saveTranslationOverrides() {
        try {
            // 引入时避免循环依赖，动态获取 FeedManager
            const { FeedManager } = await import('./feed-manager.js');
            await FeedManager.setPreference('title_translation_overrides', this._titleTranslationOverrides);
            // 同步到 AppState
            if (AppState?.preferences) {
                AppState.preferences.title_translation_overrides = this._titleTranslationOverrides;
            }
        } catch (e) {
            console.error('[AIService] Failed to save translation overrides:', e);
        }
    },

    /**
     * 获取订阅源的翻译覆盖状态
     * @param {string|number} feedId
     * @returns {'on'|'off'|'inherit'}
     */
    getFeedTranslationOverride(feedId) {
        return this._titleTranslationOverrides.feeds?.[feedId] || 'inherit';
    },

    /**
     * 获取分组的翻译覆盖状态
     * @param {string|number} groupId
     * @returns {'on'|'off'|'inherit'}
     */
    getGroupTranslationOverride(groupId) {
        return this._titleTranslationOverrides.groups?.[groupId] || 'inherit';
    },

    /**
     * 设置订阅源的翻译覆盖
     * @param {string|number} feedId
     * @param {'on'|'off'|'inherit'} value
     */
    async setFeedTranslationOverride(feedId, value) {
        if (!this._titleTranslationOverrides.feeds) this._titleTranslationOverrides.feeds = {};
        if (value === 'inherit') {
            delete this._titleTranslationOverrides.feeds[feedId];
        } else {
            this._titleTranslationOverrides.feeds[feedId] = value;
        }
        await this._saveTranslationOverrides();
    },

    /**
     * 设置分组的翻译覆盖
     * @param {string|number} groupId
     * @param {'on'|'off'|'inherit'} value
     */
    async setGroupTranslationOverride(groupId, value) {
        if (!this._titleTranslationOverrides.groups) this._titleTranslationOverrides.groups = {};
        if (value === 'inherit') {
            delete this._titleTranslationOverrides.groups[groupId];
        } else {
            this._titleTranslationOverrides.groups[groupId] = value;
        }
        await this._saveTranslationOverrides();
    },

    /**
     * 判断某个订阅源是否应该翻译标题
     * 优先级：订阅源设置 > 分组设置 > 默认关闭
     * @param {string|number} feedId
     * @returns {boolean}
     */
    shouldTranslateFeed(feedId) {
        // AI 未配置时直接返回 false
        if (!AIService.isConfigured()) return false;

        // 1. 检查订阅源级别设置
        const feedOverride = this.getFeedTranslationOverride(feedId);
        if (feedOverride === 'on') return true;
        if (feedOverride === 'off') return false;

        // 2. 检查分组级别设置
        const feeds = AppState?.feeds || [];
        const feed = feeds.find(f => f.id == feedId);
        if (feed && feed.group_id) {
            const groupOverride = this.getGroupTranslationOverride(feed.group_id);
            if (groupOverride === 'on') return true;
            if (groupOverride === 'off') return false;
        }

        // 3. 默认不翻译
        return false;
    },

    // ==================== 自动摘要覆盖 ====================

    _loadSummaryOverrides() {
        try {
            const prefs = AppState?.preferences || {};
            if (prefs.auto_summary_overrides) {
                this._autoSummaryOverrides = prefs.auto_summary_overrides;
                return;
            }
        } catch (e) { /* ignore */ }
        this._autoSummaryOverrides = { feeds: {}, groups: {} };
    },

    async _saveSummaryOverrides() {
        try {
            const { FeedManager } = await import('./feed-manager.js');
            await FeedManager.setPreference('auto_summary_overrides', this._autoSummaryOverrides);
            if (AppState?.preferences) {
                AppState.preferences.auto_summary_overrides = this._autoSummaryOverrides;
            }
        } catch (e) {
            console.error('[AIService] Failed to save summary overrides:', e);
        }
    },

    getFeedSummaryOverride(feedId) {
        return this._autoSummaryOverrides.feeds?.[feedId] || 'inherit';
    },

    getGroupSummaryOverride(groupId) {
        return this._autoSummaryOverrides.groups?.[groupId] || 'inherit';
    },

    async setFeedSummaryOverride(feedId, value) {
        if (!this._autoSummaryOverrides.feeds) this._autoSummaryOverrides.feeds = {};
        if (value === 'inherit') {
            delete this._autoSummaryOverrides.feeds[feedId];
        } else {
            this._autoSummaryOverrides.feeds[feedId] = value;
        }
        await this._saveSummaryOverrides();
    },

    async setGroupSummaryOverride(groupId, value) {
        if (!this._autoSummaryOverrides.groups) this._autoSummaryOverrides.groups = {};
        if (value === 'inherit') {
            delete this._autoSummaryOverrides.groups[groupId];
        } else {
            this._autoSummaryOverrides.groups[groupId] = value;
        }
        await this._saveSummaryOverrides();
    },

    /**
     * 判断某个订阅源是否应该自动摘要
     * 优先级：订阅源设置 > 分组设置 > 默认关闭
     * @param {string|number} feedId
     * @returns {boolean}
     */
    shouldAutoSummarize(feedId) {
        if (!AIService.isConfigured()) return false;

        const feedOverride = this.getFeedSummaryOverride(feedId);
        if (feedOverride === 'on') return true;
        if (feedOverride === 'off') return false;

        const feeds = AppState?.feeds || [];
        const feed = feeds.find(f => f.id == feedId);
        if (feed && feed.group_id) {
            const groupOverride = this.getGroupSummaryOverride(feed.group_id);
            if (groupOverride === 'on') return true;
            if (groupOverride === 'off') return false;
        }

        return false;
    },

    // ==================== 自动翻译全文覆盖 ====================

    _loadAutoTranslateOverrides() {
        try {
            const prefs = AppState?.preferences || {};
            if (prefs.auto_translate_overrides) {
                this._autoTranslateOverrides = prefs.auto_translate_overrides;
                return;
            }
        } catch (e) { /* ignore */ }
        this._autoTranslateOverrides = { feeds: {}, groups: {} };
    },

    async _saveAutoTranslateOverrides() {
        try {
            const { FeedManager } = await import('./feed-manager.js');
            await FeedManager.setPreference('auto_translate_overrides', this._autoTranslateOverrides);
            if (AppState?.preferences) {
                AppState.preferences.auto_translate_overrides = this._autoTranslateOverrides;
            }
        } catch (e) {
            console.error('[AIService] Failed to save auto-translate overrides:', e);
        }
    },

    getFeedAutoTranslateOverride(feedId) {
        return this._autoTranslateOverrides.feeds?.[feedId] || 'inherit';
    },

    getGroupAutoTranslateOverride(groupId) {
        return this._autoTranslateOverrides.groups?.[groupId] || 'inherit';
    },

    async setFeedAutoTranslateOverride(feedId, value) {
        if (!this._autoTranslateOverrides.feeds) this._autoTranslateOverrides.feeds = {};
        if (value === 'inherit') {
            delete this._autoTranslateOverrides.feeds[feedId];
        } else {
            this._autoTranslateOverrides.feeds[feedId] = value;
        }
        await this._saveAutoTranslateOverrides();
    },

    async setGroupAutoTranslateOverride(groupId, value) {
        if (!this._autoTranslateOverrides.groups) this._autoTranslateOverrides.groups = {};
        if (value === 'inherit') {
            delete this._autoTranslateOverrides.groups[groupId];
        } else {
            this._autoTranslateOverrides.groups[groupId] = value;
        }
        await this._saveAutoTranslateOverrides();
    },

    /**
     * 判断某个订阅源是否应该自动翻译全文
     * 优先级：订阅源设置 > 分组设置 > 默认关闭
     * @param {string|number} feedId
     * @returns {boolean}
     */
    shouldAutoTranslate(feedId) {
        if (!AIService.isConfigured()) return false;

        const feedOverride = this.getFeedAutoTranslateOverride(feedId);
        if (feedOverride === 'on') return true;
        if (feedOverride === 'off') return false;

        const feeds = AppState?.feeds || [];
        const feed = feeds.find(f => f.id == feedId);
        if (feed && feed.group_id) {
            const groupOverride = this.getGroupAutoTranslateOverride(feed.group_id);
            if (groupOverride === 'on') return true;
            if (groupOverride === 'off') return false;
        }

        return false;
    },

    /**
     * 加载配置 (优先从后端获取)
     */
    async loadConfig() {
        // 先加载本地缓存
        this._configCache = this._loadLocalConfig();

        // 尝试从后端加载
        if (AuthManager.isLoggedIn()) {
            try {
                const response = await AuthManager.fetchWithAuth(API_ENDPOINTS.PREFERENCES.BASE);
                if (response.ok) {
                    const prefs = await response.json();
                    if (prefs.ai_config) {
                        // 合并配置：后端覆盖本地
                        this._configCache = { ...this._getDefaultConfig(), ...prefs.ai_config };
                        // 更新本地备份
                        localStorage.setItem(STORAGE_KEYS.AI_CONFIG, JSON.stringify(this._configCache));
                    }
                }
            } catch (e) {
                console.warn('Load remote AI config failed:', e);
            }
        }
        return this._configCache;
    },

    _loadLocalConfig() {
        try {
            const config = localStorage.getItem(STORAGE_KEYS.AI_CONFIG);
            if (config) return JSON.parse(config);
        } catch (e) {
            console.error('Failed to parse AI config:', e);
        }
        return this._getDefaultConfig();
    },

    _getDefaultConfig() {
        return {
            apiUrl: '',
            apiKey: '',
            model: DEFAULT_AI_MODEL,
            temperature: 1,
            concurrency: 5,
            translatePrompt: '',
            summarizePrompt: '',
            digestPrompt: '',
            targetLang: 'zh-CN',
            titleTranslation: false,
            titleTranslationMode: 'bilingual'
        };
    },

    /**
     * 获取 AI 配置
     * @returns {Object} AI 配置对象
     */
    getConfig() {
        if (!this._configCache) {
            this._configCache = this._loadLocalConfig();
        }
        return this._sanitizeConfig(this._configCache);
    },

    /**
     * 自动修复/清理配置项（如补全缺失的占位符）
     * @param {Object} config 
     * @returns {Object}
     */
    _sanitizeConfig(config) {
        if (!config) return config;

        // 迁移旧占位符 {xxx} → {{xxx}}，并自动补全缺失的 {{content}}
        const promptKeys = ['translatePrompt', 'summarizePrompt', 'digestPrompt'];
        promptKeys.forEach((key) => {
            if (config[key]) {
                // 迁移旧格式占位符
                if (config[key].includes('{content}') && !config[key].includes('{{content}}')) {
                    config[key] = config[key].replace(/\{content\}/g, '{{content}}');
                }
                if (config[key].includes('{targetLang}') && !config[key].includes('{{targetLang}}')) {
                    config[key] = config[key].replace(/\{targetLang\}/g, '{{targetLang}}');
                }
                // 如果漏掉占位符，自动补全
                if (config[key].trim() && !config[key].includes('{{content}}')) {
                    config[key] = config[key].trim() + '\n\n{{content}}';
                }
            }
        });

        return config;
    },

    /**
     * 保存 AI 配置
     * @param {Object} config - AI 配置对象
     */
    async saveConfig(config) {
        this._configCache = config;
        localStorage.setItem(STORAGE_KEYS.AI_CONFIG, JSON.stringify(config));
        console.log('[AIService] Local saved. Syncing to remote...');

        if (AuthManager.isLoggedIn()) {
            try {
                const response = await AuthManager.fetchWithAuth(API_ENDPOINTS.PREFERENCES.BASE, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        key: 'ai_config',
                        value: config
                    })
                });
                if (response.ok) {
                    console.log('[AIService] Remote sync success');
                } else {
                    console.error('[AIService] Remote sync failed:', response.status, await response.text());
                }
            } catch (e) {
                console.error('Save remote AI config failed:', e);
            }
        } else {
            console.warn('[AIService] Not authenticated, skip remote sync.');
        }
    },

    /**
     * 检查 AI 是否已配置
     * @returns {boolean}
     */
    isConfigured() {
        const config = this.getConfig();
        return !!(config.apiUrl && config.apiKey);
    },

    /**
     * 获取默认提示词
     * @param {string} type - 'translate', 'summarize' 或 'digest'
     * @returns {string}
     */
    getDefaultPrompt(type) {
        return DEFAULT_PROMPTS[type] || '';
    },

    /**
     * 获取实际使用的提示词
     * @param {string} type - 'translate', 'summarize' 或 'digest'
     * @returns {string}
     */
    getPrompt(type) {
        const config = this.getConfig();
        let customPrompt = '';
        if (type === 'translate') customPrompt = config.translatePrompt;
        else if (type === 'summarize') customPrompt = config.summarizePrompt;
        else if (type === 'digest') customPrompt = config.digestPrompt;

        return (customPrompt && customPrompt.trim()) ? customPrompt : this.getDefaultPrompt(type);
    },

    /**
     * 获取语言显示名称
     * @param {string} langId - 语言 ID
     * @returns {string}
     */
    getLanguageName(langId) {
        const lang = AI_LANGUAGES.find(l => l.id === langId);
        if (!lang) return langId;
        return lang.name;
    },

    /**
     * 调用 AI API
     * @param {string} prompt - 完整的提示词
     * @param {Function} onChunk - 流式响应回调函数
     * @param {AbortSignal} signal - 用于请求取消的信号
     * @returns {Promise<string>} AI 响应
     */
    async callAPI(prompt, onChunk = null, signal = null) {
        const config = this.getConfig();

        if (!config.apiUrl || !config.apiKey) {
            throw new Error(i18n.t('ai.not_configured'));
        }

        const response = await AuthManager.fetchWithAuth(API_ENDPOINTS.AI.CHAT, {
            method: 'POST',
            signal: signal,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: config.model || DEFAULT_AI_MODEL,
                temperature: config.temperature ?? 1,
                messages: [
                    { role: 'user', content: prompt }
                ],
                stream: !!onChunk
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const statusCode = error.status || response.status;
            const msg = error.error || `AI API Error`;
            const err = new Error(`[${statusCode}] ${msg}`);
            err.statusCode = statusCode;
            throw err;
        }

        if (onChunk) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';
            let buffer = ''; // 缓冲区，存储不完整的行

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');

                    // 保留最后一个可能不完整的行
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.slice(6).trim();
                            if (dataStr === '[DONE]') continue;
                            if (!dataStr) continue;

                            try {
                                const data = JSON.parse(dataStr);
                                const content = data.choices[0]?.delta?.content || '';
                                if (content) {
                                    fullContent += content;
                                    onChunk(content);
                                }
                            } catch (e) {
                                // 仅在明显不是JSON时才warn，避免日志污染
                                if (dataStr.startsWith('{')) {
                                    console.warn('Failed to parse SSE data:', dataStr.substring(0, 50));
                                }
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }

            return fullContent;
        } else {
            const data = await response.json();
            return data.choices?.[0]?.message?.content || '';
        }
    },

    /**
     * 翻译内容
     */
    async translate(content, targetLangId, onChunk = null, signal = null) {
        const targetLang = this.getLanguageName(targetLangId);
        const promptTemplate = this.getPrompt('translate');
        const prompt = promptTemplate
            .replace('{{targetLang}}', targetLang)
            .replace('{{content}}', content);

        return this.callAPI(prompt, onChunk, signal);
    },

    /**
     * 总结内容
     */
    async summarize(content, targetLangId, onChunk = null, signal = null) {
        const targetLang = this.getLanguageName(targetLangId);
        const promptTemplate = this.getPrompt('summarize');
        const prompt = promptTemplate
            .replace('{{targetLang}}', targetLang)
            .replace('{{content}}', content);

        return this.callAPI(prompt, onChunk, signal);
    },

    /**
     * 翻译单个标题
     * @param {string} title - 原始标题
     * @param {string} targetLangId - 目标语言 ID
     * @returns {Promise<string>} 翻译后的标题
     */
    async translateTitle(title, targetLangId) {
        if (!title || !title.trim()) return title;
        const cacheKey = `${title}||${targetLangId}`;
        if (this._titleCache.has(cacheKey)) {
            return this._titleCache.get(cacheKey);
        }
        const targetLang = this.getLanguageName(targetLangId);
        const prompt = `Translate the following title into ${targetLang}. Output ONLY the translated title, nothing else:\n\n${title}`;
        const result = await this.callAPI(prompt);
        const translated = result.trim();
        this._titleCache.set(cacheKey, translated);
        this._titleCacheDirty = true;
        this._saveTitleCache();
        return translated;
    },

    /**
     * 批量翻译标题（单次 API 调用）
     * @param {Array<{id: string|number, title: string}>} items - 文章对象数组
     * @param {string} targetLangId - 目标语言 ID
     * @returns {Promise<Map<string|number, string>>} id -> 翻译结果 Map
     */
    async translateTitlesBatch(items, targetLangId, signal = null) {
        const resultMap = new Map();
        if (!items || items.length === 0) return resultMap;

        // 过滤已缓存的
        const needTranslate = items.filter(item => {
            const cacheKey = `${item.title}||${targetLangId}`;
            if (this._titleCache.has(cacheKey)) {
                resultMap.set(item.id, this._titleCache.get(cacheKey));
                return false;
            }
            return true;
        });

        if (needTranslate.length === 0) return resultMap;

        const targetLang = this.getLanguageName(targetLangId);
        // 构建批量翻译提示词
        const titlesBlock = needTranslate.map((item, i) => `${i + 1}. ${item.title}`).join('\n');
        const prompt = `Translate each of the following titles into ${targetLang}. Output ONLY the translated titles, one per line, in the same numbered format (e.g. "1. translated title"). Do not add any extra text:\n\n${titlesBlock}`;

        try {
            const result = await this.callAPI(prompt, null, signal);
            const lines = result.trim().split('\n').filter(l => l.trim());

            for (let i = 0; i < needTranslate.length; i++) {
                let translated = needTranslate[i].title; // 回退到原标题
                if (i < lines.length) {
                    // 去除行号前缀 (如 "1. ", "2. ")
                    translated = lines[i].replace(/^\d+\.\s*/, '').trim();
                }
                const cacheKey = `${needTranslate[i].title}||${targetLangId}`;
                this._titleCache.set(cacheKey, translated);
                resultMap.set(needTranslate[i].id, translated);
            }
            // 批次翻译完成，持久化缓存
            this._titleCacheDirty = true;
            this._saveTitleCache();
        } catch (e) {
            console.error('[AIService] Batch title translation failed:', e);
        }

        return resultMap;
    },

    /**
     * 获取标题翻译缓存
     * @param {string} title - 原始标题
     * @param {string} targetLangId - 目标语言 ID
     * @returns {string|null} 缓存的翻译结果，无缓存返回 null
     */
    getTitleCache(title, targetLangId) {
        const cacheKey = `${title}||${targetLangId}`;
        return this._titleCache.has(cacheKey) ? this._titleCache.get(cacheKey) : null;
    },

    /**
     * 提取纯文本（去除 HTML 标签）
     * @param {string} html
     * @returns {string}
     */
    extractText(html) {
        if (!html) return '';
        // 复用同一个隐藏元素，避免频繁创建DOM节点
        if (!this._tempExtractElement) {
            this._tempExtractElement = document.createElement('div');
            this._tempExtractElement.style.display = 'none';
        }
        this._tempExtractElement.innerHTML = html;
        const text = this._tempExtractElement.textContent || this._tempExtractElement.innerText || '';
        this._tempExtractElement.innerHTML = ''; // 清空，避免内存泄漏
        return text;
    },

    /**
     * 测试 AI 连接
     * @param {Object} config - { apiUrl, apiKey, model }
     */
    async testConnection(config) {
        const response = await AuthManager.fetchWithAuth(API_ENDPOINTS.AI.TEST, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                apiUrl: config.apiUrl,
                apiKey: config.apiKey,
                model: config.model,
                targetLang: config.targetLang
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || `Error: ${response.status}`);
        }
        return data;
    }
};
