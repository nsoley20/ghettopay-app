const CACHE = 'ghettopay-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './main.js',
  './utils.js',
  './store.js',
  './api.js',
  './manifest.json',
  './screens/auth.js',
  './screens/budget.js',
  './screens/coffre.js',
  './screens/desktop.js',
  './screens/factures.js',
  './screens/home.js',
  './screens/notifs.js',
  './screens/profil.js',
  './screens/send.js',
  './screens/tontine.js',
  './screens/transfert.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
      return cached || net;
    })
  );
});
