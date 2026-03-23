import express from 'express';
import {
    generateAndStoreStaticPublicRss,
    generatePublicRssXml,
    getOptionsFromMode,
    hasExplicitPublicRssOverrides,
    isStaticPublicRssEnabled,
    loadSingleUserContext,
    readStaticPublicRss
} from '../services/public-rss-service.js';

const router = express.Router();

function buildOrigin(req) {
    return `${req.protocol}://${req.get('host')}`;
}

function sendXml(res, xml) {
    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.send(xml);
}

function handlePublicRssError(res, error) {
    console.error('Public RSS error:', error);
    const status = error.status || (String(error.message || '').includes('404') ? 404 : 500);
    res.status(status).type('text/plain; charset=utf-8').send(error.message || 'Failed to generate RSS.');
}

router.get('/feed/:feedId(\\d+)', async (req, res) => {
    try {
        const { feedId } = req.params;
        const origin = buildOrigin(req);
        const userContext = await loadSingleUserContext();
        const prefs = userContext.prefs || {};
        if (!isStaticPublicRssEnabled(prefs, feedId)) {
            return res.status(404).type('text/plain; charset=utf-8').send('Public RSS is disabled for this feed.');
        }
        const shouldUseStatic = !hasExplicitPublicRssOverrides(req.query) && isStaticPublicRssEnabled(prefs, feedId);

        if (shouldUseStatic) {
            const storedXml = await readStaticPublicRss(feedId);
            if (storedXml) {
                res.setHeader('X-Tidyflux-Public-Rss', 'static');
                sendXml(res, storedXml);
                return;
            }

            const generated = await generateAndStoreStaticPublicRss({ feedId, userContext });
            res.setHeader('X-Tidyflux-Public-Rss', 'static-generated');
            sendXml(res, generated.xml);
            return;
        }

        const generated = await generatePublicRssXml({
            feedId,
            query: req.query,
            userContext,
            origin
        });
        res.setHeader('X-Tidyflux-Public-Rss', 'live');
        sendXml(res, generated.xml);
    } catch (error) {
        handlePublicRssError(res, error);
    }
});

router.get('/:mode(title|summary|translation)/:feedId(\\d+)', async (req, res) => {
    try {
        const userContext = await loadSingleUserContext();
        const prefs = userContext.prefs || {};
        if (!isStaticPublicRssEnabled(prefs, req.params.feedId)) {
            return res.status(404).type('text/plain; charset=utf-8').send('Public RSS is disabled for this feed.');
        }
        const generated = await generatePublicRssXml({
            feedId: req.params.feedId,
            requestedOptions: getOptionsFromMode(req.params.mode),
            query: req.query,
            userContext,
            origin: buildOrigin(req)
        });
        res.setHeader('X-Tidyflux-Public-Rss', 'live');
        sendXml(res, generated.xml);
    } catch (error) {
        handlePublicRssError(res, error);
    }
});

export default router;
