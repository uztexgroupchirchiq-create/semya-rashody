// Кэш для работы без интернета. Сначала сеть (чтобы телефон всегда получал свежую версию), при плохой связи или без интернета — кэш.
// Данные пользователя здесь не хранятся и не удаляются: они лежат в памяти браузера, а не в этом кэше.
var CACHE = 'moneva-v10';
var FILES = ['./', './index.html', './manifest.json', './i18n.js', './pdf.js', './pdf-fonts.js', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './logo-mark.png', './apple-touch-icon.png', './favicon-32.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // cache: 'reload' — берём файлы с сервера, а не из старого HTTP-кэша браузера
      return Promise.all(FILES.map(function (u) {
        return fetch(new Request(u, { cache: 'reload' })).then(function (r) { return r && r.ok ? c.put(u, r) : null; }).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function give(r) { if (!done && r) { done = true; resolve(r); } }
    var timer = setTimeout(function () { caches.match(req).then(give); }, 3000);
    fetch(req, { cache: 'no-cache' }).then(function (res) {
      clearTimeout(timer);
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      give(res);
    }).catch(function () {
      clearTimeout(timer);
      caches.match(req).then(function (c) { return c || caches.match('./index.html'); }).then(function (c) { if (c) give(c); else if (!done) { done = true; resolve(Response.error()); } });
    });
  }));
});
