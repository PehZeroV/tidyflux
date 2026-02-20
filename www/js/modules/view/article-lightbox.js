/**
 * ArticleLightboxMixin - 图片大图查看器模块
 * @module view/article-lightbox
 *
 * 通过 Mixin 模式合并到 ArticleContentView
 * - _openImageLightbox: 图片大图 lightbox（缩放 + 平移 + 切换）
 */

import { DOMElements } from '../../dom.js';

export const ArticleLightboxMixin = {
    /**
     * 打开图片大图 lightbox
     * @param {string} src - 图片 URL
     */
    _openImageLightbox(src) {
        // 移除已有的 lightbox
        const existing = document.querySelector('.image-lightbox-overlay');
        if (existing) existing.remove();

        // 收集当前文章内所有非 favicon 图片
        const allImages = Array.from(
            (DOMElements.articleContent || document).querySelectorAll('img:not(.favicon)')
        ).map(img => img.src).filter(Boolean);

        let currentIndex = allImages.indexOf(src);
        if (currentIndex === -1) {
            currentIndex = allImages.findIndex(s => s.includes(src) || src.includes(s));
            if (currentIndex === -1) {
                allImages.push(src);
                currentIndex = allImages.length - 1;
            }
        }

        const hasMultiple = allImages.length > 1;

        const overlay = document.createElement('div');
        overlay.className = 'image-lightbox-overlay';
        overlay.innerHTML = `
            <button class="image-lightbox-close" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            ${hasMultiple ? `<button class="image-lightbox-nav image-lightbox-prev" aria-label="Previous">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>` : ''}
            <div class="image-lightbox-img-wrapper">
                <img src="${src}" alt="" draggable="false" />
            </div>
            ${hasMultiple ? `<button class="image-lightbox-nav image-lightbox-next" aria-label="Next">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
            </button>` : ''}
            ${hasMultiple ? `<div class="image-lightbox-counter">${currentIndex + 1} / ${allImages.length}</div>` : ''}
            <div class="image-lightbox-zoom-indicator"></div>
        `;
        document.body.appendChild(overlay);

        // 动画展开
        requestAnimationFrame(() => overlay.classList.add('active'));

        const imgWrapper = overlay.querySelector('.image-lightbox-img-wrapper');
        const imgEl = overlay.querySelector('img');
        const counterEl = overlay.querySelector('.image-lightbox-counter');
        const prevBtn = overlay.querySelector('.image-lightbox-prev');
        const nextBtn = overlay.querySelector('.image-lightbox-next');
        const zoomIndicator = overlay.querySelector('.image-lightbox-zoom-indicator');

        // === 缩放状态 ===
        let scale = 1;
        let translateX = 0;
        let translateY = 0;
        const MIN_SCALE = 1;
        const MAX_SCALE = 5;
        let zoomIndicatorTimer = null;

        const applyTransform = () => {
            imgEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        };

        const clampTranslation = () => {
            if (scale <= 1) {
                translateX = 0;
                translateY = 0;
                return;
            }
            // 使用视口作为边界，允许图片在整个屏幕范围内平移
            const displayW = imgEl.offsetWidth * scale;
            const displayH = imgEl.offsetHeight * scale;
            const maxTx = Math.max(0, (displayW - window.innerWidth) / 2 + window.innerWidth * 0.1);
            const maxTy = Math.max(0, (displayH - window.innerHeight) / 2 + window.innerHeight * 0.1);
            translateX = Math.max(-maxTx, Math.min(maxTx, translateX));
            translateY = Math.max(-maxTy, Math.min(maxTy, translateY));
        };

        const showZoomIndicator = () => {
            const pct = Math.round(scale * 100);
            zoomIndicator.textContent = `${pct}%`;
            zoomIndicator.classList.add('visible');
            clearTimeout(zoomIndicatorTimer);
            zoomIndicatorTimer = setTimeout(() => {
                zoomIndicator.classList.remove('visible');
            }, 800);
        };

        const setZoom = (newScale, originX, originY) => {
            const oldScale = scale;
            scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
            if (scale === oldScale) return;

            // 缩放后调整平移，使缩放中心点不变
            if (originX !== undefined && originY !== undefined) {
                const wrapperRect = imgWrapper.getBoundingClientRect();
                const cx = originX - wrapperRect.left - wrapperRect.width / 2;
                const cy = originY - wrapperRect.top - wrapperRect.height / 2;
                translateX = cx - (cx - translateX) * (scale / oldScale);
                translateY = cy - (cy - translateY) * (scale / oldScale);
            }

            if (scale <= 1) {
                translateX = 0;
                translateY = 0;
            }
            clampTranslation();
            applyTransform();
            updateCursor();
            showZoomIndicator();
        };

        const resetZoom = () => {
            scale = 1;
            translateX = 0;
            translateY = 0;
            applyTransform();
            updateCursor();
        };

        const updateCursor = () => {
            if (scale > 1) {
                imgEl.style.cursor = 'grab';
            } else {
                imgEl.style.cursor = 'zoom-in';
            }
        };
        updateCursor();

        const updateNav = () => {
            if (!hasMultiple) return;
            prevBtn.classList.toggle('disabled', currentIndex === 0);
            nextBtn.classList.toggle('disabled', currentIndex === allImages.length - 1);
        };
        updateNav();

        const showImage = (index) => {
            if (index < 0 || index >= allImages.length) return;
            currentIndex = index;
            imgEl.src = allImages[currentIndex];
            if (counterEl) counterEl.textContent = `${currentIndex + 1} / ${allImages.length}`;
            updateNav();
            resetZoom();
        };

        const closeLightbox = () => {
            overlay.classList.remove('active');
            clearTimeout(zoomIndicatorTimer);
            setTimeout(() => overlay.remove(), 250);
            document.removeEventListener('keydown', keyHandler);
        };

        // === 鼠标滚轮缩放 ===
        imgWrapper.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY > 0 ? -0.15 : 0.15;
            setZoom(scale * (1 + delta), e.clientX, e.clientY);
        }, { passive: false });

        // === 桌面端单击缩放（区分拖拽和点击）===
        let touchHandledZoom = false;
        imgEl.addEventListener('click', (e) => {
            e.stopPropagation();
            // 触摸端已经处理过缩放，跳过合成 click
            if (touchHandledZoom) {
                touchHandledZoom = false;
                return;
            }
            // 如果刚刚拖拽过，不触发缩放
            if (wasDragged) {
                wasDragged = false;
                return;
            }
            if (scale > 1) {
                resetZoom();
                showZoomIndicator();
            } else {
                setZoom(2, e.clientX, e.clientY);
            }
        });

        // === 鼠标拖拽平移（缩放状态）===
        let isDragging = false;
        let wasDragged = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragStartTx = 0;
        let dragStartTy = 0;

        imgEl.addEventListener('mousedown', (e) => {
            if (scale <= 1) return;
            e.preventDefault();
            isDragging = true;
            wasDragged = false;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            dragStartTx = translateX;
            dragStartTy = translateY;
            imgEl.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            // 移动超过 5px 才算拖拽，避免微小抖动误判
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                wasDragged = true;
            }
            translateX = dragStartTx + dx;
            translateY = dragStartTy + dy;
            clampTranslation();
            applyTransform();
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                updateCursor();
            }
        });

        // 点击遮罩或关闭按钮关闭（仅在非缩放且非拖拽状态）
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('.image-lightbox-close')) {
                closeLightbox();
            }
        });

        // 上一张 / 下一张点击
        if (prevBtn) prevBtn.addEventListener('click', (e) => { e.stopPropagation(); showImage(currentIndex - 1); });
        if (nextBtn) nextBtn.addEventListener('click', (e) => { e.stopPropagation(); showImage(currentIndex + 1); });

        // 键盘：ESC 关闭
        const keyHandler = (e) => {
            if (e.key === 'Escape') closeLightbox();
        };
        document.addEventListener('keydown', keyHandler);

        // === 触摸手势：捏合缩放 + 拖拽平移 + 单击缩放 + 滑动切换 ===
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTx = 0;
        let touchStartTy = 0;
        let touchStartTime = 0;
        let initialPinchDist = 0;
        let initialPinchScale = 1;
        let isPinching = false;
        let touchMoved = false;

        const getTouchDist = (touches) => {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        };

        const getTouchCenter = (touches) => ({
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2,
        });

        overlay.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            if (e.touches.length === 2) {
                // 双指捏合开始
                e.preventDefault();
                isPinching = true;
                initialPinchDist = getTouchDist(e.touches);
                initialPinchScale = scale;
            } else if (e.touches.length === 1) {
                const t = e.touches[0];
                touchStartX = t.clientX;
                touchStartY = t.clientY;
                touchStartTx = translateX;
                touchStartTy = translateY;
                touchStartTime = Date.now();
                touchMoved = false;
            }
        }, { passive: false });

        overlay.addEventListener('touchmove', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isPinching && e.touches.length === 2) {
                const dist = getTouchDist(e.touches);
                const center = getTouchCenter(e.touches);
                const newScale = initialPinchScale * (dist / initialPinchDist);
                setZoom(newScale, center.x, center.y);
            } else if (e.touches.length === 1) {
                const t = e.touches[0];
                const dx = t.clientX - touchStartX;
                const dy = t.clientY - touchStartY;
                if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                    touchMoved = true;
                }
                if (scale > 1) {
                    // 缩放状态下拖拽平移
                    translateX = touchStartTx + dx;
                    translateY = touchStartTy + dy;
                    clampTranslation();
                    applyTransform();
                }
            }
        }, { passive: false });

        overlay.addEventListener('touchend', (e) => {
            e.stopPropagation();
            if (isPinching) {
                isPinching = false;
                if (scale < 1) {
                    resetZoom();
                    showZoomIndicator();
                }
                return;
            }

            if (e.changedTouches.length !== 1) return;
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = e.changedTouches[0].clientY - touchStartY;
            const elapsed = Date.now() - touchStartTime;

            // 滑动切换（非缩放状态，水平滑动 > 50px）
            if (scale <= 1 && hasMultiple && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
                if (dx < 0) showImage(currentIndex + 1);
                else showImage(currentIndex - 1);
                return;
            }

            // 单击缩放（移动 < 10px 且时间 < 300ms）
            if (!touchMoved && elapsed < 300) {
                touchHandledZoom = true;
                if (scale > 1) {
                    resetZoom();
                    showZoomIndicator();
                } else {
                    setZoom(2, e.changedTouches[0].clientX, e.changedTouches[0].clientY);
                }
            }
        }, { passive: false });
    },
};
