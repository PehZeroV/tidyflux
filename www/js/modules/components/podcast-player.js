import { Icons } from '../icons.js';
import { i18n } from '../i18n.js';
import { BREAKPOINTS } from '../../constants.js';
import { escapeHtml } from '../view/utils.js';

class PodcastPlayer {
    constructor() {
        // Playback state
        this.audioUrl = '';
        this.title = '';
        this.coverUrl = '';
        this.isPlaying = false;
        this.isLoading = false;
        this.duration = 0;

        // UI state
        this.container = null;
        this.els = null;
        this.isSeeking = false;
        this.rafId = null;

        // Tracks latest play attempt to ignore stale async callbacks
        this.playAttemptId = 0;

        // Persistent native audio element
        this.audio = this.createAudioElement();
    }

    createAudioElement() {
        const audio = document.createElement('audio');
        audio.id = 'podcast-audio';
        audio.preload = 'metadata';
        audio.setAttribute('playsinline', '');
        audio.setAttribute('webkit-playsinline', '');
        audio.style.display = 'none';
        document.body.appendChild(audio);

        audio.addEventListener('loadedmetadata', () => this.onMetadata());
        audio.addEventListener('durationchange', () => this.onMetadata());
        audio.addEventListener('play', () => this.onPlay());
        audio.addEventListener('pause', () => this.onPause());
        audio.addEventListener('ended', () => this.onEnded());
        audio.addEventListener('error', (e) => this.onError(e));

        return audio;
    }

    play(audioUrl, title = '', coverUrl = '') {
        if (!audioUrl) return;

        const isSameAudio = this.audioUrl === audioUrl;

        if (isSameAudio && this.audioUrl) {
            if (!this.container) {
                this.initContainer();
                this.render();
                this.bindEvents();
            }
            this.show();
            if (!this.isPlaying) {
                this.attemptPlay(false);
            }
            return;
        }

        if (this.isLoading) {
            return;
        }

        this.isLoading = true;
        this.isPlaying = false;
        this.duration = 0;
        this.audioUrl = audioUrl;
        this.title = title;
        this.coverUrl = coverUrl;

        if (!this.container) {
            this.initContainer();
        }

        this.render();
        this.bindEvents();
        this.show();

        // Reset source then play immediately inside user gesture context.
        this.audio.pause();
        this.audio.src = audioUrl;
        this.audio.currentTime = 0;
        this.audio.load();

        this.attemptPlay(false);
    }

    // Optional API for compatibility; does not auto-play.
    preload(audioUrl, title = '', coverUrl = '') {
        if (!audioUrl || this.isPlaying) return;
        if (this.audioUrl === audioUrl) return;

        this.audioUrl = audioUrl;
        this.title = title;
        this.coverUrl = coverUrl;
        this.isLoading = true;
        this.duration = 0;

        this.audio.pause();
        this.audio.src = audioUrl;
        this.audio.load();
    }

    attemptPlay(retried) {
        if (!this.audioUrl) return;

        const attemptId = ++this.playAttemptId;
        const playPromise = this.audio.play();

        if (!playPromise || typeof playPromise.catch !== 'function') {
            return;
        }

        playPromise.catch((err) => {
            // Ignore stale attempts.
            if (attemptId !== this.playAttemptId) {
                return;
            }

            if (err && err.name === 'AbortError' && !retried) {
                setTimeout(() => {
                    if (attemptId !== this.playAttemptId) return;
                    if (!this.audioUrl || !this.audio.paused) return;
                    this.attemptPlay(true);
                }, 0);
                return;
            }

            this.isLoading = false;
            this.isPlaying = false;
            this.updatePlayPauseIcon();
            console.error('Native play error:', err);
        });
    }

    onMetadata() {
        const duration = this.audio.duration;
        if (Number.isFinite(duration) && duration > 0) {
            this.duration = duration;
            if (this.els && this.els.totalTime) {
                this.els.totalTime.textContent = this.formatTime(duration);
            }
        }
        this.isLoading = false;
    }

    onPlay() {
        this.isLoading = false;
        this.isPlaying = true;
        this.updatePlayPauseIcon();
        this.startProgress();
    }

    onPause() {
        this.isPlaying = false;
        this.updatePlayPauseIcon();
    }

    onEnded() {
        this.isPlaying = false;
        this.updatePlayPauseIcon();
        if (this.els) {
            this.els.seekSlider.value = 0;
            this.els.currTime.textContent = '0:00';
        }
    }

    onError(err) {
        this.isLoading = false;
        this.isPlaying = false;
        this.updatePlayPauseIcon();
        if (this.audioUrl) {
            console.error('Native audio error:', err);
        }
    }

    initContainer() {
        this.container = document.createElement('div');
        this.container.id = 'persistent-player-container';
        this.container.className = 'persistent-player-container hidden';

        const contentPanel = document.getElementById('content-panel');
        if (contentPanel && window.innerWidth >= BREAKPOINTS.TABLET) {
            contentPanel.appendChild(this.container);
        } else {
            document.body.appendChild(this.container);
        }
    }

    render() {
        if (!this.container) return;

        const safeTitle = escapeHtml(this.title);
        this.container.innerHTML = `
            <div class="player-content">
                <div class="track-info">
                    <span class="track-title" title="${safeTitle}">${safeTitle || i18n.t('player.unknown_title')}</span>
                </div>
                <div class="player-controls-wrapper">
                    <button id="player-prev-btn" class="player-nav-btn" aria-label="${i18n.t('player.prev')}">
                        ${Icons.skip_previous}
                    </button>
                    <button id="player-play-btn" class="player-play-btn" aria-label="${i18n.t('player.play')}">
                        ${this.isPlaying ? Icons.pause : Icons.play_arrow}
                    </button>
                    <button id="player-next-btn" class="player-nav-btn" aria-label="${i18n.t('player.next')}">
                        ${Icons.skip_next}
                    </button>
                </div>
                <div class="player-progress-wrapper">
                    <span id="player-current-time" class="player-time">${this.formatTime(this.audio.currentTime || 0)}</span>
                    <input type="range" id="player-progress-bar" class="player-progress-bar" min="0" max="100" value="0" step="0.1">
                    <span id="player-duration" class="player-time">${this.formatTime(this.duration)}</span>
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

        // Sync initial progress bar.
        if (this.duration > 0 && this.els.seekSlider) {
            this.els.seekSlider.value = (this.audio.currentTime / this.duration) * 100;
        }
    }

    bindEvents() {
        if (!this.els) return;

        this.isSeeking = false;

        this.els.playPauseBtn.addEventListener('click', () => {
            if (!this.audioUrl) return;
            if (this.isPlaying) {
                this.audio.pause();
            } else {
                this.attemptPlay(false);
            }
        });

        this.els.closeBtn.addEventListener('click', () => {
            this.close();
        });

        this.els.seekSlider.addEventListener('touchstart', () => { this.isSeeking = true; }, { passive: true });
        this.els.seekSlider.addEventListener('mousedown', () => { this.isSeeking = true; });

        this.els.seekSlider.addEventListener('input', () => {
            if (this.duration > 0 && this.els) {
                const seekTime = (this.els.seekSlider.value / 100) * this.duration;
                this.els.currTime.textContent = this.formatTime(seekTime);
            }
        });

        this.els.seekSlider.addEventListener('change', () => {
            if (this.duration > 0) {
                const seekTime = (this.els.seekSlider.value / 100) * this.duration;
                this.audio.currentTime = seekTime;
            }
            this.isSeeking = false;
        });

        this.els.seekSlider.addEventListener('mouseup', () => { this.isSeeking = false; });
        this.els.seekSlider.addEventListener('touchend', () => { this.isSeeking = false; });

        this.els.prevBtn.addEventListener('click', () => {
            this.audio.currentTime = Math.max(0, (this.audio.currentTime || 0) - 10);
        });

        this.els.nextBtn.addEventListener('click', () => {
            const maxTime = this.duration > 0 ? this.duration : (this.audio.duration || Infinity);
            this.audio.currentTime = Math.min(maxTime, (this.audio.currentTime || 0) + 30);
        });
    }

    show() {
        if (!this.container) return;
        this.container.classList.remove('hidden');
        document.body.classList.add('player-active');
    }

    hide() {
        if (this.container) {
            this.container.classList.add('hidden');
            document.body.classList.remove('player-active');
        }
        this.audio.pause();
    }

    close() {
        this.playAttemptId++;
        this.stopProgress();

        if (this.container) {
            this.container.remove();
            this.container = null;
        }

        document.body.classList.remove('player-active');

        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();

        this.audioUrl = '';
        this.title = '';
        this.coverUrl = '';
        this.isPlaying = false;
        this.isLoading = false;
        this.duration = 0;
        this.els = null;
    }

    startProgress() {
        this.stopProgress();

        const step = () => {
            if (!this.isPlaying || !this.els) return;

            if (!this.isSeeking) {
                const current = this.audio.currentTime || 0;
                const duration = this.duration || this.audio.duration || 0;

                this.els.currTime.textContent = this.formatTime(current);
                if (duration > 0) {
                    this.els.seekSlider.value = (current / duration) * 100;
                }
            }

            this.rafId = requestAnimationFrame(step);
        };

        this.rafId = requestAnimationFrame(step);
    }

    stopProgress() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    updatePlayPauseIcon() {
        if (this.els && this.els.playPauseBtn) {
            this.els.playPauseBtn.innerHTML = this.isPlaying ? Icons.pause : Icons.play_arrow;
        }
    }

    formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

export const GlobalPodcastPlayer = new PodcastPlayer();
