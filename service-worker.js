const STATIC_CACHE = 'm365-consolidation-static-v1';
const DATA_CACHE = 'm365-consolidation-data-v1';
const APP_SHELL = [
  './',
  './index.html',
  './src/app.js',
  './src/logic.js',
  './src/styles.css',
  './data/features.json',
  './manifest.webmanifest',
  './version.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => fetch(url).then((response) => {
        if (response.ok) return cache.put(url, response);
        return undefined;
      }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => ![STATIC_CACHE, DATA_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;

  if (requestUrl.pathname.endsWith('/data/features.json') || requestUrl.pathname.endsWith('/version.json')) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(cacheFirst(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  const cache = await caches.open(STATIC_CACHE);
  cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || caches.match(request);
  }
}
