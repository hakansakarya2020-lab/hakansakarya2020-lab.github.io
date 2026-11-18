// Offline worker for the iPhone version: keeps copies of the (encrypted) files so the app works
// without internet. Decryption happens in the page (index.html), never here.
const VERSION = 'fba6804b27';
const SHELL = 'vaka-shell-' + VERSION, DATA = 'vaka-data-' + VERSION;
const SHELL_FILES = ['./', 'index.html', 'keystore.js', 'manifest.webmanifest', 'meta.json', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(f => f + '?v=' + VERSION).map(u => new Request(u, { cache: 'reload' }))).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function shell(url) {
  const u = new URL(url.href); u.search = '';
  const c = await caches.open(SHELL);
  try {
    const r = await fetch(u.href, { cache: 'no-cache' });
    if (r.ok) { c.put(u.href + '?v=' + VERSION, r.clone()); return r; }
  } catch (_) {}
  return (await c.match(u.href + '?v=' + VERSION)) || (await c.match(new URL('./?v=' + VERSION, self.registration.scope).href)) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (u.origin !== scope.origin || !u.pathname.startsWith(scope.pathname)) return;
  const rel = u.pathname.slice(scope.pathname.length);
  if (rel.startsWith('data/')) {
    // Encrypted files: cache first (the page also caches them itself).
    e.respondWith(caches.open(DATA).then(c => c.match(rel).then(hit => hit || fetch(req).then(r => { if (r.ok) c.put(rel, r.clone()); return r; }))));
    return;
  }
  if (rel.startsWith('fig/') || rel === 'app.html') return;
  e.respondWith(shell(u));
});

// After unlocking, download every encrypted file so the app works without internet.
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'precache') return;
  e.waitUntil((async () => {
    const meta = await (await fetch('meta.json?v=' + VERSION)).json();
    const files = ['data/app.bin'].concat(meta.figs.map(f => 'data/fig/' + f + '.bin'));
    const c = await caches.open(DATA);
    let done = 0;
    const report = async () => {
      for (const cl of await self.clients.matchAll()) cl.postMessage({ type: 'progress', done, total: files.length });
    };
    const queue = files.slice();
    async function worker() {
      while (queue.length) {
        const f = queue.shift();
        if (!(await c.match(f))) {
          try { const r = await fetch(f + '?v=' + VERSION); if (r.ok) await c.put(f, r); } catch (_) {}
        }
        done++;
        if (done % 20 === 0 || done === files.length) await report();
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
  })());
});
