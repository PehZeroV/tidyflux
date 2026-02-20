/**
 * ArticlePreviewMixin - 文章预览弹窗模块
 * @module view/article-preview
 *
 * 通过 Mixin 模式合并到 ArticleContentView
 * - _processArticleRefs: 处理简报中的文章引用标记
 * - _showArticlePreview: 显示文章预览弹窗
 * - _previewAutoSummarize: 预览弹窗内的自动摘要
 * - _insertPreviewSummary: 插入摘要区块
 * - _previewAutoTranslate: 预览弹窗内的自动翻译
 */

import { FeedManager } from '../feed-manager.js';
import { AIService } from '../ai-service.js';
import { AICache } from '../ai-cache.js';
import { i18n } from '../i18n.js';

export const ArticlePreviewMixin = {
    /**
     * 处理简报中的文章引用标记 [ref:ID]
     * 先替换为占位符，避免 parseMarkdown 转义 HTML
     * @param {string} content - 简报内容
     * @param {Object} articleRefs - 文章引用映射 {id: {title, feedTitle}}
     * @returns {{content: string, placeholders: Object}} 处理后的内容和占位符映射
     */
    _processArticleRefs(content, articleRefs) {
        if (!content) return { content, placeholders: {} };
        const placeholders = {};
        let idx = 0;
        // 匹配 [ref:ID] 格式，ID 可以是数字
        const processed = content.replace(/\[ref:(\d+)\]/g, (match, articleId) => {
            const ref = articleRefs && articleRefs[articleId];
            const title = ref ? ref.title : `#${articleId}`;
            const tooltip = title.replace(/"/g, '&quot;');
            const placeholder = `\x00ARTREF_${idx}\x00`;
            placeholders[placeholder] = `<a href="#/article/${articleId}" class="digest-article-ref" data-article-id="${articleId}" title="${tooltip}"><sup>[↗\uFE0E]</sup></a>`;
            idx++;
            return placeholder;
        });
        return { content: processed, placeholders };
    },

    /**
     * 在桌面端显示文章预览悬浮框
     * @param {string} articleId - 文章 ID
     * @param {Object} articleRefs - 文章引用映射
     */
    async _showArticlePreview(articleId, articleRefs) {
        // 移除已存在的预览
        const existing = document.querySelector('.article-preview-overlay');
        if (existing) existing.remove();

        const ref = articleRefs && articleRefs[articleId];
        const previewTitle = ref ? ref.title : `Article #${articleId}`;

        // 创建预览弹窗 — 初始只有 loading 状态
        const overlay = document.createElement('div');
        overlay.className = 'article-preview-overlay';
        overlay.innerHTML = `
            <div class="article-preview-card">
                <div class="article-preview-scroll">
                    <div class="article-preview-loading">
                        <div class="article-preview-spinner"></div>
                        <span>${i18n.t('common.loading') || 'Loading...'}</span>
                    </div>
                </div>
                <div class="article-preview-footer">
                    <button class="article-preview-btn article-preview-btn-secondary preview-close-btn">${i18n.t('common.close') || 'Close'}</button>
                    <button class="article-preview-btn article-preview-btn-primary preview-goto-btn">${i18n.t('digest.read_full') || 'Read Full Article'} →</button>
                </div>
            </div>
        `;
        // 将文章字体设置传递到预览弹窗（因为弹窗挂在 body 上，不会继承 #article-content 的 CSS 变量）
        const articleContent = document.getElementById('article-content');
        if (articleContent) {
            const fontFamily = articleContent.style.getPropertyValue('--article-font-family');
            const headingFontFamily = articleContent.style.getPropertyValue('--article-heading-font-family');
            const fontSize = articleContent.style.getPropertyValue('--article-font-size');
            if (fontFamily) overlay.style.setProperty('--article-font-family', fontFamily);
            if (headingFontFamily) overlay.style.setProperty('--article-heading-font-family', headingFontFamily);
            if (fontSize) overlay.style.setProperty('--article-font-size', fontSize);
        }

        document.body.appendChild(overlay);

        // 动画展开 + 背景模糊
        document.body.classList.add('dialog-open');
        requestAnimationFrame(() => overlay.classList.add('active'));

        // 用于取消 AI 请求
        const previewAbortController = new AbortController();

        // 关闭逻辑
        const closePreview = () => {
            previewAbortController.abort();
            overlay.classList.remove('active');
            document.body.classList.remove('dialog-open');
            setTimeout(() => overlay.remove(), 300);
        };

        overlay.addEventListener('click', (e) => { if (e.target === overlay) closePreview(); });
        overlay.querySelector('.preview-close-btn').addEventListener('click', closePreview);
        overlay.querySelector('.preview-goto-btn').addEventListener('click', () => {
            closePreview();
            window.location.hash = `#/article/${articleId}`;
        });
        const escHandler = (e) => {
            if (e.key === 'Escape') { closePreview(); document.removeEventListener('keydown', escHandler); }
        };
        document.addEventListener('keydown', escHandler);

        // 加载文章内容
        try {
            const article = await FeedManager.getArticle(articleId);
            const scrollArea = overlay.querySelector('.article-preview-scroll');
            if (!scrollArea || !document.body.contains(overlay)) return;

            let date = '';
            if (article.published_at) {
                const d = new Date(article.published_at);
                const h = String(d.getHours()).padStart(2, '0');
                const min = String(d.getMinutes()).padStart(2, '0');
                if (i18n.locale === 'zh') {
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    date = `${y}年${m}月${day}日 ${h}:${min}`;
                } else {
                    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    date = `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h}:${min}`;
                }
            }
            const content = article.content || article.summary || '';
            const feedName = article.feed?.title || ref?.feedTitle || '';
            const titleText = article.title || previewTitle;

            // 构建与正常文章一致的 header HTML
            let feedSourceHTML = '';
            if (article.feed_id && feedName) {
                feedSourceHTML = `
                    <a href="#/feed/${article.feed_id}" class="article-feed-source" title="${feedName}">
                        <img src="/api/favicon?feedId=${article.feed_id}" class="favicon" loading="lazy" decoding="async" alt="${feedName}" style="width: 14px; height: 14px; border-radius: 3px; margin: 0; display: block;">
                        <span>${feedName}</span>
                    </a>
                `;
            } else if (feedName) {
                feedSourceHTML = `
                    <span class="article-feed-source" style="cursor: default;">
                        <span>${feedName}</span>
                    </span>
                `;
            }

            const previewTitleHTML = article.url
                ? `<h1><a href="${article.url}" target="_blank" rel="noopener noreferrer" class="article-title-link">${titleText}</a></h1>`
                : `<h1>${titleText}</h1>`;

            // 一次性替换整个滚动区域内容
            scrollArea.innerHTML = `
                <header class="article-header" style="margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color);">
                    ${feedSourceHTML}
                    ${previewTitleHTML}
                    <div class="article-header-info" style="
                        color: var(--meta-color); 
                        font-size: 12px; 
                        margin-top: 0; 
                        display: flex; 
                        align-items: center; 
                        justify-content: flex-start;
                        flex-wrap: wrap;
                        gap: 4px;
                    ">
                        ${date ? `<span>${date}</span>` : ''}
                    </div>
                </header>
                <div class="article-preview-content article-content">${content || `<div class="article-preview-error">${i18n.t('article.empty_content') || 'No content'}</div>`}</div>
            `;

            // === 自动摘要 ===
            if (AIService.isConfigured() && article.feed_id && AIService.shouldAutoSummarize(article.feed_id)) {
                this._previewAutoSummarize(overlay, article, previewAbortController.signal);
            }

            // === 自动翻译 ===
            if (AIService.isConfigured() && article.feed_id && AIService.shouldAutoTranslate(article.feed_id)) {
                this._previewAutoTranslate(overlay, article, previewAbortController.signal);
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('[ArticlePreview] Failed to load article:', err);
            const scrollArea = overlay.querySelector('.article-preview-scroll');
            if (scrollArea) {
                scrollArea.innerHTML = `<div class="article-preview-error">${i18n.t('feed.fetch_articles_failed') || 'Failed to load article'}</div>`;
            }
        }
    },

    /**
     * 预览弹窗内的自动摘要
     */
    async _previewAutoSummarize(overlay, article, signal) {
        const contentEl = overlay.querySelector('.article-preview-content');
        if (!contentEl) return;

        const rawContent = AIService.extractText(article.content || '');
        if (!rawContent || rawContent.trim().length < 50) return;

        // 先检查缓存
        try {
            const cached = await AICache.getSummary(article.id);
            if (cached) {
                this._insertPreviewSummary(contentEl, this.parseMarkdown(cached));
                return;
            }
        } catch { /* ignore */ }

        // 插入加载中的摘要容器
        const summaryEl = this._insertPreviewSummary(contentEl, `<span style="opacity:0.6;">${i18n.t('ai.summarizing')}</span>`);

        try {
            const targetLang = AIService.getTargetLang();
            let streamedText = '';

            await AIService.summarize(rawContent, targetLang, (chunk) => {
                streamedText += chunk;
                const contentEl = summaryEl.querySelector('.preview-summary-content');
                if (contentEl) contentEl.innerHTML = this.parseMarkdown(streamedText);
            }, signal);

            AICache.setSummary(article.id, streamedText).catch(() => { });
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('[PreviewSummary] Failed:', err);
            const contentEl = summaryEl.querySelector('.preview-summary-content');
            if (contentEl) {
                const statusCode = err.statusCode || err.status || '';
                const errorMsg = statusCode ? `${i18n.t('ai.api_error')} (${statusCode})` : i18n.t('ai.api_error');
                contentEl.innerHTML = `<span style="color: var(--danger-color); font-size: 0.9em;">${errorMsg}</span><button class="ai-retry-btn">${i18n.t('common.retry')}</button>`;
                contentEl.querySelector('.ai-retry-btn')?.addEventListener('click', () => {
                    this._previewAutoSummarize(overlay, article, signal);
                });
            }
        }
    },

    /**
     * 在预览弹窗正文顶部插入摘要区块
     */
    _insertPreviewSummary(bodyEl, initialHTML) {
        const summaryEl = document.createElement('div');
        summaryEl.className = 'preview-summary-box';
        summaryEl.style.cssText = 'margin-bottom: 16px; padding: 14px 16px; background: color-mix(in srgb, var(--accent-color), transparent 94%); border-radius: var(--radius); font-size: 0.92em; line-height: 1.7;';
        summaryEl.innerHTML = `
            <div style="font-weight: 600; font-size: 0.85em; color: var(--accent-color); margin-bottom: 8px; display: flex; align-items: center; gap: 4px;">✦ ${i18n.t('ai.summary_title')}</div>
            <div class="preview-summary-content">${initialHTML}</div>
        `;
        bodyEl.insertBefore(summaryEl, bodyEl.firstChild);
        return summaryEl;
    },

    /**
     * 预览弹窗内的自动翻译
     */
    async _previewAutoTranslate(overlay, article, signal) {
        const contentEl = overlay.querySelector('.article-preview-content');
        const titleEl = overlay.querySelector('.article-header .article-title-link') || overlay.querySelector('.article-header h1');
        if (!contentEl) return;

        // 先检查缓存
        const cacheRestored = await this._restoreTranslationFromCache(contentEl, titleEl, article.id);
        if (cacheRestored) return;

        try {
            await this.translateBilingual(contentEl, titleEl, signal, article.id);
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('[PreviewTranslate] Failed:', err);
        }
    },
};
