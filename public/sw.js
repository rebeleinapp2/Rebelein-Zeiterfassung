const CACHE_NAME = 'zeiterfassung-v66';

const ASSETS = [
  '/',
  '/index.html',
  '/icon.svg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force new SW to take over immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Clearing old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim(); // Take control of all clients immediately
});

// IndexedDB Helper für Share Target
const DB_NAME = 'share-target-db';
const STORE_NAME = 'shared-files';

async function storeSharedFile(file) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      event.target.result.createObjectStore(STORE_NAME, { autoIncrement: true });
    };
    request.onsuccess = (event) => {
      const db = event.target.result;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.add(file);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Share Target Handler
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const file = formData.get('file');

          if (file) {
            await storeSharedFile(file);
            console.log('Shared file stored in IDB');
          }

          // Redirect to app with query param to trigger check
          return Response.redirect('/?shared_target=true', 303);
        } catch (err) {
          console.error('Share Target Error:', err);
          return Response.redirect('/?error=share_failed', 303);
        }
      })()
    );
    return;
  }

  // NAVIGATION REQUESTS: Network First (HTML)
  // This ensures we always get the latest index.html from server if online.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/index.html');
      })
    );
    return;
  }

  // ASSETS (JS, CSS, Images): Cache First, fallback to Network AND Cache
  // This validates that if we fetch from network, we save it for next time.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        // Check if we received a valid response
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        // Clone the response because it's a stream and can only be consumed once
        const responseToCache = networkResponse.clone();

        caches.open(CACHE_NAME).then((cache) => {
          // Don't cache API calls or other external stuff if necessary, 
          // but for now we cache everything that isn't excluded.
          // Filtering out sockjs, hmr, etc if in dev, but this is prod SW.
          // Check if it's an asset (js, css, png, etc)
          if (url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|woff2)$/)) {
            cache.put(event.request, responseToCache);
          }
        });

        return networkResponse;
      });
    })
  );
});

// Listener für Nachrichten vom Frontend (z.B. Update-Button geklickt)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
