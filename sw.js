// ============================================================
// Service Worker — Teacher Portal PWA
// ============================================================
// Bump CACHE_VERSION whenever you deploy significant updates.
// ============================================================

const CACHE_VERSION = 'v1.2.0';
const STATIC_CACHE = `static-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './tailwind.css',
  './manifest.json',
  './icon.svg',
  './js/config.js',
  './js/utils.js',
  './js/api.js',
  './js/grades.js',
  './js/subjects.js',
  './js/comments.js',
  './js/auth.js',
  './js/admin.js',
  './js/student.js',
  './js/grading-sheet.js',
  './js/import.js',
  './js/analytics.js',
  './js/backup.js',
  './js/registrations.js',
  './js/main.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then(c => c.put(req, clone));
        }
        return res;
      }).catch(() => cached);

      return cached || network;
    })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});