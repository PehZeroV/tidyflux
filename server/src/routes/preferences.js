import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { PreferenceStore } from '../utils/preference-store.js';

const router = express.Router();

// Helper to mask sensitive data (returns a new object, never mutates input)
const maskSensitiveData = (prefs) => {
    if (!prefs) return prefs;
    // Deep clone to avoid mutating cached objects
    const masked = JSON.parse(JSON.stringify(prefs));
    if (masked?.ai_config?.apiKey) {
        masked.ai_config.apiKey = '********';
    }
    return masked;
};

// Get all preferences
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        const prefs = await PreferenceStore.get(userId);
        res.json(maskSensitiveData(prefs));
    } catch (error) {
        console.error('Get preferences error:', error);
        res.status(500).json({ error: '获取偏好设置失败' });
    }
});

// Update preferences (merge with existing)
router.post('/', authenticateToken, async (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        const currentPrefs = await PreferenceStore.get(userId);

        let updates = req.body;

        // 处理 { key, value } 格式的请求
        if (updates.key !== undefined && updates.value !== undefined) {
            updates = { [updates.key]: updates.value };
        }

        // Special handling for ai_config updates to preserve API Key if masked
        if (updates.ai_config?.apiKey === '********') {
            if (currentPrefs.ai_config?.apiKey) {
                updates.ai_config.apiKey = currentPrefs.ai_config.apiKey;
            } else {
                delete updates.ai_config.apiKey;
            }
        }

        // 合并更新
        const newPrefs = { ...currentPrefs, ...updates };

        if (await PreferenceStore.save(userId, newPrefs)) {
            // Return masked key in response
            // Create a copy to mask without affecting what was just saved
            const responsePrefs = JSON.parse(JSON.stringify(newPrefs));
            res.json({ success: true, preferences: maskSensitiveData(responsePrefs) });
        } else {
            res.status(500).json({ error: '保存偏好设置失败' });
        }
    } catch (error) {
        console.error('Update preferences error:', error);
        res.status(500).json({ error: '更新偏好设置失败' });
    }
});
// Get server timezone info
router.get('/server-timezone', authenticateToken, (req, res) => {
    const envTZ = process.env.TZ || '';
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    res.json({ envTZ, systemTimezone });
});

export default router;

