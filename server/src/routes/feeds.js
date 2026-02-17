import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { t, getLang } from '../utils/i18n.js';

const router = express.Router();

// Discover feeds from a website URL
router.post('/discover', authenticateToken, async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });

        const results = await req.miniflux.discover(url);
        res.json(results || []);
    } catch (error) {
        console.error('Discover feeds error:', error);
        // If Miniflux returns error (e.g. no feeds found), return empty array instead of 500
        if (error.status === 400 || error.status === 404) {
            return res.json([]);
        }
        const lang = getLang(req);
        res.status(500).json({ error: t('discover_failed', lang) + ': ' + error.message });
    }
});

// Get all feeds
router.get('/', authenticateToken, async (req, res) => {
    try {
        // Fetch feeds and counters in parallel
        const [feeds, counters] = await Promise.all([
            req.miniflux.getFeeds(),
            req.miniflux.getCounters()
        ]);

        // Build a map of feed_id -> unread_count from counters
        const unreadMap = counters?.unreads || {};

        // Map to frontend expectation
        const mappedFeeds = feeds.map(f => ({
            id: f.id,
            url: f.feed_url,
            site_url: f.site_url,
            title: f.title,
            description: '',
            group_id: f.category ? f.category.id : null,
            group_name: f.category ? f.category.title : null,
            created_at: '',
            unread_count: unreadMap[f.id] || 0
        }));

        res.json(mappedFeeds);
    } catch (error) {
        console.error('Get feeds error:', error.message);
        const lang = getLang(req);
        res.status(500).json({ error: t('fetch_feeds_failed', lang) + ': ' + error.message });
    }
});

// Get single feed
router.get('/:id(\\d+)', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const feed = await req.miniflux.getFeed(id);
        res.json(feed);
    } catch (error) {
        console.error('Get single feed error:', error.message);
        const lang = getLang(req);
        if (error.message.includes('404')) {
            return res.status(404).json({ error: t('feed_not_found', lang) });
        }
        res.status(500).json({ error: t('fetch_feed_detail_failed', lang) });
    }
});

// Add feed
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { url, group_id } = req.body;

        // Miniflux create feed
        // API wants { feed_url, category_id }
        const categoryId = group_id ? parseInt(group_id, 10) : undefined;
        const feedId = await req.miniflux.createFeed(url, categoryId);

        // Miniflux createFeed usually returns { feed_id: 123 }

        let id = feedId;
        if (typeof feedId === 'object' && feedId.feed_id) {
            id = feedId.feed_id;
        }

        // Fetch the new feed directly by ID (O(1) instead of O(N))
        let newFeed;
        try {
            newFeed = await req.miniflux.getFeed(id);
        } catch (e) {
            // Fallback if getFeed fails
            newFeed = null;
        }

        if (newFeed) {
            res.status(201).json({
                id: newFeed.id,
                url: newFeed.feed_url,
                site_url: newFeed.site_url,
                title: newFeed.title,
                group_id: newFeed.category ? newFeed.category.id : null
            });
        } else {
            // Fallback
            res.status(201).json({ id, url });
        }

    } catch (error) {
        console.error('Add feed error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('add_feed_failed', lang) + ': ' + error.message });
    }
});

// Update feed (move to group/category)
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { group_id, category_id, title, site_url, feed_url } = req.body;

        const data = {};
        const catId = category_id !== undefined ? category_id : group_id;
        if (catId !== undefined) {
            data.category_id = parseInt(catId, 10);
        }
        if (title) data.title = title;
        if (site_url) data.site_url = site_url;
        if (feed_url) data.feed_url = feed_url;


        const updated = await req.miniflux.updateFeed(id, data);
        res.json(updated);
    } catch (error) {
        console.error('Update feed error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('update_feed_failed', lang) });
    }
});

// Delete feed
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        await req.miniflux.deleteFeed(id);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete feed error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('delete_feed_failed', lang) });
    }
});

// Refresh feed
router.post('/refresh/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        await req.miniflux.refreshFeed(id);
        res.json({ success: true });
    } catch (error) {
        console.error('Refresh feed error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('refresh_failed', lang) });
    }
});

// Refresh Group - return immediately, process in background
router.post('/refresh-group/:groupId', authenticateToken, async (req, res) => {
    try {
        const { groupId } = req.params;
        const miniflux = req.miniflux;
        const feeds = await miniflux.getFeeds();
        const groupFeeds = feeds.filter(f => !f.disabled && f.category && f.category.id == groupId);

        // Return immediately, refresh in background
        res.json({ success: true, count: groupFeeds.length });

        // Fire-and-forget: refresh feeds in background
        const CONCURRENCY_LIMIT = 5;
        for (let i = 0; i < groupFeeds.length; i += CONCURRENCY_LIMIT) {
            const batch = groupFeeds.slice(i, i + CONCURRENCY_LIMIT);
            await Promise.all(batch.map(feed => miniflux.refreshFeed(feed.id).catch(() => { })));
        }
    } catch (error) {
        console.error('Refresh group error:', error);
        if (!res.headersSent) {
            const lang = getLang(req);
            res.status(500).json({ error: t('refresh_group_failed', lang) });
        }
    }
});

// Refresh All - return immediately, process in background
router.post('/refresh', authenticateToken, async (req, res) => {
    try {
        const miniflux = req.miniflux;
        const feeds = await miniflux.getFeeds();
        const activeFeeds = feeds.filter(f => !f.disabled);

        // Return immediately, refresh in background
        res.json({ success: true, count: activeFeeds.length });

        // Fire-and-forget: refresh feeds in background
        const CONCURRENCY_LIMIT = 5;
        for (let i = 0; i < activeFeeds.length; i += CONCURRENCY_LIMIT) {
            const batch = activeFeeds.slice(i, i + CONCURRENCY_LIMIT);
            await Promise.all(batch.map(feed => miniflux.refreshFeed(feed.id).catch(() => { })));
        }
    } catch (error) {
        console.error('Refresh all error:', error);
        if (!res.headersSent) {
            const lang = getLang(req);
            res.status(500).json({ error: t('refresh_failed', lang) });
        }
    }
});

// OPML Export
router.get('/opml/export', authenticateToken, async (req, res) => {
    try {
        const opmlContent = await req.miniflux.exportOPML();
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Disposition', 'attachment; filename="miniflux_export.opml"');
        res.send(opmlContent);
    } catch (error) {
        console.error('Export OPML error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('export_failed', lang) });
    }
});

// OPML Import
router.post('/opml/import', authenticateToken, express.raw({ type: ['application/xml', 'text/xml', 'multipart/form-data'], limit: '10mb' }), async (req, res) => {
    try {
        let opmlData = req.body;

        // If it's a buffer (from express.raw), convert to string
        if (Buffer.isBuffer(opmlData)) {
            opmlData = opmlData.toString('utf8');
        }



        await req.miniflux.importOPML(opmlData);
        const lang = getLang(req);
        res.json({ success: true, message: t('import_queued', lang) });
    } catch (error) {
        console.error('Import OPML error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('import_failed', lang) + ': ' + error.message });
    }
});

export default router;
