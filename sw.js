// Service worker: guarda o app inteiro para funcionar offline.
// A cada versão publicada, AUMENTE o número abaixo (pilares-v2, v3…).
const VERSAO = 'pilares-v4';

const ARQUIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/backup.js',
  'js/db.js',
  'js/foto.js',
  'js/imagem.js',
  'js/planta.js',
  'js/relatorio.js',
  'js/ui.js',
  'js/util.js',
  'vendor/pdf.min.mjs',
  'vendor/pdf.worker.min.mjs',
  'vendor/jspdf.umd.min.js',
  'vendor/jspdf.plugin.autotable.min.js',
  'fonts/OpenSans-Regular.ttf',
  'fonts/OpenSans-SemiBold.ttf',
  'fonts/OpenSans-Bold.ttf',
  'fonts/Poppins-SemiBold.ttf',
  'fonts/Poppins-Bold.ttf',
  'assets/logo-arcoirismar.png',
  'assets/favicon.png',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'pular-espera') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSAO);
    if (req.mode === 'navigate') {
      return (await cache.match('index.html')) || fetch(req);
    }
    return (await cache.match(req, { ignoreSearch: true })) || fetch(req);
  })());
});
