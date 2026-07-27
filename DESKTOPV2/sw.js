const CACHE = 'lina-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// Estratégia network-first: tenta rede, cai no cache se offline
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return; // nunca cacheia chamadas de API

  // Modelos de reconhecimento facial (~6.8 MB) e a lib: versionados e imutáveis.
  // Cache-first — baixa uma vez só e funciona offline depois.
  if (e.request.url.includes('/models/') || e.request.url.includes('/face-api.min.js')) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
