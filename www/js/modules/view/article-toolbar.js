/**
 * ArticleToolbarMixin - 文章工具栏事件模块
 * @module view/article-toolbar
 *
 * 通过 Mixin 模式合并到 ArticleContentView
 * - bindArticleToolbarEvents: 文章工具栏事件（已读/收藏/获取全文）
 * - bindDigestToolbarEvents: 简报工具栏事件（返回/删除）
 */

import { FeedManager } from '../feed-manager.js';
import { AppState } from '../../state.js';
import { DOMElements } from '../../dom.js';
import { Icons } from '../icons.js';
import { i18n } from '../i18n.js';
import { showToast } from './utils.js';

export const ArticleToolbarMixin = {
    /**
     * 绑定文章工具栏事件
     * @param {Object} article - 文章对象
     */
    bindArticleToolbarEvents(article) {
        const vm = this.viewManager;
        const backBtn = document.getElementById('article-back-btn');
        const readBtn = document.getElementById('article-toggle-read-btn');
        const favBtn = document.getElementById('article-toggle-fav-btn');
        const fetchBtn = document.getElementById('article-fetch-content-btn');

        // 返回按钮
        if (backBtn) {
            backBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Always return to the parent list view explicitly
                if (AppState.viewingDigests) {
                    window.location.hash = '#/digests';
                } else if (AppState.currentGroupId) {
                    window.location.hash = `#/group/${AppState.currentGroupId}`;
                } else if (AppState.currentFeedId) {
                    window.location.hash = `#/feed/${AppState.currentFeedId}`;
                } else if (AppState.viewingFavorites) {
                    window.location.hash = '#/favorites';
                } else {
                    window.location.hash = '#/all';
                }
            });
        }

        // 已读/未读切换按钮
        if (readBtn) {
            readBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    const btn = e.currentTarget;
                    if (article.is_read) {
                        await FeedManager.markAsUnread(article.id);
                        article.is_read = 0;
                        btn.classList.remove('is-read');
                        btn.classList.add('active');
                        btn.innerHTML = Icons.mark_unread;
                        btn.title = i18n.t('article.mark_read');

                        // 增加未读计数
                        this.updateLocalUnreadCount(article.feed_id, 1);
                    } else {
                        await FeedManager.markAsRead(article.id);
                        article.is_read = 1;
                        btn.classList.add('is-read');
                        btn.classList.remove('active');
                        btn.innerHTML = Icons.mark_read;
                        btn.title = i18n.t('article.mark_unread');
                        this.updateLocalUnreadCount(article.feed_id);
                    }

                    // 更新列表中的文章状态
                    const listItem = DOMElements.articlesList?.querySelector(`.article-item[data-id="${article.id}"]`);
                    if (listItem) listItem.classList.toggle('unread', !article.is_read);
                } catch (err) {
                    console.error('Toggle read status failed', err);
                }
            });
        }

        // 收藏按钮
        if (favBtn) {
            favBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    const btn = e.currentTarget;
                    if (article.is_favorited) {
                        await FeedManager.unfavoriteArticle(article.id);
                        article.is_favorited = 0;
                        btn.classList.remove('active');
                        btn.title = i18n.t('article.star');
                        btn.innerHTML = Icons.star_border;
                    } else {
                        await FeedManager.favoriteArticle(article.id);
                        article.is_favorited = 1;
                        btn.classList.add('active');
                        btn.title = i18n.t('article.unstar');
                        btn.innerHTML = Icons.star;
                    }

                    // 更新列表中的收藏星标
                    const listMeta = DOMElements.articlesList?.querySelector(`.article-item[data-id="${article.id}"] .article-item-meta`);
                    if (listMeta) {
                        const star = Array.from(listMeta.children).find(el => el.innerHTML === '★');
                        if (article.is_favorited && !star) {
                            const starEl = document.createElement('span');
                            starEl.style.color = 'var(--accent-color)';
                            starEl.innerHTML = '★';
                            listMeta.prepend(starEl);
                        } else if (!article.is_favorited && star) {
                            star.remove();
                        }
                    }
                } catch (err) {
                    console.error('Toggle favorite failed', err);
                }
            });
        }

        // 获取全文按钮
        if (fetchBtn) {
            // 如果已有原始内容缓存，更新按钮状态
            if (article._originalContent) {
                fetchBtn.innerHTML = Icons.restore_original;
                fetchBtn.title = '恢复原文';
                fetchBtn.classList.add('active');
            }

            fetchBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const btn = e.currentTarget;

                if (btn.classList.contains('loading')) return;

                // 错误状态下点击恢复
                if (btn.dataset.errorState === 'true') {
                    clearTimeout(btn.errorTimeout);
                    btn.innerHTML = btn.dataset.originalHtml;
                    btn.classList.remove('loading');
                    delete btn.dataset.errorState;
                    delete btn.dataset.originalHtml;
                    return;
                }

                // 切换回原始内容
                if (article._originalContent) {
                    const bodyEl = document.querySelector('.article-body');
                    if (bodyEl) bodyEl.innerHTML = article._originalContent;

                    const stateArticle = AppState.articles?.find(a => a.id == article.id);
                    if (stateArticle) stateArticle.content = article._originalContent;

                    delete article._originalContent;
                    fetchBtn.innerHTML = Icons.fetch_original;
                    btn.classList.remove('active');
                    btn.title = '获取全文';
                    return;
                }

                // 开始获取全文
                const originalHtml = btn.innerHTML;
                btn.innerHTML = Icons.spinner;
                btn.classList.add('loading');

                // 添加旋转动画样式
                if (!document.getElementById('spinner-style')) {
                    const style = document.createElement('style');
                    style.id = 'spinner-style';
                    style.textContent = '@keyframes rotate { 100% { transform: rotate(360deg); } } .spinner circle { stroke-dasharray: 90, 150; stroke-dashoffset: 0; stroke-linecap: round; }';
                    document.head.appendChild(style);
                }

                try {
                    const originalContent = document.querySelector('.article-body')?.innerHTML || article.content;
                    const result = await FeedManager.fetchEntryContent(article.id);

                    article._originalContent = originalContent;

                    const bodyEl = document.querySelector('.article-body');
                    if (bodyEl) {
                        bodyEl.innerHTML = result.content || result.summary || '<p>内容为空</p>';
                    }

                    const stateArticle = AppState.articles?.find(a => a.id == article.id);
                    if (stateArticle) stateArticle.content = result.content;

                    // 显示成功状态
                    btn.innerHTML = Icons.success;

                    setTimeout(() => {
                        btn.innerHTML = Icons.restore_original;
                        btn.title = '恢复原文';
                        btn.classList.add('active');
                        btn.classList.remove('loading');
                    }, 1000);
                } catch (err) {
                    console.error('Fetch content failed', err);
                    btn.innerHTML = Icons.error;
                    btn.dataset.errorState = 'true';
                    btn.dataset.originalHtml = originalHtml;
                    btn.errorTimeout = setTimeout(() => {
                        if (btn.dataset.errorState === 'true') {
                            btn.innerHTML = originalHtml;
                            btn.classList.remove('loading');
                            delete btn.dataset.errorState;
                            delete btn.dataset.originalHtml;
                        }
                    }, 2000);
                }
            });

        }

        // 绑定 AI 按钮事件
        this.bindAIButtons(article);
    },

    /**
     * 绑定简报工具栏事件
     * @param {Object} digest - 简报对象
     */
    bindDigestToolbarEvents(digest) {
        const vm = this.viewManager;

        const backBtn = document.getElementById('article-back-btn');
        const deleteBtn = document.getElementById('digest-delete-btn');

        // 返回按钮
        if (backBtn) {
            backBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.innerWidth <= 800) {
                    requestAnimationFrame(() => {
                        vm.isProgrammaticNav = true;
                        history.back();
                    });
                } else {
                    if (AppState.currentGroupId) {
                        window.location.hash = `#/group/${AppState.currentGroupId}`;
                    } else if (AppState.currentFeedId) {
                        window.location.hash = `#/feed/${AppState.currentFeedId}`;
                    } else if (AppState.viewingFavorites) {
                        window.location.hash = '#/favorites';
                    } else {
                        window.location.hash = '#/all';
                    }
                }
            });
        }

        // 删除按钮
        if (deleteBtn && digest) {
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm(i18n.t('digest.confirm_delete'))) return;

                try {
                    const success = await FeedManager.deleteDigest(digest.id);
                    if (success) {
                        // 从列表中移除
                        if (AppState.articles) {
                            AppState.articles = AppState.articles.filter(a => a.id !== digest.id);
                        }
                        // 从 DOM 中移除
                        const listItem = DOMElements.articlesList?.querySelector(`.article-item[data-id="${digest.id}"]`);
                        if (listItem) listItem.remove();

                        showToast(i18n.t('common.success'), 2000, false);

                        // 导航回列表
                        if (window.innerWidth <= 800) {
                            vm.isProgrammaticNav = true;
                            history.back();
                        } else {
                            // 清除内容面板
                            DOMElements.articleContent.innerHTML = `<div class="empty-content"><p>${i18n.t('welcome')}</p></div>`;
                            AppState.currentArticleId = null;
                        }
                    } else {
                        showToast(i18n.t('digest.delete_failed'), 2000, true);
                    }
                } catch (err) {
                    console.error('Delete digest error:', err);
                    showToast(i18n.t('digest.delete_failed'), 2000, true);
                }
            });
        }
    },
};
