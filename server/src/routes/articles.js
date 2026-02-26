import express from 'express';
import { authenticateToken, requireMinifluxConfigured } from '../middleware/auth.js';
import { extractThumbnailUrl, extractFirstImage, getThumbnailUrl } from '../utils.js';
import { t, getLang } from '../utils/i18n.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireMinifluxConfigured);

/**
 * Helper to map Miniflux entry to Tidyflux Article
 * Content is passed through without sanitization - RSS sources are trusted
 */
function mapEntryToArticle(entry, thumbnail) {
    return {
        id: entry.id,
        feed_id: entry.feed_id,
        title: entry.title || '',
        summary: '',
        content: entry.content || '', // No sanitization - display exactly as RSS provides
        url: entry.url,
        author: entry.author || '',
        published_at: entry.published_at,
        thumbnail_url: thumbnail,
        enclosures: entry.enclosures || [],
        feed_title: entry.feed?.title || '',
        is_read: entry.status === 'read' ? 1 : 0,
        is_favorited: entry.starred ? 1 : 0
    };
}

// Get articles
router.get('/', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            feed_id,
            group_id,
            unread_only,
            read_only,
            favorites,

            after_published_at,
            after_id,
            before_published_at,
            before_id,
            search
        } = req.query;

        let offset = (parseInt(page) - 1) * parseInt(limit);

        // If using cursor-based pagination, we reset offset
        // Cursor pagination is more stable for lists that change (e.g., marking as read)
        if (after_published_at || after_id || before_published_at || before_id) {
            offset = 0;
        }

        const params = {
            limit,
            offset,
            order: 'published_at',
            direction: 'desc'
        };

        if (feed_id) params.feed_id = feed_id;
        if (group_id) params.category_id = group_id;
        if (unread_only === '1' || unread_only === 'true') params.status = 'unread';
        if (read_only === '1' || read_only === 'true') {
            params.status = 'read';
            params.order = 'changed_at'; // 按阅读时间排序
        }
        if (favorites === '1' || favorites === 'true') params.starred = 'true';
        if (search) params.search = search;


        // Cursor for fetching newer items (after)
        if (after_published_at) {
            params.after = Math.floor(new Date(after_published_at).getTime() / 1000);
        }
        if (after_id) {
            params.after_entry_id = after_id;
        }

        // Composite cursor pagination: Miniflux's before + before_entry_id are independent AND conditions,
        // which skips same-second articles. We use before = time+1s and post-filter server-side.
        const useCompositeCursor = !!(before_published_at && before_id);
        let cursorTime, cursorId;

        if (useCompositeCursor) {
            cursorTime = new Date(before_published_at).getTime();
            cursorId = parseInt(before_id);
            params.before = Math.floor(cursorTime / 1000) + 1; // +1s: strict < becomes <=
        } else {
            if (before_published_at) {
                params.before = Math.floor(new Date(before_published_at).getTime() / 1000);
            }
            if (before_id) {
                params.before_entry_id = before_id;
            }
        }

        const parsedLimit = parseInt(limit);
        let entries = [];
        let totalFromMiniflux = 0;
        let filteredOutCount = 0;

        if (useCompositeCursor) {
            // Fetch in rounds with increasing offsets to handle many same-second articles
            let currentOffset = 0;
            const MAX_ROUNDS = 5;
            for (let round = 0; round < MAX_ROUNDS && entries.length < parsedLimit; round++) {
                const batchParams = { ...params, offset: currentOffset, limit: parsedLimit };
                const data = await req.miniflux.getEntries(batchParams);
                totalFromMiniflux = data.total;
                const batch = data.entries || [];

                for (const entry of batch) {
                    const entryTime = new Date(entry.published_at).getTime();
                    if (entryTime < cursorTime || (entryTime === cursorTime && entry.id < cursorId)) {
                        entries.push(entry);
                    } else {
                        filteredOutCount++;
                    }
                }

                if (batch.length < parsedLimit) break;
                currentOffset += parsedLimit;
            }
            entries = entries.slice(0, parsedLimit);
        } else {
            const entriesData = await req.miniflux.getEntries(params);
            entries = entriesData.entries || [];
            totalFromMiniflux = entriesData.total;
        }

        // Sort by published_at DESC, id DESC (stabilize same-second order)
        // 历史记录模式保留 Miniflux 返回的 changed_at 排序
        if (!(read_only === '1' || read_only === 'true')) {
            entries.sort((a, b) => {
                const timeA = new Date(a.published_at).getTime();
                const timeB = new Date(b.published_at).getTime();
                if (timeA !== timeB) return timeB - timeA;
                return b.id - a.id;
            });
        }

        const total = totalFromMiniflux - filteredOutCount;

        const entryUrls = new Map();
        const articles = entries.map(entry => {
            // Try to find a thumbnail from enclosures or content
            let thumbnail = null;
            let rawImageUrl = null;
            if (entry.enclosures && entry.enclosures.length > 0) {
                const image = entry.enclosures.find(e => e.mime_type && e.mime_type.startsWith('image/'));
                if (image) rawImageUrl = image.url;
            }
            if (!rawImageUrl) {
                rawImageUrl = extractFirstImage(entry.content, '');
            }

            if (rawImageUrl) {
                entryUrls.set(entry.id, rawImageUrl);
                thumbnail = getThumbnailUrl(rawImageUrl);
            }

            return mapEntryToArticle(entry, thumbnail);
        });

        // 异步预热缩略图缓存


        res.json({
            articles,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit)),
                hasMore: offset + articles.length < total
            }
        });
    } catch (error) {
        console.error('Get articles error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: error.message || t('fetch_articles_failed', lang) });
    }
});

// Get integrations status (must be before /:id to avoid route conflict)
router.get('/integrations/status', async (req, res) => {
    try {
        const status = await req.miniflux.getIntegrationsStatus();
        res.json(status); // { has_integrations: true/false }
    } catch (error) {
        console.error('Get integrations status error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('fetch_integrations_failed', lang) });
    }
});

// Get single article
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const entry = await req.miniflux.getEntry(id);

        // Determine thumbnail
        let thumbnail = null;
        if (entry.enclosures && entry.enclosures.length > 0) {
            const image = entry.enclosures.find(e => e.mime_type && e.mime_type.startsWith('image/'));
            if (image) thumbnail = image.url;
        }
        if (!thumbnail) {
            thumbnail = extractThumbnailUrl(entry.content, '');
        }

        res.json(mapEntryToArticle(entry, thumbnail));
    } catch (error) {
        console.error('Get article error:', error);
        const lang = getLang(req);
        if (error.message.includes('404')) {
            return res.status(404).json({ error: t('article_not_found', lang) });
        }
        res.status(500).json({ error: t('fetch_articles_failed', lang) });
    }
});

// Mark read
router.post('/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        await req.miniflux.updateEntriesStatus(parseInt(id), 'read');
        res.json({ success: true });
    } catch (error) {
        console.error('Mark read error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('mark_failed', lang) });
    }
});

// Mark unread
router.delete('/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        await req.miniflux.updateEntriesStatus(parseInt(id), 'unread');
        res.json({ success: true });
    } catch (error) {
        console.error('Mark unread error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('mark_failed', lang) });
    }
});

// Batch mark read (multiple articles in one request)
router.post('/batch-read', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Invalid ids array' });
        }

        // Miniflux supports batch update: PUT /v1/entries with { entry_ids: [...], status: 'read' }
        await req.miniflux.updateEntriesStatus(ids.map(id => parseInt(id)), 'read');
        res.json({ success: true, count: ids.length });
    } catch (error) {
        console.error('Batch mark read error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('batch_mark_failed', lang) });
    }
});

// Mark all read
router.post('/mark-all-read', async (req, res) => {
    try {
        const { feed_id, group_id, after_published_at } = req.body;

        if (after_published_at) {
            // "Today" mode: fetch all unread entries after timestamp and batch-mark as read
            const afterTs = Math.floor(new Date(after_published_at).getTime() / 1000);
            const BATCH_LIMIT = 100;
            let allEntryIds = [];
            let offset = 0;

            // Fetch all unread entry IDs in batches
            while (true) {
                const params = {
                    status: 'unread',
                    after: afterTs,
                    order: 'published_at',
                    direction: 'desc',
                    limit: BATCH_LIMIT,
                    offset
                };
                if (feed_id) params.feed_id = feed_id;
                if (group_id) params.category_id = group_id;

                const data = await req.miniflux.getEntries(params);
                const entries = data.entries || [];
                allEntryIds.push(...entries.map(e => e.id));

                if (entries.length < BATCH_LIMIT) break;
                offset += BATCH_LIMIT;
            }

            if (allEntryIds.length > 0) {
                await req.miniflux.updateEntriesStatus(allEntryIds, 'read');
            }
        } else if (feed_id) {
            await req.miniflux.markFeedAsRead(feed_id);
        } else if (group_id) {
            await req.miniflux.markCategoryAsRead(group_id);
        } else {
            // Mark all entries as read for the current user
            const me = await req.miniflux.me();
            await req.miniflux.markUserAsRead(me.id);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Mark all read error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('mark_failed', lang) });
    }
});

// Favorite
router.post('/:id/favorite', async (req, res) => {
    try {
        const { id } = req.params;
        await req.miniflux.toggleBookmark(id);
        res.json({ success: true });
    } catch (error) {
        console.error('Favorite error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('favorite_failed', lang) });
    }
});


router.delete('/:id/favorite', async (req, res) => {
    try {
        const { id } = req.params;
        // Miniflux's PUT /entries/:id only supports title/content, not starred.
        // Use toggleBookmark (PUT /entries/:id/bookmark) which is the correct API.
        await req.miniflux.toggleBookmark(id);
        res.json({ success: true });
    } catch (error) {
        console.error('Unfavorite error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('unfavorite_failed', lang) });
    }
});

// Fetch article content (Readability mode)
// PUT /api/articles/:id/fetch-content
// Note: We keep frontend interface as PUT as it modifies state, but backend calls Miniflux's GET endpoint
router.put('/:id/fetch-content', async (req, res) => {
    try {
        const { id } = req.params;
        // Run both requests in parallel
        const [contentData, entry] = await Promise.all([
            req.miniflux.fetchEntryContent(id),
            req.miniflux.getEntry(id)
        ]);

        // Override content with the fetched version
        if (contentData && contentData.content) {
            entry.content = contentData.content;
        }

        // Return the updated article after fetching content
        let thumbnail = null;
        if (entry.enclosures && entry.enclosures.length > 0) {
            const image = entry.enclosures.find(e => e.mime_type && e.mime_type.startsWith('image/'));
            if (image) thumbnail = image.url;
        }
        if (!thumbnail) {
            thumbnail = extractThumbnailUrl(entry.content, '');
        }

        res.json(mapEntryToArticle(entry, thumbnail));
    } catch (error) {
        console.error('Fetch content error:', error);
        console.error('Error details:', error.message);
        const lang = getLang(req);
        if (error.message.includes('404')) {
            console.error('Miniflux returned 404 for fetch-content. Endpoint might not exist or entry ID is wrong.');
            return res.status(404).json({ error: t('article_not_found', lang) });
        }
        res.status(500).json({ error: t('fetch_content_failed', lang) });
    }
});

// Save entry to third-party services
router.post('/:id/save', async (req, res) => {
    try {
        const { id } = req.params;
        await req.miniflux.saveEntry(id);
        res.json({ success: true });
    } catch (error) {
        console.error('Save entry error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('save_third_party_failed', lang) + ': ' + error.message });
    }
});



export default router;
