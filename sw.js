// Service worker: guarda la app en el teléfono para que funcione sin internet.
// Sube la versión cuando cambie cualquier archivo de la lista.
const CACHE = 'escudo-v7';
const FILES = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/core/complaint.js',
  'js/core/crypto.js',
  'js/core/evidence.js',
  'js/core/exif.js',
  'js/core/indicators.js',
  'js/core/model.js',
  'js/core/report.js',
  'js/core/safety.js',
  'js/core/storage.js',
  'js/core/unzip.js',
  'js/core/vault.js',
  'js/core/whatsapp.js',
  'js/core/zip.js',
  'js/data/contacts.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primero la caché (rápido y sin datos móviles); si hay red, se actualiza en segundo plano.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
