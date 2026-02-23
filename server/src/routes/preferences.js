import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { PreferenceStore } from '../utils/preference-store.js';
import { t, getLang } from '../utils/i18n.js';
import { AIPretranslateScheduler } from '../jobs/ai-pretranslate-scheduler.js';

// AI 相关的配置 key，变更时需要通知调度器重启
const AI_CONFIG_KEYS = new Set([
    'ai_config',
    'ai_pretranslate_title',
    'ai_pretranslate_translate',
    'ai_pretranslate_summary',
    'title_translation_overrides',
    'auto_translate_overrides',
    'auto_summary_overrides'
]);

const router = express.Router();

const maskSensitiveData = (prefs) => {
    if (!prefs) return prefs;
    const masked = JSON.parse(JSON.stringify(prefs));
    if (masked?.ai_config?.apiKey) {
        masked.ai_config.apiKey = '********';
    }
    return masked;
};

router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        const prefs = await PreferenceStore.get(userId);
        res.json(maskSensitiveData(prefs));
    } catch (error) {
        console.error('Get preferences error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('fetch_preferences_failed', lang) });
    }
});

router.post('/', authenticateToken, async (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        let updates = req.body;

        if (updates.key !== undefined && updates.value !== undefined) {
            updates = { [updates.key]: updates.value };
        }

        const { success, preferences: newPrefs } = await PreferenceStore.update(userId, updates);

        if (success) {
            // 检查是否涉及 AI 相关配置变更
            const changedKeys = Object.keys(updates);
            const aiChanged = changedKeys.some(k => AI_CONFIG_KEYS.has(k));
            if (aiChanged) {
                AIPretranslateScheduler.notifyConfigChanged();
            }

            res.json({ success: true, preferences: maskSensitiveData(newPrefs) });
        } else {
            const lang = getLang(req);
            res.status(500).json({ error: t('save_preferences_failed', lang) });
        }
    } catch (error) {
        console.error('Update preferences error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('update_preferences_failed', lang) });
    }
});

router.get('/server-timezone', authenticateToken, (req, res) => {
    const envTZ = process.env.TZ || '';
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    res.json({ envTZ, systemTimezone });
});

export default router;
