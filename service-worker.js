const BUILD_ID = '__BUILD_ID__';
const CACHE_NAME = `m365-consolidation-${BUILD_ID}`;
const APP_SHELL = [
  './',
  './index.html',
  './src/app.js',
  './src/logic.js',
  './src/styles.css',
  './Microsoft-365-Matrix-Export.csv',
  './data/features.json',
  './data/exclusions.json',
  './manifest.webmanifest',
  './version.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(APP_SHELL.map(async (url) => {
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (response.ok) await cache.put(url, response);
      }));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isHtml = request.mode === 'navigate' || (request.headers.get('accept') ?? '').includes('text/html');
  const isAppData = isSameOrigin && (requestUrl.pathname.endsWith('/Microsoft-365-Matrix-Export.csv') || requestUrl.pathname.endsWith('/data/features.json') || requestUrl.pathname.endsWith('/data/exclusions.json') || requestUrl.pathname.endsWith('/version.json'));
  const isSourceScript = isSameOrigin && requestUrl.pathname.startsWith(new URL('./src/', self.location.href).pathname) && requestUrl.pathname.endsWith('.js');

  if (isHtml || isAppData || isSourceScript) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(new Request(request, { cache: 'no-cache' }));
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(new Request(request, { cache: 'no-cache' }));
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    const fallback =
      await cache.match(new URL('./index.html', self.location.href).href) ||
      await cache.match('./index.html') ||
      await cache.match('./');
    if (fallback) return fallback;
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}
