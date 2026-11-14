// Hält eine Kopie der App auf dem Handy, damit sie ohne Internet startet, und nimmt Dateien aus dem
// Android-„Teilen“-Menü entgegen (Web Share Target): die Dateien landen kurz im Cache „fin-share“,
// die App holt sie dort ab, importiert sie und löscht sie wieder.
// VERSION setzt tools/app-veroeffentlichen.sh bei jeder Veröffentlichung neu.
const VERSION = '2026-11-14.0736';
const CACHE = 'fin-' + VERSION;
const SHARE = 'fin-share';
const FILES = [
  './', 'index.html', 'core.js', 'sync.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
  'fonts/atkinson-400.woff2', 'fonts/atkinson-700.woff2', 'fonts/barlow-500.woff2', 'fonts/barlow-600.woff2', 'fonts/barlow-700.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('fin-') && k !== CACHE && k !== SHARE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function receiveShare(req) {
  const base = new URL('./', self.registration.scope);
  try {
    const form = await req.formData();
    const files = form.getAll('files').filter(f => f && typeof f !== 'string');
    const c = await caches.open(SHARE);
    for (const k of await c.keys()) await c.delete(k);
    let i = 0;
    for (const f of files) {
      await c.put(new Request(new URL('shared/' + i++ + '?name=' + encodeURIComponent(f.name || 'export.csv'), base)), new Response(f));
    }
    return Response.redirect(new URL('./#import?geteilt=' + i, base).href, 303);
  } catch (err) {
    return Response.redirect(new URL('./#import?geteilt=fehler', base).href, 303);
  }
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (url.origin !== location.origin) return; // GitHub-API: immer übers Netz
  if (req.method === 'POST' && url.pathname.endsWith('/share')) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET') return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' && await cache.match('./'));
    return hit || fetch(req);
  })());
});
