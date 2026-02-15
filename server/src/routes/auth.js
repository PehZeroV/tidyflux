import express from 'express';
import { generateToken, authenticateToken, clearMinifluxClientCache, getMinifluxClient } from '../middleware/auth.js';
import { UserStore } from '../utils/user-store.js';
import { MinifluxConfigStore } from '../utils/miniflux-config-store.js';
import { MinifluxClient } from '../miniflux.js';
import dns from 'dns';
import { promisify } from 'util';

const AUTH_TYPE_API_KEY = 'api_key';
const AUTH_TYPE_BASIC = 'basic';
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

function formatMinifluxTestError(err) {
    if (err.status === 401 || err.status === 403) {
        return '用户名或密码错误，请检查 Miniflux 登录信息';
    }
    const msg = err.message || '';
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('ENOTFOUND')) {
        return '无法连接到 Miniflux，请确认地址和端口正确（本机可试 http://127.0.0.1:8080）';
    }
    return '连接测试失败：' + (msg || '请检查 URL 和登录信息');
}
const router = express.Router();

// Login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: '请填写完整信息' });
        }

        // Validate against local UserStore
        const user = await UserStore.authenticate(username, password);

        if (!user) {
            return res.status(401).json({ error: '用户名或密码错误' });
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
        res.status(500).json({ error: '登录失败' });
    }
});

router.post('/register', (req, res) => {
    res.status(403).json({ error: 'Miniflux 模式不支持注册，请直接登录' });
});

// Change Password
router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        const { newPassword } = req.body;
        const username = req.user.username;

        await UserStore.changePassword(username, newPassword);
        res.json({ success: true, message: '密码修改成功' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: '密码修改失败' });
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
        const config = await MinifluxConfigStore.getConfig();
        if (!config) {
            return res.json({ connected: false, error: '未配置' });
        }

        try {
            await verifyMinifluxConnection(config.url, config.username, config.password, config.apiKey);
            res.json({ connected: true });
        } catch (err) {
            res.json({ connected: false, error: err.message });
        }
    } catch (error) {
        console.error('Status check failed:', error);
        res.status(500).json({ error: '状态检查失败' });
    }
});

// Save Miniflux manual config
// Save Miniflux manual config
router.post('/miniflux-config', authenticateToken, async (req, res) => {
    try {
        const { url, username, password, apiKey, authType } = req.body;

        if (!url) {
            return res.status(400).json({ error: '请填写 Miniflux URL' });
        }

        await validateMinifluxUrl(url).catch(err => {
            throw new Error(err.message);
        });

        if (authType === AUTH_TYPE_API_KEY) {
            if (!apiKey) throw new Error('请填写 API Key');
        } else {
            if (!username || !password) throw new Error('请填写用户名和密码');
        }

        // 测试连接
        try {
            await verifyMinifluxConnection(url, username, password, apiKey);
        } catch (testError) {
            console.error('Miniflux connection test failed:', testError);
            const msg = formatMinifluxTestError(testError);
            return res.status(400).json({ error: msg });
        }

        // 保存配置
        const success = await MinifluxConfigStore.saveManualConfig(url, username, password, apiKey, authType);
        if (!success) {
            return res.status(500).json({ error: '保存配置失败' });
        }

        // 清除客户端缓存，使用新配置
        clearMinifluxClientCache();

        res.json({
            success: true,
            message: '配置保存成功',
            config: await MinifluxConfigStore.getSafeConfig()
        });
    } catch (error) {
        if (error.message.startsWith('请填写') || error.message === 'Cannot resolve hostname' || error.message === 'Use http or https') {
            return res.status(400).json({ error: error.message });
        }
        console.error('Save miniflux config error:', error);
        res.status(500).json({ error: '保存配置失败' });
    }
});

// Test Miniflux connection (without saving)
router.post('/miniflux-test', authenticateToken, async (req, res) => {
    try {
        const { url, username, password, apiKey } = req.body;

        if (!url) {
            return res.status(400).json({ error: '请填写 Miniflux URL' });
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
                message: '连接测试成功',
                user: me.username
            });
        } catch (testError) {
            console.error('Miniflux connection test failed:', testError);
            const msg = formatMinifluxTestError(testError);
            res.status(400).json({ error: msg });
        }
    } catch (error) {
        console.error('Test miniflux config error:', error);
        res.status(500).json({ error: '测试失败' });
    }
});

// Clear manual config
router.delete('/miniflux-config', authenticateToken, async (req, res) => {
    try {
        // 不允许删除环境变量配置
        if (MinifluxConfigStore.isEnvConfigured()) {
            return res.status(400).json({ error: '环境变量配置无法通过界面删除' });
        }

        const success = await MinifluxConfigStore.clearManualConfig();
        if (!success) {
            return res.status(500).json({ error: '清除配置失败' });
        }

        clearMinifluxClientCache();
        res.json({ success: true, message: '配置已清除' });
    } catch (error) {
        console.error('Clear miniflux config error:', error);
        res.status(500).json({ error: '清除配置失败' });
    }
});

// Legacy env-config endpoint (for backwards compatibility)
router.get('/env-config', async (req, res) => {
    const safeConfig = await MinifluxConfigStore.getSafeConfig();
    res.json(safeConfig);
});

export default router;

