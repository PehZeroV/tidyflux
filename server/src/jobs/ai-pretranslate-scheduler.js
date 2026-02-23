/**
 * AI Pretranslate Scheduler - 后台自动翻译/摘要预处理
 *
 * 定时检查所有用户的偏好设置，为已开启自动标题翻译、自动全文翻译、
 * 自动摘要的订阅源/分组，后台自动预处理并将结果写入 ai_cache 表。
 *
 * 防 429 策略：
 * - 每次 AI 调用完成后固定等待 2 秒再发起下一次
 * - 遇到 429 时指数退避（30s → 60s → 120s → 300s）
 * - 同一用户顺序处理，不并发
 */

import { PreferenceStore } from '../utils/preference-store.js';
import { CacheStore } from '../utils/cache-store.js';
import { getMinifluxClient } from '../middleware/auth.js';
import {
    summarizeText,
    translateTitlesBatch,
    translateBlocksBatch,
    extractTextBlocks,
    stripHtml
} from '../utils/ai-helper.js';

// ==================== 常量 ====================
const SCHEDULER_INTERVAL = 5 * 60 * 1000;   // 5 分钟
const DELAY_BETWEEN_CALLS = 2000;            // 每次 AI 调用后等待 2 秒
const TITLE_BATCH_SIZE = 10;                 // 标题翻译每批最多 10 个
const FETCH_HOURS = 24;                      // 获取最近 24 小时的未读文章
const MAX_CONTENT_LENGTH = 50000;            // 文章内容截断长度

// 429 退避参数
const BACKOFF_INITIAL = 30000;               // 初始退避 30 秒
const BACKOFF_MAX = 300000;                  // 最大退避 5 分钟
const BACKOFF_MULTIPLIER = 2;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 解析 overrides 配置，返回需要启用某功能的 feedId 集合
 * @param {object} overrides - { feeds: {id: 'on'|'off'}, groups: {id: 'on'|'off'} }
 * @param {Array} feeds - 所有 feed 列表 (Miniflux 格式)
 * @returns {Set<number>} 需要启用的 feedId 集合
 */
function resolveEnabledFeeds(overrides, feeds) {
    if (!overrides) return new Set();

    const feedOverrides = overrides.feeds || {};
    const groupOverrides = overrides.groups || {};
    const result = new Set();

    for (const feed of feeds) {
        const feedId = feed.id;
        const groupId = feed.category?.id;

        const feedOv = feedOverrides[feedId] || 'inherit';
        if (feedOv === 'on') { result.add(feedId); continue; }
        if (feedOv === 'off') { continue; }

        // inherit → 检查 group
        if (groupId) {
            const groupOv = groupOverrides[groupId] || 'inherit';
            if (groupOv === 'on') { result.add(feedId); continue; }
            if (groupOv === 'off') { continue; }
        }
        // 默认不启用
    }

    return result;
}

/**
 * 带 429 退避的 AI 调用包装器
 */
async function callWithBackoff(fn, state) {
    while (true) {
        try {
            const result = await fn();
            // 成功后重置退避
            state.backoff = BACKOFF_INITIAL;
            return result;
        } catch (err) {
            if (err.statusCode === 429) {
                console.warn(`[AI Pretranslate] Rate limited (429), backing off ${state.backoff / 1000}s...`);
                await sleep(state.backoff);
                state.backoff = Math.min(state.backoff * BACKOFF_MULTIPLIER, BACKOFF_MAX);
                continue; // 重试
            }
            throw err; // 其他错误直接抛出
        }
    }
}

export const AIPretranslateScheduler = {
    _running: false,

    /**
     * 启动调度器
     */
    start() {
        console.log('[AI Pretranslate] Scheduler starting...');

        const run = async () => {
            if (this._running) {
                // 上一轮还没跑完，跳过
                setTimeout(run, SCHEDULER_INTERVAL);
                return;
            }
            try {
                this._running = true;
                await this.runAll();
            } catch (err) {
                console.error('[AI Pretranslate] Scheduler error:', err);
            } finally {
                this._running = false;
                setTimeout(run, SCHEDULER_INTERVAL);
            }
        };

        // 首次延迟 30 秒启动（等待服务器完全就绪）
        setTimeout(run, 30000);
    },

    /**
     * 处理所有用户
     */
    async runAll() {
        const miniflux = await getMinifluxClient();
        if (!miniflux) return;

        const userIds = await PreferenceStore.getAllUserIds();
        for (const userId of userIds) {
            try {
                await this.processUser(userId, miniflux);
            } catch (err) {
                console.error(`[AI Pretranslate] Error processing user ${userId}:`, err.message);
            }
        }
    },

    /**
     * 处理单个用户
     */
    async processUser(userId, miniflux) {
        const prefs = await PreferenceStore.get(userId);

        // 检查用户是否启用了任何后台预处理功能（默认全部关闭）
        const enableTitle = !!prefs.ai_pretranslate_title;
        const enableTranslate = !!prefs.ai_pretranslate_translate;
        const enableSummary = !!prefs.ai_pretranslate_summary;
        if (!enableTitle && !enableTranslate && !enableSummary) return;

        const aiConfig = prefs.ai_config;

        // 检查 AI 是否配置
        const isOllama = aiConfig?.provider === 'ollama';
        if (!aiConfig?.apiUrl || (!isOllama && !aiConfig?.apiKey)) return;

        const targetLang = aiConfig.targetLang || 'zh-CN';

        // 获取三种功能的 override 配置
        const titleOverrides = prefs.title_translation_overrides;
        const translateOverrides = prefs.auto_translate_overrides;
        const summaryOverrides = prefs.auto_summary_overrides;

        // 如果三种功能都没有对应的 override 配置，跳过
        if (!titleOverrides && !translateOverrides && !summaryOverrides) return;

        // 获取所有 feeds
        let feeds;
        try {
            feeds = await miniflux.getFeeds();
        } catch (err) {
            console.error(`[AI Pretranslate] Failed to get feeds for user ${userId}:`, err.message);
            return;
        }

        // 解析哪些 feed 需要启用哪些功能（仅在用户开启了对应开关时解析）
        const titleFeeds = enableTitle ? resolveEnabledFeeds(titleOverrides, feeds) : new Set();
        const translateFeeds = enableTranslate ? resolveEnabledFeeds(translateOverrides, feeds) : new Set();
        const summaryFeeds = enableSummary ? resolveEnabledFeeds(summaryOverrides, feeds) : new Set();

        // 合并所有需要处理的 feedId
        const allFeedIds = new Set([...titleFeeds, ...translateFeeds, ...summaryFeeds]);
        if (allFeedIds.size === 0) return;

        // 获取最近文章
        const afterDate = new Date();
        afterDate.setHours(afterDate.getHours() - FETCH_HOURS);
        const afterTs = Math.floor(afterDate.getTime() / 1000);

        let entries;
        try {
            const response = await miniflux.getEntries({
                status: 'unread',
                order: 'published_at',
                direction: 'desc',
                limit: 500,
                after: afterTs
            });
            entries = response.entries || [];
        } catch (err) {
            console.error(`[AI Pretranslate] Failed to get entries for user ${userId}:`, err.message);
            return;
        }

        // 过滤出属于需要处理的 feed 的文章
        const relevantEntries = entries.filter(e => allFeedIds.has(e.feed_id));
        if (relevantEntries.length === 0) return;

        console.log(`[AI Pretranslate] Processing user ${userId}: ${relevantEntries.length} articles across ${allFeedIds.size} feeds`);

        const backoffState = { backoff: BACKOFF_INITIAL };

        // 1. 标题翻译（批量处理）
        await this._processTitleTranslation(userId, relevantEntries, titleFeeds, targetLang, aiConfig, backoffState);

        // 2. 全文翻译（逐篇处理）
        await this._processFullTranslation(userId, relevantEntries, translateFeeds, targetLang, aiConfig, backoffState);

        // 3. 自动摘要（逐篇处理）
        await this._processAutoSummary(userId, relevantEntries, summaryFeeds, targetLang, aiConfig, backoffState);
    },

    /**
     * 批量标题翻译
     */
    async _processTitleTranslation(userId, entries, enabledFeeds, targetLang, aiConfig, backoffState) {
        if (enabledFeeds.size === 0) return;

        // 筛选需要标题翻译的文章
        const needTranslate = [];
        for (const entry of entries) {
            if (!enabledFeeds.has(entry.feed_id)) continue;

            // 检查缓存
            const cacheKey = `title:${entry.title}||${targetLang}`;
            const cached = CacheStore.get(userId, cacheKey);
            if (cached) continue;

            needTranslate.push({ id: entry.id, title: entry.title });
        }

        if (needTranslate.length === 0) return;

        console.log(`[AI Pretranslate] Translating ${needTranslate.length} titles for user ${userId}`);

        // 分批翻译
        for (let i = 0; i < needTranslate.length; i += TITLE_BATCH_SIZE) {
            const batch = needTranslate.slice(i, i + TITLE_BATCH_SIZE);

            try {
                const resultMap = await callWithBackoff(
                    () => translateTitlesBatch(batch, targetLang, aiConfig, aiConfig.titleTranslatePrompt),
                    backoffState
                );

                // 写入缓存
                const cacheEntries = [];
                for (const item of batch) {
                    const translated = resultMap.get(item.id);
                    if (translated && translated !== item.title) {
                        cacheEntries.push({
                            key: `title:${item.title}||${targetLang}`,
                            content: translated
                        });
                    }
                }
                if (cacheEntries.length > 0) {
                    CacheStore.setMany(userId, cacheEntries);
                }

                console.log(`[AI Pretranslate] Translated ${batch.length} titles (batch ${Math.floor(i / TITLE_BATCH_SIZE) + 1})`);
            } catch (err) {
                console.error(`[AI Pretranslate] Title translation batch failed:`, err.message);
            }

            // 等待间隔
            if (i + TITLE_BATCH_SIZE < needTranslate.length) {
                await sleep(DELAY_BETWEEN_CALLS);
            }
        }
    },

    /**
     * 逐篇全文翻译（按段落分批翻译，缓存格式与前端一致）
     */
    async _processFullTranslation(userId, entries, enabledFeeds, targetLang, aiConfig, backoffState) {
        if (enabledFeeds.size === 0) return;

        const BLOCK_BATCH_SIZE = 10; // 每批最多 10 个段落
        let count = 0;
        for (const entry of entries) {
            if (!enabledFeeds.has(entry.feed_id)) continue;

            // 检查缓存
            const cacheKey = `translation:${entry.id}:${targetLang}`;
            const cached = CacheStore.get(userId, cacheKey);
            if (cached) continue;

            const content = entry.content || '';
            if (!content.trim()) continue;

            // 截断过长内容
            const truncated = content.length > MAX_CONTENT_LENGTH
                ? content.substring(0, MAX_CONTENT_LENGTH)
                : content;

            // 提取文本块（包含标题 + 正文段落）
            const blocks = extractTextBlocks(truncated, entry.title);
            if (blocks.length === 0) continue;

            try {
                // 分批翻译，每批最多 BLOCK_BATCH_SIZE 个段落
                const allTranslated = [];
                for (let i = 0; i < blocks.length; i += BLOCK_BATCH_SIZE) {
                    const batch = blocks.slice(i, i + BLOCK_BATCH_SIZE);

                    const translatedBatch = await callWithBackoff(
                        () => translateBlocksBatch(batch, targetLang, aiConfig, aiConfig.translatePrompt),
                        backoffState
                    );
                    allTranslated.push(...translatedBatch);

                    // 批次间等待
                    if (i + BLOCK_BATCH_SIZE < blocks.length) {
                        await sleep(DELAY_BETWEEN_CALLS);
                    }
                }

                if (allTranslated.length > 0) {
                    // 存储为 JSON 数组，与前端 _restoreTranslationFromCache 格式一致
                    CacheStore.set(userId, cacheKey, JSON.stringify(allTranslated));
                    count++;
                }
            } catch (err) {
                console.error(`[AI Pretranslate] Translation failed for entry ${entry.id}:`, err.message);
            }

            await sleep(DELAY_BETWEEN_CALLS);
        }

        if (count > 0) {
            console.log(`[AI Pretranslate] Translated ${count} full articles for user ${userId}`);
        }
    },

    /**
     * 逐篇自动摘要
     */
    async _processAutoSummary(userId, entries, enabledFeeds, targetLang, aiConfig, backoffState) {
        if (enabledFeeds.size === 0) return;

        let count = 0;
        for (const entry of entries) {
            if (!enabledFeeds.has(entry.feed_id)) continue;

            // 检查缓存
            const cacheKey = `summary:${entry.id}`;
            const cached = CacheStore.get(userId, cacheKey);
            if (cached) continue;

            const content = entry.content || '';
            if (!content.trim()) continue;

            // 转为纯文本并截断
            let text = stripHtml(content);
            if (text.length > MAX_CONTENT_LENGTH) {
                text = text.substring(0, MAX_CONTENT_LENGTH);
            }

            try {
                const summary = await callWithBackoff(
                    () => summarizeText(text, targetLang, aiConfig, aiConfig.summarizePrompt),
                    backoffState
                );

                if (summary) {
                    CacheStore.set(userId, cacheKey, summary);
                    count++;
                }
            } catch (err) {
                console.error(`[AI Pretranslate] Summary failed for entry ${entry.id}:`, err.message);
            }

            await sleep(DELAY_BETWEEN_CALLS);
        }

        if (count > 0) {
            console.log(`[AI Pretranslate] Generated ${count} summaries for user ${userId}`);
        }
    }
};
