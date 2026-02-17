import sanitizeHtml from 'sanitize-html';

/**
 * 工具函数模块
 */

// --- 常量定义 ---
const MIN_IMAGE_DIMENSION = 100;

// 需要屏蔽的图片模式
const BLOCKED_PATTERNS = [
    'grey-placeholder.png',
    'placeholder',
    'spacer.gif',
    'blank.gif',
    'pixel.gif',
    'tracking',
    'analytics',
    '1x1',
    'beacon'
];

// 正则表达式提升至模块级以避免重复编译
const RE_HTML_ENTITIES = {
    lt: /&lt;/g,
    gt: /&gt;/g,
    quot: /&quot;/g,
    apos: /&#39;/g,
    amp: /&amp;/g
};

const IMG_TAG_REGEX = /<img\s+([^>]+)>/gi;
const SRC_REGEX = /src\s*=\s*["']([^"']+)["']/i;
const DATA_SRC_REGEX = /data-src\s*=\s*["']([^"']+)["']/i;
const WIDTH_REGEX = /width\s*=\s*["']?(\d+)["']?/i;
const HEIGHT_REGEX = /height\s*=\s*["']?(\d+)["']?/i;
const FIGURE_PICTURE_REGEX = /<(?:figure|picture)[^>]*>.*?<img[^>]+src\s*=\s*["']([^"']+)["']/is;
const SRCSET_REGEX = /srcset\s*=\s*["']([^\s"']+)/i;
const RAW_URL_REGEX = /(https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp))/gi;

/**
 * 解码 HTML 实体
 */
function decodeHtml(html) {
    if (!html) return '';
    return html
        .replace(RE_HTML_ENTITIES.lt, '<')
        .replace(RE_HTML_ENTITIES.gt, '>')
        .replace(RE_HTML_ENTITIES.quot, '"')
        .replace(RE_HTML_ENTITIES.apos, "'")
        .replace(RE_HTML_ENTITIES.amp, '&');
}

/**
 * 检查图片是否被屏蔽
 */
function isBlocked(url) {
    if (!url) return true;
    const lowerUrl = url.toLowerCase();
    return BLOCKED_PATTERNS.some(pattern => lowerUrl.includes(pattern));
}

/**
 * 检查图片尺寸是否过小
 */
function isTooSmall(attrs) {
    const widthMatch = attrs.match(WIDTH_REGEX);
    const heightMatch = attrs.match(HEIGHT_REGEX);

    if (widthMatch && parseInt(widthMatch[1]) < MIN_IMAGE_DIMENSION) return true;
    if (heightMatch && parseInt(heightMatch[1]) < MIN_IMAGE_DIMENSION) return true;

    return false;
}

/**
 * 从 HTML 内容中提取第一张有效图片的 URL
 * @param {string} htmlContent - HTML 内容
 * @returns {string|null} - 图片 URL 或 null
 */
export function extractFirstImage(htmlContent) {
    if (!htmlContent) return null;

    const decoded = decodeHtml(htmlContent);
    let match;

    // 1. 尝试匹配完整的 img 标签
    IMG_TAG_REGEX.lastIndex = 0; // 重置全局正则状态
    while ((match = IMG_TAG_REGEX.exec(decoded)) !== null) {
        const attrs = match[1];

        // 提取 src
        let urlMatch = attrs.match(SRC_REGEX);
        let url = urlMatch ? urlMatch[1] : null;

        // 如果没有 src，尝试 data-src
        if (!url) {
            urlMatch = attrs.match(DATA_SRC_REGEX);
            url = urlMatch ? urlMatch[1] : null;
        }

        if (url && !url.startsWith('data:') && !isBlocked(url) && !isTooSmall(attrs)) {
            return url;
        }
    }

    // 2. 尝试匹配 figure/picture 中的图片
    match = decoded.match(FIGURE_PICTURE_REGEX);
    if (match && match[1] && !match[1].startsWith('data:') && !isBlocked(match[1])) {
        return match[1];
    }

    // 3. 尝试匹配 srcset 中的第一个 URL
    match = decoded.match(SRCSET_REGEX);
    if (match && match[1] && !isBlocked(match[1])) {
        return match[1];
    }

    // 4. 尝试匹配独立的图片 URL
    RAW_URL_REGEX.lastIndex = 0;
    while ((match = RAW_URL_REGEX.exec(decoded)) !== null) {
        const url = match[1];
        if (url && !isBlocked(url)) {
            return url;
        }
    }

    return null;
}

/**
 * 将原始图片 URL 转换为压缩后的缩略图 URL
 * @param {string} originalUrl - 原始图片 URL
 * @returns {string|null} - 缩略图 URL 或 null
 */
export function getThumbnailUrl(originalUrl) {
    if (!originalUrl || originalUrl.startsWith('data:')) return null;
    // 过滤 SVG 图片（渲染性能差，且通常是图标/Logo 而非内容图片）
    const lowerUrl = originalUrl.toLowerCase();
    if (lowerUrl.endsWith('.svg') || lowerUrl.includes('.svg?')) return null;
    return originalUrl;
}

/**
 * 从 RSS 文章内容中提取并生成缩略图 URL
 */
export function extractThumbnailUrl(content, summary) {
    const imageUrl = extractFirstImage(content || summary || '');
    return getThumbnailUrl(imageUrl);
}

export { sanitizeHtml };
