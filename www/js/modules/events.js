/**
 * 事件处理模块 - Tidyflux
 * @module events
 */


import { DOMElements } from '../dom.js';
import { AppState } from '../state.js';
import { showToast } from './view/utils.js';
import { i18n } from './i18n.js';
import { KeyboardShortcuts } from './keyboard.js';

const GESTURE_EDGE_THRESHOLD = 30;
const GESTURE_MIN_SWIPE_DISTANCE = 80;
const GESTURE_MAX_VERTICAL_DEVIATION = 100;
const CLASS_ARTICLE_VIEW_ACTIVE = 'article-view-active';

/* ========================================
   下拉刷新 (仅触摸设备)
   ======================================== */

const PTR = {
    THRESHOLD: 300,          // 触发刷新的下拉像素
    MAX_DISTANCE: 400,       // 最大下拉距离
    DAMPING: 0.45,           // 阻尼系数
    INDICATOR_HEIGHT: 50,    // 指示器高度
};

let ptrState = {
    active: false,
    refreshing: false,
    startY: 0,
    distance: 0,
    indicator: null,
    viewManager: null,      // will be set later
};

/**
 * 创建下拉刷新指示器 DOM
 */
function createPtrIndicator() {
    if (ptrState.indicator) return;

    const el = document.createElement('div');
    el.className = 'ptr-indicator';
    el.innerHTML = `
        <div class="ptr-spinner">
            <svg class="ptr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            <svg class="ptr-loading" viewBox="0 0 50 50">
                <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="4"/>
            </svg>
        </div>
        <div class="ptr-text"></div>
    `;

    // Insert into articles panel (parent of articles-list), positioned absolutely
    const container = DOMElements.articlesList;
    const panel = container?.parentElement;
    if (panel) {
        panel.insertBefore(el, panel.firstChild);
    }

    // 确保列表容器有 will-change 以优化动画性能
    if (container) {
        container.style.willChange = 'transform';
    }

    ptrState.indicator = el;
}

/**
 * 更新指示器位置与文案
 */
function updatePtrIndicator(displayDist) {
    const ind = ptrState.indicator;
    const container = DOMElements.articlesList;
    if (!ind) return;

    const progress = Math.min(displayDist / (PTR.THRESHOLD * PTR.DAMPING), 1);

    // 移除过渡（实时拖拽不应有动画）
    ind.classList.remove('ptr-animating');
    ind.style.transform = `translateY(${displayDist - PTR.INDICATOR_HEIGHT}px)`;
    ind.style.opacity = String(Math.min(progress * 1.5, 1));
    ind.classList.add('ptr-visible');

    // 整个列表跟随下移
    if (container) {
        container.style.transition = 'none';
        container.style.transform = `translateY(${displayDist}px)`;
    }

    // 旋转图标
    const icon = ind.querySelector('.ptr-icon');
    if (icon) icon.style.transform = `rotate(${progress * 180}deg)`;

    // 更新文案
    const text = ind.querySelector('.ptr-text');
    if (text) {
        text.textContent = progress >= 1
            ? i18n.t('common.release_to_refresh')
            : i18n.t('common.pull_to_refresh');
    }
}

/**
 * 重置指示器（带动画）
 */
function resetPtrIndicator() {
    const ind = ptrState.indicator;
    const container = DOMElements.articlesList;
    if (!ind) return;

    const duration = '0.25s';
    const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';

    ind.classList.add('ptr-animating');
    ind.style.transform = `translateY(-${PTR.INDICATOR_HEIGHT}px)`;
    ind.style.opacity = '0';

    // 列表弹回原位
    if (container) {
        container.style.transition = `transform ${duration} ${easing}`;
        container.style.transform = 'translateY(0)';
    }

    setTimeout(() => {
        ind.classList.remove('ptr-visible', 'ptr-refreshing', 'ptr-animating');
        const icon = ind.querySelector('.ptr-icon');
        if (icon) icon.style.transform = '';
        // 清除列表容器的 transition，避免影响后续操作
        if (container) {
            container.style.transition = '';
            container.style.transform = '';
        }
    }, 260);
}

/**
 * 执行刷新
 */
async function doRefresh() {
    if (ptrState.refreshing) return;
    ptrState.refreshing = true;

    const ind = ptrState.indicator;
    if (ind) {
        ind.classList.add('ptr-refreshing');
        const text = ind.querySelector('.ptr-text');
        if (text) text.textContent = i18n.t('common.ptr_refreshing');

        // 固定指示器在可见位置
        const holdDist = PTR.INDICATOR_HEIGHT + 5;
        ind.classList.add('ptr-animating');
        ind.style.transform = 'translateY(0px)';
        ind.style.opacity = '1';

        // 列表保持下移，为指示器腾出空间
        const container = DOMElements.articlesList;
        if (container) {
            container.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
            container.style.transform = `translateY(${holdDist}px)`;
        }
    }

    try {
        // 仅从 Miniflux 重新拉取文章列表（轻量操作），不触发订阅源刷新
        if (ptrState.viewManager) {
            await Promise.all([
                ptrState.viewManager.loadArticles(AppState.currentFeedId, AppState.currentGroupId),
                ptrState.viewManager.loadFeeds()
            ]);
        }
    } catch (err) {
        console.error('Pull-to-refresh error:', err);
        showToast(err.message || i18n.t('common.refresh_failed'), 2000, true);
    } finally {
        // 短暂延迟让用户看到完成状态
        setTimeout(() => {
            ptrState.refreshing = false;
            resetPtrIndicator();
        }, 300);
    }
}

// 下拉刷新
function setupPullToRefresh(viewManager) {
    // 仅在触摸设备上启用
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice) return;

    const container = DOMElements.articlesList;
    if (!container) return;

    ptrState.viewManager = viewManager;
    createPtrIndicator();

    container.addEventListener('touchstart', (e) => {
        if (ptrState.refreshing) return;
        // 所有列表视图均支持下拉刷新
        if (container.scrollTop <= 0) {
            ptrState.startY = e.touches[0].clientY;
            ptrState.active = true;
            ptrState.distance = 0;
        }
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (!ptrState.active || ptrState.refreshing) return;

        const dy = e.touches[0].clientY - ptrState.startY;
        if (dy <= 0) {
            // 向上滑动，取消
            ptrState.active = false;
            resetPtrIndicator();
            return;
        }

        // 如果容器已滚动离开顶部（可能开始时在顶部但后来惯性上滑了），忽略
        if (container.scrollTop > 0) {
            ptrState.active = false;
            resetPtrIndicator();
            return;
        }

        e.preventDefault();

        ptrState.distance = Math.min(dy, PTR.MAX_DISTANCE);
        const displayDist = ptrState.distance * PTR.DAMPING;
        updatePtrIndicator(displayDist);
    }, { passive: false });

    container.addEventListener('touchend', () => {
        if (!ptrState.active || ptrState.refreshing) return;
        ptrState.active = false;

        if (ptrState.distance >= PTR.THRESHOLD) {
            doRefresh();
        } else {
            resetPtrIndicator();
        }
        ptrState.distance = 0;
    }, { passive: true });

    container.addEventListener('touchcancel', () => {
        ptrState.active = false;
        ptrState.distance = 0;
        resetPtrIndicator();
    }, { passive: true });
}

// 滑动手势
function setupSwipeGesture() {
    let touchStartX = 0;
    let touchStartY = 0;

    document.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const deltaX = touchEndX - touchStartX;
        const deltaY = Math.abs(touchEndY - touchStartY);

        // 从左边缘向右滑动返回
        if (touchStartX < GESTURE_EDGE_THRESHOLD && deltaX > GESTURE_MIN_SWIPE_DISTANCE && deltaY < GESTURE_MAX_VERTICAL_DEVIATION) {
            if (DOMElements.body.classList.contains(CLASS_ARTICLE_VIEW_ACTIVE)) {
                history.back();
            }
        }
    }, { passive: true });
}





let _setupDone = false;

// 全局事件监听
export function setupEventListeners(viewManager) {
    if (_setupDone) {
        // If already set up, just re-init keyboard shortcuts (to update viewManager ref)
        KeyboardShortcuts.init(viewManager);
        return;
    }
    _setupDone = true;
    setupPullToRefresh(viewManager);
    setupSwipeGesture();
    KeyboardShortcuts.init(viewManager);
}
