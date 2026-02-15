/**
 * 面板拖拽调节宽度模块
 * 支持拖拽 resize handle 调节左侧订阅源面板的宽度
 * 宽度偏好会自动保存到 localStorage
 */

const STORAGE_KEY = 'tidyflux-feeds-panel-width';
const MIN_WIDTH = 140;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 200;

/**
 * 初始化面板拖拽功能
 */
export function initPanelResizer() {
    const feedsPanel = document.getElementById('feeds-panel');
    const resizeHandle = document.getElementById('feeds-resize-handle');

    if (!feedsPanel || !resizeHandle) return;

    // 从 localStorage 恢复用户保存的宽度
    const savedWidth = localStorage.getItem(STORAGE_KEY);
    if (savedWidth) {
        const width = parseInt(savedWidth, 10);
        if (width >= MIN_WIDTH && width <= MAX_WIDTH) {
            feedsPanel.style.width = width + 'px';
        }
    }

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    /**
     * 鼠标按下 - 开始拖拽
     */
    const onMouseDown = (e) => {
        // 仅响应左键
        if (e.button !== 0) return;

        e.preventDefault();
        e.stopPropagation();

        isResizing = true;
        startX = e.clientX;
        startWidth = feedsPanel.getBoundingClientRect().width;

        // 添加状态 class
        document.body.classList.add('panel-resizing');
        resizeHandle.classList.add('resizing');

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    /**
     * 鼠标移动 - 拖拽中
     */
    const onMouseMove = (e) => {
        if (!isResizing) return;

        const deltaX = e.clientX - startX;
        let newWidth = startWidth + deltaX;

        // 限制范围
        newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));

        feedsPanel.style.width = newWidth + 'px';
    };

    /**
     * 鼠标松开 - 结束拖拽
     */
    const onMouseUp = () => {
        if (!isResizing) return;

        isResizing = false;

        // 移除状态 class
        document.body.classList.remove('panel-resizing');
        resizeHandle.classList.remove('resizing');

        // 保存当前宽度到 localStorage
        const finalWidth = Math.round(feedsPanel.getBoundingClientRect().width);
        localStorage.setItem(STORAGE_KEY, finalWidth.toString());

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    };

    // 绑定鼠标事件
    resizeHandle.addEventListener('mousedown', onMouseDown);

    // 双击重置为默认宽度
    resizeHandle.addEventListener('dblclick', () => {
        feedsPanel.style.width = DEFAULT_WIDTH + 'px';
        localStorage.setItem(STORAGE_KEY, DEFAULT_WIDTH.toString());
    });
}
