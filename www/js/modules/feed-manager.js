/**
 * Feed Manager Module
 * @module feed-manager
 */

import { AuthManager } from './auth-manager.js';
import { i18n } from './i18n.js';
import { getTodayStartISO } from './view/utils.js';

export const FeedManager = {
    async getFeeds() {
        const response = await AuthManager.fetchWithAuth('/api/feeds');

        if (!response.ok) {
            // fetchWithAuth handles 401/403
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || i18n.t('feed.fetch_feeds_failed'));
        }

        return response.json();
    },

    async addFeed(url, groupId = null) {
        const body = { url };
        if (groupId) body.group_id = groupId;

        const response = await AuthManager.fetchWithAuth('/api/feeds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || i18n.t('feed.add_feed_failed'));
        }

        return data;
    },

    async discoverFeeds(url) {
        const response = await AuthManager.fetchWithAuth('/api/feeds/discover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || i18n.t('feed.discover_failed'));
        }

        return data;
    },

    async getFeed(feedId) {
        const response = await AuthManager.fetchWithAuth(`/api/feeds/${feedId}`);

        if (!response.ok) {
            throw new Error(i18n.t('feed.fetch_feeds_failed'));
        }

        return response.json();
    },

    async updateFeed(feedId, updates) {
        const response = await AuthManager.fetchWithAuth(`/api/feeds/${feedId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || i18n.t('feed.update_feed_failed'));
        }

        return data;
    },

    async deleteFeed(feedId) {
        const response = await AuthManager.fetchWithAuth(`/api/feeds/${feedId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error(i18n.t('feed.delete_feed_failed'));
        }

        return true;
    },

    async refreshFeeds() {
        const response = await AuthManager.fetchWithAuth('/api/feeds/refresh', {
            method: 'POST'
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || i18n.t('feed.refresh_failed'));
        }

        return data;
    },

    async refreshFeed(feedId) {
        const response = await AuthManager.fetchWithAuth(`/api/feeds/refresh/${feedId}`, {
            method: 'POST'
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || i18n.t('feed.refresh_feed_failed'));
        }

        return data;
    },

    async refreshGroup(groupId) {
        const response = await AuthManager.fetchWithAuth(`/api/feeds/refresh-group/${groupId}`, {
            method: 'POST'
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || i18n.t('feed.refresh_group_failed'));
        }

        return data;
    },

    async getArticles({ page = 1, feedId = null, groupId = null, unreadOnly = true, readOnly = false, favorites = false, cursor = null, afterPublishedAt = null } = {}) {
        const params = new URLSearchParams({
            page: String(page),
            limit: '50',
            unread_only: String(readOnly ? false : unreadOnly)
        });

        if (readOnly) {
            params.append('read_only', 'true');
        }

        // 使用游标分页
        if (cursor?.publishedAt && cursor?.id) {
            params.append(cursor.isAfter ? 'after_published_at' : 'before_published_at', cursor.publishedAt);
            params.append(cursor.isAfter ? 'after_id' : 'before_id', cursor.id);
        }

        // 今天模式：过滤发布时间
        if (afterPublishedAt) {
            params.append('after_published_at', afterPublishedAt);
        }

        if (favorites) {
            params.append('favorites', 'true');
        } else if (feedId) {
            params.append('feed_id', feedId);
        } else if (groupId) {
            params.append('group_id', groupId);
        }

        const response = await AuthManager.fetchWithAuth(`/api/articles?${params.toString()}`);

        if (!response.ok) {
            throw new Error(i18n.t('feed.fetch_articles_failed'));
        }

        return response.json();
    },

    async getArticle(articleId) {
        const response = await AuthManager.fetchWithAuth(`/api/articles/${articleId}`);

        if (!response.ok) {
            throw new Error(i18n.t('feed.fetch_articles_failed'));
        }

        return response.json();
    },

    async fetchEntryContent(articleId) {
        const response = await AuthManager.fetchWithAuth(`/api/articles/${articleId}/fetch-content`, {
            method: 'PUT'
        });

        if (!response.ok) {
            throw new Error(i18n.t('feed.fetch_content_failed'));
        }

        return response.json();
    },

    async saveToThirdParty(articleId) {
        const response = await AuthManager.fetchWithAuth(`/api/articles/${articleId}/save`, {
            method: 'POST'
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || i18n.t('article.save_failed'));
        }

        return data;
    },

    async getIntegrationsStatus() {
        const response = await AuthManager.fetchWithAuth('/api/articles/integrations/status');

        if (!response.ok) {
            throw new Error(i18n.t('article.integrations_check_failed'));
        }

        return response.json();
    },

    async markAsRead(articleId) {
        const response = await AuthManager.fetchWithAuth(`/api/articles/${articleId}/read`, {
            method: 'POST'
        });

        if (!response.ok) {
            console.error('Mark as read failed');
        }

        return response.ok;
    },

    /**
     * Batch mark multiple articles as read (single API call)
     * Falls back to individual calls if batch API fails
     */
    async markAsReadBatch(articleIds) {
        if (!articleIds || articleIds.length === 0) return true;

        // If only one, use single API
        if (articleIds.length === 1) {
            return this.markAsRead(articleIds[0]);
        }

        // Try batch API first
        try {
            const response = await AuthManager.fetchWithAuth('/api/articles/batch-read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: articleIds })
            });

            if (response.ok) {
                return true;
            }

            // If batch API doesn't exist (404), fall back to parallel calls with limit
            if (response.status === 404) {
                const BATCH_SIZE = 10;
                for (let i = 0; i < articleIds.length; i += BATCH_SIZE) {
                    const batch = articleIds.slice(i, i + BATCH_SIZE);
                    await Promise.all(batch.map(id => this.markAsRead(id)));
                }
                return true;
            }

            return false;
        } catch (err) {
            console.error('Batch mark as read failed:', err);
            return false;
        }
    },

    async markAllAsRead(feedId = null, groupId = null, afterPublishedAt = null) {
        const body = {};
        if (feedId) body.feed_id = feedId;
        if (groupId) body.group_id = groupId;
        if (afterPublishedAt) body.after_published_at = afterPublishedAt;

        const response = await AuthManager.fetchWithAuth('/api/articles/mark-all-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(i18n.t('feed.mark_all_read_failed'));
        }

        return true;
    },

    async markAsUnread(articleId) {
        const response = await AuthManager.fetchWithAuth(`/api/articles/${articleId}/read`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            console.error('Mark as unread failed');
            throw new Error(i18n.t('feed.mark_unread_failed'));
        }

        return true;
    },

    async favoriteArticle(articleId) {
        const response = await AuthManager.fetchWithAuth(`/api/articles/${articleId}/favorite`, {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error(i18n.t('feed.favorite_failed'));
        }

        return true;
    },

    async unfavoriteArticle(articleId) {
        const response = await AuthManager.fetchWithAuth(`/api/articles/${articleId}/favorite`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error(i18n.t('feed.unfavorite_failed'));
        }

        return true;
    },

    // Group management
    async getGroups() {
        const response = await AuthManager.fetchWithAuth('/api/groups');

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || i18n.t('feed.fetch_groups_failed'));
        }

        return response.json();
    },

    async addGroup(name) {
        const response = await AuthManager.fetchWithAuth('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || i18n.t('feed.create_group_failed'));
        }

        return data;
    },

    async updateGroup(groupId, updates) {
        const response = await AuthManager.fetchWithAuth(`/api/groups/${groupId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });

        if (!response.ok) {
            throw new Error(i18n.t('feed.update_group_failed'));
        }

        return response.json();
    },

    async deleteGroup(groupId) {
        const response = await AuthManager.fetchWithAuth(`/api/groups/${groupId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error(i18n.t('feed.delete_group_failed'));
        }

        return true;
    },

    async updateFeedGroup(feedId, groupId) {
        const response = await AuthManager.fetchWithAuth(`/api/feeds/${feedId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group_id: groupId })
        });

        if (!response.ok) {
            throw new Error(i18n.t('feed.update_feed_failed'));
        }

        return response.json();
    },

    async importOpml(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const xmlContent = e.target.result;
                    const response = await AuthManager.fetchWithAuth('/api/feeds/opml/import', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/xml'
                        },
                        body: xmlContent
                    });

                    const data = await response.json();
                    if (!response.ok) {
                        throw new Error(data.error || i18n.t('feed.import_failed'));
                    }
                    resolve(data);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(new Error(i18n.t('feed.read_file_failed')));
            reader.readAsText(file);
        });
    },

    async exportOpml() {
        const response = await AuthManager.fetchWithAuth('/api/feeds/opml/export');

        if (!response.ok) {
            throw new Error(i18n.t('feed.export_failed'));
        }

        return response.blob();
    },

    // Preferences
    async getPreferences() {
        const response = await AuthManager.fetchWithAuth('/api/preferences');

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || i18n.t('feed.fetch_preferences_failed'));
        }

        return response.json();
    },

    async setPreference(key, value) {
        const response = await AuthManager.fetchWithAuth('/api/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value })
        });

        if (!response.ok) {
            console.error('Save preference failed');
        }

        return response.ok;
    },

    /**
     * 获取今日未读文章数量（轻量级请求）
     */
    async getTodayUnreadCount() {
        const params = new URLSearchParams({
            page: '1',
            limit: '1',
            unread_only: 'true',
            after_published_at: getTodayStartISO()
        });

        const response = await AuthManager.fetchWithAuth(`/api/articles?${params.toString()}`);
        if (!response.ok) return 0;

        const data = await response.json();
        return data.pagination?.total || 0;
    },

    // Search articles
    async searchArticles(query, page = 1) {
        const params = new URLSearchParams({
            page: String(page),
            limit: '50',
            search: query
        });

        const response = await AuthManager.fetchWithAuth(`/api/articles?${params.toString()}`);

        if (!response.ok) {
            throw new Error(i18n.t('feed.search_failed'));
        }

        return response.json();
    },

    // Get digests list
    async getDigests(options = {}) {
        const params = new URLSearchParams();
        if (options.scope) params.append('scope', options.scope);
        if (options.scopeId) params.append('scopeId', options.scopeId);
        if (options.unreadOnly) params.append('unreadOnly', 'true');

        const response = await AuthManager.fetchWithAuth(`/api/digest/list?${params.toString()}`);

        if (!response.ok) {
            throw new Error(i18n.t('digest.fetch_digests_failed'));
        }

        return response.json();
    },

    // Get single digest
    async getDigest(digestId) {
        const response = await AuthManager.fetchWithAuth(`/api/digest/${digestId}`);

        if (!response.ok) {
            throw new Error(i18n.t('digest.fetch_digest_failed'));
        }

        return response.json();
    },

    // Mark digest as read
    async markDigestAsRead(digestId) {
        const response = await AuthManager.fetchWithAuth(`/api/digest/${digestId}/read`, {
            method: 'POST'
        });

        return response.ok;
    },

    // Mark digest as unread
    async markDigestAsUnread(digestId) {
        const response = await AuthManager.fetchWithAuth(`/api/digest/${digestId}/read`, {
            method: 'DELETE'
        });

        return response.ok;
    },

    // Delete digest
    async deleteDigest(digestId) {
        const response = await AuthManager.fetchWithAuth(`/api/digest/${digestId}`, {
            method: 'DELETE'
        });

        return response.ok;
    },

};
