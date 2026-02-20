import jwt from 'jsonwebtoken';
import { MinifluxClient } from '../miniflux.js';
import { MinifluxConfigStore } from '../utils/miniflux-config-store.js';
import { t, getLang } from '../utils/i18n.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const JWT_SECRET_FILE = path.join(DATA_DIR, '.jwt-secret');
const TOKEN_EXPIRATION = process.env.TOKEN_EXPIRATION || '365d';

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 获取或生成持久化的 JWT_SECRET
function getJwtSecret() {
    // 优先使用环境变量
    if (process.env.JWT_SECRET) {
        return process.env.JWT_SECRET;
    }

    // 尝试从文件读取
    if (fs.existsSync(JWT_SECRET_FILE)) {
        return fs.readFileSync(JWT_SECRET_FILE, 'utf8').trim();
    }

    // 生成新的密钥并持久化
    const newSecret = crypto.randomBytes(64).toString('hex');
    try {
        fs.writeFileSync(JWT_SECRET_FILE, newSecret, { mode: 0o600 });
        console.log('Generated and persisted new JWT secret.');
    } catch (error) {
        console.error('Failed to persist JWT secret:', error);
        console.warn('WARNING: Using temporary JWT secret. Sessions will be invalidated on server restart.');
    }
    return newSecret;
}

const JWT_SECRET = getJwtSecret();

// 缓存 MinifluxClient 单例实例
let minifluxClientInstance = null;
let lastConfigHash = null;

function getConfigHash(config) {
    if (!config) return null;
    return `${config.url}:${config.username}:${config.password}:${config.apiKey}`;
}

/**
 * 异步获取 MinifluxClient
 */
export async function getMinifluxClient() {
    const config = await MinifluxConfigStore.getConfig();
    const currentHash = getConfigHash(config);

    // 如果配置变化了，需要重新创建实例
    if (currentHash !== lastConfigHash) {
        minifluxClientInstance = null;
        lastConfigHash = currentHash;
    }

    if (!minifluxClientInstance && config) {
        minifluxClientInstance = new MinifluxClient(
            config.url,
            config.username,
            config.password,
            config.apiKey
        );
    }
    return minifluxClientInstance;
}

// 清除缓存的客户端实例（配置更新时调用）
export function clearMinifluxClientCache() {
    minifluxClientInstance = null;
    lastConfigHash = null;
}

/**
 * 身份验证中间件
 */
export async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];

    if (!token) {
        const lang = getLang(req);
        return res.status(401).json({ error: t('not_logged_in', lang) });
    }

    try {
        const user = jwt.verify(token, JWT_SECRET);
        req.user = user;

        // 异步获取 MinifluxClient 并挂载到 request 对象
        req.miniflux = await getMinifluxClient();
        if (!req.miniflux) {
            console.warn('Miniflux service is not configured!');
        }

        next();
    } catch (err) {
        console.error('JWT verify error:', err.message);
        const lang = getLang(req);
        return res.status(403).json({ error: t('session_expired', lang) });
    }
}

/**
 * 生成 JWT Token
 */
export function generateToken(payload) {
    return jwt.sign(
        payload,
        JWT_SECRET,
        { expiresIn: TOKEN_EXPIRATION }
    );
}
