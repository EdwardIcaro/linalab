// Service Worker mínimo — habilita critério de instalação PWA
// Sem cache agressivo para evitar dados desatualizados num SaaS

const CACHE_VERSION = 'linax-v1';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Remove versões antigas de cache
    event.waitUntil(
        caches.keys().then(chaves =>
            Promise.all(chaves.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Estratégia network-first: sempre busca da rede, sem interferir nas chamadas de API
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // Não intercepta chamadas de API nem recursos de terceiros
    if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
