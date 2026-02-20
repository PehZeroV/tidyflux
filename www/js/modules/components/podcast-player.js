import { Icons } from '../icons.js';
import { i18n } from '../i18n.js';
import { BREAKPOINTS } from '../../constants.js';

class PodcastPlayer {
    constructor() {
        this.container = null;
        this.audioUrl = '';
        this.title = '';
        this.coverUrl = '';
        this.sound = null;
        this.isPlaying = false;
        this.isLoading = false;
        this.duration = 0;
        this.els = null;

        // Preload Howler to minimize delay on first click
        this.ensureHowlerLoaded().catch(() => { });
    }

    async play(audioUrl, title = '', coverUrl = '') {
        // Prevent multiple rapid clicks
        if (this.isLoading) {
            return;
        }

        // If playing same audio, just expand/show
        if (this.audioUrl === audioUrl && this.sound) {
            this.show();
            if (!this.isPlaying) {
                this.sound.play();
            }
            return;
        }

        this.isLoading = true;

        // Stop previous
        if (this.sound) {
            this.sound.unload();
            this.sound = null;
        }

        this.audioUrl = audioUrl;
        this.title = title;
        this.coverUrl = coverUrl;
        this.isPlaying = false;
        this.duration = 0;

        // Best effort to keep user gesture sync:
        // If Howl is not loaded, we must await. This might break iOS autoplay on first run.
        if (!window.Howl) {
            await this.ensureHowlerLoaded();
        }

        if (!this.container) {
            this.initContainer();
        }

        this.render();
        this.bindEvents();
        this.initHowl();
        this.show();
    }

    async ensureHowlerLoaded() {
        if (window.Howl) return;

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/js/lib/howler.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    initContainer() {
        // Match ID and Class from synthdaily
        this.container = document.createElement('div');
        this.container.id = 'persistent-player-container';
        this.container.className = 'persistent-player-container hidden';

        // On desktop, append to content-panel for proper alignment
        // On mobile, append to body
        const contentPanel = document.getElementById('content-panel');
        if (contentPanel && window.innerWidth >= BREAKPOINTS.TABLET) {
            contentPanel.appendChild(this.container);
        } else {
            document.body.appendChild(this.container);
        }
    }

    show() {
        if (this.container) {
            this.container.classList.remove('hidden');
            document.body.classList.add('player-active');
        }
    }

    hide() {
        if (this.container) {
            this.container.classList.add('hidden');
            document.body.classList.remove('player-active');
        }
        if (this.sound) {
            this.sound.pause();
        }
    }

    close() {
        // Completely remove from DOM
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
        document.body.classList.remove('player-active');

        if (this.sound) {
            this.sound.unload();
            this.sound = null;
        }

        // Reset state
        this.isPlaying = false;
        this.audioUrl = '';
        this.title = '';
        this.coverUrl = '';
        this.duration = 0;
        this.els = null;
    }

    render() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="player-content">
                <div class="track-info">
                    <span class="track-title" title="${this.title}">${this.title || i18n.t('player.unknown_title')}</span>
                </div>
                <div class="player-controls-wrapper">
                     <button id="player-prev-btn" class="player-nav-btn" aria-label="${i18n.t('player.prev')}">
                        ${Icons.skip_previous}
                    </button>
                    <button id="player-play-btn" class="player-play-btn" aria-label="${i18n.t('player.play')}">
                        ${Icons.play_arrow}
                    </button>
                    <button id="player-next-btn" class="player-nav-btn" aria-label="${i18n.t('player.next')}">
                        ${Icons.skip_next}
                    </button>
                </div>
                <div class="player-progress-wrapper">
                    <span id="player-current-time" class="player-time">0:00</span>
                    <input type="range" id="player-progress-bar" class="player-progress-bar" min="0" max="100" value="0" step="0.1">
                    <span id="player-duration" class="player-time">0:00</span>
                </div>
                <button id="player-close-btn" class="player-close-btn" aria-label="${i18n.t('player.close')}">
                    ${Icons.close}
                </button>
            </div>
        `;

        this.els = {
            playPauseBtn: this.container.querySelector('#player-play-btn'),
            seekSlider: this.container.querySelector('#player-progress-bar'),
            currTime: this.container.querySelector('#player-current-time'),
            totalTime: this.container.querySelector('#player-duration'),
            closeBtn: this.container.querySelector('#player-close-btn'),
            prevBtn: this.container.querySelector('#player-prev-btn'),
            nextBtn: this.container.querySelector('#player-next-btn')
        };
    }

    initHowl() {
        this.sound = new Howl({
            src: [this.audioUrl],
            html5: true,
            onload: () => {
                this.isLoading = false;
                this.duration = this.sound.duration();
                if (this.els && this.els.totalTime) {
                    this.els.totalTime.textContent = this.formatTime(this.duration);
                }
                // Don't call play() here, it's too late for iOS gesture if we waited for load
            },
            onplay: () => {
                this.isPlaying = true;
                this.updatePlayPauseIcon();
                requestAnimationFrame(this.step.bind(this));
            },
            onpause: () => {
                this.isPlaying = false;
                this.updatePlayPauseIcon();
            },
            onstop: () => {
                this.isPlaying = false;
                this.updatePlayPauseIcon();
            },
            onend: () => {
                this.isPlaying = false;
                this.updatePlayPauseIcon();
                if (this.els && this.els.seekSlider) this.els.seekSlider.value = 0;
                if (this.els && this.els.currTime) this.els.currTime.textContent = '0:00';
            },
            onloaderror: (id, err) => {
                this.isLoading = false;
                console.error('Howl load error:', err);
            },
            onplayerror: (id, err) => {
                this.isPlaying = false;
                this.updatePlayPauseIcon();
                console.error('Howl play error:', err);
            }
        });

        // Call play immediately to satisfy iOS gesture requirement
        this.sound.play();
    }

    bindEvents() {
        if (!this.els) return;

        this.els.playPauseBtn.addEventListener('click', () => {
            if (this.isPlaying) {
                this.sound.pause();
            } else {
                this.sound.play();
            }
        });

        this.els.closeBtn.addEventListener('click', () => {
            this.close();
        });

        // Add seeking logic...
        let isSeeking = false;

        this.els.seekSlider.addEventListener('mousedown', () => { isSeeking = true; });
        this.els.seekSlider.addEventListener('touchstart', () => { isSeeking = true; }, { passive: true });

        this.els.seekSlider.addEventListener('input', () => {
            if (this.duration) {
                const seekTime = (this.els.seekSlider.value / 100) * this.duration;
                this.els.currTime.textContent = this.formatTime(seekTime);
            }
        });

        this.els.seekSlider.addEventListener('change', () => {
            if (this.sound && this.duration) {
                const seekTime = (this.els.seekSlider.value / 100) * this.duration;
                this.sound.seek(seekTime);
            }
            isSeeking = false;
        });

        this.els.seekSlider.addEventListener('mouseup', () => { isSeeking = false; });
        this.els.seekSlider.addEventListener('touchend', () => { isSeeking = false; });

        this.els.prevBtn.addEventListener('click', () => {
            if (this.sound) {
                const cur = this.sound.seek();
                this.sound.seek(Math.max(0, cur - 10));
            }
        });

        this.els.nextBtn.addEventListener('click', () => {
            if (this.sound) {
                const cur = this.sound.seek();
                this.sound.seek(Math.min(this.duration, cur + 30));
            }
        });

        this.isSeeking = () => isSeeking;
    }

    step() {
        if (!this.sound || !this.isPlaying) return;

        if (!this.isSeeking()) {
            const seek = this.sound.seek() || 0;
            const duration = this.duration || 1;
            if (this.els && this.els.currTime) this.els.currTime.textContent = this.formatTime(seek);
            if (this.els && this.els.seekSlider) {
                this.els.seekSlider.value = (seek / duration) * 100;
            }
        }

        requestAnimationFrame(this.step.bind(this));
    }

    updatePlayPauseIcon() {
        if (this.els && this.els.playPauseBtn) {
            this.els.playPauseBtn.innerHTML = this.isPlaying ? Icons.pause : Icons.play_arrow;
        }
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')} `;
    }
}

export const GlobalPodcastPlayer = new PodcastPlayer();
