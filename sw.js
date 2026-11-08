/* Orbit Rally service worker: saves every game file on first visit,
   then serves them from the phone's storage so the game runs in flight mode. */
const CACHE = 'orbit-rally-v1';
const FILES = [
  './', './index.html', './style.css', './game.js', './manifest.webmanifest',
  './fonts/chakra-petch-latin-500-normal.woff2',
  './fonts/chakra-petch-latin-700-normal.woff2',
  './fonts/jetbrains-mono-latin-500-normal.woff2',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache first: the game never needs the network after the first load.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
