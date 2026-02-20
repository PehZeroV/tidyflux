/**
 * Gestures - 手势交互模块
 * @module view/gestures
 */

import { DOMElements } from '../../dom.js';
import { AppState } from '../../state.js';
import { BREAKPOINTS } from '../../constants.js';
import { ArticlesView } from './articles-view.js';
import { ArticleContentView } from './article-content.js';

/**
 * 手势判定常量配置
 */
const GESTURE_CONFIG = {
    SWIPE_THRESHOLD: 50,      // 最小滑动距离判定
    EDGE_SIZE: 25,            // 边缘屏蔽区域 (px) - 原生手势保留区
    VELOCITY_THRESHOLD: 0.3,  // 最小爆发速度 (px/ms)
    MOVEMENT_THRESHOLD: 10,   // 开始滑动判定阈值
    QUICK_SWIPE_MIN: 20,      // 结合速度判定的最小距离
    ANGLE_THRESHOLD: 35       // 水平滑动最大允许角度 (度)
};

/**
 * 手势处理模块
 */
export const Gestures = {
    /** 视图管理器引用 */
    viewManager: null,
    /** 是否正从边缘滑动 */
    isFromLeftEdge: false,

    /**
     * 初始化模块
     * @param {Object} viewManager - ViewManager 实例引用
     */
    init(viewManager) {
        this.viewManager = viewManager;
    },

    /**
     * 显示指定面板
     * @param {string} panel - 面板名称: 'feeds', 'articles', 'content'
     */
    showPanel(panel) {
        const panels = {
            feeds: DOMElements.feedsPanel,
            articles: DOMElements.articlesPanel,
            content: DOMElements.contentPanel
        };

        // 如果不是程序控制的导航（即系统返回手势等），禁用动画以避免与浏览器原生手势冲突导致抖动
        const isProgrammatic = this.viewManager?.isProgrammaticNav || false;
        if (!isProgrammatic) {
            Object.values(panels).forEach(p => {
                if (p) p.classList.add('no-transition');
            });
        }

        Object.values(panels).forEach(p => {
            if (p) p.classList.remove('active');
        });

        if (panels[panel]) {
            panels[panel].classList.add('active');
        }

        // 处理从文章列表进入内容页的过渡动画
        if (panel === 'content') {
            if (panels.articles) panels.articles.classList.add('move-left');
        } else {
            if (panels.articles) panels.articles.classList.remove('move-left');
        }

        // 移除 no-transition 类（如果之前添加的话）
        if (!isProgrammatic) {
            // 使用 requestAnimationFrame 避免强制同步重排 (Forced Reflow)
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    Object.values(panels).forEach(p => {
                        if (p) p.classList.remove('no-transition');
                    });
                });
            });
        }

        // 重置标志
        if (this.viewManager) {
            this.viewManager.isProgrammaticNav = false;
        }

        // 更新 body class 用于 CSS
        document.body.classList.remove('panel-feeds', 'panel-articles', 'panel-content');
        document.body.classList.add(`panel-${panel}`);
    },

    /**
     * 检查元素是否在水平可滚动容器内
     * @param {HTMLElement} element - 目标元素
     * @returns {boolean}
     */
    isInHorizontalScrollableContainer(element) {
        let current = element;
        while (current && current !== document.body) {
            const style = window.getComputedStyle(current);
            const overflowX = style.overflowX;
            if ((overflowX === 'auto' || overflowX === 'scroll') && current.scrollWidth > current.clientWidth) {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    },

    /**
     * 检查是否有文本选中
     * @returns {boolean}
     */
    hasTextSelection() {
        const selection = window.getSelection();
        return selection && selection.toString().length > 0;
    },

    /**
     * 绑定滑动手势
     */
    bindSwipeGestures() {
        if (window.innerWidth > BREAKPOINTS.TABLET) return;

        const vm = this.viewManager;
        let startX = 0;
        let startY = 0;
        let currentX = 0;
        let isSwiping = false;
        let isHorizontalSwipe = false;
        let startPanel = null;
        let swipeTarget = null;
        let startTime = 0;

        const getActivePanel = () => {
            if (DOMElements.contentPanel?.classList.contains('active')) return 'content';
            if (DOMElements.articlesPanel?.classList.contains('active')) return 'articles';
            return 'feeds';
        };

        const handleTouchStart = (e) => {
            if (this.hasTextSelection()) return;

            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            currentX = startX;
            startTime = Date.now();
            isSwiping = false;
            isHorizontalSwipe = false;
            startPanel = getActivePanel();
            swipeTarget = e.target;
            this.isFromLeftEdge = startX < GESTURE_CONFIG.EDGE_SIZE;

            // 检查是否在代码块内
            if (swipeTarget.closest('.code-block-wrapper') || swipeTarget.closest('pre')) {
                startX = 0;
                return;
            }

            // 检查是否在播放器控件内
            if (swipeTarget.closest('.persistent-player-container') || swipeTarget.closest('#persistent-player-container')) {
                startX = 0;
                return;
            }

            // 检查是否在上下文菜单内（滑块拖动等不应触发手势）
            if (swipeTarget.closest('.context-menu') || swipeTarget.matches('input[type="range"]')) {
                startX = 0;
                return;
            }

            // 检查是否在可水平滚动的容器内
            if (this.isInHorizontalScrollableContainer(swipeTarget)) {
                startX = 0;
                return;
            }
        };

        const handleTouchMove = (e) => {
            if (!startX) return;

            const touch = e.touches[0];
            const diffX = touch.clientX - startX;
            const diffY = touch.clientY - startY;

            // 确定是水平还是垂直滑动（使用显式角度判定）
            if (!isSwiping && (Math.abs(diffX) > GESTURE_CONFIG.MOVEMENT_THRESHOLD || Math.abs(diffY) > GESTURE_CONFIG.MOVEMENT_THRESHOLD)) {
                isSwiping = true;
                const angle = Math.atan2(Math.abs(diffY), Math.abs(diffX)) * (180 / Math.PI);
                isHorizontalSwipe = angle < GESTURE_CONFIG.ANGLE_THRESHOLD;

                if (!isHorizontalSwipe) {
                    startX = 0;
                    return;
                }
            }

            if (!isHorizontalSwipe) return;

            currentX = touch.clientX;

            // 差异化拦截默认行为：
            // 1. 如果是从左边缘开始的滑动，不要 preventDefault，允许 iOS Safari 触发系统原生返回手势
            // 2. 如果不是从边缘开始，必须 preventDefault，否则 Android Chrome 会在滑动结束后锁定点击事件几百毫秒
            if (this.isFromLeftEdge) {
                return;
            }

            if (e.cancelable) {
                e.preventDefault();
            }
        };

        const handleTouchEnd = () => {
            if (!isHorizontalSwipe || !startX) {
                startX = 0;
                return;
            }

            const diffX = currentX - startX;
            const elapsed = Date.now() - startTime;
            const velocity = Math.abs(diffX) / elapsed;

            const isSwipeRight = diffX > GESTURE_CONFIG.SWIPE_THRESHOLD || (diffX > GESTURE_CONFIG.QUICK_SWIPE_MIN && velocity > GESTURE_CONFIG.VELOCITY_THRESHOLD);
            const isSwipeLeft = diffX < -GESTURE_CONFIG.SWIPE_THRESHOLD || (diffX < -GESTURE_CONFIG.QUICK_SWIPE_MIN && velocity > GESTURE_CONFIG.VELOCITY_THRESHOLD);

            const isFromLeftEdge = startX < GESTURE_CONFIG.EDGE_SIZE;
            const isFromRightEdge = startX > window.innerWidth - GESTURE_CONFIG.EDGE_SIZE;

            if (startPanel === 'content') {
                // 内容页右滑
                if (!isFromLeftEdge && isSwipeRight) {
                    // 如果 AI 对话面板已打开，右滑关闭对话面板而非返回列表
                    const chatPanel = document.querySelector('.ai-chat-panel');
                    if (chatPanel) {
                        ArticleContentView.closeChat();
                        const chatBtn = document.getElementById('article-chat-btn');
                        if (chatBtn) chatBtn.classList.remove('active');
                    } else {
                        if (this.viewManager) {
                            this.viewManager.isProgrammaticNav = true;
                            history.back();
                        }

                        // 恢复滚动位置
                        if (AppState.ui.lastListViewScrollTop !== null) {
                            if (ArticlesView.useVirtualScroll && ArticlesView.virtualList) {
                                ArticlesView.virtualList.setScrollTop(AppState.ui.lastListViewScrollTop);
                            } else if (DOMElements.articlesList) {
                                DOMElements.articlesList.scrollTop = AppState.ui.lastListViewScrollTop;
                            }
                        }
                    }
                }
            } else if (startPanel === 'articles') {
                if ((isFromLeftEdge && isSwipeRight) || isSwipeRight) {
                    // 保存当前列表滚动位置
                    if (DOMElements.articlesList) {
                        if (ArticlesView.useVirtualScroll && ArticlesView.virtualList) {
                            AppState.ui.lastListViewScrollTop = ArticlesView.virtualList.getScrollTop();
                        } else {
                            AppState.ui.lastListViewScrollTop = DOMElements.articlesList.scrollTop;
                        }
                    }

                    // 返回订阅源列表
                    if (this.viewManager) this.viewManager.isProgrammaticNav = true;
                    window.location.hash = '#/feeds';
                } else if ((isFromRightEdge && isSwipeLeft) || isSwipeLeft) {
                    // 进入内容页
                    if (AppState.content.currentArticleId && this.viewManager?.selectArticle) {
                        this.viewManager.selectArticle(AppState.content.currentArticleId);
                    }
                }
            } else if (startPanel === 'feeds') {
                if ((isFromRightEdge && isSwipeLeft) || isSwipeLeft) {
                    if (this.viewManager) {
                        this.viewManager.isProgrammaticNav = true;
                        history.back();
                    }
                }
            }

            startX = 0;
            startY = 0;
            currentX = 0;
            isSwiping = false;
            isHorizontalSwipe = false;
        };

        document.addEventListener('touchstart', handleTouchStart, { passive: true });
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd, { passive: true });
    }
};

