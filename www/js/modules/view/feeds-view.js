/**
 * FeedsView - 订阅源列表视图模块
 * @module view/feeds-view
 */

import { DOMElements } from '../../dom.js';
import { AppState } from '../../state.js';
import { FeedManager } from '../feed-manager.js';
import { setTheme, setColorScheme } from '../theme-manager.js';
import { i18n } from '../i18n.js';
import { Icons } from '../icons.js';
import { API_ENDPOINTS } from '../../constants.js';
import { KeyboardShortcuts } from '../keyboard.js';
import { AIService } from '../ai-service.js';

const STORAGE_KEY_COLLAPSED = 'tidyflux_collapsed_groups';
const STORAGE_KEY_PINNED = 'tidyflux_pinned_groups';
const DEFAULT_ICON = '/icons/rss.svg';

/**
 * 订阅源视图管理
 */
export const FeedsView = {
    /** 视图管理器引用 */
    viewManager: null,

    /** IntersectionObserver for lazy loading feed icons */
    _iconObserver: null,

    /**
     * 初始化模块
     * @param {Object} viewManager - ViewManager 实例引用
     */
    init(viewManager) {
        this.viewManager = viewManager;
    },

    /**
     * 加载订阅源列表
     */
    /**
     * 加载订阅源数据（不渲染）
     * @returns {Promise<Object>} 包含 feeds, groups, digestsData 的数据对象
     */
    async fetchFeedsData() {
        try {
            // Fetch feeds, groups, prefs, AND digests in parallel
            // Wrap getDigests in a safe promise to prevent blocking main data if it fails
            const safeGetDigests = async () => {
                try {
                    const res = await FeedManager.getDigests({ unreadOnly: true });
                    return (res && res.digests) ? res.digests : { pinned: [], normal: [] };
                } catch (e) {
                    console.error('Failed to load digests count', e);
                    return { pinned: [], normal: [] };
                }
            };

            const [feeds, groups, prefs, digestsData] = await Promise.all([
                FeedManager.getFeeds(),
                FeedManager.getGroups(),
                FeedManager.getPreferences(),
                safeGetDigests()
            ]);

            AppState.feeds = feeds;
            AppState.groups = groups;
            AppState.preferences = prefs || {};

            // 应用主题设置
            if (AppState.preferences.theme) {
                setTheme(AppState.preferences.theme);
            }
            if (AppState.preferences.color_scheme) {
                setColorScheme(AppState.preferences.color_scheme);
            }
            // 应用语言设置
            if (AppState.preferences.language && AppState.preferences.language !== i18n.locale) {
                i18n.locale = AppState.preferences.language;
                i18n.translatePage();
            }

            // 同步折叠和置顶状态
            if (AppState.preferences.collapsed_groups) {
                localStorage.setItem(STORAGE_KEY_COLLAPSED, JSON.stringify(AppState.preferences.collapsed_groups));
            }
            if (AppState.preferences.pinned_groups) {
                localStorage.setItem(STORAGE_KEY_PINNED, JSON.stringify(AppState.preferences.pinned_groups));
            }

            // Sync keyboard shortcuts from server preferences
            KeyboardShortcuts.syncFromPreferences();

            // 重新加载 AI 覆盖设置（init 时 preferences 可能尚未就绪）
            AIService._loadTranslationOverrides();
            AIService._loadSummaryOverrides();
            AIService._loadAutoTranslateOverrides();

            return { feeds, groups, digestsData };
        } catch (err) {
            console.error('Load feeds error:', err);
            DOMElements.feedsList.innerHTML = `<div class="error-msg">${i18n.t('common.load_error')}</div>`;
            throw err;
        }
    },

    /**
     * 渲染订阅源界面
     * @param {Object} data - fetchFeedsData 返回的数据
     */
    render(data) {
        const { feeds, groups, digestsData } = data;
        this.renderFeedsList(feeds, groups, digestsData);

        // 更新当前标题
        if (AppState.currentFeedId) {
            const feed = feeds.find(f => f.id == AppState.currentFeedId);
            if (feed) DOMElements.currentFeedTitle.textContent = feed.title;
        } else if (AppState.currentGroupId) {
            const group = groups.find(g => g.id == AppState.currentGroupId);
            if (group) DOMElements.currentFeedTitle.textContent = group.name;
        }
    },

    /**
     * 加载并渲染订阅源列表 (Legacy/Default behavior)
     */
    async loadFeeds() {
        const data = await this.fetchFeedsData();
        this.render(data);
    },

    /**
     * 渲染订阅源列表
     * @param {Array} feeds - 订阅源数组
     * @param {Array} groups - 分组数组
     */
    renderFeedsList(feeds, groups = [], digestsData = null) {
        const totalUnread = feeds.reduce((sum, f) => sum + (f.unread_count || 0), 0);

        // 固定项：全部文章和收藏
        let html = `
            <button class="feed-item-btn ${!AppState.currentFeedId && !AppState.viewingFavorites && !AppState.currentGroupId ? 'active' : ''}" data-feed-id="">
                ${Icons.list}
                <span class="feed-name">${i18n.t('nav.all')}</span>
                ${totalUnread > 0 ? `<span class="feed-unread-count all-unread-count">${totalUnread}</span>` : ''}
            </button>
            <button class="feed-item-btn ${AppState.viewingFavorites ? 'active' : ''}" id="favorites-btn">
                ${Icons.star}
                <span class="feed-name">${i18n.t('nav.starred')}</span>
            </button>
            <button class="feed-item-btn ${AppState.viewingDigests ? 'active' : ''}" id="digests-btn">
                ${Icons.newspaper}
                <span class="feed-name">${i18n.t('nav.briefings')}</span>
                ${this._getDigestUnreadBadge(digestsData)}
            </button>
        `;

        // 按分组组织订阅源
        const feedsByGroup = {};
        const ungroupedFeeds = [];
        feeds.forEach(f => {
            if (f.group_id) {
                if (!feedsByGroup[f.group_id]) feedsByGroup[f.group_id] = [];
                feedsByGroup[f.group_id].push(f);
            } else {
                ungroupedFeeds.push(f);
            }
        });

        const collapsedGroups = this.getCollapsedGroups();
        const pinnedGroups = this.getPinnedGroups();

        // 排序分组：置顶的在前
        const sortedGroups = [...groups].sort((a, b) => {
            const aIdx = pinnedGroups.indexOf(a.id);
            const bIdx = pinnedGroups.indexOf(b.id);
            const aIsPinned = aIdx !== -1;
            const bIsPinned = bIdx !== -1;

            if (aIsPinned && !bIsPinned) return -1;
            if (!aIsPinned && bIsPinned) return 1;
            if (aIsPinned && bIsPinned) return aIdx - bIdx;
            return 0;
        });

        // 渲染分组
        let groupsHtml = '';
        sortedGroups.forEach(g => {
            const gFeeds = feedsByGroup[g.id] || [];
            const gUnread = gFeeds.reduce((sum, f) => sum + (f.unread_count || 0), 0);
            const isCollapsed = collapsedGroups.includes(g.id);

            groupsHtml += `
                <div class="feed-group ${isCollapsed ? 'collapsed' : ''}" data-group-id="${g.id}">
                    <div class="feed-group-header">
                        ${Icons.chevron_down}
                        <span class="feed-group-name" data-group-id="${g.id}">${g.name}</span>
                        ${gUnread > 0 ? `<span class="feed-group-count">${gUnread}</span>` : ''}
                    </div>
                    <div class="feed-group-items">
                        ${gFeeds.map(f => this.renderFeedItem(f)).join('')}
                    </div>
                </div>
            `;
        });

        // 渲染未分组的订阅源
        const ungroupedHtml = ungroupedFeeds.map(f => this.renderFeedItem(f)).join('');

        DOMElements.feedsList.innerHTML = html + groupsHtml + ungroupedHtml;
        this.bindFeedsListEvents();
    },

    _getDigestUnreadBadge(digestsData) {
        if (!digestsData) return '';
        const count = (digestsData.pinned?.length || 0) + (digestsData.normal?.length || 0);
        return count > 0 ? `<span class="feed-unread-count digests-unread-count">${count}</span>` : '';
    },

    /**
     * 更新徽标计数辅助方法
     * @param {HTMLElement} container - 容器元素
     * @param {number} count - 计数
     * @param {string} className - Badge 类名
     * @param {string} selector - Badge 选择器
     */
    _updateBadge(container, count, className, selector = '.feed-unread-count') {
        if (!container) return;
        let badge = container.querySelector(selector);
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = className;
                container.appendChild(badge);
            }
            badge.textContent = count;
        } else if (badge) {
            badge.remove();
        }
    },

    /**
     * 仅更新未读计数（避免完全重新渲染）
     * @param {Array} feeds - 订阅源数组
     * @param {Array} groups - 分组数组
     */
    updateUnreadCounts(feeds, groups, digestsData = null) {
        // 更新全部文章计数
        const totalUnread = feeds.reduce((sum, f) => sum + (f.unread_count || 0), 0);
        const allBtn = DOMElements.feedsList.querySelector('.feed-item-btn[data-feed-id=""]');
        this._updateBadge(allBtn, totalUnread, 'feed-unread-count all-unread-count');

        // 优化：一次性建立映射，避免在循环中重复查询 DOM
        const feedUnreadMap = new Map(feeds.map(f => [String(f.id), f.unread_count || 0]));
        const groupUnreadMap = new Map();

        // 计算分组未读数
        feeds.forEach(f => {
            if (f.group_id) {
                const gid = String(f.group_id);
                groupUnreadMap.set(gid, (groupUnreadMap.get(gid) || 0) + (f.unread_count || 0));
            }
        });

        // 遍历 DOM 更新徽标 (O(N) 复杂度)
        DOMElements.feedsList.querySelectorAll('.feed-item-btn[data-feed-id]').forEach(btn => {
            const feedId = btn.dataset.feedId;
            // 跳过 "全部" 按钮 (feedId 为空字符串)
            if (feedId === "") return;

            const count = feedUnreadMap.get(feedId) || 0;
            this._updateBadge(btn, count, 'feed-unread-count');
        });

        DOMElements.feedsList.querySelectorAll('.feed-group').forEach(groupEl => {
            const groupId = groupEl.dataset.groupId;
            const count = groupUnreadMap.get(groupId) || 0;
            const groupHeader = groupEl.querySelector('.feed-group-header');
            this._updateBadge(groupHeader, count, 'feed-group-count', '.feed-group-count');
        });

        // Update Briefings Count
        if (digestsData) {
            const btn = document.getElementById('digests-btn');
            const count = (digestsData.pinned?.length || 0) + (digestsData.normal?.length || 0);
            this._updateBadge(btn, count, 'feed-unread-count digests-unread-count');
        }
    },

    /**
     * 渲染单个订阅源项
     * @param {Object} feed - 订阅源对象
     * @returns {string} HTML 字符串
     */
    renderFeedItem(feed) {
        const unread = feed.unread_count || 0;
        // Use data-src for lazy loading with IntersectionObserver
        return `
            <button class="feed-item-btn ${AppState.currentFeedId === feed.id ? 'active' : ''}" data-feed-id="${feed.id}">
                <img class="feed-icon" src="${DEFAULT_ICON}" data-src="${API_ENDPOINTS.FAVICON.BASE}?feedId=${feed.id}" decoding="async" alt="">
                <span class="feed-name">${feed.title || i18n.t('common.unnamed')}</span>
                ${unread > 0 ? `<span class="feed-unread-count">${unread}</span>` : ''}
            </button>
        `;
    },

    /**
     * 绑定订阅源列表事件
     */
    bindFeedsListEvents() {
        const vm = this.viewManager;
        const listEl = DOMElements.feedsList;

        // Setup IntersectionObserver for lazy loading feed icons
        this._setupIconObserver(listEl);

        // Favicon 加载失败回退（使用 capture 捕获 error 事件）
        listEl.addEventListener('error', (e) => {
            if (e.target.tagName === 'IMG' && e.target.classList.contains('feed-icon')) {
                e.target.src = DEFAULT_ICON;
                e.target.onerror = null; // Prevent infinite loop if fallback also fails
            }
        }, true);

        // 收藏按钮
        const favBtn = document.getElementById('favorites-btn');
        if (favBtn) {
            favBtn.addEventListener('click', () => this.selectFavorites());
        }

        // Briefings button
        const briefBtn = document.getElementById('digests-btn');
        if (briefBtn) {
            briefBtn.addEventListener('click', () => this.selectDigests());
        }

        // 长按处理辅助函数
        const addLongPressHandler = (element, callback) => {
            let timer;
            let startX, startY;
            let isLongPress = false;

            element.addEventListener('touchstart', (e) => {
                isLongPress = false;
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                timer = setTimeout(() => {
                    isLongPress = true;
                    if (navigator.vibrate) navigator.vibrate(50);

                    // 构造模拟事件对象
                    const mockEvent = {
                        preventDefault: () => { },
                        stopPropagation: () => { },
                        clientX: startX,
                        clientY: startY,
                        target: element,
                        currentTarget: element
                    };
                    callback(mockEvent);
                }, 500);
            }, { passive: true });

            element.addEventListener('touchmove', (e) => {
                if (!timer) return;
                const diffX = Math.abs(e.touches[0].clientX - startX);
                const diffY = Math.abs(e.touches[0].clientY - startY);
                // 如果移动超过 10px，视为滚动，取消长按
                if (diffX > 10 || diffY > 10) {
                    clearTimeout(timer);
                    timer = null;
                }
            }, { passive: true });

            element.addEventListener('touchend', (e) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                // 如果触发了长按，阻止默认行为（主要是阻止后续的 click 事件）
                if (isLongPress) {
                    if (e.cancelable) e.preventDefault();
                }
            }, { passive: false });
        };

        // 订阅源点击和右键菜单
        DOMElements.feedsList.querySelectorAll('.feed-item-btn').forEach(btn => {
            if (btn.id !== 'favorites-btn' && btn.id !== 'digests-btn') {
                const feedId = btn.dataset.feedId || null;

                // 点击事件
                btn.addEventListener('click', () => {
                    this.selectFeed(feedId);
                });

                // 桌面右键菜单
                btn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    if (feedId) vm.showFeedContextMenu(e, feedId);
                });

                // 移动端长按菜单
                if (feedId) {
                    addLongPressHandler(btn, (e) => {
                        vm.showFeedContextMenu(e, feedId);
                    });
                }
            }
        });

        // 分组头部事件
        DOMElements.feedsList.querySelectorAll('.feed-group-header').forEach(header => {
            // 折叠图标点击
            header.querySelector('.fold-icon').addEventListener('click', async (e) => {
                e.stopPropagation();
                const group = header.closest('.feed-group');
                const groupId = parseInt(group.dataset.groupId, 10);
                const collapsed = group.classList.toggle('collapsed');
                await this.setGroupCollapsed(groupId, collapsed);
            });

            // 分组点击 (包含名称和未读数)
            header.addEventListener('click', (e) => {
                // 如果是折叠图标触发的（已有单独处理），则忽略
                if (e.target.closest('.fold-icon')) return;

                e.stopPropagation();
                const group = header.closest('.feed-group');
                const groupId = group ? group.dataset.groupId : null;
                if (groupId) this.selectGroup(groupId);
            });

            // 分组右键菜单
            header.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const groupId = header.closest('.feed-group').dataset.groupId;
                if (groupId) vm.showGroupContextMenu(e, groupId);
            });

            // 移动端长按菜单
            const groupId = header.closest('.feed-group').dataset.groupId;
            if (groupId) {
                addLongPressHandler(header, (e) => {
                    vm.showGroupContextMenu(e, groupId);
                });
            }
        });
    },

    /**
     * 选择订阅源
     * @param {string|null} feedId - 订阅源 ID
     */
    selectFeed(feedId) {
        const vm = this.viewManager;
        vm.isProgrammaticNav = true;
        vm.forceRefreshList = true;

        const hash = feedId ? `#/feed/${feedId}` : '#/all';
        // 强制触发路由，即使 hash 相同也重新加载
        if (window.location.hash === hash) {
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        } else {
            window.location.hash = hash;
        }
    },

    /**
     * 选择分组
     * @param {string|number} groupId - 分组 ID
     */
    selectGroup(groupId) {
        const vm = this.viewManager;
        vm.isProgrammaticNav = true;
        vm.forceRefreshList = true;

        const hash = `#/group/${groupId}`;
        // 强制触发路由，即使 hash 相同也重新加载
        if (window.location.hash === hash) {
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        } else {
            window.location.hash = hash;
        }
    },

    /**
     * 选择收藏
     */
    selectFavorites() {
        const vm = this.viewManager;
        vm.isProgrammaticNav = true;
        vm.forceRefreshList = true;

        const hash = '#/favorites';
        // 强制触发路由，即使 hash 相同也重新加载
        if (window.location.hash === hash) {
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        } else {
            window.location.hash = hash;
        }
    },

    /**
     * Select Briefings
     */
    selectDigests() {
        const vm = this.viewManager;
        vm.isProgrammaticNav = true;
        vm.forceRefreshList = true;

        const hash = '#/digests';
        if (window.location.hash === hash) {
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        } else {
            window.location.hash = hash;
        }
    },

    /**
     * 更新侧边栏激活状态
     * @param {Object} options - 选项
     */
    updateSidebarActiveState(options) {
        // 清除所有激活状态 (优化：只查找当前激活的元素)
        const currentActive = DOMElements.feedsList.querySelector('.active');
        if (currentActive) currentActive.classList.remove('active');

        if (options?.favorites) {
            const favBtn = document.getElementById('favorites-btn');
            if (favBtn) favBtn.classList.add('active');
        } else if (options?.digests) {
            const btn = document.getElementById('digests-btn');
            if (btn) btn.classList.add('active');
        } else if (options?.groupId) {
            const groupName = DOMElements.feedsList.querySelector(`.feed-group[data-group-id="${options.groupId}"] .feed-group-name`);
            if (groupName) groupName.classList.add('active');
        } else if (options?.feedId) {
            const feedBtn = DOMElements.feedsList.querySelector(`.feed-item-btn[data-feed-id="${options.feedId}"]`);
            if (feedBtn) feedBtn.classList.add('active');
        } else {
            // 全部文章
            const allBtn = DOMElements.feedsList.querySelector('.feed-item-btn[data-feed-id=""]');
            if (allBtn) allBtn.classList.add('active');
        }
    },

    /**
     * 获取折叠的分组列表
     * @returns {Array<number>}
     */
    getCollapsedGroups() {
        if (AppState.preferences && Array.isArray(AppState.preferences.collapsed_groups)) {
            return AppState.preferences.collapsed_groups;
        }
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY_COLLAPSED) || '[]');
            return Array.isArray(stored) ? stored : [];
        } catch {
            return [];
        }
    },

    /**
     * 设置分组折叠状态
     * @param {number} groupId - 分组 ID
     * @param {boolean} collapsed - 是否折叠
     */
    async setGroupCollapsed(groupId, collapsed) {
        try {
            let groups = this.getCollapsedGroups();
            if (collapsed) {
                if (!groups.includes(groupId)) groups.push(groupId);
            } else {
                groups = groups.filter(id => id !== groupId);
            }

            AppState.preferences = AppState.preferences || {};
            AppState.preferences.collapsed_groups = groups;
            localStorage.setItem(STORAGE_KEY_COLLAPSED, JSON.stringify(groups));

            try {
                await FeedManager.setPreference('collapsed_groups', groups);
            } catch (err) {
                console.error('Sync collapsed state error:', err);
            }
        } catch (err) {
            console.error('Save collapsed state error:', err);
        }
    },

    /**
     * 获取置顶的分组列表
     * @returns {Array<number>}
     */
    getPinnedGroups() {
        if (AppState.preferences && Array.isArray(AppState.preferences.pinned_groups)) {
            return AppState.preferences.pinned_groups;
        }
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY_PINNED) || '[]');
            return Array.isArray(stored) ? stored : [];
        } catch {
            return [];
        }
    },

    /**
     * 设置分组置顶状态
     * @param {number} groupId - 分组 ID
     * @param {boolean} pinned - 是否置顶
     */
    async setGroupPinned(groupId, pinned) {
        try {
            let groups = this.getPinnedGroups();
            if (pinned) {
                groups = groups.filter(id => id !== groupId);
                groups.unshift(groupId);
            } else {
                groups = groups.filter(id => id !== groupId);
            }

            AppState.preferences = AppState.preferences || {};
            AppState.preferences.pinned_groups = groups;
            localStorage.setItem(STORAGE_KEY_PINNED, JSON.stringify(groups));

            try {
                await FeedManager.setPreference('pinned_groups', groups);
            } catch (err) {
                console.error('Sync pinned state error:', err);
            }
        } catch (err) {
            console.error('Save pinned state error:', err);
        }
    },

    /**
     * Setup IntersectionObserver for lazy loading feed icons
     * @param {HTMLElement} container - The scrollable container element
     */
    _setupIconObserver(container) {
        // Disconnect existing observer if any
        if (this._iconObserver) {
            this._iconObserver.disconnect();
        }

        // Create new observer with the feeds list as root
        this._iconObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        const dataSrc = img.dataset.src;
                        if (dataSrc && img.src !== dataSrc) {
                            img.src = dataSrc;
                        }
                        // Stop observing once loaded
                        this._iconObserver.unobserve(img);
                    }
                });
            },
            {
                root: DOMElements.feedsPanel, // Use feeds panel as scroll container
                rootMargin: '50px', // Load slightly before entering viewport
                threshold: 0
            }
        );

        // Observe all feed icons with data-src
        container.querySelectorAll('img.feed-icon[data-src]').forEach(img => {
            this._iconObserver.observe(img);
        });
    }
};
