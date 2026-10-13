// Service worker: guarda la app en el teléfono para que funcione sin internet.
// Sube la versión cuando cambie cualquier archivo de la lista.
const CACHE = 'escudo-v8';
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
  'icons/notes.svg',
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
// "Compartir" desde WhatsApp u otra app: los archivos se guardan aquí hasta
// que la persona abre Escudo con su contraseña; entonces se importan y se borran.
const SHARED = 'escudo-compartido';

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARED);
    let i = 0;
    for (const file of form.getAll('archivos')) {
      if (!(file instanceof File)) continue;
      await cache.put(`./compartido/${i++}`, new Response(file, {
        headers: { 'content-type': file.type || 'application/octet-stream', 'x-nombre': encodeURIComponent(file.name) },
      }));
    }
  } catch { /* si falla, la persona puede elegir el archivo a mano */ }
  return Response.redirect('./?compartido=1', 303);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/compartir')) {
    event.respondWith(receiveShare(event.request));
    return;
  }
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
