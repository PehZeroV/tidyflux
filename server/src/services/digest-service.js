import fetch from 'node-fetch';
import { DigestStore } from '../utils/digest-store.js';

// 截取文本辅助函数
// 按 Token 估算截取文本 (1 CJK char ≈ 1 token, 4 non-CJK chars ≈ 1 token)
function truncateByToken(text, maxTokens) {
    if (!text) return '';

    let accTokens = 0;
    let cutIndex = 0;
    const len = text.length;

    for (let i = 0; i < len; i++) {
        const code = text.charCodeAt(i);
        // CJK 字符范围估算 (更精确的 Token 消耗估算)
        // 中文通常 1 字 ≈ 1.5-2 Token，英文 1 词 ≈ 1.3 Token (约 4 字符)
        if (code >= 0x4E00 && code <= 0x9FFF) {
            accTokens += 1.6; // 约 625 中文字符
        } else {
            accTokens += 0.3; // 约 3300 英文字符 (约 700 单词)
        }

        if (accTokens >= maxTokens) {
            cutIndex = i;
            return text.substring(0, cutIndex) + '...';
        }
    }

    return text;
}

// 辅助函数：获取最近未读文章
export async function getRecentUnreadArticles(miniflux, options) {
    const { hours = 12, limit, feedId, groupId, categoryIds, includeRead = false } = options;

    const afterDate = new Date();
    afterDate.setHours(afterDate.getHours() - hours);
    const afterTimestamp = Math.floor(afterDate.getTime() / 1000);

    const entriesOptions = {
        status: includeRead ? undefined : 'unread',  // 如果includeRead为true，不限制状态
        order: 'published_at',
        direction: 'desc',
        limit: limit || 500,
        after: afterTimestamp
    };

    console.log(`[Digest Debug] Fetching articles with options: limit=${entriesOptions.limit}, after=${entriesOptions.after} (${hours} hours ago), includeRead=${includeRead}`);

    // 如果指定了多个分类ID，需要分别获取并合并
    if (categoryIds && categoryIds.length > 0) {
        console.log(`[Digest Debug] Fetching from multiple categories: ${categoryIds.join(', ')}`);
        const allArticles = [];
        
        for (const catId of categoryIds) {
            try {
                const catOptions = { ...entriesOptions, category_id: parseInt(catId) };
                const response = await miniflux.getEntries(catOptions);
                if (response.entries && response.entries.length > 0) {
                    console.log(`[Digest Debug] Category ${catId}: found ${response.entries.length} articles`);
                    allArticles.push(...response.entries);
                }
            } catch (error) {
                console.error(`Error fetching entries for category ${catId}:`, error);
            }
        }
        
        // 去重（根据文章ID）并按发布时间排序
        const uniqueArticles = Array.from(
            new Map(allArticles.map(a => [a.id, a])).values()
        ).sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
        
        console.log(`[Digest Debug] Total unique articles from all categories: ${uniqueArticles.length}`);
        return uniqueArticles.slice(0, entriesOptions.limit);
    }

    if (feedId) entriesOptions.feed_id = parseInt(feedId);
    if (groupId) entriesOptions.category_id = parseInt(groupId);

    try {
        const response = await miniflux.getEntries(entriesOptions);
        return response.entries || [];
    } catch (error) {
        console.error('Fetch entries error:', error);
        throw error;
    }
}

// 辅助函数：准备文章数据 (异步分批处理，避免阻塞事件循环)
async function prepareArticlesForDigest(articles) {
    const BATCH_SIZE = 20; // 每一批处理 20 篇文章
    const results = [];
    const maxTokens = 1000;

    // 安全截断长度：在执行昂贵的正则去标签前，先截断过长的文本
    const SAFE_CONTENT_LENGTH = 50000;

    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
        const batch = articles.slice(i, i + BATCH_SIZE);

        // 处理当前批次
        const processedBatch = batch.map((article, batchIndex) => {
            let content = article.content || '';

            // 1. 预先截断：防止超大字符串导致后续正则卡死
            if (content.length > SAFE_CONTENT_LENGTH) {
                content = content.substring(0, SAFE_CONTENT_LENGTH);
            }

            // 2. 去除 HTML 标签 (简单的去标签正则)
            // 替换所有标签为空格，替换连续空白为单个空格
            content = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

            return {
                index: i + batchIndex + 1,
                title: article.title,
                feedTitle: article.feed ? article.feed.title : '',
                category: article.feed && article.feed.category ? article.feed.category.title : '',
                publishedAt: article.published_at,
                summary: truncateByToken(content, maxTokens),
                url: article.url
            };
        });

        results.push(...processedBatch);

        // 每处理完一批，让出事件循环 (yield to Event Loop)
        // 使用 setImmediate 如果环境支持，否则用 setTimeout 0
        if (i + BATCH_SIZE < articles.length) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    return results;
}

// 构建简报生成的 prompt
function buildDigestPrompt(articles, options = {}) {
    let { targetLang = 'Simplified Chinese', scope = 'subscription', customPrompt } = options;

    // 确保自定义 Prompt 包含 {{content}} 或 {content} 占位符
    if (customPrompt && customPrompt.trim() && !customPrompt.includes('{{content}}') && !customPrompt.includes('{content}')) {
        customPrompt = customPrompt.trim() + '\n\n{{content}}';
    }

    const articlesList = articles.map(a =>
        `### ${a.index}. ${a.title}\n` +
        `- Source: ${a.feedTitle}\n` +
        (a.category ? `- Category: ${a.category}\n` : '') +
        `- Date: ${a.publishedAt}\n` +
        `- Link: ${a.url}\n` +
        `- Summary: ${a.summary}\n`
    ).join('\n');


    let finalPrompt = '';

    if (customPrompt && customPrompt.trim()) {
        // 使用自定义提示词，支持 {{variable}} 和 {variable} 两种格式
        finalPrompt = customPrompt
            .replace(/\{\{targetLang\}\}/g, targetLang)
            .replace(/\{targetLang\}/g, targetLang)
            .replace(/\{\{content\}\}/g, `## Article List (Total ${articles.length} articles):\n\n${articlesList}`)
            .replace(/\{content\}/g, `## Article List (Total ${articles.length} articles):\n\n${articlesList}`);
    } else {
        // 默认提示词
        finalPrompt = `You are a professional news editor. Please generate a concise digest based on the following list of recent ${scope} articles.

## Output Requirements:
1. Output in ${targetLang}
2. Start with a 2-3 sentence overview of today's/recent key content
3. Categorize by topic or importance, listing key information in concise bullet points
4. If multiple articles relate to the same topic, combine them
5. Keep the format concise and compact, using Markdown
6. Output the content directly, no opening remarks like "Here is the digest"

## Article List (Total ${articles.length} articles):

${articlesList}`;
    }

    return finalPrompt;
}

// 调用 AI API 生成简报
async function callAIForDigest(prompt, aiConfig) {
    if (!aiConfig || !aiConfig.apiUrl || !aiConfig.apiKey) {
        throw new Error('AI 未配置，请先在设置中配置 AI API');
    }

    const normalizeApiUrl = (url) => {
        let normalized = url.trim();
        if (!normalized.endsWith('/')) normalized += '/';
        if (!normalized.endsWith('chat/completions')) {
            normalized += 'chat/completions';
        }
        return normalized;
    };

    const apiUrl = normalizeApiUrl(aiConfig.apiUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, 600000); // 10 minutes timeout

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aiConfig.apiKey}`
            },
            body: JSON.stringify({
                model: aiConfig.model || 'gpt-4.1-mini',
                temperature: aiConfig.temperature ?? 1,
                messages: [
                    { role: 'user', content: prompt }
                ],
                stream: false
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || `AI API 错误: ${response.status}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
    } finally {
        clearTimeout(timeout);
    }
}

export const DigestService = {
    async generate(minifluxClient, userId, options) {
        const {
            scope = 'all',
            feedId,
            groupId,
            categoryIds,
            hours = 12,
            timeRange,
            targetLang = 'Simplified Chinese',
            prompt: customPrompt,
            aiConfig,
            includeRead = false,
            customTitle
        } = options;

        // 使用 timeRange 参数（如果提供）覆盖 hours
        const effectiveHours = timeRange || hours;

        const isEn = targetLang && (targetLang.toLowerCase().includes('english') || targetLang.toLowerCase().includes('en'));

        // 获取 Scope 名称（需要 Miniflux Client）
        let scopeName = isEn ? 'All Subscriptions' : '全部订阅';
        let scopeId = null;

        if (scope === 'feed' && feedId) {
            scopeId = parseInt(feedId);
            const feeds = await minifluxClient.getFeeds();
            const feed = feeds.find(f => f.id === parseInt(feedId));
            scopeName = feed ? feed.title : (isEn ? 'Feed' : '订阅源');
        } else if (scope === 'group' && groupId) {
            scopeId = parseInt(groupId);
            const categories = await minifluxClient.getCategories();
            const category = categories.find(c => c.id === parseInt(groupId));
            scopeName = category ? category.title : (isEn ? 'Group' : '分组');
        } else if (categoryIds && categoryIds.length > 0) {
            // 多个分类的情况
            const categories = await minifluxClient.getCategories();
            const categoryNames = categoryIds.map(id => {
                const cat = categories.find(c => c.id === parseInt(id));
                return cat ? cat.title : `Category ${id}`;
            });
            scopeName = categoryNames.join(', ');
        }

        const fetchOptions = { hours: effectiveHours, feedId, groupId, categoryIds, includeRead };
        const articles = await getRecentUnreadArticles(minifluxClient, fetchOptions);

        if (articles.length === 0) {
            const noArticlesMsg = isEn
                ? `No ${includeRead ? '' : 'unread '}articles in the past ${effectiveHours} hours.`
                : `在过去 ${effectiveHours} 小时内没有${includeRead ? '' : '未读'}文章。`;
            return {
                success: true,
                digest: {
                    id: null,
                    content: noArticlesMsg,
                    articleCount: 0,
                    scope: scopeName,
                    generatedAt: new Date().toISOString()
                }
            };
        }

        // 准备文章数据
        const preparedArticles = await prepareArticlesForDigest(articles);

        // 构建 prompt
        const prompt = buildDigestPrompt(preparedArticles, {
            targetLang,
            scope: scopeName,
            customPrompt
        });

        // 调用 AI
        const digestContent = await callAIForDigest(prompt, aiConfig);

        // 生成标题
        let title;
        if (customTitle) {
            // 使用自定义标题
            title = customTitle;
        } else {
            // 生成本地化标题
            const now = new Date();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const timeStr = `${month}-${day}-${hh}:${mm}`;

            const digestWord = isEn ? 'Digest' : '简报';
            title = `${scopeName} · ${digestWord} ${timeStr}`;
        }

        // 存储简报
        const saved = await DigestStore.add(userId, {
            scope,
            scopeId,
            scopeName,
            title,
            content: digestContent,
            articleCount: preparedArticles.length,
            hours: effectiveHours
        });

        return {
            success: true,
            digest: saved
        };
    }
};
