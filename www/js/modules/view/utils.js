import { i18n } from '../i18n.js';

/**
 * UI 常量配置
 */
const UI_CONFIG = {
    TOAST_DURATION_MS: 3000,
    TOAST_Z_INDEX: 1000,
    CONTEXT_MENU_WIDTH: 180,
    CONTEXT_MENU_MARGIN: 10,
    DIALOG_TRANSITION_MS: 200,
    SCROLL_BUFFER: 10
};


/**
 * 转义 HTML 特殊字符，防止 XSS
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
export function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

const MS_PER_MINUTE = 60000;
const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

/**
 * 格式化日期为友好的相对时间或日期字符串
 * @param {string} dateString - ISO 日期字符串
 * @returns {string} 格式化后的日期
 */
export function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / MS_PER_MINUTE);
    const diffHours = Math.floor(diffMs / MS_PER_HOUR);
    const diffDays = Math.floor(diffMs / MS_PER_DAY);

    if (diffMins < 60) return i18n.t('article.minutes_ago', { count: diffMins });
    if (diffHours < 24) return i18n.t('article.hours_ago', { count: diffHours });
    if (diffDays < 7) return i18n.t('article.days_ago', { count: diffDays });

    const locale = i18n.locale === 'zh' ? 'zh-CN' : 'en-US';
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/**
 * 检测是否为 iOS Safari 浏览器
 * @returns {boolean}
 */
export function isIOSSafari() {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isWebkit = /WebKit/.test(ua);
    const isChrome = /CriOS/.test(ua);
    return isIOS && isWebkit && !isChrome;
}


// Pre-compiled regex for better performance
const MOBILE_DEVICE_REGEX = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

/**
 * 检测是否为移动设备
 * @returns {boolean}
 */
export function isMobileDevice() {
    return (
        MOBILE_DEVICE_REGEX.test(navigator.userAgent) ||
        (window.innerWidth <= 1024)
    );
}

const isInvalidImageUrl = (url) => {
    if (!url) return true;
    const lowerUrl = url.toLowerCase();
    // 排除 SVG (性能黑洞) 和 占位符
    return lowerUrl.endsWith('.svg') || lowerUrl.includes('.svg?') || lowerUrl.includes('grey-placeholder.png');
};

// Pre-compiled regex patterns for better performance
const IMG_WIDTH_REGEX = /width\s*=\s*["']?(\d+)["']?/i;
const IMG_HEIGHT_REGEX = /height\s*=\s*["']?(\d+)["']?/i;

// 检查图片尺寸是否太小
const isImgTooSmall = (imgTag) => {
    const widthMatch = imgTag.match(IMG_WIDTH_REGEX);
    const heightMatch = imgTag.match(IMG_HEIGHT_REGEX);
    return !!((widthMatch && parseInt(widthMatch[1]) < 100) ||
        (heightMatch && parseInt(heightMatch[1]) < 100));
};

/**
 * 从 HTML 内容中提取第一张图片 URL
 * @param {string} content - HTML 内容
 * @returns {string|null} 图片 URL 或 null
 */
export function extractFirstImage(content) {
    if (!content) return null;

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');

        // Helper to check validity
        const isValid = (src) => {
            return src &&
                !src.startsWith('data:') &&
                !isInvalidImageUrl(src);
            // Note: DOMParser parses attributes, so we don't need manual width/height regex checks as strictly,
            // but we can check attributes if needed. For now, we trust the basic URL check.
        };

        // 1. Selector strategy for <img>
        const images = doc.querySelectorAll('img');
        for (const img of images) {
            const src = img.getAttribute('src') || img.getAttribute('data-src');
            if (isValid(src)) {
                // Basic size check if attributes exist (optional optimization)
                const w = img.getAttribute('width');
                const h = img.getAttribute('height');
                if (w && parseInt(w) < 100) continue;
                if (h && parseInt(h) < 100) continue;
                return src;
            }
        }

        // 2. Fallback to <source> in <picture> if needed (usually <img> covers it)
        const sources = doc.querySelectorAll('picture source');
        for (const source of sources) {
            const srcset = source.getAttribute('srcset');
            if (srcset) {
                const firstSrc = srcset.split(',')[0].trim().split(' ')[0];
                if (isValid(firstSrc)) return firstSrc;
            }
        }

    } catch (e) {
        console.warn('DOMParser failed, falling back to regex', e);
    }

    // Fallback or if DOMParser fails (rare)
    // Minimal regex fallback for extreme cases or non-browser envs (though this is frontend code)
    const match = content.match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? match[1] : null;
}

/**
 * 生成缩略图 URL
 * @param {string|null} originalUrl - 原始图片 URL
 * @returns {string|null} 缩略图 URL
 */
export function getThumbnailUrl(originalUrl) {
    if (!originalUrl) return null;
    // 直接返回原始 URL，由前端负责加载（减轻服务器压力）
    return originalUrl;
}

/**
 * 显示 Toast 提示
 * @param {string} message - 提示消息
 * @param {number} duration - 显示时长(毫秒)
 * @param {boolean} showLoadingIcon - 是否显示加载图标
 */
let toastTimeout = null;
export function showToast(message, duration = UI_CONFIG.TOAST_DURATION_MS, showLoadingIcon = true, onClick = null, relativeTo = null) {
    const articlesPanel = document.getElementById('articles-panel');
    let toast = document.getElementById('app-toast');

    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        toast.className = 'app-toast';
        document.body.appendChild(toast);
    }

    let leftPos = '50%';
    if (relativeTo && relativeTo.getBoundingClientRect) {
        const rect = relativeTo.getBoundingClientRect();
        leftPos = `${rect.left + rect.width / 2}px`;
    } else if (articlesPanel) {
        const rect = articlesPanel.getBoundingClientRect();
        leftPos = `${rect.left + rect.width / 2}px`;
    }

    // 仅设置动态属性，其余由 CSS 类 .app-toast 控制
    toast.style.left = leftPos;
    toast.style.pointerEvents = onClick ? 'auto' : 'none';
    toast.style.cursor = onClick ? 'pointer' : 'default';
    toast.style.opacity = '0';

    const iconHtml = showLoadingIcon ? `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite; flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>
        <style>@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
    ` : '';

    toast.innerHTML = `
        ${iconHtml}
        ${message}
    `;

    // 强制 reflow
    toast.offsetWidth;
    toast.style.opacity = '1';

    if (onClick) {
        toast.onclick = () => {
            onClick();
            toast.style.opacity = '0';
            toast.style.pointerEvents = 'none';
            if (toastTimeout) clearTimeout(toastTimeout);
        };
    } else {
        toast.onclick = null;
    }

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.pointerEvents = 'none';
    }, duration);
}

// 模块级变量：跟踪当前活动的菜单关闭处理器
let activeContextMenuCloseHandler = null;

/**
 * 创建上下文菜单基础结构
 * @param {MouseEvent} event - 鼠标事件
 * @param {string} innerHTML - 菜单 HTML 内容
 * @returns {{menu: HTMLElement, cleanup: Function}} 菜单元素和清理函数
 */
export function createContextMenu(event, innerHTML) {
    // 移除已有的动态上下文菜单（只清理 body 直接子元素，不影响嵌套在工具栏等处的静态菜单）
    document.querySelectorAll('body > .context-menu').forEach(m => m.remove());
    if (activeContextMenuCloseHandler) {
        document.removeEventListener('click', activeContextMenuCloseHandler, true);
        activeContextMenuCloseHandler = null;
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = innerHTML;
    document.body.appendChild(menu);

    // 定位菜单
    const menuWidth = UI_CONFIG.CONTEXT_MENU_WIDTH;
    const menuHeight = menu.offsetHeight;
    let x = event.clientX;
    let y = event.clientY;

    if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - UI_CONFIG.CONTEXT_MENU_MARGIN;
    }
    if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - UI_CONFIG.CONTEXT_MENU_MARGIN;
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    // 点击外部关闭（使用 capture 阶段，阻止事件冒泡到底层元素）
    const closeHandler = (e) => {
        if (!menu.contains(e.target)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            menu.remove();
            document.removeEventListener('click', closeHandler, true);
            activeContextMenuCloseHandler = null;
        }
    };
    activeContextMenuCloseHandler = closeHandler;
    setTimeout(() => document.addEventListener('click', closeHandler, true), 0);

    return {
        menu,
        cleanup: () => {
            menu.remove();
            document.removeEventListener('click', closeHandler, true);
            activeContextMenuCloseHandler = null;
        }
    };
}

/**
 * 创建对话框基础结构
 * @param {string} className - 对话框类名
 * @param {string} innerHTML - 对话框内容 HTML
 * @returns {{dialog: HTMLElement, close: Function}} 对话框元素和关闭函数
 */
export function createDialog(className, innerHTML, options = {}) {
    // Clean up stale dialog elements (non-active ones left by previous close timeouts)
    document.querySelectorAll(`.${className}:not(.active)`).forEach(el => el.remove());

    const dialog = document.createElement('div');
    dialog.className = `${className} active`;
    dialog.innerHTML = innerHTML;
    document.body.appendChild(dialog);
    document.body.classList.add('dialog-open');

    let closed = false;

    // ESC 关闭
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            close();
        }
    };

    const close = () => {
        if (closed) return;
        closed = true;
        dialog.classList.remove('active');
        document.removeEventListener('keydown', escHandler);
        setTimeout(() => {
            dialog.remove();
            // Only remove dialog-open if no other active dialogs remain
            if (!document.querySelector('.settings-dialog.active, .add-feed-dialog.active, .custom-modal-dialog.active')) {
                document.body.classList.remove('dialog-open');
            }
        }, UI_CONFIG.DIALOG_TRANSITION_MS);
    };

    if (!options.preventClose) {
        document.addEventListener('keydown', escHandler);

        // 点击背景关闭（需要 mousedown 和 click 都在背景上才关闭，
        // 防止在面板内选择文字拖动到面板外时误关闭）
        let mouseDownOnBackdrop = false;
        dialog.addEventListener('mousedown', (e) => {
            mouseDownOnBackdrop = (e.target === dialog);
        });
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog && mouseDownOnBackdrop) close();
            mouseDownOnBackdrop = false;
        });

        // 触摸设备同样处理
        let touchStartOnBackdrop = false;
        dialog.addEventListener('touchstart', (e) => {
            touchStartOnBackdrop = (e.target === dialog);
        }, { passive: true });
        dialog.addEventListener('touchend', (e) => {
            if (e.target === dialog && touchStartOnBackdrop) close();
            touchStartOnBackdrop = false;
        });

        // 关闭按钮
        const closeBtn = dialog.querySelector('.close-dialog-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', close);
        }
    }

    return { dialog, close };
}

/**
 * 简单的 Markdown 渲染器
 * @param {string} markdown - Markdown 文本
 * @returns {string} HTML 字符串
 */
export function renderMarkdown(markdown) {
    if (!markdown) return '';

    let html = markdown
        // 转义 HTML 特殊字符
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // 标题
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        // 粗体
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // 斜体
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // 无序列表
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^• (.+)$/gm, '<li>$1</li>')
        // 有序列表
        .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
        // 代码块
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // 换行
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');

    // 包装列表项
    html = html.replace(/(<li>.*?<\/li>)+/gs, '<ul>$&</ul>');

    // 清理多余的 ul 标签
    html = html.replace(/<\/ul>\s*<ul>/g, '');

    return `<p>${html}</p>`;
}

/**
 * 自定义工具提示（替代原生 title）
 * 使用 data-tooltip 属性，悬停时在元素下方显示 toast 风格的提示
 */
let tooltipEl = null;
let tooltipShowTimer = null;
const TOOLTIP_DELAY = 500; // ms

function getTooltipEl() {
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'custom-tooltip';
        document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
}

function showTooltip(target) {
    const text = target.getAttribute('data-tooltip');
    if (!text) return;

    const el = getTooltipEl();
    el.textContent = text;

    // Position below the element, horizontally centered
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    let topY = rect.bottom + 6;

    el.style.left = `${centerX}px`;
    el.style.top = `${topY}px`;

    // Force reflow then show
    el.offsetWidth;
    el.classList.add('visible');

    // Check if tooltip overflows viewport right/left
    requestAnimationFrame(() => {
        const tooltipRect = el.getBoundingClientRect();
        if (tooltipRect.right > window.innerWidth - 8) {
            el.style.left = `${window.innerWidth - tooltipRect.width / 2 - 8}px`;
        }
        if (tooltipRect.left < 8) {
            el.style.left = `${tooltipRect.width / 2 + 8}px`;
        }
    });
}

function hideTooltip() {
    if (tooltipShowTimer) {
        clearTimeout(tooltipShowTimer);
        tooltipShowTimer = null;
    }
    if (tooltipEl) {
        tooltipEl.classList.remove('visible');
    }
}

/**
 * 初始化自定义工具提示（事件委托）
 * 在 document.body 上监听 mouseover/mouseout，自动处理所有 [data-tooltip] 元素
 */
export function initTooltips() {
    let currentTarget = null;

    document.body.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (!target || target === currentTarget) return;

        // 清除之前的
        hideTooltip();
        currentTarget = target;

        tooltipShowTimer = setTimeout(() => {
            if (currentTarget === target) {
                showTooltip(target);
            }
        }, TOOLTIP_DELAY);
    });

    document.body.addEventListener('mouseout', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (!target) return;

        // 检查是否移动到同一个 tooltip 元素的子元素
        const related = e.relatedTarget;
        if (related && target.contains(related)) return;

        currentTarget = null;
        hideTooltip();
    });

    // 点击时隐藏
    document.body.addEventListener('mousedown', () => {
        hideTooltip();
        currentTarget = null;
    });
}
