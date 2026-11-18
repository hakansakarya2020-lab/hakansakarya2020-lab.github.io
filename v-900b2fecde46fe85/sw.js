// Vaka Kitabı offline worker. Files on the server are AES-GCM encrypted; this worker
// decrypts them on the device with the key saved after the password was entered.
const VERSION = '71974b8247';
const SHELL = 'vaka-shell-' + VERSION, DATA = 'vaka-data-' + VERSION;
const SHELL_FILES = ['./', 'index.html', 'keystore.js', 'manifest.webmanifest', 'meta.json', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
importScripts('keystore.js');

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(f => f + '?v=' + VERSION).map(u => new Request(u, { cache: 'reload' }))).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function encrypted(path) {
  const c = await caches.open(DATA);
  let r = await c.match(path);
  if (!r) {
    r = await fetch(path + '?v=' + VERSION, { cache: 'reload' });
    if (!r.ok) throw new Error('indirilemedi: ' + path);
    await c.put(path, r.clone());
  }
  return r.arrayBuffer();
}

async function shell(req) {
  const u = new URL(req.url); u.search = '';
  const c = await caches.open(SHELL);
  try {
    const r = await fetch(req, { cache: 'no-cache' });
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
  if (rel === 'app.html') {
    e.respondWith((async () => {
      const key = await vkGet().catch(() => null);
      if (!key) return Response.redirect(scope.href, 302);
      try {
        const html = await vkGunzip(await vkDecrypt(key, await encrypted('data/app.bin')));
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      } catch (err) {
        return new Response('<meta charset=utf-8><meta name=viewport content="width=device-width"><p style="font:16px system-ui;padding:24px">Uygulama açılamadı (' + err.message + '). İnternete bağlanıp tekrar deneyin. <a href="./">Geri</a></p>', { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }
  const m = rel.match(/^fig\/([A-Za-z0-9_-]+)\.jpg$/);
  if (m) {
    e.respondWith((async () => {
      const key = await vkGet();
      const img = await vkDecrypt(key, await encrypted('data/fig/' + m[1] + '.bin'));
      return new Response(img, { headers: { 'Content-Type': 'image/jpeg' } });
    })().catch(() => new Response('', { status: 404 })));
    return;
  }
  if (rel.startsWith('data/')) return;
  e.respondWith(shell(req));
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
