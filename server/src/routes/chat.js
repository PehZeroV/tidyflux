/**
 * Chat Routes - AI 聊天记录 API
 *
 * 提供聊天记录的 CRUD 接口。
 * 
 * GET    /api/chat/:articleId       获取某篇文章的聊天记录
 * PUT    /api/chat/:articleId       保存/更新聊天记录
 * DELETE /api/chat/:articleId       删除某篇文章的聊天记录
 * GET    /api/chat                  获取聊天列表
 * DELETE /api/chat                  清空所有聊天记录
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { ChatStore } from '../utils/chat-store.js';
import { PreferenceStore } from '../utils/preference-store.js';

const router = express.Router();

/**
 * GET /api/chat/:articleId
 * 获取某篇文章的聊天记录
 */
router.get('/:articleId', authenticateToken, (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        const chat = ChatStore.get(userId, req.params.articleId);
        res.json({ chat });
    } catch (error) {
        console.error('Chat get error:', error);
        res.status(500).json({ error: 'Failed to get chat' });
    }
});

/**
 * PUT /api/chat/:articleId
 * 保存/更新聊天记录
 */
router.put('/:articleId', authenticateToken, (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        const { messages, title } = req.body;

        if (!Array.isArray(messages)) {
            return res.status(400).json({ error: 'messages array required' });
        }

        ChatStore.save(userId, req.params.articleId, messages, title || null);
        res.json({ success: true });
    } catch (error) {
        console.error('Chat save error:', error);
        res.status(500).json({ error: 'Failed to save chat' });
    }
});

/**
 * DELETE /api/chat/:articleId
 * 删除某篇文章的聊天记录
 */
router.delete('/:articleId', authenticateToken, (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        ChatStore.delete(userId, req.params.articleId);
        res.json({ success: true });
    } catch (error) {
        console.error('Chat delete error:', error);
        res.status(500).json({ error: 'Failed to delete chat' });
    }
});

/**
 * GET /api/chat
 * 获取聊天列表（最近 50 条）
 */
router.get('/', authenticateToken, (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        const limit = parseInt(req.query.limit) || 50;
        const list = ChatStore.list(userId, limit);
        res.json({ chats: list });
    } catch (error) {
        console.error('Chat list error:', error);
        res.status(500).json({ error: 'Failed to list chats' });
    }
});

/**
 * DELETE /api/chat
 * 清空所有聊天记录
 */
router.delete('/', authenticateToken, (req, res) => {
    try {
        const userId = PreferenceStore.getUserId(req.user);
        ChatStore.clear(userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Chat clear error:', error);
        res.status(500).json({ error: 'Failed to clear chats' });
    }
});

export default router;
