import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseHTML } from 'linkedom';
import { getMinifluxClient } from '../middleware/auth.js';
import { CacheStore } from '../utils/cache-store.js';
import { getDb } from '../utils/database.js';
import { PreferenceStore } from '../utils/preference-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const PUBLIC_RSS_DIR = path.join(DATA_DIR, 'public-rss');

const MAX_ITEMS = 100;
const DEFAULT_ITEMS = 20;
const FEATURE_OPTION_KEYS = ['title', 'translation', 'summary'];
const FETCH_MULTIPLIER = 4;
const MIN_SOURCE_ITEMS = 100;
const MAX_SOURCE_ITEMS = 400;

export const PUBLIC_RSS_CONFIG_KEY = 'public_rss_config';
export const PUBLIC_RSS_IMPACT_KEYS = new Set([
    PUBLIC_RSS_CONFIG_KEY,
    'ai_config',
    'ai_pretranslate_title',
    'ai_pretranslate_translate',
    'ai_pretranslate_summary',
    'title_translation_overrides',
    'auto_translate_overrides',
    'auto_summary_overrides'
]);

const FEATURE_PREF_MAP = Object.freeze({
    title: {
        globalPrefKey: 'ai_pretranslate_title',
        overridePrefKey: 'title_translation_overrides'
    },
    translation: {
        globalPrefKey: 'ai_pretranslate_translate',
        overridePrefKey: 'auto_translate_overrides'
    },
    summary: {
        globalPrefKey: 'ai_pretranslate_summary',
        overridePrefKey: 'auto_summary_overrides'
    }
});

function ensurePublicRssDirSync() {
    if (!existsSync(PUBLIC_RSS_DIR)) {
        mkdirSync(PUBLIC_RSS_DIR, { recursive: true });
    }
}

function getPublicRssStaticPath(feedId) {
    ensurePublicRssDirSync();
    return path.join(PUBLIC_RSS_DIR, `feed-${feedId}.xml`);
}

function escapeXml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function wrapCdata(value = '') {
    return `<![CDATA[${String(value).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function toRssDate(value) {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date().toUTCString() : date.toUTCString();
}

function normalizeLimit(value) {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_ITEMS;
    return Math.min(parsed, MAX_ITEMS);
}

function extractText(html = '') {
    if (!html) return '';
    const { document } = parseHTML(`<div id="rss-body">${html}</div>`);
    return document.getElementById('rss-body')?.textContent?.trim() || '';
}

function textToParagraphHtml(text = '') {
    const normalized = String(text).replace(/\r\n?/g, '\n').trim();
    if (!normalized) return '';
    return escapeHtml(normalized).replace(/\n/g, '<br>');
}

function buildSummaryLead(summary = '') {
    const paragraphHtml = textToParagraphHtml(summary);
    if (!paragraphHtml) return '';
    return `<p>✦:<br>${paragraphHtml}<br>---</p>`;
}

function prependSummaryToContent(content = '', summary = '') {
    const lead = buildSummaryLead(summary);
    return `${lead}${content || ''}`;
}

function summarizeForDescription(text = '', maxLength = 280) {
    const normalized = String(text).replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function parseTranslationCache(raw) {
    if (!raw) return [];
    try {
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function getCachedSummary(userId, entryId, lang) {
    return CacheStore.get(userId, `summary:${entryId}:${lang}`)
        || CacheStore.get(userId, `summary:${entryId}`)
        || '';
}

function getCachedTitle(userId, title, lang) {
    if (!title) return '';
    return CacheStore.get(userId, `title:${title}||${lang}`) || '';
}

function getCachedTranslation(userId, entryId, lang) {
    return CacheStore.get(userId, `translation:${entryId}:${lang}`) || '';
}

function hasCachedSummary(summary = '') {
    return Boolean(String(summary).trim());
}

function getTranslatedTitleFromBlocks(blocks, fallbackTitle = '') {
    const titleBlock = blocks.find(block => block && block.isTitle && (block.html || block.text));
    if (!titleBlock) return fallbackTitle;
    return String(titleBlock.html || titleBlock.text || '').trim() || fallbackTitle;
}

function hasTranslatedTitle(cachedTitle, blocks) {
    if (String(cachedTitle || '').trim()) return true;
    return Array.isArray(blocks) && blocks.some(block => block && block.isTitle && (block.html || block.text));
}

function renderTranslatedContent(blocks, fallbackHtml = '') {
    if (!Array.isArray(blocks) || blocks.length === 0) return fallbackHtml || '';

    const bodyBlocks = blocks.filter(block => block && !block.isTitle && (block.html || block.text));
    if (bodyBlocks.length === 0) return fallbackHtml || '';

    return bodyBlocks
        .map(block => `<p>${textToParagraphHtml(block.html || block.text || '')}</p>`)
        .join('');
}

function renderBilingualContent(blocks, fallbackHtml = '') {
    if (!Array.isArray(blocks) || blocks.length === 0) return fallbackHtml || '';

    const bodyBlocks = blocks.filter(block => block && !block.isTitle && (block.text || block.html));
    if (bodyBlocks.length === 0) return fallbackHtml || '';

    return bodyBlocks
        .map(block => {
            const originalHtml = block.text ? `<p>${textToParagraphHtml(block.text)}</p>` : '';
            const translatedHtml = (block.html || block.text)
                ? `<p>${textToParagraphHtml(block.html || block.text || '')}</p>`
                : '';
            return `${originalHtml}${translatedHtml}`;
        })
        .join('');
}

function hasTranslatedContent(blocks) {
    return Array.isArray(blocks) && blocks.some(block => block && !block.isTitle && (block.html || block.text));
}

export async function resolveSingleUserId() {
    const prefUserIds = await PreferenceStore.getAllUserIds();
    if (prefUserIds.length > 1) {
        const error = new Error('Public RSS only supports single-user deployments.');
        error.status = 409;
        throw error;
    }
    if (prefUserIds.length === 1) return prefUserIds[0];

    const cacheUsers = getDb().prepare('SELECT DISTINCT user_id FROM ai_cache LIMIT 2').all();
    if (cacheUsers.length > 1) {
        const error = new Error('Public RSS only supports single-user deployments.');
        error.status = 409;
        throw error;
    }
    if (cacheUsers.length === 1) return cacheUsers[0].user_id;

    return 'default';
}

export async function loadSingleUserContext() {
    const userId = await resolveSingleUserId();
    const prefs = userId === 'default' ? {} : await PreferenceStore.get(userId);
    return { userId, prefs };
}

function resolveTargetLang(queryLang, prefs) {
    const aiConfig = prefs?.ai_config || {};
    return queryLang || aiConfig.targetLang || aiConfig.summarizeLang || 'zh-CN';
}

export function getPublicRssConfig(prefs) {
    const config = prefs?.[PUBLIC_RSS_CONFIG_KEY];
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return { feeds: {} };
    }

    const feeds = config.feeds && typeof config.feeds === 'object' && !Array.isArray(config.feeds)
        ? config.feeds
        : {};

    return { feeds };
}

export function getFeedPublicRssConfig(prefs, feedId) {
    const config = getPublicRssConfig(prefs);
    const entry = config.feeds?.[String(feedId)];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return {};
    }
    return entry;
}

export function getStaticEnabledFeedIds(prefs) {
    return Object.entries(getPublicRssConfig(prefs).feeds || {})
        .filter(([, entry]) => Boolean(entry?.staticXml))
        .map(([feedId]) => String(feedId));
}

export function isStaticPublicRssEnabled(prefs, feedId) {
    return Boolean(getFeedPublicRssConfig(prefs, feedId).staticXml);
}

function parseFlag(value) {
    if (typeof value === 'boolean') return value;
    if (value == null) return false;
    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

export function getOptionsFromMode(mode) {
    return {
        title: mode === 'title',
        translation: mode === 'translation',
        summary: mode === 'summary',
        bilingual: false
    };
}

function createEmptyOptions() {
    return {
        title: false,
        translation: false,
        summary: false,
        bilingual: false
    };
}

function hasQueryParam(query = {}, key) {
    return Object.prototype.hasOwnProperty.call(query, key);
}

function hasExplicitPublicRssOptionOverrides(query = {}) {
    return FEATURE_OPTION_KEYS.some(key => hasQueryParam(query, key))
        || hasQueryParam(query, 'bilingual');
}

export function hasExplicitPublicRssOverrides(query = {}) {
    return hasExplicitPublicRssOptionOverrides(query)
        || hasQueryParam(query, 'limit')
        || hasQueryParam(query, 'lang');
}

function getFeedGroupId(feed) {
    return feed?.category?.id
        ?? feed?.category_id
        ?? feed?.group_id
        ?? null;
}

function isFeatureEnabledForFeed(prefs, feed, featureKey) {
    const config = FEATURE_PREF_MAP[featureKey];
    if (!config || !prefs?.[config.globalPrefKey]) return false;

    const overrides = prefs?.[config.overridePrefKey] || {};
    const feedOverride = overrides.feeds?.[feed.id] || 'inherit';
    if (feedOverride === 'on') return true;
    if (feedOverride === 'off') return false;

    const groupId = getFeedGroupId(feed);
    if (groupId != null) {
        const groupOverride = overrides.groups?.[groupId] || 'inherit';
        if (groupOverride === 'on') return true;
        if (groupOverride === 'off') return false;
    }

    return false;
}

function getStoredOptionsFromPreferences(prefs, feed) {
    return {
        title: isFeatureEnabledForFeed(prefs, feed, 'title'),
        translation: isFeatureEnabledForFeed(prefs, feed, 'translation'),
        summary: isFeatureEnabledForFeed(prefs, feed, 'summary'),
        bilingual: Boolean(getFeedPublicRssConfig(prefs, feed?.id).bilingual)
    };
}

function applyQueryOptionOverrides(baseOptions, query = {}) {
    const next = { ...baseOptions };
    FEATURE_OPTION_KEYS.forEach(key => {
        if (hasQueryParam(query, key)) {
            next[key] = parseFlag(query[key]);
        }
    });
    if (hasQueryParam(query, 'bilingual')) {
        next.bilingual = parseFlag(query.bilingual);
    }
    return next;
}

function resolveBaseOptions(requestedOptions, storedOptions, query = {}) {
    if (requestedOptions) return requestedOptions;
    if (hasExplicitPublicRssOptionOverrides(query)) return createEmptyOptions();
    return storedOptions;
}

function resolvePublicRssLimit(query = {}, prefs, feedId) {
    if (hasQueryParam(query, 'limit')) {
        return normalizeLimit(query.limit);
    }
    return normalizeLimit(getFeedPublicRssConfig(prefs, feedId).limit);
}

function hasSelectedOptions(options = {}) {
    return FEATURE_OPTION_KEYS.some(key => Boolean(options[key]));
}

function buildOptionSignature(options = {}) {
    const parts = FEATURE_OPTION_KEYS.filter(key => options[key]);
    if (options.bilingual && (options.title || options.translation)) {
        parts.push('bilingual');
    }
    return parts.join('+') || 'original';
}

function buildSourceFetchLimit(limit, options) {
    if (!hasSelectedOptions(options)) return limit;
    return Math.min(MAX_SOURCE_ITEMS, Math.max(limit * FETCH_MULTIPLIER, MIN_SOURCE_ITEMS));
}

function buildChannelTitle(feed) {
    return feed?.title || 'Untitled Feed';
}

function buildChannelDescription(feed, options, lang) {
    const features = [];
    if (options.title) features.push('translated titles');
    if (options.translation) features.push('translated content');
    if (options.summary) features.push('prepended summaries');
    if (options.bilingual && (options.title || options.translation)) features.push('bilingual display');
    const featureText = features.length > 0 ? features.join(', ') : 'derived content';
    return `${feed.title} feed with ${featureText} in ${lang}, generated by Tidyflux.`;
}

function shouldUseBilingualDisplay(options = {}) {
    return Boolean(options.bilingual && (options.title || options.translation));
}

function buildDisplayedTitle(originalTitle = '', translatedTitle = '', options = {}) {
    if (!options.title) return originalTitle;
    if (!shouldUseBilingualDisplay(options)) return translatedTitle;

    const normalizedOriginal = String(originalTitle || '').trim();
    const normalizedTranslated = String(translatedTitle || '').trim();
    if (!normalizedOriginal) return normalizedTranslated;
    if (!normalizedTranslated || normalizedTranslated === normalizedOriginal) return normalizedOriginal;
    return `${normalizedTranslated} / ${normalizedOriginal}`;
}

function buildXml(feed, entriesData, items, options, lang, origin = '') {
    const channelTitle = buildChannelTitle(feed);
    const channelLink = feed.site_url || feed.feed_url || origin || '';
    const channelDescription = buildChannelDescription(feed, options, lang);

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <link>${escapeXml(channelLink)}</link>
    <description>${escapeXml(channelDescription)}</description>
    <language>${escapeXml(lang)}</language>
    <generator>Tidyflux</generator>
    <lastBuildDate>${escapeXml(toRssDate(entriesData?.entries?.[0]?.published_at || new Date().toISOString()))}</lastBuildDate>
${items}
  </channel>
</rss>`;
}

export async function generatePublicRssXml({
    feedId,
    requestedOptions = null,
    query = {},
    origin = '',
    miniflux = null,
    userContext = null
} = {}) {
    const client = miniflux || await getMinifluxClient();
    if (!client) {
        const error = new Error('Miniflux is not configured.');
        error.status = 503;
        throw error;
    }

    const resolvedUserContext = userContext || await loadSingleUserContext();
    const userId = resolvedUserContext.userId;
    const prefs = resolvedUserContext.prefs || {};
    const feed = await client.getFeed(feedId);
    const storedOptions = getStoredOptionsFromPreferences(prefs, feed);
    const resolvedOptions = applyQueryOptionOverrides(
        resolveBaseOptions(requestedOptions, storedOptions, query),
        query
    );
    const limit = resolvePublicRssLimit(query, prefs, feedId);
    const hasAiOptions = hasSelectedOptions(resolvedOptions);
    const lang = resolveTargetLang(
        typeof query.lang === 'string' && query.lang.trim()
            ? query.lang.trim()
            : undefined,
        prefs
    );

    const entriesData = await client.getEntries({
        feed_id: feedId,
        limit: buildSourceFetchLimit(limit, resolvedOptions),
        order: 'published_at',
        direction: 'desc'
    });

    if (hasAiOptions) {
        const unavailableFeatures = FEATURE_OPTION_KEYS.filter(
            key => resolvedOptions[key] && !isFeatureEnabledForFeed(prefs, feed, key)
        );
        if (unavailableFeatures.length > 0) {
            const error = new Error(`Selected public RSS features are not enabled in AI automation: ${unavailableFeatures.join(', ')}`);
            error.status = 409;
            throw error;
        }
    }

    const items = (entriesData?.entries || []).map(entry => {
        const originalTitle = entry.title || '';
        const originalContent = entry.content || entry.summary || '';
        if (!hasAiOptions) {
            const description = summarizeForDescription(extractText(originalContent));
            const guid = `tidyflux:original:${lang}:feed:${feedId}:entry:${entry.id}`;
            return `
    <item>
      <title>${escapeXml(originalTitle)}</title>
      <link>${escapeXml(entry.url || feed.site_url || feed.feed_url || '')}</link>
      <guid isPermaLink="false">${escapeXml(guid)}</guid>
      <pubDate>${escapeXml(toRssDate(entry.published_at))}</pubDate>
      ${entry.author ? `<author>${escapeXml(entry.author)}</author>` : ''}
      <description>${escapeXml(description)}</description>
      <content:encoded>${wrapCdata(originalContent)}</content:encoded>
    </item>`.trim();
        }

        const translationRaw = getCachedTranslation(userId, entry.id, lang);
        const translationBlocks = parseTranslationCache(translationRaw);
        const cachedTitle = getCachedTitle(userId, originalTitle, lang);
        const translatedTitle = cachedTitle
            || getTranslatedTitleFromBlocks(translationBlocks, originalTitle)
            || originalTitle;
        const summary = getCachedSummary(userId, entry.id, lang);

        if (resolvedOptions.title && !hasTranslatedTitle(cachedTitle, translationBlocks)) {
            return null;
        }
        if (resolvedOptions.translation && !hasTranslatedContent(translationBlocks)) {
            return null;
        }
        if (resolvedOptions.summary && !hasCachedSummary(summary)) {
            return null;
        }

        const translatedContentHtml = resolvedOptions.translation
            ? renderTranslatedContent(translationBlocks, originalContent)
            : originalContent;
        const title = buildDisplayedTitle(originalTitle, translatedTitle, resolvedOptions);
        let contentHtml = resolvedOptions.translation
            ? (shouldUseBilingualDisplay(resolvedOptions)
                ? renderBilingualContent(translationBlocks, originalContent)
                : translatedContentHtml)
            : originalContent;
        let descriptionSource = resolvedOptions.summary
            ? (summary || extractText(translatedContentHtml || originalContent))
            : extractText(translatedContentHtml || originalContent);

        if (resolvedOptions.summary) {
            contentHtml = prependSummaryToContent(contentHtml, summary);
        }

        if (resolvedOptions.translation && !resolvedOptions.summary) {
            descriptionSource = extractText(translatedContentHtml);
        } else if (resolvedOptions.summary && summary) {
            descriptionSource = summary;
        }

        const description = summarizeForDescription(descriptionSource);
        const guid = `tidyflux:${buildOptionSignature(resolvedOptions)}:${lang}:feed:${feedId}:entry:${entry.id}`;

        return `
    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(entry.url || feed.site_url || feed.feed_url || '')}</link>
      <guid isPermaLink="false">${escapeXml(guid)}</guid>
      <pubDate>${escapeXml(toRssDate(entry.published_at))}</pubDate>
      ${entry.author ? `<author>${escapeXml(entry.author)}</author>` : ''}
      <description>${escapeXml(description)}</description>
      <content:encoded>${wrapCdata(contentHtml)}</content:encoded>
    </item>`.trim();
    }).filter(Boolean).slice(0, limit).join('\n');

    const xml = buildXml(
        feed,
        entriesData,
        items,
        resolvedOptions,
        lang,
        origin
    );

    return {
        xml,
        feed,
        options: resolvedOptions,
        lang,
        limit
    };
}

export async function readStaticPublicRss(feedId) {
    try {
        return await fs.readFile(getPublicRssStaticPath(feedId), 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return '';
        throw error;
    }
}

export async function writeStaticPublicRss(feedId, xml) {
    ensurePublicRssDirSync();
    const filePath = getPublicRssStaticPath(feedId);
    const existingXml = await readStaticPublicRss(feedId);
    if (existingXml === xml) {
        return false;
    }
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, xml, 'utf8');
    await fs.rename(tempPath, filePath);
    return true;
}

export async function removeStaticPublicRss(feedId) {
    try {
        await fs.unlink(getPublicRssStaticPath(feedId));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

export async function cleanupStaticPublicRssFiles(enabledFeedIds = []) {
    ensurePublicRssDirSync();
    const allowed = new Set((enabledFeedIds || []).map(String));
    const files = await fs.readdir(PUBLIC_RSS_DIR).catch(() => []);

    await Promise.all(files.map(async (fileName) => {
        const match = /^feed-(\d+)\.xml$/.exec(fileName);
        if (!match) return;
        if (allowed.has(match[1])) return;
        await fs.unlink(path.join(PUBLIC_RSS_DIR, fileName)).catch(() => {});
    }));
}

export async function generateAndStoreStaticPublicRss({ feedId, miniflux = null, userContext = null } = {}) {
    const result = await generatePublicRssXml({
        feedId,
        miniflux,
        userContext,
        origin: ''
    });
    await writeStaticPublicRss(feedId, result.xml);
    return result;
}
