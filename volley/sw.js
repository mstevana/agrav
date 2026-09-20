// Service worker: cache the app shell so Volley installs as a PWA and loads fast.
// Network first (updates land immediately), cache fallback when offline.
// Bumped when the shell changes. Every path is relative so the app also works from a
// project subpath (GitHub Pages) — and the solo engine is cached too, so an installed
// copy plays offline against bots with no server.
const CACHE = 'volley-v2';
const SHELL = [
  './', './index.html', './style.css', './manifest.webmanifest', './icons/icon.svg',
  './src/main.js', './src/net.js', './src/input.js', './src/render.js',
  '../shared/net/protocol.js', '../shared/net/bytes.js', '../shared/net/channel.js', '../shared/net/clock.js',
  '../shared/sim/ring-buffer.js',
  '../shared/volley/module.js', '../shared/volley/module1.js', '../shared/volley/module3.js',
  '../shared/volley/constants.js', '../shared/volley/sim.js',
  '../shared/volley/bot.js', '../shared/volley/snapshot.js',
  '../server/solo.js', '../server/lobby.js', '../server/room.js', '../server/session.js',
  '../server/games.js', '../server/store.js', '../server/config.js', '../server/log.js',
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
