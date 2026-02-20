import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pbkdf2 = promisify(crypto.pbkdf2);

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Security Constants
const PBKDF2_ITERATIONS = 1000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';
const DEFAULT_ADMIN = {
    username: 'admin',
    password: 'admin'
};

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
}

async function loadUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error loading users:', error);
        }
    }
    return {};
}

async function saveUsers(users) {
    try {
        const data = JSON.stringify(users, null, 2);
        await fs.writeFile(USERS_FILE, data, { encoding: 'utf8', mode: 0o600 });
        try {
            await fs.chmod(USERS_FILE, 0o600);
        } catch (e) {
            // Ignore chmod errors on unsupported systems
        }
        return true;
    } catch (error) {
        console.error('Error saving users:', error);
        return false;
    }
}

async function hashPassword(password, salt) {
    if (!salt) {
        salt = crypto.randomBytes(16).toString('hex');
    }
    const hashBuffer = await pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
    return { hash: hashBuffer.toString('hex'), salt };
}

async function verifyPassword(password, storedHash, salt) {
    const { hash } = await hashPassword(password, salt);
    return hash === storedHash;
}

export const UserStore = {
    async init() {
        const users = await loadUsers();

        if (existsSync(USERS_FILE)) {
            try { await fs.chmod(USERS_FILE, 0o600); } catch (e) { }
        }

        if (Object.keys(users).length === 0) {
            console.log('--------------------------------------------------');
            console.log('No users found. Creating default admin user.');
            console.log(`Username: ${DEFAULT_ADMIN.username}`);
            console.log(`Password: ${DEFAULT_ADMIN.password}`);
            console.log('--------------------------------------------------');
            await this.createUser(DEFAULT_ADMIN.username, DEFAULT_ADMIN.password);
        }
    },

    async createUser(username, password) {
        const users = await loadUsers();
        if (users[username]) {
            throw new Error('User already exists');
        }

        const { hash, salt } = await hashPassword(password);
        users[username] = {
            username,
            hash,
            salt,
            created_at: new Date().toISOString()
        };

        return await saveUsers(users);
    },

    async authenticate(username, password) {
        const users = await loadUsers();
        const user = users[username];

        if (!user) return null;

        const isValid = await verifyPassword(password, user.hash, user.salt);
        if (isValid) {
            const safeUser = { ...user };
            delete safeUser.hash;
            delete safeUser.salt;
            return safeUser;
        }

        return null;
    },

    async changePassword(username, newPassword) {
        const users = await loadUsers();
        if (!users[username]) {
            throw new Error('User not found');
        }

        const { hash, salt } = await hashPassword(newPassword);
        users[username].hash = hash;
        users[username].salt = salt;
        users[username].updated_at = new Date().toISOString();

        return await saveUsers(users);
    }
};
