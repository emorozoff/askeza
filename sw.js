/* askeza 2 — service worker.
   Задача одна: приложение должно открываться в самолёте.
   HTML берём из сети и обновляем кэш; если сети нет — отдаём кэш.
   Статику отдаём из кэша сразу и тихо обновляем в фоне. */

const CACHE = 'askeza-v2.6';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isDoc = req.mode === 'navigate' || req.destination === 'document';

  if (isDoc) {
    // network-first: свежая версия важнее, кэш — страховка на случай офлайна
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // stale-while-revalidate для остального
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});
