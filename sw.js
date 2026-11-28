// Pulse service worker: app shell offline cache (songs live in IndexedDB).
const V = 'pulse-v16';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/core.js', 'js/views.js', 'js/np.js', 'js/player.js', 'js/library.js', 'js/tags.js', 'js/util.js', 'js/platform-web.js', 'js/spotify.js', 'js/coverworker.js', 'js/companion.js', 'js/online.js', 'js/ambient.js', 'js/listen.js', 'js/transcribe.js', 'js/transcribe-worker.js', 'js/practice.js', 'js/smart.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // Network first so updates arrive, but after 3 s on a weak connection use the cached copy.
  // Only page loads fall back to index.html: a missing script must fail, not load as HTML.
  const cached = () => caches.match(e.request, { ignoreSearch: true });
  const offline = () => cached().then((r) => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()));
  e.respondWith(new Promise((res) => {
    let done = false; const finish = (r) => { if (!done) { done = true; res(r); } };
    const t = setTimeout(() => cached().then((r) => { if (r) finish(r); }), 3000);
    fetch(e.request).then((r) => {
      clearTimeout(t);
      if (r.ok) { const c = r.clone(); caches.open(V).then((ca) => ca.put(e.request, c)); }
      finish(r);
    }).catch(() => { clearTimeout(t); if (!done) offline().then(finish); });
  }));
});
