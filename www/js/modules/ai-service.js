import { i18n } from './i18n.js';
import { AuthManager } from './auth-manager.js';
import { API_ENDPOINTS, STORAGE_KEYS } from '../constants.js';
import { AppState } from '../state.js';
import { AICache } from './ai-cache.js';

const DEFAULT_AI_MODEL = 'gpt-4.1-mini';

// 默认提示词
const DEFAULT_PROMPTS = {
    titleTranslate: 'Translate each of the following titles into {{targetLang}}. Output ONLY the translated titles, one per line, in the same numbered format (e.g. "1. translated title"). Do not add any extra text:\n\n{{content}}',
    translate: 'Please translate the following text into {{targetLang}}, maintaining the original format and paragraph structure. Return only the translated content, directly outputting the translation result without any additional text:\n\n{{content}}',
    summarize: 'Please summarize this article in {{targetLang}} in a few sentences. Output the result directly without any introductory text like "Here is the summary".\n\n{{content}}',
    digest: 'You are a professional news editor. Please generate a concise digest based on the following list of recent articles.\n\n## Output Requirements:\n1. Output in {{targetLang}}\n2. Start with a 2-3 sentence overview of today\'s/recent key content\n3. Categorize by topic or importance, listing key information in concise bullet points\n4. If multiple articles relate to the same topic, combine them\n5. Keep the format concise and compact, using Markdown\n6. Output the content directly, no opening remarks like "Here is the digest"\n7. When mentioning or referencing a specific article, use [ref:ARTICLE_ID] after the relevant text (where ARTICLE_ID is the ID from the article list), so readers can click to jump to the original. Each [ref:] tag must contain exactly ONE article ID. If referencing multiple articles, use separate tags like [ref:111][ref:222]. Example: "OpenAI released GPT-5 [ref:12345]".\n\n## Article List:\n\n{{content}}'
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
 * 创建 AI 功能覆盖管理器（翻译/摘要/自动翻译共用）
 * @param {string} prefKey - AppState.preferences 中的存储键
 * @returns {Object} 覆盖管理器
 */
function createOverrideManager(prefKey) {
    const mgr = {
        _data: { feeds: {}, groups: {} },

        load() {
            try {
                const prefs = AppState?.preferences || {};
                if (prefs[prefKey]) { mgr._data = prefs[prefKey]; return; }
            } catch { /* ignore */ }
            mgr._data = { feeds: {}, groups: {} };
        },

        async save() {
            try {
                const { FeedManager } = await import('./feed-manager.js');
                await FeedManager.setPreference(prefKey, mgr._data);
                if (AppState?.preferences) {
                    AppState.preferences[prefKey] = mgr._data;
                }
            } catch (e) {
                console.error(`[AIService] Failed to save ${prefKey}:`, e);
            }
        },

        getFeed(feedId) {
            return mgr._data.feeds?.[feedId] || 'inherit';
        },

        getGroup(groupId) {
            return mgr._data.groups?.[groupId] || 'inherit';
        },

        async setFeed(feedId, value) {
            if (!mgr._data.feeds) mgr._data.feeds = {};
            if (value === 'inherit') { delete mgr._data.feeds[feedId]; }
            else { mgr._data.feeds[feedId] = value; }
            await mgr.save();
        },

        async setGroup(groupId, value) {
            if (!mgr._data.groups) mgr._data.groups = {};
            if (value === 'inherit') { delete mgr._data.groups[groupId]; }
            else { mgr._data.groups[groupId] = value; }
            await mgr.save();
        },

        async setBatch(entries) {
            if (!mgr._data.feeds) mgr._data.feeds = {};
            if (!mgr._data.groups) mgr._data.groups = {};
            for (const { type, id, value } of entries) {
                const store = type === 'group' ? mgr._data.groups : mgr._data.feeds;
                if (value === 'inherit') { delete store[id]; } else { store[id] = value; }
            }
            await mgr.save();
        },

        /**
         * 判断某个订阅源是否应该启用此功能
         * 优先级：订阅源设置 > 分组设置 > 默认关闭
         */
        shouldApply(feedId) {
            if (!AIService.isConfigured()) return false;
            const feedOv = mgr.getFeed(feedId);
            if (feedOv === 'on') return true;
            if (feedOv === 'off') return false;
            const feeds = AppState?.feeds || [];
            const feed = feeds.find(f => f.id == feedId);
            if (feed && feed.group_id) {
                const groupOv = mgr.getGroup(feed.group_id);
                if (groupOv === 'on') return true;
                if (groupOv === 'off') return false;
            }
            return false;
        }
    };
    return mgr;
}

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

    // 全局并发控制（信号量）
    _activeRequests: 0,
    _waitingQueue: [],
    // AI 功能覆盖管理器
    _translationOM: createOverrideManager('title_translation_overrides'),
    _summaryOM: createOverrideManager('auto_summary_overrides'),
    _translateOM: createOverrideManager('auto_translate_overrides'),

    /**
     * 初始化 AI 服务
     */
    async init() {
        await this.loadConfig();
        await this._loadTitleCache();
        this._translationOM.load();
        this._summaryOM.load();
        this._translateOM.load();
    },

    /**
     * 从服务端加载标题翻译缓存
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
     * 增量保存标题翻译缓存（仅保存新增条目）
     * @param {Array<{cacheKey: string, content: string}>} newEntries
     */
    _saveTitleCacheBatch(newEntries) {
        AICache.saveTitleCacheBatch(newEntries).catch((e) => {
            console.warn('[AIService] Failed to save title cache:', e);
        });
    },

    // ==================== 覆盖设置（标题翻译 / 自动摘要 / 自动翻译全文）====================
    // 公共 API 保持不变，内部委托给 OverrideManager

    getFeedTranslationOverride(feedId) { return this._translationOM.getFeed(feedId); },
    getGroupTranslationOverride(groupId) { return this._translationOM.getGroup(groupId); },
    setFeedTranslationOverride(feedId, value) { return this._translationOM.setFeed(feedId, value); },
    setGroupTranslationOverride(groupId, value) { return this._translationOM.setGroup(groupId, value); },
    setBatchTranslationOverrides(entries) { return this._translationOM.setBatch(entries); },
    shouldTranslateFeed(feedId) { return this._translationOM.shouldApply(feedId); },

    getFeedSummaryOverride(feedId) { return this._summaryOM.getFeed(feedId); },
    getGroupSummaryOverride(groupId) { return this._summaryOM.getGroup(groupId); },
    setFeedSummaryOverride(feedId, value) { return this._summaryOM.setFeed(feedId, value); },
    setGroupSummaryOverride(groupId, value) { return this._summaryOM.setGroup(groupId, value); },
    setBatchSummaryOverrides(entries) { return this._summaryOM.setBatch(entries); },
    shouldAutoSummarize(feedId) { return this._summaryOM.shouldApply(feedId); },

    getFeedAutoTranslateOverride(feedId) { return this._translateOM.getFeed(feedId); },
    getGroupAutoTranslateOverride(groupId) { return this._translateOM.getGroup(groupId); },
    setFeedAutoTranslateOverride(feedId, value) { return this._translateOM.setFeed(feedId, value); },
    setGroupAutoTranslateOverride(groupId, value) { return this._translateOM.setGroup(groupId, value); },
    setBatchAutoTranslateOverrides(entries) { return this._translateOM.setBatch(entries); },
    shouldAutoTranslate(feedId) { return this._translateOM.shouldApply(feedId); },

    /**
     * 获取指定 AI 功能模式的统一访问器对象
     * @param {'translation'|'translate'|'summary'} mode
     * @returns {{getFeed, getGroup, setFeed, setGroup, shouldFeed, setBatch}}
     */
    getOverrideAccessors(mode) {
        const map = {
            translation: {
                getFeed: (id) => this.getFeedTranslationOverride(id),
                getGroup: (id) => this.getGroupTranslationOverride(id),
                setFeed: (id, v) => this.setFeedTranslationOverride(id, v),
                setGroup: (id, v) => this.setGroupTranslationOverride(id, v),
                shouldFeed: (id) => this.shouldTranslateFeed(id),
                setBatch: (entries) => this.setBatchTranslationOverrides(entries),
            },
            translate: {
                getFeed: (id) => this.getFeedAutoTranslateOverride(id),
                getGroup: (id) => this.getGroupAutoTranslateOverride(id),
                setFeed: (id, v) => this.setFeedAutoTranslateOverride(id, v),
                setGroup: (id, v) => this.setGroupAutoTranslateOverride(id, v),
                shouldFeed: (id) => this.shouldAutoTranslate(id),
                setBatch: (entries) => this.setBatchAutoTranslateOverrides(entries),
            },
            summary: {
                getFeed: (id) => this.getFeedSummaryOverride(id),
                getGroup: (id) => this.getGroupSummaryOverride(id),
                setFeed: (id, v) => this.setFeedSummaryOverride(id, v),
                setGroup: (id, v) => this.setGroupSummaryOverride(id, v),
                shouldFeed: (id) => this.shouldAutoSummarize(id),
                setBatch: (entries) => this.setBatchSummaryOverrides(entries),
            },
        };
        return map[mode];
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
            titleTranslatePrompt: '',
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
     * 获取目标翻译语言（集中管理回退逻辑）
     * @returns {string} 语言代码，如 'zh-CN'、'en'
     */
    getTargetLang() {
        const config = this.getConfig();
        return config.targetLang || (i18n.locale === 'zh' ? 'zh-CN' : 'en');
    },

    /**
     * 自动修复/清理配置项（如补全缺失的占位符）
     * @param {Object} config 
     * @returns {Object}
     */
    _sanitizeConfig(config) {
        if (!config) return config;

        // 迁移旧占位符 {xxx} → {{xxx}}，并自动补全缺失的 {{content}}
        const promptKeys = ['titleTranslatePrompt', 'translatePrompt', 'summarizePrompt', 'digestPrompt'];
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
        console.debug('[AIService] Local saved. Syncing to remote...');

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
                    console.debug('[AIService] Remote sync success');
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
        if (config.provider === 'ollama') return !!config.apiUrl;
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
        if (type === 'titleTranslate') customPrompt = config.titleTranslatePrompt;
        else if (type === 'translate') customPrompt = config.translatePrompt;
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
     * 获取并发许可（全局信号量）
     * 所有 AI API 请求共享同一个并发限制
     */
    async _acquireConcurrency(signal) {
        const limit = this.getConfig().concurrency || 5;
        if (this._activeRequests < limit) {
            this._activeRequests++;
            return;
        }
        // 等待空闲槽位
        return new Promise((resolve, reject) => {
            const waiter = { resolve, reject };
            this._waitingQueue.push(waiter);
            // 如果外部取消了请求，从等待队列中移除
            if (signal) {
                const onAbort = () => {
                    const idx = this._waitingQueue.indexOf(waiter);
                    if (idx !== -1) this._waitingQueue.splice(idx, 1);
                    reject(new DOMException('Aborted', 'AbortError'));
                };
                signal.addEventListener('abort', onAbort, { once: true });
                waiter.cleanupAbort = () => signal.removeEventListener('abort', onAbort);
            }
        });
    },

    /**
     * 释放并发许可
     */
    _releaseConcurrency() {
        this._activeRequests--;
        if (this._waitingQueue.length > 0) {
            const waiter = this._waitingQueue.shift();
            this._activeRequests++;
            if (waiter.cleanupAbort) waiter.cleanupAbort();
            waiter.resolve();
        }
    },

    /**
     * 调用 AI API
     * @param {string} prompt - 完整的提示词
     * @param {Function} onChunk - 流式响应回调函数
     * @param {AbortSignal} signal - 用于请求取消的信号
     * @returns {Promise<string>} AI 响应
     */
    async callAPI(prompt, onChunk = null, signal = null, timeout = 120000) {
        // 全局并发控制：等待空闲槽位
        await this._acquireConcurrency(signal);

        try {
            return await this._doCallAPI(prompt, onChunk, signal, timeout);
        } finally {
            this._releaseConcurrency();
        }
    },

    /**
     * 实际执行 API 调用（由 callAPI 包装）
     */
    async _doCallAPI(prompt, onChunk = null, signal = null, timeout = 120000) {
        const config = this.getConfig();

        if (!config.apiUrl || (config.provider !== 'ollama' && !config.apiKey)) {
            throw new Error(i18n.t('ai.not_configured'));
        }

        // 前端超时控制（默认 2 分钟）
        const timeoutController = new AbortController();
        const timer = setTimeout(() => timeoutController.abort(), timeout);

        // 合并外部 signal 和超时 signal
        let combinedSignal;
        if (signal) {
            if (typeof AbortSignal.any === 'function') {
                combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
            } else {
                // 兼容旧浏览器：手动监听外部信号
                combinedSignal = timeoutController.signal;
                const onExternalAbort = () => timeoutController.abort();
                signal.addEventListener('abort', onExternalAbort, { once: true });
            }
        } else {
            combinedSignal = timeoutController.signal;
        }

        try {
            const response = await AuthManager.fetchWithAuth(API_ENDPOINTS.AI.CHAT, {
                method: 'POST',
                signal: combinedSignal,
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
        } finally {
            clearTimeout(timer);
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
     * 批量翻译标题（单次 API 调用）
     * @param {Array<{id: string|number, title: string}>} items - 文章对象数组
     * @param {string} targetLangId - 目标语言 ID
     * @returns {Promise<Map<string|number, string>>} id -> 翻译结果 Map
     */
    async translateTitlesBatch(items, targetLangId, signal = null) {
        const resultMap = new Map();
        if (!items || items.length === 0) return resultMap;

        // 过滤已缓存的（内存 Map）
        let needTranslate = items.filter(item => {
            const cacheKey = `${item.title}||${targetLangId}`;
            if (this._titleCache.has(cacheKey)) {
                resultMap.set(item.id, this._titleCache.get(cacheKey));
                return false;
            }
            return true;
        });

        if (needTranslate.length === 0) return resultMap;

        // Map 未命中 → 回退服务端数据库查询
        try {
            const missedKeys = needTranslate.map(item => `${item.title}||${targetLangId}`);
            const serverHits = await AICache.lookupTitleCacheBatch(missedKeys);
            if (serverHits && serverHits.size > 0) {
                needTranslate = needTranslate.filter(item => {
                    const cacheKey = `${item.title}||${targetLangId}`;
                    const cached = serverHits.get(cacheKey);
                    if (cached) {
                        this._titleCache.set(cacheKey, cached);
                        resultMap.set(item.id, cached);
                        return false;
                    }
                    return true;
                });
                if (needTranslate.length === 0) return resultMap;
            }
        } catch (e) {
            // 查询失败不阻塞，继续走 AI 翻译
            console.warn('[AIService] Server title cache lookup failed:', e);
        }

        const targetLang = this.getLanguageName(targetLangId);
        // 构建批量翻译提示词
        const titlesBlock = needTranslate.map((item, i) => `${i + 1}. ${item.title}`).join('\n');
        const promptTemplate = this.getPrompt('titleTranslate');
        const prompt = promptTemplate
            .replace('{{targetLang}}', targetLang)
            .replace('{{content}}', titlesBlock);

        try {
            const result = await this.callAPI(prompt, null, signal);
            const lines = result.trim().split('\n').filter(l => l.trim());

            // 解析编号行，建立 编号 -> 翻译内容 的映射
            // 支持 AI 返回额外文字（如 "以下是翻译结果"）的情况
            const numberedMap = new Map();
            for (const line of lines) {
                const match = line.match(/^(\d+)\.\s*(.+)/);
                if (match) {
                    numberedMap.set(parseInt(match[1]), match[2].trim());
                }
            }

            const newEntries = [];
            for (let i = 0; i < needTranslate.length; i++) {
                const num = i + 1; // 编号从 1 开始
                let translated = numberedMap.get(num) || needTranslate[i].title; // 按编号匹配，找不到则回退到原标题
                const cacheKey = `${needTranslate[i].title}||${targetLangId}`;
                this._titleCache.set(cacheKey, translated);
                resultMap.set(needTranslate[i].id, translated);
                newEntries.push({ cacheKey, content: translated });
            }
            // 增量保存本批新翻译的条目
            this._saveTitleCacheBatch(newEntries);
        } catch (e) {
            console.error('[AIService] Batch title translation failed:', e);
            throw e;
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
