// Service Worker untuk Sistem Absensi PIA (PWA Support)
const CACHE_NAME = 'pia-pwa-v6';
const PRECACHE_ASSETS = [
  './dashboard.html',
  './rekap-pembelajaran.html',
  './pendaftaran.html',
  './absensi-siswa.html',
  './absensi-guru.html',
  './index.html',
  './assets/logo-pia.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './css/dashboard.css',
  './css/style.css',
  './manifest.json',
  './js/pwa-install.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of PRECACHE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (e) {
          // Precache resilient: tidak menggagalkan aktivasi jika ada 1 aset offline
        }
      }
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
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const toCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, toCache)).catch(() => {});
        }
        return networkResponse;
      })
      .catch(() => caches.match(req))
  );
});
