/**
 * Public RSS Manager Dialog
 * @module view/dialog-public-rss
 */

import { AppState } from '../../state.js';
import { FeedManager } from '../feed-manager.js';
import { createDialog, escapeHtml, showToast } from './utils.js';
import { i18n } from '../i18n.js';
import { Icons } from '../icons.js';
import { AIService } from '../ai-service.js';

const STORAGE_KEY_PUBLIC_RSS_COLLAPSED = 'tidyflux_public_rss_collapsed_groups';
const STORAGE_KEY_PUBLIC_RSS_LIMITS = 'tidyflux_public_rss_feed_limits';
const STORAGE_KEY_PUBLIC_RSS_BILINGUAL = 'tidyflux_public_rss_feed_bilingual';
const PUBLIC_RSS_CONFIG_PREF_KEY = 'public_rss_config';
const DEFAULT_PUBLIC_RSS_LIMIT = 20;
const MIN_PUBLIC_RSS_LIMIT = 1;
const MAX_PUBLIC_RSS_LIMIT = 100;
const PUBLIC_RSS_CHECKBOX_INPUT_STYLE = 'width: 14px; height: 14px; flex-shrink: 0; cursor: pointer; accent-color: var(--accent-color);';
const FEATURE_CONFIG = Object.freeze({
    title: {
        labelKey: 'settings.public_rss_title_mode',
        globalPrefKey: 'ai_pretranslate_title',
        overridePrefKey: 'title_translation_overrides',
        reloadManager: () => AIService._translationOM.load()
    },
    translation: {
        labelKey: 'settings.public_rss_translation_mode',
        globalPrefKey: 'ai_pretranslate_translate',
        overridePrefKey: 'auto_translate_overrides',
        reloadManager: () => AIService._translateOM.load()
    },
    summary: {
        labelKey: 'settings.public_rss_summary_mode',
        globalPrefKey: 'ai_pretranslate_summary',
        overridePrefKey: 'auto_summary_overrides',
        reloadManager: () => AIService._summaryOM.load()
    }
});
const FEATURE_KEYS = Object.keys(FEATURE_CONFIG);

function createEmptyFeatureSelection() {
    return {
        title: false,
        translation: false,
        summary: false
    };
}

function hasSelectedOptions(options = {}) {
    return FEATURE_KEYS.some(key => Boolean(options[key]));
}

function normalizePublicRssLimit(value) {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) return DEFAULT_PUBLIC_RSS_LIMIT;
    return Math.min(MAX_PUBLIC_RSS_LIMIT, Math.max(MIN_PUBLIC_RSS_LIMIT, parsed));
}

function getLegacyStoredPublicRssLimits() {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY_PUBLIC_RSS_LIMITS) || '{}');
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
            return {};
        }
        return Object.entries(stored).reduce((acc, [feedId, limit]) => {
            acc[String(feedId)] = normalizePublicRssLimit(limit);
            return acc;
        }, {});
    } catch {
        return {};
    }
}

function getLegacyStoredPublicRssBilingualMap() {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY_PUBLIC_RSS_BILINGUAL) || '{}');
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
            return {};
        }
        return Object.entries(stored).reduce((acc, [feedId, enabled]) => {
            acc[String(feedId)] = Boolean(enabled);
            return acc;
        }, {});
    } catch {
        return {};
    }
}

function clearLegacyStoredPublicRssSettings() {
    try {
        localStorage.removeItem(STORAGE_KEY_PUBLIC_RSS_LIMITS);
        localStorage.removeItem(STORAGE_KEY_PUBLIC_RSS_BILINGUAL);
    } catch {
        // ignore
    }
}

function getPublicRssConfig() {
    const config = AppState.preferences?.[PUBLIC_RSS_CONFIG_PREF_KEY];
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return { feeds: {} };
    }

    const feeds = config.feeds && typeof config.feeds === 'object' && !Array.isArray(config.feeds)
        ? config.feeds
        : {};

    return { feeds };
}

function getFeedPublicRssConfig(feedId, publicRssConfig = {}) {
    const entry = publicRssConfig.feeds?.[String(feedId)];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return {};
    }
    return entry;
}

function getFeedPublicRssLimit(feedId, publicRssConfig = {}, legacyFeedLimits = null) {
    const entry = getFeedPublicRssConfig(feedId, publicRssConfig);
    if (entry.limit != null) {
        return normalizePublicRssLimit(entry.limit);
    }
    if (legacyFeedLimits && legacyFeedLimits[String(feedId)] != null) {
        return normalizePublicRssLimit(legacyFeedLimits[String(feedId)]);
    }
    return DEFAULT_PUBLIC_RSS_LIMIT;
}

function getFeedPublicRssBilingual(feedId, publicRssConfig = {}, legacyBilingualMap = null) {
    const entry = getFeedPublicRssConfig(feedId, publicRssConfig);
    if (Object.prototype.hasOwnProperty.call(entry, 'bilingual')) {
        return Boolean(entry.bilingual);
    }
    if (legacyBilingualMap && Object.prototype.hasOwnProperty.call(legacyBilingualMap, String(feedId))) {
        return Boolean(legacyBilingualMap[String(feedId)]);
    }
    return false;
}

function getFeedPublicRssStaticXml(feedId, publicRssConfig = {}) {
    return Boolean(getFeedPublicRssConfig(feedId, publicRssConfig).staticXml);
}

function getGroupStaticState(feeds = [], publicRssConfig = {}) {
    const total = feeds.length;
    const enabledCount = feeds.reduce((count, feed) => {
        return count + (getFeedPublicRssStaticXml(feed.id, publicRssConfig) ? 1 : 0);
    }, 0);

    return {
        checked: total > 0 && enabledCount === total,
        indeterminate: enabledCount > 0 && enabledCount < total
    };
}

function buildUpdatedPublicRssConfig(feedId, updates, currentConfig = {}) {
    const normalizedFeedId = String(feedId);
    const currentEntry = getFeedPublicRssConfig(normalizedFeedId, currentConfig);
    const nextEntry = { ...currentEntry };

    if (Object.prototype.hasOwnProperty.call(updates, 'limit')) {
        nextEntry.limit = normalizePublicRssLimit(updates.limit);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'bilingual')) {
        nextEntry.bilingual = Boolean(updates.bilingual);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'staticXml')) {
        nextEntry.staticXml = Boolean(updates.staticXml);
    }

    return {
        ...currentConfig,
        feeds: {
            ...(currentConfig.feeds || {}),
            [normalizedFeedId]: nextEntry
        }
    };
}

function buildMigratedPublicRssConfig(feeds, currentConfig, legacyFeedLimits, legacyBilingualMap) {
    let nextConfig = currentConfig;
    let changed = false;

    feeds.forEach(feed => {
        const feedId = String(feed.id);
        const currentEntry = getFeedPublicRssConfig(feedId, nextConfig);
        const hasLimit = currentEntry.limit != null;
        const hasBilingual = Object.prototype.hasOwnProperty.call(currentEntry, 'bilingual');

        if (!hasLimit && legacyFeedLimits[feedId] != null) {
            nextConfig = buildUpdatedPublicRssConfig(feedId, { limit: legacyFeedLimits[feedId] }, nextConfig);
            changed = true;
        }

        if (!hasBilingual && Object.prototype.hasOwnProperty.call(legacyBilingualMap, feedId)) {
            nextConfig = buildUpdatedPublicRssConfig(feedId, { bilingual: legacyBilingualMap[feedId] }, nextConfig);
            changed = true;
        }
    });

    return { config: nextConfig, changed };
}

function getFeatureLabel(featureKey) {
    return i18n.t(FEATURE_CONFIG[featureKey].labelKey);
}

function getPublicRssCheckboxItemStyle(enabled = true) {
    return `display: flex; align-items: center; gap: 5px; padding: 4px 7px; cursor: ${enabled ? 'pointer' : 'not-allowed'}; border-radius: calc(var(--radius) - 3px); font-size: 0.79em; overflow: hidden; opacity: ${enabled ? '1' : '0.55'};`;
}

function getActiveOptions(selectedOptions = {}, featureStates = {}) {
    return FEATURE_KEYS.reduce((acc, key) => {
        acc[key] = Boolean(selectedOptions[key] && featureStates[key]);
        return acc;
    }, createEmptyFeatureSelection());
}

function buildPublicRssUrl(feedId) {
    if (!feedId) return '';
    return new URL(`/rss/feed/${feedId}`, window.location.origin).toString();
}

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function getSelectedOptionLabel(options = {}, bilingual = false) {
    const labels = FEATURE_KEYS
        .filter(key => options[key])
        .map(key => getFeatureLabel(key));
    if (bilingual && (options.title || options.translation)) {
        labels.push(i18n.t('settings.public_rss_bilingual_mode'));
    }
    return labels.length > 0
        ? labels.join(' + ')
        : i18n.t('settings.public_rss_none_selected');
}

async function copyTextToClipboard(text) {
    if (!text) return false;

    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // fall back below
        }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    try {
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        document.body.removeChild(textarea);
    }
}

function downloadBlob(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
}

function buildPublicRssOpml(sections, publicRssConfig) {
    const bodyItems = sections.map(section => {
        const enabledFeeds = section.feeds.filter(feed => getFeedPublicRssStaticXml(feed.id, publicRssConfig));
        if (enabledFeeds.length === 0) {
            return '';
        }

        const feedOutlines = enabledFeeds.map(feed => {
            const title = escapeXml(feed.title || i18n.t('common.unnamed'));
            const xmlUrl = escapeXml(buildPublicRssUrl(feed.id));
            const htmlUrl = escapeXml(feed.site_url || feed.feed_url || buildPublicRssUrl(feed.id));
            return `    <outline type="rss" text="${title}" title="${title}" xmlUrl="${xmlUrl}" htmlUrl="${htmlUrl}" />`;
        }).join('\n');

        if (section.key === 'ungrouped') {
            return feedOutlines;
        }

        const sectionTitle = escapeXml(section.title || i18n.t('common.unnamed'));
        return [
            `    <outline text="${sectionTitle}" title="${sectionTitle}">`,
            feedOutlines,
            '    </outline>'
        ].join('\n');
    }).filter(Boolean).join('\n');

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<opml version="2.0">',
        '  <head>',
        `    <title>${escapeXml('TidyFlux Public RSS')}</title>`,
        `    <dateCreated>${escapeXml(new Date().toUTCString())}</dateCreated>`,
        '  </head>',
        '  <body>',
        bodyItems,
        '  </body>',
        '</opml>'
    ].join('\n');
}

function getCollapsedGroups() {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY_PUBLIC_RSS_COLLAPSED) || '[]');
        return Array.isArray(stored) ? stored.map(String) : [];
    } catch {
        return [];
    }
}

function saveCollapsedGroups(groupKeys) {
    try {
        localStorage.setItem(STORAGE_KEY_PUBLIC_RSS_COLLAPSED, JSON.stringify(groupKeys));
    } catch {
        // ignore
    }
}

function getOverrideData(prefKey) {
    const data = AppState.preferences?.[prefKey];
    return data && typeof data === 'object'
        ? data
        : { feeds: {}, groups: {} };
}

function isFeedSelectedForFeature(feed, featureKey) {
    const { overridePrefKey } = FEATURE_CONFIG[featureKey];
    const overrideData = getOverrideData(overridePrefKey);
    const feedOverride = overrideData.feeds?.[feed.id] || 'inherit';
    if (feedOverride === 'on') return true;
    if (feedOverride === 'off') return false;

    if (feed.group_id != null) {
        const groupOverride = overrideData.groups?.[feed.group_id] || 'inherit';
        if (groupOverride === 'on') return true;
        if (groupOverride === 'off') return false;
    }

    return false;
}

function buildInitialGlobalFeatureStates() {
    return FEATURE_KEYS.reduce((acc, key) => {
        acc[key] = Boolean(AppState.preferences?.[FEATURE_CONFIG[key].globalPrefKey]);
        return acc;
    }, createEmptyFeatureSelection());
}

function buildInitialFeedSelections(feeds) {
    return new Map(
        feeds.map(feed => {
            const selection = FEATURE_KEYS.reduce((acc, key) => {
                acc[key] = isFeedSelectedForFeature(feed, key);
                return acc;
            }, createEmptyFeatureSelection());
            return [String(feed.id), selection];
        })
    );
}

function buildGlobalFeatureControls(featureStates) {
    return FEATURE_KEYS.map(key => `
        <label class="public-rss-global-pill" style="${getPublicRssCheckboxItemStyle()}">
            <input
                type="checkbox"
                class="public-rss-global-toggle"
                data-public-rss-feature="${key}"
                ${featureStates[key] ? 'checked' : ''}
                style="${PUBLIC_RSS_CHECKBOX_INPUT_STYLE}"
            >
            <span style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-color);">
                ${getFeatureLabel(key)}
            </span>
        </label>
    `).join('');
}

function getGroupFeatureSelectionState(feeds, feedSelections, featureKey, featureStates, publicRssConfig) {
    const eligibleFeeds = feeds.filter(feed => {
        return Boolean(featureStates[featureKey] && getFeedPublicRssStaticXml(feed.id, publicRssConfig));
    });
    const checkedCount = eligibleFeeds.reduce((count, feed) => {
        const selectedOptions = feedSelections.get(String(feed.id)) || createEmptyFeatureSelection();
        return count + (selectedOptions[featureKey] ? 1 : 0);
    }, 0);

    return {
        checked: eligibleFeeds.length > 0 && checkedCount === eligibleFeeds.length,
        indeterminate: checkedCount > 0 && checkedCount < eligibleFeeds.length,
        disabled: eligibleFeeds.length === 0
    };
}

function isFeedEligibleForGroupBilingual(feedId, feedSelections, featureStates, publicRssConfig) {
    if (!getFeedPublicRssStaticXml(feedId, publicRssConfig)) {
        return false;
    }

    const selectedOptions = feedSelections.get(String(feedId)) || createEmptyFeatureSelection();
    const activeOptions = getActiveOptions(selectedOptions, featureStates);
    return Boolean(activeOptions.title || activeOptions.translation);
}

function getGroupBilingualSelectionState(feeds, feedSelections, featureStates, publicRssConfig) {
    const eligibleFeeds = feeds.filter(feed => {
        return isFeedEligibleForGroupBilingual(feed.id, feedSelections, featureStates, publicRssConfig);
    });
    const checkedCount = eligibleFeeds.reduce((count, feed) => {
        return count + (getFeedPublicRssBilingual(feed.id, publicRssConfig) ? 1 : 0);
    }, 0);

    return {
        checked: eligibleFeeds.length > 0 && checkedCount === eligibleFeeds.length,
        indeterminate: checkedCount > 0 && checkedCount < eligibleFeeds.length,
        disabled: eligibleFeeds.length === 0
    };
}

function buildGroupBulkOptionControls(section, feedSelections, featureStates, publicRssConfig) {
    const groupStaticState = getGroupStaticState(section.feeds, publicRssConfig);
    const featureControls = FEATURE_KEYS.map(key => {
        const state = getGroupFeatureSelectionState(section.feeds, feedSelections, key, featureStates, publicRssConfig);
        return `
            <label class="public-rss-group-option-pill" style="${getPublicRssCheckboxItemStyle(!state.disabled)}">
                <input
                    type="checkbox"
                    class="public-rss-group-option-input"
                    data-public-rss-group-key="${section.key}"
                    data-public-rss-group-option="${key}"
                    ${state.checked ? 'checked' : ''}
                    data-public-rss-group-indeterminate="${state.indeterminate ? 'true' : 'false'}"
                    ${state.disabled ? 'disabled' : ''}
                    style="${PUBLIC_RSS_CHECKBOX_INPUT_STYLE}"
                >
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${getFeatureLabel(key)}</span>
            </label>
        `;
    }).join('');

    const bilingualState = getGroupBilingualSelectionState(section.feeds, feedSelections, featureStates, publicRssConfig);
    const bilingualControl = `
        <label class="public-rss-group-option-pill" style="${getPublicRssCheckboxItemStyle(!bilingualState.disabled)}">
            <input
                type="checkbox"
                class="public-rss-group-option-input"
                data-public-rss-group-key="${section.key}"
                data-public-rss-group-option="bilingual"
                ${bilingualState.checked ? 'checked' : ''}
                data-public-rss-group-indeterminate="${bilingualState.indeterminate ? 'true' : 'false'}"
                ${bilingualState.disabled ? 'disabled' : ''}
                style="${PUBLIC_RSS_CHECKBOX_INPUT_STYLE}"
            >
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${i18n.t('settings.public_rss_bilingual_mode')}</span>
        </label>
    `;

    return `
        <div class="public-rss-group-bulk-row" style="display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 0 0 10px 0; border-top: 1px solid color-mix(in srgb, var(--border-color), transparent 45%); border-bottom: 1px solid color-mix(in srgb, var(--border-color), transparent 45%); margin-bottom: 4px;">
            <div style="min-width: 0;">
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                    <label class="public-rss-group-toggle-pill" style="${getPublicRssCheckboxItemStyle()} flex: 0 0 auto;">
                        <input
                            type="checkbox"
                            class="public-rss-group-static-input"
                            data-public-rss-group-key="${section.key}"
                            ${groupStaticState.checked ? 'checked' : ''}
                            data-public-rss-group-indeterminate="${groupStaticState.indeterminate ? 'true' : 'false'}"
                            style="${PUBLIC_RSS_CHECKBOX_INPUT_STYLE}"
                        >
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${i18n.t('settings.public_rss_group_enable_all')}</span>
                    </label>
                </div>
            </div>
            <div class="public-rss-actions" style="display: flex; gap: 8px 10px; flex-wrap: wrap; justify-content: flex-end; align-items: center;">
                ${featureControls}
                ${bilingualControl}
                <label aria-hidden="true" style="display: inline-flex; align-items: center; gap: 8px; padding-left: 2px; font-size: 0.82em; color: transparent; white-space: nowrap; visibility: hidden; pointer-events: none;">
                    <span>${i18n.t('settings.public_rss_limit')}</span>
                    <span class="auth-input" style="width: 84px; min-width: 84px; margin: 0; padding: 8px 10px; font-size: 0.9em; display: inline-flex; align-items: center;">00</span>
                </label>
                <button
                    type="button"
                    aria-hidden="true"
                    tabindex="-1"
                    class="appearance-mode-btn active"
                    style="flex: 0 0 auto; padding: 8px 12px; font-size: 0.86em; justify-content: center; white-space: nowrap; visibility: hidden; pointer-events: none;"
                >
                    ${i18n.t('settings.copy_link')}
                </button>
            </div>
        </div>
    `;
}

function buildFeedRows(feeds, feedSelections, featureStates, publicRssConfig) {
    return feeds.map((feed, index) => {
        const selectedOptions = feedSelections.get(String(feed.id)) || createEmptyFeatureSelection();
        const activeOptions = getActiveOptions(selectedOptions, featureStates);
        const feedLimit = getFeedPublicRssLimit(feed.id, publicRssConfig);
        const bilingual = getFeedPublicRssBilingual(feed.id, publicRssConfig);
        const staticXml = getFeedPublicRssStaticXml(feed.id, publicRssConfig);
        const currentUrl = buildPublicRssUrl(feed.id);

        const optionPills = FEATURE_KEYS.map(key => {
            const checked = Boolean(selectedOptions[key]);
            const enabled = Boolean(featureStates[key] && staticXml);
            return `
                <label class="public-rss-option-pill" style="${getPublicRssCheckboxItemStyle(enabled)}">
                    <input
                        type="checkbox"
                        class="public-rss-option-input"
                        data-public-rss-feed-id="${feed.id}"
                        data-public-rss-option="${key}"
                        ${checked ? 'checked' : ''}
                        ${enabled ? '' : 'disabled'}
                        style="${PUBLIC_RSS_CHECKBOX_INPUT_STYLE}"
                    >
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${getFeatureLabel(key)}</span>
                </label>
            `;
        }).join('');

        return `
            <div class="public-rss-feed-row" data-public-rss-feed-row="${feed.id}" style="display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 0; ${index > 0 ? 'border-top: 1px solid color-mix(in srgb, var(--border-color), transparent 45%);' : ''}">
                <div style="min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                        <label class="public-rss-static-pill" style="${getPublicRssCheckboxItemStyle()} flex: 0 0 auto;">
                            <input
                                type="checkbox"
                                class="public-rss-static-input"
                                data-public-rss-feed-id="${feed.id}"
                                ${staticXml ? 'checked' : ''}
                                style="${PUBLIC_RSS_CHECKBOX_INPUT_STYLE}"
                            >
                            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${i18n.t('settings.public_rss_static_xml')}</span>
                        </label>
                        <div style="min-width: 0; font-size: 0.92em; font-weight: 600; color: var(--text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${escapeHtml(feed.title || i18n.t('common.unnamed'))}
                        </div>
                    </div>
                </div>
                <div class="public-rss-actions" style="display: flex; gap: 8px 10px; flex-wrap: wrap; justify-content: flex-end; align-items: center;">
                    ${optionPills}
                    <label class="public-rss-bilingual-pill" style="${getPublicRssCheckboxItemStyle(staticXml && (activeOptions.title || activeOptions.translation))}">
                        <input
                            type="checkbox"
                            class="public-rss-bilingual-input"
                            data-public-rss-feed-id="${feed.id}"
                            ${bilingual ? 'checked' : ''}
                            ${(staticXml && (activeOptions.title || activeOptions.translation)) ? '' : 'disabled'}
                            style="${PUBLIC_RSS_CHECKBOX_INPUT_STYLE}"
                        >
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${i18n.t('settings.public_rss_bilingual_mode')}</span>
                    </label>
                    <label class="public-rss-limit-control" style="display: inline-flex; align-items: center; gap: 8px; padding-left: 2px; font-size: 0.82em; color: var(--meta-color); white-space: nowrap; opacity: ${staticXml ? '1' : '0.55'}; cursor: ${staticXml ? 'default' : 'not-allowed'};">
                        <span>${i18n.t('settings.public_rss_limit')}</span>
                        <input
                            type="number"
                            class="auth-input public-rss-limit-input"
                            data-public-rss-feed-id="${feed.id}"
                            min="${MIN_PUBLIC_RSS_LIMIT}"
                            max="${MAX_PUBLIC_RSS_LIMIT}"
                            step="1"
                            value="${feedLimit}"
                            ${staticXml ? '' : 'disabled'}
                            style="width: 84px; min-width: 84px; margin: 0; padding: 8px 10px; font-size: 0.9em;"
                        >
                    </label>
                    <button
                        type="button"
                        class="public-rss-copy-btn appearance-mode-btn active"
                        data-public-rss-feed-id="${feed.id}"
                        data-public-rss-url="${escapeHtml(currentUrl)}"
                        ${currentUrl ? '' : 'disabled'}
                        style="flex: 0 0 auto; padding: 8px 12px; font-size: 0.86em; justify-content: center; cursor: ${currentUrl ? 'pointer' : 'not-allowed'}; white-space: nowrap; opacity: ${currentUrl ? '1' : '0.55'};"
                    >
                        ${i18n.t('settings.copy_link')}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function groupFeeds(feeds, groups) {
    const grouped = new Map();
    groups.forEach(group => grouped.set(String(group.id), { group, feeds: [] }));

    const ungrouped = [];
    feeds.forEach(feed => {
        const key = feed.group_id != null ? String(feed.group_id) : '';
        if (key && grouped.has(key)) {
            grouped.get(key).feeds.push(feed);
        } else {
            ungrouped.push(feed);
        }
    });

    const sections = [];
    groups.forEach(group => {
        const entry = grouped.get(String(group.id));
        if (entry && entry.feeds.length > 0) {
            sections.push({
                key: String(group.id),
                title: group.name,
                feeds: entry.feeds.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
            });
        }
    });

    if (ungrouped.length > 0) {
        sections.push({
            key: 'ungrouped',
            title: i18n.t('settings.public_rss_ungrouped'),
            feeds: ungrouped.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
        });
    }

    return sections;
}

function buildGroupedFeedSections(sections, collapsedGroups, feedSelections, featureStates, publicRssConfig) {
    if (!sections || sections.length === 0) {
        return `<div style="padding: 16px; text-align: center; color: var(--meta-color);">${i18n.t('settings.public_rss_no_feeds')}</div>`;
    }

    return sections.map(section => {
        const isCollapsed = collapsedGroups.includes(section.key);
        return `
            <section class="public-rss-group-card" data-public-rss-group-key="${section.key}" data-collapsed="${isCollapsed ? 'true' : 'false'}" style="margin-bottom: 10px; border-radius: 12px; background: var(--card-bg); box-shadow: var(--card-shadow); backdrop-filter: blur(var(--glass-blur)); -webkit-backdrop-filter: blur(var(--glass-blur)); overflow: hidden;">
                <div style="display: flex; align-items: center; gap: 8px; padding: 10px 12px;">
                    <button type="button" class="public-rss-group-header" style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0; background: transparent; border: none; color: var(--text-color); cursor: pointer; text-align: left;">
                        <span class="public-rss-group-chevron" style="display: inline-flex; align-items: center; color: var(--meta-color); transition: transform 0.2s; transform: ${isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};">
                            ${Icons.chevron_down}
                        </span>
                        <span style="min-width: 0; font-size: 0.94em; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${escapeHtml(section.title || i18n.t('common.unnamed'))}
                        </span>
                    </button>
                    <span style="font-size: 0.76em; color: var(--meta-color); background: color-mix(in srgb, var(--bg-color), #fff 20%); padding: 2px 8px; border-radius: 999px;">
                        ${section.feeds.length}
                    </span>
                </div>
                <div class="public-rss-group-body" style="display: ${isCollapsed ? 'none' : 'block'}; padding: 0 12px 8px 12px;">
                    <div style="display: flex; flex-direction: column;">
                        ${buildGroupBulkOptionControls(section, feedSelections, featureStates, publicRssConfig)}
                        ${buildFeedRows(section.feeds, feedSelections, featureStates, publicRssConfig)}
                    </div>
                </div>
            </section>
        `;
    }).join('');
}

export const PublicRssDialogMixin = {
    async showPublicRssManagerDialog() {
        AIService._translationOM.load();
        AIService._summaryOM.load();
        AIService._translateOM.load();

        const feeds = [...(AppState.feeds || [])];
        const groups = [...(AppState.groups || [])];
        const groupedSections = groupFeeds(feeds, groups);
        const sectionFeedMap = new Map(groupedSections.map(section => [section.key, section.feeds]));
        const feedGroupKeyMap = new Map(
            groupedSections.flatMap(section => section.feeds.map(feed => [String(feed.id), section.key]))
        );
        const collapsedGroups = getCollapsedGroups();
        const legacyFeedLimits = getLegacyStoredPublicRssLimits();
        const legacyBilingualMap = getLegacyStoredPublicRssBilingualMap();
        let publicRssConfig = getPublicRssConfig();
        const featureStates = buildInitialGlobalFeatureStates();
        const feedSelections = buildInitialFeedSelections(feeds);

        const savePublicRssConfig = async (nextConfig) => {
            const ok = await FeedManager.setPreference(PUBLIC_RSS_CONFIG_PREF_KEY, nextConfig);
            if (!ok) return false;

            if (!AppState.preferences) {
                AppState.preferences = {};
            }
            AppState.preferences[PUBLIC_RSS_CONFIG_PREF_KEY] = nextConfig;
            return true;
        };

        const triggerWarmupForFeeds = (feedIds = []) => {
            const normalizedFeedIds = [...new Set(
                (feedIds || [])
                    .map(feedId => String(feedId))
                    .filter(Boolean)
            )];
            if (normalizedFeedIds.length === 0) return;

            FeedManager.warmupAIPretranslate(normalizedFeedIds).catch(error => {
                console.warn('[Public RSS] Failed to queue AI warmup:', error);
            });
        };

        const getWarmupEligibleFeedIds = (feedIds = []) => {
            return [...new Set(
                (feedIds || [])
                    .map(feedId => String(feedId))
                    .filter(feedId => {
                        if (!getFeedPublicRssStaticXml(feedId, publicRssConfig)) return false;
                        return hasSelectedOptions(getActiveOptions(getStoredOptions(feedId), featureStates));
                    })
            )];
        };

        const migratedConfig = buildMigratedPublicRssConfig(
            feeds,
            publicRssConfig,
            legacyFeedLimits,
            legacyBilingualMap
        );
        if (migratedConfig.changed) {
            const migrated = await savePublicRssConfig(migratedConfig.config);
            if (migrated) {
                publicRssConfig = migratedConfig.config;
                clearLegacyStoredPublicRssSettings();
            } else {
                showToast(i18n.t('auth.config_save_failed'), 2000, false);
            }
        }

        const { dialog } = createDialog('settings-dialog', `
            <style>
                .public-rss-dialog-shell,
                .public-rss-dialog-shell * {
                    box-sizing: border-box;
                }

                .public-rss-dialog-shell {
                    width: min(1180px, calc(100vw - 32px)) !important;
                    max-width: min(1180px, calc(100vw - 32px)) !important;
                    height: min(80vh, 920px) !important;
                    max-height: min(80vh, 920px) !important;
                    display: flex;
                    flex-direction: column;
                }

                .public-rss-dialog-shell button,
                .public-rss-dialog-shell input {
                    font: inherit;
                    color: inherit;
                }

                .public-rss-dialog-shell button {
                    appearance: none;
                    -webkit-appearance: none;
                }

                @media (max-width: 800px) {
                    .public-rss-dialog-shell {
                        height: 70vh !important;
                        max-height: 70vh !important;
                    }
                }

                .public-rss-global-grid {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 1px;
                    padding: 4px;
                    border-radius: var(--radius);
                    background: var(--card-bg);
                    box-shadow: var(--card-shadow);
                    backdrop-filter: blur(var(--glass-blur));
                    -webkit-backdrop-filter: blur(var(--glass-blur));
                }

                @media (max-width: 900px) {
                    .public-rss-global-grid {
                        grid-template-columns: 1fr;
                    }
                }

                @media (max-width: 640px) {
                    .public-rss-dialog-shell {
                        width: calc(100vw - 20px) !important;
                        max-width: calc(100vw - 20px) !important;
                    }

                    .public-rss-dialog-shell .public-rss-feed-row {
                        grid-template-columns: 1fr !important;
                    }

                    .public-rss-dialog-shell .public-rss-group-bulk-row {
                        grid-template-columns: 1fr !important;
                    }

                    .public-rss-dialog-shell .public-rss-actions {
                        justify-content: flex-start !important;
                    }
                }
            </style>

            <div class="settings-dialog-content public-rss-dialog-shell" style="position: relative; width: min(1180px, calc(100vw - 32px)); max-width: min(1180px, calc(100vw - 32px)); height: min(80vh, 920px); max-height: min(80vh, 920px); display: flex; flex-direction: column; overflow: hidden; padding: 0;">
                <button class="icon-btn close-dialog-btn" title="${i18n.t('common.close')}" style="position: absolute; right: 16px; top: 16px; width: 30px; height: 30px; z-index: 10;">
                    ${Icons.close}
                </button>

                <div style="padding: 18px 20px 14px 20px; border-bottom: 1px solid color-mix(in srgb, var(--border-color), transparent 30%);">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-right: 36px;">
                        <div style="min-width: 0; font-size: 1.08em; font-weight: 700; color: var(--title-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${i18n.t('settings.public_rss_manager')}
                        </div>
                        <button
                            type="button"
                            id="public-rss-export-btn"
                            class="appearance-mode-btn"
                            style="flex: 0 0 auto; padding: 7px 12px; font-size: 0.84em; white-space: nowrap;"
                        >
                            ${i18n.t('settings.public_rss_export_enabled_opml')}
                        </button>
                    </div>
                </div>

                <div style="flex: 1; min-height: 0; overflow: hidden; padding: 14px 20px 18px 20px; display: flex; flex-direction: column; gap: 10px;">
                    <div style="border-radius: 12px; background: var(--card-bg); box-shadow: var(--card-shadow); backdrop-filter: blur(var(--glass-blur)); -webkit-backdrop-filter: blur(var(--glass-blur)); padding: 12px;">
                        <div style="font-size: 0.77em; color: var(--meta-color); line-height: 1.5;">
                            ${i18n.t('settings.public_rss_sync_hint')}
                        </div>

                        <div class="public-rss-global-grid" style="margin-top: 10px;">
                            ${buildGlobalFeatureControls(featureStates)}
                        </div>
                    </div>

                    <div style="font-size: 0.77em; color: var(--meta-color); line-height: 1.5;">
                        ${i18n.t('settings.public_rss_panel_hint')}
                    </div>

                    <div id="public-rss-feed-list" style="flex: 1; min-height: 0; overflow-y: auto; padding-right: 2px;">
                        ${buildGroupedFeedSections(groupedSections, collapsedGroups, feedSelections, featureStates, publicRssConfig)}
                    </div>
                </div>
            </div>
        `);

        const globalToggles = dialog.querySelectorAll('.public-rss-global-toggle');
        const optionInputs = dialog.querySelectorAll('.public-rss-option-input');
        const bilingualInputs = dialog.querySelectorAll('.public-rss-bilingual-input');
        const staticInputs = dialog.querySelectorAll('.public-rss-static-input');
        const groupStaticInputs = dialog.querySelectorAll('.public-rss-group-static-input');
        const groupOptionInputs = dialog.querySelectorAll('.public-rss-group-option-input');
        const limitInputs = dialog.querySelectorAll('.public-rss-limit-input');
        const copyButtons = dialog.querySelectorAll('.public-rss-copy-btn');
        const groupHeaders = dialog.querySelectorAll('.public-rss-group-header');
        const exportButton = dialog.querySelector('#public-rss-export-btn');
        let pendingSaveCount = 0;

        const updateGlobalToggleVisual = (toggle) => {
            const pill = toggle.closest('.public-rss-global-pill');
            if (!pill) return;
            pill.style.opacity = '1';
            pill.style.cursor = 'pointer';
        };

        const updateGroupOptionInputState = (input, groupFeeds) => {
            const optionKey = input.dataset.publicRssGroupOption;
            if (!optionKey) return;

            const state = optionKey === 'bilingual'
                ? getGroupBilingualSelectionState(groupFeeds, feedSelections, featureStates, publicRssConfig)
                : getGroupFeatureSelectionState(groupFeeds, feedSelections, optionKey, featureStates, publicRssConfig);
            const pill = input.closest('.public-rss-group-option-pill');

            input.checked = state.checked;
            input.indeterminate = state.indeterminate;
            input.disabled = state.disabled;
            input.dataset.publicRssGroupIndeterminate = state.indeterminate ? 'true' : 'false';

            if (pill) {
                pill.style.opacity = state.disabled ? '0.55' : '1';
                pill.style.cursor = state.disabled ? 'not-allowed' : 'pointer';
            }
            input.style.cursor = state.disabled ? 'not-allowed' : 'pointer';
        };

        const updateExportButtonState = () => {
            if (!exportButton) return;
            const enabledCount = feeds.filter(feed => getFeedPublicRssStaticXml(feed.id, publicRssConfig)).length;
            const canExport = enabledCount > 0 && pendingSaveCount === 0;
            exportButton.disabled = !canExport;
            exportButton.style.opacity = canExport ? '1' : '0.55';
            exportButton.style.cursor = canExport ? 'pointer' : 'not-allowed';
        };

        const withPendingSave = async (work) => {
            pendingSaveCount += 1;
            feeds.forEach(feed => updateFeedRowState(String(feed.id)));
            updateExportButtonState();
            try {
                return await work();
            } finally {
                pendingSaveCount = Math.max(0, pendingSaveCount - 1);
                feeds.forEach(feed => updateFeedRowState(String(feed.id)));
                updateExportButtonState();
            }
        };

        const updateOptionInputVisual = (input) => {
            const optionKey = input.dataset.publicRssOption;
            const feedId = String(input.dataset.publicRssFeedId || '');
            const staticEnabled = getFeedPublicRssStaticXml(feedId, publicRssConfig);
            const enabled = Boolean(featureStates[optionKey] && staticEnabled);
            const pill = input.closest('.public-rss-option-pill');
            if (!pill) return;
            input.disabled = !enabled;
            pill.style.opacity = enabled ? '1' : '0.55';
            pill.style.cursor = enabled ? 'pointer' : 'not-allowed';
            input.style.cursor = enabled ? 'pointer' : 'not-allowed';
        };

        const updateBilingualInputVisual = (input, hasTranslationOption, staticEnabled) => {
            const pill = input.closest('.public-rss-bilingual-pill');
            if (!pill) return;
            const enabled = Boolean(staticEnabled && hasTranslationOption);
            pill.style.opacity = enabled ? '1' : '0.55';
            pill.style.cursor = enabled ? 'pointer' : 'not-allowed';
            input.style.cursor = enabled ? 'pointer' : 'not-allowed';
        };

        const updateLimitInputVisual = (input, staticEnabled) => {
            const control = input.closest('.public-rss-limit-control');
            if (control) {
                control.style.opacity = staticEnabled ? '1' : '0.55';
                control.style.cursor = staticEnabled ? 'default' : 'not-allowed';
            }
            input.disabled = !staticEnabled;
            input.style.cursor = staticEnabled ? 'text' : 'not-allowed';
        };

        const getStoredOptions = (feedId) => {
            return feedSelections.get(String(feedId)) || createEmptyFeatureSelection();
        };

        const getActiveOptionsForFeed = (feedId) => {
            return getActiveOptions(getStoredOptions(feedId), featureStates);
        };

        const updateGroupToggleState = (groupKey) => {
            const groupFeeds = sectionFeedMap.get(String(groupKey)) || [];
            const staticInput = Array.from(groupStaticInputs).find(item => item.dataset.publicRssGroupKey === String(groupKey));
            if (staticInput) {
                const state = getGroupStaticState(groupFeeds, publicRssConfig);
                staticInput.checked = state.checked;
                staticInput.indeterminate = state.indeterminate;
                staticInput.dataset.publicRssGroupIndeterminate = state.indeterminate ? 'true' : 'false';
            }

            Array.from(groupOptionInputs)
                .filter(item => item.dataset.publicRssGroupKey === String(groupKey))
                .forEach(input => updateGroupOptionInputState(input, groupFeeds));
        };

        const updateFeedRowState = (feedId) => {
            const row = dialog.querySelector(`[data-public-rss-feed-row="${feedId}"]`);
            if (!row) return;

            const activeOptions = getActiveOptionsForFeed(feedId);
            const currentLimit = getFeedPublicRssLimit(feedId, publicRssConfig);
            const bilingual = getFeedPublicRssBilingual(feedId, publicRssConfig);
            const staticXml = getFeedPublicRssStaticXml(feedId, publicRssConfig);
            const copyBtn = row.querySelector('.public-rss-copy-btn');
            const limitInput = row.querySelector('.public-rss-limit-input');
            const bilingualInput = row.querySelector('.public-rss-bilingual-input');
            const staticInput = row.querySelector('.public-rss-static-input');
            const hasTranslationOption = Boolean(activeOptions.title || activeOptions.translation);
            const rowOptionInputs = row.querySelectorAll('.public-rss-option-input');
            const url = buildPublicRssUrl(feedId);

            if (limitInput) {
                limitInput.value = String(currentLimit);
                updateLimitInputVisual(limitInput, staticXml);
            }

            if (bilingualInput) {
                bilingualInput.checked = bilingual;
                bilingualInput.disabled = !(staticXml && hasTranslationOption);
                updateBilingualInputVisual(bilingualInput, hasTranslationOption, staticXml);
            }

            if (staticInput) {
                staticInput.checked = staticXml;
            }

            rowOptionInputs.forEach(input => {
                const optionKey = input.dataset.publicRssOption;
                if (optionKey) {
                    input.checked = Boolean(getStoredOptions(feedId)[optionKey]);
                }
                updateOptionInputVisual(input);
            });

            if (copyBtn) {
                copyBtn.dataset.publicRssUrl = url;
                const canCopy = Boolean(url) && staticXml && pendingSaveCount === 0;
                copyBtn.disabled = !canCopy;
                copyBtn.style.opacity = canCopy ? '1' : '0.55';
                copyBtn.style.cursor = canCopy ? 'pointer' : 'not-allowed';
            }

            const groupKey = feedGroupKeyMap.get(String(feedId));
            if (groupKey != null) {
                updateGroupToggleState(groupKey);
            }
        };

        const refreshAllOptionAvailability = () => {
            globalToggles.forEach(updateGlobalToggleVisual);
            optionInputs.forEach(updateOptionInputVisual);
            feeds.forEach(feed => updateFeedRowState(String(feed.id)));
            groupedSections.forEach(section => updateGroupToggleState(section.key));
            updateExportButtonState();
        };

        limitInputs.forEach(input => {
            const commitLimit = async () => {
                const feedId = String(input.dataset.publicRssFeedId || '');
                if (!feedId) return;
                const previousConfig = publicRssConfig;
                const normalizedLimit = normalizePublicRssLimit(input.value);
                const currentLimit = getFeedPublicRssLimit(feedId, publicRssConfig);

                input.value = String(normalizedLimit);
                if (normalizedLimit === currentLimit) {
                    updateFeedRowState(feedId);
                    return;
                }

                const nextConfig = buildUpdatedPublicRssConfig(feedId, { limit: normalizedLimit }, publicRssConfig);
                publicRssConfig = nextConfig;
                updateFeedRowState(feedId);

                const saved = await withPendingSave(() => savePublicRssConfig(nextConfig));
                if (!saved) {
                    publicRssConfig = previousConfig;
                    updateFeedRowState(feedId);
                    showToast(i18n.t('auth.config_save_failed'), 2000, false);
                    return;
                }
                triggerWarmupForFeeds(getWarmupEligibleFeedIds([feedId]));
            };
            input.addEventListener('change', commitLimit);
            input.addEventListener('blur', commitLimit);
        });

        bilingualInputs.forEach(input => {
            const commitBilingual = async () => {
                const feedId = String(input.dataset.publicRssFeedId || '');
                if (!feedId) return;
                const rowOptions = getActiveOptionsForFeed(feedId);
                const previousConfig = publicRssConfig;
                if (!(rowOptions.title || rowOptions.translation)) {
                    input.checked = false;
                    const nextConfig = buildUpdatedPublicRssConfig(feedId, { bilingual: false }, publicRssConfig);
                    publicRssConfig = nextConfig;
                    updateFeedRowState(feedId);
                    const saved = await withPendingSave(() => savePublicRssConfig(nextConfig));
                    if (!saved) {
                        publicRssConfig = previousConfig;
                        updateFeedRowState(feedId);
                        showToast(i18n.t('auth.config_save_failed'), 2000, false);
                    }
                    return;
                }
                const nextConfig = buildUpdatedPublicRssConfig(feedId, { bilingual: input.checked }, publicRssConfig);
                publicRssConfig = nextConfig;
                updateFeedRowState(feedId);
                const saved = await withPendingSave(() => savePublicRssConfig(nextConfig));
                if (!saved) {
                    publicRssConfig = previousConfig;
                    updateFeedRowState(feedId);
                    showToast(i18n.t('auth.config_save_failed'), 2000, false);
                }
            };
            input.addEventListener('change', commitBilingual);
        });

        staticInputs.forEach(input => {
            input.addEventListener('change', async () => {
                const feedId = String(input.dataset.publicRssFeedId || '');
                if (!feedId) return;

                const previousConfig = publicRssConfig;
                const nextConfig = buildUpdatedPublicRssConfig(feedId, { staticXml: input.checked }, publicRssConfig);
                publicRssConfig = nextConfig;
                updateFeedRowState(feedId);

                const saved = await withPendingSave(() => savePublicRssConfig(nextConfig));
                if (!saved) {
                    publicRssConfig = previousConfig;
                    updateFeedRowState(feedId);
                    showToast(i18n.t('auth.config_save_failed'), 2000, false);
                    return;
                }
                if (input.checked) {
                    triggerWarmupForFeeds(getWarmupEligibleFeedIds([feedId]));
                }
            });
        });

        groupStaticInputs.forEach(input => {
            input.indeterminate = input.dataset.publicRssGroupIndeterminate === 'true';
            input.addEventListener('change', async () => {
                const groupKey = String(input.dataset.publicRssGroupKey || '');
                const groupFeeds = sectionFeedMap.get(groupKey) || [];
                if (groupFeeds.length === 0) return;

                const previousConfig = publicRssConfig;
                let nextConfig = publicRssConfig;
                groupFeeds.forEach(feed => {
                    nextConfig = buildUpdatedPublicRssConfig(feed.id, { staticXml: input.checked }, nextConfig);
                });

                publicRssConfig = nextConfig;
                groupFeeds.forEach(feed => updateFeedRowState(String(feed.id)));
                updateGroupToggleState(groupKey);

                const saved = await withPendingSave(() => savePublicRssConfig(nextConfig));
                if (!saved) {
                    publicRssConfig = previousConfig;
                    groupFeeds.forEach(feed => updateFeedRowState(String(feed.id)));
                    updateGroupToggleState(groupKey);
                    showToast(i18n.t('auth.config_save_failed'), 2000, false);
                    return;
                }
                if (input.checked) {
                    triggerWarmupForFeeds(getWarmupEligibleFeedIds(groupFeeds.map(feed => feed.id)));
                }
            });
        });

        const saveGlobalFeatureToggle = async (featureKey, enabled) => {
            const { globalPrefKey } = FEATURE_CONFIG[featureKey];
            const ok = await FeedManager.setPreference(globalPrefKey, enabled);
            if (!ok) return false;

            if (!AppState.preferences) {
                AppState.preferences = {};
            }
            AppState.preferences[globalPrefKey] = enabled;
            return true;
        };

        const saveFeedFeatureSelection = async (feedId, featureKey, enabled) => {
            const { overridePrefKey, reloadManager } = FEATURE_CONFIG[featureKey];
            const current = getOverrideData(overridePrefKey);
            const next = {
                feeds: { ...(current.feeds || {}) },
                groups: { ...(current.groups || {}) }
            };
            next.feeds[feedId] = enabled ? 'on' : 'off';

            const ok = await FeedManager.setPreference(overridePrefKey, next);
            if (!ok) return false;

            if (!AppState.preferences) {
                AppState.preferences = {};
            }
            AppState.preferences[overridePrefKey] = next;
            reloadManager();
            return true;
        };

        const saveGroupFeatureSelection = async (groupFeeds, featureKey, enabled) => {
            const { overridePrefKey, reloadManager } = FEATURE_CONFIG[featureKey];
            const current = getOverrideData(overridePrefKey);
            const next = {
                feeds: { ...(current.feeds || {}) },
                groups: { ...(current.groups || {}) }
            };

            groupFeeds.forEach(feed => {
                next.feeds[String(feed.id)] = enabled ? 'on' : 'off';
            });

            const ok = await FeedManager.setPreference(overridePrefKey, next);
            if (!ok) return false;

            if (!AppState.preferences) {
                AppState.preferences = {};
            }
            AppState.preferences[overridePrefKey] = next;
            reloadManager();
            return true;
        };

        globalToggles.forEach(toggle => {
            updateGlobalToggleVisual(toggle);
            toggle.addEventListener('change', async () => {
                const feature = toggle.dataset.publicRssFeature;
                if (!feature) return;

                const previous = featureStates[feature];
                featureStates[feature] = toggle.checked;
                refreshAllOptionAvailability();

                const saved = await withPendingSave(() => saveGlobalFeatureToggle(feature, toggle.checked));
                if (!saved) {
                    featureStates[feature] = previous;
                    toggle.checked = previous;
                    refreshAllOptionAvailability();
                    showToast(i18n.t('auth.config_save_failed'), 2000, false);
                    return;
                }
                if (toggle.checked) {
                    const candidateFeedIds = feeds
                        .filter(feed => getStoredOptions(feed.id)[feature])
                        .map(feed => feed.id);
                    triggerWarmupForFeeds(getWarmupEligibleFeedIds(candidateFeedIds));
                }
            });
        });

        optionInputs.forEach(input => {
            updateOptionInputVisual(input);
            input.addEventListener('change', async () => {
                const feedId = String(input.dataset.publicRssFeedId || '');
                const feature = input.dataset.publicRssOption;
                if (!feedId || !feature) return;

                const previous = { ...getStoredOptions(feedId) };
                const next = { ...previous, [feature]: input.checked };
                feedSelections.set(feedId, next);
                updateOptionInputVisual(input);
                updateFeedRowState(feedId);

                const saved = await withPendingSave(() => saveFeedFeatureSelection(feedId, feature, input.checked));
                if (!saved) {
                    feedSelections.set(feedId, previous);
                    input.checked = previous[feature];
                    updateOptionInputVisual(input);
                    updateFeedRowState(feedId);
                    showToast(i18n.t('auth.config_save_failed'), 2000, false);
                    return;
                }
                if (input.checked) {
                    triggerWarmupForFeeds(getWarmupEligibleFeedIds([feedId]));
                }
            });
        });

        groupOptionInputs.forEach(input => {
            input.indeterminate = input.dataset.publicRssGroupIndeterminate === 'true';
            input.addEventListener('change', async () => {
                const groupKey = String(input.dataset.publicRssGroupKey || '');
                const optionKey = input.dataset.publicRssGroupOption;
                const groupFeeds = sectionFeedMap.get(groupKey) || [];
                if (!optionKey || groupFeeds.length === 0) return;

                if (optionKey === 'bilingual') {
                    const eligibleFeeds = groupFeeds.filter(feed => {
                        return isFeedEligibleForGroupBilingual(feed.id, feedSelections, featureStates, publicRssConfig);
                    });
                    if (eligibleFeeds.length === 0) {
                        updateGroupToggleState(groupKey);
                        return;
                    }

                    const previousConfig = publicRssConfig;
                    let nextConfig = publicRssConfig;
                    eligibleFeeds.forEach(feed => {
                        nextConfig = buildUpdatedPublicRssConfig(feed.id, { bilingual: input.checked }, nextConfig);
                    });

                    publicRssConfig = nextConfig;
                    eligibleFeeds.forEach(feed => updateFeedRowState(String(feed.id)));
                    updateGroupToggleState(groupKey);

                    const saved = await withPendingSave(() => savePublicRssConfig(nextConfig));
                    if (!saved) {
                        publicRssConfig = previousConfig;
                        eligibleFeeds.forEach(feed => updateFeedRowState(String(feed.id)));
                        updateGroupToggleState(groupKey);
                        showToast(i18n.t('auth.config_save_failed'), 2000, false);
                        return;
                    }
                    if (input.checked) {
                        triggerWarmupForFeeds(getWarmupEligibleFeedIds(eligibleFeeds.map(feed => feed.id)));
                    }
                    return;
                }

                const eligibleFeeds = groupFeeds.filter(feed => {
                    return Boolean(featureStates[optionKey] && getFeedPublicRssStaticXml(feed.id, publicRssConfig));
                });
                if (eligibleFeeds.length === 0) {
                    updateGroupToggleState(groupKey);
                    return;
                }
                const nextChecked = input.checked;

                const previousSelections = new Map(
                    eligibleFeeds.map(feed => {
                        const feedId = String(feed.id);
                        return [feedId, { ...getStoredOptions(feedId) }];
                    })
                );

                eligibleFeeds.forEach(feed => {
                    const feedId = String(feed.id);
                    const nextSelection = { ...getStoredOptions(feedId), [optionKey]: nextChecked };
                    feedSelections.set(feedId, nextSelection);
                });
                eligibleFeeds.forEach(feed => {
                    const feedId = String(feed.id);
                    updateFeedRowState(feedId);
                });
                updateGroupToggleState(groupKey);

                const saved = await withPendingSave(() => saveGroupFeatureSelection(eligibleFeeds, optionKey, nextChecked));
                if (!saved) {
                    previousSelections.forEach((selection, feedId) => {
                        feedSelections.set(feedId, selection);
                        updateFeedRowState(feedId);
                    });
                    updateGroupToggleState(groupKey);
                    showToast(i18n.t('auth.config_save_failed'), 2000, false);
                    return;
                }
                if (nextChecked) {
                    triggerWarmupForFeeds(getWarmupEligibleFeedIds(eligibleFeeds.map(feed => feed.id)));
                }
            });
        });

        copyButtons.forEach(btn => {
            btn.addEventListener('click', async () => {
                const url = btn.dataset.publicRssUrl || '';
                if (!url) return;

                const copied = await copyTextToClipboard(url);
                showToast(
                    copied ? i18n.t('settings.public_rss_copy_success') : i18n.t('settings.public_rss_copy_failed'),
                    2000,
                    false
                );
            });
        });

        if (exportButton) {
            exportButton.addEventListener('click', () => {
                const enabledSections = groupedSections
                    .map(section => ({
                        ...section,
                        feeds: section.feeds.filter(feed => getFeedPublicRssStaticXml(feed.id, publicRssConfig))
                    }))
                    .filter(section => section.feeds.length > 0);

                if (enabledSections.length === 0) {
                    showToast(i18n.t('settings.public_rss_export_empty'), 2000, false);
                    return;
                }

                const opml = buildPublicRssOpml(enabledSections, publicRssConfig);
                const blob = new Blob([opml], { type: 'text/xml;charset=utf-8' });
                downloadBlob(blob, 'tidyflux-public-rss.opml');
            });
        }

        groupHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const groupEl = header.closest('[data-public-rss-group-key]');
                if (!groupEl) return;
                const groupKey = String(groupEl.dataset.publicRssGroupKey || '');
                const bodyEl = groupEl.querySelector('.public-rss-group-body');
                const chevronEl = groupEl.querySelector('.public-rss-group-chevron');
                const collapsed = groupEl.dataset.collapsed !== 'true';
                groupEl.dataset.collapsed = collapsed ? 'true' : 'false';
                if (bodyEl) bodyEl.style.display = collapsed ? 'none' : 'block';
                if (chevronEl) chevronEl.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
                const nextGroups = new Set(getCollapsedGroups());
                if (collapsed) nextGroups.add(groupKey);
                else nextGroups.delete(groupKey);
                saveCollapsedGroups([...nextGroups]);
            });
        });

        refreshAllOptionAvailability();
    }
};
