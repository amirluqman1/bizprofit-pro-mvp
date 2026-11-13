// BizProfit Pro · service worker
// Fail app: ambil versi TERBARU dari internet dahulu (elak masalah cache lama);
// jika tiada internet, guna salinan tersimpan supaya app masih boleh dibuka.
// Data Supabase tidak disimpan di sini: ia sentiasa perlukan internet.
const CACHE = 'bizprofit-app-v4';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/main.js', './js/pwa.js', './js/ui.js', './js/session.js', './js/router.js', './js/format.js',
  './js/pages/utama.js', './js/pages/rekod.js', './js/pages/stok.js',
  './js/pages/pekerja.js', './js/pages/laporan.js', './js/pages/menu.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
  '../config.js'
];
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.81.1/dist/umd/supabase.js';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    try { await cache.add(CDN); } catch { /* CDN boleh disimpan kemudian */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pustaka dari CDN (Supabase, jsPDF) dengan versi tetap: guna salinan dahulu.
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@')) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    })));
    return;
  }

  // Hanya fail app di laman ini. Panggilan ke Supabase (domain lain) tidak disentuh.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });   // semak versi terbaru
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw new Error('Tiada internet dan tiada salinan tersimpan');
    }
  })());
});
