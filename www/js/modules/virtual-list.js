/**
 * 虚拟滚动列表模块 - 支持动态高度
 * @module virtual-list
 * 动态高度：记录每个卡片的实际高度，使用累积高度精确计算位置
 */

export class VirtualList {
    constructor(options) {
        this.container = options.container;
        this.estimatedItemHeight = options.itemHeight || 85; // 预估单个卡片高度
        this.bufferSize = options.bufferSize || 8;  // 增大缓冲区以平滑滚动
        this.renderItem = options.renderItem;       // 渲染单个项的函数
        this.onItemClick = options.onItemClick;     // 点击事件回调
        this.onLoadMore = options.onLoadMore;       // 加载更多回调
        this.getActiveId = options.getActiveId;     // 获取当前激活项 ID 的回调
        this.onScrolledPast = options.onScrolledPast; // 滚动经过项目时的回调（用于滚动标记已读）

        this.items = [];
        this.scrollTop = 0;
        this.containerHeight = 0;
        this.startIndex = 0;
        this.endIndex = 0;

        // 动态高度相关
        this.itemHeights = new Map();     // 记录每个 item 的实际高度
        this.itemPositions = [];          // 每个 item 的累积位置 (top)

        // 内部元素
        this.wrapper = null;
        this.contentEl = null;
        this.spacerTop = null;
        this.spacerBottom = null;

        // 节流滚动处理
        this.scrollRAF = null;
        this.isScrolling = false;

        // 已渲染的 DOM 元素映射
        this.renderedItems = new Map();

        // 缓存 spacer 高度
        this._lastTopSpace = -1;
        this._lastBottomSpace = -1;

        // 滚动已读追踪
        this._lastScrollTopForRead = 0;
        this._lastReportedReadIndex = -1;  // 上次报告滚动已读的最大索引
        this._scrollEndTimer = null;  // 滚动停止检测定时器

        this.init();
    }

    init() {
        // 创建虚拟列表包装结构
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'virtual-list-wrapper';

        this.spacerTop = document.createElement('div');
        this.spacerTop.className = 'virtual-list-spacer-top';
        this.spacerTop.style.cssText = 'height: 0px; pointer-events: none;';

        this.contentEl = document.createElement('div');
        this.contentEl.className = 'virtual-list-content';

        this.spacerBottom = document.createElement('div');
        this.spacerBottom.className = 'virtual-list-spacer-bottom';
        this.spacerBottom.style.cssText = 'height: 0px; pointer-events: none;';

        this.wrapper.appendChild(this.spacerTop);
        this.wrapper.appendChild(this.contentEl);
        this.wrapper.appendChild(this.spacerBottom);

        // 清空容器并添加虚拟列表
        this.container.innerHTML = '';
        this.container.scrollTop = 0;  // 重置滚动位置，确保每次加载都从顶部开始
        this.container.appendChild(this.wrapper);

        // 滚动事件绑定到父容器
        this.scrollHandler = this.handleScroll.bind(this);
        this.container.addEventListener('scroll', this.scrollHandler, { passive: true });

        // 监听容器大小变化
        this.resizeObserver = new ResizeObserver(() => {
            this.containerHeight = this.container.clientHeight;
            this.render();
        });
        this.resizeObserver.observe(this.container);

        // 独立的 item 尺寸观察器
        this.itemResizeObserver = new ResizeObserver((entries) => {
            let needsRecalculate = false;
            for (const entry of entries) {
                const el = entry.target;
                const id = el.dataset.id;
                if (!id) continue;

                const height = entry.borderBoxSize ? entry.borderBoxSize[0].blockSize : entry.contentRect.height;
                const finalHeight = height + 10; // add margin

                const oldHeight = this.itemHeights.get(id);
                if (oldHeight !== finalHeight) {
                    this.itemHeights.set(id, finalHeight);
                    needsRecalculate = true;
                }
            }

            if (needsRecalculate) {
                // 使用防抖避免频繁重排
                if (this._recalcTimeout) cancelAnimationFrame(this._recalcTimeout);
                this._recalcTimeout = requestAnimationFrame(() => {
                    this._recalcTimeout = null;
                    const oldTotalHeight = this.getTotalHeight();
                    this.calculatePositions();
                    const newTotalHeight = this.getTotalHeight();

                    // 如果总高度变化，可能需要调整滚动位置（如果在上方变化）
                    if (this.containerHeight > 0) {
                        this.render();
                    }
                });
            }
        });

        // 事件委托：处理点击事件
        this.container.addEventListener('click', (e) => {
            const itemEl = e.target.closest('.article-item');
            if (itemEl && this.onItemClick) {
                const id = itemEl.dataset.id;
                // 查找对应的数据 item
                const item = this.items.find(i => i.id == id);
                if (item) {
                    this.onItemClick(item);
                }
            }
        });

        this.containerHeight = this.container.clientHeight;
    }

    handleScroll() {
        if (this.scrollRAF) {
            return;
        }

        this.scrollRAF = requestAnimationFrame(() => {
            this.scrollRAF = null;
            const prevScrollTop = this.scrollTop;
            this.scrollTop = this.container.scrollTop;
            this.render();
            this.checkLoadMore();

            // 检测滚动经过的项目（仅向下滚动时）
            if (this.onScrolledPast && this.scrollTop > this._lastScrollTopForRead) {
                this.checkScrolledPastItems();
            }
            this._lastScrollTopForRead = this.scrollTop;

            // 滚动停止检测（防抖）：用于处理最后一屏的已读标记
            if (this._scrollEndTimer) {
                clearTimeout(this._scrollEndTimer);
            }
            this._scrollEndTimer = setTimeout(() => {
                this._scrollEndTimer = null;
                this.checkVisibleItemsAtBottom();
            }, 300);
        });
    }

    /**
     * 检查是否到达底部，如果是则标记可见区域内的未读项目
     * 用于处理最后一屏无法通过"滚动经过"检测的问题
     */
    checkVisibleItemsAtBottom() {
        if (!this.onScrolledPast || this.items.length === 0) return;

        // 检查是否接近底部（距离底部小于 50px）
        const scrollHeight = this.container.scrollHeight;
        const scrollTop = this.container.scrollTop;
        const clientHeight = this.container.clientHeight;
        const distanceToBottom = scrollHeight - scrollTop - clientHeight;

        if (distanceToBottom > 50) return;  // 未到达底部，不处理

        // 找到可见区域内的未读项目
        const viewportTop = this.scrollTop;
        const viewportBottom = this.scrollTop + this.containerHeight;
        const visibleUnreadItems = [];

        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (item.is_read) continue;

            const itemTop = this.itemPositions[i] || 0;
            const itemHeight = this.itemHeights.get(String(item.id)) || this.estimatedItemHeight;
            const itemBottom = itemTop + itemHeight;

            // 检查项目是否在视口内（至少部分可见）
            if (itemBottom > viewportTop && itemTop < viewportBottom) {
                visibleUnreadItems.push(item);
            }
        }

        if (visibleUnreadItems.length > 0) {
            this.onScrolledPast(visibleUnreadItems);
        }
    }

    /**
     * 检查哪些项目已经滚动经过视口（用于滚动标记已读）
     * 只返回完全滚动过视口顶部的未读项目，且避免重复报告
     */
    checkScrolledPastItems() {
        if (!this.onScrolledPast || this.items.length === 0) return;

        // 找到当前视口顶部的项目索引
        const currentTopIndex = this.findStartIndex(this.scrollTop);

        // 如果当前顶部索引没有前进，不需要检查
        if (currentTopIndex <= this._lastReportedReadIndex) return;

        // 收集从上次报告位置到当前顶部之间的未读项目
        const scrolledPastItems = [];
        for (let i = this._lastReportedReadIndex + 1; i < currentTopIndex; i++) {
            const item = this.items[i];
            if (!item) continue;

            // 检查项目是否在视口上方（已滚动过）且未读
            const itemBottom = (this.itemPositions[i] || 0) +
                (this.itemHeights.get(String(item.id)) || this.estimatedItemHeight);
            if (itemBottom < this.scrollTop && !item.is_read) {
                scrolledPastItems.push(item);
            }
        }

        // 更新已报告的索引
        this._lastReportedReadIndex = currentTopIndex - 1;

        if (scrolledPastItems.length > 0) {
            this.onScrolledPast(scrolledPastItems);
        }
    }

    checkLoadMore() {
        if (!this.onLoadMore) return;

        const scrollHeight = this.container.scrollHeight;
        const scrollTop = this.container.scrollTop;
        const clientHeight = this.container.clientHeight;

        // 提前加载：当距离底部小于 2 个视口高度时开始预加载
        const preloadThreshold = Math.max(800, clientHeight * 2);
        if (scrollHeight - scrollTop - clientHeight < preloadThreshold) {
            this.onLoadMore();
        }
    }

    // 计算所有 item 的位置
    calculatePositions() {
        this.itemPositions = [];
        let currentTop = 0;

        for (let i = 0; i < this.items.length; i++) {
            this.itemPositions.push(currentTop);
            const height = this.itemHeights.get(String(this.items[i].id)) || this.estimatedItemHeight;
            currentTop += height;
        }

        // 添加总高度
        this.itemPositions.push(currentTop);
    }

    // 获取总高度
    getTotalHeight() {
        if (this.itemPositions.length === 0) return 0;
        return this.itemPositions[this.itemPositions.length - 1];
    }

    // 二分查找：根据 scrollTop 找到第一个可见的 item index
    findStartIndex(scrollTop) {
        if (this.itemPositions.length <= 1) return 0;

        let low = 0;
        let high = this.itemPositions.length - 2; // 最后一个是总高度

        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (this.itemPositions[mid] < scrollTop) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        return Math.max(0, low - 1);
    }

    setItems(items) {
        this.items = items;
        // 保留已知高度，只清除不存在的 item
        // 使用字符串类型的 ID 以与 itemResizeObserver 保持一致
        const newIds = new Set(items.map(i => String(i.id)));
        for (const id of this.itemHeights.keys()) {
            if (!newIds.has(id)) {
                this.itemHeights.delete(id);
            }
        }

        // 预计算是否有图片
        this._precalculateHasImage(items);

        this.calculatePositions();
        this.containerHeight = this.container.clientHeight;
        this.scrollTop = this.container.scrollTop;

        // 清空现有渲染项，强制完整重建
        this.renderedItems.clear();
        this.contentEl.innerHTML = '';
        this.startIndex = -1;
        this.endIndex = -1;
        this._lastTopSpace = -1;
        this._lastBottomSpace = -1;
        this._lastReportedReadIndex = -1;  // 重置滚动已读追踪

        this.render();
    }

    appendItems(newItems) {
        this.items = [...this.items, ...newItems];
        this._precalculateHasImage(newItems);
        this.calculatePositions();
        this.render();
    }

    // 将新文章插入到列表开头（静默更新，保持滚动位置）
    prependItems(newItems) {
        if (newItems.length === 0) return;

        // 记录当前滚动位置和第一个可见项的位置信息
        const currentScrollTop = this.container.scrollTop;

        // 找到当前视口中第一个可见的项目
        const firstVisibleIndex = this.findStartIndex(currentScrollTop);
        const firstVisibleItem = this.items[firstVisibleIndex];
        const firstVisibleItemTop = this.itemPositions[firstVisibleIndex] || 0;

        // 计算当前滚动位置相对于第一个可见项顶部的偏移量
        const offsetFromFirstVisible = currentScrollTop - firstVisibleItemTop;

        // 将新项添加到列表开头
        this.items = [...newItems, ...this.items];

        // 为新项设置预估高度（如果没有已知高度）
        for (const item of newItems) {
            if (!this.itemHeights.has(item.id)) {
                this.itemHeights.set(item.id, this.estimatedItemHeight);
            }
        }

        // 重新计算位置
        this._precalculateHasImage(newItems);
        this.calculatePositions();

        // 重置缓存以强制重新渲染
        this.startIndex = -1;
        this.endIndex = -1;
        this._lastTopSpace = -1;
        this._lastBottomSpace = -1;

        // 如果用户在最顶部，保持在顶部
        if (currentScrollTop === 0) {
            this.render();
            return;
        }

        // 找到原来第一个可见项现在的新位置
        if (firstVisibleItem) {
            const newIndex = this.items.findIndex(item => item.id === firstVisibleItem.id);
            if (newIndex >= 0) {
                const newTop = this.itemPositions[newIndex] || 0;
                // 恢复到相同的相对位置
                this.container.scrollTop = newTop + offsetFromFirstVisible;
            }
        }

        this.render();

        // 渲染后测量实际高度并精确调整
        requestAnimationFrame(() => {
            this.measureRenderedItems();
            this.calculatePositions();

            // 再次精确调整滚动位置
            if (firstVisibleItem) {
                const newIndex = this.items.findIndex(item => item.id === firstVisibleItem.id);
                if (newIndex >= 0) {
                    const newTop = this.itemPositions[newIndex] || 0;
                    this.container.scrollTop = newTop + offsetFromFirstVisible;
                }
            }
        });
    }

    getScrollTop() {
        return this.container ? this.container.scrollTop : 0;
    }

    setScrollTop(value) {
        if (this.container) {
            this.container.scrollTop = value;
            this.scrollTop = value;
        }
    }

    // 测量并记录渲染元素的高度
    measureRenderedItems() {
        let needsRecalculate = false;

        for (const [id, el] of this.renderedItems) {
            if (el.parentNode) {
                const height = el.offsetHeight + 10; // 包含 margin-bottom
                const oldHeight = this.itemHeights.get(id);

                if (oldHeight !== height) {
                    this.itemHeights.set(id, height);
                    needsRecalculate = true;
                }
            }
        }

        if (needsRecalculate) {
            this.calculatePositions();
        }
    }

    render() {
        if (!this.items.length) {
            this.contentEl.innerHTML = '<div class="empty-msg" style="padding: 40px 20px; text-align: center; color: var(--text-secondary);">暂无文章</div>';
            this.spacerTop.style.height = '0px';
            this.spacerBottom.style.height = '0px';
            return;
        }

        if (this.containerHeight <= 0) {
            this.containerHeight = this.container.clientHeight;
            if (this.containerHeight <= 0) {
                requestAnimationFrame(() => this.render());
                return;
            }
        }

        // 使用二分查找确定可见范围
        const rawStartIndex = this.findStartIndex(this.scrollTop);
        const newStartIndex = Math.max(0, rawStartIndex - this.bufferSize);

        // 计算 endIndex：找到超出视口底部的第一个 item
        const viewportBottom = this.scrollTop + this.containerHeight;
        let newEndIndex = rawStartIndex;
        while (newEndIndex < this.items.length && this.itemPositions[newEndIndex] < viewportBottom) {
            newEndIndex++;
        }
        newEndIndex = Math.min(this.items.length, newEndIndex + this.bufferSize);

        // 如果范围没变，只更新激活状态
        const rangeChanged = newStartIndex !== this.startIndex || newEndIndex !== this.endIndex;

        if (!rangeChanged) {
            const activeId = this.getActiveId ? this.getActiveId() : null;
            for (const [id, el] of this.renderedItems) {
                const isActive = activeId && id == activeId;
                el.classList.toggle('active', isActive);
            }
            return;
        }

        this.startIndex = newStartIndex;
        this.endIndex = newEndIndex;

        // 计算 spacer 高度
        const topSpace = this.itemPositions[this.startIndex] || 0;
        const totalHeight = this.getTotalHeight();
        const endPosition = this.itemPositions[this.endIndex] || totalHeight;
        const bottomSpace = Math.max(0, totalHeight - endPosition);

        // 只在高度变化时更新 DOM
        if (this._lastTopSpace !== topSpace) {
            this._lastTopSpace = topSpace;
            this.spacerTop.style.height = `${topSpace}px`;
        }
        if (this._lastBottomSpace !== bottomSpace) {
            this._lastBottomSpace = bottomSpace;
            this.spacerBottom.style.height = `${bottomSpace}px`;
        }

        // 差量更新 DOM
        const visibleItems = this.items.slice(this.startIndex, this.endIndex);
        // 确保使用字符串类型的 ID，避免类型不匹配导致的比较失败
        const visibleIds = new Set(visibleItems.map(item => String(item.id)));

        // 移除不再可见的项
        for (const [id, el] of this.renderedItems) {
            if (!visibleIds.has(id)) {
                if (this.itemResizeObserver) this.itemResizeObserver.unobserve(el);
                el.remove();
                this.renderedItems.delete(id);
            }
        }

        const activeId = this.getActiveId ? this.getActiveId() : null;

        // 创建新元素
        const newElements = [];
        visibleItems.forEach((item, idx) => {
            const itemIdStr = String(item.id);
            if (!this.renderedItems.has(itemIdStr)) {
                const el = this.createItemElement(item, this.startIndex + idx);
                this.renderedItems.set(itemIdStr, el);
                newElements.push({ el, idx, item });
            } else {
                const el = this.renderedItems.get(itemIdStr);
                const isActive = activeId && item.id == activeId;
                el.classList.toggle('active', isActive);
                el.classList.toggle('unread', !item.is_read);
            }
        });

        // 插入新元素
        if (newElements.length > 0) {
            if (this.contentEl.children.length === 0) {
                newElements.forEach(({ el }) => {
                    this.contentEl.appendChild(el);
                });
            } else {
                newElements.forEach(({ el, idx }) => {
                    let inserted = false;

                    for (let i = idx + 1; i < visibleItems.length; i++) {
                        const refEl = this.renderedItems.get(String(visibleItems[i].id));
                        if (refEl && refEl.parentNode === this.contentEl) {
                            this.contentEl.insertBefore(el, refEl);
                            inserted = true;
                            break;
                        }
                    }

                    if (!inserted) {
                        for (let i = idx - 1; i >= 0; i--) {
                            const refEl = this.renderedItems.get(String(visibleItems[i].id));
                            if (refEl && refEl.parentNode === this.contentEl) {
                                if (refEl.nextSibling) {
                                    this.contentEl.insertBefore(el, refEl.nextSibling);
                                } else {
                                    this.contentEl.appendChild(el);
                                }
                                inserted = true;
                                break;
                            }
                        }
                    }

                    if (!inserted) {
                        this.contentEl.appendChild(el);
                    }
                });
            }

            // 新元素插入后，测量它们的高度
            requestAnimationFrame(() => {
                this.measureRenderedItems();
            });
        }
    }

    createItemElement(item, index) {
        const el = document.createElement('div');
        el.className = 'article-item';
        el.dataset.id = item.id;
        el.dataset.index = index;

        // 检查是否是简报
        if (item.type === 'digest') {
            el.classList.add('digest-item');
            el.dataset.type = 'digest';
        }

        if (!item.is_read) el.classList.add('unread');

        // 使用预计算的标志，如果没有则回退到实时计算 (兼容性)
        if (item._has_image !== undefined ? item._has_image : this.hasImage(item)) {
            el.classList.add('has-image');
        }

        const activeId = this.getActiveId ? this.getActiveId() : null;
        if (activeId && item.id == activeId) el.classList.add('active');

        el.innerHTML = this.renderItem(item);

        // 观察该元素尺寸变化
        if (this.itemResizeObserver) {
            this.itemResizeObserver.observe(el);
        }

        return el;
    }

    /**
     * 更新当前激活项（确保单选）
     * @param {string|number} activeId 
     */
    updateActiveItem(activeId) {
        for (const [id, el] of this.renderedItems) {
            const isActive = id == activeId;
            if (el.classList.contains('active') !== isActive) {
                el.classList.toggle('active', isActive);
            }
        }
    }

    hasImage(item) {
        return !!item.thumbnail_url;
    }

    _precalculateHasImage(items) {
        for (const item of items) {
            if (item._has_image === undefined) {
                item._has_image = !!item.thumbnail_url;
            }
        }
    }

    updateItem(id, updates) {
        let el = null;
        for (const [key, element] of this.renderedItems) {
            if (key == id) {
                el = element;
                break;
            }
        }

        if (el) {
            if (updates.isActive !== undefined) {
                el.classList.toggle('active', updates.isActive);
            }
            if (updates.is_read !== undefined) {
                el.classList.toggle('unread', !updates.is_read);
            }
        }

        const item = this.items.find(i => i.id == id);
        if (item) {
            if (updates.is_read !== undefined) {
                item.is_read = updates.is_read;
            }
        }
    }

    destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        if (this.itemResizeObserver) {
            this.itemResizeObserver.disconnect();
        }
        if (this.scrollRAF) {
            cancelAnimationFrame(this.scrollRAF);
        }
        if (this._scrollEndTimer) {
            clearTimeout(this._scrollEndTimer);
        }
        if (this.scrollHandler && this.container) {
            this.container.removeEventListener('scroll', this.scrollHandler);
        }
        this.renderedItems.clear();
        this.itemHeights.clear();
        this.items = [];
        if (this.wrapper) {
            this.wrapper.remove();
        }
    }

    enterMinimalMode() {
        const savedScrollTop = this.container.scrollTop;

        const keepCount = 3;
        const centerIndex = this.findStartIndex(this.scrollTop);
        const keepStart = Math.max(0, centerIndex - 1);
        const keepEnd = Math.min(this.items.length, centerIndex + keepCount);

        for (const [id, el] of this.renderedItems) {
            const item = this.items.find(i => i.id == id);
            if (item) {
                const idx = this.items.indexOf(item);
                if (idx < keepStart || idx >= keepEnd) {
                    el.remove();
                    this.renderedItems.delete(id);
                }
            }
        }

        return savedScrollTop;
    }

    exitMinimalMode(savedScrollTop) {
        if (savedScrollTop !== undefined) {
            this.container.scrollTop = savedScrollTop;
        }
        this.scrollTop = this.container.scrollTop;
        this.render();
    }

    scrollToItem(id) {
        const index = this.items.findIndex(item => item.id == id);
        if (index === -1) return;

        // Ensure positions are calculated
        if (this.itemPositions.length === 0) {
            this.calculatePositions();
        }

        const top = this.itemPositions[index];
        const height = this.itemHeights.get(id) || this.estimatedItemHeight;

        // 如果该项已经在视口内，则微调或不滚动
        const containerHeight = this.container.clientHeight;
        const currentScrollTop = this.container.scrollTop;

        // 简单策略：让它尽量居中或者顶部可见
        // 都在视口内则不动，否则滚动到顶部
        if (top < currentScrollTop || (top + height) > (currentScrollTop + containerHeight)) {
            this.container.scrollTop = top;
            this.scrollTop = top;
            this.render();
        }
    }
}
