// ============================================================
// Service Worker — Teacher Portal PWA
// ============================================================
// Caches all static assets. Never caches Apps Script API calls.
// Bump CACHE_VERSION when you deploy significant updates.
// ============================================================

const CACHE_VERSION = 'v1.0.0';
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
  './js/main.js'
];

// ---- Install: pre-cache all static assets ----
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

// ---- Activate: clean old caches ----
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ---- Fetch: serve from cache, refresh in background ----
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET requests.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never touch Apps Script or external origins.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(cached => {
      // Stale-while-revalidate: return cache immediately, refresh behind the scenes.
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

// ---- Allow the page to trigger an immediate update ----
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});