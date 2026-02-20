/**
 * ArticleEnhanceMixin - 内容增强模块（表格、代码块、嵌入媒体）
 * @module view/article-enhance
 *
 * 通过 Mixin 模式合并到 ArticleContentView
 * - enhanceEmbeds: 增强嵌入式媒体的宽高比
 * - enhanceTables: 增强表格显示（代码块检测 + 空单元格清理 + 滚动包裹）
 * - enhanceCodeBlocks: 增强代码块显示（语言标签 + 复制按钮）
 */

import { DOMElements } from '../../dom.js';
import { i18n } from '../i18n.js';
import { Icons } from '../icons.js';

export const ArticleEnhanceMixin = {
    /**
     * 增强嵌入式媒体（iframe/video/embed）的宽高比
     */
    enhanceEmbeds() {
        const articleBody = DOMElements.articleContent?.querySelector('.article-body, .digest-body, .article-content');
        if (!articleBody) return;

        const embeds = articleBody.querySelectorAll('iframe, video, embed, object');
        embeds.forEach((el) => {
            // 已处理过则跳过
            if (el.dataset.embedEnhanced) return;
            el.dataset.embedEnhanced = '1';

            const w = parseFloat(el.getAttribute('width'));
            const h = parseFloat(el.getAttribute('height'));
            if (w && h && w > 0 && h > 0) {
                // 根据原始宽高属性设置 aspect-ratio
                el.style.aspectRatio = `${w} / ${h}`;
            } else if (el.tagName === 'IFRAME') {
                // iframe 没有 width/height 属性时，默认 16:9
                el.style.aspectRatio = '16 / 9';
            }
            // 移除固定宽高属性，让 CSS 控制尺寸
            el.removeAttribute('width');
            el.removeAttribute('height');
        });
    },

    /**
     * 检测表格是否是带行号的代码块（如 GitHub/Hugo 等博客常用的格式）
     * 结构：table > tbody > tr > [td(行号), td(pre>code)]
     * @param {HTMLTableElement} table
     * @returns {string|null} 代码内容，如果不是代码块返回 null
     */
    _detectTableBasedCode(table) {
        const tbody = table.querySelector(':scope > tbody');
        if (!tbody) return null;

        const tr = tbody.querySelector(':scope > tr');
        if (!tr) return null;

        const tdElements = Array.from(tr.querySelectorAll(':scope > td'));
        if (tdElements.length !== 2) return null;

        const codeTd = tdElements[1];
        const codePre = codeTd.querySelector(':scope > pre');
        if (!codePre) return null;

        // 提取代码内容
        const codeEl = codePre.querySelector(':scope > code');
        const source = codeEl || codePre;

        const getTextContent = (node) => {
            if (!node) return '';
            if (node.nodeType === Node.TEXT_NODE) return node.data;
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'BR') return '\n';
                return Array.from(node.childNodes).map(getTextContent).join('');
            }
            return '';
        };

        return getTextContent(source).replace(/\n{3,}/g, '\n\n').trim();
    },

    /**
     * 移除表格中的空 td 元素（RSS 源中常见的布局残留）
     * @param {HTMLTableElement} table
     */
    _removeEmptyTableCells(table) {
        const rows = table.querySelectorAll('tr');
        rows.forEach((tr) => {
            const tds = Array.from(tr.querySelectorAll(':scope > td'));
            tds.forEach((td) => {
                // 如果 td 没有子元素，或者子元素全是空白文本，则移除
                const hasContent = Array.from(td.childNodes).some(
                    (child) => (child.nodeType === Node.TEXT_NODE && child.data.trim()) ||
                        (child.nodeType === Node.ELEMENT_NODE && child.childNodes.length > 0)
                );
                if (!hasContent) {
                    td.remove();
                }
            });
        });
    },

    /**
     * 增强表格显示
     * 1. 检测表格式代码块并转换
     * 2. 移除空的 td 元素
     * 3. 将宽表格包裹在可横向滚动的容器中
     */
    enhanceTables() {
        const articleBody = DOMElements.articleContent?.querySelector('.article-body, .digest-body');
        if (!articleBody) return;

        const tables = articleBody.querySelectorAll('table');
        tables.forEach((table) => {
            // 避免重复处理
            if (table.parentElement?.classList.contains('table-scroll-wrapper')) return;
            if (table.parentElement?.classList.contains('code-block-wrapper')) return;

            // 1. 检测表格式代码块（如 figure > table 结构的带行号代码）
            const codeContent = this._detectTableBasedCode(table);
            if (codeContent) {
                // 将表格替换为代码块
                const wrapper = document.createElement('div');
                wrapper.className = 'code-block-wrapper';

                const header = document.createElement('div');
                header.className = 'code-block-header';
                header.innerHTML = `
                    <span class="code-language">TEXT</span>
                    <button class="code-copy-btn" data-tooltip="${i18n.t('ai.copy')}">
                        ${Icons.copy}
                        <span class="copy-text">${i18n.t('ai.copy')}</span>
                    </button>
                `;

                const pre = document.createElement('pre');
                const code = document.createElement('code');
                code.textContent = codeContent;
                pre.appendChild(code);

                // 复制功能
                const copyBtn = header.querySelector('.code-copy-btn');
                copyBtn.addEventListener('click', async () => {
                    const showSuccess = () => {
                        copyBtn.innerHTML = `${Icons.copied}<span class="copy-text">${i18n.t('ai.copied')}</span>`;
                        copyBtn.classList.add('copied');
                        setTimeout(() => {
                            copyBtn.innerHTML = `${Icons.copy}<span class="copy-text">${i18n.t('ai.copy')}</span>`;
                            copyBtn.classList.remove('copied');
                        }, 2000);
                    };
                    if (navigator.clipboard?.writeText) {
                        try { await navigator.clipboard.writeText(codeContent); showSuccess(); return; } catch { }
                    }
                    try {
                        const ta = document.createElement('textarea');
                        ta.value = codeContent;
                        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
                        document.body.appendChild(ta);
                        ta.focus(); ta.select(); ta.setSelectionRange(0, codeContent.length);
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        showSuccess();
                    } catch (err) { console.error('Copy failed:', err); }
                });

                wrapper.appendChild(header);
                wrapper.appendChild(pre);

                // 如果表格在 figure 内，替换整个 figure
                const parentFigure = table.closest('figure');
                if (parentFigure) {
                    parentFigure.parentNode.insertBefore(wrapper, parentFigure);
                    parentFigure.remove();
                } else {
                    table.parentNode.insertBefore(wrapper, table);
                    table.remove();
                }
                return;
            }

            // 2. 移除空的 td 元素
            this._removeEmptyTableCells(table);

            // 3. 包裹在滚动容器中
            const scrollWrapper = document.createElement('div');
            scrollWrapper.className = 'table-scroll-wrapper';
            table.parentNode.insertBefore(scrollWrapper, table);
            scrollWrapper.appendChild(table);
        });
    },

    /**
     * 增强代码块显示
     * 为 pre 和 code 块添加语言标签和复制按钮
     */
    enhanceCodeBlocks() {
        const articleBody = DOMElements.articleContent?.querySelector('.article-body');
        if (!articleBody) return;

        const preElements = articleBody.querySelectorAll('pre');

        preElements.forEach((pre) => {
            // 避免重复处理
            if (pre.parentElement?.classList.contains('code-block-wrapper')) return;
            // 跳过表格内的 pre（表格式代码块已由 enhanceTables 处理）
            if (pre.closest('table')) return;

            // 获取语言类型
            let language = 'text';
            const codeEl = pre.querySelector('code');
            if (codeEl) {
                const className = codeEl.className || '';
                const match = className.match(/(?:language-|lang-)(\w+)/);
                if (match) {
                    language = match[1];
                }
            }

            // 获取代码内容（清理多余换行）
            const getTextContent = (node) => {
                if (!node) return '';
                if (node.nodeType === Node.TEXT_NODE) return node.data;
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.tagName === 'BR') return '\n';
                    return Array.from(node.childNodes).map(getTextContent).join('');
                }
                return '';
            };

            const codeText = getTextContent(codeEl || pre)
                .replace(/\n{3,}/g, '\n\n')
                .trim();

            // 创建包装器
            const wrapper = document.createElement('div');
            wrapper.className = 'code-block-wrapper';

            // 创建头部
            const header = document.createElement('div');
            header.className = 'code-block-header';
            header.innerHTML = `
                <span class="code-language">${language.toUpperCase()}</span>
                <button class="code-copy-btn" data-tooltip="${i18n.t('ai.copy')}">
                    ${Icons.copy}
                    <span class="copy-text">${i18n.t('ai.copy')}</span>
                </button>
            `;

            // 复制功能 (兼容 iOS Safari)
            const copyBtn = header.querySelector('.code-copy-btn');
            copyBtn.addEventListener('click', async () => {
                const showSuccess = () => {
                    copyBtn.innerHTML = `${Icons.copied}<span class="copy-text">${i18n.t('ai.copied')}</span>`;
                    copyBtn.classList.add('copied');
                    setTimeout(() => {
                        copyBtn.innerHTML = `${Icons.copy}<span class="copy-text">${i18n.t('ai.copy')}</span>`;
                        copyBtn.classList.remove('copied');
                    }, 2000);
                };

                // 优先使用现代 Clipboard API
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    try {
                        await navigator.clipboard.writeText(codeText);
                        showSuccess();
                        return;
                    } catch (err) {
                        // Fallback to execCommand
                    }
                }

                // Fallback: 使用 textarea + execCommand (兼容 iOS Safari)
                try {
                    const textarea = document.createElement('textarea');
                    textarea.value = codeText;
                    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
                    document.body.appendChild(textarea);
                    textarea.focus();
                    textarea.select();
                    textarea.setSelectionRange(0, codeText.length); // iOS 需要这行
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    showSuccess();
                } catch (err) {
                    console.error('Copy failed:', err);
                }
            });

            // 包装 pre 元素
            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(header);
            wrapper.appendChild(pre);
        });
    },
};
