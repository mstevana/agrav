// Service worker: cache the app shell so Volley installs as a PWA and loads fast.
// Network first (updates land immediately), cache fallback when offline.
const CACHE = 'volley-v1';
const SHELL = [
  './', './index.html', './style.css', './manifest.webmanifest', './icons/icon.svg',
  './src/main.js', './src/net.js', './src/input.js', './src/render.js',
  '../shared/net/protocol.js', '../shared/net/bytes.js', '../shared/net/channel.js', '../shared/net/clock.js',
  '../shared/volley/module.js', '../shared/volley/constants.js', '../shared/volley/sim.js',
  '../shared/volley/bot.js', '../shared/volley/snapshot.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
