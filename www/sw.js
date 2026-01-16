const CACHE_NAME = 'tidyflux-cache-v7.0';

const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/css/skeleton.css',
  '/css/variables.css',
  '/css/base.css',
  '/css/themes.css',
  '/css/layout.css',
  '/css/list.css',
  '/css/article.css',
  '/css/modals.css',
  '/css/auth.css',
  '/js/main.js',
  '/js/state.js',
  '/js/dom.js',
  '/js/modules/utils.js',
  '/js/modules/view-manager.js',
  '/js/modules/router.js',
  '/js/modules/events.js',
  '/js/modules/theme-manager.js',
  '/js/modules/auth-manager.js',
  '/js/modules/feed-manager.js',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/manifest.json',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.png',
  '/icons/rss.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(URLS_TO_CACHE))
  );
});

// 接收来自主页面的消息，支持强制更新
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then(response => {
          if (response && response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  if (url.pathname === '/api/favicon') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request);
        })
    );
    return;
  }

  if ((url.pathname.endsWith('.json') && url.pathname.includes('/articles/')) || url.pathname.endsWith('.webp')) {
    const cacheKey = request.url.split('?')[0];
    event.respondWith(
      caches.match(cacheKey, { ignoreVary: true, ignoreSearch: true }).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(new Request(cacheKey, { mode: 'cors', cache: 'no-store' })).then(response => {
          if (response && response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, responseToCache));
          }
          return response;
        });
      })
    );
    return;
  } else if (url.pathname.endsWith('manifest.json')) {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then(response => {
          if (response && response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        });
      })
    );
  } else if (url.pathname.endsWith('.json')) {
    const cacheKey = request.url.split('?')[0];
    event.respondWith(
      fetch(request, { cache: 'reload' })
        .then(response => {
          if (response && response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(cacheKey, responseToCache);
            });
          }
          return response;
        })
        .catch(() => caches.match(cacheKey))
    );
  } else {
    event.respondWith(
      caches.match(request)
        .then(response => {
          if (response) {
            return response;
          }
          return fetch(request);
        })
    );
  }
});
