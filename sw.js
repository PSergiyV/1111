const SHELL = 'shell-v1', LIB = 'lib-v1';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (url.pathname.endsWith('.mp3')) return;
    // Сначала сеть (свежие данные), без сети — сохранённая копия
    e.respondWith(
      fetch(req).then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
        return r;
      }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
    );
  } else if (url.hostname === 'cdnjs.cloudflare.com') {
    // Библиотека карты кэшируется, чтобы приложение открывалось без сети
    e.respondWith(caches.open(LIB).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
