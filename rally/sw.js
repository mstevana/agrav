// Offline shell for Scrap Rally. The simulation, the renderer and the vendored
// three.js are all static files, so a cached copy is a playable game the moment
// a server is reachable again.
const CACHE = 'scrap-rally-v2';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icons/icon.svg',
  './src/main.js', './src/net.js', './src/input.js', './src/hud.js',
  './src/garage.js', './src/audio.js',
  './src/render/scene.js', './src/render/track.js', './src/render/car.js', './src/render/themes.js', './src/render/fx.js',
  '../shared/vendor/three.module.min.js',
  '../shared/gfx/noise.js', '../shared/gfx/surfaces.js', '../shared/gfx/geom.js', '../shared/gfx/merge.js',
  '../shared/net/protocol.js', '../shared/net/bytes.js', '../shared/net/channel.js', '../shared/net/clock.js',
  '../shared/sim/vec.js', '../shared/sim/rng.js', '../shared/sim/spline.js', '../shared/sim/ring-buffer.js',
  '../shared/rally/module.js', '../shared/rally/constants.js', '../shared/rally/cars.js', '../shared/rally/career.js',
  '../shared/rally/weapons.js', '../shared/rally/pickups.js', '../shared/rally/bot.js',
  '../shared/rally/sim/race.js', '../shared/rally/sim/car.js', '../shared/rally/sim/track.js', '../shared/rally/sim/snapshot.js',
  '../shared/rally/tracks/index.js', '../shared/rally/tracks/util.js',
  '../shared/rally/tracks/scrapyard.js', '../shared/rally/tracks/harbour.js', '../shared/rally/tracks/ridge.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api') || url.pathname === '/ws') return;
  // network first, so a running server always wins; the cache is the fallback
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(e.request).then(m => m || caches.match('./index.html')))
  );
});
