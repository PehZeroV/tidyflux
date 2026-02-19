/**
 * ArticleAIMixin - AI 功能模块（翻译 + 总结）
 * @module view/article-ai
 *
 * 通过 Mixin 模式合并到 ArticleContentView
 * - translateBilingual: 双语段落翻译
 * - bindAIButtons: AI 按钮事件绑定（总结 + 翻译）
 */

import { AIService } from '../ai-service.js';
import { AICache } from '../ai-cache.js';
import { Modal } from './components.js';
import { i18n } from '../i18n.js';
import { showToast } from './utils.js';
import { Dialogs } from './dialogs.js';

export const ArticleAIMixin = {
    /**
     * 双语段落翻译
     * @param {HTMLElement} bodyEl
     * @param {HTMLElement} titleEl
     * @param {AbortSignal} signal
     * @param {number|string} [entryId] - 文章ID，用于缓存
     */
    async translateBilingual(bodyEl, titleEl, signal = null, entryId = null) {
        // 1. 识别需要翻译的块
        const blocks = [];
        if (titleEl) blocks.push({ el: titleEl, isTitle: true, text: titleEl.textContent.trim() });

        const blockTags = new Set([
            'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CANVAS', 'DD', 'DIV', 'DL', 'DT',
            'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5',
            'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'NOSCRIPT', 'OL', 'P', 'SECTION',
            'TABLE', 'TFOOT', 'UL', 'VIDEO'
        ]);

        const isMeaningfulText = (text) => {
            // 移除常见的干扰字符 (Emoji, 标点, 空白, 数字)
            // \p{P}: Punctuation, \p{S}: Symbols (including Emojis), \p{Z}: Separators, \p{N}: Numbers
            // 保留一点余地：如果文本包含至少一个字母或 CJK 字符等连续语义字符
            const cleanText = text.replace(/[\p{P}\p{S}\p{Z}\p{N}]+/gu, '').trim();
            return cleanText.length >= 1;
        };

        let pendingInlineNodes = [];

        const flushInlineBlock = () => {
            if (pendingInlineNodes.length === 0) return;

            let textContent = '';
            pendingInlineNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.tagName === 'BR') {
                        textContent += '\n';
                    } else {
                        textContent += node.textContent || '';
                    }
                } else {
                    textContent += node.textContent || '';
                }
            });

            const trimmedText = textContent.trim();
            if (trimmedText.length >= 2 && isMeaningfulText(trimmedText)) {
                blocks.push({
                    el: pendingInlineNodes[pendingInlineNodes.length - 1],
                    text: trimmedText
                });
            }
            pendingInlineNodes = [];
        };

        if (bodyEl.childNodes.length > 0) {
            Array.from(bodyEl.childNodes).forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const tag = node.tagName.toUpperCase();
                    if (['SCRIPT', 'STYLE', 'SVG', 'IFRAME', 'BUTTON', 'CODE'].includes(tag)) return;

                    // 容器类标签 (代码块、公式、表格)：中断当前行内累积，且不参与翻译
                    if (['MATH', 'PRE', 'TABLE'].includes(tag)) {
                        flushInlineBlock();
                        return;
                    }

                    if (node.classList.contains('ai-trans-block') || node.classList.contains('article-toolbar') || node.classList.contains('preview-summary-box')) return;

                    if (blockTags.has(tag)) {
                        flushInlineBlock();

                        // 如果块级元素内部包含不需要翻译的特殊标签，直接跳过整个块的翻译
                        if (node.querySelector('math, pre, table')) {
                            return;
                        }

                        const text = node.textContent ? node.textContent.trim() : '';
                        if (text.length >= 2 && isMeaningfulText(text)) {
                            blocks.push({ el: node, text: text });
                        }
                        return;
                    }
                }

                if (node.nodeType === Node.TEXT_NODE) {
                    if (!node.textContent.trim() && pendingInlineNodes.length === 0) return;
                }

                pendingInlineNodes.push(node);
            });
            flushInlineBlock();
        } else if (bodyEl.textContent.trim().length > 0) {
            const text = bodyEl.textContent.trim();
            if (text.length >= 2 && isMeaningfulText(text)) {
                blocks.push({ el: bodyEl, text: text });
            }
        }

        // 2. 插入占位符
        blocks.forEach(block => {
            const transEl = document.createElement('div');
            transEl.className = block.isTitle ? 'ai-title-trans-block' : 'ai-trans-block';

            block.transEl = transEl;

            if (block.isTitle) {
                const computedStyle = window.getComputedStyle(block.el);

                transEl.style.fontFamily = computedStyle.fontFamily;
                transEl.style.fontSize = computedStyle.fontSize;
                transEl.style.fontWeight = computedStyle.fontWeight;
                transEl.style.lineHeight = computedStyle.lineHeight;
                transEl.style.color = computedStyle.color;
                transEl.style.letterSpacing = computedStyle.letterSpacing;
                transEl.style.textTransform = computedStyle.textTransform;

                transEl.style.marginTop = '8px';
                transEl.style.marginBottom = '4px';

                transEl.innerHTML = `<span style="opacity:0.6; font-size: 0.6em; font-weight: normal;">... ${i18n.t('ai.translating')} ...</span>`;

                const parent = block.el.tagName.toLowerCase() === 'a' ? block.el.parentElement : block.el;
                parent.insertAdjacentElement('afterend', transEl);
            } else {
                transEl.style.color = 'var(--text-secondary)';
                transEl.style.fontSize = '0.95em';
                transEl.style.marginTop = '6px';
                transEl.style.marginBottom = '20px';
                transEl.style.padding = '8px 12px';
                transEl.style.background = 'color-mix(in srgb, var(--accent-color), transparent 94%)';
                transEl.style.borderRadius = 'var(--radius)';
                transEl.innerHTML = `<span style="opacity:0.6; font-size: 0.9em;">... ${i18n.t('ai.translating')} ...</span>`;

                if (block.el.nodeType === Node.ELEMENT_NODE) {
                    block.el.insertAdjacentElement('afterend', transEl);
                } else if (block.el.parentNode) {
                    block.el.parentNode.insertBefore(transEl, block.el.nextSibling);
                }
            }
        });

        // 3. 并发队列执行翻译
        const CONCURRENT_LIMIT = AIService.getConfig().concurrency || 5;
        let currentIndex = 0;

        const processNext = async () => {
            while (currentIndex < blocks.length) {
                const index = currentIndex++;
                const block = blocks[index];

                if (signal?.aborted) return;

                try {
                    const aiConfig = AIService.getConfig();
                    const targetLang = aiConfig.targetLang || (i18n.locale === 'zh' ? 'zh-CN' : 'en');

                    // 标题块优先读取标题翻译缓存（列表自动翻译已缓存）
                    if (block.isTitle) {
                        const cachedTitle = AIService.getTitleCache(block.text, targetLang);
                        if (cachedTitle) {
                            block.transEl.innerHTML = this.parseMarkdown(cachedTitle);
                            continue;
                        }
                    }

                    const translation = await AIService.translate(block.text, targetLang, null, signal);
                    if (signal?.aborted) return;
                    block.transEl.innerHTML = this.parseMarkdown(translation);
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.error('Block translate error:', err);
                    block.failed = true;
                    this._showBlockTranslateError(block, err, blocks);
                }
            }
        };

        const workers = [];
        for (let i = 0; i < CONCURRENT_LIMIT; i++) {
            workers.push(processNext());
        }

        await Promise.all(workers);

        // 翻译完成后写入 IndexedDB 缓存（仅在全部成功时缓存，避免缓存错误信息）
        const hasFailure = blocks.some(b => b.failed);
        if (entryId && !signal?.aborted && !hasFailure) {
            try {
                const aiConfig = AIService.getConfig();
                const lang = aiConfig.targetLang || (i18n.locale === 'zh' ? 'zh-CN' : 'en');
                const cacheData = blocks.map(b => ({
                    text: b.text,
                    html: b.transEl.innerHTML,
                    isTitle: !!b.isTitle
                }));
                AICache.setTranslation(entryId, lang, JSON.stringify(cacheData)).catch(() => { });
            } catch { /* ignore */ }
        }
    },

    /**
     * 显示翻译块的错误信息和重试按钮（点击重试所有失败块）
     */
    _showBlockTranslateError(block, err, blocks) {
        const statusCode = err.statusCode || err.status || '';
        const errorMsg = statusCode ? `${i18n.t('ai.translate_failed')} (${statusCode})` : i18n.t('ai.translate_failed');
        block.transEl.innerHTML = `<span style="color: #e55; font-size: 0.85em;">${errorMsg}</span><button class="ai-retry-btn">${i18n.t('common.retry')}</button>`;
        block.transEl.querySelector('.ai-retry-btn')?.addEventListener('click', () => {
            this._retryFailedBlocks(blocks);
        });
    },

    /**
     * 批量重试所有失败的翻译块
     */
    async _retryFailedBlocks(blocks) {
        const failedBlocks = blocks.filter(b => b.failed);
        if (failedBlocks.length === 0) return;

        // 将所有失败块设为加载状态
        failedBlocks.forEach(block => {
            block.transEl.innerHTML = `<span style="opacity:0.6; font-size: 0.9em;">... ${i18n.t('ai.translating')} ...</span>`;
        });

        const aiConfig = AIService.getConfig();
        const targetLang = aiConfig.targetLang || (i18n.locale === 'zh' ? 'zh-CN' : 'en');

        // 并发重试
        const CONCURRENT_LIMIT = AIService.getConfig().concurrency || 5;
        let currentIndex = 0;

        const processNext = async () => {
            while (currentIndex < failedBlocks.length) {
                const block = failedBlocks[currentIndex++];
                try {
                    const translation = await AIService.translate(block.text, targetLang);
                    block.transEl.innerHTML = this.parseMarkdown(translation);
                    block.failed = false;
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.error('Block translate retry error:', err);
                    this._showBlockTranslateError(block, err, blocks);
                }
            }
        };

        const retryWorkers = [];
        for (let i = 0; i < CONCURRENT_LIMIT; i++) {
            retryWorkers.push(processNext());
        }
        await Promise.all(retryWorkers);
    },

    /**
     * 从 IndexedDB 恢复翻译缓存
     * @param {HTMLElement} bodyEl
     * @param {HTMLElement} titleEl
     * @param {number|string} entryId
     * @returns {Promise<boolean>} 是否成功恢复
     */
    async _restoreTranslationFromCache(bodyEl, titleEl, entryId) {
        try {
            const aiConfig = AIService.getConfig();
            const lang = aiConfig.targetLang || (i18n.locale === 'zh' ? 'zh-CN' : 'en');
            const raw = await AICache.getTranslation(entryId, lang);
            if (!raw) return false;

            const cacheData = JSON.parse(raw);
            if (!Array.isArray(cacheData) || cacheData.length === 0) return false;

            // 重新识别文本块（与 translateBilingual 相同逻辑）
            const blocks = [];
            if (titleEl) blocks.push({ el: titleEl, isTitle: true, text: titleEl.textContent.trim() });

            const blockTags = new Set([
                'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CANVAS', 'DD', 'DIV', 'DL', 'DT',
                'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5',
                'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'NOSCRIPT', 'OL', 'P', 'SECTION',
                'TABLE', 'TFOOT', 'UL', 'VIDEO'
            ]);

            const isMeaningfulText = (text) => {
                const cleanText = text.replace(/[\p{P}\p{S}\p{Z}\p{N}]+/gu, '').trim();
                return cleanText.length >= 1;
            };

            let pendingInlineNodes = [];
            const flushInlineBlock = () => {
                if (pendingInlineNodes.length === 0) return;
                let textContent = '';
                pendingInlineNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        textContent += node.tagName === 'BR' ? '\n' : (node.textContent || '');
                    } else {
                        textContent += node.textContent || '';
                    }
                });
                const trimmedText = textContent.trim();
                if (trimmedText.length >= 2 && isMeaningfulText(trimmedText)) {
                    blocks.push({ el: pendingInlineNodes[pendingInlineNodes.length - 1], text: trimmedText });
                }
                pendingInlineNodes = [];
            };

            if (bodyEl.childNodes.length > 0) {
                Array.from(bodyEl.childNodes).forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const tag = node.tagName.toUpperCase();
                        if (['SCRIPT', 'STYLE', 'SVG', 'IFRAME', 'BUTTON', 'CODE'].includes(tag)) return;
                        if (['MATH', 'PRE', 'TABLE'].includes(tag)) { flushInlineBlock(); return; }
                        if (node.classList.contains('ai-trans-block') || node.classList.contains('article-toolbar') || node.classList.contains('preview-summary-box')) return;
                        if (blockTags.has(tag)) {
                            flushInlineBlock();
                            if (node.querySelector('math, pre, table')) return;
                            const text = node.textContent ? node.textContent.trim() : '';
                            if (text.length >= 2 && isMeaningfulText(text)) blocks.push({ el: node, text });
                            return;
                        }
                    }
                    if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim() && pendingInlineNodes.length === 0) return;
                    pendingInlineNodes.push(node);
                });
                flushInlineBlock();
            }

            // 建立文本到缓存翻译的映射
            const cacheMap = new Map(cacheData.map(d => [d.text, d]));

            let restored = 0;
            blocks.forEach(block => {
                const cached = cacheMap.get(block.text);
                if (!cached) return;

                const transEl = document.createElement('div');
                transEl.className = block.isTitle ? 'ai-title-trans-block' : 'ai-trans-block';
                transEl.innerHTML = cached.html;

                if (block.isTitle) {
                    const computedStyle = window.getComputedStyle(block.el);
                    transEl.style.fontFamily = computedStyle.fontFamily;
                    transEl.style.fontSize = computedStyle.fontSize;
                    transEl.style.fontWeight = computedStyle.fontWeight;
                    transEl.style.lineHeight = computedStyle.lineHeight;
                    transEl.style.color = computedStyle.color;
                    transEl.style.letterSpacing = computedStyle.letterSpacing;
                    transEl.style.textTransform = computedStyle.textTransform;
                    transEl.style.marginTop = '8px';
                    transEl.style.marginBottom = '4px';
                    const parent = block.el.tagName.toLowerCase() === 'a' ? block.el.parentElement : block.el;
                    parent.insertAdjacentElement('afterend', transEl);
                } else {
                    transEl.style.color = 'var(--text-secondary)';
                    transEl.style.fontSize = '0.95em';
                    transEl.style.marginTop = '6px';
                    transEl.style.marginBottom = '20px';
                    transEl.style.padding = '8px 12px';
                    transEl.style.background = 'color-mix(in srgb, var(--accent-color), transparent 94%)';
                    transEl.style.borderRadius = 'var(--radius)';
                    if (block.el.nodeType === Node.ELEMENT_NODE) {
                        block.el.insertAdjacentElement('afterend', transEl);
                    } else if (block.el.parentNode) {
                        block.el.parentNode.insertBefore(transEl, block.el.nextSibling);
                    }
                }
                restored++;
            });

            console.debug(`[AICache] Restored ${restored}/${blocks.length} translation blocks from cache`);
            return restored > 0;
        } catch (e) {
            console.warn('[AICache] Restore translation failed:', e);
            return false;
        }
    },

    /**
     * 绑定 AI 功能按钮
     * @param {Object} article - 文章对象
     */
    bindAIButtons(article) {
        const translateBtn = document.getElementById('article-translate-btn');
        const summarizeBtn = document.getElementById('article-summarize-btn');
        const summaryBox = document.getElementById('article-ai-summary');

        // 总结功能
        if (summarizeBtn && summaryBox) {
            const summaryContent = summaryBox.querySelector('.ai-content');
            const closeBtn = summaryBox.querySelector('.ai-close-btn');

            closeBtn.addEventListener('click', () => {
                summaryBox.style.display = 'none';
            });

            // 如果已有缓存的总结，直接显示（可以在 article 对象上缓存）
            // 这里暂不实现持久化缓存，仅页面级

            summarizeBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (!AIService.isConfigured()) {
                    Modal.alertWithSettings(i18n.t('ai.not_configured'), i18n.t('common.go_to_settings'), () => Dialogs.showSettingsDialog(false));
                    return;
                }

                // 如果正在加载，点击取消
                if (summarizeBtn.classList.contains('loading')) {
                    if (article._summarizeController) {
                        article._summarizeController.abort();
                        article._summarizeController = null;
                        summarizeBtn.classList.remove('loading');
                        summaryBox.style.display = 'none';
                        summaryContent.innerHTML = '';
                    }
                    return;
                }

                if (summarizeBtn.classList.contains('active')) {
                    summaryBox.style.display = summaryBox.style.display === 'none' ? 'block' : 'none';
                    return;
                }

                summarizeBtn.classList.add('loading');
                summaryBox.style.display = 'block';
                summaryContent.innerHTML = `<div class="loading-spinner">${i18n.t('ai.summarizing')}</div>`;

                try {
                    // 先检查 IndexedDB 缓存
                    const cached = await AICache.getSummary(article.id);
                    if (cached) {
                        summaryContent.innerHTML = this.parseMarkdown(cached);
                        article._aiSummary = cached;
                        summarizeBtn.classList.remove('loading');
                        summarizeBtn.classList.add('active');
                        return;
                    }

                    // 创建 AbortController
                    article._summarizeController = new AbortController();
                    const signal = article._summarizeController.signal;

                    // 获取纯文本内容用于总结
                    const rawContent = AIService.extractText(article.content || '');

                    // 获取配置的目标语言
                    const aiConfig = AIService.getConfig();
                    const targetLang = aiConfig.targetLang || (i18n.locale === 'zh' ? 'zh-CN' : 'en');

                    let streamedText = '';
                    await AIService.summarize(rawContent, targetLang, (chunk) => {
                        streamedText += chunk;
                        summaryContent.innerHTML = this.parseMarkdown(streamedText);
                    }, signal);

                    // 写入 IndexedDB 缓存
                    AICache.setSummary(article.id, streamedText).catch(() => { });

                    summarizeBtn.classList.remove('loading');
                    summarizeBtn.classList.add('active');
                } catch (err) {
                    if (err.name === 'AbortError') {
                        console.log('Summarize aborted');
                        return;
                    }
                    console.error('Summarize failed:', err);
                    const statusCode = err.statusCode || err.status || '';
                    const errorMsg = statusCode ? `${i18n.t('ai.api_error')} (${statusCode})` : `${i18n.t('ai.api_error')}`;
                    summaryContent.innerHTML = `<span style="color: var(--danger-color); font-size: 0.9em;">${errorMsg}</span><button class="ai-retry-btn">${i18n.t('common.retry')}</button>`;
                    summaryContent.querySelector('.ai-retry-btn')?.addEventListener('click', () => {
                        summarizeBtn.click();
                    });
                    summarizeBtn.classList.remove('loading');
                } finally {
                    article._summarizeController = null;
                }
            });
        }

        // 翻译功能
        if (translateBtn) {
            // 如果已有翻译缓存
            if (article._translatedContent) {
                translateBtn.classList.add('active');
                translateBtn.setAttribute('data-tooltip', i18n.t('ai.original_content'));
            }

            translateBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                // 取消逻辑
                if (translateBtn.classList.contains('loading')) {
                    if (article._translateController) {
                        article._translateController.abort();
                        article._translateController = null;
                        translateBtn.classList.remove('loading');

                        // 清理已生成的翻译块
                        const bodyEl = document.querySelector('.article-body');
                        if (bodyEl) {
                            bodyEl.querySelectorAll('.ai-trans-block').forEach(el => el.remove());
                        }
                        const titleTransBlock = document.querySelector('.ai-title-trans-block');
                        if (titleTransBlock) titleTransBlock.remove();

                        translateBtn.classList.remove('active');
                        translateBtn.setAttribute('data-tooltip', i18n.t('ai.translate_btn'));

                        showToast(i18n.t('ai.translate_cancelled'));
                    }
                    return;
                }

                if (!AIService.isConfigured()) {
                    Modal.alertWithSettings(i18n.t('ai.not_configured'), i18n.t('common.go_to_settings'), () => Dialogs.showSettingsDialog(false));
                    return;
                }

                const bodyEl = document.querySelector('.article-body');
                const titleHeader = document.querySelector('.article-header h1');
                const titleLink = titleHeader ? titleHeader.querySelector('a') : null;
                const titleEl = titleLink || titleHeader;

                if (!bodyEl) return;

                // 检查是否已经是双语模式（存在翻译块）
                const existingBlocks = bodyEl.querySelectorAll('.ai-trans-block');
                const existingTitleBlock = document.querySelector('.ai-title-trans-block');

                if (existingBlocks.length > 0 || existingTitleBlock) {
                    // 切换显示/隐藏
                    const anyVisible = (existingTitleBlock && existingTitleBlock.style.display !== 'none') ||
                        (existingBlocks.length > 0 && existingBlocks[0].style.display !== 'none');

                    const newDisplay = anyVisible ? 'none' : 'block';

                    if (existingTitleBlock) existingTitleBlock.style.display = newDisplay;
                    existingBlocks.forEach(el => el.style.display = newDisplay);

                    translateBtn.classList.toggle('active', !anyVisible);
                    translateBtn.setAttribute('data-tooltip', !anyVisible ? i18n.t('ai.original_content') : i18n.t('ai.translate_btn'));
                    return;
                }

                // 先检查 IndexedDB 翻译缓存
                const cacheRestored = await this._restoreTranslationFromCache(bodyEl, titleEl, article.id);
                if (cacheRestored) {
                    translateBtn.classList.add('active');
                    translateBtn.setAttribute('data-tooltip', i18n.t('ai.original_content'));
                    return;
                }

                // 开始双语翻译
                translateBtn.classList.add('loading');

                try {
                    article._translateController = new AbortController();
                    await this.translateBilingual(bodyEl, titleEl, article._translateController.signal, article.id);
                    translateBtn.classList.remove('loading');
                    translateBtn.classList.add('active');
                    translateBtn.setAttribute('data-tooltip', i18n.t('ai.original_content'));
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.error('Translation failed', err);
                    Modal.alert(`${i18n.t('ai.api_error')}: ${err.message}`);
                    translateBtn.classList.remove('loading');
                }
            });
        }
    },

    /**
     * 自动摘要：文章打开时自动生成 AI 摘要
     * @param {Object} article - 文章对象
     */
    async autoSummarize(article) {
        // 检查是否已配置 AI 且该订阅源启用了自动摘要
        if (!AIService.isConfigured()) return;
        if (!AIService.shouldAutoSummarize(article.feed_id)) return;

        // 简报类型跳过
        if (article._isDigest || article.is_digest) return;

        const summaryBox = document.getElementById('article-ai-summary');
        const summarizeBtn = document.getElementById('article-summarize-btn');
        if (!summaryBox) return;

        const summaryContent = summaryBox.querySelector('.ai-content');
        if (!summaryContent) return;

        // 如果已有缓存的摘要，直接显示
        if (article._aiSummary) {
            summaryBox.style.display = 'block';
            summaryContent.innerHTML = this.parseMarkdown(article._aiSummary);
            if (summarizeBtn) summarizeBtn.classList.add('active');
            return;
        }

        // 如果手动总结按钮正在加载或已完成，不重复触发
        if (summarizeBtn && (summarizeBtn.classList.contains('loading') || summarizeBtn.classList.contains('active'))) {
            return;
        }

        // 先检查 IndexedDB 缓存
        try {
            const cached = await AICache.getSummary(article.id);
            if (cached) {
                article._aiSummary = cached;
                summaryBox.style.display = 'block';
                summaryContent.innerHTML = this.parseMarkdown(cached);
                if (summarizeBtn) summarizeBtn.classList.add('active');
                return;
            }
        } catch { /* ignore */ }

        // 获取文章内容
        const rawContent = AIService.extractText(article.content || '');
        if (!rawContent || rawContent.trim().length < 50) return; // 内容太短不总结

        // 显示加载状态
        summaryBox.style.display = 'block';
        summaryContent.innerHTML = `<div class="loading-spinner">${i18n.t('ai.summarizing')}</div>`;
        if (summarizeBtn) summarizeBtn.classList.add('loading');

        // 绑定关闭按钮
        const closeBtn = summaryBox.querySelector('.ai-close-btn');
        if (closeBtn) {
            closeBtn.onclick = () => {
                summaryBox.style.display = 'none';
                // 如果正在加载，取消请求
                if (article._autoSummarizeController) {
                    article._autoSummarizeController.abort();
                    article._autoSummarizeController = null;
                    if (summarizeBtn) summarizeBtn.classList.remove('loading');
                }
            };
        }

        try {
            article._autoSummarizeController = new AbortController();
            const signal = article._autoSummarizeController.signal;

            const aiConfig = AIService.getConfig();
            const targetLang = aiConfig.targetLang || (i18n.locale === 'zh' ? 'zh-CN' : 'en');

            let streamedText = '';
            await AIService.summarize(rawContent, targetLang, (chunk) => {
                streamedText += chunk;
                summaryContent.innerHTML = this.parseMarkdown(streamedText);
            }, signal);

            // 缓存结果到内存和 IndexedDB
            article._aiSummary = streamedText;
            AICache.setSummary(article.id, streamedText).catch(() => { });
            if (summarizeBtn) {
                summarizeBtn.classList.remove('loading');
                summarizeBtn.classList.add('active');
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('[AutoSummary] 已取消');
                return;
            }
            console.error('[AutoSummary] 失败:', err);
            const statusCode = err.statusCode || err.status || '';
            const errorMsg = statusCode ? `${i18n.t('ai.api_error')} (${statusCode})` : `${i18n.t('ai.api_error')}`;
            summaryContent.innerHTML = `<span style="color: var(--danger-color); font-size: 0.9em;">${errorMsg}</span><button class="ai-retry-btn">${i18n.t('common.retry')}</button>`;
            summaryContent.querySelector('.ai-retry-btn')?.addEventListener('click', () => {
                this.autoSummarize(article);
            });
            if (summarizeBtn) summarizeBtn.classList.remove('loading');
        } finally {
            article._autoSummarizeController = null;
        }
    },

    /**
     * 自动翻译全文：文章打开时自动触发双语翻译
     * @param {Object} article - 文章对象
     */
    async autoTranslate(article) {
        // 检查是否已配置 AI 且该订阅源启用了自动翻译
        if (!AIService.isConfigured()) return;
        if (!AIService.shouldAutoTranslate(article.feed_id)) return;

        // 简报类型跳过
        if (article._isDigest || article.is_digest) return;

        const translateBtn = document.getElementById('article-translate-btn');
        const bodyEl = document.querySelector('.article-body');
        const titleHeader = document.querySelector('.article-header h1');
        const titleLink = titleHeader ? titleHeader.querySelector('a') : null;
        const titleEl = titleLink || titleHeader;

        if (!bodyEl) return;

        // 如果正文已有翻译块，说明正文已翻译，跳过
        const existingBlocks = bodyEl.querySelectorAll('.ai-trans-block');
        if (existingBlocks.length > 0) return;

        // 检查标题翻译块是否存在（标题可能在获取全文/恢复后保留）
        const existingTitleBlock = document.querySelector('.ai-title-trans-block');

        // 如果翻译按钮正在加载，不重复触发
        if (translateBtn && translateBtn.classList.contains('loading')) return;

        // 如果按钮已 active 且无标题翻译块，说明翻译已完整完成，跳过
        // 如果按钮已 active 且有标题翻译块但无正文翻译块，说明需要补充正文翻译
        if (translateBtn && translateBtn.classList.contains('active') && !existingTitleBlock) return;

        // 如果标题已翻译，只翻译正文（跳过标题避免重复创建翻译块）
        const effectiveTitleEl = existingTitleBlock ? null : titleEl;

        // 先检查 IndexedDB 翻译缓存（仅在标题未翻译时尝试，否则缓存中的正文部分已过期）
        if (!existingTitleBlock) {
            const cacheRestored = await this._restoreTranslationFromCache(bodyEl, titleEl, article.id);
            if (cacheRestored) {
                if (translateBtn) {
                    translateBtn.classList.add('active');
                    translateBtn.setAttribute('data-tooltip', i18n.t('ai.original_content'));
                }
                return;
            }
        }

        // 开始自动翻译
        if (translateBtn) translateBtn.classList.add('loading');

        try {
            article._translateController = new AbortController();
            await this.translateBilingual(bodyEl, effectiveTitleEl, article._translateController.signal, article.id);
            if (translateBtn) {
                translateBtn.classList.remove('loading');
                translateBtn.classList.add('active');
                translateBtn.setAttribute('data-tooltip', i18n.t('ai.original_content'));
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('[AutoTranslate] 失败:', err);
            if (translateBtn) translateBtn.classList.remove('loading');
        }
    },
};
