// Кэш для работы без интернета. Увеличьте номер версии, если меняете файлы сайта.
var CACHE = 'moneva-v5';
var FILES = ['./', './index.html', './manifest.json', './i18n.js', './pdf.js', './pdf-fonts.js', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './logo-mark.png', './apple-touch-icon.png', './favicon-32.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Сначала отдаём из кэша, в фоне обновляем, если есть интернет.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      var net = fetch(e.request).then(function (res) {
        if (res && res.ok && new URL(e.request.url).origin === location.origin) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return cached || caches.match('./index.html'); });
      return cached || net;
    })
  );
});
