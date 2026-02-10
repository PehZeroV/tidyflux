import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { sanitizeHtml } from '../utils.js';

const router = express.Router();

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
        res.status(500).json({ error: '获取订阅失败: ' + error.message });
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
        if (error.message.includes('404')) {
            return res.status(404).json({ error: '订阅不存在' });
        }
        res.status(500).json({ error: '获取订阅详情失败' });
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
        res.status(500).json({ error: '添加订阅失败: ' + error.message });
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
        res.status(500).json({ error: '更新订阅失败' });
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
        res.status(500).json({ error: '删除订阅失败' });
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
        res.status(500).json({ error: '刷新失败' });
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
            res.status(500).json({ error: '刷新分组失败' });
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
            res.status(500).json({ error: '刷新失败' });
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
        res.status(500).json({ error: '导出失败' });
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
        res.json({ success: true, message: '导入已排队处理' });
    } catch (error) {
        console.error('Import OPML error:', error);
        res.status(500).json({ error: '导入失败: ' + error.message });
    }
});

export default router;
