// Service Worker untuk Sistem Absensi PIA (PWA Support)
const CACHE_NAME = 'pia-pwa-v1';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './pendaftaran.html',
  './absensi-guru.html',
  './absensi-siswa.html',
  './rekap-pembelajaran.html',
  './assets/logo-pia.png',
  './css/dashboard.css',
  './css/style.css',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('PWA Precache partial fail:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Jangan cache API atau POST requests
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-first dengan fallback ke cache
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseToCache).catch(() => {});
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(req);
      })
  );
});

