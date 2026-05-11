// Service Worker mínimo — habilita critério de instalação PWA
// Sem interceptação de fetch para não interferir em SaaS com dados dinâmicos

const CACHE_VERSION = 'linax-v2';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(chaves =>
            Promise.all(chaves.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Sem handler de fetch — browser gerencia todas as requisições normalmente.
// O SW está registrado apenas para satisfazer os critérios de instalação PWA.
