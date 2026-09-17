// AGRAV — offline shell cache. The client shell (HTML, JS, three.js, shared
// sim) is precached so the app opens instantly from the home screen; racing
// itself needs the server, so this is about launch, not play.
const CACHE = 'agrav-v2';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './src/main.js', './src/net.js', './src/input.js', './src/hud.js', './src/audio.js', './src/settings.js', './src/music.js',
  './src/render/track.js', './src/render/vehicle.js', './src/render/fx.js', './src/render/fxshaders.js', './src/render/textures.js',
  './src/render/surfaces.js', './src/render/props.js', './src/render/terrain.js', './src/render/noise.js', './src/render/livery.js', './src/render/exhaust.js', './src/render/trails.js',
  './src/render/env/index.js', './src/render/env/city.js', './src/render/env/canyon.js', './src/render/env/coast.js', './src/render/env/common.js',
  './src/render/env/sea.js', './src/render/env/hell.js', './src/render/env/moon.js', './src/render/env/jungle.js',
  '../shared/vendor/three.module.min.js', '../shared/gfx/bloom.js', '../shared/gfx/merge.js',
  '../shared/net/protocol.js', '../shared/net/bytes.js', '../shared/net/channel.js', '../shared/net/clock.js',
  '../shared/sim/vec.js', '../shared/sim/rng.js', '../shared/sim/spline.js', '../shared/sim/ring-buffer.js',
  '../shared/agrav/module.js', '../shared/agrav/constants.js', '../shared/agrav/vehicles.js', '../shared/agrav/bot.js',
  '../shared/agrav/sim/race.js', '../shared/agrav/sim/vehicle.js', '../shared/agrav/sim/weapons.js', '../shared/agrav/sim/snapshot.js',
  '../shared/agrav/tracks/index.js', '../shared/agrav/tracks/util.js', '../shared/agrav/tracks/meridian.js',
  '../shared/agrav/tracks/canyon.js', '../shared/agrav/tracks/vanta.js', '../shared/agrav/tracks/inferno.js', '../shared/agrav/tracks/selene.js', '../shared/agrav/tracks/osa.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// network first so updates land; cache as the fallback
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
