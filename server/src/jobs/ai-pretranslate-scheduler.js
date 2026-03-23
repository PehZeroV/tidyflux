/**
 * AI Pretranslate Scheduler - 后台自动翻译/摘要预处理
 *
 * 定时检查所有用户的偏好设置，为已开启自动标题翻译、自动全文翻译、
 * 自动摘要的订阅源/分组，后台自动预处理并将结果写入 ai_cache 表。
 *
 * 防 429 策略：
 * - 遇到 429 时指数退避（30s → 60s → 120s → 300s）
 * - 同一用户顺序处理，不并发
 */

import { PreferenceStore } from '../utils/preference-store.js';
import { CacheStore } from '../utils/cache-store.js';
import { getMinifluxClient } from '../middleware/auth.js';
import { PublicRssScheduler } from './public-rss-scheduler.js';
import { getFeedPublicRssConfig } from '../services/public-rss-service.js';
import {
    summarizeText,
    translateTitlesBatch,
    translateBlocksBatch,
    extractTextBlocks,
    stripHtml
} from '../utils/ai-helper.js';

// ==================== 常量 ====================
const SCHEDULER_INTERVAL = 5 * 60 * 1000;   // 5 分钟

const TITLE_BATCH_SIZE = 10;                 // 标题翻译每批最多 10 个
const FETCH_HOURS = 24;                      // 获取最近 24 小时的未读文章
const MAX_CONTENT_LENGTH = 50000;            // 文章内容截断长度
const WARMUP_DEFAULT_LIMIT = 20;             // 按 feed 预热时默认最近 20 篇
const WARMUP_MAX_LIMIT = 100;                // 预热最多 100 篇
const WARMUP_QUEUE_DELAY = 500;              // 合并短时间内的多次预热请求

// 429 退避参数
const BACKOFF_INITIAL = 30000;               // 初始退避 30 秒
const BACKOFF_MAX = 300000;                  // 最大退避 5 分钟
const BACKOFF_MULTIPLIER = 2;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function normalizeWarmupLimit(value) {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return WARMUP_DEFAULT_LIMIT;
    return Math.min(parsed, WARMUP_MAX_LIMIT);
}

function getWarmupLimitForFeed(prefs, feedId) {
    return normalizeWarmupLimit(getFeedPublicRssConfig(prefs, feedId).limit);
}

function hasUsableAIConfig(aiConfig) {
    const isOllama = aiConfig?.provider === 'ollama';
    if (!aiConfig?.apiUrl) return false;
    return isOllama || !!aiConfig?.apiKey;
}

function normalizeFeedIds(feedIds = []) {
    return [...new Set(
        (feedIds || [])
            .map(feedId => parseInt(feedId, 10))
            .filter(feedId => Number.isFinite(feedId) && feedId > 0)
    )];
}

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

function resolveActiveFeedsForMode(prefs, feeds, globalKey, overrideKey) {
    if (!prefs?.[globalKey]) return new Set();
    return resolveEnabledFeeds(prefs?.[overrideKey], feeds);
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
    _abortController: null,   // 当前轮次的 AbortController
    _scheduledTimer: null,    // 下一轮定时器
    _started: false,          // 是否已启动过（防止重复启动）
    _warmupRunning: false,    // 手动预热是否正在运行
    _warmupTimer: null,       // 预热调度器
    _pendingWarmupByUser: new Map(), // userId -> Set(feedId)

    /**
     * 单次执行入口（内部使用）
     */
    async _run() {
        if (this._running) {
            // 上一轮还没跑完，跳过
            this._scheduledTimer = setTimeout(() => this._run(), SCHEDULER_INTERVAL);
            return;
        }
        try {
            this._running = true;
            this._abortController = new AbortController();
            await this.runAll(this._abortController.signal);
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('[AI Pretranslate] Round aborted due to config change, restarting...');
            } else {
                console.error('[AI Pretranslate] Scheduler error:', err);
            }
        } finally {
            this._abortController = null;
            this._running = false;
            this._scheduledTimer = setTimeout(() => this._run(), SCHEDULER_INTERVAL);
        }
    },

    /**
     * 启动调度器（只能启动一次）
     */
    start() {
        if (this._started) return; // 防止重复启动
        this._started = true;
        console.log('[AI Pretranslate] Scheduler starting...');

        // 首次延迟 30 秒启动（等待服务器完全就绪）
        this._scheduledTimer = setTimeout(() => this._run(), 30000);
    },

    /**
     * 通知配置变更 —— 中止当前轮次并立即重跑
     */
    notifyConfigChanged() {
        if (this._abortController) {
            console.log('[AI Pretranslate] Config changed, aborting current round...');
            this._abortController.abort();
        }
        // 取消已排定的下一轮定时器，立即触发新一轮
        if (this._scheduledTimer) {
            clearTimeout(this._scheduledTimer);
            this._scheduledTimer = null;
        }
        // 等待当前轮次结束后立即开始新一轮（稍作延迟确保 finally 块执行完）
        setTimeout(() => this._run(), 500);
    },

    requestFeedWarmup(userId, feedIds = []) {
        const normalizedFeedIds = normalizeFeedIds(feedIds);
        if (!userId || normalizedFeedIds.length === 0) return 0;

        const key = String(userId);
        const pending = this._pendingWarmupByUser.get(key) || new Set();
        normalizedFeedIds.forEach(feedId => pending.add(String(feedId)));
        this._pendingWarmupByUser.set(key, pending);

        if (!this._warmupRunning) {
            this._scheduleWarmup(WARMUP_QUEUE_DELAY);
        }

        return pending.size;
    },

    async requestWarmupForPreferenceChange(userId, previousPrefs = {}, nextPrefs = {}, changedKeys = []) {
        if (!userId) return 0;

        const relevantKeys = new Set(changedKeys || []);
        const aiConfigChanged = relevantKeys.has('ai_config');
        const titleChanged = aiConfigChanged || relevantKeys.has('ai_pretranslate_title') || relevantKeys.has('title_translation_overrides');
        const translateChanged = aiConfigChanged || relevantKeys.has('ai_pretranslate_translate') || relevantKeys.has('auto_translate_overrides');
        const summaryChanged = aiConfigChanged || relevantKeys.has('ai_pretranslate_summary') || relevantKeys.has('auto_summary_overrides');

        if (!titleChanged && !translateChanged && !summaryChanged) {
            return 0;
        }

        const nextHasConfig = hasUsableAIConfig(nextPrefs?.ai_config);
        if (!nextHasConfig) {
            return 0;
        }

        const previousHasConfig = hasUsableAIConfig(previousPrefs?.ai_config);

        let feeds;
        try {
            const miniflux = await getMinifluxClient();
            if (!miniflux) return 0;
            feeds = await miniflux.getFeeds();
        } catch (err) {
            console.error('[AI Pretranslate] Failed to resolve feeds for preference-change warmup:', err.message);
            return 0;
        }

        const pendingFeedIds = new Set();
        const modeDefs = [
            {
                shouldCheck: titleChanged,
                globalKey: 'ai_pretranslate_title',
                overrideKey: 'title_translation_overrides'
            },
            {
                shouldCheck: translateChanged,
                globalKey: 'ai_pretranslate_translate',
                overrideKey: 'auto_translate_overrides'
            },
            {
                shouldCheck: summaryChanged,
                globalKey: 'ai_pretranslate_summary',
                overrideKey: 'auto_summary_overrides'
            }
        ];

        for (const { shouldCheck, globalKey, overrideKey } of modeDefs) {
            if (!shouldCheck) continue;

            const nextActiveFeeds = resolveActiveFeedsForMode(nextPrefs, feeds, globalKey, overrideKey);
            if (nextActiveFeeds.size === 0) continue;

            if (aiConfigChanged && !previousHasConfig) {
                nextActiveFeeds.forEach(feedId => pendingFeedIds.add(feedId));
                continue;
            }

            const previousActiveFeeds = resolveActiveFeedsForMode(previousPrefs, feeds, globalKey, overrideKey);
            nextActiveFeeds.forEach(feedId => {
                if (!previousActiveFeeds.has(feedId)) {
                    pendingFeedIds.add(feedId);
                }
            });
        }

        if (pendingFeedIds.size === 0) {
            return 0;
        }

        return this.requestFeedWarmup(userId, [...pendingFeedIds]);
    },

    _scheduleWarmup(delay = WARMUP_QUEUE_DELAY) {
        if (this._warmupTimer) {
            clearTimeout(this._warmupTimer);
        }
        this._warmupTimer = setTimeout(() => this._runWarmups(), delay);
        if (this._warmupTimer.unref) this._warmupTimer.unref();
    },

    async _runWarmups() {
        if (this._warmupRunning) return;

        const pendingByUser = new Map(
            [...this._pendingWarmupByUser.entries()].map(([userId, feedSet]) => [userId, [...feedSet]])
        );
        this._pendingWarmupByUser.clear();
        if (pendingByUser.size === 0) return;

        try {
            this._warmupRunning = true;
            const miniflux = await getMinifluxClient();
            if (!miniflux) return;

            for (const [userId, feedIds] of pendingByUser.entries()) {
                try {
                    await this.warmupFeeds(userId, feedIds, miniflux);
                } catch (err) {
                    console.error(`[AI Pretranslate] Warmup failed for user ${userId}:`, err.message);
                }
            }
        } finally {
            this._warmupRunning = false;
            if (this._pendingWarmupByUser.size > 0) {
                this._scheduleWarmup(WARMUP_QUEUE_DELAY);
            }
        }
    },

    /**
     * 处理所有用户
     */
    async runAll(signal) {
        const miniflux = await getMinifluxClient();
        if (!miniflux) return;

        const userIds = await PreferenceStore.getAllUserIds();
        for (const userId of userIds) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            try {
                await this.processUser(userId, miniflux, signal);
            } catch (err) {
                if (err.name === 'AbortError') throw err;
                console.error(`[AI Pretranslate] Error processing user ${userId}:`, err.message);
            }
        }
    },

    /**
     * 处理单个用户
     */
    async processUser(userId, miniflux, signal) {
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
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        await this._processTitleTranslation(userId, relevantEntries, titleFeeds, targetLang, aiConfig, backoffState, signal);

        // 2. 全文翻译（逐篇处理）
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        await this._processFullTranslation(userId, relevantEntries, translateFeeds, targetLang, aiConfig, backoffState, signal);

        // 3. 自动摘要（逐篇处理）
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        await this._processAutoSummary(userId, relevantEntries, summaryFeeds, targetLang, aiConfig, backoffState, signal);

        PublicRssScheduler.markFeedsDirty([...allFeedIds]);
    },

    async warmupFeeds(userId, feedIds = [], minifluxInstance = null) {
        const normalizedFeedIds = normalizeFeedIds(feedIds);
        if (normalizedFeedIds.length === 0) {
            return { processed: 0, feeds: [] };
        }

        const miniflux = minifluxInstance || await getMinifluxClient();
        if (!miniflux) {
            return { processed: 0, feeds: [] };
        }

        const prefs = await PreferenceStore.get(userId);
        const enableTitle = !!prefs.ai_pretranslate_title;
        const enableTranslate = !!prefs.ai_pretranslate_translate;
        const enableSummary = !!prefs.ai_pretranslate_summary;
        if (!enableTitle && !enableTranslate && !enableSummary) {
            return { processed: 0, feeds: [] };
        }

        const aiConfig = prefs.ai_config;
        if (!hasUsableAIConfig(aiConfig)) {
            return { processed: 0, feeds: [] };
        }

        const targetLang = aiConfig.targetLang || 'zh-CN';
        const titleOverrides = prefs.title_translation_overrides;
        const translateOverrides = prefs.auto_translate_overrides;
        const summaryOverrides = prefs.auto_summary_overrides;

        let feeds;
        try {
            feeds = await miniflux.getFeeds();
        } catch (err) {
            console.error(`[AI Pretranslate] Warmup failed to get feeds for user ${userId}:`, err.message);
            return { processed: 0, feeds: [] };
        }

        const requestedFeedIds = new Set(normalizedFeedIds);
        const titleFeeds = enableTitle ? resolveEnabledFeeds(titleOverrides, feeds) : new Set();
        const translateFeeds = enableTranslate ? resolveEnabledFeeds(translateOverrides, feeds) : new Set();
        const summaryFeeds = enableSummary ? resolveEnabledFeeds(summaryOverrides, feeds) : new Set();

        const warmupTitleFeeds = new Set([...titleFeeds].filter(feedId => requestedFeedIds.has(feedId)));
        const warmupTranslateFeeds = new Set([...translateFeeds].filter(feedId => requestedFeedIds.has(feedId)));
        const warmupSummaryFeeds = new Set([...summaryFeeds].filter(feedId => requestedFeedIds.has(feedId)));
        const activeFeedIds = [...new Set([
            ...warmupTitleFeeds,
            ...warmupTranslateFeeds,
            ...warmupSummaryFeeds
        ])];

        if (activeFeedIds.length === 0) {
            return { processed: 0, feeds: [] };
        }

        const entryMap = new Map();
        for (const feedId of activeFeedIds) {
            const limit = getWarmupLimitForFeed(prefs, feedId);
            try {
                const response = await miniflux.getEntries({
                    feed_id: feedId,
                    order: 'published_at',
                    direction: 'desc',
                    limit
                });
                for (const entry of response.entries || []) {
                    entryMap.set(String(entry.id), entry);
                }
            } catch (err) {
                console.error(`[AI Pretranslate] Warmup failed to get entries for feed ${feedId}:`, err.message);
            }
        }

        const relevantEntries = [...entryMap.values()].sort((a, b) => {
            const aTime = new Date(a.published_at || 0).getTime();
            const bTime = new Date(b.published_at || 0).getTime();
            return bTime - aTime;
        });
        if (relevantEntries.length === 0) {
            return { processed: 0, feeds: activeFeedIds };
        }

        console.log(`[AI Pretranslate] Warmup user ${userId}: ${relevantEntries.length} recent articles across ${activeFeedIds.length} feeds`);

        const backoffState = { backoff: BACKOFF_INITIAL };
        await this._processTitleTranslation(userId, relevantEntries, warmupTitleFeeds, targetLang, aiConfig, backoffState);
        await this._processFullTranslation(userId, relevantEntries, warmupTranslateFeeds, targetLang, aiConfig, backoffState);
        await this._processAutoSummary(userId, relevantEntries, warmupSummaryFeeds, targetLang, aiConfig, backoffState);

        PublicRssScheduler.markFeedsDirty(activeFeedIds);
        return { processed: relevantEntries.length, feeds: activeFeedIds };
    },

    /**
     * 批量标题翻译
     */
    async _processTitleTranslation(userId, entries, enabledFeeds, targetLang, aiConfig, backoffState, signal) {
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
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

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
                if (err.name === 'AbortError') throw err;
                console.error(`[AI Pretranslate] Title translation batch failed:`, err.message);
            }
        }
    },

    /**
     * 逐篇全文翻译（按段落分批翻译，缓存格式与前端一致）
     */
    async _processFullTranslation(userId, entries, enabledFeeds, targetLang, aiConfig, backoffState, signal) {
        if (enabledFeeds.size === 0) return;

        const BLOCK_BATCH_SIZE = 10; // 每批最多 10 个段落
        let count = 0;
        for (const entry of entries) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
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
                    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

                    const batch = blocks.slice(i, i + BLOCK_BATCH_SIZE);

                    const translatedBatch = await callWithBackoff(
                        () => translateBlocksBatch(batch, targetLang, aiConfig, aiConfig.translatePrompt),
                        backoffState
                    );
                    allTranslated.push(...translatedBatch);
                }

                if (allTranslated.length > 0) {
                    // 存储为 JSON 数组，与前端 _restoreTranslationFromCache 格式一致
                    CacheStore.set(userId, cacheKey, JSON.stringify(allTranslated));
                    count++;
                    console.log(`[AI Pretranslate] Translated full article ${entry.id} (${count} done)`);
                }
            } catch (err) {
                if (err.name === 'AbortError') throw err;
                console.error(`[AI Pretranslate] Translation failed for entry ${entry.id}:`, err.message);
            }

        }

        if (count > 0) {
            console.log(`[AI Pretranslate] Full translation complete: ${count} articles for user ${userId}`);
        }
    },

    /**
     * 逐篇自动摘要
     */
    async _processAutoSummary(userId, entries, enabledFeeds, targetLang, aiConfig, backoffState, signal) {
        if (enabledFeeds.size === 0) return;

        let count = 0;
        for (const entry of entries) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            if (!enabledFeeds.has(entry.feed_id)) continue;

            // 检查缓存（先查新 key，再查旧 key）
            const cacheKey = `summary:${entry.id}:${targetLang}`;
            const cached = CacheStore.get(userId, cacheKey);
            if (cached) continue;
            // 兼容旧 key
            const oldCacheKey = `summary:${entry.id}`;
            const oldCached = CacheStore.get(userId, oldCacheKey);
            if (oldCached) continue;

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
                    console.log(`[AI Pretranslate] Generated summary for entry ${entry.id} (${count} done)`);
                }
            } catch (err) {
                if (err.name === 'AbortError') throw err;
                console.error(`[AI Pretranslate] Summary failed for entry ${entry.id}:`, err.message);
            }
        }

        if (count > 0) {
            console.log(`[AI Pretranslate] Summary complete: ${count} articles for user ${userId}`);
        }
    }
};
