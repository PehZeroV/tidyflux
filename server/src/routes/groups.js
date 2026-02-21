import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { t, getLang } from '../utils/i18n.js';

const router = express.Router();

// Get all groups (Miniflux Categories)
router.get('/', authenticateToken, async (req, res) => {
    try {
        // Fetch both categories and feeds to calculate feed_count
        const [categories, feeds] = await Promise.all([
            req.miniflux.getCategories(),
            req.miniflux.getFeeds()
        ]);

        // Count feeds per category
        const feedCountByCategory = {};
        for (const feed of feeds) {
            const catId = feed.category?.id;
            if (catId) {
                feedCountByCategory[catId] = (feedCountByCategory[catId] || 0) + 1;
            }
        }

        // Map Miniflux categories to frontend groups
        const groups = categories.map(c => ({
            id: c.id,
            name: c.title,
            is_pinned: 0, // Not supported
            is_collapsed: 0, // Not supported
            feed_count: feedCountByCategory[c.id] || 0
        }));

        res.json(groups);
    } catch (error) {
        console.error('Get groups error:', error.message);
        const lang = getLang(req);
        res.status(500).json({ error: t('fetch_groups_failed', lang) + ': ' + error.message });
    }
});

// Create group
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { name } = req.body;
        const lang = getLang(req);
        if (!name) return res.status(400).json({ error: t('group_name_required', lang) });

        const category = await req.miniflux.createCategory(name);

        res.status(201).json({
            id: category.id,
            name: category.title
        });
    } catch (error) {
        console.error('Create group error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('create_group_failed', lang) });
    }
});

// Update group
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;

        if (name) {
            const category = await req.miniflux.updateCategory(id, name);
            res.json({
                id: category.id,
                name: category.title
            });
        } else {
            res.json({ id, name: '' });
        }
    } catch (error) {
        console.error('Update group error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('update_group_failed', lang) });
    }
});

// Delete group
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        await req.miniflux.deleteCategory(id);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete group error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('delete_group_failed', lang) });
    }
});

export default router;
