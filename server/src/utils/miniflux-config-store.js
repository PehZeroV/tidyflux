/**
 * Miniflux 配置存储模块
 * 支持环境变量配置或手动配置
 * 密码使用 AES-256-GCM 加密存储
 */
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { encrypt, decrypt } from './encryption.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const CONFIG_FILE = path.join(DATA_DIR, 'miniflux-config.json');

// 认证类型常量
const AUTH_TYPE_API_KEY = 'api_key';
const AUTH_TYPE_BASIC = 'basic';

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * 异步加载配置
 */
async function loadConfig() {
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf8');
        const config = JSON.parse(data);

        // 解密密码
        if (config.encryptedPassword) {
            config.password = decrypt(config.encryptedPassword);
            delete config.encryptedPassword;
        }

        // 解密 API Key
        if (config.encryptedApiKey) {
            config.apiKey = decrypt(config.encryptedApiKey);
            delete config.encryptedApiKey;
        }

        return config;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error loading miniflux config:', error);
        }
    }
    return null;
}

/**
 * 异步保存配置
 */
async function saveConfig(url, username, password, apiKey = null, authType = AUTH_TYPE_BASIC) {
    try {
        const config = {
            url,
            username,
            encryptedPassword: password ? encrypt(password) : null,
            encryptedApiKey: apiKey ? encrypt(apiKey) : null,
            authType: authType || AUTH_TYPE_BASIC,
            updated_at: new Date().toISOString()
        };
        await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error saving miniflux config:', error);
        return false;
    }
}

export const MinifluxConfigStore = {
    /**
     * 检查是否已通过环境变量配置 (同步函数，因为 process.env 在内存中)
     */
    isEnvConfigured() {
        const hasUrl = !!process.env.MINIFLUX_URL;
        const hasApiKey = !!process.env.MINIFLUX_API_KEY;
        const hasBasic = !!(process.env.MINIFLUX_USERNAME && process.env.MINIFLUX_PASSWORD);
        return hasUrl && (hasApiKey || hasBasic);
    },

    /**
     * 异步检查是否已手动配置
     */
    async isManualConfigured() {
        const config = await loadConfig();
        if (!config?.url) return false;

        if (config.authType === AUTH_TYPE_API_KEY) {
            return !!config.apiKey;
        }

        return !!(config.username && config.password);
    },

    /**
     * 异步获取有效的 Miniflux 配置
     */
    async getConfig() {
        // 优先使用环境变量
        if (this.isEnvConfigured()) {
            if (process.env.MINIFLUX_API_KEY) {
                return {
                    url: process.env.MINIFLUX_URL,
                    apiKey: process.env.MINIFLUX_API_KEY,
                    authType: AUTH_TYPE_API_KEY,
                    source: 'env'
                };
            }
            return {
                url: process.env.MINIFLUX_URL,
                username: process.env.MINIFLUX_USERNAME,
                password: process.env.MINIFLUX_PASSWORD,
                authType: AUTH_TYPE_BASIC,
                source: 'env'
            };
        }

        // 其次使用手动配置
        const config = await loadConfig();
        if (config?.url) {
            if (config.authType === AUTH_TYPE_API_KEY && config.apiKey) {
                return {
                    url: config.url,
                    apiKey: config.apiKey,
                    authType: AUTH_TYPE_API_KEY,
                    source: 'manual'
                };
            } else if (config.username && config.password) {
                return {
                    url: config.url,
                    username: config.username,
                    password: config.password,
                    authType: AUTH_TYPE_BASIC,
                    source: 'manual'
                };
            }
        }

        return null;
    },

    /**
     * 异步获取安全的配置信息
     */
    async getSafeConfig() {
        const config = await this.getConfig();
        if (config) {
            return {
                configured: true,
                url: config.url,
                username: config.username,
                authType: config.authType,
                apiKey: config.authType === AUTH_TYPE_API_KEY ? '********' : null,
                source: config.source
            };
        }
        return {
            configured: false,
            url: null,
            username: null,
            authType: null,
            source: null
        };
    },

    /**
     * 异步保存手动配置
     */
    async saveManualConfig(url, username, password, apiKey, authType) {
        return await saveConfig(url, username, password, apiKey, authType);
    },

    /**
     * 异步清除手动配置
     */
    async clearManualConfig() {
        try {
            if (existsSync(CONFIG_FILE)) {
                await fs.unlink(CONFIG_FILE);
            }
            return true;
        } catch (error) {
            console.error('Error clearing miniflux config:', error);
            return false;
        }
    }
};
