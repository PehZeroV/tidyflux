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
import { Modal } from './components.js';
import { AICache } from '../ai-cache.js';
import { AIService } from '../ai-service.js';
import { BREAKPOINTS } from '../../constants.js';

export const ArticleToolbarMixin = {
    /**
     * 取消文章的所有进行中 AI 请求
     * @param {Object} article - 文章对象
     */
    _cancelArticleAI(article) {
        if (article._translateController) {
            article._translateController.abort();
            article._translateController = null;
        }
        if (article._summarizeController) {
            article._summarizeController.abort();
            article._summarizeController = null;
        }
        if (article._autoSummarizeController) {
            article._autoSummarizeController.abort();
            article._autoSummarizeController = null;
        }
    },

    /**
     * 重置文章的所有 AI 状态（取消请求、清除缓存、重置按钮）
     * @param {Object} article - 文章对象
     */
    _resetAIState(article) {
        // 取消进行中的 AI 请求
        this._cancelArticleAI(article);

        // 清除内存中的 AI 缓存
        delete article._aiSummary;
        delete article._translatedContent;

        // 清除服务端 AI 缓存
        AICache.deleteSummary(article.id, AIService.getTargetLang()).catch(() => { });
        AICache.deleteTranslation(article.id, AIService.getTargetLang()).catch(() => { });

        // 标题翻译块保留逻辑
        const titleTransBlock = document.querySelector('.ai-title-trans-block');
        const translateBtn = document.getElementById('article-translate-btn');
        if (translateBtn) {
            translateBtn.classList.remove('loading');
            if (!titleTransBlock) {
                translateBtn.classList.remove('active');
                translateBtn.setAttribute('data-tooltip', i18n.t('ai.translate_btn'));
            }
        }

        // 重置摘要按钮和摘要框状态
        const summarizeBtn = document.getElementById('article-summarize-btn');
        const summaryBox = document.getElementById('article-ai-summary');
        if (summarizeBtn) {
            summarizeBtn.classList.remove('active', 'loading');
        }
        if (summaryBox) {
            summaryBox.style.display = 'none';
            const summaryContent = summaryBox.querySelector('.ai-content');
            if (summaryContent) summaryContent.innerHTML = '';
        }
    },

    /**
     * 绑定文章工具栏事件
     * @param {Object} article - 文章对象
     */
    bindArticleToolbarEvents(article) {
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
                        btn.setAttribute('data-tooltip', i18n.t('article.mark_read'));

                        // 增加未读计数
                        this.updateLocalUnreadCount(article.feed_id, 1);
                    } else {
                        await FeedManager.markAsRead(article.id);
                        article.is_read = 1;
                        btn.classList.add('is-read');
                        btn.classList.remove('active');
                        btn.innerHTML = Icons.mark_read;
                        btn.setAttribute('data-tooltip', i18n.t('article.mark_unread'));
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
                        btn.setAttribute('data-tooltip', i18n.t('article.star'));
                        btn.innerHTML = Icons.star_border;
                    } else {
                        await FeedManager.favoriteArticle(article.id);
                        article.is_favorited = 1;
                        btn.classList.add('active');
                        btn.setAttribute('data-tooltip', i18n.t('article.unstar'));
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
                fetchBtn.setAttribute('data-tooltip', i18n.t('feed.restore_original'));
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
                    // 重置所有 AI 状态（取消请求、清除缓存、重置按钮）
                    this._resetAIState(article);

                    const bodyEl = document.querySelector('.article-body');
                    if (bodyEl) bodyEl.innerHTML = article._originalContent;

                    article.content = article._originalContent;
                    const stateArticle = AppState.articles?.find(a => a.id == article.id);
                    if (stateArticle) stateArticle.content = article._originalContent;

                    delete article._originalContent;
                    fetchBtn.innerHTML = Icons.fetch_original;
                    btn.classList.remove('active');
                    btn.setAttribute('data-tooltip', i18n.t('feed.fetch_content'));

                    // 恢复原文后重新触发自动 AI（如果已启用）
                    this.autoSummarize(article);
                    this.autoTranslate(article);
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

                    // 重置所有 AI 状态（全文内容已变更，旧缓存失效）
                    this._resetAIState(article);

                    const bodyEl = document.querySelector('.article-body');
                    if (bodyEl) {
                        bodyEl.innerHTML = result.content || result.summary || `<p>${i18n.t('feed.empty_content')}</p>`;
                    }

                    // 更新文章内容引用（供后续 AI 使用新全文）
                    article.content = result.content || result.summary || '';
                    const stateArticle = AppState.articles?.find(a => a.id == article.id);
                    if (stateArticle) stateArticle.content = article.content;

                    // 显示成功状态
                    btn.innerHTML = Icons.success;

                    setTimeout(() => {
                        btn.innerHTML = Icons.restore_original;
                        btn.setAttribute('data-tooltip', i18n.t('feed.restore_original'));
                        btn.classList.add('active');
                        btn.classList.remove('loading');

                        // 全文获取完成后，重新触发自动 AI 功能（如果已启用）
                        this.autoSummarize(article);
                        this.autoTranslate(article);
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

        // 自动摘要（如果已启用）
        this.autoSummarize(article);

        // 自动翻译全文（如果已启用）
        this.autoTranslate(article);

        // 更多操作菜单（三个点）
        const moreBtn = document.getElementById('article-more-btn');

        if (moreBtn) {
            let activeMenu = null;
            let activeCloseHandler = null;

            const closeMenu = () => {
                if (activeMenu) {
                    activeMenu.remove();
                    activeMenu = null;
                }
                if (activeCloseHandler) {
                    document.removeEventListener('click', activeCloseHandler, true);
                    activeCloseHandler = null;
                }
            };

            moreBtn.addEventListener('click', async (e) => {
                e.stopPropagation();

                // Toggle: if already open, close
                if (activeMenu) {
                    closeMenu();
                    return;
                }

                // Create menu and append to body
                const menu = document.createElement('div');
                menu.className = 'context-menu';
                menu.style.maxWidth = 'calc(100vw - 20px)';
                menu.style.minWidth = '200px';

                const currentWidth = AppState.preferences?.article_width || 360;
                const currentFontSize = AppState.preferences?.article_font_size || 1.1;

                // Font family options (all locally hosted or system fonts)
                const fontFamilyOptions = [
                    { label: i18n.t('context.font_family_system'), value: 'system-ui' },
                    { label: i18n.t('context.font_family_sans_serif'), value: 'sans-serif' },
                    { label: i18n.t('context.font_family_serif'), value: "Georgia, serif" },
                    { label: 'Fira Sans', value: "'Fira Sans', sans-serif" },
                    { label: 'Open Sans', value: "'Open Sans', sans-serif" },
                    { label: 'Noto Sans', value: "'Noto Sans', sans-serif" },
                    { label: 'Noto Serif', value: "'Noto Serif', serif" },
                    { label: 'Source Sans Pro', value: "'Source Sans Pro', sans-serif" },
                    { label: 'Source Serif Pro', value: "'Source Serif Pro', serif" },
                ];

                menu.innerHTML = `
                    <div class="context-menu-item" data-action="save-third-party">
                        ${Icons.save_alt}
                        <span>${i18n.t('article.save_to_third_party')}</span>
                    </div>
                    <div class="context-menu-divider"></div>
                    <div class="context-menu-item context-menu-submenu-trigger" data-action="font-family">
                        ${Icons.text_format}
                        <span>${i18n.t('context.font_family')}</span>
                        <span style="margin-left: auto; font-size: 10px; opacity: 0.5;">▶</span>
                    </div>
                    <div class="context-menu-divider"></div>
                    <div class="context-menu-label" style="padding-bottom: 0;">${i18n.t('context.font_size')}</div>
                    <div style="padding: 0 16px 10px;">
                        <input type="range" class="context-menu-slider font-size-slider" min="0.9" max="1.3" step="0.02" value="${currentFontSize}">
                        <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-tertiary); margin-top: 2px; user-select: none;">
                            <span>${i18n.t('context.font_size_small')}</span>
                            <span class="font-size-value" style="cursor: pointer;" data-tooltip="${i18n.t('settings.keyboard_reset')}">${currentFontSize}em</span>
                            <span>${i18n.t('context.font_size_large')}</span>
                        </div>
                    </div>
                    <div class="page-width-section">
                        <div class="context-menu-divider"></div>
                        <div class="context-menu-label" style="padding-bottom: 0;">${i18n.t('context.page_width')}</div>
                        <div style="padding: 0 16px 10px;">
                            <input type="range" class="context-menu-slider width-slider" min="300" max="600" step="10" value="${currentWidth}">
                            <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-tertiary); margin-top: 2px; user-select: none;">
                                <span>${i18n.t('context.page_width_narrow')}</span>
                                <span class="page-width-value" style="cursor: pointer;" data-tooltip="${i18n.t('settings.keyboard_reset')}">${currentWidth * 2}</span>
                                <span>${i18n.t('context.page_width_wide')}</span>
                            </div>
                        </div>
                    </div>
                `;
                document.body.appendChild(menu);
                activeMenu = menu;

                // Position below the button, anchored to right edge
                const positionMenu = () => {
                    const rect = moreBtn.getBoundingClientRect();
                    const y = rect.bottom + 4;
                    // 右对齐：菜单右边缘与按钮右边缘对齐，向左展开
                    const rightOffset = window.innerWidth - rect.right;
                    menu.style.right = `${Math.max(10, rightOffset)}px`;
                    menu.style.left = 'auto';
                    menu.style.top = `${y}px`;
                };
                positionMenu();

                // ===== Font Family Submenu =====
                const fontTrigger = menu.querySelector('.context-menu-submenu-trigger[data-action="font-family"]');
                if (fontTrigger) {
                    fontTrigger.addEventListener('click', (e) => {
                        e.stopPropagation();

                        // Capture menu position before closing
                        const menuRect = menu.getBoundingClientRect();
                        const menuRight = menuRect.right;
                        const menuY = menuRect.top;

                        // Close main menu
                        closeMenu();

                        // Build font submenu
                        const currentFF = AppState.preferences?.article_font_family || 'system-ui';
                        const submenu = document.createElement('div');
                        submenu.className = 'context-menu context-submenu';

                        const buildFontHtml = (activeValue) => {
                            return `
                                <div class="context-menu-label" style="padding: 6px 12px 4px; display: flex; align-items: center; gap: 6px;">
                                    ${Icons.text_format}
                                    ${i18n.t('context.font_family')}
                                </div>
                                <div class="context-menu-divider" style="margin: 2px 0;"></div>
                                ${fontFamilyOptions.map(opt => {
                                const isActive = opt.value === activeValue;
                                return `<div class="context-menu-item font-family-option${isActive ? ' active' : ''}" data-font-value="${opt.value}" style="font-family: ${opt.value}; padding: 7px 12px; font-size: 0.85em;">
                                        <span>${opt.label}</span>
                                    </div>`;
                            }).join('')}
                            `;
                        };

                        submenu.innerHTML = buildFontHtml(currentFF);
                        document.body.appendChild(submenu);

                        // Position: right-aligned with main menu
                        const subW = submenu.offsetWidth;
                        const subH = submenu.offsetHeight;
                        let x = menuRight - subW;
                        let y = menuY;
                        if (x < 10) x = 10;
                        if (y + subH > window.innerHeight - 10) y = window.innerHeight - subH - 10;
                        if (y < 10) y = 10;
                        submenu.style.left = `${x}px`;
                        submenu.style.top = `${y}px`;

                        // Handle font option clicks
                        submenu.addEventListener('click', (ce) => {
                            const opt = ce.target.closest('.font-family-option');
                            if (!opt) return;
                            ce.stopPropagation();

                            const val = opt.dataset.fontValue;
                            const articleContent = document.getElementById('article-content');
                            if (articleContent) {
                                articleContent.style.setProperty('--article-font-family', val);
                                if (val === 'system-ui') {
                                    articleContent.style.removeProperty('--article-heading-font-family');
                                } else {
                                    articleContent.style.setProperty('--article-heading-font-family', val);
                                }
                            }

                            // Save preference
                            AppState.preferences = AppState.preferences || {};
                            AppState.preferences.article_font_family = val;
                            FeedManager.setPreference('article_font_family', val).catch(err => {
                                console.error('Save pref error:', err);
                            });

                            // Re-render to update checkmark
                            submenu.innerHTML = buildFontHtml(val);
                        });

                        // Click outside to close
                        const subCloseHandler = (ce) => {
                            if (!submenu.contains(ce.target)) {
                                ce.preventDefault();
                                ce.stopPropagation();
                                ce.stopImmediatePropagation();
                                submenu.remove();
                                document.removeEventListener('click', subCloseHandler, true);
                            }
                        };
                        setTimeout(() => document.addEventListener('click', subCloseHandler, true), 0);
                    });
                }
                // Slider reset helper
                const articleContent = document.getElementById('article-content');
                const resetSlider = (slider, defaultVal, cssProp, unit, prefKey, label, formatLabel) => {
                    slider.value = defaultVal;
                    if (articleContent) {
                        articleContent.style.setProperty(cssProp, defaultVal + unit);
                    }
                    if (label) {
                        label.textContent = formatLabel(defaultVal);
                    }
                    AppState.preferences = AppState.preferences || {};
                    AppState.preferences[prefKey] = defaultVal;
                    FeedManager.setPreference(prefKey, defaultVal).catch(err => {
                        console.error('Save pref error:', err);
                    });
                };

                // Page width slider events
                const widthSlider = menu.querySelector('.width-slider');
                if (widthSlider) {
                    const widthValueLabel = menu.querySelector('.page-width-value');
                    const widthFormat = v => v * 2;

                    widthSlider.addEventListener('input', (e) => {
                        e.stopPropagation();
                        const val = e.target.value;
                        if (articleContent) articleContent.style.setProperty('--article-half-width', val + 'px');
                        if (widthValueLabel) widthValueLabel.textContent = val * 2;
                    });

                    widthSlider.addEventListener('change', (e) => {
                        e.stopPropagation();
                        const val = parseInt(e.target.value, 10);
                        AppState.preferences = AppState.preferences || {};
                        AppState.preferences.article_width = val;
                        FeedManager.setPreference('article_width', val).catch(err => {
                            console.error('Save pref error:', err);
                        });
                    });

                    widthSlider.addEventListener('mousedown', (e) => e.stopPropagation());
                    widthSlider.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

                    widthSlider.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        resetSlider(widthSlider, 360, '--article-half-width', 'px', 'article_width', widthValueLabel, widthFormat);
                    });

                    if (widthValueLabel) {
                        widthValueLabel.addEventListener('click', (e) => {
                            e.stopPropagation();
                            resetSlider(widthSlider, 360, '--article-half-width', 'px', 'article_width', widthValueLabel, widthFormat);
                        });
                    }
                }

                // Font size slider events
                const fontSlider = menu.querySelector('.font-size-slider');
                if (fontSlider) {
                    const fontValueLabel = menu.querySelector('.font-size-value');
                    const fontFormat = v => v + 'em';

                    fontSlider.addEventListener('input', (e) => {
                        e.stopPropagation();
                        const val = e.target.value;
                        if (articleContent) articleContent.style.setProperty('--article-font-size', val + 'em');
                        if (fontValueLabel) fontValueLabel.textContent = val + 'em';
                    });

                    fontSlider.addEventListener('change', (e) => {
                        e.stopPropagation();
                        const val = parseFloat(e.target.value);
                        AppState.preferences = AppState.preferences || {};
                        AppState.preferences.article_font_size = val;
                        FeedManager.setPreference('article_font_size', val).catch(err => {
                            console.error('Save pref error:', err);
                        });
                    });

                    fontSlider.addEventListener('mousedown', (e) => e.stopPropagation());
                    fontSlider.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

                    fontSlider.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        resetSlider(fontSlider, 1.1, '--article-font-size', 'em', 'article_font_size', fontValueLabel, fontFormat);
                    });

                    if (fontValueLabel) {
                        fontValueLabel.addEventListener('click', (e) => {
                            e.stopPropagation();
                            resetSlider(fontSlider, 1.1, '--article-font-size', 'em', 'article_font_size', fontValueLabel, fontFormat);
                        });
                    }
                }

                // Click-outside to close (capture phase, same as other context menus)
                const closeHandler = (ce) => {
                    if (!menu.contains(ce.target) && ce.target !== moreBtn && !moreBtn.contains(ce.target)) {
                        ce.preventDefault();
                        ce.stopPropagation();
                        ce.stopImmediatePropagation();
                        closeMenu();
                    }
                };
                activeCloseHandler = closeHandler;
                setTimeout(() => document.addEventListener('click', closeHandler, true), 0);

                // Bind save action — check integrations on click
                menu.addEventListener('click', async (ce) => {
                    const item = ce.target.closest('[data-action="save-third-party"]');
                    if (!item) return;
                    ce.stopPropagation();

                    const label = item.querySelector('span');
                    const originalText = label.textContent;

                    // Check integration status first
                    label.textContent = i18n.t('common.loading');
                    item.style.opacity = '0.6';
                    item.style.pointerEvents = 'none';

                    try {
                        const status = await FeedManager.getIntegrationsStatus();
                        if (!status.has_integrations) {
                            label.textContent = originalText;
                            item.style.opacity = '';
                            item.style.pointerEvents = '';
                            closeMenu();
                            await Modal.alert(i18n.t('article.no_integrations_hint'), i18n.t('article.no_integrations'));
                            return;
                        }
                    } catch (err) {
                        label.textContent = originalText;
                        item.style.opacity = '';
                        item.style.pointerEvents = '';
                        closeMenu();
                        await Modal.alert(i18n.t('article.integrations_check_failed'));
                        return;
                    }

                    // Has integrations, proceed to save
                    label.textContent = i18n.t('article.saving');

                    try {
                        await FeedManager.saveToThirdParty(article.id);
                        label.textContent = '✓ ' + i18n.t('article.save_success');
                        item.style.color = 'var(--accent-color)';
                        setTimeout(() => {
                            label.textContent = originalText;
                            item.style.color = '';
                            item.style.opacity = '';
                            item.style.pointerEvents = '';
                        }, 2000);
                    } catch (err) {
                        label.textContent = '✕ ' + (err.message || i18n.t('article.save_failed'));
                        item.style.color = '#ff4444';
                        setTimeout(() => {
                            label.textContent = originalText;
                            item.style.color = '';
                            item.style.opacity = '';
                            item.style.pointerEvents = '';
                        }, 3000);
                    }
                });
            });
        }
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
                if (window.innerWidth <= BREAKPOINTS.MOBILE) {
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
                if (!await Modal.confirm(i18n.t('digest.confirm_delete'))) return;

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
                        if (window.innerWidth <= BREAKPOINTS.MOBILE) {
                            vm.isProgrammaticNav = true;
                            history.back();
                        } else {
                            // 清除内容面板
                            DOMElements.articleContent.innerHTML = `<div class="empty-content"><p>${i18n.t('welcome')}</p></div>`;
                            AppState.currentArticleId = null;
                        }
                    } else {
                        showToast(i18n.t('digest.delete_failed'), 2000, false);
                    }
                } catch (err) {
                    console.error('Delete digest error:', err);
                    showToast(i18n.t('digest.delete_failed'), 2000, false);
                }
            });
        }
    },
};
