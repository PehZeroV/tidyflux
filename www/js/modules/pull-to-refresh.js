/**
 * 下拉刷新组件
 * 支持触摸下拉（PWA）和鼠标滚轮下拉（桌面）
 */

const PTR_CONFIG = {
    PULL_THRESHOLD: 60,           // 触发刷新的下拉距离（像素）
    MAX_PULL_DISTANCE: 100,       // 最大下拉距离
    WHEEL_THRESHOLD: 120,         // 滚轮触发刷新的累积距离
    WHEEL_RESET_DELAY: 300,       // 滚轮停止后重置累积距离的延迟
    ANIMATION_DURATION: 200,      // 动画持续时间（毫秒）
};

export class PullToRefresh {
    constructor(container, onRefresh) {
        this.container = container;
        this.onRefresh = onRefresh;
        
        // 状态
        this.isPulling = false;
        this.isRefreshing = false;
        this.startY = 0;
        this.currentY = 0;
        this.pullDistance = 0;
        
        // 滚轮相关
        this.wheelDelta = 0;
        this.wheelResetTimer = null;
        
        // 创建刷新指示器
        this.createRefreshIndicator();
        
        // 绑定事件
        this.bindEvents();
    }
    
    /**
     * 创建刷新指示器 DOM
     */
    createRefreshIndicator() {
        this.indicator = document.createElement('div');
        this.indicator.className = 'ptr-indicator';
        this.indicator.innerHTML = `
            <div class="ptr-spinner">
                <svg class="ptr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                </svg>
                <svg class="ptr-loading" viewBox="0 0 50 50">
                    <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="4"/>
                </svg>
            </div>
            <div class="ptr-text">下拉刷新</div>
        `;
        
        // 插入到容器顶部
        this.container.insertBefore(this.indicator, this.container.firstChild);
    }
    
    /**
     * 绑定触摸和滚轮事件
     */
    bindEvents() {
        // 触摸事件（移动端）
        this.container.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: true });
        this.container.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        this.container.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: true });
        
        // 鼠标滚轮事件（桌面端）
        this.container.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
    }
    
    /**
     * 触摸开始
     */
    handleTouchStart(e) {
        if (this.isRefreshing) return;
        
        // 只在滚动到顶部时才允许下拉
        if (this.container.scrollTop === 0) {
            this.startY = e.touches[0].clientY;
            this.isPulling = true;
        }
    }
    
    /**
     * 触摸移动
     */
    handleTouchMove(e) {
        if (!this.isPulling || this.isRefreshing) return;
        
        this.currentY = e.touches[0].clientY;
        this.pullDistance = Math.max(0, this.currentY - this.startY);
        
        // 限制最大下拉距离
        this.pullDistance = Math.min(this.pullDistance, PTR_CONFIG.MAX_PULL_DISTANCE);
        
        if (this.pullDistance > 0) {
            // 阻止默认滚动行为
            e.preventDefault();
            
            // 应用阻尼效果（越拉越难拉）
            const damping = 0.4;
            const displayDistance = this.pullDistance * damping;
            
            // 更新指示器位置和状态
            this.updateIndicator(displayDistance);
        }
    }
    
    /**
     * 触摸结束
     */
    handleTouchEnd(e) {
        if (!this.isPulling || this.isRefreshing) return;
        
        this.isPulling = false;
        
        // 判断是否达到刷新阈值
        if (this.pullDistance >= PTR_CONFIG.PULL_THRESHOLD) {
            this.triggerRefresh();
        } else {
            this.resetIndicator();
        }
        
        this.pullDistance = 0;
    }
    
    /**
     * 滚轮事件处理（桌面端）
     */
    handleWheel(e) {
        if (this.isRefreshing) return;
        
        // 只在滚动到顶部且向下滚动时处理
        if (this.container.scrollTop === 0 && e.deltaY < 0) {
            // 累积滚轮距离
            this.wheelDelta += Math.abs(e.deltaY);
            
            // 清除之前的重置定时器
            if (this.wheelResetTimer) {
                clearTimeout(this.wheelResetTimer);
            }
            
            // 如果累积距离达到阈值，触发刷新
            if (this.wheelDelta >= PTR_CONFIG.WHEEL_THRESHOLD) {
                e.preventDefault();
                this.triggerRefresh();
                this.wheelDelta = 0;
            } else {
                // 显示刷新提示
                const progress = this.wheelDelta / PTR_CONFIG.WHEEL_THRESHOLD;
                const displayDistance = progress * 30; // 最多显示30px
                this.updateIndicator(displayDistance);
                
                // 设置重置定时器
                this.wheelResetTimer = setTimeout(() => {
                    this.wheelDelta = 0;
                    this.resetIndicator();
                }, PTR_CONFIG.WHEEL_RESET_DELAY);
            }
        } else {
            // 重置滚轮累积距离
            this.wheelDelta = 0;
        }
    }
    
    /**
     * 更新指示器显示
     */
    updateIndicator(distance) {
        const progress = Math.min(distance / (PTR_CONFIG.PULL_THRESHOLD * 0.4), 1);
        
        // 更新位置 - 从顶部向下移动
        this.indicator.style.transform = `translateY(${distance - 60}px)`;
        this.indicator.style.opacity = Math.min(progress * 1.5, 1);
        
        // 更新图标旋转
        const icon = this.indicator.querySelector('.ptr-icon');
        if (icon) {
            const rotation = progress * 360;
            icon.style.transform = `rotate(${rotation}deg)`;
        }
        
        // 更新文本
        const text = this.indicator.querySelector('.ptr-text');
        if (text) {
            text.textContent = progress >= 1 ? '释放刷新' : '下拉刷新';
        }
        
        // 显示指示器
        this.indicator.classList.add('ptr-visible');
    }
    
    /**
     * 重置指示器
     */
    resetIndicator() {
        this.indicator.style.transition = `all ${PTR_CONFIG.ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        this.indicator.style.transform = 'translateY(-60px)';
        this.indicator.style.opacity = '0';
        
        setTimeout(() => {
            this.indicator.classList.remove('ptr-visible', 'ptr-refreshing');
            this.indicator.style.transition = '';
            
            // 重置图标
            const icon = this.indicator.querySelector('.ptr-icon');
            if (icon) {
                icon.style.transform = 'rotate(0deg)';
            }
        }, PTR_CONFIG.ANIMATION_DURATION);
    }
    
    /**
     * 触发刷新
     */
    async triggerRefresh() {
        if (this.isRefreshing) return;
        
        this.isRefreshing = true;
        this.indicator.classList.add('ptr-refreshing');
        
        // 更新指示器为加载状态
        const text = this.indicator.querySelector('.ptr-text');
        if (text) {
            text.textContent = '刷新中...';
        }
        
        // 固定指示器位置
        this.indicator.style.transition = `all ${PTR_CONFIG.ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        this.indicator.style.transform = 'translateY(-20px)';
        this.indicator.style.opacity = '1';
        
        try {
            // 执行刷新回调
            await this.onRefresh();
        } catch (err) {
            console.error('Refresh error:', err);
        } finally {
            // 延迟重置，让用户看到刷新完成
            setTimeout(() => {
                this.isRefreshing = false;
                this.resetIndicator();
            }, 400);
        }
    }
    
    /**
     * 销毁组件
     */
    destroy() {
        if (this.indicator && this.indicator.parentNode) {
            this.indicator.parentNode.removeChild(this.indicator);
        }
        
        if (this.wheelResetTimer) {
            clearTimeout(this.wheelResetTimer);
        }
    }
}
