import express from 'express';
import { generateToken, authenticateToken, clearMinifluxClientCache } from '../middleware/auth.js';
import { UserStore } from '../utils/user-store.js';
import { MinifluxConfigStore } from '../utils/miniflux-config-store.js';
import { MinifluxClient } from '../miniflux.js';
import { t, getLang } from '../utils/i18n.js';
import dns from 'dns';
import { promisify } from 'util';

const AUTH_TYPE_API_KEY = 'api_key';
const ERR_CODE_ENOTFOUND = 'ENOTFOUND';

const dnsLookup = promisify(dns.lookup);

async function validateMinifluxUrl(urlString) {
    try {
        const url = new URL(urlString);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('Use http or https');
        }

        // Resolve hostname to IP
        const { address } = await dnsLookup(url.hostname);

        // Block Link-Local addresses (AWS/Cloud metadata)
        if (address.startsWith('169.254.')) {
            throw new Error('Access to Link-Local addresses is forbidden');
        }

        // Allow private IPs (10.x, 192.168.x, 127.x) for self-hosted usage

    } catch (error) {
        if (error.code === ERR_CODE_ENOTFOUND) {
            throw new Error('Cannot resolve hostname');
        }
        throw error;
    }
}

async function verifyMinifluxConnection(url, username, password, apiKey) {
    const testClient = new MinifluxClient(url, username, password, apiKey);
    return await testClient.request('/me');
}

function formatMinifluxTestError(err, lang) {
    if (err.status === 401 || err.status === 403) {
        return t('invalid_credentials_miniflux', lang);
    }
    const msg = err.message || '';
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('ENOTFOUND')) {
        return t('connection_failed', lang);
    }
    return t('connection_test_error', lang) + '：' + (msg || t('check_url_and_credentials', lang));
}
const router = express.Router();

// Login
router.post('/login', async (req, res) => {
    try {
        const lang = getLang(req);
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: t('fill_all_info', lang) });
        }

        // Validate against local UserStore
        const user = await UserStore.authenticate(username, password);

        if (!user) {
            return res.status(401).json({ error: t('invalid_credentials', lang) });
        }

        // Check if Miniflux is configured (env or manual)
        const safeConfig = await MinifluxConfigStore.getSafeConfig();

        const token = generateToken({
            id: user.username,
            username: user.username,
            type: 'local'
        });

        res.json({
            user: {
                id: user.username,
                username: user.username,
                email: '',
                minifluxConfigured: safeConfig.configured
            },
            token
        });
    } catch (error) {
        console.error('Login error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('login_failed', lang) });
    }
});

router.post('/register', (req, res) => {
    const lang = getLang(req);
    res.status(403).json({ error: t('register_not_supported', lang) });
});

// Change Password
router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        const lang = getLang(req);
        const { newPassword } = req.body;
        const username = req.user.username;

        if (typeof newPassword !== 'string' || newPassword.trim().length === 0) {
            return res.status(400).json({ error: t('fill_all_info', lang) });
        }

        await UserStore.changePassword(username, newPassword);
        res.json({ success: true, message: t('password_change_success', lang) });
    } catch (error) {
        console.error('Change password error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('password_change_failed', lang) });
    }
});

// Get Miniflux config (safe info only)
router.get('/miniflux-config', authenticateToken, async (req, res) => {
    const safeConfig = await MinifluxConfigStore.getSafeConfig();
    const envConfigured = MinifluxConfigStore.isEnvConfigured();

    res.json({
        ...safeConfig,
        envConfigured // 是否通过环境变量配置
    });
});

// Check connection status of current config
router.get('/miniflux-status', authenticateToken, async (req, res) => {
    try {
        const lang = getLang(req);
        const config = await MinifluxConfigStore.getConfig();
        if (!config) {
            return res.json({ connected: false, error: t('not_configured', lang) });
        }

        try {
            await verifyMinifluxConnection(config.url, config.username, config.password, config.apiKey);
            res.json({ connected: true });
        } catch (err) {
            res.json({ connected: false, error: err.message });
        }
    } catch (error) {
        console.error('Status check failed:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('status_check_failed', lang) });
    }
});

// Save Miniflux manual config
router.post('/miniflux-config', authenticateToken, async (req, res) => {
    try {
        const lang = getLang(req);
        const { url, username, password, apiKey, authType } = req.body;

        if (!url) {
            return res.status(400).json({ error: t('fill_miniflux_url', lang) });
        }

        await validateMinifluxUrl(url).catch(err => {
            throw new Error(err.message);
        });

        if (authType === AUTH_TYPE_API_KEY) {
            if (!apiKey) throw new Error(t('fill_api_key', lang));
        } else {
            if (!username || !password) throw new Error(t('fill_username_password', lang));
        }

        // 测试连接
        try {
            await verifyMinifluxConnection(url, username, password, apiKey);
        } catch (testError) {
            console.error('Miniflux connection test failed:', testError);
            const msg = formatMinifluxTestError(testError, lang);
            return res.status(400).json({ error: msg });
        }

        // 保存配置
        const success = await MinifluxConfigStore.saveManualConfig(url, username, password, apiKey, authType);
        if (!success) {
            return res.status(500).json({ error: t('config_save_failed', lang) });
        }

        // 清除客户端缓存，使用新配置
        clearMinifluxClientCache();

        res.json({
            success: true,
            message: t('config_save_success', lang),
            config: await MinifluxConfigStore.getSafeConfig()
        });
    } catch (error) {
        const lang = getLang(req);
        const validationErrors = [
            t('fill_miniflux_url', lang),
            t('fill_api_key', lang),
            t('fill_username_password', lang),
            'Cannot resolve hostname',
            'Use http or https'
        ];
        if (validationErrors.includes(error.message)) {
            return res.status(400).json({ error: error.message });
        }
        console.error('Save miniflux config error:', error);
        res.status(500).json({ error: t('config_save_failed', lang) });
    }
});

// Test Miniflux connection (without saving)
router.post('/miniflux-test', authenticateToken, async (req, res) => {
    try {
        const lang = getLang(req);
        const { url, username, password, apiKey } = req.body;

        if (!url) {
            return res.status(400).json({ error: t('fill_miniflux_url', lang) });
        }

        try {
            await validateMinifluxUrl(url);
        } catch (err) {
            return res.status(400).json({ error: err.message });
        }

        try {
            const me = await verifyMinifluxConnection(url, username, password, apiKey);
            res.json({
                success: true,
                message: t('connection_test_success', lang),
                user: me.username
            });
        } catch (testError) {
            console.error('Miniflux connection test failed:', testError);
            const msg = formatMinifluxTestError(testError, lang);
            res.status(400).json({ error: msg });
        }
    } catch (error) {
        console.error('Test miniflux config error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('test_failed', lang) });
    }
});

// Clear manual config
router.delete('/miniflux-config', authenticateToken, async (req, res) => {
    try {
        const lang = getLang(req);
        // 不允许删除环境变量配置
        if (MinifluxConfigStore.isEnvConfigured()) {
            return res.status(400).json({ error: t('env_config_cannot_delete', lang) });
        }

        const success = await MinifluxConfigStore.clearManualConfig();
        if (!success) {
            return res.status(500).json({ error: t('config_clear_failed', lang) });
        }

        clearMinifluxClientCache();
        res.json({ success: true, message: t('config_cleared', lang) });
    } catch (error) {
        console.error('Clear miniflux config error:', error);
        const lang = getLang(req);
        res.status(500).json({ error: t('config_clear_failed', lang) });
    }
});

// Legacy env-config endpoint (for backwards compatibility)
router.get('/env-config', async (req, res) => {
    const safeConfig = await MinifluxConfigStore.getSafeConfig();
    res.json(safeConfig);
});

export default router;
