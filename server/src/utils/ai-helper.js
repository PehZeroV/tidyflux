/**
 * AI Helper - 服务端 AI 调用工具函数
 *
 * 提供通用的 LLM API 调用、翻译、摘要等功能，
 * 供后台调度器和其他服务端模块复用。
 */

import { parseHTML } from 'linkedom';

// ==================== 默认 Prompt 模板 ====================
const DEFAULT_PROMPTS = {
    titleTranslate: 'Translate each of the following titles into {{targetLang}}. Output ONLY the translated titles, one per line, in the same numbered format (e.g. "1. translated title"). Do not add any extra text:\n\n{{content}}',
    translate: 'Please translate the following text into {{targetLang}}, maintaining the original format and paragraph structure. Return only the translated content, directly outputting the translation result without any additional text:\n\n{{content}}',
    summarize: 'Please summarize this article in {{targetLang}} in a few sentences. Output the result directly without any introductory text like "Here is the summary".\n\n{{content}}'
};

// ==================== 语言映射 ====================
const AI_LANGUAGES = {
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    'en': 'English',
    'ja': '日本語',
    'ko': '한국어',
    'fr': 'Français',
    'de': 'Deutsch',
    'es': 'Español',
    'pt': 'Português',
    'ru': 'Русский'
};

function getLanguageName(langId) {
    return AI_LANGUAGES[langId] || langId;
}

// ==================== URL 处理 ====================
export function normalizeApiUrl(url) {
    let normalized = url.trim();
    if (!normalized.endsWith('/')) normalized += '/';
    if (!normalized.endsWith('chat/completions')) {
        normalized += 'chat/completions';
    }
    return normalized;
}

// ==================== HTML → 纯文本 ====================
export function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ==================== 核心 AI 调用 ====================
/**
 * 通用 LLM API 调用
 * @param {string} prompt - 完整的 prompt
 * @param {object} aiConfig - { apiUrl, apiKey, model, temperature, provider }
 * @param {object} [options]
 * @param {number} [options.timeoutMs=120000] - 超时时间 (毫秒)
 * @param {boolean} [options.returnUsage=false] - 是否返回 token 用量
 * @returns {Promise<string | { content: string, usage: object|null }>}
 */
export async function callAI(prompt, aiConfig, options = {}) {
    const { timeoutMs = 120000, returnUsage = false } = options;

    const isOllama = aiConfig?.provider === 'ollama';
    if (!aiConfig?.apiUrl || (!isOllama && !aiConfig?.apiKey)) {
        throw new Error('AI not configured');
    }

    const apiUrl = normalizeApiUrl(aiConfig.apiUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const headers = { 'Content-Type': 'application/json' };
    if (aiConfig.apiKey) headers['Authorization'] = `Bearer ${aiConfig.apiKey}`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: aiConfig.model || 'gpt-4.1-mini',
                temperature: aiConfig.temperature ?? 1,
                messages: [{ role: 'user', content: prompt }],
                stream: false
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const statusCode = response.status;
            const msg = error.error?.message || `AI API Error: ${statusCode}`;
            const err = new Error(msg);
            err.statusCode = statusCode;
            throw err;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        if (returnUsage) {
            return { content, usage: data.usage || null };
        }
        return content;
    } finally {
        clearTimeout(timeout);
    }
}

// ==================== 翻译 ====================
/**
 * 翻译文本
 * @param {string} content - 要翻译的内容
 * @param {string} targetLangId - 目标语言 ID (如 'zh-CN')
 * @param {object} aiConfig
 * @param {string} [customPrompt] - 自定义 prompt 模板
 */
export async function translateText(content, targetLangId, aiConfig, customPrompt) {
    const targetLang = getLanguageName(targetLangId);
    const template = (customPrompt && customPrompt.trim()) ? customPrompt : DEFAULT_PROMPTS.translate;
    const prompt = template
        .replace(/\{\{targetLang\}\}/g, targetLang)
        .replace(/\{\{content\}\}/g, content);
    return callAI(prompt, aiConfig);
}

// ==================== 摘要 ====================
/**
 * 生成摘要
 * @param {string} content - 文章内容
 * @param {string} targetLangId - 目标语言 ID
 * @param {object} aiConfig
 * @param {string} [customPrompt]
 */
export async function summarizeText(content, targetLangId, aiConfig, customPrompt) {
    const targetLang = getLanguageName(targetLangId);
    const template = (customPrompt && customPrompt.trim()) ? customPrompt : DEFAULT_PROMPTS.summarize;
    const prompt = template
        .replace(/\{\{targetLang\}\}/g, targetLang)
        .replace(/\{\{content\}\}/g, content);
    return callAI(prompt, aiConfig);
}

// ==================== 批量标题翻译 ====================
/**
 * 批量翻译标题
 * @param {Array<{id: number, title: string}>} items
 * @param {string} targetLangId
 * @param {object} aiConfig
 * @param {string} [customPrompt]
 * @returns {Promise<Map<number, string>>} id → 翻译结果
 */
export async function translateTitlesBatch(items, targetLangId, aiConfig, customPrompt) {
    const resultMap = new Map();
    if (!items || items.length === 0) return resultMap;

    const targetLang = getLanguageName(targetLangId);
    const titlesBlock = items.map((item, i) => `${i + 1}. ${item.title}`).join('\n');
    const template = (customPrompt && customPrompt.trim()) ? customPrompt : DEFAULT_PROMPTS.titleTranslate;
    const prompt = template
        .replace(/\{\{targetLang\}\}/g, targetLang)
        .replace(/\{\{content\}\}/g, titlesBlock);

    const result = await callAI(prompt, aiConfig);
    const lines = result.trim().split('\n').filter(l => l.trim());

    // 解析编号行
    const numberedMap = new Map();
    for (const line of lines) {
        const match = line.match(/^(\d+)\.\s*(.+)/);
        if (match) {
            numberedMap.set(parseInt(match[1]), match[2].trim());
        }
    }

    for (let i = 0; i < items.length; i++) {
        const num = i + 1;
        const translated = numberedMap.get(num) || items[i].title;
        resultMap.set(items[i].id, translated);
    }

    return resultMap;
}

// ==================== HTML 文本块提取（使用 linkedom，与前端 collectTranslatableBlocks 完全一致）====================

// 与前端 article-ai.js 完全一致的常量
const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CANVAS', 'DD', 'DIV', 'DL', 'DT',
    'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5',
    'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'NOSCRIPT', 'OL', 'P', 'SECTION',
    'TABLE', 'TFOOT', 'UL', 'VIDEO'
]);
const SKIP_TAGS = ['SCRIPT', 'STYLE', 'SVG', 'IFRAME', 'BUTTON', 'CODE'];
const CONTAINER_TAGS = ['MATH', 'PRE', 'TABLE'];

/**
 * 判断文本是否有意义（非纯标点/数字/符号）
 * 与前端 isMeaningfulText 完全一致
 */
function isMeaningfulText(text) {
    const cleaned = text.replace(/[\p{P}\p{S}\p{Z}\p{N}]+/gu, '').trim();
    return cleaned.length >= 1;
}

/**
 * 从 HTML 中提取可翻译的文本块
 * 使用 linkedom 进行 DOM 解析，逻辑与前端 collectTranslatableBlocks 完全一致
 * @param {string} html - 文章 HTML 内容
 * @param {string} [title] - 文章标题
 * @returns {Array<{text: string, isTitle: boolean}>}
 */
export function extractTextBlocks(html, title) {
    const blocks = [];

    // 加入标题（与前端 titleEl.textContent.trim() 一致）
    if (title && title.trim()) {
        blocks.push({ text: title.trim(), isTitle: true });
    }

    if (!html) return blocks;

    const { document } = parseHTML(`<div id="body">${html}</div>`);
    const bodyEl = document.getElementById('body');
    if (!bodyEl) return blocks;

    // 与前端 collectTranslatableBlocks 完全一致的逻辑
    let pendingInlineNodes = [];

    const flushInlineBlock = () => {
        if (pendingInlineNodes.length === 0) return;
        let textContent = '';
        pendingInlineNodes.forEach(node => {
            if (node.nodeType === 1 /* ELEMENT_NODE */) {
                textContent += node.tagName === 'BR' ? '\n' : (node.textContent || '');
            } else {
                textContent += node.textContent || '';
            }
        });
        const trimmedText = textContent.trim();
        if (trimmedText.length >= 2 && isMeaningfulText(trimmedText)) {
            blocks.push({ text: trimmedText, isTitle: false });
        }
        pendingInlineNodes = [];
    };

    if (bodyEl.childNodes.length > 0) {
        Array.from(bodyEl.childNodes).forEach(node => {
            if (node.nodeType === 1 /* ELEMENT_NODE */) {
                const tag = node.tagName.toUpperCase();
                if (SKIP_TAGS.includes(tag)) return;
                if (CONTAINER_TAGS.includes(tag)) { flushInlineBlock(); return; }
                if (BLOCK_TAGS.has(tag)) {
                    flushInlineBlock();
                    if (node.querySelector('math, pre, table')) return;
                    const text = node.textContent ? node.textContent.trim() : '';
                    if (text.length >= 2 && isMeaningfulText(text)) {
                        blocks.push({ text, isTitle: false });
                    }
                    return;
                }
            }
            if (node.nodeType === 3 /* TEXT_NODE */ && !node.textContent.trim() && pendingInlineNodes.length === 0) return;
            pendingInlineNodes.push(node);
        });
        flushInlineBlock();
    } else if (bodyEl.textContent.trim().length > 0) {
        const text = bodyEl.textContent.trim();
        if (text.length >= 2 && isMeaningfulText(text)) {
            blocks.push({ text, isTitle: false });
        }
    }

    return blocks;
}

// ==================== 批量段落翻译 ====================
/**
 * 批量翻译文本块，返回前端缓存格式 [{text, html, isTitle}, ...]
 * @param {Array<{text: string, isTitle: boolean}>} blocks
 * @param {string} targetLangId
 * @param {object} aiConfig
 * @param {string} [customPrompt] - 用户自定义翻译提示词，作为风格指导追加
 * @returns {Promise<Array<{text: string, html: string, isTitle: boolean}>>}
 */
export async function translateBlocksBatch(blocks, targetLangId, aiConfig, customPrompt) {
    if (!blocks || blocks.length === 0) return [];

    const targetLang = getLanguageName(targetLangId);
    const numbered = blocks.map((b, i) => `${i + 1}. ${b.text}`).join('\n\n');

    // 使用自定义 prompt 或默认翻译 prompt 作为模板
    const template = (customPrompt && customPrompt.trim()) ? customPrompt : DEFAULT_PROMPTS.translate;

    // 构建分段内容：在编号文本前加上格式要求
    const blockContent = `(The following text is divided into numbered blocks. Translate each block and output in the same numbered format, e.g. "1. translated text". Do not add any extra text.)\n\n${numbered}`;

    // 替换模板中的占位符
    const prompt = template
        .replace(/\{\{targetLang\}\}/g, targetLang)
        .replace(/\{\{content\}\}/g, blockContent);

    const result = await callAI(prompt, aiConfig);

    // 解析 "N. 翻译内容" 格式的返回
    const numberedMap = new Map();
    const lines = result.split(/\n/);
    let currentNum = null;
    let currentText = '';

    for (const line of lines) {
        const match = line.match(/^(\d+)\.\s*(.*)/);
        if (match) {
            // 保存上一个块
            if (currentNum !== null) {
                numberedMap.set(currentNum, currentText.trim());
            }
            currentNum = parseInt(match[1]);
            currentText = match[2];
        } else if (currentNum !== null) {
            currentText += '\n' + line;
        }
    }
    // 保存最后一个块
    if (currentNum !== null) {
        numberedMap.set(currentNum, currentText.trim());
    }

    return blocks.map((block, i) => ({
        text: block.text,
        html: numberedMap.get(i + 1) || block.text,
        isTitle: !!block.isTitle
    }));
}
