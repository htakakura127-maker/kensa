// 画面ファイルを端末にキャッシュし、圏外でもアプリを開けるようにする
const CACHE = 'kensa-v1';
const ASSETS = ['./', './index.html', './config.js', './manifest.json', './icon-180.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// ネット優先（更新をすぐ反映）、3秒で応答がなければキャッシュを使う。API（別ドメイン）は対象外
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cached = await caches.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    });
    if (!cached) return net;
    const timeout = new Promise(resolve => setTimeout(() => resolve(cached), 3000));
    return Promise.race([net.catch(() => cached), timeout]);
  })());
});
