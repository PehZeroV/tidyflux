import { getMinifluxClient } from '../middleware/auth.js';
import {
    cleanupStaticPublicRssFiles,
    generateAndStoreStaticPublicRss,
    getStaticEnabledFeedIds,
    loadSingleUserContext
} from '../services/public-rss-service.js';

const FULL_REBUILD_INTERVAL = 15 * 60 * 1000;
const START_DELAY = 45000;
const SOON_DELAY = 1500;

export const PublicRssScheduler = {
    _started: false,
    _running: false,
    _scheduledTimer: null,
    _pendingFeedIds: new Set(),
    _forceFullRun: true,

    start() {
        if (this._started) return;
        this._started = true;
        console.log('[Public RSS] Scheduler starting...');
        this._schedule(START_DELAY);
    },

    notifyConfigChanged() {
        this._forceFullRun = true;
        if (!this._running) {
            this._schedule(SOON_DELAY);
        }
    },

    markFeedsDirty(feedIds = []) {
        feedIds.forEach(feedId => {
            if (feedId == null) return;
            this._pendingFeedIds.add(String(feedId));
        });
        if (!this._running) {
            this._schedule(SOON_DELAY);
        }
    },

    _schedule(delay = FULL_REBUILD_INTERVAL) {
        if (this._scheduledTimer) {
            clearTimeout(this._scheduledTimer);
        }
        this._scheduledTimer = setTimeout(() => this._run(), delay);
        if (this._scheduledTimer.unref) this._scheduledTimer.unref();
    },

    async _run() {
        if (this._running) return;

        const shouldRunFull = this._forceFullRun || this._pendingFeedIds.size === 0;
        const pendingFeedIds = [...this._pendingFeedIds];
        this._forceFullRun = false;
        this._pendingFeedIds.clear();

        try {
            this._running = true;
            const miniflux = await getMinifluxClient();
            if (!miniflux) return;

            const userContext = await loadSingleUserContext();
            const prefs = userContext.prefs || {};
            const enabledFeedIds = getStaticEnabledFeedIds(prefs);
            await cleanupStaticPublicRssFiles(enabledFeedIds);

            if (enabledFeedIds.length === 0) return;

            const enabledFeedSet = new Set(enabledFeedIds.map(String));
            const feedIdsToBuild = shouldRunFull
                ? enabledFeedIds
                : pendingFeedIds.filter(feedId => enabledFeedSet.has(String(feedId)));

            if (feedIdsToBuild.length === 0) return;

            console.log(`[Public RSS] Rebuilding ${feedIdsToBuild.length} static feeds${shouldRunFull ? ' (full run)' : ''}...`);
            for (const feedId of feedIdsToBuild) {
                try {
                    await generateAndStoreStaticPublicRss({
                        feedId,
                        userContext,
                        miniflux
                    });
                } catch (error) {
                    console.error(`[Public RSS] Failed to rebuild feed ${feedId}:`, error.message);
                }
            }
        } catch (error) {
            console.error('[Public RSS] Scheduler error:', error);
        } finally {
            this._running = false;
            const hasFollowUpWork = this._forceFullRun || this._pendingFeedIds.size > 0;
            this._schedule(hasFollowUpWork ? SOON_DELAY : FULL_REBUILD_INTERVAL);
        }
    }
};
