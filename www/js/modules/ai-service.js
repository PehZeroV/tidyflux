import { i18n } from './i18n.js';
import { AuthManager } from './auth-manager.js';
import { API_ENDPOINTS, STORAGE_KEYS } from '../constants.js';

const DEFAULT_AI_MODEL = 'gpt-4.1-mini';

// 默认提示词
const DEFAULT_PROMPTS = {
    translate: 'Please translate the following text into {targetLang}, maintaining the original format and paragraph structure. Return only the translated content, directly outputting the translation result without any additional text:\n\n{content}',
    summarize: 'Please summarize this article in {targetLang} in a few sentences. Output the result directly without any introductory text like "Here is the summary".\n\n{content}',
    digest: 'You are a professional news editor. Please generate a concise digest based on the following list of recent articles.\n\n## Output Requirements:\n1. Output in {targetLang}\n2. Start with a 2-3 sentence overview of today\'s/recent key content\n3. Categorize by topic or importance, listing key information in concise bullet points\n4. If multiple articles relate to the same topic, combine them\n5. Keep the format concise and compact, using Markdown\n6. Output the content directly, no opening remarks like "Here is the digest"\n\n## Article List:\n\n{content}'
};

// 语言选项
export const AI_LANGUAGES = [
    { id: 'zh-CN', name: '简体中文', nameEn: 'Simplified Chinese' },
    { id: 'zh-TW', name: '繁體中文', nameEn: 'Traditional Chinese' },
    { id: 'en', name: 'English', nameEn: 'English' },
    { id: 'ja', name: '日本語', nameEn: 'Japanese' },
    { id: 'ko', name: '한국어', nameEn: 'Korean' },
    { id: 'fr', name: 'Français', nameEn: 'French' },
    { id: 'de', name: 'Deutsch', nameEn: 'German' },
    { id: 'es', name: 'Español', nameEn: 'Spanish' },
    { id: 'pt', name: 'Português', nameEn: 'Portuguese' },
    { id: 'ru', name: 'Русский', nameEn: 'Russian' }
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

    /**
     * 初始化 AI 服务
     */
    async init() {
        await this.loadConfig();
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
            targetLang: 'zh-CN'
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

        // 检查并自动补全必要的占位符 {content}
        const promptKeys = ['translatePrompt', 'summarizePrompt', 'digestPrompt'];
        promptKeys.forEach((key) => {
            if (config[key]) {
                // 如果漏掉占位符，自动补全
                if (config[key].trim() && !config[key].includes('{content}')) {
                    config[key] = config[key].trim() + '\n\n{content}';
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
        return i18n.locale === 'zh' ? lang.name : lang.nameEn;
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
            throw new Error(error.error || `AI API Error: ${response.status}`);
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
            .replace('{targetLang}', targetLang)
            .replace('{content}', content);

        return this.callAPI(prompt, onChunk, signal);
    },

    /**
     * 总结内容
     */
    async summarize(content, targetLangId, onChunk = null, signal = null) {
        const targetLang = this.getLanguageName(targetLangId);
        const promptTemplate = this.getPrompt('summarize');
        const prompt = promptTemplate
            .replace('{targetLang}', targetLang)
            .replace('{content}', content);

        return this.callAPI(prompt, onChunk, signal);
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
